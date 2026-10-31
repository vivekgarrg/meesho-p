"""
The Meesho sync's middleware (sync_middleware/): what the worker reads from
the Meesho panel → the app's tables, with each table's rules — and the cached
screens (profit…) invalidated when anything changed.
"""

import datetime as dt
from unittest import mock

from django.test import TestCase
from django.utils import timezone

from accounts.models import Business

from . import api_cache
from .models import MeeshoAccount, MeeshoSyncSnapshot, Order
from .sync_middleware import orders

DAY = dt.date(2026, 10, 30)


def row(n, tab, **kw):
    """An order row as the worker keeps it (PanelOrders.normalize)."""
    return {"tab": tab, "sub_order_num": f"{n}_1", "order_num": str(n), "created_iso": "2026-10-30T18:00:15+0530",
            "sku": "golden-plate", "quantity": 1, "variation": "Free Size", "product_name": "Golden Plate", **kw}


class OrdersMiddlewareTests(TestCase):
    def setUp(self):
        self.biz = Business.objects.create(name="Rudam")
        self.other = Business.objects.create(name="Elsewhere")

    def order(self, sub, status, day=DAY, ago=None, business=None, **kw):
        o = Order.objects.create(business=business or self.biz, sub_order_no=sub, reason_for_credit_entry=status, order_date=day, **kw)
        if ago is not None:
            Order.objects.filter(pk=o.pk).update(created_at=timezone.now() - ago)
        return o

    def table(self):
        return [(o.sub_order_no, o.reason_for_credit_entry, o.sku) for o in Order.objects.filter(business=self.biz).order_by("sub_order_no", "id")]

    def test_the_status_rules(self):
        m = orders.moves_on
        self.assertTrue(m(None, "PENDING"))
        self.assertTrue(m("PENDING", "HOLD"))
        self.assertTrue(m("READY_TO_SHIP", "SHIPPED"))
        self.assertTrue(m("READY_TO_SHIP", "CANCELLED"))
        self.assertFalse(m("SHIPPED", "READY_TO_SHIP"))
        self.assertFalse(m("RTO_COMPLETE", "SHIPPED"))
        self.assertFalse(m("DELIVERED", "CANCELLED"))
        self.assertTrue(m("CANCELLED", "READY_TO_SHIP"))                     # the live panel beats a CSV's cancel

    def test_the_orders_table_is_brought_up_to_date_like_an_orders_csv_upload(self):
        self.order("1_1", "PENDING", sku="old-sku", quantity=1)
        self.order("2_1", "PENDING", sku="golden-plate", size="Free Size", quantity=1, product_name="Golden Plate")
        self.order("3_1", "PENDING", business=self.other)                      # another business
        rows = [row(1, "pending"), row(2, "cancelled"), row(3, "cancelled")]
        res = orders.inject(self.biz, rows).as_dict()
        self.assertEqual(self.table(), [("1_1", "PENDING", "golden-plate"),                         # details refreshed
                                        ("2_1", "PENDING", "golden-plate"), ("2_1", "CANCELLED", "golden-plate"),   # a new status row
                                        ("3_1", "CANCELLED", "golden-plate")])                       # added
        added = Order.objects.get(business=self.biz, sub_order_no="3_1")
        self.assertEqual((added.order_date, added.size, added.order_source), (DAY, "Free Size", "Meesho panel sync"))
        self.assertEqual(Order.objects.filter(business=self.other).count(), 1)  # other businesses untouched
        self.assertEqual((res["added"], res["status_changed"], res["updated"], res["rejected"]), (1, 1, 1, 0))
        again = orders.inject(self.biz, rows).as_dict()                         # the next read: nothing new
        self.assertEqual((again["added"], again["status_changed"], again["updated"]), (0, 0, 0))
        self.assertEqual(Order.objects.filter(business=self.biz).count(), 4)

    def test_shipped_orders_move_on_with_their_packet_id_and_never_move_back(self):
        self.order("1_1", "READY_TO_SHIP", sku="golden-plate", size="Free Size", product_name="Golden Plate")
        self.order("2_1", "DELIVERED")
        self.order("3_1", "SHIPPED")
        res = orders.inject(self.biz, [row(1, "shipped", packet_id="KP1"), row(2, "shipped", packet_id="KP2"), row(3, "ready-to-ship")])
        latest = {o.sub_order_no: o for o in Order.latest_per_order(Order.objects.filter(business=self.biz))}
        self.assertEqual((latest["1_1"].reason_for_credit_entry, latest["1_1"].packet_id), ("SHIPPED", "KP1"))
        self.assertEqual((latest["2_1"].reason_for_credit_entry, latest["2_1"].packet_id), ("DELIVERED", "KP2"))   # further on: kept; details refreshed
        self.assertEqual(latest["3_1"].reason_for_credit_entry, "SHIPPED")      # not back to ready to ship
        self.assertEqual(res.counts["kept_further_on"], 2)

    def test_a_status_is_compared_with_the_orders_current_row_not_any_old_one(self):
        rts = self.order("2_1", "READY_TO_SHIP", ago=dt.timedelta(days=2), sku="golden-plate", size="Free Size", quantity=1, product_name="Golden Plate")
        self.order("2_1", "CANCELLED", ago=dt.timedelta(days=2) - dt.timedelta(hours=1), sku="golden-plate", size="Free Size", quantity=1, product_name="Golden Plate")
        orders.inject(self.biz, [row(2, "ready-to-ship")])
        latest = Order.latest_per_order(Order.objects.filter(business=self.biz)).get()
        self.assertEqual((latest.reason_for_credit_entry, latest.pk), ("READY_TO_SHIP", rts.pk))   # the old row is current again
        self.assertEqual(Order.objects.filter(business=self.biz).count(), 2)

    def test_a_new_status_row_takes_the_date_of_the_orders_latest_row(self):
        self.order("2_1", "DELIVERED", day=dt.date(2026, 9, 1), ago=dt.timedelta(days=3))
        self.order("2_1", "READY_TO_SHIP", day=dt.date(2026, 10, 20), ago=dt.timedelta(days=2))
        orders.inject(self.biz, [row(2, "cancelled")])
        self.assertEqual(Order.objects.get(sub_order_no="2_1", reason_for_credit_entry="CANCELLED").order_date, dt.date(2026, 10, 20))

    def test_rows_without_what_the_table_needs_are_refused_with_why(self):
        res = orders.inject(self.biz, [row(1, "pending"), {"tab": "pending"}, row(2, "nonsense"), row(3, "pending", created_iso="")]).as_dict()
        self.assertEqual(res["rejected"], 2)
        self.assertEqual(res["reject_reasons"], {"missing sub_order_num": 1, "unknown tab nonsense": 1})
        self.assertEqual((res["added"], res["no_date"]), (2, 1))              # kept, but counted: no order date

    def test_the_snapshots_are_read_in_tab_order_and_the_cached_screens_are_invalidated_once(self):
        acct = MeeshoAccount.objects.create(business=self.biz, phone_number="9", password_enc="x", status="ACTIVE")
        now = timezone.now()
        for tab, rows in (("pending", [row(1, "pending")]), ("ready_to_ship", [row(1, "ready-to-ship")])):
            MeeshoSyncSnapshot.objects.create(account=acct, endpoint=f"orders_{tab}", http_status=200, payload=rows, fetched_at=now)
        with mock.patch.object(api_cache, "bump") as bump:
            orders.inject(self.biz, orders.rows_of(acct))
        self.assertEqual(Order.objects.get().reason_for_credit_entry, "READY_TO_SHIP")   # the later tab wins
        bump.assert_called_once_with(self.biz.pk)                              # once, not per row: profit is recomputed


class LabelsInvalidateTheCacheTests(TestCase):
    def test_saving_labels_invalidates_every_business_they_belong_to(self):
        from types import SimpleNamespace
        from accounts.models import User
        from . import views
        from .test_label_engine import make_labels_pdf
        biz = Business.objects.create(name="Rudam")
        admin = User.objects.create_user(username="a", password="pw", role=User.ROLE_SUPER_ADMIN)
        with mock.patch.object(api_cache, "bump") as bump:
            res = views._process_labels_upload(SimpleNamespace(user=admin), biz, make_labels_pdf([("lota", "1_1", "X")]),
                                               "2026-10-31", crop_labels=False, platform="meesho")
        self.assertEqual(res.status_code, 200, getattr(res, "data", None))
        bump.assert_any_call(biz.pk)                                           # the bulk write still reaches the cache
