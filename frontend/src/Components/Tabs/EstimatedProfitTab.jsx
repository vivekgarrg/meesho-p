import React, { useEffect, useMemo, useState } from "react";
import CircularProgress from "@mui/material/CircularProgress";
import { BarChart } from "@mui/x-charts/BarChart";
import { PieChart } from "@mui/x-charts/PieChart";
import { API, C, fmt } from "../../App";

// ─────────────────────────────────────────────────────────────────────────────
// Design tokens — mirrors the app's card/label language (see OverviewTab)
// ─────────────────────────────────────────────────────────────────────────────
const T = {
  card: {
    background: "#fff",
    border: "1px solid #E2E8F0",
    borderRadius: 16,
    padding: "20px 22px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
  },
  label: { fontSize: 11, fontWeight: 700, color: "#94A3B8", letterSpacing: "0.07em", textTransform: "uppercase" },
  mono: { fontFamily: "monospace" },
};

// Status → color/icon, matching the palette OverviewTab already uses for the same statuses.
// Built lazily (not a module-level constant) — App.jsx imports this tab, and this tab
// imports `C` back from App.jsx, so `C` can still be mid-initialization at module-eval time.
function getStatusMeta() {
  return {
    Delivered:           { color: C.green,  icon: "✅" },
    Returned:             { color: C.red,    icon: "↩" },
    RTO:                  { color: C.amber,  icon: "🔄" },
    Exchanged:             { color: C.blue,   icon: "🔁" },
    Claim:                 { color: "#7C3AED", icon: "⚠" },
    "Other / Cancelled":   { color: C.gray400, icon: "⊘" },
  };
}

function SectionCard({ title, subtitle, children, style }) {
  return (
    <div style={{ ...T.card, ...style }}>
      {title && <p style={{ ...T.label, marginBottom: subtitle ? 4 : 14 }}>{title}</p>}
      {subtitle && <p style={{ fontSize: 11, color: C.gray400, marginBottom: 14 }}>{subtitle}</p>}
      {children}
    </div>
  );
}

function KPICard({ label, value, sub, color, accent }) {
  return (
    <div style={{
      ...T.card, borderTop: `3px solid ${accent || color || C.blue}`,
      flex: "1 1 170px", position: "relative", overflow: "hidden",
    }}>
      <p style={{ ...T.label, marginBottom: 6 }}>{label}</p>
      <p style={{ fontSize: 21, fontWeight: 800, ...T.mono, color: color || C.gray800, lineHeight: 1.1 }}>{value}</p>
      {sub && <p style={{ fontSize: 11, color: C.gray400, marginTop: 5 }}>{sub}</p>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Upload dropzone
// ─────────────────────────────────────────────────────────────────────────────
function UploadZone({ loading, error, onFile, hasResult }) {
  const [dragging, setDragging] = useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); onFile(e.dataTransfer.files[0]); }}
      style={{
        border: `2px dashed ${dragging ? C.orange : "#CBD5E1"}`,
        borderRadius: 16, padding: hasResult ? "18px 22px" : "36px 24px",
        textAlign: "center", background: dragging ? C.orangeLight : "#F8FAFC",
        transition: "all 0.15s",
      }}
    >
      {!hasResult && <p style={{ fontSize: 38, marginBottom: 8 }}>📄</p>}
      <p style={{ fontSize: hasResult ? 13 : 15, fontWeight: 700, color: C.gray800, marginBottom: 4 }}>
        {hasResult ? "Upload a different Order Summary CSV" : "Drop your Meesho Order Summary CSV here"}
      </p>
      {!hasResult && (
        <p style={{ fontSize: 12, color: C.gray400, marginBottom: 16 }}>
          Sub orderId · Catalog ID · Quantity · Price · Order Date · Order Status · Payout Value · Payout Status · Claim Status · SKU ID
        </p>
      )}
      <label style={{ display: "inline-block" }}>
        <span style={{
          ...(loading ? {} : {}),
          display: "inline-block", padding: "9px 20px", borderRadius: 10, cursor: loading ? "default" : "pointer",
          background: C.orange, color: "#fff", fontWeight: 700, fontSize: 13, opacity: loading ? 0.6 : 1,
          boxShadow: "0 2px 6px rgba(109,40,217,0.3)",
        }}>
          {loading ? "Processing…" : "Choose CSV File"}
        </span>
        <input type="file" accept=".csv" hidden disabled={loading} onChange={(e) => onFile(e.target.files[0])} />
      </label>
      {error && (
        <p style={{ marginTop: 14, fontSize: 12, fontWeight: 600, color: C.red, background: C.redLight, border: `1px solid ${C.redBorder}`, borderRadius: 8, padding: "8px 12px", display: "inline-block" }}>
          ⚠ {error}
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Status breakdown table — new table, not the SettlementTable used on Overview
// ─────────────────────────────────────────────────────────────────────────────
function StatusBreakdownTable({ rows }) {
  const statusMeta = getStatusMeta();
  const total = rows.reduce((a, r) => ({
    count: a.count + r.count, gross: a.gross + r.gross, cost: a.cost + r.cost, net: a.net + r.net,
  }), { count: 0, gross: 0, cost: 0, net: 0 });

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 520 }}>
        <thead>
          <tr style={{ background: "#F8FAFC" }}>
            {["Status", "Orders", "Gross Payout", "Cost Deducted", "Est. Net P&L"].map((h, i) => (
              <th key={h} style={{
                padding: "7px 12px", textAlign: i <= 1 ? "left" : "right",
                fontSize: 10, fontWeight: 700, color: C.gray500, textTransform: "uppercase",
                letterSpacing: "0.05em", borderBottom: "2px solid #E2E8F0",
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const meta = statusMeta[r.status] || { color: C.gray500, icon: "•" };
            return (
              <tr key={r.status} style={{ borderBottom: i < rows.length - 1 ? "1px solid #F1F5F9" : "2px solid #E2E8F0", opacity: r.count === 0 ? 0.45 : 1 }}>
                <td style={{ padding: "8px 12px" }}>
                  <span style={{ marginRight: 6 }}>{meta.icon}</span>
                  <span style={{ fontWeight: 600, color: C.gray700 }}>{r.status}</span>
                </td>
                <td style={{ padding: "8px 12px", fontFamily: "monospace", color: C.gray500 }}>{r.count.toLocaleString()}</td>
                <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: "monospace", color: C.gray700 }}>{fmt(r.gross)}</td>
                <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: "monospace", color: r.cost > 0 ? C.red : C.gray300 }}>{r.cost ? `−${fmt(r.cost)}` : "—"}</td>
                <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: "monospace", fontWeight: 800, color: r.net >= 0 ? C.green : C.red }}>{fmt(r.net)}</td>
              </tr>
            );
          })}
          <tr style={{ background: "#F8FAFC" }}>
            <td style={{ padding: "9px 12px", fontWeight: 800, color: C.gray800, fontSize: 13 }}>Total</td>
            <td style={{ padding: "9px 12px", fontFamily: "monospace", fontWeight: 700, color: C.gray600 }}>{total.count.toLocaleString()}</td>
            <td style={{ padding: "9px 12px", textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: C.gray700 }}>{fmt(total.gross)}</td>
            <td style={{ padding: "9px 12px", textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: C.red }}>{total.cost ? `−${fmt(total.cost)}` : "—"}</td>
            <td style={{ padding: "9px 12px", textAlign: "right", fontFamily: "monospace", fontWeight: 800, color: total.net >= 0 ? C.green : C.red }}>{fmt(total.net)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SKU-wise table — new table, not the shared SKUTable used elsewhere
// ─────────────────────────────────────────────────────────────────────────────
const SORT_OPTIONS = [
  { key: "net_profit", label: "Net P&L" },
  { key: "order_count", label: "Orders" },
  { key: "gross_payout", label: "Gross Payout" },
  { key: "total_cost", label: "Cost" },
];
const PAGE_SIZE = 25;

function SkuEstimateTable({ rows }) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("net_profit");
  const [sortDir, setSortDir] = useState("desc"); // desc → sorted by profit, best performers first
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const f = rows.filter(r => !search || r.sku_id.toLowerCase().includes(search.toLowerCase()));
    const dir = sortDir === "asc" ? 1 : -1;
    return [...f].sort((a, b) => (a[sortKey] - b[sortKey]) * dir);
  }, [rows, search, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const visible = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  const toggleSort = (key) => {
    if (key === sortKey) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
    setPage(1);
  };

  const thR = { padding: "8px 10px", textAlign: "right", fontSize: 10, fontWeight: 700, color: C.gray500, textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "2px solid #E2E8F0", cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 10 }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: C.gray600 }}>{filtered.length.toLocaleString()} SKUs · sorted by profit</p>
        <input
          value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search SKU…"
          style={{ padding: "7px 12px", borderRadius: 8, border: "1.5px solid #E2E8F0", fontSize: 12, width: 220, fontFamily: "inherit" }}
        />
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 760 }}>
          <thead>
            <tr style={{ background: "#F8FAFC" }}>
              <th style={{ padding: "8px 10px", textAlign: "left", fontSize: 10, fontWeight: 700, color: C.gray500, textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "2px solid #E2E8F0" }}>SKU ID</th>
              <th style={{ ...thR, textAlign: "center", cursor: "default" }}>Outcomes</th>
              {SORT_OPTIONS.map(opt => (
                <th key={opt.key} style={thR} onClick={() => toggleSort(opt.key)}>
                  {opt.label}{sortKey === opt.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 30, textAlign: "center", color: C.gray400, fontSize: 12 }}>No SKUs match your search.</td></tr>
            )}
            {visible.map((r, i) => (
              <tr key={r.sku_id} style={{ background: i % 2 === 0 ? "#fff" : "#FAFBFC", borderBottom: "1px solid #F1F5F9" }}>
                <td style={{ padding: "8px 10px" }}>
                  <span style={{ fontFamily: "monospace", fontSize: 11, color: C.orange, fontWeight: 600, background: C.orangeLight, padding: "2px 6px", borderRadius: 4 }}>{r.sku_id}</span>
                </td>
                <td style={{ padding: "8px 10px", textAlign: "center" }}>
                  <div style={{ display: "flex", gap: 4, justifyContent: "center", flexWrap: "wrap" }}>
                    {r.delivered_count > 0 && <Badge icon="✅" n={r.delivered_count} color={C.green} />}
                    {r.return_count > 0 && <Badge icon="↩" n={r.return_count} color={C.red} />}
                    {r.rto_count > 0 && <Badge icon="🔄" n={r.rto_count} color={C.amber} />}
                    {r.exchange_count > 0 && <Badge icon="🔁" n={r.exchange_count} color={C.blue} />}
                    {r.claim_count > 0 && <Badge icon="⚠" n={r.claim_count} color="#7C3AED" />}
                    {r.other_count > 0 && <Badge icon="⊘" n={r.other_count} color={C.gray400} />}
                  </div>
                </td>
                <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: "monospace", fontWeight: 800, color: r.net_profit >= 0 ? C.green : C.red }}>{fmt(r.net_profit)}</td>
                <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: "monospace", color: C.gray600 }}>{r.order_count}</td>
                <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: "monospace", color: C.gray600 }}>{fmt(r.gross_payout)}</td>
                <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: "monospace", color: C.red }}>{r.total_cost ? fmt(r.total_cost) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, padding: "10px 0 0", borderTop: "1px solid #F1F5F9" }}>
          <span style={{ fontSize: 12, color: C.gray400 }}>
            {Math.min((pageSafe - 1) * PAGE_SIZE + 1, filtered.length)}–{Math.min(pageSafe * PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => setPage(p => p - 1)} disabled={pageSafe === 1} style={pagerBtn(pageSafe === 1)}>← Prev</button>
            <span style={{ fontSize: 12, color: C.gray500, alignSelf: "center", padding: "0 4px" }}>Page {pageSafe} / {totalPages}</span>
            <button onClick={() => setPage(p => p + 1)} disabled={pageSafe >= totalPages} style={pagerBtn(pageSafe >= totalPages)}>Next →</button>
          </div>
        </div>
      )}
    </div>
  );
}

function pagerBtn(disabled) {
  return { padding: "5px 13px", fontSize: 12, borderRadius: 10, cursor: disabled ? "default" : "pointer", background: "transparent", color: C.gray600, border: "1.5px solid #E2E8F0", opacity: disabled ? 0.4 : 1, fontFamily: "inherit", fontWeight: 600 };
}

function Badge({ icon, n, color }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, color, background: `${color}14`, border: `1px solid ${color}33`, padding: "1px 5px", borderRadius: 20 }}>
      {icon} {n}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline "add price" form for a SKU missing pricing — saves to SKU Pricing
// (final-prices/) then lets the caller re-fetch the live estimate.
// ─────────────────────────────────────────────────────────────────────────────
const inputStyle = { width: 90, padding: "5px 8px", borderRadius: 7, border: "1.5px solid #E2E8F0", fontSize: 12, fontFamily: "inherit" };

function MissingPriceSkuRow({ sku, onSaved }) {
  const [open, setOpen] = useState(false);
  const [itemPrice, setItemPrice] = useState("");
  const [packagingCost, setPackagingCost] = useState("");
  const [taxPercent, setTaxPercent] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const save = async () => {
    if (!itemPrice) { setErr("Item price is required"); return; }
    setSaving(true); setErr(null);
    try {
      const res = await fetch(`${API}/final-prices/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku_id: sku,
          item_price: Number(itemPrice),
          packaging_cost: Number(packagingCost || 0),
          tax_percent: Number(taxPercent || 0),
          final_price: Number(itemPrice) + Number(packagingCost || 0),
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail || d.error || JSON.stringify(d) || "Failed to save price");
      }
      setOpen(false);
      onSaved();
    } catch (e) {
      setErr(e.message || "Failed to save price");
    }
    setSaving(false);
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{
        display: "inline-flex", alignItems: "center", gap: 5, fontFamily: "monospace", fontSize: 11,
        color: C.red, background: "#fff", border: `1px solid ${C.redBorder}`, padding: "2px 7px 2px 7px",
        borderRadius: 6, cursor: "pointer", fontWeight: 600,
      }}>
        {sku} <span style={{ color: C.orange, fontWeight: 800 }}>＋ Add Price</span>
      </button>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, background: "#fff", border: `1.5px solid ${C.orangeBorder}`, borderRadius: 10, padding: "10px 12px" }}>
      <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: C.gray700 }}>{sku}</span>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <input type="number" placeholder="Item price*" value={itemPrice} onChange={e => setItemPrice(e.target.value)} style={inputStyle} />
        <input type="number" placeholder="Packaging" value={packagingCost} onChange={e => setPackagingCost(e.target.value)} style={inputStyle} />
        <input type="number" placeholder="Tax %" value={taxPercent} onChange={e => setTaxPercent(e.target.value)} style={inputStyle} />
        <button onClick={save} disabled={saving} style={{
          padding: "6px 12px", borderRadius: 7, border: "none", cursor: saving ? "default" : "pointer",
          background: C.green, color: "#fff", fontWeight: 700, fontSize: 12, opacity: saving ? 0.6 : 1,
        }}>{saving ? "Saving…" : "Save"}</button>
        <button onClick={() => setOpen(false)} disabled={saving} style={{
          padding: "6px 10px", borderRadius: 7, border: "1.5px solid #E2E8F0", cursor: "pointer",
          background: "transparent", color: C.gray500, fontWeight: 600, fontSize: 12,
        }}>Cancel</button>
      </div>
      {err && <span style={{ fontSize: 11, color: C.red, fontWeight: 600 }}>⚠ {err}</span>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main tab
// ─────────────────────────────────────────────────────────────────────────────
export function EstimatedProfitTab() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [fileName, setFileName] = useState("Saved Data");

  // Load whatever was already saved from earlier uploads as soon as the tab opens.
  const loadSaved = async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${API}/estimated-profit/`);
      const data = await res.json();
      if (res.ok && data.saved_order_count > 0) { setResult(data); setFileName("Saved Data"); }
    } catch {
      // silent — an empty state is fine on first-ever load
    }
    setLoading(false);
  };
  useEffect(() => { loadSaved(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch the live estimate without a full loading spinner (used after adding a SKU price).
  const refresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetch(`${API}/estimated-profit/`);
      const data = await res.json();
      if (res.ok) setResult(prev => (prev ? { ...prev, ...data } : data));
    } catch {
      // keep showing the last known result
    }
    setRefreshing(false);
  };

  const handleFile = async (file) => {
    if (!file) return;
    setLoading(true); setError(null);
    setFileName(file.name);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch(`${API}/estimated-profit/upload/`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Upload failed"); }
      else { setResult(data); }
    } catch {
      setError("Network error — is the backend running?");
    }
    setLoading(false);
  };

  const totals = result?.totals;
  const netProfit = Number(totals?.net_profit ?? 0);
  const pos = netProfit >= 0;

  const statusRows = result?.status_breakdown?.filter(r => r.count > 0) || [];

  const divergingChartData = statusRows.map(r => ({
    status: r.status,
    profitVal: r.net >= 0 ? r.net : null,
    lossVal: r.net < 0 ? r.net : null,
  }));

  const statusMeta = getStatusMeta();
  const pieData = statusRows.map((r, i) => ({
    id: i, value: r.count, label: r.status,
    color: (statusMeta[r.status] || {}).color || C.gray400,
  }));

  const topProfit = result?.top_profit_skus || [];
  const topLoss = result?.top_loss_skus || [];
  const tornadoRows = [...topLoss].reverse().concat(topProfit); // losses (top) → profits (bottom)
  const tornadoData = tornadoRows.map(r => ({
    sku: r.sku_id,
    profitVal: r.net_profit >= 0 ? r.net_profit : null,
    lossVal: r.net_profit < 0 ? r.net_profit : null,
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: C.gray800, marginBottom: 4 }}>Estimated Profit — Order Summary Upload</h2>
        <p style={{ fontSize: 12, color: C.gray400 }}>
          Upload a Meesho order-summary CSV (Payout Value per sub-order) to estimate P&L before payments settle — same
          formula as the Overview tab. In Transit / Ready To Ship rows are excluded. Delivered and an <strong>approved</strong> Claim
          deduct item cost×qty + tax + packaging; Exchanged deducts the same with packaging doubled. Returned, RTO, and a
          <strong> rejected</strong> Claim deduct nothing — the payout stands as-is, and only counts when it's actually a
          loss (settlement ≤ 0); a positive settlement on one of those is excluded.
          Rows are saved — re-uploading the same or an updated sheet refreshes existing orders instead of duplicating them.
        </p>
      </div>

      <UploadZone loading={loading} error={error} onFile={handleFile} hasResult={!!result} />

      {loading && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "50px 0", gap: 12 }}>
          <CircularProgress color="primary" />
          <span style={{ fontSize: 13, color: C.gray400 }}>Matching SKUs and computing estimated P&L…</span>
        </div>
      )}

      {!loading && result && <>

        {/* Hero banner */}
        <div style={{
          ...T.card,
          background: `linear-gradient(135deg, ${pos ? "#ECFDF5" : "#FFF1F2"} 0%, #fff 65%)`,
          border: `1.5px solid ${pos ? C.greenBorder : C.redBorder}`,
          display: "flex", justifyContent: "space-between", alignItems: "flex-start",
          flexWrap: "wrap", gap: 24, padding: "22px 26px",
        }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: C.gray400, letterSpacing: "0.12em", marginBottom: 8, textTransform: "uppercase" }}>
              Estimated Net P&L — {fileName}
            </p>
            <p style={{ fontSize: 42, fontWeight: 900, fontFamily: "monospace", color: pos ? C.green : C.red, lineHeight: 1, letterSpacing: "-0.03em" }}>
              {pos ? "+" : ""}{fmt(netProfit)}
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <span style={{ background: pos ? C.greenLight : C.redLight, color: pos ? C.green : C.red, border: `1px solid ${pos ? C.greenBorder : C.redBorder}`, fontSize: 11, fontWeight: 700, padding: "3px 12px", borderRadius: 20 }}>
                {pos ? "✅ Estimated Profitable" : "❌ Estimated Loss"}
              </span>
              <span style={{ background: "#F8FAFC", color: C.gray600, border: "1px solid #E2E8F0", fontSize: 11, fontWeight: 600, padding: "3px 12px", borderRadius: 20 }}>
                {(totals.order_count ?? 0).toLocaleString()} orders scored
              </span>
              {result.excluded_count > 0 && (
                <span style={{ background: "#FFF7ED", color: C.amber, border: "1px solid #FDE68A", fontSize: 11, fontWeight: 600, padding: "3px 12px", borderRadius: 20 }}>
                  🚚 {result.excluded_count} In Transit / Ready To Ship excluded
                </span>
              )}
              {result.created != null && (
                <span style={{ background: "#EFF6FF", color: C.blue, border: "1px solid #BFDBFE", fontSize: 11, fontWeight: 600, padding: "3px 12px", borderRadius: 20 }}>
                  💾 saved — {result.created} new · {result.updated} updated
                </span>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
            {[
              { label: "Gross Payout", value: fmt(totals.gross_payout), color: C.gray800 },
              { label: "Est. Cost Deducted", value: fmt(totals.total_cost), color: C.red },
              { label: "Order Value (list price)", value: fmt(totals.total_order_value), color: C.blue },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ textAlign: "right" }}>
                <p style={{ fontSize: 10, fontWeight: 700, color: C.gray400, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 5 }}>{label}</p>
                <p style={{ fontSize: 20, fontWeight: 800, fontFamily: "monospace", color }}>{value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Data quality strip */}
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <KPICard label="Orders Saved" value={(result.saved_order_count ?? 0).toLocaleString()} accent={C.gray600} sub="persisted across uploads" />
          <KPICard label="Orders Scored" value={(totals.order_count ?? 0).toLocaleString()} accent={C.blue} sub="Delivered/Return/RTO/Exchange/Other" />
          {result.total_rows != null && (
            <KPICard label="Rows in Last Upload" value={result.total_rows.toLocaleString()} accent={C.gray400} />
          )}
          {result.excluded_count != null && (
            <KPICard label="Excluded (In Transit / RTS)" value={result.excluded_count.toLocaleString()} accent={C.amber} sub="not yet settled" />
          )}
          {result.invalid_rows != null && (
            <KPICard label="Invalid Rows Skipped" value={result.invalid_rows.toLocaleString()} accent={C.gray400} sub="missing SKU / qty / payout" />
          )}
          <KPICard label="SKUs Missing Pricing" value={result.missing_price_count.toLocaleString()} accent={result.missing_price_count > 0 ? C.red : C.green}
            sub={result.missing_price_count > 0 ? `${fmt(result.missing_price_payout_sum)} payout excluded` : "all matched"} />
          {result.non_loss_payout_excluded_count > 0 && (
            <KPICard label="Non-Loss Rows Excluded" value={result.non_loss_payout_excluded_count.toLocaleString()} accent={C.gray400}
              sub={`${fmt(result.non_loss_payout_excluded_sum)} payout — Return/RTO/rejected Claim, settlement wasn't negative`} />
          )}
        </div>

        {result.missing_price_count > 0 && (
          <div style={{ ...T.card, background: "#FFF1F2", border: `1.5px solid ${C.redBorder}`, padding: "14px 20px" }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: C.red, marginBottom: 6 }}>
              ⚠ {result.missing_price_count} order line(s) excluded — SKU has no pricing set, so cost couldn't be computed
              {refreshing && <span style={{ fontWeight: 500, color: C.gray400 }}> · refreshing…</span>}
            </p>
            <p style={{ fontSize: 12, color: C.gray600, marginBottom: 10 }}>
              {fmt(result.missing_price_payout_sum)} of payout from these orders is <strong>not</strong> included in the estimate above.
              Add a price below and the estimate updates immediately — no re-upload needed.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {result.missing_price_skus.map(sku => (
                <MissingPriceSkuRow key={sku} sku={sku} onSaved={refresh} />
              ))}
            </div>
          </div>
        )}

        {/* Status breakdown table */}
        <SectionCard title="Estimated P&L by Order Status">
          <StatusBreakdownTable rows={statusRows} />
        </SectionCard>

        {/* Charts */}
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          {divergingChartData.length > 0 && (
            <SectionCard title="Net P&L by Status" style={{ flex: "1 1 380px" }}>
              <BarChart
                dataset={divergingChartData}
                xAxis={[{ scaleType: "band", dataKey: "status", tickLabelStyle: { fontSize: 10 } }]}
                series={[
                  { dataKey: "profitVal", label: "Profit", color: C.green },
                  { dataKey: "lossVal", label: "Loss", color: C.red },
                ]}
                height={230} borderRadius={6} margin={{ left: 56, bottom: 34, right: 10, top: 10 }}
                slotProps={{ legend: { hidden: true } }}
              />
            </SectionCard>
          )}
          {pieData.length > 0 && (
            <SectionCard title="Orders by Status" style={{ flex: "0 0 300px" }}>
              <PieChart
                series={[{ data: pieData, innerRadius: 48, outerRadius: 76, paddingAngle: 2 }]}
                height={200}
                slotProps={{ legend: { direction: "column", position: { vertical: "middle", horizontal: "right" }, labelStyle: { fontSize: 11 } } }}
              />
            </SectionCard>
          )}
        </div>

        {tornadoData.length > 0 && (
          <SectionCard title="Biggest Winners & Losers" subtitle="Top loss-making and top profit-making SKUs across all saved orders">
            <BarChart
              dataset={tornadoData}
              layout="horizontal"
              yAxis={[{ scaleType: "band", dataKey: "sku", tickLabelStyle: { fontSize: 10 }, width: 160 }]}
              xAxis={[{ tickLabelStyle: { fontSize: 10 } }]}
              series={[
                { dataKey: "profitVal", label: "Profit", color: C.green, valueFormatter: (v) => (v == null ? "" : fmt(v)) },
                { dataKey: "lossVal", label: "Loss", color: C.red, valueFormatter: (v) => (v == null ? "" : fmt(v)) },
              ]}
              height={Math.max(160, tornadoData.length * 28)}
              borderRadius={4}
              margin={{ left: 170, right: 16, top: 10, bottom: 30 }}
              slotProps={{ legend: { hidden: true } }}
            />
          </SectionCard>
        )}

        {/* SKU-wise table */}
        <SectionCard title="SKU-wise Estimated Profit / Loss">
          <SkuEstimateTable rows={result.sku_wise} />
        </SectionCard>
      </>}

      {!loading && !result && !error && (
        <p style={{ fontSize: 12, color: C.gray400, textAlign: "center", padding: "20px 0" }}>
          Upload a CSV to see the estimated profit breakdown.
        </p>
      )}
    </div>
  );
}
