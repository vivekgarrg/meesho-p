require "test_helper"

class MeeshoStockHoldJobTest < ActiveSupport::TestCase
  BASE = "https://supplier.meesho.com/api/services/catalogManagement/".freeze
  UPDATE = "#{BASE}updateStock".freeze

  setup do
    @account = make_account(status: "ACTIVE", supplier_id: "3564327", supplier_identifier: "lffy4")
    @account.cookies = { "connect.sid" => "s" }
    @account.save!
    @cat = MeeshoCatalog.create!(account_id: @account.id, catalog_id: 111, name: "Lota", category: "Puja", image_url: "",
                                 in_active: true, in_paused: false, in_pending: false, sku_count: 4, active_count: 4, archived_count: 0,
                                 blocked_count: 0, out_of_stock_count: 0, low_stock_count: 0, live_delayed: false, seen_at: Time.current)
    @run = @account.runs.create!(kind: "STOCK", trigger: "MANUAL", status: "QUEUED", queued_at: Time.current)
    @hold = MeeshoStockHold.create!(account_id: @account.id, status: "QUEUED", message: "", hold_run_id: @run.id,
                                    created_at: Time.current, updated_at: Time.current)
    # What the app's last read saw live (its stock may be hours old): the job reads it fresh.
    [[1, "lota-a", 5000], [2, "lota-b", 40], [3, "lota-c", 9], [4, "lota-d", 7], [5, "lota-e", 3]].each do |pid, sku, inv|
      MeeshoListing.create!(account_id: @account.id, catalog_id: @cat.id, product_id: pid, variation_id: 167, sku_id: sku, name: sku,
                            variation: "Free Size", image_url: "", inventory: inv, archived: false, archived_at: "", out_of_stock_since: "",
                            seen_at: Time.current)
      @hold.items.create!(catalog_id: 111, product_id: pid, variation_id: 167, sku_id: sku, variation: "Free Size")
    end
    @live = {   # Meesho now, under Active (1: stock 4998 now; 2: paused since; 3: already 0; 4: no stock given; 5 gone; 6 new)
      1 => { "inventory" => 4998 }, 2 => { "inventory" => 40, "is_user_archived" => true }, 3 => { "inventory" => 0 },
      4 => {}, 6 => { "inventory" => 12 }
    }
    @paused = {}
    @log = []
    stub_request(:post, "#{BASE}fetchAllStockV2Products").to_return do |r|
      @log << [:read, JSON.parse(r.body)["catalog_id"]]
      json(products: @live.map { |pid, a| { "id" => pid, "variation_id" => 167, "sku_id" => "lota-#{(96 + pid).chr}", "variation" => "Free Size" }.merge(a) })
    end
    stub_request(:post, "#{BASE}fetchArchivedV2Products").to_return do |_r|
      json(products: @paused.keys.map { |pid| { "id" => pid, "variation_id" => 167, "is_user_archived" => true } })
    end
    @refuse = []
    stub_request(:post, UPDATE).to_return do |r|
      v = JSON.parse(r.body)["variation"]
      @log << [:stock, v["product_id"], v["inventory"]]
      if @refuse.include?(v["product_id"])
        json(success: false, message: "Catalog is blocked")
      else
        @live[v["product_id"]] = (@live[v["product_id"]] || {}).merge("inventory" => v["inventory"].to_i)
        json(success: true)
      end
    end
    stub_request(:post, %r{catalogManagement/fetch(TabCount|AllStockV2Catalogs|Activation|ArchivedV2Catalogs)}).to_return(json({}))
  end

  def json(body)
    { status: 200, headers: { "Content-Type" => "application/json" }, body: body.to_json }
  end

  def states
    @hold.items.reload.order(:product_id).to_h { |x| [x.product_id, [x.state, x.previous_inventory]] }
  end

  def hold!
    MeeshoStockHoldJob.new.perform(@account.id, @run.id, @hold.id, "hold")
  end

  def restore!
    run = @account.runs.create!(kind: "STOCK", trigger: "MANUAL", status: "QUEUED", queued_at: Time.current)
    @hold.update!(status: "RESTORING", restore_run_id: run.id)
    MeeshoStockHoldJob.new.perform(@account.id, run.id, @hold.id, "restore")
    run.reload
  end

  test "every live SKU's stock is read fresh and saved before any is set to 0; paused, empty and unknown ones are never touched" do
    @refuse = []
    hold!
    first_write = @log.index { |e| e[0] == :stock }
    assert @log[0...first_write].all? { |e| e[0] == :read }, "read and saved before anything is changed"
    assert_equal({ 1 => ["ZEROED", 4998], 2 => ["SKIPPED_PAUSED", nil], 3 => ["SKIPPED_ZERO", 0], 4 => ["SKIPPED_UNKNOWN", nil],
                   5 => ["SKIPPED_PAUSED", nil], 6 => ["ZEROED", 12] }, states)       # 4998, Meesho's now — not the app's 5000
    assert_equal [[:stock, 1, "0"], [:stock, 6, "0"]], @log.select { |e| e[0] == :stock }
    assert_equal %w[HELD], [@hold.reload.status]
    assert_equal "OK", @run.reload.status
    assert_equal 0, MeeshoListing.find_by(account_id: @account.id, product_id: 1).inventory
    assert_equal 1, MeeshoInventoryJob.jobs.size                                        # read again afterwards
  end

  test "a SKU Meesho refuses keeps its stock and is said so" do
    @refuse = [6]
    hold!
    assert_equal ["ZERO_FAILED", 12], states[6]
    assert_match(/Catalog is blocked/, @hold.items.find_by(product_id: 6).message)
    assert_equal ["HELD", "FAILED"], [@hold.reload.status, @run.reload.status]
  end

  test "run twice, nothing saved is read over and nothing is set to 0 again" do
    hold!
    @log.clear
    @live[1]["inventory"] = 0
    @hold.update!(status: "HOLDING")                       # as if the worker ran it again
    hold!
    assert_equal ["ZEROED", 4998], states[1]               # the saved 4998 stays — not the 0 it reads now
    assert_equal [], @log.select { |e| e[0] == :stock }
    @hold.update!(status: "HELD")
    @log.clear
    hold!                                                  # a held one: nothing at all
    assert_equal [], @log
  end

  test "restore gives back exactly what was saved, only to SKUs still live and still at 0" do
    hold!
    @live[6]["inventory"] = 25                              # restocked by hand since: left as it is
    @live.delete(1)                                        # 1 paused since (under Paused now): stock would unpause it
    @paused = { 1 => true }
    run = restore!
    assert_equal ["SKIPPED_PAUSED", 4998], states[1]
    assert_equal ["SKIPPED_CHANGED", 12], states[6]
    assert_equal [], @log.select { |e| e[0] == :stock && e[2] != "0" }
    assert_equal ["RESTORED", "OK"], [@hold.reload.status, run.status]
  end

  test "restore sets the saved stock, and what fails stays to restore again" do
    hold!
    @refuse = [6]
    run = restore!
    assert_equal ["RESTORED", 4998], states[1]
    assert_includes @log, [:stock, 1, "4998"]
    assert_equal 4998, MeeshoListing.find_by(account_id: @account.id, product_id: 1).inventory
    assert_equal ["RESTORE_FAILED", 12], states[6]
    assert_equal ["HELD", "FAILED"], [@hold.reload.status, run.status]
    @refuse = []
    run = restore!
    assert_equal ["RESTORED", 12], states[6]
    assert_equal [:stock, 6, "12"], @log.last
    assert_equal ["RESTORED", "OK"], [@hold.reload.status, run.status]
  end

  test "a SKU Meesho lists under neither Active nor Paused isn't dropped: it stays to restore" do
    hold!
    @live.delete(6)
    restore!
    assert_equal "RESTORE_FAILED", states[6][0]
    assert_equal "HELD", @hold.reload.status
  end
end
