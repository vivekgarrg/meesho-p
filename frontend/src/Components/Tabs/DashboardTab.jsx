import { useCallback, useEffect, useState } from "react";
import {  S, API, fmt,  Tag } from "../../App";
import { DateRangePicker } from "../shared/DateRangePicker";
import { AppBarChart } from "../Charts/AppBarChart";
import { AppLineChart } from "../Charts/AppLineChart";
import { AppPieChart } from "../Charts/AppPieChart";

export const C = {
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

const STATUS_COLOR = {
  DELIVERED: C.green,
  RTO_COMPLETE: C.red,
  CANCELLED: C.gray400,
};

function KpiCard({ label, value, sub, accent, icon }) {
  return (
    <div style={{
      ...S.card,
      borderTop: `3px solid ${accent}`,
      display: "flex", flexDirection: "column", gap: 6,
    }}>
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

export function DashboardTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState({ from: "", to: "" });

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      ...(dateRange.from && { date_from: dateRange.from }),
      ...(dateRange.to && { date_to: dateRange.to }),
    });
    const r = await fetch(`${API}/dashboard/?${params}`);
    if (r.ok) setData(await r.json());
    setLoading(false);
  }, [dateRange]);

  useEffect(() => { load(); }, [load]);

  const handleDateChange = (range) => setDateRange(range);

  // ── Merge daily trends by date for the timeline chart ──────────────
  const timelineData = (() => {
    if (!data) return [];
    const map = {};
    (data.order_stats?.daily || []).forEach(({ order_date, count }) => {
      const d = String(order_date);
      if (!map[d]) map[d] = { date: d, orders: 0, settlements: 0, settlement_amount: 0 };
      map[d].orders = count;
    });
    (data.payment_stats?.daily || []).forEach(({ payment_date, count, total }) => {
      const d = String(payment_date);
      if (!map[d]) map[d] = { date: d, orders: 0, settlements: 0, settlement_amount: 0 };
      map[d].settlements = count;
      map[d].settlement_amount = Number(total || 0);
    });
    return Object.values(map).sort((a, b) => (a.date > b.date ? 1 : -1));
  })();

  if (loading)
    return <div style={{ textAlign: "center", padding: 80, color: C.gray400, fontSize: 15 }}>Loading dashboard…</div>;

  if (!data)
    return (
      <div style={{ textAlign: "center", padding: 80, color: C.gray400 }}>
        <p style={{ fontSize: 15 }}>No data available</p>
        <p style={{ fontSize: 12, marginTop: 6 }}>Upload Orders CSV and Meesho Payment Excel first.</p>
      </div>
    );

  const { order_stats, payment_stats, join_stats, status_settlement } = data;
  const matchRate = join_stats?.match_rate ?? 0;
  const netSettlement = payment_stats?.total_settlement ?? 0;
  const totalSale = payment_stats?.total_sale ?? 0;
  const settlementEfficiency = totalSale > 0 ? ((netSettlement / totalSale) * 100).toFixed(1) : "—";

  // Pie data: matched vs unmatched orders
  const matchPieData = [
    { name: "Matched (has settlement)", value: join_stats?.matched_count ?? 0 },
    { name: "No settlement yet", value: join_stats?.unmatched_count ?? 0 },
  ].filter((d) => d.value > 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>

      {/* Date filter bar */}
      <div style={{
        ...S.card, padding: "14px 20px",
        display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
        background: C.blueLight, borderColor: "#BFDBFE",
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.blue }}>🎯 Dashboard Filter</span>
        <DateRangePicker from={dateRange.from} to={dateRange.to} onChange={handleDateChange} />
        {(dateRange.from || dateRange.to) && (
          <Tag variant="blue">
            {dateRange.from || "…"} → {dateRange.to || "…"}
          </Tag>
        )}
      </div>

      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
        <KpiCard label="Total Orders" value={order_stats.total.toLocaleString()} accent={C.blue} icon="📦" sub="from Orders data" />
        <KpiCard label="Settled Payments" value={payment_stats.total.toLocaleString()} accent={C.green} icon="💰" sub="from Payment data" />
        <KpiCard label="Match Rate" value={`${matchRate}%`} accent={matchRate >= 80 ? C.green : C.amber} icon="🔗" sub={`${join_stats.matched_count} orders linked`} />
        <KpiCard label="Net Settlement" value={fmt(netSettlement)} accent={netSettlement >= 0 ? C.green : C.red} icon="💳" />
        <KpiCard label="Settlement Efficiency" value={`${settlementEfficiency}%`} accent={C.orange} icon="📈" sub="settlement ÷ sale amount" />
        <KpiCard label="Unmatched Orders" value={join_stats.unmatched_count.toLocaleString()} accent={C.amber} icon="⚠️" sub="no payment record yet" />
      </div>

      {/* Status-Settlement Crosswalk — the core analytics */}
      <div style={S.card}>
        <SectionTitle>Order Status → Settlement Crosswalk</SectionTitle>
        <p style={{ fontSize: 12, color: C.gray400, marginBottom: 16 }}>
          For each order lifecycle status, how many got settled and what amount was received.
        </p>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Order Status", "Orders Placed", "Settled Count", "Settlement Rate", "Net Settlement", "Order Value (Discounted)", "Settlement vs Value"].map((h) => (
                  <th key={h} style={{
                    ...S.th,
                    textAlign: ["Orders Placed", "Settled Count"].includes(h) ? "center" : ["Net Settlement", "Order Value (Discounted)"].includes(h) ? "right" : "left",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {status_settlement.map((row, i) => {
                const settleRate = row.order_count > 0 ? ((row.settled_count / row.order_count) * 100).toFixed(1) : "0.0";
                const vsValue = row.order_value > 0 ? ((row.settlement_amount / row.order_value) * 100).toFixed(1) : "—";
                const isPositive = row.settlement_amount >= 0;
                return (
                  <tr key={row.status} style={{ background: i % 2 === 0 ? C.white : C.gray50 }}>
                    <td style={S.td}>
                      <Tag variant={row.status === "DELIVERED" ? "green" : row.status === "RTO_COMPLETE" ? "red" : "gray"}>
                        {row.status}
                      </Tag>
                    </td>
                    <td style={{ ...S.td, textAlign: "center", fontFamily: "monospace", fontWeight: 600 }}>{row.order_count.toLocaleString()}</td>
                    <td style={{ ...S.td, textAlign: "center", fontFamily: "monospace" }}>
                      <span style={{
                        background: row.settled_count > 0 ? C.greenLight : C.gray100,
                        color: row.settled_count > 0 ? C.green : C.gray500,
                        padding: "2px 10px", borderRadius: 6, fontWeight: 600, fontSize: 12,
                      }}>{row.settled_count.toLocaleString()}</span>
                    </td>
                    <td style={{ ...S.td }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ flex: 1, height: 6, background: C.gray100, borderRadius: 3, overflow: "hidden" }}>
                          <div style={{ width: `${settleRate}%`, height: "100%", background: STATUS_COLOR[row.status] || C.blue, borderRadius: 3 }} />
                        </div>
                        <span style={{ fontSize: 12, color: C.gray600, fontFamily: "monospace", minWidth: 40 }}>{settleRate}%</span>
                      </div>
                    </td>
                    <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: isPositive ? C.green : C.red }}>
                      {fmt(row.settlement_amount)}
                    </td>
                    <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", color: C.gray600 }}>
                      {fmt(row.order_value)}
                    </td>
                    <td style={{ ...S.td, color: C.gray500, fontSize: 12 }}>
                      {vsValue !== "—" ? (
                        <span style={{ fontFamily: "monospace", color: Number(vsValue) > 0 ? C.green : C.red }}>
                          {vsValue}%
                        </span>
                      ) : "—"}
                    </td>
                  </tr>
                );
              })}
              {status_settlement.length === 0 && (
                <tr><td colSpan={7} style={{ ...S.td, textAlign: "center", padding: 40, color: C.gray400 }}>No data</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Charts row 1 — Orders by status + Payments by status */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <div style={S.card}>
          <SectionTitle>Orders by Lifecycle Status</SectionTitle>
          <AppBarChart
            dataset={order_stats.by_status}
            indexKey="reason_for_credit_entry"
            series={[{ dataKey: "count", label: "Orders" }]}
            colorByIndex={STATUS_COLOR}
            height={210}
          />
        </div>

        <div style={S.card}>
          <SectionTitle>Payments by Settlement Status</SectionTitle>
          <AppBarChart
            dataset={payment_stats.by_status}
            indexKey="live_order_status"
            series={[{ dataKey: "count", label: "Count", color: C.blue }]}
            height={210}
          />
        </div>
      </div>

      {/* Charts row 2 — Match pie + deductions */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 18 }}>
        <div style={S.card}>
          <SectionTitle>Order–Payment Match Rate</SectionTitle>
          <AppPieChart
            data={matchPieData.map((d, i) => ({ ...d, color: i === 0 ? C.green : C.amber }))}
            height={200}
            showLegend
          />
          <div style={{ textAlign: "center", marginTop: 4 }}>
            <span style={{ fontSize: 20, fontWeight: 800, color: matchRate >= 80 ? C.green : C.amber, fontFamily: "monospace" }}>
              {matchRate}%
            </span>
            <p style={{ fontSize: 11, color: C.gray400 }}>of orders have a payment record</p>
          </div>
        </div>

        <div style={S.card}>
          <SectionTitle>Payment Deductions Breakdown</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {[
              { label: "Total Sale Amount", value: payment_stats.total_sale, color: C.green },
              { label: "Net Settlement", value: payment_stats.total_settlement, color: netSettlement >= 0 ? C.green : C.red },
              { label: "Commission (incl. GST)", value: payment_stats.total_commission, color: C.orange },
              { label: "TCS Deducted", value: payment_stats.total_tcs, color: C.gray500 },
              { label: "TDS Deducted", value: payment_stats.total_tds, color: C.gray500 },
            ].map((item) => (
              <div key={item.label} style={{
                background: C.gray50, border: `1px solid ${C.border}`,
                borderRadius: 10, padding: "12px 14px",
              }}>
                <p style={{ fontSize: 11, color: C.gray400, marginBottom: 4 }}>{item.label}</p>
                <p style={{ fontSize: 16, fontWeight: 700, color: item.color, fontFamily: "monospace" }}>{fmt(item.value)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Timeline chart */}
      {timelineData.length > 0 && (
        <div style={S.card}>
          <SectionTitle>Daily Orders vs Settlements Timeline</SectionTitle>
          <p style={{ fontSize: 12, color: C.gray400, marginBottom: 12 }}>
            Orders placed each day vs settlements received — gap shows pending settlements.
          </p>
          <AppLineChart
            dataset={timelineData}
            indexKey="date"
            series={[
              { dataKey: "orders", label: "Orders Placed", color: C.blue },
              { dataKey: "settlements", label: "Settlements", color: C.green },
            ]}
            height={250}
          />
        </div>
      )}
    </div>
  );
}
