import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, IconButton,
  Paper, Snackbar, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from "@mui/material";
import PrintIcon from "@mui/icons-material/Print";
import DeleteIcon from "@mui/icons-material/Delete";
import RefreshIcon from "@mui/icons-material/Refresh";
import QrCode2Icon from "@mui/icons-material/QrCode2";
import { API, C } from "../../App";

// ── Label sizes ────────────────────────────────────────────────────────────────
const LABEL_SIZES = {
  "4in": { key: "4in", title: '4" × 2" — Carton / Box Label', width: 4, height: 2 },
  "1in": { key: "1in", title: '1" × 1" — Small Piece Sticker', width: 1, height: 1 },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function StockChip({ value, label }) {
  const n = Number(value) || 0;
  const color = n <= 0 ? C.red : n <= 5 ? C.amber : C.green;
  const bg = n <= 0 ? "#FFF1F2" : n <= 5 ? "#FFFBEB" : "#ECFDF5";
  return (
    <Chip label={`${label}: ${n}`} size="small"
      sx={{ bgcolor: bg, color, border: `1px solid ${color}40`, fontWeight: 700, fontSize: 11 }} />
  );
}

function SectionLoader() {
  return (
    <Box display="flex" justifyContent="center" alignItems="center" py={8}>
      <CircularProgress size={36} sx={{ color: C.orange }} />
    </Box>
  );
}

function KpiCard({ label, value, sub, color = C.orange }) {
  return (
    <Paper variant="outlined" sx={{ flex: 1, minWidth: 150, p: 2, borderRadius: 3, borderColor: "#E2E8F0" }}>
      <Typography variant="caption" color="text.secondary" fontWeight={600} textTransform="uppercase" letterSpacing={0.5}>
        {label}
      </Typography>
      <Typography variant="h5" fontWeight={800} color={color}>{value}</Typography>
      {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
    </Paper>
  );
}

// ── Barcode rendering (client-side, Code128, encodes the Parent SKU) ──────────
function BarcodeSVG({ value, height, width }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !value) return;
    try {
      JsBarcode(ref.current, value, { format: "CODE128", displayValue: false, height, width, margin: 0 });
    } catch {
      /* value has characters CODE128 can't encode — leave blank rather than crash */
    }
  }, [value, height, width]);
  return <svg ref={ref} style={{ display: "block", maxWidth: "100%" }} />;
}

function PrintLabel({ sku, sizeKey }) {
  const big = sizeKey === "4in";
  return (
    <div
      className="inv-print-label"
      style={{
        width: big ? "4in" : "1in",
        height: big ? "2in" : "1in",
        boxSizing: "border-box",
        padding: big ? "0.18in 0.3in" : "0.06in",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: big ? 8 : 2,
      }}
    >
      <div style={{
        fontSize: big ? 22 : 8, fontWeight: 800, fontFamily: "monospace",
        textAlign: "center", wordBreak: "break-all", lineHeight: 1.15,
      }}>
        {sku}
      </div>
      <BarcodeSVG value={sku} height={big ? 56 : 22} width={big ? 2.2 : 1} />
    </div>
  );
}

// ── Print Labels section ───────────────────────────────────────────────────────
function PrintLabelsSection({ rows }) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState({}); // sku_id -> copies
  const [sizeKey, setSizeKey] = useState("4in");
  const [printJob, setPrintJob] = useState(null); // { size, items: [sku, ...] }

  const filtered = rows.filter(r => !search || r.sku_id.toLowerCase().includes(search.toLowerCase()));

  const toggleRow = (sku_id) => {
    setSelected(prev => {
      const next = { ...prev };
      if (next[sku_id] != null) delete next[sku_id];
      else next[sku_id] = 1;
      return next;
    });
  };

  const setQty = (sku_id, qty) => {
    setSelected(prev => ({ ...prev, [sku_id]: Math.max(1, parseInt(qty, 10) || 1) }));
  };

  const selectAllVisible = () => {
    setSelected(prev => {
      const next = { ...prev };
      filtered.forEach(r => { if (next[r.sku_id] == null) next[r.sku_id] = 1; });
      return next;
    });
  };
  const clearSelection = () => setSelected({});

  const selectedCount = Object.keys(selected).length;
  const totalCopies = Object.values(selected).reduce((a, b) => a + b, 0);

  const handlePrint = () => {
    const items = [];
    Object.entries(selected).forEach(([sku, qty]) => { for (let i = 0; i < qty; i++) items.push(sku); });
    if (items.length === 0) return;
    setPrintJob({ size: sizeKey, items });
  };

  useEffect(() => {
    if (!printJob) return;
    const dims = LABEL_SIZES[printJob.size];
    const style = document.createElement("style");
    style.innerHTML = `@page { size: ${dims.width}in ${dims.height}in; margin: 0; }`;
    document.head.appendChild(style);

    const afterPrint = () => setPrintJob(null);
    window.addEventListener("afterprint", afterPrint);
    // small delay so the labels + barcodes are painted before the print dialog opens
    const t = setTimeout(() => window.print(), 150);
    return () => {
      clearTimeout(t);
      window.removeEventListener("afterprint", afterPrint);
      style.remove();
    };
  }, [printJob]);

  return (
    <Stack spacing={2}>
      <style>{`
        #inv-printable-labels { display: none; }
        @media print {
          body * { visibility: hidden; }
          #inv-printable-labels, #inv-printable-labels * { visibility: visible; }
          #inv-printable-labels {
            display: block !important; position: absolute; left: 0; top: 0;
          }
          .inv-print-label { page-break-after: always; break-after: page; }
        }
      `}</style>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "center" }} justifyContent="space-between">
        <TextField size="small" placeholder="Search SKU…" value={search} onChange={e => setSearch(e.target.value)} sx={{ width: 220 }} />
        <ToggleButtonGroup exclusive size="small" value={sizeKey} onChange={(_, v) => v && setSizeKey(v)}>
          {Object.values(LABEL_SIZES).map(s => (
            <ToggleButton key={s.key} value={s.key} sx={{ textTransform: "none", fontSize: 12, fontWeight: 600, px: 1.5 }}>
              {s.title}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Stack>

      <Stack useFlexGap direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap" }}>
        <Button size="small" onClick={selectAllVisible} sx={{ textTransform: "none" }}>Select all visible</Button>
        <Button size="small" onClick={clearSelection} sx={{ textTransform: "none" }} disabled={selectedCount === 0}>Clear</Button>
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
          {selectedCount} SKU{selectedCount === 1 ? "" : "s"} selected · {totalCopies} label{totalCopies === 1 ? "" : "s"} to print
        </Typography>
        <Button
          variant="contained" startIcon={<PrintIcon />} onClick={handlePrint} disabled={totalCopies === 0}
          sx={{ bgcolor: C.orange, "&:hover": { bgcolor: "#5B21B6" }, textTransform: "none" }}
        >
          Print {totalCopies || ""} Label{totalCopies === 1 ? "" : "s"}
        </Button>
      </Stack>

      <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 3, borderColor: "#E2E8F0" }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: "#F8FAFC" }}>
              <TableCell padding="checkbox" />
              {["Parent SKU (barcode value)", "Current Stock", "Packed Stock", "Copies"].map(h => (
                <TableCell key={h} sx={{ fontWeight: 700, fontSize: 12, color: "#64748B", py: 1.5 }}>{h}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow><TableCell colSpan={5} align="center" sx={{ py: 6, color: "text.secondary" }}>No SKUs found</TableCell></TableRow>
            ) : filtered.map(row => {
              const isSel = selected[row.sku_id] != null;
              return (
                <TableRow key={row.sku_id} hover selected={isSel}>
                  <TableCell padding="checkbox">
                    <Checkbox size="small" checked={isSel} onChange={() => toggleRow(row.sku_id)} />
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700, color: C.orange, fontSize: 13, fontFamily: "monospace" }}>{row.sku_id}</TableCell>
                  <TableCell><StockChip value={row.current_stock} label="Stock" /></TableCell>
                  <TableCell><StockChip value={row.packed_stock} label="Packed" /></TableCell>
                  <TableCell>
                    <TextField
                      size="small" type="number" value={selected[row.sku_id] ?? 1}
                      onChange={e => setQty(row.sku_id, e.target.value)}
                      disabled={!isSel}
                      inputProps={{ min: 1, style: { width: 56, padding: "4px 8px" } }}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {printJob && (
        <div id="inv-printable-labels">
          {printJob.items.map((sku, i) => <PrintLabel key={i} sku={sku} sizeKey={printJob.size} />)}
        </div>
      )}
    </Stack>
  );
}

// ── Packed Stock section ────────────────────────────────────────────────────────
function PackedStockSection({ rows, packedTotals, events, onAdd, onUndo, adding }) {
  const [code, setCode] = useState("");
  const [qty, setQty] = useState(1);
  const codeRef = useRef(null);

  const merged = useMemo(() => rows
    .map(r => ({ sku_id: r.sku_id, current_stock: r.current_stock, packed_stock: packedTotals[r.sku_id] || 0 }))
    .sort((a, b) => b.packed_stock - a.packed_stock || a.sku_id.localeCompare(b.sku_id)),
    [rows, packedTotals]);

  const submit = async () => {
    const c = code.trim();
    if (!c) return;
    const ok = await onAdd(c, Math.max(1, parseInt(qty, 10) || 1));
    if (ok) { setCode(""); setQty(1); codeRef.current?.focus(); }
  };

  const handleKeyDown = (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } };

  const totalPacked = Object.values(packedTotals).reduce((a, b) => a + (b || 0), 0);

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <KpiCard label="SKUs Labelled & Packed" value={Object.keys(packedTotals).length} color={C.blue} />
        <KpiCard label="Total Units Packed" value={totalPacked} color={C.green} />
      </Stack>

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, borderColor: "#E2E8F0" }}>
        <Typography variant="subtitle2" fontWeight={700} mb={1.5}>
          <QrCode2Icon fontSize="small" sx={{ verticalAlign: "middle", mr: 0.5, color: C.orange }} />
          Scan or type a printed label's code to add it to packed stock
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
          <TextField
            inputRef={codeRef} autoFocus fullWidth size="small" label="Barcode / Parent SKU"
            placeholder="Scan with a USB barcode scanner, or type and press Enter"
            value={code} onChange={e => setCode(e.target.value)} onKeyDown={handleKeyDown}
          />
          <TextField
            size="small" label="Qty" type="number" value={qty}
            onChange={e => setQty(e.target.value)} sx={{ width: { xs: "100%", sm: 100 } }}
            inputProps={{ min: 1 }}
          />
          <Button
            variant="contained" onClick={submit} disabled={adding || !code.trim()}
            sx={{ bgcolor: C.green, "&:hover": { bgcolor: "#047857" }, textTransform: "none", whiteSpace: "nowrap" }}
          >
            {adding ? <CircularProgress size={18} color="inherit" /> : "Add to Packed"}
          </Button>
        </Stack>
      </Paper>

      <Typography variant="subtitle2" fontWeight={700}>Packed Stock by SKU</Typography>
      <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 3, borderColor: "#E2E8F0" }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: "#F8FAFC" }}>
              {["Parent SKU", "Current Stock", "Packed Stock", "Still to Pack"].map(h => (
                <TableCell key={h} sx={{ fontWeight: 700, fontSize: 12, color: "#64748B", py: 1.5 }}>{h}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {merged.length === 0 ? (
              <TableRow><TableCell colSpan={4} align="center" sx={{ py: 6, color: "text.secondary" }}>No SKUs yet</TableCell></TableRow>
            ) : merged.map(r => {
              const remaining = Math.max(0, (r.current_stock || 0) - (r.packed_stock || 0));
              return (
                <TableRow key={r.sku_id} hover>
                  <TableCell sx={{ fontWeight: 700, color: C.orange, fontSize: 13, fontFamily: "monospace" }}>{r.sku_id}</TableCell>
                  <TableCell>{r.current_stock}</TableCell>
                  <TableCell sx={{ fontWeight: 700, color: C.green }}>{r.packed_stock}</TableCell>
                  <TableCell>
                    {remaining > 0
                      ? <Chip label={remaining} size="small" sx={{ bgcolor: "#FFFBEB", color: C.amber, fontWeight: 700 }} />
                      : <Chip label="✓ Done" size="small" sx={{ bgcolor: "#ECFDF5", color: C.green, fontWeight: 700 }} />}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <Typography variant="subtitle2" fontWeight={700}>Recent Scans</Typography>
      <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 3, borderColor: "#E2E8F0" }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: "#F8FAFC" }}>
              {["Time", "Parent SKU", "Qty", "Notes", ""].map(h => (
                <TableCell key={h} sx={{ fontWeight: 700, fontSize: 12, color: "#64748B", py: 1.5 }}>{h}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {events.length === 0 ? (
              <TableRow><TableCell colSpan={5} align="center" sx={{ py: 6, color: "text.secondary" }}>No scans yet</TableCell></TableRow>
            ) : events.map(e => (
              <TableRow key={e.id} hover>
                <TableCell sx={{ fontSize: 12, whiteSpace: "nowrap" }}>
                  {new Date(e.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                </TableCell>
                <TableCell sx={{ fontWeight: 700, color: C.orange, fontSize: 13, fontFamily: "monospace" }}>{e.sku_id}</TableCell>
                <TableCell sx={{ fontWeight: 700, color: e.quantity >= 0 ? C.green : C.red }}>
                  {e.quantity >= 0 ? `+${e.quantity}` : e.quantity}
                </TableCell>
                <TableCell sx={{ fontSize: 12, color: "text.secondary" }}>{e.notes || "—"}</TableCell>
                <TableCell>
                  <Tooltip title="Undo this entry">
                    <IconButton size="small" onClick={() => onUndo(e.id)} sx={{ color: C.red }}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Stack>
  );
}

// ── Main InventoryLabelsTab ─────────────────────────────────────────────────────
export function InventoryLabelsTab() {
  const [section, setSection] = useState(0);
  const [stockRows, setStockRows] = useState([]);
  const [labelRows, setLabelRows] = useState([]);
  const [packedTotals, setPackedTotals] = useState({});
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState("");
  const [err, setErr] = useState("");

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [invRes, labelsRes, packedRes] = await Promise.all([
        fetch(`${API}/inventory/`),
        fetch(`${API}/inventory/labels/`),
        fetch(`${API}/inventory/packed/`),
      ]);
      const [inv, labels, packed] = await Promise.all([invRes.json(), labelsRes.json(), packedRes.json()]);
      setStockRows(inv.results || []);
      setLabelRows(labels.results || []);
      const totals = {};
      (packed.totals || []).forEach(t => { totals[t.sku_id] = t.packed_stock; });
      setPackedTotals(totals);
      setEvents(packed.events || []);
    } catch {
      setErr("Failed to load inventory data.");
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const rows = useMemo(() => {
    const map = new Map();
    stockRows.forEach(r => map.set(r.sku_id, { sku_id: r.sku_id, current_stock: r.current_stock || 0, packed_stock: 0 }));
    labelRows.forEach(r => {
      if (!map.has(r.sku_id)) map.set(r.sku_id, { sku_id: r.sku_id, current_stock: 0, packed_stock: r.packed_stock || 0 });
    });
    return Array.from(map.values()).sort((a, b) => a.sku_id.localeCompare(b.sku_id));
  }, [stockRows, labelRows]);

  const addPacked = async (code, qty) => {
    setAdding(true);
    try {
      const res = await fetch(`${API}/inventory/packed/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, quantity: qty }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || "Failed to add"); setAdding(false); return false; }
      setToast(`+${qty} packed — ${data.sku_id} now has ${data.packed_stock} packed`);
      await loadAll();
      setAdding(false);
      return true;
    } catch {
      setErr("Failed to add"); setAdding(false); return false;
    }
  };

  const undoEvent = async (id) => {
    const res = await fetch(`${API}/inventory/packed/${id}/`, { method: "DELETE" });
    if (res.ok || res.status === 204) { setToast("Entry removed"); loadAll(); }
    else setErr("Failed to remove entry");
  };

  const sections = ["Print Labels", "Packed Stock"];

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1400, mx: "auto" }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" mb={3}>
        <Box>
          <Typography variant="h5" fontWeight={800} color="text.primary">Inventory Labels & Barcodes</Typography>
          <Typography variant="caption" color="text.secondary">
            Print a barcode label per Parent SKU, paste it on your stock, then scan it here to track packed inventory
          </Typography>
        </Box>
        <Tooltip title="Refresh">
          <IconButton onClick={loadAll}><RefreshIcon fontSize="small" /></IconButton>
        </Tooltip>
      </Stack>

      <Stack direction="row" spacing={0.5} mb={3} p={0.5} sx={{ bgcolor: "#F1F5F9", borderRadius: 2.5, display: "inline-flex" }}>
        {sections.map((s, i) => (
          <Button key={s} onClick={() => setSection(i)}
            sx={{
              textTransform: "none", fontWeight: 700, fontSize: 14, px: 2.5, py: 0.75,
              borderRadius: 2, transition: "all 0.15s",
              bgcolor: section === i ? "#fff" : "transparent",
              color: section === i ? C.orange : "#64748B",
              boxShadow: section === i ? "0 1px 4px rgba(0,0,0,0.1)" : "none",
              "&:hover": { bgcolor: section === i ? "#fff" : "#E2E8F0" },
            }}>
            {s}
          </Button>
        ))}
      </Stack>

      {err && <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }} onClose={() => setErr("")}>{err}</Alert>}

      {loading ? <SectionLoader /> : (
        <>
          {section === 0 && <PrintLabelsSection rows={rows} />}
          {section === 1 && (
            <PackedStockSection rows={rows} packedTotals={packedTotals} events={events}
              onAdd={addPacked} onUndo={undoEvent} adding={adding} />
          )}
        </>
      )}

      <Snackbar open={!!toast} autoHideDuration={3000} onClose={() => setToast("")}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
        <Alert severity="success" onClose={() => setToast("")} sx={{ borderRadius: 2 }}>{toast}</Alert>
      </Snackbar>
    </Box>
  );
}
