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


    CURL = ("curl 'https://supplier.meesho.com/api/v3/orders/search' \\\n"
            "  -H 'accept: application/json' \\\n"
            "  -H 'browser-id: YnJ3MTIz' \\\n"
            "  -H 'identifier: xzvey' \\\n"
            "  -b '_abck=aaa; connect.sid=s%3Areal.sig; s_id=4313711; current_az_identifier=xzvey' \\\n"
            "  --data-raw '{\"page\":1}'")

    def paste(self, session, client=None, **body):
        return (client or self.client_for(self.admin)).post(f"{self.base}/session/", {"session": session, **body}, format="json")

    def test_a_pasted_curl_becomes_the_session_and_queues_a_pull(self):
        r = self.paste(self.CURL)
        self.assertEqual(r.status_code, 200, r.data)
        a = MeeshoAccount.objects.get()
        self.assertEqual(json.loads(meesho_sync.decrypt(a.cookies_enc)),
                         {"_abck": "aaa", "connect.sid": "s%3Areal.sig", "s_id": "4313711", "current_az_identifier": "xzvey"})
        self.assertNotIn("s%3Areal", a.cookies_enc)
        self.assertEqual((a.status, a.browser_id, a.supplier_identifier, a.supplier_id, a.password_enc), ("ACTIVE", "YnJ3MTIz", "xzvey", "4313711", ""))
        self.assertEqual([q[0] for q in self.queued], ["MeeshoSyncJob"])
        self.assertNotIn("s%3Areal", json.dumps(r.data, default=str))
        self.assertFalse(r.data["account"]["has_password"])

    def test_cookie_header_and_json_exports_are_read_too(self):
        parse = meesho_sync._parse_pasted_session
        self.assertEqual(parse("cookie: connect.sid=abc; bm_sz=x=y")[0], {"connect.sid": "abc", "bm_sz": "x=y"})
        self.assertEqual(parse('[{"name": "connect.sid", "value": "abc"}]')[0], {"connect.sid": "abc"})
        self.assertEqual(parse('{"connect.sid": "abc"}')[0], {"connect.sid": "abc"})
        self.assertEqual(parse("curl 'https://x' -H 'Cookie: connect.sid=abc'")[0], {"connect.sid": "abc"})

    def test_a_paste_without_the_session_cookie_is_refused(self):
        r = self.paste("_abck=aaa; bm_sz=bbb")
        self.assertEqual(r.status_code, 400)
        self.assertIn("connect.sid", r.data["error"])
        self.assertFalse(MeeshoAccount.objects.exists())

    def test_pasting_keeps_a_saved_password_and_only_admins_paste(self):
        self.assertEqual(self.paste(self.CURL, self.client_for(self.worker)).status_code, 403)
        self.connect()
        self.paste("connect.sid=fresh")
        a = MeeshoAccount.objects.get()
        self.assertEqual(meesho_sync.decrypt(a.password_enc), "s3cret!")
        self.assertEqual((a.phone_number, a.status), ("9000000001", "ACTIVE"))

    def test_pasting_after_disconnect_doesnt_bring_the_password_back(self):
        self.connect()
        self.client_for(self.admin).post(f"{self.base}/disconnect/")
        self.paste("connect.sid=fresh")
        a = MeeshoAccount.objects.get()
        self.assertEqual((a.status, a.password_enc, a.sync_enabled), ("ACTIVE", "", True))

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
        self.assertEqual([t["key"] for t in d["tabs"]], ["hold", "pending", "ready_to_ship", "shipped", "cancelled"])
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
                               payload=[{**row(f"{sid}3", "Downloaded", "breached"), "awb": f"VL{sid}3"}, row(f"{sid}4"),
                                        {**row(f"{sid}5"), "packet_id": f"PANEL{sid}5"}])
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
        self.assertEqual(rts["15_1"]["packet_id"], "PANEL15")                # packet id pulled from the panel
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
        # Kept, ready to print again once Meesho's links have expired.
        from .models import MeeshoLabelFile
        kept = MeeshoLabelFile.objects.get(batch=batch)
        self.assertEqual((kept.trigger, kept.labels, kept.business_names), ("MANUAL", 2, ["Cosmify", "Rudam"]))
        self.assertEqual(len(PdfReader(__import__("io").BytesIO(bytes(kept.pdf))).pages), 2)

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


@mock.patch.dict(os.environ, {"MEESHO_SYNC_KEY": KEY})
@mock.patch.object(meesho_sync, "_worker_alive", lambda: True)
class LiveInventoryTests(TestCase):
    def setUp(self):
        from django.utils import timezone
        from .models import FinalPrice, MeeshoCatalog, MeeshoListing, ParentItemPrice
        now = timezone.now()
        self.biz = Business.objects.create(name="Cosmify")
        self.admin = User.objects.create_user(username="a", password="pw", role=User.ROLE_SUPER_ADMIN)
        self.worker = User.objects.create_user(username="w", password="pw", role=User.ROLE_BUSINESS_USER)
        for u in (self.admin, self.worker):
            Membership.objects.create(user=u, business=self.biz)
        self.acct = MeeshoAccount.objects.create(business=self.biz, phone_number="9000000001", password_enc="v1:x",
                                                 status="ACTIVE", supplier_id="3564327", supplier_identifier="lffy4")
        self.acct.snapshots.create(endpoint="inventory_counts", http_status=200, fetched_at=now,
                                   payload={"active": 2, "paused": 1, "activation_pending": 1, "blocked": 3})
        cat = lambda cid, **kw: MeeshoCatalog.objects.create(**{"account": self.acct, "catalog_id": cid, "name": f"Cat {cid}",
                                                               "seen_at": now, "products_fetched_at": now, **kw})
        c1, c2, c3 = cat(1, in_active=True), cat(2, in_active=True, in_paused=True), cat(3, in_paused=True)
        cat(4, in_pending=True, products_fetched_at=None)
        row = lambda c, pid, sku, archived=False: MeeshoListing.objects.create(
            account=self.acct, catalog=c, product_id=pid, variation_id=167, sku_id=sku, inventory=5, archived=archived, seen_at=now)
        self.l11, self.l21 = row(c1, 11, "thali-a"), row(c2, 21, "thali-b")
        self.l22, self.l31 = row(c2, 22, "lota", archived=True), row(c3, 31, "diya")
        parent = ParentItemPrice.objects.create(item_id="Brass Thali", business=self.biz)
        for sku in ("thali-a", "thali-b"):
            FinalPrice.objects.create(sku_id=sku, parent=parent, business=self.biz)
        self.base = f"/api/business/{self.biz.id}/meesho-live-inventory"
        self.queued = []
        p = mock.patch.object(meesho_sync, "enqueue", side_effect=lambda job, args, queue="critical": self.queued.append((job, args)) or "jid")
        p.start()
        self.addCleanup(p.stop)

    def client_for(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c

    def test_skus_are_grouped_by_their_parent(self):
        d = self.client_for(self.worker).get(self.base + "/").data
        groups = {g["parent"]: g for g in d["groups"]}
        self.assertEqual([s["sku_id"] for s in groups["Brass Thali"]["skus"]], ["thali-a", "thali-b"])
        self.assertEqual({s["sku_id"] for s in groups[None]["skus"]}, {"lota", "diya"})       # not linked to a parent
        self.assertEqual(d["groups"][-1]["parent"], None)                                     # unlinked last
        lota = next(s for s in groups[None]["skus"] if s["sku_id"] == "lota")["listings"][0]
        self.assertEqual((lota["catalog_id"], lota["archived"]), (2, True))
        self.assertEqual(d["accounts"][0]["counts"]["blocked"], 3)
        self.assertEqual([c["catalog_id"] for c in d["pending"]], [4])
        self.assertFalse(d["is_admin"])

    def test_pause_groups_the_skus_by_catalog_for_the_worker(self):
        r = self.client_for(self.admin).post(self.base + "/pause/", {"listings": [self.l11.pk, self.l21.pk, self.l22.pk]}, format="json")
        self.assertEqual(r.status_code, 202, r.data)
        (job, (acct_id, run_id, items)), = self.queued
        self.assertEqual((job, acct_id), ("MeeshoArchiveJob", self.acct.pk))
        # The paused one (22) isn't sent again; one entry per catalog.
        self.assertEqual(sorted(items, key=lambda i: i["catalog_id"]), [
            {"catalog_id": 1, "products": [{"product_id": 11, "variation_id": 167}]},
            {"catalog_id": 2, "products": [{"product_id": 21, "variation_id": 167}]}])
        self.assertEqual(MeeshoSyncRun.objects.get(pk=run_id).records, 2)
        # One at a time.
        r = self.client_for(self.admin).post(self.base + "/pause/", {"listings": [self.l31.pk]}, format="json")
        self.assertEqual(r.status_code, 409)

    def test_only_an_admin_pauses_and_only_what_is_listed_here(self):
        self.assertEqual(self.client_for(self.worker).post(self.base + "/pause/", {"listings": [self.l11.pk]}, format="json").status_code, 403)
        c = self.client_for(self.admin)
        self.assertEqual(c.post(self.base + "/pause/", {"listings": [self.l11.pk, 999999]}, format="json").status_code, 409)
        self.assertEqual(c.post(self.base + "/pause/", {"listings": [self.l22.pk]}, format="json").status_code, 400)   # already paused
        self.assertEqual(self.queued, [])

    def test_refresh_queues_an_inventory_read(self):
        r = self.client_for(self.worker).post(self.base + "/refresh/")
        self.assertEqual(r.status_code, 202)
        self.assertEqual([j for j, _ in self.queued], ["MeeshoInventoryJob"])
        self.assertEqual(MeeshoSyncRun.objects.get().kind, "INVENTORY")

    def test_meesho_stock_shows_it_is_synced(self):
        from django.utils import timezone
        MeeshoSyncRun.objects.create(account=self.acct, kind="INVENTORY", status="OK", finished_at=timezone.now(),
                                     message="Active 2 …")
        d = self.client_for(self.admin).get(f"/api/business/{self.biz.id}/meesho-inventory/").data
        self.assertTrue(d["sync"]["connected"])
        self.assertIsNotNone(d["sync"]["last_ok_at"])
        self.assertFalse(d["sync"]["running"])

    def test_an_uploaded_sheet_matches_rows_by_product_not_serial_number(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        from .models import MeeshoInventory
        # Synced rows: serial 1 is product 11, serial 2 is product 21.
        for sno, pid in ((1, 11), (2, 21)):
            MeeshoInventory.objects.create(business=self.biz, serial_no=sno, catalog_name="c", catalog_id=1, product_name="p",
                                           product_id=pid, style_id=f"s{pid}", variation_id=167, system_stock_count=5)
        # A fresh Meesho export numbers its rows from 1 again: serial 1 is now product 21, serial 2 a new product 31.
        csv = ("SERIAL NO,CATALOG NAME,CATALOG ID,PRODUCT NAME,PRODUCT ID,STYLE ID,VARIATION ID,VARIATION,STOCK,SYSTEM STOCK COUNT,YOUR STOCK COUNT\n"
               "1,c,1,p,21,s21,167,Free Size,IN_STOCK,9,\n"
               "2,c,1,p,31,s31,167,Free Size,IN_STOCK,4,\n")
        r = self.client_for(self.admin).post(f"/api/business/{self.biz.id}/meesho-inventory/upload/",
                                             {"file": SimpleUploadedFile("inv.csv", csv.encode())}, format="multipart")
        self.assertEqual((r.data["created"], r.data["updated"]), (1, 1), r.data)
        rows = {i.product_id: (i.serial_no, i.system_stock_count) for i in MeeshoInventory.objects.filter(business=self.biz)}
        self.assertEqual(rows, {11: (1, 5), 21: (2, 9), 31: (3, 4)})       # nothing written over another product

    def test_the_meesho_page_overview_and_its_tabs_permissions(self):
        from accounts.nav import NAV_PATHS, owners_for_api_path
        d = self.client_for(self.worker).get(f"/api/business/{self.biz.id}/meesho-orders/overview/").data
        (b,) = d["businesses"]
        self.assertEqual((b["business_name"], b["connected"], d["current_business_id"]), ("Cosmify", True, self.biz.id))
        self.assertIn("stock_rows", b["inventory"])
        # Sync and Inventory are tabs of Meesho Orders: one nav entry grants all three.
        self.assertNotIn("/meesho-sync", NAV_PATHS)
        self.assertNotIn("/meesho-live-inventory", NAV_PATHS)
        for api in ("meesho-sync/connect/", "meesho-live-inventory/pause/", "meesho-orders/overview/"):
            self.assertEqual(owners_for_api_path(api), ["/meesho-orders"], api)


def _payment_workbook(path, rows):
    """A Meesho payment file in miniature: the three header rows, then order payments."""
    import openpyxl
    from .views import ORDER_PAYMENT_COLUMNS
    wb = openpyxl.Workbook()
    wb.active.title = "Disclaimer"
    ws = wb.create_sheet("Order Payments")
    ws.append(["Order Related Details"] + [None] * (len(ORDER_PAYMENT_COLUMNS) - 1))
    ws.append(ORDER_PAYMENT_COLUMNS)
    ws.append(["A"] * len(ORDER_PAYMENT_COLUMNS))
    for r in rows:
        ws.append([r.get(c) for c in ORDER_PAYMENT_COLUMNS])
    wb.save(path)


@mock.patch.dict(os.environ, {"MEESHO_SYNC_KEY": KEY})
@mock.patch.object(meesho_sync, "_worker_alive", lambda: True)
class MeeshoPaymentsTests(TestCase):
    def setUp(self):
        import tempfile
        self.biz = Business.objects.create(name="Cosmify")
        self.admin = User.objects.create_user(username="a", password="pw", role=User.ROLE_SUPER_ADMIN)
        Membership.objects.create(user=self.admin, business=self.biz)
        self.acct = MeeshoAccount.objects.create(business=self.biz, phone_number="9000000001", password_enc="v1:x",
                                                 status="ACTIVE", supplier_id="3564327", supplier_identifier="lffy4")
        self.dir = tempfile.mkdtemp()
        self.c = APIClient()
        self.c.force_authenticate(self.admin)
        self.base = f"/api/business/{self.biz.id}/meesho-orders/payments"

    def file(self, name, rows):
        path = os.path.join(self.dir, name)
        _payment_workbook(path, rows)
        return path

    def run_command(self, kind, path):
        from io import StringIO
        from django.core.management import call_command
        out = StringIO()
        call_command("import_meesho_payments", business=self.biz.pk, file=path, kind=kind, stdout=out)
        return json.loads(out.getvalue())

    def test_completed_payments_land_in_the_payments_table_like_an_upload(self):
        from .models import OrderPayment
        row = {"sub_order_no": "111_1", "order_date": "2026-10-01 10:00", "supplier_sku": "lota", "live_order_status": "Delivered",
               "quantity": 1, "transaction_id": "AXIS1", "payment_date": "2026-10-08", "final_settlement_amount": 250.5}
        path = self.file("done.xlsx", [row])
        self.assertEqual(self.run_command("completed", path)["order_payments"], {"created": 1, "updated": 0})
        self.assertEqual(self.run_command("completed", path)["order_payments"], {"created": 0, "updated": 1})   # every 2 hours: no duplicates
        p = OrderPayment.objects.get(business=self.biz)
        self.assertEqual((p.sub_order_no, p.transaction_id, float(p.final_settlement_amount)), ("111_1", "AXIS1", 250.5))

    def test_outstanding_payments_are_kept_apart_and_replaced_each_time(self):
        from .models import MeeshoOutstandingPayment, OrderPayment
        first = self.file("o1.xlsx", [{"sub_order_no": "1_1", "payment_date": "2026-11-02", "final_settlement_amount": 100, "live_order_status": "Shipped"},
                                      {"sub_order_no": "2_1", "payment_date": "2026-11-03", "final_settlement_amount": -40, "live_order_status": "RTO"}])
        self.assertEqual(self.run_command("outstanding", first), {"outstanding": {"rows": 2, "replaced": 0, "files": 1}})
        second = self.file("o2.xlsx", [{"sub_order_no": "3_1", "payment_date": "2026-11-04", "final_settlement_amount": 70}])
        self.run_command("outstanding", second)
        self.assertEqual(list(MeeshoOutstandingPayment.objects.values_list("sub_order_no", flat=True)), ["3_1"])
        self.assertFalse(OrderPayment.objects.exists())          # not paid yet: never counted as settled

    def test_the_payments_upload_skips_rows_not_paid_yet(self):
        from .models import OrderPayment
        from .views import _ist_today
        import datetime as dt
        future = (_ist_today() + dt.timedelta(days=3)).isoformat()
        path = self.file("mixed.xlsx", [
            {"sub_order_no": "1_1", "transaction_id": "AXIS1", "payment_date": "2026-10-08", "final_settlement_amount": 10},
            {"sub_order_no": "2_1", "payment_date": future, "final_settlement_amount": 20},           # outstanding: not paid
            {"sub_order_no": "3_1", "transaction_id": "AXIS2", "payment_date": future, "final_settlement_amount": 30},  # paid ahead
        ])
        counts = self.run_command("completed", path)["order_payments"]
        self.assertEqual(counts, {"created": 2, "updated": 0, "skipped_unpaid": 1})
        self.assertEqual(sorted(OrderPayment.objects.values_list("sub_order_no", flat=True)), ["1_1", "3_1"])

    def test_outstanding_days_are_imported_together_once_each(self):
        from io import StringIO
        from django.core.management import call_command
        from .models import MeeshoOutstandingPayment
        day1 = self.file("d1.xlsx", [{"sub_order_no": "1_1", "payment_date": "2026-11-02", "final_settlement_amount": 100}])
        day2 = self.file("d2.xlsx", [{"sub_order_no": "1_1", "payment_date": "2026-11-02", "final_settlement_amount": 100},
                                     {"sub_order_no": "2_1", "payment_date": "2026-11-03", "final_settlement_amount": 50}])
        out = StringIO()
        call_command("import_meesho_payments", "--business", str(self.biz.pk), "--kind", "outstanding",
                     "--file", day1, "--file", day2, stdout=out)                 # as the worker runs it
        self.assertEqual(json.loads(out.getvalue())["outstanding"], {"rows": 2, "replaced": 0, "files": 2})
        self.assertEqual(sorted(MeeshoOutstandingPayment.objects.values_list("sub_order_no", flat=True)), ["1_1", "2_1"])

    def test_unpaid_rows_already_in_the_table_can_be_removed(self):
        from io import StringIO
        from django.core.management import call_command
        from .models import OrderPayment
        from .views import _ist_today
        import datetime as dt
        future = _ist_today() + dt.timedelta(days=4)
        OrderPayment.objects.create(business=self.biz, sub_order_no="9_1", payment_date=future, live_order_status="Shipped")
        OrderPayment.objects.create(business=self.biz, sub_order_no="8_1", payment_date=future, transaction_id="AXIS9")
        OrderPayment.objects.create(business=self.biz, sub_order_no="7_1", payment_date=dt.date(2026, 10, 1))
        out = StringIO()
        call_command("remove_unpaid_order_payments", stdout=out)
        self.assertIn("1 rows would be removed", out.getvalue())
        self.assertEqual(OrderPayment.objects.count(), 3)                         # a dry run by default
        call_command("remove_unpaid_order_payments", apply=True, stdout=StringIO())
        self.assertEqual(sorted(OrderPayment.objects.values_list("sub_order_no", flat=True)), ["7_1", "8_1"])

    def test_the_payments_tab_shows_summaries_and_outstanding(self):
        from django.utils import timezone
        from .models import MeeshoOutstandingPayment
        self.acct.snapshots.create(endpoint="payments_summary", http_status=200, fetched_at=timezone.now(), payload={
            "previous": {"daywisePayments": [{"date": "2026-10-30", "netAmount": 16766.47, "netOrderAmount": 16916.52,
                                              "transferId": "AXIS1", "netPlatformRecovery": {"adsCost": -150.05}}]},
            "upcoming": {"daywisePayments": [{"date": "2026-11-02", "netAmount": 45535.92}]},
            "previous_total": {"netAmount": 836640.97}, "upcoming_total": {"netAmount": 141071.14}})
        MeeshoOutstandingPayment.objects.create(business=self.biz, sub_order_no="9_1", final_settlement_amount=99, imported_at=timezone.now())
        d = self.c.get(self.base + "/").data
        (a,) = d["accounts"]
        self.assertEqual((a["paid_total"], a["upcoming_total"]), (836640.97, 141071.14))
        self.assertEqual(a["paid"][0]["transfer_id"], "AXIS1")
        self.assertEqual(a["paid"][0]["ads"], -150.05)
        self.assertEqual((d["outstanding_count"], d["outstanding_total"]), (1, 99.0))

    def test_refresh_queues_a_payments_read(self):
        with mock.patch.object(meesho_sync, "enqueue", return_value="jid") as enq:
            r = self.c.post(self.base + "/refresh/")
        self.assertEqual(r.status_code, 202)
        self.assertEqual(enq.call_args[0][0], "MeeshoPaymentsJob")
        self.assertEqual(MeeshoSyncRun.objects.get().kind, "PAYMENTS")


@mock.patch.dict(os.environ, {"MEESHO_SYNC_KEY": KEY})
class AutoLabelsSendTests(TestCase):
    def setUp(self):
        self.biz = Business.objects.create(name="Cosmify")
        self.admin = User.objects.create_user(username="a", password="pw", role=User.ROLE_SUPER_ADMIN)
        self.acct = MeeshoAccount.objects.create(business=self.biz, phone_number="9000000001", password_enc="v1:x",
                                                 status="ACTIVE", supplier_id="3564327", supplier_identifier="lffy4")

    def save(self, batch="auto-1", summary="Cosmify: 2 of 2 pending accepted", send=False):
        from io import StringIO
        from django.core.management import call_command
        out = StringIO()
        with mock.patch("meesho_app.notify.send", return_value={"telegram": "sent"}) as notify_send:
            call_command("meesho_save_labels", batch=batch, summary=summary, send=send, stdout=out)
        return json.loads(out.getvalue()), notify_send

    def test_no_new_labels_keeps_nothing_and_sends_nothing(self):
        from .models import MeeshoLabelFile
        out, notify_send = self.save()
        self.assertEqual(out["labels"], 0)
        self.assertFalse(MeeshoLabelFile.objects.exists())
        notify_send.assert_not_called()

    def test_labels_are_merged_sorted_saved_and_kept_ready_to_print(self):
        from .models import LabelOrder, MeeshoLabelFile
        from .test_label_engine import make_labels_pdf
        MeeshoSyncRun.objects.create(account=self.acct, kind="LABELS", status="OK", records=2,
                                     result={"batch": "auto-1", "label_url": "https://storage.googleapis.com/a.pdf", "success": 2})
        MeeshoSyncRun.objects.create(account=self.acct, kind="LABELS", status="OK", result={"batch": "other", "label_url": "x"})
        pdf = make_labels_pdf([("lota-b", "2_1", "X"), ("lota-a", "1_1", "Y")])
        with mock.patch.object(meesho_sync, "_fetch_label_pdf", return_value=pdf) as fetch:
            out, notify_send = self.save()
        fetch.assert_called_once_with("https://storage.googleapis.com/a.pdf")          # only this run's batch
        f = MeeshoLabelFile.objects.get()
        self.assertEqual((out["file_id"], f.trigger, f.labels, f.sorted, f.business_names), (f.pk, "AUTO", 2, True, ["Cosmify"]))
        self.assertTrue(bytes(f.pdf).startswith(b"%PDF"))
        self.assertIn("2 of 2 pending accepted", f.summary)
        self.assertTrue(LabelOrder.objects.exists())                                # saved for Order Scan, as an upload would
        notify_send.assert_not_called()                                              # sending is off unless asked
        with mock.patch.object(meesho_sync, "_fetch_label_pdf", return_value=pdf):
            _, notify_send = self.save(send=True)
        self.assertTrue(notify_send.call_args.kwargs["data"].startswith(b"%PDF"))
        self.assertEqual(MeeshoLabelFile.objects.count(), 1)                         # same batch: kept once
        from io import StringIO
        from django.core.management import call_command
        with mock.patch.object(meesho_sync, "_fetch_label_pdf", return_value=pdf):
            call_command("meesho_save_labels", batch="auto-1", trigger="MANUAL", stdout=StringIO())
        self.assertEqual(MeeshoLabelFile.objects.get().trigger, "MANUAL")           # a Generate from Meesho Orders

    def test_the_automation_setting(self):
        c = APIClient()
        c.force_authenticate(self.admin)
        Membership.objects.create(user=self.admin, business=self.biz)
        url = f"/api/business/{self.biz.id}/meesho-orders/automation/"
        d = c.get(url).data
        self.assertEqual((d["enabled"], d["accept_every_minutes"], d["label_times"]), (False, 30, ["17:00"]))   # starts off
        d = c.patch(url, {"enabled": True, "accept_every_minutes": 60, "label_times": ["9:05", "17:00", "17:00"]}, format="json").data
        self.assertEqual((d["enabled"], d["accept_every_minutes"], d["label_times"]), (True, 60, ["09:05", "17:00"]))
        self.assertIsNotNone(d["next_labels_at"])
        self.assertEqual(c.patch(url, {"label_times": ["25:00"]}, format="json").status_code, 400)
        self.assertEqual(c.patch(url, {"accept_every_minutes": 7}, format="json").status_code, 400)
        worker = User.objects.create_user(username="w", password="pw", role=User.ROLE_BUSINESS_USER)
        Membership.objects.create(user=worker, business=self.biz)
        w = APIClient()
        w.force_authenticate(worker)
        self.assertEqual(w.get(url).status_code, 200)
        self.assertEqual(w.patch(url, {"enabled": False}, format="json").status_code, 403)

    def test_kept_labels_are_listed_and_served_to_print(self):
        from .models import MeeshoLabelFile
        Membership.objects.create(user=self.admin, business=self.biz)
        other = Business.objects.create(name="Elsewhere")
        mine = MeeshoLabelFile.objects.create(batch="b1", trigger="AUTO", business_ids=[self.biz.pk], business_names=["Cosmify"],
                                              labels=3, pdf=b"%PDF-1.4 mine")
        MeeshoLabelFile.objects.create(batch="b2", business_ids=[other.pk], business_names=["Elsewhere"], pdf=b"%PDF theirs")
        c = APIClient()
        c.force_authenticate(self.admin)
        base = f"/api/business/{self.biz.id}/meesho-orders/label-files"
        files = c.get(base + "/").data["files"]
        self.assertEqual([f["id"] for f in files], [mine.pk])                       # only this desk's businesses
        r = c.get(f"{base}/{mine.pk}/pdf/")
        self.assertEqual((r["Content-Type"], r.content), ("application/pdf", b"%PDF-1.4 mine"))
        self.assertTrue(r["Content-Disposition"].startswith("inline"))
        self.assertTrue(c.get(f"{base}/{mine.pk}/pdf/?download=1")["Content-Disposition"].startswith("attachment"))
        self.assertEqual(c.get(f"{base}/{mine.pk + 1}/pdf/").status_code, 404)        # not this desk's

    def test_telegram_and_email_go_out_where_set_up(self):
        from django.core import mail
        from . import notify
        env = {"TELEGRAM_BOT_TOKEN": "123:abc", "TELEGRAM_CHAT_ID": "111, 222", "LABELS_EMAIL_TO": "me@example.com"}
        sent = []

        class Resp:
            def __init__(self, req): sent.append(req)
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def read(self): return b'{"ok": true}'

        with mock.patch.dict(os.environ, env), mock.patch("meesho_app.notify.urlopen", side_effect=lambda req, timeout: Resp(req)):
            result = notify.send("Meesho labels", "12 labels", filename="l.pdf", data=b"%PDF-1.4 x")
        self.assertEqual(result, {"telegram": "sent", "email": "sent"})
        self.assertEqual(len(sent), 2)                                              # one per chat
        self.assertTrue(sent[0].full_url.endswith("/bot123:abc/sendDocument"))
        self.assertIn(b'name="document"; filename="l.pdf"', sent[0].data)
        self.assertIn(b"%PDF-1.4 x", sent[0].data)
        self.assertEqual(mail.outbox[0].to, ["me@example.com"])
        self.assertEqual(mail.outbox[0].attachments[0][0], "l.pdf")

    def test_one_channel_failing_doesnt_stop_the_other(self):
        from django.core import mail
        from . import notify
        with mock.patch.dict(os.environ, {"TELEGRAM_BOT_TOKEN": "t", "TELEGRAM_CHAT_ID": "1", "LABELS_EMAIL_TO": "me@example.com"}), \
                mock.patch("meesho_app.notify.urlopen", side_effect=OSError("network down")):
            result = notify.send("s", "t")
        self.assertEqual(result["telegram"], "error: network down")
        self.assertEqual(result["email"], "sent")
        self.assertEqual(len(mail.outbox), 1)
        with mock.patch.dict(os.environ, {"TELEGRAM_BOT_TOKEN": "", "LABELS_EMAIL_TO": ""}):
            self.assertEqual(notify.send("s", "t"), {})                            # nothing set up: nothing sent
