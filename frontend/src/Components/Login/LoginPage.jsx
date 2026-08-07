import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { C, S, btn } from "../../App";
import { useAuth } from "../../contexts/AuthContext";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login(username, password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: C.bg,
        fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{ ...S.card, width: 340, display: "flex", flexDirection: "column", gap: 16 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
          <div
            style={{
              width: 40, height: 40, borderRadius: 12,
              background: "linear-gradient(135deg, #7C3AED 0%, #4F46E5 100%)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 18, fontWeight: 900, color: "#fff",
            }}
          >
            R
          </div>
          <div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: C.gray800 }}>Rudam</div>
              <div style={{ fontSize: 11, color: C.gray400, fontWeight: 600 }}>Commerce OS</div>
            </div>
            <div style={{ fontSize: 11, color: C.gray400 }}>Sign in to continue</div>
          </div>
        </div>

        <div>
          <label style={S.label}>Username</label>
          <input
            style={S.inp}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            required
          />
        </div>

        <div>
          <label style={S.label}>Password</label>
          <input
            style={S.inp}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        {error && (
          <div style={{ fontSize: 12, color: C.red, background: C.redLight, border: `1px solid ${C.redBorder}`, borderRadius: 8, padding: "8px 12px" }}>
            {error}
          </div>
        )}

        <button type="submit" disabled={submitting} style={{ ...btn("primary", "md"), opacity: submitting ? 0.7 : 1 }}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
