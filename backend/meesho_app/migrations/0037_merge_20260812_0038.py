"""
Rejoin the migration graph after two 0035s were created in parallel.

`0035_bulklistingfieldpreset` (the bulk listing sheet generator) and
`0035_businesscostsetting` (the packaging / GST policy) were both written
against 0034 without either knowing about the other, which left the graph with
two leaf nodes. Django refuses to run `migrate` at all in that state —
"Conflicting migrations detected; multiple leaf nodes in the migration graph" —
so on the server the deploy aborted before restarting gunicorn: production kept
serving the previous build, and bulk_listing_field_presets was never created,
which is why the Bulk Listing tab's presets endpoint returned a 500.

No operations of its own; it exists only to give the two branches a single
descendant. Keeping the generated filename on purpose — it is already recorded
in django_migrations under this name.
"""

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("meesho_app", "0035_bulklistingfieldpreset"),
        ("meesho_app", "0036_finalprice_parent_opt_out"),
    ]

    operations = []
