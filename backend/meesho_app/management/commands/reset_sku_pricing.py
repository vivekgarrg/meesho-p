"""
Clear a business's own SKU/parent pricing rows that AREN'T currently shared
with a linked pricing partner — "start this business's pricing fresh, keep
only what's synced in from its pricing group." The natural follow-up to
link_business_pricing: after linking, this is how you clean up whatever
pricing a business had on its own before joining the group.

    # Dry run (default) — reports exactly what would be removed, changes nothing:
    python3 manage.py reset_sku_pricing "Rudam"

    # Actually delete:
    python3 manage.py reset_sku_pricing "Rudam" --apply

Business may be given by exact name (case-insensitive) or numeric id.

If the business isn't in a pricing group at all, "shared" is an empty set,
so this removes every SKU pricing row it has — the command still requires
--apply and still lists everything first, same as when it is linked.

Refuses to run on a protected business (see PROTECTED_BUSINESSES below) —
the shared source of truth for a pricing group should never be reset this
way, only the businesses that sync from it.

Never deletes anything PROTECTed by a real Product listing (Django would
refuse anyway) — those rows are reported, not silently skipped without
explanation, so you know to deal with the Product first if you actually
want that SKU gone.
"""

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models.deletion import ProtectedError

from accounts.models import Business
from meesho_app.models import FinalPrice, InventoryAdjustment, PackedStockEvent, ParentItemPrice

# Names (case-insensitive) this command refuses to touch — the authoritative
# side of a pricing group. Add to this set if another business ever takes on
# that role.
PROTECTED_BUSINESSES = {"cosmify mart"}


def _resolve_business(identifier):
    identifier = identifier.strip()
    if identifier.isdigit():
        try:
            return Business.objects.get(pk=int(identifier), is_active=True)
        except Business.DoesNotExist:
            raise CommandError(f"No active business with id {identifier}.")
    matches = list(Business.objects.filter(name__iexact=identifier, is_active=True))
    if not matches:
        raise CommandError(f'No active business named "{identifier}". Use its exact name or numeric id.')
    if len(matches) > 1:
        ids = ", ".join(str(b.id) for b in matches)
        raise CommandError(f'More than one active business is named "{identifier}" (ids: {ids}) — use the id instead.')
    return matches[0]


class Command(BaseCommand):
    help = "Remove a business's own SKU pricing that isn't shared with a linked pricing partner."

    def add_arguments(self, parser):
        parser.add_argument("business")
        parser.add_argument("--apply", action="store_true", help="Actually delete. Without this, only a report is printed.")

    def handle(self, *args, **opts):
        business = _resolve_business(opts["business"])
        if business.name.strip().lower() in PROTECTED_BUSINESSES:
            raise CommandError(
                f'"{business.name}" is a protected pricing source and cannot be reset with this command.'
            )

        shared_item_ids = set()
        shared_sku_ids = set()
        if business.pricing_group_id:
            siblings = Business.objects.filter(
                pricing_group_id=business.pricing_group_id, is_active=True
            ).exclude(pk=business.pk)
            for sib in siblings:
                shared_item_ids |= set(ParentItemPrice.objects.filter(business=sib).values_list("item_id", flat=True))
                shared_sku_ids |= set(FinalPrice.objects.filter(business=sib).values_list("sku_id", flat=True))

        parents_to_remove = list(
            ParentItemPrice.objects.filter(business=business).exclude(item_id__in=shared_item_ids)
        )
        finals_to_remove = list(
            FinalPrice.objects.filter(business=business).exclude(sku_id__in=shared_sku_ids)
        )
        kept_parents = ParentItemPrice.objects.filter(business=business, item_id__in=shared_item_ids).count()
        kept_finals = FinalPrice.objects.filter(business=business, sku_id__in=shared_sku_ids).count()

        self.stdout.write(f"Business: [{business.pk}] {business.name}")
        if not business.pricing_group_id:
            self.stdout.write(self.style.WARNING("  Not in a pricing group — nothing counts as \"shared\", so this removes everything."))
        self.stdout.write("")
        self.stdout.write(self.style.MIGRATE_HEADING("Plan"))
        self.stdout.write(f"  {len(parents_to_remove)} parent SKU(s) to remove, {kept_parents} kept (shared)")
        self.stdout.write(f"  {len(finals_to_remove)} child SKU(s) to remove, {kept_finals} kept (shared)")

        protected = []
        removable = []
        for p in parents_to_remove:
            if hasattr(p, "product"):
                protected.append(p)
            else:
                removable.append(p)

        at_risk = [
            p for p in removable
            if InventoryAdjustment.objects.filter(parent_sku=p).exists()
            or PackedStockEvent.objects.filter(parent_sku=p).exists()
        ]

        self._list("Parent SKUs to remove", [p.item_id for p in removable])
        self._list("Child SKUs to remove", [f.sku_id for f in finals_to_remove])
        if protected:
            self.stdout.write("")
            self.stdout.write(self.style.WARNING(
                f"  {len(protected)} parent SKU(s) have a linked Product listing and will be LEFT IN PLACE "
                "(Django won't let this delete them):"
            ))
            self._list(None, [p.item_id for p in protected])
        if at_risk:
            self.stdout.write("")
            self.stdout.write(self.style.WARNING(
                f"  {len(at_risk)} of the removable parent SKU(s) have real inventory-adjustment or "
                "packed-stock records tied to them — deleting the SKU deletes those records too:"
            ))
            self._list(None, [p.item_id for p in at_risk])

        if not opts["apply"]:
            self.stdout.write("")
            self.stdout.write(self.style.NOTICE("DRY RUN — nothing was changed. Re-run with --apply to execute."))
            return

        removed_parents = 0
        skipped_protected = 0
        with transaction.atomic():
            for f in finals_to_remove:
                f.delete()
            for p in removable:
                try:
                    p.delete()
                    removed_parents += 1
                except ProtectedError:
                    skipped_protected += 1

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS(
            f"Done — removed {removed_parents} parent SKU(s) and {len(finals_to_remove)} child SKU(s) from {business.name}."
            + (f" {skipped_protected} were protected and left in place." if skipped_protected else "")
        ))

    def _list(self, heading, ids, cap=30):
        if not ids:
            return
        if heading:
            self.stdout.write(f"    {heading} ({len(ids)}):")
        shown = ids[:cap]
        self.stdout.write("      " + ", ".join(shown) + (f", … +{len(ids) - cap} more" if len(ids) > cap else ""))
