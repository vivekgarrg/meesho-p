# "Stock to 0, and back" for one account. The table belongs to Django
# (meesho_app.models.MeeshoStockHold) — keep the two in step. Worked by MeeshoStockHoldJob.
class MeeshoStockHold < ApplicationRecord
  self.table_name = "meesho_stock_holds"

  OPEN = %w[QUEUED HOLDING HELD RESTORING].freeze

  belongs_to :account, class_name: "MeeshoAccount"
  has_many :items, class_name: "MeeshoStockHoldItem", foreign_key: :hold_id

  # Django gives these defaults in Python only.
  attribute :message, :string, default: ""

  def self.open_for?(account)
    where(account_id: account.id, status: OPEN).exists?
  end
end
