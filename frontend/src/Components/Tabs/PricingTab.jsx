import { useState, useRef, useEffect, useCallback } from "react";
import { S, C, SectionHeader, fmt, btn, API } from "../../App";
import { FormCard } from "../Cards/FormCard";

export function PricingTab() {
  const [skus,      setSkus]      = useState([]);
  const [form,      setForm]      = useState({ sku_id: "", item_price: "", tax_percent: "0", packaging_cost: "0" });
  const [editId,    setEditId]    = useState(null);
  const [msg,       setMsg]       = useState(null);
  const [uploading, setUploading] = useState(false);
  const [search,    setSearch]    = useState("");
  const [summary,   setSummary]   = useState({});
  const [parentOpen, setParentOpen] = useState(true);
  const [missingOpen, setMissingOpen] = useState(false);
  const fileRef = useRef();

  const load = () =>
    fetch(`${API}/final-prices/`)
      .then(r => r.json())
      .then(d => setSkus(Array.isArray(d?.results) ? d.results : []));

  useEffect(() => {
    load();
    fetch(`${API}/profit/`).then(d => d.json()).then(setSummary).catch(() => {});
  }, []);

  const notify = (type, text) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  };

  const handleSave = async () => {
    if (!form.sku_id.trim()) return notify("err", "SKU ID is required.");
    if (!form.item_price || Number(form.item_price) <= 0) return notify("err", "Item price must be > 0.");
    const url    = editId ? `${API}/final-prices/${encodeURIComponent(editId)}/` : `${API}/final-prices/`;
    const method = editId ? "PUT" : "POST";
    const res    = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, final_price: previewFinal() }) });
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
    setForm({ sku_id: s.sku_id, item_price: String(s.item_price), tax_percent: String(s.tax_percent ?? 0), packaging_cost: String(s.packaging_cost ?? 0) });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async (sku_id) => {
    if (!window.confirm(`Delete SKU "${sku_id}"? This cannot be undone.`)) return;
    await fetch(`${API}/final-prices/${encodeURIComponent(sku_id)}/`, { method: "DELETE" });
    load();
    notify("ok", `Deleted: ${sku_id}`);
  };

  const handleFileUpload = async (file) => {
    if (!file) return;
    setUploading(true);
    const fd = new FormData(); fd.append("file", file);
    const res = await fetch(`${API}/final-prices/upload/`, { method: "POST", body: fd });
    const d   = await res.json();
    setUploading(false);
    if (res.ok) { notify("ok", `✓ ${d.created} created, ${d.updated} updated`); load(); }
    else notify("err", d.error || "Upload failed");
    if (fileRef.current) fileRef.current.value = "";
  };

  const previewFinal = useCallback(() => {
    const ip  = parseFloat(form.item_price)     || 0;
    const tax = parseFloat(form.tax_percent)    || 0;
    const pkg = parseFloat(form.packaging_cost) || 0;
    return ip + (ip * tax / 100) + pkg;
  }, [form.item_price, form.packaging_cost, form.tax_percent]);

  const filtered     = skus.filter(s => !search || s.sku_id.toLowerCase().includes(search.toLowerCase()));
  const linkedCount  = skus.filter(s => s.parent).length;
  const missingSkus  = summary?.missing_sku ?? [];

  const formCardShared = { editId, C, S, setForm, form, SectionHeader, fmt, previewFinal, handleSave, btn, msg, notify };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: C.gray800, marginBottom: 4 }}>⚙️ SKU Pricing</h2>
          <p style={{ fontSize: 13, color: C.gray400 }}>Manage purchase costs per SKU to compute profit accurately.</p>
        </div>
        {/* Stats chips */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span style={{ background: C.orangeLight, color: C.orange, border: `1px solid ${C.orangeBorder}`, padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700 }}>
            {skus.length} SKUs
          </span>
          <span style={{ background: C.blueLight, color: C.blue, border: "1px solid #BFDBFE", padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700 }}>
            {linkedCount} parent-linked
          </span>
          {missingSkus.length > 0 && (
            <button
              onClick={() => setMissingOpen(o => !o)}
              style={{ background: C.redLight, color: C.red, border: `1px solid ${C.redBorder}`, padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
            >
              ⚠ {missingSkus.length} missing
            </button>
          )}
        </div>
      </div>

      {/* Missing SKUs — inline collapsible banner */}
      {missingSkus.length > 0 && missingOpen && (
        <div style={{ ...S.card, borderLeft: `4px solid ${C.red}`, background: C.redLight, padding: "14px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: C.red }}>⚠ SKU IDs in orders but not in pricing table — profit calculations will be incomplete</p>
            <button onClick={() => setMissingOpen(false)} style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 16, fontFamily: "inherit" }}>✕</button>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {missingSkus.map(sku => (
              <span key={sku} style={{ fontFamily: "monospace", fontSize: 11, color: C.red, background: C.white, border: `1px solid ${C.redBorder}`, padding: "2px 8px", borderRadius: 4, fontWeight: 600 }}>
                {sku}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Parent Items — collapsible */}
      <div style={{ ...S.card, borderTop: `3px solid ${C.blue}`, padding: 0, overflow: "hidden" }}>
        <div
          onClick={() => setParentOpen(o => !o)}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", padding: "16px 24px", background: parentOpen ? C.white : C.gray50 }}
        >
          <p style={{ fontSize: 12, fontWeight: 700, color: C.blue, letterSpacing: "0.06em", textTransform: "uppercase" }}>
            📦 Parent Item Pricing
          </p>
          <span style={{ fontSize: 12, color: C.gray400 }}>{parentOpen ? "▲ Hide" : "▼ Show"}</span>
        </div>
        {parentOpen && (
          <div style={{ padding: "0 24px 20px" }}>
            <FormCard {...formCardShared} isParentInput={true} />
          </div>
        )}
      </div>

      {/* SKU form + Bulk upload — side by side on wide screens */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 16, alignItems: "start" }}>
        <FormCard {...formCardShared} />

        {/* Bulk upload */}
        <div style={{ ...S.card, minWidth: 220, borderTop: `3px solid ${C.blue}`, background: C.blueLight, borderColor: "#BFDBFE" }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: C.blue, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 10 }}>📂 Bulk Upload</p>
          <p style={{ fontSize: 12, color: C.gray500, marginBottom: 12 }}>
            Required: <code style={{ background: C.white, padding: "1px 5px", borderRadius: 4 }}>sku_id</code>, <code style={{ background: C.white, padding: "1px 5px", borderRadius: 4 }}>item_price</code>
          </p>
          <label style={{ ...btn("ghost"), display: "inline-block", cursor: "pointer", width: "100%", textAlign: "center" }}>
            {uploading ? "Uploading…" : "📎 Choose .xlsx / .csv"}
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={e => handleFileUpload(e.target.files[0])} disabled={uploading} />
          </label>
        </div>
      </div>

      {/* SKU table */}
      <div style={S.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <p style={{ ...S.cardTitle, marginBottom: 0 }}>All SKU Prices</p>
            <span style={{ background: C.gray100, color: C.gray500, fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20, border: `1px solid ${C.gray200}` }}>
              {filtered.length}
            </span>
          </div>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search SKU…"
            style={{ ...S.inp, width: 200, fontSize: 12 }}
          />
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {[
                  { h: "SKU ID",         align: "left"   },
                  { h: "Parent",         align: "left"   },
                  { h: "Item Price",     align: "right"  },
                  { h: "Tax %",          align: "center" },
                  { h: "Packaging",      align: "right"  },
                  { h: "Final Price",    align: "right"  },
                  { h: "Last Updated",   align: "left"   },
                  { h: "Actions",        align: "left"   },
                ].map(({ h, align }) => (
                  <th key={h} style={{ ...S.th, textAlign: align }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((s, i) => {
                const rowBg = i % 2 === 0 ? C.white : C.gray50;
                return (
                  <tr key={s.sku_id} style={{ background: rowBg }}
                    onMouseEnter={e => e.currentTarget.style.background = "#F0F7FF"}
                    onMouseLeave={e => e.currentTarget.style.background = rowBg}
                  >
                    {/* SKU ID */}
                    <td style={S.td}>
                      <span style={{ fontFamily: "monospace", fontSize: 12, color: C.orange, fontWeight: 700, background: C.orangeLight, padding: "2px 8px", borderRadius: 4, border: `1px solid ${C.orangeBorder}` }}>
                        {s.sku_id}
                      </span>
                    </td>

                    {/* Parent linked tag */}
                    <td style={S.td}>
                      {s.parent ? (
                        <span style={{ fontFamily: "monospace", fontSize: 11, color: C.blue, fontWeight: 600, background: C.blueLight, padding: "2px 9px", borderRadius: 20, border: "1px solid #BFDBFE", whiteSpace: "nowrap" }}>
                          ↳ {s.parent}
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, color: C.gray300 }}>—</span>
                      )}
                    </td>

                    {/* Prices */}
                    <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 600, color: C.gray700 }}>{fmt(s.item_price)}</td>
                    <td style={{ ...S.td, textAlign: "center" }}>
                      <span style={{ background: C.gray100, padding: "2px 8px", borderRadius: 4, fontSize: 12, color: C.gray600, fontWeight: 600 }}>{s.tax_percent ?? 0}%</span>
                    </td>
                    <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", color: C.gray500, fontSize: 12 }}>{fmt(s.packaging_cost)}</td>
                    <td style={{ ...S.td, textAlign: "right" }}>
                      <span style={{ fontFamily: "monospace", fontWeight: 800, color: C.orange, background: C.orangeLight, padding: "3px 10px", borderRadius: 6, border: `1px solid ${C.orangeBorder}` }}>
                        {fmt(s.final_price)}
                      </span>
                    </td>

                    {/* Updated */}
                    <td style={{ ...S.td, color: C.gray400, fontSize: 11 }}>{(s.updated_at || "").slice(0, 10)}</td>

                    {/* Actions */}
                    <td style={S.td}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => handleEdit(s)} style={btn("ghost", "sm")}>✏️ Edit</button>
                        <button onClick={() => handleDelete(s.sku_id)} style={btn("danger", "sm")}>🗑</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ ...S.td, textAlign: "center", padding: 48, color: C.gray400 }}>
                    {skus.length === 0 ? "No SKUs yet — add one above or bulk upload" : "No results matching search"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
