import React, { useState, useEffect, useCallback, useRef } from "react";
import { API, C, S, fmt, btn, Tag, SectionHeader, Pagination } from "../../App";

const PAGE_SIZE = 20;

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
  const [date,       setDate]       = useState(initial?.date       || today());
  const [seller,     setSeller]     = useState(initial?.seller_name || "");
  const [billNo,     setBillNo]     = useState(initial?.bill_number || "");
  const [notes,      setNotes]      = useState(initial?.notes      || "");
  const [items,      setItems]      = useState(
    initial?.items?.length ? initial.items.map(i => ({ ...i })) : [emptyItem()]
  );
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState("");

  // close on Escape, lock body scroll
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);

  const setItem = (idx, field, value) =>
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it));

  const addItem   = () => setItems(prev => [...prev, emptyItem()]);
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

  const skuOptions = parentSkus.map(p => (
    <option key={p.item_id} value={p.item_id}>{p.item_id}</option>
  ));

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center",
      padding: "28px 16px", overflowY: "auto",
    }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: C.white, borderRadius: 16, width: "100%", maxWidth: 840,
        boxShadow: "0 20px 60px rgba(0,0,0,0.2)", display: "flex", flexDirection: "column", gap: 0,
      }}>
        {/* Header */}
        <div style={{ padding: "20px 28px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 800, color: C.gray800, marginBottom: 2 }}>
              {initial?.id ? "Edit Purchase Bill" : "New Purchase Bill"}
            </h2>
            <p style={{ fontSize: 12, color: C.gray400 }}>All data is preserved and reflected in inventory.</p>
          </div>
          <button onClick={onClose} style={{ ...btn("ghost", "sm"), padding: "6px 10px", fontSize: 16, lineHeight: 1 }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ padding: "20px 28px", display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Row 1 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
            <div>
              <label style={S.label}>Date *</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} style={S.inp} />
            </div>
            <div>
              <label style={S.label}>Seller / Vendor *</label>
              <input value={seller} onChange={e => setSeller(e.target.value)} placeholder="e.g. Raj Textiles" style={S.inp} />
            </div>
            <div>
              <label style={S.label}>Bill / Invoice No.</label>
              <input value={billNo} onChange={e => setBillNo(e.target.value)} placeholder="e.g. INV-001" style={S.inp} />
            </div>
          </div>
          <div>
            <label style={S.label}>Notes</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes…" style={S.inp} />
          </div>

          {/* Items */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: C.gray600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Items
              </p>
              <button onClick={addItem} style={{ ...btn("ghostOrange", "sm") }}>+ Add Item</button>
            </div>

            {/* Table header */}
            <div style={{ display: "grid", gridTemplateColumns: "1.6fr 2fr 0.7fr 1.1fr 1fr 0.6fr 0.4fr", gap: 8, marginBottom: 6, padding: "0 4px" }}>
              {["SKU", "Description", "Qty", "Price/Unit (₹)", "Total", "Exchange?", ""].map(h => (
                <span key={h} style={{ fontSize: 10, fontWeight: 700, color: C.gray400, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</span>
              ))}
            </div>

            {items.map((it, idx) => {
              const lineTotal = it.is_exchange ? 0 : (parseInt(it.quantity, 10) || 0) * (parseFloat(it.price_per_unit) || 0);
              return (
                <div key={idx} style={{
                  display: "grid", gridTemplateColumns: "1.6fr 2fr 0.7fr 1.1fr 1fr 0.6fr 0.4fr",
                  gap: 8, marginBottom: 8, alignItems: "center",
                  background: it.is_exchange ? "#FFFBEB" : C.gray50,
                  borderRadius: 8, padding: "8px 10px",
                  border: `1px solid ${it.is_exchange ? "#FDE68A" : C.border}`,
                }}>
                  <select
                    value={it.parent_sku_id}
                    onChange={e => setItem(idx, "parent_sku_id", e.target.value)}
                    style={{ ...S.inp, fontSize: 12, padding: "7px 8px" }}
                  >
                    <option value="">— Select SKU —</option>
                    {skuOptions}
                  </select>
                  <input
                    value={it.product_description}
                    onChange={e => setItem(idx, "product_description", e.target.value)}
                    placeholder="Description…"
                    style={{ ...S.inp, fontSize: 12 }}
                  />
                  <input
                    type="number" min="1" value={it.quantity}
                    onChange={e => setItem(idx, "quantity", e.target.value)}
                    style={{ ...S.inp, fontSize: 12 }}
                  />
                  <input
                    type="number" min="0" step="0.01" value={it.price_per_unit}
                    onChange={e => setItem(idx, "price_per_unit", e.target.value)}
                    placeholder="0.00"
                    disabled={it.is_exchange}
                    style={{ ...S.inp, fontSize: 12, opacity: it.is_exchange ? 0.4 : 1 }}
                  />
                  <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 600, color: it.is_exchange ? C.gray300 : C.green, textAlign: "right" }}>
                    {it.is_exchange ? "—" : `₹${lineTotal.toFixed(2)}`}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
                      <input
                        type="checkbox" checked={it.is_exchange}
                        onChange={e => setItem(idx, "is_exchange", e.target.checked)}
                        style={{ accentColor: C.amber, width: 15, height: 15 }}
                      />
                      <span style={{ fontSize: 10, color: C.amber, fontWeight: 600 }}>Exch</span>
                    </label>
                  </div>
                  <button
                    onClick={() => removeItem(idx)}
                    disabled={items.length === 1}
                    style={{ ...btn("ghost", "sm"), padding: "4px 8px", color: C.red, borderColor: "transparent", opacity: items.length === 1 ? 0.3 : 1 }}
                  >✕</button>
                </div>
              );
            })}

            {/* Grand total bar */}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4, padding: "10px 10px 0", borderTop: `1px solid ${C.border}` }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: C.gray700 }}>
                Grand Total:&nbsp;
                <span style={{ fontFamily: "monospace", color: C.orange, fontSize: 17 }}>
                  ₹{grandTotal.toFixed(2)}
                </span>
                &nbsp;<span style={{ fontSize: 11, color: C.gray400 }}>(excl. exchanges)</span>
              </span>
            </div>
          </div>

          {error && (
            <div style={{ background: C.redLight, border: `1px solid ${C.redBorder}`, borderRadius: 8, padding: "10px 14px", color: C.red, fontSize: 13 }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "14px 28px 20px", borderTop: `1px solid ${C.border}`, display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={btn("ghost")}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ ...btn("primary"), opacity: saving ? 0.6 : 1 }}>
            {saving ? "Saving…" : initial?.id ? "Save Changes" : "Create Bill"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── View Modal (read-only bill detail) ────────────────────────────────────────
function BillViewModal({ bill, onClose, onEdit, onDownloadPdf }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "28px 16px", overflowY: "auto" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ background: C.white, borderRadius: 16, width: "100%", maxWidth: 700, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ padding: "20px 28px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 800, color: C.gray800 }}>
              Bill #{bill.bill_number || bill.id}
            </h2>
            <p style={{ fontSize: 12, color: C.gray400 }}>
              {fmtDate(bill.date)} &middot; {bill.seller_name}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => onDownloadPdf(bill.id)} style={{ ...btn("ghost", "sm") }}>⬇ PDF</button>
            <button onClick={() => onEdit(bill)}           style={{ ...btn("ghostOrange", "sm") }}>✏ Edit</button>
            <button onClick={onClose}                      style={{ ...btn("ghost", "sm"), padding: "6px 10px", fontSize: 16, lineHeight: 1 }}>✕</button>
          </div>
        </div>
        <div style={{ padding: "20px 28px" }}>
          {bill.notes && (
            <p style={{ fontSize: 13, color: C.gray500, marginBottom: 14, fontStyle: "italic" }}>{bill.notes}</p>
          )}
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                {["SKU", "Description", "Qty", "Price/Unit", "Total", "Exchange"].map(h => (
                  <th key={h} style={{ ...S.th, textAlign: ["Qty", "Price/Unit", "Total"].includes(h) ? "right" : "left" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bill.items.map((it, i) => (
                <tr key={it.id} style={{ background: i % 2 === 0 ? C.white : C.gray50 }}>
                  <td style={{ ...S.td, fontFamily: "monospace", fontWeight: 600, color: C.orange, fontSize: 12 }}>{it.parent_sku_id || "—"}</td>
                  <td style={S.td}>{it.product_description || "—"}</td>
                  <td style={{ ...S.td, textAlign: "right" }}>{it.quantity}</td>
                  <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace" }}>{fmt(it.price_per_unit)}</td>
                  <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 600 }}>
                    {it.is_exchange ? <span style={{ color: C.gray300 }}>—</span> : fmt(it.total_amount)}
                  </td>
                  <td style={{ ...S.td, textAlign: "center" }}>
                    {it.is_exchange ? <Tag variant="amber">Exchange</Tag> : <span style={{ color: C.gray300 }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: "#FFF0EA" }}>
                <td colSpan={4} style={{ ...S.td, fontWeight: 700 }}>Grand Total (excl. exchanges)</td>
                <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 800, fontSize: 15, color: C.orange }}>{fmt(bill.total_amount)}</td>
                <td style={S.td} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Main Tab ──────────────────────────────────────────────────────────────────
export function PurchasesTab() {
  const [bills,      setBills]      = useState([]);
  const [total,      setTotal]      = useState(0);
  const [page,       setPage]       = useState(1);
  const [loading,    setLoading]    = useState(false);
  const [dateFrom,   setDateFrom]   = useState("");
  const [dateTo,     setDateTo]     = useState("");
  const [sellerQ,    setSellerQ]    = useState("");
  const [parentSkus, setParentSkus] = useState([]);
  const [showForm,   setShowForm]   = useState(false);
  const [editBill,   setEditBill]   = useState(null);  // bill object or null
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

  useEffect(() => { load(); setPage(1); }, [load]);

  const handleSaved = (saved) => {
    setShowForm(false);
    setEditBill(null);
    load();
    // If we were viewing the bill, refresh it
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

  // Paginate locally (bills already loaded with filters)
  const pageBills = bills.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Summary KPIs
  const totalSpend   = bills.reduce((s, b) => s + parseFloat(b.total_amount || 0), 0);
  const totalItems   = bills.reduce((s, b) => s + b.items.length, 0);
  const uniqueSellers = [...new Set(bills.map(b => b.seller_name))].length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: C.gray800, marginBottom: 3 }}>🛒 Purchases</h1>
          <p style={{ fontSize: 13, color: C.gray400 }}>Track every stock purchase; PDF bills on demand.</p>
        </div>
        <button onClick={() => setShowForm(true)} style={{ ...btn("primary") }}>+ New Purchase Bill</button>
      </div>

      {/* KPI strip */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
        {[
          { label: "Total Spend",    value: `₹${totalSpend.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`, accent: C.orange, icon: "💸" },
          { label: "Bills Recorded", value: `${total}`,          accent: C.blue,  icon: "🧾" },
          { label: "Total SKU Lines", value: `${totalItems}`,     accent: C.green, icon: "📦" },
          { label: "Unique Sellers", value: `${uniqueSellers}`,  accent: C.amber, icon: "🏪" },
        ].map(k => (
          <div key={k.label} style={{ ...S.card, borderTop: `3px solid ${k.accent}`, minWidth: "max-content" }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: C.gray400, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 8, whiteSpace: "nowrap" }}>
              {k.icon} {k.label}
            </p>
            <p style={{ fontSize: 22, fontWeight: 800, fontFamily: "'DM Mono', monospace", color: k.accent, whiteSpace: "nowrap" }}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div style={{ ...S.card, padding: "14px 20px", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.gray400, textTransform: "uppercase", letterSpacing: "0.06em" }}>Filter</span>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ ...S.inp, width: 150, fontSize: 12 }} />
        <span style={{ color: C.gray300 }}>→</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ ...S.inp, width: 150, fontSize: 12 }} />
        <div style={{ width: 1, height: 24, background: C.gray200 }} />
        <input
          value={sellerQ} onChange={e => setSellerQ(e.target.value)}
          placeholder="🔍 Seller name…"
          style={{ ...S.inp, width: 200, fontSize: 12 }}
        />
        {(dateFrom || dateTo || sellerQ) && (
          <button
            onClick={() => { setDateFrom(""); setDateTo(""); setSellerQ(""); }}
            style={{ ...btn("ghost", "sm"), color: C.red }}
          >✕ Clear</button>
        )}
      </div>

      {/* Bills table */}
      <div style={S.card}>
        <SectionHeader
          title="Purchase Bills"
          count={total}
          actions={loading ? <span style={{ fontSize: 12, color: C.gray400 }}>Loading…</span> : null}
        />
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Date", "Bill No.", "Seller", "Items", "Total Amount", "Actions"].map(h => (
                  <th key={h} style={{ ...S.th, textAlign: h === "Total Amount" ? "right" : "left" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageBills.map((bill, i) => {
                const rowBg = i % 2 === 0 ? C.white : C.gray50;
                const exchangeCount = bill.items.filter(it => it.is_exchange).length;
                return (
                  <tr key={bill.id} style={{ background: rowBg, cursor: "pointer" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "#F0F7FF")}
                    onMouseLeave={e => (e.currentTarget.style.background = rowBg)}
                    onClick={() => setViewBill(bill)}
                  >
                    <td style={{ ...S.td, whiteSpace: "nowrap", fontWeight: 600, color: C.gray700 }}>{fmtDate(bill.date)}</td>
                    <td style={{ ...S.td, fontFamily: "monospace", fontSize: 12, color: C.blue }}>
                      {bill.bill_number || `#${bill.id}`}
                    </td>
                    <td style={{ ...S.td, fontWeight: 600 }}>{bill.seller_name}</td>
                    <td style={S.td}>
                      <span style={{ color: C.gray700 }}>{bill.items.length} line{bill.items.length !== 1 ? "s" : ""}</span>
                      {exchangeCount > 0 && (
                        <Tag variant="amber" fontSize={10}>&nbsp;{exchangeCount} exchange{exchangeCount > 1 ? "s" : ""}</Tag>
                      )}
                    </td>
                    <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: C.orange }}>
                      {fmt(bill.total_amount)}
                    </td>
                    <td style={{ ...S.td }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          onClick={() => handleDownloadPdf(bill.id)}
                          style={{ ...btn("ghost", "sm"), padding: "4px 10px", fontSize: 11 }}
                          title="Download PDF"
                        >⬇ PDF</button>
                        <button
                          onClick={() => setEditBill(bill)}
                          style={{ ...btn("ghostOrange", "sm"), padding: "4px 10px", fontSize: 11 }}
                          title="Edit"
                        >✏</button>
                        <button
                          onClick={() => handleDelete(bill.id)}
                          disabled={deleting === bill.id}
                          style={{ ...btn("ghost", "sm"), padding: "4px 10px", fontSize: 11, color: C.red, borderColor: "transparent" }}
                          title="Delete"
                        >{deleting === bill.id ? "…" : "✕"}</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!loading && bills.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ ...S.td, textAlign: "center", padding: 48, color: C.gray400 }}>
                    No purchase bills yet — click <strong>+ New Purchase Bill</strong> to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {total > PAGE_SIZE && (
          <Pagination page={page} total={total} pageSize={PAGE_SIZE} onChange={setPage} />
        )}
      </div>
    </div>
  );
}
