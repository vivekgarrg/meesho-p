"""
A scanned order can now be RETURNED (the sheet says RTO* / RETURN*), distinct
from SHIPPED. Rows already stored were classified under the older rules, where
every RTO / return was "shipped", so each is re-read from the raw sheet value it
was derived from and given its proper bucket.
"""

from django.db import migrations, models


def reclassify(apps, schema_editor):
    from meesho_app.models import ScannedOrder as Live   # the rules live on the class

    ScannedOrder = apps.get_model("meesho_app", "ScannedOrder")
    changed = []
    for row in ScannedOrder.objects.exclude(ship_status_raw="").only("id", "ship_status", "ship_status_raw"):
        bucket = Live.classify_ship_status(row.ship_status_raw)
        if bucket != Live.SHIP_UNKNOWN and bucket != row.ship_status:
            row.ship_status = bucket
            changed.append(row)
    if changed:
        ScannedOrder.objects.bulk_update(changed, ["ship_status"], batch_size=500)


class Migration(migrations.Migration):

    dependencies = [
        ("meesho_app", "0069_label_pack_day"),
    ]

    operations = [
        migrations.AlterField(
            model_name="scannedorder",
            name="ship_status",
            field=models.CharField(
                choices=[("SHIPPED", "Shipped"), ("NOT_SHIPPED", "Not shipped yet"), ("CANCELLED", "Cancelled"),
                         ("UNKNOWN", "No status yet"), ("RETURNED", "Returned")],
                db_index=True, default="UNKNOWN", max_length=20),
        ),
        migrations.RunPython(reclassify, migrations.RunPython.noop),
    ]
