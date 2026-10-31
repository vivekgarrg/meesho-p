# One catalog on the panel's Inventory page. The table belongs to Django
# (meesho_app.models.MeeshoCatalog) — keep the two in step.
class MeeshoCatalog < ApplicationRecord
  self.table_name = "meesho_inventory_catalogs"

  belongs_to :account, class_name: "MeeshoAccount"
  has_many :listings, class_name: "MeeshoListing", foreign_key: :catalog_id
end
