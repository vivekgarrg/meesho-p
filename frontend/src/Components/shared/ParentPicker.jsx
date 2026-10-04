import React, { useEffect, useState } from "react";
import { API, C, S } from "../../App";

/**
 * "Which parent SKU is this for?" — choose an existing parent or create one.
 *
 * Shared by the Quadrant Cropper (photos are linked to the parent) and Bulk
 * Listing (generated SKUs are linked under it), so both ask the question the
 * same way and enforce the same rule: a NEW parent needs its price, tax and
 * packaging, because every SKU under it is costed at that price. The server
 * enforces the same rule (clean_new_parent_pricing); this just says so first.
 *
 * Controlled: `value` comes from emptyParentChoice() and goes back out through
 * onChange. parentChoicePayload(value) is what to send to the server.
 */

// India's GST slabs — a choice rather than free typing, so a typo like "180"
// can't create a mis-taxed parent. The server accepts any whole number 0–28.
export const GST_SLABS = ["0", "3", "5", "12", "18", "28"];

/** Same arithmetic as the server (master_pricing.compute_final_price). */
export const previewFinal = (ip, tax, pkg) => {
  const i = parseFloat(ip), t = parseFloat(tax), k = parseFloat(pkg);
  if (![i, t, k].every(Number.isFinite)) return null;
  return Math.round((i + (i * t) / 100 + k) * 100) / 100;
};

/** "Brass Pooja Plate 6 inch" -> "BRASS-POOJA-PLATE-6-INCH": the shape parent
 *  SKU ids already take everywhere else, offered as an editable default. */
export function suggestParentId(name) {
  return (name || "").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

export const emptyParentChoice = (newId = "") => ({
  mode: "existing",
  picked: "",
  newId,
  pricing: { item_price: "", tax_percent: "", packaging_cost: "" },
});

/** Field-by-field validity of a "create new" choice. */
function newParentProblems(v) {
  const p = {};
  if (!v.newId.trim()) p.newId = true;
  const ip = Number(v.pricing.item_price);
  if (v.pricing.item_price.trim() === "" || !Number.isFinite(ip) || ip <= 0) p.item_price = true;
  if (v.pricing.tax_percent === "") p.tax_percent = true;
  const pk = Number(v.pricing.packaging_cost);
  if (v.pricing.packaging_cost.trim() === "" || !Number.isFinite(pk) || pk < 0) p.packaging_cost = true;
  return p;
}

/** Is the choice complete enough to send? */
export function parentChoiceReady(v) {
  if (!v) return false;
  if (v.mode === "existing") return !!v.picked;
  return Object.keys(newParentProblems(v)).length === 0;
}

/** The parent as the server expects it, or null if not ready. */
export function parentChoicePayload(v) {
  if (!parentChoiceReady(v)) return null;
  if (v.mode === "existing") return { parent_id: v.picked, create: false };
  return { parent_id: v.newId.trim(), create: true, ...v.pricing };
}

/** Short human label for summaries: "BRASS-DIYA" / "new: BRASS-DIYA". */
export function parentChoiceLabel(v) {
  if (!parentChoiceReady(v)) return "";
  return v.mode === "existing" ? v.picked : `new: ${v.newId.trim()}`;
}

export function ParentPicker({ value, onChange, autoFocus = true }) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const v = value;
  const set = (patch) => onChange({ ...v, ...patch });
  const setPrice = (k) => (e) => onChange({ ...v, pricing: { ...v.pricing, [k]: e.target.value } });

  useEffect(() => {
    if (v.mode !== "existing") return undefined;
    const t = setTimeout(() => {
      setLoading(true);
      fetch(`${API}/parent-lookup/?search=${encodeURIComponent(search.trim())}`)
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((d) => setResults(d.results || []))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [search, v.mode]);

  const problems = v.mode === "new" ? newParentProblems(v) : {};
  const finalPreview = previewFinal(v.pricing.item_price, v.pricing.tax_percent, v.pricing.packaging_cost);
  // Only flag a field red once something has been typed into it — a fresh
  // form that is all red reads as an error before anything happened.
  const red = (k, typed) => (problems[k] && typed ? { borderColor: C.red } : {});

  const tabBtn = (id, label) => (
    <button key={id} type="button" onClick={() => set({ mode: id })}
      style={{ border: "none", cursor: "pointer", fontFamily: "inherit", padding: "7px 14px", borderRadius: 8,
        background: v.mode === id ? C.white : "transparent", color: v.mode === id ? C.gray800 : C.gray500,
        fontWeight: v.mode === id ? 800 : 600, fontSize: 12.5,
        boxShadow: v.mode === id ? "0 1px 3px rgba(0,0,0,0.10)" : "none" }}>
      {label}
    </button>
  );

  return (
    <div>
      <div style={{ display: "inline-flex", background: C.gray100, borderRadius: 10, padding: 3,
        border: `1px solid ${C.border}` }}>
        {tabBtn("existing", "Choose existing")}
        {tabBtn("new", "Create new")}
      </div>

      {v.mode === "existing" ? (
        <div style={{ marginTop: 12 }}>
          <input autoFocus={autoFocus} value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search parent SKUs…" style={{ ...S.inp, fontSize: 13 }} />
          <div style={{ marginTop: 8, border: `1px solid ${C.border}`, borderRadius: 8,
            maxHeight: 220, overflowY: "auto" }}>
            {loading && results.length === 0 ? (
              <div style={{ padding: 12, fontSize: 12, color: C.gray400 }}>Searching…</div>
            ) : results.length === 0 ? (
              <div style={{ padding: 12, fontSize: 12, color: C.gray400 }}>
                No parent matches. Use "Create new" to add one.
              </div>
            ) : results.map((r) => (
              <div key={r.item_id} onClick={() => set({ picked: r.item_id })}
                style={{ padding: "8px 11px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
                  borderBottom: `1px solid ${C.gray100}`,
                  background: v.picked === r.item_id ? C.orangeLight : C.white }}>
                <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 12.5, color: C.gray800,
                  flex: 1, minWidth: 0, wordBreak: "break-all" }}>
                  {v.picked === r.item_id ? "✓ " : ""}{r.item_id}
                </span>
                <span style={{ fontSize: 11, color: C.gray400, whiteSpace: "nowrap" }}>
                  {r.sku_count} SKU{r.sku_count === 1 ? "" : "s"} · {r.image_count} photo{r.image_count === 1 ? "" : "s"}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          <label style={S.label}>New parent SKU id *</label>
          <input autoFocus={autoFocus} value={v.newId} onChange={(e) => set({ newId: e.target.value })}
            style={{ ...S.inp, fontFamily: "monospace", fontSize: 13 }} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8, marginTop: 10 }}>
            <div>
              <label style={S.label}>Item price (₹) *</label>
              <input type="text" inputMode="decimal" value={v.pricing.item_price} onChange={setPrice("item_price")}
                placeholder="e.g. 120" style={{ ...S.inp, fontSize: 13, ...red("item_price", v.pricing.item_price) }} />
            </div>
            <div>
              <label style={S.label}>Tax % *</label>
              <select value={v.pricing.tax_percent} onChange={setPrice("tax_percent")} style={{ ...S.inp, fontSize: 13 }}>
                <option value="">Choose…</option>
                {GST_SLABS.map((t) => <option key={t} value={t}>{t}%</option>)}
              </select>
            </div>
            <div>
              <label style={S.label}>Packaging (₹) *</label>
              <input type="text" inputMode="decimal" value={v.pricing.packaging_cost} onChange={setPrice("packaging_cost")}
                placeholder="0 if none" style={{ ...S.inp, fontSize: 13, ...red("packaging_cost", v.pricing.packaging_cost) }} />
            </div>
          </div>
          <div style={{ fontSize: 11.5, color: C.gray500, marginTop: 7 }}>
            {finalPreview != null && Object.keys(problems).length === 0
              ? <>Final price: <b style={{ color: C.gray800 }}>₹{finalPreview.toFixed(2)}</b> — every SKU under this parent is costed at this.</>
              : "All fields are required — every SKU under this parent is costed at its price."}
          </div>
        </div>
      )}
    </div>
  );
}
