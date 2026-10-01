"""Rejoin the two 0050 leaves.

The master-pricing work (0049_master_pricing_list -> 0050_masteritem_image_url)
and the employees/payroll work (merged in 0050_merge_20260927_2224) both
branched off 0048_parentitemprice_image_url and were never brought back
together, which left the graph with two leaf nodes — so *every* `migrate` run
aborted with "Conflicting migrations detected" and nothing after 0048 was ever
applied. That is why master_item / master_item_component did not exist in the
database at all, and why anything touching them (the Master Pricing tab, and
the Bill of Materials check in parent_price_detail) failed at runtime.

Empty on purpose: a merge migration only reconnects the graph.
"""

from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("meesho_app", "0050_masteritem_image_url"),
        ("meesho_app", "0050_merge_20260927_2224"),
    ]

    operations = []
