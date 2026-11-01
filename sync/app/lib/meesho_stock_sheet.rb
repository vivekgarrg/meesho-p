# Keeps the Meesho Stock page (the meesho_inventory table, which an uploaded
# Meesho inventory sheet used to fill) in step with the panel, from what
# MeeshoInventoryJob last read — so the sheet never has to be uploaded again.
#
# The table feeds more than that page (the parent stock sheet, Price Update,
# SKU analysis), so rows are updated in place, matched by product and
# variation, and keep their id and the seller's own "your stock count". Every
# SKU read from the Inventory page is listed — live and paused, as Meesho's
# own sheet lists them (MeeshoInventoryJob also imports that sheet, which adds
# blocked and pending ones). A row is removed only when its product is on
# neither the Inventory page nor Meesho's latest sheet, the read was complete,
# and it has no saved price update (those would go with it).
module MeeshoStockSheet
  module_function

  # Returns { added:, updated:, removed: }.
  def mirror!(account, complete:)
    stats = { added: 0, updated: 0, removed: 0 }
    business_id = account.business_id
    rows = MeeshoStockRow.where(business_id: business_id).to_a
    by_variation = rows.group_by { |r| [r.product_id, r.variation_id] }
    by_product = rows.select { |r| r.variation_id.nil? }.group_by(&:product_id)
    serial = rows.map(&:serial_no).max.to_i
    touched = []
    now = Time.current
    live = account.listings.includes(:catalog).order(:catalog_id, :product_id)
    MeeshoStockRow.transaction do
      live.each do |l|
        want = wanted(l)
        have = by_variation[[l.product_id, l.variation_id]] || by_product[l.product_id] || []
        if have.empty?
          serial += 1
          row = MeeshoStockRow.create!(want.merge(business_id: business_id, serial_no: serial,
                                                  uploaded_at: now, updated_at: now))
          touched << row.id
          stats[:added] += 1
          next
        end
        have.each do |r|
          touched << r.id
          next if want.all? { |k, v| r[k].to_s == v.to_s }
          r.update!(want.merge(updated_at: now))
          stats[:updated] += 1
        end
      end
      if complete
        # Rows Meesho's own sheet still lists stay (blocked, pending…).
        official = MeeshoSyncSnapshot.find_by(account_id: account.id, endpoint: "inventory_sheet")&.payload
        keep = Array(official.is_a?(Hash) ? official["keys"] : nil).map { |p, v| [p.to_i, v&.to_i] }.to_set
        touched += rows.select { |r| keep.include?([r.product_id, r.variation_id]) }.map(&:id)
        gone = MeeshoStockRow.where(business_id: business_id).where.not(id: touched)
                             .where("id NOT IN (SELECT inventory_id FROM meesho_price_updates)")
        stats[:removed] = gone.delete_all
      end
    end
    stats
  end

  def wanted(l)
    stock = l.inventory.to_i
    {
      catalog_name: l.catalog.name.to_s.truncate(500, omission: ""), catalog_id: l.catalog.catalog_id,
      product_name: l.name.presence || l.catalog.name.to_s, product_id: l.product_id,
      style_id: l.sku_id.to_s, variation_id: l.variation_id, variation: l.variation.to_s,
      stock_type: stock.positive? ? "IN_STOCK" : "OUT_OF_STOCK", system_stock_count: stock,
    }
  end
end
