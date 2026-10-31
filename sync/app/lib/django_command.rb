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

  # The Python that runs the Django app: MEESHO_DJANGO_PYTHON, else the first
  # candidate that can import Django — the app's virtualenv on the server; on a
  # development machine, whichever python3 has Django installed (the worker's
  # PATH may not find the same one a terminal does). Found once per process.
  CANDIDATES = [".venv/bin/python", "venv/bin/python"].map { |p| File.join(BACKEND, p) } +
               %w[python3 /Library/Frameworks/Python.framework/Versions/Current/bin/python3
                  /opt/homebrew/bin/python3 /usr/local/bin/python3 /usr/bin/python3]

  def python
    return ENV["MEESHO_DJANGO_PYTHON"] if ENV["MEESHO_DJANGO_PYTHON"].present?
    @python ||= CANDIDATES.find { |p| has_django?(p) } ||
                raise(Failed, "no Python with Django found — set MEESHO_DJANGO_PYTHON to the app's python")
  end

  def has_django?(python)
    return false if python.include?("/") && !File.executable?(python)
    _out, _err, st = Open3.capture3(python, "-c", "import django", chdir: BACKEND)
    st.success?
  rescue SystemCallError
    false
  end

  # Django must write to the very database this worker uses — not whatever its
  # own settings would fall back to.
  def env
    c = ActiveRecord::Base.connection_db_config.configuration_hash
    { "DB_ENGINE" => "mysql", "DB_NAME" => c[:database].to_s, "DB_USER" => c[:username].to_s,
      "DB_PASSWORD" => c[:password].to_s, "DB_HOST" => c[:host].to_s, "DB_PORT" => c[:port].to_s }
  end
end
