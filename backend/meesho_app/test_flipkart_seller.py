"""Flipkart Seller Hub connection: password → OTP → session held encrypted, graphql reads, expiry. Flipkart is faked."""

import json
import os
from unittest import mock

import requests
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.access import set_user_rule
from accounts.models import Business, Membership, User

from . import flipkart_seller, meesho_sync
from .models import FlipkartSellerAccount as A

KEY = __import__("base64").b64encode(b"k" * 32).decode()


def _resp(code=200, body=None, headers=None):
    r = requests.Response()
    r.status_code = code
    r._content = json.dumps(body if body is not None else {}).encode()
    r.headers.update(headers or {})
    return r


class FakeFlipkart(requests.Session):
    """Answers like Seller Hub: /login → OTP asked; /verifyOtp → session cookies; graphql → data."""
    calls = []
    script = {}

    def request(self, method, url, **kw):
        path = url.split("seller.flipkart.com", 1)[-1].split("?")[0]
        FakeFlipkart.calls.append({"method": method, "path": path, "json": kw.get("json"), "headers": kw.get("headers") or {},
                                   "cookies": {c.name: c.value for c in self.cookies}})
        answer = FakeFlipkart.script.get(path)
        if callable(answer):
            return answer(self, kw)
        if path == "/login":
            self.cookies.set("connect.sid", "pre-otp", domain="seller.flipkart.com")
            return _resp(200, {"otpRequired": True})
        if path == "/verifyOtp":
            if (kw.get("json") or {}).get("otp") != "193575":
                return _resp(400, {"message": "Invalid OTP"})
            for k, v in (("connect.sid", "SESS-7f3q"), ("sellerId", "41ad149fa06e4194"), ("is_login", "true"),
                         (flipkart_seller.CSRF_COOKIE, "csrf-1")):
                self.cookies.set(k, v, domain="seller.flipkart.com")
            return _resp(200, {"status": "OK"})
        if path == "/orchestrator/graphql":
            return FakeFlipkart.orders(kw)
        if path == "/napi/graphql":
            op = (kw.get("json") or {}).get("operationName")
            data = {
                "GetBusinessSummarySalesUnits": {"getBusinessSummarySalesUnitsData": {"result": json.dumps(
                    {"today": {"gross_units": 12, "gross_gmv": 4100.5}, "yesterday": {"gross_units": 30, "gross_gmv": 9800}})}},
                "GetBusinessSummaryImpressions": {"getBusinessSummaryImpressionsData": {"result": {
                    "impressions_latest": {"numeric": 5000, "date": "2026-11-11"}, "impressions_prev": {"numeric": 4200, "date": "2026-11-10"}}}},
                "Selection_getStockWidget": {"getStockWidget": {"aggregations": [
                    {"aggregation_name": "model-based", "value": 0, "buckets": [{"key": "bring_listing_instock", "aggregation_count": 7}]},
                    {"aggregation_name": "potential_loss", "value": 130, "buckets": []}]}},
            }[op]
            return _resp(200, {"data": data})
        return _resp(200, {})


def _shipment(n, tab, sku="5-inch-golden-plate", qty=1):
    return {"shippingId": f"SH{n}", "orderId": f"OD{n}", "sellerPrice": 85.0, "creationTime": "2026-11-10T07:24:11",
            "dispatchAfterDate": "2026-11-12T16:00:00", "dispatchByDate": "2026-11-13T12:00:00", "dispatchServiceTier": "EXPRESS",
            "shipmentContents": {"shipmentGroupSpecs": [{"listing": {"product": {"sku": sku, "title": "Golden plate", "fsn": "FSN1",
                                                                              "primaryImageUrl": "https://img/x.jpg"}}, "quantity": qty}]},
            "statusHistory": {"acceptedTime": "2026-11-12T17:23:08" if tab != "pendingToAccept" else None},
            "tracking": {"trackingId": f"FMPC{n}", "courierName": "Ekart Logistics"},
            "shipmentOrderItems": [{"orderItemId": f"OI{n}"}]}


def _orders(kw):
    """Seller Hub's orders page: counts, and each tab's shipments 3 to a page in pages of ORDER_PAGE."""
    body = kw["json"]
    if body["operationName"] == "GetStateCount":
        return _resp(200, {"data": {"shipmentStatesCountAndBreakdown": {"shipmentStatesCountMetrics": {"shipmentStatesCount": {
            "pendingToAccept": 0, "upcoming": 2, "pendingToPack": 0, "pendingToDispatch": 3, "inTransit": 1, "completed": 271,
            "pendingService": 0}, "timestamp": "t"}}}, "graphErrors": [], "dataErrors": {}})
    inp = body["variables"]["input"]
    have = {"pendingToAccept": [_shipment(10 + i, "pendingToAccept") for i in range(2)],
            "pendingToDispatch": [_shipment(20 + i, "pendingToDispatch", qty=i + 1) for i in range(3)],
            "inTransit": [_shipment(30, "inTransit")]}.get(inp["status"], [])
    page, size = inp["paginationInput"]["pageNum"], inp["paginationInput"]["pageSize"]
    chunk = have[(page - 1) * size: page * size]
    return _resp(200, {"data": {"filteredShipmentGroups": {"shipmentGroups": [{"shipments": chunk}],
                                                           "pageInfo": {"hasMore": page * size < len(have), "total": len(have)}}},
                       "graphErrors": [], "dataErrors": {}})


FakeFlipkart.orders = staticmethod(_orders)


@mock.patch.dict(os.environ, {"MEESHO_SYNC_KEY": KEY})
class FlipkartSellerTests(TestCase):
    def setUp(self):
        FakeFlipkart.calls, FakeFlipkart.script = [], {}
        p = mock.patch.object(flipkart_seller, "_http", side_effect=lambda: FakeFlipkart())
        p.start()
        self.addCleanup(p.stop)
        self.admin = User.objects.create_user(username="a", password="pw", role=User.ROLE_SUPER_ADMIN)
        self.biz = Business.objects.create(name="Rudam")
        Membership.objects.create(user=self.admin, business=self.biz)
        self.c = APIClient()
        self.c.force_authenticate(self.admin)
        self.base = f"/api/business/{self.biz.id}/flipkart-seller/"

    def connect(self, **kw):
        return self.c.post(f"{self.base}connect/", {"username": "8273343222", "password": "secret-pw", **kw}, format="json")

    def connected(self):
        self.connect(location_id="LOC3695231456da41de87ae9704b810e002")
        return self.c.post(f"{self.base}otp/", {"otp": "193575"}, format="json")

    # ── Connecting ───────────────────────────────────────────────────────
    def test_password_then_otp_connects_and_keeps_the_session_encrypted(self):
        r = self.connect()
        self.assertEqual((r.status_code, r.data["status"]), (200, "OTP_SENT"), r.data)
        login = next(c for c in FakeFlipkart.calls if c["path"] == "/login")
        self.assertEqual(login["json"], {"authName": "flipkart", "username": "8273343222", "password": "secret-pw",
                                         "userNameType": "mobileNumber"})
        self.assertEqual(FakeFlipkart.calls[0]["path"], "/getStateDetails")
        r = self.c.post(f"{self.base}otp/", {"otp": " 193 575 "}, format="json")
        self.assertEqual((r.status_code, r.data["connected"], r.data["seller_id"]), (200, True, "41ad149fa06e4194"), r.data)
        # The OTP went with the half-made session from the password step.
        verify = next(c for c in FakeFlipkart.calls if c["path"] == "/verifyOtp")
        self.assertEqual(verify["cookies"]["connect.sid"], "pre-otp")
        a = A.objects.get()
        self.assertNotIn("secret-pw", a.password_enc)
        self.assertEqual(meesho_sync.decrypt(a.password_enc), "secret-pw")
        self.assertNotIn("SESS-7f3q", a.cookies_enc)
        self.assertEqual(json.loads(meesho_sync.decrypt(a.cookies_enc))["connect.sid"], "SESS-7f3q")
        # Nothing secret comes back to the browser.
        body = json.dumps(self.c.get(self.base).data, default=str)
        self.assertNotIn("secret-pw", body)
        self.assertNotIn("SESS-7f3q", body)

    def test_a_wrong_otp_says_so_and_keeps_waiting_for_the_right_one(self):
        self.connect()
        r = self.c.post(f"{self.base}otp/", {"otp": "000000"}, format="json")
        self.assertEqual((r.status_code, r.data["status"]), (409, "OTP_SENT"))
        self.assertIn("Invalid OTP", r.data["error"])
        self.assertEqual(self.c.post(f"{self.base}otp/", {"otp": "193575"}, format="json").data["status"], "ACTIVE")

    def test_a_refused_password_is_said_plainly(self):
        FakeFlipkart.script["/login"] = lambda s, kw: _resp(401, {"message": "Invalid username or password"})
        r = self.connect()
        self.assertEqual((r.status_code, r.data["status"]), (409, "FAILED"))
        self.assertIn("Invalid username or password", r.data["error"])

    def test_flipkart_unreachable(self):
        def down(s, kw):
            raise requests.ConnectionError("no route")
        FakeFlipkart.script["/login"] = down
        r = self.connect()
        self.assertEqual(r.status_code, 409)
        self.assertIn("Couldn't reach Flipkart", r.data["error"])

    def test_no_otp_without_the_password_step(self):
        self.assertEqual(self.c.post(f"{self.base}otp/", {"otp": "193575"}, format="json").status_code, 404)

    # ── Reading ──────────────────────────────────────────────────────────
    def test_the_dashboard_is_read_with_the_sessions_csrf_and_location(self):
        r = self.connected()
        self.assertEqual(r.status_code, 200, r.data)
        s = r.data["summary"]
        self.assertIn({"label": "today · gross_units", "value": 12}, s["sales"])
        self.assertIn({"label": "yesterday · gross_gmv", "value": 9800}, s["sales"])
        self.assertEqual(s["impressions"], [{"label": "impressions_latest", "value": 5000}, {"label": "impressions_prev", "value": 4200}])
        self.assertEqual(s["out_of_stock"], [{"label": "bring_listing_instock", "value": 7}, {"label": "potential_loss", "value": 130}])
        q = next(c for c in FakeFlipkart.calls if c["path"] == "/napi/graphql")
        self.assertEqual((q["headers"]["fk-csrf-token"], q["headers"]["x-location-id"], q["headers"]["operation-name"]),
                         ("csrf-1", "LOC3695231456da41de87ae9704b810e002", "GetBusinessSummarySalesUnits"))
        self.assertEqual(q["cookies"]["connect.sid"], "SESS-7f3q")

    def test_the_panel_is_opened_after_the_otp_to_get_the_csrf_token(self):
        # As the real Seller Hub does: /verifyOtp logs in, but the CSRF cookie comes with the panel page.
        def verify(s, kw):
            for k, v in (("connect.sid", "SESS-7f3q"), ("sellerId", "41ad149fa06e4194"), ("is_login", "true")):
                s.cookies.set(k, v, domain="seller.flipkart.com")
            return _resp(200, {})
        def panel(s, kw):
            s.cookies.set(flipkart_seller.CSRF_COOKIE, "csrf-from-panel", domain="seller.flipkart.com")
            return _resp(200, {})
        FakeFlipkart.script.update({"/verifyOtp": verify, "/index.html": panel})
        r = self.connected()
        self.assertEqual((r.data["status"], r.data["status_message"]), ("ACTIVE", ""), r.data)
        q = next(c for c in FakeFlipkart.calls if c["path"] == "/napi/graphql")
        self.assertEqual(q["headers"]["fk-csrf-token"], "csrf-from-panel")
        self.assertLess([c["path"] for c in FakeFlipkart.calls].index("/index.html"),
                        [c["path"] for c in FakeFlipkart.calls].index("/napi/graphql"))

    def test_no_csrf_token_is_said_plainly_not_called_an_ended_session(self):
        def verify(s, kw):
            for k, v in (("connect.sid", "SESS-7f3q"), ("sellerId", "41"), ("is_login", "true")):
                s.cookies.set(k, v, domain="seller.flipkart.com")
            return _resp(200, {})
        FakeFlipkart.script["/verifyOtp"] = verify
        self.connected()
        r = self.c.post(f"{self.base}refresh/")
        self.assertEqual((r.status_code, r.data["status"]), (200, "ACTIVE"))
        self.assertIn("security token (CSRF)", r.data["status_message"])

    def test_a_403_is_said_as_flipkart_said_it_not_called_expired(self):
        self.connected()
        FakeFlipkart.script["/napi/graphql"] = lambda s, kw: _resp(403, {"message": "Forbidden for location"})
        r = self.c.post(f"{self.base}refresh/")
        self.assertEqual(r.data["status"], "ACTIVE")
        self.assertIn("HTTP 403): Forbidden for location", r.data["status_message"])

    # ── Orders ───────────────────────────────────────────────────────────
    def test_the_orders_page_is_read_every_tab_with_its_count(self):
        r = self.connected()
        o = r.data["orders"]
        self.assertEqual((o["counts"]["upcoming"], o["counts"]["pendingToDispatch"], o["counts"]["completed"]), (2, 3, 271))
        self.assertEqual({k: len(v) for k, v in o["tabs"].items()},
                         {"pendingToAccept": 2, "pendingToPack": 0, "pendingToDispatch": 3, "inTransit": 1, "pendingService": 0})
        row = o["tabs"]["pendingToDispatch"][1]
        self.assertEqual({k: row[k] for k in ("order_id", "shipment_id", "qty", "price", "dispatch_by", "tracking_id", "courier", "order_item_ids")},
                         {"order_id": "OD21", "shipment_id": "SH21", "qty": 2, "price": 85.0, "dispatch_by": "2026-11-13T12:00:00",
                          "tracking_id": "FMPC21", "courier": "Ekart Logistics", "order_item_ids": ["OI21"]})
        self.assertEqual(row["items"][0]["sku"], "5-inch-golden-plate")
        self.assertIsNone(o["tabs"]["pendingToAccept"][0]["accepted_at"])
        q = next(c for c in FakeFlipkart.calls if c["path"] == "/orchestrator/graphql")
        self.assertEqual((q["headers"]["x-user-id"], q["headers"]["x-client-id"], q["headers"]["fk-csrf-token"]),
                         ("41ad149fa06e4194", "SD", "csrf-1"))
        self.assertEqual(q["json"]["variables"]["input"]["params"]["seller_id"], "41ad149fa06e4194")
        self.assertIsNotNone(A.objects.get().orders_at)

    def test_every_page_of_a_tab_is_read(self):
        self.connected()
        with mock.patch.object(flipkart_seller, "ORDER_PAGE", 2):
            self.c.post(f"{self.base}refresh/")
        o = A.objects.get().orders
        self.assertEqual([r["order_id"] for r in o["tabs"]["pendingToDispatch"]], ["OD20", "OD21", "OD22"])
        pages = [c["json"]["variables"]["input"]["paginationInput"]["pageNum"] for c in FakeFlipkart.calls
                 if c["path"] == "/orchestrator/graphql" and c["json"]["variables"]["input"].get("status") == "pendingToDispatch"
                 and "paginationInput" in c["json"]["variables"]["input"]]
        self.assertEqual(pages[-2:], [1, 2])
        self.assertEqual(o["cut"], [])
        with mock.patch.object(flipkart_seller, "ORDER_PAGE", 1), mock.patch.object(flipkart_seller, "ORDER_PAGES", 2):
            self.c.post(f"{self.base}refresh/")
        self.assertEqual(A.objects.get().orders["cut"], ["pendingToDispatch"])          # more than it reads: said so

    def test_an_orders_error_keeps_the_dashboard_and_the_last_orders(self):
        self.connected()
        before = A.objects.get().orders
        FakeFlipkart.orders = staticmethod(lambda kw: _resp(200, {"data": None, "graphErrors": [{"message": "orders down"}]}))
        try:
            r = self.c.post(f"{self.base}refresh/")
        finally:
            FakeFlipkart.orders = staticmethod(_orders)
        self.assertEqual(r.data["status"], "ACTIVE")
        self.assertIn("orders: Flipkart said: orders down", r.data["status_message"])
        self.assertEqual(A.objects.get().orders, before)
        self.assertTrue(r.data["summary"]["sales"])

    def test_an_ended_session_on_the_orders_page_marks_it_expired(self):
        self.connected()
        FakeFlipkart.orders = staticmethod(lambda kw: _resp(401, {}))
        try:
            r = self.c.post(f"{self.base}refresh/")
        finally:
            FakeFlipkart.orders = staticmethod(_orders)
        self.assertEqual(r.data["status"], "EXPIRED")

    def test_renewed_cookies_are_kept(self):
        self.connected()
        def renew(s, kw):
            s.cookies.set("connect.sid", "renewed", domain="seller.flipkart.com")
            return _resp(200, {"data": {}})
        FakeFlipkart.script["/napi/graphql"] = renew
        self.assertEqual(self.c.post(f"{self.base}refresh/").status_code, 200)
        self.assertEqual(json.loads(meesho_sync.decrypt(A.objects.get().cookies_enc))["connect.sid"], "renewed")

    def test_an_ended_session_marks_the_account_expired(self):
        self.connected()
        FakeFlipkart.script["/napi/graphql"] = lambda s, kw: _resp(401, {"message": "Unauthorized"})
        r = self.c.post(f"{self.base}refresh/")
        self.assertEqual((r.status_code, r.data["status"]), (409, "EXPIRED"))
        self.assertIn("new OTP", r.data["error"])

    def test_a_graphql_error_on_one_read_keeps_the_others(self):
        self.connected()
        def partly(s, kw):
            if kw["json"]["operationName"] == "GetBusinessSummaryImpressions":
                return _resp(200, {"errors": [{"message": "field not available"}]})
            return _resp(200, {"data": {"x": {"result": {"n": 1}}}})
        FakeFlipkart.script["/napi/graphql"] = partly
        r = self.c.post(f"{self.base}refresh/")
        self.assertEqual((r.status_code, r.data["status"]), (200, "ACTIVE"))
        self.assertIn("impressions: Flipkart said: field not available", r.data["status_message"])
        self.assertNotIn("impressions", r.data["summary"])
        self.assertEqual(r.data["summary"]["sales"], [{"label": "x · n", "value": 1}])

    def test_the_schedule_refreshes_every_connected_account(self):
        self.connected()
        import io
        out = io.StringIO()
        call_command("flipkart_refresh", stdout=out)
        self.assertEqual(json.loads(out.getvalue()), {str(self.biz.id): "ok"})
        FakeFlipkart.script["/napi/graphql"] = lambda s, kw: _resp(302, {}, {"location": "/login"})
        out = io.StringIO()
        call_command("flipkart_refresh", stdout=out)
        self.assertEqual(json.loads(out.getvalue()), {str(self.biz.id): "expired"})
        self.assertEqual(A.objects.get().status, "EXPIRED")
        # Expired accounts are left alone until someone logs in again.
        out = io.StringIO()
        call_command("flipkart_refresh", stdout=out)
        self.assertEqual(json.loads(out.getvalue()), {})

    # ── Settings and access ──────────────────────────────────────────────
    def test_location_disconnect_and_who_may_do_what(self):
        self.connected()
        self.assertEqual(self.c.patch(self.base, {"location_id": "nope"}, format="json").status_code, 400)
        self.assertEqual(self.c.patch(self.base, {"location_id": "LOCabc123456"}, format="json").data["location_id"], "LOCabc123456")
        member = User.objects.create_user(username="m", password="pw", role=User.ROLE_BUSINESS_USER)
        Membership.objects.create(user=member, business=self.biz)
        set_user_rule(member, ["/flipkart-seller"])
        c = APIClient(); c.force_authenticate(member)
        self.assertEqual(c.get(self.base).data["connected"], True)                 # sees it
        self.assertEqual(c.post(f"{self.base}refresh/").status_code, 200)          # may read it now
        self.assertEqual(c.post(f"{self.base}connect/", {"username": "1", "password": "x"}, format="json").status_code, 403)
        self.assertEqual(c.delete(self.base).status_code, 403)
        set_user_rule(member, ["/orders"])
        self.assertEqual(c.get(self.base).status_code, 403)                         # not their page
        self.assertEqual(self.c.delete(self.base).data["connected"], False)
        self.assertFalse(A.objects.exists())
