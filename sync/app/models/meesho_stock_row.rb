# One row of the Meesho Stock page — the shape of Meesho's inventory sheet.
# The table belongs to Django (meesho_app.models.MeeshoInventory) — keep the
# two in step. Kept up to date from the panel by MeeshoStockSheet.
class MeeshoStockRow < ApplicationRecord
  self.table_name = "meesho_inventory"
end
