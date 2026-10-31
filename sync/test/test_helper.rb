ENV["RAILS_ENV"] ||= "test"
require "base64"
ENV["MEESHO_SYNC_KEY"] = Base64.strict_encode64("k" * 32)
require_relative "../config/environment"
require "rails/test_help"
require "webmock/minitest"
require "sidekiq/testing"

WebMock.disable_net_connect!
Sidekiq::Testing.fake!

# The tables Django owns (meesho_app/models.py), with the same NOT NULL columns,
# so a write the real database would refuse fails here too.
ActiveRecord::Schema.verbose = false
ActiveRecord::Schema.define do
  create_table :meesho_sync_accounts do |t|
    t.integer :business_id, null: false
    t.string :phone_number, null: false
    t.text :password_enc, null: false
    t.string :device_id, null: false, default: ""
    t.string :instance, null: false, default: ""
    t.string :browser_id, null: false, default: ""
    t.text :cookies_enc, null: false, default: ""
    t.string :status, null: false
    t.text :status_message, null: false, default: ""
    t.string :supplier_id, null: false, default: ""
    t.string :supplier_name, null: false, default: ""
    t.string :supplier_identifier, null: false, default: ""
    t.datetime :last_login_at
    t.boolean :sync_enabled, null: false, default: true
    t.integer :sync_interval_minutes, null: false, default: 5
    t.datetime :last_sync_at
    t.string :last_sync_status, null: false, default: ""
    t.text :last_sync_message, null: false, default: ""
    t.datetime :orders_changed_at
    t.integer :created_by_id
    t.datetime :created_at, null: false
    t.datetime :updated_at, null: false
  end
  create_table :meesho_sync_runs do |t|
    t.integer :account_id, null: false
    t.string :kind, null: false
    t.string :trigger, null: false
    t.string :status, null: false
    t.text :message, null: false
    t.integer :records, null: false
    t.text :result         # JSON, as Django's JSONField makes it on SQLite
    t.datetime :queued_at, null: false
    t.datetime :started_at
    t.datetime :finished_at
  end
  create_table :businesses do |t|
    t.string :name, null: false
  end
  create_table :orders do |t|
    t.string :reason_for_credit_entry
    t.string :sub_order_no, null: false
    t.bigint :catalog_id
    t.date :order_date
    t.string :order_source
    t.string :customer_state
    t.text :product_name
    t.string :sku
    t.string :size
    t.integer :quantity, null: false
    t.decimal :supplier_listed_price
    t.decimal :supplier_discounted_price
    t.string :packet_id
    t.datetime :created_at, null: false
    t.datetime :updated_at, null: false
    t.integer :business_id, null: false
  end
  create_table :meesho_sync_snapshots do |t|
    t.integer :account_id, null: false
    t.string :endpoint, null: false
    t.integer :http_status, null: false
    t.text :payload        # as Django's JSONField makes it on SQLite (MySQL: native json)
    t.datetime :fetched_at, null: false
    t.check_constraint "JSON_VALID(payload) OR payload IS NULL", name: "payload_is_json"
  end
  create_table :meesho_inventory_catalogs do |t|
    t.integer :account_id, null: false
    t.bigint :catalog_id, null: false
    t.string :name, null: false
    t.string :category, null: false
    t.text :image_url, null: false
    t.boolean :in_active, null: false
    t.boolean :in_paused, null: false
    t.boolean :in_pending, null: false
    %i[sku_count active_count archived_count blocked_count out_of_stock_count low_stock_count].each { |c| t.integer c, null: false }
    t.datetime :expected_live_at
    t.boolean :live_delayed, null: false
    t.datetime :seen_at, null: false
    t.datetime :products_fetched_at
    t.index %i[account_id catalog_id], unique: true
  end
  create_table :meesho_sync_settings do |t|
    %i[orders_every shipped_every inventory_every inventory_sku_reads payments_every payments_paid_days
       payments_upcoming_days returns_every].each { |c| t.integer c, null: false }
    t.string :returns_window, null: false
    t.integer :updated_by_id
    t.datetime :updated_at, null: false
  end
  create_table :meesho_auto_settings do |t|
    t.boolean :enabled, null: false, default: false
    t.integer :accept_every_minutes, null: false, default: 30
    t.text :label_times                     # JSON
    t.datetime :last_accept_at
    t.datetime :last_labels_at
    t.integer :updated_by_id
    t.datetime :updated_at, null: false
  end
  create_table :meesho_inventory do |t|
    t.integer :serial_no, null: false
    t.string :catalog_name, null: false
    t.bigint :catalog_id, null: false
    t.text :product_name, null: false
    t.bigint :product_id, null: false
    t.string :style_id, null: false
    t.bigint :variation_id
    t.string :variation, null: false
    t.string :stock_type, null: false
    t.integer :system_stock_count, null: false
    t.integer :seller_stock_count
    t.datetime :uploaded_at, null: false
    t.datetime :updated_at, null: false
    t.integer :business_id, null: false
    t.index %i[business_id serial_no], unique: true
  end
  create_table :meesho_price_updates do |t|
    t.integer :inventory_id, null: false
  end
  create_table :meesho_inventory_listings do |t|
    t.integer :account_id, null: false
    t.integer :catalog_id, null: false          # meesho_inventory_catalogs.id
    t.bigint :product_id, null: false
    t.bigint :variation_id, null: false
    t.string :sku_id, null: false
    t.text :name, null: false
    t.string :variation, null: false
    t.text :image_url, null: false
    t.integer :inventory
    t.decimal :selling_price
    t.boolean :archived, null: false
    t.string :archived_at, null: false
    t.string :out_of_stock_since, null: false
    t.datetime :seen_at, null: false
    t.index %i[account_id product_id variation_id], unique: true
  end
end

# No Django in tests: its commands are never started from here (tests that
# look at what was asked of Django swap in their own recorder).
DjangoCommand.define_singleton_method(:run) { |*_args, **_opts| {} }

# No Redis in tests: the per-account lock always succeeds.
[MeeshoSyncJob, MeeshoInventoryJob, MeeshoPaymentsJob, MeeshoReturnsJob].each do |job|
  job.class_eval do
    private
    def lock(_account) = true
    def unlock(_account) = nil
  end
end
MeeshoAutoLabelsJob.class_eval do
  private
  def lock = true
  def unlock = nil
end
MeeshoSyncJob.class_eval do
  private
  def lock(_account) = true
  def unlock(_account) = nil
end

class ActiveSupport::TestCase
  LOGIN_URL = "https://supplier.meesho.com/api/container/user/v2-login"

  setup do
    Sidekiq::Worker.clear_all
    Order.delete_all
    Business.delete_all
    MeeshoSyncSnapshot.delete_all
    MeeshoListing.delete_all
    MeeshoAutoSetting.delete_all
    MeeshoSyncSetting.delete_all
    MeeshoStockRow.delete_all
    MeeshoCatalog.delete_all
    MeeshoSyncRun.delete_all
    MeeshoAccount.delete_all
  end

  # Run the block with these endpoints configured instead of the real list.
  def with_endpoints(list)
    original = MeeshoEndpoints.method(:all)
    MeeshoEndpoints.define_singleton_method(:all) { list }
    yield
  ensure
    MeeshoEndpoints.define_singleton_method(:all, original)
  end

  def make_account(**attrs)
    MeeshoAccount.create!({ business_id: 1, phone_number: "9000000001", password_enc: SecretBox.encrypt("s3cret!"),
                            status: MeeshoAccount::STATUS_NEW }.merge(attrs))
  end

  def stub_login(status: 200, body: { data: { supplier_id: 4313711, supplier_name: "Rudam" } }, cookies: ["session_token=abc; Path=/; HttpOnly", "cid=42; Path=/"])
    stub_request(:post, LOGIN_URL).to_return(
      status: status, body: body.is_a?(String) ? body : body.to_json,
      headers: { "Content-Type" => "application/json", "Set-Cookie" => cookies })
  end
end
