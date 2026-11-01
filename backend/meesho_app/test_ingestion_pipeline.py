"""
End to end: what the Meesho sync reads goes into the app's tables correctly,
and the profit screens show it at once.

Each test runs the real pipeline — the worker's snapshots / downloaded files →
the middleware (meesho_inject, import_meesho_payments) → the tables — then
reads the screens through the API with the response cache switched ON, as in
production (the normal test settings switch it off). A screen answered before
new data arrived must never be served after it.
"""

import datetime as dt
import io
import json
import os
import tempfile

from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import Business, Membership, User

from .management.commands.verify_meesho_sync import check_orders, check_payments, check_returns
from .models import (FinalPrice, LabelOrder, MeeshoAccount, MeeshoOutstandingPayment, MeeshoSyncSnapshot, Order,
                     OrderPayment, ReturnDelivery, ScannedOrder)
from .test_meesho_sync import _payment_workbook

LOCMEM = {
    "default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"},
    "api": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache", "LOCATION": "ingestion-pipeline-tests"},
}
DAY = dt.date(2026, 10, 20)
CREATED = "2026-10-20T10:00:00+0530"


def order_row(sub, tab, **kw):
    """An order as the worker keeps it (PanelOrders.normalize)."""
    return {"tab": tab, "sub_order_num": sub, "order_num": sub.split("_")[0], "created_iso": CREATED, "sku": "diya-029",
            "variation": "Free Size", "quantity": 1, "product_name": "Brass Diya", **kw}


def return_row(sub, status, kind="RET", **kw):
    """A return as Meesho sends it (fetchReturnClaims)."""
    return {"sub_order_num": sub, "order_num": sub.split("_")[0], "awb": f"AWB{sub}", "type": kind,
            "sub_type": "forward_RTO" if kind == "RTO" else "FIRST_RET", "shipment_status": status,
            "created_date_iso": "2026-10-24T10:22:04+0530", "carrier_name": "Delhivery",
            "product": {"sku": "diya-029", "name": "Brass Diya", "quantity": 1, "variation": "Free Size",
                        "image_urls": ["https://images.meesho.com/images/products/1/a.jpg"]}, **kw}


@override_settings(CACHES=LOCMEM, API_CACHE_ENABLED=True)
class PipelineTestCase(TestCase):
    def setUp(self):
        from django.core.cache import caches
        caches["api"].clear()
        self.biz = Business.objects.create(name="Rudam")
        self.admin = User.objects.create_user(username="a", password="pw", role=User.ROLE_SUPER_ADMIN)
        Membership.objects.create(user=self.admin, business=self.biz)
        self.acct = MeeshoAccount.objects.create(business=self.biz, phone_number="9000000001", password_enc="x", status="ACTIVE",
                                                 supplier_id="1", supplier_identifier="x")
        FinalPrice.objects.create(business=self.biz, sku_id="diya-029", item_price=50, packaging_cost=5, tax_percent=0,
                                  final_price=55)
        self.api = APIClient()
        self.api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(self.admin).access_token}")
        self.base = f"/api/business/{self.biz.id}"
        self.dir = tempfile.mkdtemp()

    # ── the worker's side ────────────────────────────────────────────────────
    def snap(self, endpoint, payload):
        MeeshoSyncSnapshot.objects.update_or_create(account=self.acct, endpoint=endpoint, defaults={
            "http_status": 200, "payload": payload, "fetched_at": timezone.now()})

    def inject(self, kind):
        out = io.StringIO()
        call_command("meesho_inject", account=self.acct.id, kind=kind, stdout=out)
        return json.loads(out.getvalue().strip().splitlines()[-1])

    def import_payments(self, rows, kind="completed"):
        path = os.path.join(self.dir, f"{kind}-{len(os.listdir(self.dir))}.xlsx")
        _payment_workbook(path, rows)
        out = io.StringIO()
        call_command("import_meesho_payments", business=self.biz.pk, file=path, kind=kind, stdout=out)
        return json.loads(out.getvalue())

    # ── the screens ──────────────────────────────────────────────────────────
    def get(self, path, **params):
        r = self.api.get(f"{self.base}{path}", params)
        self.assertEqual(r.status_code, 200, r.content[:300])
        return r

    def daily(self):
        return self.get("/profit/daily/", date_from="2026-10-15", date_to="2026-10-25")

    def warm(self, fn):
        """Read a screen until the cache serves it (the first read may itself write a settings row)."""
        for _ in range(3):
            r = fn()
            if r["X-Cache"] == "HIT":
                return r
        self.fail("the screen never came from the cache")

    def status(self, sub):
        return Order.latest_per_order(Order.objects.filter(business=self.biz, sub_order_no=sub)).get().reason_for_credit_entry


class OrdersIntoTheTableTests(PipelineTestCase):
    def test_every_tab_lands_with_its_status_and_details(self):
        self.snap("orders_hold", [order_row("1_1", "hold")])
        self.snap("orders_pending", [order_row("2_1", "pending")])
        self.snap("orders_ready_to_ship", [order_row("3_1", "ready-to-ship", packet_id="KP123",
                                                     image="https://images.meesho.com/images/products/9/b.jpg")])
        self.snap("orders_shipped", [order_row("4_1", "shipped")])
        self.snap("orders_cancelled", [order_row("5_1", "cancelled")])
        res = self.inject("orders")
        self.assertEqual((res["added"], res["rejected"]), (5, 0))
        self.assertEqual({s: self.status(s) for s in ("1_1", "2_1", "3_1", "4_1", "5_1")},
                         {"1_1": "HOLD", "2_1": "PENDING", "3_1": "READY_TO_SHIP", "4_1": "SHIPPED", "5_1": "CANCELLED"})
        rts = Order.objects.get(sub_order_no="3_1")
        self.assertEqual((rts.order_date, rts.sku, rts.size, rts.packet_id, rts.order_source),
                         (DAY, "diya-029", "Free Size", "KP123", "Meesho panel sync"))
        self.assertTrue(rts.meesho_image_url.startswith("https://images.meesho.com/"))
        self.assertEqual(check_orders(self.acct).problems, 0)          # the verify command agrees

    def test_bad_rows_are_refused_not_written(self):
        self.snap("orders_pending", [order_row("", "pending"), {"tab": "pending"}, order_row("6_1", "nonsense"),
                                     order_row("7_1", "pending")])
        res = self.inject("orders")
        self.assertEqual((res["added"], res["rejected"]), (1, 3))
        self.assertEqual(list(Order.objects.values_list("sub_order_no", flat=True)), ["7_1"])

    def test_the_next_read_moves_orders_on_and_never_back_or_twice(self):
        self.snap("orders_pending", [order_row("1_1", "pending")])
        self.inject("orders")
        self.snap("orders_pending", [])
        self.snap("orders_ready_to_ship", [order_row("1_1", "ready-to-ship")])
        self.assertEqual(self.inject("orders")["status_changed"], 1)
        self.snap("orders_ready_to_ship", [])
        self.snap("orders_shipped", [order_row("1_1", "shipped")])
        self.inject("orders")
        self.snap("orders_shipped", [])
        self.snap("orders_pending", [order_row("1_1", "pending")])      # a stale list can't pull it back
        self.assertEqual(self.inject("orders")["kept_further_on"], 1)
        self.assertEqual(self.status("1_1"), "SHIPPED")
        again = self.inject("orders")
        self.assertEqual((again["added"], again["status_changed"]), (0, 0))
        self.assertEqual(sorted(Order.objects.values_list("reason_for_credit_entry", flat=True)),
                         ["PENDING", "READY_TO_SHIP", "SHIPPED"])          # one row per status, as an Orders sheet keeps

    def test_shipped_orders_the_panel_dropped_settle_from_returns_and_payments(self):
        self.snap("orders_shipped", [order_row(f"{n}_1", "shipped") for n in (1, 2, 3)])
        self.inject("orders")
        self.snap("orders_shipped", [order_row("3_1", "shipped")])        # 1 and 2 have left the list
        self.snap("returns_completed_delivered", [return_row("1_1", "Delivered", kind="RTO",
                                                             delivered_date_iso="2026-10-28T10:00:00+0530")])
        self.inject("returns")
        self.import_payments([{"sub_order_no": "2_1", "transaction_id": "AXIS1", "payment_date": "2026-10-27",
                               "final_settlement_amount": 180, "live_order_status": "Delivered", "supplier_sku": "diya-029"}])
        self.assertEqual({s: self.status(s) for s in ("1_1", "2_1", "3_1")},
                         {"1_1": "RTO_COMPLETE", "2_1": "DELIVERED", "3_1": "SHIPPED"})
        self.assertEqual(check_orders(self.acct).problems, 0)


class ReturnsIntoTheTableTests(PipelineTestCase):
    def test_every_status_lands_in_its_stage_and_a_return_never_goes_back(self):
        self.snap("returns_intransit", [return_row("1_1", "In Transit")])
        self.snap("returns_ofd_reverse", [return_row("2_1", "Out For Delivery")])
        self.snap("returns_completed_delivered", [return_row("3_1", "Delivered", delivered_date_iso="2026-10-30T10:00:00+0530")])
        self.snap("returns_completed_lost", [return_row("4_1", "Lost")])
        self.snap("returns_reverse_disposed", [return_row("5_1", "Disposed")])
        self.inject("returns")
        stages = dict(ReturnDelivery.objects.values_list("suborder_no", "stage"))
        self.assertEqual(stages, {"1_1": "IN_TRANSIT", "2_1": "IN_TRANSIT", "3_1": "DELIVERED", "4_1": "LOST", "5_1": "DISPOSED"})
        self.assertEqual(ReturnDelivery.objects.get(suborder_no="3_1").delivered_date, dt.date(2026, 10, 30))
        self.assertTrue(ReturnDelivery.objects.get(suborder_no="1_1").meesho_image_url)
        self.assertEqual(check_returns(self.acct).problems, 0)
        # The next read still lists 3_1 in transit (Meesho lags): it stays delivered.
        self.snap("returns_intransit", [return_row("3_1", "In Transit")])
        self.inject("returns")
        self.assertEqual(ReturnDelivery.objects.get(suborder_no="3_1").stage, "DELIVERED")
        self.assertEqual(ReturnDelivery.objects.count(), 5)                # updated, never duplicated


class PaymentsIntoTheTableTests(PipelineTestCase):
    PAID = {"sub_order_no": "1_1", "transaction_id": "AXIS1", "payment_date": "2026-10-27", "final_settlement_amount": 180,
            "live_order_status": "Delivered", "supplier_sku": "diya-029", "quantity": 1, "order_date": "2026-10-20 10:00"}

    def test_paid_rows_land_once_and_unpaid_ones_never_count_as_paid(self):
        from .views import _ist_today
        future = (_ist_today() + dt.timedelta(days=3)).isoformat()
        res = self.import_payments([self.PAID, {"sub_order_no": "2_1", "payment_date": future, "final_settlement_amount": 90}])
        self.assertEqual(res["order_payments"], {"created": 1, "updated": 0, "skipped_unpaid": 1})
        self.import_payments([self.PAID])                                   # the next read, two hours on
        self.assertEqual(OrderPayment.objects.count(), 1)
        self.import_payments([{"sub_order_no": "3_1", "payment_date": future, "final_settlement_amount": 70}], kind="outstanding")
        self.assertEqual(list(MeeshoOutstandingPayment.objects.values_list("sub_order_no", flat=True)), ["3_1"])
        self.assertFalse(OrderPayment.objects.filter(sub_order_no="3_1").exists())
        self.assertEqual(check_payments(self.acct).problems, 0)


class ProfitFollowsTheDataTests(PipelineTestCase):
    def test_new_orders_show_on_daily_profit_at_once(self):
        before = self.warm(self.daily).json()["totals"]["shipped_count"]
        self.snap("orders_shipped", [order_row("1_1", "shipped"), order_row("2_1", "shipped")])
        self.inject("orders")
        r = self.daily()
        self.assertEqual(r["X-Cache"], "MISS")
        self.assertEqual(r.json()["totals"]["shipped_count"], before + 2)

    def test_a_payment_import_updates_profit_and_the_till_now_total(self):
        self.snap("orders_shipped", [order_row("1_1", "shipped")])
        self.inject("orders")
        overall = self.warm(lambda: self.get("/profit/overall/"))
        daily = self.warm(self.daily)
        self.import_payments([PaymentsIntoTheTableTests.PAID])
        r = self.get("/profit/overall/")
        self.assertEqual(r["X-Cache"], "MISS")
        self.assertEqual(float(r.json()["total_settled"]) - float(overall.json()["total_settled"]), 180.0)
        d = self.daily()
        self.assertEqual(d["X-Cache"], "MISS")
        self.assertEqual(d.json()["totals"]["delivered_count"], daily.json()["totals"]["delivered_count"] + 1)
        self.assertNotEqual(d.json()["totals"]["net_profit"], daily.json()["totals"]["net_profit"])

    def test_a_settled_order_moves_from_awaiting_payment_to_rto(self):
        self.snap("orders_shipped", [order_row("1_1", "shipped")])
        self.inject("orders")
        before = self.warm(self.daily).json()["totals"]
        self.snap("orders_shipped", [])
        self.snap("returns_completed_delivered", [return_row("1_1", "Delivered", kind="RTO",
                                                             delivered_date_iso="2026-10-28T10:00:00+0530")])
        self.inject("returns")                                              # settles 1_1 as RTO_COMPLETE
        after = self.daily()
        self.assertEqual(after["X-Cache"], "MISS")
        self.assertEqual((after.json()["totals"]["rto_count"], after.json()["totals"]["no_payment_count"]),
                         (before["rto_count"] + 1, before["no_payment_count"] - 1))

    def test_returns_and_the_returns_screen_stay_in_step(self):
        self.warm(lambda: self.get("/returns/"))
        self.snap("returns_intransit", [return_row("1_1", "In Transit")])
        self.inject("returns")
        r = self.get("/returns/")
        self.assertEqual(r["X-Cache"], "MISS")
        rows = r.json().get("results", r.json())
        self.assertIn("1_1", [x["suborder_no"] for x in rows])

    def test_a_write_the_worker_makes_directly_still_invalidates(self):
        self.warm(self.daily)
        # The Rails worker writes without Django's signals; it stamps the account instead.
        MeeshoAccount.objects.filter(pk=self.acct.pk).update(orders_changed_at=timezone.now() + dt.timedelta(seconds=5))
        self.assertEqual(self.daily()["X-Cache"], "MISS")

    def test_nothing_new_keeps_the_cached_answer(self):
        self.snap("orders_shipped", [order_row("1_1", "shipped")])
        self.inject("orders")
        self.warm(self.daily)
        self.inject("orders")                                               # the same read again: nothing changed
        self.assertEqual(self.daily()["X-Cache"], "HIT")
        self.snap("returns_intransit", [return_row("9_1", "In Transit")])
        self.inject("returns")
        self.warm(self.daily)
        res = self.inject("returns")                                        # every 10 minutes, the same returns
        self.assertEqual((res["created"], res["updated"]), (0, 0))
        self.assertEqual(self.daily()["X-Cache"], "HIT")
        self.assertIsNotNone(ReturnDelivery.objects.get(suborder_no="9_1").synced_at)


class PackingDeskTests(PipelineTestCase):
    def test_only_packages_whose_labels_were_downloaded_are_on_the_desk(self):
        day = timezone.localdate()
        for sub in ("1_1", "2_1", "3_1"):
            LabelOrder.objects.create(business=self.biz, order_id=sub, sku="diya-029", awb_number=f"AWB{sub}",
                                      uploaded_date=day, platform="meesho")
        LabelOrder.objects.create(business=self.biz, order_id="FK1", sku="diya-029", awb_number="FKAWB", uploaded_date=day,
                                  platform="flipkart")
        self.snap("orders_ready_to_ship", [order_row("1_1", "ready-to-ship", label="Downloaded"),
                                           order_row("2_1", "ready-to-ship", label="Not Downloaded")])
        q = self.api.get(f"{self.base}/order-scan/queue/", {"date": day.isoformat()}).json()
        self.assertEqual(sorted(i["order_id"] for i in q["items"]), ["1_1", "3_1", "FK1"])   # 3_1 has moved past ready to ship
        self.assertEqual(q["summary"]["assigned"], 3)
        self.assertEqual(q["summary"]["hidden_not_downloaded"], 1)
        self.assertEqual(q["summary"]["hidden_not_downloaded_orders"][0]["order_id"], "2_1")
        # Downloaded on Meesho: the next sync shows it, and the desk with it.
        self.snap("orders_ready_to_ship", [order_row("2_1", "ready-to-ship", label="Downloaded")])
        q = self.api.get(f"{self.base}/order-scan/queue/", {"date": day.isoformat()}).json()
        self.assertEqual((q["summary"]["assigned"], q["summary"]["hidden_not_downloaded"]), (4, 0))
        self.assertFalse(ScannedOrder.objects.exists())                     # looking records nothing
