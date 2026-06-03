import { useCallback, useState } from "react";
import { API } from "../../App";
import ItemList from "../List/ItemList";

export function FormCard({setForm, editId, C, S, SectionHeader, form, fmt, previewFinal, handleSave, btn, msg, isParentInput, notify}){
    const [priceForm, setPriceForm] = useState({});
    
    const [priceEditId, setEditId] = useState(0);
    editId = isParentInput ? priceEditId : editId;

    form = isParentInput ? priceForm : form;
    const previewPriceFinal = useCallback(() => {
        const ip = parseFloat(form.item_price) || 0;
        const tax = parseFloat(form.tax_percent) || 0;
        const pkg = parseFloat(form.packaging_cost) || 0;
        let final_price = ip + (ip * tax / 100) + pkg;
        return final_price;
      }, [form.item_price, form.packaging_cost, form.tax_percent ]);

    previewFinal = isParentInput ? previewPriceFinal : previewFinal;
    

    const handlePriceSave = async () => {
        if (!form.item_id.trim()) return notify("err", "Item Id is required.");
        if (!form.item_price || Number(form.item_price) <= 0) return notify("err", "Item price must be > 0.");
        const url =  editId ? `${API}/parent-linking/` : `${API}/parent-prices/`;
        const method = editId ? "PATCH" : "POST";
        const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({...form, final_price: previewFinal()}) });
        if (res.ok) {
          notify("ok", `SKU "${form.item_id}" added.`);
          setForm({ sku_id: "", item_price: "", tax_percent: "0", packaging_cost: "0" });
        } else {
          const e = await res.json();
          notify("err", Object.values(e).flat().join(" "));
        }
      };

      const handleItemUpdate = (item)=>{
        setForm({...item, sku_ids: item?.sku_ids?.length >0 ?  item?.sku_ids?.join(","): ""});
        setEditId(item.item_id);
      }

    

    setForm = isParentInput ? setPriceForm : setForm;
    handleSave = isParentInput ? handlePriceSave : handleSave;
    


    return(
    <div style={{ ...S.card, borderTop: `3px solid ${isParentInput ? C.blue : editId ? C.blue : C.green}` }}>
        <SectionHeader title={isParentInput ? "Parent Item Pricing" :  editId ? `✏️ Editing: ${editId}` : "➕ Add New SKU"} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14, marginBottom: 16 }}>
        <div>
            <label style={S.label}>{isParentInput ? "ITEM ID *":"SKU ID *"}</label>
            <input value={form.item_id} onChange={e => setForm({ ...form, item_id: e.target.value })}
            placeholder="e.g. copper_bottle_01" style={S.inp} disabled={!!editId} />
        </div>
        <div>
            <label style={S.label}>Item Price (₹) *</label>
            <input type="number" step="0.01" min="0" value={form.item_price}
            onChange={e => setForm({ ...form, item_price: e.target.value })} placeholder="0.00" style={S.inp} />
        </div>
        <div>
            <label style={S.label}>Tax % (GST)</label>
            <input type="number" step="0.5" min="0" value={form.tax_percent}
            onChange={e => setForm({ ...form, tax_percent: e.target.value })} placeholder="0" style={S.inp} />
        </div>
        <div>
            <label style={S.label}>Packaging Cost (₹)</label>
            <input type="number" step="0.01" min="0" value={form.packaging_cost}
            onChange={e => setForm({ ...form, packaging_cost: e.target.value })} placeholder="0.00" style={S.inp} />
        </div>
        </div>

        {isParentInput && editId && <div>
            <label style={S.label}>Child SKU Id's</label>
            <input   value={form.sku_ids}
            onChange={e => setForm({ ...form, sku_ids: e.target.value })} placeholder="line_bottle, line_bottle2" style={S.inp} />
        </div>}
        <br/>

        {/* Final price preview */}
        <div style={{ background: C.gray50, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 16px", marginBottom: 14, display: "flex", gap: 20, flexWrap: "wrap" }}>
        <div>
            <p style={{ fontSize: 11, color: C.gray400, marginBottom: 2 }}>Item Price</p>
            <p style={{ fontFamily: "monospace", fontWeight: 700, color: C.gray700 }}>{fmt(parseFloat(form.item_price) || 0)}</p>
        </div>
        <div style={{ color: C.gray300, alignSelf: "center", fontSize: 16 }}>+</div>
        <div>
            <p style={{ fontSize: 11, color: C.gray400, marginBottom: 2 }}>Tax ({form.tax_percent || 0}%)</p>
            <p style={{ fontFamily: "monospace", fontWeight: 700, color: C.gray700 }}>
            {fmt((parseFloat(form.item_price) || 0) * (parseFloat(form.tax_percent) || 0) / 100)}
            </p>
        </div>
        <div style={{ color: C.gray300, alignSelf: "center", fontSize: 16 }}>+</div>
        <div>
            <p style={{ fontSize: 11, color: C.gray400, marginBottom: 2 }}>Packaging</p>
            <p style={{ fontFamily: "monospace", fontWeight: 700, color: C.gray700 }}>{fmt(parseFloat(form.packaging_cost) || 0)}</p>
        </div>
        <div style={{ color: C.gray300, alignSelf: "center", fontSize: 16 }}>=</div>
        <div style={{ background: C.orangeLight, border: `1px solid ${C.orangeBorder}`, borderRadius: 8, padding: "6px 14px" }}>
            <p style={{ fontSize: 10, color: C.orange, fontWeight: 700, marginBottom: 2 }}>FINAL PRICE</p>
            <p style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 18, color: C.orange }}>{fmt(previewFinal())}</p>
        </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={handleSave} style={btn( editId ? "success" : "primary")}>
        {isParentInput ? (editId ? "Update Items" :"+ Add Item") :  ( editId ? "✓ Update SKU" : "+ Add SKU")}
        </button>
        {editId && (
            <button onClick={() => { setEditId(null); setForm({ sku_id: "", item_price: "", tax_percent: "0", packaging_cost: "0" }); }} style={btn("ghost")}>
            Cancel
            </button>
        )}
        </div>

        {msg && (
        <div style={{
            marginTop: 12, padding: "10px 14px", borderRadius: 8, fontSize: 13, fontWeight: 500,
            background: msg.type === "ok" ? C.greenLight : C.redLight,
            color: msg.type === "ok" ? C.green : C.red,
            border: `1px solid ${msg.type === "ok" ? C.greenBorder : C.redBorder}`,
        }}>{msg.text}</div>
        )}

        {isParentInput && <ItemList handleEdit={handleItemUpdate}/>}
  </div>)
}