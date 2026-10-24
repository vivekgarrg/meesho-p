"""Flipkart Overview carries the same orders + payments chart data as Meesho's."""

from datetime import date
from decimal import Decimal as D

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from .models import FlipkartOrder, FlipkartOrderPayment


class FlipkartOverviewChartTests(TestCase):
    def setUp(self):
        user = User.objects.create_user(username="o", password="pw", role=User.ROLE_SUPER_ADMIN)
        self.business = Business.objects.create(name="B")
        Membership.objects.create(user=user, business=self.business)
        self.client = APIClient()
        self.client.force_authenticate(user)
        for i, (status, day) in enumerate((("DELIVERED", 1), ("DELIVERED", 1), ("RETURNED", 2), ("CANCELLED", 2))):
            FlipkartOrder.objects.create(business=self.business, order_item_id=f"I{i}", order_id=f"O{i}",
                                         order_date=date(2026, 10, day), order_item_status=status)

        def pay(n, item, rt, value, paid):
            FlipkartOrderPayment.objects.create(business=self.business, neft_id=f"N{n}", order_item_id=item, order_id=item,
                                                seller_sku="BOWL", quantity=1, sale_amount=D("400"),
                                                settlement_value=D(value), return_type=rt,
                                                order_date=date(2026, 10, 1), payment_date=paid)
        pay(1, "I0", "NA", "350", date(2026, 10, 8))
        pay(2, "I1", "", "340", date(2026, 10, 8))
        pay(3, "I2", "NA", "330", date(2026, 10, 9))
        pay(4, "I2", "customer_return", "-360", date(2026, 10, 15))   # same item, returned later
        pay(5, "I5", "courier_return", "-40", None)

    def test_payments_and_orders_chart_data(self):
        r = self.client.get(f"/api/business/{self.business.id}/flipkart-overview/").data
        p = r["payments"]
        self.assertEqual([(d["payment_date"], d["count"]) for d in p["daily"]],
                         [("2026-10-08", 2), ("2026-10-09", 1), ("2026-10-15", 1)])
        self.assertEqual({s["status"]: s["count"] for s in p["by_status"]}, {"Delivered": 2, "Return": 1, "RTO": 1})
        self.assertEqual(next(s for s in p["by_status"] if s["status"] == "Return")["total_settlement"], -30.0)
        self.assertEqual(sorted((d["order_date"], d["count"]) for d in r["orders"]["daily"]),
                         [("2026-10-01", 2), ("2026-10-02", 2)])
        self.assertTrue(r["orders"]["by_status"])

    def test_period_filter_applies(self):
        r = self.client.get(f"/api/business/{self.business.id}/flipkart-overview/",
                            {"date_from": "2026-11-01", "date_to": "2026-11-30"}).data
        self.assertEqual(r["payments"]["daily"], [])
        self.assertEqual(r["payments"]["by_status"], [])
