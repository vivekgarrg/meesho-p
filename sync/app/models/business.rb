# Django's accounts.Business — read only, for names in messages.
class Business < ApplicationRecord
  self.table_name = "businesses"
end
