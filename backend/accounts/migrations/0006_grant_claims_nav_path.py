"""
Grant /claims to already-configured access rules.

Same reasoning as 0005: a rule is an explicit allow-list, so one written before
the Claim Sheet tab existed hides it and 403s `claims/`. A path that did not
exist when a rule was saved cannot have been deliberately excluded from it.

Kept as its own migration rather than editing 0005 because that one has already
been applied — changing it would silently do nothing on any database that ran it.
"""

from django.db import migrations

NEW_PATHS = ["/claims"]

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
        ("accounts", "0005_grant_new_nav_paths"),
    ]

    operations = [
        migrations.RunPython(grant_new_paths, noop_reverse),
    ]
