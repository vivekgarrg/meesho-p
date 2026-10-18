"""Business Insights: the statistics flag real problems and leave noise alone.

The profit engine itself is covered elsewhere; here compute_profit_summary is
replaced by a canned per-SKU table so each test controls exactly what the two
periods look like. Orders (for demand changes, unusual days and states) are
real rows.
"""

from datetime import date, timedelta
from decimal import Decimal as D
from unittest import mock

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from . import insights
from .models import FinalPrice, Order, OrderPayment, ParentItemPrice

END = date(2026, 9, 30)
START = END - timedelta(days=29)          # current period: 1–30 Sep
PREV_END = START - timedelta(days=1)       # previous period: 2–31 Aug


def sku_row(delivered=0, returns=0, rto=0, claims=0, net=0.0, delivered_profit=None,
            return_loss=0.0, rto_loss=0.0, claim_loss=0.0, parent=None):
    return {
        "order_count": delivered + returns + rto + claims, "delivered_count": delivered,
        "return_count": returns, "rto_count": rto, "exchange_count": 0, "claim_count": claims,
        "net_profit": net, "delivered_profit": delivered_profit if delivered_profit is not None else net,
        "return_loss": return_loss, "rto_loss": rto_loss, "claim_loss": claim_loss,
        "claim_total_settlement": 0, "parent_item_id": parent,
    }


def summary(rows):
    return {"order_count": sum(r["order_count"] for r in rows.values()),
            "net_profit_loss": sum(r["net_profit"] for r in rows.values()),
            "sku_wise_profit": rows}


class StatsHelperTests(TestCase):
    def test_wilson_lower_is_cautious_with_small_samples(self):
        # 2 of 3 and 200 of 300 are both 67%, but only the second is sure.
        self.assertLess(insights.wilson_lower(2, 3), 0.3)
        self.assertGreater(insights.wilson_lower(200, 300), 0.6)

    def test_count_change(self):
        self.assertLessEqual(insights.count_change_z(30, 60), -3)   # real drop
        self.assertGreater(insights.count_change_z(2, 4), -3)      # noise

    def test_robust_z_ignores_one_big_day_in_history(self):
        history = [100] * 20 + [1000]
        z, median = insights.robust_z(20, history)
        self.assertEqual(median, 100)
        self.assertLess(z, -3.5)


class InsightsTestCase(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="o", password="pw", role=User.ROLE_SUPER_ADMIN)
        self.business = Business.objects.create(name="B")
        Membership.objects.create(user=self.user, business=self.business)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.url = f"/api/business/{self.business.id}/insights/"
        self.cur, self.prev = {}, {}
        self._n = 0

    def orders(self, sku, n, start, days=30, state="Delhi", status=None, priced=True):
        """n orders for `sku`, spread evenly over `days` days from `start`.
        The SKU gets a unit price unless `priced=False` — unpriced items are
        left out of insights, like they are out of profit."""
        if priced and not FinalPrice.objects.filter(business=self.business, sku_id=sku).exists():
            FinalPrice.objects.create(business=self.business, sku_id=sku, item_price=D("10"), final_price=D("10"))
        for i in range(n):
            self._n += 1
            sub = f"S{self._n}"
            Order.objects.create(business=self.business, sub_order_no=sub, sku=sku, product_name=f"{sku} name",
                                 order_date=start + timedelta(days=i % days), customer_state=state)
            if status:
                OrderPayment.objects.create(business=self.business, sub_order_no=sub, live_order_status=status)

    def run_insights(self, date_from=START, date_to=END):
        def fake(business, d_from, d_to, request=None):
            return summary(self.cur if d_from == date_from.isoformat() else self.prev)
        with mock.patch("meesho_app.views.compute_profit_summary", side_effect=fake):
            return insights.build_insights(self.business, date_from.isoformat(), date_to.isoformat())

    def kinds(self, result):
        return [(h["kind"], h["sku"]) for h in result["highlights"]]


class RateOutlierTests(InsightsTestCase):
    def setUp(self):
        super().setUp()
        self.orders("FILLER", 1, END)
        # Ten ordinary SKUs at ~10% returns, one at 40% on a solid sample, and
        # one at 67% on a tiny sample.
        for i in range(10):
            self.cur[f"OK-{i}"] = sku_row(delivered=90, returns=10, net=3000)
        self.cur["BAD"] = sku_row(delivered=60, returns=40, net=500, return_loss=-4000)
        self.cur["TINY"] = sku_row(delivered=1, returns=2, net=10)

    def test_a_credibly_high_return_sku_is_flagged(self):
        r = self.run_insights()
        self.assertEqual([x["sku"] for x in r["high_returns"]], ["BAD"])
        self.assertIn(("high_returns", "BAD"), self.kinds(r))
        bad = r["high_returns"][0]
        self.assertEqual(bad["rate"], 40.0)
        self.assertGreater(bad["money_at_stake"], 0)

    def test_a_tiny_sample_is_not_flagged(self):
        r = self.run_insights()
        self.assertNotIn("TINY", [x["sku"] for x in r["high_returns"]])

    def test_top_performers_are_ranked_by_profit(self):
        r = self.run_insights()
        self.assertEqual(r["top_performers"][0]["net_profit"], 3000)
        self.assertNotIn("BAD", [x["sku"] for x in r["top_performers"][:10] if x["net_profit"] > 500])


class LossMakerTests(InsightsTestCase):
    def test_selling_below_cost_is_called_out_as_the_cause(self):
        self.orders("FILLER", 1, END)
        self.cur["CHEAP"] = sku_row(delivered=20, returns=2, net=-900, delivered_profit=-700, return_loss=-200)
        self.cur["RETURNY"] = sku_row(delivered=10, returns=10, net=-300, delivered_profit=500, return_loss=-800)
        r = self.run_insights()
        causes = {x["sku"]: x["main_cause"] for x in r["loss_makers"]}
        self.assertEqual(causes, {"CHEAP": "price below cost", "RETURNY": "customer returns"})
        self.assertEqual(r["loss_makers"][0]["sku"], "CHEAP")


class DemandMoverTests(InsightsTestCase):
    def test_a_real_drop_and_a_real_rise_are_found_but_noise_is_not(self):
        self.orders("DROP", 60, PREV_END - timedelta(days=29))
        self.orders("DROP", 10, START)
        self.orders("UP", 5, PREV_END - timedelta(days=29))
        self.orders("UP", 50, START)
        self.orders("NOISE", 12, PREV_END - timedelta(days=29))
        self.orders("NOISE", 9, START)
        r = self.run_insights()
        self.assertEqual([x["sku"] for x in r["falling"]], ["DROP"])
        self.assertEqual([x["sku"] for x in r["rising"]], ["UP"])

    def test_a_relisted_sku_under_the_same_parent_is_not_a_collapse(self):
        parent = ParentItemPrice.objects.create(business=self.business, item_id="LOTA", item_price=D("50"),
                                                tax_percent=0, packaging_cost=D("0"), final_price=D("50"))
        FinalPrice.objects.create(business=self.business, sku_id="LOTA-OLD", parent=parent)
        FinalPrice.objects.create(business=self.business, sku_id="LOTA-NEW", parent=parent)
        self.orders("LOTA-OLD", 50, PREV_END - timedelta(days=29))
        self.orders("LOTA-NEW", 48, START)
        r = self.run_insights()
        self.assertEqual(r["falling"], [])
        self.assertEqual(r["rising"], [])


class UnpricedItemTests(InsightsTestCase):
    def test_orders_of_an_unpriced_or_zero_priced_item_are_left_out(self):
        self.orders("A", 30, START)
        self.orders("NOPRICE", 50, START, priced=False)
        FinalPrice.objects.create(business=self.business, sku_id="FREE", item_price=D("0"), final_price=D("0"))
        self.orders("FREE", 40, START)                       # on file, but ₹0
        self.orders("FREE", 5, PREV_END - timedelta(days=29))
        r = self.run_insights()
        orders = next(k for k in r["kpis"] if k["key"] == "orders")
        self.assertEqual(orders["current"], 30)
        self.assertNotIn("FREE", [x["sku"] for x in r["rising"]])
        self.assertNotIn("NOPRICE", [x["sku"] for x in r["rising"]])
        self.assertEqual(sum(d["orders"] for d in r["daily"]), 30)


class WindowTests(InsightsTestCase):
    def test_period_is_clipped_to_the_last_day_with_orders(self):
        self.orders("A", 30, START)
        r = self.run_insights(date_to=END + timedelta(days=10))
        self.assertEqual(r["period"]["date_to"], END.isoformat())
        self.assertTrue(r["period"]["clipped"])

    def test_orders_kpi_counts_the_orders_sheet(self):
        self.orders("A", 30, START)
        self.orders("A", 20, PREV_END - timedelta(days=29))
        r = self.run_insights()
        orders = next(k for k in r["kpis"] if k["key"] == "orders")
        self.assertEqual((orders["current"], orders["previous"]), (30, 20))
        self.assertEqual(r["period"]["prev_from"], (PREV_END - timedelta(days=29)).isoformat())


class DailyAnomalyTests(InsightsTestCase):
    def test_a_dead_day_is_flagged(self):
        for d in range(58):
            day = START - timedelta(days=28) + timedelta(days=d)
            if day != END - timedelta(days=3):
                self.orders("A", 20, day, days=1)
        r = self.run_insights()
        flagged = [d["date"] for d in r["daily"] if d["anomaly"]]
        self.assertEqual(flagged, [(END - timedelta(days=3)).isoformat()])


class StateTests(InsightsTestCase):
    def test_a_state_with_far_more_rto_is_flagged(self):
        self.orders("A", 100, START, state="Delhi", status="Delivered")
        self.orders("A", 5, START, state="Delhi", status="RTO")
        self.orders("A", 25, START, state="Assam", status="Delivered")
        self.orders("A", 15, START, state="Assam", status="RTO")
        r = self.run_insights()
        flags = {s["state"]: s["flag"] for s in r["states"]}
        self.assertEqual(flags, {"Delhi": False, "Assam": True})


class EndpointTests(InsightsTestCase):
    def test_no_orders_gives_a_friendly_empty_state(self):
        r = self.client.get(self.url)
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data["empty"])

    def test_runs_end_to_end_through_the_real_profit_engine(self):
        self.orders("A", 30, START)
        r = self.client.get(self.url, {"date_from": START.isoformat(), "date_to": END.isoformat()})
        self.assertEqual(r.status_code, 200, r.data)
        self.assertFalse(r.data["empty"])
        self.assertEqual(len(r.data["daily"]), 30)

    def test_other_businesses_are_refused(self):
        other = Business.objects.create(name="Other")
        stranger = User.objects.create_user(username="s", password="pw")
        Membership.objects.create(user=stranger, business=other)
        c = APIClient()
        c.force_authenticate(stranger)
        self.assertIn(c.get(self.url).status_code, (403, 404))
