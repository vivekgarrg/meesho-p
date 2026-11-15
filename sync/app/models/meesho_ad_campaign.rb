# One Meesho ad campaign with its lifetime figures. The table belongs to Django
# (meesho_app.models.MeeshoAdCampaign) — keep the two in step. Written by MeeshoAdsJob.
class MeeshoAdCampaign < ApplicationRecord
  self.table_name = "meesho_ad_campaigns"
  belongs_to :account, class_name: "MeeshoAccount"
  %i[name status reason campaign_type budget_type bid_type image feedback_state].each { |c| attribute c, :string, default: "" }
  attribute :catalog_count, :integer, default: 0
  %i[spend revenue].each { |c| attribute c, :decimal, default: 0 }
  %i[orders views clicks].each { |c| attribute c, :integer, default: 0 }
end
