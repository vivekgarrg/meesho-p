from django.db import migrations, models


def to_15(apps, schema_editor):
    # Completed payments are now read for the last 15 days; a setting still on
    # the old default (30) follows, one changed on purpose is kept.
    apps.get_model("meesho_app", "MeeshoSyncSetting").objects.filter(payments_paid_days=30).update(payments_paid_days=15)


def back_to_30(apps, schema_editor):
    apps.get_model("meesho_app", "MeeshoSyncSetting").objects.filter(payments_paid_days=15).update(payments_paid_days=30)


class Migration(migrations.Migration):
    dependencies = [("meesho_app", "0085_order_payment_updated_at")]

    operations = [
        migrations.AlterField(model_name="meeshosyncsetting", name="payments_paid_days",
                              field=models.PositiveIntegerField(default=15)),
        migrations.RunPython(to_15, back_to_30),
    ]
