import { useCallback, useEffect, useState } from "react";
import { C, S, API, SectionHeader, Pagination, fmt } from "../../App";
import { PAGE_SIZE } from "../../lib/helper";

// ── Design helpers ────────────────────────────────────────────────────────────

const COURIER_COLORS = {
  Valmo:          { bg: "#EFF6FF", fg: "#2563EB", border: "#BFDBFE" },
  Shadowfax:      { bg: "#F0FDF4", fg: "#16A34A", border: "#BBF7D0" },
  Delhivery:      { bg: "#FFF7ED", fg: "#EA580C", border: "#FED7AA" },
  "Xpress Bees":  { bg: "#FAF5FF", fg: "#9333EA", border: "#E9D5FF" },
  BlueDart:       { bg: "#FFF0EA", fg: "#E8510A", border: "#F5C4AD" },
  Ekart:          { bg: "#FFFBEB", fg: "#D97706", border: "#FDE68A" },
};
const DELIVERY_STATUS_STYLE = {
  DELIVERED:    { bg: "#F0FDF4", fg: "#16A34A", border: "#BBF7D0" },
  RTO_COMPLETE: { bg: "#FEF2F2", fg: "#DC2626", border: "#FECACA" },
  CANCELLED:    { bg: "#F9FAFB", fg: "#6B7280", border: "#E5E7EB" },
};

function cs(name) {
  return COURIER_COLORS[name] || { bg: C.gray100, fg: C.gray600, border: C.gray200 };
}

function Tag({ children, bg, fg, border, fontSize = 11 }) {
  return (
    <span style={{
      padding: "2px 9px", borderRadius: 20, fontSize,
      fontWeight: 600, background: bg, color: fg,
      border: `1px solid ${border}`, whiteSpace: "nowrap",
    }}>{children}</span>
  );
}

function SummaryKpi({ label, value, sub, accent, icon }) {
  return (
    <div style={{ ...S.card, borderTop: `3px solid ${accent}`, display: "flex", flexDirection: "column", gap: 5 }}>
      <p style={{ fontSize: 10, fontWeight: 700, color: C.gray400, textTransform: "uppercase", letterSpacing: "0.07em" }}>
        {icon} {label}
      </p>
      <p style={{ fontSize: 22, fontWeight: 800, color: accent, fontFamily: "'DM Mono', monospace", lineHeight: 1 }}>
        {value}
      </p>
      {sub && <p style={{ fontSize: 11, color: C.gray400 }}>{sub}</p>}
    </div>
  );
}

// ── Customer History Drawer ───────────────────────────────────────────────────

function CustomerHistoryDrawer({ query, onClose }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  useEffect(() => {
    setLoading(true);
    setData(null);
    setError("");
    const params = new URLSearchParams();
    if (query.name)    params.set("name", query.name);
    if (query.pincode) params.set("pincode", query.pincode);

    fetch(`${API}/labels/customer-history/?${params}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => { setError("Failed to load history"); setLoading(false); });
  }, [query.name, query.pincode]);

  const s = data?.summary || {};

  return (
    /* Overlay */
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(15,23,42,0.45)",
        zIndex: 9000,
        display: "flex", justifyContent: "flex-end",
      }}
    >
      {/* Drawer panel */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(820px, 96vw)",
          height: "100vh",
          background: C.white,
          overflowY: "auto",
          boxShadow: "-12px 0 48px rgba(0,0,0,0.18)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Drawer header */}
        <div style={{
          padding: "18px 24px 16px",
          borderBottom: `1px solid ${C.border}`,
          background: C.gray50,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          position: "sticky", top: 0, zIndex: 10,
        }}>
          <div>
            <h3 style={{ fontSize: 17, fontWeight: 800, color: C.gray800, marginBottom: 4 }}>
              👤 {query.name || `Pincode ${query.pincode}`}
            </h3>
            {data && (
              <p style={{ fontSize: 12, color: C.gray400 }}>
                {[data.customer_city, data.customer_state, data.customer_pincode]
                  .filter(Boolean).join(", ")}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              padding: "6px 14px", borderRadius: 8, border: `1px solid ${C.gray300}`,
              background: C.white, color: C.gray600, cursor: "pointer",
              fontFamily: "inherit", fontSize: 13, fontWeight: 500, flexShrink: 0,
            }}
          >✕ Close</button>
        </div>

        <div style={{ padding: "20px 24px", flex: 1 }}>
          {loading && (
            <div style={{ textAlign: "center", padding: 60, color: C.gray400 }}>
              Loading history…
            </div>
          )}
          {error && (
            <div style={{ padding: 20, color: C.red, background: C.redLight, borderRadius: 8 }}>
              {error}
            </div>
          )}

          {data && !loading && (
            <>
              {/* Customer address card */}
              {data.customer_address && (
                <div style={{
                  ...S.card, padding: "12px 16px", marginBottom: 18,
                  background: C.blueLight, borderColor: "#BFDBFE",
                }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: C.blue, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>
                    📍 Customer Address
                  </p>
                  <p style={{ fontSize: 13, color: C.gray700, lineHeight: 1.6, whiteSpace: "pre-line" }}>
                    {data.customer_address}
                  </p>
                </div>
              )}

              {/* Summary KPI row */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12, marginBottom: 20 }}>
                <SummaryKpi label="Total Orders"  value={s.total_orders}  accent={C.blue}   icon="📦" />
                <SummaryKpi label="Total Items"   value={s.total_items}   accent={C.orange} icon="🏷" />
                <SummaryKpi
                  label="Delivered"
                  value={s.delivered}
                  sub={s.total_orders > 0 ? `${((s.delivered / s.total_orders) * 100).toFixed(0)}% delivery rate` : ""}
                  accent={C.green} icon="✅"
                />
                <SummaryKpi label="RTO" value={s.rto} accent={C.red} icon="↩"
                  sub={s.total_orders > 0 ? `${((s.rto / s.total_orders) * 100).toFixed(0)}% RTO rate` : ""}
                />
                <SummaryKpi
                  label="Pending"
                  value={s.pending}
                  accent={s.pending > 0 ? C.amber : C.green}
                  icon="⏳"
                />
                <SummaryKpi
                  label="Net Settlement"
                  value={fmt(s.total_settlement)}
                  sub={`${s.settled_count} of ${s.total_orders} settled`}
                  accent={s.total_settlement > 0 ? C.green : C.gray400}
                  icon="💰"
                />
              </div>

              {/* Orders timeline table */}
              <p style={{ ...S.cardTitle, marginBottom: 12 }}>Order History — {s.total_orders} orders</p>
              <div style={{ overflowX: "auto", border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {[
                        "Upload Date", "Order ID", "SKU", "Qty",
                        "Courier", "Payment", "Delivery Status",
                        "Settlement", "Settled Date",
                      ].map((h) => (
                        <th key={h} style={{ ...S.th, fontSize: 10 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(data.orders || []).map((r, i) => {
                      const dlStyle  = DELIVERY_STATUS_STYLE[r.delivery_status] || { bg: C.gray100, fg: C.gray500, border: C.gray200 };
                      const rowBg    = i % 2 === 0 ? C.white : C.gray50;
                      const settled  = r.is_settled;
                      return (
                        <tr
                          key={r.order_id}
                          style={{ background: rowBg }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = "#F0F7FF")}
                          onMouseLeave={(e) => (e.currentTarget.style.background = rowBg)}
                        >
                          {/* Upload Date */}
                          <td style={{ ...S.td, fontSize: 12, color: C.gray500, whiteSpace: "nowrap" }}>
                            {r.uploaded_date || "—"}
                          </td>

                          {/* Order ID */}
                          <td style={{ ...S.td, fontFamily: "monospace", fontSize: 10, color: C.gray400 }}>
                            …{String(r.order_id || "").slice(-12)}
                          </td>

                          {/* SKU */}
                          <td style={S.td}>
                            {r.sku
                              ? <span style={{ fontFamily: "monospace", fontSize: 11, color: C.orange, fontWeight: 600, background: C.orangeLight, padding: "2px 6px", borderRadius: 4 }}>{r.sku}</span>
                              : <span style={{ color: C.gray300 }}>—</span>}
                          </td>

                          {/* Qty */}
                          <td style={{ ...S.td, textAlign: "center" }}>
                            {r.qty > 1
                              ? <Tag bg={C.amberLight} fg={C.amber} border="#FDE68A">×{r.qty}</Tag>
                              : <span style={{ color: C.gray400, fontSize: 12 }}>1</span>}
                          </td>

                          {/* Courier */}
                          <td style={S.td}>
                            {r.courier_name
                              ? <Tag bg={cs(r.courier_name).bg} fg={cs(r.courier_name).fg} border={cs(r.courier_name).border}>{r.courier_name}</Tag>
                              : <span style={{ color: C.gray300 }}>—</span>}
                          </td>

                          {/* Payment type */}
                          <td style={S.td}>
                            {r.payment_type === "Prepaid"
                              ? <Tag bg="#F0FDF4" fg="#16A34A" border="#BBF7D0">Prepaid</Tag>
                              : r.payment_type === "COD"
                              ? <Tag bg="#FFFBEB" fg="#D97706" border="#FDE68A">COD</Tag>
                              : <span style={{ color: C.gray300 }}>—</span>}
                          </td>

                          {/* Delivery status */}
                          <td style={S.td}>
                            {r.delivery_status
                              ? <Tag bg={dlStyle.bg} fg={dlStyle.fg} border={dlStyle.border}>{r.delivery_status}</Tag>
                              : r.live_order_status
                              ? <Tag bg={C.blueLight} fg={C.blue} border="#BFDBFE">{r.live_order_status}</Tag>
                              : <Tag bg={C.gray100} fg={C.gray500} border={C.gray200}>Pending</Tag>}
                          </td>

                          {/* Settlement amount */}
                          <td style={{ ...S.td, fontFamily: "monospace", fontWeight: settled ? 700 : 400, color: settled ? (r.settlement_amount >= 0 ? C.green : C.red) : C.gray300 }}>
                            {settled ? fmt(r.settlement_amount) : "—"}
                          </td>

                          {/* Payment date */}
                          <td style={{ ...S.td, fontSize: 11, color: C.gray400, whiteSpace: "nowrap" }}>
                            {r.payment_date || "—"}
                          </td>
                        </tr>
                      );
                    })}
                    {(!data.orders || data.orders.length === 0) && (
                      <tr>
                        <td colSpan={9} style={{ ...S.td, textAlign: "center", padding: 32, color: C.gray400 }}>
                          No orders found
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Repeat Customers Section ──────────────────────────────────────────────────

function RepeatCustomers({ onSelect }) {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]       = useState("name"); // "name" | "location"

  useEffect(() => {
    fetch(`${API}/labels/duplicates/`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const total = data ? (tab === "name" ? data.total_by_name : data.total_by_location) : 0;
  const rows  = data ? (tab === "name" ? data.by_name : data.by_location) : [];

  if (loading) return null;
  if (!data || (data.total_by_name === 0 && data.total_by_location === 0)) return null;

  return (
    <div style={{
      ...S.card,
      borderLeft: `4px solid ${C.amber}`,
      background: "#FFFDF5",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 16 }}>⚠️</span>
          <h3 style={{ fontSize: 14, fontWeight: 800, color: C.gray800 }}>Repeat Customers</h3>
          <span style={{ background: C.amberLight, color: C.amber, border: "1px solid #FDE68A", padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700 }}>
            {total} found
          </span>
        </div>
        {/* Tab toggle */}
        <div style={{ display: "flex", gap: 4, background: C.gray100, borderRadius: 8, padding: 3 }}>
          {[{ id: "name", label: `By Name (${data.total_by_name})` }, { id: "location", label: `By Location (${data.total_by_location})` }].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: "5px 14px", borderRadius: 6, fontSize: 12, cursor: "pointer",
                fontFamily: "inherit", fontWeight: tab === t.id ? 700 : 500,
                border: "none",
                background: tab === t.id ? C.white : "transparent",
                color: tab === t.id ? C.gray800 : C.gray500,
                boxShadow: tab === t.id ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                transition: "all 0.15s",
              }}
            >{t.label}</button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {tab === "name"
                ? ["Customer", "City / State", "Orders", "SKUs", "Date Range", "Action"]
                    .map((h) => <th key={h} style={{ ...S.th, fontSize: 10 }}>{h}</th>)
                : ["Pincode", "City / State", "Orders", "Distinct Names", "Customers", "SKUs", "Action"]
                    .map((h) => <th key={h} style={{ ...S.th, fontSize: 10 }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const rowBg = i % 2 === 0 ? "#FFFDF5" : C.amberLight;
              return (
                <tr
                  key={tab === "name" ? row.customer_name : row.customer_pincode}
                  style={{ background: rowBg }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#FEF9C3")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = rowBg)}
                >
                  {tab === "name" ? (
                    <>
                      <td style={{ ...S.td, fontWeight: 700, color: C.gray800 }}>{row.customer_name}</td>
                      <td style={{ ...S.td, fontSize: 12, color: C.gray500, whiteSpace: "nowrap" }}>
                        {[row.customer_city, row.customer_state].filter(Boolean).join(", ") || "—"}
                      </td>
                      <td style={{ ...S.td }}>
                        <span style={{ fontSize: 18, fontWeight: 800, fontFamily: "monospace", color: C.amber }}>
                          {row.order_count}
                        </span>
                      </td>
                      <td style={{ ...S.td }}>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {(row.skus || []).slice(0, 3).map((sku) => (
                            <span key={sku} style={{ fontFamily: "monospace", fontSize: 10, color: C.orange, background: C.orangeLight, padding: "1px 6px", borderRadius: 4, fontWeight: 600 }}>
                              {sku.length > 22 ? sku.slice(0, 20) + "…" : sku}
                            </span>
                          ))}
                          {row.skus?.length > 3 && (
                            <span style={{ fontSize: 10, color: C.gray400 }}>+{row.skus.length - 3}</span>
                          )}
                        </div>
                      </td>
                      <td style={{ ...S.td, fontSize: 11, color: C.gray400, whiteSpace: "nowrap" }}>
                        {row.first_ordered === row.last_ordered
                          ? row.first_ordered
                          : `${row.first_ordered} → ${row.last_ordered}`}
                      </td>
                      <td style={S.td}>
                        <button
                          onClick={() => onSelect({ name: row.customer_name, pincode: row.customer_pincode })}
                          style={{
                            padding: "5px 14px", borderRadius: 7, fontSize: 12, cursor: "pointer",
                            border: `1.5px solid ${C.amber}`, background: C.amberLight,
                            color: C.amber, fontFamily: "inherit", fontWeight: 600,
                          }}
                        >
                          View History →
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td style={{ ...S.td, fontFamily: "monospace", fontWeight: 700, color: C.gray700 }}>
                        {row.customer_pincode}
                      </td>
                      <td style={{ ...S.td, fontSize: 12, color: C.gray500, whiteSpace: "nowrap" }}>
                        {[row.customer_city, row.customer_state].filter(Boolean).join(", ") || "—"}
                      </td>
                      <td style={{ ...S.td }}>
                        <span style={{ fontSize: 18, fontWeight: 800, fontFamily: "monospace", color: C.amber }}>
                          {row.order_count}
                        </span>
                      </td>
                      <td style={{ ...S.td, textAlign: "center", fontFamily: "monospace", fontWeight: 700, color: C.blue }}>
                        {row.distinct_names}
                      </td>
                      <td style={{ ...S.td }}>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {(row.customer_names || []).slice(0, 3).map((n) => (
                            <span key={n} style={{ fontSize: 11, color: C.gray700, background: C.gray100, padding: "1px 7px", borderRadius: 4, fontWeight: 500 }}>
                              {n}
                            </span>
                          ))}
                          {row.customer_names?.length > 3 && (
                            <span style={{ fontSize: 11, color: C.gray400 }}>+{row.customer_names.length - 3}</span>
                          )}
                        </div>
                      </td>
                      <td style={{ ...S.td }}>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {(row.skus || []).slice(0, 2).map((sku) => (
                            <span key={sku} style={{ fontFamily: "monospace", fontSize: 10, color: C.orange, background: C.orangeLight, padding: "1px 6px", borderRadius: 4, fontWeight: 600 }}>
                              {sku.length > 20 ? sku.slice(0, 18) + "…" : sku}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td style={S.td}>
                        <button
                          onClick={() => onSelect({ pincode: row.customer_pincode })}
                          style={{
                            padding: "5px 14px", borderRadius: 7, fontSize: 12, cursor: "pointer",
                            border: `1.5px solid ${C.amber}`, background: C.amberLight,
                            color: C.amber, fontFamily: "inherit", fontWeight: 600,
                          }}
                        >
                          View History →
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main tab ──────────────────────────────────────────────────────────────────

export function LabelOrdersTab() {
  const today = new Date().toISOString().slice(0, 10);

  const [selectedDate,   setSelectedDate]   = useState(today);
  const [summary,        setSummary]        = useState(null);
  const [orders,         setOrders]         = useState([]);
  const [orderTotal,     setOrderTotal]     = useState(0);
  const [page,           setPage]           = useState(1);
  const [courierFilter,  setCourierFilter]  = useState("");
  const [availDates,     setAvailDates]     = useState([]);
  const [loading,        setLoading]        = useState(false);
  const [historyQuery,   setHistoryQuery]   = useState(null); // { name?, pincode? }

  const loadSummary = useCallback(async () => {
    const r = await fetch(`${API}/labels/summary/?date=${selectedDate}`);
    if (r.ok) {
      const d = await r.json();
      setSummary(d);
      setAvailDates(d.available_dates || []);
    }
  }, [selectedDate]);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      date: selectedDate,
      page,
      page_size: PAGE_SIZE,
      ...(courierFilter && { courier: courierFilter }),
    });
    const r = await fetch(`${API}/labels/orders/?${params}`);
    if (r.ok) {
      const d = await r.json();
      setOrders(d.results);
      setOrderTotal(d.total);
    }
    setLoading(false);
  }, [selectedDate, page, courierFilter]);

  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(() => { loadOrders(); }, [loadOrders]);

  const handleDateChange = (date) => {
    setSelectedDate(date);
    setPage(1);
    setCourierFilter("");
  };

  const handleTogglePacked = async (e, order_id, current) => {
    e.stopPropagation();
    const res = await fetch(`${API}/labels/orders/${encodeURIComponent(order_id)}/pack/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packed: !current }),
    });
    if (res.ok) {
      setOrders(prev => prev.map(o => o.order_id === order_id ? { ...o, is_packed: !current } : o));
    }
  };

  const totalOrders = summary?.total ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>

      {/* History drawer (slide-over) */}
      {historyQuery && (
        <CustomerHistoryDrawer
          query={historyQuery}
          onClose={() => setHistoryQuery(null)}
        />
      )}

      {/* Page header */}
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: C.gray800, marginBottom: 4 }}>
          📬 Label Orders
        </h2>
        <p style={{ fontSize: 13, color: C.gray400 }}>
          Orders saved from uploaded label PDFs — view by date, filter by courier.
        </p>
      </div>

      {/* ── Repeat customers (always shown, across all dates) ──────────────── */}
      <RepeatCustomers onSelect={setHistoryQuery} />

      {/* ── Date selector ──────────────────────────────────────────────────── */}
      <div style={{
        ...S.card, padding: "14px 20px",
        display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
      }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.gray500, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Date
        </span>
        <input
          type="date"
          value={selectedDate}
          max={today}
          onChange={(e) => handleDateChange(e.target.value)}
          style={{ ...S.inp, width: 160, fontSize: 13 }}
        />
        {availDates.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {availDates.slice(0, 6).map((d) => (
              <button
                key={d}
                onClick={() => handleDateChange(d)}
                style={{
                  padding: "4px 12px", borderRadius: 20, fontSize: 11, cursor: "pointer",
                  fontFamily: "inherit",
                  fontWeight: selectedDate === d ? 700 : 500,
                  border: `1.5px solid ${selectedDate === d ? C.orange : C.gray300}`,
                  background: selectedDate === d ? C.orangeLight : C.white,
                  color: selectedDate === d ? C.orange : C.gray600,
                  transition: "all 0.15s",
                }}
              >{d}</button>
            ))}
          </div>
        )}
        {totalOrders > 0 && (
          <span style={{
            marginLeft: "auto",
            background: C.orangeLight, color: C.orange,
            border: `1px solid ${C.orangeBorder}`,
            padding: "4px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700,
          }}>
            {totalOrders} order{totalOrders !== 1 ? "s" : ""} on {selectedDate}
          </span>
        )}
      </div>

      {/* Empty state */}
      {!loading && totalOrders === 0 && (
        <div style={{ ...S.card, textAlign: "center", padding: "50px 32px", color: C.gray400 }}>
          <p style={{ fontSize: 32, marginBottom: 12 }}>📭</p>
          <p style={{ fontSize: 15, fontWeight: 600 }}>No label orders for {selectedDate}</p>
          <p style={{ fontSize: 13, marginTop: 6 }}>
            Upload a labels PDF from the <strong>Labels</strong> tab — it will be saved here automatically.
          </p>
        </div>
      )}

      {totalOrders > 0 && summary && (
        <>
          {/* Courier breakdown */}
          <div style={S.card}>
            <p style={{ ...S.cardTitle, marginBottom: 16 }}>Courier Breakdown — {selectedDate}</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 10 }}>
              {(summary.courier_summary || []).map((row) => {
                const active = courierFilter === row.courier_name;
                const style  = cs(row.courier_name);
                return (
                  <div
                    key={row.courier_name}
                    onClick={() => setCourierFilter(active ? "" : row.courier_name)}
                    style={{
                      padding: "10px 16px", borderRadius: 10, cursor: "pointer",
                      background: active ? style.bg : C.white,
                      border: `${active ? 2 : 1}px solid ${active ? style.fg : style.border}`,
                      transition: "all 0.15s",
                    }}
                    onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = style.bg; }}
                    onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = C.white; }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontWeight: 700, color: style.fg, fontSize: 14 }}>{row.courier_name || "Unknown"}</span>
                      <span style={{ fontSize: 24, fontWeight: 800, color: style.fg, fontFamily: "'DM Mono', monospace" }}>{row.count}</span>
                    </div>
                    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                      <span style={{ fontSize: 11, color: C.green, fontWeight: 600 }}>✓ {row.prepaid}</span>
                      <span style={{ fontSize: 11, color: C.gray400 }}>·</span>
                      <span style={{ fontSize: 11, color: C.amber, fontWeight: 600 }}>₹ {row.cod}</span>
                      <span style={{ fontSize: 11, color: C.gray400 }}>·</span>
                      <span style={{ fontSize: 11, color: C.blue, fontWeight: 600 }}>×{row.total_items}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            {courierFilter && (
              <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, color: C.gray500 }}>Filtered:</span>
                <Tag bg={cs(courierFilter).bg} fg={cs(courierFilter).fg} border={cs(courierFilter).border}>
                  {courierFilter}
                </Tag>
                <button onClick={() => setCourierFilter("")} style={{
                  padding: "3px 10px", borderRadius: 6, border: `1px solid ${C.gray300}`,
                  background: C.white, color: C.gray500, fontSize: 11, cursor: "pointer", fontFamily: "inherit",
                }}>✕ Clear</button>
              </div>
            )}
          </div>

          {/* SKU summary */}
          <div style={S.card}>
            <p style={{ ...S.cardTitle, marginBottom: 12 }}>SKU Summary — {selectedDate}</p>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["#", "SKU", "Orders", "Total Items"].map((h, i) => (
                      <th key={h} style={{ ...S.th, textAlign: i >= 2 ? "right" : "left" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(summary.sku_summary || []).map((row, i) => (
                    <tr key={row.sku || i}
                      style={{ background: i % 2 === 0 ? C.white : C.gray50 }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#F0F7FF")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = i % 2 === 0 ? C.white : C.gray50)}
                    >
                      <td style={{ ...S.td, color: C.gray400, fontSize: 11, width: 36 }}>{i + 1}</td>
                      <td style={S.td}>
                        <span style={{ fontFamily: "monospace", fontSize: 12, color: C.orange, fontWeight: 700, background: C.orangeLight, padding: "2px 8px", borderRadius: 6 }}>
                          {row.sku || "—"}
                        </span>
                      </td>
                      <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 700, fontSize: 16 }}>{row.count}</td>
                      <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", color: C.blue, fontWeight: 600 }}>{row.total_items}</td>
                    </tr>
                  ))}
                  {(summary.sku_summary || []).length === 0 && (
                    <tr><td colSpan={4} style={{ ...S.td, textAlign: "center", color: C.gray400, padding: 24 }}>No data</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* All orders table */}
          <div style={S.card}>
            <SectionHeader
              title={`All Orders${courierFilter ? ` — ${courierFilter}` : ""}`}
              count={orderTotal}
            />

            {loading ? (
              <div style={{ textAlign: "center", padding: 40, color: C.gray400 }}>Loading…</div>
            ) : (
              <>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        {["Order ID", "Customer", "City / State", "Courier", "AWB", "Payment", "SKU", "Qty", "Order Date", "Packed"].map((h) => (
                          <th key={h} style={{ ...S.th, whiteSpace: "nowrap" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((r, i) => {
                        const style = cs(r.courier_name);
                        const rowBg = r.is_blocked
                          ? "#FFF5F5"
                          : i % 2 === 0 ? C.white : C.gray50;
                        return (
                          <tr
                            key={r.order_id}
                            style={{ background: rowBg, cursor: "pointer" }}
                            onClick={() => setHistoryQuery({ name: r.customer_name, pincode: r.customer_pincode })}
                            onMouseEnter={(e) => (e.currentTarget.style.background = r.is_blocked ? "#FFECEC" : "#F0F7FF")}
                            onMouseLeave={(e) => (e.currentTarget.style.background = rowBg)}
                            title={r.is_blocked ? "⚠ BLOCKED CUSTOMER — " + r.customer_name : "Click to view customer history"}
                          >
                            <td style={{ ...S.td, fontFamily: "monospace", fontSize: 11, color: C.gray400 }}>
                              …{r.order_id.slice(-14)}
                            </td>
                            <td style={{ ...S.td, maxWidth: 160, fontWeight: 600, color: C.gray700 }}>
                              <div style={{ display: "flex", flexDirection: "column", gap: 2, maxWidth: 140 }}>
                                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {r.customer_name || "—"}
                                </span>
                                {r.is_blocked && (
                                  <span style={{ fontSize: 9, fontWeight: 800, color: C.red, background: C.redLight, padding: "1px 6px", borderRadius: 10, width: "fit-content", letterSpacing: "0.04em" }}>
                                    🚫 BLOCKED
                                  </span>
                                )}
                              </div>
                            </td>
                            <td style={{ ...S.td, whiteSpace: "nowrap", fontSize: 12 }}>
                              <span style={{ color: C.gray600 }}>{r.customer_city || "—"}</span>
                              {r.customer_state && <span style={{ color: C.gray400 }}>, {r.customer_state}</span>}
                            </td>
                            <td style={S.td}>
                              <Tag bg={style.bg} fg={style.fg} border={style.border}>{r.courier_name || "—"}</Tag>
                            </td>
                            <td style={{ ...S.td, fontFamily: "monospace", fontSize: 11, color: C.gray500, whiteSpace: "nowrap" }}>
                              {r.awb_number || "—"}
                            </td>
                            <td style={S.td}>
                              {r.payment_type === "Prepaid"
                                ? <Tag bg="#F0FDF4" fg="#16A34A" border="#BBF7D0">Prepaid</Tag>
                                : r.payment_type === "COD"
                                ? <Tag bg="#FFFBEB" fg="#D97706" border="#FDE68A">COD</Tag>
                                : <span style={{ color: C.gray300 }}>—</span>}
                            </td>
                            <td style={S.td}>
                              {r.sku
                                ? <span style={{ fontFamily: "monospace", fontSize: 11, color: C.orange, fontWeight: 600, background: C.orangeLight, padding: "2px 7px", borderRadius: 4 }}>{r.sku}</span>
                                : <span style={{ color: C.gray300 }}>—</span>}
                            </td>
                            <td style={{ ...S.td, textAlign: "center" }}>
                              {r.qty > 1
                                ? <Tag bg={C.amberLight} fg={C.amber} border="#FDE68A">×{r.qty}</Tag>
                                : <span style={{ color: C.gray400, fontSize: 12 }}>1</span>}
                            </td>
                            <td style={{ ...S.td, color: C.gray400, fontSize: 12, whiteSpace: "nowrap" }}>
                              {r.order_date || "—"}
                            </td>
                            <td style={S.td} onClick={(e) => handleTogglePacked(e, r.order_id, r.is_packed)}>
                              <button style={{
                                padding: "3px 10px", borderRadius: 20, fontSize: 11,
                                cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
                                background: r.is_packed ? C.greenLight  : C.white,
                                color:      r.is_packed ? C.green       : C.gray400,
                                border:     `1px solid ${r.is_packed ? C.greenBorder : C.gray300}`,
                              }}>
                                {r.is_packed ? "✓ Packed" : "Not Packed"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                      {orders.length === 0 && (
                        <tr>
                          <td colSpan={10} style={{ ...S.td, textAlign: "center", padding: 40, color: C.gray400 }}>
                            No orders found
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <Pagination page={page} total={orderTotal} pageSize={PAGE_SIZE} onChange={setPage} />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
