import React, { useState, useEffect, useCallback, useRef } from "react";
import { BarChart } from "@mui/x-charts/BarChart";
import { PieChart } from "@mui/x-charts/PieChart";
import { LineChart } from "@mui/x-charts/LineChart";
import {
  Autocomplete, Box, Button, Card, CardContent, Chip, CircularProgress,
  Dialog, DialogActions, DialogContent, DialogTitle, Divider,
  FormControl, IconButton, InputAdornment, InputLabel, MenuItem,
  Paper, Select, Stack, Tab, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Tabs, TextField, Tooltip,
  Typography, Alert, Snackbar, Badge,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import DownloadIcon from "@mui/icons-material/Download";
import HistoryIcon from "@mui/icons-material/History";
import InventoryIcon from "@mui/icons-material/Inventory";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import SearchIcon from "@mui/icons-material/Search";
import TuneIcon from "@mui/icons-material/Tune";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import CheckCircleOutlinedIcon from "@mui/icons-material/CheckCircleOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import { API, C, fmt } from "../../App";

// ── Constants ─────────────────────────────────────────────────────────────────
const ADJUSTMENT_REASONS = [
  { value: "DAMAGED", label: "Damaged / Written Off" },
  { value: "FOUND", label: "Stock Found / Recount" },
  { value: "CORRECTION", label: "Inventory Correction" },
  { value: "LOST", label: "Lost / Stolen" },
  { value: "RETURN", label: "Customer Return (non-Meesho)" },
  { value: "OTHER", label: "Other" },
];

const CONSUMABLE_CATEGORIES = [
  { value: "POLYTHENE", label: "Polythene Bags" },
  { value: "BUBBLE_WRAP", label: "Bubble Wrap" },
  { value: "STATIONARY", label: "Stationery" },
  { value: "LABELS", label: "Labels" },
  { value: "BOX", label: "Boxes" },
  { value: "OTHER", label: "Other" },
];

const CONSUMABLE_UNITS = [
  { value: "pieces", label: "Pieces" },
  { value: "rolls", label: "Rolls" },
  { value: "meters", label: "Meters" },
  { value: "grams", label: "Grams" },
  { value: "kgs", label: "Kgs" },
  { value: "packs", label: "Packs" },
  { value: "boxes", label: "Boxes" },
];

const CAT_COLORS = {
  POLYTHENE: "#6D28D9",
  BUBBLE_WRAP: "#2563EB",
  STATIONARY: "#059669",
  LABELS: "#D97706",
  BOX: "#E11D48",
  OTHER: "#64748B",
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function StockBadge({ stock }) {
  if (stock <= 0)
    return <Chip label="Out" size="small" sx={{ bgcolor: "#FFF1F2", color: C.red, border: `1px solid #FECDD3`, fontWeight: 700, fontSize: 11 }} />;
  if (stock <= 5)
    return <Chip label={`Low · ${stock}`} size="small" sx={{ bgcolor: "#FFFBEB", color: C.amber, border: "1px solid #FDE68A", fontWeight: 700, fontSize: 11 }} />;
  return <Chip label={`${stock} units`} size="small" sx={{ bgcolor: "#ECFDF5", color: C.green, border: `1px solid #A7F3D0`, fontWeight: 700, fontSize: 11 }} />;
}

function KpiCard({ label, value, sub, icon, color = C.orange }) {
  return (
    <Card variant="outlined" sx={{ flex: 1, minWidth: 160, borderRadius: 3, borderColor: "#E2E8F0" }}>
      <CardContent sx={{ p: 2.5, "&:last-child": { pb: 2.5 } }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
          <Typography variant="caption" color="text.secondary" fontWeight={600} textTransform="uppercase" letterSpacing={0.5}>
            {label}
          </Typography>
          <Box sx={{ color, opacity: 0.7 }}>{icon}</Box>
        </Stack>
        <Typography variant="h5" fontWeight={800} color="text.primary">{value}</Typography>
        {sub && <Typography variant="caption" color="text.secondary" mt={0.5}>{sub}</Typography>}
      </CardContent>
    </Card>
  );
}

function SectionLoader() {
  return (
    <Box display="flex" justifyContent="center" alignItems="center" py={8}>
      <CircularProgress size={36} sx={{ color: C.orange }} />
    </Box>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

// ── Add Stock / Purchase Modal (with SKU Autocomplete + PDF) ──────────────────
function AddStockModal({ open, onClose, onSaved }) {
  const [skuOptions, setSkuOptions] = useState([]);
  const [skuInput, setSkuInput] = useState("");
  const [skuValue, setSkuValue] = useState(null);
  const [loadingSku, setLoadingSku] = useState(false);
  const [sellerName, setSellerName] = useState("");
  const [date, setDate] = useState(today());
  const [items, setItems] = useState([{ sku_id: "", qty: "", price: "" }]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [savedBillId, setSavedBillId] = useState(null);
  const debounceRef = useRef(null);

  const reset = () => {
    setSkuInput(""); setSkuValue(null); setSellerName(""); setDate(today());
    setItems([{ sku_id: "", qty: "", price: "" }]); setNotes("");
    setSaving(false); setErr(""); setSavedBillId(null);
  };

  const handleClose = () => { reset(); onClose(); };

  // Debounced SKU search
  useEffect(() => {
    if (!skuInput || skuInput.length < 2) { setSkuOptions([]); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoadingSku(true);
      try {
        const r = await fetch(`${API}/parent-prices/?search=${encodeURIComponent(skuInput)}&page_size=20`);
        const d = await r.json();
        setSkuOptions((d.results || d).map(p => ({ label: p.item_id, id: p.item_id, price: p.cost_price })));
      } catch { setSkuOptions([]); }
      setLoadingSku(false);
    }, 300);
  }, [skuInput]);

  const setItem = (i, field, val) => {
    setItems(prev => prev.map((it, idx) => idx === i ? { ...it, [field]: val } : it));
  };

  const addItemRow = () => setItems(prev => [...prev, { sku_id: "", qty: "", price: "" }]);
  const removeItemRow = (i) => setItems(prev => prev.filter((_, idx) => idx !== i));

  const save = async () => {
    const parentSku = skuValue?.id || skuInput.trim();
    if (!parentSku) { setErr("Select or type a Parent SKU."); return; }
    if (!sellerName.trim()) { setErr("Seller / Supplier name is required."); return; }
    const validItems = items.filter(it => it.sku_id.trim() && it.qty && it.price);
    if (!validItems.length) { setErr("Add at least one item with SKU, qty and price."); return; }
    setSaving(true); setErr("");
    try {
      const res = await fetch(`${API}/purchases/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parent_sku_id: parentSku,
          seller_name: sellerName,
          purchase_date: date,
          notes,
          items: validItems.map(it => ({
            sku_id: it.sku_id.trim(),
            quantity: parseInt(it.qty, 10),
            price_per_unit: parseFloat(it.price),
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || JSON.stringify(data)); setSaving(false); return; }
      setSavedBillId(data.id);
      onSaved();
    } catch (e) { setErr(e.message); }
    setSaving(false);
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
      <DialogTitle sx={{ fontWeight: 800, borderBottom: "1px solid #F1F5F9", pb: 2 }}>
        {savedBillId ? "Purchase Saved" : "Add Stock Purchase"}
      </DialogTitle>
      <DialogContent sx={{ pt: 3 }}>
        {savedBillId ? (
          <Stack spacing={3} alignItems="center" py={4}>
            <CheckCircleOutlineIcon sx={{ fontSize: 64, color: C.green }} />
            <Typography variant="h6" fontWeight={700}>Purchase #{savedBillId} saved!</Typography>
            <Stack direction="row" spacing={2}>
              <Button variant="contained" startIcon={<DownloadIcon />}
                href={`${API}/purchases/${savedBillId}/pdf/`} target="_blank"
                sx={{ bgcolor: C.orange, "&:hover": { bgcolor: "#5B21B6" } }}>
                Download Bill PDF
              </Button>
              <Button variant="outlined" onClick={() => { reset(); }}>
                Add Another
              </Button>
            </Stack>
          </Stack>
        ) : (
          <Stack spacing={2.5}>
            {err && <Alert severity="error" sx={{ borderRadius: 2 }}>{err}</Alert>}
            <Autocomplete
              freeSolo
              options={skuOptions}
              value={skuValue}
              inputValue={skuInput}
              loading={loadingSku}
              onInputChange={(_, v) => setSkuInput(v)}
              onChange={(_, v) => setSkuValue(v)}
              getOptionLabel={o => (typeof o === "string" ? o : o.label)}
              renderInput={(params) => (
                <TextField {...params} label="Parent SKU *" placeholder="Type to search or enter new SKU"
                  InputProps={{
                    ...(params.InputProps ?? {}),
                    endAdornment: <>{loadingSku && <CircularProgress size={16} />}{params.InputProps?.endAdornment}</>
                  }}
                />
              )}
            />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField label="Seller / Supplier *" value={sellerName} onChange={e => setSellerName(e.target.value)} fullWidth />
              <TextField label="Purchase Date" type="date" value={date} onChange={e => setDate(e.target.value)}
                InputLabelProps={{ shrink: true }} sx={{ minWidth: 160 }} />
            </Stack>
            <Divider><Typography variant="caption" color="text.secondary">Items</Typography></Divider>
            {items.map((it, i) => (
              <Stack key={i} direction="row" spacing={1} alignItems="center">
                <TextField label="Child SKU / Variant" value={it.sku_id} onChange={e => setItem(i, "sku_id", e.target.value)} sx={{ flex: 2 }} size="small" />
                <TextField label="Qty" type="number" value={it.qty} onChange={e => setItem(i, "qty", e.target.value)} sx={{ flex: 1 }} size="small" />
                <TextField label="Price/unit ₹" type="number" value={it.price} onChange={e => setItem(i, "price", e.target.value)} sx={{ flex: 1 }} size="small" />
                {items.length > 1 && (
                  <IconButton size="small" onClick={() => removeItemRow(i)} sx={{ color: C.red }}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                )}
              </Stack>
            ))}
            <Button size="small" onClick={addItemRow} startIcon={<AddIcon />} sx={{ alignSelf: "flex-start", color: C.orange }}>
              Add Row
            </Button>
            <TextField label="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} multiline rows={2} />
          </Stack>
        )}
      </DialogContent>
      {!savedBillId && (
        <DialogActions sx={{ px: 3, py: 2, borderTop: "1px solid #F1F5F9" }}>
          <Button onClick={handleClose}>Cancel</Button>
          <Button variant="contained" onClick={save} disabled={saving}
            sx={{ bgcolor: C.orange, "&:hover": { bgcolor: "#5B21B6" } }}>
            {saving ? <CircularProgress size={18} color="inherit" /> : "Save Purchase"}
          </Button>
        </DialogActions>
      )}
    </Dialog>
  );
}

// ── Adjustment Modal ──────────────────────────────────────────────────────────
function AdjustmentModal({ open, sku, onClose, onSaved }) {
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("CORRECTION");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const reset = () => { setQty(""); setReason("CORRECTION"); setNotes(""); setSaving(false); setErr(""); };

  const save = async () => {
    const q = parseInt(qty, 10);
    if (!qty || isNaN(q) || q === 0) { setErr("Enter a non-zero quantity (negative to remove stock)."); return; }
    setSaving(true); setErr("");
    const res = await fetch(`${API}/inventory/adjustments/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parent_sku_id: sku, quantity: q, reason, notes }),
    });
    const data = await res.json();
    if (!res.ok) { setErr(data.error || "Failed"); setSaving(false); return; }
    reset(); onSaved();
  };

  return (
    <Dialog open={open} onClose={() => { reset(); onClose(); }} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
      <DialogTitle sx={{ fontWeight: 800, borderBottom: "1px solid #F1F5F9" }}>
        Adjust Stock — {sku}
      </DialogTitle>
      <DialogContent sx={{ pt: 3 }}>
        <Stack spacing={2.5}>
          {err && <Alert severity="error">{err}</Alert>}
          <TextField label="Quantity (+add / −remove)" type="number" value={qty}
            onChange={e => setQty(e.target.value)} helperText="Use negative to remove stock" fullWidth />
          <FormControl fullWidth>
            <InputLabel>Reason</InputLabel>
            <Select value={reason} label="Reason" onChange={e => setReason(e.target.value)}>
              {ADJUSTMENT_REASONS.map(r => <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>)}
            </Select>
          </FormControl>
          <TextField label="Notes" value={notes} onChange={e => setNotes(e.target.value)} multiline rows={2} />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, borderTop: "1px solid #F1F5F9" }}>
        <Button onClick={() => { reset(); onClose(); }}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={saving}
          sx={{ bgcolor: C.orange, "&:hover": { bgcolor: "#5B21B6" } }}>
          {saving ? <CircularProgress size={18} color="inherit" /> : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── New SKU Modal ─────────────────────────────────────────────────────────────
function NewSKUModal({ onSave, onClose }) {
  const [skuId, setSkuId] = useState("");
  const [initQty, setInitQty] = useState("");
  const [initPrice, setInitPrice] = useState("");
  const [initSeller, setInitSeller] = useState("");
  const [initDate, setInitDate] = useState(today());
  const [itemPrice, setItemPrice] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    if (!skuId.trim()) { setErr("Parent SKU ID is required."); return; }
    const qty = parseInt(initQty, 10);
    if (initQty && (isNaN(qty) || qty < 1)) { setErr("Initial qty must be ≥ 1."); return; }
    setSaving(true); setErr("");
    const res = await fetch(`${API}/inventory/new-sku/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sku_id: skuId.trim().toUpperCase(),
        cost_price: itemPrice ? parseFloat(itemPrice) : null,
        initial_quantity: qty || 0,
        initial_price_per_unit: initPrice ? parseFloat(initPrice) : null,
        seller_name: initSeller.trim() || null,
        purchase_date: initDate,
      }),
    });
    const data = await res.json();
    if (!res.ok) { setErr(data.error || JSON.stringify(data)); setSaving(false); return; }
    onSave();
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
      <DialogTitle sx={{ fontWeight: 800, borderBottom: "1px solid #F1F5F9" }}>Create New Parent SKU</DialogTitle>
      <DialogContent sx={{ pt: 3 }}>
        <Stack spacing={2.5}>
          {err && <Alert severity="error">{err}</Alert>}
          <TextField label="Parent SKU ID *" value={skuId} onChange={e => setSkuId(e.target.value.toUpperCase())}
            helperText="Unique identifier e.g. PROD-001" />
          <TextField label="Cost Price per Unit ₹" type="number" value={itemPrice} onChange={e => setItemPrice(e.target.value)} />
          <Divider><Typography variant="caption" color="text.secondary">Initial Stock (optional)</Typography></Divider>
          <Stack direction="row" spacing={2}>
            <TextField label="Qty" type="number" value={initQty} onChange={e => setInitQty(e.target.value)} sx={{ flex: 1 }} />
            <TextField label="Price/unit ₹" type="number" value={initPrice} onChange={e => setInitPrice(e.target.value)} sx={{ flex: 1 }} />
          </Stack>
          <Stack direction="row" spacing={2}>
            <TextField label="Seller" value={initSeller} onChange={e => setInitSeller(e.target.value)} sx={{ flex: 2 }} />
            <TextField label="Date" type="date" value={initDate} onChange={e => setInitDate(e.target.value)}
              InputLabelProps={{ shrink: true }} sx={{ flex: 1 }} />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, borderTop: "1px solid #F1F5F9" }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={saving}
          sx={{ bgcolor: C.orange, "&:hover": { bgcolor: "#5B21B6" } }}>
          {saving ? <CircularProgress size={18} color="inherit" /> : "Create SKU"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Consumable Item Modal ─────────────────────────────────────────────────────
function ConsumableItemModal({ open, item, onClose, onSaved }) {
  const [name, setName] = useState(item?.name || "");
  const [category, setCategory] = useState(item?.category || "POLYTHENE");
  const [unit, setUnit] = useState(item?.unit || "pieces");
  const [notes, setNotes] = useState(item?.notes || "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    if (!name.trim()) { setErr("Name is required."); return; }
    setSaving(true); setErr("");
    const method = item ? "PUT" : "POST";
    const url = item ? `${API}/consumables/items/${item.id}/` : `${API}/consumables/items/`;
    const res = await fetch(url, {
      method, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), category, unit, notes }),
    });
    const data = await res.json();
    if (!res.ok) { setErr(data.error || "Failed"); setSaving(false); return; }
    onSaved();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
      <DialogTitle sx={{ fontWeight: 800, borderBottom: "1px solid #F1F5F9" }}>
        {item ? "Edit Consumable" : "New Consumable Item"}
      </DialogTitle>
      <DialogContent sx={{ pt: 3 }}>
        <Stack spacing={2.5}>
          {err && <Alert severity="error">{err}</Alert>}
          <TextField label="Name *" value={name} onChange={e => setName(e.target.value)} />
          <FormControl fullWidth>
            <InputLabel>Category</InputLabel>
            <Select value={category} label="Category" onChange={e => setCategory(e.target.value)}>
              {CONSUMABLE_CATEGORIES.map(c => <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl fullWidth>
            <InputLabel>Unit</InputLabel>
            <Select value={unit} label="Unit" onChange={e => setUnit(e.target.value)}>
              {CONSUMABLE_UNITS.map(u => <MenuItem key={u.value} value={u.value}>{u.label}</MenuItem>)}
            </Select>
          </FormControl>
          <TextField label="Notes" value={notes} onChange={e => setNotes(e.target.value)} multiline rows={2} />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, borderTop: "1px solid #F1F5F9" }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={saving}
          sx={{ bgcolor: C.orange, "&:hover": { bgcolor: "#5B21B6" } }}>
          {saving ? <CircularProgress size={18} color="inherit" /> : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Consumable Purchase Modal ─────────────────────────────────────────────────
function ConsumablePurchaseModal({ open, item, onClose, onSaved }) {
  const [date, setDate] = useState(today());
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [seller, setSeller] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    if (!qty || parseFloat(qty) <= 0) { setErr("Qty must be positive."); return; }
    if (!price || parseFloat(price) <= 0) { setErr("Price must be positive."); return; }
    setSaving(true); setErr("");
    const res = await fetch(`${API}/consumables/purchases/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item_id: item.id, date, quantity: parseFloat(qty), price_per_unit: parseFloat(price), seller_name: seller, notes }),
    });
    const data = await res.json();
    if (!res.ok) { setErr(data.error || "Failed"); setSaving(false); return; }
    onSaved();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
      <DialogTitle sx={{ fontWeight: 800, borderBottom: "1px solid #F1F5F9" }}>
        Restock — {item?.name}
      </DialogTitle>
      <DialogContent sx={{ pt: 3 }}>
        <Stack spacing={2.5}>
          {err && <Alert severity="error">{err}</Alert>}
          <Stack direction="row" spacing={2}>
            <TextField label={`Qty (${item?.unit})`} type="number" value={qty} onChange={e => setQty(e.target.value)} sx={{ flex: 1 }} />
            <TextField label="Price/unit ₹" type="number" value={price} onChange={e => setPrice(e.target.value)} sx={{ flex: 1 }} />
          </Stack>
          <TextField label="Seller / Vendor" value={seller} onChange={e => setSeller(e.target.value)} />
          <TextField label="Date" type="date" value={date} onChange={e => setDate(e.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField label="Notes" value={notes} onChange={e => setNotes(e.target.value)} multiline rows={2} />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, borderTop: "1px solid #F1F5F9" }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={saving}
          sx={{ bgcolor: C.green, "&:hover": { bgcolor: "#047857" } }}>
          {saving ? <CircularProgress size={18} color="inherit" /> : "Save Purchase"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Consumable Usage Modal ────────────────────────────────────────────────────
function ConsumableUsageModal({ open, item, onClose, onSaved }) {
  const [eventType, setEventType] = useState("USE");
  const [date, setDate] = useState(today());
  const [qty, setQty] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    if (!qty || parseFloat(qty) <= 0) { setErr("Qty must be positive."); return; }
    setSaving(true); setErr("");
    const res = await fetch(`${API}/consumables/usages/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item_id: item.id, event_type: eventType, date, quantity: parseFloat(qty), notes }),
    });
    const data = await res.json();
    if (!res.ok) { setErr(data.error || "Failed"); setSaving(false); return; }
    onSaved();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
      <DialogTitle sx={{ fontWeight: 800, borderBottom: "1px solid #F1F5F9" }}>
        Record Usage — {item?.name}
      </DialogTitle>
      <DialogContent sx={{ pt: 3 }}>
        <Stack spacing={2.5}>
          {err && <Alert severity="error">{err}</Alert>}
          <FormControl fullWidth>
            <InputLabel>Event Type</InputLabel>
            <Select value={eventType} label="Event Type" onChange={e => setEventType(e.target.value)}>
              <MenuItem value="USE">Regular Use</MenuItem>
              <MenuItem value="OPEN">📦 Opened New Package</MenuItem>
              <MenuItem value="WASTE">Waste / Discarded</MenuItem>
            </Select>
          </FormControl>
          {eventType === "OPEN" && (
            <Alert severity="info" sx={{ borderRadius: 2 }}>
              This records that you opened a new package on this date.
            </Alert>
          )}
          <TextField label="Date" type="date" value={date} onChange={e => setDate(e.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField label={`Qty used (${item?.unit})`} type="number" value={qty} onChange={e => setQty(e.target.value)} />
          <TextField label="Notes" value={notes} onChange={e => setNotes(e.target.value)} multiline rows={2} />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, borderTop: "1px solid #F1F5F9" }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={saving}
          sx={{ bgcolor: eventType === "OPEN" ? C.blue : C.amber, "&:hover": { opacity: 0.9 } }}>
          {saving ? <CircularProgress size={18} color="inherit" /> : "Record"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Overview Section ──────────────────────────────────────────────────────────
function OverviewSection() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/inventory/charts/`);
      setData(await r.json());
    } catch { }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <SectionLoader />;
  if (!data) return <Alert severity="error">Failed to load chart data.</Alert>;

  const { stock_by_sku = [], stock_status = {}, monthly_purchases = [], consumable_monthly = [], total_skus, total_stock, total_value, top_by_value = [] } = data;

  const pieData = [
    { id: 0, value: stock_status.instock || 0, label: "In Stock", color: C.green },
    { id: 1, value: stock_status.low || 0, label: "Low Stock", color: C.amber },
    { id: 2, value: stock_status.out || 0, label: "Out of Stock", color: C.red },
  ].filter(d => d.value > 0);

  const monthLabels = monthly_purchases.map(m => m.month);
  const monthQtys = monthly_purchases.map(m => m.total_qty || 0);

  const catColors = ["#6D28D9", "#2563EB", "#059669", "#D97706", "#E11D48", "#64748B"];
  const consCats = [...new Set(consumable_monthly.map(m => m.category))];
  const consMonths = [...new Set(consumable_monthly.map(m => m.month))];

  return (
    <Stack spacing={3}>
      {/* KPI Row */}
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} flexWrap="wrap">
        <KpiCard label="Total SKUs" value={total_skus || 0} icon={<InventoryIcon />} color={C.orange} />
        <KpiCard label="Total Stock" value={`${total_stock || 0} units`} icon={<LocalShippingIcon />} color={C.blue} />
        <KpiCard label="Stock Value" value={fmt(total_value)} icon={<CheckCircleOutlinedIcon />} color={C.green} />
        <KpiCard label="Low / Out" value={`${stock_status.low || 0} / ${stock_status.out || 0}`}
          sub="SKUs needing attention" icon={<WarningAmberIcon />} color={C.amber} />
      </Stack>

      {/* Charts Row 1 */}
      <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
        <Card variant="outlined" sx={{ flex: 2, borderRadius: 3, borderColor: "#E2E8F0" }}>
          <CardContent>
            <Typography variant="subtitle2" fontWeight={700} mb={2}>Top SKUs by Stock Level</Typography>
            {stock_by_sku.length > 0 ? (
              <BarChart
                dataset={stock_by_sku.slice(0, 15)}
                yAxis={[{ scaleType: "band", dataKey: "sku_id" }]}
                series={[{ dataKey: "stock", label: "Stock", color: C.orange }]}
                layout="horizontal"
                height={320}
                margin={{ left: 100, right: 20, top: 10, bottom: 30 }}
              />
            ) : <Box py={4} textAlign="center"><Typography color="text.secondary">No stock data</Typography></Box>}
          </CardContent>
        </Card>
        <Card variant="outlined" sx={{ flex: 1, borderRadius: 3, borderColor: "#E2E8F0" }}>
          <CardContent>
            <Typography variant="subtitle2" fontWeight={700} mb={2}>Stock Status Distribution</Typography>
            {pieData.length > 0 ? (
              <PieChart
                series={[{ data: pieData, innerRadius: 55, outerRadius: 100, paddingAngle: 3, cornerRadius: 4 }]}
                height={280}
                slotProps={{ legend: { position: { vertical: "bottom", horizontal: "middle" } } }}
              />
            ) : <Box py={4} textAlign="center"><Typography color="text.secondary">No data</Typography></Box>}
          </CardContent>
        </Card>
      </Stack>

      {/* Charts Row 2 */}
      <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
        <Card variant="outlined" sx={{ flex: 1, borderRadius: 3, borderColor: "#E2E8F0" }}>
          <CardContent>
            <Typography variant="subtitle2" fontWeight={700} mb={2}>Monthly Purchase Trend</Typography>
            {monthLabels.length > 1 ? (
              <LineChart
                xAxis={[{ data: monthLabels, scaleType: "point" }]}
                series={[{ data: monthQtys, label: "Units Purchased", color: C.blue }]}
                height={220}
                margin={{ left: 50, right: 20, top: 10, bottom: 40 }}
              />
            ) : <Box py={4} textAlign="center"><Typography color="text.secondary">Not enough data</Typography></Box>}
          </CardContent>
        </Card>
        <Card variant="outlined" sx={{ flex: 1, borderRadius: 3, borderColor: "#E2E8F0" }}>
          <CardContent>
            <Typography variant="subtitle2" fontWeight={700} mb={2}>Top SKUs by Purchase Value</Typography>
            {top_by_value.length > 0 ? (
              <BarChart
                dataset={top_by_value.slice(0, 10)}
                xAxis={[{ scaleType: "band", dataKey: "sku_id" }]}
                series={[{ dataKey: "purchase_value", label: "Value ₹", color: C.green }]}
                height={220}
                margin={{ left: 60, right: 20, top: 10, bottom: 50 }}
              />
            ) : <Box py={4} textAlign="center"><Typography color="text.secondary">No data</Typography></Box>}
          </CardContent>
        </Card>
      </Stack>
    </Stack>
  );
}

// ── Stock Section ─────────────────────────────────────────────────────────────
function StockSection() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [adjSku, setAdjSku] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [showStock, setShowStock] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const debRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQ) params.set("search", searchQ);
      const r = await fetch(`${API}/inventory/?${params}`);
      const d = await r.json();
      setRows(d.results || d);
    } catch { }
    setLoading(false);
  }, [searchQ]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    clearTimeout(debRef.current);
    debRef.current = setTimeout(() => setSearchQ(search), 350);
  }, [search]);

  const filtered = rows.filter(r => {
    if (filter === "instock") return r.current_stock > 5;
    if (filter === "low") return r.current_stock > 0 && r.current_stock <= 5;
    if (filter === "out") return r.current_stock <= 0;
    return true;
  });

  const counts = {
    all: rows.length,
    instock: rows.filter(r => r.current_stock > 5).length,
    low: rows.filter(r => r.current_stock > 0 && r.current_stock <= 5).length,
    out: rows.filter(r => r.current_stock <= 0).length,
  };

  const deleteSku = async (skuId) => {
    const res = await fetch(`${API}/inventory/${skuId}/`, { method: "DELETE" });
    if (res.ok || res.status === 204) { setConfirm(null); load(); }
  };

  const tabSx = (active) => ({
    textTransform: "none", fontWeight: 600, fontSize: 13, minWidth: "auto",
    px: 2, py: 0.75, borderRadius: 2,
    color: active ? "#fff" : "text.secondary",
    bgcolor: active ? C.orange : "transparent",
    "&:hover": { bgcolor: active ? C.orange : "#F1F5F9" },
  });

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }} justifyContent="space-between">
        <Stack direction="row" spacing={1} flexWrap="wrap">
          {[["all", "All"], ["instock", "In Stock"], ["low", "Low Stock"], ["out", "Out of Stock"]].map(([key, label]) => (
            <Button key={key} size="small" onClick={() => setFilter(key)} sx={tabSx(filter === key)}>
              {label} <Box component="span" sx={{ ml: 0.5, fontSize: 11, opacity: 0.8 }}>({counts[key]})</Box>
            </Button>
          ))}
        </Stack>
        <Stack direction="row" spacing={1}>
          <TextField size="small" placeholder="Search SKU…" value={search} onChange={e => setSearch(e.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" sx={{ color: "text.secondary" }} /></InputAdornment> }}
            sx={{ width: 200 }} />
          <Button variant="outlined" size="small" onClick={() => setShowStock(true)}
            startIcon={<AddIcon />} sx={{ borderColor: C.green, color: C.green, textTransform: "none" }}>
            Add Stock
          </Button>
          <Button variant="contained" size="small" onClick={() => setShowNew(true)}
            startIcon={<AddIcon />} sx={{ bgcolor: C.orange, "&:hover": { bgcolor: "#5B21B6" }, textTransform: "none" }}>
            New SKU
          </Button>
        </Stack>
      </Stack>

      {loading ? <SectionLoader /> : (
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 3, borderColor: "#E2E8F0" }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: "#F8FAFC" }}>
                {["Parent SKU", "Purchase Value", "Purchased", "Sold", "RTO", "Adjusted", "Current Stock", "Actions"].map(h => (
                  <TableCell key={h} sx={{ fontWeight: 700, fontSize: 12, color: "#64748B", py: 1.5 }}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 6, color: "text.secondary" }}>
                    No SKUs found
                  </TableCell>
                </TableRow>
              ) : filtered.map(row => (
                <TableRow key={row.sku_id} hover sx={{ "&:last-child td": { border: 0 } }}>
                  <TableCell sx={{ fontWeight: 700, color: C.orange, fontSize: 13 }}>{row.sku_id}</TableCell>
                  <TableCell>{row.purchase_value ? fmt(row.purchase_value) : "—"}</TableCell>
                  <TableCell>{row.purchased_qty}</TableCell>
                  <TableCell sx={{ color: C.red }}>{row.sold_qty}</TableCell>
                  <TableCell sx={{ color: C.green }}>{row.rto_qty}</TableCell>
                  <TableCell sx={{ color: row.adjustment_qty >= 0 ? C.green : C.red }}>
                    {row.adjustment_qty > 0 ? `+${row.adjustment_qty}` : row.adjustment_qty}
                  </TableCell>
                  <TableCell><StockBadge stock={row.current_stock} /></TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5}>
                      <Tooltip title="Adjust Stock">
                        <IconButton size="small" onClick={() => setAdjSku(row.sku_id)}
                          sx={{ color: C.amber }}>
                          <TuneIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete SKU">
                        <IconButton size="small" onClick={() => setConfirm(row.sku_id)}
                          sx={{ color: C.red }}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {showNew && <NewSKUModal onSave={() => { setShowNew(false); load(); }} onClose={() => setShowNew(false)} />}
      {showStock && <AddStockModal open={showStock} onClose={() => setShowStock(false)} onSaved={load} />}
      {adjSku && <AdjustmentModal open sku={adjSku} onClose={() => setAdjSku(null)} onSaved={() => { setAdjSku(null); load(); }} />}

      <Dialog open={!!confirm} onClose={() => setConfirm(null)} PaperProps={{ sx: { borderRadius: 3 } }}>
        <DialogTitle sx={{ fontWeight: 800 }}>Delete SKU?</DialogTitle>
        <DialogContent>
          <Typography>Delete <strong>{confirm}</strong> and all its purchase history? This cannot be undone.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={() => deleteSku(confirm)}>Delete</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

// ── Consumable Card ───────────────────────────────────────────────────────────
function ConsumableCard({ item, onEdit, onPurchase, onUsage, onDelete }) {
  const [history, setHistory] = useState([]);
  const [expanded, setExpanded] = useState(false);
  const [loadingH, setLoadingH] = useState(false);
  const catLabel = CONSUMABLE_CATEGORIES.find(c => c.value === item.category)?.label || item.category;
  const color = CAT_COLORS[item.category] || "#64748B";

  const loadHistory = async () => {
    if (expanded) { setExpanded(false); return; }
    setLoadingH(true);
    try {
      const [pRes, uRes] = await Promise.all([
        fetch(`${API}/consumables/purchases/?item_id=${item.id}&page_size=10`),
        fetch(`${API}/consumables/usages/?item_id=${item.id}&page_size=10`),
      ]);
      const [p, u] = await Promise.all([pRes.json(), uRes.json()]);
      const purchases = (p.results || p).map(x => ({ ...x, _type: "PURCHASE" }));
      const usages = (u.results || u).map(x => ({ ...x, _type: "USAGE" }));
      setHistory([...purchases, ...usages].sort((a, b) => new Date(b.date) - new Date(a.date)));
    } catch { }
    setLoadingH(false);
    setExpanded(true);
  };

  return (
    <Card variant="outlined" sx={{ borderRadius: 3, borderColor: "#E2E8F0", overflow: "hidden" }}>
      <Box sx={{ height: 4, bgcolor: color }} />
      <CardContent sx={{ pb: "12px !important" }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Box>
            <Typography fontWeight={800} fontSize={15}>{item.name}</Typography>
            <Stack direction="row" spacing={1} mt={0.5}>
              <Chip label={catLabel} size="small" sx={{ bgcolor: color + "20", color, fontWeight: 600, fontSize: 11 }} />
              <Chip label={item.unit} size="small" variant="outlined" sx={{ fontSize: 11 }} />
            </Stack>
          </Box>
          <Stack direction="row" spacing={0.5}>
            <Tooltip title="Edit"><IconButton size="small" onClick={() => onEdit(item)}><EditIcon fontSize="small" /></IconButton></Tooltip>
            <Tooltip title="Delete"><IconButton size="small" onClick={() => onDelete(item)} sx={{ color: C.red }}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
          </Stack>
        </Stack>
        {item.notes && <Typography variant="caption" color="text.secondary" mt={1} display="block">{item.notes}</Typography>}
        <Stack direction="row" spacing={1} mt={1.5}>
          <Button size="small" variant="outlined" onClick={() => onPurchase(item)}
            sx={{ textTransform: "none", borderColor: C.green, color: C.green, fontSize: 12, py: 0.5 }}>
            + Restock
          </Button>
          <Button size="small" variant="outlined" onClick={() => onUsage(item)}
            sx={{ textTransform: "none", borderColor: C.blue, color: C.blue, fontSize: 12, py: 0.5 }}>
            Record Use
          </Button>
          <Button size="small" onClick={loadHistory} startIcon={loadingH ? <CircularProgress size={12} /> : <HistoryIcon />}
            sx={{ textTransform: "none", color: "text.secondary", fontSize: 12, py: 0.5 }}>
            {expanded ? "Hide" : "History"}
          </Button>
        </Stack>
        {expanded && (
          <Box mt={2} sx={{ maxHeight: 240, overflowY: "auto" }}>
            {history.length === 0 ? (
              <Typography variant="caption" color="text.secondary">No history yet.</Typography>
            ) : history.map((h, i) => (
              <Stack key={i} direction="row" justifyContent="space-between" alignItems="center"
                sx={{ py: 0.75, borderBottom: "1px solid #F1F5F9" }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Chip
                    label={h._type === "PURCHASE" ? "Restocked" : (h.event_type === "OPEN" ? "📦 Opened" : h.event_type === "WASTE" ? "Waste" : "Used")}
                    size="small"
                    sx={{
                      bgcolor: h._type === "PURCHASE" ? "#ECFDF5" : h.event_type === "OPEN" ? "#EFF6FF" : "#FFF1F2",
                      color: h._type === "PURCHASE" ? C.green : h.event_type === "OPEN" ? C.blue : C.red,
                      fontWeight: 600, fontSize: 10,
                    }}
                  />
                  <Typography variant="caption" color="text.secondary">{h.date}</Typography>
                  {h.notes && <Typography variant="caption" color="text.secondary" sx={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.notes}</Typography>}
                </Stack>
                <Typography variant="caption" fontWeight={700} color={h._type === "PURCHASE" ? C.green : C.red}>
                  {h._type === "PURCHASE" ? `+${h.quantity} ${item.unit}` : `-${h.quantity} ${item.unit}`}
                </Typography>
              </Stack>
            ))}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

// ── Consumables Section ───────────────────────────────────────────────────────
function ConsumablesSection() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editItem, setEditItem] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [purchaseFor, setPurchaseFor] = useState(null);
  const [usageFor, setUsageFor] = useState(null);
  const [deleteFor, setDeleteFor] = useState(null);
  const [catFilter, setCatFilter] = useState("ALL");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/consumables/items/`);
      const d = await r.json();
      setItems(d.results || d);
    } catch { }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const deleteItem = async () => {
    const res = await fetch(`${API}/consumables/items/${deleteFor.id}/`, { method: "DELETE" });
    if (res.ok || res.status === 204) { setDeleteFor(null); load(); }
  };

  const filtered = catFilter === "ALL" ? items : items.filter(i => i.category === catFilter);

  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
        <Stack direction="row" spacing={1} flexWrap="wrap">
          <Button size="small" onClick={() => setCatFilter("ALL")}
            sx={{ textTransform: "none", fontWeight: 600, bgcolor: catFilter === "ALL" ? C.orange : "transparent", color: catFilter === "ALL" ? "#fff" : "text.secondary", borderRadius: 2 }}>
            All
          </Button>
          {CONSUMABLE_CATEGORIES.map(c => (
            <Button key={c.value} size="small" onClick={() => setCatFilter(c.value)}
              sx={{ textTransform: "none", fontWeight: 600, bgcolor: catFilter === c.value ? CAT_COLORS[c.value] : "transparent", color: catFilter === c.value ? "#fff" : "text.secondary", borderRadius: 2 }}>
              {c.label}
            </Button>
          ))}
        </Stack>
        <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={() => setShowNew(true)}
          sx={{ bgcolor: C.orange, "&:hover": { bgcolor: "#5B21B6" }, textTransform: "none" }}>
          New Consumable
        </Button>
      </Stack>

      {loading ? <SectionLoader /> : (
        filtered.length === 0 ? (
          <Box textAlign="center" py={8}>
            <Typography color="text.secondary">No consumables found. Add one to start tracking.</Typography>
          </Box>
        ) : (
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "1fr 1fr 1fr" }, gap: 2 }}>
            {filtered.map(item => (
              <ConsumableCard key={item.id} item={item}
                onEdit={i => setEditItem(i)}
                onPurchase={i => setPurchaseFor(i)}
                onUsage={i => setUsageFor(i)}
                onDelete={i => setDeleteFor(i)}
              />
            ))}
          </Box>
        )
      )}

      {(showNew || editItem) && (
        <ConsumableItemModal open item={editItem} onClose={() => { setShowNew(false); setEditItem(null); }}
          onSaved={() => { setShowNew(false); setEditItem(null); load(); }} />
      )}
      {purchaseFor && (
        <ConsumablePurchaseModal open item={purchaseFor} onClose={() => setPurchaseFor(null)}
          onSaved={() => { setPurchaseFor(null); load(); }} />
      )}
      {usageFor && (
        <ConsumableUsageModal open item={usageFor} onClose={() => setUsageFor(null)}
          onSaved={() => { setUsageFor(null); load(); }} />
      )}
      <Dialog open={!!deleteFor} onClose={() => setDeleteFor(null)} PaperProps={{ sx: { borderRadius: 3 } }}>
        <DialogTitle fontWeight={800}>Delete Consumable?</DialogTitle>
        <DialogContent>
          <Typography>Delete <strong>{deleteFor?.name}</strong> and all its history? This cannot be undone.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteFor(null)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={deleteItem}>Delete</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

// ── History Section ───────────────────────────────────────────────────────────
const ACTION_COLORS = { CREATE: "#059669", UPDATE: "#D97706", DELETE: "#E11D48" };
const ACTION_BG = { CREATE: "#ECFDF5", UPDATE: "#FFFBEB", DELETE: "#FFF1F2" };

function HistorySection() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({ entity_type: "", action: "", parent_sku: "", date_from: "", date_to: "" });

  const PAGE_SIZE = 25;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, page_size: PAGE_SIZE });
      Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
      const r = await fetch(`${API}/inventory/logs/?${params}`);
      const d = await r.json();
      setLogs(d.results || []);
      setTotal(d.count || 0);
    } catch { }
    setLoading(false);
  }, [page, filters]);

  useEffect(() => { load(); }, [load]);

  const setFilter = (k, v) => { setFilters(f => ({ ...f, [k]: v })); setPage(1); };

  const entityLabel = (type) => {
    const map = { PURCHASE: "Purchase", ADJUSTMENT: "Adjustment", SKU: "SKU", CONSUMABLE_PURCHASE: "Consumable Purchase", CONSUMABLE_USAGE: "Consumable Usage", CONSUMABLE_ITEM: "Consumable Item" };
    return map[type] || type;
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <Stack spacing={2}>
      {/* Filters */}
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} flexWrap="wrap">
        <TextField label="Parent SKU" size="small" value={filters.parent_sku}
          onChange={e => setFilter("parent_sku", e.target.value)} sx={{ minWidth: 160 }} />
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>Entity Type</InputLabel>
          <Select value={filters.entity_type} label="Entity Type" onChange={e => setFilter("entity_type", e.target.value)}>
            <MenuItem value="">All</MenuItem>
            <MenuItem value="PURCHASE">Purchase</MenuItem>
            <MenuItem value="ADJUSTMENT">Adjustment</MenuItem>
            <MenuItem value="SKU">SKU</MenuItem>
            <MenuItem value="CONSUMABLE_ITEM">Consumable Item</MenuItem>
            <MenuItem value="CONSUMABLE_PURCHASE">Consumable Purchase</MenuItem>
            <MenuItem value="CONSUMABLE_USAGE">Consumable Usage</MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 130 }}>
          <InputLabel>Action</InputLabel>
          <Select value={filters.action} label="Action" onChange={e => setFilter("action", e.target.value)}>
            <MenuItem value="">All</MenuItem>
            <MenuItem value="CREATE">Create</MenuItem>
            <MenuItem value="UPDATE">Update</MenuItem>
            <MenuItem value="DELETE">Delete</MenuItem>
          </Select>
        </FormControl>
        <TextField label="From Date" type="date" size="small" value={filters.date_from}
          onChange={e => setFilter("date_from", e.target.value)} InputLabelProps={{ shrink: true }} sx={{ minWidth: 150 }} />
        <TextField label="To Date" type="date" size="small" value={filters.date_to}
          onChange={e => setFilter("date_to", e.target.value)} InputLabelProps={{ shrink: true }} sx={{ minWidth: 150 }} />
        <IconButton onClick={load} sx={{ alignSelf: "center" }}>
          <RefreshIcon fontSize="small" />
        </IconButton>
      </Stack>

      <Typography variant="caption" color="text.secondary">
        Showing {logs.length} of {total} audit entries
      </Typography>

      {loading ? <SectionLoader /> : (
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 3, borderColor: "#E2E8F0" }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: "#F8FAFC" }}>
                {["Date & Time", "Action", "Entity", "Parent SKU", "Qty Change", "Description"].map(h => (
                  <TableCell key={h} sx={{ fontWeight: 700, fontSize: 12, color: "#64748B", py: 1.5 }}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 6, color: "text.secondary" }}>
                    No audit logs found
                  </TableCell>
                </TableRow>
              ) : logs.map(log => (
                <TableRow key={log.id} hover sx={{ "&:last-child td": { border: 0 } }}>
                  <TableCell sx={{ fontSize: 12, whiteSpace: "nowrap" }}>
                    {new Date(log.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                  </TableCell>
                  <TableCell>
                    <Chip label={log.action} size="small"
                      sx={{ bgcolor: ACTION_BG[log.action], color: ACTION_COLORS[log.action], fontWeight: 700, fontSize: 11 }} />
                  </TableCell>
                  <TableCell sx={{ fontSize: 12 }}>{entityLabel(log.entity_type)}</TableCell>
                  <TableCell sx={{ fontSize: 12, color: C.orange, fontWeight: 600 }}>{log.parent_sku_id || "—"}</TableCell>
                  <TableCell sx={{ fontSize: 12, fontWeight: 700, color: log.quantity_change >= 0 ? C.green : C.red }}>
                    {log.quantity_change != null ? (log.quantity_change >= 0 ? `+${log.quantity_change}` : log.quantity_change) : "—"}
                  </TableCell>
                  <TableCell sx={{ fontSize: 12, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <Tooltip title={log.description}><span>{log.description}</span></Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {totalPages > 1 && (
        <Stack direction="row" spacing={1} justifyContent="center" alignItems="center">
          <Button size="small" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</Button>
          <Typography variant="caption" color="text.secondary">Page {page} of {totalPages}</Typography>
          <Button size="small" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next →</Button>
        </Stack>
      )}
    </Stack>
  );
}

// ── Main InventoryTab ─────────────────────────────────────────────────────────
export function InventoryTab() {
  const [section, setSection] = useState(0);
  const [toast, setToast] = useState("");

  const sections = ["Overview", "Stock", "Consumables", "History"];

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1400, mx: "auto" }}>
      {/* Header */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
        <Box>
          <Typography variant="h5" fontWeight={800} color="text.primary">Inventory</Typography>
          <Typography variant="caption" color="text.secondary">Track stock, consumables, and all inventory activity</Typography>
        </Box>
      </Stack>

      {/* Section Tabs */}
      <Stack direction="row" spacing={0.5} mb={3} p={0.5}
        sx={{ bgcolor: "#F1F5F9", borderRadius: 2.5, display: "inline-flex" }}>
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

      {/* Content */}
      {section === 0 && <OverviewSection />}
      {section === 1 && <StockSection />}
      {section === 2 && <ConsumablesSection />}
      {section === 3 && <HistorySection />}

      <Snackbar open={!!toast} autoHideDuration={3000} onClose={() => setToast("")}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
        <Alert severity="success" onClose={() => setToast("")} sx={{ borderRadius: 2 }}>{toast}</Alert>
      </Snackbar>
    </Box>
  );
}
