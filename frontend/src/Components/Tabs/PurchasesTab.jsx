import React, { useState, useEffect, useCallback } from "react";
import { API, C, fmt } from "../../App";

// MUI core
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Checkbox,
  IconButton,
  MenuItem,
  Paper,
  Select,
  TextField,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Pagination,
  Alert,
} from "@mui/material";

// MUI DataGrid
import { DataGrid } from "@mui/x-data-grid";

// ── helpers ───────────────────────────────────────────────────────────────────
const today = () => new Date().toISOString().slice(0, 10);

function emptyItem() {
  return { parent_sku_id: "", product_description: "", quantity: 1, price_per_unit: "", is_exchange: false };
}

function calcTotal(items) {
  return items.reduce((s, it) => {
    if (it.is_exchange) return s;
    const qty   = parseInt(it.quantity, 10)  || 0;
    const price = parseFloat(it.price_per_unit) || 0;
    return s + qty * price;
  }, 0);
}

function fmtDate(d) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

// ── Bill Form Modal ───────────────────────────────────────────────────────────
function BillModal({ initial, parentSkus, onSave, onClose }) {
  const [date,    setDate]    = useState(initial?.date       || today());
  const [seller,  setSeller]  = useState(initial?.seller_name || "");
  const [billNo,  setBillNo]  = useState(initial?.bill_number || "");
  const [notes,   setNotes]   = useState(initial?.notes      || "");
  const [items,   setItems]   = useState(
    initial?.items?.length ? initial.items.map(i => ({ ...i })) : [emptyItem()]
  );
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState("");

  const setItem = (idx, field, value) =>
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it));

  const addItem    = () => setItems(prev => [...prev, emptyItem()]);
  const removeItem = (idx) => setItems(prev => prev.filter((_, i) => i !== idx));

  const grandTotal = calcTotal(items);

  const handleSave = async () => {
    if (!date || !seller.trim()) { setError("Date and seller name are required."); return; }
    if (items.length === 0)      { setError("Add at least one item."); return; }
    for (const it of items) {
      if (!it.parent_sku_id.trim()) { setError("Select a SKU for every item."); return; }
      if (!it.is_exchange && (!(parseFloat(it.price_per_unit) > 0))) {
        setError("Enter a valid price for non-exchange items."); return;
      }
    }
    setSaving(true); setError("");
    try {
      const method = initial?.id ? "PUT" : "POST";
      const url    = initial?.id ? `${API}/purchases/${initial.id}/` : `${API}/purchases/`;
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, seller_name: seller, bill_number: billNo, notes, items }),
      });
      if (!res.ok) { setError("Save failed. Check your inputs."); setSaving(false); return; }
      const saved = await res.json();
      onSave(saved);
    } catch {
      setError("Network error."); setSaving(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
      <DialogTitle sx={{ pb: 1, borderBottom: `1px solid ${C.border}` }}>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Box>
            <Typography variant="h6" fontWeight={800} color={C.gray800}>
              {initial?.id ? "Edit Purchase Bill" : "New Purchase Bill"}
            </Typography>
            <Typography variant="caption" color={C.gray400}>
              All data is preserved and reflected in inventory.
            </Typography>
          </Box>
          <IconButton size="small" onClick={onClose}>✕</IconButton>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ pt: 2, display: "flex", flexDirection: "column", gap: 2 }}>
        {/* Row 1 — Date / Seller / Bill No */}
        <Box display="grid" gridTemplateColumns="1fr 1fr 1fr" gap={2}>
          <TextField
            label="Date *"
            type="date"
            size="small"
            value={date}
            onChange={e => setDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            label="Seller / Vendor *"
            size="small"
            value={seller}
            onChange={e => setSeller(e.target.value)}
            placeholder="e.g. Raj Textiles"
          />
          <TextField
            label="Bill / Invoice No."
            size="small"
            value={billNo}
            onChange={e => setBillNo(e.target.value)}
            placeholder="e.g. INV-001"
          />
        </Box>

        {/* Notes */}
        <TextField
          label="Notes"
          size="small"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Optional notes…"
          fullWidth
        />

        {/* Items section */}
        <Box>
          <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
            <Typography variant="subtitle2" sx={{ fontSize: 11, fontWeight: 700, color: C.gray600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Items
            </Typography>
            <Button size="small" variant="outlined" onClick={addItem}
              sx={{ borderColor: C.orange, color: C.orange, "&:hover": { borderColor: C.orange, background: C.orangeLight } }}>
              + Add Item
            </Button>
          </Box>

          {/* Column headers */}
          <Box display="grid" sx={{ gridTemplateColumns: "1.6fr 2fr 0.7fr 1.1fr 1fr 0.6fr 0.4fr", gap: 1, mb: 0.5, px: 0.5 }}>
            {["SKU", "Description", "Qty", "Price/Unit (₹)", "Total", "Exchange?", ""].map(h => (
              <Typography key={h} sx={{ fontSize: 10, fontWeight: 700, color: C.gray400, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {h}
              </Typography>
            ))}
          </Box>

          {/* Item rows */}
          {items.map((it, idx) => {
            const lineTotal = it.is_exchange ? 0 : (parseInt(it.quantity, 10) || 0) * (parseFloat(it.price_per_unit) || 0);
            return (
              <Box key={idx} display="grid"
                sx={{
                  gridTemplateColumns: "1.6fr 2fr 0.7fr 1.1fr 1fr 0.6fr 0.4fr",
                  gap: 1, mb: 1, alignItems: "center",
                  background: it.is_exchange ? "#FFFBEB" : C.gray50,
                  borderRadius: 2, p: "8px 10px",
                  border: `1px solid ${it.is_exchange ? "#FDE68A" : C.border}`,
                }}>
                {/* SKU select */}
                <Select
                  size="small"
                  value={it.parent_sku_id}
                  onChange={e => setItem(idx, "parent_sku_id", e.target.value)}
                  displayEmpty
                  sx={{ fontSize: 12 }}
                >
                  <MenuItem value=""><em>— Select SKU —</em></MenuItem>
                  {parentSkus.map(p => (
                    <MenuItem key={p.item_id} value={p.item_id} sx={{ fontSize: 12 }}>{p.item_id}</MenuItem>
                  ))}
                </Select>

                <TextField
                  size="small"
                  value={it.product_description}
                  onChange={e => setItem(idx, "product_description", e.target.value)}
                  placeholder="Description…"
                  inputProps={{ style: { fontSize: 12 } }}
                />

                <TextField
                  size="small"
                  type="number"
                  inputProps={{ min: 1, style: { fontSize: 12 } }}
                  value={it.quantity}
                  onChange={e => setItem(idx, "quantity", e.target.value)}
                />

                <TextField
                  size="small"
                  type="number"
                  inputProps={{ min: 0, step: "0.01", style: { fontSize: 12 } }}
                  value={it.price_per_unit}
                  onChange={e => setItem(idx, "price_per_unit", e.target.value)}
                  placeholder="0.00"
                  disabled={it.is_exchange}
                  sx={{ opacity: it.is_exchange ? 0.4 : 1 }}
                />

                <Typography sx={{ fontFamily: "monospace", fontSize: 13, fontWeight: 600, color: it.is_exchange ? C.gray300 : C.green, textAlign: "right" }}>
                  {it.is_exchange ? "—" : `₹${lineTotal.toFixed(2)}`}
                </Typography>

                <Box display="flex" alignItems="center" justifyContent="center">
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={it.is_exchange}
                        onChange={e => setItem(idx, "is_exchange", e.target.checked)}
                        size="small"
                        sx={{ color: C.amber, "&.Mui-checked": { color: C.amber } }}
                      />
                    }
                    label={<Typography sx={{ fontSize: 10, color: C.amber, fontWeight: 600 }}>Exch</Typography>}
                    sx={{ m: 0 }}
                  />
                </Box>

                <IconButton
                  size="small"
                  onClick={() => removeItem(idx)}
                  disabled={items.length === 1}
                  sx={{ color: C.red, opacity: items.length === 1 ? 0.3 : 1 }}
                >✕</IconButton>
              </Box>
            );
          })}

          {/* Grand total */}
          <Box display="flex" justifyContent="flex-end" mt={0.5} pt={1.5} sx={{ borderTop: `1px solid ${C.border}` }}>
            <Typography sx={{ fontSize: 14, fontWeight: 700, color: C.gray700 }}>
              Grand Total:&nbsp;
              <Box component="span" sx={{ fontFamily: "monospace", color: C.orange, fontSize: 17 }}>
                ₹{grandTotal.toFixed(2)}
              </Box>
              &nbsp;<Box component="span" sx={{ fontSize: 11, color: C.gray400 }}>(excl. exchanges)</Box>
            </Typography>
          </Box>
        </Box>

        {error && (
          <Alert severity="error" sx={{ fontSize: 13 }}>{error}</Alert>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, pt: 1.5, borderTop: `1px solid ${C.border}`, gap: 1 }}>
        <Button variant="outlined" onClick={onClose} sx={{ color: C.gray600, borderColor: C.gray200 }}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving}
          sx={{ background: C.orange, "&:hover": { background: "#5B21B6" }, fontWeight: 700 }}
        >
          {saving ? "Saving…" : initial?.id ? "Save Changes" : "Create Bill"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── View Modal (read-only bill detail) ────────────────────────────────────────
function BillViewModal({ bill, onClose, onEdit, onDownloadPdf }) {
  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
      <DialogTitle sx={{ pb: 1, borderBottom: `1px solid ${C.border}` }}>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Box>
            <Typography variant="h6" fontWeight={800} color={C.gray800}>
              Bill #{bill.bill_number || bill.id}
            </Typography>
            <Typography variant="caption" color={C.gray400}>
              {fmtDate(bill.date)} &middot; {bill.seller_name}
            </Typography>
          </Box>
          <Box display="flex" gap={1}>
            <Button size="small" variant="outlined" onClick={() => onDownloadPdf(bill.id)}
              sx={{ fontSize: 12, borderColor: C.gray200, color: C.gray600 }}>
              ⬇ PDF
            </Button>
            <Button size="small" variant="outlined" onClick={() => onEdit(bill)}
              sx={{ fontSize: 12, borderColor: C.orange, color: C.orange, background: C.orangeLight, "&:hover": { background: C.orangeLight } }}>
              ✏ Edit
            </Button>
            <IconButton size="small" onClick={onClose}>✕</IconButton>
          </Box>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ pt: 2 }}>
        {bill.notes && (
          <Typography sx={{ fontSize: 13, color: C.gray500, mb: 2, fontStyle: "italic" }}>
            {bill.notes}
          </Typography>
        )}

        <Table size="small" sx={{ fontSize: 13 }}>
          <TableHead>
            <TableRow>
              {["SKU", "Description", "Qty", "Price/Unit", "Total", "Exchange"].map(h => (
                <TableCell key={h} align={["Qty", "Price/Unit", "Total"].includes(h) ? "right" : "left"}
                  sx={{ fontWeight: 700, fontSize: 11, textTransform: "uppercase", color: C.gray500, letterSpacing: "0.06em", background: C.gray50, borderBottom: `1px solid ${C.border}` }}>
                  {h}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {bill.items.map((it, i) => (
              <TableRow key={it.id} sx={{ background: i % 2 === 0 ? "#FFFFFF" : C.gray50 }}>
                <TableCell sx={{ fontFamily: "monospace", fontWeight: 600, color: C.orange, fontSize: 12 }}>
                  {it.parent_sku_id || "—"}
                </TableCell>
                <TableCell sx={{ color: C.gray700 }}>{it.product_description || "—"}</TableCell>
                <TableCell align="right" sx={{ color: C.gray700 }}>{it.quantity}</TableCell>
                <TableCell align="right" sx={{ fontFamily: "monospace", color: C.gray700 }}>{fmt(it.price_per_unit)}</TableCell>
                <TableCell align="right" sx={{ fontFamily: "monospace", fontWeight: 600, color: C.gray700 }}>
                  {it.is_exchange
                    ? <Box component="span" sx={{ color: C.gray300 }}>—</Box>
                    : fmt(it.total_amount)}
                </TableCell>
                <TableCell align="center">
                  {it.is_exchange
                    ? <Chip label="Exchange" size="small" sx={{ fontSize: 10, fontWeight: 600, background: C.amberLight, color: C.amber, border: `1px solid #FDE68A`, height: 22 }} />
                    : <Box component="span" sx={{ color: C.gray300 }}>—</Box>}
                </TableCell>
              </TableRow>
            ))}

            {/* Grand total footer row */}
            <TableRow sx={{ background: "#FFF0EA" }}>
              <TableCell colSpan={4} sx={{ fontWeight: 700, color: C.gray700 }}>
                Grand Total (excl. exchanges)
              </TableCell>
              <TableCell align="right" sx={{ fontFamily: "monospace", fontWeight: 800, fontSize: 15, color: C.orange }}>
                {fmt(bill.total_amount)}
              </TableCell>
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Tab ──────────────────────────────────────────────────────────────────
export function PurchasesTab() {
  const [bills,      setBills]      = useState([]);
  const [total,      setTotal]      = useState(0);
  const [loading,    setLoading]    = useState(false);
  const [dateFrom,   setDateFrom]   = useState("");
  const [dateTo,     setDateTo]     = useState("");
  const [sellerQ,    setSellerQ]    = useState("");
  const [parentSkus, setParentSkus] = useState([]);
  const [showForm,   setShowForm]   = useState(false);
  const [editBill,   setEditBill]   = useState(null);
  const [viewBill,   setViewBill]   = useState(null);
  const [deleting,   setDeleting]   = useState(null);

  // Load parent SKUs once
  useEffect(() => {
    fetch(`${API}/parent-prices/`)
      .then(r => r.json())
      .then(d => setParentSkus(Array.isArray(d) ? d : (d.results || [])))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      ...(dateFrom && { date_from: dateFrom }),
      ...(dateTo   && { date_to:   dateTo }),
      ...(sellerQ  && { seller:    sellerQ }),
    });
    try {
      const r = await fetch(`${API}/purchases/?${params}`);
      if (r.ok) {
        const d = await r.json();
        setBills(d.results || []);
        setTotal(d.total || 0);
      }
    } finally { setLoading(false); }
  }, [dateFrom, dateTo, sellerQ]);

  useEffect(() => { load(); }, [load]);

  const handleSaved = (saved) => {
    setShowForm(false);
    setEditBill(null);
    load();
    if (viewBill && viewBill.id === saved.id) setViewBill(saved);
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this purchase bill? This cannot be undone.")) return;
    setDeleting(id);
    await fetch(`${API}/purchases/${id}/`, { method: "DELETE" });
    setDeleting(null);
    if (viewBill?.id === id) setViewBill(null);
    load();
  };

  const handleDownloadPdf = async (id) => {
    const resp = await fetch(`${API}/purchases/${id}/pdf/`);
    if (!resp.ok) return;
    const blob = await resp.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `purchase_bill_${id}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Summary KPIs
  const totalSpend    = bills.reduce((s, b) => s + parseFloat(b.total_amount || 0), 0);
  const totalItems    = bills.reduce((s, b) => s + b.items.length, 0);
  const uniqueSellers = [...new Set(bills.map(b => b.seller_name))].length;

  // DataGrid columns
  const columns = [
    {
      field: "date",
      headerName: "Date",
      width: 110,
      renderCell: ({ value }) => (
        <Typography sx={{ fontSize: 13, fontWeight: 600, color: C.gray700 }}>{fmtDate(value)}</Typography>
      ),
    },
    {
      field: "bill_number",
      headerName: "Bill No.",
      width: 130,
      renderCell: ({ row }) => (
        <Typography sx={{ fontFamily: "monospace", fontSize: 12, color: C.blue }}>
          {row.bill_number || `#${row.id}`}
        </Typography>
      ),
    },
    {
      field: "seller_name",
      headerName: "Seller",
      flex: 1,
      minWidth: 150,
      renderCell: ({ value }) => (
        <Typography sx={{ fontSize: 13, fontWeight: 600, color: C.gray700 }}>{value}</Typography>
      ),
    },
    {
      field: "items",
      headerName: "Items",
      width: 160,
      sortable: false,
      renderCell: ({ row }) => {
        const exchangeCount = row.items.filter(it => it.is_exchange).length;
        return (
          <Box display="flex" alignItems="center" gap={0.75}>
            <Typography sx={{ fontSize: 13, color: C.gray700 }}>
              {row.items.length} line{row.items.length !== 1 ? "s" : ""}
            </Typography>
            {exchangeCount > 0 && (
              <Chip
                label={`${exchangeCount} exchange${exchangeCount > 1 ? "s" : ""}`}
                size="small"
                sx={{ fontSize: 10, fontWeight: 600, background: C.amberLight, color: C.amber, border: `1px solid #FDE68A`, height: 20 }}
              />
            )}
          </Box>
        );
      },
    },
    {
      field: "total_amount",
      headerName: "Total Amount",
      width: 140,
      align: "right",
      headerAlign: "right",
      renderCell: ({ value }) => (
        <Typography sx={{ fontFamily: "monospace", fontWeight: 700, color: C.orange, fontSize: 13 }}>
          {fmt(value)}
        </Typography>
      ),
    },
    {
      field: "actions",
      headerName: "Actions",
      width: 160,
      sortable: false,
      renderCell: ({ row }) => (
        <Box display="flex" gap={0.75} onClick={e => e.stopPropagation()}>
          <Button
            size="small"
            variant="outlined"
            onClick={() => handleDownloadPdf(row.id)}
            sx={{ fontSize: 11, px: 1, py: 0.25, minWidth: 0, borderColor: C.gray200, color: C.gray600 }}
            title="Download PDF"
          >⬇ PDF</Button>
          <Button
            size="small"
            variant="outlined"
            onClick={() => setEditBill(row)}
            sx={{ fontSize: 11, px: 1, py: 0.25, minWidth: 0, borderColor: C.orange, color: C.orange, background: C.orangeLight, "&:hover": { background: C.orangeLight } }}
            title="Edit"
          >✏</Button>
          <Button
            size="small"
            variant="outlined"
            onClick={() => handleDelete(row.id)}
            disabled={deleting === row.id}
            sx={{ fontSize: 11, px: 1, py: 0.25, minWidth: 0, borderColor: "transparent", color: C.red }}
            title="Delete"
          >{deleting === row.id ? "…" : "✕"}</Button>
        </Box>
      ),
    },
  ];

  return (
    <Box display="flex" flexDirection="column" gap={2.5}>

      {/* Modals */}
      {(showForm || editBill) && (
        <BillModal
          initial={editBill}
          parentSkus={parentSkus}
          onSave={handleSaved}
          onClose={() => { setShowForm(false); setEditBill(null); }}
        />
      )}
      {viewBill && !editBill && (
        <BillViewModal
          bill={viewBill}
          onClose={() => setViewBill(null)}
          onEdit={(b) => { setViewBill(null); setEditBill(b); }}
          onDownloadPdf={handleDownloadPdf}
        />
      )}

      {/* Header row */}
      <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1.5}>
        <Box>
          <Typography variant="h5" fontWeight={800} color={C.gray800} mb={0.25}>
            🛒 Purchases
          </Typography>
          <Typography variant="body2" color={C.gray400}>
            Track every stock purchase; PDF bills on demand.
          </Typography>
        </Box>
        <Button
          variant="contained"
          onClick={() => setShowForm(true)}
          sx={{ background: C.orange, "&:hover": { background: "#5B21B6" }, fontWeight: 700, borderRadius: 2 }}
        >
          + New Purchase Bill
        </Button>
      </Box>

      {/* KPI strip */}
      <Box display="flex" flexWrap="wrap" gap={1.75}>
        {[
          { label: "Total Spend",     value: `₹${totalSpend.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`, accent: C.orange, icon: "💸" },
          { label: "Bills Recorded",  value: `${total}`,        accent: C.blue,  icon: "🧾" },
          { label: "Total SKU Lines", value: `${totalItems}`,   accent: C.green, icon: "📦" },
          { label: "Unique Sellers",  value: `${uniqueSellers}`, accent: C.amber, icon: "🏪" },
        ].map(k => (
          <Paper key={k.label} elevation={1} sx={{
            borderTop: `3px solid ${k.accent}`, borderRadius: 2, p: 3,
            minWidth: "max-content",
          }}>
            <Typography sx={{ fontSize: 11, fontWeight: 700, color: C.gray400, letterSpacing: "0.07em", textTransform: "uppercase", mb: 1, whiteSpace: "nowrap" }}>
              {k.icon} {k.label}
            </Typography>
            <Typography sx={{ fontSize: 22, fontWeight: 800, fontFamily: "'DM Mono', monospace", color: k.accent, whiteSpace: "nowrap" }}>
              {k.value}
            </Typography>
          </Paper>
        ))}
      </Box>

      {/* Filter bar */}
      <Paper elevation={1} sx={{ borderRadius: 2, px: 2.5, py: 1.75, display: "flex", gap: 1.5, flexWrap: "wrap", alignItems: "center" }}>
        <Typography sx={{ fontSize: 12, fontWeight: 700, color: C.gray400, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Filter
        </Typography>
        <TextField
          type="date"
          size="small"
          value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
          InputLabelProps={{ shrink: true }}
          sx={{ width: 155 }}
        />
        <Typography sx={{ color: C.gray300 }}>→</Typography>
        <TextField
          type="date"
          size="small"
          value={dateTo}
          onChange={e => setDateTo(e.target.value)}
          InputLabelProps={{ shrink: true }}
          sx={{ width: 155 }}
        />
        <Box sx={{ width: 1, height: 24, background: C.gray200 }} />
        <TextField
          size="small"
          value={sellerQ}
          onChange={e => setSellerQ(e.target.value)}
          placeholder="🔍 Seller name…"
          sx={{ width: 210 }}
        />
        {(dateFrom || dateTo || sellerQ) && (
          <Button
            size="small"
            variant="outlined"
            onClick={() => { setDateFrom(""); setDateTo(""); setSellerQ(""); }}
            sx={{ fontSize: 12, color: C.red, borderColor: C.gray200 }}
          >
            ✕ Clear
          </Button>
        )}
      </Paper>

      {/* Bills DataGrid */}
      <Paper elevation={1} sx={{ borderRadius: 2, overflow: "hidden" }}>
        {/* Section header */}
        <Box display="flex" alignItems="center" justifyContent="space-between" px={3} pt={2.5} pb={1.5}>
          <Box display="flex" alignItems="center" gap={1.25}>
            <Typography variant="subtitle1" fontWeight={700} color={C.gray800}>
              Purchase Bills
            </Typography>
            <Chip
              label={total}
              size="small"
              sx={{ fontSize: 11, fontWeight: 700, background: C.gray100, color: C.gray500, border: `1px solid ${C.gray200}`, height: 22 }}
            />
          </Box>
          {loading && (
            <Typography sx={{ fontSize: 12, color: C.gray400 }}>Loading…</Typography>
          )}
        </Box>

        <Box sx={{ height: bills.length === 0 ? 200 : Math.min(bills.length * 52 + 110, 600), width: "100%" }}>
          <DataGrid
            rows={bills}
            columns={columns}
            getRowId={r => r.id}
            loading={loading}
            initialState={{ pagination: { paginationModel: { pageSize: 20 } } }}
            pageSizeOptions={[20, 50]}
            rowHeight={52}
            disableRowSelectionOnClick
            onRowClick={({ row }) => setViewBill(row)}
            sx={{
              border: "none",
              "& .MuiDataGrid-columnHeaders": {
                background: C.gray50,
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: C.gray500,
                borderBottom: `1px solid ${C.border}`,
              },
              "& .MuiDataGrid-cell": {
                borderBottom: `1px solid ${C.gray100}`,
                cursor: "pointer",
              },
              "& .MuiDataGrid-row:hover": {
                background: "#F0F7FF",
              },
              "& .MuiDataGrid-footerContainer": {
                borderTop: `1px solid ${C.gray100}`,
              },
            }}
          />
        </Box>
      </Paper>
    </Box>
  );
}
