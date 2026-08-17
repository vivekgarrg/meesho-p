import React, { useState, useEffect, useRef, useCallback } from "react";
import { API, btn, C, S, fmt, useIsMobile } from "../../App";

// ── helpers ───────────────────────────────────────────────────────────────────
const calcFinal = (ip, tax, pkg) => {
  const i = parseFloat(ip) || 0, t = parseFloat(tax) || 0, p = parseFloat(pkg) || 0;
  return i + i * t / 100 + p;
};

const fmtShortDate = d => {
  if (!d) return "";
  const [y, m] = d.split("-");
  return new Date(+y, +m - 1, 1).toLocaleString("en-IN", { month: "short", year: "2-digit" });
};

function nameSuggestions(parentId, skus) {
  const words = parentId.toLowerCase().split(/[_\-\s]+/).filter(w => w.length > 2);
  return [...skus].sort((a, b) => {
    const am = words.some(w => a.sku_id.toLowerCase().includes(w));
    const bm = words.some(w => b.sku_id.toLowerCase().includes(w));
    return bm - am;
  });
}

// ── field group — reusable inline form row ────────────────────────────────────
function PriceFields({ form, setForm, cols = "2fr 1fr 1fr 1fr", showNotes = false }) {
  const fields = [
    { label: "Effective From *", key: "effective_from", type: "date", show: "effective_from" in form },
    { label: "Item Price (₹) *", key: "item_price",     type: "number" },
    { label: "Tax %",            key: "tax_percent",    type: "number" },
    { label: "Packaging (₹)",   key: "packaging_cost", type: "number" },
    { label: "Notes",            key: "notes",          type: "text",   show: showNotes },
  ].filter(f => f.show !== false);

  return (
    <div style={{ display: "grid", gridTemplateColumns: cols, gap: 8 }}>
      {fields.map(({ label, key, type }) => (
        <div key={key}>
          <label style={{ ...S.label, fontSize: 10 }}>{label}</label>
          <input type={type} step={type === "number" ? "0.01" : undefined}
            value={form[key] ?? ""} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
            style={{ ...S.inp, fontSize: 12 }} />
        </div>
      ))}
    </div>
  );
}

// ── price timeline visualization ──────────────────────────────────────────────
function PriceTimeline({ histories, onDelete, onAdd }) {
  if (histories.length === 0) return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <p style={{ fontSize: 12, color: C.gray400, fontStyle: "italic" }}>
        No price history — add an entry to track price changes over time and enable date-accurate profit calculation.
      </p>
      <button onClick={onAdd} style={btn("secondary", "sm")}>+ Add First Entry</button>
    </div>
  );

  return (
    <div style={{ overflowX: "auto", paddingBottom: 4 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 0, minWidth: "max-content" }}>
        {histories.map((h, i) => {
          const isLast = i === histories.length - 1;
          return (
            <div key={h.id} style={{ display: "flex", alignItems: "flex-start" }}>
              {/* Node */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 120 }}>
                {/* Dot */}
                <div style={{
                  width: isLast ? 14 : 10, height: isLast ? 14 : 10,
                  borderRadius: "50%", background: isLast ? C.orange : C.gray300,
                  border: `2px solid ${isLast ? C.orange : C.gray200}`,
                  boxShadow: isLast ? `0 0 0 4px ${C.orangeLight}` : "none",
                  marginBottom: 6, position: "relative", zIndex: 1,
                }} />
                {/* Price */}
                <span style={{ fontFamily: "monospace", fontWeight: isLast ? 800 : 600, fontSize: isLast ? 14 : 12, color: isLast ? C.orange : C.gray600 }}>
                  {fmt(h.final_price)}
                </span>
                {isLast && <span style={{ fontSize: 9, fontWeight: 700, color: C.orange, background: C.orangeLight, border: `1px solid ${C.orangeBorder}`, padding: "1px 6px", borderRadius: 20, marginTop: 2 }}>CURRENT</span>}
                {/* Date */}
                <span style={{ fontSize: 10, color: C.gray400, marginTop: 4 }}>{fmtShortDate(h.effective_from)}</span>
                {h.notes && <span style={{ fontSize: 9, color: C.gray400, fontStyle: "italic", maxWidth: 100, textAlign: "center", marginTop: 2 }}>{h.notes}</span>}
                {/* Delete */}
                <button onClick={() => onDelete(h.id)} style={{ marginTop: 4, background: "none", border: "none", cursor: "pointer", color: C.gray300, fontSize: 12, padding: "2px 4px", borderRadius: 4, fontFamily: "inherit" }}
                  onMouseEnter={e => e.target.style.color = C.red}
                  onMouseLeave={e => e.target.style.color = C.gray300}
                  title="Remove entry">🗑</button>
              </div>

              {/* Connector line + delta */}
              {!isLast && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 6, flex: 1, minWidth: 60 }}>
                  <div style={{ height: 2, width: "100%", background: C.gray200, borderRadius: 1, marginBottom: 4 }} />
                  {(() => {
                    const next = histories[i + 1];
                    const delta = (next?.final_price || 0) - (h.final_price || 0);
                    if (delta === 0) return null;
                    return <span style={{ fontSize: 10, fontWeight: 700, color: delta > 0 ? C.red : C.green }}>
                      {delta > 0 ? "↑" : "↓"}{fmt(Math.abs(delta))}
                    </span>;
                  })()}
                </div>
              )}
            </div>
          );
        })}

        {/* Add button at end */}
        <div style={{ display: "flex", alignItems: "center", marginLeft: 8, marginTop: 2 }}>
          <button onClick={onAdd} style={{ width: 28, height: 28, borderRadius: "50%", border: `2px dashed ${C.gray300}`, background: C.white, cursor: "pointer", color: C.gray400, fontSize: 16, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit" }}
            title="Add price entry">+</button>
        </div>
      </div>
    </div>
  );
}

// ── add price history inline form ─────────────────────────────────────────────
function AddHistoryForm({ parentId, onSaved, onCancel }) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ effective_from: today, item_price: "", tax_percent: "0", packaging_cost: "0", notes: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const preview = calcFinal(form.item_price, form.tax_percent, form.packaging_cost);

  const save = async () => {
    if (!form.item_price || parseFloat(form.item_price) <= 0) return setErr("Item price required.");
    if (!form.effective_from) return setErr("Effective date required.");
    setSaving(true); setErr(null);
    const res = await fetch(`${API}/parent-prices/${encodeURIComponent(parentId)}/price-history/`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, final_price: preview.toFixed(2) }),
    });
    setSaving(false);
    if (res.ok) onSaved();
    else { const e = await res.json(); setErr(Object.values(e).flat().join(" ")); }
  };

  return (
    <div style={{ background: "#F0F7FF", border: "1px solid #BFDBFE", borderRadius: 8, padding: "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: C.blue, textTransform: "uppercase", letterSpacing: "0.05em" }}>New Price Entry</p>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: C.gray500 }}>Final: <strong style={{ fontFamily: "monospace", color: C.orange }}>{fmt(preview)}</strong></span>
          <button onClick={onCancel} style={btn("ghost", "sm")}>Cancel</button>
          <button onClick={save} disabled={saving} style={btn("primary", "sm")}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
      <PriceFields form={form} setForm={setForm} cols="1fr 1fr 1fr 1fr 2fr" showNotes />
      {err && <p style={{ color: C.red, fontSize: 12, marginTop: 6 }}>{err}</p>}
    </div>
  );
}

// ── SKU autocomplete dropdown ─────────────────────────────────────────────────
function SkuDropdown({ parentId, onSelect, unlinked = [] }) {
  const [q, setQ] = useState(""); const [open, setOpen] = useState(false);
  const ref = useRef();

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, []);

  const sorted = nameSuggestions(parentId, unlinked.filter(s => !q || s.sku_id.toLowerCase().includes(q.toLowerCase())));
  const words = parentId.toLowerCase().split(/[_\-\s]+/).filter(w => w.length > 2);
  const isSugg = id => words.some(w => id.toLowerCase().includes(w));

  return (
    <div ref={ref} style={{ position: "relative", flex: 1, maxWidth: 300 }}>
      <input value={q} onChange={e => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        placeholder="Type to search unlinked SKUs…" style={{ ...S.inp, fontSize: 12 }} />
      {open && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 300, background: C.white, border: `1px solid ${C.border}`, borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", maxHeight: 220, overflowY: "auto" }}>
          {sorted.length === 0
            ? <div style={{ padding: "12px 14px", fontSize: 12, color: C.gray400 }}>No unlinked SKUs</div>
            : sorted.map(s => (
              <div key={s.id ?? s.sku_id} onMouseDown={() => { onSelect(s.sku_id); setQ(""); setOpen(false); }}
                style={{ padding: "8px 14px", cursor: "pointer", fontSize: 12, display: "flex", justifyContent: "space-between", borderBottom: `1px solid ${C.gray100}` }}
                onMouseEnter={e => e.currentTarget.style.background = C.orangeLight}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
              >
                <span style={{ fontFamily: "monospace", fontWeight: 600, color: isSugg(s.sku_id) ? C.green : C.orange }}>
                  {isSugg(s.sku_id) && "★ "}{s.sku_id}
                </span>
                <span style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11 }}>
                  {s.order_count > 0 && <span style={{ color: C.gray400 }}>📦 {s.order_count}</span>}
                  {s.has_price
                    ? <span style={{ color: C.gray400 }}>{fmt(s.final_price)}</span>
                    : <span style={{ color: C.green, fontWeight: 700, fontSize: 9, background: C.greenLight, border: `1px solid ${C.greenBorder}`, padding: "1px 5px", borderRadius: 10 }}>NEW</span>}
                </span>
              </div>
            ))
          }
        </div>
      )}
    </div>
  );
}

// ── create child SKU form ─────────────────────────────────────────────────────
function CreateChildForm({ parentId, parentPrice, onSaved, onCancel }) {
  const [form, setForm] = useState({ sku_id: "", item_price: String(parentPrice?.item_price || ""), tax_percent: String(parentPrice?.tax_percent || "0"), packaging_cost: String(parentPrice?.packaging_cost || "0") });
  const [saving, setSaving] = useState(false); const [err, setErr] = useState(null);
  const preview = calcFinal(form.item_price, form.tax_percent, form.packaging_cost);

  const save = async () => {
    if (!form.sku_id.trim()) return setErr("SKU ID required.");
    if (parseFloat(form.item_price) <= 0) return setErr("Price required.");
    setSaving(true); setErr(null);
    const res = await fetch(`${API}/final-prices/`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, parent: parentId, final_price: preview.toFixed(2) }),
    });
    setSaving(false);
    if (res.ok) onSaved();
    else { const e = await res.json(); setErr(Object.values(e).flat().join(" ")); }
  };

  return (
    <div style={{ background: C.greenLight, border: `1px solid ${C.greenBorder}`, borderRadius: 8, padding: "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: C.green, textTransform: "uppercase", letterSpacing: "0.05em" }}>Create New Child SKU</p>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: C.gray500 }}>Final: <strong style={{ fontFamily: "monospace", color: C.green }}>{fmt(preview)}</strong></span>
          <button onClick={onCancel} style={btn("ghost", "sm")}>Cancel</button>
          <button onClick={save} disabled={saving} style={btn("success", "sm")}>{saving ? "Saving…" : "Create"}</button>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 8 }}>
        <div>
          <label style={{ ...S.label, fontSize: 10 }}>SKU ID *</label>
          <input value={form.sku_id} onChange={e => setForm(f => ({ ...f, sku_id: e.target.value }))} placeholder="e.g. BOTTLE-RED-S" style={{ ...S.inp, fontSize: 12 }} />
        </div>
        {[["Item Price (₹)", "item_price"], ["Tax %", "tax_percent"], ["Packaging (₹)", "packaging_cost"]].map(([label, key]) => (
          <div key={key}>
            <label style={{ ...S.label, fontSize: 10 }}>{label}</label>
            <input type="number" step="0.01" value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} style={{ ...S.inp, fontSize: 12 }} />
          </div>
        ))}
      </div>
      {err && <p style={{ color: C.red, fontSize: 12, marginTop: 6 }}>{err}</p>}
    </div>
  );
}

// ── parent card ───────────────────────────────────────────────────────────────
function ParentCard({ parent, onRefresh, notify, onLink, dragging, unlinked = [], onOptOut }) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState(null); // null | "history" | "link" | "create" | "edit" | "suggest"
  const [dragOver, setDragOver] = useState(false);
  const [editForm, setEditForm] = useState({ item_price: String(parent.item_price || ""), tax_percent: String(parent.tax_percent || "0"), packaging_cost: String(parent.packaging_cost || "0") });
  const [renameValue, setRenameValue] = useState(parent.item_id);
  const [renameErr, setRenameErr] = useState("");
  const [renaming, setRenaming] = useState(false);

  // Children and history arrive only when the card is opened. The list endpoint
  // used to ship both for every parent, which cost 181 queries to draw a page
  // where almost every card stays shut.
  const [children, setChildren] = useState(null);      // null = not fetched yet
  const [histories, setHistories] = useState(null);
  const [detailErr, setDetailErr] = useState(false);
  const [suggestions, setSuggestions] = useState(null);
  const [suggestBusy, setSuggestBusy] = useState(false);
  // The price-sheet builder: which children are ticked, and the prices to write.
  const [sheetPick, setSheetPick] = useState({});   // sku_id -> true
  const [sheetPrice, setSheetPrice] = useState({ msp: "", wdrp: "", mrp: "" });
  const [sheetBusy, setSheetBusy] = useState(false);

  // Counts come from the list payload, so the header is right before anything
  // is fetched; once loaded the fetched rows are the truth.
  const childCount   = children ? children.length : (parent.sku_count ?? 0);
  const historyCount = histories ? histories.length : (parent.history_count ?? 0);
  const hasHistory   = historyCount > 0;
  const latestEntry  = histories && histories.length ? histories[histories.length - 1] : null;

  const loadDetail = useCallback(async () => {
    const id = encodeURIComponent(parent.item_id);
    setDetailErr(false);
    try {
      const [kr, hr] = await Promise.all([
        fetch(`${API}/parent-prices/${id}/children/`),
        fetch(`${API}/parent-prices/${id}/price-history/`),
      ]);
      if (!kr.ok) { setDetailErr(true); return; }
      const kd = await kr.json();
      setChildren(kd.results || []);
      if (hr.ok) {
        const hd = await hr.json();
        setHistories(Array.isArray(hd) ? hd : (hd.results || []));
      } else setHistories([]);
    } catch { setDetailErr(true); }
  }, [parent.item_id]);

  useEffect(() => {
    if (open && children === null && !detailErr) loadDetail();
  }, [open, children, detailErr, loadDetail]);

  // Re-pull this card only — a link or unlink here shouldn't redraw the page.
  const reloadDetail = useCallback(() => {
    setChildren(null); setHistories(null); setSuggestions(null);
  }, []);

  const loadSuggestions = useCallback(async () => {
    setSuggestBusy(true);
    try {
      const r = await fetch(`${API}/parent-prices/${encodeURIComponent(parent.item_id)}/suggestions/`);
      setSuggestions(r.ok ? ((await r.json()).results || []) : []);
    } catch { setSuggestions([]); }
    finally { setSuggestBusy(false); }
  }, [parent.item_id]);

  // Price trajectory summary text: "₹40 → ₹45 → ₹50"
  const trajectory = histories && histories.length > 1
    ? histories.map(h => fmt(h.final_price)).join(" → ")
    : null;

  const toggle = (p) => setPanel(prev => prev === p ? null : p);

  const deleteHistory = async pk => {
    if (!window.confirm("Remove this price entry?")) return;
    const r = await fetch(`${API}/parent-prices/${encodeURIComponent(parent.item_id)}/price-history/${pk}/`, { method: "DELETE" });
    if (r.ok) { notify("ok", "Price entry removed."); onRefresh(); }
  };

  const linkSku = async skuId => {
    await onLink(skuId, parent.item_id);
    reloadDetail();
    setPanel(null);
  };

  /** Link straight from a suggestion, without leaving the card. */
  const acceptSuggestion = async skuId => {
    await onLink(skuId, parent.item_id);
    setSuggestions(list => (list || []).filter(x => x.sku_id !== skuId));
    setChildren(null); setHistories(null);
  };

  /**
   * Build the Meesho price sheet for the ticked SKUs and download it.
   *
   * Sent as a POST because the prices are per SKU; the response is the xlsx
   * itself, so it is read as a blob rather than JSON.
   */
  const downloadSheet = async () => {
    const rows = (children || [])
      .filter((ch) => sheetPick[ch.sku_id] && ch.meesho?.length)
      .map((ch) => ({
        sku_id: ch.sku_id,
        msp: sheetPrice.msp,
        wdrp: sheetPrice.wdrp || undefined,
        mrp: sheetPrice.mrp || undefined,
      }));
    if (!rows.length) { notify("err", "Tick at least one SKU that has a Meesho catalog row."); return; }
    if (!String(sheetPrice.msp).trim()) { notify("err", "Enter the new selling price."); return; }

    setSheetBusy(true);
    try {
      const res = await fetch(`${API}/parent-prices/${encodeURIComponent(parent.item_id)}/price-sheet/`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        notify("err", d.error || "Could not build the sheet.");
        return;
      }
      const written = res.headers.get("X-Rows-Written");
      const skipped = Number(res.headers.get("X-Rows-Skipped") || 0);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `msp_${parent.item_id.replace(/[^A-Za-z0-9._-]+/g, "_")}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      notify("ok", `Sheet ready — ${written} row(s)` + (skipped ? `, ${skipped} skipped.` : "."));
    } catch { notify("err", "Could not build the sheet."); }
    finally { setSheetBusy(false); }
  };

  /** "Not this one" — take the SKU out of the linking flows for good. */
  const rejectSuggestion = async skuId => {
    const ok = await onOptOut?.(skuId, true);
    if (ok) setSuggestions(list => (list || []).filter(x => x.sku_id !== skuId));
  };

  // ── drop-target handlers (drag a SKU chip from the tray onto this card) ──
  const canDrop = !!dragging;
  const handleDragOver = e => {
    if (!dragging) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!dragOver) setDragOver(true);
  };
  const handleDragLeave = e => {
    // only clear when leaving the card, not when moving over a child element
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDragOver(false);
  };
  const handleDrop = e => {
    e.preventDefault();
    setDragOver(false);
    const skuId = e.dataTransfer.getData("text/plain");
    if (skuId) onLink(skuId, parent.item_id);
  };

  const unlinkSku = async skuId => {
    if (!window.confirm(`Unlink ${skuId}?`)) return;
    const r = await fetch(`${API}/final-prices/${encodeURIComponent(skuId)}/`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parent: null }),
    });
    if (r.ok) { notify("ok", `${skuId} unlinked.`); reloadDetail(); onRefresh(); }
    else notify("err", "Unlink failed.");
  };

  const deleteParent = async () => {
    if (!window.confirm(`Delete parent "${parent.item_id}" and unlink all ${childCount} SKUs?`)) return;
    const r = await fetch(`${API}/parent-prices/${encodeURIComponent(parent.item_id)}/`, { method: "DELETE" });
    if (r.ok) { notify("ok", `${parent.item_id} deleted.`); onRefresh(); }
    else notify("err", "Delete failed.");
  };

  const saveEdit = async () => {
    const preview = calcFinal(editForm.item_price, editForm.tax_percent, editForm.packaging_cost);
    const r = await fetch(`${API}/parent-prices/${encodeURIComponent(parent.item_id)}/`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...editForm, final_price: preview.toFixed(2) }),
    });
    if (r.ok) { notify("ok", "Parent updated."); setPanel(null); onRefresh(); }
    else notify("err", "Update failed.");
  };

  const saveRename = async () => {
    const next = renameValue.trim();
    if (!next) { setRenameErr("Enter a name."); return; }
    if (next === parent.item_id) { setPanel(null); return; }
    setRenaming(true); setRenameErr("");
    try {
      const r = await fetch(`${API}/parent-prices/${encodeURIComponent(parent.item_id)}/`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: next }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        notify("ok", `Renamed to "${next}".`);
        setPanel(null);
        onRefresh();
      } else {
        // Most likely the unique_together(business, item_id) constraint —
        // surface whatever the server actually said rather than a generic message.
        setRenameErr(d.item_id?.[0] || d.error || d.detail || "Could not rename — that name may already be in use.");
      }
    } catch {
      setRenameErr("Network error.");
    } finally {
      setRenaming(false);
    }
  };

  return (
    <div
      onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
      style={{
        background: dragOver ? C.greenLight : C.white,
        border: `${dragOver ? 2 : 1}px ${canDrop ? "dashed" : "solid"} ${dragOver ? C.green : canDrop ? C.orangeBorder : open ? "#BFDBFE" : C.border}`,
        borderRadius: 12, overflow: "hidden",
        boxShadow: dragOver ? `0 0 0 4px ${C.greenLight}` : "0 1px 4px rgba(0,0,0,0.05)",
        transition: "border-color 0.15s, background 0.15s",
      }}>

      {/* Drop hint overlay while a SKU is being dragged */}
      {dragOver && (
        <div style={{ padding: "8px 16px", background: C.green, color: C.white, fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
          🔗 Drop to link into <span style={{ fontFamily: "monospace" }}>{parent.item_id}</span>
        </div>
      )}

      {/* ── Card header ───────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", cursor: "pointer" }}
        onClick={() => { setOpen(o => !o); if (!open) setPanel(null); }}>

        {/* Chevron */}
        <span style={{ fontSize: 12, color: C.gray400, minWidth: 14 }}>{open ? "▼" : "▶"}</span>

        {/* Parent ID */}
        <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: C.orange, background: C.orangeLight, border: `1px solid ${C.orangeBorder}`, padding: "3px 10px", borderRadius: 6, whiteSpace: "nowrap" }}>
          📦 {parent.item_id}
        </span>

        {/* Current price — prominent */}
        <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 15, color: C.gray800, whiteSpace: "nowrap" }}>
          {fmt(parent.final_price)}
        </span>

        {/* Price trajectory */}
        {trajectory && (
          <span style={{ fontSize: 11, color: C.gray400, fontFamily: "monospace", whiteSpace: "nowrap" }}>
            ({trajectory})
          </span>
        )}

        {latestEntry && (
          <span style={{ fontSize: 11, color: C.gray400, whiteSpace: "nowrap" }}>
            since {fmtShortDate(latestEntry.effective_from)}
          </span>
        )}

        <div style={{ flex: 1 }} />

        {/* Badges */}
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ background: C.blueLight, color: C.blue, border: "1px solid #BFDBFE", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
            {childCount} SKU{childCount !== 1 ? "s" : ""}
          </span>
          {hasHistory
            ? <span style={{ background: C.orangeLight, color: C.orange, border: `1px solid ${C.orangeBorder}`, padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
                {historyCount} price {historyCount === 1 ? "entry" : "entries"}
              </span>
            : <span style={{ background: C.gray100, color: C.gray400, border: `1px solid ${C.gray200}`, padding: "3px 10px", borderRadius: 20, fontSize: 11, whiteSpace: "nowrap" }}>
                no history
              </span>
          }
        </div>

        {/* Quick-action buttons — visible in header, stop propagation */}
        {!open && (
          <div style={{ display: "flex", gap: 4 }} onClick={e => e.stopPropagation()}>
            <button onClick={() => { setOpen(true); setTimeout(() => setPanel("history"), 50); }}
              style={{ ...btn("secondary", "sm"), padding: "4px 10px", fontSize: 11 }}>+ Price</button>
            <button onClick={() => { setOpen(true); setTimeout(() => setPanel("create"), 50); }}
              style={{ ...btn("success", "sm"), padding: "4px 10px", fontSize: 11 }}>+ SKU</button>
          </div>
        )}
      </div>

      {/* ── Expanded body ─────────────────────────────────────────────────────── */}
      {open && (
        <div style={{ borderTop: `1px solid ${C.gray100}` }}>

          {/* Action bar */}
          <div style={{ display: "flex", gap: 6, padding: "10px 16px", background: C.gray50, flexWrap: "wrap" }}>
            <button onClick={() => toggle("history")} style={{ ...btn(panel === "history" ? "secondary" : "ghost", "sm"), fontSize: 11 }}>
              {panel === "history" ? "✕ Cancel" : "📅 Add Price Entry"}
            </button>
            <button onClick={() => toggle("link")} style={{ ...btn(panel === "link" ? "secondary" : "ghost", "sm"), fontSize: 11 }}>
              {panel === "link" ? "✕ Cancel" : "🔗 Link Existing SKU"}
            </button>
            <button
              onClick={() => { toggle("suggest"); if (suggestions === null) loadSuggestions(); }}
              style={{ ...btn(panel === "suggest" ? "ghostOrange" : "ghost", "sm"), fontSize: 11 }}>
              {panel === "suggest" ? "✕ Cancel" : "✨ Suggestions"}
            </button>
            <button
              onClick={() => {
                toggle("sheet");
                // Default to everything that can actually go in the sheet.
                if (panel !== "sheet" && children) {
                  setSheetPick(Object.fromEntries(
                    children.filter((ch) => ch.meesho?.length).map((ch) => [ch.sku_id, true])));
                }
              }}
              style={{ ...btn(panel === "sheet" ? "secondary" : "ghost", "sm"), fontSize: 11 }}>
              {panel === "sheet" ? "✕ Cancel" : "📄 Price Sheet"}
            </button>
            <button onClick={() => toggle("create")} style={{ ...btn(panel === "create" ? "success" : "ghost", "sm"), fontSize: 11 }}>
              {panel === "create" ? "✕ Cancel" : "+ Create New SKU"}
            </button>
            <div style={{ flex: 1 }} />
            <button onClick={() => { setRenameValue(parent.item_id); setRenameErr(""); toggle("rename"); }}
              style={{ ...btn(panel === "rename" ? "ghostOrange" : "ghost", "sm"), fontSize: 11 }}>
              {panel === "rename" ? "✕ Cancel" : "✎ Rename"}
            </button>
            <button onClick={() => toggle("edit")} style={{ ...btn(panel === "edit" ? "ghostOrange" : "ghost", "sm"), fontSize: 11 }}>
              {panel === "edit" ? "✕ Cancel" : "✏️ Edit Price"}
            </button>
            <button onClick={deleteParent} style={{ ...btn("danger", "sm"), fontSize: 11 }}>🗑 Delete</button>
          </div>

          {/* Panel area */}
          {panel && (
            <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.gray100}` }}>
              {panel === "rename" && (
                <div style={{ background: C.orangeLight, border: `1px solid ${C.orangeBorder}`, borderRadius: 8, padding: "12px 14px" }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: C.orange, textTransform: "uppercase", marginBottom: 10 }}>
                    Rename Parent SKU
                  </p>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      <input value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                        style={{ ...S.inp, fontSize: 13, fontFamily: "monospace" }}
                        onKeyDown={(e) => { if (e.key === "Enter") saveRename(); }} />
                      {renameErr && <p style={{ color: C.red, fontSize: 12, marginTop: 6 }}>{renameErr}</p>}
                      <p style={{ fontSize: 11, color: C.gray500, marginTop: 6 }}>
                        All linked child SKUs stay linked — only the parent's name changes. Anything that
                        already recorded the old name in a past export or log keeps showing it as it was.
                      </p>
                    </div>
                    <button onClick={saveRename} disabled={renaming} style={btn("success", "sm")}>
                      {renaming ? "Saving…" : "Save"}
                    </button>
                  </div>
                </div>
              )}
              {panel === "history" && (
                <AddHistoryForm parentId={parent.item_id}
                  onSaved={() => { setPanel(null); reloadDetail(); onRefresh(); notify("ok", "Price entry added."); }}
                  onCancel={() => setPanel(null)} />
              )}
              {panel === "link" && (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <p style={{ fontSize: 12, color: C.gray600, whiteSpace: "nowrap" }}>★ = name-match suggestions · or drag a SKU from the tray above</p>
                  <SkuDropdown parentId={parent.item_id} onSelect={linkSku} unlinked={unlinked} />
                </div>
              )}
              {panel === "suggest" && (
                <div>
                  <p style={{ fontSize: 11.5, color: C.gray600, marginBottom: 9, lineHeight: 1.6 }}>
                    Unlinked SKUs whose words match this group — scored against the parent
                    name <em>and</em> the SKUs already in it. <strong>Not this one</strong> takes
                    a SKU out of every linking list for good.
                  </p>
                  {suggestBusy && suggestions === null ? (
                    <p style={{ fontSize: 12, color: C.gray400 }}>Looking for matches…</p>
                  ) : (suggestions || []).length === 0 ? (
                    <p style={{ fontSize: 12, color: C.gray400, fontStyle: "italic" }}>
                      Nothing unlinked looks like it belongs here.
                    </p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {suggestions.map(sg => (
                        <div key={sg.sku_id} style={{
                          display: "flex", alignItems: "center", gap: 9, padding: "7px 10px",
                          border: `1px solid ${C.border}`, borderRadius: 9, background: C.white }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontFamily: "monospace", fontSize: 12.5, fontWeight: 700,
                              color: sg.has_price ? C.orange : C.green, wordBreak: "break-all" }}>
                              {sg.sku_id}
                            </div>
                            <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 2,
                              fontSize: 10.5, color: C.gray400 }}>
                              <span>match {Math.round(sg.score * 100)}%</span>
                              {sg.matched?.length > 0 && <span>· {sg.matched.join(", ")}</span>}
                              {sg.order_count > 0 && <span>· 📦 {sg.order_count}</span>}
                              {!sg.has_price && <span style={{ color: C.green, fontWeight: 700 }}>· new</span>}
                            </div>
                          </div>
                          <button onClick={() => acceptSuggestion(sg.sku_id)}
                            style={{ ...btn("secondary", "sm"), padding: "4px 10px", fontSize: 11 }}>
                            Link
                          </button>
                          <button onClick={() => rejectSuggestion(sg.sku_id)}
                            title="Never link this SKU to any parent"
                            style={{ ...btn("ghost", "sm"), padding: "4px 10px", fontSize: 11, color: C.gray500 }}>
                            Not this one
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {panel === "sheet" && (
                <div>
                  <p style={{ fontSize: 11.5, color: C.gray600, marginBottom: 10, lineHeight: 1.6 }}>
                    Tick the SKUs, set the new price, and download a sheet you can upload
                    straight to Meesho. Catalog id, product id and variation are filled in
                    from your inventory — you only type the price.
                  </p>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8, marginBottom: 10 }}>
                    {[["New selling price (MSP) *", "msp"], ["Wrong/defective (WDRP)", "wdrp"], ["MRP (optional)", "mrp"]].map(([label, key]) => (
                      <div key={key}>
                        <label style={{ ...S.label, fontSize: 10 }}>{label}</label>
                        <input type="number" step="0.01" value={sheetPrice[key]}
                          onChange={(e) => setSheetPrice((f) => ({ ...f, [key]: e.target.value }))}
                          style={{ ...S.inp, fontSize: 12 }} />
                      </div>
                    ))}
                  </div>

                  {children === null ? (
                    <p style={{ fontSize: 12, color: C.gray400 }}>Loading SKUs…</p>
                  ) : (
                    <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden", marginBottom: 10 }}>
                      {children.map((ch, i) => {
                        const ready = !!ch.meesho?.length;
                        return (
                          <label key={ch.sku_id} style={{
                            display: "flex", alignItems: "center", gap: 8, padding: "7px 10px",
                            background: i % 2 ? C.gray50 : C.white, borderBottom: `1px solid ${C.gray100}`,
                            cursor: ready ? "pointer" : "not-allowed", opacity: ready ? 1 : 0.55 }}>
                            <input type="checkbox" disabled={!ready}
                              checked={!!sheetPick[ch.sku_id]}
                              onChange={() => setSheetPick((p) => ({ ...p, [ch.sku_id]: !p[ch.sku_id] }))} />
                            <span style={{ flex: 1, minWidth: 0, fontFamily: "monospace", fontSize: 11.5,
                              fontWeight: 700, color: C.gray800, wordBreak: "break-all" }}>
                              {ch.sku_id}
                            </span>
                            {ready ? (
                              <span style={{ fontSize: 10.5, color: C.gray400, whiteSpace: "nowrap" }}>
                                catalog {ch.meesho[0].catalog_id}
                                {ch.meesho.length > 1 ? ` · ${ch.meesho.length} variations` : ""}
                              </span>
                            ) : (
                              <span style={{ fontSize: 10.5, color: C.amber, fontWeight: 700, whiteSpace: "nowrap" }}>
                                not in Meesho inventory
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <button onClick={downloadSheet} disabled={sheetBusy} style={btn("primary", "sm")}>
                      {sheetBusy ? "Building…" : "⬇ Download price sheet"}
                    </button>
                    <button onClick={() => setSheetPick({})} style={btn("ghost", "sm")}>Clear</button>
                    <span style={{ fontSize: 11, color: C.gray400 }}>
                      {Object.values(sheetPick).filter(Boolean).length} selected
                    </span>
                  </div>
                </div>
              )}
              {panel === "create" && (
                <CreateChildForm parentId={parent.item_id} parentPrice={parent}
                  onSaved={() => { setPanel(null); reloadDetail(); onRefresh(); notify("ok", "Child SKU created."); }}
                  onCancel={() => setPanel(null)} />
              )}
              {panel === "edit" && (
                <div style={{ background: C.amberLight, border: "1px solid #FDE68A", borderRadius: 8, padding: "12px 14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: C.amber, textTransform: "uppercase" }}>Direct Price Override</p>
                    <div style={{ display: "flex", gap: 6 }}>
                      <span style={{ fontSize: 12, color: C.gray500 }}>Preview: <strong style={{ fontFamily: "monospace", color: C.orange }}>{fmt(calcFinal(editForm.item_price, editForm.tax_percent, editForm.packaging_cost))}</strong></span>
                      <button onClick={saveEdit} style={btn("success", "sm")}>Save</button>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                    {[["Item Price (₹)", "item_price"], ["Tax %", "tax_percent"], ["Packaging (₹)", "packaging_cost"]].map(([label, key]) => (
                      <div key={key}>
                        <label style={{ ...S.label, fontSize: 10 }}>{label}</label>
                        <input type="number" step="0.01" value={editForm[key]} onChange={e => setEditForm(f => ({ ...f, [key]: e.target.value }))} style={{ ...S.inp, fontSize: 12 }} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Price timeline */}
          <div style={{ padding: "14px 16px", borderBottom: `1px solid ${C.gray100}` }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: C.gray500, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>Price History</p>
            {histories === null
              ? <p style={{ fontSize: 12, color: C.gray400 }}>Loading price history…</p>
              : <PriceTimeline histories={histories} onDelete={deleteHistory} onAdd={() => setPanel("history")} />}
          </div>

          {/* Child SKUs — compact table */}
          <div style={{ padding: "14px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: C.gray500, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Child SKUs
                <span style={{ marginLeft: 8, background: C.blueLight, color: C.blue, border: "1px solid #BFDBFE", padding: "1px 8px", borderRadius: 20, fontWeight: 700, fontSize: 10, textTransform: "none" }}>
                  {childCount}
                </span>
              </p>
            </div>

            {children === null ? (
              <p style={{ fontSize: 12, color: C.gray400 }}>Loading child SKUs…</p>
            ) : childCount > 0 ? (
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={{ ...S.th, fontSize: 10 }}>SKU ID</th>
                      <th style={{ ...S.th, fontSize: 10, textAlign: "right" }}>Orders</th>
                      <th style={{ ...S.th, fontSize: 10, textAlign: "right" }}>Item Price</th>
                      <th style={{ ...S.th, fontSize: 10, textAlign: "right" }}>Tax %</th>
                      <th style={{ ...S.th, fontSize: 10, textAlign: "right" }}>Final Price</th>
                      <th style={{ ...S.th, fontSize: 10, width: 60 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {children.map((ch, i) => (
                      <tr key={ch.id ?? ch.sku_id} style={{ background: i % 2 === 0 ? C.white : C.gray50 }}>
                        <td style={S.td}>
                          <span style={{ fontFamily: "monospace", fontSize: 11, color: C.blue, fontWeight: 600, background: C.blueLight, padding: "2px 7px", borderRadius: 4, border: "1px solid #BFDBFE" }}>
                            ↳ {ch.sku_id}
                          </span>
                        </td>
                        <td style={{ ...S.td, textAlign: "right", color: ch.order_count ? C.gray600 : C.gray300, fontFamily: "monospace" }}>
                          {ch.order_count || 0}
                        </td>
                        {/* A child can carry its own price; falling back to the
                            parent's is what happens when it has never been set. */}
                        <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", color: C.gray600 }}>{fmt(ch.item_price ?? parent.item_price)}</td>
                        <td style={{ ...S.td, textAlign: "right", color: C.gray500 }}>{ch.tax_percent ?? parent.tax_percent ?? 0}%</td>
                        <td style={{ ...S.td, textAlign: "right" }}>
                          <span style={{ fontFamily: "monospace", fontWeight: 700, color: C.orange }}>{fmt(ch.final_price ?? parent.final_price)}</span>
                        </td>
                        <td style={{ ...S.td, textAlign: "center" }}>
                          <button onClick={() => unlinkSku(ch.sku_id)} style={{ background: "none", border: "none", cursor: "pointer", color: C.gray300, fontSize: 14, padding: "2px 6px", borderRadius: 4 }}
                            onMouseEnter={e => e.target.style.color = C.red}
                            onMouseLeave={e => e.target.style.color = C.gray300}
                            title="Unlink">✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p style={{ fontSize: 12, color: C.gray400, fontStyle: "italic" }}>
                No child SKUs linked — use "Link Existing SKU" or "Create New SKU" above.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── add parent form ───────────────────────────────────────────────────────────
function AddParentForm({ onSaved, onCancel, notify }) {
  const [form, setForm] = useState({ item_id: "", item_price: "", tax_percent: "0", packaging_cost: "0" });
  const [saving, setSaving] = useState(false); const [err, setErr] = useState(null);
  const preview = calcFinal(form.item_price, form.tax_percent, form.packaging_cost);

  const save = async () => {
    if (!form.item_id.trim()) return setErr("Parent ID required.");
    if (parseFloat(form.item_price) <= 0) return setErr("Price required.");
    setSaving(true); setErr(null);
    const res = await fetch(`${API}/parent-prices/`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, final_price: preview.toFixed(2) }),
    });
    setSaving(false);
    if (res.ok) { notify("ok", `"${form.item_id}" created.`); onSaved(); }
    else { const e = await res.json(); setErr(Object.values(e).flat().join(" ")); }
  };

  return (
    <div style={{ background: C.white, border: `2px solid ${C.orange}`, borderRadius: 12, padding: "18px 20px", boxShadow: "0 4px 16px rgba(232,81,10,0.12)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <p style={{ fontSize: 14, fontWeight: 700, color: C.gray800 }}>➕ New Parent SKU</p>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, color: C.gray500 }}>Final price: <strong style={{ fontFamily: "monospace", color: C.orange, fontSize: 16 }}>{fmt(preview)}</strong></span>
          <button onClick={onCancel} style={btn("ghost")}>Cancel</button>
          <button onClick={save} disabled={saving} style={btn("primary")}>{saving ? "Creating…" : "Create Parent"}</button>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 12 }}>
        <div>
          <label style={S.label}>Parent ID *</label>
          <input value={form.item_id} onChange={e => setForm(f => ({ ...f, item_id: e.target.value }))}
            placeholder="e.g. copper_bottle" style={S.inp} />
        </div>
        {[["Item Price (₹) *", "item_price"], ["Tax %", "tax_percent"], ["Packaging (₹)", "packaging_cost"]].map(([label, key]) => (
          <div key={key}>
            <label style={S.label}>{label}</label>
            <input type="number" step="0.01" value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} style={S.inp} />
          </div>
        ))}
      </div>
      {err && <p style={{ color: C.red, fontSize: 12, marginTop: 8 }}>{err}</p>}
    </div>
  );
}

// ── draggable unlinked-SKU chip ───────────────────────────────────────────────
function SkuChip({ sku, dragging, onDragStart, onDragEnd }) {
  const isDragging = dragging === sku.sku_id;
  const isNew = !sku.has_price;
  return (
    <div
      draggable
      onDragStart={e => { e.dataTransfer.setData("text/plain", sku.sku_id); e.dataTransfer.effectAllowed = "move"; onDragStart(sku.sku_id); }}
      onDragEnd={onDragEnd}
      title={`Drag "${sku.sku_id}" onto a parent card to link it${sku.order_count ? ` · ${sku.order_count} order(s)` : ""}`}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "5px 10px", borderRadius: 8, cursor: "grab",
        background: isDragging ? C.orange : C.white,
        border: `1px solid ${isNew ? C.greenBorder : C.orangeBorder}`,
        boxShadow: isDragging ? "0 4px 12px rgba(232,81,10,0.3)" : "0 1px 2px rgba(0,0,0,0.05)",
        opacity: isDragging ? 0.6 : 1,
        userSelect: "none", transition: "box-shadow 0.1s",
      }}>
      <span style={{ fontSize: 11, color: C.gray300 }}>⠿</span>
      <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 600, color: isDragging ? C.white : isNew ? C.green : C.orange }}>
        {sku.sku_id}
      </span>
      {isNew
        ? <span style={{ fontSize: 8, fontWeight: 800, color: C.white, background: C.green, padding: "1px 5px", borderRadius: 10, letterSpacing: "0.04em" }}>NEW</span>
        : <span style={{ fontSize: 10, fontFamily: "monospace", color: C.gray400 }}>{fmt(sku.final_price)}</span>}
      {sku.order_count > 0 && (
        <span style={{ fontSize: 10, color: isDragging ? C.white : C.gray400, whiteSpace: "nowrap" }}>📦 {sku.order_count}</span>
      )}
    </div>
  );
}

// ── unlinked-SKU tray — drag source for the drag-and-drop linking ─────────────
function UnlinkedSkuTray({ unlinked, dragging, setDragging }) {
  const [open, setOpen] = useState(true);
  const [q, setQ] = useState("");
  const [onlyNew, setOnlyNew] = useState(false);

  const filtered = unlinked.filter(s =>
    (!q || s.sku_id.toLowerCase().includes(q.toLowerCase())) &&
    (!onlyNew || !s.has_price)
  );
  const newCount = unlinked.filter(s => !s.has_price).length;

  return (
    <div style={{ background: "#FFFBF7", border: `1px solid ${C.orangeBorder}`, borderRadius: 12, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", cursor: "pointer", flexWrap: "wrap" }}
        onClick={() => setOpen(o => !o)}>
        <span style={{ fontSize: 12, color: C.gray400, minWidth: 14 }}>{open ? "▼" : "▶"}</span>
        <span style={{ fontSize: 13, fontWeight: 800, color: C.gray800 }}>🧲 Unlinked SKUs</span>
        <span style={{ background: C.orangeLight, color: C.orange, border: `1px solid ${C.orangeBorder}`, padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700 }}>
          {unlinked.length} available
        </span>
        {newCount > 0 && (
          <span style={{ background: C.greenLight, color: C.green, border: `1px solid ${C.greenBorder}`, padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700 }}>
            {newCount} new from orders
          </span>
        )}
        <span style={{ fontSize: 11, color: C.gray400 }}>— drag any chip onto a parent card below to link it</span>
      </div>

      {open && (
        <div style={{ padding: "0 16px 14px", borderTop: `1px solid ${C.orangeBorder}` }}>
          {/* Controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0", flexWrap: "wrap" }} onClick={e => e.stopPropagation()}>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter unlinked SKUs…"
              style={{ ...S.inp, maxWidth: 240, fontSize: 12 }} />
            {q && <button onClick={() => setQ("")} style={btn("ghost", "sm")}>✕</button>}
            {newCount > 0 && (
              <button onClick={() => setOnlyNew(v => !v)}
                style={{ ...btn(onlyNew ? "success" : "ghost", "sm"), fontSize: 11 }}>
                {onlyNew ? "✓ New-from-orders only" : "Show new-from-orders only"}
              </button>
            )}
            <span style={{ fontSize: 11, color: C.gray400 }}>{filtered.length} shown</span>
          </div>

          {/* Chips */}
          {filtered.length === 0 ? (
            <p style={{ fontSize: 12, color: C.gray400, fontStyle: "italic", padding: "8px 0" }}>
              {unlinked.length === 0 ? "🎉 Every SKU is linked to a parent." : "No SKUs match your filter."}
            </p>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, maxHeight: 200, overflowY: "auto", padding: 2 }}>
              {filtered.map(s => (
                <SkuChip key={s.id ?? s.sku_id} sku={s} dragging={dragging}
                  onDragStart={setDragging} onDragEnd={() => setDragging(null)} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── create a NEW parent group FROM an existing child SKU ──────────────────────
// Opens as a focused modal. Parent name defaults to the SKU id, pricing is
// pre-filled from the SKU's own price when it has one. On save the backend
// creates the parent and links this SKU to it in one atomic step.
function CreateParentFromSkuModal({ sku, onSaved, onCancel }) {
  const [form, setForm] = useState({
    parent_id: sku.sku_id,
    item_price: sku.item_price != null && sku.item_price !== "" ? String(sku.item_price) : "",
    tax_percent: "0",
    packaging_cost: "0",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const preview = calcFinal(form.item_price, form.tax_percent, form.packaging_cost);

  const set = (key, v) => setForm(f => ({ ...f, [key]: v }));

  const save = async () => {
    if (!form.parent_id.trim()) return setErr("Parent name is required.");
    if (!form.item_price || parseFloat(form.item_price) <= 0) return setErr("Item price is required.");
    setSaving(true); setErr(null);
    try {
      const res = await fetch(`${API}/parent-from-sku/`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku_id: sku.sku_id,
          parent_id: form.parent_id.trim(),
          item_price: form.item_price,
          tax_percent: form.tax_percent,
          packaging_cost: form.packaging_cost,
          final_price: preview.toFixed(2),
        }),
      });
      if (res.ok) { onSaved(form.parent_id.trim()); return; }
      const e = await res.json().catch(() => ({}));
      setErr(e.error || Object.values(e).flat().join(" ") || "Could not create parent.");
    } catch {
      setErr("Network error.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div onClick={onCancel} style={{
      position: "fixed", inset: 0, background: "rgba(15,12,24,0.45)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: C.white, borderRadius: 14, width: "min(560px, 100%)",
        boxShadow: "0 20px 60px rgba(0,0,0,0.3)", overflow: "hidden",
        border: `1px solid ${C.border}`,
      }}>
        {/* Header */}
        <div style={{ padding: "16px 20px", background: C.greenLight, borderBottom: `1px solid ${C.greenBorder}` }}>
          <p style={{ fontSize: 15, fontWeight: 800, color: C.gray900 }}>➕ New Parent from SKU</p>
          <p style={{ fontSize: 12, color: C.gray600, marginTop: 2 }}>
            Promote <span style={{ fontFamily: "monospace", fontWeight: 700, color: C.green }}>{sku.sku_id}</span> into a new parent group — it'll be linked automatically.
          </p>
        </div>

        {/* Body */}
        <div style={{ padding: "18px 20px" }}>
          <div style={{ marginBottom: 12 }}>
            <label style={S.label}>Parent Group Name *</label>
            <input value={form.parent_id} onChange={e => set("parent_id", e.target.value)}
              placeholder="e.g. copper_bottle" style={S.inp} />
            <p style={{ fontSize: 11, color: C.gray400, marginTop: 4 }}>Defaults to the SKU id — rename it to group more SKUs under this parent.</p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            {[["Item Price (₹) *", "item_price"], ["Tax %", "tax_percent"], ["Packaging (₹)", "packaging_cost"]].map(([label, key]) => (
              <div key={key}>
                <label style={{ ...S.label, fontSize: 10 }}>{label}</label>
                <input type="number" step="0.01" value={form[key]} onChange={e => set(key, e.target.value)} style={{ ...S.inp, fontSize: 12 }} />
              </div>
            ))}
          </div>
          {err && <p style={{ color: C.red, fontSize: 12, marginTop: 10 }}>{err}</p>}
        </div>

        {/* Footer */}
        <div style={{ padding: "14px 20px", borderTop: `1px solid ${C.gray100}`, display: "flex", alignItems: "center", justifyContent: "space-between", background: C.gray50 }}>
          <span style={{ fontSize: 13, color: C.gray500 }}>
            Final price: <strong style={{ fontFamily: "monospace", color: C.green, fontSize: 16 }}>{fmt(preview)}</strong>
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onCancel} style={btn("ghost", "md")}>Cancel</button>
            <button onClick={save} disabled={saving} style={btn("success", "md")}>{saving ? "Creating…" : "Create & Link"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── main tab ──────────────────────────────────────────────────────────────────
export function PricingTab() {
  const isMobile = useIsMobile();
  const [parents, setParents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState(null);
  const [missingSkus, setMissingSkus] = useState([]);
  const [showMissing, setShowMissing] = useState(false);
  const [unlinked, setUnlinked] = useState([]);
  const [showHidden, setShowHidden] = useState(false);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [dragging, setDragging] = useState(null);

  const [linkParentId, setLinkParentId] = useState("");
  const [linkQuery, setLinkQuery] = useState("");
  const [selectedUnlinked, setSelectedUnlinked] = useState(new Set());
  const [bulkLinking, setBulkLinking] = useState(false);
  const [newParentFor, setNewParentFor] = useState(null); // unlinked-SKU object → open "new parent from SKU" modal
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const notify = useCallback((type, text) => {
    setMsg({ type, text }); setTimeout(() => setMsg(null), 4000);
  }, []);

  // "Hidden" is the same list, filtered the other way — so a SKU you removed is
  // always one click from coming back rather than being lost.
  const loadUnlinked = useCallback(async () => {
    const r = await fetch(`${API}/final-prices/unlinked/${showHidden ? "?opted_out=1" : ""}`)
      .catch(() => null);
    if (r?.ok) {
      const d = await r.json();
      setUnlinked(d.results || []);
      setHiddenCount(d.hidden_count || 0);
    }
  }, [showHidden]);

  /** Take a SKU out of the linking lists, or put it back. */
  const setOptOut = useCallback(async (skuId, optOut) => {
    const r = await fetch(`${API}/sku-opt-out/`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sku_id: skuId, opt_out: optOut }),
    }).catch(() => null);
    const d = await r?.json().catch(() => ({}));
    if (!r?.ok) { notify("err", d?.error || `Could not update ${skuId}.`); return false; }
    notify("ok", optOut ? `${skuId} hidden — it won't be offered for linking.`
                        : `${skuId} is back in the list.`);
    loadUnlinked();
    return true;
  }, [notify, loadUnlinked]);

  // Searching is the server's job now: it matches parent ids *and* child SKUs,
  // and the browser no longer holds every child to filter on.
  const load = useCallback(async (term = "") => {
    const q = term.trim() ? `?search=${encodeURIComponent(term.trim())}` : "";
    const pr = await fetch(`${API}/parent-prices/${q}`);
    const pd = await pr.json();
    setParents(pd.results || []);
    setLoading(false);
  }, []);

  // This used to come off /profit/ — nearly four seconds of settlement maths to
  // produce a list of SKU names. Its own endpoint answers in ~70ms.
  const loadMissing = useCallback(async () => {
    const r = await fetch(`${API}/final-prices/unpriced/`).catch(() => null);
    if (r?.ok) { const d = await r.json(); setMissingSkus(d.results || []); }
  }, []);

  const refresh = useCallback(() => { load(search); loadUnlinked(); }, [load, loadUnlinked, search]);

  // Export parents AND child SKUs together as a two-sheet Excel workbook.
  // Uses fetch + blob (not a plain navigation) so the patched fetch
  // attaches the auth token.
  const handleDownload = useCallback(async () => {
    try {
      const res = await fetch(`${API}/pricing/download/`);
      if (!res.ok) { notify("err", "Could not download the pricing workbook."); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "pricing_parents_and_skus.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      notify("err", "Could not download the pricing workbook.");
    }
  }, [notify]);

  // Upload the combined workbook to upsert parents and child SKUs in one go.
  // The exported file's sheets/columns match what the backend expects, so it
  // round-trips (parents are upserted first, then SKUs link to them).
  const handleUpload = useCallback(async (file) => {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    setUploading(true);
    try {
      const res = await fetch(`${API}/pricing/upload/`, { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        const parents = (data.parents_created || 0) + (data.parents_updated || 0);
        const skus = (data.skus_created || 0) + (data.skus_updated || 0);
        let text = `Uploaded — ${parents} parent(s), ${skus} SKU(s).`;
        if (data.skipped) text += ` ${data.skipped} skipped.`;
        if (data.unlinked_parent_refs) text += ` ${data.unlinked_parent_refs} SKU(s) referenced a missing parent.`;
        notify("ok", text);
        refresh();
      } else {
        notify("err", data.error || "Upload failed.");
      }
    } catch {
      notify("err", "Network error during upload.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }, [notify, refresh]);

  useEffect(() => { loadMissing(); }, [loadMissing]);
  useEffect(() => { loadUnlinked(); }, [loadUnlinked]);

  // Debounced so typing a SKU doesn't fire a request per character.
  useEffect(() => {
    const t = setTimeout(() => load(search), search ? 300 : 0);
    return () => clearTimeout(t);
  }, [search, load]);

  useEffect(() => {
    setSelectedUnlinked(prev => {
      const available = new Set(unlinked.map(u => u.sku_id));
      const next = new Set([...prev].filter(sku => available.has(sku)));
      return next;
    });
  }, [unlinked]);

  // Shared linking handler — used by both drag-and-drop and the autocomplete dropdown.
  // Uses /link-sku/ so a SKU that only exists in the orders table (no FinalPrice
  // row yet) is created and linked in one step.
  const linkSku = useCallback(async (skuId, parentId) => {
    setDragging(null);
    const r = await fetch(`${API}/link-sku/`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sku_id: skuId, parent_id: parentId }),
    });
    if (r.ok) { notify("ok", `${skuId} → ${parentId} linked.`); refresh(); }
    else notify("err", `Could not link ${skuId}.`);
  }, [notify, refresh]);

  // Already narrowed by the API, including by child SKU.
  const filtered = parents;

  const quickUnlinked = unlinked.filter(s =>
    !linkQuery || s.sku_id.toLowerCase().includes(linkQuery.toLowerCase())
  );

  const toggleUnlinked = skuId => {
    setSelectedUnlinked(prev => {
      const next = new Set(prev);
      if (next.has(skuId)) next.delete(skuId);
      else next.add(skuId);
      return next;
    });
  };

  const selectVisibleUnlinked = () => {
    setSelectedUnlinked(prev => {
      const next = new Set(prev);
      quickUnlinked.slice(0, 120).forEach(s => next.add(s.sku_id));
      return next;
    });
  };

  const clearSelectedUnlinked = () => setSelectedUnlinked(new Set());

  const bulkLinkSelected = async () => {
    if (!linkParentId || selectedUnlinked.size === 0) return;
    setBulkLinking(true);
    try {
      const r = await fetch(`${API}/link-sku/bulk/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parent_id: linkParentId, sku_ids: [...selectedUnlinked] }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        const failed = d.failed || 0;
        notify(
          failed ? "err" : "ok",
          failed
            ? `Linked ${d.linked || 0} SKU(s); ${failed} failed.`
            : `Linked ${d.linked || 0} SKU(s) to ${linkParentId}.`
        );
        setSelectedUnlinked(new Set());
        refresh();
      } else {
        notify("err", d.error || "Bulk link failed.");
      }
    } catch {
      notify("err", "Bulk link failed.");
    } finally {
      setBulkLinking(false);
    }
  };

  const totalSkus = parents.reduce((a, p) => a + (p.sku_count || 0), 0);
  const withHistory = parents.filter(p => (p.history_count || 0) > 0).length;
  const noHistory = parents.length - withHistory;
  const selectedCount = selectedUnlinked.size;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      <div style={{
        borderRadius: 16,
        border: `1px solid ${C.border}`,
        padding: "18px 20px",
        background: "linear-gradient(135deg, #E0EAFF 0%, #F7F3FF 45%, #FFF8F1 100%)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 900, color: C.gray900, marginBottom: 4 }}>SKU Pricing Studio</h2>
            <p style={{ fontSize: 13, color: C.gray600 }}>
              Modern parent-SKU workspace: quick linking, clean pricing control, and visual grouping.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={handleDownload} style={btn("ghost", "md")} title="Export parents and SKUs together as a two-sheet Excel workbook">
              ⬇ Download Excel (Parents + SKUs)
            </button>
            <button
              onClick={() => fileRef.current && fileRef.current.click()}
              disabled={uploading}
              style={{ ...btn("ghost", "md"), opacity: uploading ? 0.6 : 1 }}
              title="Upload the Excel workbook to add/update parents and SKUs in one go"
            >
              {uploading ? "Uploading…" : "⬆ Upload Excel (Parents + SKUs)"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              style={{ display: "none" }}
              onChange={(e) => handleUpload(e.target.files?.[0])}
            />
            <button onClick={() => setShowAdd(o => !o)} style={btn(showAdd ? "ghost" : "primary", "md")}>
              {showAdd ? "Close New Parent" : "+ New Parent Group"}
            </button>
            {missingSkus.length > 0 && (
              <button onClick={() => setShowMissing(o => !o)} style={btn("danger", "md")}>
                {showMissing ? "Hide" : "Show"} Unpriced ({missingSkus.length})
              </button>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
        <div style={{ ...S.card, padding: "12px 14px", borderTop: `3px solid ${C.orange}` }}>
          <div style={{ fontSize: 11, color: C.gray500, fontWeight: 700 }}>Parent Groups</div>
          <div style={{ fontSize: 24, fontWeight: 900, color: C.gray900 }}>{parents.length}</div>
        </div>
        <div style={{ ...S.card, padding: "12px 14px", borderTop: `3px solid ${C.blue}` }}>
          <div style={{ fontSize: 11, color: C.gray500, fontWeight: 700 }}>Linked SKUs</div>
          <div style={{ fontSize: 24, fontWeight: 900, color: C.blue }}>{totalSkus}</div>
        </div>
        <div style={{ ...S.card, padding: "12px 14px", borderTop: `3px solid ${C.green}` }}>
          <div style={{ fontSize: 11, color: C.gray500, fontWeight: 700 }}>With Price History</div>
          <div style={{ fontSize: 24, fontWeight: 900, color: C.green }}>{withHistory}</div>
        </div>
        <div style={{ ...S.card, padding: "12px 14px", borderTop: `3px solid ${C.amber}` }}>
          <div style={{ fontSize: 11, color: C.gray500, fontWeight: 700 }}>No History</div>
          <div style={{ fontSize: 24, fontWeight: 900, color: C.amber }}>{noHistory}</div>
        </div>
        <div style={{ ...S.card, padding: "12px 14px", borderTop: `3px solid ${C.red}` }}>
          <div style={{ fontSize: 11, color: C.gray500, fontWeight: 700 }}>Unlinked SKUs</div>
          <div style={{ fontSize: 24, fontWeight: 900, color: C.red }}>{unlinked.length}</div>
        </div>
      </div>

      {msg && (
        <div style={{ padding: "10px 16px", borderRadius: 8, fontSize: 13, fontWeight: 500,
          background: msg.type === "ok" ? C.greenLight : "#FEF2F2",
          color: msg.type === "ok" ? C.green : C.red,
          border: `1px solid ${msg.type === "ok" ? C.greenBorder : "#FECACA"}` }}>
          {msg.text}
        </div>
      )}

      {showMissing && missingSkus.length > 0 && (
        <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderLeft: `4px solid ${C.red}`, borderRadius: 10, padding: "12px 16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: C.red }}>⚠ These SKUs are in orders but have no pricing set</p>
            <button onClick={() => setShowMissing(false)} style={{ background: "none", border: "none", cursor: "pointer", color: C.red, fontSize: 14 }}>✕</button>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {missingSkus.map(s => (
              <span key={s.sku_id ?? s} style={{ fontFamily: "monospace", fontSize: 11, color: C.red, background: C.white, border: "1px solid #FECACA", padding: "2px 8px", borderRadius: 4, fontWeight: 600 }}>
                {s.sku_id ?? s}
                {s.order_count > 0 && <span style={{ color: C.gray400, fontWeight: 400 }}> · {s.order_count}</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {showAdd && <AddParentForm notify={notify} onSaved={() => { setShowAdd(false); load(); }} onCancel={() => setShowAdd(false)} />}

      <div style={{
        display: "grid",
        // A 300px-minimum column beside a 1fr sibling cannot fit a 390px
        // screen, so the Link Center stacks above the list on mobile.
        gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "minmax(300px, 360px) minmax(0, 1fr)",
        gap: 14,
      }}>

        <div style={{
          ...S.card, padding: 14, height: "fit-content", minWidth: 0,
          // Sticky is only useful next to a long scrolling list; stacked on
          // mobile it would pin the panel over the content below it.
          ...(isMobile ? {} : { position: "sticky", top: 8 }),
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <h3 style={{ fontSize: 14, fontWeight: 800, color: C.gray800 }}>🔗 Link Center</h3>
            <span style={{
              background: showHidden ? C.gray100 : C.redLight,
              color: showHidden ? C.gray600 : C.red,
              border: `1px solid ${showHidden ? C.gray200 : C.redBorder}`,
              padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700 }}>
              {unlinked.length} {showHidden ? "hidden" : "unlinked"}
            </span>
          </div>
          <p style={{ fontSize: 11, color: C.gray400, marginBottom: 8 }}>
            {showHidden
              ? "SKUs you've said will never have a parent. Restore any of them here."
              : "Pick a target parent, then one-click link — or make any SKU its own new parent."}
          </p>
          {(hiddenCount > 0 || showHidden) && (
            <button onClick={() => { setShowHidden(h => !h); clearSelectedUnlinked(); }}
              style={{ background: "none", border: "none", padding: 0, marginBottom: 10,
                cursor: "pointer", fontFamily: "inherit", fontSize: 11.5, fontWeight: 700,
                color: C.blue }}>
              {showHidden ? "← Back to unlinked" : `Show ${hiddenCount} hidden SKU${hiddenCount === 1 ? "" : "s"}`}
            </button>
          )}

          {/* Step 1 — choose target parent */}
          <label style={S.label}>① Target Parent Group</label>
          <select value={linkParentId} onChange={e => setLinkParentId(e.target.value)}
            style={{ ...S.inp, marginBottom: 6, borderColor: linkParentId ? C.blue : C.gray200 }}>
            <option value="">Select a parent to link into…</option>
            {parents.map(p => (
              <option key={p.item_id} value={p.item_id}>{p.item_id} ({p.sku_count || 0})</option>
            ))}
          </select>
          {!linkParentId && (
            <p style={{ fontSize: 10, color: C.amber, marginBottom: 10 }}>Choose a parent to enable one-click linking below.</p>
          )}

          {/* Step 2 — find + bulk act */}
          <label style={{ ...S.label, marginTop: 4 }}>② Find & Link</label>
          <input
            value={linkQuery}
            onChange={e => setLinkQuery(e.target.value)}
            placeholder="Filter unlinked SKUs…"
            style={{ ...S.inp, fontSize: 12, marginBottom: 8 }}
          />

          <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
            <button onClick={selectVisibleUnlinked} style={btn("ghost", "sm")}>Select visible</button>
            {selectedCount > 0 && <button onClick={clearSelectedUnlinked} style={btn("ghost", "sm")}>Clear ({selectedCount})</button>}
          </div>

          <button
            onClick={bulkLinkSelected}
            disabled={!linkParentId || selectedCount === 0 || bulkLinking}
            style={{ ...btn("primary", "md"), width: "100%", marginBottom: 12,
              opacity: (!linkParentId || selectedCount === 0) ? 0.5 : 1 }}
          >
            {bulkLinking ? "Linking…" : `Link ${selectedCount} selected → ${linkParentId || "parent"}`}
          </button>

          {/* Unlinked SKU rows with inline quick actions */}
          <div style={{ border: `1px solid ${C.gray100}`, borderRadius: 10, overflow: "hidden", maxHeight: 420, overflowY: "auto" }}>
            {quickUnlinked.length === 0 ? (
              <div style={{ fontSize: 12, color: C.gray400, padding: 14, textAlign: "center" }}>
                {unlinked.length === 0
                  ? (showHidden ? "Nothing hidden." : "🎉 Every SKU is linked.")
                  : "No SKUs match your filter."}
              </div>
            ) : (
              quickUnlinked.slice(0, 200).map((s, i) => {
                const selected = selectedUnlinked.has(s.sku_id);
                return (
                  <div
                    key={s.id ?? s.sku_id}
                    draggable
                    onDragStart={e => { e.dataTransfer.setData("text/plain", s.sku_id); setDragging(s.sku_id); }}
                    onDragEnd={() => setDragging(null)}
                    style={{
                      display: "flex", alignItems: "center", gap: 8, padding: "7px 9px",
                      background: selected ? C.blueLight : i % 2 ? C.gray50 : C.white,
                      borderBottom: `1px solid ${C.gray100}`, cursor: "grab",
                    }}
                    title={`Drag onto a parent card to link · ${s.order_count || 0} order(s)`}
                  >
                    <input type="checkbox" checked={selected} onChange={() => toggleUnlinked(s.sku_id)} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: s.has_price ? C.orange : C.green, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {s.sku_id}
                      </div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 1 }}>
                        {s.has_price
                          ? <span style={{ fontSize: 10, fontFamily: "monospace", color: C.gray400 }}>{fmt(s.final_price)}</span>
                          : <span style={{ fontSize: 8, fontWeight: 800, color: C.white, background: C.green, padding: "1px 5px", borderRadius: 10 }}>NEW</span>}
                        {s.order_count > 0 && <span style={{ fontSize: 10, color: C.gray400 }}>📦 {s.order_count}</span>}
                      </div>
                    </div>
                    {/* Quick actions */}
                    {!showHidden && (
                      <button
                        onClick={() => linkParentId && linkSku(s.sku_id, linkParentId)}
                        disabled={!linkParentId}
                        title={linkParentId ? `Link to ${linkParentId}` : "Select a target parent first"}
                        style={{ ...btn("secondary", "sm"), padding: "3px 8px", fontSize: 11, opacity: linkParentId ? 1 : 0.4 }}
                      >🔗</button>
                    )}
                    {!showHidden && (
                      <button
                        onClick={() => setNewParentFor(s)}
                        title="Create a new parent from this SKU"
                        style={{ ...btn("success", "sm"), padding: "3px 8px", fontSize: 11 }}
                      >+ Parent</button>
                    )}
                    {/* Some SKUs will never belong to a group. Hiding one keeps
                        the pile meaning "still needs attention". */}
                    <button
                      onClick={() => setOptOut(s.sku_id, !showHidden)}
                      title={showHidden
                        ? "Put this SKU back in the unlinked list"
                        : "This SKU will never have a parent — hide it"}
                      style={{ ...btn("ghost", "sm"), padding: "3px 8px", fontSize: 11,
                        color: showHidden ? C.green : C.gray400 }}
                    >{showHidden ? "↩" : "🚫"}</button>
                  </div>
                );
              })
            )}
          </div>

          <div style={{ marginTop: 8, fontSize: 11, color: C.gray400 }}>
            Tip: 🔗 links to the target parent · <strong>+ Parent</strong> promotes a SKU into its own group · drag a row onto any card to link.
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ ...S.card, padding: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search parent ID or child SKU"
              style={{ ...S.inp, maxWidth: 300, fontSize: 12 }}
            />
            {search && <button onClick={() => setSearch("")} style={btn("ghost", "sm")}>Clear</button>}
            <span style={{ fontSize: 12, color: C.gray500 }}>
              {filtered.length} group{filtered.length === 1 ? "" : "s"}{search ? " matching" : ""}
            </span>
          </div>

          {loading ? (
            <div style={{ textAlign: "center", padding: 48, color: C.gray400 }}>Loading pricing data...</div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: "center", padding: 48, color: C.gray400, fontSize: 13 }}>
              {parents.length === 0 ? 'No parent SKUs yet - create your first parent group.' : "No results matching your search."}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {filtered.map(p => (
                <ParentCard key={p.item_id} parent={p} onRefresh={refresh} notify={notify} onOptOut={setOptOut}
                  onLink={linkSku} dragging={dragging} unlinked={unlinked} />
              ))}
            </div>
          )}
        </div>
      </div>

      {newParentFor && (
        <CreateParentFromSkuModal
          sku={newParentFor}
          onCancel={() => setNewParentFor(null)}
          onSaved={(parentId) => {
            setNewParentFor(null);
            notify("ok", `Parent "${parentId}" created from ${newParentFor.sku_id}.`);
            refresh();
          }}
        />
      )}
    </div>
  );
}
