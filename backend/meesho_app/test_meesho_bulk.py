"""Meesho Inventory's whole-account actions: pause the SKUs with no orders; stock to 0 and back. The worker is faked."""

from datetime import timedelta
from unittest import mock

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from . import meesho_sync
from .models import (
    MeeshoAccount, MeeshoCatalog, MeeshoListing, MeeshoStockHold, MeeshoStockHoldItem, MeeshoSyncRun, Order,
)

TODAY = timezone.localdate()


@mock.patch.object(meesho_sync, "_worker_alive", lambda: True)
class Base(TestCase):
    def setUp(self):
        self.biz = Business.objects.create(name="Rudam")
        self.admin = User.objects.create_user(username="a", password="pw", role=User.ROLE_SUPER_ADMIN)
        self.worker = User.objects.create_user(username="w", password="pw", role=User.ROLE_BUSINESS_USER)
        for u in (self.admin, self.worker):
            Membership.objects.create(user=u, business=self.biz)
        self.acct = MeeshoAccount.objects.create(business=self.biz, phone_number="9000000001", password_enc="v1:x", status="ACTIVE",
                                                 supplier_id="4313711", supplier_identifier="xzvey", supplier_name="Rudam")
        now = timezone.now()
        self.c1 = MeeshoCatalog.objects.create(account=self.acct, catalog_id=101, name="Thali", in_active=True, seen_at=now)
        self.c2 = MeeshoCatalog.objects.create(account=self.acct, catalog_id=202, name="Thali again", in_active=True, seen_at=now)
        row = lambda c, pid, sku, inv=50, archived=False, variation="", first=None: MeeshoListing.objects.create(
            account=self.acct, catalog=c, product_id=pid, variation_id=167, sku_id=sku, variation=variation, inventory=inv,
            archived=archived, seen_at=now, first_seen_at=first)
        self.sold = row(self.c1, 1, "thali-a")                                   # ordered last week
        self.sold_dup = row(self.c2, 2, "thali-a")                               # the same SKU in a second catalog
        self.idle = row(self.c1, 3, "thali-bFree Size", variation="Free Size")   # last order 40 days ago (Meesho glued the variation on)
        self.never = row(self.c1, 4, "diya")                                     # never ordered
        self.new = row(self.c1, 5, "lota", first=now - timedelta(days=3))        # listed 3 days ago
        self.paused = row(self.c1, 6, "kalash", archived=True)                   # already paused
        self.zero = row(self.c1, 7, "plate", inv=0)
        order = lambda sku, days, cat=101: Order.objects.create(business=self.biz, sub_order_no=f"{sku}-{days}", sku=sku,
                                                                order_date=TODAY - timedelta(days=days), catalog_id=cat, reason_for_credit_entry="DELIVERED")
        order("thali-a", 6)
        order("THALI-B", 40)
        order("plate", 1)                        # the newest order: the data is current
        self.queued = []
        p = mock.patch.object(meesho_sync, "enqueue", side_effect=lambda job, args, queue="critical", retry=2:
                              self.queued.append((job, args, retry)) or "jid")
        p.start()
        self.addCleanup(p.stop)
        self.base = f"/api/business/{self.biz.id}/meesho-live-inventory/"

    def api(self, user=None):
        c = APIClient()
        c.force_authenticate(user or self.admin)
        return c


class IdleTests(Base):
    def preview(self, **q):
        r = self.api().get(f"{self.base}idle/", q)
        self.assertEqual(r.status_code, 200, r.data)
        return r.data["businesses"][0]

    def test_the_live_skus_with_no_orders_in_those_days(self):
        b = self.preview(days=30)
        self.assertEqual(sorted(x["sku"] for x in b["rows"]), ["diya", "thali-b"])
        self.assertEqual((b["kept_new"], b["kept_ordered"], b["stale"]), (1, 3, False))   # lota too new; thali-a ×2 and plate ordered
        row = next(x for x in b["rows"] if x["sku"] == "thali-b")
        self.assertEqual(row["last_order"], TODAY - timedelta(days=40))
        # 60 days: thali-b had an order then.
        self.assertEqual([x["sku"] for x in self.preview(days=60)["rows"]], ["diya"])

    def test_per_catalog_a_dead_duplicate_catalog_counts_as_idle(self):
        self.assertEqual(sorted(x["id"] for x in self.preview(days=30, per_catalog=1)["rows"]),
                         sorted([self.sold_dup.pk, self.idle.pk, self.never.pk]))

    def test_pausing_sends_only_what_is_still_idle_one_request_per_catalog(self):
        r = self.api().post(f"{self.base}idle/pause/", {"days": 30, "listings": [self.idle.pk, self.never.pk]}, format="json")
        self.assertEqual(r.status_code, 202, r.data)
        run = MeeshoSyncRun.objects.get(kind="ARCHIVE")
        self.assertEqual(self.queued, [("MeeshoArchiveJob", [self.acct.pk, run.pk, [
            {"catalog_id": 101, "products": [{"product_id": 3, "variation_id": 167}, {"product_id": 4, "variation_id": 167}]}]], 2)])

    def test_a_sku_that_got_an_order_since_the_list_was_read_isnt_paused(self):
        Order.objects.create(business=self.biz, sub_order_no="d-0", sku="diya", order_date=TODAY, reason_for_credit_entry="PENDING")
        r = self.api().post(f"{self.base}idle/pause/", {"days": 30, "listings": [self.idle.pk, self.never.pk]}, format="json")
        self.assertEqual(r.status_code, 409, r.data)
        self.assertIn("had an order or were paused", r.data["error"])
        self.assertEqual(self.queued, [])

    def test_nothing_ordered_or_new_or_paused_can_be_slipped_in(self):
        for listing in (self.sold, self.new, self.paused):
            r = self.api().post(f"{self.base}idle/pause/", {"days": 30, "listings": [listing.pk]}, format="json")
            self.assertEqual(r.status_code, 409, (listing.sku_id, r.data))
        self.assertEqual(self.queued, [])

    def test_stale_order_data_pauses_nothing(self):
        Order.objects.filter(business=self.biz, sku="plate").delete()       # newest order now 6 days old
        self.assertTrue(self.preview(days=30)["stale"])
        r = self.api().post(f"{self.base}idle/pause/", {"days": 30, "listings": [self.never.pk]}, format="json")
        self.assertEqual(r.status_code, 409)
        self.assertIn("isn't current", r.data["error"])
        self.assertEqual(self.queued, [])

    def test_admins_only(self):
        self.assertEqual(self.api(self.worker).get(f"{self.base}idle/").status_code, 403)
        r = self.api(self.worker).post(f"{self.base}idle/pause/", {"listings": [self.never.pk]}, format="json")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(self.queued, [])


class HoldTests(Base):
    def start(self):
        return self.api().post(f"{self.base}stock-hold/start/", {"businesses": [self.biz.id]}, format="json")

    def test_start_saves_every_live_sku_first_and_queues_the_worker_once_without_retries(self):
        r = self.start()
        self.assertEqual(r.status_code, 202, r.data)
        h = MeeshoStockHold.objects.get()
        self.assertEqual(h.status, "QUEUED")
        # Every live SKU of the last read — the worker reads each fresh before it changes anything. Paused ones aren't in it.
        self.assertEqual(sorted(h.items.values_list("product_id", flat=True)), [1, 2, 3, 4, 5, 7])
        self.assertTrue(all(s == "PLANNED" for s in h.items.values_list("state", flat=True)))
        self.assertEqual(self.queued, [("MeeshoStockHoldJob", [self.acct.pk, h.hold_run_id, h.pk, "hold"], False)])
        self.assertEqual(MeeshoSyncRun.objects.get(pk=h.hold_run_id).kind, "STOCK")

    def test_no_second_hold_on_top_of_an_open_one(self):
        self.start()
        self.queued.clear()
        MeeshoSyncRun.objects.update(status="OK")
        for st in ("QUEUED", "HOLDING", "HELD", "RESTORING"):
            MeeshoStockHold.objects.update(status=st)
            r = self.start()
            self.assertEqual(r.status_code, 409, st)
            self.assertIn("restore it before holding again", r.data["error"])
        self.assertEqual((self.queued, MeeshoStockHold.objects.count()), ([], 1))
        MeeshoStockHold.objects.update(status="RESTORED")
        self.assertEqual(self.start().status_code, 202)

    def test_not_while_a_stock_update_or_pause_runs(self):
        MeeshoSyncRun.objects.create(account=self.acct, kind="ARCHIVE", trigger="MANUAL", status="RUNNING")
        r = self.start()
        self.assertEqual(r.status_code, 409)
        self.assertEqual(MeeshoStockHold.objects.count(), 0)

    def test_the_queue_down_leaves_no_open_hold(self):
        with mock.patch.object(meesho_sync, "enqueue", side_effect=ConnectionError("refused")):
            r = self.start()
        self.assertEqual(r.status_code, 503)
        self.assertEqual(MeeshoStockHold.objects.get().status, "FAILED")       # nothing sent: nothing holds the refill back

    def held(self):
        self.start()
        h = MeeshoStockHold.objects.get()
        MeeshoSyncRun.objects.filter(pk=h.hold_run_id).update(status="OK", finished_at=timezone.now())
        h.status = "HELD"
        h.save()
        h.items.filter(product_id=1).update(state="ZEROED", previous_inventory=4998)
        h.items.filter(product_id=7).update(state="SKIPPED_ZERO", previous_inventory=0)
        self.queued.clear()
        return h

    def test_restore_queues_the_worker_for_what_was_set_to_0(self):
        h = self.held()
        r = self.api().post(f"{self.base}stock-hold/{h.pk}/restore/", format="json")
        self.assertEqual(r.status_code, 202, r.data)
        h.refresh_from_db()
        self.assertEqual(h.status, "RESTORING")
        self.assertEqual(self.queued, [("MeeshoStockHoldJob", [self.acct.pk, h.restore_run_id, h.pk, "restore"], False)])
        # Not twice while the worker is on it.
        r = self.api().post(f"{self.base}stock-hold/{h.pk}/restore/", format="json")
        self.assertEqual(r.status_code, 409)

    def test_not_restored_while_still_being_set_to_0_nor_when_nothing_is_at_0(self):
        self.start()
        h = MeeshoStockHold.objects.get()
        MeeshoStockHold.objects.update(status="HOLDING")
        MeeshoStockHoldItem.objects.filter(hold=h, product_id=1).update(state="ZEROED", previous_inventory=4)
        r = self.api().post(f"{self.base}stock-hold/{h.pk}/restore/", format="json")
        self.assertEqual(r.status_code, 409)                                    # its run is still going
        self.assertIn("still on it", r.data["error"])
        MeeshoSyncRun.objects.filter(pk=h.hold_run_id).update(status="FAILED")    # stopped part-way: its zeros can go back
        self.assertEqual(self.api().post(f"{self.base}stock-hold/{h.pk}/restore/", format="json").status_code, 202)
        MeeshoStockHold.objects.update(status="HELD")
        MeeshoSyncRun.objects.update(status="OK")
        MeeshoStockHoldItem.objects.update(state="RESTORED")
        r = self.api().post(f"{self.base}stock-hold/{h.pk}/restore/", format="json")
        self.assertEqual(r.status_code, 409)

    def test_the_page_shows_each_business_and_its_hold(self):
        h = self.held()
        d = self.api().get(f"{self.base}stock-hold/").data["businesses"][0]
        self.assertEqual((d["live"], d["with_stock"], d["open"]), (6, 5, True))
        self.assertEqual((d["hold"]["id"], d["hold"]["status"], d["hold"]["can_restore"]), (h.pk, "HELD", True))
        self.assertEqual(d["hold"]["counts"]["ZEROED"], 1)

    def test_admins_only(self):
        self.assertEqual(self.api(self.worker).post(f"{self.base}stock-hold/start/", {}, format="json").status_code, 403)
        self.assertEqual(MeeshoStockHold.objects.count(), 0)
