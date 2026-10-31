# Read one account's Inventory page on the Meesho panel into
# meesho_inventory_catalogs / meesho_inventory_listings — and from them the
# Meesho Stock page (MeeshoStockSheet): every catalog under
# Active, Activation pending and Paused, and the SKUs (product + variation) in
# each. Queued every INTERVAL minutes by MeeshoScheduleJob, at once by Refresh
# on the Meesho Inventory page, and after a pause (MeeshoArchiveJob).
#
# The catalog lists are a few requests (200 a page) and are read in full every
# time. SKUs come one catalog per request, so a catalog's SKUs are read again
# only when it is new, its counts changed, or they are STALE_AFTER old — at
# most PRODUCT_CALLS a run. A first load of thousands of catalogs carries on in
# follow-up runs a few minutes apart rather than in one burst.
class MeeshoInventoryJob
  include Sidekiq::Job
  sidekiq_options queue: "default", retry: false

  INTERVAL = 30                  # minutes between scheduled pulls
  PRODUCT_CALLS = 300
  STALE_AFTER = 12.hours
  CONTINUE_IN = 3.minutes
  GAP = 0.15                     # seconds between SKU requests
  FAILURES_IN_A_ROW = 5
  LOCK_TTL = 30 * 60
  SELLABLE = %w[active paused].freeze

  def perform(account_id, run_id = nil, trigger = MeeshoSyncRun::TRIGGER_MANUAL)
    account = MeeshoAccount.find_by(id: account_id)
    return unless account && account.status != MeeshoAccount::STATUS_DISABLED
    run = run_id && MeeshoSyncRun.find_by(id: run_id)
    run ||= account.runs.create!(kind: MeeshoSyncRun::KIND_INVENTORY, trigger: trigger, status: "QUEUED", queued_at: Time.current)
    unless lock(account)
      run.finish!(false, "An inventory pull for this account is still running.")
      return
    end
    run.start!
    begin
      if account.supplier_id.blank? || account.supplier_identifier.blank?
        raise MeeshoClient::RequestError, "the supplier's ID and code aren't known — set them on the Meesho Sync page"
      end
      @client = account.cookies.present? ? MeeshoClient.new(account) : MeeshoLoginJob.login!(account)
      message, records, left = pull(account)
      account.cookies = @client.cookies
      account.save!
      run.finish!(true, message, records: records)
      # The rest of a big first load, a few minutes on — only while it gets somewhere.
      self.class.perform_in(CONTINUE_IN, account.id, nil, MeeshoSyncRun::TRIGGER_SCHEDULE) if left.positive? && @fetched.positive?
    rescue MeeshoClient::AuthError, MeeshoClient::RequestError, SecretBox::NotConfigured => e
      run.finish!(false, e.message)
    rescue StandardError => e
      Sidekiq.logger.error("MeeshoInventoryJob #{account.id}: #{e.class}: #{e.message}")
      run.finish!(false, "Unexpected error (#{e.class.name.demodulize}) — the next pull will try again.")
    ensure
      unlock(account)
    end
  end

  private

  # Returns [message, SKUs stored this run, catalogs whose SKUs still wait].
  def pull(account)
    counts = relogin(account) { MeeshoInventory.counts(@client, account) }
    lists = MeeshoInventory::TABS.keys.index_with { |tab| relogin(account) { MeeshoInventory.catalogs(@client, account, tab) } }
    now = Time.current
    seen = {}
    lists.each do |tab, cats|
      cats.each do |c|
        e = (seen[c["id"].to_i] ||= { attrs: MeeshoInventory.catalog_attrs(c), tabs: [], carried: {} })
        e[:tabs] << tab
        # The first catalog of each page arrives with its SKUs.
        e[:carried][tab] = c["products"] if c["products"].is_a?(Array) && c["products"].any?
      end
    end
    save_catalogs(account, seen, now)
    MeeshoSyncSnapshot.find_or_initialize_by(account_id: account.id, endpoint: "inventory_counts")
                      .update!(http_status: 200, payload: counts, fetched_at: now)

    @fetched = 0
    @calls_allowed = MeeshoSyncSetting.value(:inventory_sku_reads, PRODUCT_CALLS).to_i
    stored = 0
    left = 0
    failed = 0
    in_a_row = 0
    due = seen.values.select { |e| (e[:tabs] & SELLABLE).any? && stale?(e[:record]) }
    # Never read (or changed) first, then the longest ago.
    due.sort_by! { |e| e[:record].products_fetched_at || Time.at(0) }
    due.each do |e|
      tabs = e[:tabs] & SELLABLE
      calls = tabs.count { |t| !e[:carried].key?(t) }
      if @fetched + calls > @calls_allowed
        left += 1
        next
      end
      begin
        by_tab = tabs.index_with do |t|
          next e[:carried][t] if e[:carried].key?(t)
          sleep GAP if @fetched.positive?
          @fetched += 1
          relogin(account) { MeeshoInventory.products(@client, account, t, e[:record].catalog_id) }
        end
      rescue MeeshoClient::RequestError => err
        # One catalog Meesho won't hand over is tried again next pull; a run
        # of them means Meesho itself is down, and the pull stops.
        failed += 1
        in_a_row += 1
        raise if in_a_row >= FAILURES_IN_A_ROW
        Sidekiq.logger.warn("MeeshoInventoryJob #{account.id}: catalog #{e[:record].catalog_id}: #{err.message}")
        next
      end
      in_a_row = 0
      stored += save_listings(account, e[:record], by_tab, now)
    end

    sheet = MeeshoStockSheet.mirror!(account, complete: left.zero? && failed.zero?)
    # Django's response cache can't see these writes (Meesho Stock is cached
    # like any page): this stamp, part of every cache key, tells it.
    account.orders_changed_at = Time.current if stored.positive? || sheet.values.sum.positive?

    named = { "active" => "Active", "paused" => "Paused", "activation_pending" => "Activation pending", "blocked" => "Blocked" }
    message = named.filter_map { |k, label| "#{label} #{counts[k]}" if counts.key?(k) }.join(" · ")
    read = due.size - left - failed
    message += " catalogs on Meesho. SKUs read for #{read} catalog#{'s' unless read == 1}"
    message += left.positive? ? " — #{left} more on the next pulls." : "."
    message += " #{failed} catalog#{'s' unless failed == 1} Meesho wouldn't hand over — tried again next pull." if failed.positive?
    message += " Meesho Stock: #{sheet[:added]} added, #{sheet[:updated]} updated, #{sheet[:removed]} removed."
    [message, stored, left]
  end

  def stale?(cat)
    cat.products_fetched_at.nil? || cat.products_fetched_at < STALE_AFTER.ago
  end

  # Upsert every catalog seen; a catalog no tab lists any more is gone
  # (deleted or blocked) and is dropped with its SKUs.
  def save_catalogs(account, seen, now)
    existing = account.catalogs.index_by(&:catalog_id)
    MeeshoCatalog.transaction do
      seen.each do |id, e|
        cat = existing[id] || account.catalogs.new(catalog_id: id)
        flags = { in_active: e[:tabs].include?("active"), in_paused: e[:tabs].include?("paused"),
                  in_pending: e[:tabs].include?("activation_pending") }
        changed = cat.new_record? || MeeshoInventory::SUMMARY.any? { |k| cat[k] != e[:attrs][k] } ||
                  flags.any? { |k, v| cat[k] != v }
        cat.assign_attributes(e[:attrs].merge(flags).merge(seen_at: now))
        cat.products_fetched_at = nil if changed
        cat.save!
        e[:record] = cat
      end
      gone = existing.except(*seen.keys).values.map(&:id)
      if gone.any?
        MeeshoListing.where(catalog_id: gone).delete_all
        MeeshoCatalog.where(id: gone).delete_all
      end
    end
  end

  # One catalog's SKUs as just read (live ones from Active, paused ones from
  # Paused) replace what was kept for it.
  def save_listings(account, cat, by_tab, now)
    keep = []
    MeeshoListing.transaction do
      by_tab.each do |tab, products|
        Array(products).each do |p|
          next unless p.is_a?(Hash) && p["id"] && p["variation_id"]
          row = MeeshoListing.find_or_initialize_by(account_id: account.id, product_id: p["id"].to_i, variation_id: p["variation_id"].to_i)
          attrs = MeeshoInventory.listing_attrs(p)
          attrs[:archived] ||= tab == "paused"
          row.assign_attributes(attrs.merge(catalog_id: cat.id, seen_at: now))
          row.save!
          keep << row.id
        end
      end
      cat.listings.where.not(id: keep).delete_all
      cat.update!(products_fetched_at: now)
    end
    keep.size
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
    "meesho_inventory:lock:#{account.id}"
  end
end
