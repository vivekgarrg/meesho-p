from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("meesho_app", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="FinalPrice",
            fields=[
                (
                    "sku_id",
                    models.CharField(max_length=200, primary_key=True, serialize=False, unique=True),
                ),
                ("item_price", models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
                ("tax_percent", models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
                ("packaging_cost", models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
                ("final_price", models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
            ],
            options={
                "db_table": "final_price",
                "ordering": ["sku_id"],
            },
        ),
    ]
