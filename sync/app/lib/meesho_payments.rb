# The panel's Payments page (Payouts → Payments): the day-by-day summaries,
# and the payment file the panel's Download makes — requested, waited for in
# the download history, then fetched from Meesho's storage. The file is the one
# the Payments upload reads, so importing it is left to Django's own importer
# (management command import_meesho_payments), run here as a subprocess.
module MeeshoPayments
  BASE = "/api/payouts/payments/".freeze
  FILE_TYPE = "SP_ORDER_ADS_REFERRAL_PAYMENT_FILE".freeze
  # Meesho's names: COMPLETED = previous payments, PENDING = outstanding ones.
  STATUS = { "completed" => "COMPLETED", "outstanding" => "PENDING" }.freeze
  FILE_HOSTS = %w[storage.googleapis.com].freeze
  MAX_FILE = 60 * 1024 * 1024
  IST = "Asia/Kolkata".freeze

  # Django's importer failed on a file.
  class ImportError < StandardError; end

  module_function

  def headers(account)
    { "identifier" => account.supplier_identifier, "client-package-version" => "1.0.1",
      "referer" => "#{MeeshoClient::BASE}/panel/v3/new/payouts/#{account.supplier_identifier}/payments" }
  end

  def ids(account)
    { identifier: account.supplier_identifier, supplier_id: account.supplier_id.to_i }
  end

  # Paid and upcoming payouts, day by day, and their totals — as the page shows them.
  def summary(client, account, paid_days:, upcoming_days:)
    get = ->(path, limit) { client.post("#{BASE}#{path}", body: ids(account).merge(limit: limit), headers: headers(account)).body }
    {
      "previous" => get.("previous-payments", paid_days), "upcoming" => get.("upcoming-payments", upcoming_days),
      "previous_total" => get.("previous-total-amount", paid_days), "upcoming_total" => get.("upcoming-total-amount", upcoming_days),
    }
  end

  # Ask for the payment file of `kind` covering from..to (IST days). Returns its job id.
  def request_file(client, account, kind, from, to)
    zone = ActiveSupport::TimeZone[IST]
    stamp = ->(t) { t.utc.strftime("%Y-%m-%dT%H:%M:%S.000Z") }
    body = { supplier_identifier: account.supplier_identifier, supplier_id: account.supplier_id.to_i, isPollingV2Enabled: true,
             data: [{ payment_status: STATUS.fetch(kind), file_type: FILE_TYPE,
                      start_date: stamp.(zone.local(from.year, from.month, from.day)),
                      end_date: stamp.(zone.local(to.year, to.month, to.day, 23, 59, 59)) }] }
    res = client.post("#{BASE}v2/payments-excel/create", body: body, headers: headers(account)).body
    job = Array(res).find { |j| j.is_a?(Hash) && j["jobId"].present? }
    raise MeeshoClient::RequestError, "Meesho didn't start the #{kind} payment file" unless job
    job["jobId"]
  end

  # The panel's download history: { job id => entry }.
  def history(client, account)
    body = { supplier_identifier: account.supplier_identifier, supplier_id: account.supplier_id.to_i, isPollingV2Enabled: true }
    Array(client.post("#{BASE}payments-excel/history", body: body, headers: headers(account)).body)
      .select { |j| j.is_a?(Hash) && j["jobId"] }.index_by { |j| j["jobId"] }
  end

  # Fetch a ready file to `dir`. Only from Meesho's storage, and never huge.
  def download(url, dir)
    uri = URI(url)
    unless uri.scheme == "https" && FILE_HOSTS.include?(uri.host)
      raise MeeshoClient::RequestError, "payment file link points somewhere unexpected (#{uri.host})"
    end
    res = Net::HTTP.start(uri.host, uri.port, use_ssl: true, open_timeout: 30, read_timeout: 120) { |h| h.get(uri.request_uri) }
    raise MeeshoClient::RequestError, "payment file download failed (HTTP #{res.code})" unless res.is_a?(Net::HTTPSuccess)
    raise MeeshoClient::RequestError, "payment file is too large" if res.body.bytesize > MAX_FILE
    FileUtils.mkdir_p(dir)
    path = File.join(dir, "#{SecureRandom.hex(8)}-#{File.basename(uri.path)}")
    File.binwrite(path, res.body)
    path
  end

  # Run Django's importer on downloaded files (one import); returns its counts.
  def import(business_id, paths, kind)
    DjangoCommand.run("import_meesho_payments", "--business", business_id, "--kind", kind,
                      *Array(paths).flat_map { |p| ["--file", p] })
  rescue DjangoCommand::Failed => e
    raise ImportError, "importing the #{kind} payments failed: #{e.message}"
  end
end
