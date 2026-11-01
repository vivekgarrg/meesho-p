require "test_helper"

class MeeshoStockJobTest < ActiveSupport::TestCase
  URL = "https://supplier.meesho.com/api/services/catalogManagement/updateStock"

  setup do
    @account = make_account(status: "ACTIVE", supplier_id: "3564327", supplier_identifier: "lffy4", supplier_name: "Cosmify")
    @account.cookies = { "connect.sid" => "s" }
    @account.save!
    @run = @account.runs.create!(kind: "STOCK", trigger: "MANUAL", status: "QUEUED", queued_at: Time.current)
    catalog = MeeshoCatalog.create!(account_id: @account.id, catalog_id: 606662647, name: "Lota", category: "Puja", image_url: "",
                                    in_active: false, in_paused: true, in_pending: false, sku_count: 1, active_count: 0,
                                    archived_count: 1, blocked_count: 0, out_of_stock_count: 0, low_stock_count: 0,
                                    live_delayed: false, seen_at: Time.current)
    @listing = MeeshoListing.create!(account_id: @account.id, catalog_id: catalog.id, product_id: 1139807680, variation_id: 167, sku_id: "lota",
                                     name: "Lota", variation: "Free Size", image_url: "", inventory: 0, archived: true,
                                     archived_at: "Aug 24, 2026", out_of_stock_since: "", seen_at: Time.current)
    stub_request(:post, %r{catalogManagement/fetch}).to_return(status: 200, body: "{}")   # the read-again afterwards
  end

  def items(*extra)
    [{ "catalog_id" => 606662647, "product_id" => 1139807680, "variation_id" => 167, "inventory" => 1000, "sku" => "lota",
       "paused" => true }, *extra]
  end

  def json(status = 200, body = {})
    { status: status, headers: { "Content-Type" => "application/json" }, body: body.to_json }
  end

  test "stock goes to Meesho exactly as the panel sends it, and a paused SKU comes back" do
    stub_request(:post, URL).to_return(json)
    MeeshoStockJob.new.perform(@account.id, @run.id, items)
    assert_requested(:post, URL, times: 1) do |r|
      JSON.parse(r.body) == { "variation" => { "inventory" => "1000", "catalog_id" => 606662647, "product_id" => 1139807680,
                                               "variation_id" => 167 }, "supplier_id" => 3564327 } &&
        r.headers["Identifier"] == "lffy4" && r.headers["Referer"].end_with?("/inventory?tab=paused")
    end
    @run.reload
    assert_equal ["OK", "Stock set to 1000 on 1 SKU (1 unpaused)."], [@run.status, @run.message]
    @listing.reload
    assert_equal [1000, false], [@listing.inventory, @listing.archived]
  end

  test "a parent's SKUs go one by one, in order; one refused doesn't stop the rest; 429 is waited out" do
    second = { "catalog_id" => 606662647, "product_id" => 1139807681, "variation_id" => 168, "inventory" => 1000, "sku" => "lota-2" }
    third = { "catalog_id" => 606662647, "product_id" => 1139807682, "variation_id" => 169, "inventory" => 1000, "sku" => "lota-3" }
    sent = []
    stub_request(:post, URL).to_return do |r|
      pid = JSON.parse(r.body).dig("variation", "product_id")
      sent << pid
      next json(429, message: "slow down") if pid == 1139807681 && sent.count(pid) == 1
      next json(200, success: false, message: "Invalid variation") if pid == 1139807682
      json
    end
    MeeshoStockJob.new.perform(@account.id, @run.id, items(second, third))
    assert_equal [1139807680, 1139807681, 1139807681, 1139807682], sent
    @run.reload
    assert_equal "FAILED", @run.status
    assert_equal 2, @run.result["updated"]
    assert_equal "lota-3", @run.result["failed"].first["sku"]
    assert_match(/Invalid variation/, @run.message)
  end
end
