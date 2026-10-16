"""Loss-recovery buffer: ₹ per unit set on a parent (or an un-parented SKU),
charged as part of the item cost on every unit that actually sells."""

from decimal import Decimal as D

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from .models import FinalPrice, Order, OrderPayment, ParentItemPrice


class LossBufferTests(TestCase):
    def setUp(self):
        user = User.objects.create_user(username="o", password="pw", role=User.ROLE_SUPER_ADMIN)
        self.business = Business.objects.create(name="B")
        Membership.objects.create(user=user, business=self.business)
        self.client = APIClient()
        self.client.force_authenticate(user)
        self.base = f"/api/business/{self.business.id}"
        self.parent = ParentItemPrice.objects.create(
            business=self.business, item_id="PARENT", item_price=D("100"), tax_percent=0,
            packaging_cost=D("0"), final_price=D("100"), buffer_amount=D("10"))
        FinalPrice.objects.create(business=self.business, sku_id="KID", parent=self.parent,
                                  item_price=D("100"), tax_percent=0, packaging_cost=D("0"), final_price=D("100"))
        FinalPrice.objects.create(business=self.business, sku_id="LONER", item_price=D("100"), tax_percent=0,
                                  packaging_cost=D("0"), final_price=D("100"), buffer_amount=D("5"))

    def order(self, so, sku, status, settlement="300", qty=2):
        Order.objects.create(business=self.business, sub_order_no=so, sku=sku, quantity=qty, order_date="2026-09-10")
        OrderPayment.objects.create(business=self.business, sub_order_no=so, supplier_sku=sku, quantity=qty,
                                    live_order_status=status, final_settlement_amount=D(settlement),
                                    order_date="2026-09-10 00:00:00+00:00")

    def profit(self):
        return self.client.get(f"{self.base}/profit/").data

    def test_buffer_is_charged_per_unit_on_a_delivered_order(self):
        self.order("D1", "KID", "Delivered")            # 2 units × ₹10 (parent buffer)
        p = self.profit()
        self.assertEqual(D(str(p["total_buffer_cost"])), D("20"))
        # settlement 300 − item 200 − buffer 20
        self.assertEqual(D(str(p["net_profit_loss"])), D("80"))
        self.assertEqual(D(str(p["total_purchase_cost"])), D("220"))

    def test_unparented_sku_uses_its_own_buffer(self):
        self.order("D2", "LONER", "Delivered")          # 2 × ₹5
        self.assertEqual(D(str(self.profit()["total_buffer_cost"])), D("10"))

    def test_parent_buffer_wins_over_a_childs_own(self):
        FinalPrice.objects.filter(sku_id="KID").update(buffer_amount=D("99"))
        self.order("D3", "KID", "Delivered")
        self.assertEqual(D(str(self.profit()["total_buffer_cost"])), D("20"))

    def test_no_buffer_on_a_return(self):
        self.order("R1", "KID", "Return", settlement="-50")
        p = self.profit()
        self.assertEqual(D(str(p["total_buffer_cost"])), D("0"))
        self.assertEqual(D(str(p["net_profit_loss"])), D("-50"))

    def test_buffer_can_be_set_through_the_parent_api(self):
        r = self.client.patch(f"{self.base}/parent-prices/PARENT/", {"buffer_amount": "25"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(D(str(r.data["buffer_amount"])), D("25"))
        self.order("D4", "KID", "Delivered")
        self.assertEqual(D(str(self.profit()["total_buffer_cost"])), D("50"))


class ParentImageRequiredTests(TestCase):
    """Every parent SKU created from SKU Pricing needs an image link, or an upload on the way."""

    def setUp(self):
        user = User.objects.create_user(username="o", password="pw", role=User.ROLE_SUPER_ADMIN)
        self.business = Business.objects.create(name="B")
        Membership.objects.create(user=user, business=self.business)
        self.client = APIClient()
        self.client.force_authenticate(user)
        self.base = f"/api/business/{self.business.id}"
        self.body = {"item_id": "NEW", "item_price": "100", "tax_percent": "5", "packaging_cost": "2"}

    def create(self, **extra):
        return self.client.post(f"{self.base}/parent-prices/", {**self.body, **extra}, format="json")

    def test_parent_without_an_image_is_refused(self):
        r = self.create()
        self.assertEqual(r.status_code, 400)
        self.assertIn("image_url", r.data)
        self.assertFalse(ParentItemPrice.objects.filter(item_id="NEW").exists())

    def test_link_must_be_http(self):
        self.assertEqual(self.create(image_url="not a link").status_code, 400)

    def test_parent_with_a_link_is_created(self):
        r = self.create(image_url="https://images.meesho.com/x.jpg")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(ParentItemPrice.objects.get(item_id="NEW").image_url, "https://images.meesho.com/x.jpg")

    def test_upload_pending_is_accepted_without_a_link(self):
        self.assertEqual(self.create(image_upload_pending=True).status_code, 201)

    def test_parent_from_sku_needs_an_image_too(self):
        FinalPrice.objects.create(business=self.business, sku_id="S1", item_price=D("50"), tax_percent=0,
                                  packaging_cost=D("0"), final_price=D("50"))
        url = f"{self.base}/parent-from-sku/"
        self.assertEqual(self.client.post(url, {"sku_id": "S1", "parent_id": "P1"}, format="json").status_code, 400)
        r = self.client.post(url, {"sku_id": "S1", "parent_id": "P1", "image_url": "https://x.example/a.png"}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(ParentItemPrice.objects.get(item_id="P1").image_url, "https://x.example/a.png")
