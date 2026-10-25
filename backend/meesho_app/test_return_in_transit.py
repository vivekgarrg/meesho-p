"""The Meesho "Returns → In transit" export can be uploaded too, so a return that
reaches the desk before the Delivered export lists it can still be checked."""

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from .models import ReturnDelivery

META = '''
"Meesho Supplier Panel"
"Supplier ID","1"
"Supplier Registered Name","TEST"
"Download Date & Time Stamp","1792906909000"

'''
TRANSIT_HEADER = ('"S No","Product Name","SKU","Variation","Meesho PID","Category","Qty","Order Number","Suborder Number",'
                  '"Dispatch Date","Return Created Date","Type of Return","Sub Type","Expected Delivery Date","Courier Partner",'
                  '"AWB Number","Status","Attempt","Tracking Link","Return Price Type","Return Reason","Detailed Return Reason"')
DELIVERED_HEADER = ('"S No","Product Name","SKU","Variation","Meesho PID","Category","Qty","Order Number","Suborder Number",'
                    '"Dispatch Date","Return Created Date","Type of Return","Sub Type","Delivered Date","Courier Partner",'
                    '"AWB Number","Tracking Link","Proof of Delivery","Return Price Type","Return Reason","Detailed Return Reason",'
                    '"OTP Verified At"')


def transit_csv(*rows):
    lines = [TRANSIT_HEADER] + [
        f'"{i}","Brass Lota","lota-002","Free Size",,"Puja","1","{sub[:-2]}","{sub}","2026-10-06","2026-10-25",'
        f'"Customer Return","FIRST_RET","2026-11-19","Shadowfax","{awb}","{status}","NA","https://t/{awb}","Meesho Price",'
        f'"Received wrong product","Completely different"'
        for i, (sub, awb, status) in enumerate(rows, 1)]
    return SimpleUploadedFile("intransit__2026-10-25.csv", (META + "\n".join(lines) + "\n").encode())


def delivered_csv(*rows):
    lines = [DELIVERED_HEADER] + [
        f'"{i}","Brass Lota","lota-002","Free Size",,"Puja","1","{sub[:-2]}","{sub}","2026-10-06","2026-10-25",'
        f'"Customer Return","FIRST_RET","{day}","Shadowfax","{awb}","https://t/{awb}","https://pod","Meesho Price",'
        f'"Received wrong product","Completely different","NA"'
        for i, (sub, awb, day) in enumerate(rows, 1)]
    return SimpleUploadedFile("returns.csv", (META + "\n".join(lines) + "\n").encode())


class InTransitUploadTests(TestCase):
    def setUp(self):
        self.biz = Business.objects.create(name="Rudam")
        self.user = User.objects.create_user(username="u", password="pw", role=User.ROLE_SUPER_ADMIN)
        Membership.objects.create(user=self.user, business=self.biz)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.base = f"/api/business/{self.biz.id}/returns"

    def upload(self, file, kind=None):
        data = {"file": file}
        if kind:
            data["kind"] = kind
        return self.client.post(f"{self.base}/upload/", data, format="multipart")

    def test_in_transit_sheet_is_saved_with_its_status(self):
        r = self.upload(transit_csv(("111_1", "R27441", "Picked Up"), ("222_1", "VL0085", "Returned")), kind="in_transit")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual((r.data["kind"], r.data["created"]), ("in_transit", 2))
        row = ReturnDelivery.objects.get(suborder_no="111_1")
        self.assertEqual(row.stage, ReturnDelivery.STAGE_IN_TRANSIT)
        self.assertEqual(row.transit_status, "Picked Up")
        self.assertEqual(str(row.expected_delivery_date), "2026-11-19")
        self.assertEqual(row.delivery_attempt, "")          # "NA" means nothing
        self.assertIsNone(row.delivered_date)
        self.assertEqual(row.return_reason, "Received wrong product")

    def test_an_in_transit_return_can_be_scanned_and_checked(self):
        self.upload(transit_csv(("111_1", "R27441", "Picked Up")))
        r = self.client.get(f"{self.base}/lookup/", {"q": "R27441"})
        self.assertTrue(r.data["found"])
        m = r.data["matches"][0]
        self.assertEqual((m["stage"], m["transit_status"]), ("IN_TRANSIT", "Picked Up"))
        r = self.client.patch(f"{self.base}/{m['id']}/", {"claim_status": "REQUIRED", "packet_id": "R27441"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)

    def test_the_delivered_sheet_takes_over_and_keeps_the_claim_work(self):
        self.upload(transit_csv(("111_1", "R27441", "Picked Up")))
        row = ReturnDelivery.objects.get()
        row.claim_status = ReturnDelivery.CLAIM_REQUIRED
        row.packet_id = "R27441"
        row.save()
        r = self.upload(delivered_csv(("111_1", "R27441", "2026-10-28")))
        self.assertEqual(r.data["updated"], 1)
        row.refresh_from_db()
        self.assertEqual(row.stage, ReturnDelivery.STAGE_DELIVERED)
        self.assertEqual(str(row.delivered_date), "2026-10-28")
        self.assertEqual((row.claim_status, row.packet_id), (ReturnDelivery.CLAIM_REQUIRED, "R27441"))
        self.assertEqual(ReturnDelivery.objects.count(), 1)

    def test_an_older_in_transit_sheet_never_undoes_delivered(self):
        self.upload(delivered_csv(("111_1", "R27441", "2026-10-28")))
        r = self.upload(transit_csv(("111_1", "R27441", "Picked Up")))
        self.assertEqual(r.data["already_delivered"], 1)
        row = ReturnDelivery.objects.get()
        self.assertEqual(row.stage, ReturnDelivery.STAGE_DELIVERED)
        self.assertEqual(str(row.delivered_date), "2026-10-28")
        self.assertEqual(row.proof_of_delivery, "https://pod")

    def test_the_wrong_option_is_refused_with_a_pointer(self):
        r = self.upload(transit_csv(("111_1", "R27441", "Picked Up")), kind="delivered")
        self.assertEqual(r.status_code, 400)
        self.assertIn("In transit", r.data["error"])
        self.assertFalse(ReturnDelivery.objects.exists())

    def test_list_filter_and_counts(self):
        self.upload(transit_csv(("111_1", "R1", "Picked Up"), ("222_1", "R2", "Returned")))
        self.upload(delivered_csv(("333_1", "R3", "2026-10-24")))
        d = self.client.get(f"{self.base}/", {"stage": "in_transit"}).data
        self.assertEqual(d["total"], 2)
        self.assertEqual(d["stats"]["in_transit"], 2)
        self.assertEqual(d["stats"]["unreviewed"], 1)        # only the one that's back with us
        self.assertEqual(self.client.get(f"{self.base}/", {"urgency": "unreviewed"}).data["total"], 1)
