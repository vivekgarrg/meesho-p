"""SKU Pricing's price change: one product across every business, with Meesho's ids and price beside our cost."""

from decimal import Decimal as D
from io import BytesIO
from unittest import mock

import openpyxl
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from . import meesho_sync
from .models import FinalPrice, MeeshoAccount, MeeshoCatalog, MeeshoListing, ParentItemPrice


class EverywhereTests(TestCase):
    def setUp(self):
        self.rudam = Business.objects.create(name="Rudam")
        self.cosmify = Business.objects.create(name="Cosmify Mart")
        self.other = Business.objects.create(name="Not mine")
        self.user = User.objects.create_user(username="pricer", password="pw", role=User.ROLE_BUSINESS_USER)
        for b in (self.rudam, self.cosmify):
            Membership.objects.create(user=self.user, business=b)
        self.c = APIClient()
        self.c.force_authenticate(self.user)
        for b, cost in ((self.rudam, "40"), (self.cosmify, "42"), (self.other, "40")):
            p = ParentItemPrice.objects.create(business=b, item_id="DIYA", item_price=D(cost), tax_percent=0,
                                               packaging_cost=D("0"), final_price=D(cost))
            FinalPrice.objects.create(business=b, sku_id="DIYA-1", parent=p, final_price=D(cost))
        FinalPrice.objects.create(business=self.cosmify, sku_id="diya-2", final_price=D("50"))        # Cosmify's, not linked
        FinalPrice.objects.create(business=self.rudam, sku_id="DIYA-2",
                                  parent=ParentItemPrice.objects.get(business=self.rudam, item_id="DIYA"), final_price=D("44"))
        now = timezone.now()
        for b, cid, price in ((self.cosmify, 555, "199.00"), (self.other, 777, "150.00")):
            acct = MeeshoAccount.objects.create(business=b, phone_number=f"9{cid}", password_enc="x", status="ACTIVE")
            cat = MeeshoCatalog.objects.create(account=acct, catalog_id=cid, name="Diya", seen_at=now)
            MeeshoListing.objects.create(account=acct, catalog=cat, product_id=cid * 10, variation_id=cid * 100, sku_id="DIYA-1",
                                         variation="Free Size", selling_price=D(price), inventory=12, seen_at=now)
        self.api = f"/api/business/{self.rudam.id}/parent-prices/DIYA/"

    def test_every_business_with_meesho_price_and_our_cost(self):
        r = self.c.get(self.api + "everywhere/")
        self.assertEqual(r.status_code, 200, r.data)
        by = {b["business_name"]: b for b in r.data["businesses"]}
        self.assertEqual(list(by), ["Rudam", "Cosmify Mart"])                       # the business on screen first; never one not yours
        cos = {row["sku_id"]: row for row in by["Cosmify Mart"]["rows"]}
        self.assertEqual(cos["DIYA-1"]["meesho"][0]["selling_price"], 199.0)
        self.assertEqual((cos["DIYA-1"]["meesho"][0]["catalog_id"], cos["DIYA-1"]["meesho"][0]["variation_id"]), (555, 55500))
        self.assertEqual((cos["DIYA-1"]["cost"], cos["DIYA-1"]["linked"]), (42.0, True))
        self.assertEqual((cos["diya-2"]["linked"], cos["diya-2"]["cost"], cos["diya-2"]["meesho"]), (False, 50.0, []))
        self.assertTrue(by["Cosmify Mart"]["connected"])
        self.assertFalse(by["Rudam"]["connected"])                                   # no Meesho account
        self.assertIsNotNone(by["Cosmify Mart"]["meesho_read_at"])

    def test_the_sheet_for_another_business_uses_its_own_meesho_ids(self):
        r = self.c.post(self.api + "price-sheet/", {"target_business": self.cosmify.id,
                                                    "rows": [{"sku_id": "DIYA-1", "msp": 229}]}, format="json")
        self.assertEqual(r.status_code, 200, getattr(r, "data", r.content[:200]))
        ws = openpyxl.load_workbook(BytesIO(r.content)).active
        self.assertEqual([c.value for c in ws[2]][:5], [555, 5550, "Free Size", 55500, 229])
        r = self.c.post(self.api + "price-sheet/", {"target_business": self.other.id,
                                                    "rows": [{"sku_id": "DIYA-1", "msp": 229}]}, format="json")
        self.assertEqual(r.status_code, 403)

    def test_sync_reads_every_business_inventory_again(self):
        with mock.patch.object(meesho_sync, "_queue_run", return_value=(None, True)) as q:
            r = self.c.post(self.api + "everywhere/sync/")
        self.assertEqual((r.status_code, r.data["queued"]), (202, 1))                 # Cosmify's account only — "Not mine" isn't
        self.assertEqual(q.call_args.args[0].business, self.cosmify)


class GluedVariationTests(TestCase):
    """Meesho spells many SKUs with the variation glued on: "long-carving-lota-001Free Size" is our "long-carving-lota-001"."""

    def setUp(self):
        self.rudam = Business.objects.create(name="Rudam")
        self.user = User.objects.create_user(username="p2", password="pw", role=User.ROLE_BUSINESS_USER)
        Membership.objects.create(user=self.user, business=self.rudam)
        p = ParentItemPrice.objects.create(business=self.rudam, item_id="Long Carving Lota", item_price=D("300"), tax_percent=0,
                                           packaging_cost=D("0"), final_price=D("300"))
        FinalPrice.objects.create(business=self.rudam, sku_id="long-carving-lota-001", parent=p, final_price=D("300"))
        acct = MeeshoAccount.objects.create(business=self.rudam, phone_number="9111", password_enc="x", status="ACTIVE")
        cat = MeeshoCatalog.objects.create(account=acct, catalog_id=528323303, name="Lota", seen_at=timezone.now())
        MeeshoListing.objects.create(account=acct, catalog=cat, product_id=1, variation_id=167, sku_id="long-carving-lota-001Free Size",
                                     variation="Free Size", selling_price=D("799"), inventory=5, seen_at=timezone.now())
        self.c = APIClient()
        self.c.force_authenticate(self.user)

    def test_the_spelling(self):
        from .views import meesho_sku
        self.assertEqual(meesho_sku("long-carving-lota-001Free Size", "Free Size"), "long-carving-lota-001")
        self.assertEqual(meesho_sku("frock-006", "0-6 Months"), "frock-006")              # nothing glued: as it is
        self.assertEqual(meesho_sku("Free Size", "Free Size"), "Free Size")               # never down to nothing

    def test_it_is_found_as_ours(self):
        r = self.c.get(f"/api/business/{self.rudam.id}/parent-prices/Long Carving Lota/everywhere/")
        row = r.data["businesses"][0]["rows"][0]
        self.assertEqual((row["sku_id"], row["meesho"][0]["catalog_id"], row["meesho"][0]["selling_price"]),
                         ("long-carving-lota-001", 528323303, 799.0))

    def test_no_glued_twin_is_added_to_sku_pricing(self):
        from .views import sync_meesho_skus
        self.assertEqual(sync_meesho_skus(self.rudam), 0)
        self.assertFalse(FinalPrice.objects.filter(sku_id__icontains="Free Size").exists())
