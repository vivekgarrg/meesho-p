# The panel's Inventory page (Services → Inventory): its tabs, their catalogs,
# each catalog's SKUs, and pausing ("archiving") SKUs — the same requests the
# page makes.
#
# A list page carries the SKUs of its first catalog only; the rest come one
# catalog per request (the panel does that as a row is opened), so SKUs are
# fetched per catalog and only when needed (see MeeshoInventoryJob).
module MeeshoInventory
  BASE = "/api/services/catalogManagement/".freeze
  PAGE_SIZE = 200            # the most catalogs Meesho hands back per page
  MAX_PAGES = 50

  # Tab => [catalog list request, SKU request, the panel's ?tab=]
  TABS = {
    "active" => ["fetchAllStockV2Catalogs", "fetchAllStockV2Products", nil],
    "activation_pending" => ["fetchActivationPendingV2Catalogs", nil, "activation_pending"],
    "paused" => ["fetchArchivedV2Catalogs", "fetchArchivedV2Products", "paused"],
  }.freeze

  module_function

  def headers(account, tab = nil)
    { "identifier" => account.supplier_identifier, "client-version" => "v1",
      "referer" => "#{MeeshoClient::BASE}/panel/v3/new/services/#{account.supplier_identifier}/inventory#{"?tab=#{tab}" if tab}" }
  end

  # { "active" => 1329, "activation_pending" => 10, "blocked" => 139, "paused" => 677 }
  def counts(client, account)
    body = client.post("#{BASE}fetchTabCountV2", body: { supplier_id: account.supplier_id.to_i }, headers: headers(account)).body
    Array(body.is_a?(Hash) ? body["counts"] : nil).each_with_object({}) do |c, out|
      out[c["key"].to_s] = c["value"].to_i if c.is_a?(Hash) && c["key"].present?
    end
  end

  # Every catalog listed under one tab. Raises if the pages run out before
  # Meesho's total — so a partial list is never taken for the whole.
  def catalogs(client, account, tab)
    path, _, panel_tab = TABS.fetch(tab)
    out = []
    total = nil
    MAX_PAGES.times do |page|
      body = { limit: PAGE_SIZE, offset: page * PAGE_SIZE, old_category_id: [], is_hasp_seller: false,
               supplier_id: account.supplier_id.to_i, gst_type: "GSTIN" }
      body.merge!(sort_by: "ORDERS_PER_DAY", fetch_price_reco: false, fetch_transfer_price: false) if tab == "active"
      res = client.post("#{BASE}#{path}", body: body, headers: headers(account, panel_tab)).body
      list = Array(res.is_a?(Hash) ? res["catalogs"] : nil).select { |c| c.is_a?(Hash) && c["id"] }
      total ||= res.dig("pagination", "total_results") if res.is_a?(Hash)
      out.concat(list)
      break if list.size < PAGE_SIZE || (total.is_a?(Integer) && out.size >= total)
    end
    out.uniq! { |c| c["id"] }
    if total.is_a?(Integer) && out.size < total
      raise MeeshoClient::RequestError, "#{tab.tr('_', ' ')}: read #{out.size} of the #{total} catalogs Meesho lists"
    end
    out
  end

  # The SKUs of one catalog under one tab (active: live ones; paused: paused ones).
  def products(client, account, tab, catalog_id)
    _, path, panel_tab = TABS.fetch(tab)
    return [] unless path
    body = client.post("#{BASE}#{path}", body: { catalog_id: catalog_id.to_i, supplier_id: account.supplier_id.to_i, gst_type: "GSTIN" },
                       headers: headers(account, panel_tab)).body
    Array(body.is_a?(Hash) ? body["products"] : nil).select { |p| p.is_a?(Hash) && p["id"] && p["variation_id"] }
  end

  # Pause SKUs of one catalog. products: [{ product_id:, variation_id: }, …]
  def archive(client, account, catalog_id, products)
    res = client.post("#{BASE}archiveSKU",
                      body: { catalog_id: catalog_id.to_i, supplier_id: account.supplier_id.to_i,
                              products: products.map { |p| { product_id: p[:product_id].to_i, variation_id: p[:variation_id].to_i } } },
                      headers: headers(account, "active"))
    body = res.body
    if body.is_a?(Hash) && (body["success"] == false || body["status"].to_s.downcase.in?(%w[failure failed error]))
      raise MeeshoClient::RequestError, (body["message"].presence || body["error"].presence || "Meesho refused it").to_s.truncate(200)
    end
    body
  end

  # The fields a catalog row keeps, from a list entry.
  def catalog_attrs(c)
    {
      name: c["name"].to_s.truncate(500, omission: ""), category: c["category"].to_s.truncate(255, omission: ""),
      image_url: (c["image_url"].presence || Array(c["catalog_image_urls"]).first).to_s,
      sku_count: c["sku_count"].to_i, active_count: c["active_count"].to_i, archived_count: c["archived_count"].to_i,
      blocked_count: c["blocked_count"].to_i, out_of_stock_count: c["out_of_stock_count"].to_i,
      low_stock_count: c["low_stock_count"].to_i,
      expected_live_at: c["expected_go_live_timestamp"].is_a?(Integer) ? Time.at(c["expected_go_live_timestamp"]) : nil,
      live_delayed: c["is_go_live_delayed"] == true,
    }
  end

  # What a catalog's SKUs depend on: when any of it changes they're read again.
  SUMMARY = %i[sku_count active_count archived_count blocked_count out_of_stock_count low_stock_count].freeze

  def listing_attrs(p)
    {
      sku_id: (p["sku_id"].presence || p["style_id"]).to_s.truncate(255, omission: ""),
      name: p["name"].to_s, variation: p["variation"].to_s.truncate(255, omission: ""), image_url: p["image_url"].to_s,
      inventory: p["inventory"].is_a?(Numeric) ? p["inventory"].to_i : nil,
      selling_price: p["selling_price"].is_a?(Numeric) ? p["selling_price"] : nil,
      archived: p["is_user_archived"] == true || p["userArchived"] == true,
      archived_at: p["archived_at"].to_s.truncate(40, omission: ""),
      out_of_stock_since: p["out_of_stock_since"].to_s.truncate(40, omission: ""),
    }
  end
end
