"""The global Settled-only switch (X-Settlement-Mode header).

Meesho's export has no genuine bank-settlement-confirmation field — unlike
Flipkart's neft_id — so transaction_id is the proxy chosen for "settled",
despite it only being consistently populated by some upload sources. The
switch only ever narrows the data: off (default) is every payment row,
unfiltered; on restricts to rows with a transaction_id. These tests pin down
the one shared rule (_apply_settlement_filter) rather than re-testing every
endpoint that calls it.
"""

from decimal import Decimal as D

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from .models import FinalPrice, Order, OrderPayment, ParentItemPrice


class SettlementModeTestCase(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="o", password="pw", role=User.ROLE_SUPER_ADMIN)
        self.business = Business.objects.create(name="B")
        Membership.objects.create(user=self.user, business=self.business)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.base = f"/api/business/{self.business.id}"

        parent = ParentItemPrice.objects.create(
            business=self.business, item_id="DIYA", item_price=D("40"), tax_percent=5,
            packaging_cost=D("2"), final_price=D("44.00"),
        )
        FinalPrice.objects.create(business=self.business, sku_id="DIYA-1", parent=parent,
                                  item_price=D("40"), tax_percent=5, packaging_cost=D("2"), final_price=D("44.00"))

        Order.objects.create(business=self.business, sub_order_no="O-SETTLED", sku="DIYA-1", order_date="2026-01-05")
        Order.objects.create(business=self.business, sub_order_no="O-PENDING", sku="DIYA-1", order_date="2026-01-06")

        # One order with a transaction_id (settled), one without.
        OrderPayment.objects.create(
            business=self.business, sub_order_no="O-SETTLED", live_order_status="Delivered",
            transaction_id="AXISCN123", final_settlement_amount=D("44.00"),
            order_date="2026-01-05", payment_date="2026-01-10",
        )
        OrderPayment.objects.create(
            business=self.business, sub_order_no="O-PENDING", live_order_status="Delivered",
            transaction_id="", final_settlement_amount=D("44.00"),
            order_date="2026-01-06", payment_date="2026-01-11",
        )

    def get(self, path, mode=None):
        headers = {"HTTP_X_SETTLEMENT_MODE": mode} if mode else {}
        return self.client.get(f"{self.base}{path}", **headers)

    def test_default_is_everything_unfiltered(self):
        r = self.get("/profit/")
        self.assertEqual(r.data["order_count"], 2)

    def test_settled_restricts_to_transaction_id_rows(self):
        r = self.get("/profit/", mode="settled")
        self.assertEqual(r.data["order_count"], 1)

    def test_explicit_all_same_as_default(self):
        default = self.get("/profit/").data["order_count"]
        explicit = self.get("/profit/", mode="all").data["order_count"]
        self.assertEqual(default, explicit)

    def test_garbage_header_value_falls_back_to_all(self):
        r = self.get("/profit/", mode="literally anything else")
        self.assertEqual(r.data["order_count"], 2)

    def test_orders_grouped_respects_the_switch(self):
        all_mode = self.get("/orders/grouped/?page_size=1").data["kpi"]["total_groups"]
        settled = self.get("/orders/grouped/?page_size=1", mode="settled").data["kpi"]["total_groups"]
        self.assertEqual(all_mode, 2)
        self.assertEqual(settled, 1)

    def test_dashboard_match_rate_respects_the_switch(self):
        all_mode = self.get("/dashboard/").data["join_stats"]
        settled = self.get("/dashboard/", mode="settled").data["join_stats"]
        self.assertEqual(all_mode["matched_count"], 2)
        self.assertEqual(settled["matched_count"], 1)

    def test_sku_order_payments_detail_matches_profit_summary(self):
        # The SKU-detail drill-down must sum to the same thing /profit/ shows
        # for that SKU, in both modes — this is the whole point of sharing
        # _profit_payments_qs.
        for mode in (None, "settled"):
            summary_count = self.get("/profit/", mode=mode).data["order_count"]
            detail = self.get("/profit/sku-orders/?sku=DIYA-1", mode=mode).data
            self.assertEqual(detail["count"], summary_count, f"mismatch in mode={mode}")
