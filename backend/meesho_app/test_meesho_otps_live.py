"""Delivery OTPs, asked of Meesho live: one call a business, saved, reused for 15 s, and a failure keeps the last OTPs."""

import json
from datetime import timedelta
from unittest import mock

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from . import meesho_linking, meesho_sync
from .models import MeeshoAccount, MeeshoSyncSnapshot
from .sync_middleware.returns import OTP_SNAPSHOT


def answer(otp, courier="Delhivery"):
    return {"supplier_delivery_otp": [{"carrier_details": {"name": courier}, "count": 2, "awbs": ["AWB1", "AWB2"],
                                       "otp_details": [{"otp": otp, "active": True, "display_text": "Return OTP",
                                                        "expiry_timestamp": 1900000000000}]}]}


class Res:
    def __init__(self, code, body):
        self.status_code, self._body = code, body
        self.text = json.dumps(body) if isinstance(body, dict) else str(body)

    def json(self):
        if isinstance(self._body, dict):
            return self._body
        raise ValueError


class OtpsLiveTests(TestCase):
    def setUp(self):
        from django.core.cache import cache
        cache.clear()
        self.user = User.objects.create_user(username="o", password="pw", role=User.ROLE_SUPER_ADMIN)
        self.a = Business.objects.create(name="Alpha")
        self.b = Business.objects.create(name="Beta")
        for biz in (self.a, self.b):
            Membership.objects.create(user=self.user, business=biz)
        self.acct_a = MeeshoAccount.objects.create(business=self.a, phone_number="9000000001", password_enc="v1:x", status="ACTIVE",
                                                   supplier_id="11", supplier_identifier="ida",
                                                   cookies_enc=meesho_sync.encrypt(json.dumps({"connect.sid": "a"})))
        self.acct_b = MeeshoAccount.objects.create(business=self.b, phone_number="9000000002", password_enc="v1:x", status="ACTIVE",
                                                   supplier_id="22", supplier_identifier="idb",
                                                   cookies_enc=meesho_sync.encrypt(json.dumps({"connect.sid": "b"})))
        self.c = APIClient()
        self.c.force_authenticate(self.user)
        self.url = f"/api/business/{self.a.id}/meesho-orders/otps/live/"
        self.calls = []

    def meesho(self, by_identifier):
        def post(url, json=None, headers=None, timeout=None):
            self.calls.append(headers["identifier"])
            code, body = by_identifier[headers["identifier"]]
            return Res(code, body)
        return mock.patch.object(meesho_linking._HTTP, "post", side_effect=post)

    def get(self):
        r = self.c.get(self.url)
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        return r.json()

    def test_asks_meesho_for_every_business_and_saves_the_answer(self):
        with self.meesho({"ida": (200, answer("1234")), "idb": (200, answer("5678", "Valmo"))}):
            d = self.get()
        by_biz = {o["business_name"]: o for o in d["otps"]}
        self.assertEqual(by_biz["Alpha"]["otp"], "1234")
        self.assertEqual(sorted(self.calls), ["ida", "idb"])
        self.assertTrue(all(b["live"] for b in d["businesses"]))
        snap = MeeshoSyncSnapshot.objects.get(account=self.acct_a, endpoint=OTP_SNAPSHOT)
        self.assertEqual(snap.payload["supplier_delivery_otp"][0]["otp_details"][0]["otp"], "1234")

    def test_an_answer_under_15_seconds_old_is_served_again(self):
        MeeshoSyncSnapshot.objects.create(account=self.acct_a, endpoint=OTP_SNAPSHOT, payload=answer("1111"), fetched_at=timezone.now())
        MeeshoSyncSnapshot.objects.create(account=self.acct_b, endpoint=OTP_SNAPSHOT, payload=answer("2222"),
                                          fetched_at=timezone.now() - timedelta(minutes=5))
        with self.meesho({"idb": (200, answer("3333"))}):
            d = self.get()
        self.assertEqual(self.calls, ["idb"])                                  # Alpha's was fresh
        self.assertEqual({o["business_name"]: o["otp"] for o in d["otps"]}, {"Alpha": "1111", "Beta": "3333"})

    def test_an_expired_session_keeps_the_last_otps_and_says_why(self):
        MeeshoSyncSnapshot.objects.create(account=self.acct_b, endpoint=OTP_SNAPSHOT, payload=answer("2222"),
                                          fetched_at=timezone.now() - timedelta(minutes=5))
        with self.meesho({"ida": (200, answer("1234")), "idb": (403, {"message": "no"})}):
            d = self.get()
        beta = next(b for b in d["businesses"] if b["business_name"] == "Beta")
        self.assertFalse(beta["live"])
        self.assertIn("expired", beta["problem"])
        self.assertEqual(next(o for o in d["otps"] if o["business_name"] == "Beta")["otp"], "2222")
        self.assertEqual(MeeshoSyncSnapshot.objects.get(account=self.acct_b).payload, answer("2222"))   # not overwritten
        # Refused: not asked again for a while — the page's polling never piles onto a block.
        self.calls.clear()
        MeeshoSyncSnapshot.objects.filter(account=self.acct_a).update(fetched_at=timezone.now() - timedelta(minutes=1))
        with self.meesho({"ida": (200, answer("9999"))}):
            d = self.get()
        self.assertEqual(self.calls, ["ida"])
        self.assertIn("expired", next(b for b in d["businesses"] if b["business_name"] == "Beta")["problem"])
