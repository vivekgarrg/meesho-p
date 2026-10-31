require "test_helper"

class MeeshoAutoLabelsJobTest < ActiveSupport::TestCase
  def account
    @account ||= begin
      a = make_account(status: "ACTIVE", supplier_id: "3564327", supplier_identifier: "lffy4", supplier_name: "Cosmify")
      a.cookies = { "connect.sid" => "sess" }
      a.save!
      a
    end
  end

  def snapshot(endpoint, rows)
    MeeshoSyncSnapshot.create!(account_id: account.id, endpoint: endpoint, http_status: 200, payload: rows, fetched_at: Time.current)
  end

  def row(n, label: false, key: "g#{n}")
    { "sub_order_num" => "#{n}_1", "sub_order_id" => "#{n}_1_FORWARD", "grouping_key" => key, "shipment_type" => "forward", "label" => label }
  end

  # The real jobs talk to Meesho; here they record what they were asked to do.
  def with_fake_jobs
    calls = { pulls: 0, accept: [], labels: [], django: [] }
    swaps = {
      [MeeshoSyncJob, :perform] => ->(*) { calls[:pulls] += 1 },
      [MeeshoAcceptJob, :perform] => ->(_id, run_id, groups) { calls[:accept] << groups; MeeshoSyncRun.find(run_id).finish!(true, "ok", records: groups.sum { |g| g["sub_order_ids"].size }) },
      [MeeshoLabelJob, :perform] => ->(_id, run_id, groups) { calls[:labels] << [groups, MeeshoSyncRun.find(run_id).result["batch"]]; MeeshoSyncRun.find(run_id).finish!(true, "ok", records: groups.sum { |g| g["sub_order_ids"].size }) },
    }
    originals = swaps.keys.to_h { |(k, m)| [[k, m], k.instance_method(m)] }
    swaps.each { |(k, m), fn| k.define_method(m) { |*a| fn.call(*a) } }
    original_run = DjangoCommand.method(:run)
    DjangoCommand.define_singleton_method(:run) { |*a, **| calls[:django] << a; { "sent" => { "telegram" => "sent" } } }
    yield calls
  ensure
    originals&.each { |(k, m), im| k.define_method(m, im) }
    DjangoCommand.define_singleton_method(:run, original_run) if original_run
  end

  test "it does nothing while the automation is switched off" do
    with_fake_jobs do |calls|
      account
      MeeshoAutoSetting.create!(enabled: false, label_times: ["17:00"])
      MeeshoAutoLabelsJob.new.perform
      assert_equal 0, calls[:pulls]
      assert_empty calls[:django]
    end
  end

  test "every 30 minutes: every pending order is accepted, and no labels are made" do
    snapshot("orders_pending", [row(1, key: "shared"), row(2, key: "shared"), row(3), { "sub_order_num" => "4_1" }])
    snapshot("orders_ready_to_ship", [row(5)])
    with_fake_jobs do |calls|
      MeeshoAutoSetting.create!(enabled: true, label_times: ["17:00"])
      summary = MeeshoAutoLabelsJob.new.perform("accept")
      # One accept request, grouped by grouping key; a row without ids is left alone.
      assert_equal [[{ "grouping_key" => "shared", "sub_order_ids" => %w[1_1_FORWARD 2_1_FORWARD], "shipment_type" => "forward" },
                     { "grouping_key" => "g3", "sub_order_ids" => %w[3_1_FORWARD], "shipment_type" => "forward" }]], calls[:accept]
      assert_empty calls[:labels]
      assert_equal 1, calls[:pulls]
      assert_equal ["Cosmify: 3 of 3 pending accepted"], summary
      assert_empty calls[:django]                                                # no labels, nothing to keep
    end
  end

  test "5 PM: pending accepted, then labels for every ready-to-ship order not downloaded, in one batch" do
    Business.create!(id: account.business_id, name: "Cosmify")
    snapshot("orders_pending", [row(1)])
    snapshot("orders_ready_to_ship", [row(5), row(6, label: "Not Downloaded"), row(7, label: "Downloaded")])
    with_fake_jobs do |calls|
      MeeshoAutoSetting.create!(enabled: true, label_times: ["17:00"])
      summary = MeeshoAutoLabelsJob.new.perform("labels")
      assert_equal 1, calls[:accept].size
      assert_equal 2, calls[:pulls]                                              # before accepting, and after
      (groups, batch), = calls[:labels]
      assert_equal %w[5_1_FORWARD 6_1_FORWARD], groups.flat_map { |g| g["sub_order_ids"] }   # 7's label was downloaded already
      assert_match(/\Aauto-\d{8}-\d{4}-/, batch)                                 # one batch: one "Download merged labels"
      assert_equal ["Cosmify: 1 of 1 pending accepted, labels for 2 of 2 ready to ship"], summary
      # The labels are merged, sorted and kept for "Latest labels" — not sent anywhere.
      assert_equal [["meesho_save_labels", "--batch", batch, "--summary", summary.join("\n")]], calls[:django]
      assert_equal %w[ACCEPT LABELS], account.runs.order(:id).pluck(:kind)
    end
  end

  test "an account that fails doesn't stop the others" do
    account
    with_fake_jobs do |calls|
      MeeshoAutoSetting.create!(enabled: true, label_times: ["17:00"])
      MeeshoSyncJob.define_method(:perform) { |*| raise MeeshoClient::AuthError, "session expired" }
      assert_match(/stopped — session expired/, MeeshoAutoLabelsJob.new.perform("labels").first)
    end
  end

  test "the scheduler follows the setting: labels at each label time, accepts every N minutes between" do
    ist = ActiveSupport::TimeZone["Asia/Kolkata"]
    setting = MeeshoAutoSetting.create!(enabled: true, accept_every_minutes: 30, label_times: ["11:00", "17:00"])
    tick = ->(at) { travel_to(ist.parse(at)) { MeeshoScheduleJob.new.send(:queue_automation, Time.current) } }
    steps = -> { MeeshoAutoLabelsJob.jobs.map { |j| j["args"].first } }

    tick.("2026-11-02 10:00")                 # first tick: accept
    tick.("2026-11-02 10:15")                 # 15 min later: not yet
    tick.("2026-11-02 10:30")                 # 30 min: accept
    tick.("2026-11-02 11:00")                 # a label time: labels (which accept too) — no separate accept
    tick.("2026-11-02 11:01")                 # that slot is done
    tick.("2026-11-02 11:30")                 # accepting carries on, counted from the labels run
    assert_equal %w[accept accept labels accept], steps.()

    MeeshoAutoLabelsJob.jobs.clear
    setting.update!(accept_every_minutes: 0, last_labels_at: nil)
    tick.("2026-11-02 18:30")                 # 5 PM was missed by over an hour (worker down): skipped, not run late
    tick.("2026-11-02 17:40")                 # within the hour: run late
    assert_equal %w[labels], steps.()

    MeeshoAutoLabelsJob.jobs.clear
    setting.update!(enabled: false)
    tick.("2026-11-03 17:00")
    assert_empty steps.()
  end

  test "only the minute scheduler is in the cron schedule — times come from the setting" do
    schedule = YAML.load_file(Rails.root.join("config/schedule.yml"))
    assert_equal ["meesho_schedule"], schedule.keys
  end
end
