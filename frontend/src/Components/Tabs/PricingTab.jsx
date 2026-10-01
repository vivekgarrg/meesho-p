import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { API, btn, C, S, fmt, useIsMobile } from "../../App";
import { useBusiness } from "../../contexts/BusinessContext";
import { AppBarChart } from "../Charts/AppBarChart";
import { AppPieChart } from "../Charts/AppPieChart";
import { ImageUrlPreview, ImageUrlThumb } from "../shared/ImageUrlPreview";

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

/** Compact money for dense metric strips: ₹2.2L / ₹89.0k / ₹940. */
const fmtCompact = n => {
  const v = Number(n) || 0;
  if (v >= 10000000) return `₹${(v / 10000000).toFixed(1)}Cr`;
  if (v >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
  if (v >= 1000) return `₹${(v / 1000).toFixed(1)}k`;
  return `₹${Math.round(v)}`;
};

/** "3d ago" / "2mo ago" — a sold-recency read that needs no mental arithmetic. */
const fmtAgo = iso => {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(`${iso}T00:00:00`).getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
};

function nameSuggestions(parentId, skus) {
  const words = parentId.toLowerCase().split(/[_\-\s]+/).filter(w => w.length > 2);
  return [...skus].sort((a, b) => {
    const am = words.some(w => a.sku_id.toLowerCase().includes(w));
    const bm = words.some(w => b.sku_id.toLowerCase().includes(w));
    return bm - am;
  });
}

// ── SWR data layer ──────────────────────────────────────────────────────────
// Every read on this page goes through useSWR instead of manual
// fetch+useState+useEffect — a write still does a plain fetch (SWR is a
// cache for reads, not a mutation API), then calls invalidatePricing()
// below so every hook reading affected data refreshes itself. That cache is
// also why onRefresh-style prop-threading is gone: any component can call
// invalidatePricing() directly and every subscriber updates, here or not.
const parentsKey = (search) => {
  const q = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : "";
  return `${API}/parent-prices/${q}`;
};
const unlinkedKey = (showHidden) => `${API}/final-prices/unlinked/${showHidden ? "?opted_out=1" : ""}`;
const masterItemsKey = () => `${API}/master-items/`;
const missingKey = () => `${API}/final-prices/unpriced/`;
const salesKey = () => `${API}/parent-prices/sales/`;

// A reasonably "live" feel without a websocket: poll the lists that change
// from outside this tab too (a teammate's edit, the cross-business sync
// after a linked business's price moves, the master-item cascade) — plus
// revalidateOnFocus/Reconnect from the app-wide SWRConfig catches the rest
// the moment you switch back to this tab.
const LIVE = { refreshInterval: 20000 };

/**
 * Broad invalidation after any write — the same "just refresh everything"
 * shape the page always used, now scoped to SWR's cache instead of
 * re-fetching blindly. Broad on purpose: a master-item price change or a
 * cross-business sync can move OTHER parents' prices too, not just the one
 * just edited, and every open card's own children/history/components/
 * suggestions all live under the parent-prices/<id>/ prefix, so one filter
 * catches them all. Revalidating a key nothing is currently subscribed to
 * is a no-op in SWR, so this is cheap even when little is actually mounted.
 */
function invalidatePricing() {
  globalMutate((key) => typeof key === "string" && key.startsWith(`${API}/parent-prices`));
  globalMutate((key) => typeof key === "string" && key.startsWith(`${API}/final-prices`));
  globalMutate((key) => typeof key === "string" && key.startsWith(`${API}/master-items`));
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

// ── one consistent action-panel shell ─────────────────────────────────────────
// Every panel below (rename/history/link/suggest/sheet/create/edit/bom) used
// to pick its own full-color background — a different color per panel, with
// nothing else in common. One shell now: a white card, a colored left
// accent + icon that still says at a glance which panel this is, consistent
// padding everywhere. Quieter, and one less thing to keep in sync.
function ActionPanel({ accent, icon, title, right, children }) {
  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderLeft: `4px solid ${accent}`, borderRadius: 8, padding: "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 10, flexWrap: "wrap" }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: "0.04em", display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
          <span style={{ fontSize: 12 }}>{icon}</span>{title}
        </p>
        {right}
      </div>
      {children}
    </div>
  );
}

// ── price timeline visualization ──────────────────────────────────────────────
function PriceTimeline({ histories, onDelete, onAdd }) {
  if (histories.length === 0) return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
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
    <ActionPanel accent={C.blue} icon="📅" title="New Price Entry" right={
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, color: C.gray500 }}>Final: <strong style={{ fontFamily: "monospace", color: C.orange }}>{fmt(preview)}</strong></span>
        <button onClick={onCancel} style={btn("ghost", "sm")}>Cancel</button>
        <button onClick={save} disabled={saving} style={btn("primary", "sm")}>{saving ? "Saving…" : "Save"}</button>
      </div>
    }>
      <PriceFields form={form} setForm={setForm} cols="1fr 1fr 1fr 1fr 2fr" showNotes />
      {err && <p style={{ color: C.red, fontSize: 12, marginTop: 6 }}>{err}</p>}
    </ActionPanel>
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
    <ActionPanel accent={C.green} icon="➕" title="Create New Child SKU" right={
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, color: C.gray500 }}>Final: <strong style={{ fontFamily: "monospace", color: C.green }}>{fmt(preview)}</strong></span>
        <button onClick={onCancel} style={btn("ghost", "sm")}>Cancel</button>
        <button onClick={save} disabled={saving} style={btn("success", "sm")}>{saving ? "Saving…" : "Create"}</button>
      </div>
    }>
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
    </ActionPanel>
  );
}

// ── parent card ───────────────────────────────────────────────────────────────
function ParentCard({ parent, notify, onLink, dragging, unlinked = [], onOptOut, masterItems = [], sales }) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState(null); // null | "history" | "link" | "create" | "edit" | "suggest" | "sheet" | "rename" | "bom"
  const [dragOver, setDragOver] = useState(false);
  // Seeded from the parent, and re-seeded every time the Edit panel is opened
  // (see `toggle` below). Seeding only at mount meant a card that had been on
  // screen while its price moved — a master-list cascade, a price-history
  // entry, a teammate's edit, the 20s poll — still showed the price from
  // first render, and Save wrote that stale number straight back, silently
  // undoing the newer one. `?? ""` rather than `|| ""` so a genuine 0 shows
  // as 0 instead of blank.
  const formFromParent = useCallback(() => ({
    item_price: parent.item_price != null ? String(parent.item_price) : "",
    tax_percent: parent.tax_percent != null ? String(parent.tax_percent) : "0",
    packaging_cost: parent.packaging_cost != null ? String(parent.packaging_cost) : "0",
    image_url: parent.image_url || "",
  }), [parent.item_price, parent.tax_percent, parent.packaging_cost, parent.image_url]);
  const [editForm, setEditForm] = useState(formFromParent);
  const [imageBroken, setImageBroken] = useState(false);
  const [renameValue, setRenameValue] = useState(parent.item_id);
  const [savingEdit, setSavingEdit] = useState(false);
  const [renameErr, setRenameErr] = useState("");
  const [renaming, setRenaming] = useState(false);

  const idPath = encodeURIComponent(parent.item_id);

  // Children + history load once the card is open; suggestions and the bill
  // of materials load only once their own panel is opened. Each is its own
  // SWR key (conditional — null disables the hook, same idiom as the old
  // "fetch only if X" gates), so opening/closing panels is instant on a
  // second visit and a write anywhere re-validates automatically via
  // invalidatePricing() rather than a manually threaded refresh callback.
  const { data: childrenData, isLoading: childrenLoading } = useSWR(
    open ? `${API}/parent-prices/${idPath}/children/` : null
  );
  const { data: historyData, isLoading: historyLoading } = useSWR(
    open ? `${API}/parent-prices/${idPath}/price-history/` : null
  );
  const { data: suggestData, isLoading: suggestLoading } = useSWR(
    panel === "suggest" ? `${API}/parent-prices/${idPath}/suggestions/` : null
  );
  const { data: componentsData } = useSWR(
    panel === "bom" ? `${API}/parent-prices/${idPath}/components/` : null
  );

  const children = childrenData?.results ?? null;
  const histories = historyData ? (Array.isArray(historyData) ? historyData : historyData.results || []) : null;
  const suggestions = suggestData?.results ?? null;
  const components = componentsData?.results ?? null;

  const [sheetPick, setSheetPick] = useState({});   // sku_id -> true
  const [sheetPrice, setSheetPrice] = useState({ msp: "", wdrp: "", mrp: "" });
  const [sheetBusy, setSheetBusy] = useState(false);
  const [addMasterId, setAddMasterId] = useState("");
  const [addQty, setAddQty] = useState("1");
  const [bomBusy, setBomBusy] = useState(false);
  // Inline "create a master item without leaving this page" — the picker
  // only ever offers items that already exist, which sends you to a
  // different tab the moment the one you need isn't on the list yet.
  const [showNewMaster, setShowNewMaster] = useState(false);
  const [newMaster, setNewMaster] = useState({ name: "", unit_price: "", image_url: "" });
  const [newMasterBusy, setNewMasterBusy] = useState(false);

  // Counts come from the list payload, so the header is right before anything
  // is fetched; once loaded the fetched rows are the truth.
  const childCount     = children ? children.length : (parent.sku_count ?? 0);
  const historyCount   = histories ? histories.length : (parent.history_count ?? 0);
  const hasHistory     = historyCount > 0;
  const latestEntry    = histories && histories.length ? histories[histories.length - 1] : null;
  const componentCount = components ? components.length : (parent.component_count ?? 0);
  const hasComponents  = componentCount > 0;

  // Delivered-only sales for this group, from /parent-prices/sales/. Absent
  // entry = nothing delivered yet, which is a real answer, not missing data.
  const unitsSold   = sales?.units_sold || 0;
  const revenue     = sales?.revenue || 0;
  const lastSoldAgo = fmtAgo(sales?.last_sold);

  // A refresh may bring a new (or newly-working) image_url — give it another
  // chance instead of staying stuck on the "didn't load" badge forever.
  useEffect(() => { setImageBroken(false); }, [parent.image_url]);

  // Price trajectory summary text: "₹40 → ₹45 → ₹50"
  const trajectory = histories && histories.length > 1
    ? histories.map(h => fmt(h.final_price)).join(" → ")
    : null;

  const toggle = (p) => setPanel(prev => {
    const next = prev === p ? null : p;
    // Opening the Edit panel always starts from the price as it is right now,
    // not as it was when this card mounted.
    if (next === "edit") setEditForm(formFromParent());
    if (next === "rename") setRenameValue(parent.item_id);
    return next;
  });

  const deleteHistory = async pk => {
    if (!window.confirm("Remove this price entry?")) return;
    const r = await fetch(`${API}/parent-prices/${idPath}/price-history/${pk}/`, { method: "DELETE" });
    if (r.ok) { notify("ok", "Price entry removed."); invalidatePricing(); }
  };

  const linkSku = async skuId => {
    await onLink(skuId, parent.item_id);
    setPanel(null);
  };

  /** Link straight from a suggestion, without leaving the card. */
  const acceptSuggestion = async skuId => {
    await onLink(skuId, parent.item_id);
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
      const res = await fetch(`${API}/parent-prices/${idPath}/price-sheet/`, {
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
  const rejectSuggestion = async skuId => { await onOptOut?.(skuId, true); };

  // ── Bill of materials (meesho_app/master_pricing.py) ────────────────────
  const addComponent = async () => {
    if (!addMasterId) return;
    const master = masterItems.find(m => String(m.id) === String(addMasterId));
    if (!master) return;
    setBomBusy(true);
    try {
      const r = await fetch(`${API}/parent-prices/${idPath}/components/`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ master_item_name: master.name, quantity: addQty || "1" }),
      });
      if (r.ok) {
        notify("ok", `${master.name} added to the recipe.`);
        setAddMasterId(""); setAddQty("1");
        invalidatePricing();
      } else {
        const e = await r.json().catch(() => ({}));
        notify("err", e.master_item_name?.[0] || "Could not add that item.");
      }
    } finally { setBomBusy(false); }
  };

  /** Create a brand-new master item without leaving the Pricing page, then
   * select it straight away so it's one click from being added as an
   * ingredient — the whole point of this shortcut is skipping the tab
   * switch to Master Pricing and back. */
  const createMasterItem = async () => {
    if (!newMaster.name.trim()) return;
    setNewMasterBusy(true);
    try {
      const r = await fetch(`${API}/master-items/`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newMaster.name.trim(), unit_price: newMaster.unit_price || null,
          image_url: newMaster.image_url.trim(),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        notify("ok", `"${d.name}" added to the master list.`);
        setAddMasterId(String(d.id));
        setNewMaster({ name: "", unit_price: "", image_url: "" });
        setShowNewMaster(false);
        invalidatePricing();
      } else {
        notify("err", d.name?.[0] || d.unit_price?.[0] || "Could not create that master item.");
      }
    } finally { setNewMasterBusy(false); }
  };

  const updateComponentQty = async (compId, qty) => {
    const r = await fetch(`${API}/parent-prices/${idPath}/components/${compId}/`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantity: qty }),
    });
    if (r.ok) invalidatePricing();
  };

  const removeComponent = async (compId) => {
    const r = await fetch(`${API}/parent-prices/${idPath}/components/${compId}/`, { method: "DELETE" });
    if (r.ok) { notify("ok", "Removed from the recipe."); invalidatePricing(); }
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
    if (r.ok) { notify("ok", `${skuId} unlinked.`); invalidatePricing(); }
    else notify("err", "Unlink failed.");
  };

  const deleteParent = async () => {
    if (!window.confirm(`Delete parent "${parent.item_id}" and unlink all ${childCount} SKUs?`)) return;
    const r = await fetch(`${API}/parent-prices/${idPath}/`, { method: "DELETE" });
    if (r.ok) { notify("ok", `${parent.item_id} deleted.`); invalidatePricing(); }
    else notify("err", "Delete failed.");
  };

  const saveEdit = async () => {
    // A parent built from the master list has its item_price owned by that
    // recipe (see the Bill of Materials panel) — the backend puts it straight
    // back even if this request sends one, so there's nothing to compute here
    // for that case; this field is disabled in that state anyway (below).
    if (savingEdit) return;
    setSavingEdit(true);
    try {
      const preview = calcFinal(editForm.item_price, editForm.tax_percent, editForm.packaging_cost);
      const r = await fetch(`${API}/parent-prices/${idPath}/`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...editForm, image_url: editForm.image_url.trim(), final_price: preview.toFixed(2) }),
      });
      const e = await r.json().catch(() => ({}));
      if (r.ok) {
        notify("ok", childCount
          ? `Parent updated — ${childCount} child SKU${childCount === 1 ? "" : "s"} repriced too.`
          : "Parent updated.");
        setPanel(null);
        invalidatePricing();
      } else {
        // Surface what the server actually said — a silent "Update failed."
        // on a validation error or a permission denial is indistinguishable
        // from the button not working at all.
        notify("err", e.item_id?.[0] || e.item_price?.[0] || e.image_url?.[0]
          || e.detail || e.error || `Update failed (${r.status}).`);
      }
    } catch {
      notify("err", "Update failed — network error.");
    } finally { setSavingEdit(false); }
  };

  const saveRename = async () => {
    const next = renameValue.trim();
    if (!next) { setRenameErr("Enter a name."); return; }
    if (next === parent.item_id) { setPanel(null); return; }
    setRenaming(true); setRenameErr("");
    try {
      const r = await fetch(`${API}/parent-prices/${idPath}/`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: next }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        notify("ok", `Renamed to "${next}".`);
        setPanel(null);
        invalidatePricing();
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

      {/* ── Card header — identity/price on row one, status badges and
          quick actions on row two, instead of one long wrapping line where
          a price could end up sandwiched between badges. ─────────────────── */}
      <div style={{ padding: "12px 16px", cursor: "pointer" }}
        onClick={() => { setOpen(o => !o); if (!open) setPanel(null); }}>

        {/* Row 1 — chevron, photo, identity, price */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: C.gray400, minWidth: 14 }}>{open ? "▼" : "▶"}</span>

          {/* Photo — pasted Meesho catalog image, or a badge saying there isn't one */}
          {parent.image_url && !imageBroken ? (
            <img
              src={parent.image_url}
              alt=""
              onError={() => setImageBroken(true)}
              style={{ width: 34, height: 34, borderRadius: 8, objectFit: "cover", border: `1px solid ${C.border}`, flexShrink: 0 }}
            />
          ) : (
            <span
              title={imageBroken ? "Image URL didn't load" : "No photo added yet"}
              style={{ width: 34, height: 34, borderRadius: 8, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: C.gray100, color: C.gray300, border: `1px solid ${C.gray200}`, fontSize: 14 }}
            >
              📷
            </span>
          )}

          <span style={{ fontFamily: "monospace", fontSize: 13.5, fontWeight: 700, color: C.orange, background: C.orangeLight, border: `1px solid ${C.orangeBorder}`, padding: "3px 10px", borderRadius: 6, whiteSpace: "nowrap" }}>
            📦 {parent.item_id}
          </span>

          <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 16, color: C.gray900, whiteSpace: "nowrap" }}>
            {fmt(parent.final_price)}
          </span>

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

          <div style={{ flex: 1, minWidth: 8 }} />

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

        {/* Row 2 — what this group has actually SOLD, then its catalogue
            status. Units delivered sits first and loudest: on a pricing
            screen, "how many of these have I actually sold" is the number
            every price decision hangs off, and it was missing entirely. */}
        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", marginTop: 9, paddingLeft: 26 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
            <span style={{ fontSize: 17, fontWeight: 900, color: unitsSold > 0 ? C.green : C.gray300, fontFamily: "monospace", lineHeight: 1 }}>
              {unitsSold.toLocaleString("en-IN")}
            </span>
            <span style={{ fontSize: 10, fontWeight: 700, color: C.gray500 }}>
              units sold
            </span>
            {unitsSold === 0 && (
              <span style={{ fontSize: 9.5, color: C.amber, fontWeight: 700, background: C.amberLight, border: `1px solid ${C.amberBorder}`, padding: "1px 6px", borderRadius: 10 }}>
                never sold
              </span>
            )}
          </div>

          {revenue > 0 && (
            <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
              <span style={{ fontSize: 13.5, fontWeight: 800, color: "#6D28D9", fontFamily: "monospace", lineHeight: 1 }}>
                {fmtCompact(revenue)}
              </span>
              <span style={{ fontSize: 10, fontWeight: 700, color: C.gray500 }}>revenue</span>
            </div>
          )}

          {lastSoldAgo && (
            <span style={{ fontSize: 10.5, color: C.gray400 }}>
              last sold <strong style={{ color: C.gray600, fontWeight: 700 }}>{lastSoldAgo}</strong>
            </span>
          )}

          <div style={{ width: 1, height: 16, background: C.gray200 }} />

          <span style={{ background: C.blueLight, color: C.blue, border: "1px solid #BFDBFE", padding: "2px 9px", borderRadius: 20, fontSize: 10.5, fontWeight: 700, whiteSpace: "nowrap" }}>
            {childCount} SKU{childCount !== 1 ? "s" : ""}
          </span>
          {hasHistory
            ? <span style={{ background: C.orangeLight, color: C.orange, border: `1px solid ${C.orangeBorder}`, padding: "2px 9px", borderRadius: 20, fontSize: 10.5, fontWeight: 700, whiteSpace: "nowrap" }}>
                {historyCount} price {historyCount === 1 ? "entry" : "entries"}
              </span>
            : <span style={{ background: C.gray100, color: C.gray400, border: `1px solid ${C.gray200}`, padding: "2px 9px", borderRadius: 20, fontSize: 10.5, whiteSpace: "nowrap" }}>
                no history
              </span>
          }
          {hasComponents && (
            <span title="This parent's price is computed from its bill of materials, not set by hand"
              style={{ background: "#EDE9FE", color: "#6D28D9", border: "1px solid #DDD6FE", padding: "2px 9px", borderRadius: 20, fontSize: 10.5, fontWeight: 700, whiteSpace: "nowrap" }}>
              🧩 {componentCount} ingredient{componentCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      {/* ── Expanded body ─────────────────────────────────────────────────────── */}
      {open && (
        <div style={{ borderTop: `1px solid ${C.gray100}` }}>

          {/* Action bar — the common actions on the left, record-management
              (rename/edit/delete) set apart on the right by the flexible
              spacer, same grouping as before, just visually tidier. */}
          <div style={{ display: "flex", gap: 6, padding: "10px 16px", background: C.gray50, flexWrap: "wrap", alignItems: "center" }}>
            <button onClick={() => toggle("history")} style={{ ...btn(panel === "history" ? "secondary" : "ghost", "sm"), fontSize: 11 }}>
              {panel === "history" ? "✕ Cancel" : "📅 Add Price Entry"}
            </button>
            <button onClick={() => toggle("link")} style={{ ...btn(panel === "link" ? "secondary" : "ghost", "sm"), fontSize: 11 }}>
              {panel === "link" ? "✕ Cancel" : "🔗 Link Existing SKU"}
            </button>
            <button onClick={() => toggle("suggest")} style={{ ...btn(panel === "suggest" ? "ghostOrange" : "ghost", "sm"), fontSize: 11 }}>
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
            <button onClick={() => toggle("bom")} style={{ ...btn(panel === "bom" ? "ghostOrange" : "ghost", "sm"), fontSize: 11 }}>
              {panel === "bom" ? "✕ Cancel" : "🧩 Bill of Materials"}
            </button>
            <div style={{ flex: 1, minWidth: 8 }} />
            <div style={{ width: 1, alignSelf: "stretch", background: C.gray200, margin: "0 2px" }} />
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
                <ActionPanel accent={C.orange} icon="✎" title="Rename Parent SKU">
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
                </ActionPanel>
              )}
              {panel === "history" && (
                <AddHistoryForm parentId={parent.item_id}
                  onSaved={() => { setPanel(null); invalidatePricing(); notify("ok", "Price entry added."); }}
                  onCancel={() => setPanel(null)} />
              )}
              {panel === "link" && (
                <ActionPanel accent={C.blue} icon="🔗" title="Link Existing SKU">
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <p style={{ fontSize: 12, color: C.gray600, whiteSpace: "nowrap" }}>★ = name-match suggestions · or drag a SKU from the tray above</p>
                    <SkuDropdown parentId={parent.item_id} onSelect={linkSku} unlinked={unlinked} />
                  </div>
                </ActionPanel>
              )}
              {panel === "suggest" && (
                <ActionPanel accent={C.orange} icon="✨" title="Suggestions">
                  <p style={{ fontSize: 11.5, color: C.gray600, marginBottom: 9, lineHeight: 1.6 }}>
                    Unlinked SKUs whose words match this group — scored against the parent
                    name <em>and</em> the SKUs already in it. <strong>Not this one</strong> takes
                    a SKU out of every linking list for good.
                  </p>
                  {suggestLoading && suggestions === null ? (
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
                </ActionPanel>
              )}
              {panel === "sheet" && (
                <ActionPanel accent={C.blue} icon="📄" title="Price Sheet">
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
                </ActionPanel>
              )}
              {panel === "create" && (
                <CreateChildForm parentId={parent.item_id} parentPrice={parent}
                  onSaved={() => { setPanel(null); invalidatePricing(); notify("ok", "Child SKU created."); }}
                  onCancel={() => setPanel(null)} />
              )}
              {panel === "edit" && (
                <ActionPanel accent={C.amber} icon="✏️" title="Direct Price Override" right={
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ fontSize: 12, color: C.gray500 }}>Preview: <strong style={{ fontFamily: "monospace", color: C.orange }}>{fmt(calcFinal(editForm.item_price, editForm.tax_percent, editForm.packaging_cost))}</strong></span>
                    <button onClick={saveEdit} disabled={savingEdit} style={btn("success", "sm")}>
                      {savingEdit ? "Saving…" : "Save"}
                    </button>
                  </div>
                }>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                    {[["Item Price (₹)", "item_price"], ["Tax %", "tax_percent"], ["Packaging (₹)", "packaging_cost"]].map(([label, key]) => {
                      const autoPriced = key === "item_price" && hasComponents;
                      return (
                        <div key={key}>
                          <label style={{ ...S.label, fontSize: 10 }}>{label}{autoPriced ? " (auto)" : ""}</label>
                          <input type="number" step="0.01" value={editForm[key]} disabled={autoPriced}
                            onChange={e => setEditForm(f => ({ ...f, [key]: e.target.value }))}
                            style={{ ...S.inp, fontSize: 12, ...(autoPriced ? { background: C.gray100, color: C.gray500, cursor: "not-allowed" } : {}) }} />
                        </div>
                      );
                    })}
                  </div>
                  {hasComponents && (
                    <p style={{ fontSize: 10.5, color: C.gray500, marginTop: 6 }}>
                      Item price is computed from this parent's <button onClick={() => setPanel("bom")}
                        style={{ background: "none", border: "none", padding: 0, color: "#6D28D9", fontWeight: 700, cursor: "pointer", fontSize: 10.5, textDecoration: "underline" }}>
                        bill of materials
                      </button> — change the ingredients there, not here.
                    </p>
                  )}
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-end", marginTop: 10 }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ ...S.label, fontSize: 10 }}>Photo — Meesho catalog image URL</label>
                      <input value={editForm.image_url} onChange={e => setEditForm(f => ({ ...f, image_url: e.target.value }))}
                        placeholder="https://images.meesho.com/images/products/..."
                        style={{ ...S.inp, fontSize: 12, fontFamily: "monospace" }} />
                      <p style={{ fontSize: 10.5, color: C.gray500, marginTop: 4 }}>
                        Paste the image URL from the product's Meesho listing — nothing is uploaded or stored
                        beyond the link. Leave blank to show the "no image" badge instead.
                      </p>
                    </div>
                    <ImageUrlPreview url={editForm.image_url} />
                  </div>
                </ActionPanel>
              )}
              {panel === "bom" && (
                <ActionPanel accent="#6D28D9" icon="🧩" title="Bill of Materials">
                  <p style={{ fontSize: 11.5, color: C.gray600, marginBottom: 10, lineHeight: 1.6 }}>
                    Build this parent's price from items in your <strong>Master Pricing</strong> list — e.g. 2x
                    Katori + 1x Plate. Item price becomes the sum automatically, and stays that way: raise
                    Katori's price anywhere and this updates on its own.
                  </p>
                  {panel === "bom" && components === null ? (
                    <p style={{ fontSize: 12, color: C.gray400 }}>Loading…</p>
                  ) : (
                    <>
                      {components && components.length > 0 && (
                        <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden", marginBottom: 10, background: C.white }}>
                          {components.map((c, i) => (
                            <div key={c.id} style={{
                              display: "flex", alignItems: "center", gap: 8, padding: "7px 10px",
                              background: i % 2 ? C.gray50 : C.white, borderBottom: `1px solid ${C.gray100}`,
                            }}>
                              <ImageUrlThumb url={c.master_item_image_url} size={26} />
                              <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: C.gray800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {c.master_item_name}
                              </span>
                              <span style={{ fontSize: 11, color: C.gray400, whiteSpace: "nowrap" }}>
                                {c.master_item_unit_price != null ? fmt(c.master_item_unit_price) : "no price yet"} ×
                              </span>
                              <input type="number" step="0.001" min="0" defaultValue={c.quantity}
                                onBlur={e => { const v = e.target.value; if (v && Number(v) !== Number(c.quantity)) updateComponentQty(c.id, v); }}
                                style={{ ...S.inp, width: 56, fontSize: 12, padding: "4px 6px", textAlign: "center" }} />
                              <span style={{ fontSize: 12.5, fontFamily: "monospace", fontWeight: 700, color: C.gray700, width: 72, textAlign: "right" }}>
                                {c.line_total != null ? fmt(c.line_total) : "—"}
                              </span>
                              <button onClick={() => removeComponent(c.id)} title="Remove"
                                style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 14, padding: "0 2px" }}>×</button>
                            </div>
                          ))}
                        </div>
                      )}

                      {!showNewMaster ? (
                        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                          {masterItems.length > 0 && (
                            <select value={addMasterId} onChange={e => setAddMasterId(e.target.value)}
                              style={{ ...S.inp, fontSize: 12, flex: "1 1 200px" }}>
                              <option value="">— pick a master item —</option>
                              {masterItems
                                .filter(m => !components?.some(c => c.master_item === m.id))
                                .map(m => (
                                  <option key={m.id} value={m.id}>
                                    {m.name}{m.unit_price != null ? ` (${fmt(m.unit_price)})` : " (no price yet)"}
                                  </option>
                                ))}
                            </select>
                          )}
                          {masterItems.length > 0 && (
                            <div style={{ flex: "0 0 90px" }}>
                              <input type="number" step="0.001" min="0" placeholder="Qty" value={addQty}
                                onChange={e => setAddQty(e.target.value)} style={{ ...S.inp, fontSize: 12 }} />
                            </div>
                          )}
                          {masterItems.length > 0 && (
                            <button onClick={addComponent} disabled={!addMasterId || bomBusy} style={btn("success", "sm")}>
                              {bomBusy ? "Adding…" : "+ Add"}
                            </button>
                          )}
                          <button onClick={() => setShowNewMaster(true)} style={btn("ghost", "sm")}>
                            🧱 New master item…
                          </button>
                        </div>
                      ) : (
                        <div style={{ padding: "10px 12px", borderRadius: 8, background: C.gray50, border: `1px dashed ${C.gray300}` }}>
                          <p style={{ fontSize: 10.5, fontWeight: 700, color: C.gray600, textTransform: "uppercase", marginBottom: 8 }}>
                            New master item — skips the Master Pricing tab
                          </p>
                          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                            <div style={{ flex: "1 1 140px" }}>
                              <label style={{ ...S.label, fontSize: 10 }}>Name *</label>
                              <input value={newMaster.name} onChange={e => setNewMaster(f => ({ ...f, name: e.target.value }))}
                                placeholder="e.g. Katori" style={{ ...S.inp, fontSize: 12 }}
                                onKeyDown={e => { if (e.key === "Enter") createMasterItem(); }} />
                            </div>
                            <div style={{ flex: "0 0 100px" }}>
                              <label style={{ ...S.label, fontSize: 10 }}>Price (₹)</label>
                              <input type="number" step="0.01" value={newMaster.unit_price}
                                onChange={e => setNewMaster(f => ({ ...f, unit_price: e.target.value }))} style={{ ...S.inp, fontSize: 12 }} />
                            </div>
                            <div style={{ flex: "1 1 160px" }}>
                              <label style={{ ...S.label, fontSize: 10 }}>Image URL</label>
                              <input value={newMaster.image_url} onChange={e => setNewMaster(f => ({ ...f, image_url: e.target.value }))}
                                placeholder="optional" style={{ ...S.inp, fontSize: 12, fontFamily: "monospace" }} />
                            </div>
                            <ImageUrlPreview url={newMaster.image_url} size={36} />
                            <button onClick={createMasterItem} disabled={!newMaster.name.trim() || newMasterBusy} style={btn("success", "sm")}>
                              {newMasterBusy ? "Creating…" : "Create"}
                            </button>
                            <button onClick={() => setShowNewMaster(false)} style={btn("ghost", "sm")}>Cancel</button>
                          </div>
                        </div>
                      )}
                      {masterItems.length === 0 && !showNewMaster && (
                        <p style={{ fontSize: 11, color: C.gray400, marginTop: 6, fontStyle: "italic" }}>
                          No master items yet — create your first one right here.
                        </p>
                      )}
                    </>
                  )}
                </ActionPanel>
              )}
            </div>
          )}

          {/* Price timeline */}
          <div style={{ padding: "14px 16px", borderBottom: `1px solid ${C.gray100}` }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: C.gray500, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>Price History</p>
            {historyLoading && histories === null
              ? <p style={{ fontSize: 12, color: C.gray400 }}>Loading price history…</p>
              : <PriceTimeline histories={histories || []} onDelete={deleteHistory} onAdd={() => setPanel("history")} />}
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

            {childrenLoading && children === null ? (
              <p style={{ fontSize: 12, color: C.gray400 }}>Loading child SKUs…</p>
            ) : childCount > 0 ? (
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden", overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={{ ...S.th, fontSize: 10 }}>SKU ID</th>
                      <th style={{ ...S.th, fontSize: 10, textAlign: "right" }} title="Units delivered — the SKUs that actually sold">Sold</th>
                      <th style={{ ...S.th, fontSize: 10, textAlign: "right" }}>Orders</th>
                      <th style={{ ...S.th, fontSize: 10, textAlign: "right" }}>Item Price</th>
                      <th style={{ ...S.th, fontSize: 10, textAlign: "right" }}>Tax %</th>
                      <th style={{ ...S.th, fontSize: 10, textAlign: "right" }}>Final Price</th>
                      <th style={{ ...S.th, fontSize: 10, width: 60 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {(children || []).map((ch, i) => (
                      <tr key={ch.id ?? ch.sku_id} style={{ background: i % 2 === 0 ? C.white : C.gray50 }}>
                        <td style={S.td}>
                          <span style={{ fontFamily: "monospace", fontSize: 11, color: C.blue, fontWeight: 600, background: C.blueLight, padding: "2px 7px", borderRadius: 4, border: "1px solid #BFDBFE" }}>
                            ↳ {ch.sku_id}
                          </span>
                        </td>
                        <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: ch.units_sold ? C.green : C.gray300 }}>
                          {(ch.units_sold || 0).toLocaleString("en-IN")}
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
  const [form, setForm] = useState({ item_id: "", item_price: "", tax_percent: "0", packaging_cost: "0", image_url: "" });
  const [saving, setSaving] = useState(false); const [err, setErr] = useState(null);
  const preview = calcFinal(form.item_price, form.tax_percent, form.packaging_cost);

  const save = async () => {
    if (!form.item_id.trim()) return setErr("Parent ID required.");
    if (parseFloat(form.item_price) <= 0) return setErr("Price required.");
    setSaving(true); setErr(null);
    const res = await fetch(`${API}/parent-prices/`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, image_url: form.image_url.trim(), final_price: preview.toFixed(2) }),
    });
    setSaving(false);
    if (res.ok) { notify("ok", `"${form.item_id}" created.`); onSaved(); }
    else { const e = await res.json(); setErr(Object.values(e).flat().join(" ")); }
  };

  return (
    <div style={{ background: C.white, border: `2px solid ${C.orange}`, borderRadius: 12, padding: "18px 20px", boxShadow: "0 4px 16px rgba(232,81,10,0.12)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
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
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", marginTop: 12 }}>
        <div style={{ flex: 1 }}>
          <label style={S.label}>Photo — Meesho catalog image URL</label>
          <input value={form.image_url} onChange={e => setForm(f => ({ ...f, image_url: e.target.value }))}
            placeholder="https://images.meesho.com/images/products/... (optional)"
            style={{ ...S.inp, fontFamily: "monospace" }} />
        </div>
        <ImageUrlPreview url={form.image_url} />
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
        <div style={{ padding: "14px 20px", borderTop: `1px solid ${C.gray100}`, display: "flex", alignItems: "center", justifyContent: "space-between", background: C.gray50, flexWrap: "wrap", gap: 10 }}>
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
  const { activeBusiness } = useBusiness();
  const pricingPartners = activeBusiness?.pricing_partners || [];
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [msg, setMsg] = useState(null);
  const [showMissing, setShowMissing] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [dragging, setDragging] = useState(null);
  // The catalogue arrives alphabetically, which answers no question anyone
  // actually has. Sorting by what sells and filtering to what needs work are
  // what make a 144-group list navigable.
  const [sortBy, setSortBy] = useState("units");
  const [attention, setAttention] = useState(null); // null | "no_history" | "never_sold" | "no_price"
  const [linkOpen, setLinkOpen] = useState(true);

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

  // Debounced so typing a SKU doesn't fire a request per character.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), search ? 300 : 0);
    return () => clearTimeout(t);
  }, [search]);

  // Searching is the server's job: it matches parent ids *and* child SKUs, and
  // the browser never holds every child to filter on. refreshInterval (see
  // LIVE above) means a price changed elsewhere — another tab, a linked
  // business's sync, a master-item cascade — shows up here on its own.
  const { data: parentsData, isLoading: loading } = useSWR(parentsKey(debouncedSearch), LIVE);
  const parents = parentsData?.results || [];

  // "Hidden" is the same list, filtered the other way — so a SKU you removed
  // is always one click from coming back rather than being lost.
  const { data: unlinkedData } = useSWR(unlinkedKey(showHidden), LIVE);
  const unlinked = unlinkedData?.results || [];
  const hiddenCount = unlinkedData?.hidden_count || 0;
  // The Analytics donut always shows the true unlinked/hidden split regardless
  // of which view the Link Center is toggled to — same SWR key as above when
  // showHidden is already false, so this is a cache hit, not an extra request.
  const { data: unlinkedStableData } = useSWR(unlinkedKey(false), LIVE);
  const trueUnlinkedCount = showHidden ? (unlinkedStableData?.results?.length ?? 0) : unlinked.length;

  // The master price list (see Master Pricing tab) — every card's "add
  // ingredient" picker reads this without its own request.
  const { data: masterItemsData } = useSWR(masterItemsKey(), LIVE);
  const masterItems = masterItemsData?.results || [];

  // This used to come off /profit/ — nearly four seconds of settlement maths
  // to produce a list of SKU names. Its own endpoint answers in ~70ms.
  const { data: missingData } = useSWR(missingKey());
  const missingSkus = missingData?.results || [];

  // What each parent has actually SOLD (delivered units, revenue, last sold).
  // Its own endpoint, and deliberately NOT on the LIVE poll: the sales
  // roll-up only moves when a new order report is uploaded, so paying for it
  // every 20 seconds would be waste. Focus revalidation catches an upload
  // done in another tab.
  const { data: salesData } = useSWR(salesKey());
  const sales = salesData?.results || {};

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
    invalidatePricing();
    return true;
  }, [notify]);

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
        const parentsCount = (data.parents_created || 0) + (data.parents_updated || 0);
        const skus = (data.skus_created || 0) + (data.skus_updated || 0);
        let text = `Uploaded — ${parentsCount} parent(s), ${skus} SKU(s).`;
        if (data.skipped) text += ` ${data.skipped} skipped.`;
        if (data.unlinked_parent_refs) text += ` ${data.unlinked_parent_refs} SKU(s) referenced a missing parent.`;
        notify("ok", text);
        invalidatePricing();
      } else {
        notify("err", data.error || "Upload failed.");
      }
    } catch {
      notify("err", "Network error during upload.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }, [notify]);

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
    if (r.ok) { notify("ok", `${skuId} → ${parentId} linked.`); invalidatePricing(); }
    else notify("err", `Could not link ${skuId}.`);
  }, [notify]);

  const quickUnlinked = unlinked.filter(s =>
    !linkQuery || s.sku_id.toLowerCase().includes(linkQuery.toLowerCase())
  );

  // "Easier to link": a best-guess target parent per unlinked SKU, by shared
  // words with each parent's id — the same matching idea nameSuggestions()
  // already uses the other direction (a parent's own suggestions panel).
  // Lets a row link in one click without first picking a target above.
  const suggestedParentFor = useMemo(() => {
    const parentWordSets = parents.map(p => ({
      item_id: p.item_id,
      words: p.item_id.toLowerCase().split(/[_\-\s]+/).filter(w => w.length > 2),
    }));
    const map = {};
    for (const sku of unlinked) {
      const skuWords = sku.sku_id.toLowerCase().split(/[_\-\s]+/).filter(w => w.length > 2);
      let best = null, bestScore = 0;
      for (const p of parentWordSets) {
        const score = p.words.reduce((n, w) => n + (skuWords.includes(w) ? 1 : 0), 0);
        if (score > bestScore) { bestScore = score; best = p.item_id; }
      }
      if (best) map[sku.sku_id] = best;
    }
    return map;
  }, [parents, unlinked]);

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
        invalidatePricing();
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

  // ── Sales-joined, sorted, filtered catalogue ──────────────────────────
  // The list the user actually reads. Sales come from their own endpoint, so
  // a parent with no entry simply hasn't sold anything yet (0, not unknown).
  const unitsOf   = p => sales[p.item_id]?.units_sold || 0;
  const revenueOf = p => sales[p.item_id]?.revenue || 0;

  const totalUnitsSold = parents.reduce((a, p) => a + unitsOf(p), 0);
  const totalRevenue   = parents.reduce((a, p) => a + revenueOf(p), 0);
  const neverSold      = parents.filter(p => unitsOf(p) === 0).length;

  const visibleParents = useMemo(() => {
    let rows = parents;
    if (attention === "no_history") rows = rows.filter(p => (p.history_count || 0) === 0);
    else if (attention === "never_sold") rows = rows.filter(p => !(sales[p.item_id]?.units_sold));
    else if (attention === "no_price") rows = rows.filter(p => !p.final_price || Number(p.final_price) <= 0);

    const sorted = [...rows];
    if (sortBy === "units") sorted.sort((a, b) => (sales[b.item_id]?.units_sold || 0) - (sales[a.item_id]?.units_sold || 0));
    else if (sortBy === "revenue") sorted.sort((a, b) => (sales[b.item_id]?.revenue || 0) - (sales[a.item_id]?.revenue || 0));
    else if (sortBy === "price") sorted.sort((a, b) => (Number(b.final_price) || 0) - (Number(a.final_price) || 0));
    else if (sortBy === "skus") sorted.sort((a, b) => (b.sku_count || 0) - (a.sku_count || 0));
    else sorted.sort((a, b) => a.item_id.localeCompare(b.item_id));
    return sorted;
  }, [parents, sales, sortBy, attention]);

  // ── Analytics ─────────────────────────────────────────────────────────
  const linkingChartData = [
    { id: "Linked", label: "Linked", value: totalSkus, color: C.green },
    { id: "Unlinked", label: "Unlinked", value: trueUnlinkedCount, color: C.red },
    { id: "Hidden", label: "Hidden", value: hiddenCount, color: C.gray400 },
  ].filter(d => d.value > 0);
  const linkingTotal = linkingChartData.reduce((s, d) => s + d.value, 0);

  // What sells, not what's expensive. "Most expensive parent" answers no
  // pricing question; "what moves the most units / earns the most" does.
  const shortLabel = s => (s.length > 20 ? `${s.slice(0, 19)}…` : s);
  // ~34px of plot per bar + room for the value axis. A fixed floor stretched
  // a single-bar chart into one enormous block.
  const barHeight = n => n * 34 + 50;

  const bestSellersChart = [...parents]
    .filter(p => unitsOf(p) > 0)
    .sort((a, b) => unitsOf(b) - unitsOf(a))
    .slice(0, 8)
    .reverse() // horizontal bar reads highest-at-top when the dataset is bottom-to-top
    .map(p => ({ label: shortLabel(p.item_id), units_sold: unitsOf(p) }));

  const revenueChart = [...parents]
    .filter(p => revenueOf(p) > 0)
    .sort((a, b) => revenueOf(b) - revenueOf(a))
    .slice(0, 8)
    .reverse()
    .map(p => ({ label: shortLabel(p.item_id), revenue: Math.round(revenueOf(p)) }));

  const topMasterUsageChart = [...masterItems]
    .filter(m => (m.used_in_count || 0) > 0)
    .sort((a, b) => b.used_in_count - a.used_in_count)
    .slice(0, 8)
    .reverse()
    .map(m => ({ label: shortLabel(m.name), used_in_count: m.used_in_count }));

  // Glass-style action button for the dark studio header — `primary` gets a
  // solid white fill so "+ New Parent Group" still reads as the main action.
  const studioBtn = (primary = false) => ({
    padding: "9px 16px",
    borderRadius: 10,
    fontSize: 12.5,
    fontWeight: 700,
    cursor: "pointer",
    border: primary ? "1px solid #fff" : "1px solid rgba(255,255,255,0.22)",
    background: primary ? "#fff" : "rgba(255,255,255,0.1)",
    color: primary ? "#4C1D95" : "#fff",
    backdropFilter: "blur(6px)",
    transition: "transform 0.12s ease, background 0.12s ease",
    whiteSpace: "nowrap",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── Studio header — dark, confident chrome around a light workspace ── */}
      <div style={{
        borderRadius: 18,
        padding: "22px 24px",
        background: "linear-gradient(135deg, #140F22 0%, #2A1854 55%, #4C1D95 100%)",
        boxShadow: "0 12px 32px -12px rgba(76,29,149,0.45)",
        position: "relative", overflow: "hidden",
      }}>
        {/* Soft decorative glow — pure chrome, no content */}
        <div style={{ position: "absolute", top: -60, right: -40, width: 220, height: 220, borderRadius: "50%", background: "radial-gradient(circle, rgba(167,139,250,0.35) 0%, transparent 70%)", pointerEvents: "none" }} />
        <div style={{ display: "flex", justifyContent: "space-between", gap: 14, flexWrap: "wrap", alignItems: "center", position: "relative" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: "#C4B5FD" }}>
                Catalog · Pricing Workspace
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 700, color: "#86EFAC" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ADE80", boxShadow: "0 0 0 3px rgba(74,222,128,0.25)", animation: "pulse 2s infinite" }} />
                LIVE
              </span>
            </div>
            <h2 style={{ fontSize: 24, fontWeight: 900, color: "#fff", marginBottom: 5, letterSpacing: "-0.01em" }}>SKU Pricing Studio</h2>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.65)", maxWidth: 480 }}>
              Link SKUs to parents, price from a master ingredient list, and watch every number stay
              in sync automatically — on this screen, and anywhere this business shares pricing.
            </p>
            {pricingPartners.length > 0 && (
              <div style={{
                display: "inline-flex", alignItems: "center", gap: 6, marginTop: 10,
                background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.18)", color: "#fff",
                fontSize: 11.5, fontWeight: 700, padding: "4px 10px", borderRadius: 20,
              }}>
                🔗 Shared pricing with {pricingPartners.join(", ")} — editing a price here updates it there too.
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={handleDownload} style={studioBtn()} title="Export parents and SKUs together as a two-sheet Excel workbook">
              ⬇ Download Excel
            </button>
            <button
              onClick={() => fileRef.current && fileRef.current.click()}
              disabled={uploading}
              style={{ ...studioBtn(), opacity: uploading ? 0.6 : 1 }}
              title="Upload the Excel workbook to add/update parents and SKUs in one go"
            >
              {uploading ? "Uploading…" : "⬆ Upload Excel"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              style={{ display: "none" }}
              onChange={(e) => handleUpload(e.target.files?.[0])}
            />
            {missingSkus.length > 0 && (
              <button onClick={() => setShowMissing(o => !o)} style={{ ...studioBtn(), background: "rgba(248,113,113,0.18)", borderColor: "rgba(248,113,113,0.4)" }}>
                ⚠ {showMissing ? "Hide" : "Show"} Unpriced ({missingSkus.length})
              </button>
            )}
            <button onClick={() => setShowAdd(o => !o)} style={studioBtn(true)}>
              {showAdd ? "✕ Close" : "+ New Parent Group"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Analytics ─────────────────────────────────────────────────────── */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
          <span style={{ fontSize: 13 }}>📊</span>
          <h3 style={{ fontSize: 12.5, fontWeight: 800, color: C.gray700, textTransform: "uppercase", letterSpacing: "0.06em" }}>Analytics</h3>
        </div>

        {/* KPI tiles. The ones that describe a problem are buttons: clicking
            filters the catalogue below to exactly those parents, so a count
            like "38 never sold" becomes somewhere to go rather than a fact to
            read and forget. */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 12 }}>
          {[
            { label: "Units Sold", sub: "delivered", value: totalUnitsSold.toLocaleString("en-IN"), color: C.green, icon: "✅" },
            { label: "Revenue", sub: "delivered", value: fmtCompact(totalRevenue), color: "#6D28D9", icon: "💰" },
            { label: "Parent Groups", value: parents.length, color: C.orange, icon: "📦" },
            { label: "Linked SKUs", value: totalSkus, color: C.blue, icon: "🔗" },
            { label: "Never Sold", value: neverSold, color: C.amber, icon: "😴", filter: "never_sold" },
            { label: "No History", value: noHistory, color: C.gray500, icon: "⏳", filter: "no_history" },
            { label: "Unlinked SKUs", value: unlinked.length, color: C.red, icon: "⚠️" },
          ].map(t => {
            const active = t.filter && attention === t.filter;
            const clickable = !!t.filter;
            return (
              <div
                key={t.label}
                onClick={clickable ? () => setAttention(active ? null : t.filter) : undefined}
                title={clickable ? (active ? "Clear this filter" : `Show only the ${t.label.toLowerCase()} groups`) : undefined}
                style={{
                  ...S.card, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10,
                  cursor: clickable ? "pointer" : "default",
                  ...(active ? { borderColor: t.color, boxShadow: `0 0 0 2px ${t.color}33` } : {}),
                }}
              >
                <div style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, background: `${t.color}1A`, border: `1px solid ${t.color}33` }}>
                  {t.icon}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 10.5, color: C.gray500, fontWeight: 700, whiteSpace: "nowrap" }}>
                    {t.label}
                    {t.sub && <span style={{ color: C.gray300, fontWeight: 600 }}> · {t.sub}</span>}
                  </div>
                  <div style={{ fontSize: 21, fontWeight: 900, color: t.color, lineHeight: 1.1 }}>{t.value}</div>
                  {clickable && (
                    <div style={{ fontSize: 9.5, fontWeight: 700, color: active ? t.color : C.gray300 }}>
                      {active ? "✕ filtering" : "click to filter"}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Top row: a compact donut (its legend reads as progress bars, not a
            cramped dot-list) beside the priced-parents ranking, each with its
            own generous column so neither chart has to fight for width. The
            usage chart below gets a full-width row of its own for the same
            reason — a ranked bar list reads best wide, not squeezed into a
            third of the row. */}
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(240px, 0.85fr) minmax(360px, 1.4fr)", gap: 12, marginBottom: 12 }}>
          <div style={S.card}>
            <p style={S.cardTitle}>Linking Status</p>
            {linkingTotal === 0 ? (
              <p style={{ fontSize: 12, color: C.gray400 }}>No SKUs yet.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, paddingTop: 4 }}>
                <div style={{ position: "relative", width: 136, height: 136 }}>
                  <AppPieChart data={linkingChartData} height={136} valueFormatter={(v) => v.toLocaleString("en-IN")} />
                  <div style={{
                    position: "absolute", inset: 0, display: "flex", flexDirection: "column",
                    alignItems: "center", justifyContent: "center", pointerEvents: "none",
                  }}>
                    <span style={{ fontSize: 22, fontWeight: 900, color: C.gray900, lineHeight: 1 }}>{linkingTotal}</span>
                    <span style={{ fontSize: 9, fontWeight: 700, color: C.gray400, textTransform: "uppercase", letterSpacing: "0.04em" }}>total SKUs</span>
                  </div>
                </div>
                <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 9 }}>
                  {linkingChartData.map(d => {
                    const pct = Math.round((d.value / linkingTotal) * 100);
                    return (
                      <div key={d.id}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, marginBottom: 3 }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 5, color: C.gray600, fontWeight: 600 }}>
                            <span style={{ width: 8, height: 8, borderRadius: "50%", background: d.color, flexShrink: 0 }} />
                            {d.label}
                          </span>
                          <span style={{ fontFamily: "monospace", fontWeight: 700, color: C.gray800, whiteSpace: "nowrap" }}>
                            {d.value.toLocaleString("en-IN")} <span style={{ color: C.gray400, fontWeight: 600 }}>· {pct}%</span>
                          </span>
                        </div>
                        <div style={{ height: 6, borderRadius: 3, background: C.gray100, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${pct}%`, background: d.color, borderRadius: 3, transition: "width 0.3s ease" }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div style={S.card}>
            <p style={S.cardTitle}>Best Sellers — units delivered</p>
            {bestSellersChart.length === 0 ? (
              <p style={{ fontSize: 12, color: C.gray400 }}>
                No delivered orders matched to a parent yet — link SKUs to parents and sales roll up here.
              </p>
            ) : (
              <AppBarChart dataset={bestSellersChart} indexKey="label" layout="horizontal" colorful
                series={[{ dataKey: "units_sold", label: "Units" }]}
                height={barHeight(bestSellersChart.length)}
                valueFormatter={(v) => `${v.toLocaleString("en-IN")} units`}
                axisValueFormatter={(v) => v.toLocaleString("en-IN")} valueTicks={5} />
            )}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1.4fr 1fr", gap: 12 }}>
          <div style={S.card}>
            <p style={S.cardTitle}>Revenue by Parent — delivered</p>
            {revenueChart.length === 0 ? (
              <p style={{ fontSize: 12, color: C.gray400 }}>No delivered revenue to show yet.</p>
            ) : (
              <AppBarChart dataset={revenueChart} indexKey="label" layout="horizontal" colorful
                series={[{ dataKey: "revenue", label: "Revenue" }]}
                height={barHeight(revenueChart.length)}
                valueFormatter={fmt} axisValueFormatter={fmtCompact} valueTicks={5} />
            )}
          </div>

          <div style={S.card}>
            <p style={S.cardTitle}>Most-Used Master Items</p>
            {topMasterUsageChart.length === 0 ? (
              <p style={{ fontSize: 12, color: C.gray400 }}>
                No master item is used by a parent yet — build a recipe in any card's "Bill of Materials" panel.
              </p>
            ) : (
              <AppBarChart dataset={topMasterUsageChart} indexKey="label" layout="horizontal" colorful
                series={[{ dataKey: "used_in_count", label: "Parents" }]}
                height={barHeight(topMasterUsageChart.length)}
                valueFormatter={(v) => `${v} parent${v === 1 ? "" : "s"}`}
                axisValueFormatter={(v) => (Number.isInteger(v) ? String(v) : "")} valueTicks={4} />
            )}
          </div>
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

      {showAdd && <AddParentForm notify={notify} onSaved={() => { setShowAdd(false); invalidatePricing(); }} onCancel={() => setShowAdd(false)} />}

      <div style={{
        display: "grid",
        // A 300px-minimum column beside a 1fr sibling cannot fit a 390px
        // screen, so the Link Center stacks above the list on mobile.
        // Collapsed, it yields its whole column to the catalogue: linking is
        // an occasional job, pricing is the everyday one, and a permanent
        // 360px sidebar taxed the common case for the rare one.
        gridTemplateColumns: isMobile
          ? "minmax(0, 1fr)"
          : linkOpen ? "minmax(300px, 360px) minmax(0, 1fr)" : "auto minmax(0, 1fr)",
        gap: 14,
        alignItems: "start",
      }}>

        {/* Collapsed, the Link Center becomes a vertical rail that still
            reports how many SKUs are waiting — the unlinked count is the one
            thing you need to see even when you're not linking. */}
        {!linkOpen && !isMobile ? (
          <button
            onClick={() => setLinkOpen(true)}
            title="Open the Link Center"
            style={{
              ...S.card, padding: "14px 10px", minWidth: 0, cursor: "pointer", fontFamily: "inherit",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
              border: `1px solid ${unlinked.length > 0 ? C.redBorder : C.border}`,
              position: "sticky", top: 8,
            }}
          >
            <span style={{ fontSize: 15 }}>🔗</span>
            {unlinked.length > 0 && (
              <span style={{
                background: C.redLight, color: C.red, border: `1px solid ${C.redBorder}`,
                borderRadius: 20, fontSize: 11, fontWeight: 800, padding: "2px 7px",
              }}>{unlinked.length}</span>
            )}
            <span style={{
              fontSize: 11, fontWeight: 800, color: C.gray500, letterSpacing: "0.08em",
              writingMode: "vertical-rl", textTransform: "uppercase",
            }}>
              Link Center
            </span>
            <span style={{ fontSize: 11, color: C.gray400 }}>›</span>
          </button>
        ) : (
        <div style={{
          ...S.card, padding: 0, height: "fit-content", minWidth: 0, overflow: "hidden",
          // Sticky is only useful next to a long scrolling list; stacked on
          // mobile it would pin the panel over the content below it.
          ...(isMobile ? {} : { position: "sticky", top: 8 }),
        }}>
          <div style={{
            padding: "12px 16px",
            background: "linear-gradient(135deg, #2A1854 0%, #4C1D95 100%)",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <h3 style={{ fontSize: 14, fontWeight: 800, color: "#fff", display: "flex", alignItems: "center", gap: 7 }}>
                <span>🔗</span> Link Center
              </h3>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{
                  background: showHidden ? "rgba(255,255,255,0.12)" : "rgba(248,113,113,0.22)",
                  color: showHidden ? "#fff" : "#FCA5A5",
                  border: `1px solid ${showHidden ? "rgba(255,255,255,0.22)" : "rgba(248,113,113,0.4)"}`,
                  padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
                  {unlinked.length} {showHidden ? "hidden" : "unlinked"}
                </span>
                {!isMobile && (
                  <button onClick={() => setLinkOpen(false)} title="Collapse — give the catalogue the full width"
                    style={{
                      background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.2)",
                      color: "#fff", borderRadius: 6, cursor: "pointer", fontFamily: "inherit",
                      fontSize: 12, lineHeight: 1, padding: "4px 7px",
                    }}>‹</button>
                )}
              </div>
            </div>
          </div>
          <div style={{ padding: 14 }}>
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
                      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 1, flexWrap: "wrap" }}>
                        {s.has_price
                          ? <span style={{ fontSize: 10, fontFamily: "monospace", color: C.gray400 }}>{fmt(s.final_price)}</span>
                          : <span style={{ fontSize: 8, fontWeight: 800, color: C.white, background: C.green, padding: "1px 5px", borderRadius: 10 }}>NEW</span>}
                        {s.order_count > 0 && <span style={{ fontSize: 10, color: C.gray400 }}>📦 {s.order_count}</span>}
                        {!showHidden && suggestedParentFor[s.sku_id] && (
                          <button
                            onClick={(e) => { e.stopPropagation(); linkSku(s.sku_id, suggestedParentFor[s.sku_id]); }}
                            title={`One-click link to the best-matching parent, ${suggestedParentFor[s.sku_id]}`}
                            style={{
                              display: "inline-flex", alignItems: "center", gap: 3, border: "none", cursor: "pointer",
                              background: "#EDE9FE", color: "#6D28D9", fontSize: 9.5, fontWeight: 700,
                              padding: "1px 7px", borderRadius: 10, fontFamily: "inherit", maxWidth: 150,
                            }}
                          >
                            <span>✨→</span>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{suggestedParentFor[s.sku_id]}</span>
                          </button>
                        )}
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
        </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Search + sort + active filter. Sorting is the fix for a catalogue
              that only ever arrived alphabetically: "best selling" is the
              order someone making pricing decisions actually wants. */}
          <div style={{ ...S.card, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search parent ID or child SKU"
                style={{ ...S.inp, maxWidth: 300, fontSize: 12 }}
              />
              {search && <button onClick={() => setSearch("")} style={btn("ghost", "sm")}>Clear</button>}
              <div style={{ flex: 1, minWidth: 4 }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: C.gray500 }}>Sort</span>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {[
                  { key: "units", label: "Best selling" },
                  { key: "revenue", label: "Revenue" },
                  { key: "price", label: "Price" },
                  { key: "skus", label: "Most SKUs" },
                  { key: "name", label: "A–Z" },
                ].map(s => {
                  const on = sortBy === s.key;
                  return (
                    <button key={s.key} onClick={() => setSortBy(s.key)}
                      style={{
                        padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                        cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
                        border: `1px solid ${on ? "#6D28D9" : C.gray200}`,
                        background: on ? "#EDE9FE" : C.white,
                        color: on ? "#6D28D9" : C.gray500,
                      }}>
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: C.gray500 }}>
                Showing <strong style={{ color: C.gray800 }}>{visibleParents.length}</strong> of {parents.length} group{parents.length === 1 ? "" : "s"}{search ? " matching" : ""}
              </span>
              {attention && (
                <button onClick={() => setAttention(null)}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer",
                    border: `1px solid ${C.amberBorder}`, background: C.amberLight, color: C.amber,
                    fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, fontFamily: "inherit",
                  }}>
                  {{ no_history: "⏳ No price history", never_sold: "😴 Never sold", no_price: "⚠ No price set" }[attention]} ✕
                </button>
              )}
            </div>
          </div>

          {loading ? (
            <div style={{ textAlign: "center", padding: 48, color: C.gray400 }}>Loading pricing data...</div>
          ) : visibleParents.length === 0 ? (
            <div style={{ textAlign: "center", padding: 48, color: C.gray400, fontSize: 13 }}>
              {attention
                ? "No groups match that filter — everything here is in good shape."
                : search ? "No results matching your search." : "No parent SKUs yet - create your first parent group."}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {visibleParents.map(p => (
                <ParentCard key={p.item_id} parent={p} notify={notify} onOptOut={setOptOut}
                  onLink={linkSku} dragging={dragging} unlinked={unlinked} masterItems={masterItems}
                  sales={sales[p.item_id]} />
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
            invalidatePricing();
          }}
        />
      )}
    </div>
  );
}
