# Every 10 minutes: read each connected Flipkart Seller Hub account's dashboard,
# which also keeps its session alive (Seller Hub needs an OTP for every login, so
# a lapsed session can't be renewed here — the account shows "expired" until
# someone logs in again). The work lives in Django (manage.py flipkart_refresh).
class FlipkartRefreshJob
  include Sidekiq::Job
  sidekiq_options queue: "default", retry: 0

  def perform
    result = DjangoCommand.run("flipkart_refresh", timeout: 300)
    Rails.logger.info("flipkart_refresh: #{result.to_json}")
    result
  end
end
