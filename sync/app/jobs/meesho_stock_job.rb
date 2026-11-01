# Set stock on the Meesho panel, SKU by SKU — what the stock box on the panel's
# Inventory page does (updateStock). Stock on a paused SKU unpauses it, so
# this is also how a SKU, or a whole parent SKU, is brought back.
#
# Queued by Django (Meesho → Inventory → Set stock / Unpause), one job per
# business with its SKUs in order (a parent's SKUs one after another). One
# request per SKU, a moment apart — a burst is what the panel's bot protection
# stops — and Meesho's "too many requests" is waited out. One refused SKU
# doesn't stop the rest; each SKU's outcome is kept on the run, and the
# inventory is read again afterwards.
class MeeshoStockJob
  include Sidekiq::Job
  sidekiq_options queue: "critical", retry: false      # never set stock twice by itself

  GAP = 1.0                                            # seconds between SKUs
  RATE_WAIT = 20                                       # after a 429: ×1, ×2, ×3
  RATE_RETRIES = 3

  # items: [{ "listing_id", "catalog_id", "product_id", "variation_id", "inventory", "sku", "paused" }, …] — in order
  def perform(account_id, run_id, items)
    account = MeeshoAccount.find_by(id: account_id)
    run = MeeshoSyncRun.find_by(id: run_id)
    return unless account && run
    run.start!
    items = Array(items)
    done, unpaused, failed = [], 0, []
    begin
      @client = account.cookies.present? ? MeeshoClient.new(account) : MeeshoLoginJob.login!(account)
      items.each_with_index do |item, i|
        sleep GAP if i.positive? && !Rails.env.test?
        begin
          set(account, item)
          mark(account, item)
          done << (item["sku"].presence || item["product_id"])
          unpaused += 1 if item["paused"] && item["inventory"].to_i.positive?
        rescue MeeshoClient::RequestError => e
          failed << { "sku" => item["sku"], "product_id" => item["product_id"], "variation_id" => item["variation_id"],
                      "error" => e.message.truncate(200) }
        end
      end
      account.cookies = @client.cookies
      account.save!
      run.update!(result: (run.result || {}).merge("updated" => done.size, "unpaused" => unpaused, "failed" => failed))
      run.finish!(failed.empty?, message(done.size, unpaused, failed, items), records: done.size)
    rescue MeeshoClient::AuthError, SecretBox::NotConfigured => e
      run.update!(result: (run.result || {}).merge("updated" => done.size, "failed" => failed))
      run.finish!(false, "Stopped — #{e.message}#{" (#{done.size} SKUs were updated before it stopped)" if done.any?}")
    rescue StandardError => e
      Sidekiq.logger.error("MeeshoStockJob #{account_id}: #{e.class}: #{e.message}")
      run.finish!(false, "Unexpected error (#{e.class.name.demodulize}) — check the Inventory page on the Meesho panel before trying again.")
    ensure
      MeeshoInventoryJob.perform_async(account.id, nil, MeeshoSyncRun::TRIGGER_MANUAL) if account
    end
  end

  private

  # One SKU, waiting out "too many requests" and logging in again if the session lapsed.
  def set(account, item)
    waits = 0
    begin
      MeeshoInventory.update_stock(@client, account, catalog_id: item["catalog_id"], product_id: item["product_id"],
                                   variation_id: item["variation_id"], inventory: item["inventory"],
                                   tab: item["paused"] ? "paused" : nil)
    rescue MeeshoClient::AuthError
      @client = MeeshoLoginJob.login!(account)
      retry
    rescue MeeshoClient::RequestError => e
      raise unless e.message.include?("HTTP 429") && waits < RATE_RETRIES
      waits += 1
      sleep(RATE_WAIT * waits) unless Rails.env.test?
      retry
    end
  end

  # Show the new stock straight away; the next read confirms it.
  def mark(account, item)
    attrs = { inventory: item["inventory"].to_i }
    attrs.merge!(archived: false, archived_at: "") if item["inventory"].to_i.positive?
    MeeshoListing.where(account_id: account.id, product_id: item["product_id"].to_i, variation_id: item["variation_id"].to_i)
                 .update_all(attrs)
  end

  def message(updated, unpaused, failed, items)
    stock = items.map { |i| i["inventory"].to_i }.uniq
    msg = "Stock set#{" to #{stock.first}" if stock.size == 1} on #{updated} SKU#{'s' unless updated == 1}"
    msg += " (#{unpaused} unpaused)" if unpaused.positive?
    msg += "."
    msg += " #{failed.size} refused: #{failed.first(3).map { |f| "#{f['sku'] || f['product_id']} (#{f['error']})" }.join('; ')}" if failed.any?
    msg
  end
end
