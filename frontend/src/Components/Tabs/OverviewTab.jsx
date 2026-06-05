import React, { useState, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend, PieChart, Pie, Cell,
} from "recharts";
import { API, C, S, CHART_COLORS, StatCard, Tag, fmt, btn } from "../../App";

// Hardcoded to avoid circular-import TDZ at module init
const STATUS_COLOR = {
  DELIVERED:    "#16A34A",
  RTO_COMPLETE: "#DC2626",
  CANCELLED:    "#9CA3AF",
};

function KpiCard({ label, value, sub, accent, icon }) {
  return (
    <div style={{ ...S.card, borderTop: `3px solid ${accent}`, display: "flex", flexDirection: "column", gap: 6 }}>
      <p style={{ fontSize: 11, fontWeight: 700, color: C.gray400, letterSpacing: "0.07em", textTransform: "uppercase" }}>
        {icon && <span style={{ marginRight: 5 }}>{icon}</span>}{label}
      </p>
      <p style={{ fontSize: 22, fontWeight: 800, color: accent, fontFamily: "'DM Mono', monospace", lineHeight: 1.1 }}>
        {value}
      </p>
      {sub && <p style={{ fontSize: 11, color: C.gray400 }}>{sub}</p>}
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <p style={{ fontSize: 11, fontWeight: 700, color: C.gray500, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 14 }}>
      {children}
    </p>
  );
}

function fmtMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-IN", { month: "long", year: "numeric" });
}

function monthToRange(ym) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { date_from: `${ym}-01`, date_to: `${ym}-${String(last).padStart(2, "0")}` };
}

// ── Filter bar ────────────────────────────────────────────────────────────────
function FilterBar({ mode, setMode, selectedMonth, setSelectedMonth, months,
                     customFrom, setCustomFrom, customTo, setCustomTo, onApply }) {
  const pill = (active) => ({
    padding: "6px 14px", borderRadius: 8, border: "none", cursor: "pointer",
    fontSize: 12, fontWeight: active ? 700 : 500, fontFamily: "inherit",
    background: active ? C.orange : C.gray100,
    color: active ? C.white : C.gray600,
    transition: "all 0.15s",
  });

  return (
    <div style={{ ...S.card, padding: "14px 20px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: C.gray500, textTransform: "uppercase", letterSpacing: "0.06em", marginRight: 4 }}>
        📅 Filter
      </span>

      {/* All Time */}
      <button style={pill(mode === "all")} onClick={() => { setMode("all"); onApply({}); }}>
        All Time
      </button>

      {/* Month selector */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <select
          value={mode === "month" ? selectedMonth : ""}
          onChange={e => {
            const m = e.target.value;
            if (!m) return;
            setMode("month");
            setSelectedMonth(m);
            onApply(monthToRange(m));
          }}
          style={{
            ...S.inp, width: "auto", minWidth: 175, cursor: "pointer", fontSize: 12,
            background: mode === "month" ? C.orangeLight : C.white,
            borderColor: mode === "month" ? C.orange : C.gray300,
            color: mode === "month" ? C.orange : C.gray700,
            fontWeight: mode === "month" ? 700 : 400,
          }}
        >
          <option value="">Select month…</option>
          {months.map(m => (
            <option key={m} value={m}>{fmtMonth(m)}</option>
          ))}
        </select>
        {mode === "month" && selectedMonth && (
          <Tag variant="orange">{fmtMonth(selectedMonth)}</Tag>
        )}
      </div>

      {/* Divider */}
      <span style={{ color: C.gray300, fontSize: 18 }}>|</span>

      {/* Custom date range */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 12, color: C.gray500, fontWeight: 600 }}>Custom:</span>
        <input
          type="date"
          value={customFrom}
          onChange={e => setCustomFrom(e.target.value)}
          style={{ ...S.inp, width: 140, fontSize: 12, padding: "7px 10px" }}
        />
        <span style={{ color: C.gray400, fontSize: 13 }}>→</span>
        <input
          type="date"
          value={customTo}
          onChange={e => setCustomTo(e.target.value)}
          style={{ ...S.inp, width: 140, fontSize: 12, padding: "7px 10px" }}
        />
        <button
          disabled={!customFrom || !customTo}
          onClick={() => {
            if (!customFrom || !customTo) return;
            setMode("custom");
            onApply({ date_from: customFrom, date_to: customTo });
          }}
          style={{
            ...btn(mode === "custom" && customFrom && customTo ? "primary" : "ghost", "sm"),
            opacity: (!customFrom || !customTo) ? 0.45 : 1,
          }}
        >
          Apply
        </button>
        {mode === "custom" && (
          <Tag variant="orange">{customFrom} → {customTo}</Tag>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function 
OverviewTab() {
  const [profit,  setProfit]  = useState(null);
  const [dash,    setDash]    = useState(null);
  const [loading, setLoading] = useState(true);

  // months list from API
  const [months,  setMonths]  = useState([]);

  // filter state
  const [mode,          setMode]          = useState("all");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [customFrom,    setCustomFrom]    = useState("");
  const [customTo,      setCustomTo]      = useState("");

  // activeRange drives both API fetches; null = waiting for months list
  const [activeRange, setActiveRange] = useState(null);

  // Load available months first, then default to latest month
  useEffect(() => {
    fetch(`${API}/profit/available-months/`)
      .then(r => r.json())
      .then(ms => {
        setMonths(ms);
        if (ms.length > 0) {
          setMode("month");
          setSelectedMonth(ms[0]);
          setActiveRange(monthToRange(ms[0]));
        } else {
          setActiveRange({});
        }
      })
      .catch(() => setActiveRange({}));
  }, []);

  // Fetch both APIs whenever activeRange changes (skip while null)
  useEffect(() => {
    if (activeRange === null) return;
    setLoading(true);
    const qs = Object.keys(activeRange).length
      ? `?${new URLSearchParams(activeRange)}`
      : "";
    Promise.all([
      fetch(`${API}/profit/${qs}`).then(r => r.json()),
      fetch(`${API}/dashboard/${qs}`).then(r => r.json()),
    ])
      .then(([p, d]) => { setProfit(p); setDash(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [activeRange]);

  // ── Derived values ──────────────────────────────────────────────────────────
  const netProfit     = Number(profit?.net_revenue ?? 0);
  const { order_stats, payment_stats, join_stats, status_settlement } = dash || {};
  const matchRate     = join_stats?.match_rate ?? 0;
  const netSettlement = payment_stats?.total_settlement ?? 0;
  const totalSale     = payment_stats?.total_sale ?? 0;
  const settlementEff = totalSale > 0 ? ((netSettlement / totalSale) * 100).toFixed(1) : "—";

  const matchPieData = [
    { name: "Matched (has Order record)", value: join_stats?.matched_count   ?? 0 },
    { name: "No Order record",            value: join_stats?.unmatched_count ?? 0 },
  ].filter(d => d.value > 0);

  const pieData = [
    { name: "Commission", value: Math.abs(Number(profit?.total_commission_paid)) },
    { name: "Ads Cost",   value: Math.abs(Number(profit?.total_ads_cost)) },
    { name: "TCS",        value: Math.abs(Number(profit?.total_tcs)) },
    { name: "TDS",        value: Math.abs(Number(profit?.total_tds)) },
    { name: "Shipping",   value: Math.abs(Number(profit?.total_shipping_cost)) },
  ].filter(d => d.value > 0.01);

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
    return Object.values(map).sort((a, b) => (a.date > b.date ? 1 : -1));
  })();

  const filterLabel =
    mode === "month"  ? fmtMonth(selectedMonth) :
    mode === "custom" ? `${customFrom} → ${customTo}` :
    "All Time";

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

      {/* Filter bar — always visible */}
      <FilterBar
        mode={mode} setMode={setMode}
        selectedMonth={selectedMonth} setSelectedMonth={setSelectedMonth}
        months={months}
        customFrom={customFrom} setCustomFrom={setCustomFrom}
        customTo={customTo} setCustomTo={setCustomTo}
        onApply={range => setActiveRange(range)}
      />

      {loading && (
        <div style={{ textAlign: "center", padding: 80, color: C.gray400, fontSize: 15 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
          Loading overview…
        </div>
      )}

      {!loading && profit && (
        <>
          {/* Hero banner */}
          <div style={{
            background: `linear-gradient(135deg, ${netProfit >= 0 ? "#F0FDF4" : "#FEF2F2"} 0%, ${C.white} 60%)`,
            border: `1px solid ${netProfit >= 0 ? C.greenBorder : C.redBorder}`,
            borderRadius: 16, padding: "28px 32px",
            display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 20,
            boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
          }}>
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, color: C.gray400, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>
                NET PROFIT — {filterLabel.toUpperCase()}
              </p>
              <p style={{ fontSize: 48, fontWeight: 800, fontFamily: "'DM Mono', monospace", color: netProfit >= 0 ? C.green : C.red, letterSpacing: "-0.03em", lineHeight: 1 }}>
                {fmt(netProfit)}
              </p>
              <div style={{ display: "flex", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
                <Tag variant={netProfit >= 0 ? "green" : "red"}>{netProfit >= 0 ? "Profitable" : "Loss"}</Tag>
                <Tag variant="gray">{profit.order_count} Settled Orders</Tag>
                <Tag variant="amber">{profit.ads_campaigns} Ad Campaigns</Tag>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: C.gray400, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 6 }}>Gross Revenue</p>
              <p style={{ fontSize: 32, fontWeight: 800, color: C.gray800, fontFamily: "'DM Mono', monospace" }}>{fmt(profit.gross_revenue)}</p>
              <p style={{ fontSize: 12, color: C.gray400, marginTop: 4 }}>
                Settlement: <strong style={{ color: C.gray700 }}>{fmt(profit.net_settlement_revenue)}</strong>
              </p>
            </div>
          </div>

          {/* Dashboard KPI cards */}
          {dash && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
              <KpiCard label="Settled Payments"      value={payment_stats.total.toLocaleString()}           accent={C.green}                              icon="💰" sub="from payment data" />
              <KpiCard label="Orders Tracked"        value={order_stats.total.toLocaleString()}             accent={C.blue}                               icon="📦" sub="matched in Orders CSV" />
              <KpiCard label="Match Rate"            value={`${matchRate}%`}                                accent={matchRate >= 80 ? C.green : C.amber}  icon="🔗" sub={`${join_stats.matched_count} linked`} />
              <KpiCard label="Net Settlement"        value={fmt(netSettlement)}                             accent={netSettlement >= 0 ? C.green : C.red} icon="💳" />
              <KpiCard label="Settlement Efficiency" value={`${settlementEff}%`}                            accent={C.orange}                             icon="📈" sub="settlement ÷ sale amount" />
              <KpiCard label="Unmatched Payments"    value={join_stats.unmatched_count.toLocaleString()}    accent={C.amber}                              icon="⚠️" sub="no Order record" />
            </div>
          )}

          {/* Profit formula */}
          <div style={{ ...S.card, padding: "16px 24px" }}>
            <p style={{ ...S.cardTitle, marginBottom: 12 }}>Profit Formula</p>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 13 }}>
              {[
                { label: "Settlement",    val: profit.net_settlement_revenue,      color: C.green },
                { label: "Purchase Cost", val: profit.total_purchase_cost,         color: C.amber,  op: "-" },
                { label: "Ads Cost",      val: profit.total_ads_cost,              color: C.red,    op: "+" },
                { label: "Referral",      val: profit.total_referral_income,       color: C.green,  op: "+" },
                { label: "Comp/Recovery", val: profit.total_compensation_recovery, color: C.amber,  op: "+" },
                { label: "Claims",        val: profit.total_claims,                           color: C.blue, op: "+" },
                { label: "Affiliate Fee", val: Math.abs(Number(profit.total_affiliate_fee)), color: C.red,  op: "−" },
              ].map((item, i) => (
                <span key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {item.op && <span style={{ fontSize: 16, color: C.gray400, fontWeight: 300 }}>{item.op}</span>}
                  <span style={{ background: C.gray50, border: `1px solid ${C.border}`, borderRadius: 8, padding: "6px 12px", display: "inline-flex", flexDirection: "column", gap: 1 }}>
                    <span style={{ fontSize: 10, color: C.gray400, fontWeight: 600 }}>{item.label}</span>
                    <span style={{ fontFamily: "monospace", fontWeight: 700, color: item.color }}>{fmt(item.val)}</span>
                  </span>
                </span>
              ))}
              <span style={{ fontSize: 18, color: C.gray300 }}>=</span>
              <span style={{ background: netProfit >= 0 ? C.greenLight : C.redLight, border: `1px solid ${netProfit >= 0 ? C.greenBorder : C.redBorder}`, borderRadius: 8, padding: "8px 16px", display: "inline-flex", flexDirection: "column", gap: 1 }}>
                <span style={{ fontSize: 10, color: C.gray400, fontWeight: 600 }}>NET PROFIT</span>
                <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 16, color: netProfit >= 0 ? C.green : C.red }}>{fmt(netProfit)}</span>
              </span>
            </div>
          </div>

          {/* Profit stat grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14 }}>
            <StatCard label="Net Settlement"  value={profit.net_settlement_revenue}       accent={C.green}   icon="💰" />
            <StatCard label="Purchase Cost"   value={profit.total_purchase_cost}          accent={C.blue}    icon="🛒" />
            <StatCard label="Packaging Cost"  value={profit.total_packaging_cost}         accent={C.gray600} icon="📦" />
            <StatCard label="RTO / Loss"      value={profit.total_loss}                   accent={C.red}     icon="↩" />
            <StatCard label="Ads Cost"        value={profit.total_ads_cost}               accent={C.amber}   icon="📣" />
            <StatCard label="Commission"      value={profit.total_commission_paid}        accent={C.green}   icon="%" />
            <StatCard label="TCS Deducted"    value={profit.total_tcs}                    accent={C.gray400} icon="🏛" />
            <StatCard label="TDS Deducted"    value={profit.total_tds}                    accent={C.gray400} icon="🏛" />
            <StatCard label="Comp/Recovery"   value={profit.total_compensation_recovery}  accent={C.red}     icon="🔄" />
            <StatCard label="Claims Approved"  value={profit.total_claims}        accent={C.blue} icon="✅" sub={`${profit.total_claimed_orders ?? 0} claimed orders`} />
            <StatCard label="Affiliate Fee"    value={profit.total_affiliate_fee}  accent={C.red}  icon="💸" sub={`${profit.adjustment_count ?? 0} adjustment rows`} />
          </div>

          {/* Status-Settlement Crosswalk */}
          {dash && status_settlement && status_settlement.length > 0 && (
            <div style={S.card}>
              <SectionTitle>Order Status → Settlement Crosswalk</SectionTitle>
              <p style={{ fontSize: 12, color: C.gray400, marginBottom: 16 }}>
                For each lifecycle status among settled orders — count and settlement amount received.
              </p>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["Order Status", "Orders", "Settled", "Settlement Rate", "Net Settlement", "Order Value", "vs Value"].map(h => (
                        <th key={h} style={{ ...S.th, textAlign: ["Orders", "Settled"].includes(h) ? "center" : ["Net Settlement", "Order Value"].includes(h) ? "right" : "left" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {status_settlement.map((row, i) => {
                      const rate = row.order_count > 0 ? ((row.settled_count / row.order_count) * 100).toFixed(1) : "0.0";
                      const vs   = row.order_value  > 0 ? ((row.settlement_amount / row.order_value) * 100).toFixed(1) : "—";
                      return (
                        <tr key={row.status} style={{ background: i % 2 === 0 ? C.white : C.gray50 }}>
                          <td style={S.td}>
                            <Tag variant={row.status === "DELIVERED" ? "green" : row.status === "RTO_COMPLETE" ? "red" : "gray"}>
                              {row.status}
                            </Tag>
                          </td>
                          <td style={{ ...S.td, textAlign: "center", fontFamily: "monospace", fontWeight: 600 }}>{row.order_count.toLocaleString()}</td>
                          <td style={{ ...S.td, textAlign: "center" }}>
                            <span style={{ background: row.settled_count > 0 ? C.greenLight : C.gray100, color: row.settled_count > 0 ? C.green : C.gray500, padding: "2px 10px", borderRadius: 6, fontWeight: 600, fontSize: 12 }}>
                              {row.settled_count.toLocaleString()}
                            </span>
                          </td>
                          <td style={S.td}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <div style={{ flex: 1, height: 6, background: C.gray100, borderRadius: 3, overflow: "hidden" }}>
                                <div style={{ width: `${rate}%`, height: "100%", background: STATUS_COLOR[row.status] || C.blue, borderRadius: 3 }} />
                              </div>
                              <span style={{ fontSize: 12, color: C.gray600, fontFamily: "monospace", minWidth: 40 }}>{rate}%</span>
                            </div>
                          </td>
                          <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: row.settlement_amount >= 0 ? C.green : C.red }}>
                            {fmt(row.settlement_amount)}
                          </td>
                          <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", color: C.gray600 }}>{fmt(row.order_value)}</td>
                          <td style={{ ...S.td, color: C.gray500, fontSize: 12 }}>
                            {vs !== "—" ? <span style={{ fontFamily: "monospace", color: Number(vs) > 0 ? C.green : C.red }}>{vs}%</span> : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Charts row 1: Orders by status + Payments by status */}
          {dash && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
              <div style={S.card}>
                <SectionTitle>Orders by Lifecycle Status</SectionTitle>
                <ResponsiveContainer width="100%" height={210}>
                  <BarChart data={order_stats.by_status} margin={{ top: 4, right: 8, left: -8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.gray100} />
                    <XAxis dataKey="reason_for_credit_entry" tick={{ fill: C.gray400, fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: C.gray400, fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 8 }} cursor={{ fill: C.gray50 }} />
                    <Bar dataKey="count" radius={[5, 5, 0, 0]}>
                      {order_stats.by_status.map((e, i) => (
                        <Cell key={i} fill={STATUS_COLOR[e.reason_for_credit_entry] || C.gray300} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div style={S.card}>
                <SectionTitle>Payments by Settlement Status</SectionTitle>
                <ResponsiveContainer width="100%" height={210}>
                  <BarChart data={payment_stats.by_status} margin={{ top: 4, right: 8, left: -8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.gray100} />
                    <XAxis dataKey="live_order_status" tick={{ fill: C.gray400, fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: C.gray400, fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 8 }} cursor={{ fill: C.gray50 }} />
                    <Bar dataKey="count" radius={[5, 5, 0, 0]} fill={C.blue} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Charts row 2: Match pie + Deduction breakdown */}
          {dash && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 18 }}>
              <div style={S.card}>
                <SectionTitle>Payment–Order Match Rate</SectionTitle>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={matchPieData} cx="50%" cy="45%" innerRadius={50} outerRadius={76} dataKey="value" paddingAngle={3}>
                      {matchPieData.map((_, i) => <Cell key={i} fill={i === 0 ? C.green : C.amber} />)}
                    </Pie>
                    <Legend iconSize={10} formatter={v => <span style={{ fontSize: 11, color: C.gray600 }}>{v}</span>} />
                    <Tooltip contentStyle={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 8 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ textAlign: "center", marginTop: 4 }}>
                  <span style={{ fontSize: 20, fontWeight: 800, color: matchRate >= 80 ? C.green : C.amber, fontFamily: "monospace" }}>{matchRate}%</span>
                  <p style={{ fontSize: 11, color: C.gray400 }}>settlements with Order record</p>
                </div>
              </div>

              <div style={S.card}>
                <SectionTitle>Payment Deductions Breakdown</SectionTitle>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {[
                    { label: "Total Sale Amount",      value: payment_stats.total_sale,       color: C.green },
                    { label: "Net Settlement",         value: payment_stats.total_settlement, color: netSettlement >= 0 ? C.green : C.red },
                    { label: "Commission (incl. GST)", value: payment_stats.total_commission, color: C.orange },
                    { label: "TCS Deducted",           value: payment_stats.total_tcs,        color: C.gray500 },
                    { label: "TDS Deducted",           value: payment_stats.total_tds,        color: C.gray500 },
                  ].map(item => (
                    <div key={item.label} style={{ background: C.gray50, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px" }}>
                      <p style={{ fontSize: 11, color: C.gray400, marginBottom: 4 }}>{item.label}</p>
                      <p style={{ fontSize: 16, fontWeight: 700, color: item.color, fontFamily: "monospace" }}>{fmt(item.value)}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Deduction split pie */}
          {pieData.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              <div style={S.card}>
                <SectionTitle>Deduction Split</SectionTitle>
                <ResponsiveContainer width="100%" height={230}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="45%" innerRadius={55} outerRadius={82} dataKey="value" paddingAngle={2}>
                      {pieData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Pie>
                    <Legend iconSize={10} formatter={v => <span style={{ fontSize: 11, color: C.gray600 }}>{v}</span>} />
                    <Tooltip contentStyle={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 8 }} formatter={v => fmt(v)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Timeline */}
          {timelineData.length > 0 && (
            <div style={S.card}>
              <SectionTitle>Daily Settlement Activity</SectionTitle>
              <p style={{ fontSize: 12, color: C.gray400, marginBottom: 12 }}>
                Settlements received per day — "Orders" shows placement date of those settled orders.
              </p>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={timelineData} margin={{ top: 4, right: 16, left: -8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.gray100} />
                  <XAxis dataKey="date" tick={{ fill: C.gray400, fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: C.gray400, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 8 }}
                    formatter={(v, name) => [v, name === "settlements" ? "Settlements" : "Orders Placed"]}
                  />
                  <Legend iconSize={10} formatter={v => <span style={{ fontSize: 11, color: C.gray600 }}>{v === "settlements" ? "Settlements" : "Orders Placed"}</span>} />
                  <Line type="monotone" dataKey="settlements" stroke={C.green} strokeWidth={2} dot={false} name="settlements" />
                  <Line type="monotone" dataKey="orders"      stroke={C.blue}  strokeWidth={2} dot={false} name="orders" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}

      {/* Empty state */}
      {!loading && !profit && (
        <div style={{ ...S.card, textAlign: "center", padding: 60, color: C.gray400 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📭</div>
          <p style={{ fontSize: 15, fontWeight: 600 }}>No data for this period</p>
          <p style={{ fontSize: 13, marginTop: 6 }}>Try selecting a different month or "All Time"</p>
        </div>
      )}
    </div>
  );
}
