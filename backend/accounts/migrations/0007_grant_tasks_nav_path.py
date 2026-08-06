"""
Grant /tasks to already-configured access rules.

Same reasoning as 0005 and 0006: a rule is an explicit allow-list, so one
written before the Team Tasks tab existed hides it and 403s `worker-tasks/`
and `wallet/`.

Worth being explicit about what this does and does not open up. Workers are
ordinary business_user accounts, so they need /tasks to reach their own work at
all. The API scopes every read and write to the signed-in user — a worker sees
only tasks assigned to them and only their own wallet — so granting this path
does not expose anyone else's tasks, balances, or any of the business data on
the other tabs.
"""

from django.db import migrations

NEW_PATHS = ["/tasks"]

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
        ("accounts", "0006_grant_claims_nav_path"),
    ]

    operations = [
        migrations.RunPython(grant_new_paths, noop_reverse),
    ]
