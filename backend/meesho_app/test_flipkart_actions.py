"""Accepting and marking RTD Flipkart orders, as Seller Hub's Forward Orders page does. Flipkart is faked."""

import os
from unittest import mock

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from . import flipkart_actions, flipkart_seller, meesho_sync
from .models import FlipkartSellerAccount as A
from .test_flipkart_seller import KEY, FakeFlipkart, _no_payments, _orders, _resp, _shipment

LOC = "LOC3695231456da41de87ae9704b810e002"
DBD = "2026-11-14T12:00:00.000+05:30"


def _group(gid, n, missing=False, length=10):
    return {"groupId": gid, "subGroupIndex": 0, "shipmentCount": n, "missingDimensions": missing, "isMps": False,
            "packagingPolicy": "DEFAULT", "channelOfSale": "FLIPKART", "priceRange": {"minPrice": 85, "maxPrice": 85},
            "groupDetails": {"shipmentGroupSpecs": [{"listing": {"listingId": gid[2:], "product": {"sku": f"sku-{gid[-3:]}",
                                                                                                   "title": "Plate", "primaryImageUrl": "x"}},
                                                     "quantity": 1}],
                             "packages": [{"packageId": f"PKG{gid[5:]}", "dimensions": {"length": length, "breadth": 10, "height": 2, "weight": 0.1}}]},
            "sellerInputAttributes": [{"shippingId": f"S{i}", "orderId": f"OD{gid[-3:]}{i}"} for i in range(n)]}


class Hub:
    """Seller Hub's To accept / To pack: groups waiting for one dispatch-by date; AcceptOrders and MarkRTD answered."""

    def __init__(self):
        self.waiting = {"pendingToAccept": [_group("1_LSTAAA", 4), _group("1_LSTBBB", 1), _group("1_LSTCCC", 1, missing=True)],
                        "pendingLabel": [], "pendingRTD": [_group("1_LSTDDD", 2)]}
        self.sent = []
        self.answer = None

    def orch(self, kw):
        body = kw["json"]
        op, inp = body["operationName"], body["variables"].get("input") or {}
        if op == "GetStateCountBreakdown":
            n = sum(g["shipmentCount"] for g in self.waiting.get(inp["status"], []))
            dates = [{"dispatchByDate": DBD, "shipmentCount": n}] if n else []
            return _resp(200, {"data": {"shipmentStatesCountAndBreakdown": {"shipmentStatesCountMetrics": {"shipmentCountBreakdown": {
                "logisticsShipmentCountDetails": [{"printStatusShipmentCountDetails": [{"dbdShipmentCountDetails": dates}]}]}}}}})
        if op == "GetShipmentGroups":
            assert inp["shipmentParams"]["dbd"] == DBD and inp["shipmentParams"]["location_id"] == LOC, inp
            return _resp(200, {"data": {"filteredShipmentGroups": {"shipmentGroups": self.waiting.get(inp["status"], []),
                                                                   "pageInfo": {"hasMore": False}}}})
        return _orders(kw)

    def napi(self, kw):
        body = kw["json"]
        op = body["operationName"]
        if op not in ("AcceptOrders", "MarkRTD"):
            return _no_payments(kw)
        self.sent.append({"op": op, "variables": body["variables"], "query": body["query"], "headers": kw.get("headers") or {}})
        key = "sfs_revampedOrderShipmentsPackV4" if op == "AcceptOrders" else "sfs_revampedOrderShipmentsGroupRTD"
        groups = body["variables"]["groups"]
        rows = [{"external_shipment_id" if op == "AcceptOrders" else "id": f"{g['group_id']}-{i}", "status": "SUCCESS", "error_message": None}
                for g in groups for i in range(g["size"])]
        return _resp(200, {"data": {key: self.answer or {"view_name": "group_shipment", "groups_response": None,
                                                         "shipment_response": rows, "error_message": None}}})


class FlipkartActionTests(TestCase):
    def setUp(self):
        key = mock.patch.dict(os.environ, {"MEESHO_SYNC_KEY": KEY})
        key.start()
        self.addCleanup(key.stop)
        FakeFlipkart.calls, FakeFlipkart.script = [], {}
        self.hub = Hub()
        for target, name, fake in ((flipkart_seller, "_http", None), (FakeFlipkart, "orders", staticmethod(self.hub.orch)),
                                   (FakeFlipkart, "payments", staticmethod(self.hub.napi))):
            p = mock.patch.object(target, name, side_effect=lambda: FakeFlipkart()) if fake is None else mock.patch.object(target, name, fake)
            p.start()
            self.addCleanup(p.stop)
        self.admin = User.objects.create_user(username="a", password="pw", role=User.ROLE_SUPER_ADMIN)
        self.biz = Business.objects.create(name="Rudam")
        Membership.objects.create(user=self.admin, business=self.biz)
        self.account = A.objects.create(
            business=self.biz, username="8273343222", password_enc=meesho_sync.encrypt("pw"), status=A.STATUS_ACTIVE,
            seller_id="41ad149fa06e4194", location_id=LOC, sync_at=__import__("django.utils.timezone").utils.timezone.now(),
            cookies_enc=meesho_sync.encrypt('{"connect.sid": "SESS-7f3q", "%s": "csrf-1"}' % flipkart_seller.CSRF_COOKIE))
        self.c = APIClient()
        self.c.force_authenticate(self.admin)
        self.base = f"/api/business/{self.biz.id}/flipkart-seller/"

    def post(self, path, **data):
        return self.c.post(f"{self.base}{path}", {"business": self.biz.id, **data}, format="json")

    def test_what_is_waiting_is_read_now(self):
        r = self.c.get(f"{self.base}actions/", {"business": self.biz.id})
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual([(g["group_id"], g["shipments"], g["missing_dimensions"]) for g in r.data["accept"]],
                         [("1_LSTAAA", 4, False), ("1_LSTBBB", 1, False), ("1_LSTCCC", 1, True)])
        self.assertEqual(r.data["accept"][0]["dispatch_by"], DBD)
        self.assertEqual(r.data["accept"][0]["orders"], ["ODAAA0", "ODAAA1", "ODAAA2", "ODAAA3"])
        self.assertEqual((r.data["label"], [g["group_id"] for g in r.data["rtd"]]), ([], ["1_LSTDDD"]))
        self.assertEqual(self.hub.sent, [])                                  # reading never acts

    def test_accept_sends_what_seller_hub_sends(self):
        r = self.post("accept/")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual((r.data["shipments"], r.data["failed"], len(r.data["skipped"])), (5, 0, 1))
        self.assertEqual(r.data["skipped"][0]["group_id"], "1_LSTCCC")         # no package size: left for Seller Hub
        sent = self.hub.sent[0]
        self.assertEqual(sent["op"], "AcceptOrders")
        self.assertIn("sfs_revampedOrderShipmentsPackV4", sent["query"])
        self.assertEqual((sent["headers"]["operation"], sent["headers"]["x-client-id"], sent["headers"]["x-location-id"]),
                         ("mutation", "SD", LOC))
        v = sent["variables"]
        self.assertEqual((v["view_name"], v["filters"], v["shipments"], v["location_id"]), ("group_shipment", {}, [], LOC))
        self.assertEqual(v["groups"][0], {
            "group_id": "1_LSTAAA", "sub_group_index": 0, "size": 4,
            "dimensions": [{"length": 10, "breadth": 10, "height": 2, "weight": 0.1, "external_sub_shipment_id": "PKGAAA",
                            "volumetric_weight": 1}],
            "max_price": 85, "min_price": 85, "channel_of_sale": "FLIPKART", "packaging_policy": "DEFAULT", "dispatch_by_date": DBD})
        self.assertEqual([g["group_id"] for g in v["groups"]], ["1_LSTAAA", "1_LSTBBB"])
        # The orders are read again for the page.
        self.assertTrue(A.objects.get(pk=self.account.pk).orders_at)
        self.assertIn("accounts", r.data)

    def test_only_the_groups_asked_for(self):
        r = self.post("accept/", groups=["1_LSTBBB"])
        self.assertEqual((r.status_code, r.data["shipments"]), (200, 1), r.data)
        self.assertEqual([g["group_id"] for g in self.hub.sent[0]["variables"]["groups"]], ["1_LSTBBB"])
        r = self.post("accept/", dispatch_by="2026-11-20T12:00:00.000+05:30")         # nothing due then
        self.assertEqual((r.data["shipments"], len(self.hub.sent)), (0, 1))

    def test_mark_rtd_sends_what_seller_hub_sends(self):
        r = self.post("rtd/")
        self.assertEqual((r.status_code, r.data["shipments"]), (200, 2), r.data)
        sent = self.hub.sent[0]
        self.assertEqual(sent["op"], "MarkRTD")
        self.assertIn("sfs_revampedOrderShipmentsGroupRTD", sent["query"])
        v = sent["variables"]
        self.assertFalse(v["override_label_print"])
        self.assertEqual(v["groups"], [{"group_id": "1_LSTDDD", "sub_group_index": 0, "dispatch_by_date": DBD,
                                        "channel_of_sale": "FLIPKART", "packaging_policy": "DEFAULT", "size": 2}])

    def test_what_flipkart_refuses_is_said(self):
        self.hub.answer = {"shipment_response": [{"id": "1_LSTDDD-0", "status": "FAILED", "error_message": "Label not printed"},
                                                 {"id": "1_LSTDDD-1", "status": "SUCCESS", "error_message": None}],
                           "error_message": None}
        r = self.post("rtd/")
        self.assertEqual(r.status_code, 207, r.data)
        self.assertEqual(r.data["failed"], 1)
        self.assertEqual(r.data["results"][0]["failed"], [{"id": "1_LSTDDD-0", "error": "Label not printed"}])

    def test_nothing_is_sent_without_the_pickup_location_and_it_comes_from_the_orders(self):
        A.objects.filter(pk=self.account.pk).update(location_id="")
        with mock.patch.object(flipkart_seller, "read_orders", return_value={"counts": {}, "tabs": {}, "cut": []}):
            r = self.post("accept/")
        self.assertEqual(r.status_code, 409)
        self.assertIn("pickup location", r.data["error"])
        self.assertEqual(self.hub.sent, [])
        # A shipment names its location: the next read keeps it.
        sh = _shipment(1, "pendingToDispatch")
        sh["locationId"] = LOC
        self.assertEqual(flipkart_seller._row(sh, "pendingToDispatch")["location_id"], LOC)
        with mock.patch.object(flipkart_seller, "read_orders", return_value={"counts": {}, "tabs": {"pendingToDispatch": [
                flipkart_seller._row(sh, "pendingToDispatch")]}, "cut": []}):
            flipkart_seller.refresh(A.objects.get(pk=self.account.pk), sync=False)
        self.assertEqual(A.objects.get(pk=self.account.pk).location_id, LOC)

    def test_only_a_business_on_this_page(self):
        u = User.objects.create_user(username="m", password="pw", role=User.ROLE_BUSINESS_USER)
        Membership.objects.create(user=u, business=self.biz)
        stranger = Business.objects.create(name="Someone else")
        c = APIClient()
        c.force_authenticate(u)
        r = c.post(f"{self.base}accept/", {"business": stranger.id}, format="json")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(self.hub.sent, [])
        self.assertIsInstance(flipkart_actions.STAGES, dict)
