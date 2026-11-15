# Pause, or set active again, one catalog inside one ad campaign — by hand from
# the Ads dashboard (Django: meesho_ads.py queues it with a MeeshoAdPause row).
# The ad stops; the product stays live. Today's figures are read again after to
# see what Meesho now shows, which is what the row records.
class MeeshoAdEditJob
  include Sidekiq::Job
  sidekiq_options queue: "critical", retry: false      # never sent twice by itself

  def perform(pause_id)
    pause = MeeshoAdPause.find_by(id: pause_id)
    return unless pause&.status == "QUEUED"
    account = MeeshoAccount.find(pause.account_id)
    MeeshoAdsJob.new.edit(account, pause)
  rescue StandardError => e
    Sidekiq.logger.error("MeeshoAdEditJob #{pause_id}: #{e.class}: #{e.message}")
    pause&.update!(status: "FAILED", message: "Unexpected error (#{e.class.name.demodulize}) — check the campaign on Meesho.", done_at: Time.current)
  end
end
