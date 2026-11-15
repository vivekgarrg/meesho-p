# Meesho Ads for one account, every INTERVAL minutes (Meesho → Settings → Sync
# schedule, "ads_every"): the panel's Advertisement page read into the ads
# tables (Django: MeeshoAdCampaign, MeeshoAdCatalog, MeeshoAdCatalogDay,
# MeeshoAdDay), then the auto-pause rule.
#
# Each run:
#   1. the campaign list — the first page every run (new campaigns come first),
#      every page once an hour or on Refresh — lifetime figures per campaign;
#   2. the account's figures for today and yesterday, and a few days further
#      back not read yet (BACKFILL_DAYS);
#   3. each live campaign's catalogs for today (status in the campaign, spend,
#      orders…), and their lifetime figures every DETAILS_EVERY; past days of a
#      live campaign a few at a time; a campaign that has ended, once after it
#      ended;
#   4. the auto-pause (MeeshoAutoSetting.ads_auto_pause, off by default): a
#      catalog ACTIVE in a LIVE campaign whose spend TODAY (IST, read in this
#      run) is over ads_pause_spend with at most ads_pause_orders orders today
#      is paused in that campaign (edit-catalogs PAUSED). Then today's figures
#      are read again to see it paused — every pause is logged (MeeshoAdPause)
#      with the figures it went by. A catalog someone set active again by hand
#      today is left alone for the rest of the day. At most MAX_PAUSES a run.
class MeeshoAdsJob
  include Sidekiq::Job
  sidekiq_options queue: "default", retry: false

  INTERVAL = 5                       # minutes between scheduled reads
  STAGGER = 20                       # seconds between accounts
  FULL_EVERY = 60.minutes            # every page of the campaign list
  DETAILS_EVERY = 30.minutes         # a live campaign's catalogs' lifetime figures
  BACKFILL_DAYS = 30                 # how far back days are filled in
  BACKFILL_PER_RUN = 5
  ENDED_PER_RUN = 10                 # ended campaigns read once, this many a run
  SETTLE = 2.hours                   # a day's figures are taken as final this long after it ended
  MAX_PAUSES = 25
  GAP = 1.0                          # seconds between calls (bot protection)
  LOCK_TTL = 15 * 60
  IST = "Asia/Kolkata".freeze

  def perform(account_id, run_id = nil, trigger = MeeshoSyncRun::TRIGGER_MANUAL)
    account = MeeshoAccount.find_by(id: account_id)
    return unless account
    run = run_id && MeeshoSyncRun.find_by(id: run_id)
    run ||= account.runs.create!(kind: MeeshoSyncRun::KIND_ADS, trigger: trigger, status: "QUEUED", queued_at: Time.current)
    unless lock(account)
      return run.finish!(true, "Skipped — another ads read of this account is running.")
    end
    run.start!
    begin
      @client = account.cookies.present? ? MeeshoClient.new(account) : MeeshoLoginJob.login!(account)
      @now = Time.current
      @today = @now.in_time_zone(IST).to_date
      @calls = 0
      stats = { "campaigns" => read_campaigns(account, full: trigger == MeeshoSyncRun::TRIGGER_MANUAL || full_due?(account)) }
      stats["days"] = read_days(account)
      today_rows = read_live(account)
      stats["live"] = today_rows.size
      stats["ended"] = read_ended(account)
      stats["paused"] = auto_pause(account, today_rows)
      account.cookies = @client.cookies
      account.save!
      msg = "Ads: #{stats['campaigns']} campaigns read, #{stats['live']} live"
      msg += ", #{stats['paused'].size} catalog#{'s' unless stats['paused'].size == 1} paused by the ₹ rule" if stats["paused"].any?
      run.update!(result: (run.result || {}).merge(stats.merge("calls" => @calls, "listed" => @listed)))
      run.finish!(true, "#{msg}.", records: stats["campaigns"])
    rescue MeeshoClient::AuthError, MeeshoClient::RequestError, SecretBox::NotConfigured => e
      run.finish!(false, "Stopped — #{e.message}")
    rescue StandardError => e
      Sidekiq.logger.error("MeeshoAdsJob #{account_id}: #{e.class}: #{e.message}\n#{e.backtrace&.first(5)&.join("\n")}")
      run.finish!(false, "Unexpected error (#{e.class.name.demodulize}) reading Meesho Ads.")
    ensure
      unlock(account)
    end
  end

  # By hand (MeeshoAdEditJob): one catalog in one campaign to PAUSED / ACTIVE, then read again to see it.
  def edit(account, pause)
    @client = account.cookies.present? ? MeeshoClient.new(account) : MeeshoLoginJob.login!(account)
    @now = Time.current
    @today = @now.in_time_zone(IST).to_date
    @calls = 0
    want = pause.action == "RESUME" ? "ACTIVE" : "PAUSED"
    begin
      call(account) { MeeshoAds.edit_catalog(@client, account, pause.campaign_id, pause.catalog_id, want) }
    rescue MeeshoClient::RequestError, MeeshoClient::AuthError => e
      return pause.update!(status: "FAILED", message: e.message.truncate(500), done_at: Time.current)
    end
    confirm(account, pause.campaign_id, [pause], want)
    account.cookies = @client.cookies
    account.save!
  end

  private

  # ── 1. campaigns ────────────────────────────────────────────────────────
  def full_due?(account)
    oldest = MeeshoAdCampaign.where(account_id: account.id).minimum(:read_at)
    oldest.nil? || oldest < @now - FULL_EVERY
  end

  # A page can come back short before the end (Meesho filters some out), so a full read goes on until a
  # page is empty or brings nothing new — never past the pages Meesho's total needs, plus a few.
  def read_campaigns(account, full:)
    ids = {}
    total = 0
    MeeshoAds::MAX_PAGES.times do |i|
      list, total = call(account) { MeeshoAds.campaigns(@client, account, i + 1) }
      fresh = list.reject { |c| ids.key?(c["campaign_id"].to_i) }
      fresh.each { |c| save_campaign(account, c); ids[c["campaign_id"].to_i] = true }
      break unless full && fresh.any? && i + 1 < (total / MeeshoAds::PAGE_SIZE.to_f).ceil + 3
    end
    @listed = [ids.size, total]
    ids.size
  end

  def save_campaign(account, c)
    row = MeeshoAdCampaign.find_or_initialize_by(account_id: account.id, campaign_id: c["campaign_id"].to_i)
    row.assign_attributes(
      name: c["campaign_name"].to_s.truncate(255, omission: ""), status: c["status"].to_s, reason: c["reason"].to_s,
      campaign_type: c["campaign_type"].to_s, budget_type: c["budget_type"].to_s,
      bid_type: (c["derived_bid_type"] || c["bid_type"]).to_s, total_budget: c["total_budget"],
      start_at: c["start_date"], end_at: c["end_date"], catalog_count: c["catalog_count"].to_i,
      lead_catalog_id: c["catalog_id"], image: Array(c["images512"]).first.to_s.truncate(500, omission: ""),
      feedback_state: c.dig("roi_bidding_feedback_details", "campaign_feedback_state").to_s, read_at: @now,
      **MeeshoAds.figures(c["perf_details"]),
    )
    row.save!
  end

  # ── 2. the account's days ───────────────────────────────────────────────
  def read_days(account)
    have = MeeshoAdDay.where(account_id: account.id, date: (@today - BACKFILL_DAYS)..@today).pluck(:date, :read_at).to_h
    want = [@today]
    want << @today - 1 unless final?(@today - 1, have[@today - 1])
    want += ((@today - BACKFILL_DAYS)..(@today - 2)).reject { |d| have.key?(d) }.first(BACKFILL_PER_RUN)
    want.each do |day|
      data = call(account) { MeeshoAds.overall(@client, account, day, day) }
      row = MeeshoAdDay.find_or_initialize_by(account_id: account.id, date: day)
      row.assign_attributes(read_at: @now, **MeeshoAds.overall_figures(data))
      row.save!
    end
    want.size
  end

  # Read after the day ended + SETTLE: its figures won't move any more.
  def final?(day, read_at)
    read_at.present? && read_at >= day.in_time_zone(IST).end_of_day + SETTLE
  end

  # ── 3. live campaigns' catalogs ─────────────────────────────────────────
  # { campaign_id => [the catalogs of today's read] } for every live campaign.
  def read_live(account)
    out = {}
    MeeshoAdCampaign.where(account_id: account.id, status: "LIVE").find_each do |camp|
      data = call(account) { MeeshoAds.details(@client, account, camp.campaign_id, @today) }
      next unless data["applied_date_window"].to_s == "EXPLICIT"    # not today's alone: never decided on
      out[camp.campaign_id] = save_day(account, camp, data, @today)
      camp.update!(bid: data["bid"]) if data["bid"]
      if camp.details_read_at.nil? || camp.details_read_at < @now - DETAILS_EVERY
        save_lifetime(account, camp, call(account) { MeeshoAds.details(@client, account, camp.campaign_id) })
      end
      backfill(account, camp)
    end
    out
  end

  def save_day(account, camp, data, day)
    Array(data["catalogs"]).select { |c| c.is_a?(Hash) && c["catalog_id"] }.map do |c|
      f = MeeshoAds.figures(c["perf_details"])
      row = MeeshoAdCatalogDay.find_or_initialize_by(account_id: account.id, campaign_id: camp.campaign_id,
                                                     catalog_id: c["catalog_id"].to_i, date: day)
      row.assign_attributes(read_at: @now, **f)
      row.save!
      ad = catalog_row(account, camp, c)
      ad.save!
      { "catalog_id" => c["catalog_id"].to_i, "name" => c["catalog_name"].to_s, "status" => c["catalog_status"].to_s, **f.stringify_keys }
    end
  end

  def save_lifetime(account, camp, data)
    Array(data["catalogs"]).select { |c| c.is_a?(Hash) && c["catalog_id"] }.each do |c|
      row = catalog_row(account, camp, c)
      row.assign_attributes(MeeshoAds.figures(c["perf_details"]))
      row.save!
    end
    camp.update!(details_read_at: @now)
  end

  def catalog_row(account, camp, c)
    row = MeeshoAdCatalog.find_or_initialize_by(account_id: account.id, campaign_id: camp.campaign_id, catalog_id: c["catalog_id"].to_i)
    row.assign_attributes(
      name: c["catalog_name"].to_s.truncate(255, omission: ""), category: Array(c["category"]).join(", ").truncate(255, omission: ""),
      image: Array(c["images512"]).first.to_s.truncate(500, omission: ""), status: c["catalog_status"].to_s,
      status_reason: c["catalog_status_reason"].to_s, bid: c["bid"], read_at: @now,
    )
    row
  end

  # A live campaign's past days, a few a run, until every day since it started is read after it ended.
  def backfill(account, camp)
    start = [camp.start_at&.in_time_zone(IST)&.to_date || @today, @today - BACKFILL_DAYS].max
    from = camp.days_read_through ? camp.days_read_through + 1 : start
    days = (from..(@today - 1)).first(BACKFILL_PER_RUN)
    days.each do |day|
      save_day(account, camp, call(account) { MeeshoAds.details(@client, account, camp.campaign_id, day) }, day)
      camp.update!(days_read_through: day) if @now >= day.in_time_zone(IST).end_of_day + SETTLE
    end
  end

  # A campaign no longer live: its catalogs' lifetime figures once, after it ended.
  def read_ended(account)
    todo = MeeshoAdCampaign.where(account_id: account.id).where.not(status: "LIVE").order(start_at: :desc).select do |c|
      c.details_read_at.nil? || (c.end_at && c.details_read_at < c.end_at)
    end.first(ENDED_PER_RUN)
    todo.each { |camp| save_lifetime(account, camp, call(account) { MeeshoAds.details(@client, account, camp.campaign_id) }) }
    todo.size
  end

  # ── 4. the auto-pause ───────────────────────────────────────────────────
  def auto_pause(account, today_rows)
    setting = MeeshoAutoSetting.current
    return [] unless setting.respond_to?(:ads_auto_pause) && setting&.ads_auto_pause
    limit = setting.ads_pause_spend.to_d
    max_orders = setting.ads_pause_orders.to_i
    return [] unless limit.positive?
    done = []
    today_rows.each do |campaign_id, catalogs|
      due = catalogs.select { |c| c["status"] == "ACTIVE" && c["spend"].to_d > limit && c["orders"].to_i <= max_orders }
      due.reject! { |c| resumed_today?(account, campaign_id, c["catalog_id"]) }
      due = due.first(MAX_PAUSES - done.size)
      next if due.empty?
      pauses = due.map do |c|
        p = MeeshoAdPause.create!(account_id: account.id, campaign_id: campaign_id, catalog_id: c["catalog_id"], catalog_name: c["name"].truncate(255),
                                  action: "PAUSE", trigger: "AUTO", status: "QUEUED", date: @today, spend: c["spend"], orders: c["orders"],
                                  limit: limit, message: "₹#{c['spend'].to_d.to_s('F')} spent today, #{c['orders']} orders (limit ₹#{limit.to_s('F')})")
        begin
          sleep GAP unless Rails.env.test?
          call(account) { MeeshoAds.edit_catalog(@client, account, campaign_id, c["catalog_id"], "PAUSED") }
        rescue MeeshoClient::RequestError => e
          p.update!(status: "FAILED", message: "#{p.message} — #{e.message}".truncate(500), done_at: Time.current)
        end
        p
      end
      confirm(account, campaign_id, pauses.reject { |p| p.status == "FAILED" }, "PAUSED")
      done.concat(pauses.select { |p| p.reload.status == "PAUSED" }.map(&:catalog_id))
      break if done.size >= MAX_PAUSES
    end
    done
  end

  def resumed_today?(account, campaign_id, catalog_id)
    MeeshoAdPause.where(account_id: account.id, campaign_id: campaign_id, catalog_id: catalog_id, date: @today,
                        action: "RESUME", status: "RESUMED").exists?
  end

  # Read the campaign again and record what Meesho now shows for each.
  def confirm(account, campaign_id, pauses, want)
    return if pauses.empty?
    camp = MeeshoAdCampaign.find_by(account_id: account.id, campaign_id: campaign_id)
    data = call(account) { MeeshoAds.details(@client, account, campaign_id, @today) }
    now = Array(data["catalogs"]).to_h { |c| [c["catalog_id"].to_i, c["catalog_status"].to_s] }
    save_day(account, camp, data, @today) if camp
    pauses.each do |p|
      ok = now[p.catalog_id] == want
      p.update!(status: ok ? (want == "PAUSED" ? "PAUSED" : "RESUMED") : "FAILED", done_at: Time.current,
                message: ok ? p.message : "#{p.message} — Meesho took it but still shows it #{now[p.catalog_id].presence || 'missing'}".truncate(500))
    end
  end

  # ── shared ──────────────────────────────────────────────────────────────
  # Log in again once if the session lapsed; wait out "too many requests" once.
  def call(account)
    @calls += 1
    sleep GAP if @calls > 1 && !Rails.env.test?
    relogged = waited = false
    begin
      yield
    rescue MeeshoClient::AuthError
      raise if relogged
      relogged = true
      @client = MeeshoLoginJob.login!(account)
      retry
    rescue MeeshoClient::RequestError => e
      raise unless e.message.include?("HTTP 429") && !waited
      waited = true
      sleep 20 unless Rails.env.test?
      retry
    end
  end

  def lock(account)
    Sidekiq.redis { |r| r.call("SET", lock_key(account), jid.to_s, "NX", "EX", LOCK_TTL) } == "OK"
  end

  def unlock(account)
    Sidekiq.redis { |r| r.call("DEL", lock_key(account)) }
  end

  def lock_key(account)
    "meesho_ads:lock:#{account.id}"
  end
end
