require "test_helper"

class MeeshoLabelJobTest < ActiveSupport::TestCase
  LABEL_URL = "https://supplier.meesho.com/api/fulfillment/orders/reqDownloadLabelV2"
  HISTORY_URL = "https://supplier.meesho.com/api/fulfillment/orders/fetchLabelDownloadHistory"
  DOWNLOADED_URL = "https://supplier.meesho.com/api/fulfillment/orders/updateGroupDownloadBackendFlag"
  PDF = "https://storage.googleapis.com/gcs-supl-fnf-pdf-prd/labels/merged/generic/x/Sub_Order_Labels_1.pdf?X-Goog-Signature=abc"
  GROUPS = [
    { "grouping_key" => "347709574790057152_1_FORWARD_1_1", "sub_order_ids" => ["347709574790057152_1_FORWARD"], "shipment_type" => "forward" },
    { "grouping_key" => "347607850925271424_1_FORWARD_1_1", "sub_order_ids" => ["347607850925271424_1_FORWARD"], "shipment_type" => "forward" },
  ].freeze

  def account
    @account ||= begin
      a = make_account(status: "ACTIVE", supplier_id: "4313711", supplier_identifier: "xzvey", supplier_name: "Rudam")
      a.cookies = { "connect.sid" => "sess" }
      a.save!
      a
    end
  end

  setup do
    @flag_stub = stub_request(:post, DOWNLOADED_URL).to_return(status: 200, body: "{}")
  end

  def label_run
    @label_run ||= account.runs.create!(kind: "LABELS", trigger: "MANUAL", records: 2, result: { "batch" => "b1" })
  end

  def history(*entries, polling: false)
    { status: 200, headers: { "Content-Type" => "application/json" },
      body: { is_polling: polling, polling_time_ms: 10000, data: entries }.to_json }
  end

  def entry(id, progress, url: nil, status: nil, success: 2, total: 2)
    { request_id: id, label_url: url, progress_percent: progress, requested_at_msg: "Requested on 31 Oct 2026, 09:33 AM",
      status: status || (progress >= 100 ? "PROCESSED" : "PROCESSING"), status_message: "Processing Completed",
      success_suborder_count: success, total_suborder_count: total }
  end

  test "labels are requested exactly as the panel does, and the PDF link is kept" do
    stub_request(:post, LABEL_URL).to_return(status: 200, body: "{}")
    stub_request(:post, HISTORY_URL).to_return(history(entry("old", 100, url: "https://old")),
                                               history(entry("new", 40), entry("old", 100, url: "https://old"), polling: true),
                                               history(entry("new", 100, url: PDF), entry("old", 100, url: "https://old")))
    MeeshoLabelJob.new.perform(account.id, label_run.id, GROUPS)

    assert_requested(:post, LABEL_URL, times: 1) do |req|
      b = JSON.parse(req.body)
      b.values_at("current_status", "requested_status", "max_transitions", "include_all", "enable_hold") == [1, 101, 2000, false, true] &&
        b["groups"] == GROUPS && b["supplier_details"]["id"] == 4313711 && req.headers["Referer"].end_with?("/orders/ready-to-ship")
    end
    label_run.reload
    assert_equal "OK", label_run.status
    assert_equal({ "batch" => "b1", "label_url" => PDF, "success" => 2, "total" => 2, "request_id" => "new", "flagged" => true }, label_run.result)
    assert_equal "Labels ready — 2 of 2 orders.", label_run.message
    # Marked downloaded, exactly as the panel does — and only ours.
    assert_requested(:post, DOWNLOADED_URL, times: 1) do |req|
      JSON.parse(req.body) == { "supplier_id" => 4313711, "identifier" => "xzvey", "request_id" => "new",
                                "child_supplier_identifier" => nil, "child_supplier_id" => nil } &&
        req.headers["Referer"].end_with?("/orders/ready-to-ship")
    end
    assert_equal 1, MeeshoSyncJob.jobs.size
  end

  test "some orders without a label are reported" do
    stub_request(:post, LABEL_URL).to_return(status: 200, body: { request_id: "r9" }.to_json, headers: { "Content-Type" => "application/json" })
    stub_request(:post, HISTORY_URL).to_return(history, history(entry("r9", 100, url: PDF, success: 1, total: 2)))
    MeeshoLabelJob.new.perform(account.id, label_run.id, GROUPS)
    assert_equal "OK", label_run.reload.status
    assert_match(/1 of 2 orders\. 1 could not be labelled/, label_run.message)
  end

  test "a failed request is reported" do
    stub_request(:post, LABEL_URL).to_return(status: 200, body: "{}")
    stub_request(:post, HISTORY_URL).to_return(history, history(entry("x", 100, status: "FAILED")))
    MeeshoLabelJob.new.perform(account.id, label_run.id, GROUPS)
    assert_equal "FAILED", label_run.reload.status
    assert_nil label_run.result["label_url"]                 # the batch id stays, no link
  end

  test "never finishing says where to get them" do
    stub_request(:post, LABEL_URL).to_return(status: 200, body: "{}")
    stub_request(:post, HISTORY_URL).to_return(history, history(entry("slow", 60)))
    MeeshoLabelJob.new.perform(account.id, label_run.id, GROUPS)
    assert_equal "FAILED", label_run.reload.status
    assert_match(/hasn't finished the labels \(60% when last checked\)/, label_run.message)
  end

  test "labels stay available when marking them downloaded fails" do
    remove_request_stub(@flag_stub)
    stub_request(:post, DOWNLOADED_URL).to_return(status: 500, body: "{}")
    stub_request(:post, LABEL_URL).to_return(status: 200, body: "{}")
    stub_request(:post, HISTORY_URL).to_return(history, history(entry("n2", 100, url: PDF)))
    MeeshoLabelJob.new.perform(account.id, label_run.id, GROUPS)
    label_run.reload
    assert_equal ["OK", PDF, false], [label_run.status, label_run.result["label_url"], label_run.result["flagged"]]
    assert_match(/Meesho wasn't told they were downloaded/, label_run.message)
  end

  test "a failed or unfinished request is never marked downloaded" do
    stub_request(:post, LABEL_URL).to_return(status: 200, body: "{}")
    stub_request(:post, HISTORY_URL).to_return(history, history(entry("x", 100, status: "FAILED")))
    MeeshoLabelJob.new.perform(account.id, label_run.id, GROUPS)
    assert_not_requested(:post, DOWNLOADED_URL)
  end

  test "a Generate is merged, sorted and kept once its last business's labels are made" do
    calls = []
    original = DjangoCommand.method(:run)
    DjangoCommand.define_singleton_method(:run) { |*a, **| calls << a; {} }
    other = make_account(status: "ACTIVE", business_id: 2, supplier_id: "1", supplier_identifier: "x")
    mine = account.runs.create!(kind: "LABELS", trigger: "MANUAL", status: "OK", result: { "batch" => "b9", "label_url" => "u" })
    theirs = other.runs.create!(kind: "LABELS", trigger: "MANUAL", status: "RUNNING", result: { "batch" => "b9" })
    MeeshoLabelJob.new.send(:keep, mine)
    assert_empty calls                                                              # the other business isn't done yet
    theirs.update!(status: "OK", result: { "batch" => "b9", "label_url" => "v" })
    MeeshoLabelJob.new.send(:keep, theirs)
    assert_equal [["meesho_save_labels", "--batch", "b9", "--trigger", "MANUAL"]], calls
    auto = account.runs.create!(kind: "LABELS", trigger: "SCHEDULE", status: "OK", result: { "batch" => "auto-1", "label_url" => "u" })
    MeeshoLabelJob.new.send(:keep, auto)
    assert_equal 1, calls.size                                                      # automatic runs keep theirs themselves
  ensure
    DjangoCommand.define_singleton_method(:run, original)
  end
end
