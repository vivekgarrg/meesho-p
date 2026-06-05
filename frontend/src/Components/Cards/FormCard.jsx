import React, { useCallback, useState } from "react";
import { API } from "../../App";
import ItemList from "../List/ItemList";

export function FormCard({ setForm, editId, C, S, SectionHeader, form, fmt, previewFinal, handleSave, btn, msg, isParentInput, notify }) {
  const [priceForm,  setPriceForm]  = useState({});
  const [priceEditId, setEditId]    = useState(null);

  if (isParentInput) {
    editId = priceEditId;
    form   = priceForm;
  }

  const previewPriceFinal = useCallback(() => {
    const ip  = parseFloat(form.item_price)     || 0;
    const tax = parseFloat(form.tax_percent)    || 0;
    const pkg = parseFloat(form.packaging_cost) || 0;
    return ip + (ip * tax / 100) + pkg;
  }, [form.item_price, form.packaging_cost, form.tax_percent]);

  if (isParentInput) previewFinal = previewPriceFinal;

  const handlePriceSave = async () => {
    if (!form.item_id?.trim()) return notify("err", "Item ID is required.");
    if (!form.item_price || Number(form.item_price) <= 0) return notify("err", "Item price must be > 0.");
    const url    = `${API}/parent-linking/`;
    const method = priceEditId ? "PUT" : "POST";
    const res    = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, final_price: previewPriceFinal() }) });
    if (res.ok) {
      notify("ok", `Item "${form.item_id}" ${priceEditId ? "updated" : "added"}.`);
      setPriceForm({});
      setEditId(null);
    } else {
      const e = await res.json();
      notify("err", Object.values(e).flat().join(" "));
    }
  };

  const handleItemUpdate = (item) => {
    setPriceForm({ ...item, sku_ids: item?.sku_ids?.length > 0 ? item.sku_ids.join(",") : "" });
    setEditId(item.item_id);
  };

  if (isParentInput) {
    setForm    = setPriceForm;
    handleSave = handlePriceSave;
  }

  const accent = isParentInput ? C.blue : (editId ? C.amber : C.green);

  return (
    <div style={{ ...S.card, borderTop: `3px solid ${accent}` }}>
      <SectionHeader title={
        isParentInput
          ? (editId ? `✏️ Editing parent: ${editId}` : "📦 Parent Item Pricing")
          : (editId ? `✏️ Editing SKU: ${editId}` : "➕ Add / Edit SKU")
      } />

      {/* Inputs row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 12 }}>
        <div>
          <label style={S.label}>{isParentInput ? "Item ID *" : "SKU ID *"}</label>
          <input
            value={form.item_id ?? form.sku_id ?? ""}
            onChange={e => setForm({ ...form, [isParentInput ? "item_id" : "sku_id"]: e.target.value })}
            placeholder={isParentInput ? "e.g. copper_bottle_01" : "e.g. BOTTLE-RED-S"}
            style={S.inp}
            disabled={!!editId}
          />
        </div>
        <div>
          <label style={S.label}>Item Price (₹) *</label>
          <input type="number" step="0.01" min="0" value={form.item_price ?? ""}
            onChange={e => setForm({ ...form, item_price: e.target.value })}
            placeholder="0.00" style={S.inp} />
        </div>
        <div>
          <label style={S.label}>Tax % (GST)</label>
          <input type="number" step="0.5" min="0" value={form.tax_percent ?? "0"}
            onChange={e => setForm({ ...form, tax_percent: e.target.value })}
            placeholder="0" style={S.inp} />
        </div>
        <div>
          <label style={S.label}>Packaging Cost (₹)</label>
          <input type="number" step="0.01" min="0" value={form.packaging_cost ?? "0"}
            onChange={e => setForm({ ...form, packaging_cost: e.target.value })}
            placeholder="0.00" style={S.inp} />
        </div>
      </div>

      {/* Child SKUs input — only shown when editing a parent */}
      {isParentInput && editId && (
        <div style={{ marginBottom: 12 }}>
          <label style={S.label}>Child SKU IDs <span style={{ color: C.gray400, fontWeight: 400 }}>(comma separated)</span></label>
          <input
            value={form.sku_ids ?? ""}
            onChange={e => setForm({ ...form, sku_ids: e.target.value })}
            placeholder="sku_a, sku_b, sku_c"
            style={S.inp}
          />
        </div>
      )}

      {/* Final price preview — compact inline row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: C.gray50, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 12 }}>
        <span style={{ color: C.gray400 }}>Preview:</span>
        <span style={{ fontFamily: "monospace", color: C.gray700 }}>{fmt(parseFloat(form.item_price) || 0)}</span>
        <span style={{ color: C.gray300 }}>+</span>
        <span style={{ fontFamily: "monospace", color: C.gray600 }}>
          tax {fmt((parseFloat(form.item_price) || 0) * (parseFloat(form.tax_percent) || 0) / 100)}
        </span>
        <span style={{ color: C.gray300 }}>+</span>
        <span style={{ fontFamily: "monospace", color: C.gray600 }}>pkg {fmt(parseFloat(form.packaging_cost) || 0)}</span>
        <span style={{ color: C.gray300 }}>=</span>
        <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 15, color: C.orange, background: C.orangeLight, padding: "3px 12px", borderRadius: 6, border: `1px solid ${C.orangeBorder}` }}>
          {fmt(previewFinal())}
        </span>
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={handleSave} style={btn(editId ? "success" : "primary")}>
          {isParentInput ? (editId ? "✓ Update Item" : "+ Add Item") : (editId ? "✓ Update SKU" : "+ Add SKU")}
        </button>
        {editId && (
          <button
            onClick={() => {
              setEditId(null);
              setForm(isParentInput ? {} : { sku_id: "", item_price: "", tax_percent: "0", packaging_cost: "0" });
            }}
            style={btn("ghost")}
          >
            Cancel
          </button>
        )}
      </div>

      {/* Toast message */}
      {msg && (
        <div style={{ marginTop: 10, padding: "9px 14px", borderRadius: 8, fontSize: 13, fontWeight: 500, background: msg.type === "ok" ? C.greenLight : C.redLight, color: msg.type === "ok" ? C.green : C.red, border: `1px solid ${msg.type === "ok" ? C.greenBorder : C.redBorder}` }}>
          {msg.text}
        </div>
      )}

      {/* Parent items table (only for parent form) */}
      {isParentInput && <ItemList handleEdit={handleItemUpdate} />}
    </div>
  );
}
