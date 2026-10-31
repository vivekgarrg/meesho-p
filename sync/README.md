# Meesho sync worker (Rails + Sidekiq)

Logs in to the Meesho supplier panel with the account saved on the **Meesho Sync**
page, keeps the session cookies, and pulls the panel's data on a schedule
(every 5 minutes by default; **Refresh now** on the page pulls straight away).

It is a worker only, with no web server:

| Part | Where |
| --- | --- |
| Login page, Refresh button, status | Django (`backend/meesho_app/meesho_sync.py`, `frontend/.../MeeshoSyncTab.jsx`) |
| Queue | Redis. Django pushes jobs straight onto Sidekiq's queue |
| Jobs | `app/jobs/`: `MeeshoLoginJob`, `MeeshoSyncJob`, `MeeshoScheduleJob` (every minute, `config/schedule.yml`) |
| Talking to Meesho | `app/lib/meesho_client.rb` |
| What gets pulled | `app/lib/meesho_endpoints.rb` (empty until each endpoint's request is added) |
| Tables | Django owns them (`meesho_sync_accounts`, `meesho_sync_runs`, `meesho_sync_snapshots`). **Never run Rails migrations here.** |

The password and cookies are AES-256-GCM encrypted with `MEESHO_SYNC_KEY`
(`app/lib/secret_box.rb` and `meesho_sync.py` share the format).

## Run locally

```bash
brew install ruby redis           # Ruby >= 3.2
export PATH=/opt/homebrew/opt/ruby/bin:$PATH
cd sync && bundle install
redis-server &                    # or: brew services start redis
# The same DB_* / REDIS_URL / MEESHO_SYNC_KEY values the Django dev server uses:
bundle exec sidekiq -C config/sidekiq.yml
bin/rails test                    # in-memory DB, Meesho mocked
```

## One-time setup on the VPS

```bash
sudo apt install -y redis-server ruby-full build-essential   # Ruby must be >= 3.2 (Ubuntu 24.04 ships 3.2)
sudo gem install bundler
# deploy/hostinger/.env — add REDIS_URL and MEESHO_SYNC_KEY (see .env.example)
cd ~/meesho-p/sync && BUNDLE_PATH=vendor/bundle BUNDLE_WITHOUT=test bundle install
sudo cp ~/meesho-p/deploy/hostinger/sidekiq.service /etc/systemd/system/meesho-sidekiq.service
sudo systemctl daemon-reload && sudo systemctl enable --now meesho-sidekiq
sudo systemctl restart meesho     # so Django picks up the new .env values
```

After that, every deploy (`update.sh`) installs the gems and restarts
`meesho-sidekiq`. Until then, the deploy skips this step.

## Adding an endpoint

Copy the panel's request from the browser (DevTools → Network → Copy as cURL)
and add it to `MeeshoEndpoints::LIST`. Each response is kept as that endpoint's
latest snapshot. Turning it into rows of the app's own tables (orders,
payments…) is a mapping written per endpoint.
