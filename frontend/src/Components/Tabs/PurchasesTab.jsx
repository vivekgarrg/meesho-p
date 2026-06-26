import React, { useState, useEffect, useCallback, useRef } from "react";
import { API, C, fmt } from "../../App";
import {
  Alert, Autocomplete, Box, Button, Card, CardActionArea, CardContent,
  Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, Drawer, FormControlLabel, Checkbox, IconButton, InputAdornment,
  Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow,
  TextField, Tooltip, Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import DownloadIcon from "@mui/icons-material/Download";
import EditIcon from "@mui/icons-material/Edit";
import SearchIcon from "@mui/icons-material/Search";
import ReceiptIcon from "@mui/icons-material/Receipt";
import StorefrontIcon from "@mui/icons-material/Storefront";
import CalendarTodayIcon from "@mui/icons-material/CalendarToday";
import InventoryIcon from "@mui/icons-material/Inventory";
import CloseIcon from "@mui/icons-material/Close";
import FilterListIcon from "@mui/icons-material/FilterList";
import RefreshIcon from "@mui/icons-material/Refresh";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";

// ── Helpers ───────────────────────────────────────────────────────────────────
const todayStr = () => new Date().toISOString().slice(0, 10);

function fmtDate(d) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${day} ${months[+m - 1]} ${y}`;
}

function emptyItem() {
  return { parent_sku_id: "", product_description: "", quantity: 1, price_per_unit: "", is_exchange: false };
}

function calcTotal(items) {
  return items.reduce((s, it) => {
    if (it.is_exchange) return s;
    return s + (parseInt(it.quantity, 10) || 0) * (parseFloat(it.price_per_unit) || 0);
  }, 0);
}

function KpiCard({ label, value, sub, icon, color }) {
  return (
    <Card variant="outlined" sx={{ flex: 1, minWidth: 150, borderRadius: 3, borderColor: "#E2E8F0" }}>
      <CardContent sx={{ p: 2.5, "&:last-child": { pb: 2.5 } }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" mb={1}>
          <Typography variant="caption" color="text.secondary" fontWeight={700} textTransform="uppercase" letterSpacing={0.5} fontSize={11}>
            {label}
          </Typography>
          <Box sx={{ color, opacity: 0.6 }}>{icon}</Box>
        </Stack>
        <Typography variant="h5" fontWeight={800} color="text.primary">{value}</Typography>
        {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
      </CardContent>
    </Card>
  );
}

// ── SKU Autocomplete row item ─────────────────────────────────────────────────
function SkuAutocomplete({ value, onChange }) {
  const [options, setOptions] = useState([]);
  const [input,   setInput]   = useState(value || "");
  const [loading, setLoading] = useState(false);
  const debRef = useRef(null);

  useEffect(() => {
    if (!input || input.length < 1) { setOptions([]); return; }
    clearTimeout(debRef.current);
    debRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`${API}/parent-prices/?search=${encodeURIComponent(input)}&page_size=20`);
        const d = await r.json();
        setOptions((d.results || d).map(p => p.item_id));
      } catch {}
      setLoading(false);
    }, 250);
  }, [input]);

  return (
    <Autocomplete
      freeSolo
      size="small"
      options={options}
      value={value}
      inputValue={input}
      loading={loading}
      onInputChange={(_, v) => { setInput(v); onChange(v); }}
      onChange={(_, v) => { if (v) { setInput(v); onChange(v); } }}
      renderInput={(params) => (
        <TextField {...params} placeholder="Parent SKU…"
          InputProps={{ ...(params.InputProps ?? {}),
            endAdornment: <>{loading && <CircularProgress size={12} />}{params.InputProps?.endAdornment}</>
          }}
          inputProps={{ ...params.inputProps, style: { fontSize: 13 } }}
        />
      )}
    />
  );
}

// ── Bill Form (create / edit) ─────────────────────────────────────────────────
function BillForm({ initial, onSave, onClose }) {
  const [date,    setDate]    = useState(initial?.date        || todayStr());
  const [seller,  setSeller]  = useState(initial?.seller_name || "");
  const [billNo,  setBillNo]  = useState(initial?.bill_number || "");
  const [notes,   setNotes]   = useState(initial?.notes       || "");
  const [items,   setItems]   = useState(
    initial?.items?.length ? initial.items.map(i => ({ ...i })) : [emptyItem()]
  );
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState("");

  const setItem = (idx, field, val) =>
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: val } : it));

  const grandTotal = calcTotal(items);

  const handleSave = async () => {
    if (!date || !seller.trim())   { setError("Date and seller name are required."); return; }
    if (items.length === 0)        { setError("Add at least one item."); return; }
    for (const it of items) {
      if (!it.parent_sku_id.trim()) { setError("Select or type a SKU for every item."); return; }
      if (!it.is_exchange && !(parseFloat(it.price_per_unit) > 0)) {
        setError("Enter a valid price for non-exchange items."); return;
      }
    }
    setSaving(true); setError("");
    try {
      const method = initial?.id ? "PUT" : "POST";
      const url    = initial?.id ? `${API}/purchases/${initial.id}/` : `${API}/purchases/`;
      const res = await fetch(url, {
        method, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, seller_name: seller, bill_number: billNo, notes, items }),
      });
      if (!res.ok) { setError("Save failed. Check your inputs."); setSaving(false); return; }
      onSave(await res.json());
    } catch { setError("Network error."); setSaving(false); }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth
      PaperProps={{ sx: { borderRadius: 3, maxHeight: "92vh" } }}>
      <DialogTitle sx={{ borderBottom: "1px solid #F1F5F9", pb: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Box>
            <Typography fontWeight={800} fontSize={18}>
              {initial?.id ? "Edit Purchase Bill" : "New Purchase Bill"}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              All items update inventory automatically
            </Typography>
          </Box>
          <IconButton onClick={onClose} size="small"><CloseIcon /></IconButton>
        </Stack>
      </DialogTitle>

      <DialogContent sx={{ pt: 2.5 }}>
        <Stack spacing={2.5}>
          {error && <Alert severity="error" sx={{ borderRadius: 2 }}>{error}</Alert>}

          {/* Bill header */}
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField label="Date *" type="date" size="small" value={date}
              onChange={e => setDate(e.target.value)} InputLabelProps={{ shrink: true }} sx={{ flex: 1 }} />
            <TextField label="Seller / Vendor *" size="small" value={seller}
              onChange={e => setSeller(e.target.value)} placeholder="e.g. Raj Textiles" sx={{ flex: 2 }} />
            <TextField label="Bill / Invoice No." size="small" value={billNo}
              onChange={e => setBillNo(e.target.value)} placeholder="INV-001" sx={{ flex: 1 }} />
          </Stack>

          <TextField label="Notes (optional)" size="small" value={notes}
            onChange={e => setNotes(e.target.value)} fullWidth />

          <Divider>
            <Typography variant="caption" color="text.secondary" fontWeight={600}>ITEMS</Typography>
          </Divider>

          {/* Column headers */}
          <Box display="grid" sx={{ gridTemplateColumns: "2fr 2fr 0.7fr 1.1fr 1fr 80px 36px", gap: 1, px: 0.5 }}>
            {["Parent SKU", "Description", "Qty", "Price/unit ₹", "Line Total", "Exchange?", ""].map(h => (
              <Typography key={h} fontSize={10} fontWeight={700} color="text.secondary"
                textTransform="uppercase" letterSpacing={0.5}>{h}</Typography>
            ))}
          </Box>

          {/* Item rows */}
          <Stack spacing={1}>
            {items.map((it, idx) => {
              const lineTotal = it.is_exchange ? 0 : (parseInt(it.quantity, 10) || 0) * (parseFloat(it.price_per_unit) || 0);
              return (
                <Box key={idx} display="grid"
                  sx={{
                    gridTemplateColumns: "2fr 2fr 0.7fr 1.1fr 1fr 80px 36px",
                    gap: 1, alignItems: "center",
                    bgcolor: it.is_exchange ? "#FFFBEB" : "#F8FAFC",
                    borderRadius: 2, p: "10px 12px",
                    border: `1px solid ${it.is_exchange ? "#FDE68A" : "#E2E8F0"}`,
                  }}>
                  <SkuAutocomplete value={it.parent_sku_id}
                    onChange={v => setItem(idx, "parent_sku_id", v)} />
                  <TextField size="small" value={it.product_description}
                    onChange={e => setItem(idx, "product_description", e.target.value)}
                    placeholder="Description…" inputProps={{ style: { fontSize: 13 } }} />
                  <TextField size="small" type="number" value={it.quantity}
                    inputProps={{ min: 1, style: { fontSize: 13 } }}
                    onChange={e => setItem(idx, "quantity", e.target.value)} />
                  <TextField size="small" type="number" value={it.price_per_unit}
                    inputProps={{ min: 0, step: "0.01", style: { fontSize: 13 } }}
                    onChange={e => setItem(idx, "price_per_unit", e.target.value)}
                    disabled={it.is_exchange} sx={{ opacity: it.is_exchange ? 0.4 : 1 }}
                    placeholder="0.00" />
                  <Typography fontSize={13} fontWeight={700}
                    color={it.is_exchange ? "text.disabled" : C.green} textAlign="right">
                    {it.is_exchange ? "—" : `₹${lineTotal.toFixed(2)}`}
                  </Typography>
                  <Stack direction="row" alignItems="center" justifyContent="center">
                    <FormControlLabel
                      control={
                        <Checkbox checked={it.is_exchange} size="small"
                          onChange={e => setItem(idx, "is_exchange", e.target.checked)}
                          sx={{ color: C.amber, "&.Mui-checked": { color: C.amber }, p: 0.5 }} />
                      }
                      label={<Typography fontSize={10} color={C.amber} fontWeight={700}>Exch</Typography>}
                      sx={{ m: 0 }} />
                  </Stack>
                  <IconButton size="small" onClick={() => setItems(p => p.filter((_, i) => i !== idx))}
                    disabled={items.length === 1} sx={{ color: C.red, opacity: items.length === 1 ? 0.3 : 1 }}>
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Box>
              );
            })}
          </Stack>

          <Stack direction="row" justifyContent="space-between" alignItems="center"
            pt={1} sx={{ borderTop: "1px solid #F1F5F9" }}>
            <Button size="small" startIcon={<AddIcon />}
              onClick={() => setItems(p => [...p, emptyItem()])}
              sx={{ color: C.orange, textTransform: "none" }}>
              Add Row
            </Button>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="body2" color="text.secondary">Grand Total</Typography>
              <Typography fontWeight={800} fontSize={20} color={C.orange} fontFamily="monospace">
                ₹{grandTotal.toFixed(2)}
              </Typography>
              <Typography variant="caption" color="text.secondary">(excl. exchanges)</Typography>
            </Stack>
          </Stack>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2, borderTop: "1px solid #F1F5F9", gap: 1 }}>
        <Button onClick={onClose} sx={{ color: "text.secondary", textTransform: "none" }}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : null}
          sx={{ bgcolor: C.orange, "&:hover": { bgcolor: "#5B21B6" }, fontWeight: 700, textTransform: "none", borderRadius: 2 }}>
          {saving ? "Saving…" : initial?.id ? "Save Changes" : "Create Bill"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Bill Detail Drawer ────────────────────────────────────────────────────────
function BillDrawer({ bill, onClose, onEdit, onDelete, onDownload }) {
  if (!bill) return null;
  const exchangeItems = bill.items.filter(it => it.is_exchange);
  const regularItems  = bill.items.filter(it => !it.is_exchange);

  return (
    <Drawer anchor="right" open={!!bill} onClose={onClose}
      PaperProps={{ sx: { width: { xs: "100%", sm: 540 }, borderRadius: "16px 0 0 16px" } }}>
      <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <Box sx={{ p: 3, borderBottom: "1px solid #F1F5F9", bgcolor: C.orange, color: "#fff" }}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
            <Box>
              <Typography fontWeight={800} fontSize={20}>
                Bill #{bill.bill_number || bill.id}
              </Typography>
              <Stack direction="row" spacing={1.5} mt={0.5} alignItems="center">
                <Typography variant="caption" sx={{ opacity: 0.85 }}>
                  {fmtDate(bill.date)}
                </Typography>
                <Box sx={{ width: 4, height: 4, borderRadius: "50%", bgcolor: "rgba(255,255,255,0.5)" }} />
                <Typography variant="caption" sx={{ opacity: 0.85 }}>
                  {bill.seller_name}
                </Typography>
              </Stack>
            </Box>
            <IconButton onClick={onClose} sx={{ color: "#fff" }}><CloseIcon /></IconButton>
          </Stack>
          <Typography fontWeight={800} fontSize={28} mt={2}>
            {fmt(bill.total_amount)}
          </Typography>
          <Typography variant="caption" sx={{ opacity: 0.7 }}>
            {bill.items.length} item{bill.items.length !== 1 ? "s" : ""} · {exchangeItems.length} exchange
          </Typography>
        </Box>

        {/* Body */}
        <Box sx={{ flex: 1, overflowY: "auto", p: 3 }}>
          {bill.notes && (
            <Alert severity="info" icon={false} sx={{ borderRadius: 2, mb: 2, fontSize: 13, fontStyle: "italic" }}>
              {bill.notes}
            </Alert>
          )}

          {/* Regular items */}
          {regularItems.length > 0 && (
            <Box mb={3}>
              <Typography variant="caption" fontWeight={700} color="text.secondary"
                textTransform="uppercase" letterSpacing={0.5} mb={1.5} display="block">
                Items Purchased
              </Typography>
              <Stack spacing={1}>
                {regularItems.map((it, i) => (
                  <Box key={i} sx={{ p: 1.5, bgcolor: "#F8FAFC", borderRadius: 2, border: "1px solid #E2E8F0" }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                      <Box>
                        <Typography fontWeight={700} fontSize={13} color={C.orange}>
                          {it.parent_sku_id || "—"}
                        </Typography>
                        {it.product_description && (
                          <Typography fontSize={12} color="text.secondary">{it.product_description}</Typography>
                        )}
                      </Box>
                      <Box textAlign="right">
                        <Typography fontWeight={700} fontSize={14} fontFamily="monospace">
                          {fmt(it.total_amount)}
                        </Typography>
                        <Typography fontSize={11} color="text.secondary">
                          {it.quantity} × {fmt(it.price_per_unit)}
                        </Typography>
                      </Box>
                    </Stack>
                  </Box>
                ))}
              </Stack>
            </Box>
          )}

          {/* Exchange items */}
          {exchangeItems.length > 0 && (
            <Box mb={3}>
              <Typography variant="caption" fontWeight={700} color="text.secondary"
                textTransform="uppercase" letterSpacing={0.5} mb={1.5} display="block">
                Exchange Items
              </Typography>
              <Stack spacing={1}>
                {exchangeItems.map((it, i) => (
                  <Box key={i} sx={{ p: 1.5, bgcolor: "#FFFBEB", borderRadius: 2, border: "1px solid #FDE68A" }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Box>
                        <Typography fontWeight={700} fontSize={13} color={C.amber}>
                          {it.parent_sku_id || "—"}
                        </Typography>
                        {it.product_description && (
                          <Typography fontSize={12} color="text.secondary">{it.product_description}</Typography>
                        )}
                      </Box>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <SwapHorizIcon sx={{ color: C.amber, fontSize: 16 }} />
                        <Chip label={`${it.quantity} pcs`} size="small"
                          sx={{ bgcolor: "#FDE68A", color: C.amber, fontWeight: 700, fontSize: 11 }} />
                      </Stack>
                    </Stack>
                  </Box>
                ))}
              </Stack>
            </Box>
          )}

          {/* Total */}
          <Box sx={{ p: 2, bgcolor: "#F0F7FF", borderRadius: 2, border: "1px solid #BFDBFE" }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography fontWeight={700} color="text.secondary">Total Paid</Typography>
              <Typography fontWeight={800} fontSize={22} color={C.orange} fontFamily="monospace">
                {fmt(bill.total_amount)}
              </Typography>
            </Stack>
          </Box>
        </Box>

        {/* Footer actions */}
        <Box sx={{ p: 3, borderTop: "1px solid #F1F5F9" }}>
          <Stack spacing={1.5}>
            <Button fullWidth variant="contained" startIcon={<DownloadIcon />}
              href={`${API}/purchases/${bill.id}/pdf/`} target="_blank"
              sx={{ bgcolor: C.orange, "&:hover": { bgcolor: "#5B21B6" }, fontWeight: 700, borderRadius: 2, textTransform: "none" }}>
              Download Bill PDF
            </Button>
            <Stack direction="row" spacing={1}>
              <Button fullWidth variant="outlined" startIcon={<EditIcon />} onClick={() => onEdit(bill)}
                sx={{ borderColor: C.orange, color: C.orange, textTransform: "none", borderRadius: 2 }}>
                Edit Bill
              </Button>
              <Button variant="outlined" startIcon={<DeleteIcon />} onClick={() => onDelete(bill.id)}
                sx={{ borderColor: "#FECDD3", color: C.red, textTransform: "none", borderRadius: 2, minWidth: 110 }}>
                Delete
              </Button>
            </Stack>
          </Stack>
        </Box>
      </Box>
    </Drawer>
  );
}

// ── Bill Card ─────────────────────────────────────────────────────────────────
function BillCard({ bill, onClick }) {
  const exchangeCount = bill.items.filter(it => it.is_exchange).length;
  const regularCount  = bill.items.filter(it => !it.is_exchange).length;
  return (
    <Card variant="outlined"
      sx={{ borderRadius: 3, borderColor: "#E2E8F0", transition: "all 0.15s", "&:hover": { borderColor: C.orange, boxShadow: "0 2px 12px rgba(109,40,217,0.1)" } }}>
      <CardActionArea onClick={onClick} sx={{ p: 0 }}>
        <CardContent sx={{ p: 2.5, "&:last-child": { pb: 2.5 } }}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
            <Box flex={1} mr={1}>
              <Stack direction="row" spacing={1} alignItems="center" mb={0.5}>
                <Typography fontWeight={800} fontSize={14} color="text.primary">
                  {bill.seller_name}
                </Typography>
                {exchangeCount > 0 && (
                  <Chip label={`${exchangeCount} exch`} size="small"
                    sx={{ bgcolor: "#FFFBEB", color: C.amber, border: "1px solid #FDE68A", fontWeight: 700, fontSize: 10, height: 18 }} />
                )}
              </Stack>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <Typography variant="caption" color="text.secondary">{fmtDate(bill.date)}</Typography>
                <Box sx={{ width: 3, height: 3, borderRadius: "50%", bgcolor: "#CBD5E1" }} />
                <Typography variant="caption" color="text.secondary">
                  {bill.bill_number ? `#${bill.bill_number}` : `Bill #${bill.id}`}
                </Typography>
                <Box sx={{ width: 3, height: 3, borderRadius: "50%", bgcolor: "#CBD5E1" }} />
                <Typography variant="caption" color="text.secondary">
                  {regularCount} item{regularCount !== 1 ? "s" : ""}
                </Typography>
              </Stack>
              {bill.notes && (
                <Typography variant="caption" color="text.secondary" mt={0.5} display="block"
                  sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 260 }}>
                  {bill.notes}
                </Typography>
              )}
            </Box>
            <Box textAlign="right">
              <Typography fontWeight={800} fontSize={16} color={C.orange} fontFamily="monospace">
                {fmt(bill.total_amount)}
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block">total</Typography>
            </Box>
          </Stack>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

// ── Delete Confirm Dialog ─────────────────────────────────────────────────────
function ConfirmDelete({ billId, onConfirm, onCancel }) {
  const [deleting, setDeleting] = useState(false);
  return (
    <Dialog open onClose={onCancel} maxWidth="xs" PaperProps={{ sx: { borderRadius: 3 } }}>
      <DialogTitle fontWeight={800}>Delete Purchase Bill?</DialogTitle>
      <DialogContent>
        <Typography color="text.secondary">
          This will permanently delete the bill and remove it from inventory history. This cannot be undone.
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onCancel} sx={{ textTransform: "none" }}>Cancel</Button>
        <Button variant="contained" color="error" disabled={deleting}
          onClick={async () => { setDeleting(true); await onConfirm(billId); }}
          sx={{ textTransform: "none", borderRadius: 2 }}>
          {deleting ? <CircularProgress size={16} color="inherit" /> : "Delete"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Main Tab ──────────────────────────────────────────────────────────────────
export function PurchasesTab() {
  const [bills,     setBills]     = useState([]);
  const [total,     setTotal]     = useState(0);
  const [loading,   setLoading]   = useState(false);
  const [dateFrom,  setDateFrom]  = useState("");
  const [dateTo,    setDateTo]    = useState("");
  const [sellerQ,   setSellerQ]   = useState("");
  const [showForm,  setShowForm]  = useState(false);
  const [editBill,  setEditBill]  = useState(null);
  const [viewBill,  setViewBill]  = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [page,      setPage]      = useState(1);
  const PAGE_SIZE = 20;

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
        setPage(1);
      }
    } finally { setLoading(false); }
  }, [dateFrom, dateTo, sellerQ]);

  useEffect(() => { load(); }, [load]);

  const handleSaved = (saved) => {
    setShowForm(false); setEditBill(null);
    load();
    if (viewBill?.id === saved.id) setViewBill(saved);
  };

  const handleDelete = async (id) => {
    await fetch(`${API}/purchases/${id}/`, { method: "DELETE" });
    setDeletingId(null);
    if (viewBill?.id === id) setViewBill(null);
    load();
  };

  const clearFilters = () => { setDateFrom(""); setDateTo(""); setSellerQ(""); };
  const hasFilters = dateFrom || dateTo || sellerQ;

  // KPI computations
  const totalSpend    = bills.reduce((s, b) => s + parseFloat(b.total_amount || 0), 0);
  const totalQty      = bills.reduce((s, b) => s + b.items.filter(i => !i.is_exchange).reduce((q, i) => q + i.quantity, 0), 0);
  const uniqueSellers = [...new Set(bills.map(b => b.seller_name))].length;

  // Paginate
  const paged      = bills.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.ceil(bills.length / PAGE_SIZE);

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1200, mx: "auto" }}>
      {/* Modals & Drawer */}
      {(showForm || editBill) && (
        <BillForm initial={editBill} onSave={handleSaved}
          onClose={() => { setShowForm(false); setEditBill(null); }} />
      )}
      {viewBill && !editBill && (
        <BillDrawer bill={viewBill} onClose={() => setViewBill(null)}
          onEdit={(b) => { setViewBill(null); setEditBill(b); }}
          onDelete={(id) => { setViewBill(null); setDeletingId(id); }}
          onDownload={(id) => window.open(`${API}/purchases/${id}/pdf/`, "_blank")} />
      )}
      {deletingId && (
        <ConfirmDelete billId={deletingId}
          onConfirm={handleDelete} onCancel={() => setDeletingId(null)} />
      )}

      {/* Header */}
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" mb={3} flexWrap="wrap" gap={2}>
        <Box>
          <Typography variant="h5" fontWeight={800}>Purchases</Typography>
          <Typography variant="caption" color="text.secondary">
            Track stock purchases · PDF bills · Inventory auto-updated
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setShowForm(true)}
          sx={{ bgcolor: C.orange, "&:hover": { bgcolor: "#5B21B6" }, fontWeight: 700, borderRadius: 2, textTransform: "none" }}>
          New Purchase Bill
        </Button>
      </Stack>

      {/* KPI Row */}
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} mb={3} flexWrap="wrap">
        <KpiCard label="Total Spend" value={`₹${totalSpend.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
          sub={`${total} bills`} icon={<ReceiptIcon />} color={C.orange} />
        <KpiCard label="Units Purchased" value={totalQty.toLocaleString("en-IN")}
          sub="excl. exchanges" icon={<InventoryIcon />} color={C.blue} />
        <KpiCard label="Unique Sellers" value={uniqueSellers}
          sub="vendors" icon={<StorefrontIcon />} color={C.green} />
        <KpiCard label="Bills Recorded" value={total}
          sub={hasFilters ? "filtered" : "all time"} icon={<CalendarTodayIcon />} color={C.amber} />
      </Stack>

      {/* Filter Bar */}
      <Paper variant="outlined" sx={{ borderRadius: 3, borderColor: "#E2E8F0", p: 2, mb: 3 }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "center" }} flexWrap="wrap">
          <Stack direction="row" spacing={1} alignItems="center">
            <FilterListIcon fontSize="small" sx={{ color: "text.secondary" }} />
            <Typography fontSize={12} fontWeight={700} color="text.secondary" textTransform="uppercase" letterSpacing={0.5}>
              Filter
            </Typography>
          </Stack>
          <TextField size="small" type="date" value={dateFrom} label="From"
            onChange={e => setDateFrom(e.target.value)} InputLabelProps={{ shrink: true }} sx={{ width: 160 }} />
          <TextField size="small" type="date" value={dateTo} label="To"
            onChange={e => setDateTo(e.target.value)} InputLabelProps={{ shrink: true }} sx={{ width: 160 }} />
          <TextField size="small" value={sellerQ} onChange={e => setSellerQ(e.target.value)}
            placeholder="Search seller…"
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" sx={{ color: "text.secondary" }} /></InputAdornment> }}
            sx={{ flex: 1, minWidth: 180 }} />
          <Stack direction="row" spacing={1}>
            {hasFilters && (
              <Button size="small" onClick={clearFilters}
                sx={{ textTransform: "none", color: C.red, borderColor: "#FECDD3" }} variant="outlined">
                Clear
              </Button>
            )}
            <IconButton size="small" onClick={load}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Stack>
        </Stack>
      </Paper>

      {/* Bills List */}
      <Box>
        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography fontWeight={700} fontSize={15}>Purchase Bills</Typography>
            <Chip label={bills.length} size="small"
              sx={{ bgcolor: "#F1F5F9", color: "text.secondary", fontWeight: 700, fontSize: 11 }} />
          </Stack>
          {loading && <CircularProgress size={18} sx={{ color: C.orange }} />}
        </Stack>

        {loading && bills.length === 0 ? (
          <Box display="flex" justifyContent="center" py={10}>
            <CircularProgress sx={{ color: C.orange }} />
          </Box>
        ) : bills.length === 0 ? (
          <Box textAlign="center" py={10}>
            <ReceiptIcon sx={{ fontSize: 48, color: "#CBD5E1", mb: 2 }} />
            <Typography color="text.secondary" fontWeight={600}>No purchase bills found</Typography>
            <Typography variant="caption" color="text.secondary">
              {hasFilters ? "Try clearing your filters" : "Create your first purchase bill"}
            </Typography>
          </Box>
        ) : (
          <Stack spacing={1.5}>
            {paged.map(bill => (
              <BillCard key={bill.id} bill={bill} onClick={() => setViewBill(bill)} />
            ))}
          </Stack>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <Stack direction="row" justifyContent="center" alignItems="center" spacing={1} mt={3}>
            <Button size="small" disabled={page <= 1} onClick={() => setPage(p => p - 1)}
              sx={{ textTransform: "none" }}>
              ← Prev
            </Button>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              const p = totalPages <= 7 ? i + 1 : (page <= 4 ? i + 1 : page - 3 + i);
              if (p < 1 || p > totalPages) return null;
              return (
                <Button key={p} size="small" onClick={() => setPage(p)}
                  variant={page === p ? "contained" : "text"}
                  sx={{ minWidth: 36, textTransform: "none", bgcolor: page === p ? C.orange : "transparent", color: page === p ? "#fff" : "text.secondary", "&:hover": { bgcolor: page === p ? C.orange : "#F1F5F9" } }}>
                  {p}
                </Button>
              );
            })}
            <Button size="small" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
              sx={{ textTransform: "none" }}>
              Next →
            </Button>
          </Stack>
        )}
      </Box>
    </Box>
  );
}
