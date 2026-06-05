from django.db import migrations, models


class Migration(migrations.Migration):
    """
    Creates the `orders` table.
    Missing from MySQL because original migrations were applied before
    the Order model was added.
    """

    dependencies = [
        ("meesho_app", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="Order",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("reason_for_credit_entry", models.CharField(blank=True, max_length=50, null=True)),
                ("sub_order_no", models.CharField(db_index=True, max_length=100)),
                ("catalog_id", models.BigIntegerField(blank=True, null=True)),
                ("order_date", models.DateField(blank=True, null=True)),
                ("order_source", models.CharField(blank=True, max_length=100, null=True)),
                ("customer_state", models.CharField(blank=True, max_length=100, null=True)),
                ("product_name", models.TextField(blank=True, null=True)),
                ("sku", models.CharField(blank=True, max_length=255, null=True)),
                ("size", models.CharField(blank=True, max_length=50, null=True)),
                ("quantity", models.PositiveIntegerField(default=1)),
                ("supplier_listed_price", models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True)),
                ("supplier_discounted_price", models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True)),
                ("packet_id", models.CharField(blank=True, max_length=100, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "db_table": "orders",
                "ordering": ["-order_date"],
                "unique_together": {("sub_order_no", "reason_for_credit_entry", "order_date")},
            },
        ),
    ]
