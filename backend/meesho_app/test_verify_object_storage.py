"""verify_object_storage, exercised without network or credentials.

boto3 and requests are stubbed, so every branch — including the "uploads fine
but nobody can read it" case the command exists to catch — runs locally.
"""

import sys
import types
from io import StringIO
from unittest import mock

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import SimpleTestCase, override_settings

CONFIGURED = dict(
    S3_ENDPOINT_URL="https://acct.r2.cloudflarestorage.com",
    S3_BUCKET="rudam-listing-images",
    # Shaped like real R2 keys (32 / 64 hex) so the shape check passes.
    S3_ACCESS_KEY_ID="0123456789abcdef0123456789abcdef",
    S3_SECRET_ACCESS_KEY="fedcba9876543210" * 4,
    S3_PUBLIC_BASE_URL="https://images.rudam.in",
    S3_REGION="auto",
)
PROBE_BODY = b"rudam object storage probe"


class FakeClientError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.response = {"Error": {"Code": code}}


def fake_boto(client):
    boto3 = types.ModuleType("boto3")
    boto3.client = mock.Mock(return_value=client)
    exceptions = types.ModuleType("botocore.exceptions")
    exceptions.ClientError = FakeClientError
    botocore = types.ModuleType("botocore")
    botocore.exceptions = exceptions
    return {"boto3": boto3, "botocore": botocore, "botocore.exceptions": exceptions}


def response(status, content=PROBE_BODY):
    r = mock.Mock()
    r.status_code = status
    r.content = content
    return r


class VerifyObjectStorageTests(SimpleTestCase):
    def run_cmd(self, client, http_response, *args):
        out = StringIO()
        with mock.patch.dict(sys.modules, fake_boto(client)), \
             mock.patch("requests.get", return_value=http_response) as get:
            call_command("verify_object_storage", *args, stdout=out)
        return out.getvalue(), get

    # Explicit blanks: settings may have picked up a developer's real
    # backend/.env, and this test must not depend on what's in it.
    @override_settings(S3_ENDPOINT_URL="", S3_BUCKET="", S3_ACCESS_KEY_ID="",
                       S3_SECRET_ACCESS_KEY="", S3_PUBLIC_BASE_URL="")
    def test_unconfigured_names_every_missing_setting(self):
        with self.assertRaises(CommandError) as ctx:
            call_command("verify_object_storage", stdout=StringIO())
        for name in ("S3_BUCKET", "S3_PUBLIC_BASE_URL", "S3_SECRET_ACCESS_KEY"):
            self.assertIn(name, str(ctx.exception))

    @override_settings(**CONFIGURED)
    def test_a_healthy_bucket_passes_and_cleans_up(self):
        client = mock.Mock()
        out, get = self.run_cmd(client, response(200))
        self.assertIn("All checks passed", out)
        client.put_object.assert_called_once()
        client.delete_object.assert_called_once()
        # Read back over the PUBLIC base url, not the S3 API endpoint.
        self.assertTrue(get.call_args[0][0].startswith("https://images.rudam.in/_probe/"))

    @override_settings(**CONFIGURED)
    def test_a_private_bucket_is_caught_even_though_upload_worked(self):
        """The case this command exists for: writes succeed, every url 403s."""
        client = mock.Mock()
        with self.assertRaises(CommandError) as ctx:
            self.run_cmd(client, response(403))
        self.assertIn("public read returned HTTP 403", str(ctx.exception))
        # Still cleaned up after itself despite the failure.
        client.delete_object.assert_called_once()

    @override_settings(**CONFIGURED)
    def test_a_wrong_secret_is_named_as_such(self):
        client = mock.Mock()
        client.put_object.side_effect = FakeClientError("SignatureDoesNotMatch")
        with self.assertRaises(CommandError) as ctx:
            self.run_cmd(client, response(200))
        self.assertIn("secret access key is wrong", str(ctx.exception))

    @override_settings(**CONFIGURED)
    def test_a_wrong_bucket_is_named_as_such(self):
        client = mock.Mock()
        client.put_object.side_effect = FakeClientError("NoSuchBucket")
        with self.assertRaises(CommandError) as ctx:
            self.run_cmd(client, response(200))
        self.assertIn("bucket name is wrong", str(ctx.exception))

    @override_settings(**CONFIGURED)
    def test_keep_leaves_the_probe_in_place(self):
        client = mock.Mock()
        out, _get = self.run_cmd(client, response(200), "--keep")
        client.delete_object.assert_not_called()
        self.assertIn("--keep", out)

    def test_credentials_are_never_printed(self):
        """This runs on the server and gets pasted into chats and tickets, so
        it must never echo either half of the key pair. Distinctive values,
        so a hit can't be a coincidental word."""
        access = "a1b2c3d4" * 4                    # valid R2 shape, distinctive
        secret = "9f8e7d6c" * 8
        creds = dict(CONFIGURED, S3_ACCESS_KEY_ID=access, S3_SECRET_ACCESS_KEY=secret)
        with override_settings(**creds):
            out, _get = self.run_cmd(mock.Mock(), response(200))
        self.assertIn("All checks passed", out)
        self.assertNotIn(access, out)
        self.assertNotIn(secret, out)
        self.assertNotIn("a1b2c3d4a1b2", out)   # not even a prefix


class R2CredentialShapeTests(SimpleTestCase):
    """A pasted "Token value" is the common mistake; catch it before R2 does."""

    def run_with(self, access, secret):
        creds = dict(CONFIGURED, S3_ACCESS_KEY_ID=access, S3_SECRET_ACCESS_KEY=secret)
        with override_settings(**creds), self.assertRaises(CommandError) as ctx:
            call_command("verify_object_storage", stdout=StringIO())
        return str(ctx.exception)

    def test_a_token_value_in_both_fields_is_named(self):
        msg = self.run_with("Ab_cD3-" * 7 + "xx", "Ab_cD3-" * 7 + "xx")
        self.assertIn("S3_ACCESS_KEY_ID is 51 characters, not plain hex", msg)
        self.assertIn("S3_SECRET_ACCESS_KEY is 51 characters", msg)
        self.assertIn("Token value", msg)

    def test_swapped_keys_are_caught(self):
        msg = self.run_with("f" * 64, "a" * 32)
        self.assertIn("S3_ACCESS_KEY_ID is 64 characters", msg)
        self.assertIn("S3_SECRET_ACCESS_KEY is 32 characters", msg)

    @override_settings(**dict(CONFIGURED, S3_ENDPOINT_URL="https://acct.r2.cloudflarestorage.com",
                              S3_ACCESS_KEY_ID="a" * 32, S3_SECRET_ACCESS_KEY="b" * 64))
    def test_correctly_shaped_r2_keys_pass_the_check(self):
        out = StringIO()
        with mock.patch.dict(sys.modules, fake_boto(mock.Mock())), \
             mock.patch("requests.get", return_value=response(200)):
            call_command("verify_object_storage", stdout=out)
        self.assertIn("All checks passed", out.getvalue())

    @override_settings(**dict(CONFIGURED, S3_ENDPOINT_URL="", S3_ACCESS_KEY_ID="AKIAEXAMPLE"))
    def test_real_aws_keys_are_not_held_to_r2s_shape(self):
        out = StringIO()
        with mock.patch.dict(sys.modules, fake_boto(mock.Mock())), \
             mock.patch("requests.get", return_value=response(200)):
            call_command("verify_object_storage", stdout=out)
        self.assertIn("All checks passed", out.getvalue())
