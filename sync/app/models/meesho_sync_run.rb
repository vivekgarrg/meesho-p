# One login or data pull (Django: MeeshoSyncRun) — what the sync page lists.
class MeeshoSyncRun < ApplicationRecord
  self.table_name = "meesho_sync_runs"

  KIND_LOGIN = "LOGIN"
  KIND_SYNC  = "SYNC"
  TRIGGER_SCHEDULE = "SCHEDULE"
  TRIGGER_MANUAL   = "MANUAL"

  belongs_to :account, class_name: "MeeshoAccount"

  # Django gives these defaults in Python only, not in the database, so rows
  # created here must fill them in.
  attribute :message, :string, default: ""
  attribute :records, :integer, default: 0
  attribute :status, :string, default: "QUEUED"
  attribute :queued_at, :datetime, default: -> { Time.current }
  attribute :result, :json

  def start!
    update!(status: "RUNNING", started_at: Time.current)
  end

  def finish!(ok, message, records: 0)
    update!(status: ok ? "OK" : "FAILED", message: message.to_s.truncate(2000), records: records,
            finished_at: Time.current)
  end
end
