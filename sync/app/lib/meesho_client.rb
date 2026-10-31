require "net/http"
require "json"

# Talks to the Meesho supplier panel's own API (supplier.meesho.com/api/...) the
# way the panel's web page does: the same headers, and the session cookies the
# login hands back, sent on every call after it.
class MeeshoClient
  # Overridable only so a local stand-in can be used in testing.
  BASE = ENV.fetch("MEESHO_BASE_URL", "https://supplier.meesho.com").freeze
  LOGIN_PATH = "/api/container/user/v2-login".freeze
  USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " \
               "(KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36".freeze
  CLIENT_PACKAGE_VERSION = "1.0.41".freeze
  TIMEOUT = 30

  # The login was refused, or the session is no longer accepted.
  class AuthError < StandardError; end
  # Anything else that went wrong talking to Meesho.
  class RequestError < StandardError; end

  Result = Struct.new(:status, :body, :cookies, keyword_init: true)

  SESSION_COOKIES = %w[connect.sid].freeze
  BOT_COOKIES = %w[_abck bm_sz ak_bmsc bm_sv bm_mi bm_so].freeze

  attr_reader :cookies

  def initialize(account, cookies: nil)
    @account = account
    @cookies = (cookies || account.cookies).dup
  end

  # Log in with the account's phone number and password. On success the
  # session cookies are in #cookies and the response body is returned.
  def login(password)
    body = {
      password: password,
      device_id: @account.device_id.presence || @account.phone_number,
      instance: @account.instance.presence,
      phone_number: @account.phone_number,
    }.compact
    res = request(:post, LOGIN_PATH, body: body, extra: { "identifier" => "login",
                                                          "referer" => "#{BASE}/panel/v3/new/root/login" })
    # A good login answers 200 — with an empty body — and sets the session
    # cookie. Bot-protection cookies (_abck, bm_sz…) come back either way.
    refused = res.body.is_a?(Hash) && refused?(res.body)
    unless res.status.between?(200, 299) && !refused
      raise AuthError, describe_failure(res, "Login refused")
    end
    unless res.cookies.keys.any? { |k| SESSION_COOKIES.include?(k) || !BOT_COOKIES.include?(k) }
      raise AuthError, "Login answered OK but Meesho set no session cookie"
    end
    res
  end

  # `headers:` adds to (or replaces) the standard ones for this one call.
  def get(path, params: {}, headers: {})
    authed(:get, path, params: params, extra: headers)
  end

  def post(path, body: {}, headers: {})
    authed(:post, path, body: body, extra: headers)
  end

  private

  def authed(method, path, **opts)
    res = request(method, path, **opts)
    raise AuthError, describe_failure(res, "Session not accepted") if [401, 403].include?(res.status)
    raise RequestError, describe_failure(res, "Meesho answered") unless res.status.between?(200, 299)
    res
  end

  def request(method, path, params: {}, body: nil, extra: {})
    uri = URI.join(BASE, path)
    uri.query = URI.encode_www_form(params) if params.present?
    req = (method == :post ? Net::HTTP::Post : Net::HTTP::Get).new(uri)
    headers(extra).each { |k, v| req[k] = v }
    req["cookie"] = @cookies.map { |k, v| "#{k}=#{v}" }.join("; ") if @cookies.present?
    req.body = body.to_json if body
    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = uri.scheme == "https"
    http.open_timeout = TIMEOUT
    http.read_timeout = TIMEOUT
    res = http.request(req)
    fresh = parse_set_cookies(res)
    @cookies.merge!(fresh)
    Result.new(status: res.code.to_i, body: parse_body(res), cookies: fresh)
  rescue Net::OpenTimeout, Net::ReadTimeout, SocketError, Errno::ECONNREFUSED, OpenSSL::SSL::SSLError => e
    raise RequestError, "Could not reach Meesho: #{e.class.name.demodulize}"
  end

  def headers(extra)
    {
      "accept" => "application/json, text/plain, */*",
      "accept-language" => "en-GB,en-US;q=0.9,en;q=0.8,hi;q=0.7",
      "client-package-version" => CLIENT_PACKAGE_VERSION,
      "client-type" => "d-web",
      "content-type" => "application/json;charset=UTF-8",
      "origin" => BASE,
      "referer" => "#{BASE}/panel/v3/new/root/login",
      "user-agent" => USER_AGENT,
      "browser-id" => @account.browser_id.presence,
    }.compact.merge(extra)
  end

  def parse_set_cookies(res)
    (res.get_fields("set-cookie") || []).each_with_object({}) do |line, out|
      name, value = line.split(";", 2).first.to_s.split("=", 2)
      out[name.strip] = value.to_s.strip if name.present?
    end
  end

  def parse_body(res)
    JSON.parse(res.body.to_s)
  rescue JSON::ParserError
    res.body.to_s[0, 500]
  end

  def refused?(body)
    body["success"] == false || body["status"].to_s.downcase.in?(%w[failure failed error]) ||
      (body["error"].present? && body["data"].blank?)
  end

  # A message for the page — never echoing the password or cookies back.
  def describe_failure(res, prefix)
    detail =
      if res.body.is_a?(Hash)
        err = res.body["error"]
        res.body["message"].presence || (err.is_a?(Hash) ? err["message"] || err["msg"] : err).presence ||
          res.body["msg"].presence || res.body["errorMessage"].presence
      elsif res.body.to_s.match?(/<html|access denied|akamai|reference #/i)
        "Meesho's bot protection blocked the request from the server"
      end
    ["#{prefix} (HTTP #{res.status})", detail.presence&.to_s&.truncate(300)].compact.join(" — ")
  end
end
