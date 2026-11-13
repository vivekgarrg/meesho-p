# One SKU of a stock hold: its stock when read, and what became of it. The table
# belongs to Django (meesho_app.models.MeeshoStockHoldItem) — keep the two in step.
class MeeshoStockHoldItem < ApplicationRecord
  self.table_name = "meesho_stock_hold_items"

  TO_RESTORE = %w[ZEROED RESTORE_FAILED].freeze
  # Read fresh and saved (or already settled): a second read never replaces what was saved.
  SETTLED = %w[SAVED ZEROED ZERO_FAILED RESTORED RESTORE_FAILED SKIPPED_CHANGED].freeze

  belongs_to :hold, class_name: "MeeshoStockHold"

  attribute :message, :string, default: ""
  attribute :sku_id, :string, default: ""
  attribute :variation, :string, default: ""
  attribute :state, :string, default: "PLANNED"
end
