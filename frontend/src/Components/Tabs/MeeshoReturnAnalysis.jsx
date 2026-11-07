import React, { useState, useEffect, useMemo, useCallback } from "react";
import { API, C, S, btn, useIsMobile } from "../../App";
import { CircularProgress } from "@mui/material";
import { Panel, Kpi, BarList, StatusDot, TONE, inr, inrShort, num } from "./MeeshoUI";

/*
 * Meesho → Return analysis. Built on the returns Meesho's own API gives us
 * (kept in the returns table by the sync): how many came back in the last 7 and
 * 30 days, the return rate per parent SKU and SKU, which product comes back for
 * which reason and under which flag (customer return / RTO), what each return
 * cost — and a ranked list of what to do to stop the loss.
 *
 *   top      period switch; All / Customer returns / RTO — two analyses of two different problems
 *            (customer returns are measured against orders DELIVERED, RTOs against orders SHIPPED)
 *   guard    what the Return Guard paused on its own and why, and the rules it follows
 *   pointers what to do, biggest rupees first
 *   money    what returns cost: reversed sales, return shipping, what finally settled
 *   flags / reasons / couriers   the picture
 *   table    every parent (open it for its SKUs) or every SKU, sortable, filterable by flag
 */

const PERIODS = [7, 30, 60, 90];
const LEVEL = { high: { tone: "bad", label: "Act now" }, medium: { tone: "warn", label: "Watch" }, low: { tone: "info", label: "Note" }, ok: { tone: "good", label: "OK" }, watch: { tone: "neutral", label: "Too few to judge" } };
const pct = (v) => (v == null ? "—" : `${v}%`);
const sign = (n) => (n > 0 ? `+${n}` : `${n}`);

const MODES = [["all", "Overview"], ["customer", "Customer returns"], ["rto", "RTO"]];
const MODE_COLOR = { customer: "#2563EB", rto: "#F59E0B" };

/** The numbers of one parent / SKU for the mode picked — returned, rate of what, trend, windows. */
function pick(e, mode) {
  if (mode === "customer") return { n: e.customer, rate: e.customer_rate, prev: e.prev_customer_rate, vs: e.customer_vs_avg, base: e.delivered, baseLabel: "delivered", d7: e.d7_customer, d30: e.d30_customer, series: e.trend.map((t) => t.customer) };
  if (mode === "rto") return { n: e.rto, rate: e.rto_rate, prev: e.prev_rto_rate, vs: e.rto_vs_avg, base: e.orders, baseLabel: "shipped", d7: e.d7_rto, d30: e.d30_rto, series: e.trend.map((t) => t.rto) };
  return { n: e.returns, rate: e.rate, prev: e.prev_rate, vs: e.vs_avg, base: e.orders, baseLabel: "shipped", d7: e.d7, d30: e.d30, series: e.trend.map((t) => t.customer + t.rto) };
}

/** Tiny bars: how returns moved across the period. */
function Spark({ series, color = C.gray600, w = 74, h = 24 }) {
  const max = Math.max(1, ...series);
  const bw = Math.max(3, Math.floor((w - (series.length - 1) * 2) / Math.max(series.length, 1)));
  return (
    <svg width={w} height={h} role="img" aria-label={`Returns per ${series.length > 7 ? "week" : "day"}: ${series.join(", ")}`} style={{ display: "block" }}>
      {series.map((v, i) => { const bh = v ? Math.max(2, (h * v) / max) : 1; return <rect key={i} x={i * (bw + 2)} y={h - bh} width={bw} height={bh} rx={1.5} fill={color} opacity={v ? 1 : 0.25} />; })}
    </svg>
  );
}

/** Delivered vs returned, as one bar: what stayed delivered, customer returns, RTOs. */
function OutcomeBar({ e }) {
  const total = Math.max(e.orders, e.customer + e.rto, 1);
  const kept = Math.max(e.orders - e.customer - e.rto, 0);
  const seg = (n, color, label) => n > 0 && <span title={`${label}: ${n}`} style={{ width: `${(100 * n) / total}%`, background: color, minWidth: 2 }} />;
  return (
    <div style={{ minWidth: 120 }}>
      <div style={{ display: "flex", height: 9, borderRadius: 4, overflow: "hidden", background: C.gray100 }} role="img"
        aria-label={`${kept} kept, ${e.customer} customer returns, ${e.rto} RTO of ${e.orders} shipped`}>
        {seg(kept, "#86EFAC", "Delivered and kept")}{seg(e.customer, MODE_COLOR.customer, "Customer returns")}{seg(e.rto, MODE_COLOR.rto, "RTO")}
      </div>
      <div style={{ fontSize: 11.5, color: C.gray500, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>
        <b style={{ color: C.gray800 }}>{num(e.delivered)}</b> delivered · <b style={{ color: "#1D4ED8" }}>{e.customer}</b> back · <b style={{ color: "#B45309" }}>{e.rto}</b> RTO
      </div>
    </div>
  );
}

async function post(path, body) {
  const r = await fetch(`${API}/meesho-orders/return-analysis/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
  return j;
}

/** The pause / resume control of one product, and what the guard thinks of it. */
function PauseControl({ e, guard, onDone, compact }) {
  const [busy, setBusy] = useState(false);
  const g = e.guard;
  if (!g) {
    return e.has_parent === false || e.parent === null || e.parent === undefined
      ? <span style={{ fontSize: 11.5, color: C.gray400 }}>Link to a parent to pause</span> : null;
  }
  const reasons = [g.returns_breach && `customers returned ${g.rate}% of ${g.orders} delivered`, g.loss_breach && `selling at a loss (₹${Math.round(g.loss).toLocaleString("en-IN")} on ${g.loss_units} units)`].filter(Boolean);
  const act = async (paused) => {
    let note = "";
    if (paused) {
      note = window.prompt(`Pause ${e.label}? ${g.level === "sku" ? "This SKU" : "The product and each of its SKUs"} disappear from the Listing Hub for listing managers.\n\nWhy? (optional)`, reasons.join("; "));
      if (note === null) return;
    } else if (!window.confirm(`Resume ${e.label}${g.level === "sku" ? "" : " and all its SKUs"}? The guard leaves it alone for ${guard.rules.grace_days} days.`)) return;
    setBusy(true);
    try { await post("pause/", g.level === "sku" ? { business: g.business, sku: e.label, paused, note } : { business: g.business, parent: e.parent || e.label, paused, note }); onDone(); }
    catch (err) { window.alert(err.message); } finally { setBusy(false); }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: compact ? "stretch" : "flex-start" }}>
      {g.paused && <span style={{ fontSize: 12, fontWeight: 900, color: "#B91C1C", background: TONE.bad.soft, padding: "2px 8px", borderRadius: 999, alignSelf: "flex-start" }}>⏸ Paused{g.paused_auto ? " by the guard" : ""}</span>}
      {!g.paused && reasons.length > 0 && <span style={{ fontSize: 12, fontWeight: 800, color: "#B91C1C" }}>⚠ Over the limit: {reasons.join(" · ")}</span>}
      {guard.can_pause && (g.paused
        ? <button disabled={busy} onClick={() => act(false)} style={{ ...btn("ghost", "sm"), minHeight: 36, alignSelf: "flex-start" }}>▶ Resume</button>
        : <button disabled={busy} onClick={() => act(true)} style={{ ...btn(reasons.length ? "primary" : "ghost", "sm"), minHeight: 36, alignSelf: "flex-start", ...(reasons.length ? { background: "#DC2626", borderColor: "#DC2626" } : {}) }}>⏸ {g.level === "sku" ? "Pause SKU" : "Pause product"}</button>)}
    </div>
  );
}

function GuardPanel({ guard, onChange }) {
  const r = guard.rules;
  const [busy, setBusy] = useState(false);
  const unseen = guard.alerts.filter((a) => !a.seen);
  const run = async () => {
    setBusy(true);
    try {
      const preview = await post("run/", { dry_run: true });
      if (!preview.paused.length) { window.alert("Nothing breaks the rules right now."); return; }
      if (!window.confirm(`Pause ${preview.paused.length} product(s)?\n\n${preview.paused.map((p) => `• ${p.message}`).join("\n")}`)) return;
      await post("run/", {}); onChange();
    } catch (e) { window.alert(e.message); } finally { setBusy(false); }
  };
  const markSeen = async () => { try { await post("seen/", { ids: unseen.map((a) => a.id) }); onChange(); } catch (e) { window.alert(e.message); } };
  return (
    <Panel title="Return Guard" subtitle={`Checks every morning (7 am) and pauses a product on its own when its last ${r.days} days break a rule`}
      action={guard.can_pause && <button onClick={run} disabled={busy} style={{ ...btn("ghost", "sm"), minHeight: 36 }}>{busy ? "Checking…" : "Check now"}</button>}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
        <div style={{ padding: "10px 12px", borderRadius: 10, background: C.gray50, fontSize: 13, lineHeight: 1.45 }}>
          <b>Returns:</b> pause when customers send back more than <b>{r.return_pct}%</b> of the units delivered to them, once at least <b>{r.min_orders}</b> were delivered.
          Counted per order: of the orders placed {r.settle_days + r.days - 1} to {r.settle_days} days ago, each counts once by how it ended — kept, or returned by the customer.
          RTOs (never delivered) and orders still on the way don't count. Checked for each product and each SKU on its own.
        </div>
        <div style={{ padding: "10px 12px", borderRadius: 10, background: C.gray50, fontSize: 13, lineHeight: 1.45 }}>
          <b>Loss:</b> pause when it sold <b>{r.loss_min_units}+</b> delivered units and made a loss on them — it is selling below what it costs.
        </div>
        <div style={{ padding: "10px 12px", borderRadius: 10, background: guard.at_risk ? TONE.bad.soft : TONE.good.soft, fontSize: 13, lineHeight: 1.45, color: guard.at_risk ? "#991B1B" : "#166534", fontWeight: 700 }}>
          {guard.at_risk ? `${guard.at_risk} product${guard.at_risk === 1 ? "" : "s"} / SKU${guard.at_risk === 1 ? "" : "s"} over a limit right now and not paused yet.` : "No product or SKU is over a limit."} {guard.paused_count} products paused in total.
        </div>
      </div>
      {guard.alerts.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: C.gray500, textTransform: "uppercase", letterSpacing: "0.04em" }}>Alerts{unseen.length ? ` · ${unseen.length} new` : ""}</span>
            {unseen.length > 0 && <button onClick={markSeen} style={{ ...btn("ghost", "sm"), minHeight: 34 }}>Mark all seen</button>}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {guard.alerts.slice(0, 8).map((a) => (
              <div key={a.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 10px", borderRadius: 8, background: a.seen ? C.gray50 : TONE.bad.soft, fontSize: 13, lineHeight: 1.4 }}>
                <span aria-hidden>{a.kind === "loss" ? "💸" : a.kind === "returns" ? "↩" : "⏸"}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: C.gray900, fontWeight: a.seen ? 600 : 800 }}>{a.message}</div>
                  <div style={{ fontSize: 11.5, color: C.gray500 }}>{a.business} · {new Date(a.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}{a.resumed ? " · resumed since" : a.paused_now ? " · still paused" : ""}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

/** Everything paused — by the guard or by hand — why, where it stands now, and Resume. */
function PausedPanel({ onChange, version }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);
  const mobile = useIsMobile();
  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API}/meesho-orders/return-analysis/paused/`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Couldn't read what's paused.");
      setD(j); setErr(null);
    } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load, version]);   // again after a pause / resume elsewhere on the page
  if (err) return <div role="alert" style={{ color: C.red, fontWeight: 700, fontSize: 13 }}>✕ {err}</div>;
  if (!d || !d.items.length) return null;

  const resume = async (body, what, key) => {
    if (!window.confirm(`Make ${what} active again? The guard then leaves ${body.all ? "them" : "it"} alone for 14 days.`)) return;
    setBusy(key);
    try { await post("resume/", body); await load(); onChange(); }
    catch (e) { window.alert(e.message); } finally { setBusy(null); }
  };
  const autoCount = d.items.filter((i) => i.auto).length;
  const fine = d.items.filter((i) => i.auto && i.now && !i.now.over_limit).length;
  const when = (iso) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const span = d.window.map((x) => new Date(x).toLocaleDateString("en-IN", { day: "numeric", month: "short" })).join(" – ");

  return (
    <Panel title={`Paused products · ${d.items.length}`}
      subtitle={`Hidden from the Listing Hub (not paused on Meesho itself). "Now" is the exact customer-return rate for orders of ${span}.`}
      action={d.can_resume && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {autoCount > 0 && <button disabled={!!busy} onClick={() => resume({ all: "auto" }, `all ${autoCount} paused by the guard`, "auto")} style={{ ...btn("ghost", "sm"), minHeight: 36 }}>
            {busy === "auto" ? "Resuming…" : `▶ Resume guard's ${autoCount}`}</button>}
          <button disabled={!!busy} onClick={() => resume({ all: true }, `all ${d.items.length} paused products`, "all")} style={{ ...btn("ghost", "sm"), minHeight: 36 }}>
            {busy === "all" ? "Resuming…" : "▶ Resume all"}</button>
        </div>
      )}>
      {fine > 0 && (
        <div style={{ padding: "8px 12px", borderRadius: 10, background: TONE.warn.soft, color: "#92400E", fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
          ⚠ {fine} paused by the guard {fine === 1 ? "is" : "are"} under the {d.rules.return_pct}% limit on the exact count — {fine === 1 ? "it was" : "they were"} likely paused under the older count (RTOs and parcels still on the way taken as returns).
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {d.items.map((i) => {
          const key = `${i.level}|${i.business}|${i.parent}|${i.sku}`;
          const n = i.now;
          const what = i.level === "sku" ? `SKU ${i.sku}` : `${i.parent}${i.skus > 1 ? ` and its ${i.skus} SKUs` : ""}`;
          return (
            <div key={key} style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "minmax(0, 1fr) minmax(200px, 260px) auto", gap: mobile ? 8 : 14, alignItems: "center",
              padding: "10px 12px", border: `1px solid ${C.gray200}`, borderRadius: 12, background: C.white }}>
              <div style={{ display: "flex", gap: 10, minWidth: 0 }}>
                {i.image ? <img src={i.image} alt="" loading="lazy" style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
                  : <span aria-hidden style={{ width: 44, height: 44, borderRadius: 8, background: C.gray100, flexShrink: 0 }} />}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 900, fontSize: 14, color: C.gray900, wordBreak: "break-word" }}>
                    {i.level === "sku" ? i.sku : i.parent}
                    <span style={{ marginLeft: 8, fontSize: 11.5, fontWeight: 800, color: i.auto ? "#B91C1C" : C.gray600, background: i.auto ? TONE.bad.soft : C.gray100, padding: "2px 8px", borderRadius: 999 }}>
                      {i.auto ? "by the guard" : `by ${i.paused_by || "hand"}`}</span>
                  </div>
                  <div style={{ fontSize: 12, color: C.gray500 }}>
                    {i.level === "sku" ? `SKU of ${i.parent || "—"}` : `Product · ${i.skus} SKU${i.skus === 1 ? "" : "s"}`} · {i.business_name} · {when(i.paused_at)}
                  </div>
                  {i.reason && <div style={{ fontSize: 12, color: C.gray600, marginTop: 2, lineHeight: 1.4 }}>{i.reason}</div>}
                </div>
              </div>
              <div style={{ fontSize: 12.5, lineHeight: 1.45 }}>
                {n && n.delivered_to_customers > 0 ? (
                  <>
                    <div style={{ fontWeight: 900, color: n.over_limit ? "#B91C1C" : "#15803D" }}>
                      Now {n.rate}% {n.over_limit ? "· over the limit" : "· under the limit"}</div>
                    <div style={{ color: C.gray500, fontVariantNumeric: "tabular-nums" }}>
                      {num(n.customer_returns)} returned of {num(n.delivered_to_customers)} delivered · {num(n.rto)} RTO, {num(n.open)} on the way not counted</div>
                  </>
                ) : <div style={{ color: C.gray400 }}>No delivered orders in the window to judge by.</div>}
              </div>
              {d.can_resume && (
                <button disabled={!!busy} onClick={() => resume({ items: [{ business: i.business, ...(i.level === "sku" ? { sku: i.sku } : { parent: i.parent }) }] }, what, key)}
                  style={{ ...btn(n && !n.over_limit && i.auto ? "primary" : "ghost", "sm"), minHeight: 38, justifySelf: mobile ? "stretch" : "end", whiteSpace: "nowrap" }}>
                  {busy === key ? "Resuming…" : "▶ Make active"}</button>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/** Returns across the period, piece by piece: customer returns and RTOs, with their rates. */
function TrendPanel({ trend, mode, days }) {
  const weekly = days > 7;
  const total = (t) => (mode === "customer" ? t.customer : mode === "rto" ? t.rto : t.customer + t.rto);
  const max = Math.max(1, ...trend.map(total));
  const label = (t) => new Date(t.from).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return (
    <Panel title="How it is going" subtitle={`Returns raised each ${weekly ? "week" : "day"} — ${mode === "all" ? "customer returns (blue) and RTO (amber)" : mode === "customer" ? "customer returns" : "RTO"}, and the rate that period`}>
      <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: 150, overflowX: "auto", paddingBottom: 2 }} role="img" aria-label="Returns per period">
        {trend.map((t) => {
          const c = mode === "rto" ? 0 : t.customer, r = mode === "customer" ? 0 : t.rto;
          const rate = mode === "customer" ? t.customer_rate : mode === "rto" ? t.rto_rate : (t.orders ? Math.round((1000 * (t.customer + t.rto)) / t.orders) / 10 : null);
          return (
            <div key={t.from} title={`${label(t)} – ${new Date(t.to).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}: ${t.customer} customer · ${t.rto} RTO · ${t.orders} shipped`}
              style={{ flex: "1 0 34px", minWidth: 34, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: C.gray700, fontVariantNumeric: "tabular-nums" }}>{rate == null ? "" : `${rate}%`}</span>
              <div style={{ width: "70%", display: "flex", flexDirection: "column", justifyContent: "flex-end", height: 96 }}>
                {r > 0 && <span style={{ height: `${(100 * r) / max}%`, minHeight: 2, background: MODE_COLOR.rto, borderRadius: "3px 3px 0 0" }} />}
                {c > 0 && <span style={{ height: `${(100 * c) / max}%`, minHeight: 2, background: MODE_COLOR.customer, borderRadius: r > 0 ? 0 : "3px 3px 0 0" }} />}
              </div>
              <span style={{ fontSize: 10.5, color: C.gray500, marginTop: 3, whiteSpace: "nowrap" }}>{label(t)}</span>
              <span style={{ fontSize: 10.5, fontWeight: 800, color: C.gray800 }}>{total(t)}</span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function Change({ change, invert = true }) {
  if (!change) return null;
  const up = change.abs > 0, flat = change.abs === 0;
  const bad = invert ? up : !up;
  const color = flat ? C.gray500 : bad ? C.red : "#15803D";
  return (
    <span style={{ color, fontWeight: 800 }}>
      {flat ? "no change" : `${up ? "▲" : "▼"} ${Math.abs(change.abs)}${change.pct != null ? ` (${sign(change.pct)}%)` : ""}`}
      <span style={{ color: C.gray500, fontWeight: 600 }}> vs before</span>
    </span>
  );
}

function Photo({ url, size = 44 }) {
  const [bad, setBad] = useState(false);
  const box = { width: size, height: size, borderRadius: 8, flexShrink: 0, overflow: "hidden", background: C.gray50, border: `1px solid ${C.gray200}`, display: "flex", alignItems: "center", justifyContent: "center", color: C.gray300 };
  if (!url || bad) return <div style={box} aria-hidden>📦</div>;
  return <div style={box}><img src={url} alt="" loading="lazy" onError={() => setBad(true)} style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>;
}

function RateBadge({ rate, vsAvg }) {
  if (rate == null) return <span style={{ color: C.gray400 }}>—</span>;
  const tone = vsAvg == null ? "neutral" : vsAvg >= 10 ? "bad" : vsAvg > 0 ? "warn" : "good";
  const t = TONE[tone];
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 5, padding: "2px 8px", borderRadius: 999, background: t.soft, color: t.fg, fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>
      {rate}%{vsAvg != null && <span style={{ fontSize: 11, fontWeight: 700 }}>{vsAvg > 0 ? `+${vsAvg}` : vsAvg} vs avg</span>}
    </span>
  );
}

function PointerCard({ p, onPick }) {
  const t = TONE[LEVEL[p.severity]?.tone || "neutral"];
  return (
    <div style={{ ...S.card, padding: 0, display: "flex", overflow: "hidden", border: `1px solid ${C.gray200}` }}>
      <span aria-hidden style={{ width: 6, background: t.accent, flexShrink: 0 }} />
      <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6, minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.05em", color: t.fg, background: t.soft, padding: "2px 8px", borderRadius: 999 }}>{LEVEL[p.severity]?.label}</span>
          {p.amount != null && p.amount > 0 && <span style={{ fontSize: 13, fontWeight: 900, color: C.gray900 }}>{inr(p.amount)} <span style={{ fontWeight: 600, color: C.gray500 }}>{p.amount_label}</span></span>}
        </div>
        <div style={{ fontSize: 14.5, fontWeight: 800, color: C.gray900, lineHeight: 1.35 }}>{p.title}</div>
        {p.detail && <div style={{ fontSize: 13, color: C.gray600, lineHeight: 1.45 }}>{p.detail}</div>}
        <div style={{ fontSize: 13, color: C.gray800, lineHeight: 1.45 }}><b>Do this:</b> {p.action}</div>
        {p.kind === "product" && <button onClick={() => onPick(p.target)} style={{ ...btn("ghost", "sm"), alignSelf: "flex-start", minHeight: 36 }}>Show {p.target} below ↓</button>}
      </div>
    </div>
  );
}

function ReasonChips({ reasons }) {
  if (!reasons?.length) return <span style={{ color: C.gray400, fontSize: 12.5 }}>—</span>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {reasons.map((r) => (
        <span key={r.reason} style={{ fontSize: 12.5, color: C.gray700 }}>
          <b style={{ fontVariantNumeric: "tabular-nums" }}>{r.count}</b> · {r.reason}{r.share != null && <span style={{ color: C.gray400 }}> ({r.share}%)</span>}
        </span>
      ))}
    </div>
  );
}

/** What the Return Guard has to say about a row, in the verdict's place when it matters more. */
function Verdict({ e, mode }) {
  const lvl = LEVEL[e.action.level] || LEVEL.ok;
  const k = pick(e, mode);
  return (
    <>
      <StatusDot tone={lvl.tone}>{e.action.title}</StatusDot>
      {e.action.text && <div style={{ fontSize: 12, color: C.gray600, marginTop: 2, lineHeight: 1.4 }}>{e.action.text}</div>}
      {mode === "rto" && e.top_couriers?.length > 0 && <div style={{ fontSize: 12, color: C.gray700, marginTop: 2 }}>RTO via {e.top_couriers.map((c) => `${c.courier} (${c.count})`).join(", ")}</div>}
      {k.prev != null && k.rate != null && Math.abs(k.rate - k.prev) >= 1 && <div style={{ fontSize: 12, fontWeight: 800, color: k.rate > k.prev ? C.red : "#15803D", marginTop: 2 }}>{k.rate > k.prev ? "▲" : "▼"} {k.prev}% → {k.rate}% vs the period before</div>}
      {e.excess_loss > 0 && <div style={{ fontSize: 12, fontWeight: 800, color: C.red, marginTop: 2 }}>Fixing it saves ≈ {inr(e.excess_loss)}</div>}
    </>
  );
}

/** What each product's returns are about: reasons for customer returns, couriers for RTOs. */
function Why({ e, mode }) {
  if (mode === "rto") {
    return e.top_couriers?.length
      ? <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>{e.top_couriers.map((c) => <span key={c.courier} style={{ fontSize: 12.5, color: C.gray700 }}><b>{c.count}</b> · {c.courier}</span>)}</div>
      : <span style={{ color: C.gray400, fontSize: 12.5 }}>—</span>;
  }
  return <ReasonChips reasons={e.top_reasons} />;
}

/** One parent / SKU row (table row on a screen, a card on a phone). */
function Entity({ e, mobile, mode, flag, guard, onDone, open, onToggle, children, depth = 0 }) {
  const k = pick(e, mode);
  const shown = flag ? (e.flags?.[flag] || 0) : k.n;
  const color = mode === "rto" ? MODE_COLOR.rto : MODE_COLOR.customer;
  const warn = e.guard && !e.guard.paused && (e.guard.returns_breach || e.guard.loss_breach);
  if (mobile) {
    return (
      <div style={{ ...S.card, padding: 12, marginLeft: depth * 10, display: "flex", flexDirection: "column", gap: 8, borderLeft: warn ? "4px solid #DC2626" : undefined }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Photo url={e.image} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: C.gray900, overflow: "hidden", textOverflow: "ellipsis" }}>{e.label}</div>
            {e.product_name && <div style={{ fontSize: 12, color: C.gray500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.product_name}</div>}
          </div>
          <RateBadge rate={k.rate} vsAvg={k.vs} />
        </div>
        <OutcomeBar e={e} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, textAlign: "center" }}>
          {[[mode === "customer" ? "Returned" : mode === "rto" ? "RTO" : "Returns", shown], ["7 days", k.d7], ["30 days", k.d30], ["Lost", inrShort(e.money.loss)]].map(([l, v]) => (
            <div key={l}><div style={{ fontWeight: 900, fontSize: 16, fontVariantNumeric: "tabular-nums" }}>{v}</div><div style={{ fontSize: 11, color: C.gray500 }}>{l}</div></div>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}><Spark series={k.series} color={color} /><span style={{ fontSize: 11.5, color: C.gray500 }}>{k.series.length > 7 ? "weekly" : "daily"} trend</span></div>
        <Why e={e} mode={mode} />
        <div style={{ fontSize: 12.5 }}><Verdict e={e} mode={mode} /></div>
        {guard && <PauseControl e={e} guard={guard} onDone={onDone} compact />}
        {onToggle && <button onClick={onToggle} style={{ ...btn("ghost", "sm"), minHeight: 40 }}>{open ? "Hide SKUs" : "Show SKUs"}</button>}
        {open && children}
      </div>
    );
  }
  return (
    <>
      <tr style={{ background: depth ? C.gray50 : warn ? "#FEF2F2" : C.white, borderTop: `1px solid ${C.gray100}` }}>
        <td style={{ ...S.td, paddingLeft: 12 + depth * 22 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 220 }}>
            {onToggle && <button onClick={onToggle} aria-expanded={open} aria-label={open ? "Hide SKUs" : "Show SKUs"} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 13, color: C.gray500, width: 22 }}>{open ? "▾" : "▸"}</button>}
            <Photo url={e.image} size={depth ? 34 : 44} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 13.5, color: C.gray900 }}>{e.label}</div>
              {e.product_name && <div style={{ fontSize: 12, color: C.gray500, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.product_name}</div>}
            </div>
          </div>
        </td>
        <td style={S.td}><OutcomeBar e={e} /></td>
        <td style={{ ...S.td, textAlign: "right", fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>{shown}<div style={{ fontSize: 11, fontWeight: 600, color: C.gray500 }}>of {num(k.base)} {k.baseLabel}</div></td>
        <td style={{ ...S.td, textAlign: "right" }}><RateBadge rate={k.rate} vsAvg={k.vs} /></td>
        <td style={{ ...S.td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{k.d7}<span style={{ color: C.gray400 }}> / </span>{k.d30}</td>
        <td style={S.td}><Spark series={k.series} color={color} /></td>
        <td style={S.td}><Why e={e} mode={mode} /></td>
        <td style={{ ...S.td, textAlign: "right", fontWeight: 800, fontVariantNumeric: "tabular-nums" }} title={`Reversed ${inr(e.money.refunded)} · return shipping ${inr(e.money.shipping)}`}>{e.money.with_payment ? inr(e.money.loss) : <span style={{ color: C.gray400 }}>no payment yet</span>}</td>
        <td style={{ ...S.td, minWidth: 230 }}><Verdict e={e} mode={mode} /></td>
        <td style={{ ...S.td, minWidth: 150 }}>{guard && <PauseControl e={e} guard={guard} onDone={onDone} />}</td>
      </tr>
      {open && children}
    </>
  );
}

export function MeeshoReturnAnalysis() {
  const mobile = useIsMobile();
  const [days, setDays] = useState(30);
  const [mode, setMode] = useState("all");            // all | customer | rto
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("parent");        // parent | sku
  const [flag, setFlag] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("rate");
  const [onlyRisk, setOnlyRisk] = useState(false);
  const [openKeys, setOpenKeys] = useState(() => new Set());

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${API}/meesho-orders/return-analysis/?days=${days}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `Couldn't load (${res.status})`);
      setData(d);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [days]);
  useEffect(() => { load(); }, [load]);

  const sorters = {
    loss: (a) => -(a.money.loss || 0), returns: (a) => -pick(a, mode).n, rate: (a) => -(pick(a, mode).rate ?? -1),
    recent: (a) => -pick(a, mode).d7, saving: (a) => -a.excess_loss,
  };
  const filt = useCallback((list) => {
    const needle = q.trim().toLowerCase();
    return list
      .filter((e) => pick(e, mode).n > 0 || (e.guard && (e.guard.paused || e.guard.returns_breach || e.guard.loss_breach)))
      .filter((e) => (!flag || (e.flags?.[flag] || 0) > 0)
        && (!onlyRisk || (e.guard && !e.guard.paused && (e.guard.returns_breach || e.guard.loss_breach)))
        && (!needle || e.label.toLowerCase().includes(needle) || (e.product_name || "").toLowerCase().includes(needle)))
      .sort((a, b) => sorters[sort](a) - sorters[sort](b) || pick(b, mode).n - pick(a, mode).n);
  }, [q, flag, sort, mode, onlyRisk]);   // eslint-disable-line react-hooks/exhaustive-deps

  const parents = useMemo(() => filt(data?.parents || []), [data, filt]);
  const skus = useMemo(() => filt(data?.skus || []), [data, filt]);
  const skusOf = useCallback((key) => (data?.skus || []).filter((s) => (s.parent || s.key) === key), [data]);
  const toggle = (k) => setOpenKeys((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const jump = (target) => {
    setView("parent"); setQ(target); setMode("all"); setOpenKeys((s) => new Set(s).add(target));
    setTimeout(() => document.getElementById("ra-table")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  if (!data) {
    return error
      ? <div role="alert" style={{ ...S.card, padding: 20, color: C.red, fontWeight: 800 }}>✕ {error} <button onClick={load} style={{ ...btn("ghost", "sm"), marginLeft: 8 }}>Try again</button></div>
      : <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><CircularProgress style={{ color: C.orange }} /></div>;
  }
  const h = data.headline, p = h.picked, m = data.money, g = data.guard;
  const cust = mode === "customer", rto = mode === "rto";
  const win = (w) => (cust ? { n: w.customer, prev: w.previous_customer, rate: w.customer_rate, change: w.customer_change } : rto ? { n: w.rto, prev: w.previous_rto, rate: w.rto_rate, change: w.rto_change } : { n: w.returns, prev: w.previous, rate: w.rate, change: w.change });
  const P = win(p), W7 = win(h.d7), W30 = win(h.d30);
  const avg = cust ? data.average_customer_rate : rto ? data.average_rto_rate : data.average_rate;
  const rateTone = P.rate == null ? "neutral" : P.rate >= 25 ? "bad" : P.rate >= 15 ? "warn" : "good";
  const noReturns = p.returns === 0 && h.d30.returns === 0;
  const modeWord = cust ? "customer returns" : rto ? "RTOs" : "returns";
  const rateOf = cust ? `of ${num(p.delivered)} orders delivered` : `of ${num(p.orders)} orders shipped`;
  const guardOn = g;
  const rows = view === "parent" ? parents : skus;

  const ThCell = ({ children, right, onClick, active }) => (
    <th onClick={onClick} style={{ ...S.th, textAlign: right ? "right" : "left", cursor: onClick ? "pointer" : "default", color: active ? C.orange : undefined, whiteSpace: "nowrap" }}>{children}{active ? " ↓" : ""}</th>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, opacity: loading ? 0.65 : 1, transition: "opacity .15s" }}>
      {/* ── Period + which problem ─────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div role="tablist" aria-label="Which returns" style={{ display: "flex", gap: 4, padding: 4, background: C.gray100, borderRadius: 12, flexWrap: "wrap" }}>
          {MODES.map(([k, l]) => (
            <button key={k} role="tab" aria-selected={mode === k} onClick={() => setMode(k)}
              style={{ border: "none", cursor: "pointer", fontFamily: "inherit", padding: "9px 16px", borderRadius: 9, minHeight: 40, fontSize: 13.5, fontWeight: mode === k ? 800 : 700,
                background: mode === k ? C.white : "transparent", color: mode === k ? C.gray900 : C.gray600, boxShadow: mode === k ? "0 1px 3px rgba(15,23,42,.12)" : "none" }}>
              {l}{k !== "all" && <span style={{ marginLeft: 6, fontSize: 12, color: k === "rto" ? "#B45309" : "#1D4ED8" }}>{k === "rto" ? p.rto : p.customer}</span>}
            </button>
          ))}
        </div>
        <div role="tablist" aria-label="Period" style={{ display: "flex", gap: 4, padding: 4, background: C.gray100, borderRadius: 12 }}>
          {PERIODS.map((d) => (
            <button key={d} role="tab" aria-selected={days === d} onClick={() => setDays(d)}
              style={{ border: "none", cursor: "pointer", fontFamily: "inherit", padding: "9px 14px", borderRadius: 9, minHeight: 40, fontSize: 13.5, fontWeight: days === d ? 800 : 700,
                background: days === d ? C.white : "transparent", color: days === d ? C.gray900 : C.gray600, boxShadow: days === d ? "0 1px 3px rgba(15,23,42,.12)" : "none" }}>
              {d} days
            </button>
          ))}
        </div>
      </div>
      <div style={{ fontSize: 12.5, color: C.gray500, marginTop: -8 }}>
        {new Date(data.from).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} – {new Date(data.to).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
        {data.businesses.length > 1 ? ` · ${data.businesses.length} businesses combined` : ""}
        {cust ? " · customer returns are measured against orders delivered (shipped, minus RTO)" : rto ? " · RTOs are measured against orders shipped" : ""}
      </div>

      {noReturns && (
        <div style={{ ...S.card, padding: 24, textAlign: "center", color: C.gray600 }}>
          No returns in the last {days} days. Returns appear here as the Meesho sync reads them (every 10 minutes) — check Meesho → Settings if the sync isn't running.
        </div>
      )}

      {/* ── The Guard ─────────────────────────────────────────────────── */}
      {guardOn && <GuardPanel guard={g} onChange={load} />}
      {guardOn && <PausedPanel onChange={load} version={`${g.paused_count}|${g.alerts.length}|${g.at_risk}`} />}

      {/* ── Headline numbers: shipped → delivered → returned ───────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
        <Kpi label={`Shipped · ${days} days`} value={num(p.orders)} tone="neutral" icon="📦" sub={<>{num(p.delivered)} delivered · {p.rto} came back as RTO</>} />
        <Kpi label={cust ? "Customer returns" : rto ? "RTOs" : "Returned (all)"} value={num(P.n)} tone="brand" icon="↩" sub={<><Change change={P.change} /><br />{cust ? `of ${num(p.delivered)} delivered` : `of ${num(p.orders)} shipped`}</>} />
        <Kpi label={cust ? "Customer return rate" : rto ? "RTO rate" : "Return rate"} value={pct(P.rate)} tone={rateTone} icon="％"
          sub={<>{rateOf}{P.rate != null && P.prev != null && p.previous_orders ? ` · was ${pct(cust ? p.previous_customer_rate : rto ? p.previous_rto_rate : (p.previous_orders ? Math.round(1000 * p.previous / p.previous_orders) / 10 : null))} before` : ""}</>} />
        <Kpi label="Last 7 days" value={num(W7.n)} tone="neutral" icon="7" sub={<><Change change={W7.change} /><br />rate {pct(W7.rate)}</>} />
        <Kpi label="Last 30 days" value={num(W30.n)} tone="neutral" icon="30" sub={<><Change change={W30.change} /><br />rate {pct(W30.rate)}</>} />
        <Kpi label="Money lost to returns" value={m.with_payment ? inrShort(m.loss) : "—"} tone={m.loss > 0 ? "bad" : "neutral"} icon="₹"
          sub={m.with_payment ? <>{m.with_payment} of {data.data.of} returns have a payment</> : "Appears once their payments sync"} />
      </div>

      <TrendPanel trend={data.trend} mode={mode} days={days} />

      {/* ── Stop the loss ──────────────────────────────────────────────── */}
      {data.pointers.length > 0 && (
        <Panel title="How to stop the loss" subtitle="What to do first — the biggest rupees at the top">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))", gap: 12 }}>
            {data.pointers.map((ptr, i) => <PointerCard key={i} p={ptr} onPick={jump} />)}
          </div>
        </Panel>
      )}

      {/* ── Money, flags, reasons, couriers ───────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", gap: 16, alignItems: "start" }}>
        <Panel title="What returns cost" subtitle={`From the payments sheet, for the ${m.with_payment} returns that have settled`}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            {[["Net loss (settled)", m.loss, "bad"], ["Sales reversed", m.refunded, "neutral"], ["Return shipping charged", m.shipping, "warn"], ["Claims paid back", m.claims, "good"]].map(([l, v, t]) => (
              <div key={l}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: C.gray500, textTransform: "uppercase", letterSpacing: "0.04em" }}>{l}</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: TONE[t].fg, fontVariantNumeric: "tabular-nums" }}>{inr(v)}</div>
              </div>
            ))}
          </div>
          {data.open_claims.count > 0 && <div style={{ marginTop: 12, fontSize: 13, color: "#92400E", background: TONE.warn.soft, padding: "8px 10px", borderRadius: 8, fontWeight: 700 }}>⚠ {data.open_claims.count} delivered return{data.open_claims.count === 1 ? "" : "s"} still have no claim raised.</div>}
        </Panel>

        <Panel title="By flag" subtitle="What kind of return Meesho marked it as">
          {data.by_flag.length ? (
            <BarList rows={data.by_flag.filter((f) => (cust ? !f.flag.startsWith("RTO") : rto ? f.flag.startsWith("RTO") : true)).map((f) => ({ key: f.flag, label: f.flag, value: f.count, tooltip: `${f.flag}: ${f.count} (${f.share}%) — ${f.previous} in the period before`,
              color: f.flag.startsWith("RTO") ? "#F59E0B" : "#2563EB" }))} />
          ) : <div style={{ color: C.gray500, fontSize: 13 }}>Nothing to show.</div>}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
            {[["", "All flags"], ...data.by_flag.map((f) => [f.flag, f.flag])].map(([k, l]) => (
              <button key={k || "all"} onClick={() => setFlag(k)} aria-pressed={flag === k}
                style={{ ...btn(flag === k ? "primary" : "ghost", "sm"), minHeight: 34, fontSize: 12 }}>{l}</button>
            ))}
          </div>
        </Panel>

        {!rto && (
          <Panel title="Why customers return" subtitle="Meesho's stated reason · customer returns only">
            {data.by_reason.length ? (
              <BarList rows={data.by_reason.map((r) => ({ key: r.reason, label: r.reason, value: r.count, tooltip: `${r.reason}: ${r.count} (${r.share}%) · ${r.group_label}`, color: "#7C3AED" }))} />
            ) : <div style={{ color: C.gray500, fontSize: 13 }}>No customer returns in this period.</div>}
            {data.by_group.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
                {data.by_group.map((x) => <span key={x.group} style={{ fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: C.gray100, color: C.gray700 }}>{x.label} {x.share}%</span>)}
              </div>
            )}
          </Panel>
        )}

        {!cust && data.by_courier.length > 0 && (
          <Panel title="RTO by courier" subtitle="Parcels that never reached the buyer">
            <BarList rows={data.by_courier.filter((c) => c.rto).map((c) => ({ key: c.courier, label: c.courier, value: c.rto, tooltip: `${c.courier}: ${c.rto} RTO of ${c.all} returns`, color: "#F59E0B" }))} />
          </Panel>
        )}
      </div>

      {/* ── By product ─────────────────────────────────────────────────── */}
      <section id="ra-table" style={{ ...S.card, padding: 0, overflow: "hidden" }}>
        <header style={{ padding: "14px 16px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", borderBottom: `1px solid ${C.gray100}` }}>
          <div style={{ flex: "1 1 220px" }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: C.gray900 }}>{cust ? "Customer returns" : rto ? "RTOs" : "Returns"} by product — delivered vs returned</h3>
            <div style={{ fontSize: 12.5, color: C.gray500, marginTop: 2 }}>
              Rate = {modeWord} in the period ÷ orders {cust ? "delivered" : "shipped"} in the same days (average {pct(avg)}). Returns lag orders by a week or so, so compare like with like.
            </div>
          </div>
          <div role="tablist" aria-label="Group by" style={{ display: "flex", gap: 4, padding: 3, background: C.gray100, borderRadius: 10 }}>
            {[["parent", "By parent SKU"], ["sku", "By SKU"]].map(([k, l]) => (
              <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)}
                style={{ border: "none", cursor: "pointer", fontFamily: "inherit", padding: "7px 14px", borderRadius: 8, minHeight: 38, fontSize: 13, fontWeight: view === k ? 800 : 700,
                  background: view === k ? C.white : "transparent", color: view === k ? C.gray900 : C.gray600 }}>{l}</button>
            ))}
          </div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search product or SKU…" aria-label="Search" style={{ ...S.inp, width: 200, minHeight: 40 }} />
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort by" style={{ ...S.inp, width: "auto", minHeight: 40 }}>
            <option value="rate">Highest rate</option><option value="returns">Most returned</option><option value="loss">Most money lost</option>
            <option value="saving">Biggest saving</option><option value="recent">Most in last 7 days</option>
          </select>
          {g && (
            <button onClick={() => setOnlyRisk((v) => !v)} aria-pressed={onlyRisk} style={{ ...btn(onlyRisk ? "primary" : "ghost", "sm"), minHeight: 40, ...(onlyRisk ? { background: "#DC2626", borderColor: "#DC2626" } : {}) }}>
              ⚠ Needs pausing{g.at_risk ? ` (${g.at_risk})` : ""}
            </button>
          )}
        </header>
        {flag && <div style={{ padding: "8px 16px", fontSize: 12.5, fontWeight: 700, color: C.gray700, background: C.gray50 }}>Showing only “{flag}” · <button onClick={() => setFlag("")} style={{ border: "none", background: "none", color: C.orange, fontWeight: 800, cursor: "pointer" }}>clear</button></div>}

        {rows.length === 0 ? (
          <div style={{ padding: 36, textAlign: "center", color: C.gray500, fontSize: 14 }}>{onlyRisk ? "No product needs pausing right now." : "Nothing matches."}</div>
        ) : mobile ? (
          <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            {rows.map((e) => (
              <Entity key={e.key + (e.parent || "")} e={e} mobile mode={mode} flag={flag} guard={g} onDone={load}
                open={view === "parent" && openKeys.has(e.key)} onToggle={view === "parent" && e.has_parent ? () => toggle(e.key) : undefined}>
                {skusOf(e.key).map((s) => <Entity key={s.key} e={s} mobile mode={mode} flag={flag} guard={g} onDone={load} depth={1} />)}
              </Entity>
            ))}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  <ThCell>{view === "parent" ? "Parent SKU" : "SKU"}</ThCell>
                  <ThCell>Delivered vs returned</ThCell>
                  <ThCell right onClick={() => setSort("returns")} active={sort === "returns"}>{cust ? "Returned" : rto ? "RTO" : "Returns"}</ThCell>
                  <ThCell right onClick={() => setSort("rate")} active={sort === "rate"}>Rate</ThCell>
                  <ThCell right onClick={() => setSort("recent")} active={sort === "recent"}>7 / 30 days</ThCell>
                  <ThCell>Trend</ThCell>
                  <ThCell>{rto ? "Couriers" : "Why (top reasons)"}</ThCell>
                  <ThCell right onClick={() => setSort("loss")} active={sort === "loss"}>Money lost</ThCell>
                  <ThCell>Verdict</ThCell>
                  <ThCell>Pause</ThCell>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <Entity key={e.key + (e.parent || "")} e={e} mode={mode} flag={flag} guard={g} onDone={load}
                    open={view === "parent" && openKeys.has(e.key)} onToggle={view === "parent" && e.has_parent ? () => toggle(e.key) : undefined}>
                    {skusOf(e.key).map((s) => <Entity key={s.key} e={s} mode={mode} flag={flag} guard={g} onDone={load} depth={1} />)}
                  </Entity>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p style={{ fontSize: 12, color: C.gray500, margin: 0, lineHeight: 1.5 }}>
        Returns are the ones Meesho's Returns page lists (read every 10 minutes), by the day each was raised; {data.data.synced} of {data.data.returns_in_range} in range came straight from the sync.
        Delivered = shipped minus RTO. Money comes from the payments sheet by sub-order — a return with no settled payment yet shows no loss.
        Pausing a product hides it in the Listing Hub for listing managers; it does not change the product on Meesho.
      </p>
    </div>
  );
}
