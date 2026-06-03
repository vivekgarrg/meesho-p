import { useState, useRef, useEffect, useCallback } from "react";
import { S , C, SectionHeader, fmt, btn, API} from "../../App";
import { FormCard } from "../Cards/FormCard";

export function PricingTab() {
    const [skus, setSkus] = useState([]);
    const [form, setForm] = useState({ sku_id: "", item_price: "", tax_percent: "0", packaging_cost: "0" });
    const [editId, setEditId] = useState(null);
    const [msg, setMsg] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [search, setSearch] = useState("");
    const fileRef = useRef();
    const [summary, setSummary] = useState({});
  
    const load = () => fetch(`${API}/final-prices/`).then(r => r.json()).then(d => {
      setSkus(Array.isArray(d?.results) ? d.results : [])}
    );
    useEffect(() => {  load();
      fetch(`${API}/profit`).then(d=>d.json()).then(setSummary);
     }, []);
  
    const notify = (type, text) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 4000); };
  
    const handleSave = async () => {
      if (!form.sku_id.trim()) return notify("err", "SKU ID is required.");
      if (!form.item_price || Number(form.item_price) <= 0) return notify("err", "Item price must be > 0.");
      const url = editId ? `${API}/final-prices/${encodeURIComponent(editId)}/` : `${API}/final-prices/`;
      const method = editId ? "PUT" : "POST";
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({...form, final_price: previewFinal()}) });
      if (res.ok) {
        notify("ok", editId ? `SKU "${editId}" updated.` : `SKU "${form.sku_id}" added.`);
        setForm({ sku_id: "", item_price: "", tax_percent: "0", packaging_cost: "0" });
        setEditId(null);
        load();
      } else {
        const e = await res.json();
        notify("err", Object.values(e).flat().join(" "));
      }
    };
  
    const handleEdit = (s) => {
      setEditId(s.sku_id);
      setForm({ sku_id: s.sku_id, item_price: String(s.item_price), tax_percent: String(s.tax_percent), packaging_cost: String(s.packaging_cost) });
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
  
    const handleDelete = async (sku_id) => {
      if (!window.confirm(`Delete SKU "${sku_id}"? This cannot be undone.`)) return;
      await fetch(`${API}/skus/${encodeURIComponent(sku_id)}/delete/`, { method: "DELETE" });
      load();
      notify("ok", `Deleted: ${sku_id}`);
    };
  
    const handleFileUpload = async (file) => {
      if (!file) return;
      setUploading(true);
      const fd = new FormData(); fd.append("file", file);
      const res = await fetch(`${API}/final-prices/upload/`, { method: "POST", body: fd });
      const d = await res.json();
      setUploading(false);
      if (res.ok) { notify("ok", `✓ ${d.created} created, ${d.updated} updated, ${d.errors} errors`); load(); }
      else notify("err", d.error || "Upload failed");
      if (fileRef.current) fileRef.current.value = "";
    };
  
    const previewFinal = useCallback(() => {
      const ip = parseFloat(form.item_price) || 0;
      const tax = parseFloat(form.tax_percent) || 0;
      const pkg = parseFloat(form.packaging_cost) || 0;
      let final_price = ip + (ip * tax / 100) + pkg;
      return final_price;
    }, [form.item_price, form.packaging_cost, form.tax_percent ]);
  
  
    const filtered = skus.filter(s => !search || s.sku_id.toLowerCase().includes(search.toLowerCase()));
  
    const formCardInput = {editId, C, S, setForm, form, SectionHeader, fmt, previewFinal, handleSave, btn, msg, notify};
    const formCardInputForParent = {editId, C, S, setForm, form, SectionHeader, fmt, previewFinal, handleSave, btn, msg, isParentInput: true, notify};


    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
  
        {/* Form card */}
        <FormCard {...formCardInputForParent}/>
        <FormCard {...formCardInput}/>
        
  
        {/* Upload strip */}
        <div style={{ ...S.card, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", background: C.blueLight, borderColor: "#BFDBFE" }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: C.blue, marginBottom: 3 }}>📂 Bulk Upload via Excel Sheet</p>
            <p style={{ fontSize: 12, color: C.gray500 }}>Required columns: <code style={{ background: C.white, padding: "1px 5px", borderRadius: 4 }}>sku_id</code>, <code style={{ background: C.white, padding: "1px 5px", borderRadius: 4 }}>item_price</code> — optional: tax_percent, packaging_cost</p>
          </div>
          
          <label style={{ ...btn("ghost"), display: "inline-block", cursor: "pointer" }}>
            {uploading ? "Uploading…" : "📎 Choose .xlsx"}
            <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={e => handleFileUpload(e.target.files[0])} disabled={uploading} />
          </label>
        </div>
  
        <div style={{ ...S.card, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", background: C.blueLight, borderColor: "#BFDBFE" }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: C.red, marginBottom: 3 }}>Missing SKU Id's</p>
          </div>
  
          {summary?.missing_sku?.join(", ")}
        </div>
  
        {/* Table */}
        <div style={S.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <SectionHeader title="All SKU Prices" count={filtered.length} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search SKU…"
              style={{ ...S.inp, width: 200, fontSize: 12 }} />
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["SKU ID", "Item Price", "Tax %", "Packaging Cost", "Final Price", "Last Updated", "Actions"].map(h => (
                    <th key={h} style={{ ...S.th, textAlign: ["Item Price", "Packaging Cost", "Final Price"].includes(h) ? "right" : "left" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((s, i) => (
                  <tr key={s.sku_id} style={{ background: i % 2 === 0 ? C.white : C.gray50 }}
                    onMouseEnter={e => e.currentTarget.style.background = "#F0F7FF"}
                    onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? C.white : C.gray50}
                  >
                    <td style={S.td}>
                      <span style={{ fontFamily: "monospace", fontSize: 12, color: C.orange, fontWeight: 600, background: C.orangeLight, padding: "2px 7px", borderRadius: 4 }}>
                        {s.sku_id}
                      </span>
                    </td>
                    <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace" }}>{fmt(s.item_price)}</td>
                    <td style={{ ...S.td, textAlign: "center" }}>
                      <span style={{ background: C.gray100, padding: "2px 8px", borderRadius: 4, fontSize: 12, color: C.gray600 }}>{s.tax_percent}%</span>
                    </td>
                    <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace" }}>{fmt(s.packaging_cost)}</td>
                    <td style={{ ...S.td, textAlign: "right" }}>
                      <span style={{ fontFamily: "monospace", fontWeight: 800, color: C.orange, background: C.orangeLight, padding: "3px 10px", borderRadius: 6, border: `1px solid ${C.orangeBorder}` }}>
                        {fmt(s.final_price)}
                      </span>
                    </td>
                    <td style={{ ...S.td, color: C.gray400, fontSize: 11 }}>{(s.updated_at || "").slice(0, 10)}</td>
                    <td style={S.td}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => handleEdit(s)} style={btn("ghost", "sm")}>✏️ Edit</button>
                        <button onClick={() => handleDelete(s.sku_id)} style={btn("danger", "sm")}>🗑 Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={7} style={{ ...S.td, textAlign: "center", padding: 40, color: C.gray400 }}>
                    {skus.length === 0 ? "No SKUs yet — add one above" : "No results matching search"}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }