import React, { useEffect, useRef, useState } from "react";
import { API, C, S, btn, Tag } from "../../App";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import SearchIcon from "@mui/icons-material/Search";
import { CircularProgress } from "@mui/material";

// ── constants ─────────────────────────────────────────────────────────────────

const STATUS_META = {
  DELIVERED: { label: "Delivered", bg: "#059669", light: "#D1FAE5", border: "#6EE7B7" },
  RETURN: { label: "Returned", bg: "#E11D48", light: "#FFF1F2", border: "#FECDD3" },
  RTO: { label: "RTO", bg: "#7C3AED", light: "#F5F3FF", border: "#DDD6FE" },
  EXCHANGE: { label: "Exchange", bg: "#2563EB", light: "#EFF6FF", border: "#BFDBFE" },
  CLAIM: { label: "Claim", bg: "#D97706", light: "#FFFBEB", border: "#FDE68A" },
  SHIPPED: { label: "Shipped", bg: "#64748B", light: "#F1F5F9", border: "#CBD5E1" },
  UNKNOWN: { label: "Unknown", bg: "#94A3B8", light: "#F8FAFC", border: "#E2E8F0" },
};

const ALL_STATUSES = ["DELIVERED", "RETURN", "RTO", "EXCHANGE", "CLAIM", "SHIPPED", "UNKNOWN"];
const PAGE_SIZE = 50;

const fmt2 = (n) =>
  n === null || n === undefined
    ? "—"
    : `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function fmtMonth(m) {
  if (!m) return "All time";
  const [y, mo] = m.split("-");
  return new Date(Number(y), Number(mo) - 1, 1)
    .toLocaleString("en-IN", { month: "short", year: "numeric" });
}

function StatusBadge({ status }) {
  const m = STATUS_META[status] || STATUS_META.UNKNOWN;
  return (
    <span style={{
      display: "inline-block", padding: "3px 10px", borderRadius: 20,
      background: m.light, color: m.bg, border: `1px solid ${m.border}`,
      fontWeight: 700, fontSize: 11, letterSpacing: "0.04em",
    }}>
      {m.label}
    </span>
  );
}

function SettlementAmt({ value }) {
  const n = Number(value || 0);
  return (
    <span style={{
      fontFamily: "monospace", fontWeight: 700, fontSize: 13,
      color: n < 0 ? C.red : n > 0 ? C.green : C.gray400,
    }}>
      {n >= 0 ? "+" : ""}{fmt2(n)}
    </span>
  );
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

function ExpandedRows({ rows }) {
  if (!rows || rows.length === 0) return (
    <tr><td colSpan={7} style={{ padding: "14px 24px", color: C.gray400, fontSize: 12, fontStyle: "italic" }}>No detail rows.</td></tr>
  );
  return rows.map((r, i) => {
    const status = (r.live_order_status || "").toUpperCase();
    const m = STATUS_META[status];
    return (
      <tr key={r.id ?? i} style={{ background: "#F0F9FF", borderBottom: `1px solid ${C.gray100}` }}>
        <td style={{ ...S.td, paddingLeft: 40, fontSize: 11, color: C.gray400, width: 32 }}>↳</td>
        <td style={{ ...S.td }}>
          {m
            ? <span style={{ fontSize: 11, fontWeight: 600, color: m.bg, background: m.light, padding: "2px 8px", borderRadius: 6, border: `1px solid ${m.border}` }}>{r.live_order_status || "—"}</span>
            : <span style={{ color: C.gray400, fontSize: 11 }}>{r.live_order_status || "—"}</span>}
        </td>
        <td style={{ ...S.td, color: C.gray500, fontSize: 11 }}>{r.payment_date || "—"}</td>
        <td style={{ ...S.td, fontFamily: "monospace", fontSize: 12, color: C.gray600 }}>{fmt2(r.total_sale_amount)}</td>
        <td style={{ ...S.td, fontFamily: "monospace", fontSize: 12 }}>
          <span style={{ color: Number(r.final_settlement_amount) < 0 ? C.red : C.green }}>
            {fmt2(r.final_settlement_amount)}
          </span>
        </td>
        <td style={{ ...S.td, fontFamily: "monospace", fontSize: 11, color: C.orange }}>{fmt2(r.meesho_commission_incl_gst)}</td>
        <td style={{ ...S.td }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {r.tcs ? <span style={{ fontSize: 10, color: C.gray400 }}>TCS {fmt2(r.tcs)}</span> : null}
            {r.tds ? <span style={{ fontSize: 10, color: C.gray400 }}>TDS {fmt2(r.tds)}</span> : null}
            {r.claims > 0 ? <span style={{ fontSize: 10, fontWeight: 700, color: "#D97706" }}>Claim {fmt2(r.claims)}</span> : null}
            {r.return_shipping_charge ? <span style={{ fontSize: 10, color: C.red }}>RetShip {fmt2(r.return_shipping_charge)}</span> : null}
          </div>
        </td>
      </tr>
    );
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
export function PaymentsTab() {
  const [months, setMonths] = useState([]);
  // All filter+pagination in ONE object — changes are atomic, no stale page issues
  const [query, setQuery] = useState({ month: null, status: "", search: "", page: 1 });

  const [groups, setGroups] = useState([]);
  const [total, setTotal] = useState(0);
  const [kpi, setKpi] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(new Set());

  // Abort controller ref — cancel in-flight requests when query changes
  const abortRef = useRef(null);

  // Load available months once, then set the initial month
  useEffect(() => {
    fetch(`${API}/profit/available-months/`)
      .then(r => r.json())
      .then(ms => {
        setMonths(ms || []);
        // Set initial month atomically — no separate page reset needed
        if (ms && ms.length > 0) {
          setQuery(q => ({ ...q, month: ms[0], page: 1 }));
        }
      })
      .catch(() => { });
  }, []);

  // Single effect — fires whenever query object changes (one render, one fetch)
  useEffect(() => {
    // Cancel previous in-flight request
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setExpanded(new Set()); // collapse rows on filter change

    const p = new URLSearchParams({ page: query.page, page_size: PAGE_SIZE });
    if (query.month) p.set("month", query.month);
    if (query.status) p.set("status", query.status);
    if (query.search) p.set("search", query.search)

    fetch(`${API}/orders/grouped/?${p}`, { signal: ctrl.signal })
      .then(r => r.json())
      .then(data => {
        let gs = data.groups || [];
        if (query.search.trim()) {
          const q = query.search.trim().toLowerCase();
          gs = gs.filter(g =>
            (g.sub_order_no || "").toLowerCase().includes(q) ||
            (g.sku || "").toLowerCase().includes(q) ||
            (g.product_name || "").toLowerCase().includes(q)
          );
        }
        setGroups(gs);
        setTotal(data.total || 0);
        setKpi(data.kpi || null);
      })
      .catch(err => { if (err.name !== "AbortError") console.error(err); })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });

    return () => ctrl.abort();
  }, [query]);

  // Helpers that reset page to 1 atomically when filter changes
  const setMonth = (m) => setQuery(q => ({ ...q, month: m, page: 1 }));
  const setStatus = (s) => setQuery(q => ({ ...q, status: s, page: 1 }));
  const setSearch = (s) => setQuery(q => ({ ...q, search: s, page: 1 }));
  const setPage = (p) => setQuery(q => ({ ...q, page: p }));

  const toggleExpand = (id) => setExpanded(prev => {
    const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s;
  });

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const byStatus = kpi?.by_status || [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── Header ── */}
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: C.gray800, margin: 0 }}>Payments</h1>
        <p style={{ color: C.gray400, fontSize: 13, margin: "4px 0 0" }}>
          Orders grouped by sub-order number · classified by effective outcome
        </p>
      </div>

      {/* ── Month selector ── */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button
          onClick={() => setMonth(null)}
          style={{ ...btn(query.month === null ? "primary" : "ghost", "sm"), borderRadius: 20, padding: "6px 14px", fontSize: 12 }}
        >
          All time
        </button>
        {months.map(m => (
          <button
            key={m}
            onClick={() => setMonth(m)}
            style={{ ...btn(query.month === m ? "primary" : "ghost", "sm"), borderRadius: 20, padding: "6px 14px", fontSize: 12 }}
          >
            {fmtMonth(m)}
          </button>
        ))}
      </div>

      {/* ── KPI cards ── */}
      {kpi && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <KpiCard
            label="Total Orders"
            value={kpi.total_groups}
            color={C.blue}
            sub={query.month ? fmtMonth(query.month) : "all time"}
          />
          <KpiCard
            label="Net Settlement"
            value={kpi.total_settlement}
            isAmount
            color={kpi.total_settlement >= 0 ? C.green : C.red}
            bg={kpi.total_settlement >= 0 ? "#ECFDF5" : "#FFF1F2"}
            sub="after deductions"
          />
          {byStatus.map(s => {
            const m = STATUS_META[s.status] || STATUS_META.UNKNOWN;
            return (
              <KpiCard
                key={s.status}
                label={m.label}
                value={s.count}
                color={m.bg}
                bg={m.light}
                sub={fmt2(s.settlement)}
              />
            );
          })}
        </div>
      )}

      {/* ── Filters row ── */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        {/* Status pills */}
        <button
          onClick={() => setStatus("")}
          style={{ ...btn(query.status === "" ? "primary" : "ghost", "sm"), borderRadius: 20, padding: "5px 14px", fontSize: 12 }}
        >
          All
        </button>
        {ALL_STATUSES.map(s => {
          const m = STATUS_META[s];
          const active = query.status === s;
          return (
            <button key={s} onClick={() => setStatus(s)} style={{
              padding: "5px 14px", borderRadius: 20, fontSize: 12,
              fontWeight: active ? 700 : 500, cursor: "pointer", fontFamily: "inherit",
              background: active ? m.bg : m.light, color: active ? "#fff" : m.bg,
              border: `1px solid ${active ? m.bg : m.border}`, transition: "all 0.15s",
            }}>
              {m.label}
            </button>
          );
        })}

        {/* Search */}
        <div style={{ position: "relative", marginLeft: "auto", minWidth: 220 }}>
          <SearchIcon style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 16, color: C.gray400 }} />
          <input
            value={query.search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Sub-order / SKU / product…"
            style={{ ...S.inp, paddingLeft: 32, fontSize: 12 }}
          />
        </div>
      </div>

      {/* ── Table ── */}
      <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 20px", borderBottom: `1px solid ${C.gray100}`, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontWeight: 700, fontSize: 13, color: C.gray800 }}>Order Groups</span>
          <span style={{ fontSize: 12, color: C.gray400, background: C.gray100, borderRadius: 10, padding: "2px 8px", fontWeight: 600 }}>
            {loading ? "…" : total.toLocaleString("en-IN")}
          </span>
          <span style={{ marginLeft: "auto", fontSize: 12, color: C.gray400 }}>
            {!loading && `Page ${query.page} / ${totalPages}`}
          </span>
        </div>

        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 60 }}>
            <CircularProgress style={{ color: C.orange }} />
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>
                  {["", "Sub-Order No", "Status", "SKU / Product", "Order Date", "Settlement", "Rows"].map(h => (
                    <th key={h} style={{ ...S.th, fontSize: 10, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.length === 0 ? (
                  <tr><td colSpan={7} style={{ ...S.td, textAlign: "center", padding: 56, color: C.gray400 }}>
                    No payment groups found for the selected filters.
                  </td></tr>
                ) : groups.map((g, idx) => {
                  const isOpen = expanded.has(g.sub_order_no);
                  const rowBg = idx % 2 === 0 ? C.white : C.gray50;
                  return (
                    <React.Fragment key={g.sub_order_no}>
                      <tr style={{ background: rowBg, borderBottom: isOpen ? "none" : `1px solid ${C.gray100}` }}>
                        {/* Expand toggle */}
                        <td style={{ ...S.td, width: 40, textAlign: "center" }}>
                          <button
                            onClick={() => toggleExpand(g.sub_order_no)}
                            style={{ background: "none", border: "none", cursor: "pointer", color: C.orange, padding: 4, display: "flex", alignItems: "center" }}
                          >
                            {isOpen ? <ExpandLessIcon style={{ fontSize: 18 }} /> : <ExpandMoreIcon style={{ fontSize: 18 }} />}
                          </button>
                        </td>
                        {/* Sub-order no */}
                        <td style={{ ...S.td }}>
                          <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 12, color: C.blue, background: "#EFF6FF", padding: "2px 7px", borderRadius: 5 }}>
                            {g.sub_order_no}
                          </span>
                        </td>
                        {/* Status */}
                        <td style={{ ...S.td }}><StatusBadge status={g.status} /></td>
                        {/* SKU + Product */}
                        <td style={{ ...S.td, maxWidth: 220 }}>
                          {g.sku && (
                            <span style={{ fontSize: 11, fontFamily: "monospace", color: C.orange, background: C.orangeLight, padding: "1px 6px", borderRadius: 4, display: "inline-block", marginBottom: 3 }}>
                              {g.sku}
                            </span>
                          )}
                          <div style={{ fontSize: 11, color: C.gray600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 210 }} title={g.product_name}>
                            {g.product_name || "—"}
                          </div>
                        </td>
                        {/* Order date */}
                        <td style={{ ...S.td, color: C.gray500, fontSize: 11, whiteSpace: "nowrap" }}>{g.order_date || "—"}</td>
                        {/* Settlement */}
                        <td style={{ ...S.td, textAlign: "right" }}><SettlementAmt value={g.settlement} /></td>
                        {/* Row count */}
                        <td style={{ ...S.td, textAlign: "center" }}>
                          <Tag variant={g.row_count > 1 ? "amber" : "gray"}>{g.row_count}</Tag>
                        </td>
                      </tr>

                      {/* Expanded rows */}
                      {isOpen && (
                        <>
                          <tr style={{ background: "#F0F9FF" }}>
                            <td colSpan={7} style={{ padding: 0 }}>
                              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                                <thead>
                                  <tr style={{ background: "#E0F2FE" }}>
                                    {["", "Status", "Payment Date", "Sale ₹", "Settlement ₹", "Commission", "Misc"].map(h => (
                                      <th key={h} style={{ ...S.th, fontSize: 10, padding: "6px 12px" }}>{h}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody><ExpandedRows rows={g.rows} /></tbody>
                              </table>
                            </td>
                          </tr>
                          <tr style={{ height: 4, background: C.gray100 }}><td colSpan={7} /></tr>
                        </>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {!loading && total > PAGE_SIZE && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 20px", borderTop: `1px solid ${C.gray100}` }}>
            <span style={{ fontSize: 12, color: C.gray400 }}>
              {Math.min((query.page - 1) * PAGE_SIZE + 1, total)}–{Math.min(query.page * PAGE_SIZE, total)} of {total.toLocaleString("en-IN")}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setPage(query.page - 1)} disabled={query.page === 1} style={{ ...btn("ghost", "sm"), opacity: query.page === 1 ? 0.4 : 1 }}>← Prev</button>
              <span style={{ fontSize: 12, color: C.gray500, alignSelf: "center", padding: "0 4px" }}>
                {query.page} / {totalPages}
              </span>
              <button onClick={() => setPage(query.page + 1)} disabled={query.page >= totalPages} style={{ ...btn("ghost", "sm"), opacity: query.page >= totalPages ? 0.4 : 1 }}>Next →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
