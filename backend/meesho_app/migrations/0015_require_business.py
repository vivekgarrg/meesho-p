import django.db.models.deletion
from django.db import migrations, models

MODEL_NAMES = [
    "adscost",
    "blockedcustomer",
    "compensationrecovery",
    "consumableitem",
    "consumablepurchase",
    "consumableusage",
    "finalprice",
    "inventoryadjustment",
    "inventorylog",
    "labelorder",
    "meeshoinventory",
    "meeshopriceupdate",
    "order",
    "orderpayment",
    "parentitemprice",
    "parentpricehistory",
    "purchasebill",
    "purchaseitem",
    "referralpayment",
]


class Migration(migrations.Migration):

    dependencies = [
        ("meesho_app", "0014_backfill_business"),
        ("accounts", "0001_initial"),
    ]

    operations = [
        migrations.AlterField(
            model_name=model_name,
            name="business",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, to="accounts.business"
            ),
        )
        for model_name in MODEL_NAMES
    ]
