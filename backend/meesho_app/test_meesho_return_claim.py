"""Return claims raised on Meesho from the portal: found by AWB, raised on the return's own business."""

import json
import os
from unittest import mock

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from . import meesho_return_claim as rc
from . import meesho_sync
from .models import MeeshoAccount, MeeshoReturnClaim, ReturnDelivery

KEY = __import__("base64").b64encode(b"k" * 32).decode()
GCS = "https://gcs-supl-xp-agent-support-aggregator-prd.storage.googleapis.com/TicketInputAttachments/3564327/1/x.png"


class Res:
    def __init__(self, status, body):
        self.status_code, self._body, self.text = status, body, json.dumps(body)

    def json(self):
        return self._body


SCHEMA = {"data": {"fields": [
    {"key": "sub_order_number", "type": "action_single_text_box", "label": "Sub Order Number", "is_mandatory": True},
    {"key": "packet_state", "type": "drop_down", "label": "State of the packet", "is_mandatory": True,
     "options": [{"value": "intact", "label": "Intact"}, {"value": "tampered", "label": "Tampered"}]},
    {"key": "product_openingvideo_link", "type": "video_file", "label": "Unpacking Video", "is_mandatory": True},
    {"key": "ticket_desc", "type": "text_area", "label": "Description", "is_mandatory": True},
    {"key": "attachments", "type": "img_file", "label": "Attachments", "is_mandatory": False},
]}}


class ReturnClaimTests(TestCase):
    def setUp(self):
        key = mock.patch.dict(os.environ, {"MEESHO_SYNC_KEY": KEY})
        key.start()
        self.addCleanup(key.stop)
        cache.clear()
        self.rudam = Business.objects.create(name="Rudam")
        self.cosmify = Business.objects.create(name="Cosmify")
        self.user = User.objects.create_user(username="desk", password="pw", role=User.ROLE_BUSINESS_USER)
        for b in (self.rudam, self.cosmify):
            Membership.objects.create(user=self.user, business=b)
        cookies = meesho_sync.encrypt(json.dumps({"connect.sid": "s"}))
        MeeshoAccount.objects.create(business=self.rudam, phone_number="9000000001", password_enc="x", status="ACTIVE",
                                     supplier_id="3564327", supplier_identifier="lffy4", cookies_enc=cookies)
        MeeshoAccount.objects.create(business=self.cosmify, phone_number="9000000002", password_enc="x", status="ACTIVE",
                                     supplier_id="111", supplier_identifier="cosm1", cookies_enc=cookies)
        self.ret = ReturnDelivery.objects.create(business=self.cosmify, suborder_no="341668276271146947_1", awb_number="R2718300838FPL",
                                                 courier_partner="Delhivery", sku="DIYA-1", type_of_return="Customer Return")
        self.c = APIClient()
        self.c.force_authenticate(self.user)
        self.api = f"/api/business/{self.rudam.id}/return-claim/"

    def test_the_schema_is_read_leniently(self):
        f = rc.parse_fields(SCHEMA)
        self.assertEqual([x["key"] for x in f], ["sub_order_number", "packet_state", "product_openingvideo_link", "ticket_desc", "attachments"])
        self.assertEqual(f[1]["options"][1], {"value": "tampered", "label": "Tampered"})
        self.assertEqual((f[0]["required"], f[4]["required"]), (True, False))

    def test_the_awb_finds_the_return_and_its_business(self):
        r = self.c.get(f"{self.api}lookup/", {"code": ["NOT-A-CODE", "r2718300838fpl"]})
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual((r.data["matched_code"], r.data["return"]["business_name"], r.data["return"]["sub_order_no"]),
                         ("R2718300838FPL", "Cosmify", "341668276271146947_1"))
        self.assertTrue(r.data["return"]["connected"])
        self.assertEqual(self.c.get(f"{self.api}lookup/", {"code": "NOPE"}).status_code, 404)

    def test_a_business_that_isnt_yours_is_never_used(self):
        other = Business.objects.create(name="Not mine")
        r = self.c.get(f"{self.api}options/", {"business_id": other.id})
        self.assertEqual(r.status_code, 403)

    def test_the_claim_goes_to_the_returns_own_business_as_the_panel_sends_it(self):
        sent = []

        def post(url, headers=None, json=None, timeout=None, **kw):
            sent.append((url, headers, json))
            if url.endswith("subcategorySchema"):
                return Res(200, SCHEMA)
            return Res(200, {"data": {"ticket_id": "TKT-77"}})
        values = {"sub_order_number": "341668276271146947_1", "packet_state": "tampered",
                  "product_openingvideo_link": [GCS], "ticket_desc": "items missing from this return"}
        with mock.patch.object(rc.requests, "post", side_effect=post):
            r = self.c.post(self.api, {"business_id": self.cosmify.id, "return_id": self.ret.id, "sub_category_id": "2",
                                       "sub_category": "Items missing", "values": values, "email": "a@b.co"}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        url, headers, body = sent[-1]
        self.assertTrue(url.endswith("/api/experience/support/createTicket"))
        self.assertEqual(headers["identifier"], "cosm1")                                   # Cosmify's account, not Rudam's
        self.assertEqual((body["supplier_id"], body["supplier_identifier"], body["category_id"], body["sub_category_id"]),
                         ("111", "cosm1", "1", "2"))
        self.assertEqual(body["faq_classification_info"],
                         {"faq_classification_id": "", "supplier_selected_sub_category_id": 2, "supplier_selected_category_id": 1, "misc": {}})
        by_key = {d["key"]: d for d in body["ticket_details"]}
        self.assertEqual(by_key["packet_state"], {"key": "packet_state", "type": "drop_down", "label": "State of the packet",
                                                  "value": "tampered", "selectedLabel": "Tampered"})
        self.assertEqual(by_key["product_openingvideo_link"]["value"], [GCS])
        self.assertEqual(by_key["attachments"]["value"], [])                                  # every field the form has
        self.assertEqual(r.data["claim"]["ticket"], "TKT-77")
        self.ret.refresh_from_db()
        self.assertEqual((self.ret.claim_status, self.ret.claim_reference), ("RAISED", "TKT-77"))

    def test_a_missing_field_sends_nothing(self):
        with mock.patch.object(rc.requests, "post", return_value=Res(200, SCHEMA)) as post:
            r = self.c.post(self.api, {"business_id": self.cosmify.id, "sub_category_id": "2", "values": {"ticket_desc": "x"},
                                       "email": "a@b.co"}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("Unpacking Video", r.data["error"])
        self.assertEqual(post.call_count, 1)                                                  # only the schema was read
        self.assertFalse(MeeshoReturnClaim.objects.exists())

    def test_a_refusal_is_kept_and_the_return_is_left_alone(self):
        def post(url, **kw):
            return Res(200, SCHEMA) if url.endswith("subcategorySchema") else Res(400, {"message": "Sub order not eligible"})
        values = {"sub_order_number": "341668276271146947_1", "packet_state": "intact", "product_openingvideo_link": [GCS], "ticket_desc": "x"}
        with mock.patch.object(rc.requests, "post", side_effect=post):
            r = self.c.post(self.api, {"business_id": self.cosmify.id, "return_id": self.ret.id, "sub_category_id": "2",
                                       "values": values, "email": "a@b.co"}, format="json")
        self.assertEqual(r.status_code, 502)
        self.assertIn("Sub order not eligible", r.data["error"])
        self.assertEqual(MeeshoReturnClaim.objects.get().status, "FAILED")
        self.ret.refresh_from_db()
        self.assertEqual(self.ret.claim_status, "UNREVIEWED")

    def test_uploads_go_to_meesho_and_too_big_ones_are_refused(self):
        with mock.patch.object(rc.requests, "post", return_value=Res(200, {"data": {"url": GCS}})) as post:
            r = self.c.post(f"{self.api}upload/", {"business_id": self.cosmify.id,
                                                   "file": SimpleUploadedFile("w.png", b"png", content_type="image/png")}, format="multipart")
        self.assertEqual((r.status_code, r.data["url"]), (200, GCS))
        self.assertEqual(post.call_args.kwargs["data"], {"is_validation_required": "false", "entity_id": "111", "entity_type": "SUPPLIER"})
        with mock.patch.object(rc, "MAX_UPLOAD", 2):
            r = self.c.post(f"{self.api}upload/", {"business_id": self.cosmify.id,
                                                   "file": SimpleUploadedFile("v.mp4", b"12345", content_type="video/mp4")}, format="multipart")
        self.assertEqual(r.status_code, 400)

    def test_a_field_is_checked_with_meesho(self):
        def post(url, json=None, **kw):
            if url.endswith("subcategorySchema"):
                return Res(200, SCHEMA)
            self.assertEqual(json["ticket_details"], [{"key": "sub_order_number", "type": "action_single_text_box",
                                                       "label": "Sub Order Number", "value": "341668276271146947_1"}])
            return Res(200, {"is_valid": False, "message": "Sub order is not eligible for this issue"})
        with mock.patch.object(rc.requests, "post", side_effect=post):
            r = self.c.post(f"{self.api}validate/", {"business_id": self.cosmify.id, "sub_category_id": "2",
                                                     "values": {"sub_order_number": "341668276271146947_1"}, "keys": ["sub_order_number"]},
                            format="json")
        self.assertEqual((r.data["ok"], r.data["message"]), (False, "Sub order is not eligible for this issue"))
