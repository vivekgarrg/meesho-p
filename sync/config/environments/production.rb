Rails.application.configure do
  config.enable_reloading = false
  config.eager_load = true
  config.logger = ActiveSupport::TaggedLogging.logger(STDOUT)
  config.log_level = ENV.fetch("RAILS_LOG_LEVEL", "info")
  config.active_support.report_deprecations = false
  config.active_record.dump_schema_after_migration = false
  # Nothing here signs cookies or sessions, but Rails insists on a value.
  config.secret_key_base = ENV.fetch("SECRET_KEY_BASE") { ENV.fetch("DJANGO_SECRET_KEY", "sync-worker-no-sessions") }
end
