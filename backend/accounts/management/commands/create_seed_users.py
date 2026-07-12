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
        parser.add_argument("--admin-password", default=os.environ.get("SEED_ADMIN_PASSWORD", "changeme123"))
        parser.add_argument("--business-username", default="rudam_user")
        parser.add_argument(
            "--business-password", default=os.environ.get("SEED_BUSINESS_USER_PASSWORD", "changeme123")
        )
        parser.add_argument("--business-name", default="Rudam")

    @transaction.atomic
    def handle(self, *args, **options):
        business, created = Business.objects.get_or_create(
            name=options["business_name"], defaults={"is_active": True}
        )
        self.stdout.write(
            self.style.SUCCESS(f"Business '{business.name}' (id={business.id}) "
                                + ("created" if created else "already existed"))
        )

        admin_user, created = User.objects.get_or_create(
            username=options["admin_username"],
            defaults={"role": User.ROLE_SUPER_ADMIN, "is_staff": True, "is_superuser": True},
        )
        if created:
            admin_user.set_password(options["admin_password"])
            admin_user.role = User.ROLE_SUPER_ADMIN
            admin_user.is_staff = True
            admin_user.is_superuser = True
            admin_user.save()
            self.stdout.write(self.style.SUCCESS(f"Super admin '{admin_user.username}' created"))
        else:
            self.stdout.write(f"Super admin '{admin_user.username}' already existed")

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
