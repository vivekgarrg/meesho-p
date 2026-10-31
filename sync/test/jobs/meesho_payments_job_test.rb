require "test_helper"

class MeeshoPaymentsJobTest < ActiveSupport::TestCase
  BASE = "https://supplier.meesho.com/api/payouts/payments/"
  FILE = "https://storage.googleapis.com/gcs-supl-pay/3564327/meesho_PAYMENT.zip?X-Goog-Signature=abc"

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

  setup do
    @imports = []
    imports = @imports
    @original_import = MeeshoPayments.method(:import)
    MeeshoPayments.define_singleton_method(:import) do |business_id, paths, kind|
      imports << [business_id, paths.map { |p| File.binread(p) }, kind]
      kind == "completed" ? { "order_payments" => { "created" => 5, "updated" => 2 }, "ads_cost" => { "created" => 1, "updated" => 0 } }
                          : { "outstanding" => { "rows" => 9, "replaced" => 3 } }
    end
    stub_request(:post, "#{BASE}previous-payments").to_return(json(daywisePayments: [{ date: "2026-10-30", netAmount: 16766.47, transferId: "AXIS1" }], count: 1))
    @today = ActiveSupport::TimeZone["Asia/Kolkata"].today
    stub_request(:post, "#{BASE}upcoming-payments").to_return(json(daywisePayments: [
      { date: (@today + 1).iso8601, netAmount: 45535.92 }, { date: (@today + 3).iso8601, netAmount: 3204.91 }], count: 2))
    stub_request(:post, "#{BASE}previous-total-amount").to_return(json(netAmount: 836640.97))
    stub_request(:post, "#{BASE}upcoming-total-amount").to_return(json(netAmount: 141071.14))
    stub_request(:post, "#{BASE}v2/payments-excel/create").with { |r| JSON.parse(r.body)["data"][0]["payment_status"] == "COMPLETED" }
      .to_return(json([{ jobId: "job-c", status: "REGISTERED" }]))
    stub_request(:post, "#{BASE}v2/payments-excel/create").with { |r| JSON.parse(r.body)["data"][0]["payment_status"] == "PENDING" }
      .to_return(json([{ jobId: "job-o", status: "REGISTERED" }]))
    stub_request(:post, "#{BASE}payments-excel/history").to_return(json([
      { jobId: "job-c", status: "COMPLETED", filePath: FILE, paymentStatus: "COMPLETED" },
      { jobId: "job-o", status: "COMPLETED", filePath: FILE, paymentStatus: "PENDING" }]))
    stub_request(:get, FILE).to_return(status: 200, body: "PK-zip-bytes")
  end

  teardown do
    MeeshoPayments.define_singleton_method(:import, @original_import)
  end

  def run_job
    MeeshoPaymentsJob.stub_const(:POLL_SECONDS, 0) do
      MeeshoPaymentsJob.stub_const(:RETRY_SECONDS, 0) do
        MeeshoPaymentsJob.stub_const(:RATE_WAIT, 0) do
          MeeshoPaymentsJob.stub_const(:GAP, 0) { MeeshoPaymentsJob.new.perform(account.id) }
        end
      end
    end
  end

  # An outstanding file request's IST days, [first, last]; nil for any other.
  def pending_span(r)
    d = JSON.parse(r.body)["data"][0]
    return nil unless d["payment_status"] == "PENDING"
    %w[start_date end_date].map { |k| Time.iso8601(d[k]).in_time_zone("Asia/Kolkata").to_date }
  end

  def pending_day(r)
    (span = pending_span(r)) && span.first == span.last && span.first
  end

  def pending_spans_requested
    spans = []
    assert_requested(:post, "#{BASE}v2/payments-excel/create", at_least_times: 0) { |r| (sp = pending_span(r)) ? spans << sp : true }
    spans
  end

  test "both payment files are requested, downloaded and handed to Django's importer" do
    run_job
    run = account.runs.last
    assert_equal ["PAYMENTS", "OK"], [run.kind, run.status], run.message
    assert_match(/Payments table \(.+\): 5 new, 2 updated order payments; 1 new ads costs\. Outstanding \(.+\): 9 orders\./, run.message)
    # Outstanding: one file, today to the last payout day the summary lists.
    assert_equal [[account.business_id, ["PK-zip-bytes"], "completed"], [account.business_id, ["PK-zip-bytes"], "outstanding"]], @imports
    assert_empty Dir.glob(File.join(Dir.tmpdir, "meesho-payments*-#{Process.pid}-*"))                   # downloads cleaned up
    snap = MeeshoSyncSnapshot.find_by(account_id: account.id, endpoint: "payments_summary").payload
    assert_equal 836640.97, snap.dig("previous_total", "netAmount")
    # The last 30 days, completed; the next 7, outstanding ("PENDING" to Meesho), as IST days.
    completed = nil
    assert_requested(:post, "#{BASE}v2/payments-excel/create", times: 2) do |r|
      d = JSON.parse(r.body)["data"][0]
      completed = d if d["payment_status"] == "COMPLETED"
      d["file_type"] == "SP_ORDER_ADS_REFERRAL_PAYMENT_FILE" && d["start_date"].end_with?("T18:30:00.000Z") && r.headers["Identifier"] == "lffy4"
    end
    ist = ->(t) { Time.iso8601(t).in_time_zone("Asia/Kolkata") }
    assert_equal [0, 0, 0], ist.(completed["start_date"]).then { |t| [t.hour, t.min, t.sec] }       # midnight IST…
    assert_equal 30, (ist.(completed["end_date"]).to_date - ist.(completed["start_date"]).to_date).to_i
  end

  test "a refused file request is tried again, and one file failing doesn't stop the other" do
    stub_request(:post, "#{BASE}upcoming-payments").to_return(json(daywisePayments: [], count: 0))
    stub_request(:post, "#{BASE}v2/payments-excel/create").with { |r| JSON.parse(r.body)["data"][0]["payment_status"] == "COMPLETED" }
      .to_return(json({ message: "Failed to create payment excel request(s)" }, status: 500)).then
      .to_return(json([{ jobId: "job-c", status: "REGISTERED" }]))
    stub_request(:post, "#{BASE}v2/payments-excel/create").with { |r| JSON.parse(r.body)["data"][0]["payment_status"] == "PENDING" }
      .to_return(json({ message: "nope" }, status: 400))
    run_job
    run = account.runs.last
    assert_equal "OK", run.status, run.message                                      # no outstanding file: nothing outstanding to read
    assert_match(/5 new, 2 updated order payments/, run.message)                   # completed went through on the retry
    assert_match(/Outstanding: no outstanding file from .+ \(Meesho answered \(HTTP 400\)/, run.message)
    assert_equal ["completed"], @imports.map(&:last)
  end

  test "outstanding is one file, from today to the last listed payout day" do
    run_job
    assert_equal [[@today, @today + 3]], pending_spans_requested.uniq
  end

  test "Meesho's too-many-requests is waited out, never taken as no data" do
    stub_request(:post, "#{BASE}v2/payments-excel/create").with { |r| pending_span(r) == [@today, @today + 3] }
      .to_return(json({ message: "You've made too many requests" }, status: 429)).times(2).then
      .to_return(json([{ jobId: "job-o", status: "REGISTERED" }]))
    stub_request(:post, "#{BASE}payments-excel/history").to_return(json({ message: "slow down" }, status: 429)).then
      .to_return(json([{ jobId: "job-c", filePath: FILE }, { jobId: "job-o", filePath: FILE }]))
    run_job
    run = account.runs.last
    assert_equal "OK", run.status, run.message
    assert_equal [["PK-zip-bytes"], "outstanding"], @imports.last[1..]
  end

  test "still rate-limited, the last outstanding payments are kept and the read fails" do
    stub_request(:post, "#{BASE}v2/payments-excel/create").with { |r| pending_span(r) }
      .to_return(json({ message: "You've made too many requests" }, status: 429))
    run_job
    run = account.runs.last
    assert_equal "FAILED", run.status
    assert_equal ["completed"], @imports.map(&:last)                                   # nothing replaced with a part
    assert_match(/Outstanding: couldn't read the file for #{(@today + 3).strftime('%-d %b')} \(Meesho answered \(HTTP 429\).*the last outstanding payments are kept/, run.message)
    assert_match(/5 new, 2 updated order payments/, run.message)                     # completed still went in
    assert_requested(:post, "#{BASE}v2/payments-excel/create", times: 1 + 4)          # no day-by-day burst after a 429
  end

  test "a read that would outlast its budget gives up instead of waiting on" do
    stub_request(:post, "#{BASE}v2/payments-excel/create").with { |r| pending_span(r) }
      .to_return(json({ message: "You've made too many requests" }, status: 429))
    MeeshoPaymentsJob.stub_const(:BUDGET, -1) { run_job }
    run = account.runs.last
    assert_equal "FAILED", run.status
    assert_requested(:post, "#{BASE}v2/payments-excel/create", times: 1 + 1)          # no waiting past the budget
  end

  test "the one file refused, it goes a day at a time: today if there is one, and every listed day" do
    stub_request(:post, "#{BASE}v2/payments-excel/create").with { |r| (sp = pending_span(r)) && sp.first != sp.last || pending_day(r) == @today }
      .to_return(json({ message: "nope" }, status: 400))
    run_job
    run = account.runs.last
    assert_equal "OK", run.status, run.message
    assert_equal ["PK-zip-bytes"] * 2, @imports.last[1]                                  # the two listed days; nothing due today
    assert_equal [@today, @today + 1, @today + 3], pending_spans_requested.select { |a, b| a == b }.map(&:first).uniq.sort
  end

  test "a listed day refused in the day-by-day keeps the last outstanding payments" do
    stub_request(:post, "#{BASE}v2/payments-excel/create").with { |r| (sp = pending_span(r)) && sp.first != sp.last || pending_day(r) == @today + 3 }
      .to_return(json({ message: "nope" }, status: 400))
    run_job
    assert_equal ["completed"], @imports.map(&:last)
    assert_match(/couldn't read the file for #{(@today + 3).strftime('%-d %b')}/, account.runs.last.message)
  end

  test "with no payout listed, outstanding goes day by day and stops at the first day Meesho has no file for" do
    stub_request(:post, "#{BASE}upcoming-payments").to_return(json(daywisePayments: [], count: 0))
    stub_request(:post, "#{BASE}v2/payments-excel/create").with { |r| (d = pending_day(r)) && d >= @today + 2 }
      .to_return(json({ message: "Failed to create payment excel request(s)" }, status: 500))
    run_job
    run = account.runs.last
    assert_equal "OK", run.status, run.message
    assert_equal ["PK-zip-bytes"] * 2, @imports.last[1]                                   # today and tomorrow
    assert_match(/Outstanding \(.+\): 9 orders — no file from #{(@today + 2).strftime('%-d %b')}\./, run.message)
    assert_requested(:post, "#{BASE}v2/payments-excel/create", times: 1 + 2 + 3) # completed, 2 days, the refused day ×3 tries
  end

  test "a folder or file the worker may not touch is named, not just EACCES" do
    original = MeeshoPayments.method(:download)
    MeeshoPayments.define_singleton_method(:download) { |*| raise Errno::EACCES, "/home/deploy/x" }
    run_job
    assert_match(/Server error: Permission denied .*\/home\/deploy\/x/, account.runs.last.message)
  ensure
    MeeshoPayments.define_singleton_method(:download, original)
  end

  test "a file link anywhere but Meesho's storage is refused" do
    stub_request(:post, "#{BASE}payments-excel/history").to_return(json([
      { jobId: "job-c", filePath: "https://evil.example.com/x.zip" }, { jobId: "job-o", filePath: "https://evil.example.com/y.zip" }]))
    run_job
    assert_match(/points somewhere unexpected \(evil\.example\.com\)/, account.runs.last.message)
    assert_empty @imports
    assert_not_requested(:get, /evil\.example\.com/)
  end

  test "scheduled payments reads start a while apart per account" do
    account
    make_account(business_id: 2, phone_number: "9000000002", status: "ACTIVE", supplier_id: "1", supplier_identifier: "x")
    MeeshoScheduleJob.new.perform
    jobs = MeeshoPaymentsJob.jobs
    assert_equal 2, jobs.size
    assert_nil jobs.first["at"]
    assert_in_delta MeeshoPaymentsJob::STAGGER, jobs.last["at"] - Time.now.to_f, 5
  end

  test "the schedule reads payments every two hours" do
    account
    MeeshoScheduleJob.new.perform
    MeeshoScheduleJob.new.perform
    assert_equal 1, MeeshoPaymentsJob.jobs.size
    assert_equal 1, account.runs.where(kind: "PAYMENTS").count
  end
end
