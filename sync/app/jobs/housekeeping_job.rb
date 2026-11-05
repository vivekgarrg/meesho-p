# Daily: keep the server's disk and Redis in bounds. The Django side drops old
# sync history, expired API-cache files and abandoned claim uploads
# (manage.py housekeeping); here, Sidekiq's dead-job list is trimmed to what
# anyone would still look at.
class HousekeepingJob
  include Sidekiq::Job
  sidekiq_options queue: "default", retry: 1

  DEAD_DAYS = 14

  def perform
    result = DjangoCommand.run("housekeeping", timeout: 900)
    dead = trim_dead
    Rails.logger.info("housekeeping: #{result.merge('dead_jobs_removed' => dead).to_json}")
    result.merge("dead_jobs_removed" => dead)
  end

  private

  def trim_dead
    require "sidekiq/api"
    cutoff = DEAD_DAYS.days.ago.to_f
    n = 0
    Sidekiq::DeadSet.new.each do |job|
      next unless job.at.to_f < cutoff
      job.delete
      n += 1
    end
    n
  end
end
