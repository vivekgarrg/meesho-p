"""An item with no unit price (missing, or ₹0) is left out of every profit figure.

Costed at ₹0, such an order's whole payout would read as profit. So the
settled profit, its SKU drill-down, Daily Profit, Estimated Profit and
Flipkart Profit all skip it — payout, returns and cost alike — and report it
as skipped instead. The price checked is the one on the ORDER's date.
"""

from datetime import date
from decimal import Decimal as D

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from .models import (
    EstimatedProfitOrder, FinalPrice, FlipkartOrderPayment, Order, OrderPayment, ParentItemPrice, ParentPriceHistory,
)
from .views import _has_unit_price


# These tests work their profit figures out by hand around other rules, so they
# run without the business-wide ₹6 per-order buffer (see test_default_buffer.py).
def setUpModule():
    from .models import BusinessCostSetting
    field = BusinessCostSetting._meta.get_field("default_buffer_per_order")
    field._saved_default, field.default = field.default, 0


def tearDownModule():
    from .models import BusinessCostSetting
    field = BusinessCostSetting._meta.get_field("default_buffer_per_order")
    field.default = field._saved_default


class HelperTests(TestCase):
    def test_only_a_positive_price_counts(self):
        self.assertTrue(_has_unit_price(D("0.01")))
        self.assertTrue(_has_unit_price(40))
        for v in (None, 0, D("0"), D("0.00"), "", -5, "abc"):
            self.assertFalse(_has_unit_price(v), v)


class ZeroPriceTestCase(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="o", password="pw", role=User.ROLE_SUPER_ADMIN)
        self.business = Business.objects.create(name="B")
        Membership.objects.create(user=self.user, business=self.business)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.base = f"/api/business/{self.business.id}"
        # Priced: 40 + 0% tax, no packaging.  Free: on file, but ₹0.
        priced = ParentItemPrice.objects.create(business=self.business, item_id="DIYA", item_price=D("40"),
                                                tax_percent=0, packaging_cost=D("0"), final_price=D("40"))
        free = ParentItemPrice.objects.create(business=self.business, item_id="FREEBIE", item_price=D("0"),
                                              tax_percent=0, packaging_cost=D("0"), final_price=D("0"))
        FinalPrice.objects.create(business=self.business, sku_id="DIYA-1", parent=priced)
        FinalPrice.objects.create(business=self.business, sku_id="FREE-1", parent=free)

    def sale(self, sub, sku, day, status="Delivered", settle="100"):
        Order.objects.create(business=self.business, sub_order_no=sub, sku=sku, order_date=day)
        OrderPayment.objects.create(business=self.business, sub_order_no=sub, supplier_sku=sku, live_order_status=status,
                                    final_settlement_amount=D(settle), order_date=day, payment_date=day)


class SettledProfitTests(ZeroPriceTestCase):
    def setUp(self):
        super().setUp()
        self.sale("P1", "DIYA-1", date(2026, 9, 1))                       # 100 − 40 = 60
        self.sale("Z1", "FREE-1", date(2026, 9, 2), settle="150")        # ₹0 item: skipped
        self.sale("Z2", "FREE-1", date(2026, 9, 3), "Return", "-80")     # its return: skipped too
        self.sale("U1", "NO-PRICE", date(2026, 9, 4), settle="90")       # not on file: skipped

    def test_profit_counts_only_priced_items(self):
        r = self.client.get(f"{self.base}/profit/").data
        self.assertEqual(float(r["net_profit_loss"]), 60.0)
        self.assertEqual(r["orders_with_price"], 1)
        self.assertEqual(r["orders_missing_price"], 3)
        self.assertNotIn("FREE-1", r["sku_wise_profit"])
        self.assertNotIn("__unattributed__", r["sku_wise_profit"])
        ex = r["excluded_no_unit_price"]
        self.assertEqual(ex["orders"], 3)
        self.assertEqual(ex["settlement"], 160.0)          # 150 − 80 + 90
        self.assertEqual(ex["zero_price_skus"], ["FREE-1"])
        self.assertIn("FREE-1", r["missing_sku"])

    def test_sku_drill_down_skips_them(self):
        r = self.client.get(f"{self.base}/profit/sku-orders/", {"sku": "FREE-1"})
        self.assertEqual(r.data["count"], 0)

    def test_daily_profit_skips_them(self):
        r = self.client.get(f"{self.base}/profit/daily/", {"date_from": "2026-09-01", "date_to": "2026-09-05"}).data
        self.assertEqual(r["totals"]["missing_price_count"], 3)
        self.assertEqual(float(r["totals"]["net_profit"]), 60.0)


class PriceOnOrderDateTests(ZeroPriceTestCase):
    def test_an_item_priced_later_is_still_skipped_for_earlier_orders(self):
        parent = ParentItemPrice.objects.get(item_id="FREEBIE")
        ParentPriceHistory.objects.create(parent=parent, business=self.business, effective_from=date(2026, 1, 1),
                                          item_price=D("0"), tax_percent=0, packaging_cost=D("0"), final_price=D("0"))
        ParentPriceHistory.objects.create(parent=parent, business=self.business, effective_from=date(2026, 9, 10),
                                          item_price=D("30"), tax_percent=0, packaging_cost=D("0"), final_price=D("30"))
        self.sale("EARLY", "FREE-1", date(2026, 9, 5))
        self.sale("LATE", "FREE-1", date(2026, 9, 15))
        r = self.client.get(f"{self.base}/profit/").data
        self.assertEqual(float(r["net_profit_loss"]), 70.0)     # only LATE: 100 − 30
        self.assertEqual(r["orders_missing_price"], 1)


class EstimatedAndFlipkartTests(ZeroPriceTestCase):
    def test_estimated_profit_skips_zero_priced_items_and_their_returns(self):
        for sub, sku, st, pay in (("E1", "DIYA-1", "Delivered", "100"), ("E2", "FREE-1", "Delivered", "150"),
                                  ("E3", "FREE-1", "Returned", "-60")):
            EstimatedProfitOrder.objects.create(business=self.business, sub_order_no=sub, sku_id=sku, order_status=st,
                                                quantity=1, payout_value=D(pay), order_date=date(2026, 9, 1))
        r = self.client.get(f"{self.base}/estimated-profit/").data
        self.assertEqual(r["totals"]["net_profit"], 60.0)
        self.assertEqual(r["missing_price_count"], 2)
        self.assertEqual(r["missing_price_skus"], ["FREE-1"])

    def test_flipkart_profit_skips_zero_priced_items(self):
        for i, (sku, settle, ret) in enumerate((("DIYA-1", "100", "NA"), ("FREE-1", "150", "NA"), ("FREE-1", "-60", "customer_return"))):
            FlipkartOrderPayment.objects.create(business=self.business, neft_id=f"N{i}", order_item_id=f"I{i}",
                                                order_id=f"O{i}", seller_sku=sku, quantity=1, sale_amount=D("200"),
                                                settlement_value=D(settle), return_type=ret, order_date=date(2026, 9, 1))
        r = self.client.get(f"{self.base}/flipkart-profit/").data
        self.assertEqual(r["missing_price_count"], 2)
        self.assertEqual(r["totals"]["net_profit"], 60.0)
        rows = self.client.get(f"{self.base}/flipkart-profit/sku-payments/", {"sku": "FREE-1"}).data
        reasons = {o.get("excluded_reason") for o in rows.get("orders", [])}
        self.assertEqual(reasons, {"missing_price"})
