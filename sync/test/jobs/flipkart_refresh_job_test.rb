require "test_helper"

class FlipkartRefreshJobTest < ActiveSupport::TestCase
  setup do
    @calls = []
    calls = @calls
    @orig = DjangoCommand.method(:run)
    DjangoCommand.define_singleton_method(:run) { |*a, **_o| calls << a; { "3" => "ok" } }
  end

  teardown { DjangoCommand.define_singleton_method(:run, @orig) }

  test "runs the Django Flipkart refresh and is scheduled every 10 minutes" do
    assert_equal({ "3" => "ok" }, FlipkartRefreshJob.new.perform)
    assert_equal [["flipkart_refresh"]], @calls
    schedule = YAML.load_file(Rails.root.join("config/schedule.yml"))
    assert_equal ["FlipkartRefreshJob", "*/10 * * * *"], schedule["flipkart_refresh"].values_at("class", "cron")
  end
end
