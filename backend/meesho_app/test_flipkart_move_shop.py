"""flipkart_move_shop: a shop's uploaded records move to their business; what the login read stays."""

import json
from datetime import date
from decimal import Decimal as D
from io import StringIO

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase
from django.utils import timezone

from accounts.models import Business

from .models import FlipkartOrder, FlipkartOrderPayment, FlipkartOtherCharge, FlipkartOutstandingPayment, FlipkartPayout


class MoveShopTests(TestCase):
    def setUp(self):
        self.rudam = Business.objects.create(name="Rudam")
        self.cosmify = Business.objects.create(name="Cosmify Mart")
        now = timezone.now()

        def order(item, synced):
            FlipkartOrder.objects.create(business=self.rudam, order_item_id=item, order_id=f"O{item}", order_date=date(2026, 10, 5),
                                         sku="lota", quantity=1, uploaded_at=now, synced_at=now if synced else None)

        def pay(item, utr, source):
            FlipkartOrderPayment.objects.create(business=self.rudam, neft_id=utr, order_item_id=item, order_id=f"O{item}",
                                                seller_sku="lota", quantity=1, sale_amount=D("300"), settlement_value=D("250"),
                                                return_type="NA", item_return_status="NA", source=source)
        # Rudam's own shop: read by its login (synced orders, synced payments, a payout, a charge, outstanding).
        order("R1", True)
        pay("R1", "UTR-R", "seller_hub")
        FlipkartPayout.objects.create(business=self.rudam, advice_id="A1", utr="UTR-R", payment_date=date(2026, 10, 9),
                                      settlement_type="PREPAID", read_at=now)
        FlipkartOtherCharge.objects.create(business=self.rudam, category="ads", neft_id="UTR-R", amount=D("-10"))
        FlipkartOutstandingPayment.objects.create(business=self.rudam, order_item_id="R1", settlement_type="PREPAID", settlement_value=D("5"), read_at=now)
        # Cosmify's shop (named "Rudam" on Flipkart): its reports uploaded here.
        for item in ("C1", "C2"):
            order(item, False)
            pay(item, "UTR-C", "report")
        FlipkartOtherCharge.objects.create(business=self.rudam, category="ads", neft_id="UTR-C", amount=D("-20"))

    def run_(self, *extra):
        out = StringIO()
        call_command("flipkart_move_shop", "--from", str(self.rudam.pk), "--to", str(self.cosmify.pk), *extra, stdout=out)
        return json.loads(out.getvalue())

    def owners(self, model, **f):
        return sorted(model.objects.filter(**f).values_list("business__name", flat=True))

    def test_a_preview_moves_nothing(self):
        out = self.run_()
        self.assertEqual(out["would_move"], {"orders": 2, "payments": 2, "other_charges": 1, "outstanding": 0})
        self.assertEqual(FlipkartOrder.objects.filter(business=self.cosmify).count(), 0)

    def test_apply_moves_the_uploaded_shop_and_leaves_what_the_login_read(self):
        out = self.run_("--apply")
        self.assertEqual(out["moved"]["orders"], 2)
        self.assertEqual(self.owners(FlipkartOrder, order_item_id__in=["C1", "C2"]), ["Cosmify Mart", "Cosmify Mart"])
        self.assertEqual(self.owners(FlipkartOrderPayment, neft_id="UTR-C"), ["Cosmify Mart", "Cosmify Mart"])
        self.assertEqual(self.owners(FlipkartOtherCharge, neft_id="UTR-C"), ["Cosmify Mart"])
        # Rudam keeps its own.
        self.assertEqual(self.owners(FlipkartOrder, order_item_id="R1"), ["Rudam"])
        self.assertEqual(self.owners(FlipkartOrderPayment, neft_id="UTR-R"), ["Rudam"])
        self.assertEqual(self.owners(FlipkartPayout), ["Rudam"])
        self.assertEqual(self.owners(FlipkartOtherCharge, neft_id="UTR-R"), ["Rudam"])
        self.assertEqual(self.owners(FlipkartOutstandingPayment), ["Rudam"])
        # The sync no longer sees Cosmify's payments under another business.
        from .flipkart_sync import elsewhere
        self.assertIsNone(elsewhere(self.cosmify, ["UTR-C"], {"C1", "C2"}))
        self.assertEqual(self.run_()["would_move"]["orders"], 0)          # run again: nothing left to move

    def test_a_name_two_businesses_share_must_be_an_id(self):
        Business.objects.create(name="rudam")
        with self.assertRaises(CommandError):
            call_command("flipkart_move_shop", "--from", "Rudam", "--to", str(self.cosmify.pk), stdout=StringIO())

    def test_refused_when_the_destination_already_has_them(self):
        FlipkartOrder.objects.create(business=self.cosmify, order_item_id="C1", order_id="OC1", sku="lota", quantity=1)
        with self.assertRaises(CommandError):
            self.run_("--apply")
        self.assertEqual(self.owners(FlipkartOrder, order_item_id="C2"), ["Rudam"])
