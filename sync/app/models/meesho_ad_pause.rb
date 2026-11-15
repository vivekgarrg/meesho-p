# A pause / resume of a catalog in a campaign, by the auto-pause rule or by hand. Django: MeeshoAdPause.
class MeeshoAdPause < ApplicationRecord
  self.table_name = "meesho_ad_pauses"
  belongs_to :account, class_name: "MeeshoAccount"
  attribute :catalog_name, :string, default: ""
  attribute :message, :string, default: ""
  attribute :action, :string, default: "PAUSE"
  attribute :trigger, :string, default: "AUTO"
  attribute :status, :string, default: "QUEUED"
  attribute :spend, :decimal, default: 0
  attribute :orders, :integer, default: 0
  attribute :created_at, :datetime, default: -> { Time.current }
end
