# Runs every minute (config/schedule.yml): queues a pull for each account whose
# interval (5 minutes by default) has passed since its last one, and an
# inventory pull every half hour, and payments every two hours.
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
    queue_inventory(now)
    queue_payments(now)
  end

  private

  # The Inventory page, every MeeshoInventoryJob::INTERVAL minutes.
  def queue_inventory(now)
    queue_every(now, MeeshoSyncRun::KIND_INVENTORY, MeeshoInventoryJob)
  end

  # Payments, every MeeshoPaymentsJob::INTERVAL minutes.
  def queue_payments(now)
    queue_every(now, MeeshoSyncRun::KIND_PAYMENTS, MeeshoPaymentsJob)
  end

  def queue_every(now, kind, job)
    MeeshoAccount.where(sync_enabled: true, status: MeeshoAccount::STATUS_ACTIVE)
                 .where.not(supplier_id: "").where.not(supplier_identifier: "").find_each do |account|
      recent = account.runs.where(kind: kind).where("queued_at > ?", now - job::INTERVAL.minutes).exists?
      next if recent
      run = account.runs.create!(kind: kind, trigger: MeeshoSyncRun::TRIGGER_SCHEDULE, status: "QUEUED", queued_at: now)
      job.perform_async(account.id, run.id, MeeshoSyncRun::TRIGGER_SCHEDULE)
    end
  end
end
