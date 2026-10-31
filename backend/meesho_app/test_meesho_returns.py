"""The Meesho returns sync (meesho_returns): Meesho's returns → the returns table, and the courier OTPs."""

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from .meesho_returns import normalize, sync_account
from .models import MeeshoAccount, MeeshoSyncSnapshot, ReturnDelivery


def ret(n, status, **extra):
    """A fetchReturnClaims row, as Meesho sends it."""
    return {"order_num": f"{n}", "sub_order_num": f"{n}_1", "type": "RET", "sub_type": "FIRST_RET", "shipment_status": status,
            "created_date_iso": "2026-10-24T10:22:04+0530", "carrier_name": "Shadowfax", "tracking_url": "https://t/x",
            "awb": f"AWB{n}", "return_price_type": "Meesho Price", "order_dispatch_date_iso": "2026-10-20",
            "return_reason_details": {"return_reason": "Don't need it", "detailed_reason": "Changed my mind"},
            "ofd_reverse_attempt": {"reverse_ofd_attempt_count_value": 2, "reverse_ofd_attempt_count_label": "2nd Attempt"},
            "product": {"name": "Brass Diya", "meesho_pid": "1I7", "sku": "diya-029", "quantity": 1, "variation": "Free Size",
                        "category": "Diyas"}, "proof_of_delivery": {}, **extra}


class ReturnsSyncTests(TestCase):
    def setUp(self):
        self.biz = Business.objects.create(name="Cosmify")
        self.user = User.objects.create_user(username="w", password="pw", role=User.ROLE_BUSINESS_USER)
        Membership.objects.create(user=self.user, business=self.biz)
        self.acct = MeeshoAccount.objects.create(business=self.biz, phone_number="9000000001", password_enc="x", status="ACTIVE",
                                                 supplier_id="1", supplier_identifier="x")

    def snap(self, endpoint, payload):
        MeeshoSyncSnapshot.objects.update_or_create(account=self.acct, endpoint=endpoint,
                                                    defaults={"http_status": 200, "payload": payload, "fetched_at": timezone.now()})

    def test_meesho_rows_are_put_in_the_returns_exports_shape(self):
        row = normalize(ret(1, "Delivered", delivered_date_iso="2026-10-31T14:11:40+0530",
                            proof_of_delivery={"digital_pod_url": "https://pod", "otp_verified_time": "2026-10-31 14:11:40"}),
                        "completed_delivered")
        self.assertEqual((row["suborder_no"], row["awb_number"], row["sku"], row["type_of_return"], row["courier_partner"]),
                         ("1_1", "AWB1", "diya-029", "Customer Return", "Shadowfax"))
        self.assertEqual((row["delivered_date"], row["proof_of_delivery"], row["return_reason"]),
                         ("2026-10-31T14:11:40+0530", "https://pod", "Don't need it"))
        self.assertEqual(normalize(ret(2, "To Be Reattempted", type="RTO"), "ofd_reverse")["transit_status"], "Out for delivery")
        self.assertEqual(normalize(ret(2, "x", type="RTO"), "intransit")["type_of_return"], "Courier Return (RTO)")

    def test_each_status_lands_in_its_stage_and_a_delivered_return_stays_delivered(self):
        self.snap("returns_intransit", [ret(1, "In Transit", expected_delivery_date_iso="2026-11-05T05:30:00+0530"), ret(5, "In Transit")])
        self.snap("returns_ofd_reverse", [ret(2, "Out For Delivery")])
        self.snap("returns_completed_delivered", [ret(3, "Delivered", delivered_date_iso="2026-10-31T14:11:40+0530"),
                                                  ret(5, "Delivered", delivered_date_iso="2026-10-30T10:00:00+0530")])
        self.snap("returns_completed_lost", [ret(4, "Lost", lost_date_iso="2026-10-30T08:30:02+0530",
                                                 payment_status="Settlement to be credited by 02 Nov 2026")])
        self.snap("returns_reverse_disposed", [ret(6, "Disposed", disposed_date_iso="2026-10-01T20:51:56+0530")])
        counts = sync_account(self.acct)
        self.assertEqual(counts["intransit"]["created"], 2)
        rows = {r.suborder_no: r for r in ReturnDelivery.objects.filter(business=self.biz)}
        self.assertEqual({k: v.stage for k, v in rows.items()},
                         {"1_1": "IN_TRANSIT", "2_1": "IN_TRANSIT", "3_1": "DELIVERED", "4_1": "LOST", "5_1": "DELIVERED", "6_1": "DISPOSED"})
        self.assertEqual((rows["2_1"].transit_status, rows["2_1"].delivery_attempts, rows["2_1"].meesho_status),
                         ("Out for delivery", 2, "Out For Delivery"))
        self.assertEqual(str(rows["3_1"].delivered_date), "2026-10-31")
        self.assertEqual((rows["4_1"].meesho_note, rows["4_1"].claim_status), ("Settlement to be credited by 02 Nov 2026", "NOT_REQUIRED"))
        self.assertIsNotNone(rows["6_1"].closed_at)
        self.assertIsNotNone(rows["1_1"].synced_at)
        # Read again later, with 5 still listed in transit by a stale page: it stays delivered.
        sync_account(self.acct)
        self.assertEqual(ReturnDelivery.objects.get(suborder_no="5_1").stage, "DELIVERED")
        self.assertEqual(ReturnDelivery.objects.count(), 6)

    def test_claim_work_already_recorded_is_never_touched(self):
        ReturnDelivery.objects.create(business=self.biz, suborder_no="4_1", awb_number="AWB4", stage="IN_TRANSIT",
                                      claim_status="REQUIRED", claim_notes="raise it")
        self.snap("returns_completed_lost", [ret(4, "Lost", lost_date_iso="2026-10-30T08:30:02+0530")])
        sync_account(self.acct)
        r = ReturnDelivery.objects.get()
        self.assertEqual((r.stage, r.claim_status, r.claim_notes), ("LOST", "REQUIRED", "raise it"))

    def test_the_otp_dashboard(self):
        self.snap("delivery_otps", {"supplier_delivery_otp": [{
            "carrier_name": "delhivery", "otp": "7610", "count": 4, "awbs": ["1490842735834572", "1490842735834573"],
            "otp_expiry_timestamp": "2026-10-31T23:33:44.489+05:30", "carrier_details": {"name": "Delhivery", "icon": "https://i"},
            "otp_details": [{"otp": "7610", "expiry_timestamp": "2026-10-31T23:33:44.489+05:30", "type": "DEFAULT_OTP",
                             "display_text": "OTP", "active": True}]}]})
        ReturnDelivery.objects.create(business=self.biz, suborder_no="9_1", awb_number="A", stage="IN_TRANSIT", transit_status="Out for delivery")
        ReturnDelivery.objects.create(business=self.biz, suborder_no="8_1", awb_number="B", stage="LOST")
        c = APIClient()
        c.force_authenticate(self.user)
        d = c.get(f"/api/business/{self.biz.id}/meesho-orders/returns/").data
        (o,) = d["otps"]
        self.assertEqual((o["courier"], o["otp"], o["shipments"], o["business_name"]), ("Delhivery", "7610", 4, "Cosmify"))
        self.assertEqual(len(o["awbs"]), 2)
        self.assertEqual((d["returns"]["out_for_delivery"], d["returns"]["in_transit"], d["returns"]["lost"]), (1, 0, 1))


class ReturnsListAndScheduleTests(TestCase):
    def setUp(self):
        self.biz = Business.objects.create(name="Cosmify")
        self.admin = User.objects.create_user(username="a", password="pw", role=User.ROLE_SUPER_ADMIN)
        self.worker = User.objects.create_user(username="w", password="pw", role=User.ROLE_BUSINESS_USER)
        for u in (self.admin, self.worker):
            Membership.objects.create(user=u, business=self.biz)
        MeeshoAccount.objects.create(business=self.biz, phone_number="9000000001", password_enc="x", status="ACTIVE",
                                     supplier_id="1", supplier_identifier="x", sync_interval_minutes=5)
        mk = lambda n, stage, **kw: ReturnDelivery.objects.create(business=self.biz, suborder_no=f"{n}_1", awb_number=f"AWB{n}",
                                                                   stage=stage, sku=f"sku-{n}", courier_partner="Valmo", **kw)
        mk(1, "IN_TRANSIT", transit_status="In Transit")
        mk(2, "IN_TRANSIT", transit_status="Out for delivery", delivery_attempts=2)
        mk(3, "DELIVERED", delivered_date="2026-10-30", claim_status="REQUIRED")
        mk(4, "LOST", meesho_note="Settlement to be credited by 02 Nov 2026")
        mk(5, "DISPOSED")

    def client_for(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c

    def test_every_return_by_status(self):
        url = f"/api/business/{self.biz.id}/meesho-orders/returns/list/"
        c = self.client_for(self.worker)
        got = {st: [r["suborder_no"] for r in c.get(url, {"stage": st}).data["returns"]]
               for st in ("in_transit", "out_for_delivery", "delivered", "lost", "disposed")}
        self.assertEqual(got, {"in_transit": ["1_1"], "out_for_delivery": ["2_1"], "delivered": ["3_1"], "lost": ["4_1"], "disposed": ["5_1"]})
        d = c.get(url, {"stage": "delivered"}).data["returns"][0]
        self.assertEqual((d["claim_status"], d["claim_label"], d["courier"]), ("REQUIRED", "Claim required", "Valmo"))
        self.assertEqual(c.get(url, {"stage": "lost"}).data["returns"][0]["note"], "Settlement to be credited by 02 Nov 2026")
        self.assertEqual(c.get(url, {"stage": "in_transit", "q": "nothing"}).data["total"], 0)
        self.assertEqual(c.get(url, {"stage": "nope"}).status_code, 400)

    def test_the_sync_schedule(self):
        from .models import MeeshoSyncSetting
        url = f"/api/business/{self.biz.id}/meesho-orders/sync-settings/"
        d = self.client_for(self.worker).get(url).data
        self.assertEqual((d["orders_every"], d["returns_every"], d["returns_window"]), (5, 10, "last_2_week"))
        self.assertEqual(self.client_for(self.worker).patch(url, {"returns_every": 30}, format="json").status_code, 403)
        a = self.client_for(self.admin)
        d = a.patch(url, {"orders_every": 10, "returns_every": 0, "payments_paid_days": 45, "returns_window": "last_1_month"}, format="json").data
        self.assertEqual((d["orders_every"], d["returns_every"], d["payments_paid_days"], d["returns_window"]), (10, 0, 45, "last_1_month"))
        self.assertEqual(MeeshoAccount.objects.get().sync_interval_minutes, 10)      # every account's orders interval
        for bad in ({"orders_every": 0}, {"inventory_sku_reads": 5000}, {"payments_upcoming_days": "x"}, {"returns_window": "forever"}):
            self.assertEqual(a.patch(url, bad, format="json").status_code, 400, bad)
        self.assertEqual(MeeshoSyncSetting.objects.count(), 1)
