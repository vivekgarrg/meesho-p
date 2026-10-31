# Log a Meesho account in and keep its session cookies (queued by Django when
# an admin connects the account, and by MeeshoSyncJob when a session lapses).
class MeeshoLoginJob
  include Sidekiq::Job
  sidekiq_options queue: "critical", retry: 2

  SUPPLIER_ID_KEYS = %w[supplier_id supplierId].freeze
  SUPPLIER_NAME_KEYS = %w[supplier_name supplierName business_name businessName name].freeze
  # The short code in panel URLs ("xzvey") — the data APIs' "identifier".
  SUPPLIER_CODE_KEYS = %w[supplier_identifier supplierIdentifier supplier_tag supplierTag].freeze
  PASTE_HINT = "Paste a new session from your browser on the Meesho Sync page.".freeze

  def perform(account_id, run_id = nil)
    account = MeeshoAccount.find_by(id: account_id)
    return unless account && account.status != MeeshoAccount::STATUS_DISABLED && account.password_enc.present?
    run = run_id && MeeshoSyncRun.find_by(id: run_id)
    run ||= account.runs.create!(kind: MeeshoSyncRun::KIND_LOGIN, trigger: MeeshoSyncRun::TRIGGER_SCHEDULE,
                                 status: "QUEUED", queued_at: Time.current)
    run.start!
    self.class.login!(account)
    run.finish!(true, "Logged in#{" as #{account.supplier_name}" if account.supplier_name.present?}.")
    # A fresh login pulls straight away rather than waiting for the schedule.
    MeeshoSyncJob.perform_async(account.id, nil, MeeshoSyncRun::TRIGGER_MANUAL)
  rescue MeeshoClient::AuthError, MeeshoClient::RequestError, SecretBox::NotConfigured => e
    account&.update!(status: MeeshoAccount::STATUS_FAILED, status_message: e.message)
    run&.finish!(false, e.message)
  end

  # Log in and store the session on the account; raises on failure.
  def self.login!(account)
    # Connected with a session pasted from a browser and no password: there is
    # nothing to log in with, so the admin pastes a fresh one.
    if account.password_enc.blank?
      message = "The Meesho session has expired. #{PASTE_HINT}"
      account.update!(status: MeeshoAccount::STATUS_FAILED, status_message: message, cookies_enc: "")
      raise MeeshoClient::AuthError, message
    end
    ensure_device_ids(account)
    account.update!(status: MeeshoAccount::STATUS_LOGGING_IN, status_message: "Logging in…")
    client = MeeshoClient.new(account, cookies: {})
    begin
      res = client.login(account.password)
    rescue MeeshoClient::AuthError => e
      # Usually Meesho's bot protection refusing the server; a session from
      # the admin's own browser gets round it.
      message = e.message.include?("bot protection") ? "#{e.message}. #{PASTE_HINT}" : e.message
      account.update!(status: MeeshoAccount::STATUS_FAILED, status_message: message, cookies_enc: "")
      raise MeeshoClient::AuthError, message
    rescue MeeshoClient::RequestError, SecretBox::NotConfigured => e
      account.update!(status: MeeshoAccount::STATUS_FAILED, status_message: e.message, cookies_enc: "")
      raise
    end
    account.cookies = client.cookies
    jar = client.cookies
    # The panel also sets the supplier's id and code as cookies — used when the
    # login body doesn't carry them. A code an admin typed in is kept.
    id = find_value(res.body, SUPPLIER_ID_KEYS).presence || jar["s_id"]
    code = find_value(res.body, SUPPLIER_CODE_KEYS).presence || jar["current_az_identifier"]
    name = find_value(res.body, SUPPLIER_NAME_KEYS)
    account.assign_attributes(
      status: MeeshoAccount::STATUS_ACTIVE, status_message: "Logged in.", last_login_at: Time.current,
      supplier_id: (id.presence || account.supplier_id).to_s.truncate(64, omission: ""),
      supplier_name: (name.presence || account.supplier_name).to_s.truncate(255, omission: ""),
      supplier_identifier: (account.supplier_identifier.presence || code).to_s.truncate(64, omission: ""),
    )
    account.save!
    client
  end

  ID_ALPHABET = [*"A".."Z", *"a".."z", *"0".."9"].freeze

  # The panel's login needs an "instance" and a "browser-id", as a browser
  # sends — without them Meesho answers 400 Bad Request. An account that has
  # none gets its own pair, made once and kept, like one browser would.
  def self.ensure_device_ids(account)
    return if account.instance.present? && account.browser_id.present?
    account.instance = Array.new(21) { ID_ALPHABET.sample(random: SecureRandom) }.join if account.instance.blank?
    account.browser_id = Base64.strict_encode64(SecureRandom.alphanumeric(18).downcase) if account.browser_id.blank?
    account.save!
  end

  # The first value under any of `keys`, searched a few levels into the body.
  def self.find_value(node, keys, depth = 0)
    return nil if depth > 4
    case node
    when Hash
      keys.each { |k| v = node[k]; return v if v.is_a?(String) || v.is_a?(Numeric) }
      node.each_value { |v| (found = find_value(v, keys, depth + 1)) && (return found) }
    when Array
      node.first(5).each { |v| (found = find_value(v, keys, depth + 1)) && (return found) }
    end
    nil
  end
end
