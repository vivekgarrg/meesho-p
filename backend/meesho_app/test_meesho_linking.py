"""Meesho Orders → Order linking: AWB ↔ packet, PACKED in Order Scan, couriers, and the log."""

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from . import views
from .models import (LabelOrder, MeeshoAccount, MeeshoCourier, MeeshoLinkLog, MeeshoPacketLink, MeeshoSyncSnapshot,
                     ScannedOrder)


class OrderLinkingTests(TestCase):
    def setUp(self):
        self.biz = Business.objects.create(name="Cosmify")
        self.user = User.objects.create_user(username="desk", password="pw", role=User.ROLE_BUSINESS_USER)
        Membership.objects.create(user=self.user, business=self.biz)
        acct = MeeshoAccount.objects.create(business=self.biz, phone_number="9000000001", password_enc="v1:x", status="ACTIVE")
        MeeshoSyncSnapshot.objects.create(account=acct, endpoint="orders_ready_to_ship", http_status=200, fetched_at=timezone.now(), payload=[
            {"sub_order_num": "11_1", "sku": "lota", "awb": "VL1001", "packet_id": "KP4AUSE32034836", "carrier_id": 19},
            {"sub_order_num": "12_1", "sku": "diya", "awb": "VL1002", "packet_id": "KP2SECT43976500", "carrier_id": 19},
            {"sub_order_num": "13_1", "sku": "thali", "awb": "DL2001", "carrier_id": 4},
        ])
        today = views._current_business_date()
        for oid, awb, courier in (("11_1", "VL1001", "Valmo"), ("12_1", "VL1002", "Valmo"), ("13_1", "DL2001", "Delhivery")):
            LabelOrder.objects.create(order_id=oid, awb_number=awb, courier_name=courier, uploaded_date=today, business=self.biz, sku="x")
        self.c = APIClient()
        self.c.force_authenticate(self.user)
        self.base = f"/api/business/{self.biz.id}/meesho-orders/linking/"

    def link(self, awb, packet, **kw):
        return self.c.post(self.base, {"awb": awb, "packet_id": packet, **kw}, format="json")

    def test_a_link_is_checked_stored_and_marks_the_parcel_packed(self):
        MeeshoCourier.objects.create(carrier_id=19, name="Valmo")
        r = self.link(" vl1001 ", "kp4ause32034836")                              # as a scanner might send it
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual((r.data["link"]["check"], r.data["link"]["courier"], r.data["link"]["sub_order_no"]), ("MATCH", "Valmo", "11_1"))
        scan = ScannedOrder.objects.get(business=self.biz, sub_order_no="11_1")
        self.assertEqual(scan.status, ScannedOrder.STATUS_PACKED)                  # packed in Order Scan
        link = MeeshoPacketLink.objects.get()
        self.assertEqual((link.awb_number, link.packet_id, link.scanned_order_id, link.carrier_id), ("VL1001", "KP4AUSE32034836", scan.pk, 19))
        self.assertTrue(MeeshoLinkLog.objects.get().ok)
        d = self.c.get(self.base).data
        self.assertEqual((d["count"], d["matched"], d["by_courier"]), (1, 1, [{"courier": "Valmo", "count": 1}]))

    def test_scanned_the_other_way_round_still_links(self):
        self.assertEqual(self.link("KP4AUSE32034836", "VL1001").status_code, 201)

    def test_a_packet_meesho_doesnt_have_for_that_awb_is_refused_unless_linked_anyway(self):
        r = self.link("VL1001", "KP2SECT43976500")
        self.assertEqual((r.status_code, r.data["code"], r.data["can_override"]), (409, "packet_mismatch", True))
        self.assertFalse(ScannedOrder.objects.exists())                           # nothing marked packed
        log = MeeshoLinkLog.objects.get()
        self.assertEqual((log.ok, log.details["meesho_packet"]), (False, "KP4AUSE32034836"))
        r = self.link("VL1001", "KP2SECT43976500", override=True)
        self.assertEqual((r.status_code, r.data["link"]["check"]), (201, "OVERRIDDEN"))

    def test_a_packet_already_linked_to_another_awb_is_refused(self):
        self.link("DL2001", "KP9ZZZZ12345678")                                    # Meesho knows no packet for it yet
        r = self.link("VL1002", "KP9ZZZZ12345678", override=False)
        self.assertEqual(r.data["code"], "packet_mismatch")                        # Meesho has another packet for VL1002
        MeeshoSyncSnapshot.objects.update(payload=[{"sub_order_num": "12_1", "awb": "VL1002", "carrier_id": 19}])
        r = self.link("VL1002", "KP9ZZZZ12345678")
        self.assertEqual((r.status_code, r.data["code"], r.data["other_awb"]), (409, "packet_taken", "DL2001"))

    def test_bad_scans_are_refused_and_logged(self):
        for awb, packet, code in (("VL1001", "", "missing"), ("VL1001", "12345", "not_a_packet"),
                                  ("KP4AUSE32034836", "KP2SECT43976500", "two_packets"), ("NOPE999", "KP1AAAAAA11", "unknown_awb")):
            r = self.link(awb, packet)
            self.assertEqual(r.data["code"], code, (awb, packet))
        self.assertEqual(MeeshoLinkLog.objects.filter(ok=False).count(), 4)
        self.assertFalse(ScannedOrder.objects.exists())

    def test_a_failure_is_retried_from_the_log_with_the_value_put_right(self):
        r = self.link("VL1001", "KP2SECT43976500")                                # wrong packet scanned
        log_id = r.data["log_id"]
        logs = self.c.get(self.base + "logs/?errors=1").data
        self.assertEqual([l["id"] for l in logs["logs"]], [log_id])
        r = self.c.post(f"{self.base}logs/{log_id}/", {"packet_id": "KP4AUSE32034836"}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertTrue(MeeshoLinkLog.objects.get(pk=log_id).resolved)
        self.assertEqual(self.c.get(self.base + "logs/?errors=1").data["logs"], [])
        self.assertEqual(MeeshoLinkLog.objects.filter(action="RETRY", ok=True).count(), 1)

    def test_couriers_are_learned_from_shipments_and_their_labels(self):
        r = self.c.post(self.base + "couriers/refresh/")
        self.assertEqual(r.status_code, 200, r.data)
        names = {c.carrier_id: (c.name, c.shipments_seen) for c in MeeshoCourier.objects.all()}
        self.assertEqual(names, {19: ("Valmo", 2), 4: ("Delhivery", 1)})
        self.assertEqual(MeeshoLinkLog.objects.get().action, "COURIERS")

    def test_unlink_keeps_the_order_scan_record(self):
        link_id = self.link("VL1001", "KP4AUSE32034836").data["link"]["id"]
        self.assertEqual(self.c.delete(f"{self.base}{link_id}/").status_code, 204)
        self.assertFalse(MeeshoPacketLink.objects.exists())
        self.assertTrue(ScannedOrder.objects.filter(status="PACKED").exists())
        self.assertEqual(list(MeeshoLinkLog.objects.order_by("pk").values_list("action", flat=True)), ["LINK", "UNLINK"])
