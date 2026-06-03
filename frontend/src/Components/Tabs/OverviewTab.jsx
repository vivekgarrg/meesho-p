import { useState, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { C, S, CHART_COLORS, STATUS_COLORS, StatCard, Tag, API, fmt } from "../../App";

export function OverviewTab() {
  const [summary, setSummary] = useState(null);
  const [breakdown, setBreakdown] = useState([]);

  useEffect(() => {
    Promise.all([
      fetch(`${API}/profit/`).then((r) => r.json()),
      fetch(`${API}/orders/status-breakdown/`).then((r) => r.json()),
    ]).then(([s, b]) => {
      setSummary(s);
      setBreakdown(Array.isArray(b) ? b : []);
    });
  }, []);

  if (!summary)
    return <div style={{ textAlign: "center", padding: 60, color: C.gray400 }}>Loading…</div>;

  const netProfit = Number(summary.net_revenue);

  const pieData = [
    { name: "Commission", value: Math.abs(Number(summary.total_commission_paid)) },
    { name: "Ads Cost", value: Math.abs(Number(summary.total_ads_cost)) },
    { name: "TCS", value: Math.abs(Number(summary.total_tcs)) },
    { name: "TDS", value: Math.abs(Number(summary.total_tds)) },
    { name: "Shipping", value: Math.abs(Number(summary.total_shipping_cost)) },
  ].filter((d) => d.value > 0.01);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
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
            NET PROFIT — MEESHO SETTLEMENT
          </p>
          <p style={{ fontSize: 48, fontWeight: 800, fontFamily: "'DM Mono', monospace", color: netProfit >= 0 ? C.green : C.red, letterSpacing: "-0.03em", lineHeight: 1 }}>
            {fmt(netProfit)}
          </p>
          <div style={{ display: "flex", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
            <Tag variant={netProfit >= 0 ? "green" : "red"}>{netProfit >= 0 ? "Profitable Period" : "Loss Period"}</Tag>
            <Tag variant="gray">{summary.order_count} Orders</Tag>
            <Tag variant="amber">{summary.ads_campaigns} Ad Campaigns</Tag>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: C.gray400, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 6 }}>Gross Revenue</p>
          <p style={{ fontSize: 32, fontWeight: 800, color: C.gray800, fontFamily: "'DM Mono', monospace" }}>{fmt(summary.gross_revenue)}</p>
          <p style={{ fontSize: 12, color: C.gray400, marginTop: 4 }}>
            Settlement: <strong style={{ color: C.gray700 }}>{fmt(summary.net_settlement_revenue)}</strong>
          </p>
        </div>
      </div>

      {/* Profit formula strip */}
      <div style={{ ...S.card, padding: "16px 24px" }}>
        <p style={{ ...S.cardTitle, marginBottom: 12 }}>Profit Formula</p>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 13 }}>
          {[
            { label: "Settlement", val: summary.net_settlement_revenue, color: C.green },
            { label: "Purchase Cost", val: summary.total_purchase_cost, color: C.amber, op: "-" },
            { label: "Ads Cost", val: summary.total_ads_cost, color: C.red, op: "+" },
            { label: "Referral", val: summary.total_referral_income, color: C.green, op: "+" },
            { label: "Comp/Recovery", val: summary.total_compensation_recovery, color: C.amber, op: "+" },
          ].map((item, i) => (
            <span key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {item.op && <span style={{ fontSize: 16, color: C.gray400, fontWeight: 300 }}>{item.op}</span>}
              <span style={{
                background: C.gray50, border: `1px solid ${C.border}`,
                borderRadius: 8, padding: "6px 12px", display: "inline-flex", flexDirection: "column", gap: 1,
              }}>
                <span style={{ fontSize: 10, color: C.gray400, fontWeight: 600 }}>{item.label}</span>
                <span style={{ fontFamily: "monospace", fontWeight: 700, color: item.color }}>{fmt(item.val)}</span>
              </span>
            </span>
          ))}
          <span style={{ fontSize: 18, color: C.gray300 }}>=</span>
          <span style={{
            background: netProfit >= 0 ? C.greenLight : C.redLight,
            border: `1px solid ${netProfit >= 0 ? C.greenBorder : C.redBorder}`,
            borderRadius: 8, padding: "8px 16px", display: "inline-flex", flexDirection: "column", gap: 1,
          }}>
            <span style={{ fontSize: 10, color: C.gray400, fontWeight: 600 }}>NET PROFIT</span>
            <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 16, color: netProfit >= 0 ? C.green : C.red }}>{fmt(netProfit)}</span>
          </span>
        </div>
      </div>

      {/* Stat grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14 }}>
        <StatCard label="Net Settlement" value={summary.net_settlement_revenue} accent={C.green} icon="💰" />
        <StatCard label="Purchase Cost" value={summary.total_purchase_cost} accent={C.blue} icon="🚚" />
        <StatCard label="Packaging Cost" value={summary.total_packaging_cost} accent={C.gray600} icon="𝌤" />
        <StatCard label="RTO / Loss" value={summary.total_loss} accent={C.red} icon="🚚" />
        <StatCard label="Ads Cost" value={summary.total_ads_cost} accent={C.amber} icon="📣" />
        <StatCard label="Commission" value={summary.total_commission_paid} accent={C.green} icon="%" />
        <StatCard label="TCS Deducted" value={summary.total_tcs} accent={C.gray400} icon="🏛" />
        <StatCard label="TDS Deducted" value={summary.total_tds} accent={C.gray400} icon="🏛" />
        <StatCard label="Comp/Recovery" value={summary.total_compensation_recovery} accent={C.red} icon="↩" />
      </div>

      {/* Charts row */}
      <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 20 }}>
        <div style={S.card}>
          <p style={S.cardTitle}>Orders by Status (Payments)</p>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={breakdown} margin={{ top: 4, right: 8, left: -8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.gray100} />
              <XAxis dataKey="live_order_status" tick={{ fill: C.gray400, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: C.gray400, fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}
                cursor={{ fill: C.gray50 }}
              />
              <Bar dataKey="count" radius={[5, 5, 0, 0]}>
                {breakdown.map((entry, i) => (
                  <Cell key={i} fill={STATUS_COLORS[(entry.live_order_status || "").toUpperCase()] || C.gray300} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={S.card}>
          <p style={S.cardTitle}>Deduction Split</p>
          <ResponsiveContainer width="100%" height={230}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="45%" innerRadius={55} outerRadius={82} dataKey="value" paddingAngle={2}>
                {pieData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Pie>
              <Legend iconSize={10} formatter={(v) => <span style={{ fontSize: 11, color: C.gray600 }}>{v}</span>} />
              <Tooltip contentStyle={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 8 }} formatter={(v) => fmt(v)} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
