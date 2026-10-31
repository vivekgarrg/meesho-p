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
      records, notes = pull(account)
      message = notes.join(" ")
      account.update!(last_sync_at: Time.current, last_sync_status: "OK", last_sync_message: message)
      run.finish!(true, message, records: records)
    rescue MeeshoClient::AuthError, MeeshoClient::RequestError, SecretBox::NotConfigured, PanelOrders::WrongBusiness => e
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

  def pull(account)
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
      missing = Array(ep[:needs]).select { |f| account.public_send(f).blank? }
      if missing.any?
        raise MeeshoClient::RequestError,
              "#{ep[:key]}: the supplier's #{missing.map { |f| f.to_s.tr('_', ' ') }.join(' and ')} isn't known — " \
              "set it under Advanced on the Meesho Sync page."
      end
      rows, pages, status = fetch_all(account, ep)
      if ep[:orders_tab]
        rows = rows.map { |r| PanelOrders.normalize(r, ep[:orders_tab]) }
        panel_rows.concat(rows)
      end
      pulled << [ep, rows, pages, status]
    end
    # Nothing is written until everything is pulled and checked.
    PanelOrders.check_business!(account.business_id, panel_rows)
    pulled.each do |ep, rows, pages, status|
      snap = MeeshoSyncSnapshot.find_or_initialize_by(account_id: account.id, endpoint: ep[:key])
      snap.update!(http_status: status, payload: rows, fetched_at: Time.current)
      records += rows.size
      notes << "#{ep[:key].tr('_', ' ')}: #{rows.size}#{" (#{pages} pages)" if pages > 1}."
    end
    if panel_rows.any?
      m = PanelOrders.mirror!(account.business_id, panel_rows)
      notes << "Orders table: #{m[:added]} added, #{m[:status_changed]} status changes, #{m[:updated]} updated."
      # Django's response cache can't see these writes; this stamp tells it.
      account.orders_changed_at = Time.current if m.values.sum.positive?
    end
    account.cookies = @client.cookies
    account.save!
    [records, notes]
  end

  # Every page of one endpoint. A cursor-paged API is asked again with the
  # cursor each page hands back, until a page is empty or says there is no more.
  def fetch_all(account, ep)
    rows = []
    cursor = nil
    status = 0
    pages = 0
    loop do
      res = fetch(account, ep, cursor)
      status = res.status
      pages += 1
      page = self.class.rows_in(res.body)
      rows.concat(page)
      break unless ep[:paginate] == :cursor && page.any? && pages < MeeshoEndpoints::MAX_PAGES
      total = res.body.is_a?(Hash) ? res.body["total_count"] : nil
      break if total.is_a?(Integer) && rows.size >= total
      nxt = self.class.cursor_in(res.body)
      break if nxt.blank? || nxt == cursor || self.class.no_more?(res.body)
      cursor = nxt
    end
    [rows, pages, status]
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
