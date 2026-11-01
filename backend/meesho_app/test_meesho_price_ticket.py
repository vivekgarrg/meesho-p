"""Price changes sent straight to Meesho: the sheet uploaded as the panel attaches it, then a Support ticket."""

import io
import json
import os
from decimal import Decimal as D
from unittest import mock

import openpyxl
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from . import meesho_sync
from .models import (FinalPrice, MeeshoAccount, MeeshoInventory, MeeshoPriceUpdate, MeeshoSyncRun, ParentItemPrice)

KEY = __import__("base64").b64encode(b"k" * 32).decode()
FILE = "https://gcs-supl-xp-agent-support-aggregator-prd.storage.googleapis.com/TicketInputAttachments/3564327/1/msp_Choti_Pragi.xlsx"


class Res:
    def __init__(self, status, body):
        self.status_code, self._body = status, body

    def json(self):
        return self._body


class PriceTicketTests(TestCase):
    def setUp(self):
        key = mock.patch.dict(os.environ, {"MEESHO_SYNC_KEY": KEY})      # setUp encrypts the session too
        key.start()
        self.addCleanup(key.stop)
        self.rudam = Business.objects.create(name="Rudam")
        self.cosmify = Business.objects.create(name="Cosmify")
        self.admin = User.objects.create_user(username="a", password="pw", role=User.ROLE_SUPER_ADMIN)
        for b in (self.rudam, self.cosmify):
            Membership.objects.create(user=self.admin, business=b)
        cookies = meesho_sync.encrypt(json.dumps({"connect.sid": "s"}))
        self.acct = MeeshoAccount.objects.create(business=self.cosmify, phone_number="9000000001", password_enc="x", status="ACTIVE",
                                                 supplier_id="3564327", supplier_identifier="lffy4", cookies_enc=cookies)
        # The parent lives in Rudam's pricing; Cosmify lists its SKU on Meesho under its own catalog ids.
        self.parent = ParentItemPrice.objects.create(business=self.rudam, item_id="Choti Pragi")
        FinalPrice.objects.create(business=self.rudam, sku_id="pragi-s", parent=self.parent)
        MeeshoInventory.objects.create(business=self.cosmify, serial_no=1, catalog_name="c", catalog_id=606662647, product_name="p",
                                       product_id=1139807680, style_id="pragi-s", variation="Free Size", variation_id=167, system_stock_count=5)
        self.c = APIClient()
        self.c.force_authenticate(self.admin)
        self.fields = {"description": "Raise these", "reason": "raw_material_cost_increase", "callback_number": "8273343222",
                       "email": "owner@example.com"}
        self.sent = []

    def meesho(self, upload=None, ticket=None):
        def post(url, headers=None, files=None, data=None, json=None, timeout=None):
            self.sent.append({"url": url, "headers": headers, "files": files, "data": data, "json": json})
            if url.endswith("/input-attachment"):
                return upload or Res(200, {"data": {"file_url": FILE}})
            return ticket or Res(200, {"data": {"ticket_id": "TKT-778899"}})
        return mock.patch("meesho_app.meesho_price_ticket.requests.post", side_effect=post)

    def send_parent(self, **kw):
        body = {"rows": [{"sku_id": "pragi-s", "msp": 499}], "target_business": self.cosmify.pk, **self.fields, **kw}
        return self.c.post(f"/api/business/{self.rudam.id}/parent-prices/Choti Pragi/price-ticket/", body, format="json")

    def test_the_sheet_is_uploaded_then_the_ticket_raised_for_the_chosen_business(self):
        with self.meesho():
            r = self.send_parent()
        self.assertEqual(r.status_code, 201, r.data)
        upload, ticket = self.sent
        self.assertTrue(upload["url"].endswith("/api/experience/support/api/v1/upload/supplier-support/input-attachment"))
        self.assertEqual(upload["data"], {"is_validation_required": "true", "entity_id": "3564327", "entity_type": "SUPPLIER",
                                          "reference_template_key": "product_catalog_template_btn", "sub_category_id": "15",
                                          "validation_key": "input_attachment"})
        name, data, mime = upload["files"]["file"]
        self.assertEqual(name, "msp_Choti_Pragi.xlsx")
        ws = openpyxl.load_workbook(io.BytesIO(data)).active
        self.assertEqual(list(ws.iter_rows(min_row=2, values_only=True))[0][:5], (606662647, 1139807680, "Free Size", 167, 499.0))  # Cosmify's ids
        self.assertEqual(upload["headers"]["identifier"], "lffy4")
        t = ticket["json"]
        self.assertEqual((t["category_id"], t["sub_category_id"], t["supplier_id"], t["supplier_identifier"], t["supplier_email_id"]),
                         ("2", "15", "3564327", "lffy4", "owner@example.com"))
        details = {d["key"]: d["value"] for d in t["ticket_details"]}
        self.assertEqual(details, {"input_attachment": [FILE], "ticket_desc": "Raise these",
                                   "price_increase_reason": "raw_material_cost_increase", "callback_number": "8273343222"})
        run = MeeshoSyncRun.objects.get(kind="PRICE_TKT")
        self.assertEqual((run.status, run.account_id, run.result["ticket"], run.result["file_url"]), ("OK", self.acct.pk, "TKT-778899", FILE))
        self.assertIn("ticket TKT-778899", r.data["run"]["message"])
        log = self.c.get(f"/api/business/{self.rudam.id}/meesho-price-tickets/").data
        self.assertEqual((log["tickets"][0]["ticket"], [b["name"] for b in log["businesses"]]), ("TKT-778899", ["Cosmify"]))

    def test_meesho_refusing_the_sheet_raises_no_ticket_and_says_why(self):
        with self.meesho(upload=Res(400, {"message": "Row 2: Variation ID doesn't belong to this catalog"})):
            r = self.send_parent()
        self.assertEqual(r.status_code, 502)
        self.assertIn("Variation ID doesn't belong", r.data["error"])
        self.assertEqual(len(self.sent), 1)                                    # no ticket without the file
        self.assertEqual(MeeshoSyncRun.objects.get(kind="PRICE_TKT").status, "FAILED")

    def test_an_expired_session_is_said_plainly(self):
        with self.meesho(upload=Res(463, {"message": "Unauthorized call. Token missing."})):
            r = self.send_parent()
        self.assertIn("session has expired", r.data["error"])

    def test_the_business_must_be_chosen_and_have_the_skus(self):
        with self.meesho():
            self.assertEqual(self.send_parent(target_business="").status_code, 400)                       # not chosen
            r = self.send_parent(target_business=self.rudam.pk)                                           # no Meesho account
            self.assertEqual(r.status_code, 400)
            MeeshoAccount.objects.create(business=self.rudam, phone_number="9000000002", password_enc="x", status="ACTIVE",
                                         supplier_id="1", supplier_identifier="x")
            r = self.send_parent(target_business=self.rudam.pk)                                           # SKU not in its inventory
            self.assertEqual(r.status_code, 400)
            self.assertIn("Rudam's Meesho inventory", r.data["skipped"][0]["why"])
            self.assertEqual(self.send_parent(callback_number="123").status_code, 400)
            self.assertEqual(self.send_parent(email="nope").status_code, 400)
        self.assertEqual(self.sent, [])                                                                   # nothing sent

    def test_only_an_admin_sends(self):
        worker = User.objects.create_user(username="w", password="pw", role=User.ROLE_BUSINESS_USER)
        Membership.objects.create(user=worker, business=self.rudam)
        c = APIClient()
        c.force_authenticate(worker)
        r = c.post(f"/api/business/{self.rudam.id}/parent-prices/Choti Pragi/price-ticket/",
                   {"rows": [{"sku_id": "pragi-s", "msp": 1}], "target_business": self.cosmify.pk, **self.fields}, format="json")
        self.assertEqual(r.status_code, 403)

    def test_the_price_update_sheet_goes_for_its_own_business_once_confirmed(self):
        inv = MeeshoInventory.objects.get()
        MeeshoPriceUpdate.objects.create(business=self.cosmify, inventory=inv, new_msp=D("450"))
        url = f"/api/business/{self.cosmify.id}/meesho-price-update/ticket/"
        with self.meesho():
            self.assertEqual(self.c.post(url, {**self.fields, "target_business": self.rudam.pk}, format="json").status_code, 400)
            r = self.c.post(url, {**self.fields, "target_business": self.cosmify.pk}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(self.sent[0]["files"]["file"][0], "meesho_price_update.xlsx")
