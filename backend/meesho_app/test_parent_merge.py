"""SKU Pricing → merge two parents of one product: every SKU, and all else, ends up under the one kept."""

from datetime import date
from decimal import Decimal as D

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.access import set_user_rule
from accounts.models import Business, Membership, PricingGroup, User

from . import parent_merge
from .models import (FinalPrice, InventoryAdjustment, InventoryLog, ListingHubLink, ListingHubPause, ListingImage,
                     ListingPrice, MasterItem, MasterItemComponent, PackedStockEvent, ParentItemPrice, ParentPriceHistory,
                     Product, PurchaseBill, PurchaseItem, ReturnGuardAlert, SkuPause, WorkerTask)


class ParentMergeTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(username="a", password="pw", role=User.ROLE_SUPER_ADMIN)
        self.biz = Business.objects.create(name="Rudam")
        Membership.objects.create(user=self.admin, business=self.biz)
        self.c = APIClient()
        self.c.force_authenticate(self.admin)
        self.url = f"/api/business/{self.biz.id}/parent-merge/"
        self.keep = self.parent("KADAI", "100", "120")
        self.old = self.parent("kadai-big", "90", "110")
        for sku in ("kadai-1", "kadai-2"):
            self.sku(sku, self.keep)
        for sku in ("kadai-big-1", "kadai-big-2", "kadai-big-3"):
            self.sku(sku, self.old)

    def parent(self, item_id, item_price, final_price, biz=None):
        return ParentItemPrice.objects.create(business=biz or self.biz, item_id=item_id, item_price=D(item_price),
                                              final_price=D(final_price), tax_percent=5, packaging_cost=D("2"))

    def sku(self, sku_id, parent, biz=None):
        return FinalPrice.objects.create(business=biz or self.biz, sku_id=sku_id, parent=parent, item_price=parent.item_price,
                                         final_price=parent.final_price, tax_percent=parent.tax_percent,
                                         packaging_cost=parent.packaging_cost)

    def merge(self, source="kadai-big", target="KADAI", client=None):
        return (client or self.c).post(self.url, {"source": source, "target": target}, format="json")

    # ── SKUs ──────────────────────────────────────────────────────────────
    def test_every_sku_moves_to_the_kept_parent_at_its_price_and_the_other_is_removed(self):
        r = self.merge()
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["businesses"][0]["skus"], 3)
        self.assertFalse(ParentItemPrice.objects.filter(item_id="kadai-big").exists())
        kids = FinalPrice.objects.filter(parent=self.keep).order_by("sku_id")
        self.assertEqual([k.sku_id for k in kids], ["kadai-1", "kadai-2", "kadai-big-1", "kadai-big-2", "kadai-big-3"])
        self.assertEqual({(k.item_price, k.final_price) for k in kids}, {(D("100"), D("120"))})   # the kept parent's price
        self.assertEqual(FinalPrice.objects.count(), 5)                                              # none lost, none made
        self.assertFalse(FinalPrice.objects.filter(parent__isnull=True).exists())

    def test_the_preview_says_what_will_happen_and_changes_nothing(self):
        d = self.c.get(self.url, {"source": "kadai-big", "target": "KADAI"}).data
        self.assertEqual(d["source"]["skus"], ["kadai-big-1", "kadai-big-2", "kadai-big-3"])
        self.assertEqual((d["target"]["item_id"], d["target"]["skus"], d["blocked"]), ("KADAI", 2, None))
        self.assertEqual(d["price_changes"], ["kadai-big-1", "kadai-big-2", "kadai-big-3"])
        self.assertTrue(ParentItemPrice.objects.filter(item_id="kadai-big").exists())
        self.assertEqual(FinalPrice.objects.filter(parent=self.old).count(), 3)

    # ── Everything else that pointed at the merged parent ────────────────
    def test_stock_tasks_listings_alerts_and_logs_move_too(self):
        bill = PurchaseBill.objects.create(business=self.biz, date=date(2026, 10, 1), seller_name="X")
        PurchaseItem.objects.create(business=self.biz, bill=bill, parent_sku=self.old, quantity=40, price_per_unit=D("90"))
        PurchaseItem.objects.create(business=self.biz, bill=bill, parent_sku=self.keep, quantity=10, price_per_unit=D("100"))
        InventoryAdjustment.objects.create(business=self.biz, parent_sku=self.old, quantity=-3, date=date(2026, 10, 2))
        PackedStockEvent.objects.create(business=self.biz, parent_sku=self.old, quantity=5)
        WorkerTask.objects.create(business=self.biz, task_type="LISTING", parent_sku=self.old)
        ListingImage.objects.create(business=self.biz, image_no=1, sha256="x", key="k", content_type="image/jpeg", parent=self.old)
        ListingHubLink.objects.create(business=self.biz, kind="sheet", object_id=7, parent=self.old)
        ReturnGuardAlert.objects.create(business=self.biz, parent=self.old, parent_item_id="kadai-big", kind="manual", message="m")
        InventoryLog.objects.create(business=self.biz, entity_type="PURCHASE", action="CREATE", parent_sku_id="kadai-big", description="d")
        self.assertEqual(self.merge().status_code, 200)
        self.assertEqual(sum(PurchaseItem.objects.filter(parent_sku=self.keep).values_list("quantity", flat=True)), 50)   # stock adds up
        self.assertEqual(InventoryAdjustment.objects.get().parent_sku, self.keep)
        self.assertEqual(PackedStockEvent.objects.get().parent_sku, self.keep)
        self.assertEqual(WorkerTask.objects.get().parent_sku, self.keep)
        self.assertEqual(ListingImage.objects.get().parent, self.keep)
        self.assertEqual(ListingHubLink.objects.get().parent, self.keep)
        a = ReturnGuardAlert.objects.get()
        self.assertEqual((a.parent, a.parent_item_id), (self.keep, "KADAI"))
        self.assertFalse(InventoryLog.objects.filter(parent_sku_id="kadai-big").exists())
        self.assertTrue(InventoryLog.objects.filter(parent_sku_id="KADAI", description__contains="merged into KADAI").exists())

    def test_price_history_and_bill_of_materials_the_kept_parents_win(self):
        ParentPriceHistory.objects.create(business=self.biz, parent=self.keep, effective_from=date(2026, 1, 1), item_price=D("100"), final_price=D("120"))
        ParentPriceHistory.objects.create(business=self.biz, parent=self.old, effective_from=date(2026, 2, 1), item_price=D("90"), final_price=D("110"))
        steel = MasterItem.objects.create(business=self.biz, name="steel")
        MasterItemComponent.objects.create(parent=self.old, master_item=steel)
        self.assertEqual(self.merge().status_code, 200)
        self.assertEqual(list(ParentPriceHistory.objects.values_list("parent_id", "effective_from")), [(self.keep.pk, date(2026, 1, 1))])
        # The kept parent had no bill of materials: the merged one's moves over.
        self.assertEqual(list(MasterItemComponent.objects.values_list("parent_id", flat=True)), [self.keep.pk])

    def test_history_moves_when_the_kept_parent_has_none(self):
        ParentPriceHistory.objects.create(business=self.biz, parent=self.old, effective_from=date(2026, 2, 1), item_price=D("90"), final_price=D("110"))
        self.merge()
        self.assertEqual(ParentPriceHistory.objects.get().parent, self.keep)

    def test_listing_prices_pause_photo_and_product_page(self):
        ListingPrice.objects.create(business=self.biz, parent=self.keep, platform="meesho", price=D("199"))
        ListingPrice.objects.create(business=self.biz, parent=self.old, platform="meesho", price=D("189"))
        ListingPrice.objects.create(business=self.biz, parent=self.old, platform="flipkart", price=D("249"))
        ListingHubPause.objects.create(business=self.biz, parent=self.old)
        Product.objects.create(business=self.biz, name="Kadai", parent_sku=self.old)
        ParentItemPrice.objects.filter(pk=self.old.pk).update(image_url="https://x/kadai.jpg")
        self.assertEqual(self.merge().status_code, 200)
        self.assertEqual(sorted(ListingPrice.objects.filter(parent=self.keep).values_list("platform", "price")),
                         [("flipkart", D("249")), ("meesho", D("199"))])          # the kept parent's Meesho price wins
        self.assertEqual(ListingHubPause.objects.get().parent, self.keep)           # paused before: still paused
        self.assertEqual(Product.objects.get().parent_sku, self.keep)
        self.keep.refresh_from_db()
        self.assertEqual(self.keep.image_url, "https://x/kadai.jpg")

    def test_sku_pauses_stay_with_their_skus(self):
        fp = FinalPrice.objects.get(sku_id="kadai-big-2")
        SkuPause.objects.create(business=self.biz, sku=fp)
        self.merge()
        self.assertEqual(SkuPause.objects.get().sku.parent, self.keep)

    # ── Refusals ─────────────────────────────────────────────────────────
    def test_both_with_a_product_page_is_refused_and_nothing_changes(self):
        Product.objects.create(business=self.biz, name="A", parent_sku=self.old)
        Product.objects.create(business=self.biz, name="B", parent_sku=self.keep)
        self.assertIsNotNone(self.c.get(self.url, {"source": "kadai-big", "target": "KADAI"}).data["blocked"])
        r = self.merge()
        self.assertEqual(r.status_code, 409)
        self.assertIn("product page", r.data["error"])
        self.assertEqual(FinalPrice.objects.filter(parent=self.old).count(), 3)

    def test_same_parent_unknown_parent_or_missing_input(self):
        self.assertEqual(self.merge("KADAI", "KADAI").status_code, 400)
        self.assertEqual(self.merge("nope", "KADAI").status_code, 404)
        self.assertEqual(self.c.post(self.url, {"source": "kadai-big"}, format="json").status_code, 400)

    def test_another_businesss_parent_cant_be_merged(self):
        other = Business.objects.create(name="Elsewhere")
        self.parent("STRANGER", "1", "1", biz=other)
        self.assertEqual(self.merge("STRANGER", "KADAI").status_code, 404)
        self.assertTrue(ParentItemPrice.objects.filter(item_id="STRANGER").exists())

    def test_a_relation_merging_doesnt_know_stops_it_cold(self):
        original = parent_merge.HANDLED
        parent_merge.HANDLED = {h for h in original if h[0] is not WorkerTask}
        try:
            r = self.merge()
        finally:
            parent_merge.HANDLED = original
        self.assertEqual(r.status_code, 409)
        self.assertIn("WorkerTask", r.data["error"])
        self.assertTrue(ParentItemPrice.objects.filter(item_id="kadai-big").exists())

    def test_a_failure_half_way_changes_nothing(self):
        # Fails after the SKUs and alerts have moved (writing the log): all of it is rolled back.
        ReturnGuardAlert.objects.create(business=self.biz, parent=self.old, parent_item_id="kadai-big", kind="manual", message="m")
        from unittest import mock
        with mock.patch.object(parent_merge.InventoryLog.objects, "create", side_effect=RuntimeError("boom")):
            with self.assertRaises(RuntimeError):
                parent_merge.merge(self.biz, "kadai-big", "KADAI")
        self.assertEqual(FinalPrice.objects.filter(parent=self.old).count(), 3)
        self.assertEqual(FinalPrice.objects.get(sku_id="kadai-big-1").final_price, D("110"))
        self.assertEqual(ReturnGuardAlert.objects.get().parent, self.old)
        self.assertTrue(ParentItemPrice.objects.filter(item_id="kadai-big").exists())

    def test_only_sku_pricing_can_merge(self):
        member = User.objects.create_user(username="m", password="pw", role=User.ROLE_BUSINESS_USER)
        Membership.objects.create(user=member, business=self.biz)
        set_user_rule(member, ["/sku-analysis", "/labels"])
        c = APIClient(); c.force_authenticate(member)
        self.assertEqual(self.merge(client=c).status_code, 403)
        self.assertTrue(ParentItemPrice.objects.filter(item_id="kadai-big").exists())
        set_user_rule(member, ["/pricing"])
        self.assertEqual(self.merge(client=c).status_code, 200)

    # ── Businesses sharing pricing ───────────────────────────────────────
    def test_merged_in_every_business_sharing_pricing_and_none_left_without_a_parent(self):
        group = PricingGroup.objects.create(name="shared")
        sib = Business.objects.create(name="Cosmify", pricing_group=group)
        Business.objects.filter(pk=self.biz.pk).update(pricing_group=group)
        self.biz.refresh_from_db()
        ParentItemPrice.objects.filter(business=sib).delete()          # start the sibling clean, as it was before linking
        FinalPrice.objects.filter(business=sib).delete()
        from . import pricing_sync
        with pricing_sync._SyncGuard():
            s_keep, s_old = self.parent("KADAI", "100", "120", biz=sib), self.parent("kadai-big", "90", "110", biz=sib)
            self.sku("kadai-big-1", s_old, biz=sib)
            self.sku("kadai-1", s_keep, biz=sib)
        r = self.merge()
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual([b["business"] for b in r.data["businesses"]], ["Rudam", "Cosmify"])
        for biz in (self.biz, sib):
            self.assertFalse(ParentItemPrice.objects.filter(business=biz, item_id="kadai-big").exists())
            self.assertFalse(FinalPrice.objects.filter(business=biz, parent__isnull=True).exists(), biz.name)
        self.assertEqual(sorted(FinalPrice.objects.filter(business=sib).values_list("sku_id", "parent__item_id")),
                         [("kadai-1", "KADAI"), ("kadai-big-1", "KADAI")])

    def test_a_sibling_with_only_the_merged_parent_gets_it_renamed(self):
        group = PricingGroup.objects.create(name="shared")
        sib = Business.objects.create(name="Cosmify", pricing_group=group)
        Business.objects.filter(pk=self.biz.pk).update(pricing_group=group)
        self.biz.refresh_from_db()
        from . import pricing_sync
        ParentItemPrice.objects.filter(business=sib).delete()
        with pricing_sync._SyncGuard():
            s_old = self.parent("kadai-big", "90", "110", biz=sib)
            self.sku("kadai-big-9", s_old, biz=sib)
        self.assertEqual(self.c.get(self.url, {"source": "kadai-big", "target": "KADAI"}).data["also_in"],
                         [{"business": "Cosmify", "renamed": True}])
        self.assertEqual(self.merge().status_code, 200)
        self.assertEqual(FinalPrice.objects.get(business=sib).parent.item_id, "KADAI")
