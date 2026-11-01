"""
Every payment Meesho makes or takes reaches profit, in the month the ORDER was
placed — whenever it was paid:

  · miscellaneous deductions (recoveries — missing items, insurance,
    short-video commission… — blank-status rows) add to the order's
    settlement without changing how the order is costed;
  · a cancelled order's charges count, with no item cost;
  · a payment whose order isn't in the orders table goes by the order date on
    its own row; an order with several rows goes by its earliest date;
  · split by month, the months add up to the all-time totals exactly.
"""

import calendar
from datetime import date
from decimal import Decimal as D

from django.test import TestCase

from accounts.models import Business

from .models import FinalPrice, Order, OrderPayment, ParentItemPrice
from .views import compute_profit_summary


def setUpModule():
    # Figures here are worked out by hand: no business-wide per-order buffer.
    from .models import BusinessCostSetting
    field = BusinessCostSetting._meta.get_field("default_buffer_per_order")
    field._saved_default, field.default = field.default, 0


def tearDownModule():
    from .models import BusinessCostSetting
    field = BusinessCostSetting._meta.get_field("default_buffer_per_order")
    field.default = field._saved_default


class EveryPaymentCountsTests(TestCase):
    def setUp(self):
        self.biz = Business.objects.create(name="Rudam")
        parent = ParentItemPrice.objects.create(business=self.biz, item_id="DIYA", item_price=D("40"), tax_percent=0,
                                                packaging_cost=D("0"), final_price=D("40"))
        FinalPrice.objects.create(business=self.biz, sku_id="DIYA-1", parent=parent)

    def pay(self, sub, amount, status="Delivered", day=date(2026, 9, 10), paid=date(2026, 10, 2), **kw):
        return OrderPayment.objects.create(business=self.biz, sub_order_no=sub, supplier_sku="DIYA-1", live_order_status=status,
                                           final_settlement_amount=D(amount), order_date=day, payment_date=paid,
                                           transaction_id="AXIS1", quantity=1, **kw)

    def order(self, sub, day, status="DELIVERED"):
        Order.objects.create(business=self.biz, sub_order_no=sub, sku="DIYA-1", order_date=day, reason_for_credit_entry=status)

    def profit(self, f="", t=""):
        d = compute_profit_summary(self.biz, f, t)
        return float(d["total_settled"]), float(d["total_purchase_cost"]), float(d["net_profit_loss"])

    def test_a_miscellaneous_deduction_counts_and_the_order_keeps_its_cost(self):
        self.order("1_1", date(2026, 9, 10))
        self.pay("1_1", "200")                                                  # delivered: paid 200
        self.pay("1_1", "-30", status=None, recovery=D("-30"), recovery_reason="Missing items in the order shipped to customer")
        # Settled 200 − 30 = 170, the item still cost 40 — the deduction no longer zeroes the order.
        self.assertEqual(self.profit(), (170.0, 40.0, 130.0))
        sku = compute_profit_summary(self.biz)["sku_wise_profit"]
        self.assertNotIn("__unattributed__", sku)

    def test_affiliate_and_return_assurance_fees_and_claims_all_count(self):
        self.order("1_1", date(2026, 9, 10))
        self.pay("1_1", "200")
        self.pay("1_1", "-24", status=None, recovery=D("-24"), recovery_reason="Affiliate Fee")
        self.pay("1_1", "-3", status=None, recovery=D("-3"), recovery_reason="Return Assurance Program Fees")
        self.pay("1_1", "-169", status=None, recovery=D("-169"),
                 recovery_reason="Insurance premium deduction to protect your Meesho Instant Cash loan")
        self.assertEqual(self.profit()[0], 4.0)                                  # 200 − 24 − 3 − 169

    def test_a_cancelled_orders_charges_count_with_no_item_cost(self):
        self.order("2_1", date(2026, 9, 12), status="CANCELLED")
        self.pay("2_1", "-15", status="Cancelled")
        self.assertEqual(self.profit(), (-15.0, 0.0, -15.0))

    def test_payments_go_to_the_month_the_order_was_placed(self):
        self.order("1_1", date(2026, 9, 10))
        self.pay("1_1", "200", paid=date(2026, 10, 5))                          # placed in September, paid in October
        self.pay("3_1", "150", day=date(2026, 9, 20), paid=date(2026, 10, 6))   # not in the orders table: its own order date
        self.assertEqual(self.profit("2026-09-01", "2026-09-30")[0], 350.0)
        self.assertEqual(self.profit("2026-10-01", "2026-10-31")[0], 0.0)

    def test_an_order_with_several_rows_counts_once_in_the_month_it_was_placed(self):
        self.order("4_1", date(2026, 8, 30))
        self.order("4_1", date(2026, 9, 3), status="DOOR_STEP_EXCHANGED")      # a later row, a later date
        self.pay("4_1", "200", day=date(2026, 8, 30))
        self.assertEqual(self.profit("2026-08-01", "2026-08-31")[0], 200.0)
        self.assertEqual(self.profit("2026-09-01", "2026-09-30")[0], 0.0)

    def test_the_months_add_up_to_all_time(self):
        self.order("1_1", date(2026, 8, 30))
        self.order("1_1", date(2026, 9, 3), status="DOOR_STEP_EXCHANGED")
        self.pay("1_1", "200", day=date(2026, 8, 30))
        self.pay("1_1", "-30", status=None, recovery=D("-30"), recovery_reason="Missing items", day=date(2026, 8, 30))
        self.pay("2_1", "90", day=date(2026, 9, 25), paid=date(2026, 10, 9))
        self.pay("3_1", "-12", status="Cancelled", day=date(2026, 10, 1))
        p = OrderPayment.objects.create(business=self.biz, sub_order_no="5_1", supplier_sku="DIYA-1", live_order_status="Delivered",
                                        final_settlement_amount=D("70"), payment_date=date(2026, 10, 20), quantity=1)
        self.assertIsNone(p.order_date)                                          # no order date anywhere: when it was paid
        rev = cost = 0.0
        for m in (8, 9, 10, 11):
            r, c, _ = self.profit(f"2026-{m:02d}-01", f"2026-{m:02d}-{calendar.monthrange(2026, m)[1]}")
            rev, cost = rev + r, cost + c
        all_rev, all_cost, _ = self.profit()
        self.assertEqual((round(rev, 2), round(cost, 2)), (all_rev, all_cost))
        self.assertEqual(all_rev, 318.0)                                         # 200 − 30 + 90 − 12 + 70
