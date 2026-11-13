"""Flipkart Seller Hub → the Flipkart tables (orders, payouts, payments, upcoming) and their reconciliation. Flipkart is faked."""

import os
from datetime import timedelta
from decimal import Decimal
from unittest import mock

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from . import flipkart_seller, flipkart_sync, meesho_sync
from .models import (
    FlipkartOrder, FlipkartOrderPayment, FlipkartOtherCharge, FlipkartOutstandingPayment, FlipkartPayout,
    FlipkartSellerAccount as A,
)
from .test_flipkart_seller import KEY, FakeFlipkart, _orders, _resp, _shipment
from .views import FK_DELIVERED, flipkart_outcome

TODAY = timezone.localdate()
PAID_POST, PAID_PRE, TODAY_POST = TODAY - timedelta(days=2), TODAY - timedelta(days=3), TODAY


def _hub_day(d):
    return d.strftime("%b %d,%Y")          # "Nov 11,2026", as Previous payments says it


def _line(item, value, description="Sale", status="DELIVERED", sale=None, sku="5-inch-golden-plate", **kw):
    return {"transaction_type": "Previous", "order_item_id": item, "order_id": f"OD{item[2:]}", "settlement_type": "POSTPAID",
            "sale_amount": str(sale if sale is not None else value), "refund_amount": "0", "offer_amount": "0", "seller_share": "0",
            "flipkart_fees": "-10", "settlement_value": str(value), "sku": sku, "description": description,
            "dispatched_date": "26-Oct-2026", "due_date": "12-Nov-2026", "fulfillment_type": "NON_FA", "order_date": "25-Oct-2026",
            "order_status": status, "offer_adjustments": "0", "taxes": "-3.93", **kw}


class Hub:
    """Seller Hub's Payments pages: three transfers (two paid, one on its way) and what each paid; what's coming."""

    def __init__(self):
        self.payouts = [
            {"utr_number": "NFT-/XUTR/DEUTH0001X", "transfer_amount": 300, "advice_id": "9001", "payment_date": _hub_day(PAID_POST),
             "settlement_type": "Postpaid", "settlement_status": "completed"},
            {"utr_number": "AXISCN0002", "transfer_amount": 140, "advice_id": "9002", "payment_date": _hub_day(PAID_PRE),
             "settlement_type": "Prepaid", "settlement_status": "completed"},
            {"utr_number": "DISBURSEMENT_CREATED", "transfer_amount": 99, "advice_id": "9003", "payment_date": _hub_day(TODAY_POST),
             "settlement_type": "Postpaid", "settlement_status": "approved"},
        ]
        self.settled = {
            (PAID_POST, "POSTPAID"): [_line("OI30", "310.004"), _line("OI40", "0", "Promotions", "RETURNED", sale=0),
                                      _line("OI40", "-10", "Return", "RETURNED", sale=0)],
            (PAID_PRE, "PREPAID"): [_line("OI50", "150", sku="pooja-thali")],
        }
        self.upcoming = {"POSTPAID": [_line("OI31", "80.5", status="IN_TRANSIT", due_date=(TODAY + timedelta(days=4)).strftime("%d-%b-%Y"),
                                            transaction_type="Upcoming")],
                         "PREPAID": []}
        # The rest of a transfer: {(day, type): {group: {sub_group: [rows]}}}
        self.charges = {}
        self.nets = {}             # (day, type, group, sub_group): the sub-tab's total, when it isn't its rows' sum
        self.reads = []

    def net(self, key, group, sub):
        rows = self.charges.get(key, {}).get(group, {}).get(sub, [])
        return self.nets.get((*key, group, sub), sum(float(r["amount"]) for r in rows))

    def __call__(self, kw):
        body = kw["json"]
        op, v = body["operationName"], body["variables"]
        self.reads.append((op, v))
        if op == "Payments_Previous_Payments_WEB_getTableData":
            return _resp(200, {"data": {"payments_fetchPreviousPaymentTableData": {
                "data": self.payouts, "show_more": False, "token": str(len(self.payouts)), "total_count": len(self.payouts)}}})
        if op == "GetPaymentOrderSearchOrchestrator":
            i = v["input"]
            key = (timezone.datetime.fromisoformat(i["fromDate"]).date(), i["paymentType"])
            groups = [{"group": "orderItem", "label": "Orders", "netAmount": sum(float(r["settlement_value"]) for r in self.settled.get(key, []))}]
            for g, subs in self.charges.get(key, {}).items():
                groups.append({"group": g, "label": g, "netAmount": sum(self.net(key, g, k) for k in subs)})
            return _resp(200, {"data": {"settlement": {"paymentOrderSearch": {"groupSummaryList": {
                "groups": groups, "total": sum(g["netAmount"] for g in groups)}}}}})
        key = (timezone.datetime.fromisoformat(v["startDate"]).date(), v["paymentType"])
        if op == "TransactionPage_getTransactionsSubTabs":
            subs = self.charges.get(key, {}).get(v["tabName"], {})
            return _resp(200, {"data": {"getTransactionsSubTabs": [
                {"sub_group": k, "label": k.title(), "net_amount": self.net(key, v["tabName"], k)} for k in subs]}})
        assert op == "TransactionPage_getTransactionsTableData", op
        if v["tabName"] != "orderItem":
            rows = self.charges.get(key, {}).get(v["tabName"], {}).get(v["subTabName"], [])
        elif v["settlementStatus"] == "settled":
            rows = self.settled.get((timezone.datetime.fromisoformat(v["startDate"]).date(), v["paymentType"]), [])
        else:
            rows = self.upcoming[v["paymentType"]]
        token, size = int(v["token"]), int(v["size"])
        chunk = rows[token:token + size]
        return _resp(200, {"data": {"getTransactionTableData": {
            "transactions": [{"fields": [{"key": k, "value": x} for k, x in r.items()]} for r in chunk],
            "token": token + len(chunk), "is_next": token + len(chunk) < len(rows), "total_count": len(rows)}}})


def _completed(kw):
    """The Completed tab: OI60 delivered, OI61 cancelled before dispatch (quantity 0), OI30 delivered."""
    inp = kw["json"]["variables"].get("input") or {}
    if kw["json"]["operationName"] != "GetShipmentListByOrderId" or inp.get("status") != "completed":
        return _orders(kw)
    delivered = _shipment(60, "completed")
    delivered["statusHistory"].update(dispatchTime="2026-11-03T18:07:21.716", deliveredTime="2026-11-10T18:51:45")
    cancelled = _shipment(61, "completed")
    cancelled["shipmentOrderItems"] = [{"orderItemId": "OI61", "quantity": 0}]
    sold = _shipment(30, "completed")
    sold["statusHistory"].update(dispatchTime="2026-10-26T10:00:00", deliveredTime="2026-10-30T10:00:00")
    return _resp(200, {"data": {"filteredShipmentGroups": {"shipmentGroups": [{"shipments": [delivered, cancelled, sold]}],
                                                           "pageInfo": {"hasMore": False, "total": 3}}}})


class FlipkartSyncTests(TestCase):
    def setUp(self):
        key = mock.patch.dict(os.environ, {"MEESHO_SYNC_KEY": KEY})
        key.start()
        self.addCleanup(key.stop)
        FakeFlipkart.calls, FakeFlipkart.script = [], {}
        self.hub = Hub()
        p = mock.patch.object(flipkart_seller, "_http", side_effect=lambda: FakeFlipkart())
        p.start()
        self.addCleanup(p.stop)
        orch = lambda kw: self.hub(kw) if kw["json"]["operationName"] == "GetPaymentOrderSearchOrchestrator" else _completed(kw)
        for name, fake in (("payments", staticmethod(self.hub)), ("orders", staticmethod(orch))):
            p = mock.patch.object(FakeFlipkart, name, fake)
            p.start()
            self.addCleanup(p.stop)
        self.admin = User.objects.create_user(username="a", password="pw", role=User.ROLE_SUPER_ADMIN)
        self.biz = Business.objects.create(name="Rudam")
        Membership.objects.create(user=self.admin, business=self.biz)
        self.account = A.objects.create(
            business=self.biz, username="8273343222", password_enc=meesho_sync.encrypt("pw"), status=A.STATUS_ACTIVE,
            seller_id="41ad149fa06e4194", location_id="LOC1",
            cookies_enc=meesho_sync.encrypt('{"connect.sid": "SESS-7f3q", "%s": "csrf-1"}' % flipkart_seller.CSRF_COOKIE),
            orders={"tabs": {"pendingToDispatch": [flipkart_seller._row(_shipment(20, "pendingToDispatch"), "pendingToDispatch")],
                             "inTransit": [flipkart_seller._row(_shipment(31, "inTransit"), "inTransit")]}})
        self.c = APIClient()
        self.c.force_authenticate(self.admin)
        self.base = f"/api/business/{self.biz.id}/flipkart-seller/"

    def sync(self):
        return flipkart_sync.run(A.objects.get(pk=self.account.pk))

    def pay(self, item, neft):
        return FlipkartOrderPayment.objects.get(business=self.biz, order_item_id=item, neft_id=neft)

    # ── Writing ──────────────────────────────────────────────────────────
    def test_payouts_and_what_each_paid_land_in_the_tables_keyed_by_utr(self):
        out = self.sync()
        self.assertTrue(out["ok"], out)
        paid = FlipkartPayout.objects.get(advice_id="9001")
        self.assertEqual((paid.utr, paid.status, paid.settlement_type, paid.payment_date, paid.transfer_amount),
                         ("NFT-/XUTR/DEUTH0001X", "paid", "POSTPAID", PAID_POST, Decimal("300")))
        self.assertEqual((paid.items_count, paid.items_amount), (2, Decimal("300.00")))
        # On its way: no UTR yet, and what it pays isn't read until the bank has it.
        coming = FlipkartPayout.objects.get(advice_id="9003")
        self.assertEqual((coming.utr, coming.status, coming.items_read_at), ("", "in_progress", None))
        p = self.pay("OI30", "NFT-/XUTR/DEUTH0001X")
        self.assertEqual((p.settlement_value, p.sale_amount, p.marketplace_fee, p.taxes, p.payment_date, p.seller_sku, p.return_type),
                         (Decimal("310.00"), Decimal("310.00"), Decimal("-10.00"), Decimal("-3.93"), PAID_POST, "5-inch-golden-plate", "NA"))
        # One row per item per payout: the Promotions and Return lines of OI40 are one, a return.
        r = self.pay("OI40", "NFT-/XUTR/DEUTH0001X")
        self.assertEqual((r.settlement_value, r.return_type, r.marketplace_fee), (Decimal("-10.00"), "Return", Decimal("-20.00")))
        self.assertEqual(self.pay("OI50", "AXISCN0002").settlement_value, Decimal("150.00"))
        self.assertIsNotNone(p.synced_at)
        up = FlipkartOutstandingPayment.objects.get()
        self.assertEqual((up.order_item_id, up.settlement_value, up.order_status, up.due_date, up.settlement_type),
                         ("OI31", Decimal("80.50"), "SHIPPED", TODAY + timedelta(days=4), "POSTPAID"))
        self.assertEqual((out["payouts_added"], out["payments_added"], out["upcoming"]), (3, 3, 1))

    def test_orders_from_the_tabs_completed_and_the_payments(self):
        self.sync()
        st = dict(FlipkartOrder.objects.filter(business=self.biz).values_list("order_item_id", "order_item_status"))
        self.assertEqual(st, {"OI20": "READY_TO_SHIP", "OI31": "SHIPPED", "OI60": "DELIVERED", "OI61": "CANCELLED",
                              "OI30": "DELIVERED", "OI40": "RETURNED", "OI50": "DELIVERED"})
        o = FlipkartOrder.objects.get(order_item_id="OI60")
        self.assertEqual((o.order_id, o.sku, o.delivery_tracking_id, o.logistics_partner, str(o.delivery_date), str(o.dispatched_date)),
                         ("OD60", "5-inch-golden-plate", "FMPC60", "Ekart Logistics", "2026-11-10", "2026-11-03"))
        # An order only the payments know of is still written, from what they say.
        self.assertEqual(FlipkartOrder.objects.get(order_item_id="OI50").sku, "pooja-thali")

    def test_a_second_sync_writes_nothing_twice_and_reads_each_paid_payout_once(self):
        self.sync()
        self.hub.reads.clear()
        out = self.sync()
        self.assertEqual((out["payouts_added"], out["payments_added"], out["orders_added"]), (0, 0, 0), out)
        self.assertEqual(FlipkartPayout.objects.count(), 3)
        self.assertEqual(FlipkartOrderPayment.objects.count(), 3)
        self.assertEqual(FlipkartOutstandingPayment.objects.count(), 1)          # replaced, not added to
        settled = [v for op, v in self.hub.reads if v.get("settlementStatus") == "settled"]
        self.assertEqual(settled, [])
        # The transfer that was on its way is paid now: its items are read then, under its UTR.
        self.hub.payouts[2].update(utr_number="NFT-/XUTR/DEUTH0003X", settlement_status="completed")
        self.hub.settled[(TODAY_POST, "POSTPAID")] = [_line("OI20", "99")]
        out = self.sync()
        self.assertEqual((out["payouts_paid"], out["payments_added"]), (1, 1), out)
        self.assertEqual(self.pay("OI20", "NFT-/XUTR/DEUTH0003X").settlement_value, Decimal("99.00"))

    def test_long_lists_are_read_page_by_page(self):
        self.hub.settled[(PAID_POST, "POSTPAID")] = [_line(f"OI{900 + i}", "1") for i in range(7)]
        with mock.patch.object(flipkart_sync, "TABLE_PAGE", 3):
            self.sync()
        self.assertEqual(FlipkartOrderPayment.objects.filter(neft_id="NFT-/XUTR/DEUTH0001X").count(), 7)

    def test_an_uploaded_report_keeps_its_figures_and_its_further_status(self):
        # The Settlement Report has OI30 under the same NEFT id, broken down further than Seller Hub does.
        FlipkartOrderPayment.objects.create(business=self.biz, order_item_id="OI30", order_id="OD30", neft_id="NFT-/XUTR/DEUTH0001X",
                                            seller_sku="5-inch-golden-plate", settlement_value=Decimal("310.01"), tcs=Decimal("-1.5"),
                                            return_type="NA", payment_date=PAID_POST)
        # The Orders report says OI60 came back; Completed only says it was delivered.
        FlipkartOrder.objects.create(business=self.biz, order_item_id="OI60", order_id="OD60", order_item_status="RETURNED",
                                     sku="from-report", delivery_tracking_id="DTr:FMPC60")
        FlipkartOrder.objects.create(business=self.biz, order_item_id="OI20", order_id="OD20", order_item_status="APPROVED", sku="")
        out = self.sync()
        p = self.pay("OI30", "NFT-/XUTR/DEUTH0001X")
        self.assertEqual((p.settlement_value, p.tcs, p.marketplace_fee), (Decimal("310.01"), Decimal("-1.50"), Decimal("-10.00")))
        self.assertIsNotNone(p.synced_at)
        self.assertEqual(out["payments_confirmed"], 1)
        o = FlipkartOrder.objects.get(order_item_id="OI60")
        self.assertEqual((o.order_item_status, o.sku, o.delivery_tracking_id), ("RETURNED", "from-report", "DTr:FMPC60"))
        o = FlipkartOrder.objects.get(order_item_id="OI20")            # moves on, and its gaps are filled
        self.assertEqual((o.order_item_status, o.sku), ("READY_TO_SHIP", "5-inch-golden-plate"))

    def test_status_rules(self):
        m = flipkart_sync.moves_on
        self.assertTrue(m("APPROVED", "SHIPPED"))
        self.assertFalse(m("SHIPPED", "APPROVED"))
        self.assertFalse(m("RETURNED", "DELIVERED"))
        self.assertTrue(m("DELIVERED", "RETURN_REQUESTED"))
        self.assertTrue(m("CANCELLED", "SHIPPED"))           # listed live again: it wasn't cancelled
        self.assertFalse(m("SHIPPED", "CANCELLED"))          # shipped things aren't cancelled after
        self.assertTrue(m("READY_TO_SHIP", "CANCELLED"))
        self.assertEqual(flipkart_outcome([], "RETURN_CANCELLED")[0], FK_DELIVERED)

    # ── The wrong business ───────────────────────────────────────────────
    def test_payments_already_recorded_under_another_business_are_not_written_here(self):
        other = Business.objects.create(name="Cosmify Mart")
        FlipkartOrderPayment.objects.create(business=other, order_item_id="OI77", order_id="OD77", neft_id="AXISCN0002",
                                            seller_sku="x", settlement_value=5)
        out = self.sync()
        self.assertEqual((out["ok"], out.get("refused")), (False, True))
        self.assertIn("Cosmify Mart", out["message"])
        self.assertEqual(FlipkartPayout.objects.filter(business=self.biz).count(), 0)
        self.assertEqual(FlipkartOrder.objects.filter(business=self.biz).count(), 0)
        self.assertEqual(A.objects.get(pk=self.account.pk).sync["refused"], True)
        # The refresh still reads the dashboard, and says why nothing was written.
        flipkart_seller.refresh(A.objects.get(pk=self.account.pk), sync=True)
        a = A.objects.get(pk=self.account.pk)
        self.assertEqual(a.status, A.STATUS_ACTIVE)
        self.assertIn("Cosmify Mart", a.status_message)

    # ── When it runs ─────────────────────────────────────────────────────
    def test_the_schedule_syncs_every_half_hour_and_read_now_at_once(self):
        flipkart_seller.refresh(A.objects.get(pk=self.account.pk))
        self.assertEqual(FlipkartPayout.objects.count(), 3)
        self.hub.reads.clear()
        flipkart_seller.refresh(A.objects.get(pk=self.account.pk))           # 10 minutes later: dashboard only
        self.assertEqual(self.hub.reads, [])
        r = self.c.post(f"{self.base}refresh/", {"business": self.biz.id}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertTrue(self.hub.reads)
        self.assertTrue(next(a for a in r.data["accounts"] if a["business"] == self.biz.id)["sync"]["ok"])
        A.objects.filter(pk=self.account.pk).update(sync_at=timezone.now() - timedelta(minutes=31))
        self.hub.reads.clear()
        flipkart_seller.refresh(A.objects.get(pk=self.account.pk))
        self.assertTrue(self.hub.reads)

    def test_zero_payments_are_each_kept_apart(self):
        for n, day in (("9101", PAID_POST - timedelta(days=7)), ("9102", PAID_POST - timedelta(days=9))):
            self.hub.payouts.append({"utr_number": "ZERO_PAYMENT_ADVICE", "transfer_amount": 0, "advice_id": n,
                                     "payment_date": _hub_day(day), "settlement_type": "Postpaid", "settlement_status": "completed"})
            self.hub.settled[(day, "POSTPAID")] = [_line("OI70", "25"), _line("OI71", "-25", "Return", "RETURNED")]
        self.sync()
        self.assertEqual(sorted(FlipkartPayout.objects.filter(advice_id__in=["9101", "9102"]).values_list("utr", flat=True)),
                         ["ADVICE-9101", "ADVICE-9102"])
        self.assertEqual(FlipkartOrderPayment.objects.filter(order_item_id="OI70").count(), 2)
        by = {p["advice_id"]: p for p in self.c.get(f"{self.base}reconcile/", {"business": self.biz.id}).data["payouts"]}
        self.assertEqual((by["9101"]["state"], by["9101"]["items_amount"]), ("matched", 0.0))

    # ── The rest of each transfer, and the profit ─────────────────────────
    def test_each_transfers_charges_are_written_and_taken_off_the_profit(self):
        self.hub.payouts[0]["transfer_amount"] = 205               # 300 for orders, 90 fine, 10 TDS, 5 SPF in
        self.hub.charges[(PAID_POST, "POSTPAID")] = {
            "serviceItem": {"fines": [{"service_order_id": "d25e", "service_name": "Fines", "amount": "-90"}]},
            "taxation": {"tds": [{"id": "t1", "amount": "-10"}]},
            # Seller Hub's sub-tab says +5 but lists nothing: the 5 still counts, as one line.
            "spf": {"non_order_spf": []},
        }
        self.hub.nets[(PAID_POST, "POSTPAID", "spf", "non_order_spf")] = 5
        out = self.sync()
        self.assertEqual(out["charges_added"], 3, out)
        rows = {(c.category, c.source_sheet, c.reference_id): c.amount for c in FlipkartOtherCharge.objects.filter(neft_id="NFT-/XUTR/DEUTH0001X")}
        self.assertEqual(rows, {("fines", "Fines", "d25e"): Decimal("-90.00"), ("tax", "TDS", "t1"): Decimal("-10.00"),
                                ("spf", "Non_Order_SPF", "spf:non_order_spf"): Decimal("5.00")})
        self.assertTrue(all(c.source == "seller_hub" for c in FlipkartOtherCharge.objects.all()))
        by = {p["advice_id"]: p for p in self.c.get(f"{self.base}reconcile/", {"business": self.biz.id}).data["payouts"]}
        self.assertEqual((by["9001"]["state"], by["9001"]["difference"]), ("matched", 0.0))
        # The profit and loss: the orders' profit, less these charges.
        from .flipkart_views import _other_charges_summary
        self.assertEqual(_other_charges_summary(self.biz, None, None)["total"], -95.0)

    def test_a_payment_row_takes_its_units_from_its_order(self):
        FlipkartOrder.objects.create(business=self.biz, order_item_id="OI50", order_id="OD50", order_item_status="DELIVERED",
                                     sku="pooja-thali", quantity=3)
        self.sync()
        self.assertEqual(self.pay("OI50", "AXISCN0002").quantity, 3)
        self.assertEqual(self.pay("OI30", "NFT-/XUTR/DEUTH0001X").quantity, 1)

    def test_a_settlement_report_speaks_for_its_transfers(self):
        self.hub.charges[(PAID_PRE, "PREPAID")] = {"serviceItem": {"ads": [{"campaign_id": "c1", "type": "Ads", "amount": "-30"}]}}
        self.sync()
        self.assertEqual(FlipkartOtherCharge.objects.filter(neft_id="AXISCN0002", source="seller_hub").count(), 1)
        # The report for that transfer is uploaded: its Ads row replaces the sync's (no -60).
        import openpyxl
        from .flipkart_views import import_flipkart_other_charges
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Ads"
        ws.append(["NEFT ID", "Payment Date", "Campaign / Transaction ID", "Type", "Settlement Value (Rs.)"])
        ws.append(["AXISCN0002", PAID_PRE.isoformat(), "CMP-1", "Top-up", -30])
        import_flipkart_other_charges(wb, self.biz, {"AXISCN0002"})
        rows = list(FlipkartOtherCharge.objects.filter(neft_id="AXISCN0002").values_list("source", "amount"))
        self.assertEqual(rows, [("report", Decimal("-30.00"))])
        # And a later sync adds nothing of its own to a transfer a report covers.
        FlipkartPayout.objects.filter(advice_id="9002").update(items_read_at=None)
        out = self.sync()
        self.assertEqual((out["charges_added"], out["charges_kept_from_report"]), (0, 1), out)
        self.assertEqual(FlipkartOtherCharge.objects.filter(neft_id="AXISCN0002").count(), 1)

    def test_the_whole_history_newest_first_a_few_transfers_a_run(self):
        out = flipkart_sync.run(A.objects.get(pk=self.account.pk), reads=1)
        self.assertEqual((out["payouts_items_read"], out["payouts_left"]), (1, 1), out)
        self.assertIsNotNone(FlipkartPayout.objects.get(advice_id="9001").items_read_at)     # the newest
        self.assertIsNone(FlipkartPayout.objects.get(advice_id="9002").items_read_at)
        out = flipkart_sync.run(A.objects.get(pk=self.account.pk), reads=1)
        self.assertEqual((out["payouts_items_read"], out["payouts_left"]), (1, 0), out)
        self.assertEqual(FlipkartOrderPayment.objects.count(), 3)
        from django.core.management import call_command
        import io
        buf = io.StringIO()
        call_command("flipkart_payments", business=self.biz.id, stdout=buf)
        self.assertIn('"ok": true', buf.getvalue())

    # ── Reconciliation ───────────────────────────────────────────────────
    def test_reconcile_matches_each_transfer_and_follows_each_order(self):
        self.hub.payouts[1]["transfer_amount"] = 120          # 150 paid for the item, 30 kept back (ads)
        self.hub.charges[(PAID_PRE, "PREPAID")] = {"serviceItem": {"ads": [{"campaign_id": "c1", "type": "Ads top-up", "amount": "-30"}]}}
        self.sync()
        r = self.c.get(f"{self.base}reconcile/", {"business": self.biz.id})
        self.assertEqual(r.status_code, 200, r.data)
        by = {p["advice_id"]: p for p in r.data["payouts"]}
        self.assertEqual((by["9001"]["state"], by["9001"]["items"], by["9001"]["items_amount"], by["9001"]["difference"]),
                         ("matched", 2, 300.0, 0.0))
        self.assertEqual((by["9002"]["state"], by["9002"]["other_charges"], by["9002"]["difference"]), ("matched", -30.0, 0.0))
        self.assertEqual([g["group"] for g in by["9002"]["breakdown"]], ["orderItem", "serviceItem"])
        self.assertEqual(by["9003"]["state"], "in_progress")

        # Orders: paid, coming, on the way, cancelled — and delivered long ago but neither paid nor coming.
        FlipkartOrder.objects.filter(order_item_id="OI60").update(order_date=TODAY - timedelta(days=40),
                                                                  delivery_date=TODAY - timedelta(days=30))
        FlipkartOrder.objects.exclude(order_item_id="OI60").update(order_date=TODAY - timedelta(days=5))
        d = self.c.get(f"{self.base}reconcile/", {"business": self.biz.id}).data
        self.assertEqual({k: v["count"] for k, v in d["orders"].items()},
                         {"paid": 3, "coming": 1, "on_the_way": 1, "delivered_unpaid": 1, "returned": 0, "cancelled": 1})
        self.assertEqual(d["orders"]["paid"]["amount"], 450.0)
        self.assertEqual([(o["order_item_id"], o["days"]) for o in d["unpaid"]], [("OI60", 30)])
        self.assertEqual((d["totals"]["upcoming"], d["totals"]["transferred"], d["totals"]["in_progress"]), (80.5, 420.0, 99.0))
        self.assertEqual(d["upcoming_by_date"], [{"date": TODAY + timedelta(days=4), "amount": 80.5}])
        self.assertTrue(d["sync"]["ok"])

    def test_reconcile_only_for_a_business_this_person_can_see(self):
        stranger = Business.objects.create(name="Someone else")
        r = self.c.get(f"{self.base}reconcile/", {"business": stranger.id})
        # A super admin sees every business; a member only theirs.
        self.assertEqual(r.status_code, 200)
        u = User.objects.create_user(username="m", password="pw", role=User.ROLE_BUSINESS_USER)
        Membership.objects.create(user=u, business=self.biz)
        c = APIClient()
        c.force_authenticate(u)
        self.assertEqual(c.get(f"{self.base}reconcile/", {"business": stranger.id}).status_code, 403)
        self.assertEqual(c.get(f"{self.base}reconcile/").data["business"], self.biz.id)
