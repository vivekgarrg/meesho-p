require "test_helper"

class SecretBoxTest < ActiveSupport::TestCase
  test "round trip" do
    assert_equal "pässwörd ₹", SecretBox.decrypt(SecretBox.encrypt("pässwörd ₹"))
  end

  test "reads what Django's meesho_sync.encrypt wrote" do
    # Made by backend/meesho_app/meesho_sync.py with the same key ("k" * 32).
    assert_equal "Test-Pa55 ₹ é", SecretBox.decrypt("v1:cb0Ox2TeRLv+81r61jCAO/K+1py0wKmK2FdUeW57YS0KFPJfzX4s7T0DAG8=")
  end

  test "a tampered secret is refused" do
    blob = SecretBox.encrypt("x")
    bad = "v1:" + Base64.strict_encode64(Base64.decode64(blob[3..]).tap { |b| b.setbyte(13, b.getbyte(13) ^ 1) })
    assert_raises(OpenSSL::Cipher::CipherError) { SecretBox.decrypt(bad) }
  end
end
