from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0001_initial"),
        ("meesho_app", "0046_flipkartbulktemplate_review_comment_and_more"),
    ]

    operations = [
        migrations.CreateModel(
            name="FlipkartOrderPayment",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("neft_id", models.CharField(blank=True, max_length=100, null=True)),
                ("payment_date", models.DateField(blank=True, null=True)),
                ("order_id", models.CharField(db_index=True, max_length=100)),
                ("order_item_id", models.CharField(db_index=True, max_length=100)),
                ("order_date", models.DateField(blank=True, null=True)),
                ("dispatch_date", models.DateField(blank=True, null=True)),
                ("seller_sku", models.CharField(blank=True, db_index=True, max_length=200, null=True)),
                ("quantity", models.PositiveIntegerField(default=1)),
                ("fulfilment_type", models.CharField(blank=True, max_length=100, null=True)),
                ("product_sub_category", models.CharField(blank=True, max_length=200, null=True)),
                ("sale_amount", models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
                ("total_offer_amount", models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
                ("my_share", models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
                ("marketplace_fee", models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
                ("taxes", models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
                ("offer_adjustments", models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
                ("protection_fund", models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
                ("refund", models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
                ("settlement_value", models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ("tcs", models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
                ("tds", models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
                ("gst_on_mp_fees", models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
                ("return_type", models.CharField(blank=True, max_length=100, null=True)),
                ("item_return_status", models.CharField(blank=True, max_length=100, null=True)),
                ("invoice_id", models.CharField(blank=True, max_length=100, null=True)),
                ("invoice_date", models.DateField(blank=True, null=True)),
                ("uploaded_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("business", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="accounts.business")),
            ],
            options={
                "db_table": "flipkart_order_payments",
                "ordering": ["-order_date"],
            },
        ),
        migrations.AlterUniqueTogether(
            name="flipkartorderpayment",
            unique_together={("business", "order_item_id", "neft_id")},
        ),
    ]
