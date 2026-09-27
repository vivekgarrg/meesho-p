"""
Link two businesses into a shared pricing group, and (with --apply) make one
business's SKU/parent pricing catalogue authoritative for both.

    # Dry run (default) — reports exactly what would happen, changes nothing:
    python3 manage.py link_business_pricing "Rudam" "Cosmify Mart" --authoritative "Cosmify Mart"

    # Same, but actually do it:
    python3 manage.py link_business_pricing "Rudam" "Cosmify Mart" --authoritative "Cosmify Mart" --apply

Businesses may be given by exact name (case-insensitive) or numeric id.

What --apply actually does, in order:
  1. Puts both businesses in the same PricingGroup (accounts.models). From
     this point on, ParentItemPrice / FinalPrice writes to either business
     mirror to the other automatically (see meesho_app/pricing_sync.py) —
     covering every future edit, not just this one-time copy.
  2. Re-saves every ParentItemPrice and FinalPrice row belonging to the
     authoritative business, which (now that they're linked) makes that
     same sync machinery create-or-update the matching row in the OTHER
     business. Where an item_id/sku_id exists in both with different
     values, the authoritative business's values win.

What it deliberately does NOT do: delete anything. SKUs that exist only in
the non-authoritative business (not in the authoritative one) are left
exactly as they are — reported below so you can see them, not touched,
because a bulk migration is the wrong place to delete real pricing rows that
might be PROTECTed by a Product listing or referenced by real inventory /
packed-stock history. Clean those up by hand afterwards (Pricing tab ->
Delete) once you've actually looked at what's in them.

Price HISTORY entries (the "since <date>" trail in the Pricing tab) are not
copied — only current prices. Both businesses' price trajectories stay their
own; only where they end up (today's price) is kept in sync going forward.
"""

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from accounts.models import Business, PricingGroup
from meesho_app.models import FinalPrice, InventoryAdjustment, PackedStockEvent, ParentItemPrice


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
    help = "Link two businesses' SKU pricing into one shared, kept-in-sync catalogue."

    def add_arguments(self, parser):
        parser.add_argument("business_a")
        parser.add_argument("business_b")
        parser.add_argument(
            "--authoritative", required=True,
            help="Name or id of whichever of the two businesses' current pricing should win on conflicts.",
        )
        parser.add_argument(
            "--apply", action="store_true",
            help="Actually make the changes. Without this, only a report is printed.",
        )

    def handle(self, *args, **opts):
        biz_a = _resolve_business(opts["business_a"])
        biz_b = _resolve_business(opts["business_b"])
        if biz_a.pk == biz_b.pk:
            raise CommandError("Those are the same business.")

        authoritative = _resolve_business(opts["authoritative"])
        if authoritative.pk not in (biz_a.pk, biz_b.pk):
            raise CommandError('--authoritative must match one of the two businesses given.')
        other = biz_b if authoritative.pk == biz_a.pk else biz_a

        self.stdout.write(f"Authoritative: [{authoritative.pk}] {authoritative.name}")
        self.stdout.write(f"Other:         [{other.pk}] {other.name}")

        existing_groups = {b.pk: b.pricing_group_id for b in (biz_a, biz_b) if b.pricing_group_id}
        if len(set(existing_groups.values())) > 1:
            raise CommandError(
                "These two businesses are already in two DIFFERENT pricing groups "
                f"({existing_groups}) — resolve that by hand first, this command won't merge groups."
            )
        already_linked = biz_a.pricing_group_id and biz_a.pricing_group_id == biz_b.pricing_group_id

        auth_parents = {p.item_id: p for p in ParentItemPrice.objects.filter(business=authoritative)}
        other_parents = {p.item_id: p for p in ParentItemPrice.objects.filter(business=other)}

        shared_ids = sorted(set(auth_parents) & set(other_parents))
        new_to_other = sorted(set(auth_parents) - set(other_parents))
        other_only = sorted(set(other_parents) - set(auth_parents))

        conflicting = [
            item_id for item_id in shared_ids
            if (
                auth_parents[item_id].item_price != other_parents[item_id].item_price
                or auth_parents[item_id].final_price != other_parents[item_id].final_price
            )
        ]

        self.stdout.write("")
        self.stdout.write(self.style.MIGRATE_HEADING("Plan"))
        self.stdout.write(f"  Already linked: {'yes' if already_linked else 'no'}")
        self.stdout.write(f"  {authoritative.name}: {len(auth_parents)} parent SKU(s)")
        self.stdout.write(f"  {other.name}: {len(other_parents)} parent SKU(s)")
        self.stdout.write(f"  -> {len(new_to_other)} will be created in {other.name}")
        self.stdout.write(f"  -> {len(conflicting)} exist in both with a different price — {authoritative.name}'s wins")
        self.stdout.write(
            f"  -> {len(other_only)} exist only in {other.name} and will be LEFT AS-IS (not deleted, not synced)"
        )
        self._list(new_to_other, "New to " + other.name)
        self._list(conflicting, "Price will change in " + other.name)

        if other_only:
            self.stdout.write("")
            self.stdout.write(self.style.WARNING(f"  {other.name}-only SKUs — left untouched:"))
            at_risk = 0
            for item_id in other_only:
                parent = other_parents[item_id]
                has_product = hasattr(parent, "product")
                has_inventory = InventoryAdjustment.objects.filter(parent_sku=parent).exists()
                has_packed = PackedStockEvent.objects.filter(parent_sku=parent).exists()
                if has_product or has_inventory or has_packed:
                    at_risk += 1
            self._list(other_only, None)
            if at_risk:
                self.stdout.write(
                    self.style.WARNING(
                        f"    {at_risk} of those have a linked product/inventory/packed-stock record — "
                        "review before deleting any of them by hand."
                    )
                )

        if not opts["apply"]:
            self.stdout.write("")
            self.stdout.write(self.style.NOTICE("DRY RUN — nothing was changed. Re-run with --apply to execute."))
            return

        with transaction.atomic():
            if already_linked:
                group = PricingGroup.objects.get(pk=biz_a.pricing_group_id)
            else:
                group = PricingGroup.objects.filter(
                    pk__in=[b for b in (biz_a.pricing_group_id, biz_b.pricing_group_id) if b]
                ).first() or PricingGroup.objects.create(name=f"{biz_a.name} + {biz_b.name}")
                Business.objects.filter(pk__in=[biz_a.pk, biz_b.pk]).update(pricing_group=group)

            # Re-saving each row (rather than bulk .update()) is what makes
            # pricing_sync's post_save signal actually fire and propagate —
            # see pricing_sync.py's docstring on why bulk .update() can't.
            for parent in ParentItemPrice.objects.filter(business=authoritative):
                parent.save()
            for final in FinalPrice.objects.filter(business=authoritative):
                final.save()

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS(
            f"Done — {authoritative.name} and {other.name} are linked and in sync. "
            f"{len(new_to_other)} SKU(s) created in {other.name}, {len(conflicting)} price(s) updated there."
        ))

    def _list(self, ids, heading, cap=20):
        if not ids:
            return
        if heading:
            self.stdout.write(f"    {heading} ({len(ids)}):")
        shown = ids[:cap]
        self.stdout.write("      " + ", ".join(shown) + (f", … +{len(ids) - cap} more" if len(ids) > cap else ""))
