"""
Product photos (Meesho's first, the parent SKU's as fallback) on returns and
order scanning, and shipped orders settled from Meesho's returns and payments.
"""

import datetime as dt

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from .meesho_images import meesho_image, photo_map
from .models import (FinalPrice, LabelOrder, MeeshoAccount, MeeshoSyncSnapshot, Order, OrderPayment, ParentItemPrice,
                     ReturnDelivery)
from .sync_middleware import orders, returns

DAY = dt.date(2026, 10, 20)
MEESHO = "https://images.meesho.com/images/products/957016055/pyka0_512.jpg"
ORDER_PIC = "https://images.meesho.com/images/products/717066356/02oxm_512.jpg"
PARENT = "https://images.rudam.in/parents/diya.jpg"


class MeeshoImageTests(TestCase):
    def test_only_a_meesho_product_image_passes(self):
        self.assertEqual(meesho_image(MEESHO), MEESHO)
        self.assertEqual(meesho_image(f"  {MEESHO} "), MEESHO)
        for bad in ("", None, "http://images.meesho.com/images/p/x.jpg",          # not https
                    "https://evil.example.com/x.jpg",                            # not Meesho
                    "https://images.meesho.com.evil.com/x.jpg",                   # looks like it
                    "https://images.meesho.com/images/products/1/",               # not an image file
                    "https://sfx-ecom.storage.googleapis.com/seller/report.pdf",  # the delivery proof
                    "javascript:alert(1)", "https://images.meesho.com/" + "a" * 600 + ".jpg"):
            self.assertEqual(meesho_image(bad), "", bad)


class PhotoTests(TestCase):
    def setUp(self):
        self.biz = Business.objects.create(name="Rudam")
        parent = ParentItemPrice.objects.create(business=self.biz, item_id="DIYA", image_url=PARENT)
        FinalPrice.objects.create(business=self.biz, sku_id="diya-029", parent=parent)

    def ret(self, n, **kw):
        return ReturnDelivery.objects.create(business=self.biz, suborder_no=f"{n}_1", awb_number=f"AWB{n}", sku="diya-029", **kw)

    def test_meesho_photo_of_the_return_then_of_the_order_then_the_parent_skus(self):
        own = self.ret(1, meesho_image_url=MEESHO)
        via_order = self.ret(2)
        Order.objects.create(business=self.biz, sub_order_no="2_1", reason_for_credit_entry="SHIPPED", order_date=DAY,
                             meesho_image_url=ORDER_PIC)
        bare = self.ret(3)
        broken = self.ret(4, meesho_image_url="https://evil.example.com/x.jpg")   # stored, but doesn't check out
        nothing = ReturnDelivery.objects.create(business=self.biz, suborder_no="5_1", sku="no-parent")
        m = photo_map([own, via_order, bare, broken, nothing])
        self.assertEqual(m[(self.biz.id, "1_1")], (MEESHO, PARENT))       # Meesho's, with the parent's to fall back on
        self.assertEqual(m[(self.biz.id, "2_1")], (ORDER_PIC, PARENT))
        self.assertEqual(m[(self.biz.id, "3_1")], (PARENT, None))
        self.assertEqual(m[(self.biz.id, "4_1")], (PARENT, None))
        self.assertEqual(m[(self.biz.id, "5_1")], (None, None))

    def test_the_sync_keeps_meeshos_photos(self):
        orders.inject(self.biz, [{"tab": "shipped", "sub_order_num": "7_1", "created_iso": "2026-10-20T10:00:00+0530",
                                  "sku": "diya-029", "image": ORDER_PIC},
                                 {"tab": "shipped", "sub_order_num": "8_1", "created_iso": "2026-10-20T10:00:00+0530",
                                  "sku": "diya-029", "image": "https://evil.example.com/x.jpg"}])
        self.assertEqual(Order.objects.get(sub_order_no="7_1").meesho_image_url, ORDER_PIC)
        self.assertIn(Order.objects.get(sub_order_no="8_1").meesho_image_url, (None, ""))
        row = returns.normalize({"sub_order_num": "9_1", "awb": "A9", "product": {"sku": "diya-029", "image_urls": [
            "https://evil.example.com/x.jpg", MEESHO]}}, "intransit")
        self.assertEqual(row["meesho_image_url"], MEESHO)                   # the first that checks out

    def test_order_scanning_and_the_returns_list_send_the_photo_and_its_fallback(self):
        user = User.objects.create_user(username="w", password="pw", role=User.ROLE_BUSINESS_USER)
        Membership.objects.create(user=user, business=self.biz)
        MeeshoAccount.objects.create(business=self.biz, phone_number="9000000001", password_enc="x", status="ACTIVE",
                                     supplier_id="1", supplier_identifier="x")
        c = APIClient()
        c.force_authenticate(user)
        self.ret(1, meesho_image_url=MEESHO, stage="IN_TRANSIT")
        r = c.get(f"/api/business/{self.biz.id}/meesho-orders/returns/list/", {"stage": "in_transit"}).data["returns"][0]
        self.assertEqual((r["image_url"], r["image_fallback_url"]), (MEESHO, PARENT))

        Order.objects.create(business=self.biz, sub_order_no="6_1", reason_for_credit_entry="READY_TO_SHIP", order_date=DAY,
                             meesho_image_url=ORDER_PIC)
        today = timezone.localdate()
        LabelOrder.objects.create(business=self.biz, order_id="6_1", sku="diya-029", awb_number="AWB6", uploaded_date=today)
        LabelOrder.objects.create(business=self.biz, order_id="7_1", sku="diya-029", awb_number="AWB7", uploaded_date=today)
        res = c.get(f"/api/business/{self.biz.id}/order-scan/queue/", {"date": today.isoformat()})
        self.assertEqual(res.status_code, 200, res.data)
        items = {i["order_id"]: (i["image_url"], i["image_fallback_url"]) for i in res.data["items"]}
        self.assertEqual(items, {"6_1": (ORDER_PIC, PARENT), "7_1": (PARENT, None)})


class SettleTests(TestCase):
    def setUp(self):
        self.biz = Business.objects.create(name="Rudam")
        self.acct = MeeshoAccount.objects.create(business=self.biz, phone_number="9000000001", password_enc="x", status="ACTIVE",
                                                 supplier_id="1", supplier_identifier="x")

    def shipped(self, n, **kw):
        Order.objects.create(business=self.biz, sub_order_no=f"{n}_1", reason_for_credit_entry="SHIPPED", order_date=DAY,
                             sku="diya-029", **kw)

    def pay(self, n, status, day=DAY, txn="AXIS1"):
        OrderPayment.objects.create(business=self.biz, sub_order_no=f"{n}_1", live_order_status=status, payment_date=day,
                                    transaction_id=txn, final_settlement_amount=100)

    def status(self, n):
        o = Order.latest_per_order(Order.objects.filter(business=self.biz, sub_order_no=f"{n}_1")).get()
        return o.reason_for_credit_entry

    def test_shipped_orders_the_panel_dropped_take_meeshos_outcome_and_nothing_is_guessed(self):
        for n in range(1, 10):
            self.shipped(n)
        self.pay(1, "Delivered")
        self.pay(2, "Return")                                       # delivered, then sent back
        self.pay(3, "RTO")
        self.pay(4, "Exchange")
        self.pay(5, "Delivered", day=DAY)
        self.pay(5, "RTO", day=DAY + dt.timedelta(days=5))          # the latest payment says how it ended
        ReturnDelivery.objects.create(business=self.biz, suborder_no="6_1", awb_number="A6", stage="DELIVERED",
                                      type_of_return="Courier Return (RTO)", sub_type="forward_RTO")
        ReturnDelivery.objects.create(business=self.biz, suborder_no="7_1", awb_number="A7", stage="IN_TRANSIT",
                                      type_of_return="Courier Return (RTO)", sub_type="forward_RTO")
        self.pay(7, "Delivered")                                    # the live returns table beats a payment
        ReturnDelivery.objects.create(business=self.biz, suborder_no="8_1", awb_number="A8", stage="IN_TRANSIT",
                                      type_of_return="Customer Return", sub_type="FIRST_RET")
        self.pay(9, "Shipped")                                      # not an outcome: stays shipped
        self.shipped(10)
        self.pay(10, "Delivered")
        res = orders.settle(self.biz, live={"10_1"}).counts         # 10 is still on the panel's shipped list
        got = {n: self.status(n) for n in range(1, 11)}
        self.assertEqual(got, {1: "DELIVERED", 2: "DELIVERED", 3: "RTO_COMPLETE", 4: "DOOR_STEP_EXCHANGED", 5: "RTO_COMPLETE",
                               6: "RTO_COMPLETE", 7: "RTO_INITIATED", 8: "DELIVERED", 9: "SHIPPED", 10: "SHIPPED"})
        self.assertEqual((res["settled"], res["settled_from_returns"], res["settled_from_payments"], res["still_shipped"]),
                         (8, 3, 5, 1))
        new = Order.objects.get(business=self.biz, sub_order_no="1_1", reason_for_credit_entry="DELIVERED")
        self.assertEqual((new.order_date, new.sku, new.order_source), (DAY, "diya-029", "Meesho panel sync"))
        self.assertEqual(orders.settle(self.biz, live={"10_1"}).counts["settled"], 0)     # done once

    def test_orders_further_on_or_in_another_business_are_left_alone(self):
        Order.objects.create(business=self.biz, sub_order_no="1_1", reason_for_credit_entry="RTO_COMPLETE", order_date=DAY)
        self.pay(1, "Delivered")
        other = Business.objects.create(name="Elsewhere")
        Order.objects.create(business=other, sub_order_no="2_1", reason_for_credit_entry="SHIPPED", order_date=DAY)
        OrderPayment.objects.create(business=self.biz, sub_order_no="2_1", live_order_status="Delivered", payment_date=DAY)
        orders.settle(self.biz, live=set())
        self.assertEqual(self.status(1), "RTO_COMPLETE")
        self.assertEqual(Order.objects.get(business=other).reason_for_credit_entry, "SHIPPED")

    def test_the_inject_command_settles_against_the_lists_last_read(self):
        import io
        import json
        self.shipped(1)
        self.shipped(2)
        self.pay(1, "Delivered")
        self.pay(2, "Delivered")
        MeeshoSyncSnapshot.objects.create(account=self.acct, endpoint="orders_shipped", http_status=200, fetched_at=timezone.now(),
                                          payload=[{"tab": "shipped", "sub_order_num": "2_1", "created_iso": "2026-10-20T10:00:00+0530"}])
        out = io.StringIO()
        call_command("meesho_inject", account=self.acct.id, kind="orders", stdout=out)
        res = json.loads(out.getvalue().strip().splitlines()[-1])
        self.assertEqual((res["settled"], self.status(1), self.status(2)), (1, "DELIVERED", "SHIPPED"))
