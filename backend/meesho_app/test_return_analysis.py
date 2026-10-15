"""Return Analysis is customer returns only: RTO is excluded from counts and
from the return-rate denominator."""

from decimal import Decimal as D

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from .models import OrderPayment


class ReturnAnalysisTestCase(TestCase):
    def setUp(self):
        user = User.objects.create_user(username="o", password="pw", role=User.ROLE_SUPER_ADMIN)
        self.business = Business.objects.create(name="B")
        Membership.objects.create(user=user, business=self.business)
        self.client = APIClient()
        self.client.force_authenticate(user)
        when = timezone.make_aware(timezone.datetime(2026, 9, 10))

        def pay(so, status, sku="A-1", amt="100", **kw):
            OrderPayment.objects.create(business=self.business, sub_order_no=so, supplier_sku=sku,
                                        live_order_status=status, final_settlement_amount=D(amt),
                                        order_date=when, quantity=1, **kw)
        for i in range(8):
            pay(f"D{i}", "Delivered")
        pay("R1", "Return", amt="-60", recovery_reason="Size too small")
        pay("R2", "Return", amt="-60", recovery_reason="Defective product")
        pay("T1", "RTO", amt="-40")
        pay("T2", "RTO_COMPLETE", amt="-40")

    def get(self):
        return self.client.get(f"/api/business/{self.business.id}/returns/analysis/").data

    def test_rto_excluded_from_counts_and_rate(self):
        d = self.get()
        s = d["summary"]
        self.assertEqual(s["total_returns"], 2)
        self.assertEqual(s["total_orders"], 10)          # 8 delivered + 2 returned; RTO not counted
        self.assertEqual(s["return_rate"], 20.0)
        self.assertNotIn("rto_returns", s)
        self.assertNotIn("type_breakdown", d)

    def test_parent_and_sku_rows_and_reason_groups(self):
        d = self.get()
        self.assertEqual(d["parents"][0]["returns"], 2)
        self.assertEqual(d["skus"][0]["sku"], "A-1")
        groups = {g["group"] for g in d["reason_groups"]}
        self.assertEqual(groups, {"size_fit", "quality"})
        self.assertIn("verdict", d["parents"][0]["action"])
