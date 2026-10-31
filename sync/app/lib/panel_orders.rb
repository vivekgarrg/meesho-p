# The Meesho panel's order tabs (Fulfilment → Orders): reading them. Bringing
# the app's orders table up to date from them is the orders middleware's job
# (Django: meesho_app/sync_middleware/orders.py).
module PanelOrders
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

end
