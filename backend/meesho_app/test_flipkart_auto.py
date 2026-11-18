"""Flipkart's automation: accept, print every label waiting, keep the PDF, send it, mark RTD — and when. Flipkart is faked."""

import io
from datetime import timedelta
from unittest import mock

from django.utils import timezone
from pypdf import PdfWriter

from . import flipkart_auto, notify
from .models import FlipkartAutoSetting, MeeshoLabelFile
from . import test_flipkart_actions as base
from .test_flipkart_actions import DBD, Hub
from .test_flipkart_seller import FakeFlipkart, _resp


def _pdf(pages=1):
    w = PdfWriter()
    for _ in range(pages):
        w.add_blank_page(width=288, height=432)
    b = io.BytesIO()
    w.write(b)
    return b.getvalue()


class FlowHub(Hub):
    """Seller Hub moving orders on: accepted → labels waiting; printed → waiting RTD; RTD → gone."""

    def __init__(self):
        super().__init__()
        self.printed = []
        self.print_status = 200
        self.fail_next = 0            # prints answered 500 "All batches failed…" before Seller Hub is ready
        self.never = set()            # groups Seller Hub can never make a label for
        self.label_delay = 0          # looks at To pack before an accepted order's label is there

    def orch(self, kw):
        inp = kw["json"]["variables"].get("input") or {}
        if self.label_delay and inp.get("status") == "pendingLabel":
            self.label_delay -= 1
            saved, self.waiting["pendingLabel"] = self.waiting["pendingLabel"], []
            try:
                return super().orch(kw)
            finally:
                self.waiting["pendingLabel"] = saved
        return super().orch(kw)

    def napi(self, kw):
        r = super().napi(kw)
        op = kw["json"]["operationName"]
        ids = {g["group_id"] for g in kw["json"]["variables"].get("groups") or []}
        if op == "AcceptOrders":
            moved = [g for g in self.waiting["pendingToAccept"] if g["groupId"] in ids]
            self.waiting["pendingToAccept"] = [g for g in self.waiting["pendingToAccept"] if g["groupId"] not in ids]
            self.waiting["pendingLabel"] += moved
        elif op == "MarkRTD":
            self.waiting["pendingRTD"] = [g for g in self.waiting["pendingRTD"] if g["groupId"] not in ids]
        return r

    def print_(self, session, kw):
        body = kw["json"]
        self.sent.append({"op": "Print", "body": body, "headers": kw.get("headers") or {}})
        ids = {g["group_id"] for g in body["groups"]}
        if self.print_status != 200 or self.fail_next or ids & self.never:
            self.fail_next = max(0, self.fail_next - 1)
            return _resp(500, {"message": "All batches failed during document generation"})
        moved = [g for g in self.waiting["pendingLabel"] if g["groupId"] in ids]
        self.printed += [g["groupId"] for g in moved]
        self.waiting["pendingLabel"] = [g for g in self.waiting["pendingLabel"] if g["groupId"] not in ids]
        self.waiting["pendingRTD"] += moved
        r = _resp(200, {})
        r._content = _pdf(sum(g["shipment_count"] for g in body["groups"]))
        r.headers["Content-Type"] = "application/pdf"
        return r


class FlipkartAutoTests(base.FlipkartActionTests):
    """Runs on FlipkartActionTests' setup (a connected account, the fake Seller Hub)."""

    def setUp(self):
        super().setUp()
        self.hub = FlowHub()
        for name, fake in (("orders", staticmethod(self.hub.orch)), ("payments", staticmethod(self.hub.napi))):
            p = mock.patch.object(FakeFlipkart, name, fake)
            p.start()
            self.addCleanup(p.stop)
        FakeFlipkart.script = {flipkart_auto.PRINT_PATH: self.hub.print_}
        for target, name, value in ((flipkart_auto, "LABEL_WAIT_STEP", 0), (flipkart_auto.time, "sleep", lambda *_: None)):
            p = mock.patch.object(target, name, value)
            p.start()
            self.addCleanup(p.stop)
        self.sent = []
        p = mock.patch.object(notify, "send", side_effect=lambda *a, **k: self.sent.append((a, k)) or {"telegram": True})
        p.start()
        self.addCleanup(p.stop)


    def ops(self):
        return [x["op"] for x in self.hub.sent]

    def test_a_labels_run_accepts_prints_keeps_sends_then_marks_rtd(self):
        out = flipkart_auto.run("labels", trigger="AUTO")["Rudam"]
        self.assertEqual((out["accepted"], out["printed"], out["rtd"]), (5, 5, 5), out)
        self.assertEqual(self.ops(), ["AcceptOrders", "Print", "MarkRTD"])
        # Print, as Seller Hub sends it: the groups with labels waiting, the seller and the pickup location.
        p = next(x for x in self.hub.sent if x["op"] == "Print")
        self.assertEqual((p["body"]["status"], p["body"]["view"], p["body"]["seller_id"], p["body"]["location_id"]),
                         ("pendingLabel", "group_shipment", "41ad149fa06e4194", self.account.location_id))
        self.assertEqual(p["body"]["groups"][0]["price_range"], {"min_price": 85, "max_price": 85})
        self.assertEqual((p["headers"]["Accept"], p["headers"]["FK-CSRF-TOKEN"]), ("application/pdf", "csrf-1"))
        self.assertNotIn("is_breached", p["body"])                          # a dated bucket: its groups carry their date
        self.assertEqual(p["body"]["groups"][0]["dispatch_by_date"], DBD)
        # Labels are looked for where Seller Hub looks: To pack, by label printed or not.
        self.assertIn(("pendingToPack", {"labelPrintLevel": True}), self.hub.breakdowns)
        # Only what was printed is marked RTD — not 1_LSTDDD, waiting RTD from before.
        rtd = next(x for x in self.hub.sent if x["op"] == "MarkRTD")
        self.assertEqual(sorted(g["group_id"] for g in rtd["variables"]["groups"]), ["1_LSTAAA", "1_LSTBBB"])
        # Kept to print again, and sent.
        f = MeeshoLabelFile.objects.get(pk=out["file_id"])
        self.assertEqual((f.platform, f.trigger, f.labels, f.business_ids), ("flipkart", "AUTO", 5, [self.biz.id]))
        self.assertTrue(bytes(f.pdf).startswith(b"%PDF"))
        self.assertIn("Marked 5 Ready to Dispatch", f.summary)
        (title, caption), kw = self.sent[0]
        self.assertIn("Flipkart labels", title)
        self.assertEqual(kw["filename"][:16], "flipkart-labels-")

    def test_the_one_order_test_accepts_prints_and_marks_rtd_one_order(self):
        r = self.c.post(f"{self.base}auto/run/", {"business": self.biz.id, "kind": "labels", "limit": 1}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        out = r.data["results"]["Rudam"]
        self.assertEqual((out["accepted"], out["printed"], out["rtd"]), (1, 1, 1), out)
        accepted = next(x for x in self.hub.sent if x["op"] == "AcceptOrders")
        self.assertEqual([g["group_id"] for g in accepted["variables"]["groups"]], ["1_LSTBBB"])
        self.assertEqual(self.hub.printed, ["1_LSTBBB"])
        self.assertEqual(len(self.hub.waiting["pendingToAccept"]), 2)        # the 4-order group still to accept

    def test_a_breached_order_is_found_printed_and_marked_rtd_as_breached(self):
        # The order the live test stuck on: past dispatch-by, so under no date — listed and sent as "breached".
        self.hub.waiting["pendingToAccept"] = [dict(base._group("2_LSTPJT", 1), _breached=True)]
        self.hub.waiting["pendingRTD"] = []
        out = flipkart_auto.run("labels", limit=1)["Rudam"]
        self.assertEqual((out["accepted"], out["printed"], out["rtd"]), (1, 1, 1), out)
        acc = next(x for x in self.hub.sent if x["op"] == "AcceptOrders")
        self.assertEqual(acc["variables"]["filters"], {"is_breached": True})
        self.assertNotIn("dispatch_by_date", acc["variables"]["groups"][0])
        p = next(x for x in self.hub.sent if x["op"] == "Print")
        self.assertTrue(p["body"]["is_breached"])
        self.assertNotIn("dispatch_by_date", p["body"]["groups"][0])
        rtd = next(x for x in self.hub.sent if x["op"] == "MarkRTD")
        self.assertEqual((rtd["variables"]["filters"], rtd["variables"]["groups"][0]["group_id"]), ({"is_breached": True}, "2_LSTPJT"))
        self.assertNotIn("dispatch_by_date", rtd["variables"]["groups"][0])

    def test_after_accepting_it_waits_for_seller_hub_to_make_the_labels(self):
        self.hub.label_delay = 2                     # the label isn't there the first two looks
        out = flipkart_auto.run("labels", limit=1)["Rudam"]
        self.assertEqual((out["accepted"], out["printed"], out["rtd"]), (1, 1, 1), out)

    def test_a_label_that_never_comes_is_left_for_the_next_run(self):
        self.hub.label_delay = 10_000
        with mock.patch.object(flipkart_auto, "LABEL_WAIT_MAX", 0):
            out = flipkart_auto.run("labels", limit=1)["Rudam"]
        self.assertEqual((out["accepted"], out["printed"]), (1, 0), out)
        self.assertIn("next run prints them", " ".join(out["steps"]))
        self.assertNotIn("MarkRTD", self.ops())

    def test_label_printed_flags_sent_as_text_are_read_right(self):
        self.hub.flag = lambda v: "true" if v else "false"
        out = flipkart_auto.run("labels")["Rudam"]
        self.assertEqual((out["printed"], out["rtd"]), (5, 5), out)

    def test_nothing_to_print_says_what_seller_hub_showed(self):
        self.hub.waiting["pendingToAccept"] = []
        out = flipkart_auto.run("labels")["Rudam"]
        self.assertEqual(out["printed"], 0)
        self.assertIn("2 order(s) there already have their label printed", " ".join(out["steps"]))

    def test_while_seller_hub_is_making_the_documents_it_waits_and_tries_again(self):
        self.hub.fail_next = 3                     # "All batches failed during document generation", three times
        out = flipkart_auto.run("labels")["Rudam"]
        self.assertEqual((out["printed"], out["rtd"]), (5, 5), out)
        self.assertEqual(self.ops().count("Print"), 4)
        self.assertTrue(MeeshoLabelFile.objects.filter(platform="flipkart", labels=5).exists())

    def test_a_group_seller_hub_cant_do_never_holds_the_others_back(self):
        self.hub.never = {"1_LSTAAA"}
        out = flipkart_auto.run("labels")["Rudam"]
        self.assertEqual((out["printed"], out["rtd"]), (1, 1), out)            # 1_LSTBBB printed, kept and marked RTD
        self.assertEqual([x["group_id"] for x in out["not_printed"]], ["1_LSTAAA"])
        rtd = next(x for x in self.hub.sent if x["op"] == "MarkRTD")
        self.assertEqual([g["group_id"] for g in rtd["variables"]["groups"]], ["1_LSTBBB"])
        self.assertIn("couldn't make labels for yet", self.sent[0][0][1])      # said on Telegram with the PDF

    def test_reprint_gives_the_labels_waiting_rtd_again_and_keeps_them(self):
        r = self.c.post(f"{self.base}auto/reprint/", {"business": self.biz.id}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        out = r.data["results"]["Rudam"]
        self.assertEqual((out["printed"], out["rtd"]), (2, 0), out)            # 1_LSTDDD: printed, waiting RTD
        p = next(x for x in self.hub.sent if x["op"] == "Print")
        self.assertEqual(p["body"]["status"], "pendingRTD")                    # as Seller Hub's Reprint sends it
        self.assertEqual([g["group_id"] for g in p["body"]["groups"]], ["1_LSTDDD"])
        self.assertEqual(p["body"]["groups"][0]["dispatch_by_date"], DBD)
        self.assertNotIn("MarkRTD", self.ops())                                # a reprint never marks RTD
        self.assertNotIn("AcceptOrders", self.ops())
        self.assertTrue(MeeshoLabelFile.objects.filter(pk=out["file_id"], platform="flipkart", labels=2).exists())

    def test_every_run_is_kept_in_the_history_with_its_pdf(self):
        from .models import FlipkartLabelRun
        flipkart_auto.run("labels")
        self.hub.print_status = 500
        self.hub.waiting["pendingToAccept"] = [base._group("1_LSTEEE", 1)]
        flipkart_auto.run("labels")
        ok, failed = FlipkartLabelRun.objects.order_by("started_at")
        self.assertEqual((ok.status, ok.accepted, ok.printed, ok.rtd, ok.business_id), ("OK", 5, 5, 5, self.biz.id))
        self.assertIsNotNone(ok.file)
        self.assertEqual((failed.status, failed.printed, failed.file), ("FAILED", 0, None))
        self.assertIn("didn't make the labels", failed.error)
        d = self.c.get(f"{self.base}label-runs/", {"days": 7}).data
        self.assertEqual([x["status"] for x in d["runs"]], ["FAILED", "OK"])                 # newest first
        self.assertEqual((d["totals"]["printed"], d["totals"]["rtd"], d["totals"]["failed"]), (5, 5, 1))
        self.assertEqual(d["runs"][1]["file"]["labels"], 5)
        self.assertEqual(d["today"]["runs"], 2)
        self.assertEqual(d["businesses"][0]["business_name"], "Rudam")

    def test_nothing_is_marked_rtd_when_the_labels_dont_come(self):
        self.hub.print_status = 500
        out = flipkart_auto.run("labels")["Rudam"]
        self.assertIn("didn't make the labels", out["error"])
        self.assertIn("All batches failed during document generation", out["error"])
        # The batch tried PRINT_TRIES times, then each of its two groups alone SINGLE_TRIES times.
        self.assertEqual(self.ops().count("Print"), flipkart_auto.PRINT_TRIES + 2 * flipkart_auto.SINGLE_TRIES)
        self.assertNotIn("MarkRTD", self.ops())
        self.assertFalse(MeeshoLabelFile.objects.filter(platform="flipkart").exists())
        self.assertIn("couldn't finish", self.sent[-1][0][1])               # said on Telegram

    def test_telegram_gets_the_pdf_then_its_pick_list_as_meeshos(self):
        from . import meesho_sync
        with mock.patch.object(meesho_sync, "pick_list_text", return_value="📋 On these labels — 5 orders"):
            out = flipkart_auto.run("labels")["Rudam"]
        self.assertEqual([a[0] for a, _k in self.sent], [self.sent[0][0][0], self.sent[0][0][0] + " — items"])
        self.assertEqual(self.sent[1][0][1], "📋 On these labels — 5 orders")
        self.assertIn("pick_list_sent", out)

    def test_rtd_and_sending_can_be_turned_off(self):
        s = FlipkartAutoSetting.get()
        s.mark_rtd, s.send_labels = False, False
        s.save()
        out = flipkart_auto.run("labels")["Rudam"]
        self.assertEqual((out["printed"], out["rtd"]), (5, 0))
        self.assertNotIn("MarkRTD", self.ops())
        self.assertEqual(self.sent, [])

    def test_accepting_alone(self):
        out = flipkart_auto.run("accept")["Rudam"]
        self.assertEqual((out["accepted"], out["skipped"]), (5, 1))
        self.assertEqual(self.ops(), ["AcceptOrders"])

    def test_what_is_due_and_claimed_once(self):
        s = FlipkartAutoSetting.get()
        self.assertEqual(flipkart_auto.due(s), (None, None))                 # off
        s.enabled, s.accept_every = True, 30
        now = timezone.localtime().replace(hour=17, minute=5, second=0, microsecond=0)
        s.label_times = ["17:00"]
        s.save()
        self.assertEqual(flipkart_auto.due(s, now)[0], "labels")
        s.last_labels_at = s.last_accept_at = now
        self.assertEqual(flipkart_auto.due(s, now + timedelta(minutes=10)), (None, None))
        self.assertEqual(flipkart_auto.due(s, now + timedelta(minutes=31))[0], "accept")
        self.assertEqual(flipkart_auto.due(s, now.replace(hour=20))[0], "accept")   # 17:00 missed by 3 h: not caught up
        s.last_labels_at = s.last_accept_at = None
        s.save()
        with mock.patch.object(flipkart_auto, "run", return_value={"Rudam": {"printed": 5}}) as ran:
            first = flipkart_auto.run_due(now)
            again = flipkart_auto.run_due(now)
        self.assertEqual((first["due"], ran.call_count), ("labels", 1))
        self.assertEqual(again["due"], None)                                 # the slot was taken; nothing else due yet
        s.refresh_from_db()
        self.assertEqual(s.last_result["kind"], "labels")

    def test_two_runs_never_overlap(self):
        FlipkartAutoSetting.objects.filter(pk=FlipkartAutoSetting.get().pk).update(busy_until=timezone.now() + timedelta(minutes=5))
        self.assertIn("still going", flipkart_auto.run("labels")["*"]["error"])
        self.assertEqual(self.ops(), [])

    def test_settings_by_an_admin_and_the_kept_file_is_listed_to_reprint(self):
        r = self.c.patch(f"{self.base}auto/?business={self.biz.id}",
                         {"enabled": True, "accept_every": 30, "label_times": ["9:30", "17:00"], "mark_rtd": True}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual((r.data["enabled"], r.data["label_times"]), (True, ["09:30", "17:00"]))
        self.assertEqual(self.c.patch(f"{self.base}auto/?business={self.biz.id}", {"accept_every": 5}, format="json").status_code, 400)
        flipkart_auto.run("labels")
        files = self.c.get(f"/api/business/{self.biz.id}/meesho-orders/label-files/", {"platform": "flipkart"}).data["files"]
        self.assertEqual([(f["platform"], f["labels"]) for f in files], [("flipkart", 5)])
        pdf = self.c.get(f"/api/business/{self.biz.id}/meesho-orders/label-files/{files[0]['id']}/pdf/")
        self.assertEqual(pdf.status_code, 200)
        self.assertIn("flipkart-labels-", pdf["Content-Disposition"])
        self.assertEqual(len(self.c.get(f"{self.base}auto/?business={self.biz.id}").data["files"]), 1)


# The parent's own tests would run again under this class: only this file's run here.
for _name in [n for n in vars(base.FlipkartActionTests) if n.startswith("test_")]:
    if _name not in vars(FlipkartAutoTests):
        setattr(FlipkartAutoTests, _name, None)
