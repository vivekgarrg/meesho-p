from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("meesho_app", "0042_product_and_photos"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="productphoto",
            name="image_data",
        ),
        migrations.RemoveField(
            model_name="productphoto",
            name="content_type",
        ),
        migrations.AddField(
            model_name="productphoto",
            name="url",
            field=models.URLField(max_length=2000, default=""),
            preserve_default=False,
        ),
    ]
