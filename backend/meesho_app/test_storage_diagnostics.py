"""Storage that is configured *wrongly* must say so, not fail silently.

Signing an upload url is local maths and works with any key, so a bad key
used to surface only as an upload R2 quietly rejected. These pin the
messages the cropper now shows instead.
"""

from unittest import mock

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from . import object_storage

R2 = dict(
    OBJECT_STORAGE_READY=True,
    S3_ENDPOINT_URL="https://acct.r2.cloudflarestorage.com",
    S3_BUCKET="rudam-listing-images",
    S3_PUBLIC_BASE_URL="https://images.rudam.in",
    S3_REGION="auto",
    S3_ACCESS_KEY_ID="0123456789abcdef" * 2,
    S3_SECRET_ACCESS_KEY="fedcba9876543210" * 4,
)
TOKEN_VALUE = dict(R2, S3_ACCESS_KEY_ID="Ab_cD3-" * 7 + "xx", S3_SECRET_ACCESS_KEY="Ab_cD3-" * 7 + "xx")


class CredentialProblemTests(TestCase):
    @override_settings(**TOKEN_VALUE)
    def test_a_pasted_token_value_disables_uploads_with_a_reason(self):
        with mock.patch.dict("sys.modules", {"boto3": mock.Mock()}):
            self.assertFalse(object_storage.is_ready())
            problem = object_storage.credential_problem()
        self.assertIn("51 characters", problem)
        self.assertIn("Token value", problem)

    @override_settings(**R2)
    def test_well_shaped_keys_report_no_problem(self):
        with mock.patch.dict("sys.modules", {"boto3": mock.Mock()}):
            self.assertTrue(object_storage.is_ready())
            self.assertIsNone(object_storage.credential_problem())

    @override_settings(OBJECT_STORAGE_READY=False)
    def test_not_configured_at_all_is_not_a_problem_just_off(self):
        self.assertIsNone(object_storage.credential_problem())
        self.assertFalse(object_storage.is_ready())


class EndpointDiagnosticsTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="o", password="pw", role=User.ROLE_SUPER_ADMIN)
        self.business = Business.objects.create(name="B")
        Membership.objects.create(user=self.user, business=self.business)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.base = f"/api/business/{self.business.id}"
        boto = mock.patch.dict("sys.modules", {"boto3": mock.Mock()})
        boto.start()
        self.addCleanup(boto.stop)

    @override_settings(**TOKEN_VALUE)
    def test_config_explains_why_uploads_are_off(self):
        d = self.client.get(f"{self.base}/listing-images/config/").data
        self.assertFalse(d["enabled"])
        self.assertIn("Token value", d["problem"])

    @override_settings(**TOKEN_VALUE)
    def test_presign_refuses_with_the_real_reason(self):
        r = self.client.post(f"{self.base}/listing-images/presign/", {
            "parent_id": "P", "create_parent": True,
            "files": [{"sha256": "a" * 64, "content_type": "image/jpeg", "bytes": 10}],
        }, format="json")
        self.assertEqual(r.status_code, 503)
        self.assertIn("keys look wrong", r.data["error"])

    @override_settings(**TOKEN_VALUE)
    def test_check_stops_at_config_with_the_reason(self):
        d = self.client.post(f"{self.base}/listing-images/check/").data
        self.assertFalse(d["ok"])
        self.assertEqual(d["steps"][0]["step"], "config")
        self.assertIn("51 characters", d["steps"][0]["detail"])

    @override_settings(**R2)
    def test_check_reports_each_step_of_a_healthy_round_trip(self):
        client = mock.Mock()
        ok = mock.Mock(status_code=200, content=b"rudam object storage probe")
        with mock.patch.object(object_storage, "_client", return_value=client), \
             mock.patch("requests.get", return_value=ok):
            d = self.client.post(f"{self.base}/listing-images/check/").data
        self.assertTrue(d["ok"], d)
        self.assertEqual([s["step"] for s in d["steps"]], ["config", "write", "public read", "delete"])

    @override_settings(**R2)
    def test_check_catches_a_private_bucket(self):
        with mock.patch.object(object_storage, "_client", return_value=mock.Mock()), \
             mock.patch("requests.get", return_value=mock.Mock(status_code=403, content=b"")):
            d = self.client.post(f"{self.base}/listing-images/check/").data
        self.assertFalse(d["ok"])
        read = next(s for s in d["steps"] if s["step"] == "public read")
        self.assertFalse(read["ok"])
        self.assertIn("HTTP 403", read["detail"])

    @override_settings(**R2)
    def test_check_names_a_rejected_key(self):
        from botocore.exceptions import ClientError
        client = mock.Mock()
        client.put_object.side_effect = ClientError(
            {"Error": {"Code": "SignatureDoesNotMatch"}}, "PutObject")
        with mock.patch.object(object_storage, "_client", return_value=client):
            d = self.client.post(f"{self.base}/listing-images/check/").data
        write = next(s for s in d["steps"] if s["step"] == "write")
        self.assertIn("Secret Access Key is wrong", write["detail"])

    @override_settings(**R2)
    def test_no_step_ever_contains_a_credential(self):
        with mock.patch.object(object_storage, "_client", return_value=mock.Mock()), \
             mock.patch("requests.get", return_value=mock.Mock(status_code=200, content=b"rudam object storage probe")):
            text = str(self.client.post(f"{self.base}/listing-images/check/").data)
        self.assertNotIn(R2["S3_ACCESS_KEY_ID"], text)
        self.assertNotIn(R2["S3_SECRET_ACCESS_KEY"], text)
