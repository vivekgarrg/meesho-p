import React, { useState, useEffect, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { API, C, S, fmt, btn } from "../../App";

// ── helpers ───────────────────────────────────────────────────────────────────
function StockBadge({ stock }) {
  if (stock <= 0)  return <span style={{ background: C.redLight,   color: C.red,   border: `1px solid ${C.redBorder}`,   padding: "2px 10px", borderRadius: 20, fontSize: 12, fontWeight: 700 }}>Out of Stock</span>;
  if (stock <= 3)  return <span style={{ background: C.amberLight, color: C.amber, border: "1px solid #FDE68A",           padding: "2px 10px", borderRadius: 20, fontSize: 12, fontWeight: 700 }}>Low ({stock})</span>;
  return                  <span style={{ background: C.greenLight, color: C.green, border: `1px solid ${C.greenBorder}`,  padding: "2px 10px", borderRadius: 20, fontSize: 12, fontWeight: 700 }}>{stock} units</span>;
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

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);

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
    <div style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "white", borderRadius: 14, width: 440, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ padding: "16px 22px 12px", borderBottom: `1px solid ${C.border}` }}>
          <p style={{ fontWeight: 800, fontSize: 15, color: C.gray800 }}>＋ Add Stock</p>
          <p style={{ fontSize: 11, color: C.gray400, marginTop: 2, fontFamily: "monospace" }}>{skuId}</p>
        </div>
        <div style={{ padding: "16px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={S.label}>Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} style={S.inp} />
            </div>
            <div>
              <label style={S.label}>Seller Name</label>
              <input value={seller} onChange={e => setSeller(e.target.value)} placeholder="e.g. Anand Traders" style={S.inp} />
            </div>
          </div>
          <div>
            <label style={S.label}>Description (optional)</label>
            <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="e.g. Cotton kurta set" style={S.inp} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={S.label}>Quantity</label>
              <input type="number" min="1" value={qty} onChange={e => setQty(e.target.value)} style={S.inp} />
            </div>
            <div>
              <label style={S.label}>Price / Unit (₹)</label>
              <input type="number" min="0" step="0.01" value={price} onChange={e => setPrice(e.target.value)}
                disabled={exch} placeholder="0.00" style={{ ...S.inp, opacity: exch ? 0.4 : 1 }} />
            </div>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, color: C.gray600 }}>
            <input type="checkbox" checked={exch} onChange={e => setExch(e.target.checked)} style={{ accentColor: C.amber }} />
            Exchange item (not counted in cost or stock)
          </label>
          {err && <p style={{ fontSize: 12, color: C.red }}>{err}</p>}
        </div>
        <div style={{ padding: "10px 22px 16px", display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={btn("ghost")}>Cancel</button>
          <button onClick={save} disabled={saving} style={{ ...btn("primary"), opacity: saving ? 0.6 : 1 }}>
            {saving ? "Saving…" : "Add Stock"}
          </button>
        </div>
      </div>
    </div>
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

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);

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
    <div style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ background: C.white, borderRadius: 14, width: 420, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ padding: "16px 22px 12px", borderBottom: `1px solid ${C.border}` }}>
          <p style={{ fontWeight: 800, fontSize: 15, color: C.gray800 }}>Edit Purchase Item</p>
          <p style={{ fontSize: 11, color: C.gray400, marginTop: 2 }}>
            Bill {item.bill_number} · {item.bill_date} · {item.seller_name}
          </p>
        </div>
        <div style={{ padding: "16px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={S.label}>Description</label>
            <input value={desc} onChange={e => setDesc(e.target.value)} style={S.inp} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={S.label}>Quantity</label>
              <input type="number" min="1" value={qty} onChange={e => setQty(e.target.value)} style={S.inp} />
            </div>
            <div>
              <label style={S.label}>Price / Unit (₹)</label>
              <input type="number" min="0" step="0.01" value={price} onChange={e => setPrice(e.target.value)} disabled={exch} style={{ ...S.inp, opacity: exch ? 0.4 : 1 }} />
            </div>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, color: C.gray600 }}>
            <input type="checkbox" checked={exch} onChange={e => setExch(e.target.checked)} style={{ accentColor: C.amber }} />
            Exchange item (excluded from cost & stock)
          </label>
          {err && <p style={{ fontSize: 12, color: C.red }}>{err}</p>}
        </div>
        <div style={{ padding: "10px 22px 16px", display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={btn("ghost")}>Cancel</button>
          <button onClick={save} disabled={saving} style={{ ...btn("primary"), opacity: saving ? 0.6 : 1 }}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
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

  const TabBtn = ({ id, label }) => (
    <button onClick={() => setTab(id)} style={{
      padding: "6px 14px", borderRadius: 8, border: "none", cursor: "pointer", fontFamily: "inherit",
      fontSize: 12, fontWeight: tab === id ? 700 : 500,
      background: tab === id ? C.orangeLight : "transparent",
      color: tab === id ? C.orange : C.gray500,
    }}>{label}</button>
  );

  return (
    <>
      {editItem && (
        <EditItemModal item={editItem} onSave={handleSaved} onClose={() => setEditItem(null)} />
      )}
      <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,0.45)", display: "flex", justifyContent: "flex-end" }}
        onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div style={{ width: "min(720px, 96vw)", height: "100vh", background: C.white, overflowY: "auto", boxShadow: "-12px 0 48px rgba(0,0,0,0.18)", display: "flex", flexDirection: "column" }}
          onClick={(e) => e.stopPropagation()}>

          {/* Drawer header */}
          <div style={{ padding: "18px 24px 14px", borderBottom: `1px solid ${C.border}`, background: C.gray50, position: "sticky", top: 0, zIndex: 10 }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
              <div>
                <span style={{ fontFamily: "monospace", fontSize: 18, fontWeight: 800, color: C.orange }}>{skuId}</span>
                <p style={{ fontSize: 12, color: C.gray400, marginTop: 3 }}>
                  {totalPurchased} units purchased · ₹{totalSpend.toLocaleString("en-IN", { minimumFractionDigits: 2 })} total spend
                  {exchangeCount > 0 && ` · ${exchangeCount} exchange${exchangeCount > 1 ? "s" : ""}`}
                </p>
              </div>
              <button onClick={onClose} style={{ ...btn("ghost", "sm"), padding: "6px 10px", fontSize: 16, lineHeight: 1 }}>✕</button>
            </div>
            {/* Tab bar */}
            <div style={{ display: "flex", gap: 4, marginTop: 12, background: C.gray100, borderRadius: 8, padding: 3, width: "fit-content" }}>
              <TabBtn id="history" label="📋 Purchase History" />
              <TabBtn id="monthly" label="📊 Monthly Analysis" />
            </div>
          </div>

          {/* Drawer body */}
          <div style={{ flex: 1, padding: "18px 24px" }}>
            {loading ? (
              <div style={{ textAlign: "center", padding: 48, color: C.gray400 }}>Loading…</div>
            ) : (
              <>
                {/* ── History tab ── */}
                {tab === "history" && (
                  <>
                    {items.length === 0 ? (
                      <p style={{ color: C.gray400, textAlign: "center", padding: 40 }}>No purchase items found for this SKU.</p>
                    ) : (
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                        <thead>
                          <tr>
                            {["Date", "Bill", "Seller", "Desc", "Qty", "Price/Unit", "Total", "Exch?", ""].map((h, i) => (
                              <th key={h + i} style={{ ...S.th, textAlign: ["Qty", "Price/Unit", "Total"].includes(h) ? "right" : "left" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((it, i) => {
                            const rowBg = it.is_exchange ? "#FFFBEB" : i % 2 === 0 ? C.white : C.gray50;
                            return (
                              <tr key={it.id} style={{ background: rowBg }}>
                                <td style={{ ...S.td, whiteSpace: "nowrap", color: C.gray600 }}>{it.bill_date}</td>
                                <td style={{ ...S.td, fontFamily: "monospace", fontSize: 11, color: C.blue }}>{it.bill_number}</td>
                                <td style={{ ...S.td, maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.seller_name}</td>
                                <td style={{ ...S.td, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: C.gray500, fontSize: 12 }}>{it.product_description || "—"}</td>
                                <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 700 }}>{it.quantity}</td>
                                <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace" }}>{fmt(it.price_per_unit)}</td>
                                <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: it.is_exchange ? C.gray300 : C.orange }}>
                                  {it.is_exchange ? "—" : fmt(it.total_amount)}
                                </td>
                                <td style={{ ...S.td, textAlign: "center" }}>
                                  {it.is_exchange
                                    ? <span style={{ fontSize: 10, background: "#FFFBEB", color: C.amber, border: "1px solid #FDE68A", padding: "1px 7px", borderRadius: 10, fontWeight: 700 }}>Exch</span>
                                    : <span style={{ color: C.gray200 }}>—</span>}
                                </td>
                                <td style={S.td}>
                                  <div style={{ display: "flex", gap: 5 }}>
                                    <button onClick={() => setEditItem(it)} style={{ ...btn("ghostOrange", "sm"), padding: "3px 9px", fontSize: 11 }}>✏</button>
                                    <button onClick={() => handleDelete(it.id)} style={{ ...btn("ghost", "sm"), padding: "3px 9px", fontSize: 11, color: C.red }}>✕</button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr style={{ background: "#FFF0EA" }}>
                            <td colSpan={4} style={{ ...S.td, fontWeight: 700 }}>Total (excl. exchanges)</td>
                            <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 800 }}>{totalPurchased}</td>
                            <td style={S.td} />
                            <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 800, color: C.orange }}>
                              ₹{totalSpend.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                            </td>
                            <td colSpan={2} style={S.td} />
                          </tr>
                        </tfoot>
                      </table>
                    )}
                  </>
                )}

                {/* ── Monthly analysis tab ── */}
                {tab === "monthly" && (
                  <>
                    {monthly.length === 0 ? (
                      <p style={{ color: C.gray400, textAlign: "center", padding: 40 }}>No purchase data for monthly analysis.</p>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                        {/* Bar chart — qty */}
                        <div>
                          <p style={{ fontSize: 12, fontWeight: 700, color: C.gray500, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>Units Purchased per Month</p>
                          <ResponsiveContainer width="100%" height={200}>
                            <BarChart data={monthly} margin={{ top: 4, right: 8, left: -10, bottom: 4 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke={C.gray100} />
                              <XAxis dataKey="label" tick={{ fill: C.gray400, fontSize: 11 }} axisLine={false} tickLine={false} />
                              <YAxis allowDecimals={false} tick={{ fill: C.gray400, fontSize: 11 }} axisLine={false} tickLine={false} />
                              <Tooltip
                                contentStyle={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 8 }}
                                cursor={{ fill: C.gray50 }}
                                formatter={(v) => [`${v} units`, "Purchased"]}
                              />
                              <Bar dataKey="total_qty" fill={C.orange} radius={[5, 5, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>

                        {/* Bar chart — spend */}
                        <div>
                          <p style={{ fontSize: 12, fontWeight: 700, color: C.gray500, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>Spend per Month (₹)</p>
                          <ResponsiveContainer width="100%" height={200}>
                            <BarChart data={monthly.map(m => ({ ...m, value: parseFloat(m.total_value) }))} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke={C.gray100} />
                              <XAxis dataKey="label" tick={{ fill: C.gray400, fontSize: 11 }} axisLine={false} tickLine={false} />
                              <YAxis tick={{ fill: C.gray400, fontSize: 11 }} axisLine={false} tickLine={false} />
                              <Tooltip
                                contentStyle={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 8 }}
                                cursor={{ fill: C.gray50 }}
                                formatter={(v) => [`₹${v.toLocaleString("en-IN")}`, "Spend"]}
                              />
                              <Bar dataKey="value" fill={C.green} radius={[5, 5, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>

                        {/* Monthly table */}
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                          <thead>
                            <tr>
                              {["Month", "Bills", "Units", "Total Spend"].map(h => (
                                <th key={h} style={{ ...S.th, textAlign: h !== "Month" ? "right" : "left" }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {monthly.map((m, i) => (
                              <tr key={m.month} style={{ background: i % 2 === 0 ? C.white : C.gray50 }}>
                                <td style={{ ...S.td, fontWeight: 600 }}>{m.label}</td>
                                <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace" }}>{m.bill_count}</td>
                                <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 700 }}>{m.total_qty}</td>
                                <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", color: C.orange, fontWeight: 700 }}>{fmt(m.total_value)}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr style={{ background: "#FFF0EA" }}>
                              <td style={{ ...S.td, fontWeight: 700 }}>All-time total</td>
                              <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 700 }}>{monthly.reduce((s, m) => s + m.bill_count, 0)}</td>
                              <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 800 }}>{monthly.reduce((s, m) => s + m.total_qty, 0)}</td>
                              <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 800, color: C.orange }}>
                                {fmt(monthly.reduce((s, m) => s + parseFloat(m.total_value), 0))}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
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
    <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
      {/* Header row */}
      <div
        style={{ padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between",
                 background: C.gray50, borderBottom: collapsed ? "none" : `1px solid ${C.border}`, cursor: "pointer" }}
        onClick={() => setCollapsed(c => !c)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: C.gray800 }}>📦 Packing Status</span>
          {!collapsed && orders.length > 0 && (
            allPacked
              ? <span style={{ fontSize: 11, background: C.greenLight, color: C.green, border: `1px solid ${C.greenBorder}`, padding: "2px 10px", borderRadius: 20, fontWeight: 700 }}>✓ All Packed</span>
              : <span style={{ fontSize: 11, background: C.redLight,   color: C.red,   border: `1px solid ${C.redBorder}`,   padding: "2px 10px", borderRadius: 20, fontWeight: 700 }}>{unpackedCount} Not Packed</span>
          )}
        </div>
        <span style={{ color: C.gray400, fontSize: 13 }}>{collapsed ? "▼" : "▲"}</span>
      </div>

      {!collapsed && (
        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Date nav */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => shiftDate(-1)} style={{ ...btn("ghost", "sm"), padding: "5px 12px" }}>‹ Prev</button>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              style={{ ...S.inp, width: 150, fontSize: 13 }} />
            <button onClick={() => shiftDate(1)} style={{ ...btn("ghost", "sm"), padding: "5px 12px" }}>Next ›</button>
            <button onClick={() => setDate(todayStr())} style={{ ...btn("ghost", "sm"), padding: "5px 12px", color: C.orange }}>Today</button>
            <button onClick={load} style={{ ...btn("ghost", "sm"), padding: "5px 12px" }}>⟳</button>
          </div>

          {loading ? (
            <div style={{ textAlign: "center", padding: 24, color: C.gray400 }}>Loading orders…</div>
          ) : orders.length === 0 ? (
            <div style={{ textAlign: "center", padding: 24, color: C.gray400 }}>No labels uploaded for {date}.</div>
          ) : (
            <>
              {/* KPIs */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {[
                  { label: "Total Orders", value: orders.length, color: C.blue },
                  { label: "Total Units",  value: totalUnits,    color: C.gray700 },
                  { label: "Packed",       value: packedCount,   color: C.green },
                  { label: "Not Packed",   value: unpackedCount, color: unpackedCount > 0 ? C.red : C.gray300 },
                ].map(k => (
                  <div key={k.label} style={{ background: C.gray50, border: `1px solid ${C.border}`, borderRadius: 10, padding: "8px 16px", minWidth: 90 }}>
                    <p style={{ fontSize: 10, fontWeight: 700, color: C.gray400, textTransform: "uppercase", letterSpacing: "0.06em" }}>{k.label}</p>
                    <p style={{ fontSize: 18, fontWeight: 800, color: k.color, fontFamily: "monospace" }}>{k.value}</p>
                  </div>
                ))}
                {!allPacked && (
                  <button onClick={markAllPacked} style={{ ...btn("success", "sm"), alignSelf: "center", marginLeft: 6 }}>
                    ✓ Mark All Packed
                  </button>
                )}
                {allPacked && (
                  <div style={{ alignSelf: "center", marginLeft: 6, fontSize: 13, fontWeight: 700, color: C.green }}>
                    🎉 All {orders.length} orders packed!
                  </div>
                )}
              </div>

              {/* Search autocomplete */}
              <div style={{ position: "relative", maxWidth: 320 }}>
                <label style={{ ...S.label, marginBottom: 4 }}>Quick find by last 4 digits of suborder #</label>
                <input
                  value={search}
                  onChange={e => handleSearch(e.target.value)}
                  placeholder="e.g. 0480"
                  style={{ ...S.inp, fontSize: 13 }}
                />
                {suggestions.length > 0 && (
                  <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50,
                                background: C.white, border: `1px solid ${C.border}`, borderRadius: 8,
                                boxShadow: "0 8px 24px rgba(0,0,0,0.12)", marginTop: 2, overflow: "hidden" }}>
                    {suggestions.map(o => (
                      <div key={o.order_id}
                        style={{ padding: "8px 12px", display: "flex", alignItems: "center", justifyContent: "space-between",
                                 borderBottom: `1px solid ${C.gray100}`, cursor: "pointer",
                                 background: o.is_packed ? "#F0FDF4" : C.white }}
                        onMouseEnter={e => (e.currentTarget.style.background = C.gray50)}
                        onMouseLeave={e => (e.currentTarget.style.background = o.is_packed ? "#F0FDF4" : C.white)}
                      >
                        <div>
                          <span style={{ fontFamily: "monospace", fontSize: 11, color: C.gray500 }}>…{o.order_id.slice(-14)}</span>
                          <span style={{ marginLeft: 8, fontSize: 12, color: C.gray600 }}>{o.customer_name}</span>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); togglePacked(o.order_id, o.is_packed); setSearch(""); setSuggestions([]); }}
                          style={{
                            padding: "3px 10px", borderRadius: 20, fontSize: 11, cursor: "pointer",
                            fontFamily: "inherit", fontWeight: 600, border: "none",
                            background: o.is_packed ? C.greenLight : "#FEE2E2",
                            color:      o.is_packed ? C.green      : C.red,
                          }}
                        >
                          {o.is_packed ? "✓ Packed" : "Not Packed"}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Filter tabs */}
              <div style={{ display: "flex", gap: 4, background: C.gray100, borderRadius: 8, padding: 3, width: "fit-content" }}>
                {[["all", "All"], ["packed", "✓ Packed"], ["unpacked", "Not Packed"]].map(([id, label]) => (
                  <button key={id} onClick={() => setFilter(id)} style={{
                    padding: "5px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontFamily: "inherit",
                    fontSize: 12, fontWeight: filter === id ? 700 : 500,
                    background: filter === id ? C.white : "transparent",
                    color:      filter === id ? C.orange : C.gray500,
                    boxShadow:  filter === id ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
                  }}>{label} {id === "all" ? `(${orders.length})` : id === "packed" ? `(${packedCount})` : `(${unpackedCount})`}</button>
                ))}
              </div>

              {/* Orders grouped by courier */}
              {displayed.length === 0 ? (
                <p style={{ color: C.gray400, fontSize: 13, textAlign: "center", padding: 16 }}>
                  {filter === "packed" ? "No packed orders yet." : filter === "unpacked" ? "No unpacked orders — all done! 🎉" : "No orders."}
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {Object.entries(byCourier).sort().map(([courier, rows]) => {
                    const cs = courierStyle(courier);
                    const cp = rows.filter(o => o.is_packed).length;
                    return (
                      <div key={courier} style={{ border: `1px solid ${cs.border}`, borderRadius: 10, overflow: "hidden" }}>
                        {/* Courier header */}
                        <div style={{ background: cs.bg, padding: "8px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <span style={{ fontWeight: 700, fontSize: 13, color: cs.fg }}>{courier}</span>
                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <span style={{ fontSize: 11, color: cs.fg, fontWeight: 600 }}>{rows.length} orders</span>
                            <span style={{ fontSize: 11, background: C.greenLight, color: C.green, border: `1px solid ${C.greenBorder}`, padding: "1px 8px", borderRadius: 20, fontWeight: 700 }}>{cp} packed</span>
                            {cp < rows.length && <span style={{ fontSize: 11, background: C.redLight, color: C.red, border: `1px solid ${C.redBorder}`, padding: "1px 8px", borderRadius: 20, fontWeight: 700 }}>{rows.length - cp} left</span>}
                          </div>
                        </div>
                        {/* Order rows */}
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                          <tbody>
                            {rows.map((o, i) => (
                              <tr key={o.order_id} style={{ background: o.is_packed ? "#F0FDF4" : i % 2 === 0 ? C.white : C.gray50,
                                                            borderTop: `1px solid ${C.gray100}` }}>
                                <td style={{ ...S.td, fontFamily: "monospace", fontSize: 11, color: C.gray400, width: 160 }}>
                                  …{o.order_id.slice(-14)}
                                </td>
                                <td style={{ ...S.td, fontWeight: 600, color: C.gray700 }}>{o.customer_name || "—"}</td>
                                <td style={{ ...S.td, color: C.gray500 }}>{o.customer_city || "—"}</td>
                                <td style={{ ...S.td, textAlign: "center" }}>
                                  {o.payment_type === "COD"
                                    ? <span style={{ fontSize: 10, background: "#FFFBEB", color: C.amber, border: "1px solid #FDE68A", padding: "1px 7px", borderRadius: 10, fontWeight: 700 }}>COD</span>
                                    : <span style={{ fontSize: 10, background: C.greenLight, color: C.green, border: `1px solid ${C.greenBorder}`, padding: "1px 7px", borderRadius: 10, fontWeight: 700 }}>PP</span>}
                                </td>
                                <td style={{ ...S.td, textAlign: "right" }}>
                                  <button
                                    onClick={() => togglePacked(o.order_id, o.is_packed)}
                                    style={{
                                      padding: "3px 10px", borderRadius: 20, fontSize: 11, cursor: "pointer",
                                      fontFamily: "inherit", fontWeight: 600, whiteSpace: "nowrap",
                                      background: o.is_packed ? C.greenLight : C.white,
                                      color:      o.is_packed ? C.green      : C.gray400,
                                      border:     `1px solid ${o.is_packed ? C.greenBorder : C.gray300}`,
                                    }}
                                  >
                                    {o.is_packed ? "✓ Packed" : "Not Packed"}
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
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
  const thS     = (k) => ({ ...S.th, cursor: "pointer", userSelect: "none", color: sortKey === k ? C.orange : C.gray500 });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: C.gray800, marginBottom: 3 }}>📦 Inventory</h1>
          <p style={{ fontSize: 13, color: C.gray400 }}>
            Live stock = purchased − sold (delivered) + returned (RTO). Click any row to edit purchases or analyse monthly trend.
          </p>
        </div>
        <button onClick={load} style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.white, cursor: "pointer", fontSize: 12, color: C.gray600, fontFamily: "inherit" }}>
          ⟳ Refresh
        </button>
      </div>

      {/* KPI strip */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
        {[
          { label: "Total Stock",   value: totalStock,  accent: C.green,   icon: "📦" },
          { label: "SKUs Tracked",  value: data.length, accent: C.blue,    icon: "🏷" },
          { label: "Out of Stock",  value: outOfStock,  accent: C.red,     icon: "⛔" },
          { label: "Low Stock ≤3",  value: lowStock,    accent: C.amber,   icon: "⚠️" },
        ].map(k => (
          <div key={k.label} style={{ ...S.card, borderTop: `3px solid ${k.accent}`, minWidth: "max-content" }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: C.gray400, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 8, whiteSpace: "nowrap" }}>{k.icon} {k.label}</p>
            <p style={{ fontSize: 22, fontWeight: 800, fontFamily: "'DM Mono', monospace", color: k.accent, whiteSpace: "nowrap" }}>{k.value.toLocaleString("en-IN")}</p>
          </div>
        ))}
        <div style={{ ...S.card, borderTop: `3px solid ${C.orange}`, minWidth: "max-content" }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: C.gray400, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 8, whiteSpace: "nowrap" }}>💰 Total Purchase Value</p>
          <p style={{ fontSize: 22, fontWeight: 800, fontFamily: "'DM Mono', monospace", color: C.orange, whiteSpace: "nowrap" }}>
            {`₹${totalValue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`}
          </p>
        </div>
      </div>

      {/* Table */}
      <div style={S.card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
          <p style={{ ...S.cardTitle, marginBottom: 0 }}>
            Stock by Parent SKU &nbsp;
            <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, fontSize: 11, color: C.gray400 }}>— click a row to view/edit purchases or see monthly analysis</span>
          </p>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Search SKU…" style={{ ...S.inp, width: 200, fontSize: 12 }} />
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: 60, color: C.gray400 }}><div style={{ fontSize: 28, marginBottom: 10 }}>⏳</div> Loading inventory…</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th onClick={() => toggle("sku_id")}         style={thS("sku_id")}>Parent SKU{sortInd("sku_id")}</th>
                  <th onClick={() => toggle("purchased_qty")}  style={{ ...thS("purchased_qty"),  textAlign: "right" }}>Purchased{sortInd("purchased_qty")}</th>
                  <th onClick={() => toggle("sold_qty")}       style={{ ...thS("sold_qty"),       textAlign: "right" }}>Sold{sortInd("sold_qty")}</th>
                  <th onClick={() => toggle("rto_qty")}        style={{ ...thS("rto_qty"),        textAlign: "right" }}>RTO{sortInd("rto_qty")}</th>
                  <th onClick={() => toggle("current_stock")}  style={{ ...thS("current_stock"),  textAlign: "right" }}>Current Stock{sortInd("current_stock")}</th>
                  <th onClick={() => toggle("purchase_value")} style={{ ...thS("purchase_value"), textAlign: "right" }}>Purchase Value{sortInd("purchase_value")}</th>
                  <th onClick={() => toggle("last_purchase")}  style={thS("last_purchase")}>Last Purchase{sortInd("last_purchase")}</th>
                  <th style={S.th}>Status</th>
                  <th style={S.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => {
                  const rowBg = i % 2 === 0 ? C.white : C.gray50;
                  const stockColor = r.current_stock <= 0 ? C.red : r.current_stock <= 3 ? C.amber : C.green;
                  return (
                    <tr key={r.sku_id} style={{ background: rowBg, cursor: "pointer" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "#F0FFF4")}
                      onMouseLeave={e => (e.currentTarget.style.background = rowBg)}
                      onClick={() => setDetailSku(r.sku_id)}
                    >
                      <td style={{ ...S.td, fontFamily: "monospace", fontWeight: 700, color: C.orange }}>{r.sku_id}</td>
                      <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace" }}>{r.purchased_qty}</td>
                      <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", color: C.red }}>{r.sold_qty}</td>
                      <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", color: C.green }}>{r.rto_qty}</td>
                      <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 800, fontSize: 15, color: stockColor }}>{r.current_stock}</td>
                      <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace" }}>{fmt(r.purchase_value)}</td>
                      <td style={{ ...S.td, color: C.gray500, whiteSpace: "nowrap" }}>{r.last_purchase || "—"}</td>
                      <td style={S.td}><StockBadge stock={r.current_stock} /></td>
                      <td style={S.td} onClick={e => e.stopPropagation()}>
                        <div style={{ display: "flex", gap: 5 }}>
                          <button
                            onClick={() => setAddSku(r.sku_id)}
                            style={{ ...btn("success", "sm"), padding: "4px 10px", fontSize: 11 }}
                            title="Add stock purchase"
                          >＋ Add</button>
                          <button
                            onClick={() => setDetailSku(r.sku_id)}
                            style={{ ...btn("ghostOrange", "sm"), padding: "4px 10px", fontSize: 11 }}
                            title="View/edit purchase history"
                          >📋</button>
                          <button
                            onClick={(e) => handleDeleteSku(e, r.sku_id)}
                            style={{ ...btn("ghost", "sm"), padding: "4px 10px", fontSize: 11, color: C.red }}
                            title="Delete all purchases for this SKU"
                          >🗑</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ ...S.td, textAlign: "center", padding: 52, color: C.gray400 }}>
                      {search ? "No SKUs match your search." : "No inventory data yet — add purchases first."}
                    </td>
                  </tr>
                )}
              </tbody>
              {filtered.length > 0 && (
                <tfoot>
                  <tr style={{ background: "#FFF0EA" }}>
                    <td style={{ ...S.td, fontWeight: 700 }}>Total</td>
                    <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 700 }}>{filtered.reduce((s, r) => s + r.purchased_qty, 0)}</td>
                    <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: C.red }}>{filtered.reduce((s, r) => s + r.sold_qty, 0)}</td>
                    <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: C.green }}>{filtered.reduce((s, r) => s + r.rto_qty, 0)}</td>
                    <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 800, fontSize: 15, color: C.orange }}>{filtered.reduce((s, r) => s + r.current_stock, 0)}</td>
                    <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: C.orange }}>
                      {`₹${filtered.reduce((s, r) => s + parseFloat(r.purchase_value || 0), 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`}
                    </td>
                    <td colSpan={3} style={S.td} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>

      {/* Legend */}
      <div style={{ ...S.card, padding: "14px 20px" }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: C.gray400, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>How stock is calculated</p>
        <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
          {[
            { icon: "🛒", label: "Purchased", desc: "Sum of non-exchange purchase items" },
            { icon: "✅", label: "Sold (−)",  desc: "DELIVERED Meesho orders" },
            { icon: "↩",  label: "RTO (+)",   desc: "RTO_COMPLETE orders — item returned" },
          ].map(l => (
            <div key={l.label} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <span style={{ fontSize: 16 }}>{l.icon}</span>
              <div>
                <p style={{ fontSize: 12, fontWeight: 700, color: C.gray700 }}>{l.label}</p>
                <p style={{ fontSize: 11, color: C.gray400 }}>{l.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
