"""Returns desk: each return shows its product photo, and the packet id stored
for a claim finds the return again and is flagged if it's been used twice."""

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from .models import FinalPrice, ListingImage, ParentItemPrice, ReturnDelivery


class ReturnScanTests(TestCase):
    def setUp(self):
        user = User.objects.create_user(username="o", password="pw", role=User.ROLE_SUPER_ADMIN)
        self.business = Business.objects.create(name="B")
        Membership.objects.create(user=user, business=self.business)
        self.client = APIClient()
        self.client.force_authenticate(user)
        self.base = f"/api/business/{self.business.id}"
        self.parent = ParentItemPrice.objects.create(
            business=self.business, item_id="PARENT", item_price=10, tax_percent=0,
            packaging_cost=0, final_price=10, image_url="https://img.example/p.jpg")
        FinalPrice.objects.create(business=self.business, sku_id="Kid-SKU", parent=self.parent,
                                  item_price=10, tax_percent=0, packaging_cost=0, final_price=10)
        self.a = ReturnDelivery.objects.create(business=self.business, suborder_no="S1", awb_number="AWB1",
                                               sku="kid-sku", qty=2, return_reason="Size issue")
        self.b = ReturnDelivery.objects.create(business=self.business, suborder_no="S2", awb_number="AWB2",
                                               sku="other", qty=1)

    def test_list_and_lookup_carry_the_parents_photo(self):
        rows = {r["suborder_no"]: r for r in self.client.get(f"{self.base}/returns/").data["results"]}
        self.assertEqual(rows["S1"]["image_url"], "https://img.example/p.jpg")   # SKU matched case-insensitively
        self.assertIsNone(rows["S2"]["image_url"])
        m = self.client.get(f"{self.base}/returns/lookup/", {"q": "AWB1"}).data["matches"][0]
        self.assertEqual(m["image_url"], "https://img.example/p.jpg")
        self.assertEqual((m["qty"], m["return_reason"]), (2, "Size issue"))

    def test_first_uploaded_photo_is_the_fallback(self):
        self.parent.image_url = None
        self.parent.save()
        ListingImage.objects.create(business=self.business, parent=self.parent, image_no=7, key="k/7.jpg",
                                    status=ListingImage.STATUS_UPLOADED, sha256="a" * 64, bytes=1, content_type="image/jpeg")
        from . import object_storage
        row = self.client.get(f"{self.base}/returns/{self.a.pk}/").data
        self.assertEqual(row["image_url"], object_storage.public_url("k/7.jpg"))

    def test_stored_packet_id_finds_the_return_and_searches(self):
        self.client.patch(f"{self.base}/returns/{self.a.pk}/",
                          {"claim_status": "REQUIRED", "packet_id": "PKT-123"}, format="json")
        lookup = self.client.get(f"{self.base}/returns/lookup/", {"q": "pkt-123"}).data
        self.assertEqual((lookup["matched_by"], lookup["matches"][0]["suborder_no"]), ("packet", "S1"))
        found = self.client.get(f"{self.base}/returns/", {"q": "PKT-12"}).data["results"]
        self.assertEqual([r["suborder_no"] for r in found], ["S1"])

    def test_same_packet_on_two_returns_is_flagged(self):
        url = lambda pk: f"{self.base}/returns/{pk}/"
        first = self.client.patch(url(self.a.pk), {"packet_id": "PKT-9"}, format="json").data
        self.assertEqual(first["packet_duplicate_of"], [])
        second = self.client.patch(url(self.b.pk), {"packet_id": "pkt-9"}, format="json").data
        self.assertEqual(second["packet_duplicate_of"], ["S1"])
