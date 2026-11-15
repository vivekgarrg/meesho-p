# One catalog in one ad campaign: its state there and lifetime figures. Django: MeeshoAdCatalog.
class MeeshoAdCatalog < ApplicationRecord
  self.table_name = "meesho_ad_catalogs"
  belongs_to :account, class_name: "MeeshoAccount"
  %i[name category image status status_reason].each { |c| attribute c, :string, default: "" }
  %i[spend revenue].each { |c| attribute c, :decimal, default: 0 }
  %i[orders views clicks].each { |c| attribute c, :integer, default: 0 }
end
