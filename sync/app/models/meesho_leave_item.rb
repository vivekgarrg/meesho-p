# One SKU a leave paused (meesho_app.models.MeeshoLeaveItem): its stock then, and where it stands.
class MeeshoLeaveItem < ApplicationRecord
  self.table_name = "meesho_leave_items"

  belongs_to :leave, class_name: "MeeshoLeave"

  attribute :sku_id, :string, default: ""
  attribute :variation, :string, default: ""
  attribute :state, :string, default: "PAUSED"
  attribute :message, :string, default: ""
  attribute :times_repaused, :integer, default: 0
end
