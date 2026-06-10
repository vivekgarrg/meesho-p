import React, { useState, useEffect, useRef, useCallback } from "react";
import { API, btn, C, S, fmt } from "../../App";

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
function SkuDropdown({ parentId, onSelect }) {
  const [q, setQ] = useState(""); const [unlinked, setUnlinked] = useState([]); const [open, setOpen] = useState(false);
  const ref = useRef();

  useEffect(() => {
    fetch(`${API}/final-prices/unlinked/`).then(r => r.json()).then(d => setUnlinked(d.results || []));
  }, []);
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
              <div key={s.sku_id} onMouseDown={() => { onSelect(s.sku_id); setQ(""); setOpen(false); }}
                style={{ padding: "8px 14px", cursor: "pointer", fontSize: 12, display: "flex", justifyContent: "space-between", borderBottom: `1px solid ${C.gray100}` }}
                onMouseEnter={e => e.currentTarget.style.background = C.orangeLight}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
              >
                <span style={{ fontFamily: "monospace", fontWeight: 600, color: isSugg(s.sku_id) ? C.green : C.orange }}>
                  {isSugg(s.sku_id) && "★ "}{s.sku_id}
                </span>
                <span style={{ color: C.gray400, fontSize: 11 }}>{fmt(s.final_price)}</span>
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
function ParentCard({ parent, onRefresh, notify }) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState(null); // null | "history" | "link" | "create" | "edit"
  const [editForm, setEditForm] = useState({ item_price: String(parent.item_price || ""), tax_percent: String(parent.tax_percent || "0"), packaging_cost: String(parent.packaging_cost || "0") });

  const histories   = parent.price_history || [];
  const childCount  = (parent.sku_ids || []).length;
  const hasHistory  = histories.length > 0;
  const latestEntry = hasHistory ? histories[histories.length - 1] : null;

  // Price trajectory summary text: "₹40 → ₹45 → ₹50"
  const trajectory = histories.length > 1
    ? histories.map(h => fmt(h.final_price)).join(" → ")
    : null;

  const toggle = (p) => setPanel(prev => prev === p ? null : p);

  const deleteHistory = async pk => {
    if (!window.confirm("Remove this price entry?")) return;
    const r = await fetch(`${API}/parent-prices/${encodeURIComponent(parent.item_id)}/price-history/${pk}/`, { method: "DELETE" });
    if (r.ok) { notify("ok", "Price entry removed."); onRefresh(); }
  };

  const linkSku = async skuId => {
    const r = await fetch(`${API}/final-prices/${encodeURIComponent(skuId)}/`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parent: parent.item_id }),
    });
    if (r.ok) { notify("ok", `${skuId} linked.`); setPanel(null); onRefresh(); }
    else notify("err", "Link failed.");
  };

  const unlinkSku = async skuId => {
    if (!window.confirm(`Unlink ${skuId}?`)) return;
    const r = await fetch(`${API}/final-prices/${encodeURIComponent(skuId)}/`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parent: null }),
    });
    if (r.ok) { notify("ok", `${skuId} unlinked.`); onRefresh(); }
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

  return (
    <div style={{ background: C.white, border: `1px solid ${open ? "#BFDBFE" : C.border}`, borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.05)", transition: "border-color 0.15s" }}>

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
                {histories.length} price {histories.length === 1 ? "entry" : "entries"}
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
            <button onClick={() => toggle("create")} style={{ ...btn(panel === "create" ? "success" : "ghost", "sm"), fontSize: 11 }}>
              {panel === "create" ? "✕ Cancel" : "+ Create New SKU"}
            </button>
            <div style={{ flex: 1 }} />
            <button onClick={() => toggle("edit")} style={{ ...btn(panel === "edit" ? "ghostOrange" : "ghost", "sm"), fontSize: 11 }}>
              {panel === "edit" ? "✕ Cancel" : "✏️ Edit Price"}
            </button>
            <button onClick={deleteParent} style={{ ...btn("danger", "sm"), fontSize: 11 }}>🗑 Delete</button>
          </div>

          {/* Panel area */}
          {panel && (
            <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.gray100}` }}>
              {panel === "history" && (
                <AddHistoryForm parentId={parent.item_id}
                  onSaved={() => { setPanel(null); onRefresh(); notify("ok", "Price entry added."); }}
                  onCancel={() => setPanel(null)} />
              )}
              {panel === "link" && (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <p style={{ fontSize: 12, color: C.gray600, whiteSpace: "nowrap" }}>★ = name-match suggestions</p>
                  <SkuDropdown parentId={parent.item_id} onSelect={linkSku} />
                </div>
              )}
              {panel === "create" && (
                <CreateChildForm parentId={parent.item_id} parentPrice={parent}
                  onSaved={() => { setPanel(null); onRefresh(); notify("ok", "Child SKU created."); }}
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
            <PriceTimeline histories={histories} onDelete={deleteHistory} onAdd={() => setPanel("history")} />
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

            {childCount > 0 ? (
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={{ ...S.th, fontSize: 10 }}>SKU ID</th>
                      <th style={{ ...S.th, fontSize: 10, textAlign: "right" }}>Item Price</th>
                      <th style={{ ...S.th, fontSize: 10, textAlign: "right" }}>Tax %</th>
                      <th style={{ ...S.th, fontSize: 10, textAlign: "right" }}>Final Price</th>
                      <th style={{ ...S.th, fontSize: 10, width: 60 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {(parent.sku_ids || []).map((skuId, i) => (
                      <tr key={skuId} style={{ background: i % 2 === 0 ? C.white : C.gray50 }}>
                        <td style={S.td}>
                          <span style={{ fontFamily: "monospace", fontSize: 11, color: C.blue, fontWeight: 600, background: C.blueLight, padding: "2px 7px", borderRadius: 4, border: "1px solid #BFDBFE" }}>
                            ↳ {skuId}
                          </span>
                        </td>
                        <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", color: C.gray600 }}>{fmt(parent.item_price)}</td>
                        <td style={{ ...S.td, textAlign: "right", color: C.gray500 }}>{parent.tax_percent ?? 0}%</td>
                        <td style={{ ...S.td, textAlign: "right" }}>
                          <span style={{ fontFamily: "monospace", fontWeight: 700, color: C.orange }}>{fmt(parent.final_price)}</span>
                        </td>
                        <td style={{ ...S.td, textAlign: "center" }}>
                          <button onClick={() => unlinkSku(skuId)} style={{ background: "none", border: "none", cursor: "pointer", color: C.gray300, fontSize: 14, padding: "2px 6px", borderRadius: 4 }}
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

// ── main tab ──────────────────────────────────────────────────────────────────
export function PricingTab() {
  const [parents,     setParents]     = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [showAdd,     setShowAdd]     = useState(false);
  const [search,      setSearch]      = useState("");
  const [msg,         setMsg]         = useState(null);
  const [missingSkus, setMissingSkus] = useState([]);
  const [showMissing, setShowMissing] = useState(false);

  const notify = useCallback((type, text) => {
    setMsg({ type, text }); setTimeout(() => setMsg(null), 4000);
  }, []);

  const load = useCallback(async () => {
    const [pr, sr] = await Promise.all([
      fetch(`${API}/parent-prices/`),
      fetch(`${API}/profit/`).catch(() => null),
    ]);
    const pd = await pr.json(); setParents(pd.results || []);
    if (sr?.ok) { const s = await sr.json(); setMissingSkus(s.missing_sku || []); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = parents.filter(p =>
    !search || p.item_id.toLowerCase().includes(search.toLowerCase()) ||
    (p.sku_ids || []).some(s => s.toLowerCase().includes(search.toLowerCase()))
  );

  const totalSkus    = parents.reduce((a, p) => a + (p.sku_ids || []).length, 0);
  const withHistory  = parents.filter(p => (p.price_history || []).length > 0).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: C.gray800, marginBottom: 3 }}>⚙️ SKU Pricing</h2>
          <p style={{ fontSize: 12, color: C.gray400 }}>
            Parent-centric · price history enables date-accurate profit calculation
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {/* Summary pills */}
          <span style={{ background: C.orangeLight, color: C.orange, border: `1px solid ${C.orangeBorder}`, padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700 }}>
            {parents.length} parents
          </span>
          <span style={{ background: C.blueLight, color: C.blue, border: "1px solid #BFDBFE", padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700 }}>
            {totalSkus} child SKUs
          </span>
          <span style={{ background: C.greenLight, color: C.green, border: `1px solid ${C.greenBorder}`, padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700 }}>
            {withHistory} with history
          </span>
          {missingSkus.length > 0 && (
            <button onClick={() => setShowMissing(o => !o)}
              style={{ background: "#FEF2F2", color: C.red, border: "1px solid #FECACA", padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
              ⚠ {missingSkus.length} unpriced
            </button>
          )}
          <button onClick={() => setShowAdd(o => !o)} style={btn(showAdd ? "ghost" : "primary")}>
            {showAdd ? "✕ Cancel" : "+ New Parent"}
          </button>
        </div>
      </div>

      {/* Toast */}
      {msg && (
        <div style={{ padding: "10px 16px", borderRadius: 8, fontSize: 13, fontWeight: 500,
          background: msg.type === "ok" ? C.greenLight : "#FEF2F2",
          color: msg.type === "ok" ? C.green : C.red,
          border: `1px solid ${msg.type === "ok" ? C.greenBorder : "#FECACA"}` }}>
          {msg.text}
        </div>
      )}

      {/* Missing SKUs */}
      {showMissing && missingSkus.length > 0 && (
        <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderLeft: `4px solid ${C.red}`, borderRadius: 10, padding: "12px 16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: C.red }}>⚠ These SKUs are in orders but have no pricing set</p>
            <button onClick={() => setShowMissing(false)} style={{ background: "none", border: "none", cursor: "pointer", color: C.red, fontSize: 14 }}>✕</button>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {missingSkus.map(s => (
              <span key={s} style={{ fontFamily: "monospace", fontSize: 11, color: C.red, background: C.white, border: "1px solid #FECACA", padding: "2px 8px", borderRadius: 4, fontWeight: 600 }}>{s}</span>
            ))}
          </div>
        </div>
      )}

      {/* Add parent form */}
      {showAdd && <AddParentForm notify={notify} onSaved={() => { setShowAdd(false); load(); }} onCancel={() => setShowAdd(false)} />}

      {/* Search + stats row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search parent ID or child SKU…"
          style={{ ...S.inp, maxWidth: 280, fontSize: 12 }} />
        {search && <button onClick={() => setSearch("")} style={btn("ghost", "sm")}>✕ Clear</button>}
        <span style={{ fontSize: 12, color: C.gray400 }}>{filtered.length} of {parents.length} shown</span>
      </div>

      {/* List */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 48, color: C.gray400 }}>Loading pricing data…</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: 48, color: C.gray400, fontSize: 13 }}>
          {parents.length === 0 ? 'No parent SKUs yet — click "+ New Parent" to create one.' : "No results matching your search."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {filtered.map(p => <ParentCard key={p.item_id} parent={p} onRefresh={load} notify={notify} />)}
        </div>
      )}
    </div>
  );
}
