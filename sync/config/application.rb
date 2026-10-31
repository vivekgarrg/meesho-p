require_relative "boot"

# Local development: read the same gitignored backend/.env the Django app reads
# (MEESHO_SYNC_KEY, REDIS_URL, DB_*…). Like Django's loader it only fills gaps —
# a variable already set always wins — and production has no such file
# (systemd injects deploy/hostinger/.env).
env_file = File.expand_path("../../backend/.env", __dir__)
if File.file?(env_file)
  File.readlines(env_file, chomp: true, encoding: "UTF-8").each do |raw|
    line = raw.strip
    next if line.empty? || line.start_with?("#") || !line.include?("=")
    key, value = line.split("=", 2)
    key = key.strip.delete_prefix("export ").strip
    value = value.strip
    value = value[1..-2] if value.length >= 2 && value[0] == value[-1] && %w[" '].include?(value[0])
    ENV[key] ||= value unless key.empty?
  end
end

require "rails"
require "active_model/railtie"
require "active_record/railtie"
require "rails/test_unit/railtie"

Bundler.require(*Rails.groups)

module Sync
  # The Meesho sync worker. No web server: it only runs Sidekiq jobs (see
  # app/jobs and config/schedule.yml) against the Django app's database.
  class Application < Rails::Application
    config.load_defaults 8.1
    config.autoload_lib(ignore: %w[assets tasks])
    config.eager_load_paths << Rails.root.join("app/jobs")

    # Django stores times in UTC; the business runs on Indian time.
    config.time_zone = "Asia/Kolkata"
    config.active_record.default_timezone = :utc

    # Never write passwords or cookies to the logs.
    config.filter_parameters += %i[password passw cookie cookies secret token _key]
  end
end
