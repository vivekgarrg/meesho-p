# Nightly stock (Meesho → Settings → Automation): every live SKU — active on
# the panel, not paused — of every connected business set to the chosen
# quantity (5000 by default) at the chosen time (21:00 IST), so nothing runs
# out of stock on Meesho by itself. Queued by MeeshoScheduleJob.
#
# The SKUs are the ones the last inventory read saw (every half hour); only
# those not already at the quantity are sent. One business after another, each
# one SKU after another (MeeshoStockJob — a moment apart, "too many requests"
# waited out), as a STOCK run on the Inventory page.
class MeeshoStockRefillJob
  include Sidekiq::Job
  sidekiq_options queue: "default", retry: false

  def perform(qty = nil)
    setting = MeeshoAutoSetting.current
    qty = (qty || setting&.stock_refill_qty || 5000).to_i
    return unless qty.positive?
    MeeshoAccount.where(status: MeeshoAccount::STATUS_ACTIVE).where.not(supplier_id: "").where.not(supplier_identifier: "")
                 .find_each { |account| refill(account, qty) }
  end

  def self.items(account, qty)
    account.listings.where(archived: false).where("inventory IS NULL OR inventory <> ?", qty).includes(:catalog)
           .sort_by { |l| [l.catalog.catalog_id, l.sku_id.to_s, l.variation_id] }
           .map { |l| { "listing_id" => l.id, "catalog_id" => l.catalog.catalog_id, "product_id" => l.product_id,
                        "variation_id" => l.variation_id, "inventory" => qty, "sku" => l.sku_id, "paused" => false } }
  end

  private

  def refill(account, qty)
    busy = account.runs.where(kind: MeeshoSyncRun::KIND_STOCK, status: %w[QUEUED RUNNING]).where("queued_at > ?", 2.hours.ago).exists?
    return if busy
    # Its stock is held at 0 on purpose (MeeshoStockHoldJob): topping it up would undo that.
    return if MeeshoStockHold.open_for?(account)
    items = self.class.items(account, qty)
    return if items.empty?
    run = account.runs.create!(kind: MeeshoSyncRun::KIND_STOCK, trigger: MeeshoSyncRun::TRIGGER_SCHEDULE, status: "QUEUED",
                               queued_at: Time.current, records: items.size,
                               message: "Nightly stock: setting #{items.size} SKUs to #{qty}…")
    MeeshoStockJob.new.perform(account.id, run.id, items)
  rescue StandardError => e
    Sidekiq.logger.error("MeeshoStockRefillJob #{account.id}: #{e.class}: #{e.message}")
  end
end
