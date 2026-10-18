"""Business Insights — claims losses, payment checks, and the AI write-up.

The AI tests never reach the network: requests.post is replaced, so what is
checked is what we send, what we store, and how failures are reported.
"""

from datetime import date, datetime, timedelta
from decimal import Decimal as D
from unittest import mock

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from . import insights_ai
from .insights_money import claims_analysis, payment_checks, payment_window
from .models import (
    ClaimTicket, FinalPrice, InsightAIReport, Order, OrderPayment, ParentItemPrice, ParentPriceHistory,
)

TODAY = timezone.localdate()
START = TODAY - timedelta(days=29)
WIN = {"date_from": START, "date_to": TODAY, "prev_from": START - timedelta(days=30),
       "prev_to": START - timedelta(days=1)}


class Base(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="o", password="pw", role=User.ROLE_SUPER_ADMIN)
        self.business = Business.objects.create(name="B")
        Membership.objects.create(user=self.user, business=self.business)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.url = f"/api/business/{self.business.id}/insights/"
        # Lota costs 100 + 10% tax; it was 80 + 10% before a price rise 10 days ago.
        self.parent = ParentItemPrice.objects.create(business=self.business, item_id="LOTA", item_price=D("100"),
                                                     tax_percent=10, packaging_cost=D("5"), final_price=D("115"))
        ParentPriceHistory.objects.create(parent=self.parent, business=self.business, effective_from=TODAY - timedelta(days=200),
                                          item_price=D("80"), tax_percent=10, packaging_cost=D("5"), final_price=D("93"))
        ParentPriceHistory.objects.create(parent=self.parent, business=self.business, effective_from=TODAY - timedelta(days=10),
                                          item_price=D("100"), tax_percent=10, packaging_cost=D("5"), final_price=D("115"))
        FinalPrice.objects.create(business=self.business, sku_id="LOTA-1", parent=self.parent)

    def order(self, sub, day, sku="LOTA-1", qty=1):
        Order.objects.create(business=self.business, sub_order_no=sub, sku=sku, order_date=day, quantity=qty)

    def ticket(self, tid, sub, status, issue="Damaged product", amount=None, reopen=None, text=""):
        return ClaimTicket.objects.create(
            business=self.business, ticket_id=tid, suborder_no=sub, ticket_status=status, issue=issue,
            claim_amount=amount, reopen_validity=reopen, last_update=text,
            created_at_meesho=timezone.make_aware(datetime.combine(TODAY, datetime.min.time())))

    def pay(self, sub, day, status="Delivered", settle="200", **kw):
        return OrderPayment.objects.create(business=self.business, sub_order_no=sub, supplier_sku=kw.pop("sku", "LOTA-1"),
                                           live_order_status=status, payment_date=day,
                                           final_settlement_amount=D(settle), **kw)


class ClaimsTests(Base):
    def test_rejected_claim_costs_the_item_at_its_order_date_price(self):
        self.order("OLD", TODAY - timedelta(days=20))      # before the rise: 80 + 10%
        self.order("NEW", TODAY - timedelta(days=2), qty=2)  # after: 2 × (100 + 10%)
        self.ticket("T1", "OLD", ClaimTicket.STATUS_REJECTED, text="Rejected: <b>no video</b> provided")
        self.ticket("T2", "NEW", ClaimTicket.STATUS_REJECTED)
        c = claims_analysis(self.business, WIN)
        losses = {r["ticket_id"]: r["loss"] for r in c["rejected"]}
        self.assertEqual(losses, {"T1": 88.0, "T2": 220.0})
        self.assertEqual(c["period"]["rejected_loss"], 308.0)
        self.assertEqual(c["top_rejection_reasons"][0]["reason"], "Rejected: no video provided")

    def test_approved_and_open_claims_are_not_losses(self):
        for i, st in enumerate((ClaimTicket.STATUS_APPROVED, ClaimTicket.STATUS_REJECTED, ClaimTicket.STATUS_OPEN)):
            self.order(f"S{i}", TODAY - timedelta(days=3))
            self.ticket(f"T{i}", f"S{i}", st, amount=D("90") if st == ClaimTicket.STATUS_APPROVED else None)
        p = claims_analysis(self.business, WIN)["period"]
        self.assertEqual((p["approved"], p["rejected"], p["open"]), (1, 1, 1))
        self.assertEqual(p["rejected_loss"], 110.0)
        self.assertEqual(p["rejection_rate"], 50.0)
        self.assertEqual(p["open_at_risk"], 110.0)
        self.assertEqual(p["open_expected_loss"], 55.0)

    def test_reopenable_rejections_are_listed_soonest_first(self):
        for i, days in enumerate((9, 3, -1)):
            self.order(f"S{i}", TODAY - timedelta(days=5))
            self.ticket(f"T{i}", f"S{i}", ClaimTicket.STATUS_REJECTED, reopen=TODAY + timedelta(days=days))
        c = claims_analysis(self.business, WIN)
        self.assertEqual([r["ticket_id"] for r in c["reopenable"]], ["T1", "T0"])   # T2's window has closed

    def test_no_sheet_uploaded(self):
        self.assertEqual(claims_analysis(self.business, WIN), {"uploaded": False})

    def test_true_profit_kpi_and_highlight(self):
        self.order("S1", TODAY - timedelta(days=3))
        self.ticket("T1", "S1", ClaimTicket.STATUS_REJECTED)
        r = self.client.get(self.url)
        kpi = next(k for k in r.data["kpis"] if k["key"] == "true_profit")
        self.assertEqual(kpi["current"], round(r.data["claims"]["true_profit"]["net_profit"] - 110.0, 2))
        self.assertIn("claims_rejected", [h["kind"] for h in r.data["highlights"]])

    def test_insights_page_may_upload_the_claims_sheet(self):
        from accounts.nav import API_OWNERSHIP
        self.assertIn("/insights", API_OWNERSHIP["claims/"])


class PaymentCheckTests(Base):
    def checks(self):
        pwin = payment_window(self.business, "", "")
        return {c["key"]: c for c in payment_checks(self.business, pwin)["checks"]}

    def test_return_fee_over_200_is_flagged(self):
        self.pay("R1", TODAY, "Return", "-250", return_shipping_charge=D("-250"))
        self.pay("R2", TODAY, "Return", "-150", return_shipping_charge=D("-150"))
        c = self.checks()["high_return_fee"]
        self.assertEqual([r["sub_order_no"] for r in c["rows"]], ["R1"])
        self.assertEqual(c["amount"], 250.0)

    def test_shipping_outlier_is_judged_per_unit(self):
        for i in range(12):
            self.pay(f"H{i}", TODAY - timedelta(days=60), shipping_charge_incl_gst=D("-60"))
        self.pay("BIG", TODAY, shipping_charge_incl_gst=D("-180"))                        # 1 unit at 180: odd
        self.pay("MULTI", TODAY, shipping_charge_incl_gst=D("-180"), quantity=3)          # 3 × 60: fine
        rows = self.checks()["shipping_outlier"]["rows"]
        self.assertEqual([r["sub_order_no"] for r in rows], ["BIG"])

    def test_one_off_deductions_but_not_routine_fees(self):
        OrderPayment.objects.create(business=self.business, sub_order_no="A1", payment_date=TODAY,
                                    final_settlement_amount=D("-2096"), recovery_reason="Return picked up order wrongly shown as Delivered")
        OrderPayment.objects.create(business=self.business, sub_order_no="A2", payment_date=TODAY,
                                    final_settlement_amount=D("-30"), recovery_reason="Affiliate Fee")
        c = self.checks()["unusual_deductions"]
        self.assertEqual([r["sub_order_no"] for r in c["rows"]], ["A1"])
        self.assertEqual(c["amount"], 2096.0)

    def test_duplicates_and_unpaid_deliveries(self):
        for _ in range(2):
            OrderPayment.objects.create(business=self.business, sub_order_no="D1", payment_date=TODAY,
                                        final_settlement_amount=D("-35"), recovery_reason="Affiliate Fee")
        self.pay("Z1", TODAY, settle="0")
        checks = self.checks()
        self.assertEqual(checks["duplicates"]["rows"][0]["sub_order_no"], "D1")
        self.assertEqual([r["sub_order_no"] for r in checks["delivered_no_pay"]["rows"]], ["Z1"])

    def test_sub_order_with_many_rows(self):
        for i in range(4):
            OrderPayment.objects.create(business=self.business, sub_order_no="M1", payment_date=TODAY,
                                        live_order_status=["Shipped", "Return", "Exchange", None][i],
                                        final_settlement_amount=D("10"), recovery_reason="Return Assurance Program Fees" if i == 3 else None)
        self.assertEqual(self.checks()["many_rows"]["rows"][0]["rows"], 4)


def _fake_response(payload, code=200):
    r = mock.Mock(status_code=code)
    r.json.return_value = payload
    r.text = str(payload)
    return r


REPORT = {"verdict": {"status": "watch", "headline": "Profitable, but returns bite.", "summary": "…"},
          "priorities": [], "patterns": [], "payment_findings": [], "claims_view": "…", "growth_ideas": [],
          "watch_next": []}


@override_settings(ANTHROPIC_API_KEY="test-key", ANTHROPIC_MODEL="claude-opus-5-5")
class AITests(Base):
    def setUp(self):
        super().setUp()
        self.order("S1", TODAY - timedelta(days=3))
        self.ai = self.url + "ai/"

    def tool_reply(self):
        return _fake_response({"content": [{"type": "tool_use", "name": "report_insights", "input": REPORT}],
                               "usage": {"input_tokens": 9000, "output_tokens": 1500}})

    @override_settings(ANTHROPIC_API_KEY="")
    def test_without_a_key_it_says_so(self):
        r = self.client.post(self.ai, {}, format="json")
        self.assertFalse(r.data["available"])

    def test_writes_once_then_reuses_the_stored_report(self):
        with mock.patch("meesho_app.insights_ai.requests.post", return_value=self.tool_reply()) as post:
            first = self.client.post(self.ai, {}, format="json")
            second = self.client.post(self.ai, {}, format="json")
            page = self.client.get(self.url)
            got = self.client.get(self.ai, {"hash": page.data["ai"]["hash"]})
        self.assertEqual(first.status_code, 200, first.data)
        self.assertEqual(first.data["report"], REPORT)
        self.assertFalse(first.data["cached"])
        self.assertTrue(second.data["cached"])
        self.assertTrue(got.data["cached"])
        self.assertFalse(got.data["stale"])
        self.assertEqual(post.call_count, 1)
        sent = post.call_args.kwargs["json"]
        self.assertEqual(sent["model"], "claude-opus-5-5")
        self.assertEqual(sent["tool_choice"], {"type": "tool", "name": "report_insights"})
        self.assertEqual(post.call_args.kwargs["headers"]["x-api-key"], "test-key")
        self.assertEqual(InsightAIReport.objects.get().input_tokens, 9000)

    def test_changed_numbers_show_the_old_report_as_stale(self):
        with mock.patch("meesho_app.insights_ai.requests.post", return_value=self.tool_reply()):
            made = self.client.post(self.ai, {}, format="json")
        page = self.client.get(self.url).data
        r = self.client.get(self.ai, {"hash": "different", "date_from": page["period"]["date_from"],
                                      "date_to": page["period"]["date_to"]})
        self.assertTrue(r.data["stale"])
        self.assertEqual(r.data["report"], made.data["report"])

    def test_refresh_writes_a_new_one(self):
        with mock.patch("meesho_app.insights_ai.requests.post", return_value=self.tool_reply()) as post:
            self.client.post(self.ai, {}, format="json")
            self.client.post(self.ai, {"refresh": True}, format="json")
        self.assertEqual(post.call_count, 2)

    def test_get_never_calls_the_model(self):
        with mock.patch("meesho_app.insights_ai.requests.post") as post:
            r = self.client.get(self.ai)
        post.assert_not_called()
        self.assertIsNone(r.data["report"])

    def test_api_errors_are_reported_plainly(self):
        with mock.patch("meesho_app.insights_ai.requests.post",
                        return_value=_fake_response({"error": {"message": "bad key"}}, 401)):
            r = self.client.post(self.ai, {}, format="json")
        self.assertEqual(r.status_code, 502)
        self.assertIn("ANTHROPIC_API_KEY", r.data["error"])
        self.assertFalse(InsightAIReport.objects.exists())

    def test_ask_a_question(self):
        reply = _fake_response({"content": [{"type": "text", "text": "Fix LOTA-1 returns."}]})
        with mock.patch("meesho_app.insights_ai.requests.post", return_value=reply) as post:
            r = self.client.post(self.ai + "ask/", {"question": "Why is profit down?",
                                                    "history": [{"role": "user", "content": "hi"},
                                                                {"role": "assistant", "content": "hello"}]}, format="json")
        self.assertEqual(r.data["answer"], "Fix LOTA-1 returns.")
        msgs = post.call_args.kwargs["json"]["messages"]
        self.assertEqual(msgs[-1], {"role": "user", "content": "Why is profit down?"})
        self.assertIn("Business Insights data", msgs[0]["content"])

    def test_context_carries_no_customer_details(self):
        Order.objects.filter(sub_order_no="S1").update(customer_state="Delhi")
        from .insights import build_insights
        ctx = insights_ai.build_context(build_insights(self.business))
        text = str(ctx)
        self.assertNotIn("customer_state", text)
        self.assertIn("kpis", ctx)
