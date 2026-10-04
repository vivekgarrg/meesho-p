"""
End-to-end check of the R2 / S3 bucket, run on whatever machine holds the
credentials:

    python manage.py verify_object_storage

Walks the whole round trip a listing image makes — sign, upload, read back
over the PUBLIC url, delete — and names the exact step that failed. The public
read is the one most likely to be missing: the S3 API endpoint is for writing,
and objects are not readable until an R2 custom domain is connected, so a
bucket that uploads perfectly can still hand Meesho a url it cannot fetch.
"""

import re
import uuid

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Verify the configured object storage bucket can be written, read publicly, and deleted."

    def add_arguments(self, parser):
        parser.add_argument(
            "--keep", action="store_true",
            help="Leave the probe object behind instead of deleting it.",
        )

    def handle(self, *args, **options):
        ok = self.style.SUCCESS
        bad = self.style.ERROR
        warn = self.style.WARNING

        # ── config ───────────────────────────────────────────────────────────
        # S3_ENDPOINT_URL is not required: it is blank for plain AWS, and
        # settings.OBJECT_STORAGE_READY / object_storage treat it as optional
        # too — this must agree with them, or it rejects setups that work.
        missing = [
            name for name in (
                "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_PUBLIC_BASE_URL",
            )
            if not getattr(settings, name, "")
        ]
        if missing:
            raise CommandError(
                "Not configured — these are unset: " + ", ".join(missing)
                + "\nSet them in deploy/hostinger/.env (server) or your local shell. "
                  "See deploy/hostinger/.env.example."
            )
        # Same shape check the app itself uses (object_storage), so this and
        # the cropper can never disagree about whether the keys are usable.
        from meesho_app import object_storage
        problems = object_storage._r2_shape_problems()
        if problems:
            raise CommandError(
                "These don't look like R2 S3 credentials:\n  - " + "\n  - ".join(problems)
                + "\n" + object_storage.R2_KEY_HINT
            )
        self.stdout.write(ok("config      ✓ settings present"))
        self.stdout.write(f"  bucket      {settings.S3_BUCKET}")
        self.stdout.write(f"  endpoint    {settings.S3_ENDPOINT_URL or '(AWS default)'}")
        self.stdout.write(f"  public url  {settings.S3_PUBLIC_BASE_URL}")
        self.stdout.write(f"  region      {settings.S3_REGION}")

        try:
            import boto3
            from botocore.exceptions import ClientError
        except ImportError:
            raise CommandError("boto3 is not installed — pip install -r requirements.txt")

        client = boto3.client(
            "s3",
            endpoint_url=settings.S3_ENDPOINT_URL or None,
            aws_access_key_id=settings.S3_ACCESS_KEY_ID,
            aws_secret_access_key=settings.S3_SECRET_ACCESS_KEY,
            region_name=settings.S3_REGION,
        )

        key = f"_probe/{uuid.uuid4().hex}.txt"
        body = b"rudam object storage probe"
        failures = []

        # ── write ────────────────────────────────────────────────────────────
        try:
            client.put_object(Bucket=settings.S3_BUCKET, Key=key, Body=body,
                              ContentType="text/plain")
            self.stdout.write(ok(f"write       ✓ put {key}"))
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "?")
            hint = {
                "NoSuchBucket": "the bucket name is wrong, or the token is scoped to a different bucket",
                "InvalidAccessKeyId": "the access key id is wrong",
                "SignatureDoesNotMatch": "the secret access key is wrong",
                "AccessDenied": "the API token lacks Object Read & Write on this bucket",
            }.get(code, "")
            raise CommandError(f"write failed ({code}){' — ' + hint if hint else ''}\n{exc}")
        except Exception as exc:
            raise CommandError(f"write failed — could not reach the endpoint at all\n{exc}")

        # ── presigned read, which is what the browser upload path relies on ──
        try:
            client.generate_presigned_url(
                "put_object",
                Params={"Bucket": settings.S3_BUCKET, "Key": key, "ContentType": "image/jpeg"},
                ExpiresIn=300,
            )
            self.stdout.write(ok("presign     ✓ can sign a browser upload url"))
        except Exception as exc:
            failures.append(f"presign failed: {exc}")
            self.stdout.write(bad(f"presign     ✗ {exc}"))

        # ── public read: the step most likely to be missing ──────────────────
        public_url = f"{settings.S3_PUBLIC_BASE_URL}/{key}"
        try:
            import requests
            res = requests.get(public_url, timeout=20)
            if res.status_code == 200 and res.content == body:
                self.stdout.write(ok(f"public read ✓ {public_url}"))
            else:
                failures.append(f"public read returned HTTP {res.status_code}")
                self.stdout.write(bad(f"public read ✗ HTTP {res.status_code} at {public_url}"))
                self.stdout.write(warn(
                    "  The bucket is private, or S3_PUBLIC_BASE_URL is not pointing at it.\n"
                    "  Cloudflare > R2 > bucket > Settings > Public access > Connect Domain,\n"
                    "  then set S3_PUBLIC_BASE_URL to that domain. Marketplaces fetch these\n"
                    "  urls server-side, so a private bucket breaks every generated listing."
                ))
        except Exception as exc:
            failures.append(f"public read failed: {exc}")
            self.stdout.write(bad(f"public read ✗ {exc}"))

        # ── delete ───────────────────────────────────────────────────────────
        if options["keep"]:
            self.stdout.write(warn(f"delete      – kept {key} (--keep)"))
        else:
            try:
                client.delete_object(Bucket=settings.S3_BUCKET, Key=key)
                self.stdout.write(ok("delete      ✓ probe object removed"))
            except Exception as exc:
                failures.append(f"delete failed: {exc}")
                self.stdout.write(bad(f"delete      ✗ {exc}"))

        if failures:
            raise CommandError(
                f"{len(failures)} check(s) failed:\n  - " + "\n  - ".join(failures)
            )
        self.stdout.write(ok("\nAll checks passed — the bucket is ready for listing images."))
