"""Regression tests for the master price list and the parent -> child price
cascade (meesho_app/master_pricing.py).

Every case here is one that was actually broken: the master-item endpoints
raised NameError because the models were never imported into views, adding a
parent price-history entry called a master_pricing function that did not
exist, a hand edit to a parent left its child SKUs on the old price, and the
whole master_item table was missing because the migration graph had two leaf
nodes so `migrate` refused to run at all.
"""

from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from .models import (
    FinalPrice,
    MasterItem,
    MasterItemComponent,
    MasterItemPriceHistory,
    ParentItemPrice,
)


class MasterPricingTestCase(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="owner", password="pw", role=User.ROLE_SUPER_ADMIN,
        )
        self.business = Business.objects.create(name="Test Business")
        Membership.objects.create(user=self.user, business=self.business)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.base = f"/api/business/{self.business.id}"


class MasterItemEndpointTests(MasterPricingTestCase):
    """The Master Pricing tab's own CRUD."""

    def test_create_lists_and_round_trips(self):
        r = self.client.post(f"{self.base}/master-items/", {
            "name": "Katori", "unit_price": "30", "notes": "steel", "image_url": "",
        }, format="json")
        self.assertEqual(r.status_code, 201, r.data)

        listed = self.client.get(f"{self.base}/master-items/")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual([row["name"] for row in listed.data["results"]], ["Katori"])
        self.assertEqual(listed.data["results"][0]["unit_price"], "30.00")

    def test_create_without_a_price_is_allowed(self):
        """An item can exist before anyone knows what it costs."""
        r = self.client.post(f"{self.base}/master-items/", {
            "name": "Katori", "unit_price": None, "notes": "", "image_url": "",
        }, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertIsNone(r.data["unit_price"])

    def test_patch_updates_the_price(self):
        item = MasterItem.objects.create(business=self.business, name="Katori", unit_price=Decimal("30"))
        r = self.client.patch(f"{self.base}/master-items/{item.id}/", {
            "name": "Katori", "unit_price": "35",
        }, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        item.refresh_from_db()
        self.assertEqual(item.unit_price, Decimal("35"))

    def test_duplicate_name_is_a_clean_400(self):
        MasterItem.objects.create(business=self.business, name="Katori")
        r = self.client.post(f"{self.base}/master-items/", {"name": "Katori"}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("name", r.data)

    def test_delete_is_refused_while_a_parent_uses_it(self):
        item = MasterItem.objects.create(business=self.business, name="Katori", unit_price=Decimal("30"))
        parent = ParentItemPrice.objects.create(business=self.business, item_id="P1")
        MasterItemComponent.objects.create(parent=parent, master_item=item, quantity=1)
        r = self.client.delete(f"{self.base}/master-items/{item.id}/")
        self.assertEqual(r.status_code, 400)
        self.assertIn("bill of materials", r.data["error"])


class BillOfMaterialsCascadeTests(MasterPricingTestCase):
    """master item -> parent -> child FinalPrice, the one dependency direction."""

    def setUp(self):
        super().setUp()
        self.item = MasterItem.objects.create(
            business=self.business, name="Katori", unit_price=Decimal("30"),
        )
        self.parent = ParentItemPrice.objects.create(
            business=self.business, item_id="P1", tax_percent=5, packaging_cost=Decimal("2"),
        )
        MasterItemComponent.objects.create(parent=self.parent, master_item=self.item, quantity=Decimal("2"))
        self.child = FinalPrice.objects.create(business=self.business, sku_id="S1", parent=self.parent)

    def test_adding_a_component_prices_the_parent(self):
        self.parent.refresh_from_db()
        self.assertEqual(self.parent.item_price, Decimal("60"))    # 2 x 30
        self.assertEqual(self.parent.final_price, Decimal("65.00"))  # +5% +2

    def test_raising_the_master_price_reprices_parent_and_child(self):
        r = self.client.patch(f"{self.base}/master-items/{self.item.id}/",
                              {"name": "Katori", "unit_price": "35"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.parent.refresh_from_db()
        self.child.refresh_from_db()
        self.assertEqual(self.parent.item_price, Decimal("70"))
        self.assertEqual(self.parent.final_price, Decimal("75.50"))
        self.assertEqual(self.child.item_price, Decimal("70"))
        self.assertEqual(self.child.final_price, Decimal("75.50"))

    def test_a_hand_edit_to_a_bom_parent_is_put_back(self):
        """The recipe owns item_price; a stale UI cannot override it."""
        r = self.client.patch(f"{self.base}/parent-prices/P1/", {
            "item_price": "999", "tax_percent": "5", "packaging_cost": "2",
        }, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.parent.refresh_from_db()
        self.assertEqual(self.parent.item_price, Decimal("60"))


class ParentEditPropagationTests(MasterPricingTestCase):
    """A child FinalPrice mirrors its parent — including after a hand edit."""

    def test_editing_a_parent_reprices_its_children(self):
        parent = ParentItemPrice.objects.create(
            business=self.business, item_id="P1", item_price=Decimal("40"),
            tax_percent=5, packaging_cost=Decimal("2"), final_price=Decimal("44"),
        )
        child = FinalPrice.objects.create(business=self.business, sku_id="S1", parent=parent)

        r = self.client.patch(f"{self.base}/parent-prices/P1/", {
            "item_price": "50", "tax_percent": "5", "packaging_cost": "2",
            "final_price": "54.50", "image_url": "",
        }, format="json")
        self.assertEqual(r.status_code, 200, r.data)

        child.refresh_from_db()
        self.assertEqual(child.item_price, Decimal("50"))
        self.assertEqual(child.final_price, Decimal("54.50"))

    def test_adding_a_price_history_entry_succeeds(self):
        """Used to 500 on master_pricing.handle_parent_saved, which never existed."""
        ParentItemPrice.objects.create(business=self.business, item_id="P1")
        r = self.client.post(f"{self.base}/parent-prices/P1/price-history/", {
            "effective_from": "2026-10-01", "item_price": "40",
            "tax_percent": 5, "packaging_cost": "2",
        }, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        parent = ParentItemPrice.objects.get(item_id="P1")
        self.assertEqual(parent.item_price, Decimal("40"))
        self.assertEqual(parent.final_price, Decimal("44.00"))


class MasterItemPriceUpdateTests(MasterPricingTestCase):
    """The price-update trail — "Katori went from ₹30 to ₹35 on 1 Oct"."""

    def setUp(self):
        super().setUp()
        self.item = MasterItem.objects.create(
            business=self.business, name="Katori", unit_price=Decimal("30"),
        )
        self.parent = ParentItemPrice.objects.create(
            business=self.business, item_id="P1", tax_percent=5, packaging_cost=Decimal("2"),
        )
        MasterItemComponent.objects.create(parent=self.parent, master_item=self.item, quantity=Decimal("2"))
        self.child = FinalPrice.objects.create(business=self.business, sku_id="S1", parent=self.parent)

    def _record(self, effective_from, unit_price, **extra):
        return self.client.post(
            f"{self.base}/master-items/{self.item.id}/price-history/",
            {"effective_from": effective_from, "unit_price": unit_price, **extra},
            format="json",
        )

    def test_recording_an_update_cascades_all_the_way_down(self):
        r = self._record("2026-10-01", "35", notes="supplier hike")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["item"]["unit_price"], "35.00")

        self.item.refresh_from_db()
        self.parent.refresh_from_db()
        self.child.refresh_from_db()
        self.assertEqual(self.item.unit_price, Decimal("35"))
        self.assertEqual(self.parent.item_price, Decimal("70"))
        self.assertEqual(self.child.final_price, Decimal("75.50"))

    def test_the_latest_date_is_the_price_in_force(self):
        """Entries can be backfilled out of order; the newest date still wins."""
        self._record("2026-09-01", "30")
        self._record("2026-10-01", "35")
        self._record("2026-08-01", "25")
        self.item.refresh_from_db()
        self.assertEqual(self.item.unit_price, Decimal("35"))

    def test_a_second_price_for_the_same_day_is_a_correction(self):
        self._record("2026-10-01", "35")
        self._record("2026-10-01", "36")
        trail = self.client.get(f"{self.base}/master-items/{self.item.id}/price-history/").data["results"]
        self.assertEqual(len(trail), 1)
        self.assertEqual(trail[0]["unit_price"], "36.00")

    def test_effective_from_defaults_to_today(self):
        from django.utils import timezone
        r = self.client.post(f"{self.base}/master-items/{self.item.id}/price-history/",
                             {"unit_price": "35"}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["entry"]["effective_from"], str(timezone.localdate()))

    def test_removing_the_latest_entry_restores_the_previous_price(self):
        self._record("2026-09-01", "30")
        latest = self._record("2026-10-01", "35").data["entry"]["id"]

        r = self.client.delete(f"{self.base}/master-items/{self.item.id}/price-history/{latest}/")
        self.assertEqual(r.status_code, 200, r.data)

        self.item.refresh_from_db()
        self.parent.refresh_from_db()
        self.assertEqual(self.item.unit_price, Decimal("30"))
        self.assertEqual(self.parent.item_price, Decimal("60"))

    def test_an_inline_price_edit_is_logged_on_the_trail(self):
        """However the price was changed, the trail is complete."""
        self.client.patch(f"{self.base}/master-items/{self.item.id}/",
                          {"name": "Katori", "unit_price": "42"}, format="json")
        trail = MasterItemPriceHistory.objects.filter(master_item=self.item)
        self.assertEqual(trail.count(), 1)
        self.assertEqual(trail.first().unit_price, Decimal("42"))

    def test_an_edit_that_does_not_touch_the_price_logs_nothing(self):
        self.client.patch(f"{self.base}/master-items/{self.item.id}/",
                          {"notes": "steel, 4 inch"}, format="json")
        self.assertEqual(MasterItemPriceHistory.objects.filter(master_item=self.item).count(), 0)

    def test_the_list_payload_carries_the_trail_and_the_parents(self):
        """So the tab can draw a row's timeline and impact without N requests."""
        self._record("2026-10-01", "35")
        row = self.client.get(f"{self.base}/master-items/").data["results"][0]
        self.assertEqual(len(row["price_history"]), 1)
        self.assertEqual(row["used_in_count"], 1)
        self.assertEqual(row["used_in_parents"], [{"item_id": "P1", "quantity": "2.000"}])

    def test_another_business_cannot_reach_the_trail(self):
        other = Business.objects.create(name="Someone Else")
        outsider = User.objects.create_user(username="x", password="pw", role=User.ROLE_BUSINESS_USER)
        Membership.objects.create(user=outsider, business=other)
        client = APIClient()
        client.force_authenticate(outsider)
        r = client.get(f"{self.base}/master-items/{self.item.id}/price-history/")
        self.assertEqual(r.status_code, 404)

    def test_a_price_dated_ahead_of_today_still_wins_over_an_inline_edit(self):
        """The trail is the one authority — the two can never disagree."""
        self._record("2099-01-01", "80")
        self.client.patch(f"{self.base}/master-items/{self.item.id}/",
                          {"unit_price": "42"}, format="json")
        self.item.refresh_from_db()
        self.assertEqual(self.item.unit_price, Decimal("80"))
