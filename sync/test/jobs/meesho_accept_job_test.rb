require "test_helper"

class MeeshoAcceptJobTest < ActiveSupport::TestCase
  ACCEPT_URL = "https://supplier.meesho.com/api/fulfillment/orders/reqPendingOrders"
  HISTORY_URL = "https://supplier.meesho.com/api/fulfillment/orders/fetchPendingOrdersHistory"
  CLOSE_URL = "https://supplier.meesho.com/api/fulfillment/orders/updatePendingOrderStatus"
  GROUPS = [
    { "grouping_key" => "347718709113587200_1_FORWARD", "sub_order_ids" => ["347718709113587200_1_FORWARD"], "shipment_type" => "forward" },
    { "grouping_key" => "347748969962391424_1_FORWARD", "sub_order_ids" => ["347748969962391424_1_FORWARD"], "shipment_type" => "forward" },
  ].freeze

  def account
    @account ||= begin
      a = make_account(status: "ACTIVE", supplier_id: "4313711", supplier_identifier: "xzvey", supplier_name: "Rudam")
      a.cookies = { "connect.sid" => "sess" }
      a.save!
      a
    end
  end

  def accept_run
    @accept_run ||= account.runs.create!(kind: "ACCEPT", trigger: "MANUAL", records: 2)
  end

  def history(*entries, polling: false)
    { status: 200, headers: { "Content-Type" => "application/json" },
      body: { is_polling: polling, polling_time_ms: 5000, data: entries }.to_json }
  end

  def entry(progress, processed: 2, failed: 0, at: Time.current, id: "req-1", status: nil)
    { status: status || (progress >= 100 ? "COMPLETED" : "IN_PROGRESS"), requested_at_msg: (at.to_f * 1000).to_i.to_s,
      request_id: id, progress_percent: progress, failed_orders_count: failed, processed_orders_count: processed }
  end

  setup do
    stub_request(:post, CLOSE_URL).to_return(status: 200, body: "{}")
  end

  test "accepts the chosen orders exactly as the panel does, then follows the history" do
    stub_request(:post, ACCEPT_URL).to_return(status: 200, body: "{}")
    stub_request(:post, HISTORY_URL).to_return(history, history(entry(40), polling: true), history(entry(100)))
    MeeshoAcceptJob.new.perform(account.id, accept_run.id, GROUPS)

    assert_requested(:post, ACCEPT_URL, times: 1) do |req|
      b = JSON.parse(req.body)
      b["supplier_details"] == { "id" => 4313711, "identifier" => "xzvey", "name" => "Rudam" } &&
        b.values_at("current_status", "requested_status", "max_transitions", "include_all", "enable_hold", "filter") == [1, 3, 2000, false, true, {}] &&
        b["groups"] == GROUPS && req.headers["Identifier"] == "xzvey" && req.headers["Cookie"] == "connect.sid=sess" &&
        req.headers["Referer"].end_with?("/orders/pending")
    end
    assert_requested(:post, HISTORY_URL, times: 3) do |req|
      JSON.parse(req.body) == { "supplier_id" => 4313711, "identifier" => "xzvey", "child_supplier_identifier" => nil, "child_supplier_id" => nil }
    end
    accept_run.reload
    assert_equal ["OK", 2], [accept_run.status, accept_run.records]
    assert_equal "Accepted 2 of 2 orders on Meesho.", accept_run.message
    assert_equal 1, MeeshoSyncJob.jobs.size                      # tabs pulled again
    # The finished request is closed, so Meesho takes the next one.
    assert_requested(:post, CLOSE_URL, times: 1) do |req|
      JSON.parse(req.body) == { "supplier_id" => 4313711, "identifier" => "xzvey", "request_id" => "req-1", "status" => "POPUP_CLOSED",
                                "child_supplier_identifier" => nil, "child_supplier_id" => nil }
    end
  end

  test "an earlier finished request left open is closed before sending" do
    stub_request(:post, ACCEPT_URL).to_return(status: 200, body: "{}")
    stub_request(:post, HISTORY_URL).to_return(history(entry(100, id: "old", at: 3.hours.ago), entry(100, id: "done", at: 4.hours.ago, status: "POPUP_CLOSED")),
                                               history(entry(100, id: "new")))
    MeeshoAcceptJob.new.perform(account.id, accept_run.id, GROUPS)
    closed = WebMock::RequestRegistry.instance.requested_signatures.hash.keys
               .select { |sig| sig.uri.to_s.include?("updatePendingOrderStatus") }.map { |sig| JSON.parse(sig.body)["request_id"] }
    assert_equal %w[new old], closed.sort                       # never the one already closed
    assert_equal "OK", accept_run.reload.status
  end

  test "orders Meesho could not accept are reported" do
    stub_request(:post, ACCEPT_URL).to_return(status: 200, body: "{}")
    stub_request(:post, HISTORY_URL).to_return(history(entry(100, processed: 2, failed: 1)))
    MeeshoAcceptJob.new.perform(account.id, accept_run.id, GROUPS)
    assert_equal "FAILED", accept_run.reload.status
    assert_match(/Accepted 1 of 2 orders on Meesho — 1 failed/, accept_run.message)
  end

  test "an older request in the history is not taken for this one" do
    stub_request(:post, ACCEPT_URL).to_return(status: 200, body: "{}")
    stub_request(:post, HISTORY_URL).to_return(history(entry(100, at: 2.hours.ago)))
    MeeshoAcceptJob.new.perform(account.id, accept_run.id, GROUPS)
    assert_equal "OK", accept_run.reload.status
    assert_match(/still working through them/, accept_run.message)
  end

  test "a lapsed session logs in again once" do
    stub_request(:post, ACCEPT_URL).with(headers: { "Cookie" => "connect.sid=sess" }).to_return(status: 401, body: "{}")
    stub_login(body: "", cookies: ["connect.sid=fresh; Path=/"])
    stub_request(:post, ACCEPT_URL).with(headers: { "Cookie" => "connect.sid=fresh" }).to_return(status: 200, body: "{}")
    stub_request(:post, HISTORY_URL).to_return(history(entry(100)))
    MeeshoAcceptJob.new.perform(account.id, accept_run.id, GROUPS)
    assert_equal "OK", accept_run.reload.status
    assert_requested(:post, ACCEPT_URL, times: 2)
  end

  test "a refused accept is reported and never retried by itself" do
    stub_request(:post, HISTORY_URL).to_return(history)
    stub_request(:post, ACCEPT_URL).to_return(status: 400, body: { error: "Bad Request" }.to_json, headers: { "Content-Type" => "application/json" })
    MeeshoAcceptJob.new.perform(account.id, accept_run.id, GROUPS)
    assert_equal "FAILED", accept_run.reload.status
    assert_match(/Not accepted — Meesho answered \(HTTP 400\) — Bad Request/, accept_run.message)
    assert_requested(:post, ACCEPT_URL, times: 1)
    assert_equal false, MeeshoAcceptJob.get_sidekiq_options["retry"]
  end
end
