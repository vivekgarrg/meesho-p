# Pull every configured Meesho endpoint for one account. Queued every few
# minutes by MeeshoScheduleJob, and at once by Refresh on the sync page.
class MeeshoSyncJob
  include Sidekiq::Job
  sidekiq_options queue: "critical", retry: 1

  LOCK_TTL = 10 * 60

  def perform(account_id, run_id = nil, trigger = MeeshoSyncRun::TRIGGER_MANUAL)
    account = MeeshoAccount.find_by(id: account_id)
    return unless account && account.status != MeeshoAccount::STATUS_DISABLED
    run = run_id && MeeshoSyncRun.find_by(id: run_id)
    run ||= account.runs.create!(kind: MeeshoSyncRun::KIND_SYNC, trigger: trigger, status: "QUEUED", queued_at: Time.current)
    # One sync per account at a time: a Refresh during a scheduled pull waits its turn.
    unless lock(account)
      run.finish!(false, "Another sync for this account is still running.")
      return
    end
    run.start!
    begin
      records, notes = pull(account, trigger)
      message = notes.join(" ")
      account.update!(last_sync_at: Time.current, last_sync_status: "OK", last_sync_message: message)
      run.finish!(true, message, records: records)
    rescue MeeshoClient::AuthError, MeeshoClient::RequestError, SecretBox::NotConfigured, PanelOrders::WrongBusiness,
           DjangoCommand::Failed => e
      account.update!(last_sync_at: Time.current, last_sync_status: "FAILED", last_sync_message: e.message)
      run.finish!(false, e.message)
    rescue StandardError => e
      # Never leave a run stuck on RUNNING: record it, and let the next
      # scheduled pull try again rather than Sidekiq retrying this one.
      Sidekiq.logger.error("MeeshoSyncJob #{account.id}: #{e.class}: #{e.message}")
      message = "Unexpected error (#{e.class.name.demodulize}) — the next pull will try again."
      account.update!(last_sync_at: Time.current, last_sync_status: "FAILED", last_sync_message: message)
      run.finish!(false, message)
    ensure
      unlock(account)
    end
  end

  private

  def pull(account, trigger = MeeshoSyncRun::TRIGGER_MANUAL)
    @client = account.cookies.present? ? MeeshoClient.new(account) : MeeshoLoginJob.login!(account)
    endpoints = MeeshoEndpoints.all
    if endpoints.empty?
      return [0, ["Session is active. No data endpoints are set up yet — share the orders API request to add it."]]
    end
    records = 0
    notes = []
    panel_rows = []
    pulled = []
    endpoints.each do |ep|
      next if trigger == MeeshoSyncRun::TRIGGER_SCHEDULE && fresh?(account, ep)
      missing = Array(ep[:needs]).select { |f| account.public_send(f).blank? }
      if missing.any?
        raise MeeshoClient::RequestError,
              "#{ep[:key]}: the supplier's #{missing.map { |f| f.to_s.tr('_', ' ') }.join(' and ')} isn't known — " \
              "set it under Advanced on the Meesho Sync page."
      end
      rows, pages, status, total = fetch_all(account, ep)
      if ep[:orders_tab]
        rows = rows.map { |r| PanelOrders.normalize(r, ep[:orders_tab]) }
        panel_rows.concat(rows)
      end
      pulled << [ep, rows, pages, status, total]
    end
    # Nothing is written until everything is pulled and checked.
    PanelOrders.check_business!(account.business_id, panel_rows)
    pulled.each do |ep, rows, pages, status, total|
      snap = MeeshoSyncSnapshot.find_or_initialize_by(account_id: account.id, endpoint: ep[:key])
      snap.update!(http_status: status, payload: rows, fetched_at: Time.current)
      records += rows.size
      # Short only when fewer rows came than Meesho lists (Ready to ship's
      # total counts shipments, which can hold several of its rows).
      short = total && rows.size < total && self.class.counted(rows) < total
      notes << "#{ep[:key].tr('_', ' ')}: #{rows.size}#{" (#{pages} pages)" if pages > 1}" \
               "#{" — short of the #{total} Meesho lists" if short}."
    end
    if panel_rows.any?
      # The orders middleware (Django, sync_middleware/orders.py) brings the
      # orders table up to date from these snapshots, and has the cached
      # screens (profit…) recomputed.
      m = DjangoCommand.run("meesho_inject", "--account", account.id, "--kind", "orders")
      notes << "Orders table: #{m['added'].to_i} added, #{m['status_changed'].to_i} status changes, #{m['updated'].to_i} updated" \
               "#{", #{m['kept_further_on']} kept further on" if m['kept_further_on'].to_i.positive?}" \
               "#{", #{m['rejected']} refused (#{m['reject_reasons'].keys.join('; ')})" if m['rejected'].to_i.positive?}."
      account.orders_changed_at = Time.current if (m["added"].to_i + m["status_changed"].to_i + m["updated"].to_i).positive?
    end
    account.cookies = @client.cookies
    account.save!
    [records, notes]
  end

  # An endpoint pulled less often (`every:` minutes) whose snapshot is recent enough.
  def fresh?(account, ep)
    return false unless ep[:every]
    every = ep[:orders_tab] == "shipped" ? MeeshoSyncSetting.value(:shipped_every, ep[:every]) : ep[:every]
    at = MeeshoSyncSnapshot.where(account_id: account.id, endpoint: ep[:key]).pick(:fetched_at)
    at.present? && at > every.to_i.minutes.ago
  end

  # Every page of one endpoint. Meesho says on the first page how many orders
  # the tab holds (total_count) and hands back a cursor for the next page —
  # Ready to ship's first page is just the orders still waiting for a label. Pages are asked for until
  # that many are in hand; an empty page or a has_more: false doesn't stop it
  # short of the total, only the cursor running out (or MAX_PAGES) does.
  # Returns [rows, pages, http status, total_count or nil].
  def fetch_all(account, ep)
    rows = []
    seen = {}
    cursor = nil
    status = 0
    pages = 0
    total = nil
    idle = 0
    loop do
      res = fetch(account, ep, cursor)
      status = res.status
      pages += 1
      page = self.class.rows_in(res.body)
      # A cursor can hand back an order already read — keep each sub-order once.
      fresh = page.select do |r|
        k = r["sub_order_num"]
        next true if k.blank?
        next false if seen.key?(k)
        seen[k] = true
      end
      rows.concat(fresh)
      break unless ep[:paginate] == :cursor && pages < MeeshoEndpoints::MAX_PAGES
      # Only the first page says how many there are; later pages say 0.
      t = res.body.is_a?(Hash) ? res.body["total_count"] : nil
      total ||= t if t.is_a?(Integer) && t.positive?
      if total
        break if self.class.counted(rows) >= total
        idle = fresh.empty? ? idle + 1 : 0
        break if idle >= 2                      # two pages with nothing new: the cursor is going round
      else
        break if page.empty? || self.class.no_more?(res.body)
      end
      nxt = self.class.cursor_in(res.body)
      break if nxt.blank? || nxt == cursor
      cursor = nxt
    end
    [rows, pages, status, total]
  end

  # One request; if the session has lapsed, log in again once and retry.
  def fetch(account, ep, cursor)
    call(@client, account, ep, cursor)
  rescue MeeshoClient::AuthError
    @client = MeeshoLoginJob.login!(account)
    call(@client, account, ep, cursor)
  end

  def call(client, account, ep, cursor)
    headers = ep[:headers] ? ep[:headers].call(account) : {}
    if ep[:method] == :post
      body = ep[:body].respond_to?(:call) ? ep[:body].call(account, cursor) : (ep[:body] || {})
      client.post(ep[:path], body: body, headers: headers)
    else
      params = ep[:params].respond_to?(:call) ? ep[:params].call(account, cursor) : (ep[:params] || {})
      client.get(ep[:path], params: params, headers: headers)
    end
  end

  ROW_KEYS = %w[orders order_list orderList items list results rows records data].freeze
  CURSOR_KEYS = %w[cursor next_cursor nextCursor next_page_cursor nextPageCursor].freeze
  MORE_KEYS = %w[has_more hasMore has_next hasNext].freeze

  # The list of records in a response, wherever the panel put it.
  def self.rows_in(body, depth = 0)
    if depth.zero? && (panel = PanelOrders.rows(body))
      return panel
    end
    return body.select { |r| r.is_a?(Hash) } if body.is_a?(Array)
    return [] unless body.is_a?(Hash) && depth < 4
    ROW_KEYS.each do |k|
      v = body[k]
      return v.select { |r| r.is_a?(Hash) } if v.is_a?(Array) && v.any? { |r| r.is_a?(Hash) }
    end
    ROW_KEYS.each do |k|
      found = rows_in(body[k], depth + 1) if body[k].is_a?(Hash)
      return found if found.present?
    end
    body.each_value do |v|
      found = rows_in(v, depth + 1) if v.is_a?(Hash)
      return found if found.present?
    end
    []
  end

  # How many of what total_count counts have been read. Ready to ship counts
  # shipments, not the sub-orders listed under them — so count the coarsest
  # unit the rows carry. Counting low only costs one extra (empty) page;
  # counting high stopped Ready to ship short.
  def self.counted(rows)
    rows.map { |r| r["grouping_key"].presence || r["order_num"].presence || r["sub_order_num"] || r.object_id }.uniq.size
  end

  def self.cursor_in(body, depth = 0)
    return nil unless body.is_a?(Hash) && depth < 4
    CURSOR_KEYS.each { |k| v = body[k]; return v.to_s if v.is_a?(String) || v.is_a?(Numeric) }
    body.each_value { |v| (c = cursor_in(v, depth + 1)) && (return c) if v.is_a?(Hash) }
    nil
  end

  def self.no_more?(body, depth = 0)
    return false unless body.is_a?(Hash) && depth < 4
    MORE_KEYS.each { |k| return true if body[k] == false }
    body.each_value { |v| return true if v.is_a?(Hash) && no_more?(v, depth + 1) }
    false
  end

  def lock(account)
    Sidekiq.redis { |r| r.call("SET", lock_key(account), jid.to_s, "NX", "EX", LOCK_TTL) } == "OK"
  end

  def unlock(account)
    Sidekiq.redis { |r| r.call("DEL", lock_key(account)) }
  end

  def lock_key(account)
    "meesho_sync:lock:#{account.id}"
  end
end
