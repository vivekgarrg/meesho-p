import React, { useState, useEffect, useCallback } from "react";
import { API, C, S, btn, Tag } from "../../App";
import DownloadIcon from "@mui/icons-material/Download";
import SaveIcon from "@mui/icons-material/Save";
import SearchIcon from "@mui/icons-material/Search";
import TrendingDownIcon from "@mui/icons-material/TrendingDown";
import FilterAltIcon from "@mui/icons-material/FilterAlt";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { CircularProgress, Tooltip } from "@mui/material";

const PAGE_SIZE = 50;

const fmt2 = (n) =>
  n === null || n === undefined
    ? "—"
    : `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function ProfitBadge({ value }) {
  if (value === null || value === undefined)
    return <span style={{ color: C.gray300, fontSize: 12 }}>No data</span>;
  const color = value < 0 ? C.red : value < 50 ? C.amber : C.green;
  const bg    = value < 0 ? C.redLight : value < 50 ? C.amberLight : C.greenLight;
  return (
    <span style={{
      fontFamily: "monospace", fontWeight: 700, fontSize: 13,
      color, background: bg, padding: "3px 8px", borderRadius: 6,
      display: "inline-block",
    }}>
      {value >= 0 ? "+" : ""}{fmt2(value)}
    </span>
  );
}

function NumInput({ value, placeholder, onChange, highlight }) {
  return (
    <input
      type="number"
      min={0}
      step={0.01}
      value={value ?? ""}
      placeholder={placeholder}
      onChange={e => onChange(e.target.value === "" ? null : e.target.value)}
      style={{
        ...S.inp,
        width: 90, padding: "5px 8px", fontSize: 12,
        fontFamily: "monospace", fontWeight: 600,
        borderColor: highlight ? C.orange : C.gray200,
        background:  highlight ? C.orangeLight : C.white,
      }}
    />
  );
}

export function MeeshoPricingTab() {
  const [items, setItems]         = useState([]);
  const [total, setTotal]         = useState(0);
  const [loading, setLoading]     = useState(false);
  const [saving, setSaving]       = useState(false);
  const [msg, setMsg]             = useState(null);
  const [search, setSearch]       = useState("");
  const [maxProfit, setMaxProfit] = useState("");   // "" = no filter
  const [page, setPage]           = useState(1);
  const [edits, setEdits]         = useState({});   // {inventory_id: {new_msp, new_wdrp, new_mrp}}
  const [savedIds, setSavedIds]   = useState(new Set());

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (search.trim())   p.set("q", search.trim());
      if (maxProfit !== "") p.set("max_profit", maxProfit);
      const res  = await fetch(`${API}/meesho-price-update/?${p}`);
      const data = await res.json();
      setItems(data.items || []);
      setTotal(data.total ?? 0);
    } finally {
      setLoading(false);
    }
  }, [search, maxProfit]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { setPage(1); }, [search, maxProfit]);

  const setEdit = (id, field, val) => {
    setEdits(prev => ({
      ...prev,
      [id]: { ...(prev[id] || {}), [field]: val },
    }));
    setSavedIds(prev => { const s = new Set(prev); s.delete(id); return s; });
  };

  const pendingCount = Object.keys(edits).length;

  const handleSave = async () => {
    const payload = Object.entries(edits).map(([id, fields]) => ({
      inventory_id: Number(id),
      new_msp:  fields.new_msp  ?? null,
      new_wdrp: fields.new_wdrp ?? null,
      new_mrp:  fields.new_mrp  ?? null,
    }));
    setSaving(true);
    try {
      const res  = await fetch(`${API}/meesho-price-update/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      setSavedIds(prev => {
        const s = new Set(prev);
        payload.forEach(p => s.add(p.inventory_id));
        return s;
      });
      setEdits({});
      setMsg({ type: "success", text: `Saved ${data.updated} price update(s).` });
      fetchData();
    } catch {
      setMsg({ type: "error", text: "Failed to save changes." });
    } finally {
      setSaving(false);
    }
  };

  const handleDownload = () => {
    window.location.href = `${API}/meesho-price-update/download/`;
  };

  const pageItems  = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));

  const withMSP = items.filter(i => {
    const e = edits[i.inventory_id];
    return (e?.new_msp != null) || i.new_msp != null;
  }).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <TrendingDownIcon style={{ color: C.red, fontSize: 22 }} />
          <h1 style={{ fontSize: 20, fontWeight: 800, color: C.gray800 }}>Meesho Price Update</h1>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {pendingCount > 0 && (
            <button onClick={handleSave} disabled={saving} style={btn("success", "md")}>
              {saving ? <CircularProgress size={14} style={{ color: "#fff" }} /> : <SaveIcon style={{ fontSize: 16 }} />}
              &nbsp;Save {pendingCount} change{pendingCount !== 1 ? "s" : ""}
            </button>
          )}
          <Tooltip title={withMSP === 0 ? "Set New MSP for at least one SKU first" : `Download sheet for ${withMSP} SKU(s)`}>
            <span>
              <button onClick={handleDownload} disabled={withMSP === 0} style={{ ...btn("ghostOrange", "md"), opacity: withMSP === 0 ? 0.5 : 1 }}>
                <DownloadIcon style={{ fontSize: 16 }} />&nbsp;Download Sheet ({withMSP})
              </button>
            </span>
          </Tooltip>
        </div>
      </div>

      {/* ── Info banner ── */}
      <div style={{
        background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 12,
        padding: "14px 18px", fontSize: 13, color: "#1D4ED8",
        display: "flex", gap: 10, alignItems: "flex-start",
      }}>
        <span style={{ fontSize: 18, lineHeight: 1 }}>💡</span>
        <div>
          <strong>How it works:</strong> Filter SKUs by profit threshold below. Set a <strong>New MSP</strong> for the ones you want to reprice.
          Click <strong>Save</strong>, then <strong>Download Sheet</strong> to get the Meesho bulk price update Excel — upload it directly on Meesho Supplier Panel.
        </div>
      </div>

      {/* ── Flash message ── */}
      {msg && (
        <div style={{
          padding: "12px 18px", borderRadius: 10, fontSize: 13, fontWeight: 500,
          background: msg.type === "success" ? C.greenLight : C.redLight,
          color:      msg.type === "success" ? C.green : C.red,
          border: `1px solid ${msg.type === "success" ? C.greenBorder : C.redBorder}`,
          display: "flex", alignItems: "center", gap: 8,
        }}>
          {msg.type === "success" ? <CheckCircleIcon style={{ fontSize: 18 }} /> : <WarningAmberIcon style={{ fontSize: 18 }} />}
          {msg.text}
          <button onClick={() => setMsg(null)} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "inherit", fontSize: 16 }}>×</button>
        </div>
      )}

      {/* ── Filters ── */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>

        {/* Profit filter */}
        <div>
          <label style={S.label}>
            <FilterAltIcon style={{ fontSize: 13, verticalAlign: "middle" }} /> Show SKUs with avg profit below
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14, color: C.gray500, fontWeight: 600 }}>₹</span>
            <input
              type="number"
              value={maxProfit}
              onChange={e => setMaxProfit(e.target.value)}
              placeholder="e.g. 50 (or blank for all)"
              style={{ ...S.inp, width: 210 }}
            />
            {maxProfit !== "" && (
              <button onClick={() => setMaxProfit("")} style={{ ...btn("ghost", "sm"), padding: "6px 10px" }}>✕ Clear</button>
            )}
          </div>
        </div>

        {/* Search */}
        <div style={{ flex: 1, minWidth: 240 }}>
          <label style={S.label}>Search</label>
          <div style={{ position: "relative" }}>
            <SearchIcon style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 17, color: C.gray400 }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Catalog / product / style ID…"
              style={{ ...S.inp, paddingLeft: 34 }}
            />
          </div>
        </div>

        {/* Result count */}
        <div style={{ alignSelf: "flex-end", paddingBottom: 2 }}>
          <span style={{ fontSize: 12, color: C.gray400, fontWeight: 600 }}>
            {loading ? "Loading…" : `${total} SKU${total !== 1 ? "s" : ""} shown`}
          </span>
        </div>
      </div>

      {/* ── Table ── */}
      <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 56 }}>
            <CircularProgress style={{ color: C.orange }} />
          </div>
        ) : (
          <>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr>
                    {[
                      "#", "Catalog / Style", "Product", "Deliveries",
                      "Avg Settlement", "Cost", "Avg Profit/unit",
                      "Current Price", "New MSP ★", "WDRP", "MRP (opt)",
                    ].map(h => (
                      <th key={h} style={{ ...S.th, fontSize: 10, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageItems.length === 0 ? (
                    <tr><td colSpan={11} style={{ ...S.td, textAlign: "center", padding: 56, color: C.gray400 }}>
                      {total === 0 && !loading
                        ? (maxProfit !== ""
                          ? `No SKUs with avg profit below ₹${maxProfit} — try raising the threshold`
                          : "No inventory data. Upload a Meesho inventory file first.")
                        : "No results."}
                    </td></tr>
                  ) : pageItems.map((item, idx) => {
                    const globalIdx = (page - 1) * PAGE_SIZE + idx;
                    const rowBg     = globalIdx % 2 === 0 ? C.white : C.gray50;
                    const edit      = edits[item.inventory_id] || {};
                    const isSaved   = savedIds.has(item.inventory_id);
                    const hasEdit   = !!edits[item.inventory_id];

                    const msp  = edit.new_msp  !== undefined ? edit.new_msp  : item.new_msp;
                    const wdrp = edit.new_wdrp !== undefined ? edit.new_wdrp : item.new_wdrp;
                    const mrp  = edit.new_mrp  !== undefined ? edit.new_mrp  : item.new_mrp;

                    return (
                      <tr key={item.inventory_id} style={{ background: rowBg }}>
                        <td style={{ ...S.td, color: C.gray400, fontSize: 10, width: 32 }}>{item.serial_no}</td>

                        {/* Catalog + Style */}
                        <td style={{ ...S.td, maxWidth: 160 }}>
                          <div style={{ fontWeight: 600, color: C.gray700, fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 150 }} title={item.catalog_name}>
                            {item.catalog_name}
                          </div>
                          <div style={{ fontSize: 10, fontFamily: "monospace", color: C.orange, background: C.orangeLight, display: "inline-block", padding: "1px 5px", borderRadius: 4, marginTop: 2 }}>
                            {item.style_id || "—"}
                          </div>
                        </td>

                        {/* Product name */}
                        <td style={{ ...S.td, maxWidth: 200 }}>
                          <div style={{ fontSize: 11, color: C.gray600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 195 }} title={item.product_name}>
                            {item.product_name}
                          </div>
                          <div style={{ fontSize: 10, color: C.gray400, marginTop: 1 }}>
                            CatID: {item.catalog_id} · ProdID: {item.product_id}
                          </div>
                        </td>

                        {/* Deliveries */}
                        <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace" }}>
                          {item.delivery_count > 0
                            ? <Tag variant="green">{item.delivery_count}</Tag>
                            : <span style={{ color: C.gray300 }}>—</span>}
                        </td>

                        {/* Avg Settlement */}
                        <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontSize: 12 }}>
                          {item.avg_settlement != null ? fmt2(item.avg_settlement) : <span style={{ color: C.gray300 }}>—</span>}
                        </td>

                        {/* Cost */}
                        <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontSize: 12 }}>
                          {item.cost != null ? fmt2(item.cost) : <span style={{ color: C.gray300 }}>No pricing</span>}
                        </td>

                        {/* Avg Profit */}
                        <td style={{ ...S.td, textAlign: "center" }}>
                          <ProfitBadge value={item.avg_profit} />
                        </td>

                        {/* Current listing price */}
                        <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontSize: 12, color: C.gray500 }}>
                          {item.current_price != null ? fmt2(item.current_price) : <span style={{ color: C.gray300 }}>—</span>}
                        </td>

                        {/* New MSP ★ */}
                        <td style={{ ...S.td }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <NumInput
                              value={msp}
                              placeholder="New MSP"
                              onChange={val => setEdit(item.inventory_id, "new_msp", val)}
                              highlight={msp != null}
                            />
                            {isSaved && !hasEdit && msp != null && (
                              <Tooltip title="Saved"><CheckCircleIcon style={{ fontSize: 15, color: C.green }} /></Tooltip>
                            )}
                          </div>
                        </td>

                        {/* WDRP */}
                        <td style={{ ...S.td }}>
                          <NumInput
                            value={wdrp}
                            placeholder="WDRP"
                            onChange={val => setEdit(item.inventory_id, "new_wdrp", val)}
                            highlight={wdrp != null}
                          />
                        </td>

                        {/* MRP */}
                        <td style={{ ...S.td }}>
                          <NumInput
                            value={mrp}
                            placeholder="MRP"
                            onChange={val => setEdit(item.inventory_id, "new_mrp", val)}
                            highlight={mrp != null}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {items.length > PAGE_SIZE && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 20px", borderTop: `1px solid ${C.gray100}` }}>
                <span style={{ fontSize: 12, color: C.gray400 }}>
                  {Math.min((page - 1) * PAGE_SIZE + 1, items.length)}–{Math.min(page * PAGE_SIZE, items.length)} of {items.length}
                </span>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => setPage(p => p - 1)} disabled={page === 1} style={{ ...btn("ghost", "sm"), opacity: page === 1 ? 0.4 : 1 }}>← Prev</button>
                  <span style={{ fontSize: 12, color: C.gray500, padding: "0 6px", alignSelf: "center" }}>Page {page} / {totalPages}</span>
                  <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages} style={{ ...btn("ghost", "sm"), opacity: page >= totalPages ? 0.4 : 1 }}>Next →</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Sticky save bar ── */}
      {pendingCount > 0 && (
        <div style={{
          position: "fixed", bottom: 24, right: 32,
          background: C.orange, color: "#fff",
          borderRadius: 14, padding: "14px 24px",
          boxShadow: "0 8px 24px rgba(109,40,217,0.35)",
          display: "flex", alignItems: "center", gap: 14, zIndex: 999,
        }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{pendingCount} unsaved price change{pendingCount !== 1 ? "s" : ""}</span>
          <button onClick={handleSave} disabled={saving} style={{ background: "#fff", color: C.orange, border: "none", borderRadius: 8, padding: "7px 18px", fontWeight: 700, cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>
            {saving ? "Saving…" : "Save All"}
          </button>
          <button onClick={() => setEdits({})} style={{ background: "rgba(255,255,255,0.15)", color: "#fff", border: "none", borderRadius: 8, padding: "7px 12px", cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>
            Discard
          </button>
        </div>
      )}
    </div>
  );
}
