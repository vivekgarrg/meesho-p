"""Uploads are listed by when they were made, and an admin can remove one."""

from datetime import date, timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from .models import AdsCost, FlipkartOrder, Order, OrderPayment


class CleanupTests(TestCase):
    def setUp(self):
        self.biz = Business.objects.create(name="Rudam")
        self.other = Business.objects.create(name="Other")
        self.admin = User.objects.create_user(username="a", password="pw", role=User.ROLE_SUPER_ADMIN)
        self.worker = User.objects.create_user(username="w", password="pw", role=User.ROLE_BUSINESS_USER)
        for u in (self.admin, self.worker):
            Membership.objects.create(user=u, business=self.biz)
        self.base = f"/api/business/{self.biz.id}/upload-cleanup"
        now = timezone.now()
        self.first, self.second = now - timedelta(hours=5), now - timedelta(minutes=30)
        # Two payment-file uploads, hours apart; the second spread over 2 minutes.
        for i in range(3):
            self.pay(f"A{i}", self.first, date(2026, 10, 1))
        for i in range(4):
            self.pay(f"B{i}", self.second + timedelta(minutes=i * 0.5), date(2026, 10, 20))
        ads = AdsCost.objects.create(business=self.biz)
        AdsCost.objects.filter(pk=ads.pk).update(uploaded_at=self.second + timedelta(seconds=10))
        o = Order.objects.create(business=self.biz, sub_order_no="O1", order_date=date(2026, 10, 18))
        Order.objects.filter(pk=o.pk).update(created_at=self.second)
        # Another business's rows at the same time are never touched.
        self.pay("X1", self.second, date(2026, 10, 20), business=self.other)

    def pay(self, sub, at, day, business=None):
        r = OrderPayment.objects.create(business=business or self.biz, sub_order_no=sub, payment_date=day)
        OrderPayment.objects.filter(pk=r.pk).update(uploaded_at=at)

    def client_for(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c

    def test_uploads_are_grouped_by_time(self):
        d = self.client_for(self.admin).get(self.base + "/").data
        self.assertTrue(d["can_delete"])
        pays = [u for u in d["uploads"] if u["dataset"] == "meesho_payments"]
        self.assertEqual([u["rows"] for u in pays], [5, 3])          # newest first; 4 payments + 1 ads
        self.assertEqual({c["label"]: c["rows"] for c in pays[0]["counts"]}, {"Order payments": 4, "Ads cost": 1})
        self.assertEqual(pays[0]["dates"], {"from": "2026-10-20", "to": "2026-10-20"})
        orders = [u for u in d["uploads"] if u["dataset"] == "meesho_orders"]
        self.assertEqual(orders[0]["rows"], 1)

    def test_admin_removes_one_upload_only(self):
        c = self.client_for(self.admin)
        u = [u for u in c.get(self.base + "/", {"dataset": "meesho_payments"}).data["uploads"]][0]
        r = c.post(self.base + "/delete/", {"dataset": u["dataset"], "start": u["start"], "end": u["end"]}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["rows"], 5)
        self.assertEqual(sorted(OrderPayment.objects.filter(business=self.biz).values_list("sub_order_no", flat=True)),
                         ["A0", "A1", "A2"])
        self.assertFalse(AdsCost.objects.exists())
        self.assertTrue(Order.objects.exists())                                      # other dataset kept
        self.assertTrue(OrderPayment.objects.filter(business=self.other).exists())   # other business kept

    def test_workers_can_look_but_not_remove(self):
        c = self.client_for(self.worker)
        d = c.get(self.base + "/").data
        self.assertFalse(d["can_delete"])
        u = d["uploads"][0]
        r = c.post(self.base + "/delete/", {"dataset": u["dataset"], "start": u["start"], "end": u["end"]}, format="json")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(OrderPayment.objects.count(), 8)

    def test_a_range_wider_than_one_upload_is_refused(self):
        r = self.client_for(self.admin).post(self.base + "/delete/", {
            "dataset": "meesho_payments", "start": (self.first - timedelta(days=1)).isoformat(),
            "end": timezone.now().isoformat()}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(OrderPayment.objects.count(), 8)

    def test_flipkart_orders_listed(self):
        FlipkartOrder.objects.create(business=self.biz, order_item_id="1", order_id="OD1", order_date=date(2026, 10, 2))
        d = self.client_for(self.admin).get(self.base + "/", {"dataset": "flipkart_orders"}).data
        self.assertEqual([u["rows"] for u in d["uploads"]], [1])
