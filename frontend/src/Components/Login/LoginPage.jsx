import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import PublicShell, { BRAND, MUTED, OFFER } from "../Landing/PublicShell";
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
    <PublicShell>
      <div style={{
        minHeight: "62vh", display: "flex", alignItems: "center",
        justifyContent: "center", padding: "48px 20px",
      }}>
      <form
        onSubmit={handleSubmit}
        style={{ ...S.card, width: 340, display: "flex", flexDirection: "column", gap: 16 }}
      >
        <div style={{
          background: "#F5F3FF", border: "1px solid #DDD6FE", borderRadius: 10,
          padding: "9px 12px", fontSize: 12.5, fontWeight: 700, color: BRAND, textAlign: "center",
        }}>
          🎉 {OFFER}
        </div>
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

        <div style={{ fontSize: 12.5, color: MUTED, textAlign: "center" }}>
          No account yet?{" "}
          <Link to="/" style={{ color: BRAND, fontWeight: 700, textDecoration: "none" }}>
            Get your free year
          </Link>
        </div>
      </form>
      </div>
    </PublicShell>
  );
}
