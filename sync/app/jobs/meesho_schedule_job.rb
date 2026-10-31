# Runs every minute (config/schedule.yml): queues a pull for each account whose
# interval (5 minutes by default) has passed since its last one.
class MeeshoScheduleJob
  include Sidekiq::Job
  sidekiq_options queue: "default", retry: false

  def perform
    now = Time.current
    MeeshoAccount.where(sync_enabled: true, status: MeeshoAccount::STATUS_ACTIVE).find_each do |account|
      next unless account.due_for_sync?(now)
      busy = account.runs.where(kind: MeeshoSyncRun::KIND_SYNC, status: %w[QUEUED RUNNING])
                    .where("queued_at > ?", now - 10.minutes).exists?
      next if busy
      run = account.runs.create!(kind: MeeshoSyncRun::KIND_SYNC, trigger: MeeshoSyncRun::TRIGGER_SCHEDULE,
                                 status: "QUEUED", queued_at: now)
      MeeshoSyncJob.set(queue: "default").perform_async(account.id, run.id, MeeshoSyncRun::TRIGGER_SCHEDULE)
    end
  end
end
