import React,{ useState, useEffect, useMemo } from "react";
import { API, C, S, fmt, btn, Tag, Pagination } from "../../App";
import { PAGE_SIZE as pageSize } from "../../lib/helper";

const PAGE_SIZE = pageSize;

function fmtMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-IN", { month: "long", year: "numeric" });
}

function monthToRange(ym) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { date_from: `${ym}-01`, date_to: `${ym}-${String(last).padStart(2, "0")}` };
}

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

      <button style={pill(mode === "all")} onClick={() => { setMode("all"); onApply({}); }}>
        All Time
      </button>

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
        {months.map(m => <option key={m} value={m}>{fmtMonth(m)}</option>)}
      </select>

      <span style={{ color: C.gray300, fontSize: 18 }}>|</span>

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 12, color: C.gray500, fontWeight: 600 }}>Custom:</span>
        <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
          style={{ ...S.inp, width: 140, fontSize: 12, padding: "7px 10px" }} />
        <span style={{ color: C.gray400, fontSize: 13 }}>→</span>
        <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
          style={{ ...S.inp, width: 140, fontSize: 12, padding: "7px 10px" }} />
        <button
          disabled={!customFrom || !customTo}
          onClick={() => {
            if (!customFrom || !customTo) return;
            setMode("custom");
            onApply({ date_from: customFrom, date_to: customTo });
          }}
          style={{ ...btn(mode === "custom" ? "primary" : "ghost", "sm"), opacity: (!customFrom || !customTo) ? 0.45 : 1 }}
        >
          Apply
        </button>
      </div>
    </div>
  );
}

export function UnsettledOrdersTab({ initialMonth }) {
  const [months,  setMonths]  = useState([]);
  const [mode,    setMode]    = useState("all");
  const [selMonth, setSelMonth] = useState("");
  const [custFrom, setCustFrom] = useState("");
  const [custTo,   setCustTo]   = useState("");

  const [activeRange, setActiveRange] = useState(null); // null = waiting
  const [page,   setPage]   = useState(1);
  const [search, setSearch] = useState("");
  const [data,   setData]   = useState(null);
  const [loading, setLoading] = useState(true);

  // Load available months; use initialMonth if provided (e.g. navigated from Overview)
  useEffect(() => {
    fetch(`${API}/profit/available-months/`)
      .then(r => r.json())
      .then(ms => {
        setMonths(ms);
        const target = (initialMonth && ms.includes(initialMonth)) ? initialMonth : (ms[0] || null);
        if (target) {
          setMode("month");
          setSelMonth(target);
          setActiveRange(monthToRange(target));
        } else {
          setActiveRange({});
        }
      })
      .catch(() => setActiveRange({}));
  }, []); // eslint-disable-line

  // Reset to page 1 when filter or search changes
  useEffect(() => { setPage(1); }, [activeRange, search]);

  // Stable query key — prevents double fetch when page reset races activeRange change
  const queryKey = useMemo(
    () => activeRange === null ? null : JSON.stringify({ activeRange, page, search }),
    [activeRange, page, search]
  );

  useEffect(() => {
    if (queryKey === null) return;
    setLoading(true);
    const params = { ...activeRange, page, page_size: PAGE_SIZE };
    if (search) params.search = search;
    fetch(`${API}/orders/unsettled/?${new URLSearchParams(params)}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [queryKey]);

  const filterLabel =
    mode === "month"  ? fmtMonth(selMonth) :
    mode === "custom" ? `${custFrom} → ${custTo}` :
    "All Time";

  const STATUS_VARIANT = { DELIVERED: "green", RTO_COMPLETE: "red", CANCELLED: "gray" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: C.gray800, marginBottom: 4 }}>
            ⚠️ Unsettled Orders
          </h2>
          <p style={{ fontSize: 13, color: C.gray400 }}>
            Orders placed but not yet settled by Meesho — no payment record found.
          </p>
        </div>
      </div>

      {/* Filter bar */}
      <FilterBar
        mode={mode} setMode={setMode}
        selectedMonth={selMonth} setSelectedMonth={setSelMonth}
        months={months}
        customFrom={custFrom} setCustomFrom={setCustFrom}
        customTo={custTo} setCustomTo={setCustTo}
        onApply={range => setActiveRange(range)}
      />

      {/* Summary hero */}
      {data && !loading && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{
            ...S.card,
            background: "linear-gradient(135deg, #FEF2F2 0%, #FFFFFF 60%)",
            borderTop: `3px solid ${C.red}`,
          }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: C.gray400, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
              ⚠️ UNSETTLED ORDERS — {filterLabel.toUpperCase()}
            </p>
            <p style={{ fontSize: 48, fontWeight: 800, fontFamily: "'DM Mono', monospace", color: C.red, lineHeight: 1 }}>
              {data.total.toLocaleString()}
            </p>
            <p style={{ fontSize: 13, color: C.gray400, marginTop: 6 }}>orders with no payment record</p>
          </div>
          <div style={{ ...S.card, borderTop: `3px solid ${C.amber}` }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: C.gray400, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
              💸 AT-RISK ORDER VALUE
            </p>
            <p style={{ fontSize: 36, fontWeight: 800, fontFamily: "'DM Mono', monospace", color: C.amber, lineHeight: 1 }}>
              {fmt(data.total_value)}
            </p>
            <p style={{ fontSize: 13, color: C.gray400, marginTop: 6 }}>total discounted value of unsettled orders</p>
          </div>
        </div>
      )}

      {/* Table card */}
      <div style={S.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
          <p style={{ ...S.cardTitle, marginBottom: 0 }}>
            Unsettled Orders {data ? `— ${data.total.toLocaleString()} total` : ""}
          </p>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search order no, SKU, product…"
            style={{ ...S.inp, width: 240, fontSize: 12 }}
          />
        </div>

        {loading && (
          <div style={{ textAlign: "center", padding: 60, color: C.gray400 }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>⏳</div>
            Loading unsettled orders…
          </div>
        )}

        {!loading && data && (
          <>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    {["#", "Order Date", "Sub Order No", "SKU", "Product", "Size", "Qty", "Order Value", "Status", "State"].map(h => (
                      <th key={h} style={{ ...S.th, textAlign: h === "Order Value" || h === "Qty" ? "right" : "left" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.results.length === 0 && (
                    <tr>
                      <td colSpan={10} style={{ ...S.td, textAlign: "center", padding: 48, color: C.gray400 }}>
                        {search ? "No orders matching search" : "No unsettled orders for this period 🎉"}
                      </td>
                    </tr>
                  )}
                  {data.results.map((order, i) => {
                    const rowBg = i % 2 === 0 ? C.white : C.gray50;
                    const globalIdx = (page - 1) * PAGE_SIZE + i + 1;
                    return (
                      <tr key={order.sub_order_no} style={{ background: rowBg }}
                        onMouseEnter={e => (e.currentTarget.style.background = "#FFF8F0")}
                        onMouseLeave={e => (e.currentTarget.style.background = rowBg)}
                      >
                        <td style={{ ...S.td, color: C.gray400, fontSize: 11 }}>{globalIdx}</td>
                        <td style={{ ...S.td, whiteSpace: "nowrap", color: C.gray600, fontSize: 12 }}>{order.order_date}</td>
                        <td style={{ ...S.td }}>
                          <span style={{ fontFamily: "monospace", fontSize: 11, color: C.blue, fontWeight: 600, background: C.blueLight, padding: "2px 6px", borderRadius: 4 }}>
                            {order.sub_order_no}
                          </span>
                        </td>
                        <td style={{ ...S.td }}>
                          <span style={{ fontFamily: "monospace", fontSize: 12, color: C.orange, fontWeight: 600, background: C.orangeLight, padding: "2px 6px", borderRadius: 4 }}>
                            {order.sku}
                          </span>
                        </td>
                        <td style={{ ...S.td, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {order.product_name}
                        </td>
                        <td style={{ ...S.td }}>{order.size || "—"}</td>
                        <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 600 }}>{order.quantity}</td>
                        <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 600, color: C.amber }}>
                          {fmt(order.supplier_discounted_price)}
                        </td>
                        <td style={S.td}>
                          <Tag variant={STATUS_VARIANT[order.reason_for_credit_entry] || "gray"}>
                            {order.reason_for_credit_entry || "—"}
                          </Tag>
                        </td>
                        <td style={{ ...S.td, fontSize: 12, color: C.gray500 }}>{order.customer_state || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {data.total > PAGE_SIZE && (
              <Pagination page={page} total={data.total} pageSize={PAGE_SIZE} onChange={setPage} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
