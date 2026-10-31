require "tmpdir"

# Bring one account's Meesho payments into the app, every INTERVAL minutes
# (MeeshoScheduleJob) or at once from the Payments tab's Refresh:
#
#   1. the panel's day-by-day summaries (paid and upcoming) → a snapshot the
#      Payments tab shows;
#   2. the payment file for the last PAID_DAYS days (completed) → the
#      payments tables, through the same importer as the Payments upload;
#   3. the outstanding payment file, from today to the last payout day the
#      summary lists (up to UPCOMING_DAYS ahead) → meesho_outstanding_payments,
#      replaced each time. Should Meesho refuse that one file, then one file
#      per listed day — replaced only when every one of them was read.
#
# Meesho rations payment files per supplier and answers HTTP 429 past it —
# hence one outstanding file rather than one a day. A 429 is never taken as
# "no data": the call waits and tries again, and still refused it fails the
# read and the tables keep what they had, instead of replacing hundreds of
# outstanding payments with a few.
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
  POLL_SECONDS = 6
  POLL_TIMES = 30                # up to three minutes for Meesho to build a file
  REQUEST_TRIES = 3
  RETRY_SECONDS = 20
  RATE_WAIT = 30                 # seconds to wait after a 429 (×1, ×2, ×3)
  RATE_RETRIES = 3
  GAP = 6                        # seconds between outstanding days' requests
  STAGGER = 300                  # seconds between accounts' scheduled reads — one at a time
  BUDGET = 15 * 60               # a whole read never waits on Meesho longer than this…
  LOCK_TTL = 20 * 60             # …so it is done well before its lock runs out

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
    @deadline = Time.current + BUDGET
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
    summary = patient(account) { MeeshoPayments.summary(@client, account, paid_days: @paid_days, upcoming_days: @upcoming_days) }
    MeeshoSyncSnapshot.find_or_initialize_by(account_id: account.id, endpoint: "payments_summary")
                      .update!(http_status: 200, payload: summary, fetched_at: Time.current)

    today = ActiveSupport::TimeZone[MeeshoPayments::IST].today
    files = {}
    # Downloads go to a folder of their own in the system's temp space, gone
    # afterwards whatever happens.
    Dir.mktmpdir("meesho-payments") do |dir|
      files["completed"] = completed(account, today - @paid_days, today, dir)
      files["outstanding"] = outstanding(account, today, dir, payout_days(summary))
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

  # Outstanding payments: one file from today to the last listed payout day.
  # Refused (not rate-limited), one file a day instead — today, and each day
  # the summary lists a payout for; a listed day that can't be read keeps the
  # last outstanding payments, today with no file is nothing due today. With
  # no listing, day by day from today, stopping at the first day without a file.
  def outstanding(account, today, dir, listed)
    last = today + @upcoming_days
    listed = listed.select { |d| d > today && d <= last }
    base = { "from" => today.iso8601, "listed" => listed.map(&:iso8601) }
    if listed.any?
      begin
        path = fetch_file(account, "outstanding", today, listed.max, dir)
        return import_outstanding(account, base.merge("to" => listed.max.iso8601, "days" => [today, listed.max].map(&:iso8601)), [path])
      rescue MeeshoClient::RequestError => e
        return base.merge("error" => outstanding_kept(listed.max, e)) if rate_limited?(e)
        base["whole_file"] = e.message
      end
    end
    plan = listed.any? ? [today, *listed] : (today..last).to_a
    paths, days, skipped, stopped = [], [], [], nil
    plan.each_with_index do |day, i|
      sleep GAP if i.positive?
      begin
        paths << fetch_file(account, "outstanding", day, day, dir)
        days << day.iso8601
      rescue MeeshoClient::RequestError => e
        return base.merge("days" => days, "error" => outstanding_kept(day, e)) if rate_limited?(e) || listed.include?(day)
        if listed.any?
          skipped << day.iso8601                    # today, with nothing due today
        else
          stopped = { "day" => day.iso8601, "why" => e.message }
          break
        end
      end
    end
    out = base.merge("to" => (days.last || today.iso8601), "days" => days, "skipped" => skipped, "stopped" => stopped)
    if paths.empty?
      return out.merge("rows" => 0, "note" => "no outstanding file from #{today.strftime('%-d %b')} (#{stopped&.dig('why')}) — the last ones are kept")
    end
    import_outstanding(account, out, paths)
  end

  def import_outstanding(account, out, paths)
    counts = MeeshoPayments.import(account.business_id, paths, "outstanding")
    out.merge("counts" => counts, "rows" => counts.dig("outstanding", "rows").to_i)
  rescue MeeshoPayments::ImportError => e
    out.merge("error" => e.message)
  end

  def outstanding_kept(day, error)
    "couldn't read the file for #{day.strftime('%-d %b')} (#{error.message}) — the last outstanding payments are kept"
  end

  # The days the summary lists an upcoming payout for.
  def payout_days(summary)
    Array(summary.dig("upcoming", "daywisePayments")).filter_map do |d|
      Date.iso8601(d["date"].to_s) if d.is_a?(Hash) && d["date"].present?
    rescue Date::Error
      nil
    end.uniq.sort
  end

  # Request one file, wait for Meesho to build it, download it into `dir`.
  def fetch_file(account, kind, from, to, dir)
    job_id = request_file(account, kind, from, to)
    entry = wait_for(account, job_id)
    raise MeeshoClient::RequestError, "Meesho hadn't built the #{kind} file after #{POLL_SECONDS * POLL_TIMES}s" unless entry
    raise MeeshoClient::RequestError, "Meesho couldn't build the #{kind} file: #{entry['error']}" if entry["error"].present?
    MeeshoPayments.download(entry["filePath"], dir)
  end

  def request_file(account, kind, from, to)
    patient(account) { MeeshoPayments.request_file(@client, account, kind, from, to) }
  end

  # Read the download history until the file is ready (or failed). Too many
  # requests here just means a longer wait before the next look.
  def wait_for(account, job_id)
    POLL_TIMES.times do |i|
      sleep POLL_SECONDS if i.positive?
      begin
        e = relogin(account) { MeeshoPayments.history(@client, account) }[job_id]
      rescue MeeshoClient::RequestError => err
        raise unless rate_limited?(err)
        pause(RATE_WAIT, err)
        next
      end
      return e if e && (e["filePath"].present? || e["error"].present? || e["status"].to_s.upcase == "FAILED")
    end
    nil
  end

  # Sleep, unless that would take the read past its budget — then give up with `error`.
  def pause(seconds, error)
    raise error if @deadline && Time.current + seconds > @deadline
    sleep seconds
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

  # One call to Meesho, tried again when it says too many requests (429,
  # waiting longer each time) or refuses for a moment (5xx).
  def patient(account)
    waits = tries = 0
    begin
      relogin(account) { yield }
    rescue MeeshoClient::RequestError => e
      if rate_limited?(e) && waits < RATE_RETRIES
        waits += 1
        pause(RATE_WAIT * waits, e)
        retry
      elsif e.message.match?(/HTTP 5\d\d/) && (tries += 1) < REQUEST_TRIES
        pause(RETRY_SECONDS, e)
        retry
      end
      raise
    end
  end

  def rate_limited?(error)
    error.message.include?("HTTP 429")
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
