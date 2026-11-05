"""Meesho return analysis: built from the returns Meesho's API gives us."""

from datetime import timedelta
from decimal import Decimal as D

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from .models import FinalPrice, Order, OrderPayment, ParentItemPrice, ReturnDelivery


class AnalysisTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="o", password="pw", role=User.ROLE_SUPER_ADMIN)
        self.biz = Business.objects.create(name="Rudam")
        Membership.objects.create(user=self.user, business=self.biz)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.url = f"/api/business/{self.biz.id}/meesho-orders/return-analysis/"
        self.today = timezone.localdate()
        self.lota = ParentItemPrice.objects.create(business=self.biz, item_id="LOTA", item_price=D("100"), final_price=D("110"))
        self.plate = ParentItemPrice.objects.create(business=self.biz, item_id="PLATE", item_price=D("80"), final_price=D("90"))
        for sku, parent in (("lota-1", self.lota), ("lota-2", self.lota), ("plate-1", self.plate)):
            FinalPrice.objects.create(business=self.biz, sku_id=sku, parent=parent)
        self.n = 0

    def ago(self, days):
        return self.today - timedelta(days=days)

    def ret(self, sku, days_ago, reason="Size too small", typ="Customer Return", sub="FIRST_RET", **kw):
        self.n += 1
        return ReturnDelivery.objects.create(
            business=self.biz, suborder_no=f"S{self.n}_1", awb_number=f"A{self.n}", sku=sku, qty=1,
            return_created_date=self.ago(days_ago), type_of_return=typ, sub_type=sub, return_reason=reason,
            courier_partner=kw.pop("courier", "Valmo"), synced_at=timezone.now(), **kw)

    def order(self, sku, days_ago, n=1):
        for _ in range(n):
            self.n += 1
            Order.objects.create(business=self.biz, sub_order_no=f"O{self.n}_1", sku=sku, order_date=self.ago(days_ago),
                                 reason_for_credit_entry="SHIPPED", quantity=1)

    def get(self, **params):
        r = self.client.get(self.url, params)
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        return r.data

    def test_counts_for_7_and_30_days_and_the_period_before(self):
        for d in (1, 2, 3):
            self.ret("lota-1", d)
        for d in (10, 20):
            self.ret("lota-1", d)
        self.ret("lota-1", 40)                                   # the 30 days before
        d = self.get(days=30)["headline"]
        self.assertEqual((d["d7"]["returns"], d["d30"]["returns"]), (3, 5))
        self.assertEqual(d["d30"]["previous"], 1)
        self.assertEqual(d["d30"]["change"]["abs"], 4)

    def test_flags_split_customer_returns_from_rtos(self):
        self.ret("lota-1", 1)
        self.ret("lota-1", 2, typ="Courier Return (RTO)", sub="forward_RTO", reason="")
        self.ret("plate-1", 3, typ="Courier Return (RTO)", sub="EXCHANGE_RTO", reason="")
        d = self.get()
        flags = {f["flag"]: f["count"] for f in d["by_flag"]}
        self.assertEqual(flags, {"Customer return": 1, "RTO — courier could not deliver": 1, "RTO — exchange parcel": 1})
        self.assertEqual((d["headline"]["picked"]["customer"], d["headline"]["picked"]["rto"]), (1, 2))

    def test_return_rate_by_parent_and_sku_against_the_average(self):
        self.order("lota-1", 5, n=10)
        self.order("lota-2", 5, n=10)
        self.order("plate-1", 5, n=20)
        for _ in range(6):
            self.ret("lota-1", 3)
        self.ret("plate-1", 3)
        self.ret("plate-1", 4)
        d = self.get()
        self.assertEqual(d["headline"]["picked"]["orders"], 40)
        self.assertEqual(d["headline"]["picked"]["rate"], 20.0)           # 8 of 40
        parents = {p["key"]: p for p in d["parents"]}
        self.assertEqual(parents["LOTA"]["returns"], 6)
        self.assertEqual(parents["LOTA"]["orders"], 20)                    # both lota SKUs
        self.assertEqual(parents["LOTA"]["rate"], 30.0)
        self.assertEqual(parents["PLATE"]["rate"], 10.0)
        skus = {s["key"]: s for s in d["skus"]}
        self.assertEqual(skus["lota-1"]["parent"], "LOTA")
        self.assertEqual(skus["lota-1"]["rate"], 60.0)                     # 6 of 10

    def test_which_product_comes_back_for_which_reason(self):
        for _ in range(4):
            self.ret("lota-1", 2, reason="Size too small")
        self.ret("lota-1", 2, reason="Product damaged")
        d = self.get()
        top = {p["key"]: p for p in d["parents"]}["LOTA"]["top_reasons"]
        self.assertEqual([(t["reason"], t["count"]) for t in top], [("Size too small", 4), ("Product damaged", 1)])
        self.assertEqual(d["by_group"][0]["label"], "Size / fit")

    def test_money_deducted_comes_from_the_payments_sheet(self):
        r = self.ret("lota-1", 2)
        OrderPayment.objects.create(business=self.biz, sub_order_no=r.suborder_no, live_order_status="RETURN",
                                    order_date=timezone.now(), payment_date=self.ago(1),
                                    final_settlement_amount=D("-95.50"), total_sale_return_amount=D("-300"),
                                    return_shipping_charge=D("-45"))
        d = self.get()
        self.assertEqual(d["money"]["loss"], 95.5)
        self.assertEqual(d["money"]["refunded"], 300.0)
        self.assertEqual(d["money"]["shipping"], 45.0)
        self.assertEqual({p["key"]: p for p in d["parents"]}["LOTA"]["money"]["loss"], 95.5)

    def test_a_high_return_product_gets_a_pointer_with_the_saving(self):
        self.order("lota-1", 5, n=20)
        self.order("plate-1", 5, n=80)
        for _ in range(10):
            r = self.ret("lota-1", 3)
            OrderPayment.objects.create(business=self.biz, sub_order_no=r.suborder_no, live_order_status="RETURN",
                                        order_date=timezone.now(), payment_date=self.ago(1), final_settlement_amount=D("-100"))
        for _ in range(3):
            self.ret("plate-1", 3)
        d = self.get()
        lota = {p["key"]: p for p in d["parents"]}["LOTA"]
        self.assertEqual(lota["action"]["level"], "high")
        self.assertGreater(lota["excess_loss"], 0)
        first = d["pointers"][0]
        self.assertEqual(first["target"], "LOTA")
        self.assertEqual(first["severity"], "high")
        self.assertGreater(first["amount"], 0)

    def test_open_claims_are_flagged(self):
        self.ret("lota-1", 3, stage=ReturnDelivery.STAGE_DELIVERED, delivered_date=self.ago(5))
        d = self.get()
        self.assertEqual(d["open_claims"]["count"], 1)
        self.assertTrue(any(p["kind"] == "claims" for p in d["pointers"]))

    def test_nothing_returned_is_a_quiet_empty_answer(self):
        d = self.get()
        self.assertEqual(d["headline"]["picked"]["returns"], 0)
        self.assertEqual(d["pointers"], [])

    def test_a_glued_on_variation_still_finds_the_parent(self):
        self.ret("lota-1Free Size", 2, variation="Free Size")
        d = self.get()
        self.assertEqual(d["parents"][0]["key"], "LOTA")
