"""The Meesho sync page: save the login (encrypted), queue Sidekiq jobs, show status."""

import base64
import json
import os
from unittest import mock

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from . import meesho_sync
from .models import MeeshoAccount, MeeshoSyncRun

KEY = base64.b64encode(b"k" * 32).decode()


@mock.patch.dict(os.environ, {"MEESHO_SYNC_KEY": KEY})
@mock.patch.object(meesho_sync, "_worker_alive", lambda: True)
class MeeshoSyncTests(TestCase):
    def setUp(self):
        self.biz = Business.objects.create(name="Rudam")
        self.admin = User.objects.create_user(username="a", password="pw", role=User.ROLE_SUPER_ADMIN)
        self.worker = User.objects.create_user(username="w", password="pw", role=User.ROLE_BUSINESS_USER)
        for u in (self.admin, self.worker):
            Membership.objects.create(user=u, business=self.biz)
        self.base = f"/api/business/{self.biz.id}/meesho-sync"
        self.queued = []
        patcher = mock.patch.object(meesho_sync, "enqueue", side_effect=lambda job, args, queue="critical": self.queued.append((job, args, queue)) or "jid")
        patcher.start()
        self.addCleanup(patcher.stop)

    def client_for(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c

    def connect(self, client=None, **body):
        data = {"phone_number": "90000 00001", "password": "s3cret!", **body}
        return (client or self.client_for(self.admin)).post(f"{self.base}/connect/", data, format="json")

    def test_connect_stores_the_password_encrypted_and_queues_a_login(self):
        r = self.connect()
        self.assertEqual(r.status_code, 201, r.data)
        a = MeeshoAccount.objects.get()
        self.assertEqual(a.phone_number, "9000000001")
        self.assertNotIn("s3cret", a.password_enc)
        self.assertEqual(meesho_sync.decrypt(a.password_enc), "s3cret!")
        run = MeeshoSyncRun.objects.get()
        self.assertEqual(self.queued, [("MeeshoLoginJob", [a.pk, run.pk], "critical")])
        self.assertNotIn("s3cret", json.dumps(r.data, default=str))
        self.assertEqual(r.data["account"]["phone"], "••••••0001")

    def test_only_an_admin_connects_or_disconnects(self):
        self.assertEqual(self.connect(self.client_for(self.worker)).status_code, 403)
        self.connect()
        self.assertEqual(self.client_for(self.worker).post(f"{self.base}/disconnect/").status_code, 403)

    def test_refresh_queues_one_sync_at_a_time(self):
        self.connect()
        w = self.client_for(self.worker)
        r1 = w.post(f"{self.base}/refresh/")
        r2 = w.post(f"{self.base}/refresh/")
        self.assertTrue(r1.data["queued"])
        self.assertFalse(r2.data["queued"])                       # already queued: not twice
        self.assertEqual([q[0] for q in self.queued], ["MeeshoLoginJob", "MeeshoSyncJob"])

    def test_refresh_needs_an_account(self):
        self.assertEqual(self.client_for(self.worker).post(f"{self.base}/refresh/").status_code, 400)

    def test_settings_and_disconnect(self):
        self.connect()
        c = self.client_for(self.admin)
        self.assertEqual(c.patch(f"{self.base}/settings/", {"sync_interval_minutes": 10}, format="json").data["account"]["sync_interval_minutes"], 10)
        self.assertEqual(c.patch(f"{self.base}/settings/", {"sync_interval_minutes": 0}, format="json").status_code, 400)
        r = c.post(f"{self.base}/disconnect/")
        a = MeeshoAccount.objects.get()
        self.assertEqual((a.status, a.password_enc, a.cookies_enc, a.sync_enabled), ("DISABLED", "", "", False))
        self.assertEqual(r.data["account"]["status"], "DISABLED")

    def test_status_reports_setup(self):
        d = self.client_for(self.worker).get(f"{self.base}/").data
        self.assertEqual(d["setup"], {"key": True, "key_message": "", "queue": True, "worker": True})
        self.assertIsNone(d["account"])

    def test_no_key_means_a_clear_error(self):
        with mock.patch.dict(os.environ, {"MEESHO_SYNC_KEY": ""}):
            r = self.connect()
        self.assertEqual(r.status_code, 503)
        self.assertIn("MEESHO_SYNC_KEY", r.data["error"])

    def test_queue_down_is_reported_on_the_run(self):
        with mock.patch.object(meesho_sync, "enqueue", side_effect=ConnectionError("refused")):
            r = self.connect()
        self.assertEqual(r.status_code, 503)
        self.assertIn("Redis", r.data["error"])
        self.assertEqual(MeeshoSyncRun.objects.get().status, "FAILED")


@mock.patch.dict(os.environ, {"MEESHO_SYNC_KEY": KEY})
@mock.patch.object(meesho_sync, "_worker_alive", lambda: True)
class FetchedDataTests(TestCase):
    def setUp(self):
        self.biz = Business.objects.create(name="Rudam")
        self.admin = User.objects.create_user(username="a", password="pw", role=User.ROLE_SUPER_ADMIN)
        Membership.objects.create(user=self.admin, business=self.biz)
        self.c = APIClient()
        self.c.force_authenticate(self.admin)
        self.base = f"/api/business/{self.biz.id}/meesho-sync"
        self.acct = MeeshoAccount.objects.create(business=self.biz, phone_number="9000000001",
                                                 password_enc="v1:placeholder", status="ACTIVE")

    def test_pulled_orders_show_as_a_preview_table(self):
        from django.utils import timezone
        rows = [{"sub_order_num": f"S{i}_1", "sku": "lota", "price": {"amount": 199}, "items": [1]} for i in range(30)]
        self.acct.snapshots.create(endpoint="orders_pending", http_status=200, payload=rows, fetched_at=timezone.now())
        snap = self.c.get(f"{self.base}/").data["snapshots"][0]
        self.assertEqual((snap["endpoint"], snap["rows"]), ("orders_pending", 30))
        self.assertEqual(snap["columns"], ["sub_order_num", "sku", "price.amount"])
        self.assertEqual(len(snap["preview"]), 25)
        self.assertEqual(snap["preview"][0], ["S0_1", "lota", 199])

    def test_an_admin_sets_the_supplier_code(self):
        r = self.c.patch(f"{self.base}/settings/", {"supplier_identifier": " xzvey "}, format="json")
        self.assertEqual(r.data["account"]["supplier_identifier"], "xzvey")


@mock.patch.object(meesho_sync, "_worker_alive", lambda: True)
class DashboardTests(TestCase):
    def setUp(self):
        from django.utils import timezone
        self.biz = Business.objects.create(name="Rudam")
        self.user = User.objects.create_user(username="w", password="pw", role=User.ROLE_BUSINESS_USER)
        Membership.objects.create(user=self.user, business=self.biz)
        self.c = APIClient()
        self.c.force_authenticate(self.user)
        self.url = f"/api/business/{self.biz.id}/meesho-orders/"
        self.acct = MeeshoAccount.objects.create(business=self.biz, phone_number="9000000001", password_enc="v1:x", status="ACTIVE")
        today = timezone.localdate().isoformat()
        now = timezone.now()
        mk = lambda key, rows: self.acct.snapshots.create(endpoint=f"orders_{key}", http_status=200, payload=rows, fetched_at=now)
        mk("pending", [{"sub_order_num": "P1_1", "sla_status": "breaching_soon", "dispatch_by": today},
                       {"sub_order_num": "P2_1", "sla_status": "breached", "dispatch_by": "2026-01-01"}])
        mk("ready_to_ship", [{"sub_order_num": "R1_1", "sla_status": "sla_others", "label": "Not Downloaded", "dispatch_by": today}])
        mk("cancelled", [{"sub_order_num": "C1_1", "created_iso": "2026-10-01T10:00:00+0530"},
                         {"sub_order_num": "C2_1", "created_iso": "2026-10-30T10:00:00+0530"}])

    def test_tabs_counts_and_rows(self):
        d = self.c.get(self.url).data
        tabs = {t["key"]: t for t in d["tabs"]}
        self.assertEqual([t["key"] for t in d["tabs"]], ["hold", "pending", "ready_to_ship", "cancelled"])
        self.assertEqual((tabs["hold"]["count"], tabs["hold"]["fetched_at"]), (0, None))
        p = tabs["pending"]
        self.assertEqual((p["count"], p["breached"], p["breaching_soon"], p["due_today"]), (2, 1, 1, 1))
        self.assertEqual([r["sub_order_num"] for r in p["rows"]], ["P2_1", "P1_1"])        # earliest dispatch first
        self.assertEqual(tabs["ready_to_ship"]["label_pending"], 1)
        self.assertEqual([r["sub_order_num"] for r in tabs["cancelled"]["rows"]], ["C2_1", "C1_1"])   # newest first
        self.assertTrue(d["connected"])

    def test_no_account_yet(self):
        self.acct.delete()
        d = self.c.get(self.url).data
        self.assertFalse(d["connected"])
        self.assertEqual(sum(t["count"] for t in d["tabs"]), 0)

    def test_stuck_runs_are_reported(self):
        from datetime import timedelta
        from django.utils import timezone
        run = MeeshoSyncRun.objects.create(account=self.acct, kind="SYNC")
        MeeshoSyncRun.objects.filter(pk=run.pk).update(queued_at=timezone.now() - timedelta(minutes=30))
        admin = User.objects.create_user(username="a", password="pw", role=User.ROLE_SUPER_ADMIN)
        c = APIClient(); c.force_authenticate(admin)
        r = c.get(f"/api/business/{self.biz.id}/meesho-sync/").data["runs"][0]
        self.assertEqual(r["status"], "STUCK")
        self.assertFalse(self.c.get(self.url).data["syncing"])


@mock.patch.object(meesho_sync, "_worker_alive", lambda: True)
class AcceptTests(TestCase):
    def setUp(self):
        from django.utils import timezone
        self.biz = Business.objects.create(name="Rudam")
        self.admin = User.objects.create_user(username="a", password="pw", role=User.ROLE_SUPER_ADMIN)
        self.worker = User.objects.create_user(username="w", password="pw", role=User.ROLE_BUSINESS_USER)
        for u in (self.admin, self.worker):
            Membership.objects.create(user=u, business=self.biz)
        self.url = f"/api/business/{self.biz.id}/meesho-orders/accept/"
        self.acct = MeeshoAccount.objects.create(business=self.biz, phone_number="9000000001", password_enc="v1:x", status="ACTIVE",
                                                 supplier_id="4313711", supplier_identifier="xzvey", supplier_name="Rudam")
        row = lambda n: {"sub_order_num": f"{n}_1", "sub_order_id": f"{n}_1_FORWARD", "grouping_key": f"{n}_1_FORWARD", "shipment_type": "forward"}
        self.acct.snapshots.create(endpoint="orders_pending", http_status=200, payload=[row(1), row(2), row(3)], fetched_at=timezone.now())
        self.queued = []
        p = mock.patch.object(meesho_sync, "enqueue", side_effect=lambda job, args, queue="critical": self.queued.append((job, args)) or "jid")
        p.start()
        self.addCleanup(p.stop)

    def post(self, user, subs):
        c = APIClient()
        c.force_authenticate(user)
        return c.post(self.url, {"sub_order_nums": subs}, format="json")

    def test_the_chosen_orders_are_sent_to_the_worker(self):
        r = self.post(self.admin, ["1_1", "3_1", "1_1"])
        self.assertEqual(r.status_code, 202, r.data)
        run = MeeshoSyncRun.objects.get()
        self.assertEqual((run.kind, run.records), ("ACCEPT", 2))
        self.assertEqual(self.queued, [("MeeshoAcceptJob", [self.acct.pk, run.pk, [
            {"grouping_key": "1_1_FORWARD", "sub_order_ids": ["1_1_FORWARD"], "shipment_type": "forward"},
            {"grouping_key": "3_1_FORWARD", "sub_order_ids": ["3_1_FORWARD"], "shipment_type": "forward"}]])])

    def test_only_an_admin_accepts(self):
        self.assertEqual(self.post(self.worker, ["1_1"]).status_code, 403)
        self.assertEqual(self.queued, [])

    def test_orders_no_longer_pending_are_refused(self):
        r = self.post(self.admin, ["1_1", "9_1"])
        self.assertEqual(r.status_code, 409)
        self.assertIn("no longer in Pending", r.data["error"])
        self.assertEqual(self.queued, [])

    def test_one_accept_at_a_time(self):
        self.post(self.admin, ["1_1"])
        r = self.post(self.admin, ["2_1"])
        self.assertEqual(r.status_code, 409)
        self.assertEqual(len(self.queued), 1)

    def test_old_pulls_without_ids_ask_for_a_refresh(self):
        snap = self.acct.snapshots.get()
        snap.payload = [{"sub_order_num": "1_1"}]
        snap.save()
        r = self.post(self.admin, ["1_1"])
        self.assertEqual(r.status_code, 409)
        self.assertIn("Refresh", r.data["error"])

    def test_the_dashboard_shows_recent_accepts(self):
        self.post(self.admin, ["1_1"])
        c = APIClient()
        c.force_authenticate(self.worker)
        d = c.get(f"/api/business/{self.biz.id}/meesho-orders/").data
        self.assertEqual((d["accepts"][0]["kind"], d["accepts"][0]["status"]), ("ACCEPT", "QUEUED"))


class SidekiqFormatTests(TestCase):
    def test_a_job_is_pushed_the_way_sidekiq_reads_it(self):
        fake = mock.MagicMock()
        pipe = fake.pipeline.return_value.__enter__.return_value
        with mock.patch.object(meesho_sync, "_redis", return_value=fake):
            meesho_sync.enqueue("MeeshoSyncJob", [3, 9])
        pipe.sadd.assert_called_once_with("queues", "critical")
        key, payload = pipe.lpush.call_args.args
        job = json.loads(payload)
        self.assertEqual(key, "queue:critical")
        self.assertEqual((job["class"], job["args"], job["queue"]), ("MeeshoSyncJob", [3, 9], "critical"))
        self.assertEqual(len(job["jid"]), 24)


@mock.patch.object(meesho_sync, "_worker_alive", lambda: True)
class LabelTests(TestCase):
    def setUp(self):
        from django.utils import timezone
        self.biz = Business.objects.create(name="Rudam")
        self.admin = User.objects.create_user(username="a", password="pw", role=User.ROLE_SUPER_ADMIN)
        self.worker = User.objects.create_user(username="w", password="pw", role=User.ROLE_BUSINESS_USER)
        for u in (self.admin, self.worker):
            Membership.objects.create(user=u, business=self.biz)
        self.base = f"/api/business/{self.biz.id}/meesho-orders/labels/"
        self.acct = MeeshoAccount.objects.create(business=self.biz, phone_number="9000000001", password_enc="v1:x", status="ACTIVE",
                                                 supplier_id="4313711", supplier_identifier="xzvey", supplier_name="Rudam")
        row = lambda n, label: {"sub_order_num": f"{n}_1", "sub_order_id": f"{n}_1_FORWARD", "grouping_key": f"{n}_1_FORWARD_1_1",
                                "shipment_type": "forward", "label": label}
        self.acct.snapshots.create(endpoint="orders_ready_to_ship", http_status=200, fetched_at=timezone.now(),
                                   payload=[row(1, "Not Downloaded"), row(2, "Downloaded")])
        self.queued = []
        p = mock.patch.object(meesho_sync, "enqueue", side_effect=lambda job, args, queue="critical": self.queued.append((job, args)) or "jid")
        p.start()
        self.addCleanup(p.stop)

    def client_for(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c

    def test_labels_are_requested_for_the_chosen_orders(self):
        r = self.client_for(self.admin).post(self.base, {"sub_order_nums": ["1_1", "2_1"]}, format="json")
        self.assertEqual(r.status_code, 202, r.data)
        run = MeeshoSyncRun.objects.get(kind="LABELS")
        self.assertEqual(self.queued, [("MeeshoLabelJob", [self.acct.pk, run.pk, [
            {"grouping_key": "1_1_FORWARD_1_1", "sub_order_ids": ["1_1_FORWARD"], "shipment_type": "forward"},
            {"grouping_key": "2_1_FORWARD_1_1", "sub_order_ids": ["2_1_FORWARD"], "shipment_type": "forward"}]])])

    def test_only_admins_and_only_ready_to_ship(self):
        self.assertEqual(self.client_for(self.worker).post(self.base, {"sub_order_nums": ["1_1"]}, format="json").status_code, 403)
        r = self.client_for(self.admin).post(self.base, {"sub_order_nums": ["9_1"]}, format="json")
        self.assertEqual(r.status_code, 409)
        self.assertEqual(self.queued, [])

    def test_the_ready_pdf_is_sorted_by_parent_and_saved_like_an_upload(self):
        import base64
        from .models import LabelOrder
        from .test_label_engine import make_labels_pdf
        run = MeeshoSyncRun.objects.create(account=self.acct, kind="LABELS", status="OK",
                                           result={"label_url": "https://storage.googleapis.com/x.pdf", "success": 2, "total": 2})
        pdf = make_labels_pdf([("lota-b", "500_1", "A"), ("lota-a", "501_1", "B")])
        with mock.patch.object(meesho_sync, "_fetch_label_pdf", return_value=pdf) as fetch:
            r = self.client_for(self.worker).post(f"{self.base}{run.pk}/pdf/")
        self.assertEqual(r.status_code, 200, r.data)
        fetch.assert_called_once_with("https://storage.googleapis.com/x.pdf")
        self.assertTrue(base64.b64decode(r.data["sorted_pdf_b64"]).startswith(b"%PDF"))
        self.assertTrue(r.data["file_name"].startswith("meesho-labels-"))
        self.assertEqual(r.data["total_labels"], 2)
        self.assertEqual(set(LabelOrder.objects.values_list("order_id", flat=True)), {"500_1", "501_1"})   # Order Scan has them

        dashboard = self.client_for(self.worker).get(f"/api/business/{self.biz.id}/meesho-orders/").data
        b = dashboard["label_batches"][0]
        self.assertEqual((b["ready"], b["success"], b["busy"]), (1, 2, False))
        self.assertNotIn("label_url", str(dashboard["label_batches"]))   # the signed link stays on the server

    def test_only_meeshos_storage_is_fetched(self):
        with self.assertRaises(ValueError):
            meesho_sync._fetch_label_pdf("https://evil.example.com/x.pdf")
        with self.assertRaises(ValueError):
            meesho_sync._fetch_label_pdf("file:///etc/passwd")


@mock.patch.object(meesho_sync, "_worker_alive", lambda: True)
class CombinedBusinessesTests(TestCase):
    """Every assigned business with a Meesho account, on one dashboard."""

    def setUp(self):
        from django.utils import timezone
        from .models import Order
        self.a = Business.objects.create(name="Rudam")
        self.b = Business.objects.create(name="Cosmify")
        self.c = Business.objects.create(name="Elsewhere")             # not assigned
        self.admin = User.objects.create_user(username="a", password="pw", role=User.ROLE_SUPER_ADMIN)
        from .models import OrderScanSetting                            # the admin's chosen desk
        OrderScanSetting.objects.create(user=self.admin, business_ids=[self.a.id, self.b.id])
        now = timezone.now()
        def acct(biz, sid):
            a = MeeshoAccount.objects.create(business=biz, phone_number=f"90000000{sid}", password_enc="v1:x", status="ACTIVE",
                                             supplier_id=f"{sid}", supplier_identifier=f"code{sid}", supplier_name=biz.name)
            row = lambda n, label="Not Downloaded", sla="sla_others": {"sub_order_num": f"{n}_1", "sub_order_id": f"{n}_1_FORWARD",
                                                                      "grouping_key": f"{n}_1_FORWARD", "shipment_type": "forward",
                                                                      "label": label, "sla_status": sla}
            a.snapshots.create(endpoint="orders_pending", http_status=200, fetched_at=now, payload=[row(f"{sid}1"), row(f"{sid}2")])
            a.snapshots.create(endpoint="orders_ready_to_ship", http_status=200, fetched_at=now,
                               payload=[{**row(f"{sid}3", "Downloaded", "breached"), "awb": f"VL{sid}3"}, row(f"{sid}4")])
            return a
        self.acct_a, self.acct_b, self.acct_c = acct(self.a, 1), acct(self.b, 2), acct(self.c, 3)
        Order.objects.create(business=self.a, sub_order_no="13_1", reason_for_credit_entry="READY_TO_SHIP", packet_id="KP2NUJE1")
        self.queued = []
        p = mock.patch.object(meesho_sync, "enqueue", side_effect=lambda job, args, queue="critical": self.queued.append((job, args)) or "jid")
        p.start()
        self.addCleanup(p.stop)
        self.cl = APIClient()
        self.cl.force_authenticate(self.admin)
        self.base = f"/api/business/{self.a.id}/meesho-orders"

    def test_the_dashboard_combines_the_assigned_businesses(self):
        d = self.cl.get(self.base + "/").data
        tabs = {t["key"]: t for t in d["tabs"]}
        self.assertEqual(tabs["pending"]["count"], 4)                   # 2 Rudam + 2 Cosmify, not Elsewhere
        self.assertEqual({r["business_name"] for r in tabs["pending"]["rows"]}, {"Rudam", "Cosmify"})
        rts = {r["sub_order_num"]: r for r in tabs["ready_to_ship"]["rows"]}
        self.assertEqual((rts["13_1"]["awb"], rts["13_1"]["packet_id"]), ("VL13", "KP2NUJE1"))   # packet id from the Orders CSV
        self.assertIsNone(rts["14_1"]["packet_id"])
        self.assertEqual(tabs["ready_to_ship"]["breached"], 2)
        self.assertEqual({a["business_name"] for a in d["accounts"]}, {"Rudam", "Cosmify"})

    def test_accepting_across_businesses_sends_each_to_its_own_account(self):
        r = self.cl.post(self.base + "/accept/", {"orders": [
            {"business_id": self.a.id, "sub_order_num": "11_1"}, {"business_id": self.b.id, "sub_order_num": "21_1"},
            {"business_id": self.b.id, "sub_order_num": "22_1"}]}, format="json")
        self.assertEqual(r.status_code, 202, r.data)
        sent = {args[0]: [g["sub_order_ids"][0] for g in args[2]] for job, args in self.queued}
        self.assertEqual(sent, {self.acct_a.pk: ["11_1_FORWARD"], self.acct_b.pk: ["21_1_FORWARD", "22_1_FORWARD"]})
        self.assertEqual({j for j, _ in self.queued}, {"MeeshoAcceptJob"})

    def test_nothing_is_sent_unless_every_business_checks_out(self):
        r = self.cl.post(self.base + "/accept/", {"orders": [
            {"business_id": self.a.id, "sub_order_num": "11_1"}, {"business_id": self.b.id, "sub_order_num": "99_1"}]}, format="json")
        self.assertEqual(r.status_code, 409)
        self.assertIn("Cosmify", r.data["error"])
        self.assertEqual(self.queued, [])
        r = self.cl.post(self.base + "/accept/", {"orders": [{"business_id": self.c.id, "sub_order_num": "31_1"}]}, format="json")
        self.assertEqual(r.status_code, 400)                            # a business not on this desk
        self.assertEqual(self.queued, [])

    def test_labels_for_several_businesses_share_a_batch_and_download_merged(self):
        import base64
        from pypdf import PdfReader
        from .test_label_engine import make_labels_pdf
        r = self.cl.post(self.base + "/labels/", {"orders": [
            {"business_id": self.a.id, "sub_order_num": "14_1"}, {"business_id": self.b.id, "sub_order_num": "24_1"}]}, format="json")
        self.assertEqual(r.status_code, 202, r.data)
        batch = r.data["batch"]
        runs = list(MeeshoSyncRun.objects.filter(kind="LABELS"))
        self.assertEqual({run.result["batch"] for run in runs}, {batch})
        self.assertEqual({run.account_id for run in runs}, {self.acct_a.pk, self.acct_b.pk})
        # The worker finishes both.
        pdfs = {}
        for run, (sku, sub) in zip(sorted(runs, key=lambda x: x.account_id), [("lota-b", "14_1"), ("lota-a", "24_1")]):
            run.status = "OK"
            run.result = {**run.result, "label_url": f"https://storage.googleapis.com/{run.pk}.pdf", "success": 1, "total": 1}
            run.save()
            pdfs[run.result["label_url"]] = make_labels_pdf([(sku, sub, "X")])
        d = self.cl.get(self.base + "/").data["label_batches"][0]
        self.assertEqual((d["batch"], d["ready"], d["success"], d["busy"]), (batch, 2, 2, False))
        with mock.patch.object(meesho_sync, "_fetch_label_pdf", side_effect=lambda url: pdfs[url]):
            r = self.cl.post(f"{self.base}/labels/batch/{batch}/pdf/")
        self.assertEqual(r.status_code, 200, r.data)
        pages = PdfReader(__import__("io").BytesIO(base64.b64decode(r.data["sorted_pdf_b64"]))).pages
        self.assertEqual(len(pages), 2)                                 # both businesses, one file
        self.assertEqual(r.data["businesses"], ["Cosmify", "Rudam"])

    def test_refresh_pulls_every_combined_account(self):
        r = self.cl.post(self.base + "/refresh/")
        self.assertEqual((r.data["queued"], r.data["accounts"]), (2, 2))


class OrdersTabCurrentStatusTests(TestCase):
    """The Orders tab lists each order once, at its current status."""

    def setUp(self):
        from datetime import date, timedelta
        from django.utils import timezone
        from .models import Order
        self.biz = Business.objects.create(name="Rudam")
        other = Business.objects.create(name="Other")
        self.user = User.objects.create_user(username="a", password="pw", role=User.ROLE_SUPER_ADMIN)
        Membership.objects.create(user=self.user, business=self.biz)
        self.cl = APIClient()
        self.cl.force_authenticate(self.user)
        d, now = date(2026, 10, 7), timezone.now()
        def row(biz, sub, st, at, day=d):
            o = Order.objects.create(business=biz, sub_order_no=sub, reason_for_credit_entry=st, order_date=day, sku="lota")
            Order.objects.filter(pk=o.pk).update(created_at=now - timedelta(hours=at))
        # Accepted, then cancelled by the sync — the case that kept showing as Ready to ship.
        row(self.biz, "1_1", "PENDING", 30); row(self.biz, "1_1", "READY_TO_SHIP", 20); row(self.biz, "1_1", "CANCELLED", 1)
        row(self.biz, "2_1", "READY_TO_SHIP", 5)
        # The same sub-order number in another business is a different order.
        row(other, "2_1", "CANCELLED", 0)

    def get(self, **params):
        return self.cl.get(f"/api/business/{self.biz.id}/full-orders/", params).data

    def test_each_order_once_at_its_current_status(self):
        d = self.get()
        self.assertEqual(d["total"], 2)
        rows = {r["sub_order_no"]: r for r in d["results"]}
        self.assertEqual(rows["1_1"]["reason_for_credit_entry"], "CANCELLED")
        self.assertEqual(rows["1_1"]["history"], ["PENDING", "READY_TO_SHIP", "CANCELLED"])
        self.assertEqual((rows["2_1"]["reason_for_credit_entry"], rows["2_1"]["history"]), ("READY_TO_SHIP", []))

    def test_a_cancelled_order_is_not_listed_as_ready_to_ship(self):
        d = self.get(status="READY_TO_SHIP")
        self.assertEqual([r["sub_order_no"] for r in d["results"]], ["2_1"])
        self.assertEqual([r["sub_order_no"] for r in self.get(status="CANCELLED")["results"]], ["1_1"])
        a = self.cl.get(f"/api/business/{self.biz.id}/full-orders/analytics/").data
        self.assertEqual({x["reason_for_credit_entry"]: x["count"] for x in a["by_status"]}, {"CANCELLED": 1, "READY_TO_SHIP": 1})


class WorkerWritesDropCachedAnswersTests(TestCase):
    def test_the_cache_key_moves_when_the_worker_changes_orders(self):
        from types import SimpleNamespace
        from django.test import RequestFactory
        from django.utils import timezone
        from . import api_cache
        biz = Business.objects.create(name="Rudam")
        acct = MeeshoAccount.objects.create(business=biz, phone_number="9000000001", password_enc="v1:x", status="ACTIVE")
        req = RequestFactory().get(f"/api/business/{biz.id}/full-orders/")
        user = SimpleNamespace(pk=1)
        with mock.patch.object(api_cache, "business_version", lambda b: 1), mock.patch.object(api_cache, "global_version", lambda: 1):
            before = api_cache._cache_key(req, biz.id, user)
            self.assertEqual(before, api_cache._cache_key(req, biz.id, user))       # stable while nothing changes
            acct.orders_changed_at = timezone.now()
            acct.save()
            self.assertNotEqual(before, api_cache._cache_key(req, biz.id, user))


class NeverCachedTests(TestCase):
    def test_worker_written_pages_are_never_cached(self):
        from .api_cache import _NEVER_CACHE_PREFIXES
        for path in ("meesho-sync/", "meesho-orders/", "meesho-orders/accept/"):
            self.assertTrue(any(path.startswith(p) for p in _NEVER_CACHE_PREFIXES), path)
