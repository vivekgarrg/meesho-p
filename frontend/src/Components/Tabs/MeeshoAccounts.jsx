import React, { useState, useEffect, useRef } from "react";
import { API, C, S, btn } from "../../App";
import { CircularProgress } from "@mui/material";
import { ago, StatusDot } from "./MeeshoUI";

/*
 * Meesho accounts on the Meesho page: the banner when a session breaks, the
 * Reconnect dialog (password — or a session pasted from the browser when
 * Meesho blocks the server's login), and the accounts' health at a glance.
 */

export const accountTone = (b) => (!b.status ? "neutral" : b.needs_login ? "bad" : b.logging_in ? "info"
  : b.status === "DISABLED" ? "neutral" : "good");
export const accountWord = (b) => (!b.status ? "Not connected" : b.needs_login ? "Session expired" : b.logging_in ? "Logging in…"
  : b.status === "DISABLED" ? "Disconnected" : "Connected");

/** Red banner(s) for every business whose Meesho session broke. */
export function SessionAlerts({ businesses, isAdmin, onReconnect }) {
  const broken = businesses.filter((b) => b.needs_login);
  if (!broken.length) return null;
  return (
    <div role="alert" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {broken.map((b) => (
        <div key={b.business_id} style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", padding: "12px 16px",
          borderRadius: 12, background: C.redLight, border: `1.5px solid ${C.redBorder}` }}>
          <span aria-hidden style={{ fontSize: 20 }}>🔒</span>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontWeight: 800, color: C.red, fontSize: 14 }}>{b.business_name}: the Meesho session has expired</div>
            <div style={{ fontSize: 12.5, color: "#991B1B", marginTop: 2 }}>
              Orders, stock and payments for this business aren't updating, and nothing is accepted or linked, until it's logged in again.
              {b.status_message ? <span style={{ opacity: 0.8 }}> ({String(b.status_message).slice(0, 140)})</span> : null}
            </div>
          </div>
          {isAdmin ? (
            <button onClick={() => onReconnect(b)} style={{ ...btn("primary", "md"), background: C.red, borderColor: C.red, minWidth: 130 }}>Reconnect</button>
          ) : <span style={{ fontSize: 12.5, fontWeight: 700, color: C.red }}>Ask an admin to reconnect it.</span>}
        </div>
      ))}
    </div>
  );
}

/** Log a business's Meesho account in again — and watch it until it's connected or refused. */
export function ReconnectDialog({ business, onClose, onDone }) {
  const [mode, setMode] = useState("password");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [session, setSession] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [watching, setWatching] = useState(false);
  const [state, setState] = useState(null);       // the account as the overview sees it while logging in
  const first = useRef(null);

  useEffect(() => { first.current?.focus(); }, [mode]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  // Follow the login the worker is doing.
  useEffect(() => {
    if (!watching) return undefined;
    let stop = false;
    const tick = async () => {
      const r = await fetch(`${API}/meesho-orders/overview/`).catch(() => null);
      const d = r?.ok ? await r.json() : null;
      const b = d?.businesses.find((x) => x.business_id === business.business_id);
      if (stop || !b) return;
      setState(b);
      if (b.status === "ACTIVE") { setWatching(false); onDone(); }
      else if (b.needs_login) { setWatching(false); setError(b.status_message || "Meesho refused the login."); }
    };
    tick();
    const t = setInterval(tick, 2500);
    return () => { stop = true; clearInterval(t); };
  }, [watching, business.business_id, onDone]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null); setState(null);
    const body = mode === "session" ? { session } : { password, ...(phone ? { phone_number: phone } : {}) };
    try {
      const r = await fetch(`${API}/meesho-orders/accounts/${business.business_id}/login/`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setError(d.error || "Couldn't start the login.");
      else setWatching(true);
    } catch { setError("Network error."); }
    finally { setBusy(false); }
  };

  const done = state?.status === "ACTIVE";
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="reconnect-title" onClick={() => !busy && !watching && onClose()}
      style={{ position: "fixed", inset: 0, zIndex: 4000, background: "rgba(15,23,42,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...S.card, width: "100%", maxWidth: 480, padding: 0, overflow: "hidden", boxShadow: "0 24px 60px rgba(15,23,42,.3)" }}>
        <div style={{ padding: "18px 20px 12px", borderBottom: `1px solid ${C.gray100}` }}>
          <h2 id="reconnect-title" style={{ margin: 0, fontSize: 17, fontWeight: 900 }}>Reconnect {business.business_name}</h2>
          <p style={{ margin: "4px 0 0", fontSize: 12.5, color: C.gray500 }}>
            Log in to this business's Meesho supplier account again. The password is saved encrypted, so the sync can log in by itself next time.
          </p>
        </div>
        <div style={{ display: "flex", gap: 4, padding: "12px 20px 0" }}>
          {[["password", "Phone & password"], ["session", "Paste a browser session"]].map(([k, label]) => (
            <button key={k} type="button" onClick={() => { setMode(k); setError(null); }} disabled={watching}
              style={{ ...btn(mode === k ? "primary" : "ghost", "sm") }}>{label}</button>
          ))}
        </div>
        <form onSubmit={submit} style={{ padding: "14px 20px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
          {mode === "password" ? (
            <>
              <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12.5, fontWeight: 700, color: C.gray600 }}>
                Meesho login phone number
                <input ref={first} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" disabled={watching}
                  placeholder={business.phone ? `Saved: ${business.phone} — leave blank to keep` : "10-digit mobile number"} style={S.inp} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12.5, fontWeight: 700, color: C.gray600 }}>
                Password
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" disabled={watching}
                  placeholder={business.has_password ? "Leave blank to try the saved one again" : "The Meesho password"} style={S.inp}
                  required={!business.has_password} />
              </label>
            </>
          ) : (
            <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12.5, fontWeight: 700, color: C.gray600 }}>
              Session from your browser
              <span style={{ fontWeight: 500, color: C.gray500 }}>
                For when Meesho blocks the server's login. In Chrome, log in to supplier.meesho.com, open DevTools → Network, right-click any
                supplier.meesho.com/api/… request → Copy → Copy as cURL, and paste it here.
              </span>
              <textarea ref={first} value={session} onChange={(e) => setSession(e.target.value)} rows={5} required spellCheck={false} disabled={watching}
                placeholder="curl 'https://supplier.meesho.com/api/…' -H 'cookie: connect.sid=…'" style={{ ...S.inp, fontFamily: "monospace", fontSize: 12 }} />
            </label>
          )}

          {watching && !done && (
            <div role="status" style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 12px", borderRadius: 10, background: "#EFF6FF", color: "#1E3A8A", fontSize: 13, fontWeight: 700 }}>
              <CircularProgress size={16} style={{ color: "#2563EB" }} />
              {mode === "session" ? "Checking the session with Meesho…" : "Logging in to Meesho…"} {state?.status_message && state.status_message !== "Logging in…" ? `(${state.status_message})` : ""}
            </div>
          )}
          {error && <div role="alert" style={{ padding: "10px 12px", borderRadius: 10, background: C.redLight, color: C.red, fontSize: 13, fontWeight: 700 }}>{error}</div>}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
            <button type="button" onClick={onClose} disabled={busy} style={btn("ghost", "md")}>{watching ? "Close" : "Cancel"}</button>
            <button type="submit" disabled={busy || watching} style={{ ...btn("primary", "md"), minWidth: 140, opacity: busy || watching ? 0.6 : 1 }}>
              {busy ? "Sending…" : mode === "session" ? "Use this session" : "Log in"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Every business's Meesho account: connected?, and when each kind of data was last read. */
export function AccountsHealth({ businesses, isAdmin, onReconnect, compact = false }) {
  const cell = { ...S.td, whiteSpace: "nowrap" };
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead><tr>{["Business", "Meesho account", "Orders", "Inventory", "Payments", ""].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
        <tbody>
          {businesses.map((b) => {
            const line = (x) => !x ? "—" : x.status === "FAILED" ? <StatusDot tone="bad">failed · {ago(x.at)}</StatusDot>
              : <StatusDot tone={x.at ? "good" : "neutral"}>{ago(x.at)}</StatusDot>;
            return (
              <tr key={b.business_id}>
                <td style={{ ...cell, fontWeight: 800 }}>{b.business_name}{b.supplier_name && !compact ? <div style={{ fontSize: 11.5, color: C.gray400, fontWeight: 500 }}>{b.supplier_name}</div> : null}</td>
                <td style={cell}><StatusDot tone={accountTone(b)}>{accountWord(b)}</StatusDot>{b.phone && !compact ? <div style={{ fontSize: 11.5, color: C.gray400 }}>{b.phone}</div> : null}</td>
                <td style={cell}>{b.status ? line({ at: b.orders?.at, status: b.orders?.status }) : "—"}</td>
                <td style={cell}>{b.status ? line(b.inventory) : "—"}</td>
                <td style={cell}>{b.status ? line(b.payments) : "—"}</td>
                <td style={{ ...cell, textAlign: "right" }}>
                  {isAdmin && b.status && b.status !== "DISABLED" && (
                    <button onClick={() => onReconnect(b)} style={{ ...btn(b.needs_login ? "primary" : "ghost", "sm"), ...(b.needs_login ? { background: C.red, borderColor: C.red } : {}) }}>
                      {b.needs_login ? "Reconnect" : "Log in again"}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
