import React, { useState, useEffect, useCallback } from "react";
import { LatestLabels } from "./MeeshoAutomation";
import { AcceptMode } from "../shared/AcceptMode";
import { API, C, S, btn, useIsMobile } from "../../App";
import { CircularProgress } from "@mui/material";

/*
 * Flipkart → Seller Hub: connect the business's Flipkart Seller Hub login
 * (password, then the OTP Flipkart sends — it asks for one at every login), and
 * see its dashboard as last read. The session lives on the server, encrypted;
 * the sync reads it every 10 minutes, which keeps it alive. When Flipkart ends
 * it the page says so — log in again with a new OTP. Server: flipkart_seller.py.
 * Orders and payments go into the Flipkart tables and are reconciled: flipkart_sync.py.
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
  return { ok: r.ok, status: r.status, data: j };
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
                  <div style={{ textAlign: "right", flexShrink: 0, maxWidth: "38%", fontSize: 12, color: C.gray600, lineHeight: 1.5 }}>
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

// ── Acting on the orders: accept, then (labels printed in Seller Hub) mark RTD ───────────
const STAGE_INFO = {
  accept: { title: "To accept", verb: "Accept", path: "accept/", tone: "#B45309" },
  label: { title: "Labels to print", tone: "#7C3AED" },
  rtd: { title: "Ready to mark RTD", verb: "Mark RTD", path: "rtd/", tone: "#DC2626" },
};

function FlipkartActions({ accounts, mobile, onState }) {
  const [biz, setBiz] = useState(accounts[0]?.business);
  const [w, setW] = useState(null);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const name = accounts.find((a) => a.business === biz)?.business_name || "";
  const check = useCallback(async () => {
    if (!biz) return;
    setBusy("check"); setMsg(null);
    const r = await call(`actions/?business=${biz}`);
    setBusy(null);
    if (r.ok) setW(r.data); else { setW(null); setMsg({ bad: true, text: r.data.error || "Couldn't read Seller Hub." }); }
  }, [biz]);
  useEffect(() => { setW(null); check(); }, [check]);
  if (!accounts.length) return null;

  const act = async (stage, groups) => {
    const info = STAGE_INFO[stage];
    const list = groups || w[stage].filter((g) => stage !== "accept" || !g.missing_dimensions);
    const n = list.reduce((t, g) => t + g.shipments, 0);
    if (!window.confirm(`${info.verb} ${n} Flipkart order${n === 1 ? "" : "s"} for ${name} in Seller Hub now?`)) return;
    setBusy(stage); setMsg(null);
    const r = await call(info.path, "POST", { business: biz, groups: groups ? groups.map((g) => g.group_id) : undefined });
    setBusy(null);
    if (r.data?.accounts) onState(r.data);
    if (!r.ok && r.status !== 207 && !r.data.results) { setMsg({ bad: true, text: r.data.error || `Couldn't ${info.verb.toLowerCase()}.` }); return; }
    const failed = (r.data.results || []).flatMap((x) => x.failed || []);
    const errors = r.data.errors || [];
    setMsg({ bad: failed.length > 0 || errors.length > 0,
      text: `${info.verb}: ${(r.data.shipments || 0) - failed.length} of ${r.data.shipments || 0} done.`
        + (failed.length ? ` Flipkart refused ${failed.length}: ${[...new Set(failed.map((f) => f.error))].join("; ")}.` : "")
        + (errors.length ? ` ${errors.join("; ")}` : "")
        + ((r.data.skipped || []).length ? ` ${r.data.skipped.length} group(s) have no package size — accept those in Seller Hub.` : "") });
    check();
  };

  return (
    <section style={{ ...S.card, padding: 16, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontWeight: 900, fontSize: 15, color: C.gray900, flex: 1 }}>Accept & mark RTD</span>
        <button onClick={check} disabled={!!busy} style={{ ...btn("ghost", "sm"), opacity: busy ? 0.6 : 1 }}>{busy === "check" ? "Reading Seller Hub…" : "↻ Check Seller Hub"}</button>
      </div>
      {accounts.length > 1 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {accounts.map((a) => (
            <button key={a.business} onClick={() => setBiz(a.business)} aria-pressed={biz === a.business}
              style={{ ...btn(biz === a.business ? "primary" : "ghost", "sm"), minHeight: 34 }}>{a.business_name}</button>
          ))}
        </div>
      )}
      {msg && <div role="status" style={{ fontSize: 13, fontWeight: 700, color: msg.bad ? C.red : "#15803D" }}>{msg.bad ? "✕" : "✓"} {msg.text}</div>}
      {!w ? (busy === "check" && <div style={{ display: "flex", justifyContent: "center", padding: 16 }}><CircularProgress size={22} style={{ color: "#2874F0" }} /></div>) : (
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: mobile ? "1fr" : "repeat(3, minmax(0, 1fr))" }}>
          {Object.entries(STAGE_INFO).map(([stage, info]) => {
            const list = w[stage] || [];
            const n = list.reduce((t, g) => t + g.shipments, 0);
            return (
              <div key={stage} style={{ border: `1px solid ${C.gray200}`, borderTop: `3px solid ${info.tone}`, borderRadius: 12, padding: 10, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontWeight: 900, color: C.gray900, flex: 1 }}>{info.title}</span>
                  <span style={{ fontSize: 20, fontWeight: 900, color: info.tone, fontVariantNumeric: "tabular-nums" }}>{n}</span>
                </div>
                {stage === "label" && n > 0 && <div style={{ fontSize: 12.5, color: C.gray600 }}>Print these labels in Seller Hub; they then show under "Ready to mark RTD".</div>}
                {list.length === 0 ? <div style={{ fontSize: 12.5, color: C.gray500 }}>Nothing waiting.</div> : list.map((g) => (
                  <div key={`${g.group_id}-${g.dispatch_by || "breached"}`} style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
                    {g.items[0]?.image ? <img src={g.items[0].image} alt="" loading="lazy" style={{ width: 32, height: 32, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} /> : null}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: "monospace", fontSize: 12.5, fontWeight: 800, color: C.gray900, wordBreak: "break-word" }}>{g.items.map((i) => i.sku).join(", ")} ×{g.shipments}</div>
                      <div style={{ fontSize: 11.5, color: g.missing_dimensions ? C.red : C.gray500 }}>
                        {g.missing_dimensions ? "No package size — accept in Seller Hub" : g.breached ? "past dispatch-by — breached" : `dispatch by ${dayTime(g.dispatch_by)}`}</div>
                    </div>
                    {info.verb && !(stage === "accept" && g.missing_dimensions) && (
                      <button onClick={() => act(stage, [g])} disabled={!!busy} style={{ ...btn("ghost", "sm"), minHeight: 30, opacity: busy ? 0.6 : 1 }}>{info.verb}</button>
                    )}
                  </div>
                ))}
                {info.verb && list.length > 1 && (
                  <button onClick={() => act(stage)} disabled={!!busy} style={{ ...btn("primary", "sm"), opacity: busy ? 0.6 : 1 }}>
                    {busy === stage ? "Working…" : `${info.verb} all ${n}`}</button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── Payments: what Flipkart paid, matched against what it paid for ───────────────────────
const rupees = (v) => (v == null ? "—" : `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
const day = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—");
const PAYOUT_STATE = {
  matched: { icon: "✓", label: "Matches its orders", fg: "#15803D", bg: "#DCFCE7" },
  other_charges: { icon: "!", label: "Differs — upload the Settlement Report for its ads / fines", fg: "#B45309", bg: "#FEF3C7" },
  mismatch: { icon: "✕", label: "Doesn't add up", fg: "#B91C1C", bg: "#FEE2E2" },
  not_read: { icon: "…", label: "Its orders not read yet", fg: "#475569", bg: "#F1F5F9" },
  in_progress: { icon: "→", label: "On its way to the bank", fg: "#1D4ED8", bg: "#DBEAFE" },
};
const ORDER_STATES = [
  ["paid", "Paid", "#15803D"], ["coming", "Payment coming", "#1D4ED8"], ["on_the_way", "Not delivered yet", "#475569"],
  ["delivered_unpaid", "Delivered, not paid", "#B91C1C"], ["returned", "Returned", "#B45309"], ["cancelled", "Cancelled", "#64748B"],
];

function Tile({ label, value, sub, tone }) {
  return (
    <div style={{ border: `1px solid ${C.gray200}`, borderRadius: 12, padding: "8px 10px", minWidth: 0 }}>
      <div style={{ fontSize: 11.5, color: tone || C.gray500, fontWeight: 800 }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 900, color: C.gray900, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: C.gray500 }}>{sub}</div>}
    </div>
  );
}

function FlipkartPayments({ accounts, mobile }) {
  const [biz, setBiz] = useState(accounts[0]?.business);
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const stamp = accounts.find((a) => a.business === biz)?.sync_at;   // read again when the sync has written
  useEffect(() => {
    if (!biz) return;
    let live = true;
    setErr(null);
    call(`reconcile/?business=${biz}`).then((r) => {
      if (!live) return;
      if (r.ok) setD(r.data); else setErr(r.data.error || "Couldn't read the payments.");
    });
    return () => { live = false; };
  }, [biz, stamp]);
  if (!accounts.length) return null;
  const mine = d && d.business === biz ? d : null;
  const payouts = mine ? (showAll ? mine.payouts : mine.payouts.slice(0, 12)) : [];
  return (
    <section style={{ ...S.card, padding: 16, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{ fontWeight: 900, fontSize: 15, color: C.gray900, flex: 1 }}>Flipkart payments</span>
        {mine && <span style={{ fontSize: 12, color: C.gray400 }}>last {mine.days} days · written to the tables {when(mine.sync_at)}</span>}
      </div>
      {accounts.length > 1 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {accounts.map((a) => (
            <button key={a.business} onClick={() => setBiz(a.business)} aria-pressed={biz === a.business}
              style={{ ...btn(biz === a.business ? "primary" : "ghost", "sm"), minHeight: 34 }}>{a.business_name}</button>
          ))}
        </div>
      )}
      {err && <div role="alert" style={{ fontSize: 13, color: C.red, fontWeight: 700 }}>✕ {err}</div>}
      {!mine ? (!err && <div style={{ display: "flex", justifyContent: "center", padding: 20 }}><CircularProgress size={24} style={{ color: "#2874F0" }} /></div>) : (
        <>
          {mine.sync?.refused && <div role="alert" style={{ fontSize: 13, color: C.red, fontWeight: 700 }}>✕ {mine.sync.message}</div>}
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: mobile ? "repeat(2, minmax(0, 1fr))" : "repeat(auto-fill, minmax(170px, 1fr))" }}>
            <Tile label="Paid to the bank" value={rupees(mine.totals.transferred)} sub={`${mine.payouts.filter((p) => p.status === "paid").length} transfers`} />
            <Tile label="On its way" value={rupees(mine.totals.in_progress)} tone="#1D4ED8" />
            <Tile label="Coming (next 30 days)" value={rupees(mine.totals.upcoming)} sub={`${mine.totals.upcoming_items} order items`} tone="#1D4ED8" />
            <Tile label="Transfers that match" value={`${mine.totals.matched} of ${mine.totals.matched + mine.totals.to_check}`}
              sub={mine.totals.to_check ? `${mine.totals.to_check} to check` : "all add up"} tone={mine.totals.to_check ? "#B45309" : "#15803D"} />
          </div>

          <div>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: C.gray500, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6 }}>
              Order items since {day(mine.since)} · {mine.orders_total}</div>
            <div style={{ display: "grid", gap: 8, gridTemplateColumns: mobile ? "repeat(2, minmax(0, 1fr))" : "repeat(6, minmax(0, 1fr))" }}>
              {ORDER_STATES.map(([k, label, tone]) => (
                <Tile key={k} label={label} tone={tone} value={(mine.orders[k]?.count || 0).toLocaleString("en-IN")}
                  sub={mine.orders[k]?.amount ? rupees(mine.orders[k].amount) : null} />
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: C.gray500, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6 }}>Transfers</div>
            <div style={{ border: `1px solid ${C.gray100}`, borderRadius: 12, overflow: "hidden" }}>
              {payouts.length === 0 ? <div style={{ padding: 20, textAlign: "center", fontSize: 13, color: C.gray500 }}>No transfers read yet.</div> : payouts.map((p) => {
                const st = PAYOUT_STATE[p.state] || PAYOUT_STATE.not_read;
                return (
                  <div key={p.advice_id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: mobile ? "wrap" : "nowrap", padding: "9px 12px", borderBottom: `1px solid ${C.gray100}`, minWidth: 0 }}>
                    <div style={{ width: mobile ? "auto" : 92, flexShrink: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 900, color: C.gray900 }}>{day(p.date)}</div>
                      <div style={{ fontSize: 11.5, color: C.gray500, fontWeight: 700 }}>{p.type === "PREPAID" ? "Prepaid" : "Postpaid"}</div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: C.gray500, fontFamily: "monospace", wordBreak: "break-all" }}>{p.utr || `advice ${p.advice_id}`}</div>
                      {p.status === "paid" && (
                        <div style={{ fontSize: 12.5, color: C.gray600 }}>
                          {p.items} order items {rupees(p.items_amount)}{p.other_charges ? ` · other charges ${rupees(p.other_charges)}` : ""}
                          {(p.breakdown || []).filter((g) => g.group !== "orderItem" && g.amount).map((g) => ` · ${g.label} ${rupees(g.amount)}`).join("")}
                          {p.difference != null && Math.abs(p.difference) > 1 ? <b style={{ color: st.fg }}> · difference {rupees(p.difference)}</b> : null}
                        </div>
                      )}
                    </div>
                    <span title={st.label} style={{ fontSize: 12, fontWeight: 800, color: st.fg, background: st.bg, padding: "3px 9px", borderRadius: 999, whiteSpace: mobile ? "normal" : "nowrap", maxWidth: mobile ? "100%" : 260, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {st.icon} {st.label}</span>
                    <div style={{ width: 92, textAlign: "right", fontWeight: 900, fontSize: 14, color: C.gray900, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{rupees(p.transfer)}</div>
                  </div>
                );
              })}
            </div>
            {mine.payouts.length > 12 && <button onClick={() => setShowAll(!showAll)} style={{ ...btn("ghost", "sm"), marginTop: 6 }}>{showAll ? "Show fewer" : `Show all ${mine.payouts.length}`}</button>}
          </div>

          {mine.unpaid.length > 0 && (
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: C.red, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6 }}>
                Delivered 20+ days ago, neither paid nor coming · {mine.unpaid_count}</div>
              <div style={{ border: `1px solid ${C.gray100}`, borderRadius: 12, overflow: "hidden" }}>
                {mine.unpaid.slice(0, 50).map((o) => (
                  <div key={o.order_item_id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 12px", borderBottom: `1px solid ${C.gray100}`, minWidth: 0 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: C.gray900, fontFamily: "monospace", wordBreak: "break-word" }}>{o.sku || "—"}</div>
                      <div style={{ fontSize: 12, color: C.gray500, wordBreak: "break-all" }}>{o.order_id} · item {o.order_item_id} · ordered {day(o.order_date)}</div>
                    </div>
                    <div style={{ fontSize: 12.5, fontWeight: 800, color: C.red, flexShrink: 0 }}>{o.days} days</div>
                  </div>
                ))}
              </div>
            </div>
          )}
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
      {d.connected && d.sync_at && (d.sync?.ok ? (
        <div style={{ fontSize: 12.5, color: C.gray500 }}>
          Written to the Flipkart tables {when(d.sync_at)}: {d.sync.orders_added || 0} new orders, {d.sync.orders_status_changed || 0} moved on,
          {" "}{d.sync.payments_added || 0} new payments, {d.sync.charges_added || 0} charges (ads, fines, TDS…), {d.sync.payouts_added || 0} new transfers,
          {" "}{d.sync.upcoming || 0} coming.{d.sync.payouts_left ? ` ${d.sync.payouts_left} older transfers still to read — they follow on the next runs.` : ""}</div>
      ) : d.sync?.message ? <div style={{ fontSize: 13, color: d.sync.refused ? C.red : "#92400E", fontWeight: 700 }}>✕ Not written to the tables: {d.sync.message}</div> : null)}
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

/**
 * Flipkart's side of Orders Panel: what's to accept, pack and dispatch on every
 * connected Seller Hub, as last read, with the same actions as on Seller Hub —
 * logins and payments stay on that page.
 */
/** Seller Hub's accounts as last read — read again every minute (the server reads Flipkart every 10). */
function useFlipkart(every = 60000) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const load = useCallback(async () => {
    const r = await call("");
    if (r.ok && Array.isArray(r.data.accounts)) { setD(r.data); setErr(null); }
    else setErr(r.data.error || r.data.detail || "Couldn't read Flipkart.");
  }, []);
  useEffect(() => {
    load();
    if (!every) return undefined;
    const t = setInterval(load, every);
    return () => clearInterval(t);
  }, [load, every]);
  return { d, setD, err, load };
}

const Loading = ({ err }) => (err ? <div role="alert" style={{ ...S.card, color: C.red, fontWeight: 700 }}>✕ {err}</div>
  : <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><CircularProgress style={{ color: "#2874F0" }} /></div>);

const NotConnected = () => (
  <div style={{ ...S.card, padding: 24, textAlign: "center", color: C.gray500, fontSize: 13.5 }}>
    No Flipkart Seller Hub is connected yet — connect one under <a href="/business-profile?section=flipkart" style={{ color: "#2874F0", fontWeight: 700 }}>Business Settings → Flipkart setup</a>.
  </div>
);

/** Payments → Flipkart → On Flipkart now: paid, on its way and outstanding, as Seller Hub shows them (Meesho's "On Meesho now"). */
export function FlipkartLivePayments() {
  const mobile = useIsMobile();
  const { d, err } = useFlipkart();
  if (!d) return <Loading err={err} />;
  const accounts = d.accounts.filter((a) => a.connected || a.sync_at);
  return accounts.length ? <FlipkartPayments accounts={accounts} mobile={mobile} /> : <NotConnected />;
}

/** Business Settings → Flipkart setup → Automation & Telegram, on its own. */
export function FlipkartAutomationPage() {
  const { d, err } = useFlipkart(0);
  if (!d) return <Loading err={err} />;
  return <FlipkartAutomation accounts={d.accounts} isAdmin={d.is_admin} />;
}

const timeOf = (t) => { const [h, m] = t.split(":").map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }); };

/** Orders → Live on Flipkart: the automation at a glance — on or off, when it accepts and prints, what the last run did. */
function FlipkartAutoStatus() {
  const [a, setA] = useState(null);
  useEffect(() => { call("auto/").then((r) => r.ok && setA(r.data)); }, []);
  if (!a) return null;
  const times = a.label_times.map(timeOf).join(", ");
  const how = !a.enabled ? "Off — nothing is accepted or printed by itself."
    : !a.label_times.length ? "On, but no label times — add one."
      : a.accept_every ? `Accepts every ${a.accept_every} min · prints at ${times}` : `Accepts & prints together at ${times}`;
  const last = a.last_result?.results;
  return (
    <div style={{ ...S.card, padding: "10px 14px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderLeft: `5px solid ${a.enabled ? "#2874F0" : C.gray300}` }}>
      <span style={{ fontWeight: 900, fontSize: 13.5, color: C.gray900 }}>⏱ Automation</span>
      <span style={{ fontSize: 13, color: a.enabled ? C.gray700 : C.gray500 }}>{how}
        {a.enabled && a.mark_rtd ? " · marks RTD once printed" : ""}{a.enabled && a.send_labels ? " · sends to Telegram" : ""}</span>
      {last && (
        <span style={{ fontSize: 12, color: C.gray500, flexBasis: "100%" }}>
          Last {a.last_result.kind === "labels" ? "labels run" : "accept"} {fmtAt(a.last_result.at)}:{" "}
          {Object.entries(last).map(([n, r]) => `${n} — ${r.error ? `✕ ${r.error}` : (r.steps || []).join(" · ") || `accepted ${r.accepted ?? 0}`}`).join("  |  ")}
        </span>
      )}
      <a href="/business-profile?section=flipkart&part=automation" style={{ marginLeft: "auto", fontSize: 12.5, fontWeight: 800, color: "#2874F0" }}>Change →</a>
    </div>
  );
}

export function FlipkartLiveOrders() {
  const mobile = useIsMobile();
  const { d, setD, err } = useFlipkart();
  if (!d) return <Loading err={err} />;
  const connected = d.accounts.filter((a) => a.connected);
  const withOrders = d.accounts.filter((a) => a.connected || a.orders_at);
  if (!withOrders.length) return <NotConnected />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      {err && <div role="alert" style={{ fontSize: 13, color: C.red, fontWeight: 700 }}>✕ {err}</div>}
      <FlipkartAutoStatus />
      <FlipkartActions accounts={connected} mobile={mobile} onState={setD} />
      {/* The labels printed (automatically or by Run now) — print again, download, send, see what's on them. */}
      <LatestLabels platform="flipkart" emptyHint />
      <FlipkartOrders accounts={withOrders} mobile={mobile} />
    </div>
  );
}

const BLUE_FK = "#2874F0";
const fmtAt = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "never");

/** One line of what a run did, for one business. */
function RunLine({ name, r }) {
  if (r.error) return <div style={{ fontSize: 12.5, color: C.red }}><b>{name}</b>: ✕ {r.error}</div>;
  const bits = r.steps || [r.accepted != null && `Accepted ${r.accepted}`, r.skipped && `${r.skipped} need package sizes`].filter(Boolean);
  return <div style={{ fontSize: 12.5, color: C.gray700 }}><b>{name}</b>: {bits.join(" · ") || "nothing to do"}
    {r.rtd_errors?.length ? <span style={{ color: C.red }}> — {r.rtd_errors.join("; ")}</span> : null}</div>;
}

function Switch({ on, onChange, label, sub, disabled }) {
  return (
    <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.6 : 1 }}>
      <span role="switch" aria-checked={on} tabIndex={0} onClick={() => !disabled && onChange(!on)}
        onKeyDown={(e) => { if (!disabled && (e.key === " " || e.key === "Enter")) { e.preventDefault(); onChange(!on); } }}
        style={{ width: 38, height: 22, borderRadius: 11, background: on ? "#2874F0" : C.gray300, position: "relative", flexShrink: 0, marginTop: 1 }}>
        <span style={{ position: "absolute", top: 3, left: on ? 19 : 3, width: 16, height: 16, borderRadius: 8, background: "#fff", transition: "left .15s" }} />
      </span>
      <span><span style={{ fontSize: 13.5, fontWeight: 800, color: C.gray900 }}>{label}</span>
        {sub && <span style={{ display: "block", fontSize: 12, color: C.gray500 }}>{sub}</span>}</span>
    </label>
  );
}

const RTD_MODES = [
  ["scan", "When packed (scanned)", "A product group is marked RTD once every order of it is scanned at Order Scan → Flipkart scan"],
  ["print", "When labels are printed", "Straight after the labels run prints them"],
  ["off", "Never by itself", "Mark RTD in Seller Hub, or with Mark RTD now on Order Scan"],
];

/** When each business's Flipkart orders are marked Ready to Dispatch — its own setting. */
function RtdModes({ accounts, isAdmin }) {
  const [modes, setModes] = useState(() => Object.fromEntries(accounts.map((a) => [a.business, a.rtd_mode || "scan"])));
  const [err, setErr] = useState(null);
  const set = async (a, mode) => {
    const before = modes[a.business];
    setModes((m) => ({ ...m, [a.business]: mode })); setErr(null);
    const r = await call("rtd-mode/", "PATCH", { business: a.business, mode });
    if (!r.ok) { setModes((m) => ({ ...m, [a.business]: before })); setErr(r.data.error || "Couldn't save."); }
  };
  const withLogin = accounts.filter((a) => a.status);
  if (!withLogin.length) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 13.5, fontWeight: 800, color: C.gray900 }}>Mark Ready to Dispatch</span>
      {withLogin.map((a) => {
        const m = RTD_MODES.find(([k]) => k === modes[a.business]) || RTD_MODES[0];
        return (
          <label key={a.business} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.gray600 }}>{a.business_name}</span>
            <select value={modes[a.business]} disabled={!isAdmin} onChange={(e) => set(a, e.target.value)} style={{ ...S.inp, width: "auto", padding: "5px 8px" }}>
              {RTD_MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <span style={{ fontSize: 11.5, color: C.gray500 }}>{m[2]}</span>
          </label>
        );
      })}
      {err && <span style={{ fontSize: 12, color: C.red, fontWeight: 700 }}>✕ {err}</span>}
    </div>
  );
}

/**
 * Order Scan → Flipkart scan → Ready to dispatch: per business, the orders printed and waiting RTD — each
 * product group with how many of its orders are packed — and Mark RTD now. With RTD on scan, a group wholly
 * packed is marked within a minute by itself.
 */
export function FlipkartRtdBoard() {
  const mobile = useIsMobile();
  const { d, err } = useFlipkart(0);
  const [boards, setBoards] = useState({});
  const [busy, setBusy] = useState(null);
  const load = useCallback(async (biz) => {
    setBoards((b) => ({ ...b, [biz]: { ...(b[biz] || {}), loading: true } }));
    const r = await call(`rtd-scan/?business=${biz}`);
    setBoards((b) => ({ ...b, [biz]: r.ok ? r.data : { error: r.data.error || "Couldn't read Seller Hub." } }));
  }, []);
  const connected = (d?.accounts || []).filter((a) => a.connected);
  useEffect(() => {
    connected.forEach((a) => load(a.business));
    const t = setInterval(() => connected.forEach((a) => load(a.business)), 60000);
    return () => clearInterval(t);
  }, [d]); // eslint-disable-line react-hooks/exhaustive-deps
  const markNow = async (biz) => {
    setBusy(biz);
    const r = await call("rtd-scan/", "POST", { business: biz });
    setBusy(null);
    setBoards((b) => ({ ...b, [biz]: r.ok ? { ...r.data, note: `Marked ${r.data.marked} Ready to Dispatch.` } : { ...(b[biz] || {}), error: r.data.error || "Couldn't mark RTD." } }));
  };
  if (!d) return <Loading err={err} />;
  if (!connected.length) return <NotConnected />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {connected.map((a) => {
        const b = boards[a.business];
        const mode = RTD_MODES.find(([k]) => k === (b?.rtd_mode || a.rtd_mode)) || RTD_MODES[0];
        const groups = b && !b.error ? [...(b.ready || []).map((g) => ({ ...g, ready: true })), ...(b.waiting || [])] : [];
        const toPack = groups.reduce((n, g) => n + g.shipments - g.packed, 0);
        return (
          <section key={a.business} style={{ ...S.card, padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "12px 14px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderBottom: `1px solid ${C.gray100}` }}>
              <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                <div style={{ fontWeight: 900, fontSize: 15, color: C.gray900 }}>{a.business_name}</div>
                <div style={{ fontSize: 12, color: C.gray500 }}>RTD: <b style={{ color: C.gray700 }}>{mode[1]}</b> — {mode[2]}</div>
              </div>
              {b && !b.error && <span style={{ fontSize: 12.5, color: C.gray600 }}>
                <b style={{ color: "#15803D" }}>{b.marked_today ?? 0}</b> marked RTD today · <b style={{ color: toPack ? C.orange : "#15803D" }}>{toPack}</b> printed, still to pack</span>}
              <button onClick={() => markNow(a.business)} disabled={busy === a.business || !(b?.ready || []).length}
                style={{ ...btn("primary", "sm"), opacity: (b?.ready || []).length ? 1 : 0.5 }}>
                {busy === a.business ? "Marking…" : `🚚 Mark RTD now${(b?.ready || []).length ? ` · ${(b.ready || []).reduce((n, g) => n + g.shipments, 0)}` : ""}`}</button>
            </div>
            {b?.note && <div role="status" style={{ padding: "6px 14px", fontSize: 12.5, fontWeight: 700, color: "#15803D" }}>✓ {b.note}</div>}
            {b?.error ? <div role="alert" style={{ padding: 14, color: C.red, fontWeight: 700, fontSize: 13 }}>✕ {b.error}</div>
              : !b || b.loading && !groups.length ? <div style={{ padding: 18, color: C.gray400, fontSize: 13 }}>Reading Seller Hub…</div>
              : groups.length === 0 ? <div style={{ padding: 18, color: C.gray500, fontSize: 13 }}>Nothing printed and waiting RTD.</div>
              : groups.map((g) => {
                const pct = g.shipments ? (100 * g.packed) / g.shipments : 0;
                return (
                  <div key={g.group_id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 14px", borderTop: `1px solid ${C.gray100}` }}>
                    {g.image ? <img src={g.image} alt="" loading="lazy" style={{ width: 40, height: 40, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
                      : <div style={{ width: 40, height: 40, borderRadius: 8, background: C.gray100, flexShrink: 0 }} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 13, color: C.gray900, wordBreak: "break-word" }}>{g.sku || g.group_id}</div>
                      <div style={{ height: 6, borderRadius: 99, background: C.gray100, marginTop: 4, overflow: "hidden", maxWidth: mobile ? "100%" : 320 }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: g.ready ? "#16A34A" : BLUE_FK }} />
                      </div>
                    </div>
                    <div style={{ textAlign: "right", fontSize: 12.5, flexShrink: 0, maxWidth: "45%" }}>
                      <div style={{ fontWeight: 900, color: g.ready ? "#15803D" : C.gray900 }}>{g.packed}/{g.shipments} packed</div>
                      <div style={{ fontSize: 11.5, color: g.ready ? "#15803D" : C.gray500 }}>
                        {g.ready ? (mode[0] === "scan" ? "all packed — goes RTD within a minute" : "all packed — ready to mark RTD") : "waiting for the rest to be scanned"}</div>
                    </div>
                  </div>
                );
              })}
          </section>
        );
      })}
    </div>
  );
}

/**
 * Business Settings → Flipkart → Automation: accept every N minutes; at each label time accept, print every
 * label waiting, keep the PDF (Labels Downloaded, to print again), send it to Telegram, mark RTD.
 * And the one-order test: accept one order, print its label, mark it RTD — now.
 */
export function FlipkartAutomation({ accounts, isAdmin }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [time, setTime] = useState("17:00");
  const [running, setRunning] = useState(null);
  const [result, setResult] = useState(null);
  const load = useCallback(async () => {
    const r = await call("auto/");
    if (r.ok) { setD(r.data); setErr(null); } else setErr(r.data.error || "Couldn't read the automation.");
  }, []);
  useEffect(() => { load(); }, [load]);
  const save = async (patch) => {
    const r = await call("auto/", "PATCH", patch);
    if (r.ok) { setD(r.data); setErr(null); } else setErr(r.data.error || "Couldn't save.");
  };
  const runNow = async (business, name, limit) => {
    const what = limit === 1
      ? `Test with one order for ${name}: accept ONE order on Flipkart, print its label, keep it and send it to Telegram — RTD as ${name} is set. Go ahead?`
      : `For ${name}: accept every order waiting, print every label waiting, keep and send the PDF — RTD as ${name} is set. Go ahead?`;
    if (!window.confirm(what)) return;
    setRunning(`${business}-${limit || "all"}`); setResult(null);
    const r = await call("auto/run/", "POST", { business, kind: "labels", ...(limit ? { limit } : {}) });
    setRunning(null);
    setResult(r.data.results ? { results: r.data.results } : { error: r.data.error || "The run failed." });
    load();
  };
  const openPdf = async (id) => {
    const res = await fetch(`${API}/meesho-orders/label-files/${id}/pdf/`);
    if (!res.ok) { setErr("Couldn't open that labels file."); return; }
    window.open(URL.createObjectURL(await res.blob()), "_blank");
  };
  if (!d) return err ? <div role="alert" style={{ color: C.red, fontWeight: 700, fontSize: 13 }}>✕ {err}</div> : null;
  const connected = accounts.filter((a) => a.connected);
  const last = d.last_result?.results;
  return (
    <section style={{ ...S.card, padding: 16, display: "flex", flexDirection: "column", gap: 14, borderTop: "4px solid #2874F0" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 280px" }}>
          <div style={{ fontWeight: 900, fontSize: 16, color: C.gray900 }}>Automation</div>
          <div style={{ fontSize: 12.5, color: C.gray500 }}>
            Accept orders on a schedule, and at each label time: accept, print every label waiting, keep the PDF (Labels Downloaded — print it
            again any time) and send it to Telegram. Orders are marked Ready to Dispatch as each business is set below — by default once
            they're packed at Order Scan → Flipkart scan.
          </div>
        </div>
        <Switch on={d.enabled} disabled={!isAdmin} onChange={(v) => save({ enabled: v })} label={d.enabled ? "On" : "Off"} />
      </div>
      {err && <div role="alert" style={{ color: C.red, fontWeight: 700, fontSize: 13 }}>✕ {err}</div>}

      <AcceptMode every={d.accept_every} choices={[0, 15, 30, 45, 60, 120]} disabled={!isAdmin} labelTimes={d.label_times}
        color="#2874F0" onChange={(m) => save({ accept_every: m })} />
      <span style={{ fontSize: 11.5, color: C.gray500, marginTop: -8 }}>Last accepted: {fmtAt(d.last_accept_at)}</span>

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12.5, fontWeight: 800, color: C.gray600 }}>{d.accept_every ? "Print labels at (India time)" : "Accept & print at (India time)"}</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {d.label_times.length === 0 && <span style={{ fontSize: 12.5, color: C.gray400 }}>No times yet</span>}
            {d.label_times.map((t) => (
              <span key={t} style={{ display: "inline-flex", gap: 4, alignItems: "center", background: "#EFF6FF", color: "#1D4ED8", border: "1px solid #BFDBFE",
                borderRadius: 999, padding: "3px 10px", fontSize: 13, fontWeight: 800 }}>
                {t}{isAdmin && <button onClick={() => save({ label_times: d.label_times.filter((x) => x !== t) })} aria-label={`Remove ${t}`}
                  style={{ border: "none", background: "none", color: "#1D4ED8", cursor: "pointer", padding: 0, fontSize: 14, minHeight: 0 }}>×</button>}
              </span>
            ))}
          </div>
          {isAdmin && (
            <div style={{ display: "flex", gap: 6 }}>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ ...S.inp, width: 130 }} />
              <button onClick={() => time && save({ label_times: [...d.label_times, time] })} style={btn("ghost", "sm")}>+ Add time</button>
            </div>
          )}
          <span style={{ fontSize: 11.5, color: C.gray500 }}>Last: {fmtAt(d.last_labels_at)}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Switch on={d.send_labels} disabled={!isAdmin} onChange={(v) => save({ send_labels: v })} label="Send the labels to Telegram" />
          <RtdModes accounts={accounts} isAdmin={isAdmin} />
        </div>
      </div>

      {last && (
        <div style={{ background: C.gray50, borderRadius: 10, padding: "8px 12px", display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: C.gray600 }}>Last {d.last_result.kind === "labels" ? "labels run" : "accept"} · {fmtAt(d.last_result.at)}</span>
          {Object.entries(last).map(([n, r]) => <RunLine key={n} name={n} r={r} />)}
        </div>
      )}

      {isAdmin && connected.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: `1px solid ${C.gray100}`, paddingTop: 12 }}>
          <span style={{ fontSize: 12.5, fontWeight: 800, color: C.gray600 }}>Run now</span>
          {connected.map((a) => (
            <div key={a.business} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontWeight: 800, fontSize: 13.5, minWidth: 120 }}>{a.business_name}</span>
              <button onClick={() => runNow(a.business, a.business_name, 1)} disabled={!!running} style={btn("ghost", "sm")}>
                {running === `${a.business}-1` ? "Testing…" : "🧪 Test with one order"}</button>
              <button onClick={() => runNow(a.business, a.business_name, null)} disabled={!!running} style={btn("ghost", "sm")}>
                {running === `${a.business}-all` ? "Running…" : "Accept & print everything"}</button>
            </div>
          ))}
          {running && <span style={{ fontSize: 12.5, color: C.gray500 }}>Working on Flipkart — accepting waits about a minute for Seller Hub to make the labels…</span>}
          {result?.error && <div role="alert" style={{ color: C.red, fontWeight: 700, fontSize: 13 }}>✕ {result.error}</div>}
          {result?.results && Object.entries(result.results).map(([n, r]) => (
            <div key={n} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <RunLine name={n} r={r} />
              {r.file_id && <button onClick={() => openPdf(r.file_id)} style={btn("primary", "sm")}>🖨 Print the labels</button>}
            </div>
          ))}
        </div>
      )}

      {d.files.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: `1px solid ${C.gray100}`, paddingTop: 12 }}>
          <span style={{ fontSize: 12.5, fontWeight: 800, color: C.gray600 }}>Labels printed — print again <a href="/label-items" style={{ color: "#2874F0", fontWeight: 700, marginLeft: 6 }}>All in Labels Downloaded →</a></span>
          {d.files.map((f) => (
            <div key={f.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
              <span style={{ minWidth: 0, flex: 1 }}><b>{f.labels} label{f.labels === 1 ? "" : "s"}</b> · {fmtAt(f.created_at)} · {f.businesses.join(", ")}
                <span style={{ color: C.gray500 }}> · {f.trigger === "AUTO" ? "automatic" : "run by hand"}</span></span>
              <button onClick={() => openPdf(f.id)} style={btn("ghost", "sm")}>🖨 Reprint</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Business Settings → Flipkart: each business's Seller Hub login (connect, OTP, log out) and nothing else. */
export function FlipkartAccounts() {
  const mobile = useIsMobile();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const load = useCallback(async () => {
    const r = await call("");
    if (r.ok && Array.isArray(r.data.accounts)) setD(r.data);
    else setErr(r.data.error || r.data.detail || "Couldn't read the Flipkart connections.");
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!d) {
    return err ? <div role="alert" style={{ ...S.card, color: C.red, fontWeight: 700 }}>✕ {err}</div>
      : <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><CircularProgress style={{ color: "#2874F0" }} /></div>;
  }
  const withLogin = d.accounts.filter((a) => a.status);
  const without = d.accounts.filter((a) => !a.status);
  const cards = showAll || withLogin.length === 0 ? [...withLogin, ...without] : withLogin;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 1100 }}>
      <p style={{ fontSize: 13, color: C.gray500, margin: 0 }}>
        Each business's own Flipkart Seller Hub login — Flipkart asks for an OTP at every login. Once in, it's kept alive and read every 10 minutes.
      </p>
      {err && <div role="alert" style={{ fontSize: 13, color: C.red, fontWeight: 700 }}>✕ {err}</div>}
      {cards.map((a) => <AccountCard key={a.business} d={a} isAdmin={d.is_admin} mobile={mobile} onState={setD} />)}
      {d.is_admin && without.length > 0 && withLogin.length > 0 && (
        <button onClick={() => setShowAll(!showAll)} style={{ ...btn("ghost", "md"), alignSelf: "flex-start" }}>
          {showAll ? "Hide businesses without Flipkart" : `+ Connect Flipkart for another business (${without.length})`}
        </button>
      )}
    </div>
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
            and read every 10 minutes, and their orders show together below. Every 30 minutes (or on Read now) their orders and payments are
            written into the app's Flipkart tables — as Meesho's are — every payment with its orders, ads, fines, protection fund and taxes,
            which the Flipkart profit and loss uses; each payment is matched against what it paid for.
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

      <FlipkartActions accounts={d.accounts.filter((a) => a.connected)} mobile={mobile} onState={setD} />
      <FlipkartOrders accounts={d.accounts.filter((a) => a.connected || a.orders_at)} mobile={mobile} />
      <FlipkartPayments accounts={d.accounts.filter((a) => a.connected || a.sync_at)} mobile={mobile} />

      {d.is_admin && (
        <section style={{ ...S.card, padding: "12px 16px", fontSize: 13, color: C.gray600, lineHeight: 1.6 }}>
          <b style={{ color: C.gray900 }}>Printing labels and the manifest</b> come next, once their Seller Hub requests are added — until then print labels in Seller Hub.
        </section>
      )}
    </div>
  );
}
