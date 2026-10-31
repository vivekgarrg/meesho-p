# Keeps the Meesho Stock page (the meesho_inventory table, which an uploaded
# Meesho inventory sheet used to fill) in step with the panel, from what
# MeeshoInventoryJob last read — so the sheet never has to be uploaded again.
#
# The table feeds more than that page (the parent stock sheet, Price Update,
# SKU analysis), so rows are updated in place, matched by product and
# variation, and keep their id and the seller's own "your stock count". Only
# live SKUs are listed, as in Meesho's own sheet. A row is removed only when
# its product is no longer live on Meesho, the read was complete, and it has
# no saved price update (those would go with it).
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
    live = account.listings.where(archived: false).includes(:catalog).order(:catalog_id, :product_id)
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
