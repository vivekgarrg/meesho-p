import os

from django.core.management.base import BaseCommand
from django.db import transaction

from accounts.models import Business, Membership, User


class Command(BaseCommand):
    help = (
        "Seeds the default business (Rudam) plus one super_admin and one "
        "business_user account for initial rollout. Idempotent - safe to re-run."
    )

    def add_arguments(self, parser):
        parser.add_argument("--admin-username", default="admin")
        parser.add_argument("--admin-password", default=os.environ.get("SEED_ADMIN_PASSWORD", "Vivek@123"))
        parser.add_argument("--business-username", default="rudam_user")
        parser.add_argument(
            "--business-password", default=os.environ.get("SEED_BUSINESS_USER_PASSWORD", "changeme123")
        )
        # Re-setting an existing admin's password is now opt-in.
        #
        # This command runs on every deploy (see deploy/hostinger/update.sh), and
        # it used to reset the admin password unconditionally — so changing your
        # password in the app was silently undone by the next push. A password
        # you chose must outlive a deploy.
        #
        # Use --force-password (or SEED_ADMIN_FORCE_PASSWORD=true) for the one
        # case the old behaviour was there for: being locked out and needing the
        # documented credentials back.
        parser.add_argument(
            "--force-password",
            action="store_true",
            default=os.environ.get("SEED_ADMIN_FORCE_PASSWORD", "").lower() in ("1", "true", "yes"),
            help="Reset the admin password even if the account already exists.",
        )
        parser.add_argument("--business-name", default="Rudam")
        # Extra businesses to ensure exist (in addition to --business-name).
        parser.add_argument("--extra-businesses", nargs="*", default=["Rudam 2"])

    @transaction.atomic
    def handle(self, *args, **options):
        business, created = Business.objects.get_or_create(
            name=options["business_name"], defaults={"is_active": True}
        )
        self.stdout.write(
            self.style.SUCCESS(f"Business '{business.name}' (id={business.id}) "
                                + ("created" if created else "already existed"))
        )

        for extra_name in options["extra_businesses"]:
            extra, created = Business.objects.get_or_create(
                name=extra_name, defaults={"is_active": True}
            )
            self.stdout.write(
                self.style.SUCCESS(f"Business '{extra.name}' (id={extra.id}) "
                                    + ("created" if created else "already existed"))
            )

        admin_user, created = User.objects.get_or_create(
            username=options["admin_username"],
            defaults={"role": User.ROLE_SUPER_ADMIN, "is_staff": True, "is_superuser": True},
        )
        # Password is set when the account is first created, and after that only
        # on explicit request. The role/staff flags are still enforced every run:
        # those are what make the account usable at all, and unlike a password
        # nobody deliberately changes them.
        set_password = created or options["force_password"]
        if set_password:
            admin_user.set_password(options["admin_password"])
        admin_user.role = User.ROLE_SUPER_ADMIN
        admin_user.is_staff = True
        admin_user.is_superuser = True
        admin_user.save()
        self.stdout.write(
            self.style.SUCCESS(
                f"Super admin '{admin_user.username}' "
                + ("created (password set)" if created
                   else "password reset (--force-password)" if set_password
                   else "already existed — password left unchanged")
            )
        )

        biz_user, created = User.objects.get_or_create(
            username=options["business_username"],
            defaults={"role": User.ROLE_BUSINESS_USER},
        )
        if created:
            biz_user.set_password(options["business_password"])
            biz_user.role = User.ROLE_BUSINESS_USER
            biz_user.save()
            self.stdout.write(self.style.SUCCESS(f"Business user '{biz_user.username}' created"))
        else:
            self.stdout.write(f"Business user '{biz_user.username}' already existed")

        _, created = Membership.objects.get_or_create(user=biz_user, business=business)
        if created:
            self.stdout.write(self.style.SUCCESS(f"Membership: {biz_user.username} -> {business.name} created"))
        else:
            self.stdout.write(f"Membership: {biz_user.username} -> {business.name} already existed")
