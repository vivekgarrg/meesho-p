# The Meesho automation set on Meesho → Settings (one row). The
# table belongs to Django (meesho_app.models.MeeshoAutoSetting) — keep the two
# in step. Read every minute by MeeshoScheduleJob.
class MeeshoAutoSetting < ApplicationRecord
  self.table_name = "meesho_auto_settings"

  IST = "Asia/Kolkata".freeze
  # A label time missed by more than this (worker down) is skipped, not run late.
  CATCH_UP = 60.minutes

  attribute :label_times, :json

  def self.current
    order(:id).first
  end

  # The label time that is due now and hasn't run yet (an IST Time), or nil.
  def due_label_slot(now = Time.current)
    return nil unless enabled
    ist = now.in_time_zone(IST)
    Array(label_times).filter_map do |t|
      h, m = t.to_s.split(":").map(&:to_i)
      slot = ist.change(hour: h, min: m)
      slot if slot <= ist && ist - slot < CATCH_UP && (last_labels_at.nil? || last_labels_at < slot)
    end.max
  end

  # Whether it's time to accept again.
  def accept_due?(now = Time.current)
    every = accept_every_minutes.to_i
    enabled && every.positive? && (last_accept_at.nil? || last_accept_at <= now - every.minutes + 30.seconds)
  end
end
