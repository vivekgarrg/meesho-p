# The latest response from one Meesho endpoint (Django: MeeshoSyncSnapshot).
class MeeshoSyncSnapshot < ApplicationRecord
  self.table_name = "meesho_sync_snapshots"
  belongs_to :account, class_name: "MeeshoAccount"
  # Always written as JSON, whatever the column type is (MySQL json, or text).
  attribute :payload, :json
end
