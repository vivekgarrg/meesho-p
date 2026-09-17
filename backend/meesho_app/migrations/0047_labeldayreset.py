from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0001_initial"),
        ("meesho_app", "0046_flipkartbulktemplate_review_comment_and_more"),
    ]

    operations = [
        migrations.CreateModel(
            name="LabelDayReset",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("business_date", models.DateField(db_index=True)),
                ("reset_at", models.DateTimeField(auto_now=True)),
                ("business", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="accounts.business")),
            ],
            options={
                "db_table": "label_day_resets",
                "ordering": ["-business_date"],
            },
        ),
        migrations.AlterUniqueTogether(
            name="labeldayreset",
            unique_together={("business", "business_date")},
        ),
    ]
