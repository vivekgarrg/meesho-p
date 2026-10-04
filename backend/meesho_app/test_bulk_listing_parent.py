"""Meesho bulk listing: every generated batch goes under a parent SKU.

End to end against the bundled Meesho template, so these prove a real
generation — sheet built, batch saved, SKUs registered — links correctly, not
just that the parent fields are validated.
"""

import json
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from . import bulk_listing as bl
from .models import BulkListingBatch, FinalPrice, ParentItemPrice, WorkerTask

PRICING = {"item_price": "40", "tax_percent": 5, "packaging_cost": "2"}   # final 44.00


def valid_shared(spec):
    """A value for every shared field the template requires, chosen from the
    template's own options where it has them."""
    shared = {}
    for f in spec["fields"]:
        if f.get("role") in ("title", "sku", "style", "group_id") or str(f.get("role") or "").startswith("image_"):
            continue
        if not f.get("required"):
            continue
        if f.get("options"):
            india = next((o for o in f["options"] if o.strip().lower() == "india"), None)
            shared[f["key"]] = india or f["options"][0]
        elif f.get("money_max") is not None or f.get("type") == "number":
            shared[f["key"]] = "299"
        else:
            shared[f["key"]] = "Test value"
    for f in spec["fields"]:
        if f.get("role") == "wrong_defective_price":
            shared[f["key"]] = "279"
    return shared


class ListingParentTestCase(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="o", password="pw", role=User.ROLE_SUPER_ADMIN)
        self.business = Business.objects.create(name="B")
        Membership.objects.create(user=self.user, business=self.business)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.base = f"/api/business/{self.business.id}"
        self.spec = bl.parse_template(bl.load_workbook(bl.built_in_path("puja_articles")))
        self.shared = valid_shared(self.spec)

    def generate(self, parent=None, skus=("DIYA-001", "DIYA-002"), shared=None):
        payload = {
            "mode": "new",
            "shared": self.shared if shared is None else shared,
            "image_urls": [f"https://example.com/{s}.jpg" for s in skus],
            "rows": [{"product_name": f"Brass Diya {s}", "sku_id": s, "style_id": s,
                      "images": [f"https://example.com/{s}.jpg"], "overrides": {}} for s in skus],
        }
        if parent is not None:
            payload["parent"] = parent
        return self.client.post(f"{self.base}/bulk-listing/generate/", {
            "platform": "meesho", "built_in": "puja_articles", "payload": json.dumps(payload),
        }, format="multipart")

    def assert_nothing_written(self):
        self.assertEqual(BulkListingBatch.objects.count(), 0)
        self.assertEqual(FinalPrice.objects.count(), 0)
        self.assertEqual(WorkerTask.objects.count(), 0)


class ParentRequiredTests(ListingParentTestCase):
    def test_a_batch_without_a_parent_is_refused_and_writes_nothing(self):
        r = self.generate(parent=None)
        self.assertEqual(r.status_code, 400)
        self.assertIn("parent SKU", r.json()["error"])
        self.assert_nothing_written()

    def test_an_unknown_existing_parent_is_refused(self):
        r = self.generate(parent={"parent_id": "NOPE"})
        self.assertEqual(r.status_code, 404)
        self.assert_nothing_written()


class LinkToExistingParentTests(ListingParentTestCase):
    def setUp(self):
        super().setUp()
        self.parent = ParentItemPrice.objects.create(
            business=self.business, item_id="BRASS-DIYA", item_price=Decimal("40"),
            tax_percent=5, packaging_cost=Decimal("2"), final_price=Decimal("44"),
        )

    def test_generated_skus_are_linked_and_priced_like_the_parent(self):
        r = self.generate(parent={"parent_id": "brass-diya"})   # case-insensitive
        self.assertEqual(r.status_code, 200, getattr(r, "data", r.content[:300]))
        self.assertEqual(r["X-Parent-Id"], "BRASS-DIYA")
        self.assertEqual(r["X-Parent-Created"], "0")
        rows = FinalPrice.objects.filter(business=self.business).order_by("sku_id")
        self.assertEqual([x.sku_id for x in rows], ["DIYA-001", "DIYA-002"])
        for row in rows:
            self.assertEqual(row.parent, self.parent)
            self.assertEqual(row.final_price, Decimal("44.00"))   # no longer price-less

    def test_the_review_task_and_snapshot_remember_the_parent(self):
        self.generate(parent={"parent_id": "BRASS-DIYA"})
        self.assertEqual(WorkerTask.objects.get().parent_sku, self.parent)
        self.assertEqual(BulkListingBatch.objects.get().payload_snapshot["parent"], "BRASS-DIYA")

    def test_choosing_an_existing_parent_needs_no_pricing(self):
        r = self.generate(parent={"parent_id": "BRASS-DIYA", "create": False})
        self.assertEqual(r.status_code, 200)


class CreateNewParentTests(ListingParentTestCase):
    def test_creates_the_parent_with_its_pricing_and_links_everything(self):
        r = self.generate(parent={"parent_id": "NEW-DIYA", "create": True, **PRICING})
        self.assertEqual(r.status_code, 200, getattr(r, "data", r.content[:300]))
        self.assertEqual(r["X-Parent-Created"], "1")
        parent = ParentItemPrice.objects.get(business=self.business, item_id="NEW-DIYA")
        self.assertEqual(parent.final_price, Decimal("44.00"))
        self.assertEqual(set(parent.sku_prices.values_list("sku_id", flat=True)), {"DIYA-001", "DIYA-002"})

    def test_missing_pricing_is_refused_before_anything_is_built(self):
        r = self.generate(parent={"parent_id": "NEW-DIYA", "create": True, "item_price": "40"})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(set(r.json()["fields"]), {"tax_percent", "packaging_cost"})
        self.assertFalse(ParentItemPrice.objects.filter(item_id="NEW-DIYA").exists())
        self.assert_nothing_written()

    def test_a_name_that_already_exists_is_refused(self):
        ParentItemPrice.objects.create(business=self.business, item_id="NEW-DIYA", item_price="9")
        r = self.generate(parent={"parent_id": "new-diya", "create": True, **PRICING})
        self.assertEqual(r.status_code, 409)
        self.assertIn("Choose existing", r.json()["error"])
        self.assertEqual(str(ParentItemPrice.objects.get(item_id="NEW-DIYA").item_price), "9.00")
        self.assert_nothing_written()

    def test_the_parent_cannot_share_a_name_with_one_of_its_own_skus(self):
        r = self.generate(parent={"parent_id": "DIYA-001", "create": True, **PRICING})
        self.assertEqual(r.status_code, 400)
        self.assert_nothing_written()

    def test_the_parent_cannot_reuse_an_existing_catalogue_sku(self):
        FinalPrice.objects.create(business=self.business, sku_id="OLD-SKU")
        r = self.generate(parent={"parent_id": "old-sku", "create": True, **PRICING})
        self.assertEqual(r.status_code, 409)
        self.assertFalse(ParentItemPrice.objects.filter(item_id__iexact="old-sku").exists())

    def test_a_generation_that_fails_later_leaves_no_empty_parent_behind(self):
        """Parent is only created inside the batch's transaction."""
        r = self.generate(parent={"parent_id": "NEW-DIYA", "create": True, **PRICING}, shared={})
        self.assertNotEqual(r.status_code, 200)
        self.assertFalse(ParentItemPrice.objects.filter(item_id="NEW-DIYA").exists())
        self.assert_nothing_written()
