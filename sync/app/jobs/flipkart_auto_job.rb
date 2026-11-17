# Every minute: Flipkart's automation (Business Settings → Flipkart setup) —
# accept every N minutes, and at each label time accept, print every label
# waiting, keep the PDF, send it to Telegram and mark those orders Ready to
# Dispatch. Whether anything is due is decided (and claimed) in Django
# (manage.py flipkart_auto --run due), so a minute with nothing due is cheap.
class FlipkartAutoJob
  include Sidekiq::Job
  sidekiq_options queue: "default", retry: 0

  def perform
    result = DjangoCommand.run("flipkart_auto", "--run", "due", timeout: 900)
    Rails.logger.info("flipkart_auto: #{result.to_json}")
    result
  end
end
