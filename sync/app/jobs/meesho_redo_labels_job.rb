# Make a label batch whole again: for every business in it whose labels
# failed (Meesho busy, refused, timed out…), read its Ready to ship tab and
# request the labels of everything not downloaded yet, into the same batch;
# then Django merges every business's labels in the batch into one PDF,
# sorted by parent SKU, keeps it for "Latest labels" and Order Scan, and —
# when asked — sends it (Telegram / email / WhatsApp).
#
# Queued from Meesho → Ready to ship (Retry … merge & send) or the Django
# command meesho_redo_labels. One labels job at a time: it waits for the
# automation's lock.
class MeeshoRedoLabelsJob
  include Sidekiq::Job
  sidekiq_options queue: "critical", retry: false

  CHUNK = MeeshoAutoLabelsJob::CHUNK

  def perform(batch, send = false)
    runs = self.class.runs_of(batch)
    return if runs.empty?
    unless lock
      self.class.perform_in(60, batch, send)
      return
    end
    begin
      lines = self.class.failed_accounts(runs).map { |account| "#{name(account)}: #{redo_account(account, batch)}" }
      args = ["meesho_save_labels", "--batch", batch, "--trigger", batch.start_with?("auto-") ? "AUTO" : "MANUAL",
              "--summary", (["Labels made again for the businesses that failed."] + lines).join("\n")]
      args << "--send" if send
      DjangoCommand.run(*args)
    rescue DjangoCommand::Failed => e
      Sidekiq.logger.error("MeeshoRedoLabelsJob #{batch}: #{e.message}")
    ensure
      unlock
    end
  end

  def self.runs_of(batch)
    MeeshoSyncRun.where(kind: "LABELS").where("queued_at > ?", 3.days.ago).order(:queued_at)
                 .select { |r| (r.result || {})["batch"] == batch }
  end

  # The businesses in the batch with no labels made (and not made since).
  def self.failed_accounts(runs)
    made = runs.select { |r| (r.result || {})["label_url"].present? }.map(&:account_id).to_set
    ids = runs.reject { |r| (r.result || {})["superseded"] }.map(&:account_id).uniq.reject { |id| made.include?(id) }
    MeeshoAccount.where(id: ids).to_a
  end

  private

  def redo_account(account, batch)
    MeeshoSyncJob.new.perform(account.id, nil, MeeshoSyncRun::TRIGGER_SCHEDULE)          # its Ready to ship, now
    todo = MeeshoAutoLabelsJob.label_todo(account)
    return "nothing left to label" if todo.empty?
    made = 0
    new_runs = todo.each_slice(CHUNK).map do |chunk|
      # Not MANUAL: the label job's own keep would merge the batch before every business is done.
      run = account.runs.create!(kind: "LABELS", trigger: MeeshoSyncRun::TRIGGER_SCHEDULE, status: "QUEUED",
                                 records: chunk.sum { |g| g["sub_order_ids"].size }, result: { "batch" => batch },
                                 message: "Generating labels again…")
      MeeshoLabelJob.new.perform(account.id, run.id, chunk)
      run.reload
      made += run.records if run.status == "OK"
      run
    end
    if new_runs.any? { |r| (r.result || {})["label_url"].present? }
      # The failed attempts are replaced: they no longer make the batch look incomplete.
      self.class.runs_of(batch).each do |r|
        next unless r.account_id == account.id && (r.result || {})["label_url"].blank? && !new_runs.include?(r)
        r.update!(result: (r.result || {}).merge("superseded" => true))
      end
    end
    "labels for #{made} of #{todo.sum { |g| g['sub_order_ids'].size }} ready to ship"
  end

  def name(account)
    Business.find_by(id: account.business_id)&.name || account.supplier_name.presence || "Account #{account.id}"
  end

  def lock
    Sidekiq.redis { |r| r.call("SET", MeeshoAutoLabelsJob.lock_key, jid.to_s, "NX", "EX", MeeshoAutoLabelsJob::LOCK_TTL) } == "OK"
  end

  def unlock
    Sidekiq.redis { |r| r.call("DEL", MeeshoAutoLabelsJob.lock_key) }
  end
end
