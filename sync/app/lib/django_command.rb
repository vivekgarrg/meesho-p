require "open3"

# Run one of the Django app's management commands from the worker — for work
# that belongs to Django (its importers, label sorting, sending), so it is never
# written twice. Django is pointed at the very database this worker uses, and
# the command's last line of JSON is returned.
module DjangoCommand
  BACKEND = File.expand_path("../../../backend", __dir__)

  class Failed < StandardError; end

  module_function

  def run(name, *args, timeout: 600)
    out, err, st = Open3.capture3(env, python, "manage.py", name, *args.map(&:to_s), chdir: BACKEND)
    raise Failed, "#{name} failed: #{err.lines.last(3).join.strip.truncate(300)}" unless st.success?
    JSON.parse(out.lines.reverse.find { |l| l.strip.start_with?("{") } || "{}")
  end

  def python
    ENV["MEESHO_DJANGO_PYTHON"].presence ||
      [File.join(BACKEND, ".venv/bin/python"), File.join(BACKEND, "venv/bin/python")].find { |p| File.executable?(p) } || "python3"
  end

  # Django must write to the very database this worker uses — not whatever its
  # own settings would fall back to.
  def env
    c = ActiveRecord::Base.connection_db_config.configuration_hash
    { "DB_ENGINE" => "mysql", "DB_NAME" => c[:database].to_s, "DB_USER" => c[:username].to_s,
      "DB_PASSWORD" => c[:password].to_s, "DB_HOST" => c[:host].to_s, "DB_PORT" => c[:port].to_s }
  end
end
