"""Return Scan: each day's returns from the Delivered sheet are scanned off as they
arrive, courier by courier; in-transit ones are tracked; missed ones are flagged."""

from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Business, BusinessProfile, Membership, User

from .models import LabelOrder, ReturnDelivery, ReturnScan


class ReturnDeskTests(TestCase):
    def setUp(self):
        self.a = Business.objects.create(name="Rudam")
        self.b = Business.objects.create(name="Cosmify")
        self.user = User.objects.create_user(username="desk", password="pw", role=User.ROLE_BUSINESS_USER)
        for biz in (self.a, self.b):
            Membership.objects.create(user=self.user, business=biz)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.base = f"/api/business/{self.a.id}/return-scan"
        self.today = timezone.localdate()
        d = self.today
        mk = lambda biz, sub, awb, courier, **kw: ReturnDelivery.objects.create(
            business=biz, suborder_no=sub, awb_number=awb, courier_partner=courier, sku="SKU", **kw)
        mk(self.a, "A1_1", "VLR1", "Valmo", delivered_date=d, type_of_return="Courier Return (RTO)")
        mk(self.a, "A2_1", "VLR2", "Valmo", delivered_date=d, type_of_return="Customer Return")
        mk(self.b, "B1_1", "DLR1", "Delhivery", delivered_date=d, type_of_return="Customer Return")
        mk(self.a, "OLD_1", "VLOLD", "Valmo", delivered_date=d - timedelta(days=3))          # never received
        mk(self.a, "T1_1", "SFT1", "Shadowfax", stage=ReturnDelivery.STAGE_IN_TRANSIT,
           expected_delivery_date=d, transit_status="Picked Up")
        LabelOrder.objects.create(business=self.a, order_id="A2_1", awb_number="FWDAWB2", uploaded_date=d - timedelta(days=9))

    def queue(self, **p):
        return self.client.get(f"{self.base}/queue/", p).data

    def scan(self, code, **kw):
        return self.client.post(f"{self.base}/", {"code": code, **kw}, format="json")

    def test_the_days_list_is_the_delivered_sheet_combined_across_businesses(self):
        q = self.queue()
        self.assertEqual(q["summary"]["expected"], 3)
        self.assertEqual({c["courier"]: (c["expected"], c["left"]) for c in q["summary"]["by_courier"]},
                         {"Valmo": (2, 2), "Delhivery": (1, 1)})
        self.assertEqual((q["summary"]["rto"], q["summary"]["customer"]), (1, 2))
        self.assertEqual([(i["suborder_no"], i["due"]) for i in q["upcoming"]], [("T1_1", "today")])
        self.assertEqual([i["suborder_no"] for i in q["missing"]], ["OLD_1"])

    def test_scanning_ticks_them_off_by_awb_suborder_or_forward_label(self):
        self.assertEqual(self.scan("VLR1").data["where"], "on_list")
        self.assertEqual(self.scan("FWDAWB2").data["item"]["suborder_no"], "A2_1")   # the RTO's outbound AWB
        self.assertEqual(self.scan("B1_1").data["item"]["business_name"], "Cosmify")
        q = self.queue()
        self.assertEqual((q["summary"]["received"], q["summary"]["left"]), (3, 0))
        self.assertEqual({c["courier"]: c["received"] for c in q["summary"]["by_courier"]}, {"Valmo": 2, "Delhivery": 1})

    def test_a_rescan_counts_once(self):
        self.scan("VLR1")
        r = self.scan("vlr1")
        self.assertTrue(r.data["already_scanned"])
        self.assertEqual(ReturnScan.objects.count(), 1)
        self.assertEqual(self.queue()["summary"]["received"], 1)

    def test_early_late_and_unknown_parcels_are_extra(self):
        self.assertEqual(self.scan("SFT1").data["where"], "in_transit")
        self.assertEqual(self.scan("VLOLD").data["where"], "earlier")
        r = self.scan("NOPE-12345")
        self.assertFalse(r.data["matched"])
        q = self.queue()
        self.assertEqual(sorted(e["why"] for e in q["extra"]), ["earlier", "unknown"])
        self.assertEqual([v["suborder_no"] for v in q["verified"]], ["T1_1"])          # the early one is verified, not extra
        self.assertEqual((q["summary"]["upcoming"], q["summary"]["missing"]), (0, 0))   # both arrived
        self.assertEqual({c["courier"]: c["extra"] for c in q["summary"]["by_courier"] if c["extra"]},
                         {"Valmo": 1, "Not recognised": 1})
        self.assertEqual({c["courier"]: c["verified"] for c in q["summary"]["by_courier"] if c["verified"]}, {"Shadowfax": 1})

    def test_an_earlier_day_is_shown_as_is(self):
        q = self.queue(date=(self.today - timedelta(days=3)).isoformat())
        self.assertEqual([i["suborder_no"] for i in q["items"]], ["OLD_1"])

    def test_a_mis_scan_can_be_undone(self):
        sid = self.scan("VLR1").data["item"]["scan_id"]
        self.assertEqual(self.client.delete(f"{self.base}/{sid}/").status_code, 200)
        self.assertEqual(self.queue()["summary"]["received"], 0)

    def test_a_business_without_returns_access_is_left_out(self):
        BusinessProfile.objects.update_or_create(business=self.b, defaults={"visible_paths": ["/orders"]})
        self.assertEqual(self.queue()["summary"]["expected"], 2)

    def test_no_future_day(self):
        r = self.scan("VLR1", day=(self.today + timedelta(days=1)).isoformat())
        self.assertEqual(r.status_code, 400)

    def test_a_packet_can_be_marked_damaged_and_then_raised_with_the_delivery_boy(self):
        sid = self.scan("VLR1").data["item"]["scan_id"]
        r = self.client.patch(f"{self.base}/{sid}/", {"damaged": True, "note": "tape cut"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        q = self.queue()
        self.assertEqual((q["summary"]["damaged_today"], q["summary"]["damaged"], q["summary"]["damaged_unreported"]), (1, 1, 1))
        self.assertEqual([(d["suborder_no"], d["damage_note"]) for d in q["damaged"]], [("A1_1", "tape cut")])
        self.client.patch(f"{self.base}/{sid}/", {"reported": True}, format="json")
        q = self.queue()
        self.assertEqual((q["summary"]["damaged"], q["summary"]["damaged_unreported"]), (1, 0))   # still today's, now raised
        self.assertIsNotNone(q["damaged"][0]["reported_at"])
        self.client.patch(f"{self.base}/{sid}/", {"damaged": False}, format="json")
        self.assertEqual(self.queue()["summary"]["damaged"], 0)

    def test_damaged_as_it_is_scanned(self):
        self.scan("DLR1", damaged=True, note="wet")
        s = ReturnScan.objects.get()
        self.assertTrue(s.damaged)
        self.assertEqual(s.damage_note, "wet")

    def test_an_earlier_unraised_damaged_packet_stays_on_the_list_a_week(self):
        old = self.today - timedelta(days=3)
        self.scan("VLOLD", day=old.isoformat(), damaged=True)
        self.scan("VLR1", day=(self.today - timedelta(days=10)).isoformat(), damaged=True)   # too old
        q = self.queue()
        self.assertEqual([d["suborder_no"] for d in q["damaged"]], ["OLD_1"])
        sid = q["damaged"][0]["scan_id"]
        self.client.patch(f"{self.base}/{sid}/", {"reported": True}, format="json")
        self.assertEqual(self.queue()["damaged"], [])                      # raised: off today's list

    def test_upcoming_returns_are_listed_verified_and_ticked_off_once_delivered(self):
        d = self.today
        mk = lambda sub, awb, **kw: ReturnDelivery.objects.create(business=self.a, suborder_no=sub, awb_number=awb, courier_partner="Valmo",
                                                                   sku="SKU", stage=ReturnDelivery.STAGE_IN_TRANSIT, **kw)
        mk("U1_1", "VLU1", expected_delivery_date=d + timedelta(days=3), transit_status="In transit")
        mk("U2_1", "VLU2", expected_delivery_date=d + timedelta(days=2), transit_status="Out for delivery")
        mk("U3_1", "VLU3", expected_delivery_date=d - timedelta(days=2))
        q = self.queue()
        self.assertEqual([(u["suborder_no"], u["due"]) for u in q["upcoming"]],
                         [("U2_1", "out_for_delivery"), ("U3_1", "overdue"), ("T1_1", "today"), ("U1_1", "later")])
        self.assertEqual((q["summary"]["upcoming"], q["summary"]["out_for_delivery"], q["summary"]["upcoming_due"]), (4, 1, 3))

        r = self.scan("VLU1")
        self.assertEqual(r.data["where"], "in_transit")
        q = self.queue()
        self.assertEqual([v["suborder_no"] for v in q["verified"]], ["U1_1"])
        self.assertNotIn("U1_1", [u["suborder_no"] for u in q["upcoming"]])
        self.assertEqual(q["summary"]["verified_today"], 1)

        # Meesho marks it delivered two days later: it's on that day's list, already received.
        later = d + timedelta(days=2)
        ReturnDelivery.objects.filter(suborder_no="U1_1").update(stage=ReturnDelivery.STAGE_DELIVERED, delivered_date=later)
        q = self.client.get(f"{self.base}/queue/", {"date": later.isoformat()}).data
        u1 = next(i for i in q["items"] if i["suborder_no"] == "U1_1")
        self.assertEqual((u1["bucket"], u1["received_early"]), ("received", True))
        self.assertEqual(self.queue()["verified"], [])
