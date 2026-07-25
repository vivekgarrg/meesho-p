import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { API, C, fmt } from "../../App";
import { useDateFilter } from "../../contexts/DateFilterContext";
import {
  Alert, Autocomplete, Box, Button, Chip, CircularProgress, Divider, Drawer,
  FormControlLabel, Switch, IconButton, InputAdornment, Paper, Stack,
  TextField, Tooltip, Typography, Collapse,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import DownloadIcon from "@mui/icons-material/Download";
import EditIcon from "@mui/icons-material/Edit";
import SearchIcon from "@mui/icons-material/Search";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import StorefrontIcon from "@mui/icons-material/Storefront";
import InventoryIcon from "@mui/icons-material/Inventory2";
import CloseIcon from "@mui/icons-material/Close";
import RefreshIcon from "@mui/icons-material/Refresh";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import PaymentsIcon from "@mui/icons-material/Payments";

// ── Helpers ───────────────────────────────────────────────────────────────────
const todayStr = () => new Date().toISOString().slice(0, 10);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(d) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day} ${MONTHS[+m - 1]} ${y}`;
}
const emptyItem = () => ({ parent_sku_id: "", product_description: "", quantity: "1", price_per_unit: "", is_exchange: false });
const lineTotal = (it) => (it.is_exchange ? 0 : (parseFloat(it.quantity) || 0) * (parseFloat(it.price_per_unit) || 0));
const calcTotal = (items) => items.reduce((s, it) => s + lineTotal(it), 0);
const money = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── Parent-SKU autocomplete (searches existing parent prices) ──
function SkuAutocomplete({ value, onChange, onEnter }) {
  const [options, setOptions] = useState([]);
  const [input, setInput] = useState(value || "");
  const [loading, setLoading] = useState(false);
  const debRef = useRef(null);
  useEffect(() => { setInput(value || ""); }, [value]);
  useEffect(() => {
    if (!input) { setOptions([]); return; }
    clearTimeout(debRef.current);
    debRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`${API}/parent-prices/?search=${encodeURIComponent(input)}&page_size=20`);
        const d = await r.json();
        setOptions((d.results || d).map((p) => p.item_id));
      } catch { /* ignore */ }
      setLoading(false);
    }, 220);
  }, [input]);
  return (
    <Autocomplete
      freeSolo size="small" options={options} value={value} inputValue={input} loading={loading}
      onInputChange={(_, v) => { setInput(v); onChange(v); }}
      onChange={(_, v) => { if (v != null) { setInput(v); onChange(v); } }}
      renderInput={(params) => (
        <TextField {...params} placeholder="Parent SKU (optional)"
          onKeyDown={(e) => { if (e.key === "Enter" && onEnter) { e.preventDefault(); onEnter(); } }}
          InputProps={{ ...(params.InputProps ?? {}), endAdornment: <>{loading && <CircularProgress size={12} />}{params.InputProps?.endAdornment}</> }}
          inputProps={{ ...params.inputProps, style: { fontSize: 13 } }} />
      )}
    />
  );
}

// ── Add / Edit purchase drawer (optimized for fast entry) ──
function PurchaseFormDrawer({ open, initial, sellers, onClose, onSaved }) {
  const [date, setDate] = useState(todayStr());
  const [seller, setSeller] = useState("");
  const [billNo, setBillNo] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState([emptyItem()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const sellerRef = useRef(null);

  const reset = useCallback((keepMeta) => {
    setItems([emptyItem()]);
    setError("");
    if (!keepMeta) { setSeller(""); setBillNo(""); setNotes(""); setDate(todayStr()); }
  }, []);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setDate(initial.date || todayStr());
      setSeller(initial.seller_name || "");
      setBillNo(initial.bill_number || "");
      setNotes(initial.notes || "");
      setItems(initial.items?.length ? initial.items.map((i) => ({ ...i, quantity: String(i.quantity) })) : [emptyItem()]);
    } else {
      reset(false);
    }
    setFlash("");
  }, [open, initial, reset]);

  const setItem = (idx, field, val) => setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [field]: val } : it)));
  const addRow = () => setItems((p) => [...p, emptyItem()]);
  const grand = calcTotal(items);

  const save = async (addAnother) => {
    if (!date || !seller.trim()) { setError("Date and seller are required."); return; }
    const clean = items.filter((it) => it.parent_sku_id.trim() || it.product_description.trim());
    if (clean.length === 0) { setError("Add at least one item (SKU or description)."); return; }
    for (const it of clean) {
      if (!it.is_exchange && !(parseFloat(it.price_per_unit) > 0)) { setError("Enter a price for every non-exchange item."); return; }
    }
    setSaving(true); setError("");
    try {
      const isEdit = !!initial?.id;
      const url = isEdit ? `${API}/purchases/${initial.id}/` : `${API}/purchases/`;
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, seller_name: seller, bill_number: billNo, notes, items: clean }),
      });
      if (!res.ok) { setError("Save failed — check your inputs."); setSaving(false); return; }
      const saved = await res.json();
      onSaved(saved);
      if (addAnother && !isEdit) {
        setFlash(`Saved ${money(saved.total_amount)} — ready for the next one.`);
        reset(true);                       // keep seller/date, clear items
        setTimeout(() => sellerRef.current?.focus(), 50);
      } else {
        onClose();
      }
    } catch { setError("Network error."); }
    finally { setSaving(false); }
  };

  return (
    <Drawer anchor="right" open={open} onClose={onClose}
      PaperProps={{ sx: { width: { xs: "100%", sm: 620 } } }}>
      <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <Box sx={{ position: "relative", px: 3, py: 2.5, pr: 7, background: `linear-gradient(135deg, ${C.orange} 0%, #7C3AED 100%)`, color: "#fff" }}>
          <Typography fontWeight={800} fontSize={19}>{initial?.id ? "Edit Purchase" : "New Purchase"}</Typography>
          <Typography variant="caption" sx={{ opacity: 0.85 }}>Stock purchases auto-update inventory</Typography>
          <IconButton onClick={onClose} aria-label="Close"
            sx={{ position: "absolute", top: 10, right: 10, color: "#fff", bgcolor: "rgba(255,255,255,0.18)", "&:hover": { bgcolor: "rgba(255,255,255,0.30)" } }}>
            <CloseIcon />
          </IconButton>
        </Box>

        {/* Body */}
        <Box sx={{ flex: 1, overflowY: "auto", px: 3, py: 2.5 }}>
          <Stack spacing={2}>
            {flash && <Alert severity="success" sx={{ borderRadius: 2 }}>{flash}</Alert>}
            {error && <Alert severity="error" sx={{ borderRadius: 2 }}>{error}</Alert>}

            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              <TextField label="Date" type="date" size="small" value={date} onChange={(e) => setDate(e.target.value)} InputLabelProps={{ shrink: true }} sx={{ flex: 1 }} />
              <Autocomplete freeSolo size="small" options={sellers} value={seller} sx={{ flex: 2 }}
                onInputChange={(_, v) => setSeller(v)} onChange={(_, v) => setSeller(v || "")}
                renderInput={(p) => <TextField {...p} inputRef={sellerRef} label="Seller / Vendor" placeholder="e.g. Raj Textiles" />} />
              <TextField label="Bill No." size="small" value={billNo} onChange={(e) => setBillNo(e.target.value)} placeholder="INV-001" sx={{ flex: 1 }} />
            </Stack>

            <Divider textAlign="left"><Typography variant="caption" color="text.secondary" fontWeight={700}>ITEMS</Typography></Divider>

            <Stack spacing={1.25}>
              {items.map((it, idx) => (
                <Paper key={idx} variant="outlined"
                  sx={{ p: 1.5, borderRadius: 2, borderColor: it.is_exchange ? "#FDE68A" : "#E2E8F0", bgcolor: it.is_exchange ? "#FFFBEB" : "#fff" }}>
                  <Stack direction="row" spacing={1} alignItems="center" mb={1}>
                    <Box sx={{ flex: 1 }}>
                      <SkuAutocomplete value={it.parent_sku_id} onChange={(v) => setItem(idx, "parent_sku_id", v)} onEnter={addRow} />
                    </Box>
                    <Tooltip title="Exchange (no cost, adds stock)">
                      <FormControlLabel sx={{ m: 0 }}
                        control={<Switch size="small" checked={it.is_exchange} onChange={(e) => setItem(idx, "is_exchange", e.target.checked)} />}
                        label={<Typography fontSize={11} fontWeight={700} color={it.is_exchange ? C.amber : "text.secondary"}>Exch</Typography>} />
                    </Tooltip>
                    <IconButton size="small" onClick={() => setItems((p) => p.filter((_, i) => i !== idx))} disabled={items.length === 1} sx={{ color: C.red }}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <TextField size="small" placeholder="Description (optional)" value={it.product_description}
                      onChange={(e) => setItem(idx, "product_description", e.target.value)} sx={{ flex: 2 }} inputProps={{ style: { fontSize: 13 } }} />
                    <TextField size="small" type="number" label="Qty" value={it.quantity}
                      onChange={(e) => setItem(idx, "quantity", e.target.value)} sx={{ width: 74 }} inputProps={{ min: 1, style: { fontSize: 13 } }} InputLabelProps={{ shrink: true }} />
                    <TextField size="small" type="number" label="Rate ₹" value={it.price_per_unit} disabled={it.is_exchange}
                      onChange={(e) => setItem(idx, "price_per_unit", e.target.value)} sx={{ width: 110 }}
                      inputProps={{ min: 0, step: "0.01", style: { fontSize: 13 } }} InputLabelProps={{ shrink: true }}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRow(); } }} />
                    <Box sx={{ width: 96, textAlign: "right" }}>
                      <Typography fontSize={13} fontWeight={800} fontFamily="monospace" color={it.is_exchange ? "text.disabled" : C.green}>
                        {it.is_exchange ? "exch" : money(lineTotal(it))}
                      </Typography>
                    </Box>
                  </Stack>
                </Paper>
              ))}
            </Stack>

            <Button startIcon={<AddIcon />} onClick={addRow} sx={{ alignSelf: "flex-start", color: C.orange, textTransform: "none" }}>
              Add another item
            </Button>

            <TextField label="Notes (optional)" size="small" value={notes} onChange={(e) => setNotes(e.target.value)} fullWidth multiline minRows={2} />
          </Stack>
        </Box>

        {/* Footer */}
        <Box sx={{ px: 3, py: 2, borderTop: "1px solid #F1F5F9" }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1.5}>
            <Typography color="text.secondary" fontWeight={600}>Grand Total</Typography>
            <Typography fontWeight={800} fontSize={22} fontFamily="monospace" color={C.orange}>{money(grand)}</Typography>
          </Stack>
          <Stack direction="row" spacing={1}>
            <Button onClick={onClose} sx={{ color: "text.secondary", textTransform: "none" }}>Cancel</Button>
            <Box sx={{ flex: 1 }} />
            {!initial?.id && (
              <Button variant="outlined" onClick={() => save(true)} disabled={saving}
                sx={{ borderColor: C.orange, color: C.orange, textTransform: "none", borderRadius: 2, fontWeight: 700 }}>
                Save &amp; New
              </Button>
            )}
            <Button variant="contained" onClick={() => save(false)} disabled={saving}
              startIcon={saving ? <CircularProgress size={15} color="inherit" /> : null}
              sx={{ bgcolor: C.orange, "&:hover": { bgcolor: "#5B21B6" }, fontWeight: 700, textTransform: "none", borderRadius: 2, minWidth: 140 }}>
              {saving ? "Saving…" : initial?.id ? "Save Changes" : "Create Bill"}
            </Button>
          </Stack>
        </Box>
      </Box>
    </Drawer>
  );
}

// ── One bill row (expandable) ──
function BillRow({ bill, expanded, onToggle, onEdit, onDelete, onDuplicate }) {
  const regular = bill.items.filter((i) => !i.is_exchange);
  const exch = bill.items.filter((i) => i.is_exchange);
  return (
    <>
      <Box onClick={onToggle}
        sx={{
          display: "grid", gridTemplateColumns: "28px 1fr 130px 90px 120px 130px", gap: 1, alignItems: "center",
          px: 2, py: 1.5, cursor: "pointer", borderBottom: "1px solid #F1F5F9",
          "&:hover": { bgcolor: "#FAFAFF" },
        }}>
        <Box sx={{ color: C.gray400 }}>{expanded ? <KeyboardArrowDownIcon fontSize="small" /> : <KeyboardArrowRightIcon fontSize="small" />}</Box>
        <Box sx={{ minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography fontWeight={800} fontSize={14} noWrap>{bill.seller_name}</Typography>
            {exch.length > 0 && <Chip label={`${exch.length} exch`} size="small" sx={{ height: 18, fontSize: 10, bgcolor: "#FFFBEB", color: C.amber, border: "1px solid #FDE68A", fontWeight: 700 }} />}
          </Stack>
          <Typography variant="caption" color="text.secondary" noWrap>
            {bill.bill_number ? `#${bill.bill_number} · ` : ""}{regular.length} item{regular.length !== 1 ? "s" : ""}
            {bill.notes ? ` · ${bill.notes}` : ""}
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>{fmtDate(bill.date)}</Typography>
        <Typography variant="body2" color="text.secondary" textAlign="center">
          {regular.reduce((s, i) => s + Number(i.quantity), 0)} u
        </Typography>
        <Typography fontWeight={800} fontFamily="monospace" color={C.orange} textAlign="right">{money(bill.total_amount)}</Typography>
        <Stack direction="row" justifyContent="flex-end" onClick={(e) => e.stopPropagation()}>
          <Tooltip title="Duplicate"><IconButton size="small" onClick={() => onDuplicate(bill)}><ContentCopyIcon fontSize="small" /></IconButton></Tooltip>
          <Tooltip title="Edit"><IconButton size="small" onClick={() => onEdit(bill)}><EditIcon fontSize="small" /></IconButton></Tooltip>
          <Tooltip title="PDF"><IconButton size="small" component="a" href={`${API}/purchases/${bill.id}/pdf/`} target="_blank"><DownloadIcon fontSize="small" /></IconButton></Tooltip>
          <Tooltip title="Delete"><IconButton size="small" sx={{ color: C.red }} onClick={() => onDelete(bill.id)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
        </Stack>
      </Box>
      <Collapse in={expanded} unmountOnExit>
        <Box sx={{ px: 6, py: 1.5, bgcolor: "#FAFAFF", borderBottom: "1px solid #F1F5F9" }}>
          {bill.items.map((it, i) => (
            <Stack key={i} direction="row" justifyContent="space-between" alignItems="center" sx={{ py: 0.5 }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                {it.is_exchange && <SwapHorizIcon sx={{ fontSize: 15, color: C.amber }} />}
                <Typography fontSize={12.5} fontWeight={700} color={it.is_exchange ? C.amber : C.orange} noWrap>{it.parent_sku_id || "—"}</Typography>
                {it.product_description && <Typography fontSize={12} color="text.secondary" noWrap>· {it.product_description}</Typography>}
              </Stack>
              <Typography fontSize={12.5} fontFamily="monospace" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
                {it.is_exchange ? `${it.quantity} pcs (exchange)` : `${it.quantity} × ${money(it.price_per_unit)} = ${money(it.total_amount)}`}
              </Typography>
            </Stack>
          ))}
        </Box>
      </Collapse>
    </>
  );
}

function ConfirmDelete({ open, onConfirm, onCancel }) {
  const [busy, setBusy] = useState(false);
  return (
    <Drawer anchor="bottom" open={open} onClose={onCancel} PaperProps={{ sx: { borderRadius: "16px 16px 0 0", maxWidth: 440, mx: "auto", p: 3 } }}>
      <Typography fontWeight={800} fontSize={18} mb={1}>Delete this purchase?</Typography>
      <Typography color="text.secondary" fontSize={14} mb={3}>It will be removed from inventory history. This cannot be undone.</Typography>
      <Stack direction="row" spacing={1} justifyContent="flex-end">
        <Button onClick={onCancel} sx={{ textTransform: "none" }}>Cancel</Button>
        <Button variant="contained" color="error" disabled={busy} onClick={async () => { setBusy(true); await onConfirm(); setBusy(false); }} sx={{ textTransform: "none", borderRadius: 2 }}>
          {busy ? <CircularProgress size={16} color="inherit" /> : "Delete"}
        </Button>
      </Stack>
    </Drawer>
  );
}

function Kpi({ label, value, sub, icon, color }) {
  return (
    <Paper variant="outlined" sx={{ borderRadius: 3, borderColor: "#E2E8F0", p: 2, minWidth: 0 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
        <Typography variant="caption" fontWeight={700} color="text.secondary" textTransform="uppercase" letterSpacing={0.5} fontSize={10}>{label}</Typography>
        <Box sx={{ color, opacity: 0.7 }}>{icon}</Box>
      </Stack>
      <Typography fontWeight={800} fontSize={22} mt={0.5}>{value}</Typography>
      {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
    </Paper>
  );
}

// ── Main ──
export function PurchasesTab() {
  const { range, label: periodLabel } = useDateFilter();
  const [bills, setBills] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [sellerQ, setSellerQ] = useState("");
  const [drawer, setDrawer] = useState({ open: false, initial: null });
  const [expanded, setExpanded] = useState(new Set());
  const [deletingId, setDeletingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      ...(range.date_from && { date_from: range.date_from }),
      ...(range.date_to && { date_to: range.date_to }),
      ...(sellerQ && { seller: sellerQ }),
    });
    try {
      const r = await fetch(`${API}/purchases/?${params}`);
      if (r.ok) { const d = await r.json(); setBills(d.results || []); setTotal(d.total || 0); }
    } finally { setLoading(false); }
  }, [JSON.stringify(range), sellerQ]);

  useEffect(() => { load(); }, [load]);

  const sellers = useMemo(() => [...new Set(bills.map((b) => b.seller_name).filter(Boolean))].sort(), [bills]);
  const totalSpend = bills.reduce((s, b) => s + parseFloat(b.total_amount || 0), 0);
  const totalQty = bills.reduce((s, b) => s + b.items.filter((i) => !i.is_exchange).reduce((q, i) => q + Number(i.quantity), 0), 0);
  const hasFilters = !!sellerQ;

  const toggle = (id) => setExpanded((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const onSaved = () => load();
  const doDelete = async () => {
    await fetch(`${API}/purchases/${deletingId}/`, { method: "DELETE" });
    setDeletingId(null); load();
  };
  // Duplicate: open a NEW bill pre-filled from an existing one (no id) for fast re-entry.
  const duplicate = (bill) => setDrawer({ open: true, initial: {
    date: todayStr(), seller_name: bill.seller_name, bill_number: "", notes: bill.notes,
    items: bill.items.map((i) => ({ ...i })),
  } });

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1180, mx: "auto" }}>
      <PurchaseFormDrawer open={drawer.open} initial={drawer.initial} sellers={sellers}
        onClose={() => setDrawer({ open: false, initial: null })} onSaved={onSaved} />
      <ConfirmDelete open={!!deletingId} onConfirm={doDelete} onCancel={() => setDeletingId(null)} />

      {/* Header */}
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, alignItems: "center", justifyContent: "space-between", mb: 3 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h5" fontWeight={800}>Purchases</Typography>
          <Typography variant="caption" color="text.secondary">Record stock buys fast · inventory auto-updates · PDF bills</Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDrawer({ open: true, initial: null })}
          sx={{ bgcolor: C.orange, "&:hover": { bgcolor: "#5B21B6" }, fontWeight: 700, borderRadius: 2, textTransform: "none", px: 2.5, py: 1, whiteSpace: "nowrap", flexShrink: 0 }}>
          New Purchase
        </Button>
      </Box>

      {/* KPIs */}
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 2, mb: 3 }}>
        <Kpi label="Total Spend" value={money(totalSpend).replace(/\.00$/, "")} sub={`${total} bill${total !== 1 ? "s" : ""}`} icon={<PaymentsIcon />} color={C.orange} />
        <Kpi label="Units Purchased" value={totalQty.toLocaleString("en-IN")} sub="excl. exchanges" icon={<InventoryIcon />} color={C.blue} />
        <Kpi label="Vendors" value={sellers.length} sub="unique sellers" icon={<StorefrontIcon />} color={C.green} />
        <Kpi label="Bills" value={total} sub={hasFilters ? `filtered · ${periodLabel}` : periodLabel} icon={<ReceiptLongIcon />} color={C.amber} />
      </Box>

      {/* Filter + list */}
      <Paper variant="outlined" sx={{ borderRadius: 3, borderColor: "#E2E8F0", overflow: "hidden" }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "center" }} sx={{ p: 2, borderBottom: "1px solid #F1F5F9", flexWrap: "wrap" }}>
          <TextField size="small" value={sellerQ} onChange={(e) => setSellerQ(e.target.value)} placeholder="Search seller…"
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" sx={{ color: "text.secondary" }} /></InputAdornment> }}
            sx={{ flex: 1, minWidth: 200 }} />
          {hasFilters && <Button size="small" onClick={() => setSellerQ("")} sx={{ textTransform: "none", color: C.red }}>Clear</Button>}
          <IconButton size="small" onClick={load}><RefreshIcon fontSize="small" /></IconButton>
        </Stack>

        {/* Column header */}
        <Box sx={{ display: { xs: "none", sm: "grid" }, gridTemplateColumns: "28px 1fr 130px 90px 120px 130px", gap: 1, px: 2, py: 1, bgcolor: "#F8FAFC", borderBottom: "1px solid #F1F5F9" }}>
          {["", "Seller / Bill", "Date", "Units", "Total", "Actions"].map((h, i) => (
            <Typography key={h + i} fontSize={10} fontWeight={700} color="text.secondary" textTransform="uppercase" letterSpacing={0.5}
              textAlign={h === "Total" ? "right" : h === "Units" ? "center" : h === "Actions" ? "right" : "left"}>{h}</Typography>
          ))}
        </Box>

        {loading && bills.length === 0 ? (
          <Box display="flex" justifyContent="center" py={8}><CircularProgress sx={{ color: C.orange }} /></Box>
        ) : bills.length === 0 ? (
          <Box textAlign="center" py={8}>
            <ReceiptLongIcon sx={{ fontSize: 48, color: "#CBD5E1", mb: 1 }} />
            <Typography color="text.secondary" fontWeight={600}>No purchases yet</Typography>
            <Button onClick={() => setDrawer({ open: true, initial: null })} sx={{ mt: 1, textTransform: "none", color: C.orange, fontWeight: 700 }}>+ Record your first purchase</Button>
          </Box>
        ) : (
          bills.map((bill) => (
            <BillRow key={bill.id} bill={bill} expanded={expanded.has(bill.id)} onToggle={() => toggle(bill.id)}
              onEdit={(b) => setDrawer({ open: true, initial: b })} onDelete={(id) => setDeletingId(id)} onDuplicate={duplicate} />
          ))
        )}
      </Paper>
    </Box>
  );
}
