"""Return Guard: pause a product with returns over 40% of 50+ units, or one selling at a loss in 20+ units."""

from datetime import timedelta
from decimal import Decimal as D
from unittest import mock

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from . import return_guard
from .models import FinalPrice, ListingHubPause, Order, ParentItemPrice, ReturnDelivery, ReturnGuardAlert, SkuPause


class GuardTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(username="a", password="pw", role=User.ROLE_SUPER_ADMIN)
        self.biz = Business.objects.create(name="Rudam")
        Membership.objects.create(user=self.admin, business=self.biz)
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.today = timezone.localdate()
        self.lota = ParentItemPrice.objects.create(business=self.biz, item_id="LOTA", item_price=D("100"), final_price=D("110"))
        FinalPrice.objects.create(business=self.biz, sku_id="lota-1", parent=self.lota)
        self.n = 0

    def orders(self, n, sku="lota-1", days_ago=3):
        for _ in range(n):
            self.n += 1
            Order.objects.create(business=self.biz, sub_order_no=f"O{self.n}_1", sku=sku, quantity=1,
                                 order_date=self.today - timedelta(days=days_ago), reason_for_credit_entry="SHIPPED")

    def returns(self, n, rto=0, sku="lota-1"):
        for i in range(n):
            self.n += 1
            ReturnDelivery.objects.create(
                business=self.biz, suborder_no=f"R{self.n}_1", awb_number=f"A{self.n}", sku=sku, qty=1,
                return_created_date=self.today - timedelta(days=2),
                type_of_return="Courier Return (RTO)" if i < rto else "Customer Return",
                sub_type="forward_RTO" if i < rto else "FIRST_RET", return_reason="Size too small",
                synced_at=timezone.now())

    def test_pauses_above_forty_percent_with_fifty_units(self):
        self.orders(50)
        self.returns(21, rto=6)                                  # 42%
        with mock.patch("meesho_app.notify.channels", return_value=[]):
            done = return_guard.run()
        self.assertEqual([d["parent"] for d in done if "sku" not in d], ["LOTA"])
        self.assertTrue(ListingHubPause.objects.get(parent=self.lota).auto)
        self.assertTrue(SkuPause.objects.get(sku__sku_id="lota-1").auto)          # its SKU is paused one by one too
        alert = ReturnGuardAlert.objects.get(sku="")
        self.assertEqual((alert.kind, alert.orders, alert.returns), ("returns", 50, 21))
        self.assertIn("42.0%", alert.message)

    def test_exactly_forty_percent_or_under_fifty_orders_is_left_alone(self):
        self.orders(50)
        self.returns(20)                                         # exactly 40% — not above
        self.assertEqual(return_guard.run(), [])
        ReturnDelivery.objects.all().delete()
        Order.objects.all().delete()
        self.orders(49)
        self.returns(30)                                         # 61%, but only 49 units
        self.assertEqual(return_guard.run(), [])
        self.assertFalse(ListingHubPause.objects.exists())

    def test_pauses_a_product_selling_at_a_loss(self):
        loss = {"LOTA": {"units": 25, "loss": D("500")}}
        with mock.patch.object(return_guard, "loss_stats", return_value=loss):
            done = return_guard.run()
        self.assertEqual(done[0]["kind"], "loss")
        small = {"LOTA": {"units": 19, "loss": D("500")}}
        ListingHubPause.objects.all().delete()
        with mock.patch.object(return_guard, "loss_stats", return_value=small):
            self.assertEqual(return_guard.run(), [])

    def test_loss_from_the_profit_engine(self):
        profit = {"sku_wise_profit": {"lota-1": {"delivered_quantity": 22, "delivered_profit": D("-300")}}}
        with mock.patch("meesho_app.views.compute_profit_summary", return_value=profit):
            self.assertEqual(return_guard.loss_stats(self.biz, self.today), {"LOTA": {"units": 22, "loss": D("300")}})
        profit["sku_wise_profit"]["lota-1"]["delivered_profit"] = D("300")
        with mock.patch("meesho_app.views.compute_profit_summary", return_value=profit):
            self.assertEqual(return_guard.loss_stats(self.biz, self.today), {})

    def test_dry_run_changes_nothing_and_paused_ones_are_not_repeated(self):
        self.orders(60)
        self.returns(30)
        self.assertEqual(len(return_guard.run(dry_run=True)), 1)
        self.assertFalse(ListingHubPause.objects.exists())
        self.assertEqual(len(return_guard.run()), 1)
        self.assertEqual(return_guard.run(), [])                 # already paused
        self.assertEqual(ReturnGuardAlert.objects.filter(sku="").count(), 1)

    def test_resumed_product_is_left_alone_for_a_while(self):
        self.orders(60)
        self.returns(30)
        return_guard.run()
        return_guard.resume(self.lota)
        self.assertEqual(return_guard.run(), [])
        ReturnGuardAlert.objects.update(resumed_at=timezone.now() - timedelta(days=return_guard.GRACE_DAYS + 1))
        self.assertEqual(len(return_guard.run()), 1)

    def test_alert_goes_out_on_the_channels_set_up(self):
        self.orders(60)
        self.returns(30)
        with mock.patch("meesho_app.notify.channels", return_value=["telegram"]), \
                mock.patch("meesho_app.notify.send") as send:
            return_guard.run()
        self.assertIn("LOTA paused", send.call_args[0][1])

    def test_command_prints_what_it_paused(self):
        self.orders(60)
        self.returns(30)
        out = mock.MagicMock()
        call_command("return_guard", "--dry-run", stdout=out)
        self.assertIn("LOTA", "".join(c.args[0] for c in out.write.call_args_list))

    # ── The page ─────────────────────────────────────────────────────────

    def url(self, tail=""):
        return f"/api/business/{self.biz.id}/meesho-orders/return-analysis/{tail}"

    def test_pause_and_resume_button(self):
        r = self.client.post(self.url("pause/"), {"parent": "LOTA", "paused": True, "note": "bad batch"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        pause = ListingHubPause.objects.get(parent=self.lota)
        self.assertFalse(pause.auto)
        self.assertEqual(pause.paused_by, self.admin)
        self.assertEqual(ReturnGuardAlert.objects.get().kind, "manual")
        r = self.client.post(self.url("pause/"), {"parent": "LOTA", "paused": False}, format="json")
        self.assertEqual(r.data["paused"], False)
        self.assertFalse(ListingHubPause.objects.exists())

    def test_only_admins_pause_and_an_unlinked_sku_cannot_be_paused(self):
        worker = User.objects.create_user(username="w", password="pw")
        Membership.objects.create(user=worker, business=self.biz)
        c = APIClient()
        c.force_authenticate(worker)
        self.assertEqual(c.post(self.url("pause/"), {"parent": "LOTA", "paused": True}, format="json").status_code, 403)
        self.assertEqual(self.client.post(self.url("pause/"), {"parent": "NOPE", "paused": True}, format="json").status_code, 404)

    def test_analysis_splits_customer_returns_from_rto_with_delivered(self):
        self.orders(50)
        self.returns(10, rto=4)                                  # 6 customer returns, 4 RTOs
        d = self.client.get(self.url(), {"days": 30}).data
        h = d["headline"]["d30"]
        self.assertEqual((h["orders"], h["delivered"], h["customer"], h["rto"]), (50, 46, 6, 4))
        self.assertEqual((h["customer_rate"], h["rto_rate"], h["rate"]), (13.0, 8.0, 20.0))
        p = d["parents"][0]
        self.assertEqual((p["delivered"], p["customer_rate"], p["rto_rate"]), (46, 13.0, 8.0))
        self.assertEqual(sum(t["customer"] + t["rto"] for t in p["trend"]), 10)
        self.assertEqual(sum(t["orders"] for t in d["trend"]), 50)

    def test_analysis_shows_what_the_guard_sees(self):
        self.orders(60)
        self.returns(30)
        d = self.client.get(self.url()).data
        g = d["guard"]
        self.assertTrue(g["can_pause"])
        self.assertEqual((g["rules"]["return_pct"], g["rules"]["min_orders"], g["at_risk"]), (40.0, 50, 2))   # the parent and its one SKU
        self.assertTrue(d["parents"][0]["guard"]["returns_breach"])
        self.client.post(self.url("run/"), {}, format="json")
        d = self.client.get(self.url()).data
        self.assertEqual(d["guard"]["paused_count"], 1)
        self.assertEqual(d["guard"]["unseen"], 1)
        self.assertTrue(d["skus"][0]["guard"]["paused"])
        self.assertTrue(d["parents"][0]["guard"]["paused_auto"])
        self.client.post(self.url("seen/"), {}, format="json")
        self.assertEqual(self.client.get(self.url()).data["guard"]["unseen"], 0)

    # ── One SKU at a time ────────────────────────────────────────────────

    def test_one_bad_sku_is_paused_alone_and_the_parent_stays(self):
        FinalPrice.objects.create(business=self.biz, sku_id="lota-2", parent=self.lota)
        self.orders(100, sku="lota-2")                           # lota-2 is fine
        self.orders(50, sku="lota-1")
        self.returns(25, sku="lota-1")                           # lota-1: 50% — parent overall 25/150
        done = return_guard.run()
        self.assertEqual([(d.get("sku"), d["parent"]) for d in done], [("lota-1", "LOTA")])
        self.assertFalse(ListingHubPause.objects.exists())
        self.assertEqual(list(SkuPause.objects.values_list("sku__sku_id", flat=True)), ["lota-1"])
        self.assertEqual(ReturnGuardAlert.objects.get().sku, "lota-1")

    def test_pause_and_resume_a_single_sku_by_hand(self):
        FinalPrice.objects.create(business=self.biz, sku_id="lota-2", parent=self.lota)
        r = self.client.post(self.url("pause/"), {"sku": "lota-2", "paused": True, "note": "dented"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(list(SkuPause.objects.values_list("sku__sku_id", flat=True)), ["lota-2"])
        self.assertFalse(ListingHubPause.objects.exists())
        self.client.post(self.url("pause/"), {"sku": "lota-2", "paused": False}, format="json")
        self.assertFalse(SkuPause.objects.exists())
        self.assertEqual(self.client.post(self.url("pause/"), {"sku": "nope", "paused": True}, format="json").status_code, 404)

    def test_pausing_a_parent_pauses_every_sku_and_resuming_frees_them(self):
        FinalPrice.objects.create(business=self.biz, sku_id="lota-2", parent=self.lota)
        self.client.post(self.url("pause/"), {"parent": "LOTA", "paused": True}, format="json")
        self.assertEqual(SkuPause.objects.count(), 2)
        self.client.post(self.url("pause/"), {"parent": "LOTA", "paused": False}, format="json")
        self.assertEqual(SkuPause.objects.count(), 0)

    def test_paused_skus_are_left_out_of_the_hub(self):
        from .listing_hub import _parent_skus
        FinalPrice.objects.create(business=self.biz, sku_id="lota-2", parent=self.lota)
        self.client.post(self.url("pause/"), {"sku": "lota-2", "paused": True}, format="json")
        self.assertEqual(_parent_skus(self.biz, self.lota), ["lota-1"])
