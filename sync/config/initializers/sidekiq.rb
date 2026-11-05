redis = { url: ENV.fetch("REDIS_URL", "redis://127.0.0.1:6379/0") }

Sidekiq.configure_server do |config|
  config.redis = redis
  # Failed jobs kept for a look, not forever (Sidekiq's default is 10,000 for
  # 6 months, all in Redis's memory). HousekeepingJob trims further daily.
  config[:dead_max_jobs] = 1000
  config[:dead_timeout_in_seconds] = 30 * 24 * 3600
  schedule = Rails.root.join("config/schedule.yml")
  Sidekiq::Cron::Job.load_from_hash!(YAML.load_file(schedule)) if schedule.exist?
end

Sidekiq.configure_client do |config|
  config.redis = redis
end
