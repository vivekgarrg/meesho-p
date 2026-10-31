# Read one account's Returns page on the Meesho panel, every INTERVAL minutes
# (MeeshoScheduleJob) or at once from Meesho → Returns & OTPs:
#
#   - the couriers' delivery OTPs (fetchDeliveryOTPs) → snapshot delivery_otps;
#   - every return under each status — in transit, out for delivery,
#     delivered, lost, disposed (fetchReturnClaims, every page) → snapshots
#     returns_<status>;
#
# then Django (sync_meesho_returns → meesho_returns) puts each return in the
# returns table's shape and writes it through the Returns upload's importer.
class MeeshoReturnsJob
  include Sidekiq::Job
  sidekiq_options queue: "default", retry: false

  INTERVAL = 10                  # minutes between scheduled reads
  BASE = "/api/fulfillment/returnRto/".freeze
  PAGE_SIZE = 50
  MAX_PAGES = 60
  LOCK_TTL = 15 * 60
  GAP = 1.5                      # seconds between page requests — Meesho answers 429 to bursts
  RATE_WAIT = 20                 # seconds to wait when it does,
  RATE_RETRIES = 2               # and how often before leaving that status for the next read
  LABELS = { "intransit" => "in transit", "ofd_reverse" => "out for delivery", "completed_delivered" => "delivered",
             "completed_lost" => "lost", "reverse_disposed" => "disposed" }.freeze
  # Meesho's status filter → extra filters the panel sends with it (delivered
  # and lost are read for the last two weeks, as the panel shows them).
  STATUSES = {
    "intransit" => {}, "ofd_reverse" => {},
    "completed_delivered" => { "delivered_date" => { "value" => "last_2_week" } },
    "completed_lost" => { "lost_date" => { "value" => "last_2_week" } },
    "reverse_disposed" => {},
  }.freeze

  def perform(account_id, run_id = nil, trigger = MeeshoSyncRun::TRIGGER_MANUAL)
    account = MeeshoAccount.find_by(id: account_id)
    return unless account && account.status != MeeshoAccount::STATUS_DISABLED
    run = run_id && MeeshoSyncRun.find_by(id: run_id)
    run ||= account.runs.create!(kind: MeeshoSyncRun::KIND_RETURNS, trigger: trigger, status: "QUEUED", queued_at: Time.current)
    unless lock(account)
      run.finish!(false, "A returns read for this account is still running.")
      return
    end
    run.start!
    begin
      if account.supplier_id.blank? || account.supplier_identifier.blank?
        raise MeeshoClient::RequestError, "the supplier's ID and code aren't known — set them under Meesho → Settings"
      end
      @client = account.cookies.present? ? MeeshoClient.new(account) : MeeshoLoginJob.login!(account)
      otps = relogin(account) { otps(account) }
      save(account, "delivery_otps", otps)
      read = {}
      partial = {}
      window = MeeshoSyncSetting.value(:returns_window, "last_2_week")
      STATUSES.each do |st, extra|
        # Delivered and lost: as far back as the Sync schedule says.
        extra = extra.transform_values { |f| f.is_a?(Hash) && f.key?("value") ? f.merge("value" => window) : f }
        rows, problem = relogin(account) { returns(account, st, extra) }
        partial[st] = problem if problem
        # A status Meesho wouldn't hand over at all keeps its last read.
        next if rows.nil?
        read[st] = rows
        save(account, "returns_#{st}", rows)
      end
      raise MeeshoClient::RequestError, "Meesho wouldn't hand over any returns: #{partial.values.first}" if read.empty?
      written = DjangoCommand.run("meesho_inject", "--account", account.id, "--kind", "returns")
      account.cookies = @client.cookies
      account.save!
      couriers = Array(otps["supplier_delivery_otp"]).size
      run.update!(result: { "read" => read.transform_values(&:size), "partial" => partial, "written" => written })
      counts = LABELS.filter_map { |st, label| "#{label} #{read[st].size}#{' (partial)' if partial[st]}" if read[st] }
      gone = LABELS.filter_map { |st, label| "#{label}: not read (#{partial[st]})" unless read[st] }
      refused = written["rejected"].to_i.positive? ? "#{written['rejected']} refused (#{written['reject_reasons'].keys.join('; ')}). " : ""
      run.finish!(true, "Returns — #{counts.join(', ')}. #{gone.join('. ')}#{'. ' if gone.any?}#{refused}" \
                        "OTPs for #{couriers} courier#{'s' unless couriers == 1}.", records: read.values.sum(&:size))
    rescue MeeshoClient::AuthError, MeeshoClient::RequestError, SecretBox::NotConfigured, DjangoCommand::Failed => e
      run.finish!(false, e.message)
    rescue StandardError => e
      Sidekiq.logger.error("MeeshoReturnsJob #{account.id}: #{e.class}: #{e.message}")
      run.finish!(false, "Unexpected error (#{e.class.name.demodulize}: #{e.message.truncate(150)}) — the next read will try again.")
    ensure
      unlock(account)
    end
  end

  private

  def headers(account, tab = "overview")
    { "identifier" => account.supplier_identifier, "client-package-version" => "1.0.4", "content-type" => "application/json",
      "referer" => "#{MeeshoClient::BASE}/panel/v3/new/fulfillment/#{account.supplier_identifier}/returns/#{tab}" }
  end

  def otps(account)
    body = @client.post("#{BASE}fetchDeliveryOTPs", headers: headers(account),
                        body: { supplier_id: account.supplier_id.to_i, identifier: account.supplier_identifier,
                                child_supplier_identifier: nil, child_supplier_id: nil }).body
    body.is_a?(Hash) ? body : {}
  end

  # Every return under one status, page after page (Meesho hands back a cursor).
  # Returns [rows, problem]: rows nil when not even the first page came; a
  # problem (e.g. a later page refused, or "too many requests") with the rows
  # read so far otherwise — nothing is ever deleted on a partial read.
  def returns(account, status, extra)
    rows = []
    cursor = filter_cursor = nil
    MAX_PAGES.times do |page|
      sleep GAP if page.positive?
      who = { supplier_details: { identifier: account.supplier_identifier, id: account.supplier_id.to_i },
              identifier: account.supplier_identifier, child_supplier_identifier: nil, child_supplier_id: nil }
      body = if page.zero?
        { screenType: "returns", size: PAGE_SIZE, page_pointer: nil, cursor: nil, filter_cursor: nil,
          filters: { "shipment_status" => status }.merge(extra) }.merge(who)
      else
        # The next page, as the panel asks for it: the page we're on and the
        # one wanted, with both cursors the last page handed back — and no
        # filters (they travel inside filter_cursor).
        { screenType: "returns", size: PAGE_SIZE, page_pointer: page, cursor: cursor, filter_cursor: filter_cursor,
          targetPage: page + 1 }.merge(who)
      end
      waits = 0
      begin
        res = @client.post("#{BASE}fetchReturnClaims", body: body, headers: headers(account, "returnTracking-#{status}")).body
      rescue MeeshoClient::RequestError => e
        # "Too many requests": Meesho wants a pause, not a give-up.
        if e.message.include?("HTTP 429") && waits < RATE_RETRIES
          waits += 1
          sleep RATE_WAIT
          retry
        end
        return [page.zero? ? nil : dedupe(rows), e.message.truncate(120)]
      end
      data = Array(res.is_a?(Hash) ? res["data"] : nil).select { |r| r.is_a?(Hash) }
      rows.concat(data)
      total = res.is_a?(Hash) ? res["total_pages"].to_i : 0
      nxt = res.is_a?(Hash) ? res["cursor"].presence : nil
      filter_cursor = (res["filter_cursor"].presence if res.is_a?(Hash)) || filter_cursor
      break if data.empty? || nxt.nil? || nxt == cursor || (total.positive? && page + 1 >= total)
      cursor = nxt
    end
    [dedupe(rows), nil]
  end

  def dedupe(rows)
    rows.uniq { |r| [r["sub_order_num"], r["awb"]] }
  end

  def save(account, endpoint, payload)
    MeeshoSyncSnapshot.find_or_initialize_by(account_id: account.id, endpoint: endpoint)
                      .update!(http_status: 200, payload: payload, fetched_at: Time.current)
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
    "meesho_returns:lock:#{account.id}"
  end
end
