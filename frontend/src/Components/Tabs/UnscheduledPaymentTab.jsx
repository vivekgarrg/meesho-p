import React, { useEffect, useRef, useState } from "react";
import { API, C, S, btn, Tag } from "../../App";
import SearchIcon from "@mui/icons-material/Search";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { CircularProgress } from "@mui/material";

// Unscheduled Payment = expected (not-yet-settled) payout for shipped orders.
// Gross estimate = order's discounted price; margin = expected − SKU cost.
// Surfaces low-margin products so they can be stopped before the money lands.

const PAGE_SIZE = 50;
const THRESHOLDS = [20, 30, 40, 50, 100];

const fmt2 = (n) =>
  n === null || n === undefined
    ? "—"
    : `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function fmtMonth(m) {
  if (!m) return "All time";
  const [y, mo] = m.split("-");
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleString("en-IN", { month: "short", year: "numeric" });
}

function KpiCard({ label, value, isAmount, color, bg, sub }) {
  return (
    <div style={{
      flex: "1 1 150px", padding: "14px 18px", borderRadius: 14,
      background: bg || C.white, border: `1.5px solid ${C.gray200}`,
      borderTop: `3px solid ${color || C.orange}`,
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.gray400, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: isAmount ? 17 : 24, fontWeight: 800, fontFamily: "monospace", color: color || C.gray800, lineHeight: 1.1 }}>
        {isAmount ? fmt2(value) : (value ?? 0).toLocaleString("en-IN")}
      </div>
      {sub && <div style={{ fontSize: 11, color: C.gray400, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

// Colour a per-unit margin by how close it is to the threshold.
function marginColor(marginPU, threshold) {
  if (marginPU === null || marginPU === undefined) return C.gray400;
  if (marginPU < 0) return C.red;
  const ratio = marginPU / (threshold || 50);
  if (ratio < 0.4) return C.red;
  if (ratio < 1) return "#D97706"; // amber
  return C.green;
}

function MarginAmt({ value, threshold }) {
  const color = marginColor(value, threshold);
  return (
    <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13, color }}>
      {value === null || value === undefined ? "—" : `${value >= 0 ? "+" : ""}${fmt2(value)}`}
    </span>
  );
}

// ── Low-margin products panel — the "which product to stop" view ──
function LowMarginProducts({ products, threshold }) {
  const flagged = products.filter((p) => p.is_low_margin);
  if (flagged.length === 0) {
    return (
      <div style={{ ...S.card, padding: "16px 20px", display: "flex", alignItems: "center", gap: 10, color: C.green }}>
        <span style={{ fontSize: 18 }}>✓</span>
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          No products below ₹{threshold}/unit margin in the shipped-order pipeline.
        </span>
      </div>
    );
  }
  return (
    <div style={{ ...S.card, padding: 0, overflow: "hidden", border: `1.5px solid #FECACA` }}>
      <div style={{ padding: "12px 20px", borderBottom: `1px solid ${C.gray100}`, background: "#FFF1F2", display: "flex", alignItems: "center", gap: 10 }}>
        <WarningAmberIcon style={{ color: C.red, fontSize: 20 }} />
        <span style={{ fontWeight: 800, fontSize: 14, color: C.red }}>
          Low-margin products to review ({flagged.length})
        </span>
        <span style={{ fontSize: 12, color: C.gray500 }}>
          avg margin below ₹{threshold}/unit on shipped-but-unpaid orders — candidates to stop
        </span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              {["SKU", "Product", "Orders", "Units", "Avg Margin / unit", "Expected Payout", "Est. Margin"].map((h) => (
                <th key={h} style={{ ...S.th, fontSize: 10, whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {flagged.map((p, i) => (
              <tr key={p.sku} style={{ background: i % 2 === 0 ? C.white : C.gray50, borderBottom: `1px solid ${C.gray100}` }}>
                <td style={{ ...S.td }}>
                  <span style={{ fontSize: 11, fontFamily: "monospace", color: C.orange, background: C.orangeLight, padding: "1px 6px", borderRadius: 4 }}>{p.sku}</span>
                </td>
                <td style={{ ...S.td, maxWidth: 260 }}>
                  <div style={{ fontSize: 11, color: C.gray600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 250 }} title={p.product_name}>
                    {p.product_name || "—"}
                  </div>
                </td>
                <td style={{ ...S.td, textAlign: "center" }}><Tag variant="amber">{p.order_count}</Tag></td>
                <td style={{ ...S.td, textAlign: "center", fontFamily: "monospace" }}>{p.total_quantity}</td>
                <td style={{ ...S.td, textAlign: "right" }}><MarginAmt value={p.avg_margin_per_unit} threshold={threshold} /></td>
                <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", color: C.gray600 }}>{fmt2(p.total_expected)}</td>
                <td style={{ ...S.td, textAlign: "right" }}><MarginAmt value={p.total_margin} threshold={threshold} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main ──
export function UnscheduledPaymentTab() {
  const [months, setMonths] = useState([]);
  const [query, setQuery] = useState({ month: null, search: "", threshold: 50, page: 1 });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef(null);

  useEffect(() => {
    fetch(`${API}/profit/available-months/`)
      .then((r) => r.json())
      .then((ms) => setMonths(ms || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);

    const p = new URLSearchParams({ page: query.page, page_size: PAGE_SIZE, threshold: query.threshold });
    if (query.month) p.set("month", query.month);
    if (query.search) p.set("search", query.search);

    fetch(`${API}/orders/unscheduled/?${p}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch((err) => { if (err.name !== "AbortError") console.error(err); })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });

    return () => ctrl.abort();
  }, [query]);

  const setMonth = (m) => setQuery((q) => ({ ...q, month: m, page: 1 }));
  const setSearch = (s) => setQuery((q) => ({ ...q, search: s, page: 1 }));
  const setThreshold = (t) => setQuery((q) => ({ ...q, threshold: t, page: 1 }));
  const setPage = (p) => setQuery((q) => ({ ...q, page: p }));

  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = data?.results || [];
  const products = data?.by_product || [];
  const threshold = query.threshold;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: C.gray800, margin: 0 }}>Unscheduled Payment</h1>
        <p style={{ color: C.gray400, fontSize: 13, margin: "4px 0 0" }}>
          Expected payout for shipped orders whose settlement hasn't landed yet · gross estimate vs SKU cost to flag low-margin products
        </p>
      </div>

      {/* Month pills */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={() => setMonth(null)} style={{ ...btn(query.month === null ? "primary" : "ghost", "sm"), borderRadius: 20, padding: "6px 14px", fontSize: 12 }}>All time</button>
        {months.map((m) => (
          <button key={m} onClick={() => setMonth(m)} style={{ ...btn(query.month === m ? "primary" : "ghost", "sm"), borderRadius: 20, padding: "6px 14px", fontSize: 12 }}>
            {fmtMonth(m)}
          </button>
        ))}
      </div>

      {/* KPI cards */}
      {data && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <KpiCard label="Shipped / Awaiting Pay" value={data.total} color={C.blue} sub={query.month ? fmtMonth(query.month) : "all time"} />
          <KpiCard label="Expected Payout" value={data.total_expected} isAmount color={C.green} bg="#ECFDF5" sub="gross, before Meesho fees" />
          <KpiCard label="Low-Margin Products" value={data.low_product_count} color={C.red} bg="#FFF1F2" sub={`below ₹${threshold}/unit`} />
          <KpiCard label="At-Risk Margin" value={data.at_risk_margin} isAmount color={C.red} bg="#FFF1F2" sub="est. margin on flagged products" />
        </div>
      )}

      {/* Threshold + search */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: C.gray500 }}>Flag margin below:</span>
        {THRESHOLDS.map((t) => (
          <button key={t} onClick={() => setThreshold(t)} style={{ ...btn(threshold === t ? "primary" : "ghost", "sm"), borderRadius: 20, padding: "5px 14px", fontSize: 12 }}>
            ₹{t}
          </button>
        ))}
        <div style={{ position: "relative", marginLeft: "auto", minWidth: 220 }}>
          <SearchIcon style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 16, color: C.gray400 }} />
          <input value={query.search} onChange={(e) => setSearch(e.target.value)} placeholder="Sub-order / SKU / product…" style={{ ...S.inp, paddingLeft: 32, fontSize: 12 }} />
        </div>
      </div>

      {/* Low-margin products panel */}
      {data && !loading && <LowMarginProducts products={products} threshold={threshold} />}

      {/* Orders table */}
      <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 20px", borderBottom: `1px solid ${C.gray100}`, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontWeight: 700, fontSize: 13, color: C.gray800 }}>Shipped Orders — expected payments</span>
          <span style={{ fontSize: 12, color: C.gray400, background: C.gray100, borderRadius: 10, padding: "2px 8px", fontWeight: 600 }}>
            {loading ? "…" : total.toLocaleString("en-IN")}
          </span>
          <span style={{ marginLeft: "auto", fontSize: 12, color: C.gray400 }}>{!loading && `Page ${query.page} / ${totalPages}`}</span>
        </div>

        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><CircularProgress style={{ color: C.orange }} /></div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>
                  {["Sub-Order No", "SKU / Product", "Order Date", "Qty", "Expected Payout", "Cost", "Est. Margin / unit"].map((h) => (
                    <th key={h} style={{ ...S.th, fontSize: 10, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={7} style={{ ...S.td, textAlign: "center", padding: 56, color: C.gray400 }}>No shipped orders awaiting payment for the selected filters.</td></tr>
                ) : rows.map((r, idx) => {
                  const low = r.is_low_margin;
                  const rowBg = low ? "#FFF5F5" : (idx % 2 === 0 ? C.white : C.gray50);
                  return (
                    <tr key={r.sub_order_no} style={{ background: rowBg, borderBottom: `1px solid ${C.gray100}` }}>
                      <td style={{ ...S.td }}>
                        <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 12, color: C.blue, background: "#EFF6FF", padding: "2px 7px", borderRadius: 5 }}>{r.sub_order_no}</span>
                      </td>
                      <td style={{ ...S.td, maxWidth: 240 }}>
                        {r.sku && <span style={{ fontSize: 11, fontFamily: "monospace", color: C.orange, background: C.orangeLight, padding: "1px 6px", borderRadius: 4, display: "inline-block", marginBottom: 3 }}>{r.sku}</span>}
                        <div style={{ fontSize: 11, color: C.gray600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 230 }} title={r.product_name}>{r.product_name || "—"}</div>
                      </td>
                      <td style={{ ...S.td, color: C.gray500, fontSize: 11, whiteSpace: "nowrap" }}>{r.order_date || "—"}</td>
                      <td style={{ ...S.td, textAlign: "center", fontFamily: "monospace" }}>{r.quantity}</td>
                      <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", color: C.gray700 }}>{fmt2(r.expected_payout)}</td>
                      <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", color: r.has_cost ? C.gray500 : C.gray300 }}>
                        {r.has_cost ? fmt2(r.cost) : "no price"}
                      </td>
                      <td style={{ ...S.td, textAlign: "right" }}>
                        <MarginAmt value={r.est_margin_per_unit} threshold={threshold} />
                        {low && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: C.red, background: "#FFF1F2", border: "1px solid #FECDD3", borderRadius: 4, padding: "1px 5px" }}>LOW</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && total > PAGE_SIZE && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 20px", borderTop: `1px solid ${C.gray100}` }}>
            <span style={{ fontSize: 12, color: C.gray400 }}>
              {Math.min((query.page - 1) * PAGE_SIZE + 1, total)}–{Math.min(query.page * PAGE_SIZE, total)} of {total.toLocaleString("en-IN")}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setPage(query.page - 1)} disabled={query.page === 1} style={{ ...btn("ghost", "sm"), opacity: query.page === 1 ? 0.4 : 1 }}>← Prev</button>
              <span style={{ fontSize: 12, color: C.gray500, alignSelf: "center", padding: "0 4px" }}>{query.page} / {totalPages}</span>
              <button onClick={() => setPage(query.page + 1)} disabled={query.page >= totalPages} style={{ ...btn("ghost", "sm"), opacity: query.page >= totalPages ? 0.4 : 1 }}>Next →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
