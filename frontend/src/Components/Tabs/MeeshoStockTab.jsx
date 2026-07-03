import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Alert, Box, Button, Chip, CircularProgress, IconButton,
  MenuItem, Paper, Select, Table, TableBody, TableCell,
  TableHead, TableRow, TextField, Tooltip, Typography,
} from "@mui/material";
import { API, C } from "../../App";

const STOCK_TYPES = ["IN_STOCK", "OUT_OF_STOCK", "ALL"];
const ST_STYLE = {
  IN_STOCK:     { bg: "#D1FAE5", color: "#065F46", border: "#6EE7B7" },
  OUT_OF_STOCK: { bg: "#FEE2E2", color: "#991B1B", border: "#FCA5A5" },
  ALL:          { bg: "#EFF6FF", color: "#1E40AF", border: "#BFDBFE" },
};

// ── helpers ──────────────────────────────────────────────────────────────────
function profitColor(p) {
  if (p == null) return C.gray400;
  if (p < 0)   return "#DC2626";
  if (p < 30)  return "#D97706";
  if (p < 60)  return "#CA8A04";
  return "#16A34A";
}

function ProfitChip({ value }) {
  const c = profitColor(value);
  return (
    <Chip
      label={value == null ? "—" : `₹${value.toFixed(0)}`}
      size="small"
      sx={{ fontFamily: "monospace", fontWeight: 800, fontSize: 12, background: `${c}18`, color: c, border: `1px solid ${c}40`, "& .MuiChip-label": { px: "8px" } }}
    />
  );
}

// ── Tab switcher ──────────────────────────────────────────────────────────────
function ViewTab({ active, onClick, children }) {
  return (
    <Button
      onClick={onClick}
      size="small"
      sx={{
        textTransform: "none", fontWeight: active ? 800 : 500, fontSize: 13,
        borderRadius: 0, borderBottom: active ? `3px solid ${C.orange}` : "3px solid transparent",
        color: active ? C.orange : C.gray500, px: "18px", py: "8px",
        "&:hover": { background: C.orangeLight },
      }}
    >
      {children}
    </Button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Stock Data View
// ═══════════════════════════════════════════════════════════════════════════════
function StockDataView() {
  const [items,     setItems]     = useState([]);
  const [catalogs,  setCatalogs]  = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState(null);
  const [search,    setSearch]    = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editVal,   setEditVal]   = useState("");
  const [saving,    setSaving]    = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(() => {
    setLoading(true);
    const p = new URLSearchParams();
    if (catFilter) p.set("catalog_id", catFilter);
    if (search)    p.set("search", search);
    fetch(`${API}/meesho-stock/?${p}`)
      .then(r => r.json())
      .then(d => { setItems(d.items || []); setCatalogs(d.catalogs || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [catFilter, search]);

  useEffect(() => { load(); }, [load]);

  const handleUpload = async (file) => {
    setUploading(true); setUploadMsg(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const res  = await fetch(`${API}/meesho-stock/upload/`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok || data.error) setUploadMsg({ type: "error", text: data.error });
      else {
        setUploadMsg({ type: "success", text: `${data.created} created · ${data.updated} updated${data.skipped ? ` · ${data.skipped} skipped` : ""}${data.errors?.length ? ` · ${data.errors.length} row errors` : ""}` });
        load();
      }
    } catch { setUploadMsg({ type: "error", text: "Network error." }); }
    finally  { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const saveEdit = async (id) => {
    setSaving(true);
    const v = editVal.trim() === "" ? null : editVal;
    try {
      const res = await fetch(`${API}/meesho-stock/${id}/`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ edit_stock: v }),
      });
      if (res.ok) {
        const d = await res.json();
        setItems(prev => prev.map(it => it.id === id ? { ...it, edit_stock: d.edit_stock } : it));
      }
    } catch {}
    setSaving(false); setEditingId(null);
  };

  const handleClear = async () => {
    if (!window.confirm("Clear all stock data?")) return;
    await fetch(`${API}/meesho-stock/clear/`, { method: "DELETE" });
    setItems([]); setCatalogs([]);
  };

  const grouped = items.reduce((acc, it) => {
    const k = it.catalog_id;
    if (!acc[k]) acc[k] = { catalog_name: it.catalog_name, catalog_id: it.catalog_id, rows: [] };
    acc[k].rows.push(it);
    return acc;
  }, {});
  const pendingEdits = items.filter(it => it.edit_stock !== null && it.edit_stock !== undefined).length;

  return (
    <>
      {/* Toolbar */}
      <Box sx={{ display: "flex", alignItems: "center", gap: "10px", mb: "16px", flexWrap: "wrap" }}>
        {items.length > 0 && (
          <>
            <Chip label={`${items.length} products`} size="small" sx={{ background: C.orangeLight, color: C.orange, border: `1px solid ${C.orangeBorder}`, fontWeight: 700 }} />
            {pendingEdits > 0 && <Chip label={`${pendingEdits} edits pending`} size="small" sx={{ background: "#EFF6FF", color: "#2563EB", border: "1px solid #BFDBFE", fontWeight: 700 }} />}
          </>
        )}
        <Box sx={{ ml: "auto", display: "flex", gap: "8px" }}>
          <Button variant="contained" size="small" onClick={() => fileRef.current?.click()} disabled={uploading}
            sx={{ background: C.orange, color: "#fff", fontWeight: 700, textTransform: "none", fontSize: 13, "&:hover": { background: "#D97706" } }}>
            {uploading ? <CircularProgress size={14} sx={{ mr: "6px", color: "#fff" }} /> : "⇧ "}
            Upload XLSX
          </Button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }}
            onChange={e => { if (e.target.files?.[0]) handleUpload(e.target.files[0]); }} />
          {items.length > 0 && (
            <Button variant="outlined" size="small" onClick={handleClear}
              sx={{ borderColor: "#FCA5A5", color: "#DC2626", fontWeight: 600, textTransform: "none", fontSize: 13 }}>
              🗑 Clear All
            </Button>
          )}
        </Box>
      </Box>

      {uploadMsg && <Alert severity={uploadMsg.type} sx={{ mb: "14px", borderRadius: 2 }} onClose={() => setUploadMsg(null)}>{uploadMsg.text}</Alert>}

      {/* Filters */}
      {items.length > 0 && (
        <Paper elevation={0} sx={{ border: `1px solid ${C.border}`, borderRadius: 2, p: "10px 16px", mb: "14px", display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
          <TextField size="small" placeholder="🔍 Search product / SKU / catalog…" value={search} onChange={e => setSearch(e.target.value)} sx={{ width: 260, "& input": { fontSize: 13 } }} />
          <Select size="small" value={catFilter} displayEmpty onChange={e => setCatFilter(e.target.value)} sx={{ fontSize: 13, minWidth: 200 }}>
            <MenuItem value="">All Catalogs</MenuItem>
            {catalogs.map(c => <MenuItem key={c.catalog_id} value={c.catalog_id} sx={{ fontSize: 13 }}>{c.catalog_name ? `${c.catalog_name} (${c.catalog_id})` : c.catalog_id}</MenuItem>)}
          </Select>
          <Typography sx={{ fontSize: 12, color: C.gray400, ml: "auto" }}>{Object.keys(grouped).length} catalogs · {items.length} products</Typography>
        </Paper>
      )}

      {/* Empty state */}
      {!loading && items.length === 0 && (
        <Paper elevation={0} sx={{ border: `2px dashed ${C.border}`, borderRadius: 3, p: "60px 24px", textAlign: "center" }}>
          <Typography sx={{ fontSize: 36, mb: "12px" }}>📊</Typography>
          <Typography sx={{ fontSize: 16, fontWeight: 700, color: C.gray600, mb: "6px" }}>No stock data yet</Typography>
          <Typography sx={{ fontSize: 13, color: C.gray400, mb: "20px" }}>Upload the Meesho stock xlsx to get started</Typography>
          <Button variant="contained" onClick={() => fileRef.current?.click()} sx={{ background: C.orange, fontWeight: 700, textTransform: "none", "&:hover": { background: "#D97706" } }}>⇧ Upload XLSX</Button>
        </Paper>
      )}

      {loading && <Box sx={{ display: "flex", justifyContent: "center", py: "60px" }}><CircularProgress sx={{ color: C.orange }} /></Box>}

      {/* Grouped tables by catalog */}
      {!loading && Object.values(grouped).map(group => (
        <Paper key={group.catalog_id} elevation={0} sx={{ border: `1px solid ${C.border}`, borderRadius: 2, mb: "18px", overflow: "hidden" }}>
          <Box sx={{ background: "#F8FAFC", borderBottom: `1px solid ${C.border}`, p: "10px 16px", display: "flex", alignItems: "center", gap: "10px" }}>
            <Typography sx={{ fontSize: 13, fontWeight: 800, color: C.gray700 }}>{group.catalog_name || "—"}</Typography>
            <Chip label={`ID: ${group.catalog_id}`} size="small" sx={{ fontFamily: "monospace", fontSize: 11, background: C.orangeLight, color: C.orange, border: `1px solid ${C.orangeBorder}`, "& .MuiChip-label": { px: "8px" } }} />
            <Chip label={`${group.rows.length} products`} size="small" sx={{ fontSize: 11, background: C.gray100, color: C.gray500, "& .MuiChip-label": { px: "8px" } }} />
          </Box>
          <Box sx={{ overflowX: "auto" }}>
            <Table size="small" sx={{ width: "100%", borderCollapse: "collapse" }}>
              <TableHead>
                <TableRow>
                  {[["#","left",36],["Product Name","left",200],["Product ID","left",110],["Style ID","left",120],["Variation","left",150],["Var ID","left",110],["Stock Type","center",130],["Current","right",90],["Edit Stock","center",140]].map(([h,a,w]) => (
                    <TableCell key={h} sx={{ textAlign: a, fontSize: 11, fontWeight: 700, color: C.gray500, textTransform: "uppercase", letterSpacing: "0.06em", background: C.gray50, whiteSpace: "nowrap", borderBottom: `1px solid ${C.border}`, py: "9px", px: "12px", minWidth: w }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {group.rows.map((row, ri) => {
                  const stS      = ST_STYLE[row.stock_type] || {};
                  const isEdit   = editingId === row.id;
                  const hasEdit  = row.edit_stock !== null && row.edit_stock !== undefined;
                  return (
                    <TableRow key={row.id} sx={{ background: ri % 2 === 0 ? C.white : C.gray50, "&:hover": { background: "#F0F7FF" } }}>
                      <TableCell sx={{ color: C.gray400, fontSize: 11, py: "8px", px: "12px" }}>{ri + 1}</TableCell>
                      <TableCell sx={{ py: "8px", px: "12px", maxWidth: 220 }}>
                        <Tooltip title={row.product_name || ""} placement="top">
                          <Typography sx={{ fontSize: 12, fontWeight: 600, color: C.gray800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 210 }}>{row.product_name || "—"}</Typography>
                        </Tooltip>
                      </TableCell>
                      <TableCell sx={{ py: "8px", px: "12px" }}><span style={{ fontFamily: "monospace", fontSize: 11, color: C.blue, fontWeight: 600 }}>{row.product_id}</span></TableCell>
                      <TableCell sx={{ py: "8px", px: "12px" }}><span style={{ fontFamily: "monospace", fontSize: 11, color: C.gray600 }}>{row.product_style_id || "—"}</span></TableCell>
                      <TableCell sx={{ py: "8px", px: "12px" }}><Typography sx={{ fontSize: 12, color: C.gray600, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.variation || "—"}</Typography></TableCell>
                      <TableCell sx={{ py: "8px", px: "12px" }}><span style={{ fontFamily: "monospace", fontSize: 11, color: C.gray500 }}>{row.variation_id || "—"}</span></TableCell>
                      <TableCell sx={{ textAlign: "center", py: "8px", px: "12px" }}>
                        {row.stock_type
                          ? <Chip label={row.stock_type} size="small" sx={{ fontSize: 11, fontWeight: 700, background: stS.bg, color: stS.color, border: `1px solid ${stS.border}`, "& .MuiChip-label": { px: "8px" } }} />
                          : <span style={{ color: C.gray300 }}>—</span>}
                      </TableCell>
                      <TableCell sx={{ textAlign: "right", py: "8px", px: "12px" }}>
                        <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 15, color: C.gray800 }}>{row.current_stock ?? "—"}</span>
                      </TableCell>
                      <TableCell sx={{ textAlign: "center", py: "6px", px: "12px" }}>
                        {isEdit ? (
                          <Box sx={{ display: "flex", alignItems: "center", gap: "4px" }}>
                            <TextField autoFocus size="small" type="number" value={editVal} onChange={e => setEditVal(e.target.value)}
                              onKeyDown={e => { if (e.key === "Enter") saveEdit(row.id); if (e.key === "Escape") setEditingId(null); }}
                              placeholder="new count" sx={{ width: 80, "& input": { fontSize: 12, py: "4px", textAlign: "right" } }} />
                            <IconButton size="small" onClick={() => saveEdit(row.id)} disabled={saving} sx={{ color: C.green, p: "3px" }}>
                              {saving ? <CircularProgress size={14} /> : "✓"}
                            </IconButton>
                            <IconButton size="small" onClick={() => setEditingId(null)} sx={{ color: C.gray400, p: "3px" }}>✕</IconButton>
                          </Box>
                        ) : (
                          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
                            {hasEdit
                              ? <Chip label={row.edit_stock} size="small" onClick={() => { setEditingId(row.id); setEditVal(String(row.edit_stock)); }}
                                  sx={{ fontFamily: "monospace", fontWeight: 800, fontSize: 13, background: "#EFF6FF", color: "#2563EB", border: "1px solid #BFDBFE", "& .MuiChip-label": { px: "10px" }, cursor: "pointer" }} />
                              : <Typography sx={{ fontSize: 12, color: C.gray300 }}>—</Typography>}
                            <IconButton size="small" onClick={() => { setEditingId(row.id); setEditVal(hasEdit ? String(row.edit_stock) : ""); }}
                              sx={{ color: C.gray400, p: "2px", opacity: 0.45, "&:hover": { opacity: 1, color: C.orange } }}>✏</IconButton>
                          </Box>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Box>
        </Paper>
      ))}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Price Fix Sheet View
// ═══════════════════════════════════════════════════════════════════════════════
let _rowKey = 1;
function uid() { return ++_rowKey; }

function PriceFixView() {
  const [minProfit,  setMinProfit]  = useState("50");
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState("");
  const [rows,       setRows]       = useState([]);           // editable sheet rows
  const [generating, setGenerating] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const loadLossSKUs = async () => {
    setLoading(true); setError(""); setRows([]);
    try {
      const res  = await fetch(`${API}/meesho-stock/price-fix/?min_profit=${minProfit}`);
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed."); return; }
      setRows(data.items.map(it => ({
        _key:         uid(),
        catalog_id:   it.catalog_id,
        product_id:   it.product_id,
        variation_name: it.variation,
        variation_id: it.variation_id,
        new_msp:      it.suggested_msp != null ? String(it.suggested_msp) : "",
        wdrp:         "",
        new_mrp:      "",
        // display-only
        catalog_name: it.catalog_name,
        product_name: it.product_name,
        sku:          it.sku,
        cost:         it.cost,
        avg_settlement: it.avg_settlement,
        profit:       it.profit,
        order_count:  it.order_count,
      })));
      setLoadedOnce(true);
    } catch { setError("Network error."); }
    finally { setLoading(false); }
  };

  const updateRow = (key, field, val) =>
    setRows(prev => prev.map(r => r._key === key ? { ...r, [field]: val } : r));

  const deleteRow = (key) =>
    setRows(prev => prev.filter(r => r._key !== key));

  const addRow = () =>
    setRows(prev => [...prev, {
      _key: uid(), catalog_id: "", product_id: "", variation_name: "",
      variation_id: "", new_msp: "", wdrp: "", new_mrp: "",
      catalog_name: "", product_name: "", sku: "", cost: null,
      avg_settlement: null, profit: null, order_count: null,
    }]);

  const generateSheet = async () => {
    if (!rows.length) return;
    setGenerating(true);
    try {
      const res = await fetch(`${API}/meesho-stock/generate-price-sheet/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: rows.map(r => ({
            catalog_id:    r.catalog_id,
            product_id:    r.product_id,
            variation_name: r.variation_name,
            variation_id:  r.variation_id,
            new_msp:       r.new_msp,
            wdrp:          r.wdrp,
            new_mrp:       r.new_mrp,
          })),
        }),
      });
      if (!res.ok) { setError("Sheet generation failed."); return; }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url; a.download = "meesho_price_update.xlsx"; a.click();
      URL.revokeObjectURL(url);
    } catch { setError("Network error."); }
    finally { setGenerating(false); }
  };

  const lossCount    = rows.filter(r => r.profit != null && r.profit < 0).length;
  const lowProfCount = rows.filter(r => r.profit != null && r.profit >= 0 && r.profit < parseFloat(minProfit || 50)).length;

  return (
    <>
      {/* Controls */}
      <Paper elevation={0} sx={{ border: `1px solid ${C.border}`, borderRadius: 2, p: "14px 18px", mb: "16px" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: C.gray700 }}>Min Profit Threshold</Typography>
          <TextField
            size="small" type="number" value={minProfit} onChange={e => setMinProfit(e.target.value)}
            inputProps={{ min: 0, step: 10 }}
            sx={{ width: 90, "& input": { fontSize: 13, fontWeight: 700, textAlign: "center" } }}
            InputProps={{ startAdornment: <span style={{ fontSize: 12, color: C.gray400, marginRight: 2 }}>₹</span> }}
          />
          <Button variant="contained" size="small" onClick={loadLossSKUs} disabled={loading}
            sx={{ background: "#DC2626", color: "#fff", fontWeight: 700, textTransform: "none", fontSize: 13, "&:hover": { background: "#B91C1C" } }}>
            {loading ? <CircularProgress size={14} sx={{ mr: "6px", color: "#fff" }} /> : "🔍 "}
            Load Loss SKUs
          </Button>
          {loadedOnce && (
            <>
              {lossCount > 0    && <Chip label={`${lossCount} in loss`}     size="small" sx={{ background: "#FEE2E2", color: "#DC2626", border: "1px solid #FCA5A5", fontWeight: 700 }} />}
              {lowProfCount > 0 && <Chip label={`${lowProfCount} low profit`} size="small" sx={{ background: "#FEF3C7", color: "#D97706", border: "1px solid #FDE68A", fontWeight: 700 }} />}
              <Chip label={`${rows.length} total rows`} size="small" sx={{ background: C.gray100, color: C.gray600, fontWeight: 600 }} />
            </>
          )}
        </Box>
        <Typography sx={{ fontSize: 11, color: C.gray400, mt: "8px" }}>
          Finds products where average profit (settlement − cost) is below ₹{minProfit}. Pre-fills catalog/product/variation from the uploaded stock sheet, and suggests a new MSP.
        </Typography>
      </Paper>

      {error && <Alert severity="error" sx={{ mb: "14px" }} onClose={() => setError("")}>{error}</Alert>}

      {/* No data yet */}
      {!loading && rows.length === 0 && !loadedOnce && (
        <Paper elevation={0} sx={{ border: `2px dashed ${C.border}`, borderRadius: 3, p: "50px 24px", textAlign: "center" }}>
          <Typography sx={{ fontSize: 30, mb: "10px" }}>📉</Typography>
          <Typography sx={{ fontSize: 15, fontWeight: 700, color: C.gray600, mb: "6px" }}>Click "Load Loss SKUs" to begin</Typography>
          <Typography sx={{ fontSize: 13, color: C.gray400 }}>Requires the stock sheet uploaded and purchase prices configured in Pricing tab</Typography>
        </Paper>
      )}

      {loading && <Box sx={{ display: "flex", justifyContent: "center", py: "50px" }}><CircularProgress sx={{ color: "#DC2626" }} /></Box>}

      {/* Sheet editor */}
      {rows.length > 0 && (
        <>
          <Paper elevation={0} sx={{ border: `1px solid ${C.border}`, borderRadius: 2, overflow: "hidden", mb: "16px" }}>
            <Box sx={{ overflowX: "auto" }}>
              <Table size="small" sx={{ width: "100%", borderCollapse: "collapse" }}>
                <TableHead>
                  <TableRow>
                    {[
                      ["#",            "left",   36],
                      ["Catalog",      "left",   160],
                      ["Product",      "left",   160],
                      ["Cost",         "right",  70],
                      ["Avg Settle",   "right",  80],
                      ["Profit",       "center", 80],
                      ["Orders",       "center", 65],
                      ["Catalog ID ✎", "left",   110],
                      ["Product ID ✎", "left",   110],
                      ["Variation Name ✎", "left", 150],
                      ["Variation ID ✎",   "left", 120],
                      ["New MSP ✎",    "right",  110],
                      ["WDRP ✎",       "right",  90],
                      ["New MRP ✎",    "right",  90],
                      ["",             "center", 36],
                    ].map(([h, a, w]) => (
                      <TableCell key={h} sx={{ textAlign: a, fontSize: 10, fontWeight: 700, color: C.gray500, textTransform: "uppercase", letterSpacing: "0.05em", background: C.gray50, whiteSpace: "nowrap", borderBottom: `1px solid ${C.border}`, py: "9px", px: "10px", minWidth: w }}>
                        {h}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row, ri) => (
                    <TableRow key={row._key} sx={{ background: ri % 2 === 0 ? C.white : C.gray50, "&:hover": { background: "#FFF7ED" } }}>
                      <TableCell sx={{ color: C.gray400, fontSize: 11, py: "6px", px: "10px" }}>{ri + 1}</TableCell>
                      {/* Read-only info */}
                      <TableCell sx={{ py: "6px", px: "10px", maxWidth: 160 }}>
                        <Tooltip title={row.catalog_name || ""}>
                          <Typography sx={{ fontSize: 11, color: C.gray700, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 150 }}>
                            {row.catalog_name || <span style={{ color: C.gray300 }}>—</span>}
                          </Typography>
                        </Tooltip>
                      </TableCell>
                      <TableCell sx={{ py: "6px", px: "10px", maxWidth: 160 }}>
                        <Tooltip title={row.product_name || row.sku || ""}>
                          <Typography sx={{ fontSize: 11, color: C.gray600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 150 }}>
                            {row.product_name || row.sku || <span style={{ color: C.gray300 }}>—</span>}
                          </Typography>
                        </Tooltip>
                      </TableCell>
                      <TableCell sx={{ textAlign: "right", py: "6px", px: "10px" }}>
                        <span style={{ fontFamily: "monospace", fontSize: 12, color: C.gray600 }}>
                          {row.cost != null ? `₹${row.cost}` : "—"}
                        </span>
                      </TableCell>
                      <TableCell sx={{ textAlign: "right", py: "6px", px: "10px" }}>
                        <span style={{ fontFamily: "monospace", fontSize: 12, color: C.gray600 }}>
                          {row.avg_settlement != null ? `₹${row.avg_settlement}` : "—"}
                        </span>
                      </TableCell>
                      <TableCell sx={{ textAlign: "center", py: "6px", px: "10px" }}>
                        <ProfitChip value={row.profit} />
                      </TableCell>
                      <TableCell sx={{ textAlign: "center", py: "6px", px: "10px" }}>
                        <span style={{ fontSize: 11, color: C.gray500 }}>{row.order_count ?? "—"}</span>
                      </TableCell>

                      {/* Editable sheet fields */}
                      {[
                        ["catalog_id",    110],
                        ["product_id",    110],
                        ["variation_name",150],
                        ["variation_id",  120],
                      ].map(([field, w]) => (
                        <TableCell key={field} sx={{ py: "4px", px: "6px" }}>
                          <TextField
                            size="small" value={row[field] || ""}
                            onChange={e => updateRow(row._key, field, e.target.value)}
                            sx={{ width: w, "& input": { fontSize: 11, py: "4px", px: "6px" } }}
                          />
                        </TableCell>
                      ))}

                      {/* MSP / WDRP / MRP — numeric */}
                      {[["new_msp","#7C3AED",110],["wdrp",C.gray500,90],["new_mrp",C.gray500,90]].map(([field, color, w]) => (
                        <TableCell key={field} sx={{ py: "4px", px: "6px" }}>
                          <TextField
                            size="small" type="number" value={row[field] || ""}
                            onChange={e => updateRow(row._key, field, e.target.value)}
                            placeholder={field === "new_msp" ? "required" : "optional"}
                            sx={{ width: w, "& input": { fontSize: 12, py: "4px", px: "6px", textAlign: "right", color, fontWeight: field === "new_msp" ? 700 : 400 } }}
                          />
                        </TableCell>
                      ))}

                      <TableCell sx={{ textAlign: "center", py: "6px", px: "6px" }}>
                        <IconButton size="small" onClick={() => deleteRow(row._key)}
                          sx={{ color: "#FCA5A5", "&:hover": { color: "#DC2626", background: "#FEE2E2" }, p: "3px" }}>
                          ✕
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </Paper>

          {/* Bottom actions */}
          <Box sx={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
            <Button variant="outlined" size="small" onClick={addRow}
              sx={{ borderColor: C.gray300, color: C.gray600, fontWeight: 600, textTransform: "none", fontSize: 13 }}>
              + Add Row
            </Button>
            <Button variant="contained" size="small" onClick={generateSheet} disabled={generating || !rows.some(r => r.new_msp)}
              sx={{ background: "#16A34A", color: "#fff", fontWeight: 700, textTransform: "none", fontSize: 13, "&:hover": { background: "#15803D" }, ml: "auto" }}>
              {generating ? <CircularProgress size={14} sx={{ mr: "6px", color: "#fff" }} /> : "⬇ "}
              Generate &amp; Download XLSX
            </Button>
            <Typography sx={{ fontSize: 11, color: C.gray400 }}>
              {rows.filter(r => r.new_msp).length} of {rows.length} rows have a new MSP
            </Typography>
          </Box>
        </>
      )}

      {loadedOnce && rows.length === 0 && !loading && (
        <Alert severity="success" sx={{ borderRadius: 2 }}>
          No SKUs found with profit below ₹{minProfit}. All products are profitable at this threshold.
        </Alert>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Tab
// ═══════════════════════════════════════════════════════════════════════════════
export function MeeshoStockTab() {
  const [view, setView] = useState("stock");

  return (
    <Box sx={{ p: "20px 24px", maxWidth: 1400, mx: "auto" }}>
      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "center", gap: "12px", mb: "4px" }}>
        <Typography sx={{ fontSize: 22, fontWeight: 800, color: C.gray800 }}>📦 Meesho Stock Sheet</Typography>
      </Box>

      {/* View tabs */}
      <Box sx={{ display: "flex", borderBottom: `1px solid ${C.border}`, mb: "20px" }}>
        <ViewTab active={view === "stock"}    onClick={() => setView("stock")}>Stock Data</ViewTab>
        <ViewTab active={view === "pricefix"} onClick={() => setView("pricefix")}>📉 Price Fix Sheet</ViewTab>
      </Box>

      {view === "stock"    && <StockDataView />}
      {view === "pricefix" && <PriceFixView />}
    </Box>
  );
}
