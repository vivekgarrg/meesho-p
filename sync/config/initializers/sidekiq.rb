redis = { url: ENV.fetch("REDIS_URL", "redis://127.0.0.1:6379/0") }

Sidekiq.configure_server do |config|
  config.redis = redis
  schedule = Rails.root.join("config/schedule.yml")
  Sidekiq::Cron::Job.load_from_hash!(YAML.load_file(schedule)) if schedule.exist?
end

Sidekiq.configure_client do |config|
  config.redis = redis
end
