import React, { useState, useEffect, useCallback } from "react";
import { BarChart } from "@mui/x-charts/BarChart";
import {
  Box, Button, Card, CardContent, Chip, Dialog, DialogActions,
  DialogContent, DialogTitle, FormControlLabel, Checkbox,
  Paper, Stack, Table, TableBody, TableCell, TableContainer,
  TableFooter, TableHead, TableRow, TextField, Typography,
  CircularProgress, Collapse, IconButton,
} from "@mui/material";
import { API, C, fmt } from "../../App";

// ── helpers ───────────────────────────────────────────────────────────────────
function StockBadge({ stock }) {
  if (stock <= 0)
    return <Chip label="Out of Stock" size="small" sx={{ background: C.redLight, color: C.red, border: `1px solid ${C.redBorder}`, fontWeight: 700, fontSize: 12 }} />;
  if (stock <= 3)
    return <Chip label={`Low (${stock})`} size="small" sx={{ background: C.amberLight, color: C.amber, border: "1px solid #FDE68A", fontWeight: 700, fontSize: 12 }} />;
  return <Chip label={`${stock} units`} size="small" sx={{ background: C.greenLight, color: C.green, border: `1px solid ${C.greenBorder}`, fontWeight: 700, fontSize: 12 }} />;
}

// ── Add Stock Modal ───────────────────────────────────────────────────────────
function AddStockModal({ skuId, onSave, onClose }) {
  const today = new Date().toISOString().slice(0, 10);
  const [date,   setDate]   = useState(today);
  const [seller, setSeller] = useState("");
  const [qty,    setQty]    = useState("1");
  const [price,  setPrice]  = useState("");
  const [desc,   setDesc]   = useState("");
  const [exch,   setExch]   = useState(false);
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState("");

  const save = async () => {
    if (!seller.trim())                         { setErr("Enter a seller name."); return; }
    if (!(parseInt(qty, 10) > 0))              { setErr("Quantity must be ≥ 1."); return; }
    if (!exch && !(parseFloat(price) > 0))     { setErr("Enter a valid price."); return; }
    setSaving(true); setErr("");
    const res = await fetch(`${API}/purchases/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date,
        seller_name: seller.trim(),
        bill_number: "",
        notes: "",
        items: [{
          parent_sku_id: skuId,
          product_description: desc,
          quantity: parseInt(qty, 10),
          price_per_unit: exch ? "0" : price,
          is_exchange: exch,
        }],
      }),
    });
    if (res.ok) onSave();
    else { setErr("Save failed. Please try again."); setSaving(false); }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800, fontSize: 15, color: C.gray800, pb: 1, borderBottom: `1px solid ${C.border}` }}>
        ＋ Add Stock
        <Typography variant="caption" display="block" sx={{ fontFamily: "monospace", color: C.gray400, mt: 0.5 }}>
          {skuId}
        </Typography>
      </DialogTitle>
      <DialogContent sx={{ pt: 2 }}>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5 }}>
            <TextField
              label="Date"
              type="date"
              size="small"
              value={date}
              onChange={e => setDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
            <TextField
              label="Seller Name"
              size="small"
              value={seller}
              onChange={e => setSeller(e.target.value)}
              placeholder="e.g. Anand Traders"
              fullWidth
            />
          </Box>
          <TextField
            label="Description (optional)"
            size="small"
            value={desc}
            onChange={e => setDesc(e.target.value)}
            placeholder="e.g. Cotton kurta set"
            fullWidth
          />
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5 }}>
            <TextField
              label="Quantity"
              type="number"
              size="small"
              inputProps={{ min: 1 }}
              value={qty}
              onChange={e => setQty(e.target.value)}
              fullWidth
            />
            <TextField
              label="Price / Unit (₹)"
              type="number"
              size="small"
              inputProps={{ min: 0, step: 0.01 }}
              value={price}
              onChange={e => setPrice(e.target.value)}
              disabled={exch}
              placeholder="0.00"
              fullWidth
            />
          </Box>
          <FormControlLabel
            control={
              <Checkbox
                checked={exch}
                onChange={e => setExch(e.target.checked)}
                sx={{ color: C.amber, "&.Mui-checked": { color: C.amber } }}
                size="small"
              />
            }
            label={
              <Typography variant="body2" sx={{ color: C.gray600 }}>
                Exchange item (not counted in cost or stock)
              </Typography>
            }
          />
          {err && <Typography variant="caption" sx={{ color: C.red }}>{err}</Typography>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} variant="outlined" size="small" sx={{ color: C.gray600, borderColor: C.gray200 }}>
          Cancel
        </Button>
        <Button
          onClick={save}
          disabled={saving}
          variant="contained"
          size="small"
          sx={{ background: C.orange, "&:hover": { background: C.orange }, opacity: saving ? 0.6 : 1 }}
        >
          {saving ? "Saving…" : "Add Stock"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Edit Item Modal ───────────────────────────────────────────────────────────
function EditItemModal({ item, onSave, onClose }) {
  const [qty,    setQty]    = useState(String(item.quantity));
  const [price,  setPrice]  = useState(String(item.price_per_unit));
  const [desc,   setDesc]   = useState(item.product_description || "");
  const [exch,   setExch]   = useState(item.is_exchange);
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState("");

  const save = async () => {
    if (!exch && !(parseFloat(price) > 0)) { setErr("Enter a valid price."); return; }
    if (!(parseInt(qty, 10) > 0))          { setErr("Quantity must be ≥ 1."); return; }
    setSaving(true); setErr("");
    const res = await fetch(`${API}/purchases/items/${item.id}/`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantity: parseInt(qty, 10), price_per_unit: price, product_description: desc, is_exchange: exch }),
    });
    if (res.ok) onSave(await res.json());
    else { setErr("Save failed."); setSaving(false); }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800, fontSize: 15, color: C.gray800, pb: 1, borderBottom: `1px solid ${C.border}` }}>
        Edit Purchase Item
        <Typography variant="caption" display="block" sx={{ color: C.gray400, mt: 0.5 }}>
          Bill {item.bill_number} · {item.bill_date} · {item.seller_name}
        </Typography>
      </DialogTitle>
      <DialogContent sx={{ pt: 2 }}>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Description"
            size="small"
            value={desc}
            onChange={e => setDesc(e.target.value)}
            fullWidth
          />
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5 }}>
            <TextField
              label="Quantity"
              type="number"
              size="small"
              inputProps={{ min: 1 }}
              value={qty}
              onChange={e => setQty(e.target.value)}
              fullWidth
            />
            <TextField
              label="Price / Unit (₹)"
              type="number"
              size="small"
              inputProps={{ min: 0, step: 0.01 }}
              value={price}
              onChange={e => setPrice(e.target.value)}
              disabled={exch}
              fullWidth
            />
          </Box>
          <FormControlLabel
            control={
              <Checkbox
                checked={exch}
                onChange={e => setExch(e.target.checked)}
                sx={{ color: C.amber, "&.Mui-checked": { color: C.amber } }}
                size="small"
              />
            }
            label={
              <Typography variant="body2" sx={{ color: C.gray600 }}>
                Exchange item (excluded from cost &amp; stock)
              </Typography>
            }
          />
          {err && <Typography variant="caption" sx={{ color: C.red }}>{err}</Typography>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} variant="outlined" size="small" sx={{ color: C.gray600, borderColor: C.gray200 }}>
          Cancel
        </Button>
        <Button
          onClick={save}
          disabled={saving}
          variant="contained"
          size="small"
          sx={{ background: C.orange, "&:hover": { background: C.orange }, opacity: saving ? 0.6 : 1 }}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── SKU Detail Drawer ─────────────────────────────────────────────────────────
function SKUDetailDrawer({ skuId, onClose, onRefreshInventory }) {
  const [items,    setItems]    = useState([]);
  const [monthly,  setMonthly]  = useState([]);
  const [editItem, setEditItem] = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [tab,      setTab]      = useState("history"); // "history" | "monthly"

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);

  const load = useCallback(async () => {
    setLoading(true);
    const [itemsRes, monthlyRes] = await Promise.all([
      fetch(`${API}/purchases/sku-items/?parent_sku=${encodeURIComponent(skuId)}`),
      fetch(`${API}/purchases/sku-monthly/?parent_sku=${encodeURIComponent(skuId)}`),
    ]);
    if (itemsRes.ok)   setItems((await itemsRes.json()).results   || []);
    if (monthlyRes.ok) setMonthly((await monthlyRes.json()).results || []);
    setLoading(false);
  }, [skuId]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (itemId) => {
    if (!window.confirm("Delete this purchase item? Stock will be reduced.")) return;
    const res = await fetch(`${API}/purchases/items/${itemId}/`, { method: "DELETE" });
    if (res.ok) { load(); onRefreshInventory(); }
  };

  const handleSaved = () => { setEditItem(null); load(); onRefreshInventory(); };

  const totalPurchased   = items.filter(i => !i.is_exchange).reduce((s, i) => s + i.quantity, 0);
  const totalSpend       = items.filter(i => !i.is_exchange).reduce((s, i) => s + parseFloat(i.total_amount), 0);
  const exchangeCount    = items.filter(i => i.is_exchange).length;

  return (
    <>
      {editItem && (
        <EditItemModal item={editItem} onSave={handleSaved} onClose={() => setEditItem(null)} />
      )}
      {/* Backdrop */}
      <Box
        onClick={onClose}
        sx={{
          position: "fixed", inset: 0, zIndex: 1000,
          background: "rgba(15,23,42,0.45)",
          display: "flex", justifyContent: "flex-end",
        }}
      >
        {/* Drawer panel */}
        <Box
          onClick={e => e.stopPropagation()}
          sx={{
            width: "min(720px, 96vw)", height: "100vh",
            background: C.white, overflowY: "auto",
            boxShadow: "-12px 0 48px rgba(0,0,0,0.18)",
            display: "flex", flexDirection: "column",
          }}
        >
          {/* Drawer header */}
          <Box
            sx={{
              px: 3, pt: 2.5, pb: 2,
              borderBottom: `1px solid ${C.border}`,
              background: C.gray50,
              position: "sticky", top: 0, zIndex: 10,
            }}
          >
            <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 1.5 }}>
              <Box>
                <Typography sx={{ fontFamily: "monospace", fontSize: 18, fontWeight: 800, color: C.orange }}>
                  {skuId}
                </Typography>
                <Typography variant="caption" sx={{ color: C.gray400, mt: 0.5, display: "block" }}>
                  {totalPurchased} units purchased · ₹{totalSpend.toLocaleString("en-IN", { minimumFractionDigits: 2 })} total spend
                  {exchangeCount > 0 && ` · ${exchangeCount} exchange${exchangeCount > 1 ? "s" : ""}`}
                </Typography>
              </Box>
              <Button
                onClick={onClose}
                variant="outlined"
                size="small"
                sx={{ minWidth: 36, px: 1, color: C.gray600, borderColor: C.gray200, lineHeight: 1 }}
              >
                ✕
              </Button>
            </Box>
            {/* Tab bar */}
            <Box sx={{ display: "flex", gap: 0.5, mt: 1.5, background: C.gray100, borderRadius: 2, p: 0.375, width: "fit-content" }}>
              {[["history", "📋 Purchase History"], ["monthly", "📊 Monthly Analysis"]].map(([id, label]) => (
                <Button
                  key={id}
                  onClick={() => setTab(id)}
                  size="small"
                  sx={{
                    px: 1.75, py: 0.75, borderRadius: 1.5, border: "none",
                    fontWeight: tab === id ? 700 : 500, fontSize: 12,
                    background: tab === id ? C.orangeLight : "transparent",
                    color: tab === id ? C.orange : C.gray500,
                    textTransform: "none",
                    "&:hover": { background: tab === id ? C.orangeLight : C.gray200 },
                  }}
                >
                  {label}
                </Button>
              ))}
            </Box>
          </Box>

          {/* Drawer body */}
          <Box sx={{ flex: 1, p: 3 }}>
            {loading ? (
              <Box sx={{ textAlign: "center", py: 6, color: C.gray400 }}>
                <CircularProgress size={24} sx={{ color: C.orange }} />
                <Typography variant="body2" sx={{ mt: 1, color: C.gray400 }}>Loading…</Typography>
              </Box>
            ) : (
              <>
                {/* ── History tab ── */}
                {tab === "history" && (
                  items.length === 0 ? (
                    <Typography sx={{ color: C.gray400, textAlign: "center", py: 5 }}>
                      No purchase items found for this SKU.
                    </Typography>
                  ) : (
                    <TableContainer component={Paper} elevation={0} sx={{ border: `1px solid ${C.border}`, borderRadius: 2 }}>
                      <Table size="small">
                        <TableHead>
                          <TableRow sx={{ background: C.gray50 }}>
                            {["Date", "Bill", "Seller", "Desc", "Qty", "Price/Unit", "Total", "Exch?", ""].map((h, i) => (
                              <TableCell
                                key={h + i}
                                align={["Qty", "Price/Unit", "Total"].includes(h) ? "right" : "left"}
                                sx={{ fontSize: 11, fontWeight: 700, color: C.gray500, textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap", borderBottom: `1px solid ${C.border}`, background: C.gray50 }}
                              >
                                {h}
                              </TableCell>
                            ))}
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {items.map((it, i) => {
                            const rowBg = it.is_exchange ? "#FFFBEB" : i % 2 === 0 ? C.white : C.gray50;
                            return (
                              <TableRow key={it.id} sx={{ background: rowBg }}>
                                <TableCell sx={{ whiteSpace: "nowrap", color: C.gray600, fontSize: 13 }}>{it.bill_date}</TableCell>
                                <TableCell sx={{ fontFamily: "monospace", fontSize: 11, color: C.blue }}>{it.bill_number}</TableCell>
                                <TableCell sx={{ maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13 }}>{it.seller_name}</TableCell>
                                <TableCell sx={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: C.gray500, fontSize: 12 }}>{it.product_description || "—"}</TableCell>
                                <TableCell align="right" sx={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13 }}>{it.quantity}</TableCell>
                                <TableCell align="right" sx={{ fontFamily: "monospace", fontSize: 13 }}>{fmt(it.price_per_unit)}</TableCell>
                                <TableCell align="right" sx={{ fontFamily: "monospace", fontWeight: 700, color: it.is_exchange ? C.gray300 : C.orange, fontSize: 13 }}>
                                  {it.is_exchange ? "—" : fmt(it.total_amount)}
                                </TableCell>
                                <TableCell align="center">
                                  {it.is_exchange
                                    ? <Chip label="Exch" size="small" sx={{ fontSize: 10, background: "#FFFBEB", color: C.amber, border: "1px solid #FDE68A", fontWeight: 700, height: 20 }} />
                                    : <Typography sx={{ color: C.gray200 }}>—</Typography>}
                                </TableCell>
                                <TableCell>
                                  <Box sx={{ display: "flex", gap: 0.625 }}>
                                    <Button
                                      onClick={() => setEditItem(it)}
                                      size="small"
                                      sx={{ minWidth: 0, px: 1, py: 0.375, fontSize: 11, background: C.orangeLight, color: C.orange, border: `1.5px solid ${C.orangeBorder}`, textTransform: "none" }}
                                    >✏</Button>
                                    <Button
                                      onClick={() => handleDelete(it.id)}
                                      size="small"
                                      sx={{ minWidth: 0, px: 1, py: 0.375, fontSize: 11, color: C.red, border: `1.5px solid ${C.gray200}`, textTransform: "none" }}
                                    >✕</Button>
                                  </Box>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                        <TableFooter>
                          <TableRow sx={{ background: "#FFF0EA" }}>
                            <TableCell colSpan={4} sx={{ fontWeight: 700, fontSize: 13, color: C.gray700 }}>Total (excl. exchanges)</TableCell>
                            <TableCell align="right" sx={{ fontFamily: "monospace", fontWeight: 800, fontSize: 13, color: C.gray700 }}>{totalPurchased}</TableCell>
                            <TableCell />
                            <TableCell align="right" sx={{ fontFamily: "monospace", fontWeight: 800, color: C.orange, fontSize: 13 }}>
                              ₹{totalSpend.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell colSpan={2} />
                          </TableRow>
                        </TableFooter>
                      </Table>
                    </TableContainer>
                  )
                )}

                {/* ── Monthly analysis tab ── */}
                {tab === "monthly" && (
                  monthly.length === 0 ? (
                    <Typography sx={{ color: C.gray400, textAlign: "center", py: 5 }}>
                      No purchase data for monthly analysis.
                    </Typography>
                  ) : (
                    <Stack spacing={2.5}>
                      {/* Bar chart — qty */}
                      <Box>
                        <Typography sx={{ fontSize: 12, fontWeight: 700, color: C.gray500, textTransform: "uppercase", letterSpacing: "0.05em", mb: 1.25 }}>
                          Units Purchased per Month
                        </Typography>
                        <BarChart
                          dataset={monthly}
                          xAxis={[{ scaleType: "band", dataKey: "label" }]}
                          series={[{ dataKey: "total_qty", label: "Units", color: C.orange }]}
                          height={220}
                          borderRadius={4}
                          margin={{ left: 60, bottom: 60, right: 10, top: 10 }}
                        />
                      </Box>

                      {/* Bar chart — spend */}
                      <Box>
                        <Typography sx={{ fontSize: 12, fontWeight: 700, color: C.gray500, textTransform: "uppercase", letterSpacing: "0.05em", mb: 1.25 }}>
                          Spend per Month (₹)
                        </Typography>
                        <BarChart
                          dataset={monthly.map(m => ({ ...m, value: parseFloat(m.total_value) }))}
                          xAxis={[{ scaleType: "band", dataKey: "label" }]}
                          series={[{ dataKey: "value", label: "Spend (₹)", color: C.green }]}
                          height={220}
                          borderRadius={4}
                          margin={{ left: 60, bottom: 60, right: 10, top: 10 }}
                        />
                      </Box>

                      {/* Monthly table */}
                      <TableContainer component={Paper} elevation={0} sx={{ border: `1px solid ${C.border}`, borderRadius: 2 }}>
                        <Table size="small">
                          <TableHead>
                            <TableRow sx={{ background: C.gray50 }}>
                              {["Month", "Bills", "Units", "Total Spend"].map(h => (
                                <TableCell
                                  key={h}
                                  align={h !== "Month" ? "right" : "left"}
                                  sx={{ fontSize: 11, fontWeight: 700, color: C.gray500, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: `1px solid ${C.border}`, background: C.gray50 }}
                                >
                                  {h}
                                </TableCell>
                              ))}
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {monthly.map((m, i) => (
                              <TableRow key={m.month} sx={{ background: i % 2 === 0 ? C.white : C.gray50 }}>
                                <TableCell sx={{ fontWeight: 600, fontSize: 13, color: C.gray700 }}>{m.label}</TableCell>
                                <TableCell align="right" sx={{ fontFamily: "monospace", fontSize: 13 }}>{m.bill_count}</TableCell>
                                <TableCell align="right" sx={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13 }}>{m.total_qty}</TableCell>
                                <TableCell align="right" sx={{ fontFamily: "monospace", color: C.orange, fontWeight: 700, fontSize: 13 }}>{fmt(m.total_value)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                          <TableFooter>
                            <TableRow sx={{ background: "#FFF0EA" }}>
                              <TableCell sx={{ fontWeight: 700, fontSize: 13, color: C.gray700 }}>All-time total</TableCell>
                              <TableCell align="right" sx={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13, color: C.gray700 }}>{monthly.reduce((s, m) => s + m.bill_count, 0)}</TableCell>
                              <TableCell align="right" sx={{ fontFamily: "monospace", fontWeight: 800, fontSize: 13, color: C.gray700 }}>{monthly.reduce((s, m) => s + m.total_qty, 0)}</TableCell>
                              <TableCell align="right" sx={{ fontFamily: "monospace", fontWeight: 800, color: C.orange, fontSize: 13 }}>
                                {fmt(monthly.reduce((s, m) => s + parseFloat(m.total_value), 0))}
                              </TableCell>
                            </TableRow>
                          </TableFooter>
                        </Table>
                      </TableContainer>
                    </Stack>
                  )
                )}
              </>
            )}
          </Box>
        </Box>
      </Box>
    </>
  );
}

// ── Packing Panel ─────────────────────────────────────────────────────────────
const COURIER_BG = {
  Valmo:         { bg: "#EFF6FF", fg: "#2563EB", border: "#BFDBFE" },
  Shadowfax:     { bg: "#F0FDF4", fg: "#16A34A", border: "#BBF7D0" },
  Delhivery:     { bg: "#FFF7ED", fg: "#EA580C", border: "#FED7AA" },
  "Xpress Bees": { bg: "#FAF5FF", fg: "#9333EA", border: "#E9D5FF" },
  BlueDart:      { bg: "#FFF0EA", fg: "#E8510A", border: "#F5C4AD" },
  Ekart:         { bg: "#FFFBEB", fg: "#D97706", border: "#FDE68A" },
};
function courierStyle(name) {
  return COURIER_BG[name] || { bg: C.gray100, fg: C.gray600, border: C.gray200 };
}

function PackingPanel() {
  const todayStr = () => new Date().toISOString().slice(0, 10);
  const [date,        setDate]        = useState(todayStr());
  const [orders,      setOrders]      = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [filter,      setFilter]      = useState("all");    // "all" | "packed" | "unpacked"
  const [search,      setSearch]      = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [collapsed,   setCollapsed]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/labels/orders/?date=${date}&page_size=1000`);
      if (r.ok) setOrders((await r.json()).results || []);
    } finally { setLoading(false); }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const shiftDate = (days) => {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    setDate(d.toISOString().slice(0, 10));
  };

  const togglePacked = async (order_id, current) => {
    const res = await fetch(`${API}/labels/orders/${encodeURIComponent(order_id)}/pack/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packed: !current }),
    });
    if (res.ok) {
      const update = (list) => list.map(o => o.order_id === order_id ? { ...o, is_packed: !current } : o);
      setOrders(update);
      setSuggestions(update);
    }
  };

  const markAllPacked = async () => {
    if (!window.confirm(`Mark all ${orders.length} orders as packed?`)) return;
    const res = await fetch(`${API}/labels/bulk-pack/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_ids: orders.map(o => o.order_id), packed: true }),
    });
    if (res.ok) {
      setOrders(prev => prev.map(o => ({ ...o, is_packed: true })));
      setSuggestions([]);
    }
  };

  const handleSearch = (val) => {
    setSearch(val);
    const v = val.trim();
    if (v.length >= 2) {
      setSuggestions(
        orders.filter(o => {
          const id = String(o.order_id);
          return id.slice(-4).includes(v) || id.endsWith(v);
        }).slice(0, 8)
      );
    } else {
      setSuggestions([]);
    }
  };

  const packedCount   = orders.filter(o => o.is_packed).length;
  const unpackedCount = orders.length - packedCount;
  const allPacked     = orders.length > 0 && unpackedCount === 0;
  const totalUnits    = orders.reduce((s, o) => s + (o.qty || 1), 0);

  const displayed = orders.filter(o => {
    if (filter === "packed")   return o.is_packed;
    if (filter === "unpacked") return !o.is_packed;
    return true;
  });

  const byCourier = displayed.reduce((acc, o) => {
    const c = o.courier_name || "Unknown";
    if (!acc[c]) acc[c] = [];
    acc[c].push(o);
    return acc;
  }, {});

  return (
    <Paper elevation={1} sx={{ borderRadius: 3, overflow: "hidden", border: `1px solid ${C.border}` }}>
      {/* Header row */}
      <Box
        onClick={() => setCollapsed(c => !c)}
        sx={{
          px: 2.5, py: 1.75,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: C.gray50,
          borderBottom: collapsed ? "none" : `1px solid ${C.border}`,
          cursor: "pointer",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
          <Typography sx={{ fontSize: 15, fontWeight: 800, color: C.gray800 }}>📦 Packing Status</Typography>
          {!collapsed && orders.length > 0 && (
            allPacked
              ? <Chip label="✓ All Packed" size="small" sx={{ fontSize: 11, background: C.greenLight, color: C.green, border: `1px solid ${C.greenBorder}`, fontWeight: 700 }} />
              : <Chip label={`${unpackedCount} Not Packed`} size="small" sx={{ fontSize: 11, background: C.redLight, color: C.red, border: `1px solid ${C.redBorder}`, fontWeight: 700 }} />
          )}
        </Box>
        <Typography sx={{ color: C.gray400, fontSize: 13 }}>{collapsed ? "▼" : "▲"}</Typography>
      </Box>

      <Collapse in={!collapsed}>
        <Box sx={{ px: 2.5, py: 2, display: "flex", flexDirection: "column", gap: 1.75 }}>

          {/* Date nav */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
            <Button
              onClick={() => shiftDate(-1)}
              variant="outlined"
              size="small"
              sx={{ color: C.gray600, borderColor: C.gray200, textTransform: "none", px: 1.5 }}
            >‹ Prev</Button>
            <TextField
              type="date"
              size="small"
              value={date}
              onChange={e => setDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              sx={{ width: 160 }}
            />
            <Button
              onClick={() => shiftDate(1)}
              variant="outlined"
              size="small"
              sx={{ color: C.gray600, borderColor: C.gray200, textTransform: "none", px: 1.5 }}
            >Next ›</Button>
            <Button
              onClick={() => setDate(todayStr())}
              variant="outlined"
              size="small"
              sx={{ color: C.orange, borderColor: C.orangeBorder, textTransform: "none", px: 1.5 }}
            >Today</Button>
            <Button
              onClick={load}
              variant="outlined"
              size="small"
              sx={{ color: C.gray600, borderColor: C.gray200, textTransform: "none", px: 1.5 }}
            >⟳</Button>
          </Box>

          {loading ? (
            <Box sx={{ textAlign: "center", py: 3, color: C.gray400 }}>
              <CircularProgress size={20} sx={{ color: C.orange }} />
              <Typography variant="body2" sx={{ mt: 1, color: C.gray400 }}>Loading orders…</Typography>
            </Box>
          ) : orders.length === 0 ? (
            <Typography sx={{ textAlign: "center", py: 3, color: C.gray400 }}>No labels uploaded for {date}.</Typography>
          ) : (
            <>
              {/* KPIs */}
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.25 }}>
                {[
                  { label: "Total Orders", value: orders.length, color: C.blue },
                  { label: "Total Units",  value: totalUnits,    color: C.gray700 },
                  { label: "Packed",       value: packedCount,   color: C.green },
                  { label: "Not Packed",   value: unpackedCount, color: unpackedCount > 0 ? C.red : C.gray300 },
                ].map(k => (
                  <Paper key={k.label} elevation={0} sx={{ background: C.gray50, border: `1px solid ${C.border}`, borderRadius: 2.5, px: 2, py: 1, minWidth: 90 }}>
                    <Typography sx={{ fontSize: 10, fontWeight: 700, color: C.gray400, textTransform: "uppercase", letterSpacing: "0.06em" }}>{k.label}</Typography>
                    <Typography sx={{ fontSize: 18, fontWeight: 800, color: k.color, fontFamily: "monospace" }}>{k.value}</Typography>
                  </Paper>
                ))}
                {!allPacked && (
                  <Button
                    onClick={markAllPacked}
                    variant="contained"
                    size="small"
                    sx={{ alignSelf: "center", ml: 0.75, background: C.green, "&:hover": { background: C.green }, textTransform: "none" }}
                  >
                    ✓ Mark All Packed
                  </Button>
                )}
                {allPacked && (
                  <Typography sx={{ alignSelf: "center", ml: 0.75, fontSize: 13, fontWeight: 700, color: C.green }}>
                    🎉 All {orders.length} orders packed!
                  </Typography>
                )}
              </Box>

              {/* Search autocomplete */}
              <Box sx={{ position: "relative", maxWidth: 320 }}>
                <Typography variant="caption" sx={{ display: "block", fontWeight: 600, color: C.gray600, mb: 0.5 }}>
                  Quick find by last 4 digits of suborder #
                </Typography>
                <TextField
                  size="small"
                  value={search}
                  onChange={e => handleSearch(e.target.value)}
                  placeholder="e.g. 0480"
                  fullWidth
                />
                {suggestions.length > 0 && (
                  <Paper
                    elevation={3}
                    sx={{
                      position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50,
                      border: `1px solid ${C.border}`, borderRadius: 2, mt: 0.25, overflow: "hidden",
                    }}
                  >
                    {suggestions.map(o => (
                      <Box
                        key={o.order_id}
                        sx={{
                          px: 1.5, py: 1,
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          borderBottom: `1px solid ${C.gray100}`, cursor: "pointer",
                          background: o.is_packed ? "#F0FDF4" : C.white,
                          "&:hover": { background: C.gray50 },
                        }}
                      >
                        <Box>
                          <Typography component="span" sx={{ fontFamily: "monospace", fontSize: 11, color: C.gray500 }}>
                            …{o.order_id.slice(-14)}
                          </Typography>
                          <Typography component="span" sx={{ ml: 1, fontSize: 12, color: C.gray600 }}>
                            {o.customer_name}
                          </Typography>
                        </Box>
                        <Button
                          onClick={(e) => { e.stopPropagation(); togglePacked(o.order_id, o.is_packed); setSearch(""); setSuggestions([]); }}
                          size="small"
                          sx={{
                            px: 1.25, borderRadius: 10, fontSize: 11, fontWeight: 600,
                            background: o.is_packed ? C.greenLight : "#FEE2E2",
                            color:      o.is_packed ? C.green      : C.red,
                            textTransform: "none",
                            "&:hover": { background: o.is_packed ? C.greenLight : "#FEE2E2" },
                          }}
                        >
                          {o.is_packed ? "✓ Packed" : "Not Packed"}
                        </Button>
                      </Box>
                    ))}
                  </Paper>
                )}
              </Box>

              {/* Filter tabs */}
              <Box sx={{ display: "flex", gap: 0.5, background: C.gray100, borderRadius: 2, p: 0.375, width: "fit-content" }}>
                {[["all", "All"], ["packed", "✓ Packed"], ["unpacked", "Not Packed"]].map(([id, label]) => (
                  <Button
                    key={id}
                    onClick={() => setFilter(id)}
                    size="small"
                    sx={{
                      px: 1.75, py: 0.625, borderRadius: 1.5, border: "none",
                      fontWeight: filter === id ? 700 : 500, fontSize: 12,
                      background: filter === id ? C.white : "transparent",
                      color:      filter === id ? C.orange : C.gray500,
                      boxShadow:  filter === id ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
                      textTransform: "none",
                      "&:hover": { background: filter === id ? C.white : C.gray200 },
                    }}
                  >
                    {label} {id === "all" ? `(${orders.length})` : id === "packed" ? `(${packedCount})` : `(${unpackedCount})`}
                  </Button>
                ))}
              </Box>

              {/* Orders grouped by courier */}
              {displayed.length === 0 ? (
                <Typography sx={{ color: C.gray400, fontSize: 13, textAlign: "center", py: 2 }}>
                  {filter === "packed" ? "No packed orders yet." : filter === "unpacked" ? "No unpacked orders — all done! 🎉" : "No orders."}
                </Typography>
              ) : (
                <Stack spacing={1.25}>
                  {Object.entries(byCourier).sort().map(([courier, rows]) => {
                    const cs = courierStyle(courier);
                    const cp = rows.filter(o => o.is_packed).length;
                    return (
                      <Box key={courier} sx={{ border: `1px solid ${cs.border}`, borderRadius: 2.5, overflow: "hidden" }}>
                        {/* Courier header */}
                        <Box sx={{ background: cs.bg, px: 1.75, py: 1, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <Typography sx={{ fontWeight: 700, fontSize: 13, color: cs.fg }}>{courier}</Typography>
                          <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                            <Typography sx={{ fontSize: 11, color: cs.fg, fontWeight: 600 }}>{rows.length} orders</Typography>
                            <Chip label={`${cp} packed`} size="small" sx={{ fontSize: 11, background: C.greenLight, color: C.green, border: `1px solid ${C.greenBorder}`, fontWeight: 700, height: 20 }} />
                            {cp < rows.length && <Chip label={`${rows.length - cp} left`} size="small" sx={{ fontSize: 11, background: C.redLight, color: C.red, border: `1px solid ${C.redBorder}`, fontWeight: 700, height: 20 }} />}
                          </Box>
                        </Box>
                        {/* Order rows */}
                        <Table size="small">
                          <TableBody>
                            {rows.map((o, i) => (
                              <TableRow
                                key={o.order_id}
                                sx={{
                                  background: o.is_packed ? "#F0FDF4" : i % 2 === 0 ? C.white : C.gray50,
                                  borderTop: `1px solid ${C.gray100}`,
                                }}
                              >
                                <TableCell sx={{ fontFamily: "monospace", fontSize: 11, color: C.gray400, width: 160 }}>
                                  …{o.order_id.slice(-14)}
                                </TableCell>
                                <TableCell sx={{ fontWeight: 600, color: C.gray700, fontSize: 12 }}>{o.customer_name || "—"}</TableCell>
                                <TableCell sx={{ color: C.gray500, fontSize: 12 }}>{o.customer_city || "—"}</TableCell>
                                <TableCell align="center">
                                  {o.payment_type === "COD"
                                    ? <Chip label="COD" size="small" sx={{ fontSize: 10, background: "#FFFBEB", color: C.amber, border: "1px solid #FDE68A", fontWeight: 700, height: 20 }} />
                                    : <Chip label="PP"  size="small" sx={{ fontSize: 10, background: C.greenLight, color: C.green, border: `1px solid ${C.greenBorder}`, fontWeight: 700, height: 20 }} />}
                                </TableCell>
                                <TableCell align="right">
                                  <Button
                                    onClick={() => togglePacked(o.order_id, o.is_packed)}
                                    size="small"
                                    sx={{
                                      px: 1.25, borderRadius: 10, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap",
                                      background: o.is_packed ? C.greenLight : C.white,
                                      color:      o.is_packed ? C.green      : C.gray400,
                                      border:     `1px solid ${o.is_packed ? C.greenBorder : C.gray300}`,
                                      textTransform: "none",
                                      "&:hover": { background: o.is_packed ? C.greenLight : C.gray50 },
                                    }}
                                  >
                                    {o.is_packed ? "✓ Packed" : "Not Packed"}
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </Box>
                    );
                  })}
                </Stack>
              )}
            </>
          )}
        </Box>
      </Collapse>
    </Paper>
  );
}

// ── Main Tab ──────────────────────────────────────────────────────────────────
export function InventoryTab() {
  const [data,       setData]       = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [search,     setSearch]     = useState("");
  const [sortKey,    setSortKey]    = useState("current_stock");
  const [sortAsc,    setSortAsc]    = useState(true);
  const [detailSku,  setDetailSku]  = useState(null);
  const [addSku,     setAddSku]     = useState(null);   // SKU id for add-stock modal

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/inventory/`);
      if (r.ok) setData((await r.json()).results || []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDeleteSku = async (e, skuId) => {
    e.stopPropagation();
    if (!window.confirm(`Delete ALL purchase history for "${skuId}"?\n\nThis removes every purchase entry and cannot be undone.`)) return;
    const res = await fetch(`${API}/inventory/${encodeURIComponent(skuId)}/`, { method: "DELETE" });
    if (res.ok) load();
  };

  const toggle = (key) => {
    if (sortKey === key) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(true); }
  };

  const filtered = data
    .filter(r => !search || r.sku_id.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const va = typeof a[sortKey] === "string" ? a[sortKey].toLowerCase() : (a[sortKey] || 0);
      const vb = typeof b[sortKey] === "string" ? b[sortKey].toLowerCase() : (b[sortKey] || 0);
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ? 1 : -1;
      return 0;
    });

  const totalStock  = data.reduce((s, r) => s + r.current_stock, 0);
  const outOfStock  = data.filter(r => r.current_stock <= 0).length;
  const lowStock    = data.filter(r => r.current_stock > 0 && r.current_stock <= 3).length;
  const totalValue  = data.reduce((s, r) => s + parseFloat(r.purchase_value || 0), 0);

  const sortInd = (k) => sortKey === k ? (sortAsc ? " ↑" : " ↓") : "";

  const thSx = (k) => ({
    fontSize: 11, fontWeight: 700,
    textTransform: "uppercase", letterSpacing: "0.06em",
    whiteSpace: "nowrap", cursor: "pointer", userSelect: "none",
    borderBottom: `1px solid ${C.border}`,
    background: C.gray50,
    color: sortKey === k ? C.orange : C.gray500,
  });

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>

      {addSku && (
        <AddStockModal skuId={addSku} onClose={() => setAddSku(null)} onSave={() => { setAddSku(null); load(); }} />
      )}

      {/* Packing Panel — above SKU table */}
      <PackingPanel />

      {detailSku && (
        <SKUDetailDrawer
          skuId={detailSku}
          onClose={() => setDetailSku(null)}
          onRefreshInventory={load}
        />
      )}

      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1.5 }}>
        <Box>
          <Typography sx={{ fontSize: 20, fontWeight: 800, color: C.gray800, mb: 0.375 }}>📦 Inventory</Typography>
          <Typography sx={{ fontSize: 13, color: C.gray400 }}>
            Live stock = purchased − sold (delivered) + returned (RTO). Click any row to edit purchases or analyse monthly trend.
          </Typography>
        </Box>
        <Button
          onClick={load}
          variant="outlined"
          size="small"
          sx={{ color: C.gray600, borderColor: C.border, textTransform: "none", fontSize: 12 }}
        >
          ⟳ Refresh
        </Button>
      </Box>

      {/* KPI strip */}
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.75 }}>
        {[
          { label: "Total Stock",   value: totalStock,  accent: C.green,   icon: "📦" },
          { label: "SKUs Tracked",  value: data.length, accent: C.blue,    icon: "🏷" },
          { label: "Out of Stock",  value: outOfStock,  accent: C.red,     icon: "⛔" },
          { label: "Low Stock ≤3",  value: lowStock,    accent: C.amber,   icon: "⚠️" },
        ].map(k => (
          <Card key={k.label} elevation={1} sx={{ borderTop: `3px solid ${k.accent}`, borderRadius: 3, minWidth: "max-content" }}>
            <CardContent sx={{ py: 1.5, px: 2, "&:last-child": { pb: 1.5 } }}>
              <Typography sx={{ fontSize: 11, fontWeight: 700, color: C.gray400, letterSpacing: "0.07em", textTransform: "uppercase", mb: 1, whiteSpace: "nowrap" }}>
                {k.icon} {k.label}
              </Typography>
              <Typography sx={{ fontSize: 22, fontWeight: 800, fontFamily: "'DM Mono', monospace", color: k.accent, whiteSpace: "nowrap" }}>
                {k.value.toLocaleString("en-IN")}
              </Typography>
            </CardContent>
          </Card>
        ))}
        <Card elevation={1} sx={{ borderTop: `3px solid ${C.orange}`, borderRadius: 3, minWidth: "max-content" }}>
          <CardContent sx={{ py: 1.5, px: 2, "&:last-child": { pb: 1.5 } }}>
            <Typography sx={{ fontSize: 11, fontWeight: 700, color: C.gray400, letterSpacing: "0.07em", textTransform: "uppercase", mb: 1, whiteSpace: "nowrap" }}>
              💰 Total Purchase Value
            </Typography>
            <Typography sx={{ fontSize: 22, fontWeight: 800, fontFamily: "'DM Mono', monospace", color: C.orange, whiteSpace: "nowrap" }}>
              {`₹${totalValue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`}
            </Typography>
          </CardContent>
        </Card>
      </Box>

      {/* Table */}
      <Paper elevation={1} sx={{ borderRadius: 3, border: `1px solid ${C.border}`, p: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.75, flexWrap: "wrap", gap: 1.25 }}>
          <Box>
            <Typography component="span" sx={{ fontSize: 11, fontWeight: 700, color: C.gray400, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Stock by Parent SKU
            </Typography>
            <Typography component="span" sx={{ fontSize: 11, color: C.gray400, ml: 1 }}>
              — click a row to view/edit purchases or see monthly analysis
            </Typography>
          </Box>
          <TextField
            size="small"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="🔍 Search SKU…"
            sx={{ width: 200 }}
          />
        </Box>

        {loading ? (
          <Box sx={{ textAlign: "center", py: 7.5, color: C.gray400 }}>
            <Typography sx={{ fontSize: 28, mb: 1.25 }}>⏳</Typography>
            <Typography sx={{ color: C.gray400 }}>Loading inventory…</Typography>
          </Box>
        ) : (
          <TableContainer sx={{ overflowX: "auto" }}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell onClick={() => toggle("sku_id")}         sx={thSx("sku_id")}>Parent SKU{sortInd("sku_id")}</TableCell>
                  <TableCell onClick={() => toggle("purchased_qty")}  sx={{ ...thSx("purchased_qty"),  textAlign: "right" }}>Purchased{sortInd("purchased_qty")}</TableCell>
                  <TableCell onClick={() => toggle("sold_qty")}       sx={{ ...thSx("sold_qty"),       textAlign: "right" }}>Sold{sortInd("sold_qty")}</TableCell>
                  <TableCell onClick={() => toggle("rto_qty")}        sx={{ ...thSx("rto_qty"),        textAlign: "right" }}>RTO{sortInd("rto_qty")}</TableCell>
                  <TableCell onClick={() => toggle("current_stock")}  sx={{ ...thSx("current_stock"),  textAlign: "right" }}>Current Stock{sortInd("current_stock")}</TableCell>
                  <TableCell onClick={() => toggle("purchase_value")} sx={{ ...thSx("purchase_value"), textAlign: "right" }}>Purchase Value{sortInd("purchase_value")}</TableCell>
                  <TableCell onClick={() => toggle("last_purchase")}  sx={thSx("last_purchase")}>Last Purchase{sortInd("last_purchase")}</TableCell>
                  <TableCell sx={thSx("_status")}>Status</TableCell>
                  <TableCell sx={thSx("_actions")}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filtered.map((r, i) => {
                  const rowBg = i % 2 === 0 ? C.white : C.gray50;
                  const stockColor = r.current_stock <= 0 ? C.red : r.current_stock <= 3 ? C.amber : C.green;
                  return (
                    <TableRow
                      key={r.sku_id}
                      sx={{ background: rowBg, cursor: "pointer", "&:hover": { background: "#F0FFF4" } }}
                      onClick={() => setDetailSku(r.sku_id)}
                    >
                      <TableCell sx={{ fontFamily: "monospace", fontWeight: 700, color: C.orange, fontSize: 13 }}>{r.sku_id}</TableCell>
                      <TableCell align="right" sx={{ fontFamily: "monospace", fontSize: 13 }}>{r.purchased_qty}</TableCell>
                      <TableCell align="right" sx={{ fontFamily: "monospace", fontSize: 13, color: C.red }}>{r.sold_qty}</TableCell>
                      <TableCell align="right" sx={{ fontFamily: "monospace", fontSize: 13, color: C.green }}>{r.rto_qty}</TableCell>
                      <TableCell align="right" sx={{ fontFamily: "monospace", fontWeight: 800, fontSize: 15, color: stockColor }}>{r.current_stock}</TableCell>
                      <TableCell align="right" sx={{ fontFamily: "monospace", fontSize: 13 }}>{fmt(r.purchase_value)}</TableCell>
                      <TableCell sx={{ color: C.gray500, whiteSpace: "nowrap", fontSize: 13 }}>{r.last_purchase || "—"}</TableCell>
                      <TableCell><StockBadge stock={r.current_stock} /></TableCell>
                      <TableCell onClick={e => e.stopPropagation()}>
                        <Box sx={{ display: "flex", gap: 0.625 }}>
                          <Button
                            onClick={() => setAddSku(r.sku_id)}
                            size="small"
                            title="Add stock purchase"
                            sx={{ minWidth: 0, px: 1.25, py: 0.5, fontSize: 11, background: C.green, color: C.white, textTransform: "none", "&:hover": { background: C.green } }}
                          >＋ Add</Button>
                          <Button
                            onClick={() => setDetailSku(r.sku_id)}
                            size="small"
                            title="View/edit purchase history"
                            sx={{ minWidth: 0, px: 1.25, py: 0.5, fontSize: 11, background: C.orangeLight, color: C.orange, border: `1.5px solid ${C.orangeBorder}`, textTransform: "none" }}
                          >📋</Button>
                          <Button
                            onClick={(e) => handleDeleteSku(e, r.sku_id)}
                            size="small"
                            title="Delete all purchases for this SKU"
                            sx={{ minWidth: 0, px: 1.25, py: 0.5, fontSize: 11, color: C.red, border: `1.5px solid ${C.gray200}`, textTransform: "none" }}
                          >🗑</Button>
                        </Box>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} sx={{ textAlign: "center", py: 6.5, color: C.gray400, fontSize: 13 }}>
                      {search ? "No SKUs match your search." : "No inventory data yet — add purchases first."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
              {filtered.length > 0 && (
                <TableFooter>
                  <TableRow sx={{ background: "#FFF0EA" }}>
                    <TableCell sx={{ fontWeight: 700, fontSize: 13, color: C.gray700 }}>Total</TableCell>
                    <TableCell align="right" sx={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13, color: C.gray700 }}>{filtered.reduce((s, r) => s + r.purchased_qty, 0)}</TableCell>
                    <TableCell align="right" sx={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13, color: C.red }}>{filtered.reduce((s, r) => s + r.sold_qty, 0)}</TableCell>
                    <TableCell align="right" sx={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13, color: C.green }}>{filtered.reduce((s, r) => s + r.rto_qty, 0)}</TableCell>
                    <TableCell align="right" sx={{ fontFamily: "monospace", fontWeight: 800, fontSize: 15, color: C.orange }}>{filtered.reduce((s, r) => s + r.current_stock, 0)}</TableCell>
                    <TableCell align="right" sx={{ fontFamily: "monospace", fontWeight: 700, color: C.orange, fontSize: 13 }}>
                      {`₹${filtered.reduce((s, r) => s + parseFloat(r.purchase_value || 0), 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`}
                    </TableCell>
                    <TableCell colSpan={3} />
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </TableContainer>
        )}
      </Paper>

      {/* Legend */}
      <Paper elevation={1} sx={{ borderRadius: 3, border: `1px solid ${C.border}`, px: 2.5, py: 1.75 }}>
        <Typography sx={{ fontSize: 11, fontWeight: 700, color: C.gray400, textTransform: "uppercase", letterSpacing: "0.06em", mb: 1.25 }}>
          How stock is calculated
        </Typography>
        <Box sx={{ display: "flex", gap: 3.5, flexWrap: "wrap" }}>
          {[
            { icon: "🛒", label: "Purchased", desc: "Sum of non-exchange purchase items" },
            { icon: "✅", label: "Sold (−)",  desc: "DELIVERED Meesho orders" },
            { icon: "↩",  label: "RTO (+)",   desc: "RTO_COMPLETE orders — item returned" },
          ].map(l => (
            <Box key={l.label} sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
              <Typography sx={{ fontSize: 16 }}>{l.icon}</Typography>
              <Box>
                <Typography sx={{ fontSize: 12, fontWeight: 700, color: C.gray700 }}>{l.label}</Typography>
                <Typography sx={{ fontSize: 11, color: C.gray400 }}>{l.desc}</Typography>
              </Box>
            </Box>
          ))}
        </Box>
      </Paper>
    </Box>
  );
}
