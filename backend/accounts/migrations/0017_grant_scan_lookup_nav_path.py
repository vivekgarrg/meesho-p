"""
Grant /scan-lookup to already-configured access rules.

Same reasoning as 0005-0013: a rule is an explicit allow-list, so one written
before the Listing Lookup tab existed hides it and 403s `order-scan/lookup/`.
Only people who can already use Order Scan get it — the lookup is the same
desk, scanning the same codes.
"""

from django.db import migrations

NEW_PATHS = ["/scan-lookup"]
GATE_PATH = "/order-scan"

_MODELS = ["NavVisibilitySetting", "BusinessProfile", "UserAccess"]


def grant_new_paths(apps, schema_editor):
    for model_name in _MODELS:
        model = apps.get_model("accounts", model_name)
        for row in model.objects.all():
            current = list(row.visible_paths or [])
            if not current or GATE_PATH not in current:
                continue  # unconfigured → already unrestricted; or no Order Scan access
            missing = [p for p in NEW_PATHS if p not in current]
            if not missing:
                continue
            row.visible_paths = current + missing
            row.save(update_fields=["visible_paths"])


def noop_reverse(apps, schema_editor):
    """See 0005 — revoking a tab someone may have deliberately enabled is worse."""


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0016_businessprofile_deduct_owner_spent"),
    ]

    operations = [
        migrations.RunPython(grant_new_paths, noop_reverse),
    ]
