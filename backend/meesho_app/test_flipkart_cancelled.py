"""
A Flipkart order item that was cancelled is never costed as a sale — whether
the Orders report says CANCELLED, or Flipkart settled exactly nothing for it.
The payments screen, the P&L and the SKU report all agree.
"""

from datetime import date
from decimal import Decimal as D

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from .models import FinalPrice, FlipkartOrder, FlipkartOrderPayment, ParentItemPrice
from .views import _compute_flipkart_profit_summary


class FlipkartCancelledTests(TestCase):
    def setUp(self):
        user = User.objects.create_user(username="o", password="pw", role=User.ROLE_SUPER_ADMIN)
        self.biz = Business.objects.create(name="Rudam")
        Membership.objects.create(user=user, business=self.biz)
        self.c = APIClient()
        self.c.force_authenticate(user)
        parent = ParentItemPrice.objects.create(business=self.biz, item_id="LOTA", item_price=D("100"), tax_percent=0,
                                                packaging_cost=D("0"), final_price=D("100"))
        FinalPrice.objects.create(business=self.biz, sku_id="LOTA-1", parent=parent, item_price=D("100"), final_price=D("100"))
        # Delivered: paid 300.
        self.pay("D1", "300")
        self.order("D1", "DELIVERED")
        # Cancelled on the Orders report, settled at 0 (the user's case).
        self.pay("C1", "0", sale="536")
        self.order("C1", "CANCELLED")
        # No Orders report row, but settled at exactly 0 with no return: cancelled too.
        self.pay("C2", "0", sale="357")
        self.pay("C2", "0", sale="0")
        # Cancelled with a cancellation charge: counts at the charge, no item cost.
        self.pay("C3", "-25", sale="400")
        self.order("C3", "CANCELLED")

    def pay(self, item, value, sale="400", rt="NA"):
        FlipkartOrderPayment.objects.create(business=self.biz, neft_id=f"N-{item}-{value}-{sale}", order_item_id=item, order_id=f"O{item}",
                                            seller_sku="LOTA-1", quantity=1, sale_amount=D(sale), settlement_value=D(value),
                                            return_type=rt, item_return_status="NA", order_date=date(2026, 10, 5))

    def order(self, item, status):
        FlipkartOrder.objects.create(business=self.biz, order_item_id=item, order_id=f"O{item}", order_date=date(2026, 10, 5),
                                     order_item_status=status, sku="LOTA-1")

    def test_the_payments_screen_says_cancelled_with_no_loss(self):
        d = self.c.get(f"/api/business/{self.biz.id}/flipkart-payments/grouped/").data
        by = {g["order_id"]: g for g in d["groups"]}
        self.assertEqual((by["OD1"]["status"], by["OD1"]["net_profit"]), ("DELIVERED", 200.0))        # 300 − cost 100
        self.assertEqual((by["OC1"]["status"], by["OC1"]["net_profit"], by["OC1"]["cost"]), ("CANCELLED", 0.0, 0.0))
        self.assertEqual((by["OC2"]["status"], by["OC2"]["net_profit"]), ("CANCELLED", 0.0))
        self.assertEqual((by["OC3"]["status"], by["OC3"]["net_profit"], by["OC3"]["cost"]), ("CANCELLED", -25.0, 0.0))
        self.assertEqual(by["OC1"]["items"][0]["excluded_reason"], "cancelled")
        self.assertEqual({s["status"]: s["count"] for s in d["kpi"]["by_status"]}, {"DELIVERED": 1, "CANCELLED": 3})
        self.assertEqual(d["kpi"]["total_profit"], 175.0)                                            # 200 − 25

    def test_the_pnl_agrees(self):
        s = _compute_flipkart_profit_summary(self.biz)
        self.assertEqual(s["totals"]["net_profit"], 175.0)
        self.assertEqual(s["totals"]["total_cost"], 100.0)                                            # only the delivered one is costed
        self.assertEqual(s["cancelled_count"], 3)

    def test_the_sku_report_agrees(self):
        d = self.c.get(f"/api/business/{self.biz.id}/flipkart-profit/sku-payments/", {"sku": "LOTA-1"})
        self.assertEqual(d.status_code, 200)
        orders = {o["order_item_id"]: o for o in d.data["orders"]}
        self.assertEqual((orders["C1"]["is_cancelled"], orders["C1"]["excluded_reason"], orders["C1"]["cost"]), (True, "cancelled", 0.0))
        self.assertEqual((orders["D1"]["is_cancelled"], orders["D1"]["net_profit"]), (False, 200.0))
