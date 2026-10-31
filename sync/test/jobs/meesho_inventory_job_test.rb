require "test_helper"

class MeeshoInventoryJobTest < ActiveSupport::TestCase
  BASE = "https://supplier.meesho.com/api/services/catalogManagement/"

  def account
    @account ||= begin
      a = make_account(status: "ACTIVE", supplier_id: "3564327", supplier_identifier: "lffy4", supplier_name: "Cosmify")
      a.cookies = { "connect.sid" => "sess" }
      a.save!
      a
    end
  end

  def json(body)
    { status: 200, headers: { "Content-Type" => "application/json" }, body: body.to_json }
  end

  def product(id, sku, inventory: 10, archived: false)
    { "id" => id, "variation_id" => 167, "sku_id" => sku, "name" => "Thali #{id}", "variation" => "Free Size",
      "inventory" => inventory, "selling_price" => 499, "image_url" => "https://images.meesho.com/#{id}.jpg",
      "is_user_archived" => archived, "archived_at" => archived ? "Oct 31, 2026" : nil }
  end

  def catalog(id, products: [], **counts)
    { "id" => id, "name" => "Catalog #{id}", "category" => "Puja Articles", "catalog_image_urls" => ["https://img/#{id}"],
      "sku_count" => 1, "active_count" => 1, "archived_count" => 0, "blocked_count" => 0, "out_of_stock_count" => 0,
      "low_stock_count" => 0, "products" => products }.merge(counts.transform_keys(&:to_s))
  end

  def stub_inventory(active:, paused: [], pending: [], products: {}, archived_products: {})
    stub_request(:post, "#{BASE}fetchTabCountV2").to_return(json(counts: [
      { key: "active", value: active.size, name: "Active" }, { key: "activation_pending", value: pending.size },
      { key: "blocked", value: 2 }, { key: "paused", value: paused.size }]))
    { "fetchAllStockV2Catalogs" => active, "fetchArchivedV2Catalogs" => paused, "fetchActivationPendingV2Catalogs" => pending }.each do |path, cats|
      stub_request(:post, "#{BASE}#{path}").to_return(json(catalogs: cats, pagination: { page_size: 200, total_results: cats.size }))
    end
    products.each do |cid, list|
      stub_request(:post, "#{BASE}fetchAllStockV2Products").with { |r| JSON.parse(r.body)["catalog_id"] == cid }.to_return(json(products: list))
    end
    archived_products.each do |cid, list|
      stub_request(:post, "#{BASE}fetchArchivedV2Products").with { |r| JSON.parse(r.body)["catalog_id"] == cid }.to_return(json(products: list))
    end
  end

  test "every tab's catalogs and their SKUs are kept, live and paused" do
    stub_inventory(
      active: [catalog(1, products: [product(11, "thali-a")]), catalog(2), catalog(3, archived_count: 1, sku_count: 2)],
      paused: [catalog(3, archived_count: 1, sku_count: 2), catalog(4, active_count: 0, archived_count: 1)],
      pending: [catalog(5, sku_count: 0, active_count: 0).merge("expected_go_live_timestamp" => 1789871192, "is_go_live_delayed" => true)],
      products: { 2 => [product(21, "thali-a", inventory: 0)], 3 => [product(31, "lota")] },
      archived_products: { 3 => [product(32, "lota", archived: true)], 4 => [product(41, "diya", archived: true)] })
    MeeshoInventoryJob.new.perform(account.id)

    run = account.runs.last
    assert_equal ["INVENTORY", "OK"], [run.kind, run.status], run.message
    assert_match(/Active 3 · Paused 2 · Activation pending 1 · Blocked 2 catalogs on Meesho/, run.message)
    cats = account.catalogs.index_by(&:catalog_id)
    assert_equal [true, true, false], [cats[3].in_active, cats[3].in_paused, cats[3].in_pending]
    assert cats[5].in_pending && cats[5].live_delayed && cats[5].expected_live_at.present?
    rows = account.listings.order(:product_id).map { |l| [l.product_id, l.sku_id, l.archived, l.inventory] }
    assert_equal [[11, "thali-a", false, 10], [21, "thali-a", false, 0], [31, "lota", false, 10], [32, "lota", true, 10], [41, "diya", true, 10]], rows
    # Catalog 1 came with its SKUs on the list page: not asked for again.
    assert_not_requested(:post, "#{BASE}fetchAllStockV2Products", body: hash_including("catalog_id" => 1))
    assert_requested(:post, "#{BASE}fetchAllStockV2Products", times: 2)
    assert_equal({ "active" => 3, "activation_pending" => 1, "blocked" => 2, "paused" => 2 },
                 MeeshoSyncSnapshot.find_by(account_id: account.id, endpoint: "inventory_counts").payload)
    assert_requested(:post, "#{BASE}fetchAllStockV2Catalogs") { |r| r.headers["Identifier"] == "lffy4" && JSON.parse(r.body)["limit"] == 200 }
  end

  test "SKUs are read again only for catalogs that changed; a catalog no longer listed is dropped" do
    stub_inventory(active: [catalog(2), catalog(3)], products: { 2 => [product(21, "a")], 3 => [product(31, "b")] })
    MeeshoInventoryJob.new.perform(account.id)
    WebMock.reset!
    stub_inventory(active: [catalog(2, out_of_stock_count: 1)], products: { 2 => [product(21, "a", inventory: 0)] })
    MeeshoInventoryJob.new.perform(account.id)
    assert_requested(:post, "#{BASE}fetchAllStockV2Products", times: 1)       # only the changed one
    assert_equal [2], account.catalogs.pluck(:catalog_id)                         # 3 is gone
    assert_equal [[21, 0]], account.listings.pluck(:product_id, :inventory)

    WebMock.reset!
    stub_inventory(active: [catalog(2, out_of_stock_count: 1)])
    MeeshoInventoryJob.new.perform(account.id)
    assert_not_requested(:post, "#{BASE}fetchAllStockV2Products")             # unchanged: nothing to read
  end

  test "a big first load is spread over follow-up runs" do
    cats = (1..5).map { |i| catalog(100 + i) }
    stub_inventory(active: [catalog(99)] + cats, products: [99, *101..105].to_h { |i| [i, [product(i * 10, "s#{i}")]] })
    MeeshoInventoryJob.stub_const(:PRODUCT_CALLS, 2) do
      MeeshoInventoryJob.new.perform(account.id)
    end
    assert_match(/SKUs read for \d+ catalogs — \d+ more on the next pulls/, account.runs.last.message)
    assert_equal 1, MeeshoInventoryJob.jobs.size                                   # carries on in a few minutes
    assert_requested(:post, "#{BASE}fetchAllStockV2Products", times: 2)
  end

  test "a catalog Meesho won't hand over is skipped and tried again next pull" do
    stub_inventory(active: [catalog(2), catalog(3)], products: { 3 => [product(31, "b")] })
    stub_request(:post, "#{BASE}fetchAllStockV2Products").with { |r| JSON.parse(r.body)["catalog_id"] == 2 }.to_return(status: 500, body: "{}")
    MeeshoInventoryJob.new.perform(account.id)
    run = account.runs.last
    assert_equal "OK", run.status, run.message
    assert_match(/SKUs read for 1 catalog\. 1 catalog Meesho wouldn't hand over/, run.message)
    assert_equal [31], account.listings.pluck(:product_id)
    assert_nil account.catalogs.find_by(catalog_id: 2).products_fetched_at          # still due
  end

  test "Meesho failing catalog after catalog stops the pull" do
    cats = (1..6).map { |i| catalog(i) }
    stub_inventory(active: [catalog(99, products: [product(990, "x")])] + cats)
    stub_request(:post, "#{BASE}fetchAllStockV2Products").to_return(status: 500, body: "{}")
    MeeshoInventoryJob.stub_const(:GAP, 0) { MeeshoInventoryJob.new.perform(account.id) }
    assert_equal "FAILED", account.runs.last.status
    assert_requested(:post, "#{BASE}fetchAllStockV2Products", times: 5)
  end

  test "a list that ends short of Meesho's total keeps what was there" do
    stub_inventory(active: [catalog(2)], products: { 2 => [product(21, "a")] })
    MeeshoInventoryJob.new.perform(account.id)
    stub_request(:post, "#{BASE}fetchAllStockV2Catalogs").to_return(json(catalogs: [], pagination: { total_results: 900 }))
    MeeshoInventoryJob.new.perform(account.id)
    assert_equal "FAILED", account.runs.last.status
    assert_match(/read 0 of the 900 catalogs/, account.runs.last.message)
    assert_equal [2], account.catalogs.pluck(:catalog_id)                         # nothing dropped on a partial read
  end

  test "pausing sends one request per catalog and carries on past a refused one" do
    stub_inventory(active: [catalog(1), catalog(2)], products: { 1 => [product(11, "a"), product(12, "a")], 2 => [product(21, "a")] })
    MeeshoInventoryJob.new.perform(account.id)
    MeeshoInventoryJob.jobs.clear
    archive = "#{BASE}archiveSKU"
    stub_request(:post, archive).with { |r| JSON.parse(r.body)["catalog_id"] == 1 }.to_return(json(success: true))
    stub_request(:post, archive).with { |r| JSON.parse(r.body)["catalog_id"] == 2 }.to_return(status: 500, body: { message: "Try later" }.to_json)
    run = account.runs.create!(kind: "ARCHIVE", trigger: "MANUAL", records: 3)
    items = [{ "catalog_id" => 1, "products" => [{ "product_id" => 11, "variation_id" => 167 }, { "product_id" => 12, "variation_id" => 167 }] },
             { "catalog_id" => 2, "products" => [{ "product_id" => 21, "variation_id" => 167 }] }]
    MeeshoArchiveJob.stub_const(:GAP, 0) { MeeshoArchiveJob.new.perform(account.id, run.id, items) }

    assert_requested(:post, archive, times: 1) do |r|
      JSON.parse(r.body) == { "catalog_id" => 1, "supplier_id" => 3564327,
                              "products" => [{ "product_id" => 11, "variation_id" => 167 }, { "product_id" => 12, "variation_id" => 167 }] }
    end
    run.reload
    assert_equal "FAILED", run.status
    assert_match(/Paused 2 SKUs in 1 catalog\. 1 catalog refused: 2/, run.message)
    assert_equal [[11, true], [12, true], [21, false]], account.listings.order(:product_id).pluck(:product_id, :archived)
    assert_equal [2], run.result["failed"].map { |f| f["catalog_id"] }
    assert_equal 1, MeeshoInventoryJob.jobs.size                                   # read again afterwards
  end

  test "the Meesho Stock sheet is kept in step: updated in place, edits kept, new SKUs added, gone ones removed" do
    now = Time.current
    row = ->(serial, pid, vid, **kw) {
      MeeshoStockRow.create!({ business_id: account.business_id, serial_no: serial, catalog_name: "old", catalog_id: 1, product_name: "old",
                               product_id: pid, style_id: "old", variation_id: vid, variation: "", stock_type: "ALL",
                               system_stock_count: 0, uploaded_at: now, updated_at: now }.merge(kw))
    }
    kept = row.(1, 11, 167, seller_stock_count: 40)            # uploaded earlier; the seller typed 40
    gone = row.(2, 99, 167)                                     # no longer on Meesho
    priced = row.(3, 98, 167)                                   # gone too, but has a saved price update
    MeeshoStockRow.connection.execute("INSERT INTO meesho_price_updates (inventory_id) VALUES (#{priced.id})")
    MeeshoStockRow.create!(business_id: 777, serial_no: 1, catalog_name: "x", catalog_id: 1, product_name: "x", product_id: 55,
                           style_id: "x", variation: "", stock_type: "ALL", system_stock_count: 0, uploaded_at: now, updated_at: now)
    stub_inventory(active: [catalog(1, products: [product(11, "thali-a", inventory: 7)]), catalog(2)],
                   paused: [catalog(3, active_count: 0, archived_count: 1)],
                   products: { 2 => [product(21, "thali-b", inventory: 0)] },
                   archived_products: { 3 => [product(31, "lota", archived: true)] })
    MeeshoInventoryJob.new.perform(account.id)

    assert_match(/Meesho Stock: 1 added, 1 updated, 1 removed/, account.runs.last.message)
    rows = MeeshoStockRow.where(business_id: account.business_id).order(:serial_no)
    assert_equal [[1, 11, "thali-a", 7, "IN_STOCK", 40, "Catalog 1"], [3, 98, "old", 0, "ALL", nil, "old"], [4, 21, "thali-b", 0, "OUT_OF_STOCK", nil, "Catalog 2"]],
                 rows.map { |r| [r.serial_no, r.product_id, r.style_id, r.system_stock_count, r.stock_type, r.seller_stock_count, r.catalog_name] }
    assert_equal kept.id, rows.first.id                                  # same row: Price Update's link holds
    refute MeeshoStockRow.exists?(gone.id)
    assert MeeshoStockRow.exists?(business_id: 777)                     # another business untouched
  end

  test "nothing is removed from Meesho Stock while SKUs are still loading" do
    now = Time.current
    MeeshoStockRow.create!(business_id: account.business_id, serial_no: 1, catalog_name: "x", catalog_id: 1, product_name: "x",
                           product_id: 99, style_id: "x", variation: "", stock_type: "ALL", system_stock_count: 0, uploaded_at: now, updated_at: now)
    stub_inventory(active: [catalog(1), catalog(2)], products: { 1 => [product(11, "a")], 2 => [product(21, "b")] })
    MeeshoInventoryJob.stub_const(:PRODUCT_CALLS, 1) { MeeshoInventoryJob.new.perform(account.id) }
    assert_match(/Meesho Stock: 1 added, 0 updated, 0 removed/, account.runs.last.message)
    assert MeeshoStockRow.exists?(product_id: 99)
  end

  test "the schedule reads the inventory every half hour" do
    account
    MeeshoScheduleJob.new.perform
    MeeshoScheduleJob.new.perform
    assert_equal 1, MeeshoInventoryJob.jobs.size
    assert_equal 1, account.runs.where(kind: "INVENTORY").count
  end
end
