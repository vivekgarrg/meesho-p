"""Returns → Flipkart: who sent each item back, the return rates, worst SKUs, reasons and the list."""

from datetime import date
from decimal import Decimal as D

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from .models import FlipkartOrder, FlipkartOrderPayment


class FlipkartReturnsTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="o", password="pw", role=User.ROLE_SUPER_ADMIN)
        self.biz = Business.objects.create(name="Rudam")
        Membership.objects.create(user=self.user, business=self.biz)
        self.c = APIClient()
        self.c.force_authenticate(self.user)
        self.url = f"/api/business/{self.biz.id}/flipkart-returns/"
        n = 0

        def order(sku, status, delivered=None, dispatched=date(2026, 10, 6), reason="", day=5, **kw):
            nonlocal n
            n += 1
            FlipkartOrder.objects.create(business=self.biz, order_item_id=f"I{n}", order_id=f"O{n}", sku=sku, quantity=1,
                                         order_date=date(2026, 10, day), order_item_status=status, delivery_date=delivered,
                                         dispatched_date=dispatched, return_reason=reason, **kw)
            return f"I{n}"

        for _ in range(4):
            order("LOTA", "DELIVERED", delivered=date(2026, 10, 9))
        # Came back from the customer (delivered first), with a payment that says so.
        cust = order("LOTA", "RETURNED", delivered=date(2026, 10, 9), reason="QUALITY_ISSUE", return_sub_reason="Dented",
                     return_approval_date=date(2026, 10, 15))
        for value, rt in (("300", "NA"), ("-340", "Customer Return")):
            FlipkartOrderPayment.objects.create(business=self.biz, neft_id=f"N{value}", order_item_id=cust, order_id="O",
                                                seller_sku="LOTA", quantity=1, sale_amount=D("400"), settlement_value=D(value),
                                                return_type=rt, item_return_status="NA", order_date=date(2026, 10, 5))
        # Never delivered, no payment yet: the courier brought it back.
        order("LOTA", "RETURN_REQUESTED", reason="Attempts_Exhausted")
        order("DIYA", "RETURNED", reason="QUALITY_ISSUE")
        order("DIYA", "DELIVERED", delivered=date(2026, 10, 9))
        order("DIYA", "CANCELLED", dispatched=None)
        order("DIYA", "RETURNED", delivered=date(2026, 11, 9), day=28)            # placed late in the month, sent back by the customer

    def get(self, **q):
        r = self.c.get(self.url, q)
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        return r.json()

    def test_totals_say_who_sent_it_back(self):
        t = self.get()["totals"]
        self.assertEqual((t["items"], t["delivered"], t["returns"], t["cancelled"]), (10, 5, 4, 1))
        self.assertEqual((t["customer"], t["courier"], t["unknown"]), (2, 2, 0))
        self.assertEqual(t["return_rate"], round(100 * 4 / 9, 1))              # returned ÷ (delivered + returned)
        self.assertEqual(t["customer_rate"], round(100 * 2 / 7, 1))            # customer returns ÷ items that reached a customer (5 kept + 2)
        self.assertEqual(t["returns_net"], -40.0)                              # 300 paid, 340 taken back

    def test_worst_skus_reasons_and_the_list(self):
        d = self.get()
        diya, lota = (next(s for s in d["by_sku"] if s["sku"] == k) for k in ("DIYA", "LOTA"))
        self.assertEqual((diya["returns"], diya["delivered"], diya["return_rate"]), (2, 1, 66.7))
        self.assertEqual((lota["returns"], lota["customer"], lota["courier"]), (2, 1, 1))
        self.assertEqual(d["by_sku"][0]["sku"], "DIYA")                        # worst rate first
        top = d["reasons"][0]
        self.assertEqual((top["reason"], top["count"]), ("QUALITY_ISSUE", 2))
        self.assertEqual(top["subs"], [{"sub": "Dented", "count": 1}])
        self.assertEqual(d["returns"][0]["order_date"], "2026-10-28")           # newest first
        paid = next(r for r in d["returns"] if r["return_date"])
        self.assertEqual((paid["sku"], paid["kind"], paid["net"], paid["sub_reason"]), ("LOTA", "customer", -40.0, "Dented"))
        self.assertIsNone(next(r for r in d["returns"] if r["reason"] == "Attempts_Exhausted")["net"])   # not paid yet

    def test_by_the_period_the_orders_were_placed(self):
        t = self.get(date_from="2026-10-20", date_to="2026-10-31")["totals"]
        self.assertEqual((t["items"], t["returns"], t["customer"]), (1, 1, 1))
