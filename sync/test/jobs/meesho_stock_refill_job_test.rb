require "test_helper"

class MeeshoStockRefillJobTest < ActiveSupport::TestCase
  IST = ActiveSupport::TimeZone["Asia/Kolkata"]

  setup do
    @setting = MeeshoAutoSetting.create!(enabled: false, accept_every_minutes: 30, label_times: [], updated_at: Time.current,
                                         stock_refill_enabled: true, stock_refill_time: "21:00", stock_refill_qty: 5000)
    @account = make_account(status: "ACTIVE", supplier_id: "3564327", supplier_identifier: "lffy4")
    cat = MeeshoCatalog.create!(account_id: @account.id, catalog_id: 606662647, name: "Lota", category: "Puja", image_url: "",
                                in_active: true, in_paused: false, in_pending: false, sku_count: 3, active_count: 2, archived_count: 1,
                                blocked_count: 0, out_of_stock_count: 0, low_stock_count: 0, live_delayed: false, seen_at: Time.current)
    mk = ->(pid, sku, inv, archived) {
      MeeshoListing.create!(account_id: @account.id, catalog_id: cat.id, product_id: pid, variation_id: 167, sku_id: sku, name: sku,
                            variation: "Free Size", image_url: "", inventory: inv, archived: archived, archived_at: "",
                            out_of_stock_since: "", seen_at: Time.current)
    }
    mk.(3, "lota-c", 12, false)
    mk.(1, "lota-a", 0, false)          # out of stock, still live: refilled
    mk.(2, "lota-b", 5000, false)       # already there: not sent
    mk.(4, "lota-d", 0, true)           # paused: left alone
  end

  test "due once at the set time (IST), off when switched off" do
    at = ->(h, m) { IST.local(2026, 11, 1, h, m) }
    refute @setting.stock_refill_due?(at.(20, 59))
    assert @setting.stock_refill_due?(at.(21, 0))
    assert @setting.stock_refill_due?(at.(21, 40))
    refute @setting.stock_refill_due?(at.(22, 30))                       # missed by more than the catch-up window
    @setting.update!(last_stock_refill_at: at.(21, 1))
    refute @setting.stock_refill_due?(at.(21, 5))                        # done for tonight
    @setting.update!(last_stock_refill_at: nil, stock_refill_enabled: false)
    refute @setting.stock_refill_due?(at.(21, 0))
  end

  test "the scheduler queues it once a night" do
    travel_to IST.local(2026, 11, 1, 21, 2) do
      MeeshoScheduleJob.new.send(:queue_stock_refill, Time.current)
      MeeshoScheduleJob.new.send(:queue_stock_refill, Time.current)
    end
    assert_equal 1, MeeshoStockRefillJob.jobs.size
  end

  test "only live SKUs not already at the quantity, in order, as one stock run" do
    items = MeeshoStockRefillJob.items(@account, 5000)
    assert_equal %w[lota-a lota-c], items.map { |i| i["sku"] }
    assert items.all? { |i| i["inventory"] == 5000 && !i["paused"] }
    sent = []
    orig = MeeshoStockJob.instance_method(:perform)
    MeeshoStockJob.define_method(:perform) { |aid, run_id, its| sent << [aid, MeeshoSyncRun.find(run_id).trigger, its.size] }
    MeeshoStockRefillJob.new.perform
    assert_equal [[@account.id, "SCHEDULE", 2]], sent
  ensure
    MeeshoStockJob.define_method(:perform, orig) if orig
  end

  test "an account whose stock is held at 0 isn't topped up" do
    hold = MeeshoStockHold.create!(account_id: @account.id, status: "HELD", message: "", created_at: Time.current, updated_at: Time.current)
    sent = []
    orig = MeeshoStockJob.instance_method(:perform)
    MeeshoStockJob.define_method(:perform) { |aid, _run_id, its| sent << [aid, its.size] }
    MeeshoStockRefillJob.new.perform
    assert_equal [], sent
    hold.update!(status: "RESTORED")                     # restored: the nightly stock goes on again
    MeeshoStockRefillJob.new.perform
    assert_equal [[@account.id, 2]], sent
  ensure
    MeeshoStockJob.define_method(:perform, orig) if orig
  end
end
