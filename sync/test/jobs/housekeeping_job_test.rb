require "test_helper"

class HousekeepingJobTest < ActiveSupport::TestCase
  setup do
    @calls = []
    calls = @calls
    @orig = DjangoCommand.method(:run)
    DjangoCommand.define_singleton_method(:run) { |*a, **_o| calls << a; { "runs_deleted" => 3 } }
  end

  teardown { DjangoCommand.define_singleton_method(:run, @orig) }

  test "runs the Django housekeeping and is scheduled daily" do
    job = HousekeepingJob.new
    def job.trim_dead = 2                       # the dead set lives in Redis
    assert_equal({ "runs_deleted" => 3, "dead_jobs_removed" => 2 }, job.perform)
    assert_equal [["housekeeping"]], @calls
    schedule = YAML.load_file(Rails.root.join("config/schedule.yml"))
    assert_equal "HousekeepingJob", schedule.dig("housekeeping", "class")
  end
end
