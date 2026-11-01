require "test_helper"

class MeeshoRedoLabelsJobTest < ActiveSupport::TestCase
  def account(n, name)
    a = make_account(business_id: n, phone_number: "900000000#{n}", status: "ACTIVE", supplier_id: n.to_s,
                     supplier_identifier: "id#{n}", supplier_name: name)
    a.cookies = { "connect.sid" => "s" }
    a.save!
    a
  end

  setup do
    @cosmify = account(1, "Cosmify")
    @rudam = account(2, "Rudam")
    @ok = @cosmify.runs.create!(kind: "LABELS", trigger: "SCHEDULE", status: "OK", queued_at: Time.current,
                                result: { "batch" => "auto-5pm", "label_url" => "https://x/c.pdf", "success" => 33 })
    @failed = @rudam.runs.create!(kind: "LABELS", trigger: "SCHEDULE", status: "FAILED", queued_at: Time.current,
                                  result: { "batch" => "auto-5pm" }, message: "Labels not generated — Meesho answered (HTTP 423)")
    MeeshoSyncSnapshot.create!(account_id: @rudam.id, endpoint: "orders_ready_to_ship", http_status: 200, fetched_at: Time.current,
                               payload: [{ "sub_order_id" => "9_1_FORWARD", "grouping_key" => "g9", "label" => "Not Downloaded" },
                                         { "sub_order_id" => "8_1_FORWARD", "grouping_key" => "g8", "label" => "Downloaded" }])
    @calls = []
    calls = @calls
    @orig = { sync: MeeshoSyncJob.instance_method(:perform), label: MeeshoLabelJob.instance_method(:perform),
              django: DjangoCommand.method(:run) }
    MeeshoSyncJob.define_method(:perform) { |*a| calls << [:pull, a.first] }
    MeeshoLabelJob.define_method(:perform) do |aid, run_id, groups|
      calls << [:labels, aid, groups.map { |g| g["grouping_key"] }]
      r = MeeshoSyncRun.find(run_id)
      r.update!(status: "OK", records: 1, result: r.result.merge("label_url" => "https://x/r.pdf", "success" => 1))
    end
    DjangoCommand.define_singleton_method(:run) { |*a| calls << [:django, *a]; {} }
  end

  teardown do
    MeeshoSyncJob.define_method(:perform, @orig[:sync])
    MeeshoLabelJob.define_method(:perform, @orig[:label])
    DjangoCommand.define_singleton_method(:run, @orig[:django])
  end

  test "only the business that failed is labelled again, then the batch is merged, sorted and sent" do
    MeeshoRedoLabelsJob.new.perform("auto-5pm", true)
    assert_equal [:pull, @rudam.id], @calls[0]
    assert_equal [:labels, @rudam.id, ["g9"]], @calls[1]                   # only what isn't downloaded yet; Cosmify untouched
    django = @calls.find { |c| c.first == :django }
    assert_equal ["meesho_save_labels", "--batch", "auto-5pm", "--trigger", "AUTO"], django[1, 5]
    assert_includes django, "--send"
    assert @failed.reload.result["superseded"]                            # the batch no longer looks incomplete
    new_run = @rudam.runs.where.not(id: @failed.id).last
    assert_equal ["auto-5pm", "https://x/r.pdf"], new_run.result.values_at("batch", "label_url")
  end

  test "a batch already complete is just merged again" do
    @failed.update!(result: @failed.result.merge("superseded" => true))
    MeeshoRedoLabelsJob.new.perform("auto-5pm", false)
    assert_equal [:django], @calls.map(&:first)
    refute_includes @calls.last, "--send"
  end
end
