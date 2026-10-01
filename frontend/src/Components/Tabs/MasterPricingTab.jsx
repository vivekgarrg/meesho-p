import React, { useCallback, useEffect, useMemo, useState } from "react";
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
 *
 * PRICE UPDATES
 *
 * A master item's price is the thing that actually moves — the supplier put
 * Katori up. Each change is recorded as a dated entry
 * (MasterItemPriceHistory), and the latest entry by date IS the item's
 * current price, so the trail and the price can never disagree. Recording an
 * update cascades the same way a hand edit does: every parent built from the
 * item is repriced, and so is every child SKU under those parents.
 */

const emptyForm = { name: "", unit_price: "", notes: "", image_url: "" };

const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local

const fmtDate = (d) => {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return new Date(+y, +m - 1, +day).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "2-digit",
  });
};

/** "3d ago" / "2mo ago" — how long this price has been the price. */
const fmtAgo = (d) => {
  if (!d) return null;
  const days = Math.floor((Date.now() - new Date(`${d}T00:00:00`).getTime()) / 86400000);
  if (days < 0) return `from ${fmtDate(d)}`;
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
};

/** The entry that is currently in force — the latest by effective_from. */
const latestEntry = (history) => {
  if (!history || !history.length) return null;
  return [...history].sort((a, b) => a.effective_from.localeCompare(b.effective_from)).at(-1);
};

/** The one before it, so a row can show "↑ ₹5 from ₹30". */
const previousEntry = (history) => {
  if (!history || history.length < 2) return null;
  return [...history].sort((a, b) => a.effective_from.localeCompare(b.effective_from)).at(-2);
};

// ── price-update trail for one master item ──────────────────────────────────
function PriceUpdatePanel({ item, onRecorded, onDeleted, notify }) {
  const isMobile = useIsMobile();
  const [form, setForm] = useState({ effective_from: today(), unit_price: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const history = useMemo(
    () => [...(item.price_history || [])].sort((a, b) => a.effective_from.localeCompare(b.effective_from)),
    [item.price_history],
  );
  const parents = item.used_in_parents || [];

  // What this update would do to each parent built from the item, before it is
  // committed — the number that actually matters is downstream, not here.
  const nextPrice = parseFloat(form.unit_price);
  const impact = Number.isFinite(nextPrice)
    ? parents.map((p) => ({ ...p, line: nextPrice * parseFloat(p.quantity || 1) }))
    : [];

  const record = async () => {
    if (!String(form.unit_price).trim()) { setErr("Enter the new price."); return; }
    if (!form.effective_from) { setErr("Pick the date this price took effect."); return; }
    setBusy(true); setErr("");
    try {
      const r = await fetch(`${API}/master-items/${item.id}/price-history/`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          effective_from: form.effective_from,
          unit_price: form.unit_price,
          notes: form.notes,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(d.unit_price?.[0] || d.effective_from?.[0] || d.detail || d.error
          || `Could not record the update (${r.status}).`);
        return;
      }
      setForm({ effective_from: today(), unit_price: "", notes: "" });
      notify("ok", parents.length
        ? `${item.name} updated — ${parents.length} parent SKU${parents.length === 1 ? "" : "s"} repriced.`
        : `${item.name} updated.`);
      onRecorded();
    } catch {
      setErr("Could not record the update — network error.");
    } finally { setBusy(false); }
  };

  const remove = async (entry) => {
    if (!window.confirm(`Remove the ${fmtDate(entry.effective_from)} price of ${fmt(entry.unit_price)}?`)) return;
    const r = await fetch(`${API}/master-items/${item.id}/price-history/${entry.id}/`, { method: "DELETE" });
    if (r.ok) {
      notify("ok", "Price entry removed — the previous price is back in force.");
      onDeleted();
    } else {
      const d = await r.json().catch(() => ({}));
      notify("err", d.error || "Could not remove that entry.");
    }
  };

  return (
    <div style={{ background: C.gray50, borderTop: `1px solid ${C.border}`, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
      {/* ── the trail ── */}
      <div>
        <p style={{ ...S.cardTitle, marginBottom: 8 }}>Price Updates</p>
        {history.length === 0 ? (
          <p style={{ fontSize: 12, color: C.gray400, fontStyle: "italic", margin: 0 }}>
            No recorded updates yet — the current price was set when the item was created.
            Record one below and every change from here on is dated and kept.
          </p>
        ) : (
          <div style={{ overflowX: "auto", paddingBottom: 4 }}>
            <div style={{ display: "flex", alignItems: "flex-start", minWidth: "max-content" }}>
              {history.map((h, i) => {
                const isLast = i === history.length - 1;
                const next = history[i + 1];
                const delta = next ? Number(next.unit_price) - Number(h.unit_price) : 0;
                return (
                  <div key={h.id} style={{ display: "flex", alignItems: "flex-start" }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 108 }}>
                      <div style={{
                        width: isLast ? 13 : 9, height: isLast ? 13 : 9, borderRadius: "50%",
                        background: isLast ? C.orange : C.gray300,
                        border: `2px solid ${isLast ? C.orange : C.gray200}`,
                        boxShadow: isLast ? `0 0 0 4px ${C.orangeLight}` : "none",
                        marginBottom: 6,
                      }} />
                      <span style={{ fontFamily: "monospace", fontWeight: isLast ? 800 : 600, fontSize: isLast ? 14 : 12, color: isLast ? C.orange : C.gray600 }}>
                        {fmt(h.unit_price)}
                      </span>
                      {isLast && (
                        <span style={{ fontSize: 9, fontWeight: 700, color: C.orange, background: C.orangeLight, border: `1px solid ${C.orangeBorder}`, padding: "1px 6px", borderRadius: 20, marginTop: 2 }}>
                          IN FORCE
                        </span>
                      )}
                      <span style={{ fontSize: 10, color: C.gray400, marginTop: 4 }}>{fmtDate(h.effective_from)}</span>
                      {h.notes && (
                        <span style={{ fontSize: 9, color: C.gray400, fontStyle: "italic", maxWidth: 100, textAlign: "center", marginTop: 2 }}>
                          {h.notes}
                        </span>
                      )}
                      <button onClick={() => remove(h)} title="Remove entry"
                        style={{ marginTop: 4, background: "none", border: "none", cursor: "pointer", color: C.gray300, fontSize: 12, padding: "2px 4px", fontFamily: "inherit" }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = C.red; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = C.gray300; }}>
                        🗑
                      </button>
                    </div>
                    {!isLast && (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 6, minWidth: 54 }}>
                        <div style={{ height: 2, width: "100%", background: C.gray200, borderRadius: 1, marginBottom: 4 }} />
                        {delta !== 0 && (
                          <span style={{ fontSize: 10, fontWeight: 700, color: delta > 0 ? C.red : C.green }}>
                            {delta > 0 ? "↑" : "↓"}{fmt(Math.abs(delta))}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── record a new one ── */}
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderLeft: `4px solid ${C.orange}`, borderRadius: 8, padding: "12px 14px" }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: C.orange, textTransform: "uppercase", letterSpacing: "0.04em", margin: "0 0 10px", display: "flex", alignItems: "center", gap: 6 }}>
          <span>📈</span>Record a price update
        </p>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 2fr auto", gap: 10, alignItems: "end" }}>
          <div>
            <label style={{ ...S.label, fontSize: 10 }}>Effective from *</label>
            <input type="date" value={form.effective_from}
              onChange={(e) => setForm((f) => ({ ...f, effective_from: e.target.value }))}
              style={{ ...S.inp, fontSize: 12 }} />
          </div>
          <div>
            <label style={{ ...S.label, fontSize: 10 }}>New unit price (₹) *</label>
            <input type="number" step="0.01" value={form.unit_price}
              placeholder={item.unit_price != null ? String(item.unit_price) : ""}
              onChange={(e) => setForm((f) => ({ ...f, unit_price: e.target.value }))}
              onKeyDown={(e) => { if (e.key === "Enter") record(); }}
              style={{ ...S.inp, fontSize: 12 }} />
          </div>
          <div>
            <label style={{ ...S.label, fontSize: 10 }}>Why</label>
            <input value={form.notes} placeholder="e.g. supplier raised the rate"
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              style={{ ...S.inp, fontSize: 12 }} />
          </div>
          <button onClick={record} disabled={busy} style={btn("primary", "sm")}>
            {busy ? "Saving…" : "Update price"}
          </button>
        </div>
        {err && <p style={{ color: C.red, fontSize: 11.5, marginTop: 8, marginBottom: 0 }}>{err}</p>}
        <p style={{ fontSize: 10.5, color: C.gray500, marginTop: 8, marginBottom: 0 }}>
          The latest date wins — recording a second price for a date already on the trail replaces
          that day's entry rather than stacking beside it.
        </p>
      </div>

      {/* ── what it moves ── */}
      <div>
        <p style={{ ...S.cardTitle, marginBottom: 8 }}>
          Parents built from this {parents.length ? `(${parents.length})` : ""}
        </p>
        {parents.length === 0 ? (
          <p style={{ fontSize: 12, color: C.gray400, fontStyle: "italic", margin: 0 }}>
            Nothing uses this item yet — add it to a parent's Bill of Materials in SKU Pricing and a
            price update here will reprice that parent, and every SKU under it, on its own.
          </p>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {(impact.length ? impact : parents).map((p) => (
              <span key={p.item_id} style={{
                background: C.white, border: `1px solid ${C.border}`, borderRadius: 8,
                padding: "6px 10px", fontSize: 11.5, color: C.gray700,
                display: "inline-flex", alignItems: "center", gap: 7,
              }}>
                <strong style={{ fontWeight: 700 }}>{p.item_id}</strong>
                <span style={{ color: C.gray400 }}>×{parseFloat(p.quantity)}</span>
                {"line" in p && (
                  <span style={{ fontFamily: "monospace", fontWeight: 700, color: C.orange }}>
                    → {fmt(p.line)}
                  </span>
                )}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function MasterPricingTab() {
  const isMobile = useIsMobile();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [openId, setOpenId] = useState(null); // which row's price-update panel is open

  const notify = useCallback((type, text) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  }, []);

  // A failed load used to leave `items` empty and say "No master items yet",
  // which reads identically to an empty list — so a 500 or a permission
  // denial looked like "saving doesn't work". Surface the failure instead.
  const load = useCallback(async (term = "") => {
    const q = term.trim() ? `?search=${encodeURIComponent(term.trim())}` : "";
    try {
      const r = await fetch(`${API}/master-items/${q}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setLoadErr(d.detail || d.error || `Could not load the master list (${r.status}).`);
        return;
      }
      setLoadErr("");
      setItems(d.results || []);
    } catch {
      setLoadErr("Could not load the master list — network error.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(search), search ? 250 : 0);
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
        setFormErr(d.name?.[0] || d.unit_price?.[0] || d.image_url?.[0] || d.detail || d.error
          || `Could not save (${r.status}).`);
      }
    } catch {
      setFormErr("Could not save — network error.");
    } finally { setSaving(false); }
  };

  const startEdit = (item) => {
    setEditingId(item.id);
    setEditDraft({
      name: item.name,
      unit_price: item.unit_price != null ? String(item.unit_price) : "",
      notes: item.notes || "",
      image_url: item.image_url || "",
    });
  };

  const saveEdit = async (id) => {
    if (savingEdit) return;
    setSavingEdit(true);
    try {
      const r = await fetch(`${API}/master-items/${id}/`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editDraft.name.trim(), unit_price: editDraft.unit_price || null,
          notes: editDraft.notes, image_url: (editDraft.image_url || "").trim(),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        notify("ok", "Updated — every parent built from this recomputes automatically, and the change is on the price trail.");
        setEditingId(null);
        load(search);
      } else {
        notify("err", d.name?.[0] || d.unit_price?.[0] || d.image_url?.[0] || d.detail || d.error
          || `Update failed (${r.status}).`);
      }
    } catch {
      notify("err", "Update failed — network error.");
    } finally { setSavingEdit(false); }
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
          recomputes on its own, in SKU Pricing's "Bill of Materials" panel. Open a row to see when
          its price last moved, and to record the next change.
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

      {loadErr && (
        <div style={{
          padding: "10px 14px", borderRadius: 10, fontSize: 13, fontWeight: 600,
          background: C.redLight, color: C.red, border: `1px solid ${C.redBorder}`,
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        }}>
          <span>{loadErr}</span>
          <button onClick={() => load(search)} style={btn("ghost", "sm")}>Retry</button>
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
            {loadErr ? "Nothing to show while the list can't be loaded."
              : search ? "No matches." : "No master items yet — add your first raw item above."}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={S.th}></th>
                  <th style={S.th}></th>
                  <th style={S.th}>Name</th>
                  <th style={{ ...S.th, textAlign: "right" }}>Unit Price</th>
                  <th style={S.th}>Last Change</th>
                  <th style={S.th}>Notes</th>
                  <th style={{ ...S.th, textAlign: "right" }}>Used In</th>
                  <th style={S.th}></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => {
                  const editing = editingId === item.id;
                  const expanded = openId === item.id;
                  const current = latestEntry(item.price_history);
                  const prev = previousEntry(item.price_history);
                  const delta = current && prev ? Number(current.unit_price) - Number(prev.unit_price) : 0;
                  const zebra = i % 2 ? C.gray50 : C.white;
                  return (
                    <React.Fragment key={item.id}>
                      <tr style={{ background: expanded ? C.orangeLight : zebra }}>
                        <td style={{ ...S.td, width: 1, paddingRight: 0 }}>
                          <button
                            onClick={() => setOpenId((id) => (id === item.id ? null : item.id))}
                            title={expanded ? "Hide price updates" : "Show price updates"}
                            style={{
                              background: "none", border: "none", cursor: "pointer", fontFamily: "inherit",
                              color: expanded ? C.orange : C.gray400, fontSize: 11, fontWeight: 700,
                              padding: "4px 6px",
                            }}>
                            {expanded ? "▾" : "▸"}
                          </button>
                        </td>
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
                        <td style={{ ...S.td, whiteSpace: "nowrap" }}>
                          {current ? (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                              <span style={{ fontSize: 11.5, color: C.gray500 }}>{fmtAgo(current.effective_from)}</span>
                              {delta !== 0 && (
                                <span style={{ fontSize: 10.5, fontWeight: 700, color: delta > 0 ? C.red : C.green }}>
                                  {delta > 0 ? "↑" : "↓"}{fmt(Math.abs(delta))}
                                </span>
                              )}
                            </span>
                          ) : (
                            <button onClick={() => setOpenId(item.id)} style={{
                              background: "none", border: "none", padding: 0, cursor: "pointer",
                              fontFamily: "inherit", fontSize: 11, color: C.gray400, textDecoration: "underline",
                            }}>
                              no updates yet
                            </button>
                          )}
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
                              <button onClick={() => saveEdit(item.id)} disabled={savingEdit}
                                style={{ ...btn("success", "sm"), padding: "4px 10px", fontSize: 11, marginRight: 6 }}>
                                {savingEdit ? "Saving…" : "Save"}
                              </button>
                              <button onClick={() => setEditingId(null)} style={{ ...btn("ghost", "sm"), padding: "4px 10px", fontSize: 11 }}>Cancel</button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => setOpenId((id) => (id === item.id ? null : item.id))}
                                style={{ ...btn("ghost", "sm"), padding: "4px 10px", fontSize: 11, marginRight: 6 }}>
                                📈 Price
                              </button>
                              <button onClick={() => startEdit(item)} style={{ ...btn("ghost", "sm"), padding: "4px 10px", fontSize: 11, marginRight: 6 }}>Edit</button>
                              <button onClick={() => deleteItem(item)} style={{ ...btn("ghost", "sm"), padding: "4px 10px", fontSize: 11, color: C.red }}>Delete</button>
                            </>
                          )}
                        </td>
                      </tr>
                      {expanded && (
                        <tr>
                          <td colSpan={8} style={{ padding: 0, borderBottom: `1px solid ${C.gray100}` }}>
                            <PriceUpdatePanel
                              item={item}
                              notify={notify}
                              onRecorded={() => load(search)}
                              onDeleted={() => load(search)}
                            />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
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
