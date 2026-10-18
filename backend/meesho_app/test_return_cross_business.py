"""Claim work on a return owned by another of the user's businesses.

One desk receives parcels for several businesses; the scan lookup already finds
a sibling business's parcel. Opening it and saving claim work (claim required,
packet id, claim details) must work too — but only in businesses the user is
assigned to and may use Returns in.
"""

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Business, BusinessProfile, Membership, User

from .models import ReturnDelivery


class CrossBusinessReturnTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="desk", password="pw", role=User.ROLE_BUSINESS_USER)
        self.a = Business.objects.create(name="Rudam")
        self.b = Business.objects.create(name="Cosmify")
        for biz in (self.a, self.b):
            Membership.objects.create(user=self.user, business=biz)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.ret = ReturnDelivery.objects.create(business=self.b, suborder_no="SB1", awb_number="AWB-B1",
                                                 sku="lota", qty=1, return_reason="Damaged")
        self.url = f"/api/business/{self.a.id}/returns/{self.ret.id}/"   # selected business is A

    def test_scan_finds_it_and_claim_work_saves_on_its_own_business(self):
        found = self.client.get(f"/api/business/{self.a.id}/returns/lookup/", {"q": "AWB-B1"}).data
        self.assertEqual((found["business_name"], found["cross_business"]), ("Cosmify", True))

        r = self.client.patch(self.url, {"claim_status": "REQUIRED"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        r = self.client.patch(self.url, {"packet_id": "PKT-777", "claim_notes": "Broken neck",
                                         "claim_reference": "TCK1"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["business_name"], "Cosmify")
        self.ret.refresh_from_db()
        self.assertEqual((self.ret.claim_status, self.ret.packet_id, self.ret.claim_notes, self.ret.business_id),
                         ("REQUIRED", "PKT-777", "Broken neck", self.b.id))
        self.assertEqual(self.client.get(self.url).status_code, 200)

    def test_not_assigned_to_that_business(self):
        Membership.objects.filter(user=self.user, business=self.b).delete()
        r = self.client.patch(self.url, {"claim_status": "REQUIRED"}, format="json")
        self.assertEqual(r.status_code, 404)
        self.ret.refresh_from_db()
        self.assertEqual(self.ret.claim_status, "UNREVIEWED")

    def test_returns_hidden_for_that_business(self):
        BusinessProfile.objects.update_or_create(business=self.b, defaults={"visible_paths": ["/orders"]})
        r = self.client.patch(self.url, {"packet_id": "X"}, format="json")
        self.assertEqual(r.status_code, 404)
        self.ret.refresh_from_db()
        self.assertEqual(self.ret.packet_id, "")
