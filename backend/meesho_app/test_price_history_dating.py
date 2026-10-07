"""A price change applies to orders placed from that date on — never to
orders placed before it.

Profit costs each order at the price in effect on its ORDER date. Before this,
only "Add Price Entry" left a dated record; Edit Price, the Excel upload and a
master-list cascade overwrote the current price, and every order without a
matching dated entry fell back to the current price — so raising a price
recosted all past orders at the new one. These run through the real profit
lookups, not a reimplementation of them.
"""

from datetime import date, timedelta
from decimal import Decimal as D

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from .models import (
    FinalPrice, MasterItem, MasterItemComponent, Order, ParentItemPrice, ParentPriceHistory,
)
from .views import _PriceResolver, _estimated_profit_pricing_lookup, _history_entry_at

TODAY = timezone.localdate()
YESTERDAY = TODAY - timedelta(days=1)
LAST_MONTH = TODAY - timedelta(days=30)


class DatingTestCase(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="o", password="pw", role=User.ROLE_SUPER_ADMIN)
        self.business = Business.objects.create(name="B")
        Membership.objects.create(user=self.user, business=self.business)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.base = f"/api/business/{self.business.id}"
        # Priced at 40 (+5% +2 = 44.00), one child SKU, orders going back a month.
        self.parent = ParentItemPrice.objects.create(
            business=self.business, item_id="DIYA", item_price=D("40"), tax_percent=5,
            packaging_cost=D("2"), final_price=D("44.00"),
        )
        FinalPrice.objects.create(business=self.business, sku_id="DIYA-1", parent=self.parent,
                                  item_price=D("40"), tax_percent=5, packaging_cost=D("2"), final_price=D("44.00"))
        Order.objects.create(business=self.business, sub_order_no="O-OLD", sku="DIYA-1", order_date=LAST_MONTH)

    def raise_price(self, item_price="50"):
        r = self.client.patch(f"{self.base}/parent-prices/DIYA/",
                              {"item_price": item_price, "tax_percent": 5, "packaging_cost": "2"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)

    def cost_on(self, when):
        """Final price the profit report uses for an order placed on `when`."""
        return _PriceResolver(self.business).effective_price("DIYA-1", when)[0]

    def estimated_cost_on(self, when):
        """Item price the estimated / Flipkart profit reports use."""
        get_price, _known, _canonical = _estimated_profit_pricing_lookup(self.business)
        return get_price("DIYA-1", when)[0]


class EditPriceIsDatedTests(DatingTestCase):
    def test_orders_before_the_increase_keep_the_old_price(self):
        self.raise_price("50")
        self.assertEqual(self.cost_on(LAST_MONTH), D("44.00"))
        self.assertEqual(self.cost_on(YESTERDAY), D("44.00"))

    def test_orders_from_the_day_of_the_increase_use_the_new_price(self):
        self.raise_price("50")
        self.assertEqual(self.cost_on(TODAY), D("54.50"))          # 50 + 5% + 2

    def test_the_estimated_and_flipkart_reports_agree(self):
        self.raise_price("50")
        self.assertEqual(self.estimated_cost_on(LAST_MONTH), D("40"))
        self.assertEqual(self.estimated_cost_on(TODAY), D("50"))

    def test_the_old_price_is_recorded_from_the_first_order_on(self):
        self.raise_price("50")
        history = list(ParentPriceHistory.objects.filter(parent=self.parent).order_by("effective_from"))
        self.assertEqual([(h.effective_from, h.item_price) for h in history],
                         [(LAST_MONTH, D("40")), (TODAY, D("50"))])
        self.assertIn("automatically", history[0].notes)

    def test_a_second_change_the_same_day_replaces_todays_entry(self):
        self.raise_price("50")
        self.raise_price("55")
        prices = list(ParentPriceHistory.objects.filter(parent=self.parent)
                      .order_by("effective_from").values_list("item_price", flat=True))
        self.assertEqual(prices, [D("40"), D("55")])

    def test_a_later_change_does_not_rewrite_the_baseline(self):
        self.raise_price("50")
        ParentPriceHistory.objects.filter(parent=self.parent, effective_from=TODAY).update(
            effective_from=YESTERDAY)                      # pretend that was yesterday
        self.raise_price("60")
        prices = list(ParentPriceHistory.objects.filter(parent=self.parent)
                      .order_by("effective_from").values_list("item_price", flat=True))
        self.assertEqual(prices, [D("40"), D("50"), D("60")])
        self.assertEqual(self.cost_on(LAST_MONTH), D("44.00"))


class OnlyRealChangesAreRecordedTests(DatingTestCase):
    def test_saving_the_same_price_records_nothing(self):
        self.raise_price("40")
        self.assertFalse(ParentPriceHistory.objects.filter(parent=self.parent).exists())

    def test_a_rename_or_photo_change_records_nothing(self):
        self.client.patch(f"{self.base}/parent-prices/DIYA/", {"image_url": "https://x.example/a.jpg"},
                          format="json")
        self.assertFalse(ParentPriceHistory.objects.filter(parent=self.parent).exists())

    def test_creating_a_parent_records_nothing(self):
        self.client.post(f"{self.base}/parent-prices/", {
            "item_id": "NEW", "item_price": "10", "tax_percent": 0, "packaging_cost": "0"}, format="json")
        self.assertFalse(ParentPriceHistory.objects.filter(parent__item_id="NEW").exists())

    def test_a_parent_getting_its_first_price_has_no_old_price_to_keep(self):
        bare = ParentItemPrice.objects.create(business=self.business, item_id="BARE")
        bare.item_price, bare.tax_percent, bare.packaging_cost, bare.final_price = D("10"), 0, D("0"), D("10")
        bare.save()
        self.assertEqual(list(ParentPriceHistory.objects.filter(parent=bare).values_list("item_price", flat=True)),
                         [D("10")])


class EveryPathIsDatedTests(DatingTestCase):
    def test_the_excel_upload_path_is_dated(self):
        """The workbook import saves through update_or_create."""
        ParentItemPrice.objects.update_or_create(
            business=self.business, item_id="DIYA",
            defaults={"item_price": D("50"), "tax_percent": 5, "packaging_cost": D("2"), "final_price": D("54.50")})
        self.assertEqual(self.cost_on(LAST_MONTH), D("44.00"))
        self.assertEqual(self.cost_on(TODAY), D("54.50"))

    def test_a_master_list_price_rise_is_dated(self):
        katori = MasterItem.objects.create(business=self.business, name="Katori", unit_price=D("20"))
        MasterItemComponent.objects.create(parent=self.parent, master_item=katori, quantity=2)   # 40 again
        katori.unit_price = D("25")
        katori.save()                                            # recipe -> 50
        self.parent.refresh_from_db()
        self.assertEqual(self.parent.item_price, D("50"))
        self.assertEqual(self.cost_on(LAST_MONTH), D("44.00"))
        self.assertEqual(self.cost_on(TODAY), D("54.50"))


class AddPriceEntryTests(DatingTestCase):
    def add_entry(self, when, item_price):
        r = self.client.post(f"{self.base}/parent-prices/DIYA/price-history/", {
            "effective_from": str(when), "item_price": item_price, "tax_percent": 5, "packaging_cost": "2"},
            format="json")
        self.assertEqual(r.status_code, 201, r.data)

    def test_the_first_dated_price_keeps_the_one_it_replaces(self):
        """Used to leave last month's orders costed at the new price."""
        self.add_entry(YESTERDAY, "50")
        self.assertEqual(self.cost_on(LAST_MONTH), D("44.00"))
        self.assertEqual(self.cost_on(YESTERDAY), D("54.50"))

    def test_entering_the_current_price_adds_no_baseline(self):
        self.add_entry(YESTERDAY, "40")
        self.assertEqual(ParentPriceHistory.objects.filter(parent=self.parent).count(), 1)


class LookupFallbackTests(TestCase):
    """The shared rule all four profit calculations now use."""

    entries = [(date(2026, 9, 1), "A"), (date(2026, 10, 1), "B")]

    def test_picks_the_entry_in_effect_on_the_order_date(self):
        self.assertEqual(_history_entry_at(self.entries, date(2026, 9, 15))[1], "A")
        self.assertEqual(_history_entry_at(self.entries, date(2026, 10, 1))[1], "B")
        self.assertEqual(_history_entry_at(self.entries, date(2026, 12, 1))[1], "B")

    def test_an_order_older_than_every_entry_gets_the_earliest_not_the_newest(self):
        self.assertEqual(_history_entry_at(self.entries, date(2026, 1, 1))[1], "A")

    def test_unknown_order_date_or_no_history_defers_to_the_current_price(self):
        self.assertIsNone(_history_entry_at(self.entries, None))
        self.assertIsNone(_history_entry_at([], date(2026, 9, 15)))

    def test_accepts_a_datetime(self):
        from datetime import datetime
        self.assertEqual(_history_entry_at(self.entries, datetime(2026, 9, 15, 13, 0))[1], "A")


class StaleFinalPriceTests(DatingTestCase):
    """A save that changes the parts but not the total must not leave the
    parent's final price disagreeing with its own item, tax and packaging."""

    def test_final_price_follows_its_parts(self):
        self.raise_price("50")                       # sends no final_price
        self.parent.refresh_from_db()
        self.assertEqual(self.parent.final_price, D("54.50"))

    def test_children_get_the_corrected_total(self):
        self.raise_price("50")
        self.assertEqual(FinalPrice.objects.get(sku_id="DIYA-1").final_price, D("54.50"))

    def test_an_explicit_matching_total_is_kept(self):
        r = self.client.patch(f"{self.base}/parent-prices/DIYA/", {
            "item_price": "50", "tax_percent": 5, "packaging_cost": "2", "final_price": "54.50"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.parent.refresh_from_db()
        self.assertEqual(self.parent.final_price, D("54.50"))
