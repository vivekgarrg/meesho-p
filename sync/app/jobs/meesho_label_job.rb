# Generate shipping labels on the Meesho panel for chosen Ready-to-ship orders
# — what "Download label" in the panel does: request them (reqDownloadLabelV2),
# then follow the panel's label history until Meesho has made the PDF and
# hands back its link. The link is kept on the run; Django downloads it and
# sorts the pages by parent SKU, as the Labels tab does.
# Queued by Django (Meesho Orders → Ready to ship → Generate labels).
class MeeshoLabelJob
  include Sidekiq::Job
  sidekiq_options queue: "critical", retry: false

  PATH = "/api/fulfillment/orders/reqDownloadLabelV2".freeze
  HISTORY_PATH = "/api/fulfillment/orders/fetchLabelDownloadHistory".freeze
  # Telling Meesho the labels were downloaded is what lets it take the next
  # label request — the panel calls it once the PDF has been downloaded.
  DOWNLOADED_PATH = "/api/fulfillment/orders/updateGroupDownloadBackendFlag".freeze
  POLL_SECONDS = 10
  POLL_TIMES = 30                                      # up to five minutes

  def perform(account_id, run_id, groups)
    account = MeeshoAccount.find_by(id: account_id)
    run = MeeshoSyncRun.find_by(id: run_id)
    return unless account && run
    run.start!
    begin
      client = account.cookies.present? ? MeeshoClient.new(account) : MeeshoLoginJob.login!(account)
      before = begin
        ids(history(client, account))
      rescue MeeshoClient::AuthError
        client = MeeshoLoginJob.login!(account)
        ids(history(client, account))
      end
      res = client.post(PATH, body: self.class.body(account, groups), headers: self.class.headers(account))
      outcome = follow(client, account, before, MeeshoAcceptJob.request_id(res.body))
      account.cookies = client.cookies
      account.save!
      # Kept alongside what Django put there (the batch several businesses' runs share).
      run.update!(result: (run.result || {}).merge(outcome[:result])) if outcome[:result]
      run.finish!(outcome[:ok], outcome[:message], records: outcome.dig(:result, "success") || groups.sum { |g| Array(g["sub_order_ids"]).size })
    rescue MeeshoClient::AuthError, MeeshoClient::RequestError, SecretBox::NotConfigured => e
      run.finish!(false, "Labels not generated — #{e.message}")
    rescue StandardError => e
      Sidekiq.logger.error("MeeshoLabelJob #{account_id}: #{e.class}: #{e.message}")
      run.finish!(false, "Unexpected error (#{e.class.name.demodulize}) — check Ready to ship on the Meesho panel.")
    ensure
      # Their label status has changed: pull the tabs again.
      MeeshoSyncJob.perform_async(account.id, nil, MeeshoSyncRun::TRIGGER_MANUAL) if account
    end
  end

  def self.body(account, groups)
    { supplier_details: { id: account.supplier_id.to_i, identifier: account.supplier_identifier, name: account.supplier_name },
      identifier: account.supplier_identifier, enable_hold: true, include_all: false,
      current_status: 1, requested_status: 101, max_transitions: 2000, filter: {},
      groups: groups.map { |g| { grouping_key: g["grouping_key"], sub_order_ids: Array(g["sub_order_ids"]), shipment_type: g["shipment_type"] || "forward" } },
      child_supplier_identifier: nil, child_supplier_id: nil }
  end

  def self.headers(account)
    { "identifier" => account.supplier_identifier, "client-package-version" => "1.0.4", "content-type" => "application/json",
      "referer" => "https://supplier.meesho.com/panel/v3/new/fulfillment/#{account.supplier_identifier}/orders/ready-to-ship" }
  end

  def self.no_wait?
    Rails.env.test?
  end

  private

  def history(client, account)
    client.post(HISTORY_PATH, body: { supplier_id: account.supplier_id.to_i, identifier: account.supplier_identifier,
                                      child_supplier_identifier: nil, child_supplier_id: nil },
                headers: self.class.headers(account))
  end

  # The link is in hand (it stays valid for days), so the request is marked
  # downloaded now — otherwise Meesho holds back the next one. A failure here
  # doesn't lose the labels; it is reported on the run.
  def mark_downloaded(client, account, request_id)
    return false if request_id.blank?
    client.post(DOWNLOADED_PATH, body: { supplier_id: account.supplier_id.to_i, identifier: account.supplier_identifier,
                                         request_id: request_id, child_supplier_identifier: nil, child_supplier_id: nil },
                headers: self.class.headers(account))
    true
  rescue MeeshoClient::AuthError, MeeshoClient::RequestError => e
    Sidekiq.logger.warn("MeeshoLabelJob #{account.id}: marking #{request_id} downloaded failed: #{e.message}")
    false
  end

  def entries(res)
    res.body.is_a?(Hash) ? Array(res.body["data"]).select { |e| e.is_a?(Hash) } : []
  end

  def ids(res)
    entries(res).map { |e| e["request_id"] }.compact.to_set
  end

  # Follow the label history until our request has its PDF. Ours is the one
  # with the id Meesho answered with, else the one that wasn't there before.
  def follow(client, account, before, request_id)
    last = nil
    POLL_TIMES.times do |i|
      sleep(POLL_SECONDS) unless i.zero? || self.class.no_wait?
      list = entries(history(client, account))
      mine = list.find { |e| request_id && e["request_id"] == request_id } ||
             list.find { |e| e["request_id"].present? && !before.include?(e["request_id"]) }
      next unless mine
      last = mine
      status = mine["status"].to_s.upcase
      if status.include?("FAIL")
        return { ok: false, message: "Meesho couldn't make the labels: #{mine["status_message"].presence || status}." }
      end
      next unless mine["label_url"].present? && mine["progress_percent"].to_i >= 100
      success, total = mine["success_suborder_count"].to_i, mine["total_suborder_count"].to_i
      flagged = mark_downloaded(client, account, mine["request_id"])
      result = { "label_url" => mine["label_url"], "success" => success, "total" => total, "request_id" => mine["request_id"],
                 "flagged" => flagged }
      msg = "Labels ready — #{success} of #{total} order#{total == 1 ? "" : "s"}." +
            (success < total ? " #{total - success} could not be labelled; check them on the Meesho panel." : "") +
            (flagged ? "" : " Meesho wasn't told they were downloaded — if the next label request is refused, download these once on the panel.")
      return { ok: success.positive?, message: msg, result: result }
    end
    pct = last ? last["progress_percent"].to_i : nil
    { ok: false, message: "Meesho hasn't finished the labels#{pct ? " (#{pct}% when last checked)" : ""} — open Ready to ship on the Meesho panel to download them." }
  end
end
