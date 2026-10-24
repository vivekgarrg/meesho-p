"""Order scanning: fast exact lookups, Flipkart parcels, unmatched codes kept,
courier tiles, and the "not sent" alerts."""

from datetime import timedelta
from unittest import mock

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from .models import FlipkartOrder, LabelOrder, Order, ScannedOrder
from .views import _current_business_date


class ScanTestCase(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="desk", password="pw", role=User.ROLE_SUPER_ADMIN)
        self.business = Business.objects.create(name="B")
        self.other = Business.objects.create(name="B2")
        for b in (self.business, self.other):
            Membership.objects.create(user=self.user, business=b)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.base = f"/api/business/{self.business.id}/order-scan"
        self.today = _current_business_date()

    def label(self, oid, awb, courier="Valmo", day=None, platform="meesho", business=None):
        return LabelOrder.objects.create(order_id=oid, awb_number=awb, courier_name=courier, sku="LOTA-1", qty=1,
                                         uploaded_date=day or self.today, platform=platform,
                                         business=business or self.business)

    def scan(self, code, platform=None, status="PACKED"):
        body = {"code": code, "status": status}
        if platform:
            body["platform"] = platform
        return self.client.post(self.base + "/", body, format="json")


class ResolveTests(ScanTestCase):
    def test_exact_awb_and_order_id(self):
        self.label("S1_1", "VL001")
        r = self.scan("vl001")
        self.assertEqual((r.data["matched_from"], r.data["row"]["sub_order_no"]), ("LABEL", "S1_1"))
        r = self.scan("S1_1")
        self.assertTrue(r.data["already_scanned"])

    def test_sibling_business_parcel_is_filed_there(self):
        self.label("S9_1", "VL009", business=self.other)
        r = self.scan("VL009")
        self.assertEqual((r.data["business_name"], r.data["cross_business"]), ("B2", True))

    def test_partial_match_only_over_recent_labels(self):
        self.label("OLD_1", "XB-77777777", day=self.today - timedelta(days=200))
        self.label("NEW_1", "XB-88888888")
        self.assertEqual(self.scan("88888888").data["row"]["sub_order_no"], "NEW_1")
        self.assertEqual(self.scan("77777777").data["matched_from"], "NONE")

    def test_flipkart_parcel_by_tracking_id(self):
        FlipkartOrder.objects.create(business=self.business, order_item_id="FKI-1", order_id="OD1",
                                     delivery_tracking_id="FMPP1234567", sku="BOWL", logistics_partner="Ekart",
                                     order_item_status="READY_TO_DISPATCH")
        r = self.scan("FMPP1234567", platform="flipkart")
        row = r.data["row"]
        self.assertEqual((r.data["matched_from"], row["platform"], row["sub_order_no"], row["courier_name"]),
                         ("FLIPKART", "flipkart", "FKI-1", "Ekart"))
        self.assertEqual(r.data["ship_status"], "NOT_SHIPPED")
        # A Flipkart parcel is still recognised when the desk is on Meesho.
        FlipkartOrder.objects.create(business=self.business, order_item_id="FKI-2", order_id="OD2",
                                     delivery_tracking_id="FMPP999", order_item_status="SHIPPED")
        r = self.scan("FMPP999")
        self.assertEqual((r.data["row"]["platform"], r.data["ship_status"]), ("flipkart", "SHIPPED"))

    def test_unmatched_code_is_saved_with_the_desks_platform(self):
        r = self.scan("NOTHING-KNOWS-THIS", platform="flipkart")
        self.assertEqual(r.status_code, 201)
        row = ScannedOrder.objects.get()
        self.assertEqual((row.matched_from, row.platform, row.sub_order_no), ("NONE", "flipkart", "NOTHING-KNOWS-THIS"))
        r = self.scan("NOTHING-KNOWS-THIS")
        self.assertTrue(r.data["already_scanned"])
        self.assertEqual(ScannedOrder.objects.count(), 1)

    def test_unmatched_code_links_up_after_its_label_arrives(self):
        self.scan("VL555")
        self.label("S5_1", "VL555", courier="Delhivery")
        r = self.client.post(self.base + "/refresh-ship/", {}, format="json")
        self.assertEqual(r.data["relinked"], 1)
        row = ScannedOrder.objects.get()
        self.assertEqual((row.matched_from, row.sub_order_no, row.courier_name), ("LABEL", "S5_1", "Delhivery"))

    def test_stats_count_platforms(self):
        self.label("S1_1", "VL001")
        self.scan("VL001")
        self.scan("UNKNOWN-X", platform="flipkart")
        stats = self.client.get(self.base + "/").data["stats"]
        self.assertEqual((stats["total"], stats["meesho"], stats["flipkart"], stats["unrecognised"]), (2, 1, 1, 1))


class CourierTileTests(ScanTestCase):
    def test_queue_counts_scanned_and_left_per_courier(self):
        for i in range(3):
            self.label(f"V{i}_1", f"VAL{i}", courier="Valmo")
        self.label("D1_1", "DEL1", courier="Delhivery ")
        self.label("D2_1", "DEL2", courier="delhivery")
        self.scan("VAL0")
        self.scan("DEL1", status="DISPATCHED")
        self.scan("STRAY-CODE")
        s = self.client.get(self.base + "/queue/", {"date": self.today.isoformat(), "platform": "meesho"}).data["summary"]
        tiles = {c["courier"]: (c["assigned"], c["scanned"], c["left"], c["dispatched"]) for c in s["by_courier"]}
        self.assertEqual(tiles, {"Valmo": (3, 1, 2, 0), "Delhivery": (2, 1, 1, 1)})
        self.assertEqual((s["off_list"], s["off_list_unrecognised"]), (1, 1))


class AlertTests(ScanTestCase):
    def test_not_sent_orders_are_flagged(self):
        yesterday = self.today - timedelta(days=1)
        self.label("A1_1", "AWB1", day=yesterday)                     # never scanned → not packed
        self.label("A2_1", "AWB2", day=yesterday)                     # cancelled on Meesho → not flagged
        Order.objects.create(business=self.business, sub_order_no="A2_1", reason_for_credit_entry="CANCELLED")
        self.label("A3_1", "AWB3", day=yesterday)
        self.scan("AWB3")                                             # packed …
        old = timezone.now() - timedelta(hours=30)
        ScannedOrder.objects.filter(sub_order_no="A3_1").update(last_scanned_at=old)   # … 30 hours ago
        self.label("A4_1", "AWB4", day=yesterday)
        self.scan("AWB4", status="DISPATCHED")
        ScannedOrder.objects.filter(sub_order_no="A4_1").update(last_scanned_at=old, ship_status="NOT_SHIPPED")
        self.scan("NOBODY-KNOWS")
        a = self.client.get(self.base + "/alerts/").data
        self.assertEqual([i["order_id"] for i in a["not_packed"]["items"]], ["A1_1"])
        self.assertEqual([i["order_id"] for i in a["not_dispatched"]["items"]], ["A3_1"])
        self.assertEqual([i["order_id"] for i in a["not_shipped"]["items"]], ["A4_1"])
        self.assertEqual(a["unrecognised"]["count"], 1)
        self.assertEqual(a["total"], 4)

    def test_todays_work_is_not_late(self):
        self.label("T1_1", "TT1")
        self.scan("TT1")
        a = self.client.get(self.base + "/alerts/").data
        self.assertEqual(a["total"], 0)

    def test_overview_may_read_the_alerts(self):
        from accounts.nav import owners_for_api_path
        self.assertIn("/", owners_for_api_path("order-scan/alerts/"))
        self.assertNotIn("/", owners_for_api_path("order-scan/queue/"))


class SpeedTests(ScanTestCase):
    def test_a_known_awb_needs_no_partial_search(self):
        self.label("S1_1", "VL001")
        from django.db import connection
        from django.test.utils import CaptureQueriesContext
        with CaptureQueriesContext(connection) as ctx:
            self.scan("VL001")
        self.assertFalse([q for q in ctx.captured_queries if "LIKE %" in q["sql"] and "label_orders" in q["sql"]])

    def test_awb_is_indexed(self):
        names = {i.name for i in LabelOrder._meta.indexes}
        self.assertIn("label_biz_awb_idx", names)


class PackingDayTests(ScanTestCase):
    """A packing day runs noon to noon; scans count toward the day the desk has open."""

    def test_scan_counts_toward_todays_packing_day_by_default(self):
        self.scan("ANY-CODE-1")
        self.assertEqual(ScannedOrder.objects.get().scan_day, self.today)
        self.assertEqual(self.client.get(self.base + "/").data["stats"]["scanned_today"], 1)

    def test_previous_day_can_be_scanned_on_purpose(self):
        yesterday = self.today - timedelta(days=1)
        self.label("Y1_1", "YAWB1", day=yesterday)
        r = self.client.post(self.base + "/", {"code": "YAWB1", "status": "PACKED", "day": yesterday.isoformat()}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["row"]["scan_day"], yesterday.isoformat())
        self.client.post(self.base + "/", {"code": "STRAY-Y", "day": yesterday.isoformat()}, format="json")
        q = self.client.get(self.base + "/queue/", {"date": yesterday.isoformat()}).data
        self.assertEqual(q["summary"]["by_courier"][0]["scanned"], 1)
        self.assertEqual(q["summary"]["off_list"], 1)          # the stray counts for yesterday …
        today_q = self.client.get(self.base + "/queue/", {"date": self.today.isoformat()}).data
        self.assertEqual(today_q["summary"]["off_list"], 0)    # … not today
        self.assertFalse(q["is_current_day"])
        self.assertIn(yesterday.isoformat(), today_q["dates"])

    def test_future_day_is_refused(self):
        r = self.client.post(self.base + "/", {"code": "X1", "day": (self.today + timedelta(days=1)).isoformat()}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertFalse(ScannedOrder.objects.exists())

    def test_counts_start_fresh_at_noon(self):
        from datetime import datetime
        tz = timezone.get_current_timezone()
        with mock.patch("django.utils.timezone.now", return_value=datetime(2026, 10, 23, 11, 59, tzinfo=tz)):
            self.client.post(self.base + "/", {"code": "BEFORE-NOON"}, format="json")
        with mock.patch("django.utils.timezone.now", return_value=datetime(2026, 10, 23, 12, 1, tzinfo=tz)):
            self.client.post(self.base + "/", {"code": "AFTER-NOON"}, format="json")
        days = dict(ScannedOrder.objects.values_list("scanned_code", "scan_day"))
        self.assertEqual(str(days["BEFORE-NOON"]), "2026-10-22")
        self.assertEqual(str(days["AFTER-NOON"]), "2026-10-23")
