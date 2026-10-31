# The Meesho panel's order tabs (Fulfilment → Orders): reading them, and
# bringing the app's own orders table up to date from them.
module PanelOrders
  # Panel tab → the status the Orders CSV records for it.
  STATUS = {
    "hold" => "HOLD",
    "pending" => "PENDING",
    "ready-to-ship" => "READY_TO_SHIP",
    "shipped" => "SHIPPED",
    "cancelled" => "CANCELLED",
  }.freeze

  # How far along an order is. The panel's tabs only ever move an order
  # forward; a status from an Orders CSV that is further on (DELIVERED, RTO…,
  # RETURN…) is newer news than a panel tab still listing it, and is kept.
  STAGE = { "HOLD" => 1, "PENDING" => 1, "READY_TO_SHIP" => 2, "SHIPPED" => 3 }.freeze
  # Anything not listed above (DELIVERED, RTO_COMPLETE, RETURN…) is past shipping.
  AFTER_SHIPPING = 4

  def self.stage(status)
    STAGE.fetch(status.to_s, status.present? ? AFTER_SHIPPING : 0)
  end

  # Whether the panel's status should replace the order's current one.
  def self.moves_on?(current, panel)
    # Listed live on the panel again: whatever cancelled it was wrong.
    return true if current.blank? || current == "CANCELLED"
    return stage(current) < AFTER_SHIPPING if panel == "CANCELLED"
    stage(panel) >= stage(current)
  end

  # Each order is kept with just these — no customer details.
  FIELDS = {
    "sub_order_num" => "sub_order_num", "order_num" => "order_num", "created_iso" => "created_iso",
    "product_sku" => "sku", "quantity" => "quantity", "variation" => "variation", "name" => "product_name",
    "product_id" => "product_id", "image" => "image", "expected_dispatch_date_iso" => "dispatch_by",
    "sla_status" => "sla_status", "label" => "label", "shipment_type" => "shipment_type",
    "is_express" => "is_express", "cancelled_message" => "cancelled_message",
    # What accepting an order needs (see MeeshoAcceptJob).
    "id" => "sub_order_id", "grouping_key" => "grouping_key",
    # Once its label is made, a Ready-to-ship shipment has an AWB.
    "awb" => "awb", "carrier_id" => "carrier_id",
    # Ready to ship carries the packet ID on the order, not the sub-order.
    "packet_id" => "packet_id",
  }.freeze

  module_function

  # The sub-orders in one page of a tab. Most tabs list them in data.subOrders;
  # Ready to ship nests them under data.groups[].orders[].sub_orders. Returns
  # nil when the body is not shaped like either.
  def rows(body)
    data = body.is_a?(Hash) ? body["data"] : nil
    return nil unless data.is_a?(Hash) && (data.key?("subOrders") || data.key?("groups"))
    subs = Array(data["subOrders"]).select { |s| s.is_a?(Hash) }
    # Both lists are read: a page may carry some of its orders in each.
    grouped = Array(data["groups"]).flat_map do |g|
      next [] unless g.is_a?(Hash)
      Array(g["orders"]).flat_map do |o|
        Array(o["sub_orders"]).map do |s|
          s.merge("order_num" => s["order_num"] || o["order_num"], "created_iso" => s["created_iso"] || o["created_iso"],
                  "grouping_key" => s["grouping_key"] || g["grouping_key"], "awb" => s["awb"] || g["awb"],
                  "carrier_id" => s["carrier_id"] || g["carrier_id"],
                  "packet_id" => s["packet_id"].presence || o["packet_id"].presence || g["packet_id"].presence).compact
        end
      end
    end
    # Pending lists the same sub-orders in both: keep each once, its two
    # copies merged (the grouped one carries the AWB, packet ID…).
    keyed = {}
    (subs + grouped).each_with_index do |r, i|
      k = r["sub_order_num"].presence || "row#{i}"
      keyed[k] = keyed.key?(k) ? keyed[k].merge(r) { |_, mine, theirs| mine.presence || theirs } : r
    end
    keyed.values
  end

  class WrongBusiness < StandardError; end

  # Refuse to write when the pulled orders plainly belong to another business:
  # many of them already in that business's orders and few or none in this
  # one — the Meesho account was connected under the wrong business. A new
  # business with no orders anywhere yet is fine.
  def check_business!(business_id, rows)
    subs = rows.map { |r| r["sub_order_num"] }.compact.uniq
    return if subs.empty?
    mine = Order.where(business_id: business_id, sub_order_no: subs).distinct.count(:sub_order_no)
    others = Order.where(sub_order_no: subs).where.not(business_id: business_id)
                  .group(:business_id).distinct.count(:sub_order_no)
    other_id, theirs = others.max_by { |_, n| n }
    return unless theirs && theirs >= 10 && theirs > 3 * mine
    name = Business.find_by(id: other_id)&.name || "business ##{other_id}"
    here = Business.find_by(id: business_id)&.name || "this business"
    raise WrongBusiness, "These Meesho orders belong to #{name}: #{theirs} of them are already in #{name}'s orders and " \
                         "#{mine} in #{here}'s. Nothing was saved. Disconnect here and connect the Meesho account " \
                         "while #{name} is the selected business."
  end

  def normalize(raw, tab)
    FIELDS.each_with_object({ "tab" => tab }) { |(from, to), out| out[to] = raw[from] if raw.key?(from) }
  end

  def order_date(row)
    Time.iso8601(row["created_iso"].to_s.sub(/([+-]\d\d)(\d\d)\z/, '\1:\2')).in_time_zone("Asia/Kolkata").to_date
  rescue ArgumentError
    nil
  end

  # Bring the orders table up to date from what the panel shows now, as an
  # Orders CSV upload would: an order already in the table gets its details
  # (SKU, size, quantity, product, packet ID) refreshed and — if its status
  # moved on (see moves_on?) — a row for the new status; one that isn't there
  # yet is added. Nothing is ever deleted. Returns { added:, status_changed:, updated: }.
  def mirror!(business_id, rows)
    stats = { added: 0, status_changed: 0, updated: 0 }
    by_sub = rows.select { |r| r["sub_order_num"].present? }.index_by { |r| r["sub_order_num"] }
    return stats if by_sub.empty?
    existing = Order.where(business_id: business_id, sub_order_no: by_sub.keys).to_a.group_by(&:sub_order_no)
    now = Time.current
    Order.transaction do
      by_sub.each do |sub, row|
        status = STATUS[row["tab"]] or next
        details = { sku: row["sku"].presence, size: row["variation"].presence, quantity: row["quantity"].presence,
                    product_name: row["product_name"].presence, packet_id: row["packet_id"].presence }.compact
        have = existing[sub] || []
        if have.empty?
          Order.create!(business_id: business_id, sub_order_no: sub, reason_for_credit_entry: status,
                        order_date: order_date(row), order_source: "Meesho panel sync", **details,
                        created_at: now, updated_at: now)
          stats[:added] += 1
          next
        end
        stale = have.reject { |o| details.all? { |k, v| o[k].to_s == v.to_s } }
        stale.each { |o| o.update!(details) }
        stats[:updated] += 1 if stale.any?
        # The order's current status is its latest row — the same rule as
        # Django's Order.latest_per_order (order_date, then created_at, then id).
        latest = have.max_by { |o| [o.order_date || Date.new(1970), o.created_at || Time.at(0), o.id] }
        next if latest.reason_for_credit_entry == status
        next unless moves_on?(latest.reason_for_credit_entry, status)
        day = latest.order_date || order_date(row)
        if (back = have.find { |o| o.reason_for_credit_entry == status && o.order_date == day })
          # Back to a status it had before on that date (the row is unique per
          # status and date): that row becomes the latest again.
          back.update_columns(created_at: now, updated_at: now)
        else
          Order.create!(business_id: business_id, sub_order_no: sub, reason_for_credit_entry: status,
                        order_date: day, order_source: latest.order_source,
                        catalog_id: latest.catalog_id, customer_state: latest.customer_state, **details,
                        created_at: now, updated_at: now)
        end
        stats[:status_changed] += 1
      end
    end
    stats
  end
end
