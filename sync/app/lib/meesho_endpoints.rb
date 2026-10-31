# The Meesho panel APIs the sync pulls, in order, every run. Each response is
# kept as the endpoint's latest snapshot (meesho_sync_snapshots); turning one
# into rows of the app's own tables (orders, payments…) is added per endpoint
# once its response has been seen.
#
# Each entry:
#   key:      the snapshot's name
#   method:   :get / :post
#   path:     under https://supplier.meesho.com
#   body:     ->(account, cursor) { ... }   (or params: for :get)
#   headers:  ->(account) { ... }           extra headers for this API
#   paginate: :cursor — keep asking with the cursor the last page returned
#   needs:    account fields that must be known first
#
# Add one by copying the panel's request from the browser (DevTools → Network
# → Copy as cURL).
module MeeshoEndpoints
  PAGE_SIZE = 50
  MAX_PAGES = 150          # Ready to ship comes 5 orders a page

  # Fulfilment → Orders, one tab at a time — the same request the panel makes,
  # with that tab's status number and type.
  def self.orders_tab(type, status)
    {
      key: "orders_#{type.tr('-', '_')}",
      orders_tab: type,
      method: :post,
      path: "/api/fulfillment/orders",
      paginate: :cursor,
      needs: %i[supplier_id supplier_identifier],
      headers: ->(a) {
        { "identifier" => a.supplier_identifier, "client-package-version" => "1.0.4",
          "content-type" => "application/json",
          "referer" => "https://supplier.meesho.com/panel/v3/new/fulfillment/#{a.supplier_identifier}/orders/#{type}" }
      },
      body: ->(a, cursor) {
        { enable_hold: true,
          supplier_details: { id: a.supplier_id.to_i, identifier: a.supplier_identifier, name: a.supplier_name },
          cursor: cursor, limit: PAGE_SIZE, status: status, type: type,
          identifier: a.supplier_identifier, child_supplier_identifier: nil, child_supplier_id: nil }
      },
    }.freeze
  end

  ORDER_TABS = [["hold", 0], ["pending", 1], ["ready-to-ship", 3], ["cancelled", 5]].freeze
  ORDERS_PENDING = orders_tab("pending", 1)

  LIST = ORDER_TABS.map { |type, status| orders_tab(type, status) }.freeze

  def self.all
    LIST
  end
end
