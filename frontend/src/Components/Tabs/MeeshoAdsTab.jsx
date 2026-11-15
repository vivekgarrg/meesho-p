import React, { useCallback, useEffect, useMemo, useState } from "react";
import { API, C, S, btn, useIsMobile } from "../../App";
import { CircularProgress } from "@mui/material";
import { Panel, Kpi, StatusDot, TONE, inr, inrShort, num, ago, dayLabel } from "./MeeshoUI";

/*
 * Meesho → Ads. What the sync reads off the panel's Advertisement page every
 * few minutes (server: meesho_ads.py, worker: MeeshoAdsJob):
 *   the days' spend, ad orders and Meesho's ROI;
 *   today's live catalogs against the auto-pause rule (over ₹X today with no
 *   order → paused in its campaign), with Pause / Resume by hand;
 *   each catalog's true ROI — its ad orders × what an order of it really nets
 *   (settled payments less costs, returns included) less the ad cost with GST;
 *   every campaign, and every pause the rule or a person made.
 */

async function api(path = "", method = "GET", body) {
  const res = await fetch(`${API}/meesho-ads/${path}`, {
    method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined,
  }).catch(() => null);
  const data = res ? await res.json().catch(() => ({})) : { error: "Couldn't reach the server." };
  return { ok: !!res && res.ok, data };
}

const RANGES = [7, 14, 30, 90];
const isoDay = (d) => d.toISOString().slice(0, 10);
const pct = (v, d = 1) => (v === null || v === undefined ? "—" : `${Number(v).toFixed(d)}%`);
const x2 = (v) => (v === null || v === undefined ? "—" : Number(v).toFixed(2));
const VERDICT = {
  scale: { tone: "good", label: "Scale up" },
  keep: { tone: "good", label: "Profitable" },
  learning: { tone: "info", label: "Too early" },
  losing: { tone: "bad", label: "Losing" },
  pause: { tone: "bad", label: "Pause" },
  loss_anyway: { tone: "bad", label: "Loss without ads" },
  no_cost: { tone: "neutral", label: "No cost price" },
};
const PAUSE_TONE = { PAUSED: "warn", RESUMED: "good", FAILED: "bad", QUEUED: "info" };
const th = { textAlign: "left", padding: "8px 10px", fontSize: 11.5, fontWeight: 800, color: C.gray500, textTransform: "uppercase",
  letterSpacing: "0.03em", borderBottom: `1px solid ${C.gray200}`, whiteSpace: "nowrap", background: C.gray50, position: "sticky", top: 0 };
const td = { padding: "8px 10px", fontSize: 13, color: C.gray800, borderBottom: `1px solid ${C.gray100}`, verticalAlign: "middle",
  fontVariantNumeric: "tabular-nums" };
const tdR = { ...td, textAlign: "right", whiteSpace: "nowrap" };

function Thumb({ src }) {
  return src ? <img src={src} alt="" loading="lazy" style={{ width: 36, height: 36, borderRadius: 6, objectFit: "cover", flexShrink: 0, background: C.gray100 }} />
    : <span style={{ width: 36, height: 36, borderRadius: 6, background: C.gray100, flexShrink: 0 }} />;
}

function Name({ img, name, sub }) {
  return (
    <span style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
      <Thumb src={img} />
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontWeight: 700, color: C.gray900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>{name || "—"}</span>
        {sub && <span style={{ display: "block", fontSize: 11.5, color: C.gray500 }}>{sub}</span>}
      </span>
    </span>
  );
}

function Table({ head, children, maxHeight = 520 }) {
  return (
    <div style={{ overflow: "auto", maxHeight, border: `1px solid ${C.gray200}`, borderRadius: 8 }}>
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 720 }}>
        <thead><tr>{head.map((h) => <th key={h.k || h} style={{ ...th, textAlign: h.r ? "right" : "left", cursor: h.onClick ? "pointer" : "default" }}
          onClick={h.onClick} title={h.hint}>{h.label || h}{h.sorted ? (h.sorted === "desc" ? " ↓" : " ↑") : ""}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** Spend per day (bars, one series), the day's orders and ROI in the tooltip. */
function DailyChart({ series }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...series.map((d) => d.spend));
  const H = 140;
  const h = hover !== null ? series[hover] : null;
  return (
    <div style={{ position: "relative" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: H, borderBottom: `1px solid ${C.gray200}` }}
        onMouseLeave={() => setHover(null)}>
        {series.map((d, i) => (
          <div key={d.date} onMouseEnter={() => setHover(i)} style={{ flex: 1, height: "100%", display: "flex", alignItems: "flex-end", cursor: "default" }}>
            <div style={{ width: "100%", height: `${d.read ? Math.max(d.spend ? 2 : 0, (100 * d.spend) / max) : 0}%`,
              background: d.orders ? "#2563EB" : "#93C5FD", borderRadius: "4px 4px 0 0", opacity: hover === null || hover === i ? 1 : 0.5 }} />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.gray500, marginTop: 4 }}>
        <span>{dayLabel(series[0]?.date)}</span><span>{dayLabel(series[series.length - 1]?.date)}</span>
      </div>
      <div style={{ display: "flex", gap: 14, fontSize: 11.5, color: C.gray600, marginTop: 6 }}>
        <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#2563EB", borderRadius: 2, marginRight: 4 }} />spend, with orders</span>
        <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#93C5FD", borderRadius: 2, marginRight: 4 }} />spend, no order</span>
      </div>
      {h && (
        <div style={{ position: "absolute", top: 0, right: 0, background: C.white, border: `1px solid ${C.gray200}`, borderRadius: 8,
          padding: "8px 10px", fontSize: 12, boxShadow: "0 4px 14px rgba(15,23,42,.08)", pointerEvents: "none" }}>
          <div style={{ fontWeight: 800, color: C.gray900 }}>{dayLabel(h.date)}</div>
          {h.read ? <>
            <div>Spend {inr(h.spend, 2)} · orders {h.orders}</div>
            <div>Ad revenue {inr(h.revenue)} · ROI {h.spend ? x2(h.revenue / h.spend) : "—"}</div>
          </> : <div style={{ color: C.gray500 }}>not read yet</div>}
        </div>
      )}
    </div>
  );
}

function RuleCard({ rule, admin, onSaved }) {
  const [spend, setSpend] = useState(rule.spend);
  const [orders, setOrders] = useState(rule.orders);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  useEffect(() => { setSpend(rule.spend); setOrders(rule.orders); }, [rule.spend, rule.orders]);
  const save = async (patch) => {
    if (patch.auto_pause && !window.confirm(`Turn on auto-pause?\n\nEvery ${rule.every || 5} minutes, any catalog in a live campaign that has spent over ₹${spend} today with ${orders ? `${orders} or fewer orders` : "no order"} today is paused in that campaign on Meesho. The product stays live; only its ad stops.`)) return;
    setBusy(true); setMsg(null);
    const r = await api("rule/", "POST", patch);
    setBusy(false);
    if (r.ok) { onSaved(r.data.rule); setMsg({ text: "Saved." }); } else setMsg({ bad: true, text: r.data.error || "Couldn't save." });
  };
  return (
    <Panel title="Auto-pause" subtitle={`Checked every ${rule.every || 5} minutes on each live campaign — today's figures (IST), read fresh each time`}
      action={<StatusDot tone={rule.auto_pause ? "good" : "neutral"}>{rule.auto_pause ? "On" : "Off"}</StatusDot>}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", fontSize: 13, color: C.gray700 }}>
        <span>Pause a catalog in its campaign when today's spend is over</span>
        <input type="number" min={5} step={1} value={spend} disabled={!admin || busy} onChange={(e) => setSpend(e.target.value)}
          style={{ ...S.inp, width: 80 }} aria-label="Spend limit, ₹" />
        <span>with at most</span>
        <input type="number" min={0} max={20} value={orders} disabled={!admin || busy} onChange={(e) => setOrders(e.target.value)}
          style={{ ...S.inp, width: 64 }} aria-label="Orders allowed" />
        <span>orders today.</span>
        {admin && <>
          <button style={btn("ghost", "sm")} disabled={busy || (Number(spend) === rule.spend && Number(orders) === rule.orders)}
            onClick={() => save({ spend, orders })}>Save</button>
          <button style={btn(rule.auto_pause ? "ghost" : "primary", "sm")} disabled={busy}
            onClick={() => save({ auto_pause: !rule.auto_pause, spend, orders })}>{rule.auto_pause ? "Turn off" : "Turn on"}</button>
        </>}
      </div>
      <div style={{ fontSize: 12, color: C.gray500, marginTop: 8 }}>
        A catalog someone sets active again by hand is left alone for the rest of that day. Every pause is logged below with the figures it went by.
      </div>
      {msg && <div style={{ fontSize: 12.5, marginTop: 6, color: msg.bad ? C.red : "#15803D" }}>{msg.text}</div>}
    </Panel>
  );
}

function Insights({ items }) {
  if (!items?.length) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map((i, k) => {
        const t = TONE[i.level === "good" ? "good" : i.level === "bad" ? "bad" : "warn"];
        return (
          <div key={k} style={{ border: `1px solid ${C.gray200}`, borderLeft: `4px solid ${t.accent}`, borderRadius: 8, padding: "10px 12px", background: C.white }}>
            <div style={{ fontWeight: 800, color: t.fg, fontSize: 13.5 }}>{i.title}</div>
            {i.detail && <div style={{ fontSize: 12.5, color: C.gray600, marginTop: 2 }}>{i.detail}</div>}
          </div>
        );
      })}
    </div>
  );
}

function LiveToday({ b, rule, admin, onAct, acting }) {
  const rows = b.today.catalogs;
  return (
    <Panel title="Live now — today" subtitle={`${dayLabel(b.today.date)} · ${inr(b.today.spend, 2)} spent · ${b.today.orders} orders · ROI ${x2(b.today.roi)}`}>
      {!rows.length ? <div style={{ fontSize: 13, color: C.gray500 }}>No live campaign today.</div> : (
        <Table head={["Catalog", "In campaign", { label: "Spend today", r: true }, { label: "Orders", r: true }, { label: "Revenue", r: true },
          { label: "ROI", r: true }, { label: "Clicks", r: true }, { label: "CTR", r: true }, { label: "Rule", hint: `over ₹${rule.spend} with ≤${rule.orders} orders` }, ""]}>
          {rows.map((r) => {
            const share = Math.min(100, (100 * r.spend) / Math.max(rule.spend, 1));
            return (
              <tr key={`${r.campaign_id}-${r.catalog_id}`}>
                <td style={td}><Name img={r.image} name={r.name} sub={`#${r.catalog_id}`} /></td>
                <td style={td}><StatusDot tone={r.status === "ACTIVE" ? "good" : "neutral"}>{r.status === "ACTIVE" ? "Active" : "Paused"}</StatusDot></td>
                <td style={tdR}>
                  <div>{inr(r.spend, 2)}</div>
                  {r.status === "ACTIVE" && r.orders <= rule.orders && (
                    <div style={{ height: 4, background: C.gray100, borderRadius: 2, marginTop: 4, width: 90, marginLeft: "auto" }} title={`₹${rule.spend} limit`}>
                      <div style={{ height: "100%", width: `${share}%`, background: share >= 100 ? C.red : share > 70 ? "#F59E0B" : "#2563EB", borderRadius: 2 }} />
                    </div>
                  )}
                </td>
                <td style={tdR}>{r.orders}</td>
                <td style={tdR}>{inr(r.revenue)}</td>
                <td style={tdR}>{x2(r.roi)}</td>
                <td style={tdR}>{num(r.clicks)}</td>
                <td style={tdR}>{pct(r.ctr, 2)}</td>
                <td style={td}>{r.over_limit ? <StatusDot tone="bad">Over — {rule.auto_pause ? "pausing" : "would pause"}</StatusDot>
                  : r.left_before_pause !== null ? <span style={{ fontSize: 12, color: C.gray500 }}>{inr(r.left_before_pause, 2)} left</span>
                  : <span style={{ fontSize: 12, color: C.gray400 }}>—</span>}</td>
                <td style={tdR}>{admin && (
                  <button style={btn("ghost", "sm")} disabled={acting}
                    onClick={() => onAct(b, r, r.status === "ACTIVE" ? "pause" : "resume")}>{r.status === "ACTIVE" ? "Pause" : "Resume"}</button>
                )}</td>
              </tr>
            );
          })}
        </Table>
      )}
    </Panel>
  );
}

const CAT_COLS = [
  { k: "name", label: "Catalog" },
  { k: "spend", label: "Spend", r: true, v: (c) => c.lifetime.spend },
  { k: "orders", label: "Ad orders", r: true, v: (c) => c.lifetime.orders },
  { k: "revenue", label: "Ad revenue", r: true, v: (c) => c.lifetime.revenue },
  { k: "roi", label: "Meesho ROI", r: true, v: (c) => c.lifetime.roi, hint: "ad revenue ÷ spend" },
  { k: "cpo", label: "Cost / order", r: true, v: (c) => c.lifetime.cpo, hint: "spend ÷ ad orders (before GST)" },
  { k: "npo", label: "Earns / order", r: true, v: (c) => c.economics.net_per_order, hint: "what an order of this catalog nets: settled less item, packaging, tax; returns included — last 120 days" },
  { k: "be", label: "Break-even ROI", r: true, v: (c) => c.breakeven_roi, hint: "below this Meesho ROI the ads cost more than the orders earn" },
  { k: "ret", label: "Returns", r: true, v: (c) => c.economics.return_pct },
  { k: "profit", label: "True profit", r: true, v: (c) => c.true_profit, hint: "ad orders × earns per order − spend × 1.18" },
  { k: "troi", label: "True ROI", r: true, v: (c) => c.true_roi_pct, hint: "true profit ÷ ad cost with GST" },
  { k: "verdict", label: "Verdict" },
];

function Catalogs({ b }) {
  const [sort, setSort] = useState({ k: "spend", dir: "desc" });
  const [only, setOnly] = useState("all");
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const col = CAT_COLS.find((c) => c.k === sort.k);
    let xs = b.catalogs.filter((c) => (only === "all" || (only === "live" ? c.live_in.length : c.verdict === only))
      && (!q || `${c.name} ${c.catalog_id}`.toLowerCase().includes(q.toLowerCase())));
    if (col?.v) xs = [...xs].sort((a, z) => ((col.v(a) ?? -1e12) - (col.v(z) ?? -1e12)) * (sort.dir === "desc" ? -1 : 1));
    return xs;
  }, [b.catalogs, sort, only, q]);
  const counts = b.catalogs.reduce((m, c) => ({ ...m, [c.verdict]: (m[c.verdict] || 0) + 1 }), {});
  const chip = (k, label) => (
    <button key={k} onClick={() => setOnly(k)} style={{ ...btn(only === k ? "primary" : "ghost", "sm"), whiteSpace: "nowrap" }}>{label}</button>
  );
  return (
    <Panel title="Catalogs — true ROI" subtitle="Every campaign each catalog has been in, together. Earns / order is from your own settled payments and SKU costs.">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10, alignItems: "center" }}>
        {chip("all", `All ${b.catalogs.length}`)}
        {chip("live", `In a live campaign ${b.catalogs.filter((c) => c.live_in.length).length}`)}
        {Object.entries(VERDICT).filter(([k]) => counts[k]).map(([k, v]) => chip(k, `${v.label} ${counts[k]}`))}
        <input placeholder="Find a catalog" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...S.inp, width: 180, marginLeft: "auto" }} />
      </div>
      <Table head={CAT_COLS.map((c) => ({ ...c, onClick: c.v ? () => setSort((s) => ({ k: c.k, dir: s.k === c.k && s.dir === "desc" ? "asc" : "desc" })) : undefined,
        sorted: sort.k === c.k ? sort.dir : null }))}>
        {rows.map((c) => {
          const v = VERDICT[c.verdict] || VERDICT.no_cost;
          return (
            <tr key={c.catalog_id}>
              <td style={td}><Name img={c.image} name={c.name}
                sub={`#${c.catalog_id} · ${c.campaigns} campaign${c.campaigns === 1 ? "" : "s"}${c.live_in.length ? " · live" : ""}`} /></td>
              <td style={tdR}>{inr(c.lifetime.spend)}</td>
              <td style={tdR}>{c.lifetime.orders}</td>
              <td style={tdR}>{inr(c.lifetime.revenue)}</td>
              <td style={tdR}>{x2(c.lifetime.roi)}</td>
              <td style={tdR}>{inr(c.lifetime.cpo)}</td>
              <td style={tdR} title={`${c.economics.orders} orders judged${c.economics.unpriced ? `, ${c.economics.unpriced} without a cost price` : ""}`}>{inr(c.economics.net_per_order)}</td>
              <td style={{ ...tdR, color: c.breakeven_roi && c.lifetime.roi !== null ? (c.lifetime.roi >= c.breakeven_roi ? "#15803D" : C.red) : C.gray800 }}>{x2(c.breakeven_roi)}</td>
              <td style={tdR}>{pct(c.economics.return_pct, 0)}</td>
              <td style={{ ...tdR, fontWeight: 800, color: c.true_profit === null ? C.gray400 : c.true_profit >= 0 ? "#15803D" : C.red }}>{inr(c.true_profit)}</td>
              <td style={tdR}>{pct(c.true_roi_pct, 0)}</td>
              <td style={{ ...td, minWidth: 220 }}><StatusDot tone={v.tone}>{v.label}</StatusDot>
                <div style={{ fontSize: 11.5, color: C.gray500, marginTop: 2 }}>{c.verdict_text}</div></td>
            </tr>
          );
        })}
      </Table>
    </Panel>
  );
}

function Campaigns({ b }) {
  const [all, setAll] = useState(false);
  const rows = all ? b.campaigns : b.campaigns.slice(0, 15);
  return (
    <Panel title="Campaigns" subtitle={`${b.campaigns.length} — lifetime figures from Meesho`}
      action={b.campaigns.length > 15 && <button style={btn("ghost", "sm")} onClick={() => setAll(!all)}>{all ? "Fewer" : "Show all"}</button>}>
      <Table head={["Campaign", "Status", "Ran", { label: "Catalogs", r: true }, { label: "Budget", r: true }, { label: "Spend", r: true },
        { label: "Orders", r: true }, { label: "Revenue", r: true }, { label: "ROI", r: true }, { label: "Cost / order", r: true }, { label: "CTR", r: true }]}>
        {rows.map((c) => (
          <tr key={c.campaign_id}>
            <td style={td}><Name img={c.image} name={c.name} sub={`#${c.campaign_id} · ${c.bid_type || c.type}${c.bid ? ` · bid ${c.bid}` : ""}`} /></td>
            <td style={td}><StatusDot tone={c.status === "LIVE" ? "good" : "neutral"}>{c.status === "LIVE" ? `Live${c.feedback ? ` · ${c.feedback.toLowerCase()}` : ""}` : (c.reason || c.status).replace(/_/g, " ").toLowerCase()}</StatusDot></td>
            <td style={{ ...td, whiteSpace: "nowrap", fontSize: 12 }}>{dayLabel(c.start)}{c.end ? ` → ${dayLabel(c.end)}` : ""}</td>
            <td style={tdR}>{c.catalog_count}</td>
            <td style={tdR}>{inr(c.budget)}</td>
            <td style={tdR}>{inr(c.spend)}</td>
            <td style={tdR}>{c.orders}</td>
            <td style={tdR}>{inr(c.revenue)}</td>
            <td style={tdR}>{x2(c.roi)}</td>
            <td style={tdR}>{inr(c.cpo)}</td>
            <td style={tdR}>{pct(c.ctr, 2)}</td>
          </tr>
        ))}
      </Table>
    </Panel>
  );
}

function PauseLog({ b }) {
  if (!b.pauses.length) return null;
  return (
    <Panel title="Pauses and resumes" subtitle="By the auto-pause rule or by hand — with the day's figures it went by">
      <Table maxHeight={360} head={["When", "Catalog", "What", { label: "Spend that day", r: true }, { label: "Orders", r: true }, "Result"]}>
        {b.pauses.map((p) => (
          <tr key={p.id}>
            <td style={{ ...td, whiteSpace: "nowrap", fontSize: 12 }}>{ago(p.at)}</td>
            <td style={td}>{p.name || p.catalog_id}<div style={{ fontSize: 11.5, color: C.gray500 }}>#{p.catalog_id} in #{p.campaign_id}</div></td>
            <td style={td}>{p.action === "PAUSE" ? "Pause" : "Resume"} · {p.trigger === "AUTO" ? `rule (₹${p.limit})` : `by ${p.by || "hand"}`}</td>
            <td style={tdR}>{inr(p.spend, 2)}</td>
            <td style={tdR}>{p.orders}</td>
            <td style={td}><StatusDot tone={PAUSE_TONE[p.status] || "neutral"}>{p.status.toLowerCase()}</StatusDot>
              {p.status === "FAILED" && <div style={{ fontSize: 11.5, color: C.gray500 }}>{p.message}</div>}</td>
          </tr>
        ))}
      </Table>
    </Panel>
  );
}

function Business({ b, rule, admin, onAct, acting, showName }) {
  const t = b.totals;
  const tp = b.true;
  const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 };
  const deductedOff = b.deducted.ads_cost !== null && b.deducted.panel_with_gst
    && Math.abs(b.deducted.ads_cost - b.deducted.panel_with_gst) > Math.max(50, b.deducted.panel_with_gst * 0.1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {showName && <h2 style={{ margin: "8px 0 0", fontSize: 17, fontWeight: 900, color: C.gray900 }}>{b.business}</h2>}
      {!b.campaigns.length ? (
        <Panel title="No ads read yet">
          <div style={{ fontSize: 13, color: C.gray600 }}>{b.last_run ? `Last read: ${b.last_run.status.toLowerCase()} — ${b.last_run.message}` : "Press Refresh, or wait for the next read (every 5 minutes)."}</div>
        </Panel>
      ) : <>
        <div style={grid}>
          <Kpi label="Ad spend" value={inrShort(t.spend)} sub={`${inr(t.cost_with_gst)} with GST · ${b.range.days_read} of ${b.range.days} days read`} />
          <Kpi label="Ad orders" value={num(t.orders)} sub={`${inr(t.cpo)} per order · ${pct(t.cvr, 2)} of clicks`} />
          <Kpi label="Ad revenue" value={inrShort(t.revenue)} sub={`${inr(t.aov)} an order`} />
          <Kpi label="Meesho ROI" value={x2(t.roi)} tone={t.roi === null ? "neutral" : t.roi >= 10 ? "good" : t.roi >= 5 ? "warn" : "bad"} sub="ad revenue ÷ spend" />
          <Kpi label="True profit from ads" value={inr(tp.profit)} tone={tp.spend_judged ? (tp.profit >= 0 ? "good" : "bad") : "neutral"}
            sub={tp.spend_judged ? `on ${inr(tp.spend_judged)} of spend${tp.spend_unpriced ? ` · ${inr(tp.spend_unpriced)} not judged (no cost price)` : ""}` : "no daily catalog figures in these days yet"} />
          <Kpi label="Clicks" value={num(t.clicks)} sub={`${pct(t.ctr, 2)} of ${num(t.views)} views · ${inr(t.cpc, 2)} a click`} />
        </div>
        {deductedOff && (
          <div style={{ fontSize: 12.5, color: "#B45309", background: C.amberLight, borderRadius: 8, padding: "8px 12px" }}>
            Meesho deducted {inr(b.deducted.ads_cost)} for ads in these days' payments (Ads Cost sheet), against {inr(b.deducted.panel_with_gst)} the panel shows with GST — the payment can cover other days' spend, or a payment file isn't uploaded yet.
          </div>
        )}
        <Insights items={b.insights} />
        <LiveToday b={b} rule={rule} admin={admin} onAct={onAct} acting={acting} />
        <Panel title="Spend per day" subtitle={`${dayLabel(b.range.from)} – ${dayLabel(b.range.to)}`}><DailyChart series={b.series} /></Panel>
        <Catalogs b={b} />
        <Campaigns b={b} />
        <PauseLog b={b} />
      </>}
    </div>
  );
}

export function MeeshoAdsTab() {
  const isMobile = useIsMobile();
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);
  const [acting, setActing] = useState(false);

  const load = useCallback(async (quiet) => {
    if (!quiet) setLoading(true);
    const to = new Date();
    const from = new Date(Date.now() - (days - 1) * 86400000);
    const r = await api(`?date_from=${isoDay(from)}&date_to=${isoDay(to)}`);
    setLoading(false);
    if (r.ok) { setData(r.data); setErr(null); } else setErr(r.data.error || "Couldn't load the ads.");
  }, [days]);
  useEffect(() => { load(); }, [load]);
  // The worker reads every few minutes: keep the page current while it's open.
  useEffect(() => { const t = setInterval(() => load(true), 60000); return () => clearInterval(t); }, [load]);

  const refresh = async () => {
    setMsg(null);
    const r = await api("refresh/", "POST", {});
    setMsg(r.ok ? { text: "Reading Meesho Ads — the page updates in a minute or so." } : { bad: true, text: r.data.error || "Couldn't start the read." });
    if (r.ok) setTimeout(() => load(true), 45000);
  };
  const act = async (b, row, action) => {
    const what = action === "pause" ? "Pause" : "Set active again";
    if (!window.confirm(`${what} "${row.name || row.catalog_id}" in campaign #${row.campaign_id} on Meesho?\n\nToday: ${inr(row.spend, 2)} spent, ${row.orders} orders.${action === "resume" ? "\n\nThe auto-pause leaves it alone for the rest of today." : ""}`)) return;
    setActing(true); setMsg(null);
    const r = await api("catalog/", "POST", { business: b.business_id, campaign_id: row.campaign_id, catalog_id: row.catalog_id, action });
    setActing(false);
    setMsg(r.ok ? { text: `${what}: sent to Meesho — the log below shows when it's done.` } : { bad: true, text: r.data.error || "Couldn't send it." });
    if (r.ok) { setTimeout(() => load(true), 8000); setTimeout(() => load(true), 25000); }
  };

  if (loading && !data) return <div style={{ padding: 40, textAlign: "center" }}><CircularProgress size={28} /></div>;
  if (err && !data) return <div style={{ ...S.card, padding: 16, color: C.red }}>{err}</div>;
  const many = data.businesses.length > 1;
  const lastRead = data.businesses.map((b) => b.last_read).filter(Boolean).sort().pop();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 4 }}>
          {RANGES.map((n) => <button key={n} style={btn(days === n ? "primary" : "ghost", "sm")} onClick={() => setDays(n)}>{n} days</button>)}
        </div>
        <span style={{ fontSize: 12.5, color: C.gray500, marginLeft: isMobile ? 0 : "auto" }}>Read {ago(lastRead)}</span>
        <button style={btn("ghost", "sm")} onClick={refresh}>↻ Refresh</button>
      </div>
      {msg && <div style={{ fontSize: 13, color: msg.bad ? C.red : "#15803D" }}>{msg.text}</div>}
      <RuleCard rule={data.rule} admin={data.admin} onSaved={(rule) => setData((d) => ({ ...d, rule }))} />
      {data.businesses.map((b) => (
        <Business key={b.business_id} b={b} rule={data.rule} admin={data.admin} onAct={act} acting={acting} showName={many} />
      ))}
    </div>
  );
}
