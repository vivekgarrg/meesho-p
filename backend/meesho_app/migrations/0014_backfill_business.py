from django.db import migrations

MODEL_NAMES = [
    "ParentItemPrice",
    "FinalPrice",
    "OrderPayment",
    "AdsCost",
    "ParentPriceHistory",
    "ReferralPayment",
    "CompensationRecovery",
    "Order",
    "BlockedCustomer",
    "PurchaseBill",
    "PurchaseItem",
    "InventoryAdjustment",
    "ConsumableItem",
    "ConsumablePurchase",
    "ConsumableUsage",
    "InventoryLog",
    "LabelOrder",
    "MeeshoInventory",
    "MeeshoPriceUpdate",
]


def backfill_business(apps, schema_editor):
    Business = apps.get_model("accounts", "Business")
    business, _ = Business.objects.get_or_create(name="Rudam", defaults={"is_active": True})

    for model_name in MODEL_NAMES:
        Model = apps.get_model("meesho_app", model_name)
        Model.objects.filter(business__isnull=True).update(business_id=business.id)


def noop_reverse(apps, schema_editor):
    # Not reversible in place — backfilling business_id is a one-way data fix.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("meesho_app", "0013_delete_meeshostockitem_adscost_business_and_more"),
        ("accounts", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(backfill_business, noop_reverse),
    ]
