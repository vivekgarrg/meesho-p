"""Owner "spent" (owner draw): recorded as an EmployeePayment of type "spent",
kept out of payroll, and subtracted from profit only when the business's
deduct_owner_spent switch is on."""

from decimal import Decimal as D

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Business, BusinessProfile, Membership, User

from .models import Employee, EmployeePayment


class OwnerSpentTestCase(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="o", password="pw", role=User.ROLE_SUPER_ADMIN)
        self.business = Business.objects.create(name="B")
        Membership.objects.create(user=self.user, business=self.business)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.base = f"/api/business/{self.business.id}"
        self.owner = Employee.objects.create(business=self.business, full_name="Owner")
        EmployeePayment.objects.create(employee=self.owner, business=self.business, amount=D("500"),
                                       paid_on="2026-01-10", payment_type="spent")
        EmployeePayment.objects.create(employee=self.owner, business=self.business, amount=D("100"),
                                       paid_on="2026-02-10", payment_type="spent")

    def profit(self, **params):
        return self.client.get(f"{self.base}/profit/", params).data

    def set_flag(self, on):
        BusinessProfile.objects.update_or_create(business=self.business, defaults={"deduct_owner_spent": on})

    def test_reported_but_not_deducted_when_flag_off(self):
        p = self.profit()
        self.assertEqual(D(str(p["total_owner_spent"])), D("600"))
        self.assertFalse(p["owner_spent_deducted"])
        self.assertEqual(D(str(p["net_revenue"])), D("0"))

    def test_deducted_when_flag_on_and_respects_date_range(self):
        self.set_flag(True)
        p = self.profit()
        self.assertEqual(D(str(p["net_revenue"])), D("-600"))
        jan = self.profit(date_from="2026-01-01", date_to="2026-01-31")
        self.assertEqual(D(str(jan["net_revenue"])), D("-500"))

    def test_spent_is_not_salary_or_total_paid(self):
        self.set_flag(True)
        self.assertEqual(D(str(self.profit()["total_salary_cost"])), D("0"))
        rows = self.client.get(f"{self.base}/employees/").data
        rows = rows.get("results", rows)
        self.assertEqual(D(rows[0]["total_paid"]), D("0"))
        self.assertEqual(D(rows[0]["spent"]), D("600"))
        summary = self.client.get(f"{self.base}/employees/summary/").data
        self.assertEqual(D(summary["total_paid_all_time"]), D("0"))
        self.assertEqual(D(summary["spent_all_time"]), D("600"))
