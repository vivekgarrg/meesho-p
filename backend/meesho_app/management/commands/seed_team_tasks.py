"""
Demo data for the Team Tasks screen.

The screen only really shows itself once there is a task in every state it can
be in — SKUs waiting, SKUs rejected, SKUs already paid for, a paused task, a
claim awaiting review. Clicking that together by hand takes ten minutes and is
never quite the same twice, so it lives here instead.

    DB_ENGINE=mysql python3 manage.py seed_team_tasks               # business 1
    DB_ENGINE=mysql python3 manage.py seed_team_tasks --business 3
    DB_ENGINE=mysql python3 manage.py seed_team_tasks --clear       # remove it

Everything it writes is tagged with DEMO_TAG in the task title, and --clear
deletes exactly and only those tasks (and the wallet lines hanging off them),
so it can never touch real work.
"""

from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from accounts.models import Business, User
from meesho_app.models import (
    PlatformRate, TaskListing, WalletEntry, WorkerTask,
)

DEMO_TAG = "[demo]"


class Command(BaseCommand):
    help = "Create (or remove) demo Team Tasks data for a business."

    def add_arguments(self, parser):
        parser.add_argument("--business", type=int, default=1,
                            help="Business id to seed. Defaults to 1.")
        parser.add_argument("--clear", action="store_true",
                            help="Delete the demo tasks instead of creating them.")

    def handle(self, *args, **opts):
        try:
            business = Business.objects.get(pk=opts["business"])
        except Business.DoesNotExist:
            raise CommandError(f"No business with id {opts['business']}.")

        if opts["clear"]:
            return self._clear(business)

        workers = list(
            User.objects.filter(memberships__business=business)
            .exclude(role=User.ROLE_SUPER_ADMIN).distinct().order_by("pk")
        )
        if not workers:
            raise CommandError(
                f"'{business.name}' has no non-admin members, so there is "
                "nobody to assign demo tasks to. Add a member first."
            )
        admin = User.objects.filter(role=User.ROLE_SUPER_ADMIN).first()
        # Two named workers make the "by <name>" lines and the wallet table read
        # properly; one member is fine, they just do all of it.
        a = workers[0]
        b = workers[1] if len(workers) > 1 else workers[0]

        with transaction.atomic():
            self._clear(business, quiet=True)
            self._rates(business)
            self._seed(business, admin, a, b)

        self.stdout.write(self.style.SUCCESS(
            f"Seeded demo Team Tasks for '{business.name}' "
            f"(assigned to {a.username} / {b.username}). "
            f"Remove with: manage.py seed_team_tasks --business {business.pk} --clear"
        ))

    # ── helpers ──────────────────────────────────────────────────────────────

    def _clear(self, business, quiet=False):
        tasks = WorkerTask.objects.filter(business=business, title__startswith=DEMO_TAG)
        n = tasks.count()
        # Wallet entries are PROTECTed against the user but only SET_NULL against
        # the task, so they'd survive as orphans — drop the demo ones explicitly.
        WalletEntry.objects.filter(task__in=tasks).delete()
        TaskListing.objects.filter(task__in=tasks).delete()
        tasks.delete()
        if not quiet:
            self.stdout.write(self.style.SUCCESS(f"Removed {n} demo tasks."))

    def _rates(self, business):
        """A standing rate per platform, so 'New task' can suggest one."""
        for platform, listing_rate, claim_rate, bonus in [
            ("MEESHO", 12, 25, 15),
            ("AMAZON", 15, 30, 20),
            ("FLIPKART", 10, 20, 10),
        ]:
            PlatformRate.objects.update_or_create(
                business=business, platform=platform,
                task_type=WorkerTask.TYPE_LISTING, user=None,
                defaults={"reward_amount": Decimal(listing_rate), "bonus_amount": Decimal(0)},
            )
            PlatformRate.objects.update_or_create(
                business=business, platform=platform,
                task_type=WorkerTask.TYPE_RETURN_CLAIM, user=None,
                defaults={"reward_amount": Decimal(claim_rate), "bonus_amount": Decimal(bonus)},
            )

    def _seed(self, business, admin, a, b):
        now = timezone.now()

        def task(**kw):
            assignees = kw.pop("assignees")
            t = WorkerTask.objects.create(business=business, created_by=admin, **kw)
            t.assignees.set(assignees)
            return t

        def sku(t, sku_id, status, by, comment="", paid=False, **over):
            fields = {
                "listing_price": Decimal("499.00"), "mrp": Decimal("999.00"),
                "wrong_defective_price": Decimal("150.00"),
                "min_settlement_amount": Decimal("380.00"),
                "hsn_code": "7323", "tax_percent": Decimal("18.00"),
                "sku_prefix": t.listing_defaults.get("sku_prefix", ""),
            }
            fields.update(over)
            listing = TaskListing.objects.create(
                business=business, task=t, created_by=by, sku_id=sku_id,
                status=status, review_comment=comment,
                reviewed_by=admin if status != TaskListing.STATUS_PENDING else None,
                reviewed_at=now if status != TaskListing.STATUS_PENDING else None,
                reward_amount=t.reward_amount,
                reward_credited_at=now if paid else None,
                **fields,
            )
            if paid:
                WalletEntry.objects.create(
                    business=business, user=by, task=t, listing=listing,
                    kind=WalletEntry.KIND_LISTING, amount=t.reward_amount,
                    note=f"{DEMO_TAG} approved {sku_id}", created_by=admin,
                )
            return listing

        # 1 ── The headline case: a live listing task mid-flight, with a SKU in
        #      every state so the grouped list has something in each band.
        t1 = task(
            task_type=WorkerTask.TYPE_LISTING, platform="MEESHO",
            title=f"{DEMO_TAG} Brass lota — festive photoshoot",
            instructions="Download the photos, edit them, create the listings, "
                         "then add each SKU below.",
            source_link="https://drive.google.com/drive/folders/demo-brass",
            reward_amount=Decimal("12.00"), assignees=[a, b],
            listing_defaults={
                "sku_prefix": "BRS-", "listing_price": "499.00", "mrp": "999.00",
                "hsn_code": "7323", "tax_percent": "18",
                "wrong_defective_price": "150.00", "min_settlement_amount": "380.00",
            },
        )
        sku(t1, "BRS-001", TaskListing.STATUS_APPROVED, a, "Looks right.", paid=True)
        sku(t1, "BRS-002", TaskListing.STATUS_REJECTED, b,
            "MRP is wrong — it should be 999, not 899.", mrp=Decimal("899.00"))
        sku(t1, "BRS-003", TaskListing.STATUS_PENDING, a)
        sku(t1, "BRS-004", TaskListing.STATUS_PENDING, b)

        # 2 ── Nothing added yet: the empty state a worker lands on, and the one
        #      the "generate a SKU" flow has to make obvious.
        task(
            task_type=WorkerTask.TYPE_LISTING, platform="AMAZON",
            title=f"{DEMO_TAG} Copper bottle — new range",
            instructions="Five variants. Generate the SKU ids in order.",
            source_link="https://drive.google.com/drive/folders/demo-copper",
            reward_amount=Decimal("15.00"), assignees=[a],
            listing_defaults={"sku_prefix": "CPR-", "listing_price": "899.00",
                              "mrp": "1499.00", "hsn_code": "7418", "tax_percent": "18"},
        )

        # 3 ── Paused: proves existing SKUs stay readable while the add box is
        #      replaced by the reason it's gone.
        t3 = task(
            task_type=WorkerTask.TYPE_LISTING, platform="FLIPKART",
            title=f"{DEMO_TAG} Steel tiffin — on hold",
            instructions="Paused until the new photos land.",
            reward_amount=Decimal("10.00"), assignees=[b], is_paused=True, paused_at=now,
            listing_defaults={"sku_prefix": "STL-", "listing_price": "349.00",
                              "mrp": "699.00", "hsn_code": "7323", "tax_percent": "12"},
        )
        sku(t3, "STL-001", TaskListing.STATUS_APPROVED, b, paid=True,
            listing_price=Decimal("349.00"), mrp=Decimal("699.00"))
        sku(t3, "STL-002", TaskListing.STATUS_PENDING, b,
            listing_price=Decimal("349.00"), mrp=Decimal("699.00"))

        # 4 ── A claim waiting on the admin — the other half of the review flow.
        task(
            task_type=WorkerTask.TYPE_RETURN_CLAIM, platform="MEESHO",
            title=f"{DEMO_TAG} Claim — damaged return",
            instructions=f"Download the video, compress under "
                         f"{WorkerTask.CLAIM_VIDEO_MAX_MB}MB, raise the claim.",
            source_link="https://drive.google.com/file/d/demo-claim",
            suborder_no="3078123456_1", reward_amount=Decimal("25.00"),
            bonus_amount=Decimal("15.00"), assignees=[a],
            status=WorkerTask.STATUS_SUBMITTED, submitted_reference="TKT-88213",
            submitted_note="Raised, awaiting Meesho.", submitted_by=a, submitted_at=now,
        )

        # 5 ── A finished claim, so the collapsed/approved styling has a subject.
        t5 = task(
            task_type=WorkerTask.TYPE_RETURN_CLAIM, platform="MEESHO",
            title=f"{DEMO_TAG} Claim — wrong item returned",
            suborder_no="3078987654_2", reward_amount=Decimal("25.00"),
            bonus_amount=Decimal("15.00"), assignees=[b],
            status=WorkerTask.STATUS_APPROVED, submitted_reference="TKT-88101",
            submitted_by=b, submitted_at=now, reviewed_by=admin, reviewed_at=now,
            review_comment="Claim went up, bonus follows if Meesho accepts it.",
        )
        WalletEntry.objects.create(
            business=business, user=b, task=t5, kind=WalletEntry.KIND_CLAIM_RAISED,
            amount=t5.reward_amount, note=f"{DEMO_TAG} claim raised", created_by=admin,
        )
