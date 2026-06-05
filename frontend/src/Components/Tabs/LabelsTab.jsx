import React,{ useCallback, useEffect, useRef, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from "recharts";
import { C, S, API, SectionHeader, Pagination, fmt } from "../../App";

const CHART_COLORS = [
  "#E8510A", "#F59E0B", "#10B981", "#3B82F6", "#8B5CF6",
  "#EC4899", "#06B6D4", "#84CC16", "#EF4444", "#6366F1",
];

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

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function offsetDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysDiff(iso) {
  return Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function downloadCroppedPDF(b64, fileName) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const blob  = new Blob([bytes], { type: "application/pdf" });
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement("a");
  a.href = url; a.download = `labels_only_${fileName.replace(/\.pdf$/i, "")}.pdf`;
  a.click(); URL.revokeObjectURL(url);
}

// ── Small shared Tag ─────────────────────────────────────────────────────────

function CTag({ children, bg, fg, border, fontSize = 11 }) {
  return (
    <span style={{ padding: "2px 9px", borderRadius: 20, fontSize, fontWeight: 600, background: bg, color: fg, border: `1px solid ${border}`, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

// ── KPI card (upload results) ────────────────────────────────────────────────

function KpiCard({ label, value, sub, accent, icon, highlight }) {
  return (
    <div style={{ ...S.card, borderTop: `3px solid ${accent}`, display: "flex", flexDirection: "column", gap: 6, background: highlight ? `${accent}0D` : C.white }}>
      <p style={{ fontSize: 11, fontWeight: 700, color: C.gray400, letterSpacing: "0.07em", textTransform: "uppercase" }}>{icon} {label}</p>
      <p style={{ fontSize: 26, fontWeight: 800, color: accent, fontFamily: "'DM Mono', monospace", lineHeight: 1.1 }}>{value}</p>
      {sub && <p style={{ fontSize: 11, color: C.gray400 }}>{sub}</p>}
    </div>
  );
}

// ── Drop zone ────────────────────────────────────────────────────────────────

function DropZone({ onFile, disabled }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const handle = (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) { alert("Please upload a PDF file."); return; }
    onFile(file);
  };
  return (
    <div
      onClick={() => !disabled && inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); if (!disabled) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); if (!disabled) handle(e.dataTransfer.files[0]); }}
      style={{ border: `2px dashed ${dragging ? C.orange : C.gray300}`, borderRadius: 14, padding: "40px 32px", textAlign: "center", cursor: disabled ? "not-allowed" : "pointer", background: dragging ? C.orangeLight : C.gray50, transition: "all 0.2s", opacity: disabled ? 0.6 : 1 }}
    >
      <div style={{ fontSize: 40, marginBottom: 10 }}>📄</div>
      <p style={{ fontSize: 14, fontWeight: 700, color: C.gray700, marginBottom: 5 }}>Drop Meesho Labels PDF here</p>
      <p style={{ fontSize: 12, color: C.gray400, marginBottom: 16 }}>One label per page — extracts SKU + Qty from Product Details table</p>
      <span style={{ display: "inline-block", padding: "8px 20px", borderRadius: 8, background: C.orange, color: C.white, fontWeight: 600, fontSize: 13 }}>Choose PDF file</span>
      <input ref={inputRef} type="file" accept=".pdf" style={{ display: "none" }} onChange={e => handle(e.target.files[0])} />
    </div>
  );
}

// ── Batch date picker ────────────────────────────────────────────────────────

function BatchDatePicker({ value, onChange }) {
  const today = todayISO();
  const diff  = daysDiff(value);
  const presets = [
    { label: "Today", date: today }, { label: "Yesterday", date: offsetDate(-1) },
    { label: "2 days ago", date: offsetDate(-2) }, { label: "3 days ago", date: offsetDate(-3) },
    { label: "1 week ago", date: offsetDate(-7) },
  ];
  return (
    <div style={{ ...S.card, padding: "14px 20px", borderLeft: `4px solid ${diff > 0 ? C.amber : C.green}`, background: diff > 0 ? "#FFFDF5" : C.greenLight }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 130 }}>
          <span style={{ fontSize: 16 }}>📅</span>
          <div>
            <p style={{ fontSize: 12, fontWeight: 700, color: C.gray700 }}>Batch Date</p>
            <p style={{ fontSize: 11, color: C.gray400 }}>Record labels under this date</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {presets.map(p => {
            const active = value === p.date;
            return (
              <button key={p.date} onClick={() => onChange(p.date)} style={{ padding: "5px 13px", borderRadius: 20, fontSize: 12, cursor: "pointer", fontFamily: "inherit", fontWeight: active ? 700 : 500, border: `1.5px solid ${active ? C.orange : C.gray300}`, background: active ? C.orangeLight : C.white, color: active ? C.orange : C.gray600 }}>
                {p.label}
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: C.gray400 }}>custom:</span>
          <input type="date" value={value} max={today} onChange={e => e.target.value && onChange(e.target.value)} style={{ ...S.inp, width: 145, fontSize: 12 }} />
        </div>
        <span style={{ marginLeft: "auto", padding: "4px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700, background: diff === 0 ? C.greenLight : C.amberLight, color: diff === 0 ? C.green : C.amber, border: `1px solid ${diff === 0 ? C.greenBorder : "#FDE68A"}` }}>
          {diff === 0 ? "✓ Today" : `↩ Back-dated ${diff}d`}
        </span>
      </div>
    </div>
  );
}

// ── Customer history drawer ──────────────────────────────────────────────────

function SummaryKpi({ label, value, sub, accent, icon }) {
  return (
    <div style={{ ...S.card, borderTop: `3px solid ${accent}`, display: "flex", flexDirection: "column", gap: 5 }}>
      <p style={{ fontSize: 10, fontWeight: 700, color: C.gray400, textTransform: "uppercase", letterSpacing: "0.07em" }}>{icon} {label}</p>
      <p style={{ fontSize: 22, fontWeight: 800, color: accent, fontFamily: "'DM Mono', monospace", lineHeight: 1 }}>{value}</p>
      {sub && <p style={{ fontSize: 11, color: C.gray400 }}>{sub}</p>}
    </div>
  );
}

function CustomerHistoryDrawer({ query, onClose }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  useEffect(() => {
    setLoading(true); setData(null); setError("");
    const params = new URLSearchParams();
    if (query.name)    params.set("name", query.name);
    if (query.pincode) params.set("pincode", query.pincode);
    fetch(`${API}/labels/customer-history/?${params}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => { setError("Failed to load history"); setLoading(false); });
  }, [query.name, query.pincode]);

  const s = data?.summary || {};

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", zIndex: 9000, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "min(820px, 96vw)", height: "100vh", background: C.white, overflowY: "auto", boxShadow: "-12px 0 48px rgba(0,0,0,0.18)", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "18px 24px 16px", borderBottom: `1px solid ${C.border}`, background: C.gray50, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, position: "sticky", top: 0, zIndex: 10 }}>
          <div>
            <h3 style={{ fontSize: 17, fontWeight: 800, color: C.gray800, marginBottom: 4 }}>👤 {query.name || `Pincode ${query.pincode}`}</h3>
            {data && <p style={{ fontSize: 12, color: C.gray400 }}>{[data.customer_city, data.customer_state, data.customer_pincode].filter(Boolean).join(", ")}</p>}
          </div>
          <button onClick={onClose} style={{ padding: "6px 14px", borderRadius: 8, border: `1px solid ${C.gray300}`, background: C.white, color: C.gray600, cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 500, flexShrink: 0 }}>
            ✕ Close
          </button>
        </div>

        <div style={{ padding: "20px 24px", flex: 1 }}>
          {loading && <div style={{ textAlign: "center", padding: 60, color: C.gray400 }}>Loading history…</div>}
          {error   && <div style={{ padding: 20, color: C.red, background: C.redLight, borderRadius: 8 }}>{error}</div>}
          {data && !loading && (
            <>
              {data.customer_address && (
                <div style={{ ...S.card, padding: "12px 16px", marginBottom: 18, background: C.blueLight, borderColor: "#BFDBFE" }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: C.blue, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>📍 Customer Address</p>
                  <p style={{ fontSize: 13, color: C.gray700, lineHeight: 1.6, whiteSpace: "pre-line" }}>{data.customer_address}</p>
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12, marginBottom: 20 }}>
                <SummaryKpi label="Total Orders"   value={s.total_orders}  accent={C.blue}   icon="📦" />
                <SummaryKpi label="Total Items"    value={s.total_items}   accent={C.orange} icon="🏷" />
                <SummaryKpi label="Delivered"      value={s.delivered}     accent={C.green}  icon="✅" sub={s.total_orders > 0 ? `${((s.delivered / s.total_orders) * 100).toFixed(0)}% rate` : ""} />
                <SummaryKpi label="RTO"            value={s.rto}           accent={C.red}    icon="↩" />
                <SummaryKpi label="Pending"        value={s.pending}       accent={s.pending > 0 ? C.amber : C.green} icon="⏳" />
                <SummaryKpi label="Net Settlement" value={fmt(s.total_settlement)} accent={s.total_settlement > 0 ? C.green : C.gray400} icon="💰" sub={`${s.settled_count} of ${s.total_orders} settled`} />
              </div>

              <p style={{ ...S.cardTitle, marginBottom: 12 }}>Order History — {s.total_orders} orders</p>
              <div style={{ overflowX: "auto", border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>{["Upload Date", "Order ID", "SKU", "Qty", "Courier", "Payment", "Delivery Status", "Settlement", "Settled Date"].map(h => (
                      <th key={h} style={{ ...S.th, fontSize: 10 }}>{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {(data.orders || []).map((r, i) => {
                      const dlStyle = DELIVERY_STATUS_STYLE[r.delivery_status] || { bg: C.gray100, fg: C.gray500, border: C.gray200 };
                      const rowBg   = i % 2 === 0 ? C.white : C.gray50;
                      return (
                        <tr key={r.order_id} style={{ background: rowBg }}
                          onMouseEnter={e => e.currentTarget.style.background = "#F0F7FF"}
                          onMouseLeave={e => e.currentTarget.style.background = rowBg}
                        >
                          <td style={{ ...S.td, fontSize: 12, color: C.gray500, whiteSpace: "nowrap" }}>{r.uploaded_date || "—"}</td>
                          <td style={{ ...S.td, fontFamily: "monospace", fontSize: 10, color: C.gray400 }}>…{String(r.order_id || "").slice(-12)}</td>
                          <td style={S.td}>{r.sku ? <span style={{ fontFamily: "monospace", fontSize: 11, color: C.orange, fontWeight: 600, background: C.orangeLight, padding: "2px 6px", borderRadius: 4 }}>{r.sku}</span> : <span style={{ color: C.gray300 }}>—</span>}</td>
                          <td style={{ ...S.td, textAlign: "center" }}>{r.qty > 1 ? <CTag bg={C.amberLight} fg={C.amber} border="#FDE68A">×{r.qty}</CTag> : <span style={{ color: C.gray400, fontSize: 12 }}>1</span>}</td>
                          <td style={S.td}>{r.courier_name ? <CTag bg={cs(r.courier_name).bg} fg={cs(r.courier_name).fg} border={cs(r.courier_name).border}>{r.courier_name}</CTag> : <span style={{ color: C.gray300 }}>—</span>}</td>
                          <td style={S.td}>{r.payment_type === "Prepaid" ? <CTag bg="#F0FDF4" fg="#16A34A" border="#BBF7D0">Prepaid</CTag> : r.payment_type === "COD" ? <CTag bg="#FFFBEB" fg="#D97706" border="#FDE68A">COD</CTag> : <span style={{ color: C.gray300 }}>—</span>}</td>
                          <td style={S.td}>{r.delivery_status ? <CTag bg={dlStyle.bg} fg={dlStyle.fg} border={dlStyle.border}>{r.delivery_status}</CTag> : r.live_order_status ? <CTag bg={C.blueLight} fg={C.blue} border="#BFDBFE">{r.live_order_status}</CTag> : <CTag bg={C.gray100} fg={C.gray500} border={C.gray200}>Pending</CTag>}</td>
                          <td style={{ ...S.td, fontFamily: "monospace", fontWeight: r.is_settled ? 700 : 400, color: r.is_settled ? (r.settlement_amount >= 0 ? C.green : C.red) : C.gray300 }}>{r.is_settled ? fmt(r.settlement_amount) : "—"}</td>
                          <td style={{ ...S.td, fontSize: 11, color: C.gray400, whiteSpace: "nowrap" }}>{r.payment_date || "—"}</td>
                        </tr>
                      );
                    })}
                    {(!data.orders || data.orders.length === 0) && (
                      <tr><td colSpan={9} style={{ ...S.td, textAlign: "center", padding: 32, color: C.gray400 }}>No orders found</td></tr>
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

// ── Main merged LabelsTab ────────────────────────────────────────────────────

export function LabelsTab() {
  const today = todayISO();

  // Upload state
  const [uploadOpen,    setUploadOpen]    = useState(true);
  const [batchDate,     setBatchDate]     = useState(today);
  const [uploadResult,  setUploadResult]  = useState(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadError,   setUploadError]   = useState("");
  const [fileName,      setFileName]      = useState("");
  const [showPages,     setShowPages]     = useState(false);
  const [skuSearch,     setSkuSearch]     = useState("");

  // Date filter state
  const [availDates,  setAvailDates]  = useState([]);
  const [dateMode,    setDateMode]    = useState("all");
  const [selDate,     setSelDate]     = useState("");
  const [customFrom,  setCustomFrom]  = useState("");
  const [customTo,    setCustomTo]    = useState("");
  const [activeRange, setActiveRange] = useState(null); // null = not yet initialised

  // Repeat customers state
  const [repData,      setRepData]      = useState(null);
  const [repLoading,   setRepLoading]   = useState(false);
  const [repTab,       setRepTab]       = useState("name");
  const [historyQuery, setHistoryQuery] = useState(null);

  // All-orders section (lazy)
  const [ordersOpen,    setOrdersOpen]    = useState(false);
  const [summary,       setSummary]       = useState(null);
  const [orders,        setOrders]        = useState([]);
  const [orderTotal,    setOrderTotal]    = useState(0);
  const [ordersPage,    setOrdersPage]    = useState(1);
  const [courierFilter, setCourierFilter] = useState("");
  const [ordersLoading, setOrdersLoading] = useState(false);

  // ── Init: load available dates, default to latest ──────────────────────────
  useEffect(() => {
    fetch(`${API}/labels/summary/`)
      .then(r => r.json())
      .then(d => {
        const dates = d.available_dates || [];
        setAvailDates(dates);
        if (dates.length > 0) {
          setSelDate(dates[0]); setDateMode("single");
          setActiveRange({ date_from: dates[0], date_to: dates[0] });
        } else {
          setActiveRange({});
        }
      })
      .catch(() => setActiveRange({}));
  }, []);

  // ── Fetch repeat customers when activeRange changes ────────────────────────
  useEffect(() => {
    if (activeRange === null) return;
    setRepLoading(true); setRepData(null);
    const params = new URLSearchParams();
    if (activeRange.date_from) params.set("date_from", activeRange.date_from);
    if (activeRange.date_to)   params.set("date_to",   activeRange.date_to);
    fetch(`${API}/labels/duplicates/?${params}`)
      .then(r => r.json())
      .then(d => { setRepData(d); setRepLoading(false); })
      .catch(() => setRepLoading(false));
  }, [JSON.stringify(activeRange)]); // eslint-disable-line

  // ── Fetch all-orders section (only when expanded) ─────────────────────────
  const fetchOrders = useCallback(async (ar, pg, courier) => {
    setOrdersLoading(true);
    const params = new URLSearchParams({ page: pg, page_size: 50 });
    if (ar.date_from) params.set("date_from", ar.date_from);
    if (ar.date_to)   params.set("date_to",   ar.date_to);
    if (courier)      params.set("courier",   courier);
    try {
      const [sumRes, ordRes] = await Promise.all([
        fetch(`${API}/labels/summary/?${params}`).then(r => r.json()),
        fetch(`${API}/labels/orders/?${params}`).then(r => r.json()),
      ]);
      setSummary(sumRes);
      setOrders(ordRes.results || []);
      setOrderTotal(ordRes.total || 0);
    } catch {}
    setOrdersLoading(false);
  }, []);

  useEffect(() => {
    if (!ordersOpen || activeRange === null) return;
    fetchOrders(activeRange, ordersPage, courierFilter);
  }, [ordersOpen, JSON.stringify(activeRange), ordersPage, courierFilter, fetchOrders]); // eslint-disable-line

  // ── Date filter helpers ────────────────────────────────────────────────────
  const applyRange = (range) => {
    setActiveRange(range);
    setOrdersPage(1);
    setCourierFilter("");
    setSummary(null);
    setOrders([]);
  };

  // ── Upload handlers ────────────────────────────────────────────────────────
  const handleFile = async (file) => {
    setUploadLoading(true); setUploadError(""); setUploadResult(null);
    setFileName(file.name);
    const form = new FormData();
    form.append("file", file);
    form.append("upload_date", batchDate);
    try {
      const res  = await fetch(`${API}/labels/parse/`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok || data.error) {
        setUploadError(data.error || "Upload failed.");
      } else {
        setUploadResult(data);
        setAvailDates(prev => prev.includes(batchDate) ? prev : [batchDate, ...prev].sort().reverse());
        setActiveRange(ar => ar ? { ...ar } : {});  // re-trigger repeat customer fetch
      }
    } catch {
      setUploadError("Could not reach the server — is the backend running?");
    }
    setUploadLoading(false);
  };

  const resetUpload = () => {
    setUploadResult(null); setUploadError(""); setFileName("");
    setShowPages(false); setSkuSearch(""); setBatchDate(todayISO());
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const filteredSku  = (uploadResult?.sku_table || []).filter(r => !skuSearch || r.sku.toLowerCase().includes(skuSearch.toLowerCase()));
  const chartData    = (uploadResult?.sku_table || []).slice(0, 15).map(r => ({ sku: r.sku.length > 20 ? r.sku.slice(0, 18) + "…" : r.sku, fullSku: r.sku, count: r.count, totalQty: r.total_qty }));
  const highQtyCount = (uploadResult?.sku_table || []).reduce((s, r) => s + r.high_qty_orders, 0);
  const totalLabels  = uploadResult?.total_labels ?? 0;
  const totalPages   = uploadResult?.total_pages  ?? 0;

  const repTotal = repData ? (repTab === "name" ? repData.total_by_name : repData.total_by_location) : 0;
  const repRows  = repData ? (repTab === "name" ? repData.by_name : repData.by_location) : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      {historyQuery && <CustomerHistoryDrawer query={historyQuery} onClose={() => setHistoryQuery(null)} />}

      {/* Header */}
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: C.gray800, marginBottom: 4 }}>🏷 Labels</h2>
        <p style={{ fontSize: 13, color: C.gray400 }}>Upload Meesho label PDFs and track repeat customers.</p>
      </div>

      {/* ── UPLOAD SECTION ────────────────────────────────────────────────── */}
      <div style={S.card}>
        <div onClick={() => setUploadOpen(o => !o)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", marginBottom: uploadOpen ? 16 : 0 }}>
          <p style={{ ...S.cardTitle, marginBottom: 0 }}>
            📤 Upload New Labels PDF
            {uploadResult && <span style={{ marginLeft: 10, fontWeight: 400, color: C.green, textTransform: "none", letterSpacing: 0 }}>✓ {fileName}</span>}
          </p>
          <span style={{ fontSize: 12, color: C.gray400 }}>{uploadOpen ? "▲ Hide" : "▼ Show"}</span>
        </div>

        {uploadOpen && (
          <>
            {!uploadResult && !uploadLoading && (
              <>
                <BatchDatePicker value={batchDate} onChange={setBatchDate} />
                <div style={{ marginTop: 16 }}><DropZone onFile={handleFile} /></div>
              </>
            )}

            {uploadLoading && (
              <div style={{ textAlign: "center", padding: "48px 32px" }}>
                <div style={{ fontSize: 32, marginBottom: 10 }}>⚙️</div>
                <p style={{ fontSize: 14, fontWeight: 700, color: C.gray700 }}>Parsing labels…</p>
                <p style={{ fontSize: 12, color: C.gray400, marginTop: 4 }}>Extracting from <strong>{fileName}</strong></p>
              </div>
            )}

            {uploadError && (
              <div style={{ ...S.card, borderColor: C.redBorder, background: C.redLight, padding: "14px 18px", display: "flex", gap: 10, marginTop: 12 }}>
                <span style={{ fontSize: 18 }}>⚠️</span>
                <p style={{ fontSize: 13, color: C.red }}>{uploadError}</p>
              </div>
            )}

            {uploadResult && (
              <>
                {/* Badges + action buttons */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
                  <span style={{ background: C.greenLight, border: `1px solid ${C.greenBorder}`, color: C.green, padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600 }}>✓ {fileName}</span>
                  {(() => {
                    const diff = daysDiff(uploadResult.upload_date || batchDate);
                    return (
                      <span style={{ background: diff === 0 ? C.greenLight : C.amberLight, border: `1px solid ${diff === 0 ? C.greenBorder : "#FDE68A"}`, color: diff === 0 ? C.green : C.amber, padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600 }}>
                        📅 Saved as {uploadResult.upload_date || batchDate}{diff > 0 ? ` (${diff}d ago)` : " (today)"}
                      </span>
                    );
                  })()}
                  {highQtyCount > 0 && <span style={{ background: C.amberLight, border: "1px solid #FDE68A", color: C.amber, padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600 }}>⚠ {highQtyCount} label{highQtyCount > 1 ? "s" : ""} with Qty &gt; 1</span>}
                  <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                    {uploadResult.cropped_pdf_b64 && (
                      <button onClick={() => downloadCroppedPDF(uploadResult.cropped_pdf_b64, fileName)} style={{ padding: "7px 16px", borderRadius: 8, fontSize: 13, border: `1.5px solid ${C.green}`, background: C.greenLight, color: C.green, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>
                        ⬇ Download Cropped Labels
                      </button>
                    )}
                    <button onClick={resetUpload} style={{ padding: "7px 14px", borderRadius: 8, fontSize: 13, border: `1px solid ${C.gray300}`, background: C.white, color: C.gray600, cursor: "pointer", fontFamily: "inherit", fontWeight: 500 }}>
                      ↩ New Upload
                    </button>
                  </div>
                </div>

                {/* KPI cards */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 16 }}>
                  <KpiCard label="Total Pages"  value={uploadResult.total_pages}      sub="one label per page"   accent={C.blue}   icon="📄" />
                  <KpiCard label="Unique SKUs"  value={uploadResult.total_unique_skus} sub="distinct products"     accent={C.orange} icon="🏷" />
                  <KpiCard label="Labels Found" value={totalLabels}                    sub={`${((totalLabels / Math.max(totalPages, 1)) * 100).toFixed(0)}% coverage`} accent={totalLabels === totalPages ? C.green : C.amber} icon="✅" />
                  <KpiCard label="Multi-Qty"    value={highQtyCount}                   sub="qty > 1 orders"        accent={highQtyCount > 0 ? C.amber : C.green} icon={highQtyCount > 0 ? "⚠️" : "✓"} highlight={highQtyCount > 0} />
                </div>

                {/* Bar chart */}
                {chartData.length > 0 && (
                  <div style={{ background: C.gray50, borderRadius: 10, padding: "16px 16px 0", marginBottom: 16 }}>
                    <p style={{ ...S.cardTitle }}>SKU Distribution — Top {chartData.length}</p>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={chartData} margin={{ top: 4, right: 12, left: -8, bottom: 46 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.gray100} />
                        <XAxis dataKey="sku" tick={{ fill: C.gray500, fontSize: 10 }} axisLine={false} tickLine={false} angle={-40} textAnchor="end" interval={0} />
                        <YAxis allowDecimals={false} tick={{ fill: C.gray400, fontSize: 11 }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 8 }} cursor={{ fill: C.gray50 }}
                          formatter={(v, _n, props) => [`${v} labels (${props.payload.totalQty} items)`, props.payload.fullSku]}
                          labelFormatter={() => ""} />
                        <Bar dataKey="count" radius={[5, 5, 0, 0]}>
                          {chartData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* SKU table */}
                <div style={{ overflowX: "auto" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <p style={{ ...S.cardTitle, marginBottom: 0 }}>SKU Dispatch Count — {filteredSku.length} SKUs</p>
                    <input value={skuSearch} onChange={e => setSkuSearch(e.target.value)} placeholder="🔍 Search SKU…" style={{ ...S.inp, width: 180, fontSize: 12 }} />
                  </div>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>{[["#","left"],["SKU","left"],["Orders","right"],["Items","right"],["Max Qty","center"],["Multi-Qty","center"],["% Share","right"],["Bar","left"]].map(([h, a]) => (
                        <th key={h} style={{ ...S.th, textAlign: a }}>{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody>
                      {filteredSku.map((row, i) => {
                        const pct   = totalLabels > 0 ? (row.count / totalLabels) * 100 : 0;
                        const isHQ  = row.max_qty > 1;
                        const rowBg = isHQ ? (i % 2 === 0 ? "#FFFBEB" : "#FEF3C7") : (i % 2 === 0 ? C.white : C.gray50);
                        return (
                          <tr key={row.sku} style={{ background: rowBg }}
                            onMouseEnter={e => e.currentTarget.style.background = isHQ ? "#FDE68A55" : "#F0F7FF"}
                            onMouseLeave={e => e.currentTarget.style.background = rowBg}
                          >
                            <td style={{ ...S.td, color: C.gray400, fontSize: 11, width: 36 }}>{i + 1}</td>
                            <td style={S.td}>
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                {isHQ && <span title="Multi-qty orders">⚠️</span>}
                                <span style={{ fontFamily: "monospace", fontSize: 12, color: C.orange, fontWeight: 700, background: C.orangeLight, padding: "3px 9px", borderRadius: 6 }}>{row.sku}</span>
                              </div>
                            </td>
                            <td style={{ ...S.td, textAlign: "right" }}><span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 20, color: C.gray800 }}>{row.count}</span></td>
                            <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 600, color: C.blue }}>{row.total_qty}</td>
                            <td style={{ ...S.td, textAlign: "center" }}>
                              <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 700, background: row.max_qty > 1 ? C.amberLight : C.gray100, color: row.max_qty > 1 ? C.amber : C.gray500, border: `1px solid ${row.max_qty > 1 ? "#FDE68A" : C.gray200}` }}>× {row.max_qty}</span>
                            </td>
                            <td style={{ ...S.td, textAlign: "center" }}>
                              {row.high_qty_orders > 0 ? <span style={{ background: C.amberLight, color: C.amber, border: "1px solid #FDE68A", padding: "2px 10px", borderRadius: 20, fontSize: 12, fontWeight: 700 }}>{row.high_qty_orders}</span> : <span style={{ color: C.gray300 }}>—</span>}
                            </td>
                            <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", color: C.gray500, fontSize: 12 }}>{pct.toFixed(1)}%</td>
                            <td style={{ ...S.td, minWidth: 80 }}>
                              <div style={{ height: 8, background: C.gray100, borderRadius: 4, overflow: "hidden" }}>
                                <div style={{ width: `${pct}%`, height: "100%", borderRadius: 4, background: isHQ ? "linear-gradient(90deg,#D97706,#F59E0B)" : "linear-gradient(90deg,#E8510A,#F59E0B)" }} />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {filteredSku.length > 0 && (
                        <tr style={{ background: C.gray50, borderTop: `2px solid ${C.border}` }}>
                          <td colSpan={2} style={{ ...S.td, fontWeight: 700, color: C.gray700 }}>Total</td>
                          <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 800, fontSize: 18, color: C.orange }}>{filteredSku.reduce((s, r) => s + r.count, 0)}</td>
                          <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: C.blue }}>{filteredSku.reduce((s, r) => s + r.total_qty, 0)}</td>
                          <td colSpan={4} style={S.td} />
                        </tr>
                      )}
                      {filteredSku.length === 0 && (
                        <tr><td colSpan={8} style={{ ...S.td, textAlign: "center", padding: 40, color: C.gray400 }}>{skuSearch ? `No SKU matching "${skuSearch}"` : "No SKUs extracted"}</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Per-page detail */}
                <div style={{ marginTop: 14, borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", cursor: "pointer" }} onClick={() => setShowPages(o => !o)}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: C.gray500 }}>Per-page detail — {uploadResult.page_details.length} pages</span>
                    <span style={{ fontSize: 12, color: C.gray400 }}>{showPages ? "▲ Hide" : "▼ Show"}</span>
                  </div>
                  {showPages && (
                    <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden", marginTop: 10 }}>
                      {uploadResult.page_details.map(d => (
                        <div key={d.page} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 14px", borderBottom: `1px solid ${C.gray100}` }}>
                          <span style={{ fontSize: 11, color: C.gray400, fontFamily: "monospace", minWidth: 48 }}>pg {d.page}</span>
                          {d.sku ? <span style={{ background: C.orangeLight, color: C.orange, border: `1px solid ${C.orangeBorder}`, padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 600, fontFamily: "monospace" }}>{d.sku}</span> : <span style={{ fontSize: 12, color: C.gray400 }}>No SKU</span>}
                          {d.qty > 1 && <span style={{ background: C.amberLight, color: C.amber, border: "1px solid #FDE68A", padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700 }}>Qty: {d.qty}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* ── DATE FILTER ───────────────────────────────────────────────────── */}
      <div style={{ ...S.card, padding: "14px 20px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.gray500, textTransform: "uppercase", letterSpacing: "0.06em", marginRight: 4 }}>📅 Filter</span>

        <button onClick={() => { setDateMode("all"); applyRange({}); }}
          style={{ padding: "5px 14px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12, fontWeight: dateMode === "all" ? 700 : 500, fontFamily: "inherit", background: dateMode === "all" ? C.orange : C.gray100, color: dateMode === "all" ? C.white : C.gray600 }}>
          All Time
        </button>

        {availDates.slice(0, 7).map(d => (
          <button key={d} onClick={() => { setSelDate(d); setDateMode("single"); applyRange({ date_from: d, date_to: d }); }}
            style={{ padding: "4px 12px", borderRadius: 20, fontSize: 11, cursor: "pointer", fontFamily: "inherit", fontWeight: dateMode === "single" && selDate === d ? 700 : 500, border: `1.5px solid ${dateMode === "single" && selDate === d ? C.orange : C.gray300}`, background: dateMode === "single" && selDate === d ? C.orangeLight : C.white, color: dateMode === "single" && selDate === d ? C.orange : C.gray600 }}>
            {d}
          </button>
        ))}

        <span style={{ color: C.gray300, fontSize: 18 }}>|</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12, color: C.gray500, fontWeight: 600 }}>Range:</span>
          <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} style={{ ...S.inp, width: 140, fontSize: 12, padding: "7px 10px" }} />
          <span style={{ color: C.gray400, fontSize: 13 }}>→</span>
          <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} style={{ ...S.inp, width: 140, fontSize: 12, padding: "7px 10px" }} />
          <button
            disabled={!customFrom || !customTo}
            onClick={() => { if (!customFrom || !customTo) return; setDateMode("custom"); applyRange({ date_from: customFrom, date_to: customTo }); }}
            style={{ padding: "6px 14px", borderRadius: 8, fontSize: 12, cursor: (!customFrom || !customTo) ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 600, background: dateMode === "custom" ? C.orange : C.gray100, color: dateMode === "custom" ? C.white : C.gray600, border: "none", opacity: (!customFrom || !customTo) ? 0.5 : 1 }}>
            Apply
          </button>
        </div>
      </div>

      {/* ── REPEAT CUSTOMERS (auto-loads with date filter) ─────────────────── */}
      <div style={{ ...S.card, borderLeft: `4px solid ${C.amber}`, background: "#FFFDF5" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 16 }}>⚠️</span>
            <h3 style={{ fontSize: 14, fontWeight: 800, color: C.gray800 }}>Repeat Customers</h3>
            {repData && <span style={{ background: C.amberLight, color: C.amber, border: "1px solid #FDE68A", padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700 }}>{repTotal} found</span>}
          </div>
          <div style={{ display: "flex", gap: 4, background: C.gray100, borderRadius: 8, padding: 3 }}>
            {[{ id: "name", label: `By Name${repData ? ` (${repData.total_by_name})` : ""}` }, { id: "location", label: `By Location${repData ? ` (${repData.total_by_location})` : ""}` }].map(t => (
              <button key={t.id} onClick={() => setRepTab(t.id)} style={{ padding: "5px 14px", borderRadius: 6, fontSize: 12, cursor: "pointer", fontFamily: "inherit", fontWeight: repTab === t.id ? 700 : 500, border: "none", background: repTab === t.id ? C.white : "transparent", color: repTab === t.id ? C.gray800 : C.gray500, boxShadow: repTab === t.id ? "0 1px 3px rgba(0,0,0,0.1)" : "none" }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {repLoading && <div style={{ textAlign: "center", padding: 40, color: C.gray400 }}>Loading repeat customers…</div>}

        {!repLoading && repData && repTotal === 0 && (
          <div style={{ textAlign: "center", padding: 40, color: C.gray400 }}>
            <p style={{ fontSize: 28, marginBottom: 8 }}>🎉</p>
            <p style={{ fontWeight: 600 }}>No repeat customers for this period</p>
          </div>
        )}

        {!repLoading && repRows.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {(repTab === "name"
                    ? ["Customer", "City / State", "Orders", "SKUs", "Date Range", "Action"]
                    : ["Pincode", "City / State", "Orders", "Names", "SKUs", "Action"]
                  ).map(h => <th key={h} style={{ ...S.th, fontSize: 10 }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {repRows.map((row, i) => {
                  const rowBg = i % 2 === 0 ? "#FFFDF5" : C.amberLight;
                  const key   = repTab === "name" ? row.customer_name : row.customer_pincode;
                  return (
                    <tr key={key} style={{ background: rowBg }}
                      onMouseEnter={e => e.currentTarget.style.background = "#FEF9C3"}
                      onMouseLeave={e => e.currentTarget.style.background = rowBg}
                    >
                      {repTab === "name" ? (
                        <>
                          <td style={{ ...S.td, fontWeight: 700, color: C.gray800 }}>{row.customer_name}</td>
                          <td style={{ ...S.td, fontSize: 12, color: C.gray500, whiteSpace: "nowrap" }}>{[row.customer_city, row.customer_state].filter(Boolean).join(", ") || "—"}</td>
                          <td style={S.td}>
                            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                              <span style={{ fontSize: 18, fontWeight: 800, fontFamily: "monospace", color: C.amber }}>{row.order_count}</span>
                              {row.period_count !== row.order_count && (
                                <span style={{ fontSize: 10, color: C.gray400 }}>{row.period_count} in period</span>
                              )}
                            </div>
                          </td>
                          <td style={S.td}>
                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                              {(row.skus || []).slice(0, 3).map(sku => <span key={sku} style={{ fontFamily: "monospace", fontSize: 10, color: C.orange, background: C.orangeLight, padding: "1px 6px", borderRadius: 4, fontWeight: 600 }}>{sku.length > 22 ? sku.slice(0, 20) + "…" : sku}</span>)}
                              {row.skus?.length > 3 && <span style={{ fontSize: 10, color: C.gray400 }}>+{row.skus.length - 3}</span>}
                            </div>
                          </td>
                          <td style={{ ...S.td, fontSize: 11, color: C.gray400, whiteSpace: "nowrap" }}>
                            {row.first_ordered === row.last_ordered ? row.first_ordered : `${row.first_ordered} → ${row.last_ordered}`}
                          </td>
                          <td style={S.td}>
                            <button onClick={() => setHistoryQuery({ name: row.customer_name, pincode: row.customer_pincode })}
                              style={{ padding: "5px 14px", borderRadius: 7, fontSize: 12, cursor: "pointer", border: `1.5px solid ${C.amber}`, background: C.amberLight, color: C.amber, fontFamily: "inherit", fontWeight: 600 }}>
                              View History →
                            </button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td style={{ ...S.td, fontFamily: "monospace", fontWeight: 700, color: C.gray700 }}>{row.customer_pincode}</td>
                          <td style={{ ...S.td, fontSize: 12, color: C.gray500, whiteSpace: "nowrap" }}>{[row.customer_city, row.customer_state].filter(Boolean).join(", ") || "—"}</td>
                          <td style={S.td}>
                            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                              <span style={{ fontSize: 18, fontWeight: 800, fontFamily: "monospace", color: C.amber }}>{row.order_count}</span>
                              {row.period_count !== row.order_count && (
                                <span style={{ fontSize: 10, color: C.gray400 }}>{row.period_count} in period</span>
                              )}
                            </div>
                          </td>
                          <td style={S.td}>
                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                              {(row.customer_names || []).slice(0, 3).map(n => <span key={n} style={{ fontSize: 11, color: C.gray700, background: C.gray100, padding: "1px 7px", borderRadius: 4, fontWeight: 500 }}>{n}</span>)}
                              {row.customer_names?.length > 3 && <span style={{ fontSize: 11, color: C.gray400 }}>+{row.customer_names.length - 3}</span>}
                            </div>
                          </td>
                          <td style={S.td}>
                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                              {(row.skus || []).slice(0, 2).map(sku => <span key={sku} style={{ fontFamily: "monospace", fontSize: 10, color: C.orange, background: C.orangeLight, padding: "1px 6px", borderRadius: 4, fontWeight: 600 }}>{sku.length > 20 ? sku.slice(0, 18) + "…" : sku}</span>)}
                            </div>
                          </td>
                          <td style={S.td}>
                            <button onClick={() => setHistoryQuery({ pincode: row.customer_pincode })}
                              style={{ padding: "5px 14px", borderRadius: 7, fontSize: 12, cursor: "pointer", border: `1.5px solid ${C.amber}`, background: C.amberLight, color: C.amber, fontFamily: "inherit", fontWeight: 600 }}>
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
        )}
      </div>

      {/* ── ALL ORDERS — lazy, only loads on click ────────────────────────── */}
      <div style={S.card}>
        <div onClick={() => setOrdersOpen(o => !o)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
          <p style={{ ...S.cardTitle, marginBottom: 0 }}>
            📋 All Orders
            {summary && ordersOpen && <span style={{ marginLeft: 8, fontWeight: 400, color: C.gray500, textTransform: "none", letterSpacing: 0 }}>— {summary.total} orders</span>}
          </p>
          <span style={{ fontSize: 12, color: C.orange, fontWeight: 600 }}>
            {ordersOpen ? "▲ Hide" : "▼ Show All Orders"}
          </span>
        </div>

        {ordersOpen && (
          <div style={{ marginTop: 16 }}>
            {ordersLoading && !summary && <div style={{ textAlign: "center", padding: 40, color: C.gray400 }}>Loading orders…</div>}

            {!ordersLoading && summary && summary.total === 0 && (
              <div style={{ textAlign: "center", padding: 40, color: C.gray400 }}>
                <p style={{ fontSize: 28, marginBottom: 8 }}>📭</p>
                <p style={{ fontWeight: 600 }}>No orders for this period</p>
              </div>
            )}

            {summary && summary.total > 0 && (
              <>
                {/* Courier breakdown */}
                <p style={{ ...S.cardTitle, marginBottom: 12 }}>Courier Breakdown</p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10, marginBottom: 20 }}>
                  {(summary.courier_summary || []).map(row => {
                    const active = courierFilter === row.courier_name;
                    const style  = cs(row.courier_name);
                    return (
                      <div key={row.courier_name}
                        onClick={() => setCourierFilter(active ? "" : row.courier_name)}
                        style={{ padding: "10px 16px", borderRadius: 10, cursor: "pointer", background: active ? style.bg : C.white, border: `${active ? 2 : 1}px solid ${active ? style.fg : style.border}` }}
                        onMouseEnter={e => { if (!active) e.currentTarget.style.background = style.bg; }}
                        onMouseLeave={e => { if (!active) e.currentTarget.style.background = C.white; }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ fontWeight: 700, color: style.fg, fontSize: 13 }}>{row.courier_name || "Unknown"}</span>
                          <span style={{ fontSize: 22, fontWeight: 800, color: style.fg, fontFamily: "'DM Mono', monospace" }}>{row.count}</span>
                        </div>
                        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                          <span style={{ fontSize: 11, color: C.green, fontWeight: 600 }}>✓ {row.prepaid}</span>
                          <span style={{ fontSize: 11, color: C.amber, fontWeight: 600 }}>₹ {row.cod}</span>
                          <span style={{ fontSize: 11, color: C.blue, fontWeight: 600 }}>×{row.total_items}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Orders table */}
                <SectionHeader title={`Orders${courierFilter ? ` — ${courierFilter}` : ""}`} count={orderTotal} />
                {ordersLoading ? (
                  <div style={{ textAlign: "center", padding: 32, color: C.gray400 }}>Loading…</div>
                ) : (
                  <>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr>{["Order ID", "Customer", "City / State", "Courier", "AWB", "Payment", "SKU", "Qty", "Upload Date"].map(h => (
                            <th key={h} style={{ ...S.th, whiteSpace: "nowrap" }}>{h}</th>
                          ))}</tr>
                        </thead>
                        <tbody>
                          {orders.map((r, i) => {
                            const style = cs(r.courier_name);
                            const rowBg = i % 2 === 0 ? C.white : C.gray50;
                            return (
                              <tr key={r.order_id} style={{ background: rowBg, cursor: "pointer" }}
                                onClick={() => setHistoryQuery({ name: r.customer_name, pincode: r.customer_pincode })}
                                onMouseEnter={e => e.currentTarget.style.background = "#F0F7FF"}
                                onMouseLeave={e => e.currentTarget.style.background = rowBg}
                              >
                                <td style={{ ...S.td, fontFamily: "monospace", fontSize: 11, color: C.gray400 }}>…{r.order_id.slice(-14)}</td>
                                <td style={{ ...S.td, maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600, color: C.gray700 }}>{r.customer_name || "—"}</td>
                                <td style={{ ...S.td, whiteSpace: "nowrap", fontSize: 12 }}>
                                  <span style={{ color: C.gray600 }}>{r.customer_city || "—"}</span>
                                  {r.customer_state && <span style={{ color: C.gray400 }}>, {r.customer_state}</span>}
                                </td>
                                <td style={S.td}><CTag bg={style.bg} fg={style.fg} border={style.border}>{r.courier_name || "—"}</CTag></td>
                                <td style={{ ...S.td, fontFamily: "monospace", fontSize: 11, color: C.gray500, whiteSpace: "nowrap" }}>{r.awb_number || "—"}</td>
                                <td style={S.td}>{r.payment_type === "Prepaid" ? <CTag bg="#F0FDF4" fg="#16A34A" border="#BBF7D0">Prepaid</CTag> : r.payment_type === "COD" ? <CTag bg="#FFFBEB" fg="#D97706" border="#FDE68A">COD</CTag> : <span style={{ color: C.gray300 }}>—</span>}</td>
                                <td style={S.td}>{r.sku ? <span style={{ fontFamily: "monospace", fontSize: 11, color: C.orange, fontWeight: 600, background: C.orangeLight, padding: "2px 7px", borderRadius: 4 }}>{r.sku}</span> : <span style={{ color: C.gray300 }}>—</span>}</td>
                                <td style={{ ...S.td, textAlign: "center" }}>{r.qty > 1 ? <CTag bg={C.amberLight} fg={C.amber} border="#FDE68A">×{r.qty}</CTag> : <span style={{ color: C.gray400, fontSize: 12 }}>1</span>}</td>
                                <td style={{ ...S.td, color: C.gray400, fontSize: 12, whiteSpace: "nowrap" }}>{r.uploaded_date || "—"}</td>
                              </tr>
                            );
                          })}
                          {orders.length === 0 && (
                            <tr><td colSpan={9} style={{ ...S.td, textAlign: "center", padding: 40, color: C.gray400 }}>No orders found</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    {orderTotal > 50 && <Pagination page={ordersPage} total={orderTotal} pageSize={50} onChange={p => setOrdersPage(p)} />}
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
