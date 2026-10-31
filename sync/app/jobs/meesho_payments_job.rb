require "tmpdir"

# Bring one account's Meesho payments into the app, every INTERVAL minutes
# (MeeshoScheduleJob) or at once from the Payments tab's Refresh:
#
#   1. the panel's day-by-day summaries (paid and upcoming) → a snapshot the
#      Payments tab shows;
#   2. the payment file for the last PAID_DAYS days (completed) → the
#      payments tables, through the same importer as the Payments upload;
#   3. the payment file for the next UPCOMING_DAYS days (outstanding) →
#      meesho_outstanding_payments, replaced each time.
#
# Meesho builds a file in the background: it is requested, then the download
# history is read until it is ready, then fetched from Meesho's storage —
# one file at a time. One file failing doesn't stop the other.
class MeeshoPaymentsJob
  include Sidekiq::Job
  sidekiq_options queue: "default", retry: false

  INTERVAL = 120                 # minutes between scheduled reads
  PAID_DAYS = 30
  UPCOMING_DAYS = 7
  POLL_SECONDS = 5
  POLL_TIMES = 36                # up to three minutes for Meesho to build a file
  REQUEST_TRIES = 3
  RETRY_SECONDS = 20
  LOCK_TTL = 20 * 60

  def perform(account_id, run_id = nil, trigger = MeeshoSyncRun::TRIGGER_MANUAL)
    account = MeeshoAccount.find_by(id: account_id)
    return unless account && account.status != MeeshoAccount::STATUS_DISABLED
    run = run_id && MeeshoSyncRun.find_by(id: run_id)
    run ||= account.runs.create!(kind: MeeshoSyncRun::KIND_PAYMENTS, trigger: trigger, status: "QUEUED", queued_at: Time.current)
    unless lock(account)
      run.finish!(false, "A payments read for this account is still running.")
      return
    end
    run.start!
    begin
      if account.supplier_id.blank? || account.supplier_identifier.blank?
        raise MeeshoClient::RequestError, "the supplier's ID and code aren't known — set them under Meesho → Settings"
      end
      @client = account.cookies.present? ? MeeshoClient.new(account) : MeeshoLoginJob.login!(account)
      result = pull(account)
      account.cookies = @client.cookies
      account.save!
      run.update!(result: result)
      failed = result["files"].values.any? { |f| f["error"] }
      run.finish!(!failed, message(result), records: result["files"].values.sum { |f| f["rows"].to_i })
    rescue MeeshoClient::AuthError, MeeshoClient::RequestError, SecretBox::NotConfigured => e
      run.finish!(false, e.message)
    rescue SystemCallError => e
      # A file or folder the worker may not touch (EACCES…) — say which.
      Sidekiq.logger.error("MeeshoPaymentsJob #{account.id}: #{e.class}: #{e.message}")
      run.finish!(false, "Server error: #{e.message.truncate(250)} — the next read will try again.")
    rescue StandardError => e
      Sidekiq.logger.error("MeeshoPaymentsJob #{account.id}: #{e.class}: #{e.message}")
      run.finish!(false, "Unexpected error (#{e.class.name.demodulize}: #{e.message.truncate(150)}) — the next read will try again.")
    ensure
      unlock(account)
    end
  end

  private

  def pull(account)
    @paid_days = MeeshoSyncSetting.value(:payments_paid_days, PAID_DAYS).to_i
    @upcoming_days = MeeshoSyncSetting.value(:payments_upcoming_days, UPCOMING_DAYS).to_i
    summary = relogin(account) { MeeshoPayments.summary(@client, account, paid_days: @paid_days, upcoming_days: @upcoming_days) }
    MeeshoSyncSnapshot.find_or_initialize_by(account_id: account.id, endpoint: "payments_summary")
                      .update!(http_status: 200, payload: summary, fetched_at: Time.current)

    today = ActiveSupport::TimeZone[MeeshoPayments::IST].today
    files = {}
    # Downloads go to a folder of their own in the system's temp space, gone
    # afterwards whatever happens.
    Dir.mktmpdir("meesho-payments") do |dir|
      files["completed"] = completed(account, today - @paid_days, today, dir)
      files["outstanding"] = outstanding(account, today, dir)
    end
    { "files" => files }
  end

  # The last PAID_DAYS days' completed payments, through the Payments upload's importer.
  def completed(account, from, to, dir)
    out = { "from" => from.iso8601, "to" => to.iso8601 }
    path = fetch_file(account, "completed", from, to, dir)
    counts = MeeshoPayments.import(account.business_id, [path], "completed")
    sheets = counts.except("rejected", "reject_reasons", "rejected_samples")
    out.merge("counts" => counts, "rows" => sheets.values.sum { |c| c.is_a?(Hash) ? c.values.sum(&:to_i) : 0 },
              "rejected" => counts["rejected"].to_i)
  rescue MeeshoClient::RequestError, MeeshoPayments::ImportError => e
    out.merge("error" => e.message)
  end

  # Outstanding payments, one day at a time from today, for up to UPCOMING_DAYS
  # days — stopping at the first day Meesho has no file for. The days found
  # replace the outstanding payments together; none found keeps the last ones.
  def outstanding(account, today, dir)
    paths = []
    days = []
    stopped = nil
    (0..@upcoming_days).each do |i|
      day = today + i
      begin
        paths << fetch_file(account, "outstanding", day, day, dir)
        days << day.iso8601
      rescue MeeshoClient::RequestError => e
        stopped = { "day" => day.iso8601, "why" => e.message }
        break
      end
    end
    out = { "from" => today.iso8601, "to" => (days.last || today.iso8601), "days" => days, "stopped" => stopped }
    if paths.empty?
      return out.merge("rows" => 0, "note" => "no outstanding file from #{today.strftime('%-d %b')} (#{stopped&.dig('why')}) — the last ones are kept")
    end
    counts = MeeshoPayments.import(account.business_id, paths, "outstanding")
    out.merge("counts" => counts, "rows" => counts.dig("outstanding", "rows").to_i)
  rescue MeeshoPayments::ImportError => e
    out.merge("error" => e.message)
  end

  # Request one file, wait for Meesho to build it, download it into `dir`.
  def fetch_file(account, kind, from, to, dir)
    job_id = request_file(account, kind, from, to)
    entry = wait_for(account, job_id)
    raise MeeshoClient::RequestError, "Meesho hadn't built the #{kind} file after #{POLL_SECONDS * POLL_TIMES}s" unless entry
    raise MeeshoClient::RequestError, "Meesho couldn't build the #{kind} file: #{entry['error']}" if entry["error"].present?
    MeeshoPayments.download(entry["filePath"], dir)
  end

  # Ask for a file; Meesho now and then refuses (HTTP 5xx) — try again shortly.
  def request_file(account, kind, from, to)
    tries = 0
    begin
      tries += 1
      relogin(account) { MeeshoPayments.request_file(@client, account, kind, from, to) }
    rescue MeeshoClient::RequestError => e
      raise unless tries < REQUEST_TRIES && e.message.match?(/HTTP 5\d\d/)
      sleep RETRY_SECONDS
      retry
    end
  end

  # Read the download history until the file is ready (or failed).
  def wait_for(account, job_id)
    POLL_TIMES.times do |i|
      sleep POLL_SECONDS if i.positive?
      e = relogin(account) { MeeshoPayments.history(@client, account) }[job_id]
      return e if e && (e["filePath"].present? || e["error"].present? || e["status"].to_s.upcase == "FAILED")
    end
    nil
  end

  def message(result)
    c = result["files"]["completed"] || {}
    o = result["files"]["outstanding"] || {}
    parts = []
    if c["error"]
      parts << "Payments: #{c['error']}"
    elsif (op = c.dig("counts", "order_payments"))
      ads = c.dig("counts", "ads_cost") || {}
      parts << "Payments table (#{c['from']} to #{c['to']}): #{op['created'].to_i} new, #{op['updated'].to_i} updated order payments; " \
               "#{ads['created'].to_i} new ads costs#{"; #{c['rejected']} rows refused" if c['rejected'].to_i.positive?}."
    end
    parts << if o["error"]
               "Outstanding: #{o['error']}"
             elsif o["note"]
               "Outstanding: #{o['note']}."
             else
               span = [o["days"].first, o["days"].last].uniq.map { |d| Date.parse(d).strftime("%-d %b") }.join("–")
               "Outstanding (#{span}): #{o['rows'].to_i} orders#{" — no file from #{Date.parse(o['stopped']['day']).strftime('%-d %b')}" if o['stopped']}."
             end
    parts.join(" ")
  end

  def relogin(account)
    yield
  rescue MeeshoClient::AuthError
    @client = MeeshoLoginJob.login!(account)
    yield
  end

  def lock(account)
    Sidekiq.redis { |r| r.call("SET", lock_key(account), jid.to_s, "NX", "EX", LOCK_TTL) } == "OK"
  end

  def unlock(account)
    Sidekiq.redis { |r| r.call("DEL", lock_key(account)) }
  end

  def lock_key(account)
    "meesho_payments:lock:#{account.id}"
  end
end
