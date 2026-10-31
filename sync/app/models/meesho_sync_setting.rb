# How often each kind of Meesho data is read, and how much — set on Meesho →
# Settings → Sync schedule (one row). The table belongs to Django
# (meesho_app.models.MeeshoSyncSetting) — keep the two in step. With no row
# yet, each job's own defaults apply.
class MeeshoSyncSetting < ApplicationRecord
  self.table_name = "meesho_sync_settings"

  def self.current
    order(:id).first
  end

  # A setting's value, or the given default when nothing's been saved.
  def self.value(field, default)
    current&.public_send(field) || default
  end
end
