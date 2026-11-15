"""SKU Analysis / profit stay a fixed number of queries however many orders there are (no query per order or per payment row)."""

from datetime import date, datetime, timezone as tz

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from .models import FinalPrice, Order, OrderPayment


class ProfitQueryCountTests(TestCase):
    def setUp(self):
        self.biz = Business.objects.create(name="B")
        self.user = User.objects.create_user(username="o", password="pw", role=User.ROLE_SUPER_ADMIN)
        Membership.objects.create(user=self.user, business=self.biz)
        FinalPrice.objects.create(business=self.biz, sku_id="lota", final_price=100, item_price=100, packaging_cost=5, tax_percent=5)
        self.c = APIClient()
        self.c.force_authenticate(self.user)
        self.n = 0

    def orders(self, k):
        for _ in range(k):
            self.n += 1
            sub = f"{self.n}_1"
            when = datetime(2026, 10, 1 + self.n % 28, 10, tzinfo=tz.utc)
            Order.objects.create(business=self.biz, sub_order_no=sub, sku="lota", quantity=1, order_date=when.date(),
                                 reason_for_credit_entry="DELIVERED")
            for status, amount in (("Delivered", 180), ("", -4)):
                OrderPayment.objects.create(business=self.biz, sub_order_no=sub, supplier_sku="lota", quantity=1, order_date=when,
                                            payment_date=date(2026, 10, 28), live_order_status=status, final_settlement_amount=amount,
                                            total_sale_amount=199, product_gst_percent=5,
                                            order_source="Ad order" if self.n % 2 else "")

    def queries(self, path):
        with CaptureQueriesContext(connection) as q:
            r = self.c.get(path, HTTP_CACHE_CONTROL="no-cache")
        self.assertEqual(r.status_code, 200, getattr(r, "data", r.content[:300]))
        return len(q), r

    def test_profit_and_ads_analysis_dont_query_per_order(self):
        base = f"/api/business/{self.biz.id}"
        for path in (f"{base}/profit/", f"{base}/profit/?date_from=2026-10-01&date_to=2026-10-31", f"{base}/ads/sku-analysis/"):
            self.orders(5)
            few, _ = self.queries(path)
            self.orders(25)
            many, r = self.queries(path)
            self.assertLessEqual(many, few + 2, f"{path}: {few} queries for {self.n - 25} orders, {many} for {self.n}")
