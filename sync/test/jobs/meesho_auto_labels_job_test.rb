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

  def snapshot(endpoint, rows, acc = account)
    MeeshoSyncSnapshot.find_or_initialize_by(account_id: acc.id, endpoint: endpoint)
                      .update!(http_status: 200, payload: rows, fetched_at: Time.current)
  end

  # A second business, with its own Meesho account.
  def rudam
    @rudam ||= begin
      Business.create!(id: 2, name: "Rudam")
      a = make_account(business_id: 2, phone_number: "9000000002", status: "ACTIVE", supplier_id: "4313711", supplier_identifier: "rudam1",
                       supplier_name: "Rudam")
      a.cookies = { "connect.sid" => "sess2" }
      a.save!
      a
    end
  end

  def row(n, label: false, key: "g#{n}")
    { "sub_order_num" => "#{n}_1", "sub_order_id" => "#{n}_1_FORWARD", "grouping_key" => key, "shipment_type" => "forward", "label" => label }
  end

  # The real jobs talk to Meesho; here they record what they were asked to do.
  def with_fake_jobs(ready_after: Hash.new(0), short_once: [])
    calls = { pulls: 0, accept: [], labels: [], django: [], label_accounts: [] }
    moving = Hash.new { |h, k| h[k] = [] }            # account id => [[reads left, row]]
    short = short_once.dup
    pull = lambda do |id, *|
      calls[:pulls] += 1
      arrived, still = moving[id].map { |n, r| [n - 1, r] }.partition { |n, _| n <= 0 }
      moving[id] = still
      next if arrived.empty?
      snap = MeeshoSyncSnapshot.find_or_initialize_by(account_id: id, endpoint: "orders_ready_to_ship")
      snap.update!(http_status: 200, payload: Array(snap.payload) + arrived.map(&:last), fetched_at: Time.current)
    end
    swaps = {
      [MeeshoSyncJob, :perform] => pull,
      [MeeshoAcceptJob, :perform] => lambda do |id, run_id, groups|
        calls[:accept] << groups
        groups.flat_map { |g| g["sub_order_ids"] }.each do |sid|
          moving[id] << [ready_after[id] + 1, { "sub_order_id" => sid, "grouping_key" => "a-#{sid}", "shipment_type" => "forward", "label" => false }]
        end
        MeeshoSyncRun.find(run_id).finish!(true, "ok", records: groups.sum { |g| g["sub_order_ids"].size })
      end,
      [MeeshoLabelJob, :perform] => lambda do |id, run_id, groups|
        calls[:labels] << [groups, MeeshoSyncRun.find(run_id).result["batch"]]
        calls[:label_accounts] << id
        n = groups.sum { |g| g["sub_order_ids"].size }
        if short.delete(id)                             # Meesho made none of them this time
          MeeshoSyncRun.find(run_id).finish!(false, "Meesho couldn't make the labels", records: 0)
        else
          MeeshoSyncRun.find(run_id).finish!(true, "ok", records: n)
          snap = MeeshoSyncSnapshot.find_by(account_id: id, endpoint: "orders_ready_to_ship")
          done = groups.flat_map { |g| g["sub_order_ids"] }
          snap&.update!(payload: snap.payload.map { |r| done.include?(r["sub_order_id"]) ? r.merge("label" => "Downloaded") : r })
        end
      end,
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
      # 7's label was downloaded already; 1, just accepted, is labelled with the rest.
      assert_equal %w[1_1_FORWARD 5_1_FORWARD 6_1_FORWARD], groups.flat_map { |g| g["sub_order_ids"] }.sort
      assert_match(/\Aauto-\d{8}-\d{4}-/, batch)                                 # one batch: one "Download merged labels"
      assert_equal ["Cosmify: 1 of 1 pending accepted, labels for 3 of 3 ready to ship"], summary
      # The labels are merged, sorted and kept for "Latest labels" — not sent anywhere.
      assert_equal [["meesho_save_labels", "--batch", batch, "--summary", summary.join("\n")]], calls[:django]
      assert_equal %w[ACCEPT LABELS], account.runs.order(:id).pluck(:kind)
    end
  end

  test "two businesses: both accepted, both waited for, both labelled — then one PDF" do
    Business.create!(id: account.business_id, name: "Cosmify")
    snapshot("orders_pending", [row(1)])
    snapshot("orders_ready_to_ship", [])
    snapshot("orders_pending", [row(21), row(22)], rudam)
    snapshot("orders_ready_to_ship", [], rudam)
    # Meesho moves Rudam's accepted orders to Ready to ship only after three more reads.
    with_fake_jobs(ready_after: { rudam.id => 3 }.tap { |h| h.default = 0 }) do |calls|
      MeeshoAutoSetting.create!(enabled: true, label_times: ["17:00"])
      summary = MeeshoAutoLabelsJob.new.perform("labels")
      assert_equal [account.id, rudam.id].sort, calls[:label_accounts].uniq.sort
      assert_includes summary, "Cosmify: 1 of 1 pending accepted, labels for 1 of 1 ready to ship"
      assert_includes summary, "Rudam: 2 of 2 pending accepted, labels for 2 of 2 ready to ship"
      batches = calls[:labels].map(&:last).uniq
      assert_equal 1, batches.size                                               # one batch, one PDF
      assert_equal 1, calls[:django].size                                        # kept / sent once, after both
    end
  end

  test "a business whose labels come back short is tried again before the PDF is made" do
    Business.create!(id: account.business_id, name: "Cosmify")
    snapshot("orders_pending", [])
    snapshot("orders_ready_to_ship", [row(5)])
    with_fake_jobs(short_once: [account.id]) do |calls|
      MeeshoAutoSetting.create!(enabled: true, label_times: ["17:00"])
      summary = MeeshoAutoLabelsJob.new.perform("labels")
      assert_equal 2, calls[:labels].size                                        # tried, then again
      assert_equal ["Cosmify: 0 of 0 pending accepted, labels for 1 of 1 ready to ship"], summary
    end
  end

  test "orders Meesho never moves to Ready to ship, and a business not logged in, are said — not left out silently" do
    Business.create!(id: account.business_id, name: "Cosmify")
    Business.create!(id: 3, name: "Rudam")
    make_account(business_id: 3, phone_number: "9000000003", status: "FAILED", supplier_id: "77", supplier_identifier: "x", sync_enabled: true)
    snapshot("orders_pending", [row(1)])
    snapshot("orders_ready_to_ship", [])
    with_fake_jobs(ready_after: Hash.new(1000)) do |calls|
      MeeshoAutoSetting.create!(enabled: true, label_times: ["17:00"])
      summary = MeeshoAutoLabelsJob.new.perform("labels")
      assert_match(/Cosmify: 1 of 1 pending accepted, labels for 0 of 0 ready to ship \(1 accepted but not in Ready to ship yet/, summary.first)
      assert_match(/Rudam: not connected/, summary.last)
      assert_includes calls[:django].first.last, "Rudam: not connected"           # in the Telegram message too
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

  test "accept & print together: nothing is accepted between label times; each label time accepts and makes labels in one run" do
    ist = ActiveSupport::TimeZone["Asia/Kolkata"]
    MeeshoAutoSetting.create!(enabled: true, accept_every_minutes: 0, label_times: ["11:00", "17:00"])
    tick = ->(at) { travel_to(ist.parse(at)) { MeeshoScheduleJob.new.send(:queue_automation, Time.current) } }
    steps = -> { MeeshoAutoLabelsJob.jobs.map { |j| j["args"].first } }

    %w[09:00 09:30 10:30 10:59].each { |t| tick.("2026-11-02 #{t}") }        # all morning: nothing
    assert_empty steps.()
    tick.("2026-11-02 11:00")                                                 # 11:00: one run — accept, then labels
    %w[11:01 13:00 16:59].each { |t| tick.("2026-11-02 #{t}") }
    tick.("2026-11-02 17:00")
    assert_equal %w[labels labels], steps.()
  end

  test "only the minute scheduler is in the cron schedule — times come from the setting" do
    schedule = YAML.load_file(Rails.root.join("config/schedule.yml"))
    # Labels and accepting run from the minute scheduler only (besides it: daily housekeeping, the
    # Return Guard, the Flipkart session keep-alive and Flipkart's own automation — none of them Meesho's).
    assert_equal({ "meesho_schedule" => "MeeshoScheduleJob", "housekeeping" => "HousekeepingJob",
                   "return_guard" => "ReturnGuardJob", "flipkart_refresh" => "FlipkartRefreshJob",
                   "flipkart_auto" => "FlipkartAutoJob" },
                 schedule.transform_values { |v| v["class"] })
  end
end
