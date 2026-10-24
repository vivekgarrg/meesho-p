"""Order Scan combines every business a person is assigned to; an admin can
choose which, and that choice is saved to their account."""

from datetime import timedelta

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Business, BusinessProfile, Membership, User

from .models import LabelOrder, OrderScanSetting, ScannedOrder
from .views import _current_business_date


class DeskTestCase(TestCase):
    def setUp(self):
        self.a = Business.objects.create(name="Rudam")
        self.b = Business.objects.create(name="Cosmify")
        self.c = Business.objects.create(name="Elsewhere")      # nobody below is assigned
        self.admin = User.objects.create_user(username="admin", password="pw", role=User.ROLE_SUPER_ADMIN)
        self.worker = User.objects.create_user(username="desk", password="pw", role=User.ROLE_BUSINESS_USER)
        for u in (self.admin, self.worker):
            for biz in (self.a, self.b):
                Membership.objects.create(user=u, business=biz)
        self.today = _current_business_date()
        for biz, courier, n in ((self.a, "Valmo", 3), (self.b, "Valmo", 2), (self.b, "Delhivery", 1), (self.c, "Valmo", 4)):
            for i in range(n):
                LabelOrder.objects.create(order_id=f"{biz.name[:2]}{courier[:2]}{i}_1", awb_number=f"{biz.name[:2]}{courier[:2]}AWB{i}",
                                          courier_name=courier, sku="SKU", qty=1, uploaded_date=self.today, business=biz)

    def client_for(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c

    def base(self, biz=None):
        return f"/api/business/{(biz or self.a).id}/order-scan"

    def queue(self, client, biz=None):
        return client.get(self.base(biz) + "/queue/", {"date": self.today.isoformat()}).data


class MergeTests(DeskTestCase):
    def test_assigned_businesses_are_combined_by_default(self):
        w = self.client_for(self.worker)
        w.post(self.base() + "/", {"code": "CoVaAWB0", "status": "PACKED"}, format="json")   # a Cosmify parcel
        q = self.queue(w)
        self.assertEqual(q["summary"]["assigned"], 6)                 # 3 Rudam + 3 Cosmify, not Elsewhere
        self.assertEqual({b["name"] for b in q["businesses"]}, {"Rudam", "Cosmify"})
        tiles = {c["courier"]: (c["assigned"], c["scanned"]) for c in q["summary"]["by_courier"]}
        self.assertEqual(tiles, {"Valmo": (5, 1), "Delhivery": (1, 0)})
        self.assertEqual({i["business_name"] for i in q["items"]}, {"Rudam", "Cosmify"})
        rec = w.get(self.base() + "/").data
        self.assertEqual(rec["total"], 1)
        self.assertEqual(rec["stats"]["total"], 1)

    def test_a_business_without_order_scan_access_is_left_out(self):
        BusinessProfile.objects.update_or_create(business=self.b, defaults={"visible_paths": ["/orders"]})
        q = self.queue(self.client_for(self.worker))
        self.assertEqual(q["summary"]["assigned"], 3)

    def test_a_combined_row_can_be_updated_from_either_business(self):
        w = self.client_for(self.worker)
        row = w.post(self.base() + "/", {"code": "CoVaAWB1"}, format="json").data["row"]
        self.assertEqual(ScannedOrder.objects.get(pk=row["id"]).business_id, self.b.id)
        r = w.patch(self.base() + f"/{row['id']}/", {"status": "DISPATCHED"}, format="json")
        self.assertEqual(r.status_code, 200)
        r = w.post(self.base() + "/bulk-status/", {"ids": [row["id"]], "status": "ON_HOLD"}, format="json")
        self.assertEqual(r.data["updated"], 1)

    def test_alerts_cover_the_desk_only_when_asked(self):
        yesterday = self.today - timedelta(days=1)
        LabelOrder.objects.create(order_id="OLD_A", awb_number="OA", courier_name="Valmo", uploaded_date=yesterday, business=self.a)
        LabelOrder.objects.create(order_id="OLD_B", awb_number="OB", courier_name="Valmo", uploaded_date=yesterday, business=self.b)
        w = self.client_for(self.worker)
        self.assertEqual(w.get(self.base() + "/alerts/").data["not_packed"]["count"], 1)
        self.assertEqual(w.get(self.base() + "/alerts/", {"scope": "desk"}).data["not_packed"]["count"], 2)


class SettingTests(DeskTestCase):
    def test_admin_choice_is_saved_and_applied(self):
        a = self.client_for(self.admin)
        s = a.get(self.base() + "/settings/").data
        self.assertTrue(s["is_admin"])
        self.assertTrue(s["all"])
        self.assertIn(self.c.id, [b["id"] for b in s["available"]])      # super admin can reach every business
        r = a.put(self.base() + "/settings/", {"business_ids": [self.a.id, self.c.id]}, format="json")
        self.assertEqual(sorted(r.data["selected"]), sorted([self.a.id, self.c.id]))
        self.assertEqual(self.queue(a)["summary"]["assigned"], 7)       # Rudam 3 + Elsewhere 4
        # Saved to the account: a fresh session (another device) sees the same.
        self.assertEqual(self.queue(self.client_for(self.admin))["summary"]["assigned"], 7)
        self.assertEqual(sorted(OrderScanSetting.objects.get(user=self.admin).business_ids), sorted([self.a.id, self.c.id]))

    def test_ticking_everything_means_all(self):
        a = self.client_for(self.admin)
        every = [b["id"] for b in a.get(self.base() + "/settings/").data["available"]]
        r = a.put(self.base() + "/settings/", {"business_ids": every}, format="json")
        self.assertTrue(r.data["all"])

    def test_only_admins_choose_and_only_within_access(self):
        w = self.client_for(self.worker)
        self.assertFalse(w.get(self.base() + "/settings/").data["is_admin"])
        self.assertEqual(w.put(self.base() + "/settings/", {"business_ids": [self.a.id]}, format="json").status_code, 403)
        a = self.client_for(self.admin)
        self.assertEqual(a.put(self.base() + "/settings/", {"business_ids": [99999]}, format="json").status_code, 400)
        self.assertEqual(a.put(self.base() + "/settings/", {"business_ids": "x"}, format="json").status_code, 400)
