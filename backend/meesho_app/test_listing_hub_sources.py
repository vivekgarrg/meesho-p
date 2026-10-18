"""Listing Hub: every saved listing of a product, links, categories, pausing,
detail checks and photo checks. Storage and the network are never touched."""

from decimal import Decimal as D
from unittest import mock

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from . import listing_hub_sources as src
from .models import (
    BulkListingBatch, FinalPrice, ListingHubLink, ListingHubPause, ListingImage, ListingTemplate, ParentItemPrice,
    TaskListing, WorkerTask,
)

IMG = "https://upload.meeshosupplyassets.com/cataloging/1/1.jpg"
REAL_FOLDER_PHOTOS = src.folder_photos   # the tests patch the module attribute
MEESHO_CAT = "Puja Articles Template (Home & Kitchen/Home Decor/Puja Accessories/Puja Articles)"


class Base(TestCase):
    def setUp(self):
        patcher = mock.patch("meesho_app.listing_hub_sources.folder_photos", return_value=([], None))
        self.folder = patcher.start()
        self.addCleanup(patcher.stop)
        self.business = Business.objects.create(name="B")
        self.admin = User.objects.create_user(username="admin", password="pw", role=User.ROLE_SUPER_ADMIN)
        self.lister = User.objects.create_user(username="lister", password="pw", role=User.ROLE_BUSINESS_USER)
        for u in (self.admin, self.lister):
            Membership.objects.create(user=u, business=self.business)
        self.client = self.as_user(self.admin)
        self.base = f"/api/business/{self.business.id}/listing-hub"
        self.lota = ParentItemPrice.objects.create(business=self.business, item_id="Choti Pragi", item_price=D("100"),
                                                   tax_percent=0, packaging_cost=D("0"), final_price=D("100"))
        self.bowl = ParentItemPrice.objects.create(business=self.business, item_id="Floral Brass Bowl", item_price=D("140"),
                                                   tax_percent=0, packaging_cost=D("0"), final_price=D("140"))
        FinalPrice.objects.create(business=self.business, sku_id="LOTA-1", parent=self.lota)

    def as_user(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c

    def sheet(self, platform="meesho", skus=("X-1",), category=MEESHO_CAT, shared=None, rows=None, parent=None):
        snap = {"shared": shared or {}, "rows": rows or [{"sku_id": s, "product_name": "Lota", "images": [IMG]} for s in skus]}
        if parent:
            snap["parent"] = parent
        return BulkListingBatch.objects.create(business=self.business, platform=platform, category_label=category,
                                               filename=f"{platform}.xlsx", file_data=b"x", source_kind="FILE",
                                               first_sku_id=skus[0], sku_ids=list(skus), payload_snapshot=snap)

    def product(self, item="Choti Pragi", client=None):
        return (client or self.client).get(self.base + "/product/", {"id": item})


class MatchingTests(Base):
    def test_sheet_found_by_sku_parent_and_admin_link(self):
        by_sku = self.sheet(skus=("LOTA-1",))
        made_for = self.sheet(skus=("NEW-1",), parent="Choti Pragi")
        orphan = self.sheet(platform="flipkart", skus=("big-brass-bowl-floral-001",), category="bowl",
                            rows=[{"sku_id": "big-brass-bowl-floral-001", "images": [IMG], "attributes": {"model_name": "Floral bowl"}}])
        got = {l["id"]: l["matched_by"] for l in self.product().data["listings"]}
        self.assertEqual(got, {by_sku.id: "SKU ids", made_for.id: "made for it"})

        r = self.client.post(self.base + "/link/", {"kind": "sheet", "object_id": orphan.id, "id": "Choti Pragi"}, format="json")
        self.assertEqual(r.data["linked"], "Choti Pragi")
        got = {l["id"]: l["matched_by"] for l in self.product().data["listings"]}
        self.assertEqual(got[orphan.id], "linked")

    def test_a_link_moves_a_sheet_off_its_automatic_product(self):
        s = self.sheet(skus=("LOTA-1",))
        self.client.post(self.base + "/link/", {"kind": "sheet", "object_id": s.id, "id": "Floral Brass Bowl"}, format="json")
        self.assertEqual(self.product().data["listings"], [])
        self.assertEqual([l["id"] for l in self.product("Floral Brass Bowl").data["listings"]], [s.id])
        self.client.post(self.base + "/link/", {"kind": "sheet", "object_id": s.id, "id": None}, format="json")
        self.assertEqual([l["id"] for l in self.product().data["listings"]], [s.id])     # back to the SKU match

    def test_extension_templates_matched_by_name_or_sku_and_their_photos(self):
        named = ListingTemplate.objects.create(business=self.business, name="Choti Pragi gold",
                                               fields={"title": "Brass lota", "img": IMG + "?t"})
        by_sku = ListingTemplate.objects.create(business=self.business, name="Lota v2", fields={"sku": "LOTA-1"})
        ListingTemplate.objects.create(business=self.business, name="Something else", fields={"a": "b"})
        r = self.product().data
        self.assertEqual({l["id"] for l in r["listings"] if l["kind"] == "template"}, {named.id, by_sku.id})
        self.assertIn(IMG + "?t", [p["url"] for p in r["photos"]])

    def test_unlinked_listings_come_with_suggestions(self):
        orphan = self.sheet(platform="flipkart", skus=("big-brass-bowl-floral-001",), category="bowl",
                            rows=[{"sku_id": "big-brass-bowl-floral-001", "images": [], "attributes": {"model_name": "Floral Design Brass Bowl"}}])
        self.sheet(skus=("LOTA-1",))
        rows = self.client.get(self.base + "/unlinked/").data["results"]
        self.assertEqual([(r["kind"], r["object_id"]) for r in rows], [("sheet", orphan.id)])
        self.assertEqual(rows[0]["suggestions"][0]["item_id"], "Floral Brass Bowl")


class CategoryTests(Base):
    def test_short_names(self):
        self.assertEqual(src.short_category(MEESHO_CAT), "Puja Articles")
        self.assertEqual(src.short_category("Bowl Template"), "Bowl")
        self.assertEqual(src.short_category(""), "Uncategorised")

    def test_search_groups_and_filters_by_category(self):
        self.sheet(skus=("LOTA-1",))
        d = self.client.get(self.base + "/search/").data
        self.assertEqual(d["categories"], [{"label": "Puja Articles", "count": 1}, {"label": "No listing sheet yet", "count": 1}])
        cards = {c["item_id"]: c["categories"] for c in d["results"]}
        self.assertEqual(cards["Choti Pragi"], ["Puja Articles"])
        only = self.client.get(self.base + "/search/", {"category": "Puja Articles"}).data["results"]
        self.assertEqual([c["item_id"] for c in only], ["Choti Pragi"])
        none = self.client.get(self.base + "/search/", {"category": "No listing sheet yet"}).data["results"]
        self.assertEqual([c["item_id"] for c in none], ["Floral Brass Bowl"])


class PauseTests(Base):
    def test_paused_product_is_hidden_from_listers_but_not_admins(self):
        r = self.client.post(self.base + "/pause/", {"id": "Choti Pragi", "paused": True, "note": "Out of stock"}, format="json")
        self.assertTrue(r.data["paused"])
        lister = self.as_user(self.lister)
        self.assertEqual([c["item_id"] for c in lister.get(self.base + "/search/").data["results"]], ["Floral Brass Bowl"])
        self.assertEqual(self.product(client=lister).status_code, 404)
        self.assertEqual(lister.get(self.base + "/photos.zip", {"id": "Choti Pragi"}).status_code, 404)
        admin_view = self.client.get(self.base + "/search/").data
        self.assertEqual({c["item_id"]: c["paused"] for c in admin_view["results"]}, {"Choti Pragi": True, "Floral Brass Bowl": False})
        self.assertEqual([c["item_id"] for c in self.client.get(self.base + "/search/", {"status": "paused"}).data["results"]],
                         ["Choti Pragi"])
        self.assertEqual(self.product().data["paused"]["note"], "Out of stock")

        self.client.post(self.base + "/pause/", {"id": "Choti Pragi", "paused": False}, format="json")
        self.assertEqual(self.product(client=lister).status_code, 200)
        self.assertFalse(ListingHubPause.objects.exists())

    def test_only_admins_pause_or_link(self):
        lister = self.as_user(self.lister)
        s = self.sheet()
        self.assertEqual(lister.post(self.base + "/pause/", {"id": "Choti Pragi", "paused": True}, format="json").status_code, 403)
        self.assertEqual(lister.post(self.base + "/link/", {"kind": "sheet", "object_id": s.id, "id": "Choti Pragi"},
                                     format="json").status_code, 403)
        self.assertEqual(lister.get(self.base + "/unlinked/").status_code, 403)
        self.assertFalse(ListingHubLink.objects.exists())


class DetailCheckTests(Base):
    def issues(self, platform, shared, rows, breakeven=None):
        return [i["text"] for i in src.sheet_issues(platform, shared, rows, {"lota-1"}, breakeven)]

    def test_meesho_sheet_problems(self):
        rows = [{"sku_id": "LOTA-1", "fields": {"product_name": ""}, "images": []}]
        got = self.issues("meesho", {"mrp": "100", "meesho_price": "150", "hsn_id": "74AB", "gst": "7",
                                     "wrong_defective_returns_price": "120"}, rows, breakeven=200)
        joined = " | ".join(got)
        for expected in ("Missing: Weight", "MRP ₹100 is lower than the selling price ₹150", "below break-even (₹200)",
                         "HSN code “74AB”", "GST 7% isn't", "no product name", "no photo", "below the Meesho price"):
            self.assertIn(expected, joined)

    def test_clean_sheet_has_no_problems(self):
        rows = [{"sku_id": "LOTA-1", "fields": {"product_name": "Brass lota"}, "images": [IMG]}]
        self.assertEqual(self.issues("meesho", {"mrp": "999", "meesho_price": "299", "hsn_id": "741810", "gst": "5",
                                                "weight": "0.2", "wrong_defective_returns_price": "349"}, rows, 189), [])

    def test_flipkart_sheet_and_foreign_skus(self):
        rows = [{"sku_id": "OTHER-9", "fields": {}, "images": [IMG]}]
        got = " | ".join(self.issues("flipkart", {"mrp_inr": "999", "your_selling_price_inr": "425", "hsn": "741810",
                                                  "tax_code": "GST_5", "weight_kg": "0.1", "description": "x",
                                                  "model_name": "Bowl"}, rows))
        self.assertIn("aren't under this product", got)
        self.assertNotIn("Missing", got)

    def test_issues_and_task_listings_reach_the_page(self):
        self.sheet(skus=("LOTA-1",), shared={"mrp": "50", "meesho_price": "80"})
        task = WorkerTask.objects.create(business=self.business, task_type=WorkerTask.TYPE_LISTING,
                                         platform="meesho", created_by=self.admin)
        TaskListing.objects.create(business=self.business, task=task, created_by=self.admin, sku_id="LOTA-1",
                                   listing_price=D("299"), mrp=D("999"), hsn_code="741810")
        r = self.product().data
        self.assertGreaterEqual(r["issue_count"], 1)
        self.assertEqual(r["skus"][0]["task"]["listing_price"], 299.0)
        self.assertEqual(r["skus"][0]["task"]["hsn_code"], "741810")


class PhotoTests(Base):
    def test_storage_folder_photos_are_included_once(self):
        ListingImage.objects.create(business=self.business, image_no=1, parent=self.lota, folder="Choti Pragi",
                                    key="listing-images/1/Choti Pragi/Choti Pragi-1.jpg", content_type="image/jpeg",
                                    status=ListingImage.STATUS_UPLOADED, sha256="a")
        self.folder.return_value = ([("listing-images/1/Choti Pragi/Choti Pragi-1.jpg", "https://img.example/Choti%20Pragi-1.jpg"),
                                     ("listing-images/1/Choti Pragi/old.jpg", "https://img.example/old.jpg")], None)
        with override_settings(S3_PUBLIC_BASE_URL="https://img.example"):
            photos = self.product().data["photos"]
        self.assertEqual([p["source"] for p in photos], ["Uploaded", "Storage folder"])

    def folder_listing(self, folders):
        """A fake bucket: {folder: [file names]} under the business."""
        def lister(prefix, delimiter=None):
            base = f"listing-images/{self.business.pk}/"
            if delimiter:
                yield {"CommonPrefixes": [{"Prefix": f"{base}{f}/"} for f in folders]}
            else:
                folder = prefix[len(base):].rstrip("/")
                yield {"Contents": [{"Key": f"{prefix}{n}"} for n in folders.get(folder, [])]}
        return lister

    @override_settings(S3_KEY_PREFIX="listing-images", S3_PUBLIC_BASE_URL="https://img.example")
    def test_folder_named_after_the_product_is_read_case_insensitively(self):
        lister = self.folder_listing({"choti pragi": ["a.jpg", "notes.txt", "b.PNG"], "Other": ["x.jpg"]})
        with mock.patch.object(src, "_list", side_effect=lister), \
                mock.patch("meesho_app.object_storage.is_ready", return_value=True):
            photos, note = REAL_FOLDER_PHOTOS(self.business, self.lota)
        self.assertIsNone(note)
        self.assertEqual([k.rsplit("/", 1)[-1] for k, _u in photos], ["a.jpg", "b.PNG"])

    @override_settings(S3_KEY_PREFIX="listing-images", S3_PUBLIC_BASE_URL="https://img.example")
    def test_another_products_folder_is_never_read(self):
        # "Choti Pragi" is already the bowl's folder on record, so it isn't the lota's.
        ListingImage.objects.create(business=self.business, image_no=1, parent=self.bowl, folder="Choti Pragi",
                                    key="k1", content_type="image/jpeg", status=ListingImage.STATUS_UPLOADED, sha256="b")
        lister = self.folder_listing({"Choti Pragi": ["a.jpg"]})
        with mock.patch.object(src, "_list", side_effect=lister) as lst, \
                mock.patch("meesho_app.object_storage.is_ready", return_value=True):
            photos, _note = REAL_FOLDER_PHOTOS(self.business, self.lota)
        self.assertEqual(photos, [])
        lst.assert_not_called()

    def test_photo_link_check(self):
        self.sheet(skus=("LOTA-1",), rows=[{"sku_id": "LOTA-1", "product_name": "L", "images": [IMG, IMG + "?gone"]}])

        def head(url, **kw):
            r = mock.Mock(status_code=404 if "gone" in url else 200, headers={"content-type": "image/jpeg"})
            return r
        with mock.patch("meesho_app.listing_hub_sources.requests.head", side_effect=head):
            d = self.client.get(self.base + "/photos/check/", {"id": "Choti Pragi"}).data
        self.assertEqual(d["broken"], 1)
        self.assertEqual([r["ok"] for r in d["results"]], [True, False])
        self.assertIn("HTTP 404", d["results"][1]["reason"])
