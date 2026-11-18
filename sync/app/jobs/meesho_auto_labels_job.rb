# The Meesho automation, as set on Meesho → Settings
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
# labels), with the same jobs — and one run at a time (a labels run that finds
# an accept still going waits a minute).
#
# A labels run goes business by business through each step before the next,
# so the one PDF has every business's labels:
#   1. accept every business's pending orders;
#   2. wait (re-reading, up to WAIT_MAX) until each business's just-accepted
#      orders are in Ready to ship — Meesho takes a moment to move them, and
#      labelling straight away found nothing ("accept & print together");
#   3. make every business's labels; one that comes back short is tried again;
#   4. only then merge, sort and send — saying which business, if any, is
#      missing and why (a business whose Meesho login has lapsed is named too).
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
  WAIT_STEP = 20                                       # seconds between looks for the just-accepted orders,
  WAIT_MAX = 180                                       # and how long to keep looking
  RETRY_WAIT = 60                                      # before a second try at a business's labels
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
      summary = if step == "labels"
                  labels_run(batch)
                else
                  accounts.map { |a| line(a) { accept(a)[:line] } }
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

  # "<business>: <what happened>" — or why it stopped; one business failing never stops the others.
  def line(account)
    "#{account_name(account)}: #{yield}"
  rescue StandardError => e
    Sidekiq.logger.error("MeeshoAutoLabelsJob #{account.id}: #{e.class}: #{e.message}")
    "#{account_name(account)}: stopped — #{e.message.truncate(200)}"
  end

  # The labels run, step by step across every business (see the top of the file).
  def labels_run(batch)
    accs = accounts
    # 1. Accept, every business.
    accepted = {}
    failed = {}
    accs.each do |a|
      accepted[a.id] = accept(a)
    rescue StandardError => e
      Sidekiq.logger.error("MeeshoAutoLabelsJob #{a.id}: #{e.class}: #{e.message}")
      failed[a.id] = "stopped — #{e.message.truncate(200)}"
    end
    # 2. Wait until what each business just accepted is in Ready to ship.
    waiting = accs.select { |a| accepted[a.id] && accepted[a.id][:ids].any? }
    late = wait_for_ready(waiting, accepted)
    # 3. Labels, every business; one that comes back short is tried once more.
    lines = accs.map do |a|
      next "#{account_name(a)}: #{failed[a.id]}" if failed[a.id]
      line(a) do
        made, todo = labels(a, batch)
        if made < todo
          sleep(RETRY_WAIT) unless MeeshoLabelJob.no_wait?
          pull(a)
          again, _rest = labels(a, batch)
          made += again
        end
        note = late[a.id].to_i.positive? ? " (#{late[a.id]} accepted but not in Ready to ship yet — the next run labels them)" : ""
        short = made < todo ? " ⚠ #{todo - made} label#{'s' unless todo - made == 1} not made — see Meesho Orders" : ""
        "#{accepted[a.id][:line]}, labels for #{made} of #{todo} ready to ship#{short}#{note}"
      end
    end
    lines + not_connected.map { |n| "#{n}: not connected — nothing accepted or labelled; log in again under Business Settings → Meesho setup" }
  end

  # Accept one business's pending orders. {line:, ids: [sub-order ids accepted]}
  def accept(account)
    pull(account)
    pending = groups(rows(account, "orders_pending"))
    accepted, ids = 0, []
    pending.each_slice(CHUNK) do |chunk|
      run = account.runs.create!(kind: "ACCEPT", trigger: MeeshoSyncRun::TRIGGER_SCHEDULE, status: "QUEUED",
                                 records: chunk.sum { |g| g["sub_order_ids"].size },
                                 message: "Accepting (daily run)…")
      MeeshoAcceptJob.new.perform(account.id, run.id, chunk)
      run.reload
      next unless run.status == "OK"
      accepted += run.records
      ids += chunk.flat_map { |g| g["sub_order_ids"] }
    end
    { line: "#{accepted} of #{pending.sum { |g| g['sub_order_ids'].size }} pending accepted", ids: ids }
  end

  # Re-read each business until its just-accepted orders show in Ready to ship (or WAIT_MAX passes).
  # Returns {account id => how many still weren't there}.
  def wait_for_ready(accs, accepted)
    left = accs.to_h { |a| [a.id, accepted[a.id][:ids]] }
    waited = 0
    loop do
      accs.each do |a|
        next if left[a.id].empty?
        pull(a)
        ready = rows(a, "orders_ready_to_ship").map { |r| r["sub_order_id"] }
        left[a.id] -= ready
      end
      break if left.values.all?(&:empty?) || waited >= WAIT_MAX
      sleep(WAIT_STEP) unless MeeshoLabelJob.no_wait?
      waited += WAIT_STEP
    end
    left.transform_values(&:size)
  rescue StandardError => e
    Sidekiq.logger.error("MeeshoAutoLabelsJob waiting for Ready to ship: #{e.class}: #{e.message}")
    {}
  end

  # Make one business's labels for every Ready-to-ship order not downloaded yet. [made, asked]
  def labels(account, batch)
    todo = self.class.label_todo(account)
    made = 0
    todo.each_slice(CHUNK) do |chunk|
      run = account.runs.create!(kind: "LABELS", trigger: MeeshoSyncRun::TRIGGER_SCHEDULE, status: "QUEUED",
                                 records: chunk.sum { |g| g["sub_order_ids"].size }, result: { "batch" => batch },
                                 message: "Generating labels (automatic run)…")
      MeeshoLabelJob.new.perform(account.id, run.id, chunk)
      run.reload
      made += run.records if run.status == "OK"
    end
    [made, todo.sum { |g| g["sub_order_ids"].size }]
  end

  # Businesses with a Meesho account set up whose login has lapsed: named in the run's message, not left out silently.
  def not_connected
    MeeshoAccount.where.not(status: MeeshoAccount::STATUS_ACTIVE).where.not(supplier_id: "").where.not(supplier_identifier: "")
                 .where(sync_enabled: true).map { |a| account_name(a) }
  end

  # The account's order tabs, read now (as a manual Refresh does).
  def pull(account)
    MeeshoSyncJob.new.perform(account.id, nil, MeeshoSyncRun::TRIGGER_SCHEDULE)
  end

  def rows(account, endpoint)
    self.class.rows(account, endpoint)
  end

  def groups(rows)
    self.class.groups(rows)
  end

  def self.rows(account, endpoint)
    payload = MeeshoSyncSnapshot.find_by(account_id: account.id, endpoint: endpoint)&.payload
    Array(payload).select { |r| r.is_a?(Hash) && r["sub_order_id"].present? && r["grouping_key"].present? }
  end

  # Orders grouped as Meesho's requests take them: by grouping key.
  def self.groups(rows)
    rows.group_by { |r| r["grouping_key"] }.map do |key, rs|
      { "grouping_key" => key, "sub_order_ids" => rs.map { |r| r["sub_order_id"] }.uniq,
        "shipment_type" => rs.first["shipment_type"].presence || "forward" }
    end
  end

  # Ready-to-ship orders whose labels aren't downloaded yet, as the last pull saw them.
  def self.label_todo(account)
    groups(rows(account, "orders_ready_to_ship").select { |r| NOT_DOWNLOADED.include?(r["label"]) })
  end

  def self.lock_key
    LOCK_KEY
  end
end
