from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("meesho_app", "0075_meesho_orders_changed_at"),
    ]

    operations = [
        migrations.CreateModel(
            name="MeeshoCatalog",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("catalog_id", models.BigIntegerField()),
                ("name", models.CharField(blank=True, max_length=500)),
                ("category", models.CharField(blank=True, max_length=255)),
                ("image_url", models.TextField(blank=True)),
                ("in_active", models.BooleanField(default=False)),
                ("in_paused", models.BooleanField(default=False)),
                ("in_pending", models.BooleanField(default=False)),
                ("sku_count", models.IntegerField(default=0)),
                ("active_count", models.IntegerField(default=0)),
                ("archived_count", models.IntegerField(default=0)),
                ("blocked_count", models.IntegerField(default=0)),
                ("out_of_stock_count", models.IntegerField(default=0)),
                ("low_stock_count", models.IntegerField(default=0)),
                ("expected_live_at", models.DateTimeField(blank=True, null=True)),
                ("live_delayed", models.BooleanField(default=False)),
                ("seen_at", models.DateTimeField()),
                ("products_fetched_at", models.DateTimeField(blank=True, null=True)),
                ("account", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="catalogs", to="meesho_app.meeshoaccount")),
            ],
            options={"db_table": "meesho_inventory_catalogs", "unique_together": {("account", "catalog_id")}},
        ),
        migrations.CreateModel(
            name="MeeshoListing",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("product_id", models.BigIntegerField()),
                ("variation_id", models.BigIntegerField()),
                ("sku_id", models.CharField(db_index=True, max_length=255)),
                ("name", models.TextField(blank=True)),
                ("variation", models.CharField(blank=True, max_length=255)),
                ("image_url", models.TextField(blank=True)),
                ("inventory", models.IntegerField(blank=True, null=True)),
                ("selling_price", models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
                ("archived", models.BooleanField(default=False)),
                ("archived_at", models.CharField(blank=True, max_length=40)),
                ("out_of_stock_since", models.CharField(blank=True, max_length=40)),
                ("seen_at", models.DateTimeField()),
                ("account", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="listings", to="meesho_app.meeshoaccount")),
                ("catalog", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="listings", to="meesho_app.meeshocatalog")),
            ],
            options={"db_table": "meesho_inventory_listings", "unique_together": {("account", "product_id", "variation_id")}},
        ),
    ]
