require "test_helper"

class MeeshoSyncJobTest < ActiveSupport::TestCase
  ORDERS = { key: "orders", method: :post, path: "/api/test/orders", body: { page: 1 } }.freeze
  ORDERS_URL = "https://supplier.meesho.com/api/test/orders"

  def active_account
    a = make_account(status: "ACTIVE")
    a.cookies = { "session_token" => "old" }
    a.save!
    a
  end

  test "with no endpoints set up yet it says so and keeps the session" do
    account = active_account
    with_endpoints([]) { MeeshoSyncJob.new.perform(account.id) }
    run = account.runs.last
    assert_equal "OK", run.status
    assert_match(/No data endpoints/, run.message)
    assert_equal "OK", account.reload.last_sync_status
    assert account.last_sync_at.present?
  end

  test "an endpoint is pulled with the session and kept as a snapshot" do
    account = active_account
    stub_request(:post, ORDERS_URL).with(headers: { "Cookie" => "session_token=old" })
      .to_return(status: 200, body: [{ id: 1 }, { id: 2 }].to_json, headers: { "Content-Type" => "application/json" })
    with_endpoints([ORDERS]) { MeeshoSyncJob.new.perform(account.id) }
    snap = MeeshoSyncSnapshot.find_by(account_id: account.id, endpoint: "orders")
    assert_equal 2, snap.payload.size
    assert_equal 2, account.runs.last.records
  end

  test "a lapsed session logs in again once and carries on" do
    account = active_account
    stub_login(cookies: ["session_token=new; Path=/"])
    stub_request(:post, ORDERS_URL).with(headers: { "Cookie" => "session_token=old" }).to_return(status: 401, body: "{}")
    stub_request(:post, ORDERS_URL).with(headers: { "Cookie" => "session_token=new" }).to_return(status: 200, body: "[]")
    with_endpoints([ORDERS]) { MeeshoSyncJob.new.perform(account.id) }
    assert_equal "OK", account.runs.last.status
    assert_equal "new", account.reload.cookies["session_token"]
  end

  test "a session with no cookies logs in first" do
    account = make_account(status: "ACTIVE")
    stub_login
    with_endpoints([]) { MeeshoSyncJob.new.perform(account.id) }
    assert_requested(:post, LOGIN_URL)
    assert_equal "OK", account.runs.last.status
  end

  test "a failed re-login is recorded on the run and the account" do
    account = make_account(status: "ACTIVE")
    stub_login(status: 401, body: { message: "Password changed" }, cookies: [])
    with_endpoints([]) { MeeshoSyncJob.new.perform(account.id) }
    assert_equal "FAILED", account.runs.last.status
    assert_equal ["FAILED", "FAILED"], [account.reload.status, account.last_sync_status]
  end

  # ── Fulfilment → Orders → Pending ──
  PENDING_URL = "https://supplier.meesho.com/api/fulfillment/orders"

  def supplier_account
    a = active_account
    a.update!(supplier_id: "4313711", supplier_identifier: "xzvey", supplier_name: "Rudam")
    a
  end

  def page(orders, cursor: nil, more: nil)
    { status: 200, headers: { "Content-Type" => "application/json" },
      body: { data: { orders: orders, cursor: cursor, has_more: more }.compact }.to_json }
  end

  test "pending orders are asked for exactly as the panel does" do
    account = supplier_account
    stub_request(:post, PENDING_URL).to_return(page([{ sub_order_num: "S1_1" }]))
    with_endpoints([MeeshoEndpoints::ORDERS_PENDING]) { MeeshoSyncJob.new.perform(account.id) }
    assert_requested(:post, PENDING_URL) do |req|
      b = JSON.parse(req.body)
      b["supplier_details"] == { "id" => 4313711, "identifier" => "xzvey", "name" => "Rudam" } &&
        b.values_at("status", "type", "limit", "cursor", "identifier", "enable_hold") == [1, "pending", 50, nil, "xzvey", true] &&
        req.headers["Identifier"] == "xzvey" && req.headers["Client-Package-Version"] == "1.0.4" &&
        req.headers["Referer"].end_with?("/fulfillment/xzvey/orders/pending") && req.headers["Cookie"] == "session_token=old"
    end
    snap = MeeshoSyncSnapshot.find_by(endpoint: "orders_pending")
    assert_equal [{ "tab" => "pending", "sub_order_num" => "S1_1" }], snap.payload
    assert_match(/orders pending: 1\./, account.runs.last.message)
  end

  test "every page is pulled by following the cursor" do
    account = supplier_account
    stub_request(:post, PENDING_URL).with { |r| JSON.parse(r.body)["cursor"].nil? }
      .to_return(page((1..50).map { |i| { id: i } }, cursor: "c2"))
    stub_request(:post, PENDING_URL).with { |r| JSON.parse(r.body)["cursor"] == "c2" }
      .to_return(page((51..60).map { |i| { id: i } }, cursor: "c3", more: false))
    with_endpoints([MeeshoEndpoints::ORDERS_PENDING]) { MeeshoSyncJob.new.perform(account.id) }
    assert_equal 60, MeeshoSyncSnapshot.find_by(endpoint: "orders_pending").payload.size
    assert_equal 60, account.runs.last.records
    assert_match(/2 pages/, account.runs.last.message)
    assert_requested(:post, PENDING_URL, times: 2)
  end

  test "an empty page ends it" do
    account = supplier_account
    stub_request(:post, PENDING_URL).to_return(page([], cursor: "again"))
    with_endpoints([MeeshoEndpoints::ORDERS_PENDING]) { MeeshoSyncJob.new.perform(account.id) }
    assert_requested(:post, PENDING_URL, times: 1)
    assert_equal "OK", account.runs.last.status
  end

  test "without the supplier code it says what to set" do
    account = active_account
    MeeshoSyncJob.new.perform(account.id)
    assert_equal "FAILED", account.runs.last.status
    assert_match(/supplier identifier isn't known/, account.runs.last.message)
    assert_not_requested(:post, PENDING_URL)
  end

  test "rows and cursors are found however the response is shaped" do
    assert_equal [{ "a" => 1 }], MeeshoSyncJob.rows_in([{ "a" => 1 }])
    assert_equal [{ "a" => 1 }], MeeshoSyncJob.rows_in({ "data" => { "result" => { "list" => [{ "a" => 1 }] } } })
    assert_equal "x9", MeeshoSyncJob.cursor_in({ "data" => { "next_cursor" => "x9" } })
    assert MeeshoSyncJob.no_more?({ "meta" => { "hasMore" => false } })
  end

  test "each order tab is asked for with its own status and type" do
    account = supplier_account
    stub_request(:post, PENDING_URL).to_return(page([]))
    MeeshoSyncJob.new.perform(account.id)
    asked = []
    WebMock::RequestRegistry.instance.requested_signatures.hash.each_key do |sig|
      b = JSON.parse(sig.body)
      asked << [b["type"], b["status"], sig.headers["Referer"].split("/").last]
    end
    assert_equal [["cancelled", 5, "cancelled"], ["hold", 0, "hold"], ["pending", 1, "pending"], ["ready-to-ship", 3, "ready-to-ship"]], asked.sort
    assert_equal %w[orders_cancelled orders_hold orders_pending orders_ready_to_ship], MeeshoSyncSnapshot.pluck(:endpoint).sort
  end

  # ── The panel's real response shapes ──
  def real_sub(n, **extra)
    { "sub_order_num" => "#{n}_1", "order_num" => n.to_s, "created_iso" => "2026-10-30T18:00:15+0530", "id" => "#{n}_1_FORWARD",
      "product_sku" => "golden-plate", "quantity" => 1, "variation" => "Free Size", "name" => "Golden Plate",
      "expected_dispatch_date_iso" => "2026-10-31", "sla_status" => "breaching_soon", "label" => false,
      "delivery" => { "customer" => "should not be kept" } }.merge(extra)
  end

  def real_page(subs, total:, cursor: "next", groups: false)
    data = if groups
      { "count" => subs.size, "subOrders" => [],
        "groups" => subs.map { |s| { "awb" => "VL#{s["order_num"]}", "carrier_id" => 19,
                                     "orders" => [{ "order_num" => s["order_num"], "created_iso" => s["created_iso"],
                                                    "sub_orders" => [s.except("order_num", "created_iso")] }] } } }
    else
      { "count" => subs.size, "subOrders" => subs, "groups" => [] }
    end
    { status: 200, headers: { "Content-Type" => "application/json" },
      body: { "total_count" => total, "cursor" => cursor, "data" => data }.to_json }
  end

  test "real pending and ready-to-ship pages are read, paged to the total, and kept without customer details" do
    account = supplier_account
    pending = MeeshoEndpoints.orders_tab("pending", 1)
    rts = MeeshoEndpoints.orders_tab("ready-to-ship", 3)
    stub_request(:post, PENDING_URL).with { |r| JSON.parse(r.body)["type"] == "pending" }
      .to_return(real_page([real_sub(1), real_sub(2)], total: 2))
    stub_request(:post, PENDING_URL).with { |r| JSON.parse(r.body)["type"] == "ready-to-ship" && JSON.parse(r.body)["cursor"].nil? }
      .to_return(real_page([real_sub(3)], total: 2, cursor: "p2", groups: true))
    stub_request(:post, PENDING_URL).with { |r| JSON.parse(r.body)["cursor"] == "p2" }
      .to_return(real_page([real_sub(4)], total: 2, cursor: "p3", groups: true))
    with_endpoints([pending, rts]) { MeeshoSyncJob.new.perform(account.id) }

    pend = MeeshoSyncSnapshot.find_by(endpoint: "orders_pending").payload
    assert_equal %w[1_1 2_1], pend.map { |r| r["sub_order_num"] }
    assert_equal({ "tab" => "pending", "sub_order_num" => "1_1", "order_num" => "1", "created_iso" => "2026-10-30T18:00:15+0530",
                   "sku" => "golden-plate", "quantity" => 1, "variation" => "Free Size", "product_name" => "Golden Plate",
                   "dispatch_by" => "2026-10-31", "sla_status" => "breaching_soon", "label" => false,
                   "sub_order_id" => "1_1_FORWARD" }, pend.first)
    rts_rows = MeeshoSyncSnapshot.find_by(endpoint: "orders_ready_to_ship").payload
    assert_equal [["3_1", "3"], ["4_1", "4"]], rts_rows.map { |r| [r["sub_order_num"], r["order_num"]] }
    assert_equal ["VL3", "VL4"], rts_rows.map { |r| r["awb"] }                # the shipment's AWB, from its group
    # Pending had all 2 in one page (no second call); ready-to-ship stopped at its total of 2.
    assert_requested(:post, PENDING_URL, times: 3)
  end

  test "the orders table is brought up to date like an Orders CSV upload" do
    account = supplier_account
    Order.create!(business_id: 1, sub_order_no: "1_1", reason_for_credit_entry: "PENDING", order_date: Date.new(2026, 10, 30), sku: "old-sku", quantity: 1, created_at: Time.current, updated_at: Time.current)
    Order.create!(business_id: 1, sub_order_no: "2_1", reason_for_credit_entry: "PENDING", order_date: Date.new(2026, 10, 30), sku: "golden-plate", size: "Free Size", quantity: 1, product_name: "Golden Plate", created_at: Time.current, updated_at: Time.current)
    Order.create!(business_id: 9, sub_order_no: "3_1", reason_for_credit_entry: "PENDING", created_at: Time.current, updated_at: Time.current)   # another business
    cancelled = MeeshoEndpoints.orders_tab("cancelled", 5)
    pending = MeeshoEndpoints.orders_tab("pending", 1)
    stub_request(:post, PENDING_URL).with { |r| JSON.parse(r.body)["type"] == "pending" }.to_return(real_page([real_sub(1)], total: 1))
    stub_request(:post, PENDING_URL).with { |r| JSON.parse(r.body)["type"] == "cancelled" }.to_return(real_page([real_sub(2), real_sub(3)], total: 2))
    with_endpoints([pending, cancelled]) { MeeshoSyncJob.new.perform(account.id) }

    rows = Order.where(business_id: 1).order(:sub_order_no, :id).map { |o| [o.sub_order_no, o.reason_for_credit_entry, o.sku] }
    assert_equal [["1_1", "PENDING", "golden-plate"],                        # existing: details refreshed
                  ["2_1", "PENDING", "golden-plate"], ["2_1", "CANCELLED", "golden-plate"],   # status changed: a new row
                  ["3_1", "CANCELLED", "golden-plate"]], rows                # not here yet: added
    added = Order.find_by(business_id: 1, sub_order_no: "3_1")
    assert_equal [Date.new(2026, 10, 30), "Free Size", "Meesho panel sync"], [added.order_date, added.size, added.order_source]
    assert_equal 1, Order.where(business_id: 9).count                    # other businesses untouched
    assert_match(/1 added, 1 status changes, 1 updated/, account.runs.last.message)
    stamp = account.reload.orders_changed_at
    assert stamp.present?                                                # tells Django's cache

    with_endpoints([pending, cancelled]) { MeeshoSyncJob.new.perform(account.id) }   # again: nothing new
    assert_equal 4, Order.where(business_id: 1).count
    assert_match(/0 added, 0 status changes, 0 updated/, account.runs.last.message)
    assert_equal stamp, account.reload.orders_changed_at                 # nothing changed, nothing to drop
  end

  test "a status is compared with the order's current row, not any old one" do
    account = supplier_account
    t = 2.days.ago
    row = ->(st, at) { Order.create!(business_id: 1, sub_order_no: "2_1", reason_for_credit_entry: st, order_date: Date.new(2026, 10, 30),
                                     sku: "golden-plate", size: "Free Size", quantity: 1, product_name: "Golden Plate", created_at: at, updated_at: at) }
    # It was ready to ship, then cancelled (CSV), and Meesho now says ready to ship again.
    rts = row.call("READY_TO_SHIP", t)
    row.call("CANCELLED", t + 1.hour)
    stub_request(:post, PENDING_URL).to_return(real_page([real_sub(2)], total: 1))
    with_endpoints([MeeshoEndpoints.orders_tab("ready-to-ship", 3)]) { MeeshoSyncJob.new.perform(account.id) }
    latest = Order.where(business_id: 1, sub_order_no: "2_1").order(order_date: :desc, created_at: :desc, id: :desc).first
    assert_equal ["READY_TO_SHIP", rts.id], [latest.reason_for_credit_entry, latest.id]    # the old row is current again
    assert_equal 2, Order.where(business_id: 1).count
  end

  test "a new status row takes the date of the order's latest row" do
    account = supplier_account
    Order.create!(business_id: 1, sub_order_no: "2_1", reason_for_credit_entry: "DELIVERED", order_date: Date.new(2026, 9, 1),
                  sku: "golden-plate", size: "Free Size", quantity: 1, product_name: "Golden Plate", created_at: 3.days.ago, updated_at: 3.days.ago)
    Order.create!(business_id: 1, sub_order_no: "2_1", reason_for_credit_entry: "READY_TO_SHIP", order_date: Date.new(2026, 10, 20),
                  sku: "golden-plate", size: "Free Size", quantity: 1, product_name: "Golden Plate", created_at: 2.days.ago, updated_at: 2.days.ago)
    stub_request(:post, PENDING_URL).to_return(real_page([real_sub(2)], total: 1))
    with_endpoints([MeeshoEndpoints.orders_tab("cancelled", 5)]) { MeeshoSyncJob.new.perform(account.id) }
    added = Order.find_by(business_id: 1, sub_order_no: "2_1", reason_for_credit_entry: "CANCELLED")
    assert_equal Date.new(2026, 10, 20), added.order_date                # so it ranks as the latest
  end

  test "orders that belong to another business are not written anywhere" do
    account = supplier_account                                            # business 1
    Business.create!(id: 1, name: "Cosmify Mart")
    Business.create!(id: 3, name: "Rudam")
    subs = (1..12).map { |i| real_sub(100 + i) }
    subs.each { |s| Order.create!(business_id: 3, sub_order_no: s["sub_order_num"], reason_for_credit_entry: "PENDING", created_at: Time.current, updated_at: Time.current) }
    stub_request(:post, PENDING_URL).to_return(real_page(subs, total: 12))
    with_endpoints([MeeshoEndpoints.orders_tab("pending", 1)]) { MeeshoSyncJob.new.perform(account.id) }

    run = account.runs.last
    assert_equal "FAILED", run.status
    assert_match(/belong to Rudam: 12 of them are already in Rudam's orders and 0 in Cosmify Mart's/, run.message)
    assert_equal 0, Order.where(business_id: 1).count
    assert_equal 0, MeeshoSyncSnapshot.count
  end

  test "a new business with no orders anywhere yet is filled in" do
    account = supplier_account
    stub_request(:post, PENDING_URL).to_return(real_page((1..12).map { |i| real_sub(200 + i) }, total: 12))
    with_endpoints([MeeshoEndpoints.orders_tab("pending", 1)]) { MeeshoSyncJob.new.perform(account.id) }
    assert_equal "OK", account.runs.last.status
    assert_equal 12, Order.where(business_id: 1).count
  end
end
