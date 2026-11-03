"""Return claims raised on Meesho from the portal: found by AWB, raised on the return's own business."""

import json
import os
from unittest import mock

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from . import meesho_return_claim as rc
from . import meesho_sync
from .models import MeeshoAccount, MeeshoReturnClaim, ReturnDelivery

KEY = __import__("base64").b64encode(b"k" * 32).decode()
GCS = "https://gcs-supl-xp-agent-support-aggregator-prd.storage.googleapis.com/TicketInputAttachments/3564327/1/x.png"


class Res:
    def __init__(self, status, body):
        self.status_code, self._body, self.text = status, body, json.dumps(body)

    def json(self):
        return self._body


SCHEMA = {"data": {"fields": [
    {"key": "issue", "type": "drop_down", "label": "Issue", "options": [{"value": "2", "label": "Items missing"}]},
    {"key": "description_text_2", "type": "text", "label": "<div>Enter NA if there's no Packet ID</div>"},
    {"key": "sub_order_number", "type": "action_single_text_box", "label": "Sub Order Number", "is_mandatory": True},
    {"key": "packet_state", "type": "drop_down", "label": "State of the packet", "is_mandatory": True,
     "options": [{"value": "intact", "label": "Intact"}, {"value": "tampered", "label": "Tampered"}]},
    {"key": "product_openingvideo_link", "type": "video_file", "label": "Unpacking Video", "is_mandatory": True},
    {"key": "ticket_desc", "type": "text_area", "label": "Description", "is_mandatory": True},
    {"key": "attachments", "type": "img_file", "label": "Attachments", "is_mandatory": False},
]}}


class ReturnClaimTests(TestCase):
    def setUp(self):
        key = mock.patch.dict(os.environ, {"MEESHO_SYNC_KEY": KEY})
        key.start()
        self.addCleanup(key.stop)
        cache.clear()
        self.rudam = Business.objects.create(name="Rudam")
        self.cosmify = Business.objects.create(name="Cosmify")
        self.user = User.objects.create_user(username="desk", password="pw", role=User.ROLE_BUSINESS_USER)
        for b in (self.rudam, self.cosmify):
            Membership.objects.create(user=self.user, business=b)
        cookies = meesho_sync.encrypt(json.dumps({"connect.sid": "s"}))
        MeeshoAccount.objects.create(business=self.rudam, phone_number="9000000001", password_enc="x", status="ACTIVE",
                                     supplier_id="3564327", supplier_identifier="lffy4", cookies_enc=cookies)
        MeeshoAccount.objects.create(business=self.cosmify, phone_number="9000000002", password_enc="x", status="ACTIVE",
                                     supplier_id="111", supplier_identifier="cosm1", cookies_enc=cookies)
        self.ret = ReturnDelivery.objects.create(business=self.cosmify, suborder_no="341668276271146947_1", awb_number="R2718300838FPL",
                                                 courier_partner="Delhivery", sku="DIYA-1", type_of_return="Customer Return")
        self.c = APIClient()
        self.c.force_authenticate(self.user)
        self.api = f"/api/business/{self.rudam.id}/return-claim/"
        import tempfile
        root = mock.patch.object(rc, "UPLOAD_ROOT", tempfile.mkdtemp())
        root.start()
        self.addCleanup(root.stop)
        q = mock.patch("meesho_app.meesho_sync.enqueue")
        self.enqueue = q.start()
        self.addCleanup(q.stop)

    def raise_claim(self, values, files=None, **extra):
        """Queue a claim from the page, then let the worker raise it."""
        r = self.c.post(self.api, {"business_id": self.cosmify.id, "return_id": self.ret.id, "sub_category_id": "2",
                                   "sub_category": "Items missing", "values": values, "files": files or {}, "email": "a@b.co",
                                   **extra}, format="json")
        if r.status_code != 202:
            return r, None
        return r, rc.process_claim(r.data["claim"]["id"])

    def test_the_schema_is_read_leniently(self):
        f = rc.parse_fields(SCHEMA)
        self.assertEqual([x["key"] for x in f], ["description_text_2", "sub_order_number", "packet_state", "product_openingvideo_link",
                                                 "ticket_desc", "attachments"])           # no "issue": that's the type picker
        self.assertEqual((f[0]["info"], f[0]["required"]), (True, False))                   # a note, shown but never sent
        self.assertEqual(f[2]["options"][1], {"value": "tampered", "label": "Tampered"})
        self.assertEqual((f[1]["required"], f[5]["required"]), (True, False))

    def test_each_claim_type_once_under_the_id_meesho_raises_it(self):
        answer = {"data": [{"sub_category_id": 142, "sub_category_title": "Item/s are missing in my return"},
                           {"sub_category_id": 5, "sub_category_title": "Not received"},
                           {"sub_category_id": 2, "sub_category_title": "Item/s are missing in my return"}]}
        with mock.patch.object(rc.requests, "post", return_value=Res(200, answer)):
            subs = rc.sub_categories(MeeshoAccount.objects.get(business=self.cosmify))
        self.assertEqual(subs, [{"id": "2", "label": "Item/s are missing in my return"}, {"id": "5", "label": "Not received"}])

    def test_the_awb_finds_the_return_and_its_business(self):
        r = self.c.get(f"{self.api}lookup/", {"code": ["NOT-A-CODE", "r2718300838fpl"]})
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual((r.data["matched_code"], r.data["return"]["business_name"], r.data["return"]["sub_order_no"]),
                         ("R2718300838FPL", "Cosmify", "341668276271146947_1"))
        self.assertTrue(r.data["return"]["connected"])
        self.assertEqual(self.c.get(f"{self.api}lookup/", {"code": "NOPE"}).status_code, 404)

    def test_a_return_is_found_as_returns_and_claims_finds_it(self):
        from .models import OrderScanSetting
        # Stored with stray characters, delivered long ago — Returns & Claims' search still finds it, so must this.
        ReturnDelivery.objects.create(business=self.rudam, suborder_no="999_1", awb_number=" VLR083065118686 ",
                                      delivered_date="2025-01-05", sku="LOTA")
        # An admin whose Order Scan desk is narrowed to Cosmify — claims still cover the business on screen.
        self.user.role = User.ROLE_SUPER_ADMIN if hasattr(User, "ROLE_SUPER_ADMIN") else self.user.role
        self.user.save()
        OrderScanSetting.objects.update_or_create(user=self.user, defaults={"business_ids": [self.cosmify.id]})
        r = self.c.get(f"{self.api}lookup/", {"code": "VLR083065118686"})
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual((r.data["return"]["business_name"], r.data["return"]["sub_order_no"]), ("Rudam", "999_1"))

    def test_a_business_that_isnt_yours_is_never_used(self):
        other = Business.objects.create(name="Not mine")
        r = self.c.get(f"{self.api}options/", {"business_id": other.id})
        self.assertEqual(r.status_code, 403)

    def test_the_claim_goes_to_the_returns_own_business_as_the_panel_sends_it(self):
        sent = []

        def post(url, headers=None, json=None, timeout=None, **kw):
            sent.append((url, headers, json))
            if url.endswith("subcategorySchema"):
                return Res(200, SCHEMA)
            return Res(200, {"data": {"ticket_id": "TKT-77"}})
        values = {"sub_order_number": "341668276271146947_1", "packet_state": "tampered",
                  "product_openingvideo_link": [GCS], "ticket_desc": "items missing from this return"}
        with mock.patch.object(rc.requests, "post", side_effect=post):
            r, done = self.raise_claim(values)
        self.assertEqual((r.status_code, r.data["claim"]["status"]), (202, "QUEUED"), r.data)   # back at once: the worker raises it
        self.assertEqual(self.enqueue.call_args.args, ("MeeshoClaimJob", [r.data["claim"]["id"], 1]))
        self.assertEqual(done, {"next": "done"})
        url, headers, body = sent[-1]
        self.assertTrue(url.endswith("/api/experience/support/createTicket"))
        self.assertEqual(headers["identifier"], "cosm1")                                   # Cosmify's account, not Rudam's
        self.assertEqual((body["supplier_id"], body["supplier_identifier"], body["category_id"], body["sub_category_id"]),
                         ("111", "cosm1", "1", "2"))
        self.assertEqual(body["faq_classification_info"],
                         {"faq_classification_id": "", "supplier_selected_sub_category_id": 2, "supplier_selected_category_id": 1, "misc": {}})
        by_key = {d["key"]: d for d in body["ticket_details"]}
        self.assertEqual(by_key["packet_state"], {"key": "packet_state", "type": "drop_down", "label": "State of the packet",
                                                  "value": "tampered", "selectedLabel": "Tampered"})
        self.assertEqual(by_key["product_openingvideo_link"]["value"], [GCS])
        self.assertEqual(by_key["attachments"]["value"], [])                                  # every field the form has
        self.assertNotIn("issue", by_key)                                                     # the type picker isn't a field
        self.assertNotIn("description_text_2", by_key)                                        # nor is a note
        claim = MeeshoReturnClaim.objects.get()
        self.assertEqual((claim.status, claim.ticket, claim.values["packet_state"], claim.email), ("OK", "TKT-77", "tampered", "a@b.co"))
        self.assertEqual(claim.return_snapshot["awb_number"], "R2718300838FPL")                  # kept for analytics
        self.assertEqual([e["step"] for e in claim.events], ["queued", "raised"])
        self.ret.refresh_from_db()
        self.assertEqual((self.ret.claim_status, self.ret.claim_reference), ("RAISED", "TKT-77"))

    def test_a_missing_field_sends_nothing(self):
        with mock.patch.object(rc.requests, "post", return_value=Res(200, SCHEMA)) as post:
            r = self.c.post(self.api, {"business_id": self.cosmify.id, "sub_category_id": "2", "values": {"ticket_desc": "x"},
                                       "email": "a@b.co"}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("Unpacking Video", r.data["error"])
        self.assertEqual(post.call_count, 1)                                                  # only the schema was read
        self.assertFalse(MeeshoReturnClaim.objects.exists())

    def test_a_refusal_is_kept_and_the_return_is_left_alone(self):
        def post(url, **kw):
            return Res(200, SCHEMA) if url.endswith("subcategorySchema") else Res(400, {"message": "Sub order not eligible"})
        values = {"sub_order_number": "341668276271146947_1", "packet_state": "intact", "product_openingvideo_link": [GCS], "ticket_desc": "x"}
        with mock.patch.object(rc.requests, "post", side_effect=post), mock.patch("meesho_app.notify.channels", return_value=["telegram"]), \
                mock.patch("meesho_app.notify.send") as told:
            r, done = self.raise_claim(values)
        self.assertEqual(done, {"next": "failed"})                                             # Meesho said no: not tried again
        claim = MeeshoReturnClaim.objects.get()
        self.assertIn("Sub order not eligible", claim.message)
        self.assertEqual(claim.status, "FAILED")
        self.assertIn("341668276271146947_1", told.call_args.args[1])                         # and you're told
        self.ret.refresh_from_db()
        self.assertEqual(self.ret.claim_status, "UNREVIEWED")

    def test_uploads_go_to_meesho_and_too_big_ones_are_refused(self):
        with mock.patch.object(rc.requests, "post", return_value=Res(200, {"data": {"url": GCS}})) as post:
            r = self.c.post(f"{self.api}upload/", {"business_id": self.cosmify.id,
                                                   "file": SimpleUploadedFile("w.png", b"png", content_type="image/png")}, format="multipart")
        self.assertEqual((r.status_code, r.data["url"]), (200, GCS))
        self.assertEqual(post.call_args.kwargs["data"], {"is_validation_required": "false", "entity_id": "111", "entity_type": "SUPPLIER"})
        with mock.patch.object(rc, "MAX_UPLOAD", 2):
            r = self.c.post(f"{self.api}upload/", {"business_id": self.cosmify.id,
                                                   "file": SimpleUploadedFile("v.mp4", b"12345", content_type="video/mp4")}, format="multipart")
        self.assertEqual(r.status_code, 400)

    def test_a_field_is_checked_with_meesho(self):
        def post(url, json=None, **kw):
            if url.endswith("subcategorySchema"):
                return Res(200, SCHEMA)
            self.assertEqual(json["ticket_details"], [{"key": "sub_order_number", "type": "action_single_text_box",
                                                       "label": "Sub Order Number", "value": "341668276271146947_1"}])
            return Res(200, {"is_valid": False, "message": "Sub order is not eligible for this issue"})
        with mock.patch.object(rc.requests, "post", side_effect=post):
            r = self.c.post(f"{self.api}validate/", {"business_id": self.cosmify.id, "sub_category_id": "2",
                                                     "values": {"sub_order_number": "341668276271146947_1"}, "keys": ["sub_order_number"]},
                            format="json")
        self.assertEqual((r.data["ok"], r.data["message"]), (False, "Sub order is not eligible for this issue"))

    def test_meesho_says_why_a_field_is_refused(self):
        answer = {"is_valid": False, "errors": [{"error_message": "Ticket {{ticket_id}} has already been raised for this issue.",
                                                 "ticket_id": {"link": "SUPPORT/TICKET_DETAILS", "label": 793641126954}, "field_name": "awb_number"}]}
        self.assertEqual(rc._errors(answer), ("Ticket 793641126954 has already been raised for this issue.", "793641126954"))

    def test_a_video_goes_up_in_pieces_and_on_to_meesho_in_the_background(self):
        data = b"v" * 2500
        r = self.c.post(f"{self.api}upload/start/", {"business_id": self.cosmify.id, "name": "unbox.mp4", "size": len(data),
                                                     "content_type": "video/mp4"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        uid = r.data["upload_id"]
        for i in range(3):
            piece = SimpleUploadedFile("blob", data[i * 1000:(i + 1) * 1000], content_type="application/octet-stream")
            self.assertEqual(self.c.post(f"{self.api}upload/{uid}/chunk/", {"index": i, "file": piece}, format="multipart").status_code, 200)
        sent = {}

        def fake_upload(account, name, blob, content_type):
            sent.update(account=account.business.name, name=name, blob=blob, type=content_type)
            return GCS
        with mock.patch.object(rc, "_in_background", side_effect=lambda fn, *a: fn(*a)), mock.patch.object(rc, "upload", side_effect=fake_upload):
            r = self.c.post(f"{self.api}upload/{uid}/finish/", {"parts": 3}, format="json")
        self.assertEqual(r.status_code, 202)
        self.assertEqual((sent["account"], sent["name"], sent["blob"], sent["type"]), ("Cosmify", "unbox.mp4", data, "video/mp4"))
        st = self.c.get(f"{self.api}upload/{uid}/").data
        self.assertEqual((st["state"], st["url"]), ("done", GCS))

    def test_a_missing_piece_or_someone_elses_upload_is_refused(self):
        r = self.c.post(f"{self.api}upload/start/", {"business_id": self.cosmify.id, "name": "v.mp4", "size": 10}, format="json")
        uid = r.data["upload_id"]
        self.assertEqual(self.c.post(f"{self.api}upload/{uid}/finish/", {"parts": 1}, format="json").status_code, 400)
        stranger = User.objects.create_user(username="x", password="pw", role=User.ROLE_BUSINESS_USER)
        Membership.objects.create(user=stranger, business=self.rudam)
        other = APIClient()
        other.force_authenticate(stranger)
        self.assertEqual(other.get(f"{self.api}upload/{uid}/").status_code, 404)
        self.assertEqual(self.c.get(f"{self.api}upload/../../etc/").status_code, 404)
        too_big = self.c.post(f"{self.api}upload/start/", {"business_id": self.cosmify.id, "name": "v.mp4", "size": 30 * 1048576}, format="json")
        self.assertEqual(too_big.status_code, 400)

    def test_a_return_already_claimed_is_a_duplicate(self):
        values = {"sub_order_number": "341668276271146947_1", "packet_state": "intact", "product_openingvideo_link": [GCS], "ticket_desc": "x"}
        with mock.patch.object(rc.requests, "post", side_effect=lambda url, **kw: Res(200, SCHEMA) if url.endswith("subcategorySchema")
                               else Res(200, {"data": {"ticket_id": "TKT-1"}})):
            self.raise_claim(values)
            r, _ = self.raise_claim(values)
        self.assertEqual((r.status_code, r.data["code"]), (409, "duplicate"))
        self.assertIn("TKT-1", r.data["error"])
        found = self.c.get(f"{self.api}lookup/", {"code": "R2718300838FPL"}).data["return"]
        self.assertIn("TKT-1", found["duplicate"]["why"])
        # A claim raised on the panel and recorded on Returns & Claims counts too.
        ReturnDelivery.objects.create(business=self.cosmify, suborder_no="9_1", awb_number="AWB9", claim_status="RAISED",
                                      claim_reference="T-99")
        self.assertIn("T-99", self.c.get(f"{self.api}lookup/", {"code": "AWB9"}).data["return"]["duplicate"]["why"])

    def upload_file(self, name, data, ctype, finish=True):
        r = self.c.post(f"{self.api}upload/start/", {"business_id": self.cosmify.id, "name": name, "size": len(data),
                                                     "content_type": ctype}, format="json")
        uid = r.data["upload_id"]
        self.c.post(f"{self.api}upload/{uid}/chunk/", {"index": 0, "file": SimpleUploadedFile("b", data)}, format="multipart")
        if finish:
            self.assertEqual(self.c.post(f"{self.api}upload/{uid}/finish/", {"parts": 1, "send": False}, format="json").data["state"], "complete")
        return uid

    def test_files_go_up_compressed_with_the_pod_attached_in_the_background(self):
        self.ret.proof_of_delivery = "https://pod.example.com/x.pdf"
        self.ret.save()
        video = self.upload_file("unbox.mp4", b"v" * 3000, "video/mp4")
        photo = self.upload_file("waybill.jpg", b"\xff\xd8\xff photo", "image/jpeg")
        sent, ticket = [], {}

        def fake_upload(account, name, data, ctype):
            sent.append((name, len(data), ctype))
            return f"https://storage.googleapis.com/x/{name}"

        def post(url, json=None, **kw):
            if url.endswith("subcategorySchema"):
                return Res(200, SCHEMA)
            ticket.update(json)
            return Res(200, {"data": {"ticket_id": "TKT-5"}})
        pod = mock.Mock(status_code=200, headers={"content-type": "application/pdf"})
        pod.raw.read.return_value = b"%PDF-1.4 pod"
        values = {"sub_order_number": "341668276271146947_1", "packet_state": "intact", "ticket_desc": "2 items missing"}
        with mock.patch.object(rc, "upload", side_effect=fake_upload), mock.patch.object(rc.requests, "post", side_effect=post), \
                mock.patch.object(rc.requests, "get", return_value=pod), mock.patch.object(rc, "MEESHO_VIDEO_MAX", 1000), \
                mock.patch.object(rc, "compress_video", return_value=(b"small", "unbox.mp4")) as squeeze:
            r, done = self.raise_claim(values, files={"product_openingvideo_link": [video], "product_reverse_way_bill_link": [photo]})
        self.assertEqual(done, {"next": "done"}, MeeshoReturnClaim.objects.get().message)
        squeeze.assert_called_once()                                                          # over the cap: compressed
        self.assertEqual(sent, [("unbox.mp4", 5, "video/mp4"), ("waybill.jpg", 9, "image/jpeg"), ("proof-of-delivery.pdf", 12, "application/pdf")])
        by_key = {d["key"]: d["value"] for d in ticket["ticket_details"]}
        self.assertEqual(by_key["attachments"], ["https://storage.googleapis.com/x/proof-of-delivery.pdf"])   # the POD, by itself
        self.assertEqual(by_key["product_openingvideo_link"], ["https://storage.googleapis.com/x/unbox.mp4"])
        claim = MeeshoReturnClaim.objects.get()
        self.assertEqual((claim.files["product_openingvideo_link"][0]["size"], claim.files["product_openingvideo_link"][0]["sent_size"]), (3000, 5))
        self.assertTrue(claim.pod_meesho_url.endswith("proof-of-delivery.pdf"))

    def test_it_waits_for_files_still_on_their_way_and_retries_when_meesho_is_busy(self):
        video = self.upload_file("unbox.mp4", b"v" * 100, "video/mp4", finish=False)
        values = {"sub_order_number": "341668276271146947_1", "packet_state": "intact", "ticket_desc": "x"}
        with mock.patch.object(rc.requests, "post", return_value=Res(200, SCHEMA)):
            r, done = self.raise_claim(values, files={"product_openingvideo_link": [video]})
        self.assertEqual(done, {"next": "wait", "in": rc.FILES_WAIT})
        self.c.post(f"{self.api}upload/{video}/finish/", {"parts": 1, "send": False}, format="json")
        claim_id = r.data["claim"]["id"]
        with mock.patch.object(rc, "upload", side_effect=rc.TicketRefused("busy", "meesho_refused", meesho_http=503)), \
                mock.patch.object(rc.requests, "post", return_value=Res(200, SCHEMA)):
            self.assertEqual(rc.process_claim(claim_id, 1)["next"], "retry")
        self.assertEqual(MeeshoReturnClaim.objects.get().status, "RETRYING")
