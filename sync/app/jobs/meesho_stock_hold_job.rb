# "Stock to 0, and back" (Django: meesho_bulk.py, MeeshoStockHold) for one account.
#
# hold:    1. every catalog of the hold is read fresh from Meesho (its Active
#             tab), and each live SKU's stock saved on its item (SAVED) — all of
#             them before anything is changed;
#          2. then each saved SKU is set to 0, one a moment apart (ZEROED, or
#             ZERO_FAILED with why).
#          A paused SKU, one already at 0, one Meesho gives no stock for, and the
#          SKUs of a catalog that couldn't be read are never touched.
# restore: each SKU the hold set to 0 is read fresh again and gets its saved
#          stock back — only if it is still live (stock would unpause a paused
#          one) and still at 0 (one restocked since is left as it is).
#
# Safe to run twice: a saved SKU is never read again (a second read would save
# the 0), a SKU is only set to 0 from SAVED, and only given its stock back from
# ZEROED / RESTORE_FAILED after checking it's still at 0. Each SKU's state is
# written as it goes, so a stop part-way leaves an exact record. The inventory is
# read again afterwards.
class MeeshoStockHoldJob
  include Sidekiq::Job
  sidekiq_options queue: "critical", retry: false

  GAP = 1.0            # seconds between stock changes (bot protection)
  READ_GAP = 0.3       # between catalog reads
  RATE_WAIT = 20
  RATE_RETRIES = 3

  def perform(account_id, run_id, hold_id, mode)
    account = MeeshoAccount.find_by(id: account_id)
    run = MeeshoSyncRun.find_by(id: run_id)
    hold = MeeshoStockHold.find_by(id: hold_id, account_id: account_id)
    return unless account && run && hold
    run.start!
    begin
      @client = account.cookies.present? ? MeeshoClient.new(account) : MeeshoLoginJob.login!(account)
      mode == "restore" ? restore(account, hold, run) : hold!(account, hold, run)
      account.cookies = @client.cookies
      account.save!
    rescue MeeshoClient::AuthError, MeeshoClient::RequestError, SecretBox::NotConfigured => e
      stopped(hold, run, mode, "Stopped — #{e.message}")
    rescue StandardError => e
      Sidekiq.logger.error("MeeshoStockHoldJob #{account_id}: #{e.class}: #{e.message}")
      stopped(hold, run, mode, "Unexpected error (#{e.class.name.demodulize}) — check the Inventory page on the Meesho panel.")
    ensure
      MeeshoInventoryJob.perform_async(account.id, nil, MeeshoSyncRun::TRIGGER_MANUAL) if account
    end
  end

  private

  # ── hold ────────────────────────────────────────────────────────────────
  def hold!(account, hold, run)
    return run.finish!(false, "This hold is #{hold.status.downcase} — nothing done.") unless %w[QUEUED HOLDING].include?(hold.status)
    hold.update!(status: "HOLDING", message: "Reading each catalog's stock from Meesho…")
    read_and_save(account, hold)
    saved = hold.items.where(state: "SAVED").order(:catalog_id, :sku_id, :variation_id).to_a
    hold.update!(message: "Stock saved for #{saved.size} SKUs — setting them to 0…")
    saved.each_with_index do |item, i|
      sleep GAP if i.positive? && !Rails.env.test?
      begin
        set_stock(account, item, 0)
        item.update!(state: "ZEROED", zeroed_at: Time.current, message: "")
        MeeshoListing.where(account_id: account.id, product_id: item.product_id, variation_id: item.variation_id).update_all(inventory: 0)
      rescue MeeshoClient::RequestError => e
        item.update!(state: "ZERO_FAILED", message: e.message.truncate(250))
      end
    end
    counts = hold.items.group(:state).count
    zeroed = counts["ZEROED"].to_i
    msg = "Saved and set to 0: #{zeroed} SKU#{'s' unless zeroed == 1}."
    msg += " Meesho refused #{counts['ZERO_FAILED']} (they kept their stock)." if counts["ZERO_FAILED"].to_i.positive?
    msg += " Not touched: #{left_alone(counts)}." if left_alone(counts).present?
    hold.update!(status: zeroed.positive? ? "HELD" : "FAILED", held_at: Time.current, message: msg)
    run.update!(result: (run.result || {}).merge("hold_id" => hold.id, "counts" => counts))
    run.finish!(zeroed.positive? && counts["ZERO_FAILED"].to_i.zero?, msg, records: zeroed)
  end

  # Read every catalog of the hold fresh and save what Meesho says each live SKU has.
  def read_and_save(account, hold)
    planned = hold.items.where(state: "PLANNED").to_a
    known = hold.items.index_by { |x| [x.product_id, x.variation_id] }
    planned.group_by(&:catalog_id).each_with_index do |(catalog_id, items), i|
      sleep READ_GAP if i.positive? && !Rails.env.test?
      products = begin
        read(account, catalog_id)
      rescue MeeshoClient::RequestError => e
        items.each { |x| x.update!(state: "READ_FAILED", message: e.message.truncate(250)) }
        next
      end
      seen = {}
      products.each do |p|
        key = [p["id"].to_i, p["variation_id"].to_i]
        seen[key] = true
        item = known[key] || hold.items.new(catalog_id: catalog_id, product_id: key[0], variation_id: key[1])
        next if MeeshoStockHoldItem::SETTLED.include?(item.state)        # saved before: never read over
        a = MeeshoInventory.listing_attrs(p)
        item.sku_id = a[:sku_id].to_s.truncate(255, omission: "")
        item.variation = a[:variation].to_s.truncate(255, omission: "")
        state, prev = if a[:archived] then ["SKIPPED_PAUSED", nil]
                      elsif a[:inventory].nil? then ["SKIPPED_UNKNOWN", nil]
                      elsif a[:inventory].zero? then ["SKIPPED_ZERO", 0]
                      else ["SAVED", a[:inventory]]
                      end
        item.assign_attributes(state: state, previous_inventory: prev, saved_at: Time.current, message: "")
        item.save!
        known[key] = item
      end
      # Live in the app's last read, not live on Meesho now: paused or gone since — not touched.
      items.each { |x| x.update!(state: "SKIPPED_PAUSED", message: "no longer live on Meesho") unless seen[[x.product_id, x.variation_id]] }
    end
  end

  # ── restore ─────────────────────────────────────────────────────────────
  def restore(account, hold, run)
    return run.finish!(false, "This hold is #{hold.status.downcase} — nothing restored.") unless %w[RESTORING HELD HOLDING].include?(hold.status)
    hold.update!(status: "RESTORING", message: "Giving each SKU its saved stock back…")
    todo = hold.items.where(state: MeeshoStockHoldItem::TO_RESTORE).order(:catalog_id, :sku_id, :variation_id).to_a
    sent = 0
    todo.group_by(&:catalog_id).each_with_index do |(catalog_id, items), i|
      sleep READ_GAP if i.positive? && !Rails.env.test?
      now = begin
        read(account, catalog_id).index_by { |p| [p["id"].to_i, p["variation_id"].to_i] }
      rescue MeeshoClient::RequestError => e
        items.each { |x| x.update!(state: "RESTORE_FAILED", message: "couldn't read its catalog: #{e.message}".truncate(250)) }
        next
      end
      paused = nil
      items.each do |item|
        key = [item.product_id, item.variation_id]
        p = now[key]
        a = p && MeeshoInventory.listing_attrs(p)
        if a.nil?
          # Not under Active: paused since (never touched), or Meesho isn't listing it right now (kept to try again).
          paused ||= begin
            with_retries(account) { MeeshoInventory.products(@client, account, "paused", catalog_id) }
              .to_h { |x| [[x["id"].to_i, x["variation_id"].to_i], true] }
          rescue MeeshoClient::RequestError
            {}
          end
          if paused[key]
            item.update!(state: "SKIPPED_PAUSED", message: "paused since — not touched (stock would unpause it)")
          else
            item.update!(state: "RESTORE_FAILED", message: "Meesho doesn't list it under Active or Paused right now — restore again later")
          end
          next
        end
        if a[:archived]
          item.update!(state: "SKIPPED_PAUSED", message: "paused since — not touched (stock would unpause it)")
          next
        end
        unless a[:inventory].to_i.zero? && !a[:inventory].nil?
          item.update!(state: "SKIPPED_CHANGED", message: "its stock is #{a[:inventory].inspect} now — left as it is")
          next
        end
        sleep GAP if sent.positive? && !Rails.env.test?
        sent += 1
        begin
          set_stock(account, item, item.previous_inventory)
          item.update!(state: "RESTORED", restored_at: Time.current, message: "")
          MeeshoListing.where(account_id: account.id, product_id: item.product_id, variation_id: item.variation_id)
                       .update_all(inventory: item.previous_inventory)
        rescue MeeshoClient::RequestError => e
          item.update!(state: "RESTORE_FAILED", message: e.message.truncate(250))
        end
      end
    end
    counts = hold.items.group(:state).count
    failed = counts["RESTORE_FAILED"].to_i
    msg = "Stock given back to #{counts['RESTORED'].to_i} SKUs."
    msg += " #{counts['SKIPPED_CHANGED']} had new stock and were left as they are." if counts["SKIPPED_CHANGED"].to_i.positive?
    msg += " #{failed} not restored yet — restore again." if failed.positive?
    hold.update!(status: failed.positive? ? "HELD" : "RESTORED", restored_at: failed.positive? ? nil : Time.current, message: msg)
    run.update!(result: (run.result || {}).merge("hold_id" => hold.id, "counts" => counts))
    run.finish!(failed.zero?, msg, records: counts["RESTORED"].to_i)
  end

  # ── shared ──────────────────────────────────────────────────────────────
  def read(account, catalog_id)
    with_retries(account) { MeeshoInventory.products(@client, account, "active", catalog_id) }
  end

  def set_stock(account, item, qty)
    with_retries(account) do
      MeeshoInventory.update_stock(@client, account, catalog_id: item.catalog_id, product_id: item.product_id,
                                   variation_id: item.variation_id, inventory: qty)
    end
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

  def left_alone(counts)
    { "SKIPPED_PAUSED" => "paused", "SKIPPED_ZERO" => "already at 0", "SKIPPED_UNKNOWN" => "stock not given by Meesho",
      "READ_FAILED" => "catalog couldn't be read" }
      .filter_map { |k, label| "#{counts[k]} #{label}" if counts[k].to_i.positive? }.join(", ")
  end

  # Stopped part-way: every SKU's state is already recorded. A hold with SKUs at 0 stays open (restore them).
  def stopped(hold, run, mode, why)
    counts = hold.items.group(:state).count
    zeroed = counts["ZEROED"].to_i + counts["RESTORE_FAILED"].to_i
    status = zeroed.positive? ? "HELD" : (mode == "restore" ? "RESTORED" : "FAILED")
    hold.update!(status: status, message: zeroed.positive? ? "#{why} (#{zeroed} SKUs are at 0 — restore them when it is fixed)." : why)
    run.update!(result: (run.result || {}).merge("hold_id" => hold.id, "counts" => counts))
    run.finish!(false, hold.message)
  end
end
