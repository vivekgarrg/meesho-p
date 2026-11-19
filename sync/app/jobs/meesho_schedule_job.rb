# Runs every minute (config/schedule.yml): queues a pull for each account whose
# interval (5 minutes by default) has passed since its last one, and an
# inventory pull every half hour, payments every two hours, returns and OTPs
# every ten minutes, Meesho Ads (and its auto-pause) every five, and the
# automation set on Meesho Orders (accept every N minutes, labels at set times).
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
    queue_every(now, MeeshoSyncRun::KIND_RETURNS, MeeshoReturnsJob)
    queue_every(now, MeeshoSyncRun::KIND_ADS, MeeshoAdsJob)
    queue_automation(now)
    queue_stock_refill(now)
    queue_leaves(now)
  end

  private

  # The automation set on Meesho Orders (MeeshoAutoSetting): a labels run at
  # each label time (it accepts first, so that slot needs no accept of its
  # own), otherwise an accept every N minutes.
  def queue_automation(now)
    setting = MeeshoAutoSetting.current
    return unless setting&.enabled
    if setting.due_label_slot(now)
      setting.update!(last_labels_at: now, last_accept_at: now)
      MeeshoAutoLabelsJob.perform_async("labels")
    elsif setting.accept_due?(now)
      setting.update!(last_accept_at: now)
      MeeshoAutoLabelsJob.perform_async("accept")
    end
  end

  # Leaves (Meesho Inventory → Leave): one starting pauses everything live; one under way is
  # checked every hour (anything live again is paused again); one ending brings it all back.
  # Each is claimed in the table before it's queued, so a minute's tick never queues one twice.
  def queue_leaves(now)
    MeeshoLeave.where(status: "SCHEDULED").where("starts_at <= ?", now).find_each do |l|
      next unless MeeshoLeave.where(id: l.id, status: "SCHEDULED")
                             .update_all(status: "PAUSING", message: "Pausing every live catalog…", updated_at: now) == 1
      MeeshoLeaveJob.perform_async(l.account_id, l.id, "start")
    end
    MeeshoLeave.where(status: "ON_LEAVE").where.not(ends_at: nil).where("ends_at <= ?", now).find_each do |l|
      next unless MeeshoLeave.where(id: l.id, status: "ON_LEAVE")
                             .update_all(status: "RESUMING", ended_how: "auto", message: "Leave over — bringing every catalog back…", updated_at: now) == 1
      MeeshoLeaveJob.perform_async(l.account_id, l.id, "end")
    end
    MeeshoLeave.where(status: "ON_LEAVE").where("last_guard_at IS NULL OR last_guard_at <= ?", now - MeeshoLeave::GUARD_EVERY).find_each do |l|
      next unless MeeshoLeave.where(id: l.id, status: "ON_LEAVE", last_guard_at: l.last_guard_at).update_all(last_guard_at: now, updated_at: now) == 1
      MeeshoLeaveJob.perform_async(l.account_id, l.id, "guard")
    end
  end

  # Nightly stock (Meesho → Settings): every live SKU back to the set quantity.
  def queue_stock_refill(now)
    setting = MeeshoAutoSetting.current
    return unless setting&.stock_refill_due?(now)
    setting.update!(last_stock_refill_at: now)
    MeeshoStockRefillJob.perform_async
  end

  # The Inventory page, every MeeshoInventoryJob::INTERVAL minutes.
  def queue_inventory(now)
    queue_every(now, MeeshoSyncRun::KIND_INVENTORY, MeeshoInventoryJob)
  end

  # Payments, every MeeshoPaymentsJob::INTERVAL minutes.
  def queue_payments(now)
    queue_every(now, MeeshoSyncRun::KIND_PAYMENTS, MeeshoPaymentsJob)
  end

  # Minutes between reads of each kind, from the Sync schedule (0 = paused).
  EVERY = { MeeshoSyncRun::KIND_INVENTORY => :inventory_every, MeeshoSyncRun::KIND_PAYMENTS => :payments_every,
            MeeshoSyncRun::KIND_RETURNS => :returns_every, MeeshoSyncRun::KIND_ADS => :ads_every }.freeze

  # A job with a STAGGER (seconds) has each further account's read start that
  # much later — Meesho rate-limits the server's address, not each account.
  def queue_every(now, kind, job)
    every = MeeshoSyncSetting.value(EVERY.fetch(kind), job::INTERVAL).to_i
    return if every <= 0
    stagger = job.const_defined?(:STAGGER) ? job::STAGGER : 0
    queued = 0
    MeeshoAccount.where(sync_enabled: true, status: MeeshoAccount::STATUS_ACTIVE)
                 .where.not(supplier_id: "").where.not(supplier_identifier: "").find_each do |account|
      recent = account.runs.where(kind: kind).where("queued_at > ?", now - every.minutes).exists?
      next if recent
      run = account.runs.create!(kind: kind, trigger: MeeshoSyncRun::TRIGGER_SCHEDULE, status: "QUEUED", queued_at: now)
      delay = stagger * queued
      queued += 1
      if delay.positive?
        job.perform_in(delay, account.id, run.id, MeeshoSyncRun::TRIGGER_SCHEDULE)
      else
        job.perform_async(account.id, run.id, MeeshoSyncRun::TRIGGER_SCHEDULE)
      end
    end
  end
end
