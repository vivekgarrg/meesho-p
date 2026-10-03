"""Flipkart bulk-listing rules that Flipkart's own uploader enforces.

The procurement-type values here are not a guess: an upload built by this app
came back rejected with

    [procurement_type]: Invalid value given for attribute: procurement_type.
    Allowed values are: QUICK,REGULAR,EXPRESS,DOMESTIC,MADE_TO_ORDER,INTERNATIONAL

so that list is the contract, and these tests pin it.
"""

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from . import bulk_listing_flipkart as blf
from .models import BulkListingBatch, FlipkartFieldPreset

ALLOWED_PROCUREMENT = ["QUICK", "REGULAR", "EXPRESS", "DOMESTIC", "MADE_TO_ORDER", "INTERNATIONAL"]


def spec_with(*fields):
    return {"category_label": "Test", "sheet_name": "Test", "data_start_row": 4, "fields": list(fields)}


def field(key, label, options=None, role="attribute"):
    return {"key": key, "label": label, "column": 0, "required": False,
            "type": "select" if options else "text", "options": options or [],
            "role": role, "mirror_columns": [], "money_max": None}


class ProcurementTypeTests(TestCase):
    def test_the_allowed_set_is_exactly_what_flipkart_accepts(self):
        self.assertEqual(blf.CANONICAL_DROPDOWN_VALUES["procurement type"], ALLOWED_PROCUREMENT)

    def test_the_values_flipkart_rejected_are_gone(self):
        values = blf.CANONICAL_DROPDOWN_VALUES["procurement type"]
        self.assertNotIn("Instock", values)   # never a valid value at all
        self.assertNotIn("Express", values)   # right lane, wrong case
        self.assertIn("EXPRESS", values)

    def test_the_default_is_itself_an_allowed_value(self):
        """A default that fails validation is worse than no default."""
        default = blf.DEFAULT_ATTRIBUTE_VALUES["procurement type"]
        self.assertIn(default, ALLOWED_PROCUREMENT)
        self.assertEqual(default, "EXPRESS")

    def test_default_attributes_resolves_on_a_spec(self):
        spec = spec_with(field("pt", "Procurement Type", ALLOWED_PROCUREMENT))
        self.assertEqual(blf.default_attributes(spec), {"pt": "EXPRESS"})

    def test_an_oddly_spaced_or_cased_header_still_matches(self):
        spec = spec_with(field("pt", "  procurement   TYPE ", ALLOWED_PROCUREMENT))
        self.assertEqual(blf.default_attributes(spec), {"pt": "EXPRESS"})


class FulfilmentByTests(TestCase):
    def test_fulfilment_is_forced_to_seller(self):
        spec = spec_with(field("fb", "Fullfilment by", ["Seller", "Flipkart"]))
        self.assertEqual(blf.forced_attributes(spec), {"fb": "Seller"})

    def test_every_spelling_flipkart_has_shipped_is_matched(self):
        for label in ("Fullfilment by", "Fulfilment by", "Fulfillment by", "Fulfilled by"):
            spec = spec_with(field("fb", label, ["Seller", "Flipkart"]))
            self.assertEqual(blf.forced_attributes(spec), {"fb": "Seller"}, label)

    def test_the_forced_value_snaps_to_the_sheets_own_casing(self):
        """'Seller' against a SELLER-only dropdown would fail the server's own
        `value not in options` check and take the whole generate down."""
        spec = spec_with(field("fb", "Fullfilment by", ["SELLER", "FLIPKART"]))
        self.assertEqual(blf.forced_attributes(spec), {"fb": "SELLER"})

    def test_a_forced_value_with_no_dropdown_is_left_as_is(self):
        spec = spec_with(field("sp", "Shipping provider", []))
        self.assertEqual(blf.forced_attributes(spec), {"sp": "FLIPKART"})

    def test_forced_wins_over_whatever_the_sheet_said(self):
        """Flipkart-fulfilled locks procurement type/SLA/stock, so this is not
        a preference — it is what keeps the rest of the sheet writable."""
        spec = spec_with(field("fb", "Fullfilment by", ["Seller", "Flipkart"]))
        forced = blf.forced_attributes(spec)
        attrs = {"fb": "Flipkart"}
        attrs.update(forced)
        self.assertEqual(attrs["fb"], "Seller")

    def test_a_forced_field_is_never_also_merely_defaulted(self):
        overlap = set(blf.FORCED_ATTRIBUTE_VALUES) & set(blf.DEFAULT_ATTRIBUTE_VALUES)
        self.assertEqual(overlap, set())


class FlipkartApiTestCase(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="owner", password="pw", role=User.ROLE_SUPER_ADMIN,
        )
        self.business = Business.objects.create(name="B")
        Membership.objects.create(user=self.user, business=self.business)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.base = f"/api/business/{self.business.id}"


class PresetScopingTests(FlipkartApiTestCase):
    """A preset is {field_key: value}; a Flipkart field key only means
    something against its own template, so presets are per category."""

    def setUp(self):
        super().setUp()
        for name, label in [("Diya basics", "Diyas"), ("Diya premium", "Diyas"),
                            ("Saree basics", "Sarees")]:
            FlipkartFieldPreset.objects.create(
                business=self.business, name=name, source_label=label,
                fields={"brand": "Kalash"}, created_by=self.user,
            )

    def test_unfiltered_still_returns_everything(self):
        r = self.client.get(f"{self.base}/bulk-listing/flipkart-presets/")
        self.assertEqual(len(r.data["results"]), 3)
        self.assertEqual(r.data["other_count"], 0)

    def test_filtering_by_category_hides_the_rest_and_counts_them(self):
        r = self.client.get(f"{self.base}/bulk-listing/flipkart-presets/?source_label=Diyas")
        self.assertEqual(
            sorted(p["name"] for p in r.data["results"]), ["Diya basics", "Diya premium"],
        )
        self.assertEqual(r.data["other_count"], 1)

    def test_category_matching_ignores_case(self):
        r = self.client.get(f"{self.base}/bulk-listing/flipkart-presets/?source_label=diyas")
        self.assertEqual(len(r.data["results"]), 2)

    def test_a_category_with_no_presets_says_how_many_exist_elsewhere(self):
        r = self.client.get(f"{self.base}/bulk-listing/flipkart-presets/?source_label=Kurtis")
        self.assertEqual(r.data["results"], [])
        self.assertEqual(r.data["other_count"], 3)

    def test_presets_never_cross_businesses(self):
        other = Business.objects.create(name="Other")
        FlipkartFieldPreset.objects.create(
            business=other, name="Theirs", source_label="Diyas", fields={}, created_by=self.user,
        )
        r = self.client.get(f"{self.base}/bulk-listing/flipkart-presets/?source_label=Diyas")
        self.assertNotIn("Theirs", [p["name"] for p in r.data["results"]])


class BatchPlatformFilterTests(FlipkartApiTestCase):
    """The Flipkart flow lists only Flipkart sheets — a Meesho batch cannot be
    loaded back into the Flipkart form at all, so showing it is a dead end."""

    def setUp(self):
        super().setUp()
        for platform, name in [
            (BulkListingBatch.PLATFORM_MEESHO, "meesho-a.xlsx"),
            (BulkListingBatch.PLATFORM_MEESHO, "meesho-b.xlsx"),
            (BulkListingBatch.PLATFORM_FLIPKART, "flipkart-a.xls"),
        ]:
            BulkListingBatch.objects.create(
                business=self.business, platform=platform, filename=name,
                file_data=b"x", source_kind=BulkListingBatch.SOURCE_FILE,
                first_sku_id="SKU-1", sku_ids=["SKU-1"], row_count=1,
            )

    def test_flipkart_sees_only_flipkart(self):
        r = self.client.get(f"{self.base}/bulk-listing/batches/?platform=flipkart")
        self.assertEqual([b["filename"] for b in r.data["results"]], ["flipkart-a.xls"])

    def test_meesho_sees_only_meesho(self):
        r = self.client.get(f"{self.base}/bulk-listing/batches/?platform=meesho")
        self.assertEqual(
            sorted(b["filename"] for b in r.data["results"]), ["meesho-a.xlsx", "meesho-b.xlsx"],
        )

    def test_no_filter_still_returns_both(self):
        r = self.client.get(f"{self.base}/bulk-listing/batches/")
        self.assertEqual(len(r.data["results"]), 3)
