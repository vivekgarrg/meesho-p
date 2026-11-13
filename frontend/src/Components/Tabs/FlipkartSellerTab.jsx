import React, { useState, useEffect, useCallback } from "react";
import { API, C, S, btn, useIsMobile } from "../../App";
import { CircularProgress } from "@mui/material";

/*
 * Flipkart → Seller Hub: connect the business's Flipkart Seller Hub login
 * (password, then the OTP Flipkart sends — it asks for one at every login), and
 * see its dashboard as last read. The session lives on the server, encrypted;
 * the sync reads it every 10 minutes, which keeps it alive. When Flipkart ends
 * it the page says so — log in again with a new OTP. Server: flipkart_seller.py.
 */

const STATUS = {
  ACTIVE: { label: "Connected", fg: "#15803D", bg: "#DCFCE7" },
  OTP_SENT: { label: "Waiting for the OTP", fg: "#B45309", bg: "#FEF3C7" },
  EXPIRED: { label: "Session ended — log in again", fg: "#B91C1C", bg: "#FEE2E2" },
  FAILED: { label: "Login refused", fg: "#B91C1C", bg: "#FEE2E2" },
  NEW: { label: "Connecting…", fg: "#475569", bg: "#F1F5F9" },
};
const GROUPS = [["sales", "Sales"], ["impressions", "Impressions"], ["out_of_stock", "Out of stock"]];
const when = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" }) : "never");
// Seller Hub's own names for its figures, in words.
const NAMES = {
  gross_units: "units", gross_gmv: "sales value", impressions_latest: "impressions (latest day)",
  impressions_prev: "impressions (day before)", bring_listing_instock: "listings to bring back in stock",
  potential_loss: "potential loss",
};
const pretty = (label) => label.split(" · ").map((p) => NAMES[p] || p.replace(/_/g, " ")).join(" · ");
const value = (label, v) => (/gmv|value/i.test(label) ? `₹${Number(v).toLocaleString("en-IN")}` : Number(v).toLocaleString("en-IN"));

async function call(path, method = "GET", body) {
  const r = await fetch(`${API}/flipkart-seller/${path}`, {
    method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, data: j };
}

function Badge({ status }) {
  const s = STATUS[status] || { label: "Not connected", fg: "#475569", bg: "#F1F5F9" };
  return <span style={{ fontSize: 12, fontWeight: 800, color: s.fg, background: s.bg, padding: "4px 10px", borderRadius: 999, whiteSpace: "nowrap" }}>{s.label}</span>;
}

/** Password (and pickup location) → Flipkart sends an OTP. */
function ConnectForm({ d, onDone, setErr }) {
  const [username, setUsername] = useState(d.username || "");
  const [password, setPassword] = useState("");
  const [location, setLocation] = useState(d.location_id || "");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    const r = await call("connect/", "POST", { username, password, location_id: location });
    setBusy(false);
    if (!r.ok) setErr(r.data.error || "Couldn't start the login.");
    onDone(r.data);
  };
  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", alignItems: "end" }}>
      <label style={lbl}>Seller Hub mobile number (or email)
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" inputMode="tel" style={S.inp} required />
      </label>
      <label style={lbl}>Password {d.username ? <span style={{ fontWeight: 600, color: C.gray400 }}>(leave blank to use the saved one)</span> : null}
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" style={S.inp} required={!d.username} />
      </label>
      <label style={lbl}>Pickup location id <span style={{ fontWeight: 600, color: C.gray400 }}>(LOC…, optional)</span>
        <input value={location} onChange={(e) => setLocation(e.target.value.trim())} placeholder="LOC…" style={{ ...S.inp, fontFamily: "monospace" }} />
      </label>
      <button type="submit" disabled={busy} style={{ ...btn("primary", "md"), minHeight: 42 }}>{busy ? "Sending…" : "Log in → send OTP"}</button>
    </form>
  );
}

/** The OTP Flipkart sent to the phone. */
function OtpForm({ d, onDone, setErr }) {
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    const r = await call("otp/", "POST", { otp });
    setBusy(false);
    if (!r.ok) setErr(r.data.error || "OTP not accepted.");
    onDone(r.data);
  };
  const resend = async () => {
    setBusy(true); setErr(null);
    const r = await call("connect/", "POST", { username: d.username });
    setBusy(false);
    if (!r.ok) setErr(r.data.error || "Couldn't send a new OTP.");
    onDone(r.data);
  };
  return (
    <form onSubmit={submit} style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
      <label style={{ ...lbl, flex: "0 1 220px" }}>OTP sent to {d.username}
        <input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 8))} inputMode="numeric" autoComplete="one-time-code"
          autoFocus placeholder="6 digits" style={{ ...S.inp, fontSize: 20, letterSpacing: ".2em", fontFamily: "monospace" }} />
      </label>
      <button type="submit" disabled={busy || otp.length < 4} style={{ ...btn("primary", "md"), minHeight: 42 }}>{busy ? "Checking…" : "Verify"}</button>
      <button type="button" onClick={resend} disabled={busy} style={{ ...btn("ghost", "md"), minHeight: 42 }}>Send a new OTP</button>
    </form>
  );
}

const lbl = { display: "flex", flexDirection: "column", gap: 5, fontSize: 12.5, fontWeight: 800, color: C.gray600, minWidth: 0 };

export function FlipkartSellerTab() {
  const mobile = useIsMobile();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [relogin, setRelogin] = useState(false);

  const load = useCallback(async () => {
    const r = await call("");
    if (r.ok) setD(r.data); else setErr(r.data.error || r.data.detail || "Couldn't read the Flipkart connection.");
  }, []);
  useEffect(() => { load(); }, [load]);
  // While connected, read again every minute (the server's own refresh runs every 10).
  useEffect(() => {
    if (d?.status !== "ACTIVE") return undefined;
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [d?.status, load]);

  const got = (data) => { if (data && "status" in data) { setD(data); setRelogin(false); } };
  const refresh = async () => {
    setBusy(true); setErr(null);
    const r = await call("refresh/", "POST");
    setBusy(false);
    if (!r.ok) setErr(r.data.error || "Couldn't read Flipkart.");
    got(r.data);
  };
  const disconnect = async () => {
    if (!window.confirm("Disconnect Flipkart? The saved login and session are deleted from the server.")) return;
    const r = await call("", "DELETE");
    if (r.ok) setD(r.data);
  };

  if (!d) {
    return err ? <div role="alert" style={{ ...S.card, color: C.red, fontWeight: 700 }}>✕ {err}</div>
      : <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><CircularProgress style={{ color: "#2874F0" }} /></div>;
  }
  const showLogin = d.is_admin && (!d.status || ["FAILED", "EXPIRED", "NEW"].includes(d.status) || relogin);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 1100, minWidth: 0 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: C.gray900, margin: 0 }}>Flipkart Seller Hub</h1>
        <p style={{ fontSize: 13, color: C.gray500, margin: "4px 0 0", maxWidth: 760 }}>
          The business's Seller Hub login, held on the server (encrypted). Flipkart asks for an OTP at every login; once in, the session is kept alive and read every 10 minutes.
        </p>
      </div>

      <section style={{ ...S.card, padding: 16, borderTop: "4px solid #2874F0", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 900, fontSize: 15, color: C.gray900, flex: "1 1 200px" }}>Connection</span>
          <Badge status={d.status} />
        </div>
        {d.status && (
          <div style={{ display: "grid", gap: "4px 14px", gridTemplateColumns: mobile ? "1fr" : "repeat(3, minmax(0, 1fr))", fontSize: 13, color: C.gray600 }}>
            <span>Login: <b style={{ color: C.gray900 }}>{d.username}</b></span>
            {d.seller_id && <span>Seller id: <b style={{ fontFamily: "monospace", color: C.gray900 }}>{d.seller_id}</b></span>}
            <span>Pickup location: <b style={{ fontFamily: "monospace", color: C.gray900 }}>{d.location_id || "not set"}</b></span>
            <span>Logged in: {when(d.last_login_at)}</span>
            <span>Last read: {when(d.last_check_at)}</span>
          </div>
        )}
        {d.status_message && d.status !== "ACTIVE" && <div style={{ fontSize: 13, color: d.status === "OTP_SENT" ? "#92400E" : C.red, fontWeight: 700 }}>{d.status_message}</div>}
        {err && <div role="alert" style={{ fontSize: 13, color: C.red, fontWeight: 700 }}>✕ {err}</div>}

        {!d.is_admin && !d.connected && <div style={{ fontSize: 13, color: C.gray500 }}>Not connected — an admin connects Flipkart here.</div>}
        {d.is_admin && d.status === "OTP_SENT" && !relogin && <OtpForm d={d} onDone={got} setErr={setErr} />}
        {showLogin && d.status !== "OTP_SENT" && <ConnectForm d={d} onDone={got} setErr={setErr} />}
        {showLogin && d.status === "OTP_SENT" && relogin && <ConnectForm d={d} onDone={got} setErr={setErr} />}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {d.connected && <button onClick={refresh} disabled={busy} style={{ ...btn("primary", "sm"), opacity: busy ? 0.6 : 1 }}>{busy ? "Reading Flipkart…" : "↻ Read Flipkart now"}</button>}
          {d.is_admin && d.status && !showLogin && <button onClick={() => setRelogin(true)} style={btn("ghost", "sm")}>Log in again</button>}
          {d.is_admin && relogin && <button onClick={() => setRelogin(false)} style={btn("ghost", "sm")}>Cancel</button>}
          {d.is_admin && d.status && <button onClick={disconnect} style={{ ...btn("ghost", "sm"), color: C.red }}>Disconnect</button>}
        </div>
      </section>

      {d.connected && (
        <section style={{ ...S.card, padding: 16 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", marginBottom: 10 }}>
            <span style={{ fontWeight: 900, fontSize: 15, color: C.gray900, flex: 1 }}>Seller Hub today</span>
            <span style={{ fontSize: 12, color: C.gray400 }}>read {when(d.summary_at)}</span>
          </div>
          {d.status_message && <div style={{ fontSize: 12.5, color: "#92400E", marginBottom: 10 }}>Some numbers couldn't be read: {d.status_message}</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {GROUPS.filter(([k]) => (d.summary?.[k] || []).length).map(([k, title]) => (
              <div key={k}>
                <div style={{ fontSize: 12, fontWeight: 800, color: C.gray500, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6 }}>{title}</div>
                <div style={{ display: "grid", gap: 8, gridTemplateColumns: mobile ? "repeat(2, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))" }}>
                  {d.summary[k].map((t) => (
                    <div key={t.label} style={{ border: `1px solid ${C.gray200}`, borderRadius: 12, padding: "10px 12px", minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: C.gray500, fontWeight: 700, textTransform: "capitalize", overflow: "hidden", textOverflow: "ellipsis" }}>{pretty(t.label)}</div>
                      <div style={{ fontSize: 22, fontWeight: 900, color: C.gray900, fontVariantNumeric: "tabular-nums" }}>{value(t.label, t.value)}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {!GROUPS.some(([k]) => (d.summary?.[k] || []).length) && <div style={{ fontSize: 13, color: C.gray500 }}>Nothing read yet — press “Read Flipkart now”.</div>}
          </div>
        </section>
      )}

      {d.is_admin && (
        <section style={{ ...S.card, padding: "12px 16px", fontSize: 13, color: C.gray600, lineHeight: 1.6 }}>
          <b style={{ color: C.gray900 }}>Orders, accepting and labels</b> come next, once their Seller Hub requests are added: the orders lists
          (pending → shipped), accepting / confirming, labels and manifest, returns, payments and stock.
        </section>
      )}
    </div>
  );
}
