# Daily: pause products whose returns are over the limit (40% of 50+ units) or
# that sell at a loss (20+ units), and send an alert. The rules live in Django
# (manage.py return_guard); this only runs it on a schedule.
class ReturnGuardJob
  include Sidekiq::Job
  sidekiq_options queue: "default", retry: 1

  def perform
    result = DjangoCommand.run("return_guard", timeout: 900)
    Rails.logger.info("return_guard: #{result.to_json}")
    result
  end
end
