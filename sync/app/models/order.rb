# The app's orders table (Django: meesho_app.models.Order) — one row per
# sub-order per status, as the Orders CSV upload writes it.
class Order < ApplicationRecord
  self.table_name = "orders"
  attribute :quantity, :integer, default: 1
end
