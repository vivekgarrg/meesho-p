# The Meesho automation, as set on Meesho Orders → Accounts & sync
# (MeeshoAutoSetting; MeeshoScheduleJob queues it), for every connected account:
#
#   "accept": accept every Pending order — every N minutes.
#   "labels": accept, then have Meesho make the labels of every Ready-to-ship
#             order whose label isn't downloaded yet — at each label time. They
#             share one batch; Django (meesho_save_labels) merges them into one
#             PDF sorted by parent SKU and keeps it for Meesho Orders' "Latest
#             labels" (Print / Download), since Meesho's own link expires.
#
# The same steps an admin takes on Meesho Orders (Accept, then Generate
# labels), with the same jobs, run one after another — and one run at a time
# (a labels run that finds an accept still going waits a minute).
#
# The automation starts switched off: a development copy of the worker, logged
# in to the same Meesho accounts but with its own database, does nothing until
# someone switches it on there.
class MeeshoAutoLabelsJob
  include Sidekiq::Job
  sidekiq_options queue: "critical", retry: false      # never accept or send twice by itself

  CHUNK = 500                                          # orders per accept / label request
  NOT_DOWNLOADED = [false, "Not Downloaded"].freeze

  STEPS = %w[accept labels].freeze
  LOCK_KEY = "meesho_auto:lock".freeze
  LOCK_TTL = 45 * 60

  def self.enabled?
    MeeshoAutoSetting.current&.enabled || false
  end

  # step: "accept" (accept only) or "labels" (accept, then make the labels).
  # force: run even with the automation off (by hand, from a console).
  # Returns one line per account saying what happened.
  def perform(step = "labels", force = false)
    raise ArgumentError, "unknown step #{step.inspect}" unless STEPS.include?(step)
    return unless force || self.class.enabled?
    unless lock
      # One run at a time: labels wait for the accept to finish; an accept just skips.
      self.class.perform_in(60, step, force) if step == "labels"
      return
    end
    begin
      batch = "auto-#{Time.current.in_time_zone('Asia/Kolkata').strftime('%Y%m%d-%H%M')}-#{SecureRandom.hex(3)}"
      summary = accounts.map do |account|
        "#{account_name(account)}: #{run_account(account, batch, labels: step == 'labels')}"
      rescue StandardError => e
        Sidekiq.logger.error("MeeshoAutoLabelsJob #{account.id}: #{e.class}: #{e.message}")
        "#{account_name(account)}: stopped — #{e.message.truncate(200)}"
      end
      keep(batch, summary) if step == "labels"
      Sidekiq.logger.info("MeeshoAutoLabelsJob #{step} #{batch}: #{summary.join(' | ')}")
      summary
    ensure
      unlock
    end
  end

  private

  # Merge, sort and keep the run's labels for "Latest labels" (Django).
  def keep(batch, summary)
    DjangoCommand.run("meesho_save_labels", "--batch", batch, "--summary", summary.join("\n"))
  rescue DjangoCommand::Failed => e
    Sidekiq.logger.error("MeeshoAutoLabelsJob #{batch}: keeping the labels PDF failed: #{e.message}")
  end

  def lock
    Sidekiq.redis { |r| r.call("SET", LOCK_KEY, jid.to_s, "NX", "EX", LOCK_TTL) } == "OK"
  end

  def unlock
    Sidekiq.redis { |r| r.call("DEL", LOCK_KEY) }
  end

  def accounts
    MeeshoAccount.where(status: MeeshoAccount::STATUS_ACTIVE).where.not(supplier_id: "").where.not(supplier_identifier: "").to_a
  end

  def account_name(account)
    Business.find_by(id: account.business_id)&.name || account.supplier_name.presence || "Account #{account.id}"
  end

  # Accept, then (labels: true) generate labels, for one account. Returns what happened, in a line.
  def run_account(account, batch, labels:)
    pull(account)
    pending = groups(rows(account, "orders_pending"))
    accepted = 0
    pending.each_slice(CHUNK) do |chunk|
      run = account.runs.create!(kind: "ACCEPT", trigger: MeeshoSyncRun::TRIGGER_SCHEDULE, status: "QUEUED",
                                 records: chunk.sum { |g| g["sub_order_ids"].size },
                                 message: "Accepting (daily run)…")
      MeeshoAcceptJob.new.perform(account.id, run.id, chunk)
      run.reload
      accepted += run.records if run.status == "OK"
    end
    accepted_line = "#{accepted} of #{pending.sum { |g| g['sub_order_ids'].size }} pending accepted"
    return accepted_line unless labels

    pull(account) if pending.any?                        # the accepted ones now sit in Ready to ship

    todo = groups(rows(account, "orders_ready_to_ship").select { |r| NOT_DOWNLOADED.include?(r["label"]) })
    labelled = 0
    todo.each_slice(CHUNK) do |chunk|
      run = account.runs.create!(kind: "LABELS", trigger: MeeshoSyncRun::TRIGGER_SCHEDULE, status: "QUEUED",
                                 records: chunk.sum { |g| g["sub_order_ids"].size }, result: { "batch" => batch },
                                 message: "Generating labels (automatic run)…")
      MeeshoLabelJob.new.perform(account.id, run.id, chunk)
      run.reload
      labelled += run.records if run.status == "OK"
    end
    "#{accepted_line}, labels for #{labelled} of #{todo.sum { |g| g['sub_order_ids'].size }} ready to ship"
  end

  # The account's order tabs, read now (as a manual Refresh does).
  def pull(account)
    MeeshoSyncJob.new.perform(account.id, nil, MeeshoSyncRun::TRIGGER_SCHEDULE)
  end

  def rows(account, endpoint)
    payload = MeeshoSyncSnapshot.find_by(account_id: account.id, endpoint: endpoint)&.payload
    Array(payload).select { |r| r.is_a?(Hash) && r["sub_order_id"].present? && r["grouping_key"].present? }
  end

  # Orders grouped as Meesho's requests take them: by grouping key.
  def groups(rows)
    rows.group_by { |r| r["grouping_key"] }.map do |key, rs|
      { "grouping_key" => key, "sub_order_ids" => rs.map { |r| r["sub_order_id"] }.uniq,
        "shipment_type" => rs.first["shipment_type"].presence || "forward" }
    end
  end
end
