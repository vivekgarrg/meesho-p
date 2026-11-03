require "test_helper"

class MeeshoClaimJobTest < ActiveSupport::TestCase
  setup do
    @calls = []
    @answers = []
    calls, answers = @calls, @answers
    @orig = DjangoCommand.method(:run)
    DjangoCommand.define_singleton_method(:run) do |*a, **_o|
      calls << a
      ans = answers.shift
      raise DjangoCommand::Failed, "boom" if ans == :crash
      ans || {}
    end
  end

  teardown { DjangoCommand.define_singleton_method(:run, @orig) }

  test "waits while the phone is still sending, then retries with the next attempt" do
    @answers.push({ "next" => "wait", "in" => 30 })
    MeeshoClaimJob.new.perform(7)
    assert_equal ["meesho_raise_claim", "--claim", 7, "--attempt", 1], @calls.last
    assert_equal [7, 1, 0], MeeshoClaimJob.jobs.last["args"]                   # same attempt: only waiting
    MeeshoClaimJob.jobs.clear
    @answers.push({ "next" => "retry", "in" => 300 })
    MeeshoClaimJob.new.perform(7, 1)
    assert_equal [7, 2, 0], MeeshoClaimJob.jobs.last["args"]                   # Meesho busy: next attempt
    MeeshoClaimJob.jobs.clear
    @answers.push({ "next" => "done" })
    MeeshoClaimJob.new.perform(7, 2)
    assert_empty MeeshoClaimJob.jobs
  end

  test "a command that keeps crashing ends with the claim marked failed" do
    @answers.push(:crash)
    MeeshoClaimJob.new.perform(7, 1, 0)
    assert_equal [7, 1, 1], MeeshoClaimJob.jobs.last["args"]
    MeeshoClaimJob.jobs.clear
    @answers.push(:crash, {})
    MeeshoClaimJob.new.perform(7, 1, MeeshoClaimJob::CRASH_RETRIES)
    assert_empty MeeshoClaimJob.jobs
    assert_equal "--give-up", @calls.last[3]
  end
end
