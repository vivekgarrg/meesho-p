from django.db import migrations


class Migration(migrations.Migration):
    """
    No-op.

    Historically this migration created the `orders` table, because the
    original `0001_initial` was applied before the Order model existed.
    `0001_initial` has since been regenerated to include the Order model,
    so it now creates the `orders` table itself. Running the CreateModel
    here as well collides on a fresh database ("table orders already
    exists").

    This migration is kept (rather than deleted) so the dependency chain
    and any already-recorded `django_migrations` rows stay valid. It is
    intentionally empty: on environments where 0002 was already applied,
    nothing changes; on fresh databases, 0001_initial handles the table.
    """

    dependencies = [
        ("meesho_app", "0001_initial"),
    ]

    operations = []
