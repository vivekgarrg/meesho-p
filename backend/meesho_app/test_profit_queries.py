"""SKU Analysis / profit stay a fixed number of queries however many orders there are (no query per order or per payment row)."""

from datetime import date, datetime, timezone as tz

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from .models import FinalPrice, Order, OrderPayment, ParentItemPrice


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


class SkuProfitTests(ProfitQueryCountTests):
    """/profit/sku/ — one SKU's row, as /profit/ gives it, without working out every SKU."""

    def test_profit_and_ads_analysis_dont_query_per_order(self):
        pass                                    # the parent's; not run twice

    def setUp(self):
        super().setUp()
        FinalPrice.objects.create(business=self.biz, sku_id="Diya", final_price=50, item_price=50, packaging_cost=2, tax_percent=0)
        self.orders(6)                          # lota, October
        for i, (month, sku, status, amount) in enumerate(((9, "diya", "Delivered", 90), (10, "diya", "RTO", -20), (11, "DIYA", "Return", -35))):
            sub = f"d{i}"
            when = datetime(2026, month, 5, 10, tzinfo=tz.utc)
            Order.objects.create(business=self.biz, sub_order_no=sub, sku=sku, quantity=1, order_date=when.date())
            OrderPayment.objects.create(business=self.biz, sub_order_no=sub, supplier_sku=sku, quantity=1, order_date=when,
                                        payment_date=date(2026, month, 20), live_order_status=status, final_settlement_amount=amount)
        # Not in the orders table: goes by its own order date (October).
        OrderPayment.objects.create(business=self.biz, sub_order_no="x1", supplier_sku="diya", quantity=1,
                                    order_date=datetime(2026, 10, 9, 10, tzinfo=tz.utc), payment_date=date(2026, 11, 2),
                                    live_order_status="Delivered", final_settlement_amount=95)
        self.base = f"/api/business/{self.biz.id}/profit/"

    def get(self, path, **q):
        r = self.c.get(path, q)
        self.assertEqual(r.status_code, 200, getattr(r, "data", r.content[:300]))
        return r.json()

    def test_the_row_is_profits_own_for_any_range(self):
        for rng in ({}, {"date_from": "2026-10-01", "date_to": "2026-10-31"}, {"date_from": "2026-11-01", "date_to": "2026-11-30"}):
            full = self.get(self.base, **rng)["sku_wise_profit"]
            for sku in ("lota", "Diya"):
                self.assertEqual(self.get(f"{self.base}sku/", sku=sku.lower(), **rng)["row"], full.get(sku, {}), (rng, sku))

    def test_history_in_one_call_matches_profit_month_by_month(self):
        months = self.get(f"{self.base}sku/", sku="diya", months=1)["months"]
        self.assertEqual([m["month"] for m in months], ["2026-09", "2026-10", "2026-11"])
        for m in months:
            y, mo = map(int, m["month"].split("-"))
            last = 30 if mo in (9, 11) else 31
            full = self.get(self.base, date_from=f"{m['month']}-01", date_to=f"{m['month']}-{last}")["sku_wise_profit"]
            self.assertEqual(m["row"], full["Diya"], m["month"])
        self.assertEqual(months[1]["row"]["order_count"], 2)          # the RTO and the order not on file

    def test_a_sku_with_nothing_and_a_missing_param(self):
        self.assertEqual(self.get(f"{self.base}sku/", sku="nope")["row"], {})
        self.assertEqual(self.c.get(f"{self.base}sku/").status_code, 400)

    def put_under_parent(self):
        par = ParentItemPrice.objects.create(business=self.biz, item_id="Puja Set")
        FinalPrice.objects.filter(business=self.biz).update(parent=par)

    def test_a_parent_is_every_sku_under_it_merged(self):
        self.put_under_parent()
        fields = ("net_profit", "order_count", "delivered_count", "return_count", "rto_count", "delivered_profit",
                  "return_loss", "rto_loss", "total_packaging_cost", "settled_amount", "delivered_quantity")
        for rng in ({}, {"date_from": "2026-10-01", "date_to": "2026-10-31"}):
            full = self.get(self.base, **rng)["sku_wise_profit"]
            kids = [full[k] for k in ("lota", "Diya") if k in full]
            got = self.get(f"{self.base}sku/", parent="puja set", **rng)
            self.assertEqual((got["kind"], got["skus"]), ("parent", ["Diya", "lota"]))
            row = got["row"]
            for f in fields:
                self.assertAlmostEqual(float(row[f]), sum(float(k.get(f, 0) or 0) for k in kids), 2, (rng, f))
            self.assertEqual({c["sku_id"] for c in row["children"]}, {"lota", "Diya"})
            self.assertEqual(sum(c["order_count"] for c in row["children"]), row["order_count"])
            # Payments: every order of every SKU under it, each saying which.
            pay = self.get(f"{self.base}sku-orders/", parent="Puja Set", **rng)["orders"]
            self.assertEqual(len(pay), row["order_count"])
            self.assertEqual({o["sku"] for o in pay}, {"lota", "Diya"})

    def test_a_parents_history_is_one_call(self):
        self.put_under_parent()
        months = self.get(f"{self.base}sku/", parent="Puja Set", months=1)["months"]
        self.assertEqual([m["month"] for m in months], ["2026-09", "2026-10", "2026-11"])
        self.assertEqual(months[1]["row"]["order_count"], 6 + 2)             # October: 6 lota, 2 diya

    def test_a_name_with_no_skus_under_it_is_taken_as_a_sku(self):
        r = self.get(f"{self.base}sku/", parent="lota")
        self.assertEqual(r["kind"], "sku")
        self.assertEqual(r["row"]["order_count"], 6)
