require "test_helper"

class ReturnGuardJobTest < ActiveSupport::TestCase
  setup do
    @calls = []
    calls = @calls
    @orig = DjangoCommand.method(:run)
    DjangoCommand.define_singleton_method(:run) { |*a, **_o| calls << a; { "paused" => [] } }
  end

  teardown { DjangoCommand.define_singleton_method(:run, @orig) }

  test "runs the Django return guard and is scheduled daily" do
    assert_equal({ "paused" => [] }, ReturnGuardJob.new.perform)
    assert_equal [["return_guard"]], @calls
    schedule = YAML.load_file(Rails.root.join("config/schedule.yml"))
    assert_equal "ReturnGuardJob", schedule.dig("return_guard", "class")
  end
end
