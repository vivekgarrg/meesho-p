"""Meesho bulk listing: a price per listing (random within a range, set on each row) and a description per listing."""

import io
import json
from decimal import Decimal

from openpyxl import load_workbook

from . import bulk_listing as bl
from .models import ParentItemPrice
from .test_bulk_listing_parent import ListingParentTestCase

SKUS = ("DIYA-001", "DIYA-002", "DIYA-003")


class PerRowTests(ListingParentTestCase):
    def setUp(self):
        super().setUp()
        ParentItemPrice.objects.create(business=self.business, item_id="BRASS-DIYA", item_price=Decimal("40"),
                                       tax_percent=5, packaging_cost=Decimal("2"), final_price=Decimal("44"))
        f = {x["key"]: x for x in self.spec["fields"]}
        self.price = f["meesho_price"]
        self.wdrp = bl.find_field(self.spec, role="wrong_defective_price")
        self.desc = next(x for x in self.spec["fields"] if "description" in x["label"].lower() and not x["role"])

    def post(self, rows, shared):
        payload = {"mode": "new", "shared": shared, "parent": {"parent_id": "BRASS-DIYA"},
                   "image_urls": [f"https://example.com/{s}.jpg" for s in SKUS],
                   "rows": [{"product_name": f"Brass Diya {s}", "sku_id": s, "style_id": s,
                             "images": [f"https://example.com/{s}.jpg"], "overrides": o} for s, o in zip(SKUS, rows)]}
        return self.client.post(f"{self.base}/bulk-listing/generate/", {
            "platform": "meesho", "built_in": "puja_articles", "payload": json.dumps(payload)}, format="multipart")

    def cells(self, r, field):
        ws = load_workbook(io.BytesIO(r.content))[self.spec["sheet_name"]]
        start = self.spec["data_start_row"]
        return [ws[f'{field["column"]}{start + i}'].value for i in range(len(SKUS))]

    def test_each_listing_has_its_own_price_and_wrong_defective_price_and_description(self):
        shared = {k: v for k, v in self.shared.items() if k not in (self.wdrp["key"], self.desc["key"])}
        rows = [{self.price["key"]: p, self.desc["key"]: f"Brass diya no. {i}, handmade, 4 inch."}
                for i, p in enumerate(("219", "234", "247"))]
        r = self.post(rows, shared)
        self.assertEqual(r.status_code, 200, getattr(r, "data", r.content[:300]))
        self.assertEqual(self.cells(r, self.price), [219, 234, 247])
        self.assertEqual(self.cells(r, self.wdrp), [199, 214, 227])          # each row's own price − 20
        self.assertEqual(self.cells(r, self.desc), [f"Brass diya no. {i}, handmade, 4 inch." for i in range(3)])

    def test_a_wrong_defective_price_the_seller_gave_is_kept(self):
        rows = [{self.price["key"]: p, self.desc["key"]: "d"} for p in ("219", "234", "247")]
        r = self.post(rows, self.shared)                                       # shared Wrong/Defective 279
        self.assertEqual(self.cells(r, self.wdrp), [279, 279, 279])

    def test_a_required_description_missing_on_one_row_is_refused(self):
        if not self.desc["required"]:
            self.skipTest("this template's description isn't required")
        shared = {k: v for k, v in self.shared.items() if k != self.desc["key"]}
        rows = [{self.desc["key"]: "one"}, {self.desc["key"]: "two"}, {}]
        r = self.post(rows, shared)
        self.assertEqual(r.status_code, 400)
        self.assertIn(self.desc["label"], r.data["error"])
