"""
Grant the nav paths added in this release to every already-configured rule.

Why this is needed at all: an access rule is an explicit allow-list, so a rule
saved before a tab existed silently hides that tab forever — and, because
API_OWNERSHIP maps endpoints to nav paths, also 403s its API. Shipping a new
screen would therefore work for super admins (who bypass the rules) and be
invisible to everyone else, which reads as "it works for me but not my team".

The reasoning that makes this safe: a path that did not exist when a rule was
written cannot have been *deliberately* excluded from it. So granting brand-new
paths respects the admin's intent rather than overriding it. Rules are only
touched when they are already non-empty — an empty rule means "not configured,
nothing is restricted", and adding paths there would turn an unrestricted
install into a restricted one.

This does not normalise ordering, because every read path already runs the
stored list through nav.clean_paths().
"""

from django.db import migrations

# Paths introduced alongside this migration.
NEW_PATHS = ["/order-scan", "/extension"]

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
    """
    Deliberately not removing the paths again: by the time anyone rolls back, an
    admin may have made these tabs visible on purpose, and revoking that is worse
    than leaving a rule slightly wider than it was.
    """


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0004_businessprofile_visible_paths_useraccess"),
    ]

    operations = [
        migrations.RunPython(grant_new_paths, noop_reverse),
    ]
