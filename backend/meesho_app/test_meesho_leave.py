"""Leave: putting a business on leave, changing and ending it. The sync worker is faked."""

from datetime import timedelta
from unittest import mock

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from . import meesho_sync
from .models import MeeshoAccount, MeeshoLeave, MeeshoLeaveItem


class LeaveTests(TestCase):
    def setUp(self):
        self.biz = Business.objects.create(name="Cosmify")
        self.admin = User.objects.create_user(username="a", password="pw", role=User.ROLE_SUPER_ADMIN)
        self.worker = User.objects.create_user(username="w", password="pw", role=User.ROLE_BUSINESS_USER)
        for u in (self.admin, self.worker):
            Membership.objects.create(user=u, business=self.biz)
        self.acct = MeeshoAccount.objects.create(business=self.biz, phone_number="9000000001", password_enc="v1:x", status="ACTIVE",
                                                 supplier_id="3564327", supplier_identifier="lffy4")
        self.queued = []
        p = mock.patch.object(meesho_sync, "enqueue", side_effect=lambda job, args, queue="critical", retry=2:
                              self.queued.append((job, args)) or "jid")
        p.start()
        self.addCleanup(p.stop)
        self.base = f"/api/business/{self.biz.id}/meesho-leave/"

    def api(self, user=None):
        c = APIClient()
        c.force_authenticate(user or self.admin)
        return c

    def test_on_leave_now_starts_at_once_and_a_later_one_waits_for_its_time(self):
        r = self.api().post(self.base, {"businesses": [self.biz.id], "ends_at": (timezone.now() + timedelta(days=3)).isoformat(),
                                        "note": "Diwali"}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        l = MeeshoLeave.objects.get()
        self.assertEqual((l.status, l.note, l.created_by), (MeeshoLeave.PAUSING, "Diwali", self.admin))
        self.assertEqual(self.queued, [("MeeshoLeaveJob", [self.acct.pk, l.pk, "start"])])
        # One open leave a business.
        again = self.api().post(self.base, {"businesses": [self.biz.id]}, format="json")
        self.assertEqual(again.status_code, 409)
        l.status = MeeshoLeave.ENDED
        l.save()
        self.queued.clear()
        later = self.api().post(self.base, {"businesses": [self.biz.id], "starts_at": (timezone.now() + timedelta(days=1)).isoformat()},
                                format="json")
        self.assertEqual(later.status_code, 201, later.data)
        self.assertEqual(later.data["leaves"][0]["status"], MeeshoLeave.SCHEDULED)
        self.assertEqual(self.queued, [])                                    # the worker's minute tick starts it

    def test_it_must_end_after_it_starts_and_only_an_admin_sets_it(self):
        r = self.api().post(self.base, {"businesses": [self.biz.id], "ends_at": (timezone.now() - timedelta(hours=1)).isoformat()}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.api(self.worker).post(self.base, {"businesses": [self.biz.id]}, format="json").status_code, 403)
        self.acct.status = "FAILED"
        self.acct.save()
        self.assertEqual(self.api().post(self.base, {"businesses": [self.biz.id]}, format="json").status_code, 400)
        self.assertFalse(MeeshoLeave.objects.exists())

    def leave(self, status, **kw):
        return MeeshoLeave.objects.create(account=self.acct, status=status, starts_at=timezone.now() - timedelta(hours=2), **kw)

    def test_ending_by_hand_brings_it_back_and_a_scheduled_one_is_just_cancelled(self):
        l = self.leave(MeeshoLeave.ON_LEAVE)
        r = self.api().post(f"{self.base}{l.pk}/end/", {}, format="json")
        self.assertEqual(r.status_code, 202, r.data)
        l.refresh_from_db()
        self.assertEqual((l.status, l.ended_how, l.ended_by), (MeeshoLeave.RESUMING, "manual", self.admin))
        self.assertEqual(self.queued, [("MeeshoLeaveJob", [self.acct.pk, l.pk, "end"])])
        self.assertEqual(self.api().post(f"{self.base}{l.pk}/end/", {}, format="json").status_code, 409)   # bringing back now
        l.status = MeeshoLeave.ENDED
        l.save()
        s = self.leave(MeeshoLeave.SCHEDULED)
        s.starts_at = timezone.now() + timedelta(days=1)
        s.save()
        self.queued.clear()
        r = self.api().post(f"{self.base}{s.pk}/end/", {}, format="json")
        self.assertEqual(r.data["status"], MeeshoLeave.CANCELLED)
        self.assertEqual(self.queued, [])

    def test_retry_brings_back_what_an_end_left_paused(self):
        l = self.leave(MeeshoLeave.ENDED)
        MeeshoLeaveItem.objects.create(leave=l, catalog_id=1, product_id=1, variation_id=1, state=MeeshoLeaveItem.RESUMED)
        self.assertEqual(self.api().post(f"{self.base}{l.pk}/end/", {}, format="json").status_code, 409)   # nothing left
        MeeshoLeaveItem.objects.create(leave=l, catalog_id=1, product_id=2, variation_id=1, state=MeeshoLeaveItem.RESUME_FAILED)
        r = self.api().post(f"{self.base}{l.pk}/end/", {}, format="json")
        self.assertEqual(r.status_code, 202, r.data)
        self.assertEqual(self.queued[-1], ("MeeshoLeaveJob", [self.acct.pk, l.pk, "end"]))

    def test_the_page_shows_each_business_its_leave_and_its_skus(self):
        l = self.leave(MeeshoLeave.ON_LEAVE, ends_at=timezone.now() + timedelta(days=1), repaused=2)
        for pid, st in ((1, "PAUSED"), (2, "PAUSED"), (3, "PAUSE_FAILED")):
            MeeshoLeaveItem.objects.create(leave=l, catalog_id=10 + pid // 3, product_id=pid, variation_id=1, state=st, previous_inventory=5)
        d = self.api(self.worker).get(self.base).data                       # anyone who sees the page sees it
        b = d["businesses"][0]
        self.assertEqual((b["leave"]["status"], b["leave"]["skus"], b["leave"]["catalogs"], b["leave"]["repaused"]), ("ON_LEAVE", 3, 2, 2))
        self.assertEqual(b["leave"]["counts"], {"PAUSED": 2, "PAUSE_FAILED": 1})
        items = self.api(self.worker).get(f"{self.base}{l.pk}/items/").data["items"]
        self.assertEqual([(x["product_id"], x["stock"]) for x in items], [(1, 5), (2, 5), (3, 5)])
        # Changing the end: an admin; not to the past.
        r = self.api().patch(f"{self.base}{l.pk}/", {"ends_at": (timezone.now() + timedelta(days=5)).isoformat()}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(self.api().patch(f"{self.base}{l.pk}/", {"ends_at": (timezone.now() - timedelta(days=1)).isoformat()},
                                          format="json").status_code, 400)
        self.assertEqual(self.api().patch(f"{self.base}{l.pk}/", {"ends_at": ""}, format="json").data["ends_at"], None)   # until ended by hand
