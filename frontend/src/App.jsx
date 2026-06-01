import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";

const API = "http://localhost:8000/api";

const fmt = (n) =>
  n === null || n === undefined
    ? "—"
    : `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  orange: "#E8510A",
  orangeLight: "#FFF0EA",
  orangeBorder: "#F5C4AD",
  green: "#16A34A",
  greenLight: "#F0FDF4",
  greenBorder: "#BBF7D0",
  red: "#DC2626",
  redLight: "#FEF2F2",
  redBorder: "#FECACA",
  blue: "#2563EB",
  blueLight: "#EFF6FF",
  amber: "#D97706",
  amberLight: "#FFFBEB",
  gray50: "#F9FAFB",
  gray100: "#F3F4F6",
  gray200: "#E5E7EB",
  gray300: "#D1D5DB",
  gray400: "#9CA3AF",
  gray500: "#6B7280",
  gray600: "#4B5563",
  gray700: "#374151",
  gray800: "#1F2937",
  gray900: "#111827",
  white: "#FFFFFF",
  border: "#E5E7EB",
  bg: "#F5F6FA",
  surface: "#FFFFFF",
};

const CHART_COLORS = [C.orange, "#F59E0B", "#10B981", "#3B82F6", "#8B5CF6", "#EC4899", "#06B6D4", "#84CC16"];
const STATUS_COLORS = {
  DELIVERED: C.green, RTO: C.red, RETURN: C.orange,
  PREMIUM_RETURN: C.orange, PENDING: C.blue, CANCELLED: C.gray400,
};

// ── Shared styles ─────────────────────────────────────────────────────────────
const S = {
  card: {
    background: C.white, border: `1px solid ${C.border}`,
    borderRadius: 12, padding: 24,
    boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
  },
  cardTitle: {
    fontSize: 12, fontWeight: 700, color: C.gray500,
    marginBottom: 16, letterSpacing: "0.06em", textTransform: "uppercase",
  },
  th: {
    padding: "11px 14px", textAlign: "left", color: C.gray500,
    fontSize: 11, fontWeight: 700, letterSpacing: "0.05em",
    textTransform: "uppercase", borderBottom: `1px solid ${C.border}`,
    background: C.gray50, whiteSpace: "nowrap",
  },
  td: {
    padding: "10px 14px", color: C.gray700, fontSize: 13,
    borderBottom: `1px solid ${C.gray100}`,
  },
  inp: {
    background: C.white, border: `1px solid ${C.gray300}`,
    borderRadius: 8, padding: "9px 12px", color: C.gray800,
    fontSize: 13, outline: "none", width: "100%",
    fontFamily: "inherit", transition: "border-color 0.15s",
  },
  label: { fontSize: 12, fontWeight: 600, color: C.gray600, display: "block", marginBottom: 5 },
};

function btn(variant = "primary", size = "md") {
  const sizes = { sm: { padding: "5px 12px", fontSize: 12 }, md: { padding: "9px 18px", fontSize: 13 }, lg: { padding: "11px 24px", fontSize: 14 } };
  const variants = {
    primary: { background: C.orange, color: C.white, border: "none" },
    success: { background: C.green, color: C.white, border: "none" },
    danger: { background: C.red, color: C.white, border: "none" },
    ghost: { background: "transparent", color: C.gray600, border: `1px solid ${C.gray300}` },
    ghostOrange: { background: C.orangeLight, color: C.orange, border: `1px solid ${C.orangeBorder}` },
  };
  return { ...variants[variant], ...sizes[size], borderRadius: 8, cursor: "pointer", fontWeight: 600, fontFamily: "inherit" };
}

// ── Shared components ─────────────────────────────────────────────────────────
function Tag({ children, variant = "gray" }) {
  const vars = {
    green: { bg: C.greenLight, color: C.green, border: C.greenBorder },
    red: { bg: C.redLight, color: C.red, border: C.redBorder },
    orange: { bg: C.orangeLight, color: C.orange, border: C.orangeBorder },
    blue: { bg: C.blueLight, color: C.blue, border: "#BFDBFE" },
    gray: { bg: C.gray100, color: C.gray600, border: C.gray200 },
    amber: { bg: C.amberLight, color: C.amber, border: "#FDE68A" },
  };
  const v = vars[variant] || vars.gray;
  return (
    <span style={{
      padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600,
      background: v.bg, color: v.color, border: `1px solid ${v.border}`, whiteSpace: "nowrap",
    }}>{children}</span>
  );
}

function StatusTag({ status }) {
  const s = (status || "").toUpperCase();
  const map = { DELIVERED: "green", RTO: "red", RETURN: "orange", PREMIUM_RETURN: "orange", PENDING: "blue", CANCELLED: "gray" };
  return <Tag variant={map[s] || "gray"}>{status || "—"}</Tag>;
}

function StatCard({ label, value, sub, accent = C.orange, icon }) {
  const num = Number(value);
  const isNeg = !isNaN(num) && num < 0;
  const valColor = accent ? accent :  value === null || value === undefined ? C.gray400 : isNeg ? C.red : num > 0 ? C.green : C.gray700;
  return (
    <div style={{
      ...S.card, position: "relative", overflow: "hidden",
      borderTop: `3px solid ${accent}`,
    }}>
      <p style={{ fontSize: 11, fontWeight: 700, color: C.gray400, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 8 }}>
        {icon && <span style={{ marginRight: 5 }}>{icon}</span>}{label}
      </p>
      <p style={{ fontSize: 24, fontWeight: 800, color: valColor, fontFamily: "'DM Mono', monospace", lineHeight: 1.1 }}>
        {value !== null && value !== undefined ? fmt(value) : sub || "—"}
      </p>
      {sub && value !== null && value !== undefined && (
        <p style={{ fontSize: 11, color: C.gray400, marginTop: 5 }}>{sub}</p>
      )}
    </div>
  );
}

function SectionHeader({ title, count, actions }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: C.gray800 }}>{title}</h2>
        {count !== undefined && (
          <span style={{ background: C.gray100, color: C.gray500, fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20, border: `1px solid ${C.gray200}` }}>
            {count}
          </span>
        )}
      </div>
      {actions && <div style={{ display: "flex", gap: 8 }}>{actions}</div>}
    </div>
  );
}

function Pagination({ page, total, pageSize, onChange }) {
  const totalPages = Math.ceil(total / pageSize);
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14, padding: "10px 0 0", borderTop: `1px solid ${C.gray100}` }}>
      <span style={{ fontSize: 12, color: C.gray400 }}>
        {Math.min((page - 1) * pageSize + 1, total)}–{Math.min(page * pageSize, total)} of {total}
      </span>
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={() => onChange(page - 1)} disabled={page === 1} style={{ ...btn("ghost", "sm"), opacity: page === 1 ? 0.4 : 1 }}>← Prev</button>
        <span style={{ fontSize: 12, color: C.gray500, alignSelf: "center", padding: "0 4px" }}>Page {page} / {totalPages}</span>
        <button onClick={() => onChange(page + 1)} disabled={page >= totalPages} style={{ ...btn("ghost", "sm"), opacity: page >= totalPages ? 0.4 : 1 }}>Next →</button>
      </div>
    </div>
  );
}

// ── TABS ──────────────────────────────────────────────────────────────────────
const TABS = [
  { id: "overview", label: "Overview", icon: "📊" },
  { id: "sku", label: "SKU Profit", icon: "🏷" },
  { id: "loss", label: "SKU Loss", icon: "📉" },
  { id: "ads", label: "Ads & Deductions", icon: "📣" },
  { id: "orders", label: "Orders", icon: "📦" },
  { id: "pricing", label: "SKU Pricing", icon: "⚙️" },
  { id: "upload", label: "Upload", icon: "⬆️" },
];

// ═══════════════════════════════════════════════════════════════════════════════
// OVERVIEW TAB
// ═══════════════════════════════════════════════════════════════════════════════
function OverviewTab() {
  const [summary, setSummary] = useState(null);
  const [breakdown, setBreakdown] = useState([]);

  useEffect(() => {
    Promise.all([
      fetch(`${API}/profit/`).then(r => r.json()),
      fetch(`${API}/orders/status-breakdown/`).then(r => r.json()),
    ]).then(([s, b]) => { setSummary(s); setBreakdown(Array.isArray(b) ? b : []); });
  }, []);

  if (!summary) return <div style={{ textAlign: "center", padding: 60, color: C.gray400 }}>Loading…</div>;

  const netProfit = Number(summary.net_revenue);
console.log(summary, "~summary")
  const pieData = [
    { name: "Commission", value: Math.abs(Number(summary.total_commission_paid)) },
    { name: "Ads Cost", value: Math.abs(Number(summary.total_ads_cost)) },
    { name: "TCS", value: Math.abs(Number(summary.total_tcs)) },
    { name: "TDS", value: Math.abs(Number(summary.total_tds)) },
    { name: "Shipping", value: Math.abs(Number(summary.total_shipping_cost)) },
  ].filter(d => d.value > 0.01);

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

      {/* Profit Formula strip */}
      <div style={{ ...S.card, padding: "16px 24px" }}>
        <p style={{ ...S.cardTitle, marginBottom: 12 }}>Profit Formula</p>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 13 }}>
          {[
            { label: "Settlement", val: summary.net_settlement_revenue, color: C.green },
            { label: "Purchase Cost", val: summary.total_purchase_cost, color: C.amber, op: "-"},
            // {label: "Total RTO/LOSS", val: summary.total_loss, color: C.red, op: "+"},
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
        <StatCard label="Purchase Cost" value={summary.total_purchase_cost} accent={C.blue} icon="🚚"/>
        <StatCard label="Packaging Cost" value={summary.total_packaging_cost}  accent={C.gray600} icon="𝌤"/>
        <StatCard label="RTO/LOSS" value={summary.total_loss} accent={C.red} icon="🚚"/>
        <StatCard label="Ads Cost" value={summary.total_ads_cost} accent={C.amber} icon="📣" />
        <StatCard label="Commission" value={summary.total_commission_paid} accent={C.green} icon="%" />
        <StatCard label="TCS Deducted" value={summary.total_tcs} accent={C.gray400} icon="🏛" />
        <StatCard label="TDS Deducted" value={summary.total_tds} accent={C.gray400} icon="🏛" />
        <StatCard label="Comp/Recovery" value={summary.total_compensation_recovery} accent={C.red} icon="↩" />
      </div>

      {/* Charts row */}
      <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 20 }}>
        <div style={S.card}>
          <p style={S.cardTitle}>Orders by Status</p>
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

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED SKU TABLE (used by Profit and Loss tabs)
// ═══════════════════════════════════════════════════════════════════════════════
function SKUTable({ data, mode }) {
  const [search, setSearch] = useState("");
  const filtered = data.filter(s =>
    !search || s.sku_id.toLowerCase().includes(search.toLowerCase()) ||
    (s.product_name || "").toLowerCase().includes(search.toLowerCase())
  );
  const isProfitMode = mode === "profit";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <p style={{ ...S.cardTitle, marginBottom: 0 }}>
          {isProfitMode ? "✅ Profitable SKUs" : "⚠️ Loss-making SKUs"} — {filtered.length} items
        </p>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search SKU or product…"
          style={{ ...S.inp, width: 220, fontSize: 12 }} />
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              {["#", "SKU ID", "Final Price", "Loss", "Profit", "Purchase Cost", "Settled Amount", "Total Purchase Cost", "Delivered", "Returns", "Net Profit / Loss"].map(h => (
                <th key={h} style={{ ...S.th, textAlign: h.includes("Price") || h.includes("Profit") || h.includes("Loss") ? "right" : "left" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((s, i) => (
              <tr key={s.sku_id} style={{ background: i % 2 === 0 ? C.white : C.gray50 }}
                onMouseEnter={e => e.currentTarget.style.background = "#F0F7FF"}
                onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? C.white : C.gray50}
              >
                <td style={{ ...S.td, color: C.gray400, fontSize: 11 }}>{i + 1}</td>
                <td style={S.td}>
                  <span style={{ fontFamily: "monospace", fontSize: 12, color: C.orange, fontWeight: 600, background: C.orangeLight, padding: "2px 6px", borderRadius: 4 }}>
                    {s.sku_id}
                  </span>
                </td>
                <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 600 }}>{fmt(s.final_price)}</td>
                <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 600 }}>{fmt(s.loss)}</td>
                <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 600 }}>{fmt(s.profit)}</td>
                <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 600 }}>{fmt(s.purchase_cost)}</td>
                <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 600 }}>{fmt(s.settled_amount)}</td>
                <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 600 }}>{fmt(s.total_purchase_cost)}</td>
                <td style={{ ...S.td, textAlign: "center" }}><Tag variant="green">{s.Delivered ?? 0}</Tag></td>
                <td style={{ ...S.td, textAlign: "center" }}>
                  <Tag variant="red">Return: {s.Return ?? 0} </Tag>  
                  <br/><br/>
                  <Tag variant="grey">RTO: {s.RTO ?? 0}</Tag>
                  <br/><br/>
                  <Tag variant="amber">Exchange: {s.Exchange ?? 0}</Tag>
                  <br/><br/>
                  <Tag variant="grey">Cancelled: {s.Cancelled ?? 0}</Tag>
                  <br/><br/>
                  <Tag variant="green">Shipped: {s.Shipped ?? 0}</Tag>
                  </td>
                <td style={{ ...S.td, textAlign: "right" }}>
                  <span style={{
                    fontFamily: "monospace", fontWeight: 700, fontSize: 13,
                    background: s.net_profit >= 0 ? C.greenLight : C.redLight,
                    color: s.net_profit >= 0 ? C.green : C.red,
                    border: `1px solid ${s.net_profit >= 0 ? C.greenBorder : C.redBorder}`,
                    padding: "3px 10px", borderRadius: 6, display: "inline-block",
                  }}>
                    {fmt(s.net_profit)}
                  </span>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={11} style={{ ...S.td, textAlign: "center", padding: 40, color: C.gray400 }}>
                {data.length === 0 ? "No data — upload Meesho report and add SKU pricing first" : "No results matching search"}
              </td></tr>
            )}
          </tbody>
          {filtered.length > 0 && (
            <tfoot>
              <tr style={{ background: C.gray50, borderTop: `2px solid ${C.border}` }}>
                <td colSpan={4} style={{ ...S.td, fontWeight: 700, color: C.gray700 }}>TOTAL</td>
                <td style={{ ...S.td, textAlign: "center", fontWeight: 700 }}>{filtered.reduce((a, s) => a + s.delivered_count, 0)}</td>
                <td style={{ ...S.td, textAlign: "center", fontWeight: 700 }}>{filtered.reduce((a, s) => a + s.return_rto_count, 0)}</td>
                <td style={{ ...S.td, textAlign: "center", fontWeight: 700 }}>{filtered.reduce((a, s) => a + s.claim_count, 0)}</td>
                <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: C.green }}>
                  {fmt(filtered.reduce((a, s) => a + s.delivered_profit, 0))}
                </td>
                <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: C.red }}>
                  {fmt(filtered.reduce((a, s) => a + s.return_loss, 0))}
                </td>
                <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: C.amber }}>
                  {fmt(filtered.reduce((a, s) => a + s.claim_loss, 0))}
                </td>
                <td style={{ ...S.td, textAlign: "right" }}>
                  {(() => {
                    const total = filtered.reduce((a, s) => a + s.net_profit, 0);
                    return (
                      <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 14, color: total >= 0 ? C.green : C.red }}>
                        {fmt(total)}
                      </span>
                    );
                  })()}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SKU PROFIT TAB
// ═══════════════════════════════════════════════════════════════════════════════
function SKUProfitTab({summary}) {
  const [data, setData] = useState([]);
  const [unmapped, setUnmapped] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`${API}/profit/`).then(r => r.json()),
    ]).then(([skus]) => {
      const profitData = skus.sku_wise_profit;
      const prepareData  = Object.keys(profitData).map((key)=>({
        sku_id : key,
        net_profit: profitData[key]["profit"] + profitData[key]["loss"],
        ...profitData[key],
      }))

      setData(prepareData.sort((a,b) =>   b.net_profit - a.net_profit) ?? []);
      setLoading(false);
    });
  }, []);

  if (loading) return <div style={{ textAlign: "center", padding: 60, color: C.gray400 }}>Loading…</div>;

  const totalProfit = data.reduce((a, s) => a + s.net_profit, 0);
  const topSKU = data[0];
  const chartData = data.slice(0, 10);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
        <StatCard label="Total Profit (mapped SKUs)" value={totalProfit} accent={C.green} icon="✅" />
        <StatCard label="Profitable SKUs" value={null} accent={C.green} sub={`${data.filter((a) => a.net_profit > 0).length} SKUs earning profit`} icon="🏷" />
        {topSKU && <StatCard label="Best Performing SKU" value={topSKU.net_profit} accent={C.orange} sub={topSKU.sku_id} icon="🏆" />}
        {/* <StatCard label="Unmapped SKUs" value={null} accent={C.amber} sub={`${unmapped.length} have no pricing`} icon="⚠️" /> */}
      </div>

      {chartData.length > 0 && (
        <div style={S.card}>
          <p style={S.cardTitle}>Top 10 SKUs by Net Profit</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 50 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.gray100} />
              <XAxis dataKey="sku_id" tick={{ fill: C.gray500, fontSize: 10 }} angle={-30} textAnchor="end" interval={0} tickLine={false} />
              <YAxis tick={{ fill: C.gray400, fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 8 }} formatter={(v) => fmt(v)} />
              <Bar dataKey="net_profit" radius={[5, 5, 0, 0]} fill={C.green} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div style={S.card}>
        <SKUTable data={data} mode="profit" />
      </div>

      {unmapped.length > 0 && (
        <div style={{ ...S.card, borderColor: C.orangeBorder, background: C.orangeLight }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: C.orange, marginBottom: 10 }}>
            ⚠️ {unmapped.length} SKUs in orders have no pricing — excluded from profit calculation
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {unmapped.map(u => (
              <span key={u.supplier_sku} title={u.product_name || ""} style={{
                background: C.white, border: `1px solid ${C.orangeBorder}`,
                borderRadius: 6, padding: "3px 9px", fontSize: 12, color: C.orange, fontFamily: "monospace",
              }}>{u.supplier_sku}</span>
            ))}
          </div>
          <p style={{ fontSize: 11, color: C.amber, marginTop: 8 }}>Go to ⚙️ SKU Pricing tab to add prices.</p>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SKU LOSS TABsku
// ═══════════════════════════════════════════════════════════════════════════════
function SKULossTab() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`${API}/profit/`).then(r => r.json()),
    ]).then(([skus]) => {
      const profitData = skus.sku_wise_profit;
      const prepareData  = Object.keys(profitData).map((key)=>({
        sku_id : key,
        net_profit: profitData[key]["profit"] + profitData[key]["loss"],
        ...profitData[key],
      }))

      setData(prepareData.sort((a,b) => a.net_profit - b.net_profit  ) ?? []);
      setLoading(false);
    });
  }, []);

  if (loading) return <div style={{ textAlign: "center", padding: 60, color: C.gray400 }}>Loading…</div>;

  const totalLoss = data.reduce((a, s) => a + s.loss, 0);
  const worstSKU = data[0];
  const chartData = data.slice(0, 10);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
        <StatCard label="Total Loss (mapped SKUs)" value={totalLoss} accent={C.red} icon="📉" />
        <StatCard label="Loss-making SKUs" value={null} accent={C.red} sub={`${data.filter((a)=> a.loss < 0).length} SKUs in loss`} icon="🏷" />
        {worstSKU && <StatCard label="Worst Performing SKU" value={worstSKU.net_profit} accent={C.red} sub={worstSKU.sku_id} icon="⚠️" />}
        <StatCard label="Avg Loss Per SKU" value={data.length > 0 ? totalLoss / data.filter((a)=> a.loss < 0).length : 0} accent={C.orange} icon="📊" />
      </div>

      {chartData.length > 0 && (
        <div style={S.card}>
          <p style={S.cardTitle}>Top 10 Loss-making SKUs</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 50 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.gray100} />
              <XAxis dataKey="sku_id" tick={{ fill: C.gray500, fontSize: 10 }} angle={-30} textAnchor="end" interval={0} tickLine={false} />
              <YAxis tick={{ fill: C.gray400, fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 8 }} formatter={(v) => fmt(v)} />
              <Bar dataKey="net_profit" radius={[5, 5, 0, 0]} fill={C.red} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div style={S.card}>
        <SKUTable data={data} mode="loss" />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADS & DEDUCTIONS TAB
// ═══════════════════════════════════════════════════════════════════════════════
function AdsTab() {
  const [data, setData] = useState(null);
  useEffect(() => { fetch(`${API}/ads/summary/`).then(r => r.json()).then(setData); }, []);
  if (!data) return <div style={{ textAlign: "center", padding: 60, color: C.gray400 }}>Loading…</div>;

  const items = [
    { label: "Ads Cost (total)", value: data.ads_total, color: C.orange, icon: "📣" },
    { label: "Ads GST", value: data.ads_gst, color: C.amber, icon: "🏛" },
    { label: "TCS Deducted", value: data.tcs_total, color: C.blue, icon: "📋" },
    { label: "TDS Deducted", value: data.tds_total, color: C.blue, icon: "📋" },
    { label: "Commission (incl. GST)", value: data.commission_total, color: C.red, icon: "%" },
    { label: "Gold Platform Fee", value: data.gold_fee_total, color: C.amber, icon: "⭐" },
    { label: "Mall Platform Fee", value: data.mall_fee_total, color: C.amber, icon: "🏪" },
    { label: "Shipping Charges", value: data.shipping_total, color: C.orange, icon: "🚚" },
    { label: "Return Shipping", value: data.return_shipping_total, color: C.red, icon: "↩" },
    { label: "Warehousing", value: data.warehousing_total, color: C.gray500, icon: "🏭" },
    { label: "Comp / Recovery", value: data.compensation_recovery_total, color: C.blue, icon: "💼" },
  ];

  const totalDeducted = items.reduce((a, i) => a + Math.abs(Number(i.value || 0)), 0);
  const pieData = items.filter(i => Math.abs(Number(i.value || 0)) > 0.01).map(i => ({ name: i.label, value: Math.abs(Number(i.value || 0)) }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Hero */}
      <div style={{
        background: `linear-gradient(135deg, ${C.redLight} 0%, ${C.white} 70%)`,
        border: `1px solid ${C.redBorder}`, borderRadius: 14,
        padding: "24px 28px", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 16,
        boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
      }}>
        <div>
          <p style={{ fontSize: 11, fontWeight: 700, color: C.gray400, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>TOTAL DEDUCTIONS THIS PERIOD</p>
          <p style={{ fontSize: 40, fontWeight: 800, fontFamily: "'DM Mono', monospace", color: C.red }}>{fmt(totalDeducted)}</p>
        </div>
        <div style={{ textAlign: "right" }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: C.gray400, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Referral Income (credit)</p>
          <p style={{ fontSize: 28, fontWeight: 800, color: C.green, fontFamily: "monospace" }}>{fmt(data.referral_income)}</p>
        </div>
      </div>

      {/* Cards grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
        {items.map(item => (
          <div key={item.label} style={{
            background: C.white, border: `1px solid ${C.border}`, borderRadius: 10,
            padding: "14px 16px", borderLeft: `4px solid ${item.color}`,
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}>
            <p style={{ fontSize: 11, color: C.gray400, marginBottom: 5 }}>{item.icon} {item.label}</p>
            <p style={{ fontSize: 18, fontWeight: 700, color: C.gray800, fontFamily: "monospace" }}>{fmt(item.value)}</p>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={S.card}>
          <p style={S.cardTitle}>Deduction Distribution</p>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="48%" outerRadius={92} dataKey="value" paddingAngle={2}
                label={({ percent }) => `${(percent * 100).toFixed(0)}%`} labelLine={{ stroke: C.gray300 }}>
                {pieData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Pie>
              <Legend iconSize={10} formatter={(v) => <span style={{ fontSize: 11, color: C.gray600 }}>{v}</span>} />
              <Tooltip contentStyle={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 8 }} formatter={fmt} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div style={S.card}>
          <p style={S.cardTitle}>Ads Campaigns</p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={S.th}>Campaign ID</th>
                  <th style={S.th}>Date</th>
                  <th style={{ ...S.th, textAlign: "right" }}>Total Cost</th>
                </tr>
              </thead>
              <tbody>
                {(data.ads_by_campaign || []).map((r, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? C.white : C.gray50 }}>
                    <td style={{ ...S.td, fontFamily: "monospace", fontSize: 12 }}>{r.campaign_id || "—"}</td>
                    <td style={{ ...S.td, color: C.gray500 }}>{r.deduction_date || "—"}</td>
                    <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 600, color: C.red }}>{fmt(r.cost)}</td>
                  </tr>
                ))}
                {(data.ads_by_campaign || []).length === 0 && (
                  <tr><td colSpan={3} style={{ ...S.td, textAlign: "center", color: C.gray400, padding: 24 }}>No ad campaigns</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ORDERS TAB
// ═══════════════════════════════════════════════════════════════════════════════
function OrdersTab() {
  const [data, setData] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [skuFilter, setSkuFilter] = useState("");

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page, page_size: 25, ...(statusFilter && { status: statusFilter }), ...(skuFilter && { sku: skuFilter }) });
    const r = await fetch(`${API}/orders/?${params}`);
    if (r.ok) { const d = await r.json(); setData(d.results); setTotal(d.total); }
  }, [page, statusFilter, skuFilter]);

  useEffect(() => { load(); }, [load]);

  const statuses = ["DELIVERED", "RTO", "RETURN", "PENDING", "CANCELLED"];

  return (
    <div style={S.card}>
      <SectionHeader title="Order Payments" count={total} />

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16, alignItems: "center", padding: "12px 14px", background: C.gray50, borderRadius: 10, border: `1px solid ${C.border}` }}>
        <input value={skuFilter} onChange={e => { setSkuFilter(e.target.value); setPage(1); }} placeholder="🔍 Filter by SKU…"
          style={{ ...S.inp, width: 180, fontSize: 12 }} />
        <div style={{ width: 1, height: 28, background: C.gray200, margin: "0 4px" }} />
        {["", ...statuses].map(s => (
          <button key={s || "ALL"} onClick={() => { setStatusFilter(s); setPage(1); }} style={{
            padding: "5px 13px", borderRadius: 20, fontSize: 12, cursor: "pointer", fontWeight: statusFilter === s ? 700 : 400,
            background: statusFilter === s ? (STATUS_COLORS[s] || C.gray700) : C.white,
            color: statusFilter === s ? C.white : C.gray600,
            border: `1px solid ${statusFilter === s ? (STATUS_COLORS[s] || C.gray700) : C.gray300}`,
            transition: "all 0.15s",
          }}>{s || "All"}</button>
        ))}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Sub Order No", "Date", "SKU", "Product", "Status", "Qty", "Sale Amount", "Settlement", "Commission", "Claims", "TCS", "TDS"].map(h => (
                <th key={h} style={{ ...S.th, textAlign: ["Sale Amount", "Settlement", "Commission", "Claims", "TCS", "TDS"].includes(h) ? "right" : "left" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((r, i) => {
              const settlement = Number(r.final_settlement_amount || 0);
              const claims = Number(r.claims || 0);
              return (
                <tr key={r.sub_order_no} style={{ background: i % 2 === 0 ? C.white : C.gray50 }}
                  onMouseEnter={e => e.currentTarget.style.background = "#F0F7FF"}
                  onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? C.white : C.gray50}
                >
                  <td style={{ ...S.td, fontFamily: "monospace", fontSize: 11, color: C.gray400 }}>…{r.sub_order_no.slice(-12)}</td>
                  <td style={{ ...S.td, color: C.gray500, whiteSpace: "nowrap" }}>{(r.order_date || "").slice(0, 10)}</td>
                  <td style={S.td}>
                    {r.supplier_sku ? (
                      <span style={{ fontFamily: "monospace", fontSize: 11, color: C.orange, fontWeight: 600, background: C.orangeLight, padding: "2px 6px", borderRadius: 4 }}>
                        {r.supplier_sku}
                      </span>
                    ) : <span style={{ color: C.gray300 }}>—</span>}
                  </td>
                  <td style={{ ...S.td, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: C.gray600 }}>{r.product_name || "—"}</td>
                  <td style={S.td}><StatusTag status={r.live_order_status} /></td>
                  <td style={{ ...S.td, textAlign: "center", color: C.gray600 }}>{r.quantity || 1}</td>
                  <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace" }}>{fmt(r.total_sale_amount)}</td>
                  <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 600, color: settlement < 0 ? C.red : C.green }}>{fmt(settlement)}</td>
                  <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", color: C.red }}>{fmt(r.meesho_commission_incl_gst)}</td>
                  <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", color: claims > 0 ? C.amber : C.gray400 }}>{claims > 0 ? fmt(claims) : "—"}</td>
                  <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", color: C.gray500 }}>{fmt(r.tcs)}</td>
                  <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", color: C.gray500 }}>{fmt(r.tds)}</td>
                </tr>
              );
            })}
            {data.length === 0 && (
              <tr><td colSpan={12} style={{ ...S.td, textAlign: "center", padding: 40, color: C.gray400 }}>No orders found</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination page={page} total={total} pageSize={25} onChange={setPage} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SKU PRICING TAB
// ═══════════════════════════════════════════════════════════════════════════════
function PricingTab() {
  const [skus, setSkus] = useState([]);
  const [form, setForm] = useState({ sku_id: "", item_price: "", tax_percent: "0", packaging_cost: "0" });
  const [editId, setEditId] = useState(null);
  const [msg, setMsg] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState("");
  const fileRef = useRef();
  const [summary, setSummary] = useState({});

  const load = () => fetch(`${API}/final-prices/`).then(r => r.json()).then(d => {
    setSkus(Array.isArray(d?.results) ? d.results : [])}
  );
  useEffect(() => {  load();
    fetch(`${API}/profit`).then(d=>d.json()).then(setSummary);
   }, []);

  const notify = (type, text) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 4000); };

  const handleSave = async () => {
    if (!form.sku_id.trim()) return notify("err", "SKU ID is required.");
    if (!form.item_price || Number(form.item_price) <= 0) return notify("err", "Item price must be > 0.");
    const url = editId ? `${API}/final-prices/${encodeURIComponent(editId)}/` : `${API}/final-prices/`;
    const method = editId ? "PUT" : "POST";
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({...form, final_price: previewFinal()}) });
    if (res.ok) {
      notify("ok", editId ? `SKU "${editId}" updated.` : `SKU "${form.sku_id}" added.`);
      setForm({ sku_id: "", item_price: "", tax_percent: "0", packaging_cost: "0" });
      setEditId(null);
      load();
    } else {
      const e = await res.json();
      notify("err", Object.values(e).flat().join(" "));
    }
  };

  const handleEdit = (s) => {
    setEditId(s.sku_id);
    setForm({ sku_id: s.sku_id, item_price: String(s.item_price), tax_percent: String(s.tax_percent), packaging_cost: String(s.packaging_cost) });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async (sku_id) => {
    if (!window.confirm(`Delete SKU "${sku_id}"? This cannot be undone.`)) return;
    await fetch(`${API}/skus/${encodeURIComponent(sku_id)}/delete/`, { method: "DELETE" });
    load();
    notify("ok", `Deleted: ${sku_id}`);
  };

  const handleFileUpload = async (file) => {
    if (!file) return;
    setUploading(true);
    const fd = new FormData(); fd.append("file", file);
    const res = await fetch(`${API}/final-prices/upload/`, { method: "POST", body: fd });
    const d = await res.json();
    setUploading(false);
    if (res.ok) { notify("ok", `✓ ${d.created} created, ${d.updated} updated, ${d.errors} errors`); load(); }
    else notify("err", d.error || "Upload failed");
    if (fileRef.current) fileRef.current.value = "";
  };

  const previewFinal = useCallback(() => {
    const ip = parseFloat(form.item_price) || 0;
    const tax = parseFloat(form.tax_percent) || 0;
    const pkg = parseFloat(form.packaging_cost) || 0;
    let final_price = ip + (ip * tax / 100) + pkg;
    return final_price;
  }, [form.item_price, form.packaging_cost, form.tax_percent ]);


  const filtered = skus.filter(s => !search || s.sku_id.toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Form card */}
      <div style={{ ...S.card, borderTop: `3px solid ${editId ? C.blue : C.green}` }}>
        <SectionHeader title={editId ? `✏️ Editing: ${editId}` : "➕ Add New SKU"} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14, marginBottom: 16 }}>
          <div>
            <label style={S.label}>SKU ID *</label>
            <input value={form.sku_id} onChange={e => setForm({ ...form, sku_id: e.target.value })}
              placeholder="e.g. copper_bottle_01" style={S.inp} disabled={!!editId} />
          </div>
          <div>
            <label style={S.label}>Item Price (₹) *</label>
            <input type="number" step="0.01" min="0" value={form.item_price}
              onChange={e => setForm({ ...form, item_price: e.target.value })} placeholder="0.00" style={S.inp} />
          </div>
          <div>
            <label style={S.label}>Tax % (GST)</label>
            <input type="number" step="0.5" min="0" value={form.tax_percent}
              onChange={e => setForm({ ...form, tax_percent: e.target.value })} placeholder="0" style={S.inp} />
          </div>
          <div>
            <label style={S.label}>Packaging Cost (₹)</label>
            <input type="number" step="0.01" min="0" value={form.packaging_cost}
              onChange={e => setForm({ ...form, packaging_cost: e.target.value })} placeholder="0.00" style={S.inp} />
          </div>
        </div>

        {/* Final price preview */}
        <div style={{ background: C.gray50, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 16px", marginBottom: 14, display: "flex", gap: 20, flexWrap: "wrap" }}>
          <div>
            <p style={{ fontSize: 11, color: C.gray400, marginBottom: 2 }}>Item Price</p>
            <p style={{ fontFamily: "monospace", fontWeight: 700, color: C.gray700 }}>{fmt(parseFloat(form.item_price) || 0)}</p>
          </div>
          <div style={{ color: C.gray300, alignSelf: "center", fontSize: 16 }}>+</div>
          <div>
            <p style={{ fontSize: 11, color: C.gray400, marginBottom: 2 }}>Tax ({form.tax_percent || 0}%)</p>
            <p style={{ fontFamily: "monospace", fontWeight: 700, color: C.gray700 }}>
              {fmt((parseFloat(form.item_price) || 0) * (parseFloat(form.tax_percent) || 0) / 100)}
            </p>
          </div>
          <div style={{ color: C.gray300, alignSelf: "center", fontSize: 16 }}>+</div>
          <div>
            <p style={{ fontSize: 11, color: C.gray400, marginBottom: 2 }}>Packaging</p>
            <p style={{ fontFamily: "monospace", fontWeight: 700, color: C.gray700 }}>{fmt(parseFloat(form.packaging_cost) || 0)}</p>
          </div>
          <div style={{ color: C.gray300, alignSelf: "center", fontSize: 16 }}>=</div>
          <div style={{ background: C.orangeLight, border: `1px solid ${C.orangeBorder}`, borderRadius: 8, padding: "6px 14px" }}>
            <p style={{ fontSize: 10, color: C.orange, fontWeight: 700, marginBottom: 2 }}>FINAL PRICE</p>
            <p style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 18, color: C.orange }}>{fmt(previewFinal())}</p>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={handleSave} style={btn(editId ? "success" : "primary")}>
            {editId ? "✓ Update SKU" : "+ Add SKU"}
          </button>
          {editId && (
            <button onClick={() => { setEditId(null); setForm({ sku_id: "", item_price: "", tax_percent: "0", packaging_cost: "0" }); }} style={btn("ghost")}>
              Cancel
            </button>
          )}
        </div>

        {msg && (
          <div style={{
            marginTop: 12, padding: "10px 14px", borderRadius: 8, fontSize: 13, fontWeight: 500,
            background: msg.type === "ok" ? C.greenLight : C.redLight,
            color: msg.type === "ok" ? C.green : C.red,
            border: `1px solid ${msg.type === "ok" ? C.greenBorder : C.redBorder}`,
          }}>{msg.text}</div>
        )}
      </div>

      {/* Upload strip */}
      <div style={{ ...S.card, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", background: C.blueLight, borderColor: "#BFDBFE" }}>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: C.blue, marginBottom: 3 }}>📂 Bulk Upload via Excel Sheet</p>
          <p style={{ fontSize: 12, color: C.gray500 }}>Required columns: <code style={{ background: C.white, padding: "1px 5px", borderRadius: 4 }}>sku_id</code>, <code style={{ background: C.white, padding: "1px 5px", borderRadius: 4 }}>item_price</code> — optional: tax_percent, packaging_cost</p>
        </div>
        
        <label style={{ ...btn("ghost"), display: "inline-block", cursor: "pointer" }}>
          {uploading ? "Uploading…" : "📎 Choose .xlsx"}
          <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={e => handleFileUpload(e.target.files[0])} disabled={uploading} />
        </label>
      </div>

      <div style={{ ...S.card, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", background: C.blueLight, borderColor: "#BFDBFE" }}>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: C.red, marginBottom: 3 }}>Missing SKU Id's</p>
        </div>

        {summary?.missing_sku?.join(", ")}
      </div>

      {/* Table */}
      <div style={S.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <SectionHeader title="All SKU Prices" count={filtered.length} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search SKU…"
            style={{ ...S.inp, width: 200, fontSize: 12 }} />
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["SKU ID", "Item Price", "Tax %", "Packaging Cost", "Final Price", "Last Updated", "Actions"].map(h => (
                  <th key={h} style={{ ...S.th, textAlign: ["Item Price", "Packaging Cost", "Final Price"].includes(h) ? "right" : "left" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((s, i) => (
                <tr key={s.sku_id} style={{ background: i % 2 === 0 ? C.white : C.gray50 }}
                  onMouseEnter={e => e.currentTarget.style.background = "#F0F7FF"}
                  onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? C.white : C.gray50}
                >
                  <td style={S.td}>
                    <span style={{ fontFamily: "monospace", fontSize: 12, color: C.orange, fontWeight: 600, background: C.orangeLight, padding: "2px 7px", borderRadius: 4 }}>
                      {s.sku_id}
                    </span>
                  </td>
                  <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace" }}>{fmt(s.item_price)}</td>
                  <td style={{ ...S.td, textAlign: "center" }}>
                    <span style={{ background: C.gray100, padding: "2px 8px", borderRadius: 4, fontSize: 12, color: C.gray600 }}>{s.tax_percent}%</span>
                  </td>
                  <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace" }}>{fmt(s.packaging_cost)}</td>
                  <td style={{ ...S.td, textAlign: "right" }}>
                    <span style={{ fontFamily: "monospace", fontWeight: 800, color: C.orange, background: C.orangeLight, padding: "3px 10px", borderRadius: 6, border: `1px solid ${C.orangeBorder}` }}>
                      {fmt(s.final_price)}
                    </span>
                  </td>
                  <td style={{ ...S.td, color: C.gray400, fontSize: 11 }}>{(s.updated_at || "").slice(0, 10)}</td>
                  <td style={S.td}>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => handleEdit(s)} style={btn("ghost", "sm")}>✏️ Edit</button>
                      <button onClick={() => handleDelete(s.sku_id)} style={btn("danger", "sm")}>🗑 Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} style={{ ...S.td, textAlign: "center", padding: 40, color: C.gray400 }}>
                  {skus.length === 0 ? "No SKUs yet — add one above" : "No results matching search"}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// UPLOAD TAB
// ═══════════════════════════════════════════════════════════════════════════════
function UploadTab() {
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);

  const handleFile = async (file) => {
    if (!file) return;
    setLoading(true); setMsg(null);
    const fd = new FormData(); fd.append("file", file);
    try {
      const res = await fetch(`${API}/upload/`, { method: "POST", body: fd });
      const d = await res.json();
      if (res.ok) setMsg({ type: "ok", data: d.results });
      else setMsg({ type: "err", text: d.error || "Upload failed" });
    } catch { setMsg({ type: "err", text: "Network error — is Django running on port 8000?" }); }
    setLoading(false);
  };

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
        style={{
          border: `2px dashed ${dragging ? C.orange : C.gray300}`,
          borderRadius: 16, padding: "52px 32px", textAlign: "center",
          background: dragging ? C.orangeLight : C.gray50,
          transition: "all 0.2s", cursor: "pointer",
        }}
      >
        <div style={{ fontSize: 52, marginBottom: 14 }}>📊</div>
        <p style={{ fontSize: 17, fontWeight: 600, color: C.gray700, marginBottom: 6 }}>Drop Meesho Excel report here</p>
        <p style={{ fontSize: 13, color: C.gray400, marginBottom: 22 }}>SP_ORDER_ADS_REFERRAL_PAYMENT_FILE_*.xlsx</p>
        <label style={{ ...btn("primary"), display: "inline-block", cursor: "pointer" }}>
          {loading ? "Uploading…" : "Choose File"}
          <input type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} disabled={loading} />
        </label>

        {msg && msg.type === "ok" && (
          <div style={{ marginTop: 24, background: C.greenLight, border: `1px solid ${C.greenBorder}`, borderRadius: 10, padding: 16, textAlign: "left" }}>
            <p style={{ color: C.green, fontWeight: 700, marginBottom: 8 }}>✓ Upload successful — data injected into DB</p>
            {Object.entries(msg.data).map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: `1px solid ${C.greenBorder}`, fontSize: 13 }}>
                <span style={{ color: C.gray600, fontWeight: 600 }}>{k}</span>
                <span style={{ color: C.green, fontFamily: "monospace" }}>{Object.entries(v).map(([kk, vv]) => `${kk}: ${vv}`).join(", ")}</span>
              </div>
            ))}
          </div>
        )}
        {msg && msg.type === "err" && (
          <div style={{ marginTop: 16, background: C.redLight, border: `1px solid ${C.redBorder}`, borderRadius: 8, padding: "10px 14px" }}>
            <p style={{ color: C.red, fontSize: 13 }}>❌ {msg.text}</p>
          </div>
        )}
      </div>

      {/* Mapping table */}
      <div style={S.card}>
        <p style={S.cardTitle}>Excel Sheet → MySQL Table Mapping</p>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={S.th}>Excel Sheet</th>
              <th style={S.th}>MySQL Table</th>
              <th style={S.th}>Primary Key</th>
              <th style={S.th}>Behaviour on Re-upload</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Order Payments", "order_payments", "sub_order_no", "Update existing rows (safe to re-upload)"],
              ["Ads Cost", "ads_cost", "id (auto-increment)", "Always inserts new rows"],
              ["Referral Payments", "referral_payments", "reward_id", "Update existing rows"],
              ["Compensation & Recovery", "compensation_recovery", "id (auto-increment)", "Always inserts new rows"],
            ].map(([a, b, c, d_], i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? C.white : C.gray50 }}>
                <td style={{ ...S.td, color: C.orange, fontWeight: 600 }}>{a}</td>
                <td style={{ ...S.td, fontFamily: "monospace", fontSize: 12 }}>{b}</td>
                <td style={{ ...S.td, fontFamily: "monospace", fontSize: 12, color: C.blue }}>{c}</td>
                <td style={{ ...S.td, color: C.gray500 }}>{d_}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROOT APP
// ═══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [tab, setTab] = useState("overview");

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.gray800, fontFamily: "'Inter','Segoe UI',sans-serif" }}>

      {/* Header */}
      <div style={{
        background: C.white, borderBottom: `1px solid ${C.border}`,
        padding: "0 28px", height: 58,
        display: "flex", alignItems: "center", gap: 4,
        position: "sticky", top: 0, zIndex: 100,
        boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
      }}>
        {/* Brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: 20 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, background: C.orange,
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
          }}>🏪</div>
          <span style={{ fontSize: 15, fontWeight: 800, color: C.gray800, letterSpacing: "-0.02em" }}>
            Meesho <span style={{ color: C.orange }}>Profit</span>
          </span>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 2, overflowX: "auto" }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: "6px 14px", borderRadius: 8, border: "none", cursor: "pointer",
              fontSize: 13, fontWeight: tab === t.id ? 700 : 500, transition: "all 0.15s",
              background: tab === t.id ? C.orangeLight : "transparent",
              color: tab === t.id ? C.orange : C.gray500,
              whiteSpace: "nowrap",
            }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Page content */}
      <div style={{ maxWidth: 1360, margin: "0 auto", padding: "28px 20px" }}>
        {tab === "overview" && <OverviewTab />}
        {tab === "sku" && <SKUProfitTab />}
        {tab === "loss" && <SKULossTab />}
        {tab === "ads" && <AdsTab />}
        {tab === "orders" && <OrdersTab />}
        {tab === "pricing" && <PricingTab />}
        {tab === "upload" && <UploadTab />}
      </div>
    </div>
  );
}
