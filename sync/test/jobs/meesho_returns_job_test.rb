require "test_helper"

class MeeshoReturnsJobTest < ActiveSupport::TestCase
  BASE = "https://supplier.meesho.com/api/fulfillment/returnRto/"

  def account
    @account ||= begin
      a = make_account(status: "ACTIVE", supplier_id: "3564327", supplier_identifier: "lffy4", supplier_name: "Cosmify")
      a.cookies = { "connect.sid" => "sess" }
      a.save!
      a
    end
  end

  def json(body = nil, status: 200, **fields)
    { status: status, headers: { "Content-Type" => "application/json" }, body: (body || fields).to_json }
  end

  def page(rows, cursor: nil, total: 1)
    json({ "data" => rows, "cursor" => cursor, "filter_cursor" => "f1", "total_pages" => total })
  end

  def ret(n)
    { "sub_order_num" => "#{n}_1", "awb" => "AWB#{n}", "shipment_status" => "x" }
  end

  def status_of(req)
    JSON.parse(req.body).dig("filters", "shipment_status")
  end

  setup do
    @django = []
    django = @django
    @original = DjangoCommand.method(:run)
    DjangoCommand.define_singleton_method(:run) { |*a, **| django << a; { "intransit" => { "created" => 1 } } }
    stub_request(:post, "#{BASE}fetchDeliveryOTPs").to_return(json("supplier_delivery_otp" => [{ "carrier_name" => "delhivery", "otp" => "7610" }]))
    MeeshoReturnsJob::STATUSES.each_key.with_index do |st, i|
      stub_request(:post, "#{BASE}fetchReturnClaims").with { |r| status_of(r) == st }.to_return(page([ret(i)]))
    end
  end

  teardown { DjangoCommand.define_singleton_method(:run, @original) }

  def run_job
    MeeshoReturnsJob.stub_const(:GAP, 0) { MeeshoReturnsJob.stub_const(:RATE_WAIT, 0) { MeeshoReturnsJob.new.perform(account.id) } }
    account.runs.last
  end

  test "every return status and the OTPs are read, then written through Django's importer" do
    run = run_job
    assert_equal ["RETURNS", "OK"], [run.kind, run.status], run.message
    assert_match(/in transit 1, out for delivery 1, delivered 1, lost 1, disposed 1\. OTPs for 1 courier\./, run.message)
    snaps = MeeshoSyncSnapshot.where(account_id: account.id).pluck(:endpoint).sort
    assert_equal %w[delivery_otps returns_completed_delivered returns_completed_lost returns_intransit returns_ofd_reverse returns_reverse_disposed], snaps
    assert_equal [["meesho_inject", "--account", account.id, "--kind", "returns"]], @django
    # Delivered and lost are read for the last two weeks, as the panel shows them.
    assert_requested(:post, "#{BASE}fetchReturnClaims") { |r| JSON.parse(r.body)["filters"] == { "shipment_status" => "completed_delivered", "delivered_date" => { "value" => "last_2_week" } } }
    assert_requested(:post, "#{BASE}fetchReturnClaims", times: 5) { |r| r.headers["Identifier"] == "lffy4" && JSON.parse(r.body)["supplier_details"] == { "identifier" => "lffy4", "id" => 3564327 } }
  end

  test "pages are followed by their cursor; a refused later page keeps what was read" do
    stub_request(:post, "#{BASE}fetchReturnClaims").with { |r| status_of(r) == "intransit" && JSON.parse(r.body)["cursor"].nil? }
      .to_return(page([ret(1), ret(2)], cursor: "c2", total: 3))
    stub_request(:post, "#{BASE}fetchReturnClaims").with { |r| JSON.parse(r.body)["cursor"] == "c2" }
      .to_return(page([ret(3)], cursor: "c3", total: 3))
    stub_request(:post, "#{BASE}fetchReturnClaims").with { |r| JSON.parse(r.body)["cursor"] == "c3" }
      .to_return(json({ message: "Request failed" }, status: 400))
    run = run_job
    assert_equal "OK", run.status
    assert_match(/in transit 3 \(partial\)/, run.message)
    assert_equal %w[1_1 2_1 3_1], MeeshoSyncSnapshot.find_by(endpoint: "returns_intransit").payload.map { |r| r["sub_order_num"] }
    # The next page as the panel asks for it: the page we're on, the one wanted,
    # both cursors from the last page — and no filters (they're in filter_cursor).
    assert_requested(:post, "#{BASE}fetchReturnClaims") do |r|
      b = JSON.parse(r.body)
      b["cursor"] == "c2" && b["page_pointer"] == 1 && b["targetPage"] == 2 && b["filter_cursor"] == "f1" && !b.key?("filters")
    end
  end

  test "a status Meesho won't hand over keeps its last read, and the rest carry on" do
    MeeshoSyncSnapshot.create!(account_id: account.id, endpoint: "returns_completed_lost", http_status: 200, payload: [ret(9)], fetched_at: 1.hour.ago)
    stub_request(:post, "#{BASE}fetchReturnClaims").with { |r| status_of(r) == "completed_lost" }.to_return(json({ message: "x" }, status: 500))
    run = run_job
    assert_equal "OK", run.status
    assert_match(/lost: not read \(Meesho answered \(HTTP 500\)/, run.message)
    assert_equal ["9_1"], MeeshoSyncSnapshot.find_by(endpoint: "returns_completed_lost").payload.map { |r| r["sub_order_num"] }
  end

  test "too many requests: it waits and tries again" do
    stub_request(:post, "#{BASE}fetchReturnClaims").with { |r| status_of(r) == "completed_lost" }
      .to_return(json({ message: "You've made too many requests" }, status: 429)).then.to_return(page([ret(7)]))
    run = run_job
    assert_match(/lost 1[,.]/, run.message)
    assert_equal ["7_1"], MeeshoSyncSnapshot.find_by(endpoint: "returns_completed_lost").payload.map { |r| r["sub_order_num"] }
  end

  test "returns and OTPs are read every ten minutes" do
    account
    MeeshoScheduleJob.new.perform
    MeeshoScheduleJob.new.perform
    assert_equal 1, MeeshoReturnsJob.jobs.size
    travel 11.minutes do
      MeeshoScheduleJob.new.perform
    end
    assert_equal 2, MeeshoReturnsJob.jobs.size
  end
end
