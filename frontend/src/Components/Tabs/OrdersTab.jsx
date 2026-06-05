import React,{ useCallback, useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { S, SectionHeader, C, Pagination, API, fmt, Tag, StatCard } from "../../App";
import { DateRangePicker } from "../shared/DateRangePicker";

const ORDER_STATUSES = ["DELIVERED", "RTO_COMPLETE", "CANCELLED"];

const STATUS_META = {
  DELIVERED:    { variant: "green",  accent: "#16A34A" },
  RTO_COMPLETE: { variant: "red",    accent: "#DC2626" },
  CANCELLED:    { variant: "gray",   accent: "#9CA3AF" },
};

export function OrdersTab() {
  const [data, setData] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [skuFilter, setSkuFilter] = useState("");
  const [dateRange, setDateRange] = useState({ from: "", to: "" });
  const [analytics, setAnalytics] = useState(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({
      page,
      page_size: 50,
      ...(statusFilter && { status: statusFilter }),
      ...(skuFilter && { sku: skuFilter }),
      ...(dateRange.from && { date_from: dateRange.from }),
      ...(dateRange.to && { date_to: dateRange.to }),
    });
    const r = await fetch(`${API}/full-orders/?${params}`);
    if (r.ok) {
      const d = await r.json();
      setData(d.results);
      setTotal(d.total);
    }
  }, [page, statusFilter, skuFilter, dateRange]);

  const loadAnalytics = useCallback(async () => {
    const params = new URLSearchParams({
      ...(dateRange.from && { date_from: dateRange.from }),
      ...(dateRange.to && { date_to: dateRange.to }),
    });
    const r = await fetch(`${API}/full-orders/analytics/?${params}`);
    if (r.ok) setAnalytics(await r.json());
  }, [dateRange]);

  useEffect(() => { load(); loadAnalytics(); }, [load, loadAnalytics]);

  const handleDateChange = (range) => { setDateRange(range); setPage(1); };

  const deliveredCount  = analytics?.by_status?.find((s) => s.reason_for_credit_entry === "DELIVERED")?.count ?? 0;
  const rtoCount        = analytics?.by_status?.find((s) => s.reason_for_credit_entry === "RTO_COMPLETE")?.count ?? 0;
  const cancelledCount  = analytics?.by_status?.find((s) => s.reason_for_credit_entry === "CANCELLED")?.count ?? 0;
  const totalOrders     = analytics?.total ?? 0;
  const deliveredPct    = totalOrders > 0 ? ((deliveredCount / totalOrders) * 100).toFixed(1) : "0.0";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Summary KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
        <StatCard label="Total Orders" value={null} sub={`${totalOrders.toLocaleString()} orders`} accent={C.blue} icon="📦" />
        <StatCard label="Delivered" value={null} sub={`${deliveredCount.toLocaleString()} (${deliveredPct}%)`} accent={C.green} icon="✅" />
        <StatCard label="RTO Complete" value={null} sub={`${rtoCount.toLocaleString()} orders`} accent={C.red} icon="↩" />
        <StatCard label="Cancelled" value={null} sub={`${cancelledCount.toLocaleString()} orders`} accent={C.gray400} icon="✕" />
      </div>

      {/* Charts row — status distribution + top states */}
      {analytics && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
          <div style={S.card}>
            <p style={S.cardTitle}>Order Status Distribution</p>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={analytics.by_status} margin={{ top: 4, right: 8, left: -8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.gray100} />
                <XAxis dataKey="reason_for_credit_entry" tick={{ fill: C.gray400, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: C.gray400, fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 8 }}
                  cursor={{ fill: C.gray50 }}
                />
                <Bar dataKey="count" radius={[5, 5, 0, 0]}>
                  {analytics.by_status.map((entry, i) => (
                    <Cell key={i} fill={STATUS_META[entry.reason_for_credit_entry]?.accent || C.gray300} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={S.card}>
            <p style={S.cardTitle}>Top Customer States</p>
            <div style={{ overflowY: "auto", maxHeight: 200 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={S.th}>State</th>
                    <th style={{ ...S.th, textAlign: "right" }}>Orders</th>
                    <th style={{ ...S.th, textAlign: "right" }}>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {(analytics.by_state || []).map((s, i) => (
                    <tr key={s.customer_state} style={{ background: i % 2 === 0 ? C.white : C.gray50 }}>
                      <td style={S.td}>{s.customer_state || "—"}</td>
                      <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 600 }}>{s.count}</td>
                      <td style={{ ...S.td, textAlign: "right", color: C.gray400 }}>
                        {totalOrders > 0 ? `${((s.count / totalOrders) * 100).toFixed(1)}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Table with filters */}
      <div style={S.card}>
        <SectionHeader title="All Orders" count={total} />

        {/* Filter bar */}
        <div style={{
          display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16,
          alignItems: "center", padding: "12px 14px",
          background: C.gray50, borderRadius: 10, border: `1px solid ${C.border}`,
        }}>
          <DateRangePicker from={dateRange.from} to={dateRange.to} onChange={handleDateChange} />
          <div style={{ width: 1, height: 28, background: C.gray200 }} />
          <input
            value={skuFilter}
            onChange={(e) => { setSkuFilter(e.target.value); setPage(1); }}
            placeholder="🔍 Filter by SKU…"
            style={{ ...S.inp, width: 180, fontSize: 12 }}
          />
          <div style={{ width: 1, height: 28, background: C.gray200 }} />
          {["", ...ORDER_STATUSES].map((s) => (
            <button key={s || "ALL"} onClick={() => { setStatusFilter(s); setPage(1); }} style={{
              padding: "5px 13px", borderRadius: 20, fontSize: 12, cursor: "pointer",
              fontWeight: statusFilter === s ? 700 : 400,
              background: statusFilter === s ? (STATUS_META[s]?.accent || C.gray700) : C.white,
              color: statusFilter === s ? C.white : C.gray600,
              border: `1px solid ${statusFilter === s ? (STATUS_META[s]?.accent || C.gray700) : C.gray300}`,
              transition: "all 0.15s",
            }}>{s || "All"}</button>
          ))}
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Sub Order No", "Order Date", "Status", "SKU", "Size", "Product", "Qty", "State", "Listed Price", "Discounted Price"].map((h) => (
                  <th key={h} style={{
                    ...S.th,
                    textAlign: ["Listed Price", "Discounted Price"].includes(h) ? "right" : "left",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((r, i) => (
                <tr key={r.sub_order_no}
                  style={{ background: i % 2 === 0 ? C.white : C.gray50 }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#F0F7FF")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = i % 2 === 0 ? C.white : C.gray50)}
                >
                  <td style={{ ...S.td, fontFamily: "monospace", fontSize: 11, color: C.gray400 }}>…{r.sub_order_no.slice(-12)}</td>
                  <td style={{ ...S.td, color: C.gray500, whiteSpace: "nowrap" }}>{r.order_date || "—"}</td>
                  <td style={S.td}>
                    <Tag variant={STATUS_META[r.reason_for_credit_entry]?.variant || "gray"}>
                      {r.reason_for_credit_entry}
                    </Tag>
                  </td>
                  <td style={S.td}>
                    {r.sku
                      ? <span style={{ fontFamily: "monospace", fontSize: 11, color: C.orange, fontWeight: 600, background: C.orangeLight, padding: "2px 6px", borderRadius: 4 }}>{r.sku}</span>
                      : <span style={{ color: C.gray300 }}>—</span>
                    }
                  </td>
                  <td style={{ ...S.td, color: C.gray500 }}>{r.size || "—"}</td>
                  <td style={{ ...S.td, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: C.gray600 }}>{r.product_name || "—"}</td>
                  <td style={{ ...S.td, textAlign: "center", color: C.gray600 }}>{r.quantity || 1}</td>
                  <td style={{ ...S.td, color: C.gray500, whiteSpace: "nowrap" }}>{r.customer_state || "—"}</td>
                  <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace" }}>{fmt(r.supplier_listed_price)}</td>
                  <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 600 }}>{fmt(r.supplier_discounted_price)}</td>
                </tr>
              ))}
              {data.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ ...S.td, textAlign: "center", padding: 40, color: C.gray400 }}>
                    No orders found — upload Orders CSV first
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <Pagination page={page} total={total} pageSize={50} onChange={setPage} />
      </div>
    </div>
  );
}
