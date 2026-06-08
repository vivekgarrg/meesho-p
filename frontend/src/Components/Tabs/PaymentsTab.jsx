import React,{ useCallback, useEffect, useState } from "react";
import { S, SectionHeader, C, STATUS_COLORS, Pagination, API, StatusTag, fmt } from "../../App";
import { DateRangePicker } from "../shared/DateRangePicker";
import { PAGE_SIZE } from "../../lib/helper";

const PAYMENT_STATUSES = ["DELIVERED", "RTO", "RETURN", "PENDING", "CANCELLED"];

export function PaymentsTab() {
  const [data, setData] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [skuFilter, setSkuFilter] = useState("");
  const [dateRange, setDateRange] = useState({ from: "", to: "" });

  const load = useCallback(async () => {
    const params = new URLSearchParams({
      page,
      page_size: PAGE_SIZE,
      ...(statusFilter && { status: statusFilter }),
      ...(skuFilter && { sku: skuFilter }),
      ...(dateRange.from && { date_from: dateRange.from }),
      ...(dateRange.to && { date_to: dateRange.to }),
    });
    const r = await fetch(`${API}/orders/?${params}`);
    if (r.ok) {
      const d = await r.json();
      setData(d.results);
      setTotal(d.total);
    }
  }, [page, statusFilter, skuFilter, dateRange]);

  useEffect(() => { load(); }, [load]);

  const handleDateChange = (range) => { setDateRange(range); setPage(1); };

  return (
    <div style={S.card}>
      <SectionHeader title="Payments (Settled Orders)" count={total} />

      {/* Filters */}
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
        {["", ...PAYMENT_STATUSES].map((s) => (
          <button key={s || "ALL"} onClick={() => { setStatusFilter(s); setPage(1); }} style={{
            padding: "5px 13px", borderRadius: 20, fontSize: 12, cursor: "pointer",
            fontWeight: statusFilter === s ? 700 : 400,
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
              {["Sub Order No", "Order Date", "SKU", "Product", "Status", "Qty", "Sale Amount", "Settlement", "Commission", "Claims", "TCS", "TDS"].map((h) => (
                <th key={h} style={{ ...S.th, textAlign: ["Sale Amount", "Settlement", "Commission", "Claims", "TCS", "TDS"].includes(h) ? "right" : "left" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((r, i) => {
              const settlement = Number(r.final_settlement_amount || 0);
              const claims = Number(r.claims || 0);
              return (
                <tr key={r.sub_order_no}
                  style={{ background: i % 2 === 0 ? C.white : C.gray50 }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#F0F7FF")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = i % 2 === 0 ? C.white : C.gray50)}
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
              <tr><td colSpan={12} style={{ ...S.td, textAlign: "center", padding: 40, color: C.gray400 }}>No payment records found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination page={page} total={total} pageSize={PAGE_SIZE} onChange={setPage} />
    </div>
  );
}
