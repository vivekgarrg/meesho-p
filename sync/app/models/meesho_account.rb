# One business's Meesho supplier-panel login and session. The table belongs to
# Django (meesho_app.models.MeeshoAccount) — keep the two in step.
class MeeshoAccount < ApplicationRecord
  self.table_name = "meesho_sync_accounts"

  STATUS_NEW        = "NEW"
  STATUS_LOGGING_IN = "LOGGING_IN"
  STATUS_ACTIVE     = "ACTIVE"
  STATUS_FAILED     = "FAILED"
  STATUS_DISABLED   = "DISABLED"

  has_many :runs, class_name: "MeeshoSyncRun", foreign_key: :account_id
  has_many :snapshots, class_name: "MeeshoSyncSnapshot", foreign_key: :account_id
  has_many :catalogs, class_name: "MeeshoCatalog", foreign_key: :account_id
  has_many :listings, class_name: "MeeshoListing", foreign_key: :account_id

  def password
    SecretBox.decrypt(password_enc)
  end

  # Session cookies as a { name => value } hash.
  def cookies
    cookies_enc.present? ? JSON.parse(SecretBox.decrypt(cookies_enc)) : {}
  end

  def cookies=(hash)
    self.cookies_enc = hash.present? ? SecretBox.encrypt(hash.to_json) : ""
  end

  def due_for_sync?(now = Time.current)
    sync_enabled && status == STATUS_ACTIVE &&
      (last_sync_at.nil? || last_sync_at <= now - sync_interval_minutes.minutes)
  end
end
