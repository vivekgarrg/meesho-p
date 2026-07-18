"""
Switch ParentItemPrice.item_id and FinalPrice.sku_id from global primary keys
to surrogate integer PKs with per-business uniqueness, so the same SKU / parent
id can exist in more than one business (enables copying pricing across
businesses).

parent_item_price is referenced by four FK columns, all currently storing the
parent's item_id string:
  - final_price.parent_id            (FinalPrice.parent, SET_NULL)
  - parent_price_history.parent_id   (ParentPriceHistory.parent, CASCADE)
  - purchase_items.parent_sku_id     (PurchaseItem.parent_sku, SET_NULL)
  - inventory_adjustments.parent_sku_id (InventoryAdjustment.parent_sku, CASCADE)

We snapshot each link's item_id string, drop the FKs (MySQL won't alter a PK
referenced by FKs), swap both PKs to a surrogate id, re-add the FKs (now
pointing at the new integer id), then remap the columns by matching the
snapshotted item_id. Existing item_ids are globally unique (they were the PK),
so the item_id -> new id remap is unambiguous and lossless.

On a fresh/empty database (e.g. prod, where data loads from a fixture *after*
migrations run) the RunPython steps are no-ops.
"""
from django.db import migrations, models
import django.db.models.deletion


# (model_name, temp_field, fk_attname)
_LINKS = [
    ("finalprice", "parent_item_tmp", "parent_id"),
    ("parentpricehistory", "parent_item_tmp", "parent_id"),
    ("purchaseitem", "parent_item_tmp", "parent_sku_id"),
    ("inventoryadjustment", "parent_item_tmp", "parent_sku_id"),
]


def noop(apps, schema_editor):
    pass


def snapshot_parent_links(apps, schema_editor):
    for model_name, tmp, fk_attname in _LINKS:
        Model = apps.get_model("meesho_app", model_name)
        for obj in Model.objects.all().iterator():
            setattr(obj, tmp, getattr(obj, fk_attname))
            obj.save(update_fields=[tmp])


def remap_parent_links(apps, schema_editor):
    ParentItemPrice = apps.get_model("meesho_app", "ParentItemPrice")
    # item_id -> new surrogate id (item_ids are globally unique in existing data)
    id_by_item = {p.item_id: p.id for p in ParentItemPrice.objects.all().iterator()}

    for model_name, tmp, fk_attname in _LINKS:
        Model = apps.get_model("meesho_app", model_name)
        for obj in Model.objects.all().iterator():
            item_id = getattr(obj, tmp)
            new_id = id_by_item.get(item_id) if item_id else None
            if new_id is None and model_name in ("parentpricehistory", "inventoryadjustment"):
                # non-nullable FK: drop rows whose parent can't be resolved
                obj.delete()
                continue
            setattr(obj, fk_attname, new_id)
            obj.save(update_fields=[fk_attname])


class Migration(migrations.Migration):

    dependencies = [
        ("meesho_app", "0015_require_business"),
    ]

    operations = [
        # 1. Temp columns to preserve the parent item_id string across the swap.
        migrations.AddField("finalprice", "parent_item_tmp",
                            models.CharField(max_length=200, null=True, blank=True)),
        migrations.AddField("parentpricehistory", "parent_item_tmp",
                            models.CharField(max_length=200, null=True, blank=True)),
        migrations.AddField("purchaseitem", "parent_item_tmp",
                            models.CharField(max_length=200, null=True, blank=True)),
        migrations.AddField("inventoryadjustment", "parent_item_tmp",
                            models.CharField(max_length=200, null=True, blank=True)),
        migrations.RunPython(snapshot_parent_links, noop),

        # 2. Drop the FKs (and the unique_together that references parent) so the
        #    parent PK can be restructured.
        migrations.AlterUniqueTogether(name="parentpricehistory", unique_together=set()),
        migrations.RemoveField(model_name="finalprice", name="parent"),
        migrations.RemoveField(model_name="parentpricehistory", name="parent"),
        migrations.RemoveField(model_name="purchaseitem", name="parent_sku"),
        migrations.RemoveField(model_name="inventoryadjustment", name="parent_sku"),

        # 3. Swap ParentItemPrice PK: item_id (char pk) -> surrogate id.
        migrations.AlterField("parentitemprice", "item_id",
                            models.CharField(db_index=True, max_length=200)),
        migrations.AddField("parentitemprice", "id",
                            models.BigAutoField(auto_created=True, primary_key=True,
                                            serialize=False, verbose_name="ID")),

        # 4. Swap FinalPrice PK: sku_id (char pk) -> surrogate id (no inbound FK).
        migrations.AlterField("finalprice", "sku_id",
                            models.CharField(db_index=True, max_length=200)),
        migrations.AddField("finalprice", "id",
                            models.BigAutoField(auto_created=True, primary_key=True,
                                            serialize=False, verbose_name="ID")),

        # 5. Re-add the FKs, now referencing the new integer id. The two
        #    non-nullable ones (history, inventory_adjustment) are added nullable
        #    for the remap and tightened afterwards.
        migrations.AddField("finalprice", "parent",
                            models.ForeignKey(blank=True, null=True, db_column="parent_id",
                                            on_delete=django.db.models.deletion.SET_NULL,
                                            related_name="sku_prices",
                                            to="meesho_app.parentitemprice")),
        migrations.AddField("parentpricehistory", "parent",
                            models.ForeignKey(null=True, db_column="parent_id",
                                            on_delete=django.db.models.deletion.CASCADE,
                                            related_name="price_history",
                                            to="meesho_app.parentitemprice")),
        migrations.AddField("purchaseitem", "parent_sku",
                            models.ForeignKey(blank=True, null=True, db_column="parent_sku_id",
                                            on_delete=django.db.models.deletion.SET_NULL,
                                            to="meesho_app.parentitemprice")),
        migrations.AddField("inventoryadjustment", "parent_sku",
                            models.ForeignKey(null=True, db_column="parent_sku_id",
                                            on_delete=django.db.models.deletion.CASCADE,
                                            related_name="inventory_adjustments",
                                            to="meesho_app.parentitemprice")),

        # 6. Remap parent_id / parent_sku_id from the snapshotted item_id.
        migrations.RunPython(remap_parent_links, noop),

        # 7. Restore non-nullable FKs and the history unique_together.
        migrations.AlterField("parentpricehistory", "parent",
                            models.ForeignKey(db_column="parent_id",
                                            on_delete=django.db.models.deletion.CASCADE,
                                            related_name="price_history",
                                            to="meesho_app.parentitemprice")),
        migrations.AlterField("inventoryadjustment", "parent_sku",
                            models.ForeignKey(db_column="parent_sku_id",
                                            on_delete=django.db.models.deletion.CASCADE,
                                            related_name="inventory_adjustments",
                                            to="meesho_app.parentitemprice")),
        migrations.AlterUniqueTogether(name="parentpricehistory",
                                    unique_together={("parent", "effective_from")}),

        # 8. Drop temp columns.
        migrations.RemoveField(model_name="finalprice", name="parent_item_tmp"),
        migrations.RemoveField(model_name="parentpricehistory", name="parent_item_tmp"),
        migrations.RemoveField(model_name="purchaseitem", name="parent_item_tmp"),
        migrations.RemoveField(model_name="inventoryadjustment", name="parent_item_tmp"),

        # 9. Per-business uniqueness.
        migrations.AlterUniqueTogether(name="parentitemprice",
                                    unique_together={("business", "item_id")}),
        migrations.AlterUniqueTogether(name="finalprice",
                                    unique_together={("business", "sku_id")}),
    ]
