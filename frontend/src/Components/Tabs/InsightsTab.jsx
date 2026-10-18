import React, { useEffect, useMemo, useState } from "react";
import CircularProgress from "@mui/material/CircularProgress";
import { API, C, S, fmt } from "../../App";
import { useDateFilter } from "../../contexts/DateFilterContext";
import { AppLineChart } from "../Charts/AppLineChart";
import { AIPanel, ClaimsSection, ClaimsUploadButton, PaymentsSection } from "./InsightsPanels";

/**
 * Business Insights — what is selling, what is leaking money, and what
 * changed versus the period before. All of it is computed on the server
 * (meesho_app/insights.py) from the same numbers as the Profit page; this
 * screen only lays it out.
 */

const SEVERITY = {
  critical:    { label: "Fix now",     color: C.red,    bg: C.redLight,    border: C.redBorder },
  warning:     { label: "Watch",       color: C.amber,  bg: C.amberLight,  border: C.amberBorder },
  opportunity: { label: "Opportunity", color: C.blue,   bg: C.blueLight,   border: C.blueLight },
  good:        { label: "Working",     color: C.green,  bg: C.greenLight,  border: C.greenBorder },
  info:        { label: "Good to know", color: C.gray500, bg: C.gray50,    border: C.gray200 },
};

const FILTERS = [
  { key: "all", label: "All", match: () => true },
  { key: "problems", label: "Problems", match: (h) => h.severity === "critical" || h.severity === "warning" },
  { key: "growth", label: "Growth", match: (h) => h.severity === "opportunity" || h.severity === "good" },
  { key: "info", label: "Other", match: (h) => h.severity === "info" },
];

const fmtDay = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "");
const pct = (v) => (v == null ? "—" : `${v}%`);
const num = (v) => (v == null ? "—" : Number(v).toLocaleString("en-IN"));

function fmtKpi(value, format) {
  if (value == null) return "—";
  if (format === "money") return fmt(value);
  if (format === "pct") return `${value}%`;
  return num(value);
}

function KpiCard({ k }) {
  const hasChange = k.change != null && k.change !== 0;
  const better = hasChange && ((k.change > 0) === (k.good_when === "up"));
  const color = !hasChange ? C.gray400 : better ? C.green : C.red;
  return (
    <div style={{ ...S.card, display: "flex", flexDirection: "column", gap: 6, padding: 16 }}>
      <p style={{ fontSize: 11, fontWeight: 700, color: C.gray400, letterSpacing: "0.07em", textTransform: "uppercase" }}>{k.label}</p>
      <p style={{ fontSize: 22, fontWeight: 800, color: C.gray800, fontFamily: "monospace", lineHeight: 1.1 }}>{fmtKpi(k.current, k.format)}</p>
      <p style={{ fontSize: 11.5, color }}>
        {hasChange ? `${k.change > 0 ? "▲" : "▼"} ${Math.abs(k.change)}${k.change_unit === "pts" ? " pts" : "%"}` : "no change"}
        <span style={{ color: C.gray400 }}> · was {fmtKpi(k.previous, k.format)}</span>
      </p>
    </div>
  );
}

function HighlightCard({ h }) {
  const sev = SEVERITY[h.severity] || SEVERITY.info;
  const isGain = h.severity === "opportunity" || h.severity === "good";
  return (
    <div style={{ ...S.card, padding: 16, borderLeft: `4px solid ${sev.color}`, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase",
          color: sev.color, background: sev.bg, border: `1px solid ${sev.border}`, borderRadius: 999, padding: "2px 8px" }}>
          {sev.label}
        </span>
        {h.impact > 0 && (
          <span style={{ fontSize: 11.5, fontWeight: 700, color: isGain ? C.green : C.red }}>
            ≈ {fmt(h.impact)} {isGain ? (h.kind === "top_performer" ? "profit" : "upside") : "at stake"}
          </span>
        )}
      </div>
      <p style={{ fontSize: 14, fontWeight: 800, color: C.gray800, wordBreak: "break-word" }}>{h.title}</p>
      <p style={{ fontSize: 12.5, color: C.gray600, lineHeight: 1.5 }}>{h.why}</p>
      <p style={{ fontSize: 12.5, color: C.gray700, lineHeight: 1.5, background: C.gray50, borderRadius: 8, padding: "8px 10px" }}>
        <b>What to do: </b>{h.action}
      </p>
    </div>
  );
}

function SkuCell({ row }) {
  return (
    <td style={{ ...S.td, maxWidth: 280 }}>
      <div style={{ fontWeight: 700, color: C.gray800, wordBreak: "break-word" }}>{row.sku}</div>
      {(row.product_name || row.parent) && (
        <div style={{ fontSize: 11, color: C.gray400, wordBreak: "break-word" }}>
          {row.parent && row.parent !== row.sku ? `${row.parent}` : ""}
          {row.parent && row.product_name && row.parent !== row.sku ? " · " : ""}
          {row.product_name ? row.product_name.slice(0, 70) : ""}
        </div>
      )}
      {row.skus && row.is_parent && (
        <div style={{ fontSize: 11, color: C.gray400 }}>SKUs: {row.skus.join(", ")}</div>
      )}
    </td>
  );
}

const money = (v, strong) => (
  <span style={{ fontFamily: "monospace", fontWeight: strong ? 800 : 500, color: v == null ? C.gray400 : v >= 0 ? C.green : C.red }}>
    {v == null ? "—" : fmt(v)}
  </span>
);

const rateCols = (label) => ({ label, render: (r) => <span style={{ color: C.red, fontWeight: 700 }}>{pct(r.rate)}</span>, sub: (r) => `avg ${pct(r.baseline)}` });

const TABLES = [
  {
    key: "top_performers", label: "Top performers", hint: "Highest net profit this period (at least 5 settled orders).",
    cols: [
      { label: "Net profit", render: (r) => money(r.net_profit, true) },
      { label: "Share", render: (r) => pct(r.profit_share) },
      { label: "Profit / order", render: (r) => money(r.profit_per_order) },
      { label: "Settled", render: (r) => num(r.settled) },
      { label: "Return", render: (r) => pct(r.return_rate) },
      { label: "RTO", render: (r) => pct(r.rto_rate) },
      { label: "Last period", render: (r) => money(r.prev_net_profit) },
    ],
  },
  {
    key: "hidden_gems", label: "Hidden gems", hint: "High profit per order and fewer returns than average, but still low volume — cheap growth if pushed.",
    cols: [
      { label: "Profit / order", render: (r) => money(r.profit_per_order, true) },
      { label: "Orders", render: (r) => num(r.orders) },
      { label: "Return", render: (r) => pct(r.return_rate) },
      { label: "RTO", render: (r) => pct(r.rto_rate) },
      { label: "Net profit", render: (r) => money(r.net_profit) },
    ],
  },
  {
    key: "rising", label: "Rising", hint: "Products whose orders grew well beyond normal noise vs the previous period. SKUs under one parent are counted together.",
    cols: [
      { label: "Orders", render: (r) => <b>{num(r.prev_orders)} → {num(r.orders)}</b> },
      { label: "Change", render: (r) => <span style={{ color: C.green }}>{r.change_pct == null ? "new" : `+${r.change_pct}%`}</span> },
      { label: "Profit / order", render: (r) => money(r.profit_per_order) },
    ],
  },
  {
    key: "falling", label: "Falling", hint: "Products whose orders dropped well beyond normal noise. Check the listing is live, in stock and priced right.",
    cols: [
      { label: "Orders", render: (r) => <b>{num(r.prev_orders)} → {num(r.orders)}</b> },
      { label: "Change", render: (r) => <span style={{ color: C.red }}>{r.change_pct == null ? "—" : `${r.change_pct}%`}</span> },
      { label: "Profit / order (before)", render: (r) => money(r.prev_profit_per_order) },
    ],
  },
  {
    key: "high_returns", label: "High returns", hint: "Return rate credibly above your average — not just a couple of unlucky orders.",
    cols: [
      rateCols("Return rate"),
      { label: "Returns / settled", render: (r) => `${num(r.returns)} / ${num(r.settled)}` },
      { label: "Extra returns", render: (r) => `≈ ${Math.round(r.excess)}` },
      { label: "Money at stake", render: (r) => money(-r.money_at_stake) },
      { label: "Top reasons", render: (r) => (r.top_reasons?.length ? r.top_reasons.map((x) => `${x.reason} (${x.count})`).join("; ") : "—") },
    ],
  },
  {
    key: "high_rto", label: "High RTO", hint: "Orders that came back undelivered far more often than your average.",
    cols: [
      rateCols("RTO rate"),
      { label: "RTO / settled", render: (r) => `${num(r.rto)} / ${num(r.settled)}` },
      { label: "Extra RTO", render: (r) => `≈ ${Math.round(r.excess)}` },
      { label: "Profit lost", render: (r) => money(-r.money_at_stake) },
    ],
  },
  {
    key: "high_claims", label: "High claims", hint: "Claims (damaged / wrong returns) far above your average.",
    cols: [
      rateCols("Claim rate"),
      { label: "Claims / settled", render: (r) => `${num(r.claims)} / ${num(r.settled)}` },
      { label: "Claim loss", render: (r) => money(r.claim_loss) },
      { label: "Recovered", render: (r) => money(r.claim_settlement) },
    ],
  },
  {
    key: "loss_makers", label: "Loss makers", hint: "SKUs that lost money overall this period, and the main reason why.",
    cols: [
      { label: "Net profit", render: (r) => money(r.net_profit, true) },
      { label: "Main cause", render: (r) => <span style={{ color: C.red, fontWeight: 700 }}>{r.main_cause}</span> },
      { label: "Delivered profit", render: (r) => money(r.delivered_profit) },
      { label: "Return / RTO", render: (r) => `${pct(r.return_rate)} / ${pct(r.rto_rate)}` },
      { label: "Settled", render: (r) => num(r.settled) },
    ],
  },
  {
    key: "return_spikes", label: "Return spikes", hint: "Same SKU, much worse return rate than last period. Only shown when both periods are mostly settled.",
    cols: [
      { label: "Return rate", render: (r) => <b>{pct(r.prev_return_rate)} → <span style={{ color: C.red }}>{pct(r.return_rate)}</span></b> },
      { label: "Settled", render: (r) => num(r.settled) },
      { label: "Return loss", render: (r) => money(r.return_loss) },
    ],
  },
];

function DataTable({ table, rows }) {
  if (!rows?.length) {
    return <p style={{ padding: 24, textAlign: "center", color: C.gray400, fontSize: 13 }}>Nothing stands out here for this period.</p>;
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ ...S.th, textAlign: "left" }}>{table.key === "rising" || table.key === "falling" ? "Product" : "SKU"}</th>
            {table.cols.map((c) => <th key={c.label} style={{ ...S.th, textAlign: "right", whiteSpace: "nowrap" }}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.sku} style={{ background: i % 2 ? C.gray50 : C.white }}>
              <SkuCell row={r} />
              {table.cols.map((c) => (
                <td key={c.label} style={{ ...S.td, textAlign: "right", whiteSpace: c.label === "Top reasons" ? "normal" : "nowrap" }}>
                  {c.render(r)}
                  {c.sub && <div style={{ fontSize: 10.5, color: C.gray400 }}>{c.sub(r)}</div>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatesTable({ states }) {
  if (!states?.length) return <p style={{ padding: 24, textAlign: "center", color: C.gray400, fontSize: 13 }}>No state data for this period.</p>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>{["State", "Orders", "Delivered", "RTO", "RTO rate", "Return rate"].map((h, i) => (
            <th key={h} style={{ ...S.th, textAlign: i ? "right" : "left" }}>{h}</th>))}</tr>
        </thead>
        <tbody>
          {states.map((s, i) => (
            <tr key={s.state} style={{ background: s.flag ? C.redLight : i % 2 ? C.gray50 : C.white }}>
              <td style={{ ...S.td, fontWeight: 700 }}>{s.state}{s.flag && <span style={{ color: C.red, fontSize: 11 }}> · high RTO</span>}</td>
              <td style={{ ...S.td, textAlign: "right" }}>{num(s.orders)}</td>
              <td style={{ ...S.td, textAlign: "right" }}>{num(s.delivered)}</td>
              <td style={{ ...S.td, textAlign: "right" }}>{num(s.rto)}</td>
              <td style={{ ...S.td, textAlign: "right", fontWeight: 700, color: s.flag ? C.red : C.gray700 }}>{pct(s.rto_rate)}</td>
              <td style={{ ...S.td, textAlign: "right" }}>{pct(s.return_rate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function InsightsTab() {
  const { range, label: periodLabel } = useDateFilter();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("all");
  const [showAll, setShowAll] = useState(false);
  const [table, setTable] = useState("top_performers");
  // Bumped after a claims upload so the page (and the AI panel) re-read.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (range.date_from) params.set("date_from", range.date_from);
    if (range.date_to) params.set("date_to", range.date_to);
    fetch(`${API}/insights/?${params}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.detail || d.error || `Could not load insights (${r.status}).`);
        return d;
      })
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e.message || "Network error — could not load insights."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range.date_from, range.date_to, reloadKey]);

  const highlights = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter) || FILTERS[0];
    return (data?.highlights || []).filter(f.match);
  }, [data, filter]);
  const counts = useMemo(() => Object.fromEntries(
    FILTERS.map((f) => [f.key, (data?.highlights || []).filter(f.match).length])), [data]);

  const period = data?.period;
  const anomalies = (data?.daily || []).filter((d) => d.anomaly);
  const tabs = [...TABLES.map((t) => ({ key: t.key, label: t.label, n: data?.[t.key]?.length || 0 })),
    { key: "states", label: "States", n: (data?.states || []).filter((s) => s.flag).length }];
  const activeTable = TABLES.find((t) => t.key === table);
  const visible = showAll ? highlights : highlights.slice(0, 8);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
      <div style={{ flex: "1 1 420px" }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: C.gray800, marginBottom: 4 }}>Business Insights</h2>
        <p style={{ fontSize: 12, color: C.gray400, maxWidth: 760, lineHeight: 1.5 }}>
          Your best and worst SKUs, unusual changes, and what to do about them — worked out from your own orders and
          Meesho payments, compared with the period just before. Small samples are not flagged, so what shows here is
          worth acting on. · {periodLabel}
        </p>
        {period && (
          <p style={{ fontSize: 11.5, color: C.gray500, marginTop: 6 }}>
            Looking at <b>{fmtDay(period.date_from)} – {fmtDay(period.date_to)}</b> vs <b>{fmtDay(period.prev_from)} – {fmtDay(period.prev_to)}</b>
            {period.clipped && <span style={{ color: C.amber }}> · orders uploaded up to {fmtDay(period.data_through)}, so the period stops there</span>}
            {period.capped && <span style={{ color: C.amber }}> · limited to the last 92 days</span>}
            {data?.excluded_no_unit_price?.orders > 0 && (
              <span style={{ color: C.amber }}> · {data.excluded_no_unit_price.orders} order(s) left out because their item has no unit price (₹0 or missing) — price them on SKU Pricing</span>
            )}
            {data?.settled_share && data.settled_share.current < 70 && (
              <span style={{ color: C.amber }}> · only {data.settled_share.current}% of these orders have settled yet — rates will move as payments arrive</span>
            )}
          </p>
        )}
      </div>
      <ClaimsUploadButton onUploaded={() => setReloadKey((k) => k + 1)} compact />
      </div>

      {error && (
        <div style={{ padding: "10px 16px", borderRadius: 10, background: C.redLight, border: `1px solid ${C.redBorder}`, color: C.red, fontSize: 13, fontWeight: 600 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: 60 }}>
          <CircularProgress style={{ color: C.orange }} />
          <p style={{ fontSize: 12, color: C.gray400 }}>Comparing this period with the last one…</p>
        </div>
      ) : !data || data.empty ? (
        !error && <div style={{ textAlign: "center", padding: 60, color: C.gray400, fontSize: 14 }}>{data?.message || "No data for this period."}</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
            {data.kpis.map((k) => <KpiCard key={k.key} k={k} />)}
          </div>

          <AIPanel range={range} ai={data.ai} period={data.period} />

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <p style={{ fontSize: 13, fontWeight: 800, color: C.gray800 }}>What needs your attention</p>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {FILTERS.map((f) => (
                  <button key={f.key} onClick={() => { setFilter(f.key); setShowAll(false); }}
                    style={{ fontSize: 12, fontWeight: 700, padding: "5px 12px", borderRadius: 999, cursor: "pointer",
                      border: `1px solid ${filter === f.key ? C.orange : C.gray200}`,
                      background: filter === f.key ? C.orangeLight : C.white, color: filter === f.key ? C.orange : C.gray600 }}>
                    {f.label} ({counts[f.key] || 0})
                  </button>
                ))}
              </div>
            </div>
            {visible.length === 0 ? (
              <p style={{ ...S.card, textAlign: "center", color: C.gray400, fontSize: 13 }}>Nothing in this group for this period.</p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 340px), 1fr))", gap: 12 }}>
                {visible.map((h, i) => <HighlightCard key={`${h.kind}-${h.sku || i}-${i}`} h={h} />)}
              </div>
            )}
            {highlights.length > 8 && (
              <button onClick={() => setShowAll((v) => !v)}
                style={{ alignSelf: "center", fontSize: 12.5, fontWeight: 700, color: C.orange, background: "none", border: "none", cursor: "pointer" }}>
                {showAll ? "Show fewer" : `Show all ${highlights.length}`}
              </button>
            )}
          </div>

          <ClaimsSection claims={data.claims} onUploaded={() => setReloadKey((k) => k + 1)} />
          <PaymentsSection payments={data.payments} />

          <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
            <div style={{ display: "flex", gap: 4, padding: "10px 10px 0", overflowX: "auto", borderBottom: `1px solid ${C.gray100}` }}>
              {tabs.map((t) => (
                <button key={t.key} onClick={() => setTable(t.key)}
                  style={{ fontSize: 12.5, fontWeight: 700, padding: "8px 12px", whiteSpace: "nowrap", cursor: "pointer",
                    border: "none", background: "none", borderBottom: `2px solid ${table === t.key ? C.orange : "transparent"}`,
                    color: table === t.key ? C.orange : C.gray500 }}>
                  {t.label} <span style={{ color: C.gray400, fontWeight: 600 }}>{t.n}</span>
                </button>
              ))}
            </div>
            <p style={{ fontSize: 12, color: C.gray400, padding: "10px 16px 6px" }}>
              {activeTable ? activeTable.hint : "Delivered / RTO / return by customer state. Highlighted states have credibly higher RTO than your average."}
            </p>
            {activeTable ? <DataTable table={activeTable} rows={data[activeTable.key]} /> : <StatesTable states={data.states} />}
          </div>

          <div style={S.card}>
            <p style={{ fontSize: 11, fontWeight: 700, color: C.gray500, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 4 }}>
              Orders per day vs normal
            </p>
            <p style={{ fontSize: 12, color: C.gray400, marginBottom: 14 }}>
              "Normal" is the typical day over the four weeks before. Days far outside it are listed below the chart.
            </p>
            <AppLineChart
              dataset={data.daily}
              indexKey="date"
              series={[
                { dataKey: "orders", label: "Orders", color: C.orange },
                { dataKey: "expected", label: "Normal", color: C.gray400 },
              ]}
              indexFormatter={fmtDay}
              maxTicks={15}
              height={240}
            />
            {anomalies.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                {anomalies.map((a) => (
                  <span key={a.date} style={{ fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 999,
                    background: a.anomaly === "low" ? C.redLight : C.greenLight, color: a.anomaly === "low" ? C.red : C.green }}>
                    {fmtDay(a.date)}: {a.orders} orders (normal ≈ {Math.round(a.expected)})
                  </span>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
