# The daily Meesho run (config/schedule.yml), for every connected account:
#
#   every 30 min  "accept": accept every Pending order.
#   5 PM IST      "labels": accept again, then have
#                 Meesho make the labels of every Ready-to-ship order whose
#                 label isn't downloaded yet. They share one batch, so they're on
#                 Meesho Orders → Ready to ship as one "Download merged labels"
#                 (one PDF, sorted by parent SKU).
#
# The 5 PM run does that slot's accepting itself, so the half-hourly accept
# skips 5:00 — two accept requests at once would collide on Meesho.
#
# The same steps an admin takes on Meesho Orders (Accept, then Generate
# labels), with the same jobs, run one after another. Off unless
# MEESHO_AUTO_LABELS=true — so a development copy of the worker, logged in to
# the same Meesho accounts, never accepts orders or makes labels.
#
# Sending the PDF to Telegram/email (Django: meesho_send_labels) is built but
# not called for now.
class MeeshoAutoLabelsJob
  include Sidekiq::Job
  sidekiq_options queue: "critical", retry: false      # never accept or send twice by itself

  CHUNK = 500                                          # orders per accept / label request
  NOT_DOWNLOADED = [false, "Not Downloaded"].freeze

  LABELS_AT = 17                                       # 5 PM IST — config/schedule.yml's meesho_auto_labels

  # Whether now is the 5 PM labels run's slot (it accepts as well).
  def self.labels_slot?(now = Time.current)
    t = now.in_time_zone("Asia/Kolkata")
    t.hour == LABELS_AT && t.min < 15
  end

  def self.enabled?
    ENV["MEESHO_AUTO_LABELS"].to_s.strip.downcase.in?(%w[1 true yes on])
  end

  STEPS = %w[accept labels].freeze

  # step: "accept" (accept only) or "labels" (accept, then make the labels).
  # Returns one line per account saying what happened.
  def perform(step = "labels", force = false)
    return unless force || self.class.enabled?
    raise ArgumentError, "unknown step #{step.inspect}" unless STEPS.include?(step)
    return [] if step == "accept" && !force && self.class.labels_slot?
    batch = "auto-#{Time.current.in_time_zone('Asia/Kolkata').strftime('%Y%m%d-%H%M')}-#{SecureRandom.hex(3)}"
    summary = accounts.map do |account|
      "#{account_name(account)}: #{run_account(account, batch, labels: step == 'labels')}"
    rescue StandardError => e
      Sidekiq.logger.error("MeeshoAutoLabelsJob #{account.id}: #{e.class}: #{e.message}")
      "#{account_name(account)}: stopped — #{e.message.truncate(200)}"
    end
    Sidekiq.logger.info("MeeshoAutoLabelsJob #{step} #{batch}: #{summary.join(' | ')}")
    summary
  end

  private

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
                                 message: "Generating labels (5 PM run)…")
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
