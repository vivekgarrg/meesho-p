# The Sidekiq dashboard — queues, running and scheduled jobs, retries, failures,
# the every-minute schedule (Cron) — served at https://<site>/sidekiq/ by
# nginx from this small process (systemd: meesho-sidekiq-web, puma on
# 127.0.0.1:9292). It can retry or delete jobs, so it is behind a username and
# password: SIDEKIQ_WEB_USER / SIDEKIQ_WEB_PASSWORD in the server's .env. With
# no password set it serves nothing.
#
#   bundle exec puma -b tcp://127.0.0.1:9292 sidekiq_web.ru
require "bundler/setup"
require "digest"
require "rack/auth/basic"
require "rack/session"
require "sidekiq"
require "sidekiq/web"
require "sidekiq-cron"
require "sidekiq/cron/web"

Sidekiq.configure_client do |config|
  config.redis = { url: ENV.fetch("REDIS_URL", "redis://127.0.0.1:6379/0") }
end

USER = ENV["SIDEKIQ_WEB_USER"].to_s
PASSWORD = ENV["SIDEKIQ_WEB_PASSWORD"].to_s

SAME = ->(a, b) { a.bytesize == b.bytesize && Rack::Utils.secure_compare(a, b) }

map "/sidekiq" do
  if PASSWORD.empty?
    run ->(_env) { [503, { "content-type" => "text/plain" }, ["Set SIDEKIQ_WEB_USER and SIDEKIQ_WEB_PASSWORD in the .env, then restart meesho-sidekiq-web.\n"]] }
  else
    use Rack::Auth::Basic, "Rudam jobs" do |user, password|
      SAME.(user.to_s, USER) & SAME.(password.to_s, PASSWORD)
    end
    # Sidekiq's forms (retry, delete…) need a session; its secret comes from
    # the dashboard password, so there is nothing more to set.
    use Rack::Session::Cookie, secret: Digest::SHA256.hexdigest("rudam-sidekiq-web:#{PASSWORD}") * 2,
                               same_site: true, max_age: 86_400, path: "/sidekiq"
    run Sidekiq::Web
  end
end
