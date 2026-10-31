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
    MeeshoPayments.define_singleton_method(:import) do |business_id, path, kind|
      imports << [business_id, File.binread(path), kind]
      kind == "completed" ? { "order_payments" => { "created" => 5, "updated" => 2 }, "ads_cost" => { "created" => 1, "updated" => 0 } }
                          : { "outstanding" => { "rows" => 9, "replaced" => 3 } }
    end
    stub_request(:post, "#{BASE}previous-payments").to_return(json(daywisePayments: [{ date: "2026-10-30", netAmount: 16766.47, transferId: "AXIS1" }], count: 1))
    stub_request(:post, "#{BASE}upcoming-payments").to_return(json(daywisePayments: [{ date: "2026-11-02", netAmount: 45535.92 }], count: 1))
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
      MeeshoPaymentsJob.stub_const(:RETRY_SECONDS, 0) { MeeshoPaymentsJob.new.perform(account.id) }
    end
  end

  test "both payment files are requested, downloaded and handed to Django's importer" do
    run_job
    run = account.runs.last
    assert_equal ["PAYMENTS", "OK"], [run.kind, run.status], run.message
    assert_match(/Payments table \(.+\): 5 new, 2 updated order payments; 1 new ads costs\. Outstanding \(next 7 days\): 9 orders\./, run.message)
    assert_equal [[account.business_id, "PK-zip-bytes", "completed"], [account.business_id, "PK-zip-bytes", "outstanding"]], @imports
    assert_empty Dir.glob(File.join(MeeshoPaymentsJob::DIR, "*"))                        # downloads cleaned up
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
    stub_request(:post, "#{BASE}v2/payments-excel/create").with { |r| JSON.parse(r.body)["data"][0]["payment_status"] == "COMPLETED" }
      .to_return(json({ message: "Failed to create payment excel request(s)" }, status: 500)).then
      .to_return(json([{ jobId: "job-c", status: "REGISTERED" }]))
    stub_request(:post, "#{BASE}v2/payments-excel/create").with { |r| JSON.parse(r.body)["data"][0]["payment_status"] == "PENDING" }
      .to_return(json({ message: "nope" }, status: 400))
    run_job
    run = account.runs.last
    assert_equal "FAILED", run.status
    assert_match(/5 new, 2 updated order payments/, run.message)                   # completed went through on the retry
    assert_match(/Outstanding: Meesho answered \(HTTP 400\)/, run.message)
    assert_equal ["completed"], @imports.map(&:last)
  end

  test "a file link anywhere but Meesho's storage is refused" do
    stub_request(:post, "#{BASE}payments-excel/history").to_return(json([
      { jobId: "job-c", filePath: "https://evil.example.com/x.zip" }, { jobId: "job-o", filePath: "https://evil.example.com/y.zip" }]))
    run_job
    assert_match(/points somewhere unexpected \(evil\.example\.com\)/, account.runs.last.message)
    assert_empty @imports
    assert_not_requested(:get, /evil\.example\.com/)
  end

  test "the schedule reads payments every two hours" do
    account
    MeeshoScheduleJob.new.perform
    MeeshoScheduleJob.new.perform
    assert_equal 1, MeeshoPaymentsJob.jobs.size
    assert_equal 1, account.runs.where(kind: "PAYMENTS").count
  end
end
