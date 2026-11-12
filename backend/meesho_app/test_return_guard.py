"""Return Guard: pause a product whose customers return over 40% of 30+ units delivered to them, or one selling at a loss in 20+ units."""

from datetime import timedelta
from decimal import Decimal as D
from unittest import mock

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from . import return_guard
from .models import FinalPrice, ListingHubPause, Order, OrderPayment, ParentItemPrice, ReturnDelivery, ReturnGuardAlert, SkuPause


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

    def sold(self, kept, returned=0, rto=0, on_the_way=0, sku="lota-1", days_ago=15):
        """Orders placed `days_ago` and how they ended: delivered and kept, returned by the customer
        (the orders sheet still says DELIVERED; the returns file says customer return), RTO, or still on the way."""
        for status, n in (("kept", kept), ("returned", returned), ("rto", rto), ("open", on_the_way)):
            for _ in range(n):
                self.n += 1
                so = f"S{self.n}_1"
                Order.objects.create(business=self.biz, sub_order_no=so, sku=sku, quantity=1, order_date=self.today - timedelta(days=days_ago),
                                     reason_for_credit_entry={"kept": "DELIVERED", "returned": "DELIVERED", "rto": "RTO_COMPLETE", "open": "SHIPPED"}[status])
                if status == "returned":
                    ReturnDelivery.objects.create(business=self.biz, suborder_no=so, awb_number=f"A{self.n}", sku=sku, qty=1,
                                                  return_created_date=self.today - timedelta(days=days_ago - 6), type_of_return="Customer Return",
                                                  sub_type="FIRST_RET", return_reason="Size too small", synced_at=timezone.now())

    def test_pauses_when_customers_return_over_forty_percent_of_what_was_delivered(self):
        self.sold(kept=29, returned=21, rto=10, on_the_way=5)    # 21 of 50 delivered = 42%; RTO and in transit don't count
        with mock.patch("meesho_app.notify.channels", return_value=[]):
            done = return_guard.run()
        self.assertEqual([d["parent"] for d in done if "sku" not in d], ["LOTA"])
        self.assertTrue(ListingHubPause.objects.get(parent=self.lota).auto)
        self.assertTrue(SkuPause.objects.get(sku__sku_id="lota-1").auto)          # its SKU is paused one by one too
        alert = ReturnGuardAlert.objects.get(sku="")
        self.assertEqual((alert.kind, alert.orders, alert.returns), ("returns", 50, 21))
        self.assertIn("42.0%", alert.message)
        self.assertIn("21 of 50 units delivered", alert.message)
        self.assertIn("RTO not counted", alert.message)

    def test_exactly_forty_percent_or_under_thirty_delivered_is_left_alone(self):
        self.sold(kept=30, returned=20)                          # exactly 40% — not above
        self.assertEqual(return_guard.run(), [])
        ReturnDelivery.objects.all().delete()
        Order.objects.all().delete()
        self.sold(kept=15, returned=14)                          # 48%, but only 29 delivered
        self.assertEqual(return_guard.run(), [])
        self.assertFalse(ListingHubPause.objects.exists())

    def test_rto_is_not_a_customer_return(self):
        self.sold(kept=30, returned=10, rto=40)                  # 10 of 40 delivered = 25%, however many RTOs
        self.assertEqual(return_guard.run(), [])
        st = return_guard.return_stats([self.biz.pk], self.today)[(self.biz.pk, "LOTA")]
        self.assertEqual((st["orders"], st["returns"], st["rto"]), (40, 10, 40))

    def test_orders_too_recent_to_have_been_returned_are_not_counted(self):
        self.sold(kept=30, returned=30, days_ago=return_guard.SETTLE_DAYS - 1)
        self.assertEqual(return_guard.return_stats([self.biz.pk], self.today), {})
        self.sold(kept=30, returned=30, days_ago=return_guard.SETTLE_DAYS + return_guard.GUARD_DAYS)   # too old
        self.assertEqual(return_guard.return_stats([self.biz.pk], self.today), {})

    def test_the_payments_report_says_returned_too(self):
        self.sold(kept=40)
        for so in list(Order.objects.values_list("sub_order_no", flat=True))[:20]:
            OrderPayment.objects.create(business=self.biz, sub_order_no=so, live_order_status="Return", payment_date=self.today,
                                        transaction_id=f"T{so}", final_settlement_amount=-50)
        st = return_guard.return_stats([self.biz.pk], self.today)[(self.biz.pk, "LOTA")]
        self.assertEqual((st["orders"], st["returns"], st["delivered"]), (40, 20, 20))

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
        self.sold(kept=30, returned=30)
        self.assertEqual(len(return_guard.run(dry_run=True)), 1)
        self.assertFalse(ListingHubPause.objects.exists())
        self.assertEqual(len(return_guard.run()), 1)
        self.assertEqual(return_guard.run(), [])                 # already paused
        self.assertEqual(ReturnGuardAlert.objects.filter(sku="").count(), 1)

    def test_resumed_product_is_left_alone_for_a_while(self):
        self.sold(kept=30, returned=30)
        return_guard.run()
        return_guard.resume(self.lota)
        self.assertEqual(return_guard.run(), [])
        ReturnGuardAlert.objects.update(resumed_at=timezone.now() - timedelta(days=return_guard.GRACE_DAYS + 1))
        self.assertEqual(len(return_guard.run()), 1)

    def test_alert_goes_out_on_the_channels_set_up(self):
        self.sold(kept=30, returned=30)
        with mock.patch("meesho_app.notify.channels", return_value=["telegram"]), \
                mock.patch("meesho_app.notify.send") as send:
            return_guard.run()
        self.assertIn("LOTA paused", send.call_args[0][1])

    def test_command_prints_what_it_paused(self):
        self.sold(kept=30, returned=30)
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
        self.sold(kept=30, returned=30)
        d = self.client.get(self.url()).data
        g = d["guard"]
        self.assertTrue(g["can_pause"])
        self.assertEqual((g["rules"]["return_pct"], g["rules"]["min_orders"], g["at_risk"]), (40.0, 30, 2))   # the parent and its one SKU
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
        self.sold(kept=100, sku="lota-2")                        # lota-2 is fine
        self.sold(kept=25, returned=25, sku="lota-1")            # lota-1: 50% — parent overall 25/150
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

    # ── What is paused, and making it active again ───────────────────────

    def test_the_paused_list_and_resume(self):
        FinalPrice.objects.create(business=self.biz, sku_id="lota-2", parent=self.lota)
        bowl = ParentItemPrice.objects.create(business=self.biz, item_id="BOWL", item_price=D("100"), final_price=D("110"))
        FinalPrice.objects.create(business=self.biz, sku_id="bowl-1", parent=bowl)
        self.sold(kept=30, returned=5)                           # LOTA is fine now (14%) — paused under an older count
        return_guard.pause(self.biz, self.lota, "returns", "LOTA paused: 92% came back", auto=True)
        self.client.post(self.url("pause/"), {"sku": "bowl-1", "paused": True, "note": "dented"}, format="json")
        d = self.client.get(self.url("paused/")).data
        rows = {(i["level"], i["parent"], i["sku"]): i for i in d["items"]}
        self.assertEqual(set(rows), {("parent", "LOTA", ""), ("sku", "BOWL", "bowl-1")})   # LOTA's SKUs go with it, not listed twice
        lota = rows[("parent", "LOTA", "")]
        self.assertEqual((lota["auto"], lota["skus"], lota["reason"]), (True, 2, "LOTA paused: 92% came back"))
        self.assertEqual((lota["now"]["delivered_to_customers"], lota["now"]["customer_returns"], lota["now"]["rate"], lota["now"]["over_limit"]),
                         (35, 5, 14.3, False))
        self.assertTrue(d["can_resume"])
        # Only what the guard paused.
        r = self.client.post(self.url("resume/"), {"all": "auto"}, format="json")
        self.assertEqual(r.data["resumed"], ["LOTA"])
        self.assertFalse(ListingHubPause.objects.exists())
        self.assertEqual(list(SkuPause.objects.values_list("sku__sku_id", flat=True)), ["bowl-1"])
        # One by one.
        self.client.post(self.url("resume/"), {"items": [{"business": self.biz.pk, "sku": "bowl-1"}]}, format="json")
        self.assertFalse(SkuPause.objects.exists())
        self.assertEqual(self.client.get(self.url("paused/")).data["items"], [])

    def test_only_admins_resume(self):
        return_guard.pause(self.biz, self.lota, "returns", "x", auto=True)
        worker = User.objects.create_user(username="w", password="pw")
        Membership.objects.create(user=worker, business=self.biz)
        c = APIClient()
        c.force_authenticate(worker)
        self.assertEqual(c.post(self.url("resume/"), {"all": True}, format="json").status_code, 403)
        self.assertFalse(c.get(self.url("paused/")).data["can_resume"])
        self.assertTrue(ListingHubPause.objects.exists())

    # ── Auto-pause is off unless switched on; the simple page ────────────

    def test_the_morning_run_pauses_nothing_while_auto_pause_is_off(self):
        import json as _json
        from io import StringIO
        from .models import MeeshoAutoSetting
        self.sold(kept=30, returned=30)
        out = StringIO()
        call_command("return_guard", stdout=out)
        self.assertEqual(_json.loads(out.getvalue())["skipped"], "auto-pause is off")
        self.assertFalse(ListingHubPause.objects.exists())
        r = self.client.post(self.url("auto/"), {"on": True}, format="json")
        self.assertEqual(r.data["auto_pause"], True)
        self.assertTrue(MeeshoAutoSetting.get().return_guard_auto)
        with mock.patch("meesho_app.notify.channels", return_value=[]):
            call_command("return_guard", stdout=StringIO())
        self.assertTrue(ListingHubPause.objects.exists())

    def test_only_admins_switch_auto_pause(self):
        worker = User.objects.create_user(username="w", password="pw")
        Membership.objects.create(user=worker, business=self.biz)
        c = APIClient()
        c.force_authenticate(worker)
        self.assertEqual(c.post(self.url("auto/"), {"on": True}, format="json").status_code, 403)

    def test_sku_analysis_pauses_one_businesss_sku_and_reads_it_back(self):
        other = Business.objects.create(name="Cosmify")
        Membership.objects.create(user=self.admin, business=other)
        theirs = ParentItemPrice.objects.create(business=other, item_id="LOTA", item_price=D("100"), final_price=D("110"))
        FinalPrice.objects.create(business=other, sku_id="lota-1", parent=theirs)          # same SKU code, another business
        r = self.client.post(self.url("pause/"), {"business": other.id, "sku": "lota-1", "paused": True,
                                                  "note": "Loss in SKU Analysis"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(list(SkuPause.objects.values_list("business_id", "sku__sku_id")), [(other.id, "lota-1")])   # only that business's
        d = self.client.get(self.url("sku-pauses/"), {"businesses": f"{self.biz.id},{other.id}"}).data
        self.assertTrue(d["can_pause"])
        self.assertEqual([(x["business"], x["sku"], x["parent"], x["note"]) for x in d["skus"]], [(other.id, "lota-1", "LOTA", "SKU lota-1 paused by a: Loss in SKU Analysis")])
        return_guard.pause(self.biz, self.lota, "manual", "x", auto=False)
        d = self.client.get(self.url("sku-pauses/"), {"businesses": f"{self.biz.id},{other.id}"}).data
        self.assertIn({"business": self.biz.id, "parent": "LOTA"}, [{"business": x["business"], "parent": x["parent"]} for x in d["parents"]])
        # Only admins pause; a member reads — and never a business they can't open.
        member = User.objects.create_user(username="m", password="pw", role=User.ROLE_BUSINESS_USER)
        Membership.objects.create(user=member, business=self.biz)
        c = APIClient(); c.force_authenticate(member)
        self.assertEqual(c.post(self.url("pause/"), {"sku": "lota-1", "paused": True}, format="json").status_code, 403)
        d = c.get(self.url("sku-pauses/"), {"businesses": str(other.id)}).data
        self.assertEqual((d["businesses"], {x["business"] for x in d["skus"]}, d["can_pause"]), ([self.biz.id], {self.biz.id}, False))

    def test_the_simple_page_pauses_one_sku_and_the_product_stays_live(self):
        lota2 = FinalPrice.objects.create(business=self.biz, sku_id="lota-2", parent=self.lota)
        FinalPrice.objects.create(business=self.biz, sku_id="lota-3", parent=self.lota)      # no orders in the window
        self.sold(kept=29, returned=21, sku="lota-1")
        self.sold(kept=10, sku="lota-2")
        r = self.client.post(self.url("pause/"), {"business": self.biz.id, "sku": "LOTA-2", "paused": True}, format="json")
        self.assertEqual((r.status_code, r.data["sku"]), (200, "lota-2"))
        self.assertTrue(SkuPause.objects.filter(sku=lota2).exists())
        self.assertFalse(ListingHubPause.objects.exists())                          # the parent isn't paused
        lota = next(p for p in self.client.get(self.url("simple/")).data["products"] if p["key"] == "LOTA")
        self.assertEqual((lota["paused"], lota["paused_skus"], lota["status"]), (False, 1, "high"))
        self.assertEqual({s["key"]: (s["paused"], s["status"]) for s in lota["skus"]},
                         {"lota-1": (False, "over"), "lota-2": (True, "paused")})
        # A paused SKU still shows when it has no orders in the period.
        self.client.post(self.url("pause/"), {"business": self.biz.id, "sku": "lota-3", "paused": True}, format="json")
        lota = next(p for p in self.client.get(self.url("simple/")).data["products"] if p["key"] == "LOTA")
        self.assertEqual((lota["paused_skus"], sorted(s["key"] for s in lota["skus"] if s["paused"])), (2, ["lota-2", "lota-3"]))
        # The Listing Hub keeps the product with just the SKUs still live.
        self.assertEqual(list(FinalPrice.objects.filter(parent=self.lota, sku_pause__isnull=True).values_list("sku_id", flat=True)), ["lota-1"])

    def test_the_simple_page(self):
        FinalPrice.objects.create(business=self.biz, sku_id="lota-2", parent=self.lota)
        self.sold(kept=29, returned=21, rto=10, on_the_way=5, sku="lota-1")
        self.sold(kept=10, sku="lota-2")
        self.sold(kept=5, returned=1, sku="loose-sku")           # no parent
        d = self.client.get(self.url("simple/"), {"days": 30}).data
        t = d["totals"]
        self.assertEqual((t["orders"], t["returns"], t["rto"], t["open"], t["shipped"]), (66, 22, 10, 5, 81))
        lota = next(p for p in d["products"] if p["key"] == "LOTA")
        self.assertEqual((lota["orders"], lota["returns"], lota["rate"], lota["status"]), (60, 21, 35.0, "high"))
        self.assertEqual({s["key"]: s["status"] for s in lota["skus"]}, {"lota-1": "over", "lota-2": "ok"})
        loose = next(p for p in d["products"] if p["key"] == "loose-sku")
        self.assertEqual((loose["level"], loose["status"]), ("unlinked", "few"))
        self.assertFalse(d["auto_pause"])
        return_guard.pause(self.biz, self.lota, "manual", "x", auto=False)
        lota = next(p for p in self.client.get(self.url("simple/")).data["products"] if p["key"] == "LOTA")
        self.assertEqual((lota["status"], lota["paused"]), ("paused", True))
