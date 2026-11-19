# A leave (Django: meesho_app.models.MeeshoLeave) for one Meesho account.
#
# start: every catalog under the panel's Active tab is read fresh; each live SKU is
#        recorded first (MeeshoLeaveItem, with its stock — what brings it back),
#        then the catalog's live SKUs are paused in one request (archiveSKU), one
#        catalog a moment after another.
# guard: every hour while on leave (MeeshoScheduleJob): the same again — anything
#        live is paused. One the leave paused that's live again (Meesho, the panel,
#        anyone) is paused again and counted; a SKU listed since is recorded and
#        paused too, so it comes back at the end with the rest.
# end:   at the end time, or ended by hand: each SKU the leave paused that is still
#        paused gets its recorded stock back — giving a paused SKU stock is how
#        Meesho unpauses it. One live again already is left as it is; one that had
#        no stock when paused stays paused (stock 0 can't bring it back) — said so.
#
# A SKU's recorded stock is never written over; each SKU's state is written as it
# goes, so a stop part-way leaves an exact record, and running again carries on.
class MeeshoLeaveJob
  include Sidekiq::Job
  sidekiq_options queue: "critical", retry: false      # never pause or bring back twice by itself

  GAP = 1.0            # seconds between pause / stock requests (bot protection)
  READ_GAP = 0.3       # between catalog reads
  RATE_WAIT = 20
  RATE_RETRIES = 3

  def perform(account_id, leave_id, mode)
    account = MeeshoAccount.find_by(id: account_id)
    leave = MeeshoLeave.find_by(id: leave_id, account_id: account_id)
    return unless account && leave
    begin
      @client = account.cookies.present? ? MeeshoClient.new(account) : MeeshoLoginJob.login!(account)
      case mode
      when "start" then start!(account, leave)
      when "guard" then guard!(account, leave)
      when "end" then end!(account, leave)
      else raise ArgumentError, "unknown mode #{mode.inspect}"
      end
      account.cookies = @client.cookies
      account.save!
    rescue MeeshoClient::AuthError, MeeshoClient::RequestError, SecretBox::NotConfigured => e
      stopped(leave, mode, "Stopped — #{e.message}")
    rescue StandardError => e
      Sidekiq.logger.error("MeeshoLeaveJob #{account_id}: #{e.class}: #{e.message}")
      stopped(leave, mode, "Unexpected error (#{e.class.name.demodulize}) — check the Inventory page on the Meesho panel.")
    ensure
      MeeshoInventoryJob.perform_async(account.id, nil, MeeshoSyncRun::TRIGGER_MANUAL) if account
    end
  end

  private

  def now
    Time.current
  end

  # ── start / guard: pause everything live ────────────────────────────────
  def start!(account, leave)
    return unless %w[SCHEDULED PAUSING].include?(leave.status)
    leave.update!(status: "PAUSING", message: "Pausing every live catalog…")
    r = pause_live(account, leave)
    counts = leave.items.group(:state).count
    paused = counts["PAUSED"].to_i
    msg = "On leave — #{paused} SKU#{'s' unless paused == 1} paused in #{r[:catalogs]} catalog#{'s' unless r[:catalogs] == 1}."
    msg += " Meesho refused #{counts['PAUSE_FAILED']} — they're tried again at the hourly check." if counts["PAUSE_FAILED"].to_i.positive?
    msg += " #{r[:unread]} catalog#{'s' unless r[:unread] == 1} couldn't be read — tried again at the hourly check." if r[:unread].positive?
    leave.update!(status: "ON_LEAVE", paused_at: leave.paused_at || now, last_guard_at: now, message: msg)
  end

  def guard!(account, leave)
    return unless leave.status == "ON_LEAVE"
    r = pause_live(account, leave)
    leave.update!(last_guard_at: now, repaused: leave.repaused + r[:repaused],
                  message: "On leave — checked #{now.in_time_zone('Asia/Kolkata').strftime('%-d %b, %-I:%M %p')}: " +
                           (r[:repaused] + r[:new]).then { |n| n.zero? ? "nothing live — all paused." : "#{r[:repaused]} found live again and #{r[:new]} newly listed — paused." } +
                           (r[:failed].positive? ? " #{r[:failed]} Meesho refused — tried again next hour." : ""))
  end

  # Everything under Active now: recorded (once), then paused catalog by catalog.
  # Returns { catalogs:, new:, repaused:, failed:, unread: }.
  def pause_live(account, leave)
    out = { catalogs: 0, new: 0, repaused: 0, failed: 0, unread: 0 }
    cats = with_retries(account) { MeeshoInventory.catalogs(@client, account, "active") }
    known = leave.items.index_by { |x| [x.product_id, x.variation_id] }
    cats.each_with_index do |c, i|
      sleep READ_GAP if i.positive? && !Rails.env.test?
      products = begin
        with_retries(account) { MeeshoInventory.products(@client, account, "active", c["id"]) }
      rescue MeeshoClient::RequestError
        out[:unread] += 1
        next
      end
      live = products.filter_map do |p|
        a = MeeshoInventory.listing_attrs(p)
        next if a[:archived]
        key = [p["id"].to_i, p["variation_id"].to_i]
        item = known[key]
        was_paused = item && item.paused_at.present?
        unless item
          # Recorded before anything is changed — its stock is what brings it back. Never written over.
          item = leave.items.create!(catalog_id: c["id"].to_i, product_id: key[0], variation_id: key[1],
                                     sku_id: a[:sku_id].to_s.truncate(255, omission: ""), variation: a[:variation].to_s.truncate(255, omission: ""),
                                     previous_inventory: a[:inventory], state: "PAUSE_FAILED", message: "not paused yet")
          known[key] = item
        end
        [item, was_paused]
      end
      next if live.empty?
      out[:catalogs] += 1
      sleep GAP if out[:catalogs] > 1 && !Rails.env.test?
      begin
        with_retries(account) do
          MeeshoInventory.archive(@client, account, c["id"], live.map { |x, _| { product_id: x.product_id, variation_id: x.variation_id } })
        end
        live.each do |item, was_paused|
          if was_paused
            out[:repaused] += 1
            item.update!(state: "PAUSED", times_repaused: item.times_repaused + 1, paused_at: now, message: "found live again — paused")
          else
            out[:new] += 1 if leave.status == "ON_LEAVE"
            item.update!(state: "PAUSED", paused_at: now, message: "")
          end
        end
        MeeshoListing.where(account_id: account.id, product_id: live.map { |x, _| x.product_id }).update_all(archived: true)
      rescue MeeshoClient::RequestError => e
        out[:failed] += live.size
        live.each { |item, _| item.update!(state: "PAUSE_FAILED", message: e.message.truncate(250)) }
      end
    end
    out
  end

  # ── end: bring back what the leave paused ───────────────────────────────
  def end!(account, leave)
    return unless %w[RESUMING ON_LEAVE ENDED].include?(leave.status)
    leave.update!(status: "RESUMING", message: "Bringing every catalog back…")
    todo = leave.items.where(state: %w[PAUSED RESUME_FAILED]).order(:catalog_id, :sku_id, :variation_id).to_a
    sent = 0
    todo.group_by(&:catalog_id).each_with_index do |(catalog_id, items), i|
      sleep READ_GAP if i.positive? && !Rails.env.test?
      paused = begin
        with_retries(account) { MeeshoInventory.products(@client, account, "paused", catalog_id) }
          .to_h { |p| [[p["id"].to_i, p["variation_id"].to_i], p] }
      rescue MeeshoClient::RequestError => e
        items.each { |x| x.update!(state: "RESUME_FAILED", message: "couldn't read its catalog: #{e.message}".truncate(250)) }
        next
      end
      active = nil
      items.each do |item|
        key = [item.product_id, item.variation_id]
        unless paused[key]
          active ||= begin
            with_retries(account) { MeeshoInventory.products(@client, account, "active", catalog_id) }
              .to_h { |p| [[p["id"].to_i, p["variation_id"].to_i], true] }
          rescue MeeshoClient::RequestError
            {}
          end
          if active[key]
            item.update!(state: "RESUMED", resumed_at: now, message: "live already")
          else
            item.update!(state: "RESUME_FAILED", message: "Meesho doesn't list it under Paused or Active right now — try again later")
          end
          next
        end
        if item.previous_inventory.to_i <= 0
          item.update!(state: "KEPT_PAUSED", message: "it had no stock when paused — give it stock on the Inventory page to bring it back")
          next
        end
        sleep GAP if sent.positive? && !Rails.env.test?
        sent += 1
        begin
          with_retries(account) do
            MeeshoInventory.update_stock(@client, account, catalog_id: item.catalog_id, product_id: item.product_id,
                                         variation_id: item.variation_id, inventory: item.previous_inventory, tab: "paused")
          end
          item.update!(state: "RESUMED", resumed_at: now, message: "")
          MeeshoListing.where(account_id: account.id, product_id: item.product_id, variation_id: item.variation_id)
                       .update_all(archived: false, inventory: item.previous_inventory)
        rescue MeeshoClient::RequestError => e
          item.update!(state: "RESUME_FAILED", message: e.message.truncate(250))
        end
      end
    end
    counts = leave.items.group(:state).count
    back, failed, kept = counts["RESUMED"].to_i, counts["RESUME_FAILED"].to_i, counts["KEPT_PAUSED"].to_i
    msg = "Back from leave — #{back} SKU#{'s' unless back == 1} live again."
    msg += " #{failed} not brought back yet — press Retry." if failed.positive?
    msg += " #{kept} had no stock when paused and stay paused." if kept.positive?
    leave.update!(status: "ENDED", resumed_at: now, message: msg)
  end

  # ── shared ──────────────────────────────────────────────────────────────
  def stopped(leave, mode, msg)
    paused = leave.items.where(state: "PAUSED").exists?
    status = case mode
             when "end" then "ENDED"                    # the record stays: Retry brings the rest back
             else paused ? "ON_LEAVE" : (mode == "start" ? "FAILED" : leave.status)
             end
    leave.update!(status: status, message: "#{msg}#{mode == 'end' ? ' — press Retry to bring the rest back.' : (paused ? ' — the hourly check carries on.' : '')}")
  end

  # Log in again once if the session lapsed; wait out "too many requests".
  def with_retries(account)
    waits = 0
    relogged = false
    begin
      yield
    rescue MeeshoClient::AuthError
      raise if relogged
      relogged = true
      @client = MeeshoLoginJob.login!(account)
      retry
    rescue MeeshoClient::RequestError => e
      raise unless e.message.include?("HTTP 429") && waits < RATE_RETRIES
      waits += 1
      sleep(RATE_WAIT * waits) unless Rails.env.test?
      retry
    end
  end
end
