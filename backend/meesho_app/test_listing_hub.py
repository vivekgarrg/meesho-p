"""Listing Hub: search, the product page, the recommended price, saved prices
and photo downloads."""

from datetime import date, datetime, timedelta
from decimal import Decimal as D
from unittest import mock

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from . import listing_hub
from .models import (
    BulkListingBatch, FinalPrice, ListingImage, ListingPrice, Order, OrderPayment, ParentItemPrice, Product,
)

IMG = "https://upload.meeshosupplyassets.com/cataloging/1/1.jpg"


class HubTestCase(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="o", password="pw", role=User.ROLE_SUPER_ADMIN)
        self.business = Business.objects.create(name="B")
        Membership.objects.create(user=self.user, business=self.business)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.base = f"/api/business/{self.business.id}/listing-hub"
        # Unit cost 100 + 0% + 10 packaging + 5 buffer = 115.
        self.lota = ParentItemPrice.objects.create(business=self.business, item_id="Choti Pragi", item_price=D("100"),
                                                   tax_percent=0, packaging_cost=D("10"), final_price=D("110"),
                                                   buffer_amount=D("5"), image_url=IMG)
        for s in ("LOTA-1", "LOTA-2"):
            FinalPrice.objects.create(business=self.business, sku_id=s, parent=self.lota)
        self.n = 0

    def sell(self, sku, status, price, settle, k=1):
        for _ in range(k):
            self.n += 1
            sub = f"S{self.n}"
            day = date(2026, 9, 1) + timedelta(days=self.n % 30)
            Order.objects.create(business=self.business, sub_order_no=sub, sku=sku, order_date=day)
            OrderPayment.objects.create(business=self.business, sub_order_no=sub, supplier_sku=sku, live_order_status=status,
                                        quantity=1, listing_price_incl_taxes=D(str(price)),
                                        final_settlement_amount=D(str(settle)), payment_date=day,
                                        order_date=timezone.make_aware(datetime(2026, 9, 1)))

    def history(self):
        """60 delivered on a perfect payout line (payout = price − 10), 20
        returns at −160, 20 RTOs at 0 — all for this product."""
        for i in range(60):
            p = 200 + i * 5
            self.sell("LOTA-1", "Delivered", p, p - 10)
        self.sell("LOTA-1", "Return", 299, -160, 20)
        self.sell("LOTA-2", "RTO", 299, 0, 20)


class SearchTests(HubTestCase):
    def test_finds_by_parent_and_by_any_sku_id(self):
        self.assertEqual([r["item_id"] for r in self.client.get(self.base + "/search/", {"q": "pragi"}).data["results"]],
                         ["Choti Pragi"])
        r = self.client.get(self.base + "/search/", {"q": "lota-2"}).data["results"]
        self.assertEqual((r[0]["item_id"], r[0]["matched_sku"]), ("Choti Pragi", "LOTA-2"))

    def test_finds_by_product_name_and_lists_skus_with_no_parent(self):
        Product.objects.create(business=self.business, name="Small brass kalash", parent_sku=self.lota)
        FinalPrice.objects.create(business=self.business, sku_id="KALASH-LOOSE")
        r = self.client.get(self.base + "/search/", {"q": "kalash"}).data
        self.assertEqual([x["item_id"] for x in r["results"]], ["Choti Pragi"])
        self.assertEqual(r["skus_without_parent"], ["KALASH-LOOSE"])

    def test_cards_say_where_it_is_listed(self):
        BulkListingBatch.objects.create(business=self.business, platform="flipkart", filename="f.xlsx", file_data=b"x",
                                        source_kind="FILE", first_sku_id="LOTA-1", sku_ids=["LOTA-1"])
        card = self.client.get(self.base + "/search/").data["results"][0]
        self.assertEqual(card["listed_on"], ["flipkart"])
        self.assertEqual(card["sku_count"], 2)
        self.assertEqual(card["unit_cost"], 115.0)


class RecommendedPriceTests(HubTestCase):
    def test_price_hits_the_target_profit(self):
        self.history()
        r = self.client.get(self.base + "/product/", {"id": "choti pragi", "target": "30"}).data
        m = r["pricing"]["platforms"]["meesho"]
        w = m["working"]
        self.assertEqual((w["delivered_pct"], w["return_pct"], w["rto_pct"]), (60.0, 20.0, 20.0))
        self.assertEqual(w["rates_from"], "this product")
        self.assertAlmostEqual(w["payout_per_rupee"], 1.0, places=3)
        self.assertAlmostEqual(w["payout_offset"], -10.0, places=1)
        # Default cost settings charge the box on delivered orders only, so:
        # 0.6·(P − 10 − 115) + 0.2·(−160) + 0.2·0 = 30  →  P = 228.33
        self.assertAlmostEqual(m["exact"], 228.33, places=1)
        self.assertEqual(m["recommended"], 229)              # next price ending in 9
        self.assertGreaterEqual(m["profit_at_recommended"], 30)
        self.assertIsNotNone(m["current_selling_price"])     # median of recent delivered orders

    def test_default_target_is_a_share_of_cost(self):
        self.history()
        r = self.client.get(self.base + "/product/", {"id": "Choti Pragi"}).data["pricing"]
        self.assertEqual(r["default_target"], 23.0)          # 20% of ₹115

    def test_few_own_orders_falls_back_to_business_rates(self):
        other = ParentItemPrice.objects.create(business=self.business, item_id="NEW", item_price=D("50"),
                                               tax_percent=0, packaging_cost=D("0"), final_price=D("50"))
        self.history()
        w = self.client.get(self.base + "/product/", {"id": "NEW"}).data["pricing"]["platforms"]["meesho"]["working"]
        self.assertEqual(w["rates_from"], "your whole business")
        del other

    def test_flipkart_without_its_own_payments_says_so(self):
        self.history()
        f = self.client.get(self.base + "/product/", {"id": "Choti Pragi"}).data["pricing"]["platforms"]["flipkart"]
        self.assertIn("No Flipkart payments", f["note"])

    def test_unpriced_product_gets_no_recommendation(self):
        ParentItemPrice.objects.create(business=self.business, item_id="FREE", item_price=D("0"), final_price=D("0"))
        r = self.client.get(self.base + "/product/", {"id": "FREE"}).data["pricing"]
        self.assertFalse(r["priced"])
        self.assertNotIn("recommended", r["platforms"]["meesho"])


class SavedPriceTests(HubTestCase):
    def test_save_shows_expected_profit_and_can_be_cleared(self):
        self.history()
        r = self.client.post(self.base + "/price/", {"id": "Choti Pragi", "platform": "meesho", "price": "259", "mrp": "999"},
                             format="json")
        self.assertEqual(r.status_code, 200, r.data)
        m = self.client.get(self.base + "/product/", {"id": "Choti Pragi"}).data["pricing"]["platforms"]["meesho"]
        self.assertEqual(m["saved"]["price"], 259.0)
        self.assertAlmostEqual(m["saved"]["expected_profit"], 0.6 * (259 - 125) - 32, places=1)
        self.client.delete(self.base + "/price/", {"id": "Choti Pragi", "platform": "meesho"}, format="json")
        self.assertFalse(ListingPrice.objects.exists())

    def test_rejects_bad_prices(self):
        for body in ({"price": "0"}, {"price": "abc"}, {"price": "300", "mrp": "200"}, {"platform": "amazon", "price": "5"}):
            payload = {"id": "Choti Pragi", "platform": "meesho", **body}
            self.assertEqual(self.client.post(self.base + "/price/", payload, format="json").status_code, 400, body)


class ProductPageTests(HubTestCase):
    def setUp(self):
        super().setUp()
        BulkListingBatch.objects.create(
            business=self.business, platform="meesho", filename="m.xlsx", file_data=b"x", source_kind="BUILT_IN",
            first_sku_id="LOTA-1", sku_ids=["LOTA-1", "OTHER-9"], category_label="Puja",
            payload_snapshot={"parent": "Choti Pragi", "shared": {"mrp": "999", "hsn_id": "741810", "empty": ""},
                              "rows": [{"sku_id": "LOTA-1", "product_name": "Brass Lota", "images": [IMG, IMG + "?2"]},
                                       {"sku_id": "OTHER-9", "product_name": "Not ours", "images": []}]})
        BulkListingBatch.objects.create(
            business=self.business, platform="flipkart", filename="f.xlsx", file_data=b"x", source_kind="FILE",
            first_sku_id="UNRELATED", sku_ids=["UNRELATED"], payload_snapshot={"rows": []})

    def test_page_gathers_skus_details_and_photos(self):
        self.sell("LOTA-1", "Delivered", 299, 289, 3)
        r = self.client.get(self.base + "/product/", {"id": "Choti Pragi"}).data
        self.assertEqual([s["sku_id"] for s in r["skus"]], ["LOTA-1", "LOTA-2"])
        self.assertEqual(r["skus"][0]["orders"], 3)
        self.assertEqual(list(r["listings"]), ["meesho"])                       # the unrelated Flipkart sheet isn't ours
        labels = {f["label"]: f["value"] for f in r["listings"]["meesho"]["fields"]}
        self.assertEqual(labels, {"MRP": "999", "HSN code": "741810"})          # blanks dropped, labels readable
        self.assertEqual([s["sku_id"] for s in r["listings"]["meesho"]["skus"]], ["LOTA-1"])
        self.assertEqual([p["url"] for p in r["photos"]], [IMG, IMG + "?2"])    # main image not repeated
        self.assertEqual(r["photos"][0]["source"], "main")

    def test_unknown_product(self):
        self.assertEqual(self.client.get(self.base + "/product/", {"id": "NOPE"}).status_code, 404)


class DownloadTests(HubTestCase):
    def setUp(self):
        super().setUp()
        BulkListingBatch.objects.create(
            business=self.business, platform="meesho", filename="m.xlsx", file_data=b"x", source_kind="BUILT_IN",
            first_sku_id="LOTA-1", sku_ids=["LOTA-1"],
            payload_snapshot={"rows": [{"sku_id": "LOTA-1", "images": ["http://169.254.169.254/latest/meta-data"]}]})

    def fake_get(self, url, **kw):
        r = mock.Mock(status_code=200, headers={"content-type": "image/jpeg"})
        r.raw.read.return_value = b"JPEGDATA"
        return r

    def test_zip_has_the_allowed_photos_only(self):
        with mock.patch("meesho_app.listing_hub.requests.get", side_effect=self.fake_get) as get:
            r = self.client.get(self.base + "/photos.zip", {"id": "Choti Pragi"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r["X-Photos-Included"], "1")
        self.assertEqual(r["X-Photos-Missing"], "1")
        fetched = [c.args[0] for c in get.call_args_list]
        self.assertEqual(fetched, [IMG])                                     # never the internal address
        import io, zipfile
        self.assertEqual(zipfile.ZipFile(io.BytesIO(r.content)).namelist(), ["Choti-Pragi-01.jpg"])

    def test_single_photo_by_number(self):
        with mock.patch("meesho_app.listing_hub.requests.get", side_effect=self.fake_get):
            r = self.client.get(self.base + "/photo/", {"id": "Choti Pragi", "n": "1"})
            bad = self.client.get(self.base + "/photo/", {"id": "Choti Pragi", "n": "2"})
        self.assertEqual(r.status_code, 200)
        self.assertIn("Choti-Pragi-1.jpg", r["Content-Disposition"])
        self.assertEqual(bad.status_code, 502)

    @override_settings(S3_PUBLIC_BASE_URL="https://images.example.in")
    def test_own_bucket_host_is_allowed(self):
        self.assertTrue(listing_hub._allowed_host("https://images.example.in/a/b.jpg"))
        self.assertFalse(listing_hub._allowed_host("https://evil.example.in/a.jpg"))
        self.assertTrue(listing_hub._allowed_host("https://rukminim1.flixcart.com/x.jpg"))
        self.assertFalse(listing_hub._allowed_host("https://flixcart.com.evil.io/x.jpg"))


class AccessTests(HubTestCase):
    def test_nav_owns_the_endpoints(self):
        from accounts.nav import API_OWNERSHIP, NAV_CATALOG
        self.assertEqual(API_OWNERSHIP["listing-hub/"], ["/listing-hub"])
        self.assertIn("/listing-hub", [n["path"] for n in NAV_CATALOG])

    def test_other_business_refused(self):
        stranger = User.objects.create_user(username="s", password="pw")
        Membership.objects.create(user=stranger, business=Business.objects.create(name="X"))
        c = APIClient()
        c.force_authenticate(stranger)
        self.assertIn(c.get(self.base + "/search/").status_code, (403, 404))
