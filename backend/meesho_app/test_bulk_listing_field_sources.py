"""Saved field values, scoped to the uploaded template's category.

A preset (and a generated sheet's snapshot) is {field_key: value}, and a field
key only means something against the template it came from — so offering one
saved under a different category just silently prefills nothing. These tests
pin the scoping, and the "a previous listing is reusable too" behaviour.
"""

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from .models import BulkListingBatch, BulkListingFieldPreset, FlipkartFieldPreset


class FieldSourceTestCase(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="owner", password="pw", role=User.ROLE_SUPER_ADMIN,
        )
        self.business = Business.objects.create(name="B")
        Membership.objects.create(user=self.user, business=self.business)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.base = f"/api/business/{self.business.id}"

    def preset(self, name, label, fields=None, model=BulkListingFieldPreset):
        return model.objects.create(
            business=self.business, name=name, source_label=label,
            fields=fields or {"brand": "Kalash", "net_qty": "1"}, created_by=self.user,
        )

    def batch(self, label, first_sku, snapshot, platform=BulkListingBatch.PLATFORM_MEESHO,
              row_count=1):
        return BulkListingBatch.objects.create(
            business=self.business, platform=platform, category_label=label,
            filename=f"{first_sku}.xlsx", file_data=b"x",
            source_kind=BulkListingBatch.SOURCE_FILE, first_sku_id=first_sku,
            sku_ids=[first_sku], row_count=row_count, payload_snapshot=snapshot,
            created_by=self.user,
        )

    def sources(self, **params):
        qs = "&".join(f"{k}={v}" for k, v in params.items())
        return self.client.get(f"{self.base}/bulk-listing/field-sources/?{qs}")


class PresetScopingTests(FieldSourceTestCase):
    def setUp(self):
        super().setUp()
        self.preset("Diya basics", "Diyas")
        self.preset("Diya premium", "Diyas")
        self.preset("Saree basics", "Sarees")

    def test_only_this_categorys_presets_are_offered(self):
        r = self.sources(platform="meesho", source_label="Diyas")
        self.assertEqual(
            sorted(x["name"] for x in r.data["results"]), ["Diya basics", "Diya premium"],
        )
        self.assertEqual(r.data["other_count"], 1)

    def test_matching_ignores_case(self):
        self.assertEqual(len(self.sources(platform="meesho", source_label="diyas").data["results"]), 2)

    def test_no_category_filter_returns_everything(self):
        r = self.sources(platform="meesho")
        self.assertEqual(len(r.data["results"]), 3)
        self.assertEqual(r.data["other_count"], 0)

    def test_an_unknown_category_says_how_many_exist_elsewhere(self):
        r = self.sources(platform="meesho", source_label="Kurtis")
        self.assertEqual(r.data["results"], [])
        self.assertEqual(r.data["other_count"], 3)

    def test_meesho_never_sees_flipkart_presets(self):
        self.preset("FK diya", "Diyas", model=FlipkartFieldPreset)
        names = [x["name"] for x in self.sources(platform="meesho", source_label="Diyas").data["results"]]
        self.assertNotIn("FK diya", names)

    def test_flipkart_reads_its_own_table(self):
        self.preset("FK diya", "Diyas", model=FlipkartFieldPreset)
        names = [x["name"] for x in self.sources(platform="flipkart", source_label="Diyas").data["results"]]
        self.assertEqual(names, ["FK diya"])

    def test_sources_never_cross_businesses(self):
        other = Business.objects.create(name="Other")
        BulkListingFieldPreset.objects.create(
            business=other, name="Theirs", source_label="Diyas", fields={"brand": "X"},
        )
        names = [x["name"] for x in self.sources(platform="meesho", source_label="Diyas").data["results"]]
        self.assertNotIn("Theirs", names)

    def test_an_unknown_platform_is_rejected(self):
        self.assertEqual(self.sources(platform="amazon").status_code, 400)


class PastListingReuseTests(FieldSourceTestCase):
    """Every generated sheet is already a record of a fully filled-in form, so
    it is offered for reuse without anyone having to save it as a preset."""

    def test_a_meesho_batch_exposes_its_shared_fields(self):
        self.batch("Diyas", "SKU-1",
                   {"mode": "new", "shared": {"brand": "Kalash", "mrp": "499"}, "rows": []})
        r = self.sources(platform="meesho", source_label="Diyas")
        self.assertEqual(len(r.data["results"]), 1)
        entry = r.data["results"][0]
        self.assertEqual(entry["kind"], "batch")
        self.assertEqual(entry["fields"], {"brand": "Kalash", "mrp": "499"})
        self.assertEqual(entry["field_count"], 2)

    def test_a_batch_is_named_so_it_can_be_recognised(self):
        self.batch("Diyas", "SKU-1", {"shared": {"brand": "K"}}, row_count=5)
        entry = self.sources(platform="meesho", source_label="Diyas").data["results"][0]
        self.assertEqual(entry["name"], "SKU-1 +4 more")

    def test_blank_values_are_not_offered_as_fields(self):
        self.batch("Diyas", "SKU-1", {"shared": {"brand": "K", "mrp": "", "color": None}})
        entry = self.sources(platform="meesho", source_label="Diyas").data["results"][0]
        self.assertEqual(entry["fields"], {"brand": "K"})

    def test_a_batch_with_nothing_usable_is_left_out(self):
        """An older batch with no snapshot would be a picker entry that does
        nothing when chosen."""
        self.batch("Diyas", "EMPTY-1", {})
        self.batch("Diyas", "BLANK-1", {"shared": {"brand": ""}})
        self.batch("Diyas", "GOOD-1", {"shared": {"brand": "K"}})
        names = [x["name"] for x in self.sources(platform="meesho", source_label="Diyas").data["results"]]
        self.assertEqual(names, ["GOOD-1"])

    def test_batches_from_another_category_are_filtered_and_counted(self):
        self.batch("Diyas", "D-1", {"shared": {"brand": "K"}})
        self.batch("Sarees", "S-1", {"shared": {"brand": "K"}})
        r = self.sources(platform="meesho", source_label="Diyas")
        self.assertEqual([x["name"] for x in r.data["results"]], ["D-1"])
        self.assertEqual(r.data["other_count"], 1)

    def test_a_flipkart_batch_exposes_row_1s_attributes(self):
        """Flipkart fills each row separately; row 1 is the one the UI already
        mirrors onto the others, so it is the one worth reusing."""
        self.batch("kalash", "FK-1",
                   {"mode": "flipkart",
                    "rows": [{"sku_id": "FK-1", "attributes": {"brand": "Kalash", "mrp": "499"}},
                             {"sku_id": "FK-2", "attributes": {"brand": "Other"}}]},
                   platform=BulkListingBatch.PLATFORM_FLIPKART)
        entry = self.sources(platform="flipkart", source_label="kalash").data["results"][0]
        self.assertEqual(entry["fields"], {"brand": "Kalash", "mrp": "499"})

    def test_a_meesho_batch_is_not_read_as_flipkart(self):
        self.batch("Diyas", "SKU-1", {"shared": {"brand": "K"}})
        r = self.sources(platform="flipkart", source_label="Diyas")
        self.assertEqual(r.data["results"], [])

    def test_presets_and_listings_arrive_in_one_list_each_tagged(self):
        self.preset("Diya basics", "Diyas")
        self.batch("Diyas", "SKU-1", {"shared": {"brand": "K"}})
        r = self.sources(platform="meesho", source_label="Diyas")
        kinds = {x["kind"] for x in r.data["results"]}
        self.assertEqual(kinds, {"preset", "batch"})
        keys = [x["key"] for x in r.data["results"]]
        self.assertEqual(len(keys), len(set(keys)), "keys must be unique across both kinds")
        self.assertTrue(any(k.startswith("preset-") for k in keys))
        self.assertTrue(any(k.startswith("batch-") for k in keys))

    def test_the_batch_list_is_capped_so_the_picker_stays_usable(self):
        for i in range(45):
            self.batch("Diyas", f"SKU-{i}", {"shared": {"brand": "K"}})
        r = self.sources(platform="meesho", source_label="Diyas")
        self.assertEqual(len(r.data["results"]), 40)


class LegacyPresetEndpointTests(FieldSourceTestCase):
    """The original presets endpoint keeps working, now with the same filter."""

    def test_meesho_presets_filter_by_category(self):
        self.preset("Diya basics", "Diyas")
        self.preset("Saree basics", "Sarees")
        r = self.client.get(f"{self.base}/bulk-listing/presets/?source_label=Diyas")
        self.assertEqual([p["name"] for p in r.data["results"]], ["Diya basics"])
        self.assertEqual(r.data["other_count"], 1)

    def test_unfiltered_is_unchanged(self):
        self.preset("Diya basics", "Diyas")
        self.preset("Saree basics", "Sarees")
        r = self.client.get(f"{self.base}/bulk-listing/presets/")
        self.assertEqual(len(r.data["results"]), 2)
        self.assertEqual(r.data["other_count"], 0)
