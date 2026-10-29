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
        self.assertEqual([i["suborder_no"] for i in q["in_transit"]], ["T1_1"])
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
        self.assertEqual(sorted(e["why"] for e in q["extra"]), ["earlier", "early", "unknown"])
        self.assertEqual((q["summary"]["in_transit"], q["summary"]["missing"]), (0, 0))   # both arrived
        self.assertEqual({c["courier"]: c["extra"] for c in q["summary"]["by_courier"] if c["extra"]},
                         {"Shadowfax": 1, "Valmo": 1, "Not recognised": 1})

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
