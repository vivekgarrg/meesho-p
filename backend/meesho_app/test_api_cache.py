"""The business API response cache: fast when nothing changed, never stale or
leaky when something did. (Disabled in the normal test settings, so each test
here switches on an in-memory store.)"""

from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import Business, Membership, User

from .models import Employee

LOCMEM = {
    "default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"},
    "api": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache", "LOCATION": "api-cache-tests"},
}


def jwt_client(user):
    # The middleware identifies users from the JWT itself, so these tests use
    # real tokens rather than force_authenticate.
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return c


@override_settings(CACHES=LOCMEM, API_CACHE_ENABLED=True)
class ApiCacheTestCase(TestCase):
    def setUp(self):
        from django.core.cache import caches
        caches["api"].clear()
        self.admin = User.objects.create_user(username="a", password="pw", role=User.ROLE_SUPER_ADMIN)
        self.business = Business.objects.create(name="B")
        Membership.objects.create(user=self.admin, business=self.business)
        self.client = jwt_client(self.admin)
        self.base = f"/api/business/{self.business.id}"

    def cache_header(self, path, **extra):
        return self.client.get(f"{self.base}{path}", **extra)["X-Cache"]

    def test_second_identical_get_is_a_hit(self):
        self.assertEqual(self.cache_header("/employees/"), "MISS")
        self.assertEqual(self.cache_header("/employees/"), "HIT")

    def test_write_through_the_api_invalidates(self):
        self.cache_header("/employees/")
        self.assertEqual(self.cache_header("/employees/"), "HIT")
        r = self.client.post(f"{self.base}/employees/", {"full_name": "Asha"}, format="json")
        self.assertLess(r.status_code, 300)
        resp = self.client.get(f"{self.base}/employees/")
        self.assertEqual(resp["X-Cache"], "MISS")
        body = resp.json()
        rows = body.get("results", body)
        self.assertIn("Asha", [e["full_name"] for e in rows])

    def test_orm_write_outside_a_request_invalidates(self):
        self.cache_header("/employees/")
        Employee.objects.create(business=self.business, full_name="Ravi")
        self.assertEqual(self.cache_header("/employees/"), "MISS")

    def test_refresh_endpoint_clears(self):
        self.cache_header("/employees/")
        self.assertEqual(self.cache_header("/employees/"), "HIT")
        self.assertEqual(self.client.post(f"{self.base}/cache/refresh/", {}, format="json").status_code, 200)
        self.assertEqual(self.cache_header("/employees/"), "MISS")

    def test_settlement_mode_gets_its_own_entry(self):
        self.cache_header("/employees/")
        self.assertEqual(self.cache_header("/employees/", HTTP_X_SETTLEMENT_MODE="settled"), "MISS")
        self.assertEqual(self.cache_header("/employees/", HTTP_X_SETTLEMENT_MODE="settled"), "HIT")

    def test_other_business_user_cannot_read_cached_data(self):
        self.cache_header("/employees/")
        self.assertEqual(self.cache_header("/employees/"), "HIT")
        outsider = User.objects.create_user(username="x", password="pw", role=User.ROLE_BUSINESS_USER)
        r = jwt_client(outsider).get(f"{self.base}/employees/")
        self.assertEqual(r.status_code, 404)
        self.assertFalse(r.has_header("X-Cache"))

    def test_no_cache_request_header_bypasses(self):
        self.cache_header("/employees/")
        r = self.client.get(f"{self.base}/employees/", HTTP_CACHE_CONTROL="no-cache")
        self.assertEqual(r["X-Cache"], "BYPASS")

    def test_profile_flag_change_invalidates_profit(self):
        # The first read creates the business's cost-settings row, which itself
        # invalidates; from the second read on it is stable.
        self.cache_header("/profit/")
        self.cache_header("/profit/")
        self.assertEqual(self.cache_header("/profit/"), "HIT")
        r = self.client.put(f"/api/businesses/{self.business.id}/",
                            {"profile": {"deduct_owner_spent": True}}, format="json")
        self.assertLess(r.status_code, 300)
        self.assertEqual(self.cache_header("/profit/"), "MISS")
