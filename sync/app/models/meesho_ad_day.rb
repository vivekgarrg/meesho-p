# The account's ad figures on one IST day. Django: MeeshoAdDay.
class MeeshoAdDay < ApplicationRecord
  self.table_name = "meesho_ad_days"
  belongs_to :account, class_name: "MeeshoAccount"
  %i[spend revenue].each { |c| attribute c, :decimal, default: 0 }
  %i[orders views clicks].each { |c| attribute c, :integer, default: 0 }
end
