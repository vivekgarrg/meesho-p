"""Order Scan → Unshipped: scanned Meesho parcels until Meesho ships them, settled from the sync's lists."""

from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from . import scan_unshipped, views
from .models import MeeshoAccount, MeeshoSyncSnapshot, Order, ScannedOrder

S = ScannedOrder


class UnshippedTests(TestCase):
    def setUp(self):
        self.biz = Business.objects.create(name="Cosmify")
        self.user = User.objects.create_user(username="desk", password="pw", role=User.ROLE_BUSINESS_USER)
        Membership.objects.create(user=self.user, business=self.biz)
        self.acct = MeeshoAccount.objects.create(business=self.biz, phone_number="9000000001", password_enc="v1:x", status="ACTIVE")
        self.c = APIClient()
        self.c.force_authenticate(self.user)
        self.url = f"/api/business/{self.biz.id}/order-scan/unshipped/"
        self.today = views._current_business_date()

    def scan(self, sub, awb, status=S.STATUS_PACKED, days_ago=0, courier="Valmo"):
        return S.objects.create(business=self.biz, sub_order_no=sub, awb_number=awb, scanned_code=awb, status=status,
                                platform="meesho", courier_name=courier, scan_day=self.today - timedelta(days=days_ago),
                                last_scanned_at=timezone.now() - timedelta(days=days_ago), matched_from=S.MATCH_LABEL)

    def lists(self, endpoint, rows):
        MeeshoSyncSnapshot.objects.update_or_create(account=self.acct, endpoint=endpoint,
                                                    defaults={"http_status": 200, "fetched_at": timezone.now(), "payload": rows})

    def test_packed_parcels_wait_until_meesho_ships_them(self):
        self.scan("1_1", "VL1", days_ago=2)
        self.scan("2_1", "VL2")
        self.scan("3_1", "DL3", courier="Delhivery")
        self.lists("orders_ready_to_ship", [{"sub_order_num": "2_1", "awb": "VL2"}])
        d = self.c.get(self.url).data
        self.assertEqual((d["summary"]["unshipped"], d["summary"]["ready_to_ship"], d["summary"]["old"]), (3, 1, 1))
        self.assertEqual(d["rows"][0]["awb"], "VL1")                                # oldest first
        # Meesho ships VL2; the orders table (written by the same sync) says 3_1 shipped.
        self.lists("orders_ready_to_ship", [])
        self.lists("orders_shipped", [{"sub_order_num": "2_1", "awb": "VL2"}])
        Order.objects.create(business=self.biz, sub_order_no="3_1", reason_for_credit_entry="SHIPPED")
        d = self.c.get(self.url).data
        self.assertEqual((d["summary"]["unshipped"], d["summary"]["gone"]), (1, 2))
        self.assertEqual([r["awb"] for r in d["rows"] if r["state"] == "unshipped"], ["VL1"])
        vl2 = S.objects.get(sub_order_no="2_1")
        self.assertEqual((vl2.ship_status, vl2.status), (S.SHIP_SHIPPED, S.STATUS_DISPATCHED))
        self.assertEqual({c["courier"]: c["unshipped"] for c in d["by_courier"]}, {"Valmo": 1, "Delhivery": 0})

    def test_gone_a_day_ago_is_off_the_screen(self):
        s = self.scan("1_1", "VL1")
        S.objects.filter(pk=s.pk).update(ship_status=S.SHIP_SHIPPED, updated_at=timezone.now() - timedelta(hours=30))
        self.assertEqual(self.c.get(self.url).data["rows"], [])

    def test_cancelled_after_packing_and_never_back_to_unshipped(self):
        self.scan("1_1", "VL1")
        self.lists("orders_cancelled", [{"sub_order_num": "1_1"}])
        d = self.c.get(self.url).data
        self.assertEqual((d["summary"]["unshipped"], d["summary"]["cancelled"]), (0, 1))
        # Shipped never moves back to "not shipped" when a sheet still says READY_TO_SHIP.
        s = self.scan("2_1", "VL2")
        self.lists("orders_shipped", [{"sub_order_num": "2_1", "awb": "VL2"}])
        Order.objects.create(business=self.biz, sub_order_no="2_1", reason_for_credit_entry="READY_TO_SHIP")
        self.assertEqual(scan_unshipped.settle([self.biz.id]), 1)
        s.refresh_from_db()
        self.assertEqual(s.ship_status, S.SHIP_SHIPPED)
        self.lists("orders_shipped", [])
        self.assertEqual(scan_unshipped.settle([self.biz.id]), 0)
        s.refresh_from_db()
        self.assertEqual(s.ship_status, S.SHIP_SHIPPED)

    def test_flipkart_and_old_scans_are_left_out(self):
        self.scan("1_1", "VL1", days_ago=scan_unshipped.DAYS + 1)
        S.objects.create(business=self.biz, sub_order_no="FK1", awb_number="FMP1", scanned_code="FMP1", status=S.STATUS_PACKED,
                         platform="flipkart", scan_day=self.today, last_scanned_at=timezone.now())
        self.assertEqual(self.c.get(self.url).data["summary"]["unshipped"], 0)

    def test_the_sync_settles_scans_after_writing_orders(self):
        from django.core.management import call_command
        import io
        self.scan("1_1", "VL1")
        self.lists("orders_shipped", [{"sub_order_num": "1_1", "awb": "VL1", "tab": "shipped"}])
        out = io.StringIO()
        call_command("meesho_inject", "--account", str(self.acct.id), "--kind", "orders", stdout=out)
        self.assertIn('"scans_settled": 1', out.getvalue())
        self.assertEqual(S.objects.get(sub_order_no="1_1").ship_status, S.SHIP_SHIPPED)
