import { useCallback, useEffect, useState } from "react";
import { C, S, API, SectionHeader, Pagination } from "../../App";

// ── Small helpers ─────────────────────────────────────────────────────────────

const COURIER_COLORS = {
  Valmo:        { bg: "#EFF6FF", fg: "#2563EB", border: "#BFDBFE" },
  Shadowfax:    { bg: "#F0FDF4", fg: "#16A34A", border: "#BBF7D0" },
  Delhivery:    { bg: "#FFF7ED", fg: "#EA580C", border: "#FED7AA" },
  "Xpress Bees":{ bg: "#FAF5FF", fg: "#9333EA", border: "#E9D5FF" },
  BlueDart:     { bg: "#FFF0EA", fg: "#E8510A", border: "#F5C4AD" },
  Ekart:        { bg: "#FFFBEB", fg: "#D97706", border: "#FDE68A" },
};

function courierStyle(name) {
  return COURIER_COLORS[name] || { bg: C.gray100, fg: C.gray600, border: C.gray200 };
}

function CourierPill({ name, count }) {
  const s = courierStyle(name);
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "10px 16px", borderRadius: 10,
      background: s.bg, border: `1.5px solid ${s.border}`,
    }}>
      <span style={{ fontWeight: 700, color: s.fg, fontSize: 14 }}>{name || "Unknown"}</span>
      <span style={{ fontSize: 24, fontWeight: 800, color: s.fg, fontFamily: "'DM Mono', monospace" }}>
        {count}
      </span>
    </div>
  );
}

function Tag({ children, bg, fg, border }) {
  return (
    <span style={{
      padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 600,
      background: bg, color: fg, border: `1px solid ${border}`, whiteSpace: "nowrap",
    }}>{children}</span>
  );
}

// ── Main tab ──────────────────────────────────────────────────────────────────

export function LabelOrdersTab() {
  const today = new Date().toISOString().slice(0, 10);

  const [selectedDate,  setSelectedDate]  = useState(today);
  const [summary,       setSummary]       = useState(null);
  const [orders,        setOrders]        = useState([]);
  const [orderTotal,    setOrderTotal]    = useState(0);
  const [page,          setPage]          = useState(1);
  const [courierFilter, setCourierFilter] = useState("");
  const [availDates,    setAvailDates]    = useState([]);
  const [loading,       setLoading]       = useState(false);

  // Load summary (courier breakdown + sku breakdown)
  const loadSummary = useCallback(async () => {
    const r = await fetch(`${API}/labels/summary/?date=${selectedDate}`);
    if (r.ok) {
      const d = await r.json();
      setSummary(d);
      setAvailDates(d.available_dates || []);
    }
  }, [selectedDate]);

  // Load paginated orders
  const loadOrders = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      date: selectedDate,
      page,
      page_size: 50,
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

  const handleCourierFilter = (c) => {
    setCourierFilter(c === courierFilter ? "" : c);
    setPage(1);
  };

  const totalOrders = summary?.total ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>

      {/* Header */}
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: C.gray800, marginBottom: 4 }}>
          📬 Label Orders
        </h2>
        <p style={{ fontSize: 13, color: C.gray400 }}>
          Orders saved from uploaded label PDFs — view by date, filter by courier.
        </p>
      </div>

      {/* Date selector bar */}
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
        {/* Quick-pick available dates */}
        {availDates.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {availDates.slice(0, 6).map((d) => (
              <button
                key={d}
                onClick={() => handleDateChange(d)}
                style={{
                  padding: "4px 12px", borderRadius: 20, fontSize: 11, cursor: "pointer",
                  fontFamily: "inherit", fontWeight: selectedDate === d ? 700 : 500,
                  border: `1.5px solid ${selectedDate === d ? C.orange : C.gray300}`,
                  background: selectedDate === d ? C.orangeLight : C.white,
                  color: selectedDate === d ? C.orange : C.gray600,
                  transition: "all 0.15s",
                }}
              >
                {d}
              </button>
            ))}
          </div>
        )}
        {totalOrders > 0 && (
          <span style={{
            marginLeft: "auto", background: C.orangeLight, color: C.orange,
            border: `1px solid ${C.orangeBorder}`, padding: "4px 14px",
            borderRadius: 20, fontSize: 12, fontWeight: 700,
          }}>
            {totalOrders} order{totalOrders !== 1 ? "s" : ""} on {selectedDate}
          </span>
        )}
      </div>

      {/* No data state */}
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
          {/* Courier breakdown cards */}
          <div style={S.card}>
            <p style={{ ...S.cardTitle, marginBottom: 16 }}>Courier Breakdown — {selectedDate}</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 10 }}>
              {(summary.courier_summary || []).map((row) => (
                <div
                  key={row.courier_name}
                  onClick={() => handleCourierFilter(row.courier_name)}
                  style={{ cursor: "pointer", transition: "transform 0.1s" }}
                  onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.02)")}
                  onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
                >
                  <CourierPill name={row.courier_name} count={row.count} />
                  <div style={{ display: "flex", gap: 6, marginTop: 6, paddingLeft: 4 }}>
                    <span style={{ fontSize: 11, color: C.green, fontWeight: 600 }}>
                      Prepaid: {row.prepaid}
                    </span>
                    <span style={{ fontSize: 11, color: C.gray400 }}>·</span>
                    <span style={{ fontSize: 11, color: C.amber, fontWeight: 600 }}>
                      COD: {row.cod}
                    </span>
                    <span style={{ fontSize: 11, color: C.gray400 }}>·</span>
                    <span style={{ fontSize: 11, color: C.blue, fontWeight: 600 }}>
                      Items: {row.total_items}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            {courierFilter && (
              <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 12, color: C.gray500 }}>Filtered by courier:</span>
                <span style={{
                  ...courierStyle(courierFilter),
                  padding: "3px 12px", borderRadius: 20, fontSize: 12, fontWeight: 700,
                  background: courierStyle(courierFilter).bg, color: courierStyle(courierFilter).fg,
                  border: `1px solid ${courierStyle(courierFilter).border}`,
                }}>
                  {courierFilter}
                </span>
                <button
                  onClick={() => setCourierFilter("")}
                  style={{
                    padding: "3px 10px", borderRadius: 6, border: `1px solid ${C.gray300}`,
                    background: C.white, color: C.gray500, fontSize: 11, cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  ✕ Clear
                </button>
              </div>
            )}
          </div>

          {/* SKU summary table */}
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
                    <tr key={row.sku}
                      style={{ background: i % 2 === 0 ? C.white : C.gray50 }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#F0F7FF")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = i % 2 === 0 ? C.white : C.gray50)}
                    >
                      <td style={{ ...S.td, color: C.gray400, fontSize: 11, width: 36 }}>{i + 1}</td>
                      <td style={S.td}>
                        <span style={{
                          fontFamily: "monospace", fontSize: 12, color: C.orange, fontWeight: 700,
                          background: C.orangeLight, padding: "2px 8px", borderRadius: 6,
                        }}>{row.sku || "—"}</span>
                      </td>
                      <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 700, fontSize: 16 }}>
                        {row.count}
                      </td>
                      <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", color: C.blue, fontWeight: 600 }}>
                        {row.total_items}
                      </td>
                    </tr>
                  ))}
                  {(summary.sku_summary || []).length === 0 && (
                    <tr><td colSpan={4} style={{ ...S.td, textAlign: "center", color: C.gray400, padding: 24 }}>No data</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Orders table */}
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
                        {[
                          "Order ID", "Customer", "City / State",
                          "Courier", "AWB", "Payment",
                          "SKU", "Qty", "Order Date",
                        ].map((h) => (
                          <th key={h} style={{ ...S.th, whiteSpace: "nowrap" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((r, i) => {
                        const cs = courierStyle(r.courier_name);
                        const rowBg = i % 2 === 0 ? C.white : C.gray50;
                        return (
                          <tr key={r.order_id}
                            style={{ background: rowBg }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = "#F0F7FF")}
                            onMouseLeave={(e) => (e.currentTarget.style.background = rowBg)}
                          >
                            {/* Order ID */}
                            <td style={{ ...S.td, fontFamily: "monospace", fontSize: 11, color: C.gray400 }}>
                              …{r.order_id.slice(-14)}
                            </td>

                            {/* Customer */}
                            <td style={{ ...S.td, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              <span style={{ fontWeight: 600, color: C.gray700 }}>{r.customer_name || "—"}</span>
                            </td>

                            {/* City / State */}
                            <td style={{ ...S.td, whiteSpace: "nowrap" }}>
                              <span style={{ color: C.gray600 }}>{r.customer_city || "—"}</span>
                              {r.customer_state && (
                                <span style={{ color: C.gray400, fontSize: 11 }}>, {r.customer_state}</span>
                              )}
                            </td>

                            {/* Courier */}
                            <td style={S.td}>
                              <Tag bg={cs.bg} fg={cs.fg} border={cs.border}>
                                {r.courier_name || "—"}
                              </Tag>
                            </td>

                            {/* AWB */}
                            <td style={{ ...S.td, fontFamily: "monospace", fontSize: 11, color: C.gray500, whiteSpace: "nowrap" }}>
                              {r.awb_number || "—"}
                            </td>

                            {/* Payment */}
                            <td style={S.td}>
                              {r.payment_type === "Prepaid" ? (
                                <Tag bg={C.greenLight} fg={C.green} border={C.greenBorder}>Prepaid</Tag>
                              ) : r.payment_type === "COD" ? (
                                <Tag bg={C.amberLight} fg={C.amber} border="#FDE68A">COD</Tag>
                              ) : <span style={{ color: C.gray300 }}>—</span>}
                            </td>

                            {/* SKU */}
                            <td style={S.td}>
                              {r.sku ? (
                                <span style={{
                                  fontFamily: "monospace", fontSize: 11,
                                  color: C.orange, fontWeight: 600,
                                  background: C.orangeLight, padding: "2px 7px", borderRadius: 4,
                                }}>{r.sku}</span>
                              ) : <span style={{ color: C.gray300 }}>—</span>}
                            </td>

                            {/* Qty */}
                            <td style={{ ...S.td, textAlign: "center" }}>
                              {r.qty > 1 ? (
                                <Tag bg={C.amberLight} fg={C.amber} border="#FDE68A">×{r.qty}</Tag>
                              ) : (
                                <span style={{ color: C.gray400, fontSize: 12 }}>1</span>
                              )}
                            </td>

                            {/* Order Date */}
                            <td style={{ ...S.td, color: C.gray400, fontSize: 12, whiteSpace: "nowrap" }}>
                              {r.order_date || "—"}
                            </td>
                          </tr>
                        );
                      })}
                      {orders.length === 0 && (
                        <tr>
                          <td colSpan={9} style={{ ...S.td, textAlign: "center", padding: 40, color: C.gray400 }}>
                            No orders found
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <Pagination page={page} total={orderTotal} pageSize={50} onChange={setPage} />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
