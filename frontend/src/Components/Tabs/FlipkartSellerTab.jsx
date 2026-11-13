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
    const r = await call("connect/", "POST", { business: d.business, username, password, location_id: location });
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
    const r = await call("otp/", "POST", { business: d.business, otp });
    setBusy(false);
    if (!r.ok) setErr(r.data.error || "OTP not accepted.");
    onDone(r.data);
  };
  const resend = async () => {
    setBusy(true); setErr(null);
    const r = await call("connect/", "POST", { business: d.business, username: d.username });
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

// Seller Hub's Forward Orders tabs. "To accept" and "Upcoming" are one list there (pendingToAccept):
// an order is upcoming until its dispatch-after time, then it's to accept.
const ORDER_TABS = [
  { key: "accept", label: "To accept", count: "pendingToAccept", list: "pendingToAccept", tone: "#B45309" },
  { key: "upcoming", label: "Upcoming", count: "upcoming", list: "pendingToAccept", tone: "#7C3AED" },
  { key: "pack", label: "To pack", count: "pendingToPack", list: "pendingToPack", tone: "#2874F0" },
  { key: "dispatch", label: "To dispatch", count: "pendingToDispatch", list: "pendingToDispatch", tone: "#DC2626" },
  { key: "transit", label: "In transit", count: "inTransit", list: "inTransit", tone: "#0F766E" },
  { key: "service", label: "Pending service", count: "pendingService", list: "pendingService", tone: "#64748B" },
  { key: "completed", label: "Completed", count: "completed", list: null, tone: "#15803D" },
];
const istDate = (s) => (s ? new Date(/[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : `${s}+05:30`) : null);   // Seller Hub's times are IST
const dayTime = (s) => { const d = istDate(s); return d ? d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—"; };
const isUpcoming = (o) => { const d = istDate(o.dispatch_after); return !!d && d > new Date(); };

/** Seller Hub's Forward Orders, as last read: a tile per tab, the SKUs to pack, and the orders. */
function FlipkartOrders({ accounts, mobile }) {
  const [tab, setTab] = useState("dispatch");
  const [q, setQ] = useState("");
  const [biz, setBiz] = useState(null);          // one business, or all of them
  const read = accounts.filter((a) => a.orders_at);
  const shown = read.filter((a) => !biz || a.business === biz);
  // Every business's orders together (as Meesho's), each order marked with its business.
  const counts = {};
  const tabs = {};
  for (const a of shown) {
    for (const [k, v] of Object.entries(a.orders?.counts || {})) counts[k] = (counts[k] || 0) + v;
    for (const [k, v] of Object.entries(a.orders?.tabs || {})) tabs[k] = [...(tabs[k] || []), ...v.map((r) => ({ ...r, business_name: a.business_name }))];
  }
  const o = { cut: shown.flatMap((a) => a.orders?.cut || []) };
  const ordersAt = shown.map((a) => a.orders_at).sort()[0];
  const t = ORDER_TABS.find((x) => x.key === tab);
  const base = t.list ? (tabs[t.list] || []) : [];
  const listed = t.key === "accept" ? base.filter((x) => !isUpcoming(x)) : t.key === "upcoming" ? base.filter(isUpcoming) : base;
  const needle = q.trim().toLowerCase();
  const rows = listed.filter((x) => !needle || [x.order_id, x.tracking_id, ...x.items.map((i) => `${i.sku} ${i.title}`)]
    .some((v) => String(v || "").toLowerCase().includes(needle)));
  const bySku = {};
  for (const r of listed) for (const i of r.items) {
    const k = i.sku || i.title;
    bySku[k] = bySku[k] || { sku: k, image: i.image, qty: 0, orders: 0 };
    bySku[k].qty += i.qty; bySku[k].orders += 1;
  }
  const skus = Object.values(bySku).sort((a, b) => b.qty - a.qty);
  const now = new Date();
  if (!read.length) return null;
  return (
    <section style={{ ...S.card, padding: 16, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{ fontWeight: 900, fontSize: 15, color: C.gray900, flex: 1 }}>Flipkart orders</span>
        <span style={{ fontSize: 12, color: C.gray400 }}>read {when(ordersAt)}</span>
      </div>
      {read.length > 1 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button onClick={() => setBiz(null)} aria-pressed={!biz} style={{ ...btn(biz ? "ghost" : "primary", "sm"), minHeight: 34 }}>All businesses</button>
          {read.map((a) => (
            <button key={a.business} onClick={() => setBiz(biz === a.business ? null : a.business)} aria-pressed={biz === a.business}
              style={{ ...btn(biz === a.business ? "primary" : "ghost", "sm"), minHeight: 34 }}>
              {a.business_name} · {(a.orders?.counts?.pendingToDispatch || 0) + (a.orders?.counts?.pendingToPack || 0)} to ship</button>
          ))}
        </div>
      )}
      <div role="tablist" aria-label="Order tabs" style={{ display: "grid", gap: 8, gridTemplateColumns: mobile ? "repeat(2, minmax(0, 1fr))" : "repeat(auto-fill, minmax(140px, 1fr))" }}>
        {ORDER_TABS.map((x) => (
          <button key={x.key} role="tab" aria-selected={tab === x.key} onClick={() => setTab(x.key)}
            style={{ textAlign: "left", cursor: "pointer", fontFamily: "inherit", borderRadius: 12, padding: "10px 12px", minWidth: 0,
              border: `2px solid ${tab === x.key ? x.tone : C.gray200}`, background: tab === x.key ? C.white : C.gray50 }}>
            <div style={{ fontSize: 24, fontWeight: 900, color: C.gray900, fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>{counts[x.count] ?? 0}</div>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: x.tone }}>{x.label}</div>
          </button>
        ))}
      </div>
      {(o.cut || []).length > 0 && <div style={{ fontSize: 12.5, color: "#92400E" }}>Some tabs have more orders than are read here — Seller Hub has them all.</div>}
      {!t.list ? (
        <div style={{ fontSize: 13, color: C.gray500 }}>Completed orders are counted only.</div>
      ) : (
        <>
          {skus.length > 0 && (
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: C.gray500, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6 }}>By SKU</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {skus.map((x) => (
                  <button key={x.sku} onClick={() => setQ(q === x.sku ? "" : x.sku)} aria-pressed={q === x.sku}
                    style={{ display: "inline-flex", gap: 6, alignItems: "center", border: `1.5px solid ${q === x.sku ? t.tone : C.gray200}`, background: C.white,
                      borderRadius: 999, padding: "3px 10px 3px 3px", cursor: "pointer", fontFamily: "inherit", maxWidth: "100%" }}>
                    {x.image ? <img src={x.image} alt="" style={{ width: 24, height: 24, borderRadius: 99, objectFit: "cover" }} /> : null}
                    <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 800, color: C.gray800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.sku}</span>
                    <span style={{ fontSize: 12, fontWeight: 900, color: t.tone }}>×{x.qty}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order id, SKU, tracking id…" aria-label="Search orders" style={{ ...S.inp, minHeight: 40 }} />
          <div style={{ border: `1px solid ${C.gray100}`, borderRadius: 12, overflow: "hidden" }}>
            {rows.length === 0 ? <div style={{ padding: 20, textAlign: "center", fontSize: 13, color: C.gray500 }}>No orders here.</div> : rows.map((r) => {
              const by = istDate(r.dispatch_by);
              const late = by && by < now && ["pendingToPack", "pendingToDispatch", "pendingToAccept"].includes(r.tab);
              const today = by && by.toDateString() === now.toDateString();
              return (
                <div key={r.shipment_id || r.order_id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "9px 12px", borderBottom: `1px solid ${C.gray100}`, minWidth: 0 }}>
                  {r.items[0]?.image ? <img src={r.items[0].image} alt="" loading="lazy" style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
                    : <div style={{ width: 44, height: 44, borderRadius: 8, background: C.gray100, flexShrink: 0 }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {r.items.map((i) => (
                      <div key={i.sku + i.fsn} style={{ fontSize: 13.5, fontWeight: 800, color: C.gray900, wordBreak: "break-word" }}>
                        <span style={{ fontFamily: "monospace" }}>{i.sku}</span>
                        <span style={{ marginLeft: 6, color: i.qty > 1 ? "#fff" : "#2874F0", background: i.qty > 1 ? C.red : "#EFF6FF", borderRadius: 6, padding: "0 6px", fontSize: 12.5 }}>×{i.qty}</span>
                      </div>
                    ))}
                    <div style={{ fontSize: 12, color: C.gray500, marginTop: 2, wordBreak: "break-all" }}>
                      {[read.length > 1 && !biz && r.business_name, r.order_id, r.tracking_id && `${r.courier || "Courier"} ${r.tracking_id}`, r.tier].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0, fontSize: 12, color: C.gray600, lineHeight: 1.5 }}>
                    {r.price != null && <div style={{ fontWeight: 900, fontSize: 13.5, color: C.gray900 }}>₹{Number(r.price).toLocaleString("en-IN")}</div>}
                    {r.tab === "pendingToAccept" && isUpcoming(r)
                      ? <div>from {dayTime(r.dispatch_after)}</div>
                      : <div style={{ fontWeight: late || today ? 800 : 600, color: late ? C.red : today ? "#B45309" : C.gray600 }}>
                          {late ? "late · " : ""}dispatch by {dayTime(r.dispatch_by)}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

const lbl = { display: "flex", flexDirection: "column", gap: 5, fontSize: 12.5, fontWeight: 800, color: C.gray600, minWidth: 0 };

/** One business's Seller Hub login: where it stands, logging it in (password → OTP), and its dashboard. */
function AccountCard({ d, isAdmin, mobile, onState }) {
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [relogin, setRelogin] = useState(false);
  const got = (data) => { if (data?.accounts) { onState(data); setRelogin(false); } };
  const refresh = async () => {
    setBusy(true); setErr(null);
    const r = await call("refresh/", "POST", { business: d.business });
    setBusy(false);
    if (!r.ok) setErr(r.data.error || "Couldn't read Flipkart.");
    got(r.data);
  };
  const disconnect = async () => {
    if (!window.confirm(`Disconnect Flipkart for ${d.business_name}? Its saved login and session are deleted from the server.`)) return;
    const r = await call("", "DELETE", { business: d.business });
    if (!r.ok) setErr(r.data.error || "Couldn't disconnect.");
    got(r.data);
  };
  const showLogin = isAdmin && (!d.status || ["FAILED", "EXPIRED", "NEW"].includes(d.status) || relogin);
  const [open, setOpen] = useState(!d.connected);
  const groups = GROUPS.filter(([k]) => (d.summary?.[k] || []).length);

  return (
    <section style={{ ...S.card, padding: 16, borderTop: `4px solid ${d.connected ? "#2874F0" : C.gray300}`, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontWeight: 900, fontSize: 16, color: C.gray900, flex: "1 1 200px", minWidth: 0 }}>
          {d.business_name}
          {d.username && <span style={{ fontWeight: 600, fontSize: 12.5, color: C.gray500 }}> · {d.username}</span>}
        </span>
        <Badge status={d.status} />
        {d.status && <button onClick={() => setOpen(!open)} aria-expanded={open} style={{ ...btn("ghost", "sm"), minHeight: 32 }}>{open ? "▾ Less" : "▸ More"}</button>}
      </div>
      {d.connected && groups.length > 0 && (
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: mobile ? "repeat(2, minmax(0, 1fr))" : "repeat(auto-fill, minmax(150px, 1fr))" }}>
          {groups.flatMap(([k]) => d.summary[k]).map((t) => (
            <div key={t.label} style={{ border: `1px solid ${C.gray200}`, borderRadius: 12, padding: "8px 10px", minWidth: 0 }}>
              <div style={{ fontSize: 11.5, color: C.gray500, fontWeight: 700, textTransform: "capitalize", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pretty(t.label)}</div>
              <div style={{ fontSize: 19, fontWeight: 900, color: C.gray900, fontVariantNumeric: "tabular-nums" }}>{value(t.label, t.value)}</div>
            </div>
          ))}
        </div>
      )}
      {d.status_message && <div style={{ fontSize: 13, color: d.status === "OTP_SENT" || d.status === "ACTIVE" ? "#92400E" : C.red, fontWeight: 700 }}>
        {d.status === "ACTIVE" ? "Some figures couldn't be read: " : ""}{d.status_message}</div>}
      {err && <div role="alert" style={{ fontSize: 13, color: C.red, fontWeight: 700 }}>✕ {err}</div>}
      {open && d.status && (
        <div style={{ display: "grid", gap: "4px 14px", gridTemplateColumns: mobile ? "1fr" : "repeat(3, minmax(0, 1fr))", fontSize: 13, color: C.gray600 }}>
          {d.seller_id && <span>Seller id: <b style={{ fontFamily: "monospace", color: C.gray900 }}>{d.seller_id}</b></span>}
          <span>Pickup location: <b style={{ fontFamily: "monospace", color: C.gray900 }}>{d.location_id || "not set"}</b></span>
          <span>Logged in: {when(d.last_login_at)}</span>
          <span>Last read: {when(d.last_check_at)}</span>
        </div>
      )}
      {!isAdmin && !d.connected && <div style={{ fontSize: 13, color: C.gray500 }}>Not connected — an admin connects Flipkart here.</div>}
      {isAdmin && d.status === "OTP_SENT" && !relogin && <OtpForm d={d} onDone={got} setErr={setErr} />}
      {showLogin && (open || !d.status) && <ConnectForm d={d} onDone={got} setErr={setErr} />}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {d.connected && <button onClick={refresh} disabled={busy} style={{ ...btn("primary", "sm"), opacity: busy ? 0.6 : 1 }}>{busy ? "Reading Flipkart…" : "↻ Read now"}</button>}
        {isAdmin && d.status && !showLogin && open && <button onClick={() => setRelogin(true)} style={btn("ghost", "sm")}>Log in again</button>}
        {isAdmin && relogin && <button onClick={() => setRelogin(false)} style={btn("ghost", "sm")}>Cancel</button>}
        {isAdmin && d.status && open && <button onClick={disconnect} style={{ ...btn("ghost", "sm"), color: C.red }}>Disconnect</button>}
      </div>
    </section>
  );
}

export function FlipkartSellerTab() {
  const mobile = useIsMobile();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    const r = await call("");
    if (r.ok && Array.isArray(r.data.accounts)) setD(r.data);
    else setErr(r.data.error || r.data.detail || "Couldn't read the Flipkart connections.");
  }, []);
  // Read again whenever what's held isn't this page's shape (e.g. kept over from an older version of it).
  const ready = !!d && Array.isArray(d.accounts);
  useEffect(() => { if (!ready) load(); }, [ready, load]);
  const anyConnected = (d?.accounts || []).some((a) => a.connected);
  // While any is connected, read again every minute (the server's own refresh runs every 10).
  useEffect(() => {
    if (!anyConnected) return undefined;
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [anyConnected, load]);

  const refreshAll = async () => {
    setBusy(true); setErr(null);
    const r = await call("refresh/", "POST", {});
    setBusy(false);
    if (!r.ok) setErr(r.data.error || "Couldn't read Flipkart.");
    if (r.data?.accounts) setD(r.data);
  };

  if (!ready) {
    return err ? <div role="alert" style={{ ...S.card, color: C.red, fontWeight: 700 }}>✕ {err}</div>
      : <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><CircularProgress style={{ color: "#2874F0" }} /></div>;
  }
  // Businesses with a login first; the others on request (an admin may have many).
  const withLogin = d.accounts.filter((a) => a.status);
  const without = d.accounts.filter((a) => !a.status);
  const cards = showAll || withLogin.length === 0 ? [...withLogin, ...without] : withLogin;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 1100, minWidth: 0 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 320px", minWidth: 0 }}>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: C.gray900, margin: 0 }}>Flipkart Seller Hub</h1>
          <p style={{ fontSize: 13, color: C.gray500, margin: "4px 0 0", maxWidth: 760 }}>
            Each business's own Seller Hub login, held on the server (encrypted) — Flipkart asks for an OTP at every login. Once in, each is kept alive
            and read every 10 minutes, and their orders show together below.
          </p>
        </div>
        {withLogin.filter((a) => a.connected).length > 1 && (
          <button onClick={refreshAll} disabled={busy} style={{ ...btn("primary", "sm"), opacity: busy ? 0.6 : 1 }}>{busy ? "Reading Flipkart…" : "↻ Read all now"}</button>
        )}
      </div>
      {err && <div role="alert" style={{ fontSize: 13, color: C.red, fontWeight: 700 }}>✕ {err}</div>}

      {cards.map((a) => <AccountCard key={a.business} d={a} isAdmin={d.is_admin} mobile={mobile} onState={setD} />)}
      {d.is_admin && without.length > 0 && withLogin.length > 0 && (
        <button onClick={() => setShowAll(!showAll)} style={{ ...btn("ghost", "md"), alignSelf: "flex-start" }}>
          {showAll ? "Hide businesses without Flipkart" : `+ Connect Flipkart for another business (${without.length})`}
        </button>
      )}

      <FlipkartOrders accounts={d.accounts.filter((a) => a.connected || a.orders_at)} mobile={mobile} />

      {d.is_admin && (
        <section style={{ ...S.card, padding: "12px 16px", fontSize: 13, color: C.gray600, lineHeight: 1.6 }}>
          <b style={{ color: C.gray900 }}>Accepting, labels and the manifest</b> come next, once their Seller Hub requests are added.
        </section>
      )}
    </div>
  );
}
