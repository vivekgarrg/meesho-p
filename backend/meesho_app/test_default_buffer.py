"""Every order that sells carries a ₹6 buffer by default, so losses are covered.

The buffer is a business setting (BusinessCostSetting.default_buffer_per_order,
₹6 unless changed) charged once per order on the outcomes that sell —
delivered, exchange, claim — and never on a return or RTO. A SKU with its own
loss-recovery buffer in SKU Pricing is charged that instead, per unit.
"""

from datetime import date
from decimal import Decimal as D

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from .models import BusinessCostSetting, EstimatedProfitOrder, FinalPrice, FlipkartOrderPayment, Order, OrderPayment, ParentItemPrice


class DefaultBufferTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="o", password="pw", role=User.ROLE_SUPER_ADMIN)
        self.business = Business.objects.create(name="B")
        Membership.objects.create(user=self.user, business=self.business)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.base = f"/api/business/{self.business.id}"
        diya = ParentItemPrice.objects.create(business=self.business, item_id="DIYA", item_price=D("40"),
                                              tax_percent=0, packaging_cost=D("0"), final_price=D("40"))
        lamp = ParentItemPrice.objects.create(business=self.business, item_id="LAMP", item_price=D("40"),
                                              tax_percent=0, packaging_cost=D("0"), final_price=D("40"),
                                              buffer_amount=D("10"))            # its own buffer, per unit
        FinalPrice.objects.create(business=self.business, sku_id="DIYA-1", parent=diya)
        FinalPrice.objects.create(business=self.business, sku_id="LAMP-1", parent=lamp)

    def sale(self, sub, sku, status="Delivered", settle="100", qty=1):
        day = date(2026, 9, 1)
        Order.objects.create(business=self.business, sub_order_no=sub, sku=sku, order_date=day, quantity=qty)
        OrderPayment.objects.create(business=self.business, sub_order_no=sub, supplier_sku=sku, live_order_status=status,
                                    final_settlement_amount=D(settle), order_date=day, payment_date=day, quantity=qty)

    def profit(self):
        return float(self.client.get(f"{self.base}/profit/").data["net_profit_loss"])

    def test_a_delivered_order_carries_six_rupees(self):
        self.sale("P1", "DIYA-1")
        self.assertEqual(self.profit(), 54.0)                       # 100 − 40 − 6

    def test_it_is_per_order_not_per_unit(self):
        self.sale("P2", "DIYA-1", settle="200", qty=2)
        self.assertEqual(self.profit(), 114.0)                      # 200 − 2 × 40 − 6

    def test_returns_and_rto_carry_none(self):
        self.sale("R1", "DIYA-1", status="Return", settle="-50")
        self.sale("R2", "DIYA-1", status="RTO", settle="-20")
        self.assertEqual(self.profit(), -70.0)

    def test_a_sku_with_its_own_buffer_uses_that_instead(self):
        self.sale("L1", "LAMP-1", settle="200", qty=2)
        self.assertEqual(self.profit(), 100.0)                      # 200 − 2 × 40 − 2 × 10

    def test_the_admin_can_change_or_turn_it_off(self):
        r = self.client.get(f"{self.base}/cost-settings/")
        self.assertEqual(r.data["default_buffer_per_order"], 6.0)
        r = self.client.patch(f"{self.base}/cost-settings/", {"default_buffer_per_order": 8.5}, format="json")
        self.assertEqual(r.data["default_buffer_per_order"], 8.5)
        self.sale("P1", "DIYA-1")
        self.assertEqual(self.profit(), 51.5)
        self.client.patch(f"{self.base}/cost-settings/", {"default_buffer_per_order": 0}, format="json")
        self.assertEqual(self.profit(), 60.0)
        r = self.client.patch(f"{self.base}/cost-settings/", {"default_buffer_per_order": -1}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_only_an_admin_can_change_it(self):
        worker = User.objects.create_user(username="w", password="pw", role=User.ROLE_BUSINESS_USER)
        Membership.objects.create(user=worker, business=self.business)
        c = APIClient()
        c.force_authenticate(worker)
        r = c.patch(f"{self.base}/cost-settings/", {"default_buffer_per_order": 0}, format="json")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(BusinessCostSetting.objects.get(business=self.business).default_buffer_per_order, D("6"))

    def test_estimated_and_flipkart_profit_carry_it_too(self):
        EstimatedProfitOrder.objects.create(business=self.business, sub_order_no="E1", sku_id="DIYA-1",
                                            order_status="Delivered", quantity=1, payout_value=D("100"),
                                            order_date=date(2026, 9, 1))
        self.assertEqual(self.client.get(f"{self.base}/estimated-profit/").data["totals"]["net_profit"], 54.0)
        FlipkartOrderPayment.objects.create(business=self.business, neft_id="N1", order_item_id="I1", order_id="O1",
                                            seller_sku="DIYA-1", quantity=1, sale_amount=D("200"),
                                            settlement_value=D("100"), return_type="NA", order_date=date(2026, 9, 1))
        self.assertEqual(self.client.get(f"{self.base}/flipkart-profit/").data["totals"]["net_profit"], 54.0)
