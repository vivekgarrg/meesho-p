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


class FlipkartMissingPriceFlagTests(TestCase):
    """The Flipkart SKU list says which SKUs have no price, so the UI can offer to add one or link a parent."""

    def test_unpriced_sku_is_flagged_and_clears_once_priced(self):
        from .models import FlipkartOrderPayment
        user = User.objects.create_user(username="f", password="pw", role=User.ROLE_SUPER_ADMIN)
        business = Business.objects.create(name="B")
        Membership.objects.create(user=user, business=business)
        client = APIClient()
        client.force_authenticate(user)
        FlipkartOrderPayment.objects.create(business=business, order_item_id="1", seller_sku="NEW-SKU",
                                            settlement_value=D("100"), sale_amount=D("100"), order_date="2026-10-01")
        base = f"/api/business/{business.id}"
        row = lambda: {r["sku_id"]: r for r in client.get(f"{base}/flipkart-profit/").data["sku_payment_list"]}["NEW-SKU"]
        self.assertTrue(row()["missing_price"])
        FinalPrice.objects.create(business=business, sku_id="NEW-SKU", item_price=D("40"), tax_percent=0,
                                  packaging_cost=D("0"), final_price=D("40"))
        self.assertFalse(row()["missing_price"])


class FlipkartSkuAnalysisShapeTests(TestCase):
    """The Flipkart SKU rows carry the same delivered/returned split Meesho's analysis shows."""

    def test_rows_split_delivered_profit_from_return_loss(self):
        from .models import FlipkartOrderPayment
        user = User.objects.create_user(username="s", password="pw", role=User.ROLE_SUPER_ADMIN)
        business = Business.objects.create(name="B")
        Membership.objects.create(user=user, business=business)
        client = APIClient()
        client.force_authenticate(user)
        FinalPrice.objects.create(business=business, sku_id="K", item_price=D("40"), tax_percent=0,
                                  packaging_cost=D("0"), final_price=D("40"))
        FlipkartOrderPayment.objects.create(business=business, order_item_id="1", seller_sku="K", quantity=2,
                                            sale_amount=D("300"), settlement_value=D("200"), order_date="2026-10-01")
        FlipkartOrderPayment.objects.create(business=business, order_item_id="2", seller_sku="K", quantity=1,
                                            sale_amount=D("100"), settlement_value=D("-30"), return_type="customer_return",
                                            order_date="2026-10-02")
        d = client.get(f"/api/business/{business.id}/flipkart-sku-analysis/").data
        k = {r["sku_id"]: r for r in d["skus"]}["K"]
        self.assertEqual((k["delivered_count"], k["return_count"], k["delivered_quantity"]), (1, 1, 2))
        self.assertEqual(k["delivered_profit"], 120.0)          # 200 settlement − 2 × ₹40
        self.assertEqual(k["return_loss"], -30.0)               # nothing to cost on a return, just the settlement hit
        self.assertEqual(k["net_profit"], 90.0)
        self.assertEqual(k["one_unit_price"], 40.0)
        self.assertEqual([b["status"] for b in d["status_breakdown"]], ["Delivered", "Returned"])


class FlipkartOverallTests(TestCase):
    def test_lifetime_totals_include_other_charges(self):
        from .models import FlipkartOrderPayment, FlipkartOtherCharge
        user = User.objects.create_user(username="fo", password="pw", role=User.ROLE_SUPER_ADMIN)
        business = Business.objects.create(name="B")
        Membership.objects.create(user=user, business=business)
        client = APIClient()
        client.force_authenticate(user)
        FinalPrice.objects.create(business=business, sku_id="K", item_price=D("40"), tax_percent=0,
                                  packaging_cost=D("0"), final_price=D("40"))
        FlipkartOrderPayment.objects.create(business=business, order_item_id="1", seller_sku="K", quantity=1,
                                            sale_amount=D("150"), settlement_value=D("100"), order_date="2026-10-01")
        FlipkartOtherCharge.objects.create(business=business, category=FlipkartOtherCharge.CATEGORY_CHOICES[0][0],
                                           amount=D("-10"), payment_date="2026-10-02")
        d = client.get(f"/api/business/{business.id}/flipkart-overall/", {"date_from": "2030-01-01"}).data
        self.assertEqual((d["gross_revenue"], d["total_settled"], d["net_profit"], d["order_count"]), (150.0, 100.0, 50.0, 1))


class FlipkartDeepDiveTests(TestCase):
    def setUp(self):
        from .models import FlipkartOrder, FlipkartOrderPayment, FlipkartOtherCharge
        user = User.objects.create_user(username="dd", password="pw", role=User.ROLE_SUPER_ADMIN)
        self.business = Business.objects.create(name="B")
        Membership.objects.create(user=user, business=self.business)
        self.client = APIClient()
        self.client.force_authenticate(user)
        self.base = f"/api/business/{self.business.id}"
        FinalPrice.objects.create(business=self.business, sku_id="K", item_price=D("40"), tax_percent=0,
                                  packaging_cost=D("0"), final_price=D("40"))
        FlipkartOrderPayment.objects.create(
            business=self.business, order_item_id="1", seller_sku="K", quantity=1, sale_amount=D("200"),
            marketplace_fee=D("-30"), gst_on_mp_fees=D("-5"), settlement_value=D("165"),
            fulfilment_type="NON_FBF", order_date="2026-10-01")
        FlipkartOrder.objects.create(
            business=self.business, order_item_id="1", order_id="O1", sku="K", order_item_status="DELIVERED",
            order_date="2026-10-01", dispatch_by_date="2026-10-02", dispatched_date="2026-10-05",
            dispatch_sla_breached=True, logistics_partner="Ekart")
        FlipkartOrder.objects.create(
            business=self.business, order_item_id="2", order_id="O2", sku="K", order_item_status="CANCELLED",
            order_date="2026-10-01", logistics_partner="Ekart", cancellation_reason="Out of stock")
        FlipkartOtherCharge.objects.create(business=self.business, category="fines", amount=D("-50"),
                                           payment_date="2026-10-03", description="SLA penalty", reference_id="R1")
        FlipkartOtherCharge.objects.create(business=self.business, category="ads", amount=D("-20"),
                                           payment_date="2026-10-03", description="Ad wallet")

    def test_fees_are_taken_apart(self):
        d = self.client.get(f"{self.base}/flipkart-deep-dive/").data
        f = d["fees"]
        self.assertEqual((f["total_fee"], f["rate_pct"], f["marketplace_fee"], f["gst_on_fee"]), (35.0, 17.5, 30.0, 5.0))
        self.assertEqual(f["by_sku"][0]["sku"], "K")
        self.assertEqual(f["by_fulfilment"][0]["label"], "NON_FBF")

    def test_sla_shows_how_late_and_who(self):
        s = self.client.get(f"{self.base}/flipkart-deep-dive/").data["sla"]
        self.assertEqual((s["dispatch_breached"], s["avg_dispatch_days_late"], s["worst_dispatch_days_late"]), (1, 3.0, 3))
        self.assertEqual(s["worst_orders"][0]["dispatch_days_late"], 3)
        self.assertEqual(s["by_partner"][0]["label"], "Ekart")

    def test_fines_are_listed_line_by_line(self):
        c = self.client.get(f"{self.base}/flipkart-deep-dive/").data["fines"]
        self.assertEqual((c["total"], c["fines_total"], c["ads_spend"], c["count"]), (-70.0, 50.0, 20.0, 2))
        self.assertEqual(c["biggest"][0]["description"], "SLA penalty")
        self.assertEqual(len(c["lines"]), 2)

    def test_sku_report_pulls_one_skus_full_picture(self):
        r = self.client.get(f"{self.base}/flipkart-sku-report/", {"sku": "k"}).data
        self.assertEqual(r["sku"], "k")
        self.assertEqual(r["row"]["delivered_count"], 1)
        self.assertEqual(r["orders"]["total"], 2)
        self.assertEqual((r["orders"]["cancelled"], r["orders"]["dispatch_sla_breached"]), (1, 1))
        self.assertEqual(r["monthly"][0]["month"], "2026-10")
        self.assertFalse(r["missing_price"])
