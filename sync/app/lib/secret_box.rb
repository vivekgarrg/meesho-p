require "openssl"
require "base64"

# AES-256-GCM under MEESHO_SYNC_KEY (32 bytes, base64) — the same format the
# Django side writes (backend/meesho_app/meesho_sync.py):
#   "v1:" + base64(nonce[12] · ciphertext · tag[16])
module SecretBox
  class NotConfigured < StandardError; end

  module_function

  def key
    raw = ENV["MEESHO_SYNC_KEY"].to_s.strip
    raise NotConfigured, "MEESHO_SYNC_KEY is not set" if raw.empty?
    k = Base64.decode64(raw)
    raise NotConfigured, "MEESHO_SYNC_KEY must be 32 bytes, base64-encoded" unless k.bytesize == 32
    k
  end

  def encrypt(text)
    c = OpenSSL::Cipher.new("aes-256-gcm").encrypt
    c.key = key
    nonce = c.random_iv                   # 12 bytes for GCM
    sealed = c.update(text.to_s) + c.final
    "v1:" + Base64.strict_encode64(nonce + sealed + c.auth_tag)
  end

  def decrypt(blob)
    raise ArgumentError, "unknown secret format" unless blob.to_s.start_with?("v1:")
    raw = Base64.decode64(blob[3..])
    nonce, body, tag = raw.byteslice(0, 12), raw.byteslice(12, raw.bytesize - 28), raw.byteslice(-16, 16)
    c = OpenSSL::Cipher.new("aes-256-gcm").decrypt
    c.key = key
    c.iv = nonce
    c.auth_tag = tag
    (c.update(body) + c.final).force_encoding(Encoding::UTF_8)
  end
end
