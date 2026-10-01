import React, { useCallback, useEffect, useState } from "react";
import { API, C, S, btn, fmt, useIsMobile } from "../../App";
import { ImageUrlPreview, ImageUrlThumb } from "../shared/ImageUrlPreview";

/*
 * MASTER PRICING
 *
 * The raw-material price list ("Katori" ₹30, "Plate" ₹110, …) a parent SKU
 * can be built from instead of being priced by hand — see the "Bill of
 * Materials" panel on each parent in SKU Pricing, and the cascade logic in
 * backend meesho_app/master_pricing.py. Raising a master item's price here
 * recomputes every parent built from it automatically; that's the entire
 * point of keeping a master list instead of typing the same ₹30 into five
 * different combo parents and updating all five by hand later.
 */

const emptyForm = { name: "", unit_price: "", notes: "", image_url: "" };

export function MasterPricingTab() {
  const isMobile = useIsMobile();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState({});

  const notify = useCallback((type, text) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  }, []);

  const load = useCallback(async (term = "") => {
    const q = term.trim() ? `?search=${encodeURIComponent(term.trim())}` : "";
    const r = await fetch(`${API}/master-items/${q}`);
    const d = await r.json().catch(() => ({}));
    setItems(d.results || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setTimeout(() => load(search), 250);
    return () => clearTimeout(t);
  }, [search, load]);

  const createItem = async () => {
    if (!form.name.trim()) return setFormErr("Name is required.");
    setSaving(true);
    setFormErr("");
    try {
      const r = await fetch(`${API}/master-items/`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(), unit_price: form.unit_price || null,
          notes: form.notes, image_url: form.image_url.trim(),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        notify("ok", `"${form.name.trim()}" added.`);
        setForm(emptyForm);
        setShowAdd(false);
        load(search);
      } else {
        setFormErr(d.name?.[0] || d.unit_price?.[0] || d.image_url?.[0] || "Could not save.");
      }
    } finally { setSaving(false); }
  };

  const startEdit = (item) => {
    setEditingId(item.id);
    setEditDraft({ name: item.name, unit_price: String(item.unit_price ?? ""), notes: item.notes || "", image_url: item.image_url || "" });
  };

  const saveEdit = async (id) => {
    const r = await fetch(`${API}/master-items/${id}/`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editDraft.name.trim(), unit_price: editDraft.unit_price || null,
        notes: editDraft.notes, image_url: (editDraft.image_url || "").trim(),
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) {
      notify("ok", "Updated — every parent built from this recomputes automatically.");
      setEditingId(null);
      load(search);
    } else {
      notify("err", d.name?.[0] || d.unit_price?.[0] || d.image_url?.[0] || "Update failed.");
    }
  };

  const deleteItem = async (item) => {
    if (!window.confirm(`Delete "${item.name}" from the master list?`)) return;
    const r = await fetch(`${API}/master-items/${item.id}/`, { method: "DELETE" });
    if (r.ok) { notify("ok", `"${item.name}" deleted.`); load(search); }
    else { const d = await r.json().catch(() => ({})); notify("err", d.error || "Delete failed."); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ fontSize: 20 }}>🧱</span>
          <h1 style={{ fontSize: isMobile ? 17 : 19, fontWeight: 800, color: C.gray800 }}>Master Pricing</h1>
        </div>
        <p style={{ fontSize: 12, color: C.gray400, marginTop: 3, maxWidth: 680 }}>
          A price list of unique raw items — Katori ₹30, Plate ₹110 — that parent SKUs can be built
          from instead of being priced by hand. Raise a price here and every parent that uses it
          recomputes on its own, in SKU Pricing's "Bill of Materials" panel.
        </p>
      </div>

      {msg && (
        <div style={{
          padding: "10px 14px", borderRadius: 10, fontSize: 13, fontWeight: 600,
          background: msg.type === "ok" ? C.greenLight : C.redLight,
          color: msg.type === "ok" ? C.green : C.red,
          border: `1px solid ${msg.type === "ok" ? C.greenBorder : C.redBorder}`,
        }}>
          {msg.text}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search master items…"
          style={{ ...S.inp, flex: "1 1 220px", maxWidth: 320 }} />
        <button onClick={() => setShowAdd((s) => !s)} style={btn(showAdd ? "ghost" : "primary", "md")}>
          {showAdd ? "Cancel" : "+ New Master Item"}
        </button>
      </div>

      {showAdd && (
        <div style={{ ...S.card, border: `2px solid ${C.orange}` }}>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "2fr 1fr 2fr", gap: 10 }}>
            <div>
              <label style={S.label}>Name *</label>
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Katori" style={S.inp} onKeyDown={(e) => { if (e.key === "Enter") createItem(); }} />
            </div>
            <div>
              <label style={S.label}>Unit Price (₹)</label>
              <input type="number" step="0.01" value={form.unit_price}
                onChange={(e) => setForm((f) => ({ ...f, unit_price: e.target.value }))} style={S.inp} />
            </div>
            <div>
              <label style={S.label}>Notes</label>
              <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="optional" style={S.inp} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", marginTop: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={S.label}>Photo — catalog image URL</label>
              <input value={form.image_url} onChange={(e) => setForm((f) => ({ ...f, image_url: e.target.value }))}
                placeholder="https://... (optional)" style={{ ...S.inp, fontFamily: "monospace" }} />
            </div>
            <ImageUrlPreview url={form.image_url} />
          </div>
          {formErr && <p style={{ color: C.red, fontSize: 12, marginTop: 8 }}>{formErr}</p>}
          <div style={{ marginTop: 10 }}>
            <button onClick={createItem} disabled={saving} style={btn("primary", "sm")}>
              {saving ? "Saving…" : "Add to master list"}
            </button>
          </div>
        </div>
      )}

      <div style={S.card}>
        {loading ? (
          <div style={{ textAlign: "center", padding: 40, color: C.gray400 }}>Loading…</div>
        ) : items.length === 0 ? (
          <div style={{ textAlign: "center", padding: 40, color: C.gray400, fontSize: 13 }}>
            {search ? "No matches." : "No master items yet — add your first raw item above."}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={S.th}></th>
                  <th style={S.th}>Name</th>
                  <th style={{ ...S.th, textAlign: "right" }}>Unit Price</th>
                  <th style={S.th}>Notes</th>
                  <th style={{ ...S.th, textAlign: "right" }}>Used In</th>
                  <th style={S.th}></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => {
                  const editing = editingId === item.id;
                  return (
                    <tr key={item.id} style={{ background: i % 2 ? C.gray50 : C.white }}>
                      <td style={{ ...S.td, width: 1 }}>
                        <ImageUrlThumb url={editing ? editDraft.image_url : item.image_url} />
                      </td>
                      <td style={{ ...S.td, fontWeight: 700 }}>
                        {editing
                          ? <input value={editDraft.name} onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                              style={{ ...S.inp, fontSize: 12.5, padding: "5px 8px" }} />
                          : item.name}
                      </td>
                      <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace" }}>
                        {editing
                          ? <input type="number" step="0.01" value={editDraft.unit_price}
                              onChange={(e) => setEditDraft((d) => ({ ...d, unit_price: e.target.value }))}
                              style={{ ...S.inp, fontSize: 12.5, padding: "5px 8px", width: 100, textAlign: "right" }} />
                          : (item.unit_price != null ? fmt(item.unit_price) : <span style={{ color: C.gray300 }}>not set</span>)}
                      </td>
                      <td style={{ ...S.td, color: C.gray500 }}>
                        {editing ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <input value={editDraft.notes} onChange={(e) => setEditDraft((d) => ({ ...d, notes: e.target.value }))}
                              placeholder="Notes" style={{ ...S.inp, fontSize: 12.5, padding: "5px 8px" }} />
                            <input value={editDraft.image_url} onChange={(e) => setEditDraft((d) => ({ ...d, image_url: e.target.value }))}
                              placeholder="Image URL" style={{ ...S.inp, fontSize: 11.5, padding: "5px 8px", fontFamily: "monospace" }} />
                          </div>
                        ) : (item.notes || "—")}
                      </td>
                      <td style={{ ...S.td, textAlign: "right" }}>
                        {item.used_in_count > 0 ? (
                          <span style={{ background: "#EDE9FE", color: "#6D28D9", border: "1px solid #DDD6FE", padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700 }}>
                            {item.used_in_count} parent{item.used_in_count !== 1 ? "s" : ""}
                          </span>
                        ) : (
                          <span style={{ color: C.gray300, fontSize: 11 }}>unused</span>
                        )}
                      </td>
                      <td style={{ ...S.td, textAlign: "right", whiteSpace: "nowrap" }}>
                        {editing ? (
                          <>
                            <button onClick={() => saveEdit(item.id)} style={{ ...btn("success", "sm"), padding: "4px 10px", fontSize: 11, marginRight: 6 }}>Save</button>
                            <button onClick={() => setEditingId(null)} style={{ ...btn("ghost", "sm"), padding: "4px 10px", fontSize: 11 }}>Cancel</button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => startEdit(item)} style={{ ...btn("ghost", "sm"), padding: "4px 10px", fontSize: 11, marginRight: 6 }}>Edit</button>
                            <button onClick={() => deleteItem(item)} style={{ ...btn("ghost", "sm"), padding: "4px 10px", fontSize: 11, color: C.red }}>Delete</button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
