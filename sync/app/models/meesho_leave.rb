# A leave: every catalog live on Meesho paused, kept paused, and brought back at
# the end. The table belongs to Django (meesho_app.models.MeeshoLeave) — keep the
# two in step. Worked by MeeshoLeaveJob; queued by MeeshoScheduleJob.
class MeeshoLeave < ApplicationRecord
  self.table_name = "meesho_leaves"

  OPEN = %w[SCHEDULED PAUSING ON_LEAVE RESUMING].freeze
  GUARD_EVERY = 60.minutes                     # how often a leave checks nothing has come back on

  belongs_to :account, class_name: "MeeshoAccount"
  has_many :items, class_name: "MeeshoLeaveItem", foreign_key: :leave_id

  # Django gives these defaults in Python only.
  attribute :status, :string, default: "SCHEDULED"
  attribute :note, :string, default: ""
  attribute :message, :string, default: ""
  attribute :ended_how, :string, default: ""
  attribute :repaused, :integer, default: 0
end
