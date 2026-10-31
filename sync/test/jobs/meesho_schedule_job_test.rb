require "test_helper"

class MeeshoScheduleJobTest < ActiveSupport::TestCase
  test "queues only accounts whose interval has passed" do
    due   = make_account(business_id: 1, status: "ACTIVE", last_sync_at: 6.minutes.ago)
    fresh = make_account(business_id: 2, status: "ACTIVE", last_sync_at: 2.minutes.ago)
    never = make_account(business_id: 3, status: "ACTIVE", last_sync_at: nil)
    make_account(business_id: 4, status: "FAILED", last_sync_at: nil)
    make_account(business_id: 5, status: "ACTIVE", sync_enabled: false)
    make_account(business_id: 6, status: "ACTIVE", sync_interval_minutes: 15, last_sync_at: 10.minutes.ago)

    MeeshoScheduleJob.new.perform
    assert_equal [due.id, never.id].sort, MeeshoSyncJob.jobs.map { |j| j["args"][0] }.sort
    assert_equal ["default"], MeeshoSyncJob.jobs.map { |j| j["queue"] }.uniq
    refute fresh.runs.exists?

    MeeshoScheduleJob.new.perform                        # already queued: not twice
    assert_equal 2, MeeshoSyncJob.jobs.size
  end
end
