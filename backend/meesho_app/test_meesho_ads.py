"""Meesho Ads dashboard, ROI and its actions. The worker and Meesho are faked."""

from datetime import timedelta
from decimal import Decimal
from unittest import mock

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from . import meesho_ads, meesho_sync
from .models import (
    FinalPrice, MeeshoAccount, MeeshoAdCampaign, MeeshoAdCatalog, MeeshoAdCatalogDay, MeeshoAdDay, MeeshoAdPause,
    MeeshoAutoSetting, Order, OrderPayment,
)


@mock.patch.object(meesho_sync, "_worker_alive", lambda: True)
class AdsTests(TestCase):
    def setUp(self):
        self.biz = Business.objects.create(name="Cosmify")
        self.admin = User.objects.create_user(username="a", password="pw", role=User.ROLE_SUPER_ADMIN)
        self.worker = User.objects.create_user(username="w", password="pw", role=User.ROLE_BUSINESS_USER)
        for u in (self.admin, self.worker):
            Membership.objects.create(user=u, business=self.biz)
        self.acct = MeeshoAccount.objects.create(business=self.biz, phone_number="9000000001", password_enc="v1:x", status="ACTIVE",
                                                 supplier_id="3564327", supplier_identifier="lffy4", supplier_name="Cosmify")
        self.today = meesho_ads._ist_today()
        now = timezone.now()
        self.camp = MeeshoAdCampaign.objects.create(account=self.acct, campaign_id=28089176, name="Nov", status="LIVE",
                                                    start_at=now - timedelta(days=2), spend=231, revenue=1554, orders=6, read_at=now)
        MeeshoAdCampaign.objects.create(account=self.acct, campaign_id=27763867, name="Oct", status="PAUSED", reason="SUPPLIER_ABORTED",
                                        start_at=now - timedelta(days=20), spend=127.5, read_at=now)
        cat = lambda camp, cid, st, spend, orders, revenue, name="Puja": MeeshoAdCatalog.objects.create(
            account=self.acct, campaign_id=camp, catalog_id=cid, name=name, status=st, spend=spend, orders=orders, revenue=revenue, read_at=now)
        cat(28089176, 101, "ACTIVE", 200, 6, 1800, "Thali")          # earns: 6 × ₹80 = 480 − 236 = 244
        cat(28089176, 202, "ACTIVE", 40, 0, 0, "Diya")               # ₹40 no order (₹47.20 with GST ≥ ₹30 an order earns)
        cat(27763867, 202, "ACTIVE", 60, 1, 300, "Diya")             # the same catalog in an old campaign: summed
        cat(28089176, 303, "PAUSED", 10, 0, 0, "Lota")               # no cost price
        day = lambda cid, spend, orders, d=None: MeeshoAdCatalogDay.objects.create(
            account=self.acct, campaign_id=28089176, catalog_id=cid, date=d or self.today, spend=spend, orders=orders, revenue=orders * 300, read_at=now)
        day(101, 30, 1)
        day(202, 36, 0)
        day(303, 5, 0)
        day(101, 50, 2, self.today - timedelta(days=1))
        MeeshoAdDay.objects.create(account=self.acct, date=self.today, spend=71, revenue=300, orders=1, views=1000, clicks=50, read_at=now)
        MeeshoAdDay.objects.create(account=self.acct, date=self.today - timedelta(days=1), spend=50, revenue=600, orders=2, views=900, clicks=40, read_at=now)
        # Our orders: catalog 101 nets ₹80 an order (settled 180, cost 100), 202 nets ₹30 (130 − 100).
        FinalPrice.objects.create(business=self.biz, sku_id="thali", final_price=100, item_price=100, packaging_cost=0, tax_percent=0)
        FinalPrice.objects.create(business=self.biz, sku_id="diya", final_price=100, item_price=100, packaging_cost=0, tax_percent=0)
        when = timezone.now() - timedelta(days=10)
        for i in range(4):
            for sku, cid, settled in (("thali", 101, 180), ("diya", 202, 130)):
                sub = f"{sku}-{i}"
                Order.objects.create(business=self.biz, sub_order_no=sub, sku=sku, quantity=1, catalog_id=cid,
                                     order_date=when.date(), reason_for_credit_entry="DELIVERED")
                OrderPayment.objects.create(business=self.biz, sub_order_no=sub, supplier_sku=sku, catalog_id=cid, quantity=1,
                                            order_date=when, payment_date=when.date(), live_order_status="Delivered",
                                            final_settlement_amount=settled, order_source="Ad order" if i == 0 else "")
        self.queued = []
        p = mock.patch.object(meesho_sync, "enqueue", side_effect=lambda job, args, queue="critical", retry=2:
                              self.queued.append((job, args, retry)) or "jid")
        p.start()
        self.addCleanup(p.stop)
        self.base = f"/api/business/{self.biz.id}/meesho-ads/"

    def api(self, user=None):
        c = APIClient()
        c.force_authenticate(user or self.admin)
        return c

    def board(self, **q):
        r = self.api().get(self.base, q)
        self.assertEqual(r.status_code, 200, r.data)
        return r.data["businesses"][0]

    def cat(self, b, cid):
        return next(c for c in b["catalogs"] if c["catalog_id"] == cid)

    def test_totals_and_days_from_what_the_worker_read(self):
        b = self.board()
        t = b["totals"]
        self.assertEqual((t["spend"], t["revenue"], t["orders"]), (121.0, 900.0, 3))
        self.assertEqual(t["roi"], 7.44)
        self.assertEqual(t["cost_with_gst"], 142.78)
        self.assertEqual(b["range"]["days"], 30)
        self.assertEqual(b["range"]["days_read"], 2)
        self.assertEqual(len(b["series"]), 30)
        self.assertEqual([c["campaign_id"] for c in b["campaigns"]], [28089176, 27763867])

    def test_true_roi_per_catalog_from_what_an_order_really_nets(self):
        b = self.board()
        thali = self.cat(b, 101)
        self.assertEqual(thali["economics"]["net_per_order"], 80.0)
        self.assertEqual(thali["economics"]["ad_orders_settled"], 1)
        self.assertEqual(thali["breakeven_cpo"], 80.0)
        self.assertEqual(thali["true_profit"], 244.0)                     # 6 × 80 − 200 × 1.18
        self.assertEqual(thali["breakeven_roi"], 4.42)                    # ₹300 order × 1.18 ÷ ₹80
        self.assertEqual(thali["verdict"], "scale")                       # ₹39.33 an order of ₹80
        diya = self.cat(b, 202)
        self.assertEqual((diya["campaigns"], diya["lifetime"]["spend"], diya["lifetime"]["orders"]), (2, 100.0, 1))
        self.assertEqual(diya["true_profit"], -88.0)                      # 30 − 118
        self.assertEqual(self.cat(b, 303)["verdict"], "no_cost")
        # The range: thali's 3 orders × 80 − 80 × 1.18; diya's 0 − 36 × 1.18. Lota has no cost: kept apart.
        self.assertEqual(b["true"]["profit"], round(240 - 94.4 - 42.48, 2))
        self.assertEqual(b["true"]["spend_unpriced"], 5.0)

    def test_today_shows_each_live_catalog_against_the_rule(self):
        b = self.board()
        rows = {r["catalog_id"]: r for r in b["today"]["catalogs"]}
        self.assertTrue(rows[202]["over_limit"])                          # ₹36, no order, active
        self.assertFalse(rows[101]["over_limit"])                         # an order
        self.assertFalse(rows[303]["over_limit"])                         # paused already
        self.assertIsNone(rows[101]["left_before_pause"])
        # The rule is off: the page says what it would pause.
        self.assertTrue(any("Auto-pause is off" in i["title"] for i in b["insights"]))

    def test_pause_or_resume_by_hand_queues_the_worker_once(self):
        r = self.api().post(f"{self.base}catalog/", {"business": self.biz.id, "campaign_id": 28089176, "catalog_id": 202,
                                                    "action": "pause"}, format="json")
        self.assertEqual(r.status_code, 202, r.data)
        p = MeeshoAdPause.objects.get()
        self.assertEqual((p.action, p.trigger, p.status, p.spend), ("PAUSE", "MANUAL", "QUEUED", Decimal("36.00")))
        self.assertEqual(self.queued, [("MeeshoAdEditJob", [p.pk], False)])
        again = self.api().post(f"{self.base}catalog/", {"business": self.biz.id, "campaign_id": 28089176, "catalog_id": 202,
                                                        "action": "pause"}, format="json")
        self.assertEqual(again.status_code, 409)

    def test_nothing_sent_for_what_cant_be_changed(self):
        cases = [({"campaign_id": 28089176, "catalog_id": 303, "action": "pause"}, 409),      # paused already
                 ({"campaign_id": 27763867, "catalog_id": 202, "action": "pause"}, 409),      # campaign not live
                 ({"campaign_id": 28089176, "catalog_id": 999, "action": "pause"}, 404),
                 ({"campaign_id": 28089176, "catalog_id": 202, "action": "delete"}, 400)]
        for body, code in cases:
            r = self.api().post(f"{self.base}catalog/", {"business": self.biz.id, **body}, format="json")
            self.assertEqual(r.status_code, code, (body, r.data))
        self.assertEqual(self.queued, [])

    def test_the_rule_is_set_by_an_admin_within_limits(self):
        r = self.api().post(f"{self.base}rule/", {"auto_pause": True, "spend": "40", "orders": 0}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        s = MeeshoAutoSetting.get()
        self.assertEqual((s.ads_auto_pause, s.ads_pause_spend, s.ads_pause_orders), (True, Decimal("40"), 0))
        self.assertEqual(self.api().post(f"{self.base}rule/", {"spend": 1}, format="json").status_code, 400)
        self.assertEqual(self.api(self.worker).post(f"{self.base}rule/", {"auto_pause": False}, format="json").status_code, 403)
        self.assertTrue(MeeshoAutoSetting.get().ads_auto_pause)

    def test_admins_only_for_changes_and_refresh_queues_a_read(self):
        r = self.api(self.worker).post(f"{self.base}catalog/", {"business": self.biz.id, "campaign_id": 28089176,
                                                               "catalog_id": 202, "action": "pause"}, format="json")
        self.assertEqual(r.status_code, 403)
        r = self.api().post(f"{self.base}refresh/", {}, format="json")
        self.assertEqual(r.status_code, 202, r.data)
        self.assertEqual(self.queued[0][0], "MeeshoAdsJob")
        self.assertEqual(self.queued[0][2], False)
