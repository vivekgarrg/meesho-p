require "test_helper"

class MeeshoAdsJobTest < ActiveSupport::TestCase
  ADS = "https://supplier.meesho.com/api/ads/campaigns/".freeze

  setup do
    @account = make_account(status: "ACTIVE", supplier_id: "3564327", supplier_identifier: "lffy4")
    @account.cookies = { "connect.sid" => "s" }
    @account.save!
    MeeshoAutoSetting.create!(label_times: [], updated_at: Time.current)
    @today = Time.current.in_time_zone("Asia/Kolkata").to_date
    # Meesho now, in campaign 28089176 (live): catalog => [status, today's spend, today's orders]
    @catalogs = { 553274394 => ["ACTIVE", 54.07, 1], 578475291 => ["ACTIVE", 36.5, 0], 548920846 => ["PAUSED", 80.0, 0],
                  308241142 => ["ACTIVE", 35.0, 0], 600000001 => ["ACTIVE", 0, 0] }
    @window = "EXPLICIT"
    @edits = []
    @refuse = false
    @ignore = false
    stub_request(:post, "#{ADS}fetch-campaign-list").to_return do |r|
      page = JSON.parse(r.body)["page_number"]
      list = page == 1 ? [campaign(28089176, "LIVE", nil), campaign(27763867, "PAUSED", "2026-10-28T21:58:03+05:30")] : []
      json(data: { total_campaigns_count: 2, campaigns: list })
    end
    stub_request(:post, "#{ADS}fetch-overall-performance").to_return do |_r|
      json(data: { total_budget_utilized: 65.87, total_revenue: 525, total_orders: 1, total_clicks: 526, total_views: 18221 })
    end
    stub_request(:post, "#{ADS}fetch-campaign-details").to_return do |r|
      b = JSON.parse(r.body)
      dated = b["start_date"].present?
      cats = b["campaign_id"] == "28089176" ? @catalogs : { 281105247 => ["ACTIVE", 127.5, 0] }
      json(data: { campaign_id: b["campaign_id"].to_i, applied_date_window: dated ? @window : "EXPLICIT", bid: 12.0,
                   catalogs: cats.map { |id, (st, spend, orders)|
                     { catalog_id: id, catalog_name: "Puja #{id}", catalog_status: st, category: ["Puja Articles"], bid: 12.0,
                       perf_details: spend.zero? ? { is_new_catalog: false } :
                         { budget_utilised: dated ? spend : spend * 3, order_count: orders, revenue: orders * 300, total_views: 100, total_clicks: 10 } }
                   } })
    end
    stub_request(:post, "#{ADS}edit-catalogs").to_return do |r|
      b = JSON.parse(r.body)
      @edits << [b["campaign_id"], b["catalog_id"], b["catalog_status"]]
      next json(errors: ["Catalog can't be paused"]) if @refuse
      @catalogs[b["catalog_id"]][0] = b["catalog_status"] unless @ignore
      json(data: { success: true })
    end
  end

  def campaign(id, status, end_at)
    { campaign_id: id, campaign_name: "C #{id}", status: status, start_date: "2026-11-13T17:51:58+05:30", end_date: end_at,
      total_budget: 300, catalog_id: 308241142, catalog_count: 4, campaign_type: "DAILY_BUDGET", budget_type: "DAILY_BUDGET",
      bid_type: "SLROI", images512: ["https://x/1.jpg"],
      perf_details: { budget_utilised: 231.54, revenue: 1554, order_count: 6, total_views: 121131, total_clicks: 2782 } }
  end

  def json(body)
    { status: 200, headers: { "Content-Type" => "application/json" }, body: body.to_json }
  end

  def run!
    MeeshoAdsJob.new.perform(@account.id, nil, "MANUAL")
    @account.runs.where(kind: "ADS").order(:id).last
  end

  def rule!(on: true, spend: 35, orders: 0)
    MeeshoAutoSetting.current.update!(ads_auto_pause: on, ads_pause_spend: spend, ads_pause_orders: orders)
  end

  test "reads campaigns, days and today's catalogs — and sends nothing while the rule is off" do
    run = run!
    assert_equal "OK", run.status, run.message
    assert_equal [], @edits
    c = MeeshoAdCampaign.find_by(campaign_id: 28089176)
    assert_equal ["LIVE", 231.54, 6], [c.status, c.spend.to_f, c.orders]
    day = MeeshoAdCatalogDay.find_by(catalog_id: 578475291, date: @today)
    assert_equal [36.5, 0], [day.spend.to_f, day.orders]
    assert_equal 0, MeeshoAdCatalogDay.find_by(catalog_id: 600000001, date: @today).spend.to_f   # nothing spent: all 0
    # Lifetime figures for each catalog, the ended campaign's too.
    assert_equal 109.5, MeeshoAdCatalog.find_by(campaign_id: 28089176, catalog_id: 578475291).spend.to_f
    assert_equal 382.5, MeeshoAdCatalog.find_by(campaign_id: 27763867, catalog_id: 281105247).spend.to_f
    assert_equal 65.87, MeeshoAdDay.find_by(date: @today).spend.to_f
  end

  test "pauses only an active catalog over the limit today with no orders, and checks Meesho shows it paused" do
    rule!
    run = run!
    # 578475291: ₹36.50, 0 orders. Not 553274394 (an order), 548920846 (paused already), 308241142 (₹35 is not over ₹35).
    assert_equal [["28089176", 578475291, "PAUSED"]], @edits
    p = MeeshoAdPause.sole
    assert_equal ["PAUSED", "AUTO", "PAUSE", 36.5, 0, 35.0, @today], [p.status, p.trigger, p.action, p.spend.to_f, p.orders, p.limit.to_f, p.date]
    assert_includes run.message, "1 catalog paused"
    assert_equal "PAUSED", MeeshoAdCatalog.find_by(campaign_id: 28089176, catalog_id: 578475291).status
    # The next run: it's paused now — nothing sent again.
    run!
    assert_equal 1, @edits.size
  end

  test "a catalog set active by hand today is left alone for the rest of the day" do
    rule!
    MeeshoAdPause.create!(account_id: @account.id, campaign_id: 28089176, catalog_id: 578475291, action: "RESUME", trigger: "MANUAL",
                          status: "RESUMED", date: @today)
    run!
    assert_equal [], @edits
  end

  test "the limit and the orders allowed are the setting's" do
    rule!(spend: 50, orders: 1)
    run!
    assert_equal [["28089176", 553274394, "PAUSED"]], @edits    # ₹54.07 with 1 order
  end

  test "what Meesho refuses, or takes but doesn't apply, is recorded as failed" do
    rule!
    @refuse = true
    assert_equal "OK", run!.status
    assert_equal "FAILED", MeeshoAdPause.sole.status
    assert_includes MeeshoAdPause.sole.message, "Catalog can't be paused"
    MeeshoAdPause.delete_all
    @refuse = false
    @ignore = true
    run!
    assert_equal "FAILED", MeeshoAdPause.sole.status
    assert_includes MeeshoAdPause.sole.message, "still shows it ACTIVE"
  end

  test "figures that aren't today's alone decide nothing" do
    rule!
    @window = "LAST_3_DAYS"
    run!
    assert_equal [], @edits
    assert_nil MeeshoAdCatalogDay.find_by(catalog_id: 578475291, date: @today)
  end

  test "pausing or resuming by hand" do
    run!
    p = MeeshoAdPause.create!(account_id: @account.id, campaign_id: 28089176, catalog_id: 548920846, action: "RESUME",
                              trigger: "MANUAL", status: "QUEUED", date: @today)
    MeeshoAdEditJob.new.perform(p.id)
    assert_equal [["28089176", 548920846, "ACTIVE"]], @edits
    assert_equal "RESUMED", p.reload.status
    MeeshoAdEditJob.new.perform(p.id)                       # not QUEUED any more: never sent twice
    assert_equal 1, @edits.size
  end
end
