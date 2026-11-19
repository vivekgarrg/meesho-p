require "test_helper"

class MeeshoLeaveJobTest < ActiveSupport::TestCase
  BASE = "https://supplier.meesho.com/api/services/catalogManagement/".freeze

  setup do
    @account = make_account(status: "ACTIVE", supplier_id: "3564327", supplier_identifier: "lffy4")
    @account.cookies = { "connect.sid" => "s" }
    @account.save!
    # Meesho, faked: catalog => { product_id => { "inventory" =>, "paused" => } }.
    @meesho = { 111 => { 1 => { "inventory" => 50 }, 2 => { "inventory" => 0 } },
                222 => { 3 => { "inventory" => 7 } },
                333 => { 4 => { "inventory" => 9, "paused" => true } } }           # paused before the leave: never touched
    @log = []
    @refuse_archive = []
    sku = ->(pid, a) { { "id" => pid, "variation_id" => 167, "sku_id" => "sku-#{pid}", "variation" => "Free Size", "inventory" => a["inventory"] } }
    stub_request(:post, "#{BASE}fetchAllStockV2Catalogs").to_return do |_r|
      json(catalogs: @meesho.select { |_c, ps| ps.values.any? { |a| !a["paused"] } }.keys.map { |c| { "id" => c } },
           pagination: { total_results: @meesho.count { |_c, ps| ps.values.any? { |a| !a["paused"] } } })
    end
    stub_request(:post, "#{BASE}fetchAllStockV2Products").to_return do |r|
      c = JSON.parse(r.body)["catalog_id"]
      json(products: (@meesho[c] || {}).reject { |_p, a| a["paused"] }.map { |p, a| sku.(p, a) })
    end
    stub_request(:post, "#{BASE}fetchArchivedV2Products").to_return do |r|
      c = JSON.parse(r.body)["catalog_id"]
      json(products: (@meesho[c] || {}).select { |_p, a| a["paused"] }.map { |p, a| sku.(p, a).merge("is_user_archived" => true) })
    end
    stub_request(:post, "#{BASE}archiveSKU").to_return do |r|
      b = JSON.parse(r.body)
      @log << [:pause, b["catalog_id"], b["products"].map { |p| p["product_id"] }]
      next json(success: false, message: "Catalog is blocked") if @refuse_archive.include?(b["catalog_id"])
      b["products"].each { |p| @meesho[b["catalog_id"]][p["product_id"]]["paused"] = true }
      json(success: true)
    end
    stub_request(:post, "#{BASE}updateStock").to_return do |r|
      v = JSON.parse(r.body)["variation"]
      @log << [:stock, v["product_id"], v["inventory"].to_i]
      a = @meesho[v["catalog_id"]][v["product_id"]]
      a["inventory"] = v["inventory"].to_i
      a["paused"] = false if a["inventory"].positive?                    # stock on a paused SKU unpauses it
      json(success: true)
    end
  end

  def json(body)
    { status: 200, headers: { "Content-Type" => "application/json" }, body: body.to_json }
  end

  def leave!(**attrs)
    MeeshoLeave.create!({ account_id: @account.id, status: "SCHEDULED", starts_at: Time.current }.merge(attrs))
  end

  def work(leave, mode)
    MeeshoLeaveJob.new.perform(@account.id, leave.id, mode)
    leave.reload
  end

  def items(leave)
    leave.items.reload.order(:product_id).to_h { |x| [x.product_id, [x.state, x.previous_inventory]] }
  end

  def live?(pid)
    @meesho.values.each { |ps| return !ps[pid]["paused"] if ps[pid] }
  end

  test "start: every live SKU recorded with its stock, then paused catalog by catalog — one paused before is left alone" do
    l = work(leave!, "start")
    assert_equal "ON_LEAVE", l.status
    assert_equal({ 1 => ["PAUSED", 50], 2 => ["PAUSED", 0], 3 => ["PAUSED", 7] }, items(l))
    assert_equal [[:pause, 111, [1, 2]], [:pause, 222, [3]]], @log
    assert [1, 2, 3].none? { |p| live?(p) }
    assert_match(/3 SKUs paused in 2 catalogs/, l.message)
  end

  test "the hourly check pauses again what came back on, and a SKU listed since — kept for the end" do
    l = work(leave!, "start")
    @meesho[111][1]["paused"] = false                                     # Meesho (or someone) turned it back on
    @meesho[222][5] = { "inventory" => 20 }                               # listed during the leave
    @log.clear
    l = work(l, "guard")
    assert_equal [[:pause, 111, [1]], [:pause, 222, [5]]], @log
    assert_equal 1, l.repaused
    assert_equal ["PAUSED", 50], items(l)[1]                               # its stock as it was before the leave
    assert_equal 1, l.items.find_by(product_id: 1).times_repaused
    assert_equal ["PAUSED", 20], items(l)[5]
    assert_match(/1 found live again and 1 newly listed — paused/, l.message)
    @log.clear
    work(l, "guard")                                                       # nothing live: nothing sent
    assert_empty @log.select { |x| x.first == :pause }
  end

  test "end: each SKU the leave paused gets its stock back; one with no stock stays paused; the one paused before stays paused" do
    l = work(leave!, "start")
    @log.clear
    l = work(l, "end")
    assert_equal "ENDED", l.status
    assert_equal [[:stock, 1, 50], [:stock, 3, 7]], @log
    assert live?(1) && live?(3)
    refute live?(2)                                                       # had 0 stock: 0 can't bring it back
    refute live?(4)                                                       # never the leave's
    assert_equal({ 1 => ["RESUMED", 50], 2 => ["KEPT_PAUSED", 0], 3 => ["RESUMED", 7] }, items(l))
    assert_match(/2 SKUs live again.*1 had no stock when paused/, l.message)
  end

  test "a SKU someone brought back during the leave's end is left as it is; a refused pause is tried again next hour" do
    @refuse_archive << 222
    l = work(leave!, "start")
    assert_equal "PAUSE_FAILED", items(l)[3].first
    assert_match(/Meesho refused 1/, l.message)
    @refuse_archive.clear
    l = work(l, "guard")
    assert_equal "PAUSED", items(l)[3].first
    @meesho[111][1]["paused"] = false                                     # live again just before the end
    @log.clear
    l = work(l, "end")
    assert_equal ["RESUMED", 50], items(l)[1]
    assert_not_includes @log, [:stock, 1, 50]                             # not sent: live already
  end

  test "the minute scheduler starts, checks every hour and ends a leave — each once" do
    l = leave!(starts_at: 1.minute.ago, ends_at: 3.hours.from_now)
    queued = -> { MeeshoLeaveJob.jobs.map { |j| j["args"].last } }
    sched = -> { MeeshoScheduleJob.new.send(:queue_leaves, Time.current) }
    sched.()
    sched.()
    assert_equal %w[start], queued.()
    assert_equal "PAUSING", l.reload.status
    l.update!(status: "ON_LEAVE", last_guard_at: 30.minutes.ago)
    sched.()
    assert_equal %w[start], queued.()                                      # checked half an hour ago: not yet
    l.update!(last_guard_at: 61.minutes.ago)
    sched.()
    sched.()
    assert_equal %w[start guard], queued.()
    travel 4.hours do
      sched.()
      sched.()
    end
    assert_equal %w[start guard end], queued.()
    assert_equal ["RESUMING", "auto"], [l.reload.status, l.ended_how]
  end
end
