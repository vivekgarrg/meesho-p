"""Quadrant Cropper -> R2 -> parent SKU.

object_storage is mocked throughout: these pin numbering, dedupe, parent
linking and the confirm-before-link rule, none of which need a real bucket.
"""

import threading
from unittest import mock

from django.test import TestCase, TransactionTestCase
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from .models import ListingImage, ListingImageCounter, ParentItemPrice

SHA_A = "a" * 64
SHA_B = "b" * 64
SHA_C = "c" * 64


def file(sha, ctype="image/jpeg", size=1000):
    return {"sha256": sha, "content_type": ctype, "bytes": size}


class StorageMock:
    """Stands in for object_storage. `present` holds keys "in the bucket"."""

    def __init__(self):
        self.present = {}

    def start(self, test):
        base = "meesho_app.listing_images_views.object_storage"
        for name, fn in {
            "is_ready": lambda: True,
            "presign_put": lambda key, ct: f"https://signed.example/{key}?ct={ct}",
            "object_size": lambda key: self.present.get(key),
            "public_url": lambda key: f"https://images.rudam.in/{key}",
        }.items():
            p = mock.patch(f"{base}.{name}", side_effect=fn)
            p.start()
            test.addCleanup(p.stop)


class ListingImageTestCase(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="o", password="pw", role=User.ROLE_SUPER_ADMIN)
        self.business = Business.objects.create(name="B")
        Membership.objects.create(user=self.user, business=self.business)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.base = f"/api/business/{self.business.id}"
        self.storage = StorageMock()
        self.storage.start(self)

    PRICING = {"item_price": "40", "tax_percent": 5, "packaging_cost": "2"}

    def presign(self, parent_id="DIYA", create=False, files=None, product="Brass Diya", pricing=None):
        body = {
            "parent_id": parent_id, "create_parent": create, "product_name": product,
            "files": files if files is not None else [file(SHA_A)],
        }
        if create:
            body.update(self.PRICING if pricing is None else pricing)
        return self.client.post(f"{self.base}/listing-images/presign/", body, format="json")

    def upload(self, results):
        """Simulate the browser's PUTs landing in the bucket."""
        for r in results:
            if r.get("needs_upload"):
                img = ListingImage.objects.get(pk=r["id"])
                self.storage.present[img.key] = img.bytes

    def confirm(self, ids):
        return self.client.post(f"{self.base}/listing-images/confirm/", {"ids": ids}, format="json")


class ConfigTests(ListingImageTestCase):
    def test_reports_enabled_when_storage_is_ready(self):
        self.assertTrue(self.client.get(f"{self.base}/listing-images/config/").data["enabled"])

    def test_unconfigured_storage_disables_the_feature_cleanly(self):
        with mock.patch("meesho_app.listing_images_views.object_storage.is_ready", return_value=False):
            self.assertFalse(self.client.get(f"{self.base}/listing-images/config/").data["enabled"])
            r = self.presign(create=True)
        self.assertEqual(r.status_code, 503)
        self.assertEqual(ListingImage.objects.count(), 0)
        self.assertFalse(ParentItemPrice.objects.filter(item_id="DIYA").exists())


class ParentLinkingTests(ListingImageTestCase):
    def test_creating_a_parent_from_the_cropper(self):
        r = self.presign("NEW-PARENT", create=True)
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["parent"], {"item_id": "NEW-PARENT", "created": True})
        parent = ParentItemPrice.objects.get(business=self.business, item_id="NEW-PARENT")
        self.assertEqual(str(parent.item_price), "40.00")
        self.assertEqual(parent.tax_percent, 5)
        self.assertEqual(str(parent.final_price), "44.00")   # 40 + 5% + 2, computed server-side
        self.assertEqual(ListingImage.objects.get().parent, parent)

    def test_choosing_an_existing_parent(self):
        ParentItemPrice.objects.create(business=self.business, item_id="DIYA")
        r = self.presign("diya")   # case-insensitive, like every SKU comparison here
        self.assertEqual(r.data["parent"], {"item_id": "DIYA", "created": False})

    def test_create_for_a_name_that_already_exists_is_refused(self):
        """The typed prices must neither be silently dropped nor overwrite
        the existing parent's — the seller is told to pick it instead."""
        ParentItemPrice.objects.create(business=self.business, item_id="DIYA", item_price="99")
        r = self.presign("Diya", create=True)
        self.assertEqual(r.status_code, 409)
        self.assertIn("Choose existing", r.data["error"])
        self.assertEqual(str(ParentItemPrice.objects.get(item_id="DIYA").item_price), "99.00")
        self.assertEqual(ListingImage.objects.count(), 0)

    def test_an_unknown_parent_without_create_is_refused_not_invented(self):
        r = self.presign("TYPO-PARENT", create=False)
        self.assertEqual(r.status_code, 404)
        self.assertFalse(ParentItemPrice.objects.filter(item_id="TYPO-PARENT").exists())
        self.assertEqual(ListingImage.objects.count(), 0)

    def test_a_blank_parent_is_refused(self):
        self.assertEqual(self.presign("   ", create=True).status_code, 400)

    def test_a_failed_validation_creates_no_parent(self):
        r = self.presign("NEW", create=True, files=[file("not-a-hash")])
        self.assertEqual(r.status_code, 400)
        self.assertFalse(ParentItemPrice.objects.filter(item_id="NEW").exists())


class NumberingTests(ListingImageTestCase):
    def test_numbers_are_sequential_per_business(self):
        r = self.presign("P", create=True, files=[file(SHA_A), file(SHA_B), file(SHA_C)])
        self.assertEqual([x["image_no"] for x in r.data["results"]], [1, 2, 3])
        r2 = self.presign("P", files=[file("d" * 64)])
        self.assertEqual(r2.data["results"][0]["image_no"], 4)

    def test_each_business_counts_from_one(self):
        self.presign("P", create=True, files=[file(SHA_A), file(SHA_B)])
        other = Business.objects.create(name="Other")
        Membership.objects.create(user=self.user, business=other)
        r = self.client.post(f"/api/business/{other.id}/listing-images/presign/", {
            "parent_id": "Q", "create_parent": True, "product_name": "Q item",
            "files": [file(SHA_C)], **self.PRICING,
        }, format="json")
        self.assertEqual(r.data["results"][0]["image_no"], 1)

    def test_the_key_is_folder_then_product_and_number(self):
        r = self.presign("P", create=True, product="Brass Diya")
        key = ListingImage.objects.get(pk=r.data["results"][0]["id"]).key
        self.assertEqual(key, f"listing-images/{self.business.pk}/Brass Diya/Brass Diya-1.jpg")

    def test_extension_follows_the_content_type(self):
        r = self.presign("P", create=True, files=[file(SHA_A, "image/png"), file(SHA_B, "image/webp")])
        keys = [ListingImage.objects.get(pk=x["id"]).key for x in r.data["results"]]
        self.assertTrue(keys[0].endswith(".png"))
        self.assertTrue(keys[1].endswith(".webp"))

    def test_a_signed_put_url_comes_back_for_each_new_image(self):
        r = self.presign("P", create=True, files=[file(SHA_A), file(SHA_B)])
        for x in r.data["results"]:
            self.assertTrue(x["needs_upload"])
            self.assertIn("image%2Fjpeg", x["put_url"].replace("/", "%2F"))


class ConfirmBeforeLinkTests(ListingImageTestCase):
    """Only images actually seen in the bucket count as linked."""

    def test_confirm_marks_uploaded_once_the_object_exists(self):
        r = self.presign("P", create=True, files=[file(SHA_A), file(SHA_B)])
        self.upload(r.data["results"])
        ids = [x["id"] for x in r.data["results"]]
        c = self.confirm(ids)
        self.assertEqual(sorted(c.data["confirmed"]), sorted(ids))
        self.assertEqual(c.data["failed"], [])
        self.assertEqual(ListingImage.objects.filter(status="uploaded").count(), 2)

    def test_an_upload_that_never_landed_stays_pending_and_unlinked(self):
        r = self.presign("P", create=True, files=[file(SHA_A), file(SHA_B)])
        first, second = r.data["results"]
        self.upload([first])                           # second PUT "died"
        c = self.confirm([first["id"], second["id"]])
        self.assertEqual(c.data["confirmed"], [first["id"]])
        self.assertEqual(c.data["failed"][0]["id"], second["id"])
        self.assertIn("didn't finish", c.data["failed"][0]["reason"])
        listed = self.client.get(f"{self.base}/listing-images/?parent_id=P").data["results"]
        self.assertEqual([x["id"] for x in listed], [first["id"]])

    def test_a_truncated_upload_is_not_confirmed(self):
        r = self.presign("P", create=True, files=[file(SHA_A, size=5000)])
        img = ListingImage.objects.get(pk=r.data["results"][0]["id"])
        self.storage.present[img.key] = 1200
        c = self.confirm([img.pk])
        self.assertEqual(c.data["confirmed"], [])
        self.assertIn("size mismatch", c.data["failed"][0]["reason"])

    def test_storage_being_unreachable_fails_softly(self):
        r = self.presign("P", create=True)
        with mock.patch("meesho_app.listing_images_views.object_storage.object_size",
                        side_effect=RuntimeError("boom")):
            c = self.confirm([r.data["results"][0]["id"]])
        self.assertEqual(c.status_code, 200)
        self.assertIn("try again", c.data["failed"][0]["reason"])

    def test_confirming_twice_is_harmless(self):
        r = self.presign("P", create=True)
        self.upload(r.data["results"])
        i = r.data["results"][0]["id"]
        self.confirm([i])
        self.assertEqual(self.confirm([i]).data["confirmed"], [i])

    def test_another_businesss_image_cannot_be_confirmed(self):
        r = self.presign("P", create=True)
        other = Business.objects.create(name="Other")
        outsider = User.objects.create_user(username="x", password="pw", role=User.ROLE_BUSINESS_USER)
        Membership.objects.create(user=outsider, business=other)
        c = APIClient(); c.force_authenticate(outsider)
        res = c.post(f"/api/business/{other.id}/listing-images/confirm/",
                     {"ids": [r.data["results"][0]["id"]]}, format="json")
        self.assertEqual(res.data["confirmed"], [])
        self.assertEqual(res.data["failed"][0]["reason"], "unknown image")


class DedupeAndRetryTests(ListingImageTestCase):
    def test_re_uploading_the_same_crop_reuses_the_existing_image(self):
        r = self.presign("P", create=True)
        self.upload(r.data["results"]); self.confirm([r.data["results"][0]["id"]])
        again = self.presign("P").data["results"][0]
        self.assertTrue(again["duplicate"])
        self.assertFalse(again["needs_upload"])
        self.assertEqual(again["image_no"], 1)
        self.assertEqual(ListingImage.objects.count(), 1)

    def test_the_same_crop_twice_in_one_batch_is_stored_once(self):
        r = self.presign("P", create=True, files=[file(SHA_A), file(SHA_A)])
        a, b = r.data["results"]
        self.assertEqual(a["id"], b["id"])
        self.assertTrue(b["duplicate"])
        self.assertEqual(ListingImage.objects.count(), 1)

    def test_a_retry_after_a_failed_upload_keeps_the_same_number(self):
        """Retrying must not burn numbers or leave orphan rows behind."""
        first = self.presign("P", create=True).data["results"][0]
        retry = self.presign("P").data["results"][0]
        self.assertEqual(retry["id"], first["id"])
        self.assertEqual(retry["image_no"], first["image_no"])
        self.assertTrue(retry["needs_upload"])
        self.assertEqual(ListingImage.objects.count(), 1)
        self.assertEqual(ListingImageCounter.objects.get(business=self.business).last_no, 1)

    def test_a_duplicate_owned_by_another_parent_is_not_moved(self):
        r = self.presign("FIRST", create=True)
        self.upload(r.data["results"]); self.confirm([r.data["results"][0]["id"]])
        again = self.presign("SECOND", create=True).data["results"][0]
        self.assertEqual(again["parent"], "FIRST")
        self.assertEqual(ListingImage.objects.get().parent.item_id, "FIRST")

    def test_an_unlinked_duplicate_is_adopted(self):
        r = self.presign("FIRST", create=True)
        self.upload(r.data["results"]); self.confirm([r.data["results"][0]["id"]])
        ListingImage.objects.update(parent=None)
        again = self.presign("SECOND", create=True).data["results"][0]
        self.assertEqual(again["parent"], "SECOND")


class ValidationTests(ListingImageTestCase):
    def test_rejects_non_image_types(self):
        self.assertEqual(self.presign("P", create=True, files=[file(SHA_A, "application/pdf")]).status_code, 400)

    def test_rejects_oversized_and_empty_images(self):
        self.assertEqual(self.presign("P", create=True, files=[file(SHA_A, size=16 * 1024 * 1024)]).status_code, 400)
        self.assertEqual(self.presign("P", create=True, files=[file(SHA_A, size=0)]).status_code, 400)

    def test_rejects_an_empty_batch(self):
        self.assertEqual(self.presign("P", create=True, files=[]).status_code, 400)

    def test_rejects_a_bad_hash(self):
        self.assertEqual(self.presign("P", create=True, files=[file("xyz")]).status_code, 400)


class ListAndSearchTests(ListingImageTestCase):
    def setUp(self):
        super().setUp()
        r = self.presign("DIYA", create=True, files=[file(SHA_A), file(SHA_B)], product="Brass Diya")
        self.upload(r.data["results"]); self.confirm([x["id"] for x in r.data["results"]])
        r = self.presign("THALI", create=True, files=[file(SHA_C)], product="Pooja Thali")
        self.upload(r.data["results"]); self.confirm([x["id"] for x in r.data["results"]])

    def get(self, qs=""):
        return self.client.get(f"{self.base}/listing-images/{qs}").data["results"]

    def test_lists_a_parents_images(self):
        self.assertEqual(sorted(x["image_no"] for x in self.get("?parent_id=diya")), [1, 2])

    def test_search_by_image_number(self):
        self.assertEqual([x["image_no"] for x in self.get("?search=%233")], [3])

    def test_search_by_product_name(self):
        self.assertEqual([x["image_no"] for x in self.get("?search=thali")], [3])

    def test_public_url_uses_the_public_domain(self):
        self.assertTrue(all(x["public_url"].startswith("https://images.rudam.in/") for x in self.get()))

    def test_parent_picker_reports_image_counts(self):
        rows = self.client.get(f"{self.base}/parent-lookup/?search=a").data["results"]
        counts = {r["item_id"]: r["image_count"] for r in rows}
        self.assertEqual(counts, {"DIYA": 2, "THALI": 1})


class ConcurrentNumberingTests(TransactionTestCase):
    """Two batches at once must never receive the same number. SQLite
    serialises writers anyway; this guards the counter logic itself, and
    select_for_update makes it hold on MySQL in production."""

    def test_parallel_batches_get_distinct_numbers(self):
        user = User.objects.create_user(username="o", password="pw", role=User.ROLE_SUPER_ADMIN)
        business = Business.objects.create(name="B")
        Membership.objects.create(user=user, business=business)
        ParentItemPrice.objects.create(business=business, item_id="P")
        storage = StorageMock(); storage.start(self)
        numbers, errors = [], []

        def run(i):
            from django.db import connection
            try:
                c = APIClient(); c.force_authenticate(user)
                r = c.post(f"/api/business/{business.id}/listing-images/presign/", {
                    "parent_id": "P", "product_name": "Brass Diya", "files": [file(f"{i:064x}")],
                }, format="json")
                if r.status_code == 200:
                    numbers.extend(x["image_no"] for x in r.data["results"])
                else:
                    errors.append(r.status_code)
            except Exception as exc:  # sqlite "database is locked" under contention
                errors.append(str(exc))
            finally:
                connection.close()

        threads = [threading.Thread(target=run, args=(i,)) for i in range(1, 7)]
        for t in threads: t.start()
        for t in threads: t.join()
        self.assertEqual(len(numbers), len(set(numbers)), f"duplicate numbers: {numbers}")


class ParentListCountTests(ListingImageTestCase):
    """SKU Pricing shows "📷 Photos (N)" on each parent from this count."""

    def test_only_confirmed_images_are_counted(self):
        r = self.presign("DIYA", create=True, files=[file(SHA_A), file(SHA_B), file(SHA_C)])
        first, second, _third = r.data["results"]
        self.upload([first, second])
        self.confirm([first["id"], second["id"]])   # third never landed
        rows = self.client.get(f"{self.base}/parent-prices/").data["results"]
        diya = next(row for row in rows if row["item_id"] == "DIYA")
        self.assertEqual(diya["listing_image_count"], 2)

    def test_a_parent_with_no_photos_reports_zero(self):
        ParentItemPrice.objects.create(business=self.business, item_id="EMPTY")
        rows = self.client.get(f"{self.base}/parent-prices/").data["results"]
        self.assertEqual(next(r for r in rows if r["item_id"] == "EMPTY")["listing_image_count"], 0)


class NewParentPricingTests(ListingImageTestCase):
    """Point 1: a new parent needs price, tax and packaging — both in the
    cropper and on SKU Pricing — because every child SKU is costed at it."""

    def create_via_pricing(self, **fields):
        body = {"item_id": "NEW-P", **fields}
        return self.client.post(f"{self.base}/parent-prices/", body, format="json")

    def test_sku_pricing_form_requires_every_field(self):
        r = self.create_via_pricing()
        self.assertEqual(r.status_code, 400)
        self.assertEqual(set(r.data), {"item_price", "tax_percent", "packaging_cost"})
        self.assertFalse(ParentItemPrice.objects.filter(item_id="NEW-P").exists())

    def test_an_empty_price_is_refused(self):
        """The old form let "" through: parseFloat("") <= 0 is false."""
        r = self.create_via_pricing(item_price="", tax_percent=5, packaging_cost="2")
        self.assertEqual(r.data["item_price"], ["Item price is required."])

    def test_zero_price_is_refused_but_zero_tax_and_packaging_are_fine(self):
        self.assertIn("item_price", self.create_via_pricing(
            item_price="0", tax_percent=5, packaging_cost="2").data)
        r = self.create_via_pricing(item_price="40", tax_percent=0, packaging_cost="0")
        self.assertEqual(r.status_code, 201, r.data)

    def test_tax_must_be_a_whole_number_within_gst_range(self):
        for bad in ("29", "-1", "5.5", "abc"):
            r = self.create_via_pricing(item_price="40", tax_percent=bad, packaging_cost="2")
            self.assertIn("tax_percent", r.data, bad)

    def test_money_is_limited_to_two_decimals_and_real_numbers(self):
        for bad in ("10.999", "nan", "inf", "-5"):
            r = self.create_via_pricing(item_price=bad, tax_percent=5, packaging_cost="2")
            self.assertIn("item_price", r.data, bad)

    def test_final_price_is_computed_by_the_server_not_trusted(self):
        r = self.create_via_pricing(item_price="40", tax_percent=5, packaging_cost="2",
                                    final_price="1")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(str(ParentItemPrice.objects.get(item_id="NEW-P").final_price), "44.00")

    def test_cropper_create_requires_pricing_and_writes_nothing_without_it(self):
        r = self.presign("CROP-P", create=True, pricing={"item_price": "40"})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(set(r.data["fields"]), {"tax_percent", "packaging_cost"})
        self.assertFalse(ParentItemPrice.objects.filter(item_id="CROP-P").exists())
        self.assertEqual(ListingImage.objects.count(), 0)

    def test_choosing_an_existing_parent_needs_no_pricing(self):
        ParentItemPrice.objects.create(business=self.business, item_id="OLD", item_price="10")
        self.assertEqual(self.presign("OLD", create=False).status_code, 200)


class FolderNamingTests(ListingImageTestCase):
    """Point 2: the R2 folder is named like the downloaded zip."""

    def folder_for(self, parent, product, create=True, sha=None):
        r = self.presign(parent, create=create, product=product, files=[file(sha or SHA_A)])
        self.assertEqual(r.status_code, 200, r.data)
        return r.data["folder"], r.data

    def test_folder_is_the_product_name(self):
        folder, data = self.folder_for("P1", "Brass Pooja Plate")
        self.assertEqual(folder, "Brass Pooja Plate")
        self.assertEqual(data["file_base"], "Brass Pooja Plate")
        key = ListingImage.objects.get().key
        self.assertTrue(key.startswith(f"listing-images/{self.business.pk}/Brass Pooja Plate/"))

    def test_same_parent_keeps_adding_to_its_folder(self):
        self.folder_for("P1", "Brass Diya", sha=SHA_A)
        folder, _ = self.folder_for("P1", "Brass Diya", create=False, sha=SHA_B)
        self.assertEqual(folder, "Brass Diya")
        self.assertEqual(set(ListingImage.objects.values_list("folder", flat=True)), {"Brass Diya"})

    def test_another_parent_with_the_same_name_gets_001_then_002(self):
        self.assertEqual(self.folder_for("P1", "Brass Diya", sha=SHA_A)[0], "Brass Diya")
        self.assertEqual(self.folder_for("P2", "Brass Diya", sha=SHA_B)[0], "Brass Diya-001")
        self.assertEqual(self.folder_for("P3", "Brass Diya", sha=SHA_C)[0], "Brass Diya-002")

    def test_a_suffixed_folder_is_reused_by_its_own_parent(self):
        self.folder_for("P1", "Brass Diya", sha=SHA_A)
        self.folder_for("P2", "Brass Diya", sha=SHA_B)
        folder, _ = self.folder_for("P2", "Brass Diya", create=False, sha=SHA_C)
        self.assertEqual(folder, "Brass Diya-001")

    def test_names_differing_only_in_case_are_the_same_folder(self):
        self.folder_for("P1", "Brass Diya", sha=SHA_A)
        self.assertEqual(self.folder_for("P2", "brass diya", sha=SHA_B)[0], "brass diya-001")
        folder, _ = self.folder_for("P1", "BRASS DIYA", create=False, sha=SHA_C)
        self.assertEqual(folder, "Brass Diya")   # existing spelling kept

    def test_unsafe_characters_are_dropped_like_the_zip_name(self):
        folder, _ = self.folder_for("P1", '  Kalash / Diya: "Set" * 2  ')
        self.assertEqual(folder, "Kalash Diya Set 2")

    def test_symbols_survive_into_the_key(self):
        """Kept, not stripped — public_url() percent-encodes them; see
        PublicUrlEncodingTests."""
        self.folder_for("P1", "Kalash & Diya #2")
        self.assertIn("/Kalash & Diya #2/Kalash & Diya #2-1.jpg", ListingImage.objects.get().key)

    def test_a_blank_product_name_is_refused(self):
        r = self.presign("P1", create=True, product="   ")
        self.assertEqual(r.status_code, 400)
        self.assertFalse(ParentItemPrice.objects.filter(item_id="P1").exists())

    def test_a_very_long_name_still_fits_the_key_column(self):
        folder, _ = self.folder_for("P1", "x" * 300)
        key = ListingImage.objects.get().key
        self.assertLessEqual(len(folder), 100)
        self.assertLessEqual(len(key), 255)


class PublicUrlEncodingTests(TestCase):
    def test_spaces_and_symbols_are_percent_encoded(self):
        from django.test import override_settings
        from meesho_app import object_storage
        with override_settings(S3_PUBLIC_BASE_URL="https://images.rudam.in"):
            url = object_storage.public_url("listing-images/1/Kalash & Diya #2/Kalash & Diya #2-7.jpg")
        self.assertEqual(
            url,
            "https://images.rudam.in/listing-images/1/Kalash%20%26%20Diya%20%232/Kalash%20%26%20Diya%20%232-7.jpg",
        )


class VanishedObjectTests(ListingImageTestCase):
    """An image recorded as uploaded whose object was later deleted from the
    bucket must be uploaded again — not reported as a duplicate forever."""

    def upload_once(self, product="red-white"):
        r = self.presign("RED-WHITE", create=True, product=product)
        self.upload(r.data["results"]); self.confirm([r.data["results"][0]["id"]])
        return ListingImage.objects.get()

    def test_a_deleted_object_is_re_uploaded_under_the_same_number(self):
        img = self.upload_once()
        self.storage.present.clear()            # deleted in the R2 dashboard
        again = self.presign("RED-WHITE", product="red-white").data["results"][0]
        self.assertTrue(again["needs_upload"])
        self.assertTrue(again["restored"])
        self.assertFalse(again["duplicate"])
        self.assertEqual(again["image_no"], img.image_no)
        self.assertEqual(ListingImage.objects.count(), 1)
        self.assertEqual(ListingImage.objects.get().status, "pending")   # no longer claims "uploaded"

    def test_it_is_moved_into_the_product_folder(self):
        """Old date-path images get the folder layout when they come back."""
        img = self.upload_once()
        ListingImage.objects.filter(pk=img.pk).update(
            folder="", key=f"listing-images/{self.business.pk}/2026/10/dc138a42-1.png")
        self.storage.present.clear()
        self.presign("RED-WHITE", product="red-white")
        img.refresh_from_db()
        self.assertEqual(img.folder, "red-white")
        self.assertEqual(img.key, f"listing-images/{self.business.pk}/red-white/red-white-1.jpg")

    def test_once_re_uploaded_it_is_linked_again(self):
        self.upload_once()
        self.storage.present.clear()
        again = self.presign("RED-WHITE", product="red-white").data["results"]
        self.upload(again)
        self.assertEqual(self.confirm([again[0]["id"]]).data["confirmed"], [again[0]["id"]])
        listed = self.client.get(f"{self.base}/listing-images/?parent_id=RED-WHITE").data["results"]
        self.assertEqual(len(listed), 1)

    def test_an_object_still_present_stays_a_plain_duplicate(self):
        self.upload_once()
        again = self.presign("RED-WHITE", product="red-white").data["results"][0]
        self.assertTrue(again["duplicate"])
        self.assertFalse(again["needs_upload"])

    def test_if_storage_cannot_be_asked_the_record_is_trusted(self):
        self.upload_once()
        with mock.patch("meesho_app.listing_images_views.object_storage.object_size",
                        side_effect=RuntimeError("down")):
            again = self.presign("RED-WHITE", product="red-white").data["results"][0]
        self.assertTrue(again["duplicate"])


class DefaultParentImageTests(ListingImageTestCase):
    def upload_batch(self, parent="RW", create=True, files=None):
        r = self.presign(parent, create=create, product="red-white", files=files or [file(SHA_A), file(SHA_B)])
        self.upload(r.data["results"])
        self.confirm([x["id"] for x in r.data["results"]])
        return r.data["results"]

    def test_first_photo_becomes_the_parents_picture(self):
        results = self.upload_batch()
        parent = ParentItemPrice.objects.get(item_id="RW")
        first = ListingImage.objects.get(image_no=1)
        self.assertEqual(parent.image_url, f"https://images.rudam.in/{first.key}")
        self.assertEqual(results[0]["image_no"], 1)

    def test_a_pasted_picture_is_never_overwritten(self):
        ParentItemPrice.objects.create(business=self.business, item_id="RW", item_price="40",
                                       image_url="https://images.meesho.com/my-own.jpg")
        self.upload_batch(create=False)
        self.assertEqual(ParentItemPrice.objects.get(item_id="RW").image_url,
                         "https://images.meesho.com/my-own.jpg")

    def test_an_image_that_never_landed_is_not_used_as_the_picture(self):
        r = self.presign("RW", create=True, product="red-white", files=[file(SHA_A)])
        self.confirm([r.data["results"][0]["id"]])          # never uploaded
        self.assertFalse(ParentItemPrice.objects.get(item_id="RW").image_url)


class LegacyPendingFolderTests(ListingImageTestCase):
    def test_a_pre_folder_pending_record_is_moved_into_the_folder_on_reuse(self):
        first = self.presign("RW", create=True, product="red-white").data["results"][0]
        ListingImage.objects.filter(pk=first["id"]).update(
            folder="", key=f"listing-images/{self.business.pk}/2026/10/dc138a42-1.png")
        self.presign("RW", product="red-white")
        img = ListingImage.objects.get(pk=first["id"])
        self.assertEqual(img.folder, "red-white")
        self.assertEqual(img.key, f"listing-images/{self.business.pk}/red-white/red-white-1.jpg")
        self.assertEqual(img.image_no, 1)


class TidyCommandTests(ListingImageTestCase):
    def setUp(self):
        super().setUp()
        r = self.presign("RW", create=True, product="red-white", files=[file(SHA_A), file(SHA_B)])
        self.upload(r.data["results"]); self.confirm([x["id"] for x in r.data["results"]])
        # Simulate #1 having been stored before folders existed.
        self.legacy_key = f"listing-images/{self.business.pk}/2026/10/dc138a42-1.jpg"
        ListingImage.objects.filter(image_no=1).update(folder="", key=self.legacy_key)
        ParentItemPrice.objects.filter(item_id="RW").update(image_url=None)

    def run_cmd(self, *args):
        from io import StringIO
        from django.core.management import call_command
        out = StringIO()
        with mock.patch("meesho_app.management.commands.tidy_listing_images.object_storage.is_ready",
                        return_value=True), \
             mock.patch("meesho_app.management.commands.tidy_listing_images.object_storage.move_object") as mv:
            call_command("tidy_listing_images", *args, stdout=out)
        return out.getvalue(), mv

    def test_dry_run_changes_nothing(self):
        out, mv = self.run_cmd("--dry-run")
        mv.assert_not_called()
        self.assertEqual(ListingImage.objects.get(image_no=1).key, self.legacy_key)
        self.assertFalse(ParentItemPrice.objects.get(item_id="RW").image_url)
        self.assertIn("would move 1", out)

    def test_moves_into_the_parents_existing_folder_and_sets_the_picture(self):
        out, mv = self.run_cmd()
        new_key = f"listing-images/{self.business.pk}/red-white/red-white-1.jpg"
        mv.assert_called_once_with(self.legacy_key, new_key)
        img = ListingImage.objects.get(image_no=1)
        self.assertEqual((img.folder, img.key), ("red-white", new_key))
        self.assertTrue(ParentItemPrice.objects.get(item_id="RW").image_url.endswith(new_key))

    def test_a_failed_move_leaves_the_record_untouched(self):
        from io import StringIO
        from django.core.management import call_command
        with mock.patch("meesho_app.management.commands.tidy_listing_images.object_storage.is_ready",
                        return_value=True), \
             mock.patch("meesho_app.management.commands.tidy_listing_images.object_storage.move_object",
                        side_effect=RuntimeError("copy failed")):
            call_command("tidy_listing_images", stdout=StringIO())
        self.assertEqual(ListingImage.objects.get(image_no=1).key, self.legacy_key)

    def test_running_twice_is_harmless(self):
        self.run_cmd()
        _out, mv = self.run_cmd()
        mv.assert_not_called()
