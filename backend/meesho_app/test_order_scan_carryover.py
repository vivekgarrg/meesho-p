"""Past 12 pm the desk keeps the previous day's list until the new day has work;
an orders-sheet upload reports how many dispatched parcels went out."""

import io
from datetime import timedelta

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from .models import LabelOrder, Order, ScannedOrder
from .test_flipkart_model import order_row, orders_workbook
from .views import _current_business_date


class CarryTestCase(TestCase):
    def setUp(self):
        self.biz = Business.objects.create(name="Rudam")
        self.user = User.objects.create_user(username="desk", password="pw", role=User.ROLE_SUPER_ADMIN)
        Membership.objects.create(user=self.user, business=self.biz)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.base = f"/api/business/{self.biz.id}"
        self.today = _current_business_date()
        self.yesterday = self.today - timedelta(days=1)

    def scan(self, sub, status=ScannedOrder.STATUS_DISPATCHED, day=None, **kw):
        return ScannedOrder.objects.create(business=self.biz, sub_order_no=sub, scanned_code=sub, status=status,
                                           scan_day=day or self.yesterday, last_scanned_at=timezone.now(),
                                           matched_from=ScannedOrder.MATCH_LABEL, **kw)


class CarryOverTests(CarryTestCase):
    def setUp(self):
        super().setUp()
        for i in range(3):
            LabelOrder.objects.create(order_id=f"Y{i}_1", awb_number=f"YAWB{i}", courier_name="Valmo",
                                      uploaded_date=self.yesterday, business=self.biz)
        self.scan("Y0_1", awb_number="YAWB0")

    def queue(self, **params):
        return self.client.get(f"{self.base}/order-scan/queue/", params).data

    def test_previous_days_orders_stay_up_until_today_has_work(self):
        q = self.queue()
        self.assertEqual(q["date"], self.yesterday.isoformat())
        self.assertTrue(q["carried_over"])
        self.assertEqual(q["summary"]["assigned"], 3)
        self.assertEqual(q["summary"]["scanned"], 1)

    def test_the_first_scan_of_the_day_replaces_them(self):
        self.client.post(f"{self.base}/order-scan/", {"code": "SOMETHING-NEW"}, format="json")
        q = self.queue()
        self.assertEqual(q["date"], self.today.isoformat())
        self.assertFalse(q["carried_over"])

    def test_a_leftover_from_the_shown_list_keeps_it_up(self):
        r = self.client.post(f"{self.base}/order-scan/", {"code": "YAWB2", "status": "DISPATCHED"}, format="json")
        self.assertEqual(ScannedOrder.objects.get(pk=r.data["row"]["id"]).scan_day, self.yesterday)
        q = self.queue()
        self.assertEqual(q["date"], self.yesterday.isoformat())
        self.assertEqual(q["summary"]["scanned"], 2)

    def test_todays_labels_replace_them(self):
        LabelOrder.objects.create(order_id="T0_1", awb_number="TAWB0", uploaded_date=self.today, business=self.biz)
        q = self.queue()
        self.assertEqual(q["date"], self.today.isoformat())
        self.assertEqual(q["summary"]["assigned"], 1)          # only today's own — nothing comes forward by itself

    def test_a_day_picked_by_hand_is_shown_as_is(self):
        q = self.queue(date=self.today.isoformat())
        self.assertEqual(q["date"], self.today.isoformat())
        self.assertFalse(q["carried_over"])
        self.assertEqual(q["summary"]["assigned"], 0)

    def test_a_long_quiet_spell_starts_on_today(self):
        LabelOrder.objects.all().update(uploaded_date=self.today - timedelta(days=20))
        ScannedOrder.objects.all().update(scan_day=self.today - timedelta(days=20))
        self.assertEqual(self.queue()["date"], self.today.isoformat())


def meesho_orders_csv(rows):
    out = io.StringIO()
    out.write("Reason for Credit Entry,Sub Order No,Order Date,SKU,Quantity\n")
    for status, sub in rows:
        out.write(f"{status},{sub},2026-10-20,SKU,1\n")
    return SimpleUploadedFile("Orders.csv", out.getvalue().encode())


class UploadCheckTests(CarryTestCase):
    def test_meesho_orders_upload_reports_dispatched_vs_shipped(self):
        self.scan("A_1")                                     # dispatched, sheet: shipped
        self.scan("B_1")                                     # dispatched, sheet: ready to ship
        self.scan("C_1", ship_status=ScannedOrder.SHIP_SHIPPED, ship_status_raw="DELIVERED")  # already known
        self.scan("D_1")                                     # dispatched, not in the sheet
        self.scan("E_1", status=ScannedOrder.STATUS_PACKED)  # packed only, sheet: shipped
        r = self.client.post(f"{self.base}/upload-orders/", {"file": meesho_orders_csv(
            [("SHIPPED", "A_1"), ("READY_TO_SHIP", "B_1"), ("DELIVERED", "C_1"), ("SHIPPED", "E_1"), ("SHIPPED", "Z_1")])},
            format="multipart")
        self.assertEqual(r.status_code, 201, r.data)
        s = r.data["scan_check"]
        self.assertEqual(s["scanned_in_file"], 4)            # D_1 isn't in the file, Z_1 was never scanned
        self.assertEqual(s["dispatched"], 3)
        self.assertEqual(s["dispatched_shipped"], 2)
        self.assertEqual(s["dispatched_not_shipped"], 1)
        self.assertEqual(s["packed_not_dispatched"], 1)
        self.assertEqual(s["newly_shipped"], 2)              # A_1 and E_1
        self.assertEqual([w["order"] for w in s["waiting"]], ["B_1"])
        self.assertEqual(ScannedOrder.objects.get(sub_order_no="A_1").ship_status, ScannedOrder.SHIP_SHIPPED)
        self.assertEqual(ScannedOrder.objects.get(sub_order_no="D_1").ship_status, ScannedOrder.SHIP_UNKNOWN)
        self.assertEqual(Order.objects.filter(business=self.biz).count(), 5)

    def test_a_shipped_parcel_is_never_downgraded_by_an_old_sheet(self):
        self.scan("A_1", ship_status=ScannedOrder.SHIP_SHIPPED, ship_status_raw="SHIPPED")
        r = self.client.post(f"{self.base}/upload-orders/", {"file": meesho_orders_csv([("READY_TO_SHIP", "A_1")])},
                             format="multipart")
        self.assertEqual(r.data["scan_check"]["dispatched_shipped"], 1)
        self.assertEqual(ScannedOrder.objects.get(sub_order_no="A_1").ship_status, ScannedOrder.SHIP_SHIPPED)

    def test_flipkart_orders_upload_reports_too(self):
        self.scan("111", platform="flipkart")
        self.scan("222", platform="flipkart")
        r = self.client.post(f"{self.base}/flipkart-orders/upload/", {"file": orders_workbook([
            order_row("111", "APPROVED", dispatched_date="2026-10-21"),   # the dispatch date proves it left
            order_row("222", "READY_TO_DISPATCH"),
        ])}, format="multipart")
        self.assertEqual(r.status_code, 200, r.data)
        s = r.data["scan_check"]
        self.assertEqual((s["dispatched"], s["dispatched_shipped"], s["dispatched_not_shipped"]), (2, 1, 1))


class ShiftTests(CarryTestCase):
    """Only the day's own orders are listed; an admin moves earlier unsent ones onto it."""

    def setUp(self):
        super().setUp()
        for i in range(6):
            LabelOrder.objects.create(order_id=f"Y{i}_1", awb_number=f"YAWB{i}", courier_name="Valmo",
                                      uploaded_date=self.yesterday, business=self.biz)
        LabelOrder.objects.create(order_id="OLD_1", awb_number="OLDAWB", courier_name="Valmo",
                                  uploaded_date=self.today - timedelta(days=12), business=self.biz)
        LabelOrder.objects.create(order_id="T0_1", awb_number="TAWB0", courier_name="Valmo",
                                  uploaded_date=self.today, business=self.biz)
        self.scan("Y0_1", awb_number="YAWB0")                                   # dispatched: gone
        self.scan("Y1_1", status=ScannedOrder.STATUS_PACKED, awb_number="YAWB1")  # packed, still here
        self.scan("Y2_1", status=ScannedOrder.STATUS_PACKED, awb_number="YAWB2",
                  ship_status=ScannedOrder.SHIP_SHIPPED)                        # marketplace: shipped
        Order.objects.create(business=self.biz, sub_order_no="Y3_1", reason_for_credit_entry="CANCELLED")
        Order.objects.create(business=self.biz, sub_order_no="Y4_1", reason_for_credit_entry="READY_TO_SHIP")
        Order.objects.create(business=self.biz, sub_order_no="Y4_1", reason_for_credit_entry="SHIPPED")
        # Y5_1: never scanned, no sheet — not sent.

    def queue(self, day=None, client=None):
        return (client or self.client).get(f"{self.base}/order-scan/queue/", {"date": (day or self.today).isoformat()}).data

    def shift(self, items, **body):
        return self.client.post(f"{self.base}/order-scan/shift/", {
            "items": [{"business_id": self.biz.id, "order_id": o} for o in items], **body}, format="json")

    def test_the_latest_day_shows_only_its_own_orders(self):
        q = self.queue()
        self.assertEqual([i["order_id"] for i in q["items"]], ["T0_1"])
        self.assertEqual(q["summary"]["by_courier"][0]["assigned"], 1)

    def test_the_admin_is_offered_the_earlier_unsent_orders(self):
        unsent = self.queue()["earlier_unsent"]
        self.assertEqual({i["order_id"] for i in unsent["items"]}, {"Y1_1", "Y5_1"})
        self.assertEqual(unsent["by_day"], [{"day": self.yesterday.isoformat(), "count": 2}])

    def test_moving_them_puts_them_on_the_latest_day_only(self):
        r = self.shift(["Y1_1", "Y5_1"], to_day=self.today.isoformat())
        self.assertEqual(r.data["moved"], 2)
        q = self.queue()
        self.assertEqual({i["order_id"]: i["shifted_from"] for i in q["items"]},
                         {"T0_1": None, "Y1_1": self.yesterday.isoformat(), "Y5_1": self.yesterday.isoformat()})
        self.assertEqual(q["summary"]["moved_in"], 2)
        self.assertEqual(q["earlier_unsent"]["count"], 0)
        self.assertNotIn("Y5_1", {i["order_id"] for i in self.queue(self.yesterday)["items"]})
        # The label's own upload date is untouched.
        self.assertEqual(LabelOrder.objects.get(order_id="Y5_1").uploaded_date, self.yesterday)

    def test_a_scan_of_a_moved_order_counts_today(self):
        self.shift(["Y5_1"], to_day=self.today.isoformat())
        self.client.post(f"{self.base}/order-scan/", {"code": "YAWB5", "status": "DISPATCHED"}, format="json")
        q = self.queue()
        item = next(i for i in q["items"] if i["order_id"] == "Y5_1")
        self.assertEqual(item["state"], "DISPATCHED")
        self.assertEqual(q["summary"]["off_list"], 0)

    def test_undo_moves_them_back(self):
        self.shift(["Y5_1"], to_day=self.today.isoformat())
        r = self.shift(["Y5_1"], undo=True)
        self.assertEqual(r.data["moved"], 1)
        self.assertNotIn("Y5_1", {i["order_id"] for i in self.queue()["items"]})
        self.assertIn("Y5_1", {i["order_id"] for i in self.queue(self.yesterday)["items"]})

    def test_moved_orders_are_no_longer_late_in_the_alerts(self):
        before = self.client.get(f"{self.base}/order-scan/alerts/").data["not_packed"]["count"]
        self.shift(["Y5_1"], to_day=self.today.isoformat())
        after = self.client.get(f"{self.base}/order-scan/alerts/").data["not_packed"]["count"]
        self.assertEqual(before - after, 1)

    def test_only_an_admin_may_move_or_see_them(self):
        worker = User.objects.create_user(username="w", password="pw", role=User.ROLE_BUSINESS_USER)
        Membership.objects.create(user=worker, business=self.biz)
        c = APIClient()
        c.force_authenticate(worker)
        self.assertIsNone(self.queue(client=c)["earlier_unsent"])
        r = c.post(f"{self.base}/order-scan/shift/", {"items": [{"business_id": self.biz.id, "order_id": "Y5_1"}],
                                                      "to_day": self.today.isoformat()}, format="json")
        self.assertEqual(r.status_code, 403)

    def test_never_to_a_day_not_started_or_backwards(self):
        r = self.shift(["Y5_1"], to_day=(self.today + timedelta(days=1)).isoformat())
        self.assertEqual(r.status_code, 400)
        r = self.shift(["T0_1"], to_day=self.yesterday.isoformat())
        self.assertEqual((r.data["moved"], r.data["skipped"]), (0, 1))


class CourierSummaryTests(CarryTestCase):
    def test_packed_per_courier_for_the_day(self):
        self.scan("A_1", status=ScannedOrder.STATUS_PACKED, day=self.today, courier_name="Valmo", qty=2)
        self.scan("B_1", day=self.today, courier_name="valmo ")                       # dispatched
        self.scan("C_1", status=ScannedOrder.STATUS_PACKED, day=self.today, courier_name="Delhivery")
        self.scan("D_1", status=ScannedOrder.STATUS_ON_HOLD, day=self.today, courier_name="Delhivery")  # not packed
        self.scan("E_1", status=ScannedOrder.STATUS_PACKED, day=self.yesterday, courier_name="Valmo")   # other day
        d = self.client.get(f"{self.base}/order-scan/courier-summary/", {"date": self.today.isoformat()}).data
        rows = {c["courier"]: (c["packed"], c["dispatched"], c["pieces"]) for c in d["couriers"]}
        self.assertEqual(rows, {"Valmo": (2, 1, 3), "Delhivery": (1, 0, 1)})
        self.assertEqual(d["total"], {"packed": 3, "dispatched": 1, "pieces": 4})
        self.assertEqual(d["couriers"][0]["by_business"], [{"business": "Rudam", "packed": 2}])

    def test_defaults_to_todays_packing_day(self):
        self.scan("A_1", status=ScannedOrder.STATUS_PACKED, day=self.today, courier_name="Valmo")
        d = self.client.get(f"{self.base}/order-scan/courier-summary/").data
        self.assertEqual((d["date"], d["total"]["packed"]), (self.today.isoformat(), 1))
