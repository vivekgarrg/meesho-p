"""Unrecognised scans are filed under a courier by an admin; the lookup tab
reads the listing behind a scanned AWB."""

from decimal import Decimal as D

from rest_framework.test import APIClient

from accounts.models import Membership, User

from .models import FinalPrice, LabelOrder, MasterItem, MasterItemComponent, ParentItemPrice, ScannedOrder
from .test_order_scan_carryover import CarryTestCase


class UnrecognisedScanTests(CarryTestCase):
    def queue(self, client=None):
        return (client or self.client).get(f"{self.base}/order-scan/queue/", {"date": self.today.isoformat()}).data

    def scan_unknown(self, code="MYSTERY-1"):
        return self.client.post(f"{self.base}/order-scan/", {"code": code, "status": "PACKED"}, format="json").data["row"]

    def test_an_unrecognised_scan_is_listed_for_checking(self):
        row = self.scan_unknown()
        self.assertEqual(row["matched_from"], "NONE")
        listed = self.queue()["unrecognised"]
        self.assertEqual([u["code"] for u in listed], ["MYSTERY-1"])

    def test_the_admin_files_it_under_a_courier_and_it_is_counted_there(self):
        row = self.scan_unknown()
        r = self.client.patch(f"{self.base}/order-scan/{row['id']}/", {"courier_name": "Valmo"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        q = self.queue()
        self.assertEqual(q["unrecognised"], [])
        self.assertIn({"courier": "Valmo", "scanned": 1}, q["summary"]["off_list_by_courier"])

    def test_a_worker_cannot_assign_a_courier(self):
        row = self.scan_unknown()
        worker = User.objects.create_user(username="w", password="pw", role=User.ROLE_BUSINESS_USER)
        Membership.objects.create(user=worker, business=self.biz)
        c = APIClient()
        c.force_authenticate(worker)
        r = c.patch(f"{self.base}/order-scan/{row['id']}/", {"courier_name": "Valmo"}, format="json")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(ScannedOrder.objects.get(pk=row["id"]).courier_name, "")


class LookupTests(CarryTestCase):
    def setUp(self):
        super().setUp()
        self.parent = ParentItemPrice.objects.create(business=self.biz, item_id="DIYA-SET", item_price=D("90"),
                                                     tax_percent=5, packaging_cost=D("4"), final_price=D("98.50"),
                                                     image_url="https://img.example/diya.jpg")
        FinalPrice.objects.create(business=self.biz, sku_id="DIYA-RED", parent=self.parent, item_price=D("90"))
        katori = MasterItem.objects.create(business=self.biz, name="Katori", unit_price=D("30"))
        plate = MasterItem.objects.create(business=self.biz, name="Plate", unit_price=D("30"))
        MasterItemComponent.objects.create(parent=self.parent, master_item=katori, quantity=2)
        MasterItemComponent.objects.create(parent=self.parent, master_item=plate, quantity=1)
        LabelOrder.objects.create(order_id="L1_1", awb_number="LAWB1", courier_name="Valmo", sku="DIYA-RED",
                                  qty=2, customer_city="Pune", uploaded_date=self.today, business=self.biz)

    def get(self, code):
        return self.client.get(f"{self.base}/order-scan/lookup/", {"code": code}).data

    def test_an_awb_shows_the_listing_behind_it(self):
        d = self.get("LAWB1")
        self.assertTrue(d["found"])
        self.assertEqual(d["sku"], "DIYA-RED")
        self.assertEqual(d["parent"]["item_id"], "DIYA-SET")
        self.assertEqual(d["parent"]["image_url"], "https://img.example/diya.jpg")
        self.assertEqual([(c["name"], c["quantity"], c["line_total"]) for c in d["components"]],
                         [("Katori", 2.0, 60.0), ("Plate", 1.0, 30.0)])
        self.assertEqual(d["order"]["courier"], "Valmo")
        self.assertEqual(d["siblings"], ["DIYA-RED"])
        self.assertTrue(d["pricing"]["from_master_list"])

    def test_the_order_number_works_too(self):
        self.assertEqual(self.get("L1_1")["parent"]["item_id"], "DIYA-SET")

    def test_an_unknown_code_says_so_and_records_nothing(self):
        self.assertFalse(self.get("NOPE-123")["found"])
        self.assertEqual(ScannedOrder.objects.count(), 0)

    def test_a_lookup_is_not_a_scan(self):
        self.get("LAWB1")
        self.assertEqual(ScannedOrder.objects.count(), 0)

    def test_a_sku_with_no_parent_still_answers(self):
        LabelOrder.objects.create(order_id="L2_1", awb_number="LAWB2", sku="LOOSE-1", uploaded_date=self.today, business=self.biz)
        d = self.get("LAWB2")
        self.assertTrue(d["found"])
        self.assertIsNone(d["parent"])
        self.assertEqual(d["components"], [])


class StatusClassificationTests(CarryTestCase):
    """The order sheet's status words, as the desk reads them."""

    def test_each_status_lands_in_its_bucket(self):
        S = ScannedOrder
        cases = {
            "READY_TO_SHIP": S.SHIP_NOT_SHIPPED, "PENDING": S.SHIP_NOT_SHIPPED,
            "SHIPPED": S.SHIP_SHIPPED, "Delivered": S.SHIP_SHIPPED, "DELIVERED": S.SHIP_SHIPPED,
            "CANCELLED": S.SHIP_CANCELLED, "Cancelled": S.SHIP_CANCELLED,
            "RTO": S.SHIP_RETURNED, "RTO_LOCKED": S.SHIP_RETURNED, "RTO_COMPLETE": S.SHIP_RETURNED,
            "RTO_INITIATED": S.SHIP_RETURNED, "Return": S.SHIP_RETURNED,
            "": S.SHIP_UNKNOWN, None: S.SHIP_UNKNOWN,
        }
        for raw, want in cases.items():
            self.assertEqual(S.classify_ship_status(raw), want, raw)

    def test_ready_to_ship_is_not_shipped_in_the_scan_record_either(self):
        from .views import _meesho_bucket
        self.assertEqual(_meesho_bucket("READY_TO_SHIP"), "pending")
        self.assertEqual(_meesho_bucket("Ready To Ship"), "pending")
        self.assertEqual(_meesho_bucket("SHIPPED"), "shipped")
        self.assertEqual(_meesho_bucket("DELIVERED"), "delivered")
        self.assertEqual(_meesho_bucket("RTO_COMPLETE"), "rto")
        self.assertEqual(_meesho_bucket("RTO_LOCKED"), "rto")
        self.assertEqual(_meesho_bucket("CANCELLED"), "cancelled")

    def test_the_list_reads_the_furthest_status_from_either_sheet(self):
        from .models import Order, OrderPayment
        LabelOrder.objects.create(order_id="S1_1", awb_number="SAWB1", courier_name="Valmo", uploaded_date=self.today, business=self.biz)
        LabelOrder.objects.create(order_id="S2_1", awb_number="SAWB2", courier_name="Valmo", uploaded_date=self.today, business=self.biz)
        LabelOrder.objects.create(order_id="S3_1", awb_number="SAWB3", courier_name="Valmo", uploaded_date=self.today, business=self.biz)
        Order.objects.create(business=self.biz, sub_order_no="S1_1", reason_for_credit_entry="READY_TO_SHIP")
        Order.objects.create(business=self.biz, sub_order_no="S1_1", reason_for_credit_entry="SHIPPED")
        Order.objects.create(business=self.biz, sub_order_no="S2_1", reason_for_credit_entry="READY_TO_SHIP")
        Order.objects.create(business=self.biz, sub_order_no="S3_1", reason_for_credit_entry="SHIPPED")
        OrderPayment.objects.create(business=self.biz, sub_order_no="S3_1", live_order_status="RTO_COMPLETE")
        q = self.client.get(f"{self.base}/order-scan/queue/", {"date": self.today.isoformat()}).data
        got = {i["order_id"]: i["ship_status"] for i in q["items"]}
        self.assertEqual(got, {"S1_1": "SHIPPED", "S2_1": "NOT_SHIPPED", "S3_1": "RETURNED"})
        self.assertEqual(q["summary"]["returned"], 1)
