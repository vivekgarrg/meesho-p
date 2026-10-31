require "test_helper"

# The Sync schedule (Meesho → Settings) — the worker follows what's saved.
class MeeshoSyncScheduleTest < ActiveSupport::TestCase
  def account
    @account ||= begin
      a = make_account(status: "ACTIVE", supplier_id: "3564327", supplier_identifier: "lffy4")
      a.cookies = { "connect.sid" => "sess" }
      a.save!
      a
    end
  end

  def schedule(**over)
    MeeshoSyncSetting.create!({ orders_every: 5, shipped_every: 15, inventory_every: 30, inventory_sku_reads: 300,
                                payments_every: 120, payments_paid_days: 30, payments_upcoming_days: 7, returns_every: 10,
                                returns_window: "last_2_week", updated_at: Time.current }.merge(over))
  end

  test "a read set to 0 is paused; others follow their own interval" do
    account
    schedule(returns_every: 0, payments_every: 60)
    MeeshoScheduleJob.new.perform
    assert_empty MeeshoReturnsJob.jobs
    assert_equal 1, MeeshoPaymentsJob.jobs.size
    travel 61.minutes do
      MeeshoScheduleJob.new.perform
    end
    assert_equal 2, MeeshoPaymentsJob.jobs.size                       # every hour, not every two
    assert_empty MeeshoReturnsJob.jobs
  end

  test "returns are read as far back as the schedule says" do
    schedule(returns_window: "last_1_month")
    base = "https://supplier.meesho.com/api/fulfillment/returnRto/"
    ok = { status: 200, headers: { "Content-Type" => "application/json" } }
    stub_request(:post, "#{base}fetchDeliveryOTPs").to_return(ok.merge(body: "{}"))
    stub_request(:post, "#{base}fetchReturnClaims").to_return(ok.merge(body: { data: [], cursor: nil }.to_json))
    MeeshoReturnsJob.stub_const(:GAP, 0) { MeeshoReturnsJob.new.perform(account.id) }
    assert_requested(:post, "#{base}fetchReturnClaims") { |r| JSON.parse(r.body)["filters"]["delivered_date"] == { "value" => "last_1_month" } }
    assert_requested(:post, "#{base}fetchReturnClaims") { |r| JSON.parse(r.body)["filters"]["lost_date"] == { "value" => "last_1_month" } }
  end

  test "inventory reads as many catalogs' SKUs per run as the schedule says" do
    schedule(inventory_sku_reads: 1)
    base = "https://supplier.meesho.com/api/services/catalogManagement/"
    json = ->(b) { { status: 200, headers: { "Content-Type" => "application/json" }, body: b.to_json } }
    cats = (1..3).map { |i| { "id" => i, "name" => "C#{i}", "sku_count" => 1, "active_count" => 1, "products" => [] } }
    stub_request(:post, "#{base}fetchTabCountV2").to_return(json.({ counts: [] }))
    stub_request(:post, "#{base}fetchAllStockV2Catalogs").to_return(json.({ catalogs: cats, pagination: { total_results: 3 } }))
    %w[fetchActivationPendingV2Catalogs fetchArchivedV2Catalogs].each { |p| stub_request(:post, "#{base}#{p}").to_return(json.({ catalogs: [], pagination: { total_results: 0 } })) }
    stub_request(:post, "#{base}fetchAllStockV2Products").to_return(json.({ products: [] }))
    MeeshoInventoryJob.new.perform(account.id)
    assert_requested(:post, "#{base}fetchAllStockV2Products", times: 1)
    assert_match(/2 more on the next pulls/, account.runs.last.message)
  end
end
