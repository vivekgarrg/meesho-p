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
    assert_equal [["cancelled", 5, "cancelled"], ["hold", 0, "hold"], ["pending", 1, "pending"], ["ready-to-ship", 3, "ready-to-ship"], ["shipped", 4, "shipped"]], asked.sort
    assert_equal %w[orders_cancelled orders_hold orders_pending orders_ready_to_ship orders_shipped], MeeshoSyncSnapshot.pluck(:endpoint).sort
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
                                     "orders" => [{ "order_num" => s["order_num"], "created_iso" => s["created_iso"], "packet_id" => "PKT#{s["order_num"]}",
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
    assert_equal ["PKT3", "PKT4"], rts_rows.map { |r| r["packet_id"] }       # the packet ID, from its order
    # Pending had all 2 in one page (no second call); ready-to-ship stopped at its total of 2.
    assert_requested(:post, PENDING_URL, times: 3)
  end

  test "ready to ship keeps paging when its total counts shipments, not sub-orders" do
    account = supplier_account
    rts = MeeshoEndpoints.orders_tab("ready-to-ship", 3)
    two_subs = ->(n) { real_page([real_sub(n), real_sub(n, "sub_order_num" => "#{n}_2", "id" => "#{n}_2_FORWARD")],
                                 total: 2, cursor: "after#{n}", groups: true) }
    stub_request(:post, PENDING_URL).with { |r| JSON.parse(r.body)["cursor"].nil? }.to_return(two_subs.(3))
    stub_request(:post, PENDING_URL).with { |r| JSON.parse(r.body)["cursor"] == "after3" }.to_return(real_page([real_sub(4)], total: 2, cursor: "after4", groups: true))
    with_endpoints([rts]) { MeeshoSyncJob.new.perform(account.id) }
    rows = MeeshoSyncSnapshot.find_by(endpoint: "orders_ready_to_ship").payload
    assert_equal %w[3_1 3_2 4_1], rows.map { |r| r["sub_order_num"] }   # 2 sub-orders on page 1 didn't stop it short
    assert_requested(:post, PENDING_URL, times: 2)
  end

  test "pages are fetched until Meesho's total is in hand, past an empty page and has_more false" do
    account = supplier_account
    rts = MeeshoEndpoints.orders_tab("ready-to-ship", 3)
    empty = { status: 200, headers: { "Content-Type" => "application/json" },
              body: { "total_count" => 3, "cursor" => "p3", "has_more" => false, "data" => { "subOrders" => [], "groups" => [] } }.to_json }
    stub_request(:post, PENDING_URL).with { |r| JSON.parse(r.body)["cursor"].nil? }.to_return(real_page([real_sub(3)], total: 3, cursor: "p2", groups: true))
    stub_request(:post, PENDING_URL).with { |r| JSON.parse(r.body)["cursor"] == "p2" }.to_return(empty)
    # The next page repeats order 3 alongside 4 and 5: kept once.
    stub_request(:post, PENDING_URL).with { |r| JSON.parse(r.body)["cursor"] == "p3" }
      .to_return(real_page([real_sub(3), real_sub(4), real_sub(5)], total: 3, cursor: "p4", groups: true))
    with_endpoints([rts]) { MeeshoSyncJob.new.perform(account.id) }
    rows = MeeshoSyncSnapshot.find_by(endpoint: "orders_ready_to_ship").payload
    assert_equal %w[3_1 4_1 5_1], rows.map { |r| r["sub_order_num"] }
    assert_requested(:post, PENDING_URL, times: 3)
    refute_match(/short of/, account.runs.last.message)
  end

  test "only the first page carries the total — later pages' 0 doesn't end the pull" do
    account = supplier_account
    rts = MeeshoEndpoints.orders_tab("ready-to-ship", 3)
    stub_request(:post, PENDING_URL).with { |r| JSON.parse(r.body)["cursor"].nil? }.to_return(real_page([real_sub(3)], total: 3, cursor: "p2", groups: true))
    stub_request(:post, PENDING_URL).with { |r| JSON.parse(r.body)["cursor"] == "p2" }.to_return(real_page([real_sub(4)], total: 0, cursor: "p3", groups: true))
    stub_request(:post, PENDING_URL).with { |r| JSON.parse(r.body)["cursor"] == "p3" }.to_return(real_page([real_sub(5)], total: 0, cursor: "p4", groups: true))
    with_endpoints([rts]) { MeeshoSyncJob.new.perform(account.id) }
    assert_equal %w[3_1 4_1 5_1], MeeshoSyncSnapshot.find_by(endpoint: "orders_ready_to_ship").payload.map { |r| r["sub_order_num"] }
    assert_requested(:post, PENDING_URL, times: 3)
  end

  test "a pull that ends short of Meesho's total says so" do
    account = supplier_account
    rts = MeeshoEndpoints.orders_tab("ready-to-ship", 3)
    stub_request(:post, PENDING_URL).to_return(real_page([real_sub(3)], total: 69, cursor: nil, groups: true))
    with_endpoints([rts]) { MeeshoSyncJob.new.perform(account.id) }
    assert_match(/ready to ship: 1 — short of the 69 Meesho lists/, account.runs.last.message)
  end

  test "a scheduled pull skips shipped while its last pull is recent; refresh doesn't" do
    account = supplier_account
    shipped = MeeshoEndpoints.orders_tab("shipped", 4, every: 15)
    MeeshoSyncSnapshot.create!(account_id: account.id, endpoint: "orders_shipped", http_status: 200, payload: [], fetched_at: 5.minutes.ago)
    stub_request(:post, PENDING_URL).to_return(real_page([real_sub(1)], total: 1))
    with_endpoints([shipped]) { MeeshoSyncJob.new.perform(account.id, nil, MeeshoSyncRun::TRIGGER_SCHEDULE) }
    assert_not_requested(:post, PENDING_URL)
    with_endpoints([shipped]) { MeeshoSyncJob.new.perform(account.id, nil, MeeshoSyncRun::TRIGGER_MANUAL) }
    assert_requested(:post, PENDING_URL, times: 1)
  end

  test "the orders middleware (Django) brings the orders table up to date from the pull, and the run says what it did" do
    account = supplier_account
    calls = []
    original = DjangoCommand.method(:run)
    DjangoCommand.define_singleton_method(:run) do |*a, **|
      calls << a
      { "added" => 2, "status_changed" => 1, "updated" => 0, "kept_further_on" => 1, "rejected" => 1, "reject_reasons" => { "missing sub_order_num" => 1 } }
    end
    stub_request(:post, PENDING_URL).to_return(real_page([real_sub(1), real_sub(2)], total: 2))
    with_endpoints([MeeshoEndpoints.orders_tab("pending", 1)]) { MeeshoSyncJob.new.perform(account.id) }
    run = account.runs.last
    assert_equal "OK", run.status, run.message
    assert_equal [["meesho_inject", "--account", account.id, "--kind", "orders"]], calls
    assert MeeshoSyncSnapshot.find_by(endpoint: "orders_pending")                # snapshot first, then the middleware reads it
    assert_match(/Orders table: 2 added, 1 status changes, 0 updated, 1 kept further on, 1 refused \(missing sub_order_num\)\./, run.message)
    assert account.reload.orders_changed_at.present?                             # tells Django's response cache

    DjangoCommand.define_singleton_method(:run) { |*a, **| raise DjangoCommand::Failed, "meesho_inject failed: boom" }
    with_endpoints([MeeshoEndpoints.orders_tab("pending", 1)]) { MeeshoSyncJob.new.perform(account.id) }
    assert_equal ["FAILED", "meesho_inject failed: boom"], [account.runs.last.status, account.runs.last.message]
  ensure
    DjangoCommand.define_singleton_method(:run, original)
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

end
