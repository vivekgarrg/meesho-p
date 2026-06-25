import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import CircularProgress from "@mui/material/CircularProgress";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import TextField from "@mui/material/TextField";
import Alert from "@mui/material/Alert";
import Divider from "@mui/material/Divider";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import { BarChart } from "@mui/x-charts/BarChart";
import { LineChart } from "@mui/x-charts/LineChart";
import { PieChart } from "@mui/x-charts/PieChart";
import { API, C, CHART_COLORS, fmt } from "../../App";

// ─────────────────────────────────────────────────────────────────────────────
// Design tokens
// ─────────────────────────────────────────────────────────────────────────────
const T = {
  card: {
    background: "#fff",
    border: "1px solid #E2E8F0",
    borderRadius: 16,
    padding: "20px 22px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
  },
  mono: { fontFamily: "monospace" },
  label: { fontSize: 11, fontWeight: 700, color: "#94A3B8", letterSpacing: "0.07em", textTransform: "uppercase" },
};

// ─────────────────────────────────────────────────────────────────────────────
// Utility helpers
// ─────────────────────────────────────────────────────────────────────────────
function fmtMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-IN", { month: "long", year: "numeric" });
}
function fmtShort(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-IN", { month: "short", year: "2-digit" });
}
function monthToRange(ym) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { date_from: `${ym}-01`, date_to: `${ym}-${String(last).padStart(2, "0")}` };
}
const pct2 = (n, d) => d > 0 ? (n / d * 100).toFixed(1) : "0.0";

// ─────────────────────────────────────────────────────────────────────────────
// Reusable primitive components
// ─────────────────────────────────────────────────────────────────────────────

/** Wrapper card with optional title and accent bar */
function SectionCard({ title, children, accent, style }) {
  return (
    <div style={{ ...T.card, ...style }}>
      {accent && <div style={{ height: 3, background: accent, borderRadius: "12px 12px 0 0", margin: "-20px -22px 16px" }} />}
      {title && (
        <p style={{ ...T.label, marginBottom: 14 }}>{title}</p>
      )}
      {children}
    </div>
  );
}

/** Single key metric — large number + label + optional sub text */
function KPICard({ label, value, sub, color, icon, accent, style }) {
  return (
    <div style={{
      ...T.card,
      borderTop: `3px solid ${accent || color || C.blue}`,
      flex: "1 1 180px",
      position: "relative",
      overflow: "hidden",
      ...style,
    }}>
      <div style={{ position: "absolute", right: -12, top: -12, width: 60, height: 60, borderRadius: "50%", background: accent || color || C.blue, opacity: 0.06 }} />
      {icon && <div style={{ fontSize: 18, marginBottom: 6 }}>{icon}</div>}
      <p style={{ ...T.label, marginBottom: 6 }}>{label}</p>
      <p style={{ fontSize: 22, fontWeight: 800, ...T.mono, color: color || C.gray800, lineHeight: 1.1 }}>{value}</p>
      {sub && <p style={{ fontSize: 11, color: C.gray400, marginTop: 5 }}>{sub}</p>}
    </div>
  );
}

/** Row: label on left, value on right — for lists inside cards */
function StatRow({ label, value, color, bold, sub, borderless, badge }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "7px 0",
      borderBottom: borderless ? "none" : "1px solid #F1F5F9",
    }}>
      <span style={{ fontSize: 12, color: C.gray500 }}>{label}</span>
      <div style={{ textAlign: "right", display: "flex", alignItems: "center", gap: 8 }}>
        {badge && (
          <span style={{ fontSize: 10, fontWeight: 700, background: C.gray100, color: C.gray500, padding: "1px 7px", borderRadius: 20 }}>{badge}</span>
        )}
        <div>
          <span style={{ fontFamily: "monospace", fontWeight: bold ? 800 : 700, fontSize: 13, color: color || C.gray800 }}>{value}</span>
          {sub && <span style={{ fontSize: 10, color: C.gray400, display: "block" }}>{sub}</span>}
        </div>
      </div>
    </div>
  );
}

/** Progress bar for rates */
function RateBar({ label, pct, count, color }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
        <span style={{ fontSize: 12, color: C.gray600, fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 13, fontFamily: "monospace", fontWeight: 800, color }}>
          {pct}% <span style={{ fontSize: 10, fontWeight: 400, color: C.gray400 }}>({count})</span>
        </span>
      </div>
      <div style={{ height: 7, borderRadius: 99, background: "#F1F5F9", overflow: "hidden" }}>
        <div style={{ width: `${Math.min(pct, 100)}%`, height: "100%", background: color, borderRadius: 99, transition: "width 0.5s ease" }} />
      </div>
    </div>
  );
}

/** A step in the profit formula */
function FormulaStep({ sign, label, value, color, note, bold, divider }) {
  return (
    <>
      {divider && <div style={{ height: 1, background: "#E2E8F0", margin: "10px 0" }} />}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "6px 0" }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: color || C.gray500, width: 16, flexShrink: 0, fontFamily: "monospace", marginTop: 1 }}>{sign}</span>
        <div style={{ flex: 1 }}>
          <span style={{ fontSize: 12, color: C.gray600, fontWeight: bold ? 700 : 400 }}>{label}</span>
          {note && <span style={{ display: "block", fontSize: 10, color: C.gray400, marginTop: 1 }}>{note}</span>}
        </div>
        <span style={{ fontFamily: "monospace", fontWeight: bold ? 800 : 700, fontSize: bold ? 15 : 13, color: color || C.gray800 }}>{fmt(value)}</span>
      </div>
    </>
  );
}

/** Status outcome card — shows count + net for one order type */
function OutcomeCard({ icon, label, count, rate, rateColor, netLabel, net, netColor, subStats }) {
  return (
    <div style={{
      ...T.card, flex: "1 1 180px", padding: "16px 18px",
      borderLeft: `4px solid ${rateColor}`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div>
          <p style={{ fontSize: 11, fontWeight: 700, color: C.gray400, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
            {icon} {label}
          </p>
          <p style={{ fontSize: 26, fontWeight: 800, fontFamily: "monospace", color: rateColor, lineHeight: 1 }}>
            {count.toLocaleString()}
          </p>
          <p style={{ fontSize: 11, color: C.gray400, marginTop: 3 }}>orders · {rate}%</p>
        </div>
        <div style={{ textAlign: "right" }}>
          <p style={{ fontSize: 10, color: C.gray400, marginBottom: 2 }}>{netLabel}</p>
          <p style={{ fontSize: 16, fontWeight: 800, fontFamily: "monospace", color: netColor }}>{fmt(net)}</p>
        </div>
      </div>
      {subStats && subStats.map(({ label: sl, value: sv, color: sc }) => (
        <div key={sl} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderTop: "1px solid #F8FAFC" }}>
          <span style={{ fontSize: 11, color: C.gray400 }}>{sl}</span>
          <span style={{ fontSize: 11, fontFamily: "monospace", fontWeight: 600, color: sc || C.gray600 }}>{sv}</span>
        </div>
      ))}
    </div>
  );
}

/** Filter bar with month selector + custom date range */
function FilterBar({ mode, setMode, selectedMonth, setSelectedMonth, months, customFrom, setCustomFrom, customTo, setCustomTo, onApply }) {
  return (
    <div style={{ ...T.card, padding: "12px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.gray400, letterSpacing: "0.07em", textTransform: "uppercase" }}>Period</span>
        <Button size="small" variant={mode === "all" ? "contained" : "outlined"} disableElevation
          onClick={() => { setMode("all"); onApply({}); }}
          sx={{ borderRadius: 20, textTransform: "none", fontSize: 12, minWidth: 80 }}>
          All Time
        </Button>
        <Select size="small" displayEmpty value={mode === "month" ? (selectedMonth || "") : ""}
          onChange={e => { const m = e.target.value; if (!m) return; setMode("month"); setSelectedMonth(m); onApply(monthToRange(m)); }}
          sx={{ minWidth: 160, fontSize: 12, borderRadius: 20, "& .MuiOutlinedInput-notchedOutline": { borderRadius: 20 } }}>
          <MenuItem value=""><em>Select month…</em></MenuItem>
          {months.map(m => <MenuItem key={m} value={m} sx={{ fontSize: 12 }}>{fmtMonth(m)}</MenuItem>)}
        </Select>
        {mode === "month" && selectedMonth && (
          <Chip label={fmtMonth(selectedMonth)} color="primary" size="small" sx={{ borderRadius: 20 }} />
        )}
        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
        <span style={{ fontSize: 11, color: C.gray400 }}>Custom range:</span>
        <TextField size="small" type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
          sx={{ width: 148, "& input": { fontSize: 12 } }} />
        <span style={{ fontSize: 11, color: C.gray400 }}>→</span>
        <TextField size="small" type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
          sx={{ width: 148, "& input": { fontSize: 12 } }} />
        <Button size="small" variant={mode === "custom" ? "contained" : "outlined"} disableElevation
          disabled={!customFrom || !customTo}
          onClick={() => { if (customFrom && customTo) { setMode("custom"); onApply({ date_from: customFrom, date_to: customTo }); } }}
          sx={{ borderRadius: 20, textTransform: "none", fontSize: 12 }}>
          Apply
        </Button>
        {mode === "custom" && customFrom && (
          <Chip label={`${customFrom} → ${customTo}`} color="primary" size="small"
            onDelete={() => { setMode("all"); onApply({}); }} sx={{ borderRadius: 20 }} />
        )}
      </div>
    </div>
  );
}

/** Settlement by status compact table */
function SettlementTable({ rows, total }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
      <thead>
        <tr style={{ background: "#F8FAFC" }}>
          {["Status", "Orders", "Gross Settlement", "Item Cost", "Net P&L"].map((h, i) => (
            <th key={h} style={{
              padding: "7px 12px", textAlign: i <= 1 ? "left" : "right",
              fontSize: 10, fontWeight: 700, color: C.gray500, textTransform: "uppercase",
              letterSpacing: "0.05em", borderBottom: "2px solid #E2E8F0",
            }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(({ icon, label, count, gross, cost, net, netColor }, i) => (
          <tr key={label} style={{ borderBottom: i < rows.length - 1 ? "1px solid #F1F5F9" : "2px solid #E2E8F0" }}>
            <td style={{ padding: "8px 12px" }}>
              <span style={{ marginRight: 6 }}>{icon}</span>
              <span style={{ fontWeight: 600, color: C.gray700 }}>{label}</span>
            </td>
            <td style={{ padding: "8px 12px", fontFamily: "monospace", color: C.gray500 }}>{count.toLocaleString()}</td>
            <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: "monospace", color: C.gray700 }}>{fmt(gross)}</td>
            <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: "monospace", color: cost < 0 ? C.red : C.gray300 }}>{cost !== 0 ? fmt(cost) : "—"}</td>
            <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: "monospace", fontWeight: 800, color: netColor }}>{fmt(net)}</td>
          </tr>
        ))}
        <tr style={{ background: "#F8FAFC" }}>
          <td style={{ padding: "9px 12px", fontWeight: 800, color: C.gray800, fontSize: 13 }}>Total</td>
          <td style={{ padding: "9px 12px", fontFamily: "monospace", fontWeight: 700, color: C.gray600 }}>{total.count.toLocaleString()}</td>
          <td style={{ padding: "9px 12px", textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: C.gray700 }}>{fmt(total.gross)}</td>
          <td style={{ padding: "9px 12px", textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: C.red }}>{fmt(total.cost)}</td>
          <td style={{ padding: "9px 12px", textAlign: "right", fontFamily: "monospace", fontWeight: 800, color: total.net >= 0 ? C.green : C.red }}>{fmt(total.net)}</td>
        </tr>
      </tbody>
    </table>
  );
}

/** Group of payment deduction metrics */
function DeductionRow({ label, value, pct, color }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #F1F5F9" }}>
      <span style={{ fontSize: 12, color: C.gray600 }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13, color }}>{fmt(value)}</span>
        {pct !== undefined && (
          <span style={{ background: "#F1F5F9", color: C.gray600, fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20, minWidth: 46, textAlign: "center" }}>{pct}%</span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main tab
// ─────────────────────────────────────────────────────────────────────────────
export function OverviewTab() {
  const navigate = useNavigate();
  const [profit, setProfit] = useState(null);
  const [dash, setDash] = useState(null);
  const [loading, setLoading] = useState(true);
  const [months, setMonths] = useState([]);
  const [mode, setMode] = useState("all");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [activeRange, setActiveRange] = useState(null);

  useEffect(() => {
    fetch(`${API}/profit/available-months/`).then(r => r.json()).then(ms => {
      setMonths(ms);
      if (ms.length > 0) { setMode("month"); setSelectedMonth(ms[0]); setActiveRange(monthToRange(ms[0])); }
      else setActiveRange({});
    }).catch(() => setActiveRange({}));
  }, []);

  useEffect(() => {
    if (activeRange === null) return;
    setLoading(true);
    const qs = Object.keys(activeRange).length ? `?${new URLSearchParams(activeRange)}` : "";
    Promise.all([
      fetch(`${API}/profit/${qs}`).then(r => r.json()),
      fetch(`${API}/dashboard/${qs}`).then(r => r.json()),
    ]).then(([p, d]) => { setProfit(p); setDash(d); setLoading(false); }).catch(() => setLoading(false));
  }, [activeRange]);

  // ── Derived values ────────────────────────────────────────────────────────
  const netProfit   = Number(profit?.net_revenue ?? 0);
  const pos         = netProfit >= 0;
  const { order_stats, payment_stats, join_stats, unsettled } = dash || {};

  const matchRate   = join_stats?.match_rate ?? 0;
  const netSettle   = payment_stats?.total_settlement ?? 0;
  const totalSale   = payment_stats?.total_sale ?? 0;
  const settleEff   = totalSale > 0 ? ((netSettle / totalSale) * 100).toFixed(1) : "—";

  const filterLabel = mode === "month" ? fmtMonth(selectedMonth)
    : mode === "custom" ? `${customFrom} → ${customTo}` : "All Time";

  const nDel   = profit?.total_delivered_count ?? 0;
  const nRet   = profit?.total_return_count    ?? 0;
  const nRTO   = profit?.total_rto_count       ?? 0;
  const nOther = profit?.total_other_count     ?? 0;
  const nTotal = profit?.settled_order_count   ?? (nDel + nRet + nRTO);
  const delRate = pct2(nDel, nTotal);
  const retRate = pct2(nRet, nTotal);
  const rtoRate = pct2(nRTO, nTotal);

  const shipped      = profit?.shipped_summary ?? {};
  const taxSummary   = profit?.tax_summary ?? {};
  const grossRev     = profit?.gross_revenue ?? 0;
  const tcsAmt       = profit?.total_tcs ?? 0;
  const tdsAmt       = profit?.total_tds ?? 0;
  const commAmt      = profit?.total_commission_paid ?? 0;
  const tcsPct       = pct2(tcsAmt, grossRev);
  const tdsPct       = pct2(tdsAmt, grossRev);
  const commPct      = pct2(commAmt, grossRev);
  const totalDeductPct = taxSummary.total_deduction_rate_pct?.toFixed(2) ?? "0.00";

  const matchPieData = [
    { id: 0, value: join_stats?.matched_count   ?? 0, label: "Matched",   color: C.green },
    { id: 1, value: join_stats?.unmatched_count ?? 0, label: "Unmatched", color: C.amber },
  ].filter(d => d.value > 0);

  const deductionPieData = [
    { label: "Commission",  value: Math.abs(Number(commAmt)) },
    { label: "Ads Cost",    value: Math.abs(Number(profit?.total_ads_cost)) },
    { label: "TCS",         value: Math.abs(Number(tcsAmt)) },
    { label: "TDS",         value: Math.abs(Number(tdsAmt)) },
    { label: "Shipping",    value: Math.abs(Number(profit?.total_shipping_cost)) },
  ].filter(d => d.value > 0.01).map((d, i) => ({ ...d, id: i, color: CHART_COLORS[i % CHART_COLORS.length] }));

  const timelineData = (() => {
    if (!dash) return [];
    const map = {};
    (dash.payment_stats?.daily || []).forEach(({ payment_date, count }) => {
      const d = String(payment_date);
      if (!map[d]) map[d] = { date: d, settlements: 0, orders: 0 };
      map[d].settlements = count;
    });
    (dash.order_stats?.daily || []).forEach(({ order_date, count }) => {
      const d = String(order_date);
      if (!map[d]) map[d] = { date: d, settlements: 0, orders: 0 };
      map[d].orders = count;
    });
    return Object.values(map).sort((a, b) => a.date > b.date ? 1 : -1);
  })();

  // Derived amounts for settlement table
  const delGross   = Number(profit?.total_profit || 0) + Number(profit?.total_purchase_cost || 0);
  const delCost    = -Number(profit?.total_purchase_cost || 0);
  const retNet     = Number(profit?.total_loss || 0);
  const rtoNet     = Number(profit?.total_rto_loss || 0);
  const otherNet   = Number(profit?.total_other || 0);
  const totalGross = delGross + retNet + rtoNet + otherNet;

  const settlementRows = [
    { icon: "✅", label: "Delivered", count: nDel, gross: delGross,  cost: delCost, net: Number(profit?.total_profit || 0), netColor: C.green },
    { icon: "↩",  label: "Return",    count: nRet, gross: retNet,    cost: 0,       net: retNet, netColor: retNet >= 0 ? C.gray600 : C.red },
    { icon: "🔄", label: "RTO",       count: nRTO, gross: rtoNet,    cost: 0,       net: rtoNet, netColor: rtoNet >= 0 ? C.gray600 : C.amber },
    { icon: "⊘",  label: "Other",     count: nOther, gross: otherNet, cost: 0,      net: otherNet, netColor: otherNet >= 0 ? C.gray600 : C.red },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── 1. Filter bar ──────────────────────────────────────────────── */}
      <FilterBar mode={mode} setMode={setMode} selectedMonth={selectedMonth}
        setSelectedMonth={setSelectedMonth} months={months}
        customFrom={customFrom} setCustomFrom={setCustomFrom}
        customTo={customTo} setCustomTo={setCustomTo}
        onApply={range => setActiveRange(range)} />

      {loading && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "80px 0", gap: 14 }}>
          <CircularProgress color="primary" />
          <span style={{ fontSize: 13, color: C.gray400 }}>Loading overview…</span>
        </div>
      )}

      {!loading && profit && <>

        {/* ── 2. Hero banner ─────────────────────────────────────────────── */}
        <div style={{
          ...T.card,
          background: `linear-gradient(135deg, ${pos ? "#ECFDF5" : "#FFF1F2"} 0%, #fff 65%)`,
          border: `1.5px solid ${pos ? C.greenBorder : C.redBorder}`,
          display: "flex", justifyContent: "space-between", alignItems: "flex-start",
          flexWrap: "wrap", gap: 24, padding: "24px 28px",
        }}>
          {/* Left: main P&L */}
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: C.gray400, letterSpacing: "0.12em", marginBottom: 8, textTransform: "uppercase" }}>
              Net P&L — {filterLabel}
            </p>
            <p style={{ fontSize: 48, fontWeight: 900, fontFamily: "monospace", color: pos ? C.green : C.red, lineHeight: 1, letterSpacing: "-0.03em" }}>
              {pos ? "+" : ""}{fmt(netProfit)}
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <span style={{
                background: pos ? C.greenLight : C.redLight, color: pos ? C.green : C.red,
                border: `1px solid ${pos ? C.greenBorder : C.redBorder}`,
                fontSize: 11, fontWeight: 700, padding: "3px 12px", borderRadius: 20,
              }}>{pos ? "✅ Profitable" : "❌ In Loss"}</span>
              <span style={{ background: "#F8FAFC", color: C.gray600, border: "1px solid #E2E8F0", fontSize: 11, fontWeight: 600, padding: "3px 12px", borderRadius: 20 }}>
                {(profit.order_count ?? 0).toLocaleString()} settled orders
              </span>
              <span style={{ background: "#FFF7ED", color: C.amber, border: "1px solid #FDE68A", fontSize: 11, fontWeight: 600, padding: "3px 12px", borderRadius: 20 }}>
                {profit.ads_campaigns ?? 0} ad campaigns
              </span>
            </div>
          </div>
          {/* Right: key secondary metrics */}
          <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
            {[
              { label: "Gross Revenue",      value: fmt(profit.gross_revenue),          color: C.gray800 },
              { label: "Net Settlement",     value: fmt(profit.net_settlement_revenue),  color: C.green },
              { label: "Order Net P&L",      value: fmt(profit.order_net_pl),            color: Number(profit.order_net_pl) >= 0 ? C.green : C.red },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ textAlign: "right" }}>
                <p style={{ fontSize: 10, fontWeight: 700, color: C.gray400, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 5 }}>{label}</p>
                <p style={{ fontSize: 22, fontWeight: 800, fontFamily: "monospace", color }}>{value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── 3. Shipped in-transit warning ──────────────────────────────── */}
        {shipped.count > 0 && (
          <div style={{
            display: "flex", alignItems: "flex-start", gap: 14,
            background: "#FFFBEB", border: "1.5px dashed #F59E0B",
            borderRadius: 12, padding: "14px 20px",
          }}>
            <span style={{ fontSize: 24, flexShrink: 0 }}>🚚</span>
            <div>
              <p style={{ fontSize: 13, fontWeight: 700, color: C.amber, marginBottom: 4 }}>
                {shipped.count} orders SHIPPED — excluded from P&L until settled
              </p>
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: C.gray500 }}>Expected settlement: <strong style={{ fontFamily: "monospace" }}>{fmt(shipped.settlement_paid)}</strong></span>
                <span style={{ fontSize: 12, color: C.gray500 }}>If delivered: <strong style={{ fontFamily: "monospace", color: Number(shipped.expected_profit) >= 0 ? C.green : C.red }}>{fmt(shipped.expected_profit)}</strong></span>
                <span style={{ fontSize: 12, color: C.gray500 }}>Expected sale: <strong style={{ fontFamily: "monospace" }}>{fmt(shipped.expected_sale)}</strong></span>
              </div>
            </div>
          </div>
        )}

        {/* ── 4. Order outcome cards ──────────────────────────────────────── */}
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <OutcomeCard
            icon="✅" label="Delivered" count={nDel} rate={delRate} rateColor={C.green}
            netLabel="Net Profit" net={Number(profit.total_profit || 0)} netColor={C.green}
            subStats={[
              { label: "Gross settlement", value: fmt(delGross) },
              { label: "Item cost (all-in)", value: fmt(delCost), color: C.red },
              { label: "  └ incl. pkg", value: fmt(profit.total_packaging_cost ?? 0), color: C.gray400 },
              { label: "  └ incl. GST", value: fmt(profit.total_tax_cost ?? 0), color: C.gray400 },
            ]}
          />
          <OutcomeCard
            icon="↩" label="Returns" count={nRet} rate={retRate} rateColor={C.red}
            netLabel="Net Settlement" net={retNet} netColor={retNet >= 0 ? C.gray600 : C.red}
            subStats={[{ label: "incl. claim credits", value: "see claims tab" }]}
          />
          <OutcomeCard
            icon="🔄" label="RTO" count={nRTO} rate={rtoRate} rateColor={C.amber}
            netLabel="Net Settlement" net={rtoNet} netColor={rtoNet >= 0 ? C.gray600 : C.amber}
            subStats={[{ label: "item came back", value: "no item cost" }]}
          />
          <OutcomeCard
            icon="⊘" label="Other" count={nOther} rate={pct2(nOther, nTotal)} rateColor={C.gray400}
            netLabel="Net" net={otherNet} netColor={otherNet >= 0 ? C.gray600 : C.red}
            subStats={[{ label: "cancelled / adj / exchange", value: "" }]}
          />
        </div>

        {/* ── 5. Two-column: Profit Formula + P&L Summary ──────────────────── */}
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>

          {/* Profit formula */}
          <SectionCard title="Profit Formula" style={{ flex: "1 1 340px" }}>
            <p style={{ fontSize: 11, color: C.gray400, marginBottom: 14, lineHeight: 1.7 }}>
              Commission / TCS / TDS / Shipping are already deducted by Meesho inside the settlement — not subtracted again here.
            </p>
            <FormulaStep sign="+" label={`Delivered Profit — ${nDel} orders`} value={profit.total_profit} color={C.green}
              note="settlement − item_price × qty" />
            <FormulaStep sign="±" label={`Return Net — ${nRet} orders`} value={profit.total_loss}
              color={Number(profit.total_loss) >= 0 ? C.gray600 : C.red}
              note="return settlement incl. claims; item came back" />
            <FormulaStep sign="±" label={`RTO Net — ${nRTO} orders`} value={profit.total_rto_loss}
              color={Number(profit.total_rto_loss) >= 0 ? C.gray600 : C.amber}
              note="RTO settlement incl. claims; item came back" />
            {Number(profit.total_other || 0) !== 0 && (
              <FormulaStep sign="±" label={`Other — ${nOther} orders`} value={profit.total_other}
                color={Number(profit.total_other) >= 0 ? C.gray600 : C.red}
                note="cancelled, exchange, adj-only rows" />
            )}
            <FormulaStep sign="=" label="Order Net P&L" value={profit.order_net_pl}
              color={Number(profit.order_net_pl) >= 0 ? C.green : C.red} bold divider />
            <FormulaStep sign="−" label="Ads Spend" value={profit.total_ads_cost} color={C.orange}
              note="ad campaigns — always a cost" />
            <FormulaStep sign="±" label="Compensation / Recovery" value={profit.total_compensation_recovery}
              color={Number(profit.total_compensation_recovery) >= 0 ? C.blue : C.red} />
            <FormulaStep sign="+" label="Referral Income" value={profit.total_referral_income} color={C.green} />
            <FormulaStep sign="=" label="NET P&L (Final)" value={netProfit}
              color={pos ? C.green : C.red} bold divider />
            {/* Reconciliation — confirms frontend math equals backend net_revenue */}
            {(() => {
              const computed = Number(profit.order_net_pl)
                + Number(profit.total_ads_cost ?? 0)
                + Number(profit.total_compensation_recovery ?? 0)
                + Number(profit.total_referral_income ?? 0);
              const diff = Math.abs(netProfit - computed);
              const match = diff < 0.05;
              return (
                <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8,
                  background: match ? "#ECFDF5" : "#FFF7ED",
                  border: `1px solid ${match ? C.greenBorder : C.amberBorder}` }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: match ? C.green : C.amber }}>
                    {match ? "✅ P&L reconciled — all components match" : `⚠️ Off by ₹${diff.toFixed(2)} — check data`}
                  </span>
                </div>
              );
            })()}
            {/* Informational breakdown — packaging & tax are already inside item_price */}
            <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 8, background: "#F8FAFC", border: "1px dashed #E2E8F0" }}>
              <p style={{ fontSize: 9, fontWeight: 700, color: C.gray300, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>
                Cost Breakdown (already inside item_price — info only)
              </p>
              <div style={{ display: "flex", gap: 16 }}>
                <div>
                  <p style={{ fontSize: 10, color: C.gray400, marginBottom: 2 }}>📦 Packaging</p>
                  <p style={{ fontSize: 13, fontFamily: "monospace", fontWeight: 700, color: C.gray600 }}>{fmt(profit.total_packaging_cost ?? 0)}</p>
                </div>
                <div>
                  <p style={{ fontSize: 10, color: C.gray400, marginBottom: 2 }}>🏷️ GST on Items</p>
                  <p style={{ fontSize: 13, fontFamily: "monospace", fontWeight: 700, color: C.gray600 }}>{fmt(profit.total_tax_cost ?? 0)}</p>
                </div>
                <div>
                  <p style={{ fontSize: 10, color: C.gray400, marginBottom: 2 }}>📦+🏷️ Combined</p>
                  <p style={{ fontSize: 13, fontFamily: "monospace", fontWeight: 700, color: C.gray600 }}>{fmt((profit.total_packaging_cost ?? 0) + (profit.total_tax_cost ?? 0))}</p>
                </div>
              </div>
            </div>
          </SectionCard>

          {/* P&L columns */}
          <div style={{ flex: "1 1 380px", display: "flex", flexDirection: "column", gap: 14 }}>

            {/* Order P&L Breakdown */}
            <SectionCard title="Order P&L Breakdown">
              <StatRow label={`✅ Delivered Profit (${nDel})`} value={fmt(profit.total_profit)} color={C.green} sub="settlement − item_price×qty (all-in cost)" />
              <StatRow label={`↩ Return Net (${nRet}) · ${retRate}%`} value={fmt(profit.total_loss)} color={retNet >= 0 ? C.gray600 : C.red} sub="return settlement incl. claims" />
              <StatRow label={`🔄 RTO Net (${nRTO}) · ${rtoRate}%`} value={fmt(profit.total_rto_loss)} color={rtoNet >= 0 ? C.gray600 : C.amber} sub="RTO settlement incl. claims" />
              <StatRow label={`⊘ Other · ${nOther} orders`} value={fmt(profit.total_other || 0)} color={otherNet >= 0 ? C.gray600 : C.red} sub="cancelled, exchange, adj-only" />
              <StatRow label="= Order Net P&L" value={fmt(profit.order_net_pl)} color={Number(profit.order_net_pl) >= 0 ? C.green : C.red} bold borderless />
            </SectionCard>

            {/* Full P&L bridge to Net */}
            <SectionCard title="Full P&L Bridge → Net Profit">
              <StatRow label="Order Net P&L" value={fmt(profit.order_net_pl)} color={Number(profit.order_net_pl) >= 0 ? C.green : C.red} sub="item_price (all-in) already deducted" />
              <StatRow label="Ads Spend" value={fmt(profit.total_ads_cost)} color={C.orange} sub="ad campaigns cost" />
              <StatRow label="Compensation / Recovery" value={fmt(profit.total_compensation_recovery)} color={Number(profit.total_compensation_recovery) >= 0 ? C.blue : C.red} />
              <StatRow label="Referral Income" value={fmt(profit.total_referral_income)} color={C.green} />
              <StatRow label="= NET P&L (Final)" value={`${pos ? "+" : ""}${fmt(netProfit)}`} color={pos ? C.green : C.red} bold borderless />
            </SectionCard>
          </div>
        </div>

        {/* ── 6. Settlement by status table ──────────────────────────────── */}
        <SectionCard title="Settlement by Order Status">
          <SettlementTable
            rows={settlementRows}
            total={{ count: nDel + nRet + nRTO + nOther, gross: totalGross, cost: delCost, net: Number(profit.order_net_pl) }}
          />
        </SectionCard>

        {/* ── 7. Meesho Deductions ───────────────────────────────────────── */}
        <SectionCard title="Meesho Deductions (already reflected in net settlement)">
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 280px" }}>
              <DeductionRow label="Commission incl. GST"        value={commAmt}                     pct={commPct} color={C.orange} />
              <DeductionRow label="TCS — Tax Collected at Source" value={tcsAmt}                    pct={tcsPct}  color={C.gray500} />
              <DeductionRow label="TDS — Tax Deducted at Source"  value={tdsAmt}                    pct={tdsPct}  color={C.gray500} />
              <DeductionRow label="Shipping Charges"             value={profit.total_shipping_cost}               color={C.amber} />
              <DeductionRow label="Ads Cost"                     value={profit.total_ads_cost}                    color={C.red} />
              <DeductionRow label="Affiliate Fee"                value={profit.total_affiliate_fee}               color={C.red} />
              <div style={{ borderTop: "2px solid #E2E8F0", paddingTop: 10, marginTop: 4 }}>
                <DeductionRow label="Total (Comm + TCS + TDS)" value={Number(commAmt) + Number(tcsAmt) + Number(tdsAmt)} pct={totalDeductPct} color={C.red} />
              </div>
            </div>
            <div style={{ flex: "1 1 200px", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ background: "#F8FAFC", borderRadius: 12, padding: "14px 16px" }}>
                <p style={{ fontSize: 10, fontWeight: 700, color: C.gray400, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Revenue Flow</p>
                <p style={{ fontSize: 12, color: C.gray500, lineHeight: 1.7 }}>
                  Gross Revenue <strong style={{ fontFamily: "monospace", color: C.gray800 }}>{fmt(grossRev)}</strong>
                  <br />→ deduct commission, TCS, TDS, shipping
                  <br />→ Net Settlement <strong style={{ fontFamily: "monospace", color: C.green }}>{fmt(profit.net_settlement_revenue)}</strong>
                </p>
              </div>
              <div style={{ background: "#FFFBEB", borderRadius: 12, padding: "14px 16px" }}>
                <p style={{ fontSize: 10, fontWeight: 700, color: C.amber, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Claims Received</p>
                <p style={{ fontSize: 18, fontWeight: 800, fontFamily: "monospace", color: C.amber }}>{fmt(profit.total_claims ?? 0)}</p>
                <p style={{ fontSize: 11, color: C.gray400, marginTop: 3 }}>{(profit.total_claimed_orders ?? 0).toLocaleString()} claimed orders</p>
              </div>
            </div>
          </div>
        </SectionCard>

        {/* ── 8. Rates + Order health ─────────────────────────────────────── */}
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>

          {/* Order outcome rates */}
          <SectionCard title="Order Outcome Rates" style={{ flex: "1 1 260px" }}>
            <RateBar label="✅ Delivery Rate" pct={delRate} count={nDel} color={C.green} />
            <RateBar label="↩ Return Rate"   pct={retRate} count={nRet} color={C.red} />
            <RateBar label="🔄 RTO Rate"      pct={rtoRate} count={nRTO} color={C.amber} />
            <p style={{ fontSize: 11, color: C.gray400, marginTop: 6, lineHeight: 1.6 }}>
              Based on {nTotal.toLocaleString()} settled orders. Returns/RTO bring the item back.
            </p>
          </SectionCard>

          {/* Operations KPIs */}
          <SectionCard title="Operations" style={{ flex: "1 1 340px" }}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {[
                { label: "Orders Settled",  value: (profit.order_count ?? 0).toLocaleString(),          sub: `${profit.orders_with_price ?? 0} with price`, accent: C.blue },
                { label: "Missing Price",   value: (profit.orders_missing_price ?? 0).toLocaleString(), sub: "SKUs without pricing",    accent: C.amber },
                { label: "Pure Returns",    value: (profit.total_pure_returns ?? 0).toLocaleString(),   sub: "return-only orders",     accent: C.red },
                { label: "Claimed Orders",  value: (profit.total_claimed_orders ?? 0).toLocaleString(), sub: fmt(profit.total_claims ?? 0), accent: C.orange },
                { label: "Ad Campaigns",    value: (profit.ads_campaigns ?? 0).toLocaleString(),        sub: `${profit.adjustment_count ?? 0} adj. rows`, accent: C.orange },
                { label: "Referral Count",  value: (profit.referral_count ?? 0).toLocaleString(),       sub: fmt(profit.total_referral_income ?? 0), accent: C.green },
              ].map(({ label, value, sub, accent }) => (
                <div key={label} style={{ flex: "1 1 130px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 10, padding: "12px 14px", borderLeft: `3px solid ${accent}` }}>
                  <p style={{ fontSize: 10, fontWeight: 700, color: C.gray400, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{label}</p>
                  <p style={{ fontSize: 18, fontWeight: 800, fontFamily: "monospace", color: accent }}>{value}</p>
                  {sub && <p style={{ fontSize: 11, color: C.gray400, marginTop: 3 }}>{sub}</p>}
                </div>
              ))}
            </div>
          </SectionCard>
        </div>

        {/* ── 9. Payment deductions + Match rate ─────────────────────────── */}
        {dash && (
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>

            {/* Match donut */}
            <SectionCard title="Payment–Order Match Rate" style={{ flex: "0 0 240px" }}>
              {matchPieData.length > 0 && (
                <PieChart series={[{ data: matchPieData, innerRadius: 48, outerRadius: 74, paddingAngle: 3 }]}
                  height={160} slotProps={{ legend: { direction: "row", position: { vertical: "bottom", horizontal: "middle" }, labelStyle: { fontSize: 11 } } }} />
              )}
              <div style={{ textAlign: "center", marginTop: 8 }}>
                <p style={{ fontSize: 28, fontWeight: 900, fontFamily: "monospace", color: matchRate >= 80 ? C.green : C.amber }}>{matchRate}%</p>
                <p style={{ fontSize: 11, color: C.gray400 }}>{join_stats?.matched_count ?? 0} linked payments</p>
              </div>
            </SectionCard>

            {/* Payment deduction breakdown */}
            <SectionCard title="Payment Deductions Breakdown" style={{ flex: "1 1 300px" }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {[
                  { label: "Total Sale Amount",    value: payment_stats?.total_sale,       color: C.green },
                  { label: "Net Settlement",        value: payment_stats?.total_settlement, color: netSettle >= 0 ? C.green : C.red },
                  { label: "Commission (incl. GST)", value: payment_stats?.total_commission, color: C.orange },
                  { label: "TCS Deducted",           value: payment_stats?.total_tcs,       color: C.gray500 },
                  { label: "TDS Deducted",           value: payment_stats?.total_tds,       color: C.gray500 },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ flex: "1 1 140px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 10, padding: "12px 14px" }}>
                    <p style={{ fontSize: 11, color: C.gray400, marginBottom: 5 }}>{label}</p>
                    <p style={{ fontSize: 16, fontWeight: 700, fontFamily: "monospace", color }}>{fmt(value)}</p>
                  </div>
                ))}
              </div>
            </SectionCard>

            {/* Data health KPIs */}
            <SectionCard title="Data Health" style={{ flex: "0 0 220px" }}>
              <StatRow label="Settled Payments"      value={(payment_stats?.total ?? 0).toLocaleString()} sub="payment rows" />
              <StatRow label="Orders Tracked"        value={(order_stats?.total ?? 0).toLocaleString()}   sub="order records" />
              <StatRow label="Unmatched Payments"    value={(join_stats?.unmatched_count ?? 0).toLocaleString()} color={C.amber} />
              <StatRow label="Net Settlement"        value={fmt(netSettle)}  color={netSettle >= 0 ? C.green : C.red} />
              <StatRow label="Settlement Efficiency" value={`${settleEff}%`} color={C.orange} sub="settlement ÷ sale" borderless />
            </SectionCard>
          </div>
        )}

        {/* ── 10. Unsettled quick link ─────────────────────────────────────── */}
        {unsettled && (
          <div
            onClick={() => {
              const params = new URLSearchParams();
              if (activeRange?.date_from) params.set("date_from", activeRange.date_from);
              if (activeRange?.date_to)   params.set("date_to",   activeRange.date_to);
              navigate(`/unsettled?${params.toString()}`);
            }}
            style={{
              ...T.card, display: "flex", alignItems: "center", gap: 20, cursor: "pointer",
              background: "#FFF1F2", border: "1.5px solid #FECDD3", padding: "16px 22px",
            }}
          >
            <span style={{ fontSize: 28 }}>⚠️</span>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: C.red, marginBottom: 3 }}>
                {(unsettled.count ?? 0).toLocaleString()} Unsettled Orders
              </p>
              <p style={{ fontSize: 12, color: C.gray500 }}>
                {unsettled.total_value ? `At-risk value: ${fmt(unsettled.total_value)}` : "No payment record"}
              </p>
            </div>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.red }}>View details →</span>
          </div>
        )}

        {/* ── 11. Deduction pie + Daily activity chart ─────────────────────── */}
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          {deductionPieData.length > 0 && (
            <SectionCard title="Deduction Split" style={{ flex: "0 0 340px" }}>
              <PieChart series={[{ data: deductionPieData, innerRadius: 52, outerRadius: 80, paddingAngle: 2 }]}
                height={230} slotProps={{ legend: { direction: "column", position: { vertical: "middle", horizontal: "right" }, labelStyle: { fontSize: 11 } } }} />
            </SectionCard>
          )}
          {timelineData.length > 0 && (
            <SectionCard title="Daily Settlement Activity" style={{ flex: "1 1 320px" }}>
              <p style={{ fontSize: 11, color: C.gray400, marginBottom: 10 }}>
                Settlements per day vs orders placed. Gap = pending settlement.
              </p>
              <LineChart dataset={timelineData}
                xAxis={[{ dataKey: "date", scaleType: "point", tickLabelStyle: { fontSize: 10 } }]}
                series={[
                  { dataKey: "settlements", label: "Settlements", color: C.green, showMark: false, area: true },
                  { dataKey: "orders", label: "Orders Placed", color: C.blue, showMark: false, area: true },
                ]}
                height={230} margin={{ left: 48, right: 10, top: 10, bottom: 30 }} />
            </SectionCard>
          )}
        </div>

        {/* ── 12. Orders + Payments by status bar charts ──────────────────── */}
        {dash && order_stats?.by_status?.length > 0 && (
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
            <SectionCard title="Orders by Lifecycle Status" style={{ flex: "1 1 300px" }}>
              <BarChart dataset={order_stats.by_status}
                xAxis={[{ scaleType: "band", dataKey: "reason_for_credit_entry", tickLabelStyle: { fontSize: 10 } }]}
                series={[{ dataKey: "count", label: "Orders", color: C.blue }]}
                height={200} borderRadius={6} margin={{ left: 48, bottom: 48, right: 8, top: 8 }}
                slotProps={{ legend: { hidden: true } }} />
            </SectionCard>
            <SectionCard title="Payments by Settlement Status" style={{ flex: "1 1 300px" }}>
              <BarChart dataset={payment_stats.by_status}
                xAxis={[{ scaleType: "band", dataKey: "live_order_status" }]}
                series={[{ dataKey: "count", label: "Payments", color: C.blue }]}
                height={200} borderRadius={6} margin={{ left: 48, bottom: 30, right: 8, top: 8 }}
                slotProps={{ legend: { hidden: true } }} />
            </SectionCard>
          </div>
        )}

      </>}

      {!loading && !profit && (
        <Alert severity="info" sx={{ borderRadius: 3 }}>
          No data for this period — try a different month or All Time.
        </Alert>
      )}
    </div>
  );
}
