"""
Grant /return-analysis to already-configured access rules.

Same reasoning as 0005-0011: a rule is an explicit allow-list, so one written
before the Return Analysis tab existed hides it and 403s `returns/analysis/`.
"""

from django.db import migrations

NEW_PATHS = ["/return-analysis"]

_MODELS = ["NavVisibilitySetting", "BusinessProfile", "UserAccess"]


def grant_new_paths(apps, schema_editor):
    for model_name in _MODELS:
        model = apps.get_model("accounts", model_name)
        for row in model.objects.all():
            current = list(row.visible_paths or [])
            if not current:
                continue  # unconfigured → already unrestricted
            missing = [p for p in NEW_PATHS if p not in current]
            if not missing:
                continue
            row.visible_paths = current + missing
            row.save(update_fields=["visible_paths"])


def noop_reverse(apps, schema_editor):
    """See 0005 — revoking a tab someone may have deliberately enabled is worse."""


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0011_grant_bulk_labels_nav_path"),
    ]

    operations = [
        migrations.RunPython(grant_new_paths, noop_reverse),
    ]
