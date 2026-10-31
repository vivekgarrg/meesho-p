# Pause ("archive") SKUs on the Meesho panel — what Pause on the panel's
# Inventory page does. Queued by Django (Meesho Inventory → Pause), with the
# chosen SKUs already grouped by catalog: Meesho takes one catalog per
# request, with any number of its SKUs, so pausing a whole parent is one
# request per catalog it's listed in.
#
# The requests go one after another, a moment apart — a burst of them in
# parallel is what the panel's bot protection is there to stop, and one
# refused catalog shouldn't stop the rest. Each catalog's outcome is kept on
# the run (result["failed"]), and the inventory is read again afterwards.
class MeeshoArchiveJob
  include Sidekiq::Job
  sidekiq_options queue: "critical", retry: false      # never pause twice by itself

  GAP = 0.3

  # items: [{ "catalog_id" => 606662647, "products" => [{ "product_id" => 1139807680, "variation_id" => 167 }, …] }, …]
  def perform(account_id, run_id, items)
    account = MeeshoAccount.find_by(id: account_id)
    run = MeeshoSyncRun.find_by(id: run_id)
    return unless account && run
    run.start!
    done = 0
    skus = 0
    failed = []
    begin
      client = account.cookies.present? ? MeeshoClient.new(account) : MeeshoLoginJob.login!(account)
      Array(items).each_with_index do |item, i|
        sleep GAP if i.positive?
        products = Array(item["products"]).map { |p| { product_id: p["product_id"], variation_id: p["variation_id"] } }
        begin
          begin
            MeeshoInventory.archive(client, account, item["catalog_id"], products)
          rescue MeeshoClient::AuthError
            client = MeeshoLoginJob.login!(account)
            MeeshoInventory.archive(client, account, item["catalog_id"], products)
          end
          mark_paused(account, products)
          done += 1
          skus += products.size
        rescue MeeshoClient::RequestError => e
          failed << { "catalog_id" => item["catalog_id"], "error" => e.message.truncate(200) }
        end
      end
      account.cookies = client.cookies
      account.save!
      message = "Paused #{skus} SKU#{'s' unless skus == 1} in #{done} catalog#{'s' unless done == 1}."
      message += " #{failed.size} catalog#{'s' unless failed.size == 1} refused: #{failed.first(3).map { |f| "#{f['catalog_id']} (#{f['error']})" }.join('; ')}" if failed.any?
      run.update!(result: (run.result || {}).merge("paused" => skus, "failed" => failed))
      run.finish!(failed.empty?, message, records: skus)
    rescue MeeshoClient::AuthError, SecretBox::NotConfigured => e
      run.update!(result: (run.result || {}).merge("paused" => skus, "failed" => failed))
      run.finish!(false, "Stopped — #{e.message}#{" (#{skus} SKUs were paused before it stopped)" if skus.positive?}")
    rescue StandardError => e
      Sidekiq.logger.error("MeeshoArchiveJob #{account_id}: #{e.class}: #{e.message}")
      run.finish!(false, "Unexpected error (#{e.class.name.demodulize}) — check the Inventory page on the Meesho panel before trying again.")
    ensure
      # Read the inventory again, so the page shows what Meesho now says.
      MeeshoInventoryJob.perform_async(account.id, nil, MeeshoSyncRun::TRIGGER_MANUAL) if account
    end
  end

  private

  # Show them paused straight away; the next read confirms it.
  def mark_paused(account, products)
    today = Date.current.strftime("%b %-d, %Y")
    products.each do |p|
      MeeshoListing.where(account_id: account.id, product_id: p[:product_id].to_i, variation_id: p[:variation_id].to_i)
                   .update_all(archived: true, archived_at: today)
    end
  end
end
