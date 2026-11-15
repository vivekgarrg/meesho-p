# The panel's Advertisement pages (supplier.meesho.com/panel/v3/new/ads/<code>/advertisement):
# the same requests the page makes. All reads except edit_catalog, which pauses
# (or sets active again) one catalog inside one campaign — the ad stops, the
# product stays live.
#
# Figures are Meesho's: spend ("budget_utilised") before GST, revenue = the ad
# orders' value, roi = revenue / spend. A day is an IST date; start_date =
# end_date = that day gives that day alone (applied_date_window "EXPLICIT").
module MeeshoAds
  BASE = "/api/ads/campaigns/".freeze
  PAGE_SIZE = 50             # the most the campaign list gives a page (100 is refused)
  MAX_PAGES = 40

  module_function

  def headers(account, campaign_id = nil)
    page = "#{MeeshoClient::BASE}/panel/v3/new/ads/#{account.supplier_identifier}/advertisement"
    page += "/details/#{campaign_id}?campaign-id=#{campaign_id}&page=campaign_details" if campaign_id
    { "identifier" => account.supplier_identifier, "supplier-id" => account.supplier_id.to_s,
      "content-type" => "application/json", "referer" => page }
  end

  def post(client, account, path, body, campaign_id = nil)
    res = client.post("#{BASE}#{path}", body: body, headers: headers(account, campaign_id)).body
    unless res.is_a?(Hash) && res["data"].is_a?(Hash)
      why = res.is_a?(Hash) ? Array(res["errors"]).join("; ").presence || res["message"] : res.to_s
      raise MeeshoClient::RequestError, "Meesho Ads #{path}: #{why.to_s.truncate(200).presence || 'no data'}"
    end
    res["data"]
  end

  # One page of the campaign list (lifetime figures), and how many there are in all.
  def campaigns(client, account, page)
    data = post(client, account, "fetch-campaign-list",
                { supplier_id: account.supplier_id.to_i, perf_details_required: true, page_number: page, page_size: PAGE_SIZE })
    [Array(data["campaigns"]).select { |c| c.is_a?(Hash) && c["campaign_id"] }, data["total_campaigns_count"].to_i]
  end

  # A campaign and every catalog in it (the panel ignores paging here) — for one day, or lifetime (day nil).
  def details(client, account, campaign_id, day = nil)
    d = day&.iso8601
    post(client, account, "fetch-campaign-details",
         { supplier_id: account.supplier_id.to_i, campaign_id: campaign_id.to_s, page_number: 1, page_size: 100,
           start_date: d, end_date: d }, campaign_id)
  end

  # The whole account's figures for a range of days.
  def overall(client, account, from, to)
    post(client, account, "fetch-overall-performance",
         { start_date: from.iso8601, end_date: to.iso8601, supplier_id: account.supplier_id.to_i })
  end

  # The write: one catalog in one campaign to "PAUSED" or "ACTIVE".
  def edit_catalog(client, account, campaign_id, catalog_id, status)
    raise ArgumentError, "status #{status}" unless %w[PAUSED ACTIVE].include?(status)
    res = client.post("#{BASE}edit-catalogs", headers: headers(account, campaign_id),
                      body: { supplier_id: account.supplier_id.to_i, campaign_id: campaign_id.to_s,
                              catalog_id: catalog_id.to_i, catalog_status: status }).body
    if res.is_a?(Hash) && (Array(res["errors"]).any? || res["success"] == false)
      raise MeeshoClient::RequestError, "Meesho refused: #{(Array(res['errors']).join('; ').presence || res['message']).to_s.truncate(200)}"
    end
    res
  end

  # perf_details → the figures kept. A catalog with nothing that day comes without them: all 0.
  def figures(perf)
    perf = perf.is_a?(Hash) ? perf : {}
    { spend: (perf["budget_utilised"] || perf["total_budget_utilized"]).to_d.round(2), revenue: perf["revenue"].to_d.round(2),
      orders: perf["order_count"].to_i, views: perf["total_views"].to_i, clicks: perf["total_clicks"].to_i }
  end

  def overall_figures(data)
    { spend: data["total_budget_utilized"].to_d.round(2), revenue: data["total_revenue"].to_d.round(2),
      orders: data["total_orders"].to_i, views: data["total_views"].to_i, clicks: data["total_clicks"].to_i }
  end
end
