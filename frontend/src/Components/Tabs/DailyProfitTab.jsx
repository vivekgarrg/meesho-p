import React, { useEffect, useState } from "react";
import { BarChart } from "@mui/x-charts/BarChart";
import { LineChart } from "@mui/x-charts/LineChart";
import CircularProgress from "@mui/material/CircularProgress";
import { API, C, S, fmt } from "../../App";
import { useDateFilter } from "../../contexts/DateFilterContext";

const BUCKET_META = [
  { key: "delivered_count", label: "Delivered", color: C.green },
  { key: "return_count",    label: "Return",    color: C.orange },
  { key: "rto_count",       label: "RTO",        color: C.red },
  { key: "exchange_count",  label: "Exchange",  color: C.blue },
  { key: "claim_count",     label: "Claim",      color: "#7C3AED" },
  { key: "unknown_count",   label: "Unresolved", color: C.gray400 },
  { key: "no_payment_count", label: "Awaiting Meesho data", color: C.gray200 },
];

function fmtDay(iso) {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

const pct = (n, of) => (of > 0 ? `${((n / of) * 100).toFixed(1)}%` : "—");

/**
 * A plain count/rate tile. Unlike the shared `StatCard` (built for money —
 * it runs every value through the ₹ currency formatter and auto-colors
 * anything positive green), this renders whatever string it's given as-is,
 * so an order count doesn't get printed as "₹100.00" and a rising RTO count
 * doesn't get painted green just for being a positive number.
 */
function KpiTile({ label, value, sub, accent, icon }) {
  return (
    <div style={{ ...S.card, borderTop: `3px solid ${accent}`, display: "flex", flexDirection: "column", gap: 6 }}>
      <p style={{ fontSize: 11, fontWeight: 700, color: C.gray400, letterSpacing: "0.07em", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 5 }}>
        {icon && <span>{icon}</span>}{label}
      </p>
      <p style={{ fontSize: 24, fontWeight: 800, color: accent, fontFamily: "monospace", lineHeight: 1.1 }}>{value}</p>
      {sub && <p style={{ fontSize: 11, color: C.gray400 }}>{sub}</p>}
    </div>
  );
}

export function DailyProfitTab() {
  const { range, label: periodLabel, mode } = useDateFilter();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (range.date_from) params.set("date_from", range.date_from);
    if (range.date_to)   params.set("date_to", range.date_to);
    fetch(`${API}/profit/daily/?${params}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setError("Network error — could not load daily profit."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range.date_from, range.date_to]);

  // Backend returns days oldest → newest, which is what both the table and
  // the charts want (chronological reading order, left to right / top to bottom).
  const days = data?.days || [];
  const totals = data?.totals;

  const barSeries = BUCKET_META.map(({ key, label, color }) => ({
    dataKey: key, label, color, stack: "outcome",
  }));

  const netPos = (totals?.net_profit ?? 0) >= 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: C.gray800, marginBottom: 4 }}>Daily Profit</h2>
        <p style={{ fontSize: 12, color: C.gray400, maxWidth: 720 }}>
          Profit attributed to the day an order shipped, not the day it settles. A day's numbers start mostly
          "awaiting Meesho data" and fill in as Delivered / RTO / Return outcomes and payments arrive over the
          following days — no fixed settlement delay is assumed, this is real settlement data as it lands. · {periodLabel}
        </p>
        {mode === "all" && !loading && data && (
          <p style={{ fontSize: 11.5, color: C.amber, marginTop: 6 }}>
            Showing the last 30 days (day-by-day view is capped at 92 days) — pick a month above for a specific period.
          </p>
        )}
      </div>

      {error && (
        <div style={{
          padding: "10px 16px", borderRadius: 10, background: C.redLight,
          border: `1px solid ${C.redBorder}`, color: C.red, fontSize: 13, fontWeight: 600,
        }}>{error}</div>
      )}

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 60 }}>
          <CircularProgress style={{ color: C.orange }} />
        </div>
      ) : !totals || totals.shipped_count === 0 ? (
        <div style={{ textAlign: "center", padding: 60, color: C.gray400 }}>
          <p style={{ fontSize: 14 }}>No orders shipped in this period.</p>
        </div>
      ) : (
        <>
          {/* ── Summary row ── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
            <KpiTile label="Shipped" value={totals.shipped_count.toLocaleString()} accent={C.blue} icon="📦"
              sub={`across ${days.length} day(s)`} />
            <KpiTile label="Delivered" value={totals.delivered_count.toLocaleString()} accent={C.green} icon="✅"
              sub={`${pct(totals.delivered_count, totals.shipped_count)} of shipped`} />
            <KpiTile label="RTO" value={totals.rto_count.toLocaleString()} accent={C.red} icon="🔄"
              sub={`${pct(totals.rto_count, totals.shipped_count)} of shipped`} />
            <KpiTile label="Return" value={totals.return_count.toLocaleString()} accent={C.orange} icon="↩"
              sub={`${pct(totals.return_count, totals.shipped_count)} of shipped`} />
            <KpiTile label="Awaiting Meesho Data" value={totals.no_payment_count.toLocaleString()} accent={C.amber} icon="⏳"
              sub={`${pct(totals.no_payment_count, totals.shipped_count)} of shipped — no sheet yet`} />
            <KpiTile label="Net Profit" value={fmt(totals.net_profit)} accent={netPos ? C.green : C.red} icon="₹"
              sub={`from ${totals.settled_count.toLocaleString()} settled order(s)`} />
            <KpiTile label="Profit / Shipped Order" value={fmt(totals.shipped_count ? totals.net_profit / totals.shipped_count : 0)}
              accent={netPos ? C.green : C.red} icon="📊"
              sub="blended — includes orders still pending" />
          </div>

          {/* ── Outcome mix per day ── */}
          <div style={S.card}>
            <p style={{ fontSize: 11, fontWeight: 700, color: C.gray500, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 4 }}>
              Shipped Orders — Outcome Mix by Ship Day
            </p>
            <p style={{ fontSize: 12, color: C.gray400, marginBottom: 14 }}>
              Each bar is everything shipped that day; the "awaiting Meesho data" slice shrinks as sheets are uploaded.
            </p>
            <BarChart
              dataset={days}
              xAxis={[{ scaleType: "band", dataKey: "date", valueFormatter: fmtDay, tickLabelStyle: { fontSize: 10 } }]}
              series={barSeries}
              height={260}
              borderRadius={3}
              margin={{ left: 44, right: 10, top: 10, bottom: 34 }}
              slotProps={{ legend: { position: { vertical: "top", horizontal: "right" }, labelStyle: { fontSize: 10.5 } } }}
            />
          </div>

          {/* ── Net profit trend ── */}
          <div style={S.card}>
            <p style={{ fontSize: 11, fontWeight: 700, color: C.gray500, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 4 }}>
              Net Profit by Ship Day
            </p>
            <p style={{ fontSize: 12, color: C.gray400, marginBottom: 14 }}>
              Settlement-based — a recent day's line will keep rising as its still-pending orders settle.
            </p>
            <LineChart
              dataset={days}
              xAxis={[{ scaleType: "band", dataKey: "date", valueFormatter: fmtDay, tickLabelStyle: { fontSize: 10 } }]}
              series={[{ dataKey: "net_profit", label: "Net Profit", color: C.orange, valueFormatter: (v) => fmt(v) }]}
              height={220}
              margin={{ left: 56, right: 10, top: 10, bottom: 34 }}
              slotProps={{ legend: { hidden: true } }}
            />
          </div>

          {/* ── Day-by-day table ── */}
          <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    {["Date", "Shipped", "Delivered", "RTO", "Return", "Exchange", "Claim", "Unresolved", "Awaiting data", "Net profit"].map((h, i) => (
                      <th key={h} style={{ ...S.th, textAlign: i === 0 ? "left" : "right" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {days.map((d, idx) => {
                    const pos = d.net_profit >= 0;
                    return (
                      <tr key={d.date} style={{ background: idx % 2 === 0 ? C.white : C.gray50 }}>
                        <td style={{ ...S.td, fontWeight: 700, color: C.gray800 }}>{fmtDay(d.date)}</td>
                        <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace" }}>{d.shipped_count}</td>
                        <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", color: C.green }}>{d.delivered_count || "—"}</td>
                        <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", color: C.red }}>{d.rto_count || "—"}</td>
                        <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", color: C.orange }}>{d.return_count || "—"}</td>
                        <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", color: C.blue }}>{d.exchange_count || "—"}</td>
                        <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", color: "#7C3AED" }}>{d.claim_count || "—"}</td>
                        <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", color: C.gray400 }}>{d.unknown_count || "—"}</td>
                        <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", color: d.no_payment_count ? C.amber : C.gray300 }}>
                          {d.no_payment_count || "—"}
                        </td>
                        <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 800, color: pos ? C.green : C.red }}>
                          {fmt(d.net_profit)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
