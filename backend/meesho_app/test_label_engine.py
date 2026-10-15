"""The fast (pdfium) label engine must hand the parser exactly what pdfplumber
did, and an unreadable page must fall back to the slow path rather than be lost."""

import io
from decimal import Decimal

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from accounts.models import Business, Membership, User

from .helpers import label_pdf
from .models import LabelOrder


def make_labels_pdf(rows, blank_pages=0):
    """A Meesho-style label sheet: one page per (sku, order_id, name)."""
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    w, h = A4
    for sku, order_id, name in rows:
        c.setFont("Helvetica", 11)
        c.drawString(20, h - 40, "Customer Address")
        c.drawString(300, h - 40, "Prepaid: Do not collect cash")
        c.drawString(20, h - 56, name)
        c.drawString(20, h - 72, "12 Test Street Valmo Pickup 23/10")
        c.drawString(20, h - 88, "Chennai, Tamil Nadu, 600040")
        c.drawString(20, h - 140, "If undelivered, return to:")
        c.drawString(20, h - 156, "Rudam, Haridwar, Uttarakhand, 249407")
        c.drawString(20, h - 220, "VL0123456789012")
        c.drawString(20, h - 260, "Product Details")
        c.drawString(20, h - 276, "SKU Size Qty Color Order No.")
        c.drawString(20, h - 292, f"{sku} Free Size 1 Golden {order_id}")
        c.setFont("Helvetica-Bold", 14)
        c.drawString(20, h - 380, "TAX INVOICE Original For Recipient")
        c.setFont("Helvetica", 10)
        c.drawString(20, h - 420, "Purchase Order No. Invoice No. Order Date Invoice Date")
        c.drawString(20, h - 436, "12345 INV1 13.10.2026 15.10.2026")
        c.showPage()
    for _ in range(blank_pages):
        c.setFont("Helvetica", 11)
        c.drawString(20, h - 40, "nothing useful here")
        c.showPage()
    c.save()
    return buf.getvalue()


def make_flipkart_pdf(rows):
    """A Flipkart-style sheet: label on the top half, tax invoice under a cut line."""
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    w, h = A4
    for sku, order_id, qty in rows:
        c.setFont("Helvetica", 9)
        c.drawString(200, h - 45, "E-Kart Logistics")
        c.drawString(200, h - 60, f"{order_id} COD")
        c.drawString(200, h - 85, "Ordered through")
        c.drawString(260, h - 150, "Shipping/Customer address:")
        c.drawString(260, h - 165, "Name: Test Buyer,")
        c.drawString(260, h - 178, "12 Test Street, Test Nagar,")
        c.drawString(260, h - 191, "Lucknow - 226001, IN-UP")
        c.drawString(200, h - 215, "HBD: 15 - 10")
        c.drawString(200, h - 228, "Sold By:Rudam, Haridwar")
        c.drawString(200, h - 255, "SKU ID | Description QTY")
        c.drawString(200, h - 270, f"1 {sku} | rudam Brass thing {qty}")
        c.drawString(200, h - 330, "FMPC6625604488")
        c.drawString(200, h - 360, "Not for resale.")
        c.setFont("Helvetica-Bold", 12)
        c.drawString(40, h - 400, "Tax Invoice")
        c.setFont("Helvetica", 9)
        c.drawString(40, h - 420, f"Order Id: {order_id}")
        c.drawString(40, h - 434, "Order Date: 14-10-2026, 10:39 PM")
        c.showPage()
    c.save()
    return buf.getvalue()


class LabelEngineTests(TestCase):
    def test_fast_engine_matches_pdfplumber_text_and_crop(self):
        data = make_labels_pdf([("brass-001", f"3415_{i}", f"Buyer {i}") for i in range(4)])
        fast = label_pdf.extract_pages_fast((data, 0, 10))
        slow = label_pdf.extract_pages((data, 0, 10))
        self.assertEqual(len(fast), len(slow))
        for f, s in zip(fast, slow):
            self.assertEqual(f["full_text"], s["full_text"])
            self.assertAlmostEqual(f["crop_y"], s["crop_y"], places=1)
            self.assertAlmostEqual(f["height"], s["height"], places=2)

    def test_extract_all_pages_uses_the_fast_engine(self):
        data = make_labels_pdf([("a", "1_1", "X")])
        pages, meta = label_pdf.extract_all_pages(data)
        self.assertEqual(meta["engine"], "pdfium")
        self.assertTrue(pages[0]["fast"])


class LabelUploadTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="o", password="pw", role=User.ROLE_SUPER_ADMIN)
        self.business = Business.objects.create(name="B")
        Membership.objects.create(user=self.user, business=self.business)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.url = f"/api/business/{self.business.id}/labels/parse/"

    def upload(self, data):
        return self.client.post(self.url, {"file": SimpleUploadedFile("l.pdf", data, content_type="application/pdf")},
                                format="multipart")

    def test_labels_are_parsed_saved_and_sorted_by_volume(self):
        rows = [("rare-sku", "100_1", "A"), ("common-sku", "100_2", "B"),
                ("common-sku", "100_3", "C"), ("common-sku", "100_4", "D")]
        r = self.upload(make_labels_pdf(rows))
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        d = r.data
        self.assertEqual(d["total_labels"], 4)
        self.assertEqual(d["db_saved"], 4)
        self.assertEqual(d["extract"]["engine"], "pdfium")
        self.assertEqual(LabelOrder.objects.get(order_id="100_2").sku, "common-sku")
        self.assertEqual(LabelOrder.objects.get(order_id="100_2").customer_city, "Chennai")
        # most-dispatched SKU's pages come first in the sorted PDF
        first_page = d["page_order"][0]
        self.assertEqual(d["page_details"][first_page]["sku"], "common-sku")

    def test_unreadable_page_is_rechecked_with_pdfplumber(self):
        r = self.upload(make_labels_pdf([("sku-1", "200_1", "A")], blank_pages=1))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["extract"].get("rechecked_pages"), 1)
        self.assertEqual(r.data["total_labels"], 1)


class FlipkartLabelTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="o", password="pw", role=User.ROLE_SUPER_ADMIN)
        self.business = Business.objects.create(name="B")
        Membership.objects.create(user=self.user, business=self.business)
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def upload(self, data):
        return self.client.post(f"/api/business/{self.business.id}/labels/parse/",
                                {"file": SimpleUploadedFile("l.pdf", data, content_type="application/pdf")},
                                format="multipart")

    def test_flipkart_fields_are_parsed_and_saved(self):
        r = self.upload(make_flipkart_pdf([("brass-kalash", "OD111111111111111111", 1)]))
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        pd_ = r.data["page_details"][0]
        self.assertEqual(pd_["platform"], "flipkart")
        self.assertEqual(pd_["sku"], "brass-kalash")
        self.assertEqual(pd_["awb"], "FMPC6625604488")
        self.assertEqual(pd_["customer_pincode"], "226001")
        row = LabelOrder.objects.get(order_id="OD111111111111111111")
        self.assertEqual((row.customer_name, row.customer_city, row.customer_state),
                         ("Test Buyer", "Lucknow", "Uttar Pradesh"))
        self.assertEqual((row.courier_name, row.payment_type, row.pickup_date), ("Ekart", "COD", "15/10"))
        self.assertEqual(str(row.order_date), "2026-10-14")

    def test_flipkart_label_is_cropped_to_its_own_edges(self):
        from pypdf import PdfReader
        r = self.upload(make_flipkart_pdf([("a", "OD222222222222222222", 1)]))
        import base64
        box = PdfReader(io.BytesIO(base64.b64decode(r.data["cropped_pdf_b64"]))).pages[0].cropbox
        self.assertLess(float(box.width), 300)     # an A4 page is 595 wide
        self.assertLess(float(box.height), 450)    # tax-invoice half removed

    def test_mixed_meesho_and_flipkart_pages_sort_together(self):
        from pypdf import PdfReader, PdfWriter
        w = PdfWriter()
        for blob in (make_labels_pdf([("meesho-sku", "300_1", "A")]),
                     make_flipkart_pdf([("fk-sku", "OD333333333333333333", 1), ("fk-sku", "OD444444444444444444", 1)])):
            for p in PdfReader(io.BytesIO(blob)).pages:
                w.add_page(p)
        buf = io.BytesIO()
        w.write(buf)
        r = self.upload(buf.getvalue())
        self.assertEqual(r.status_code, 200)
        self.assertEqual(sorted(d["platform"] for d in r.data["page_details"]), ["flipkart", "flipkart", "meesho"])
        self.assertEqual(r.data["page_details"][r.data["page_order"][0]]["sku"], "fk-sku")  # 2 labels beats 1
