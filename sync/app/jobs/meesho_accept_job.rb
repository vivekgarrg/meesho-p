# Accept pending orders on the Meesho panel — what "Accept" in the panel's
# Pending tab does: ask Meesho to move the chosen orders from Pending (1) to
# Ready to ship (3). Meesho does it in the background, so the job then follows
# the panel's request history until it reports how many went through.
# Queued by Django (Meesho Orders → Pending → Accept).
class MeeshoAcceptJob
  include Sidekiq::Job
  sidekiq_options queue: "critical", retry: false      # never send an accept twice by itself

  PATH = "/api/fulfillment/orders/reqPendingOrders".freeze
  HISTORY_PATH = "/api/fulfillment/orders/fetchPendingOrdersHistory".freeze
  # Closing a finished request ("POPUP_CLOSED") is what lets Meesho take the
  # next one — the panel does it when its progress popup is closed.
  CLOSE_PATH = "/api/fulfillment/orders/updatePendingOrderStatus".freeze
  CLOSED = "POPUP_CLOSED".freeze
  POLL_SECONDS = 5
  POLL_TIMES = 24                                       # up to two minutes

  # groups: [{ "grouping_key" =>, "sub_order_ids" => [...], "shipment_type" => "forward" }, …]
  def perform(account_id, run_id, groups)
    account = MeeshoAccount.find_by(id: account_id)
    run = MeeshoSyncRun.find_by(id: run_id)
    return unless account && run
    run.start!
    begin
      client = account.cookies.present? ? MeeshoClient.new(account) : MeeshoLoginJob.login!(account)
      # An earlier request left finished but open would block this one.
      begin
        close_finished(client, account, history(client, account))
      rescue MeeshoClient::AuthError
        client = MeeshoLoginJob.login!(account)
        close_finished(client, account, history(client, account))
      end
      started = Time.current
      res = begin
        client.post(PATH, body: self.class.body(account, groups), headers: self.class.headers(account))
      rescue MeeshoClient::AuthError
        client = MeeshoLoginJob.login!(account)
        client.post(PATH, body: self.class.body(account, groups), headers: self.class.headers(account))
      end
      outcome = follow(client, account, started, self.class.request_id(res.body))
      account.cookies = client.cookies
      account.save!
      # Sent and still being worked through by Meesho is not a failure.
      ok = outcome[:done] ? outcome[:failed].to_i.zero? : true
      run.finish!(ok, outcome[:message], records: outcome[:processed] || groups.size)
    rescue MeeshoClient::AuthError, MeeshoClient::RequestError, SecretBox::NotConfigured => e
      run.finish!(false, "Not accepted — #{e.message}")
    rescue StandardError => e
      Sidekiq.logger.error("MeeshoAcceptJob #{account_id}: #{e.class}: #{e.message}")
      run.finish!(false, "Unexpected error (#{e.class.name.demodulize}) — check the Pending tab on the Meesho panel before trying again.")
    ensure
      # The accepted orders now sit in Ready to ship: pull the tabs again.
      MeeshoSyncJob.perform_async(account.id, nil, MeeshoSyncRun::TRIGGER_MANUAL) if account
    end
  end

  def self.body(account, groups)
    { supplier_details: { id: account.supplier_id.to_i, identifier: account.supplier_identifier, name: account.supplier_name },
      identifier: account.supplier_identifier, enable_hold: true, include_all: false,
      current_status: 1, requested_status: 3, max_transitions: 2000, filter: {},
      groups: groups.map { |g| { grouping_key: g["grouping_key"], sub_order_ids: Array(g["sub_order_ids"]), shipment_type: g["shipment_type"] || "forward" } },
      child_supplier_identifier: nil, child_supplier_id: nil }
  end

  def self.headers(account)
    { "identifier" => account.supplier_identifier, "client-package-version" => "1.0.4", "content-type" => "application/json",
      "referer" => "https://supplier.meesho.com/panel/v3/new/fulfillment/#{account.supplier_identifier}/orders/pending" }
  end

  def self.request_id(body)
    return nil unless body.is_a?(Hash)
    body["request_id"] || body.dig("data", "request_id") || (body["data"].is_a?(Array) && body["data"].first.is_a?(Hash) ? body["data"].first["request_id"] : nil)
  end

  private

  # Read the panel's request history until Meesho says it has finished ours.
  def follow(client, account, started, request_id)
    last = nil
    POLL_TIMES.times do |i|
      sleep(POLL_SECONDS) unless i.zero? || self.class.no_wait?
      res = history(client, account)
      entries = res.body.is_a?(Hash) ? Array(res.body["data"]).select { |e| e.is_a?(Hash) } : []
      mine = entries.find { |e| request_id && e["request_id"] == request_id } ||
             entries.find { |e| e["requested_at_msg"].to_i >= (started.to_f * 1000).to_i - 60_000 }
      last = mine if mine
      if mine && mine["progress_percent"].to_i >= 100
        close(client, account, mine)
        processed, failed = mine["processed_orders_count"].to_i, mine["failed_orders_count"].to_i
        msg = "Accepted #{processed - failed} of #{processed} order#{processed == 1 ? "" : "s"} on Meesho" +
              (failed.positive? ? " — #{failed} failed; check them on the Meesho panel." : ".")
        return { done: true, processed: processed, failed: failed, message: msg }
      end
      break if res.body.is_a?(Hash) && res.body["is_polling"] == false && mine.nil? && i >= 2
    end
    pct = last ? last["progress_percent"].to_i : nil
    { done: false, processed: nil, failed: nil,
      message: "Sent to Meesho#{pct ? " (#{pct}% done when last checked)" : ""} — it is still working through them; the tabs refresh on the next pull." }
  end

  def history(client, account)
    client.post(HISTORY_PATH, body: { supplier_id: account.supplier_id.to_i, identifier: account.supplier_identifier,
                                      child_supplier_identifier: nil, child_supplier_id: nil },
                headers: self.class.headers(account))
  end

  def close_finished(client, account, res)
    entries = res.body.is_a?(Hash) ? Array(res.body["data"]).select { |e| e.is_a?(Hash) } : []
    entries.each { |e| close(client, account, e) if e["progress_percent"].to_i >= 100 }
  end

  # Mark one finished request closed, as closing the panel's popup does.
  def close(client, account, entry)
    return if entry["request_id"].blank? || entry["status"] == CLOSED
    client.post(CLOSE_PATH, body: { supplier_id: account.supplier_id.to_i, identifier: account.supplier_identifier,
                                    request_id: entry["request_id"], status: CLOSED,
                                    child_supplier_identifier: nil, child_supplier_id: nil },
                headers: self.class.headers(account))
    entry["status"] = CLOSED
  end

  # Tests run without the five-second waits.
  def self.no_wait?
    Rails.env.test?
  end
end
