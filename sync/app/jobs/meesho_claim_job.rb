# Raise one return claim on Meesho in the background — queued by Raise Return
# Claim, so the desk moves straight on to the next return while this one's
# video is compressed and every file goes up. The work is Django's
# (meesho_raise_claim); this job only runs it and does what it says next:
#
#   wait   — the phone is still sending files: look again shortly
#   retry  — Meesho was busy or unreachable: try again later (gaps growing)
#   done / failed — finished (a failure is on the claim, and sent to Telegram)
#
# If the command itself can't run, it is tried a few times, then the claim is
# marked failed so it never sits "queued" for ever.
class MeeshoClaimJob
  include Sidekiq::Job
  sidekiq_options queue: "critical", retry: false

  CRASH_RETRIES = 4
  CRASH_WAIT = [60, 300, 900, 1800].freeze

  def perform(claim_id, attempt = 1, crashes = 0)
    res = DjangoCommand.run("meesho_raise_claim", "--claim", claim_id, "--attempt", attempt)
    case res["next"]
    when "wait" then self.class.perform_in((res["in"] || 30).to_i, claim_id, attempt, crashes)
    when "retry" then self.class.perform_in((res["in"] || 300).to_i, claim_id, attempt + 1, crashes)
    end
  rescue DjangoCommand::Failed => e
    Sidekiq.logger.error("MeeshoClaimJob #{claim_id}: #{e.message}")
    if crashes < CRASH_RETRIES
      self.class.perform_in(CRASH_WAIT[crashes], claim_id, attempt, crashes + 1)
    else
      begin
        DjangoCommand.run("meesho_raise_claim", "--claim", claim_id, "--give-up", e.message.truncate(300))
      rescue DjangoCommand::Failed
        nil
      end
    end
  end
end
