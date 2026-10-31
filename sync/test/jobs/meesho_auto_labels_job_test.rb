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

  test "it does nothing unless switched on for this server" do
    with_fake_jobs do |calls|
      ENV.delete("MEESHO_AUTO_LABELS")
      account
      MeeshoAutoLabelsJob.new.perform
      assert_equal 0, calls[:pulls]
      assert_empty calls[:django]
    end
  end

  test "8 AM: every pending order is accepted, and no labels are made" do
    snapshot("orders_pending", [row(1, key: "shared"), row(2, key: "shared"), row(3), { "sub_order_num" => "4_1" }])
    snapshot("orders_ready_to_ship", [row(5)])
    with_fake_jobs do |calls|
      ENV["MEESHO_AUTO_LABELS"] = "true"
      summary = MeeshoAutoLabelsJob.new.perform("accept")
      # One accept request, grouped by grouping key; a row without ids is left alone.
      assert_equal [[{ "grouping_key" => "shared", "sub_order_ids" => %w[1_1_FORWARD 2_1_FORWARD], "shipment_type" => "forward" },
                     { "grouping_key" => "g3", "sub_order_ids" => %w[3_1_FORWARD], "shipment_type" => "forward" }]], calls[:accept]
      assert_empty calls[:labels]
      assert_equal 1, calls[:pulls]
      assert_equal ["Cosmify: 3 of 3 pending accepted"], summary
      assert_empty calls[:django]                                                # nothing sent anywhere
    end
  ensure
    ENV.delete("MEESHO_AUTO_LABELS")
  end

  test "5 PM: pending accepted, then labels for every ready-to-ship order not downloaded, in one batch" do
    Business.create!(id: account.business_id, name: "Cosmify")
    snapshot("orders_pending", [row(1)])
    snapshot("orders_ready_to_ship", [row(5), row(6, label: "Not Downloaded"), row(7, label: "Downloaded")])
    with_fake_jobs do |calls|
      ENV["MEESHO_AUTO_LABELS"] = "true"
      summary = MeeshoAutoLabelsJob.new.perform("labels")
      assert_equal 1, calls[:accept].size
      assert_equal 2, calls[:pulls]                                              # before accepting, and after
      (groups, batch), = calls[:labels]
      assert_equal %w[5_1_FORWARD 6_1_FORWARD], groups.flat_map { |g| g["sub_order_ids"] }   # 7's label was downloaded already
      assert_match(/\Aauto-\d{8}-\d{4}-/, batch)                                 # one batch: one "Download merged labels"
      assert_equal ["Cosmify: 1 of 1 pending accepted, labels for 2 of 2 ready to ship"], summary
      assert_empty calls[:django]
      assert_equal %w[ACCEPT LABELS], account.runs.order(:id).pluck(:kind)
    end
  ensure
    ENV.delete("MEESHO_AUTO_LABELS")
  end

  test "an account that fails doesn't stop the others" do
    account
    with_fake_jobs do |calls|
      ENV["MEESHO_AUTO_LABELS"] = "true"
      MeeshoSyncJob.define_method(:perform) { |*| raise MeeshoClient::AuthError, "session expired" }
      assert_match(/stopped — session expired/, MeeshoAutoLabelsJob.new.perform("labels").first)
    end
  ensure
    ENV.delete("MEESHO_AUTO_LABELS")
  end

  test "it accepts at 8 AM and makes labels at 5 PM, India time" do
    schedule = YAML.load_file(Rails.root.join("config/schedule.yml"))
    ist = ActiveSupport::TimeZone["Asia/Kolkata"]
    from = ist.local(2026, 11, 2, 6, 0)
    at = ->(name) { Fugit.parse_cron(schedule.fetch(name)["cron"]).next_time(from).to_t.in_time_zone(ist).strftime("%H:%M") }
    assert_equal ["08:00", ["accept"]], [at.("meesho_auto_accept"), schedule["meesho_auto_accept"]["args"]]
    assert_equal ["17:00", ["labels"]], [at.("meesho_auto_labels"), schedule["meesho_auto_labels"]["args"]]
    assert_equal ["MeeshoAutoLabelsJob"], schedule.values_at("meesho_auto_accept", "meesho_auto_labels").map { |e| e["class"] }.uniq
  end
end
