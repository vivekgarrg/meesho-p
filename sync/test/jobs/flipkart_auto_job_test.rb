require "test_helper"

class FlipkartAutoJobTest < ActiveSupport::TestCase
  setup do
    @calls = []
    calls = @calls
    @orig = DjangoCommand.method(:run)
    DjangoCommand.define_singleton_method(:run) { |*a, **o| calls << [a, o]; { "due" => nil } }
  end

  teardown { DjangoCommand.define_singleton_method(:run, @orig) }

  test "asks Django what's due every minute, with room for a labels run" do
    assert_equal({ "due" => nil }, FlipkartAutoJob.new.perform)
    assert_equal [[["flipkart_auto", "--run", "due"], { timeout: 900 }]], @calls
    schedule = YAML.load_file(Rails.root.join("config/schedule.yml"))
    assert_equal ["FlipkartAutoJob", "* * * * *"], schedule["flipkart_auto"].values_at("class", "cron")
  end
end
