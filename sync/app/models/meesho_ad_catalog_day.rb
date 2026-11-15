# One catalog's figures in one campaign on one IST day. Django: MeeshoAdCatalogDay.
class MeeshoAdCatalogDay < ApplicationRecord
  self.table_name = "meesho_ad_catalog_days"
  belongs_to :account, class_name: "MeeshoAccount"
  %i[spend revenue].each { |c| attribute c, :decimal, default: 0 }
  %i[orders views clicks].each { |c| attribute c, :integer, default: 0 }
end
