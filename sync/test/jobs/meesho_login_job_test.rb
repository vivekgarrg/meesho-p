require "test_helper"

class MeeshoLoginJobTest < ActiveSupport::TestCase
  test "a good login stores the session encrypted and queues a pull" do
    account = make_account
    stub_login
    run = account.runs.create!(kind: "LOGIN", trigger: "MANUAL")
    MeeshoLoginJob.new.perform(account.id, run.id)

    account.reload
    assert_equal "ACTIVE", account.status
    assert_equal({ "session_token" => "abc", "cid" => "42" }, account.cookies)
    refute_includes account.cookies_enc, "abc"                       # never stored in the clear
    assert_equal ["4313711", "Rudam"], [account.supplier_id, account.supplier_name]
    assert_equal "OK", run.reload.status
    assert_equal 1, MeeshoSyncJob.jobs.size

    # No instance / browser-id saved: the account gets its own pair, kept for next time.
    assert_match(/\A[A-Za-z0-9]{21}\z/, account.instance)
    assert account.browser_id.present?
    assert_requested(:post, LOGIN_URL) do |req|
      body = JSON.parse(req.body)
      body == { "password" => "s3cret!", "device_id" => "9000000001", "instance" => account.instance, "phone_number" => "9000000001" } &&
        req.headers["Client-Type"] == "d-web" && req.headers["Identifier"] == "login" &&
        req.headers["Browser-Id"] == account.browser_id && req.headers["Cookie"].nil?
    end
  end

  test "the panel's own fields are sent when set" do
    account = make_account(device_id: "dev-1", instance: "inst-2", browser_id: "brw-3")
    stub_login
    MeeshoLoginJob.new.perform(account.id)
    assert_requested(:post, LOGIN_URL) do |req|
      b = JSON.parse(req.body)
      b["device_id"] == "dev-1" && b["instance"] == "inst-2" && req.headers["Browser-Id"] == "brw-3"
    end
  end

  test "a refused login is reported without the password" do
    account = make_account
    stub_login(status: 401, body: { message: "Invalid phone number or password" }, cookies: [])
    MeeshoLoginJob.new.perform(account.id)
    account.reload
    assert_equal "FAILED", account.status
    assert_includes account.status_message, "Invalid phone number or password"
    refute_includes account.status_message, "s3cret!"
    assert_equal "FAILED", account.runs.last.status
    assert_empty MeeshoSyncJob.jobs
  end

  test "bot protection blocking the server is named as such" do
    account = make_account
    stub_login(status: 403, body: "<html>Access Denied … Reference #18.abc</html>", cookies: [])
    MeeshoLoginJob.new.perform(account.id)
    assert_match(/bot protection/, account.reload.status_message)
  end

  test "a disconnected account is left alone" do
    account = make_account(status: "DISABLED", password_enc: "")
    MeeshoLoginJob.new.perform(account.id)
    assert_not_requested(:post, LOGIN_URL)
  end

  test "the supplier id and code come from the panel's cookies when the body lacks them" do
    account = make_account
    stub_login(body: { data: { name: "Rudam" } }, cookies: ["connect.sid=x; Path=/", "s_id=4313711; Path=/", "current_az_identifier=xzvey; Path=/"])
    MeeshoLoginJob.new.perform(account.id)
    account.reload
    assert_equal ["4313711", "xzvey", "Rudam"], [account.supplier_id, account.supplier_identifier, account.supplier_name]
  end

  test "a supplier code an admin set is kept" do
    account = make_account(supplier_identifier: "mine")
    stub_login(cookies: ["connect.sid=x; Path=/", "current_az_identifier=other; Path=/"])
    MeeshoLoginJob.new.perform(account.id)
    assert_equal "mine", account.reload.supplier_identifier
  end

  test "the real panel answers a good login with an empty body and a session cookie" do
    account = make_account
    stub_login(body: "", cookies: ["_abck=x; Path=/", "bm_sz=y; Path=/", "connect.sid=s%3Areal; Path=/", "current_az_identifier=xzvey; Path=/"])
    MeeshoLoginJob.new.perform(account.id)
    account.reload
    assert_equal ["ACTIVE", "xzvey"], [account.status, account.supplier_identifier]
    assert_equal "s%3Areal", account.cookies["connect.sid"]
  end

  test "only bot-protection cookies back is not a login" do
    account = make_account
    stub_login(body: "", cookies: ["_abck=x; Path=/", "bm_sz=y; Path=/"])
    MeeshoLoginJob.new.perform(account.id)
    assert_equal "FAILED", account.reload.status
    assert_match(/no session cookie/, account.status_message)
  end

  test "the 400 Meesho gives a malformed login is reported" do
    account = make_account
    stub_login(status: 400, body: { error: "Bad Request", options: { backendData: { error: "Bad Request" } } }, cookies: [])
    MeeshoLoginJob.new.perform(account.id)
    assert_equal "Login refused (HTTP 400) — Bad Request", account.reload.status_message
  end
end
