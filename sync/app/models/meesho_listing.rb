# One SKU (product + variation) in one catalog. The table belongs to Django
# (meesho_app.models.MeeshoListing) — keep the two in step.
class MeeshoListing < ApplicationRecord
  self.table_name = "meesho_inventory_listings"

  belongs_to :account, class_name: "MeeshoAccount"
  belongs_to :catalog, class_name: "MeeshoCatalog"
end
