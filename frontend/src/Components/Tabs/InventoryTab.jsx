import React, { useState, useEffect, useCallback } from "react";
import { API, C, S, fmt } from "../../App";

function StockBadge({ stock }) {
  if (stock <= 0) return (
    <span style={{ background: C.redLight, color: C.red, border: `1px solid ${C.redBorder}`, padding: "2px 10px", borderRadius: 20, fontSize: 12, fontWeight: 700 }}>
      Out of Stock
    </span>
  );
  if (stock <= 3) return (
    <span style={{ background: C.amberLight, color: C.amber, border: `1px solid #FDE68A`, padding: "2px 10px", borderRadius: 20, fontSize: 12, fontWeight: 700 }}>
      Low ({stock})
    </span>
  );
  return (
    <span style={{ background: C.greenLight, color: C.green, border: `1px solid ${C.greenBorder}`, padding: "2px 10px", borderRadius: 20, fontSize: 12, fontWeight: 700 }}>
      {stock} units
    </span>
  );
}

export function InventoryTab() {
  const [data,    setData]    = useState([]);
  const [loading, setLoading] = useState(false);
  const [search,  setSearch]  = useState("");
  const [sortKey, setSortKey] = useState("current_stock");  // current_stock | sku_id | sold_qty
  const [sortAsc, setSortAsc] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/inventory/`);
      if (r.ok) {
        const d = await r.json();
        setData(d.results || []);
      }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = (key) => {
    if (sortKey === key) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(true); }
  };

  const sortIndicator = (key) =>
    sortKey === key ? (sortAsc ? " ↑" : " ↓") : "";

  const filtered = data
    .filter(r => !search || r.sku_id.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const va = typeof a[sortKey] === "string" ? a[sortKey].toLowerCase() : (a[sortKey] || 0);
      const vb = typeof b[sortKey] === "string" ? b[sortKey].toLowerCase() : (b[sortKey] || 0);
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ? 1 : -1;
      return 0;
    });

  // KPIs
  const totalStock   = data.reduce((s, r) => s + r.current_stock, 0);
  const outOfStock   = data.filter(r => r.current_stock <= 0).length;
  const lowStock     = data.filter(r => r.current_stock > 0 && r.current_stock <= 3).length;
  const totalValue   = data.reduce((s, r) => s + parseFloat(r.purchase_value || 0), 0);

  const thStyle = (key) => ({
    ...S.th,
    cursor: "pointer",
    userSelect: "none",
    color: sortKey === key ? C.orange : C.gray500,
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: C.gray800, marginBottom: 3 }}>📦 Inventory</h1>
          <p style={{ fontSize: 13, color: C.gray400 }}>
            Live stock = purchased − sold (delivered) + returned (RTO). Only non-exchange purchases count.
          </p>
        </div>
        <button
          onClick={load}
          style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.white, cursor: "pointer", fontSize: 12, color: C.gray600, fontFamily: "inherit" }}
        >⟳ Refresh</button>
      </div>

      {/* KPI strip */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
        {[
          { label: "Total Stock (units)", value: totalStock,  accent: C.green,  icon: "📦" },
          { label: "SKUs Tracked",        value: data.length, accent: C.blue,   icon: "🏷" },
          { label: "Out of Stock",        value: outOfStock,  accent: C.red,    icon: "⛔" },
          { label: "Low Stock (≤3)",       value: lowStock,    accent: C.amber,  icon: "⚠️" },
        ].map(k => (
          <div key={k.label} style={{ ...S.card, borderTop: `3px solid ${k.accent}`, minWidth: "max-content" }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: C.gray400, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 8, whiteSpace: "nowrap" }}>
              {k.icon} {k.label}
            </p>
            <p style={{ fontSize: 22, fontWeight: 800, fontFamily: "'DM Mono', monospace", color: k.accent, whiteSpace: "nowrap" }}>
              {typeof k.value === "number" ? k.value.toLocaleString("en-IN") : k.value}
            </p>
          </div>
        ))}
        <div style={{ ...S.card, borderTop: `3px solid ${C.orange}`, minWidth: "max-content" }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: C.gray400, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 8, whiteSpace: "nowrap" }}>
            💰 Total Purchase Value
          </p>
          <p style={{ fontSize: 22, fontWeight: 800, fontFamily: "'DM Mono', monospace", color: C.orange, whiteSpace: "nowrap" }}>
            {`₹${totalValue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`}
          </p>
        </div>
      </div>

      {/* Table card */}
      <div style={S.card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
          <p style={{ ...S.cardTitle, marginBottom: 0 }}>
            Stock by Parent SKU &nbsp;
            <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, fontSize: 11, color: C.gray400 }}>
              — click column headers to sort
            </span>
          </p>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="🔍 Search SKU…"
            style={{ ...S.inp, width: 200, fontSize: 12 }}
          />
        </div>

        {loading && (
          <div style={{ textAlign: "center", padding: 60, color: C.gray400 }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>⏳</div> Loading inventory…
          </div>
        )}

        {!loading && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th onClick={() => toggle("sku_id")}         style={thStyle("sku_id")}>Parent SKU{sortIndicator("sku_id")}</th>
                  <th onClick={() => toggle("purchased_qty")}  style={{ ...thStyle("purchased_qty"),  textAlign: "right" }}>Purchased{sortIndicator("purchased_qty")}</th>
                  <th onClick={() => toggle("sold_qty")}       style={{ ...thStyle("sold_qty"),       textAlign: "right" }}>Sold{sortIndicator("sold_qty")}</th>
                  <th onClick={() => toggle("rto_qty")}        style={{ ...thStyle("rto_qty"),        textAlign: "right" }}>RTO Return{sortIndicator("rto_qty")}</th>
                  <th onClick={() => toggle("current_stock")}  style={{ ...thStyle("current_stock"),  textAlign: "right" }}>Current Stock{sortIndicator("current_stock")}</th>
                  <th onClick={() => toggle("purchase_value")} style={{ ...thStyle("purchase_value"), textAlign: "right" }}>Purchase Value{sortIndicator("purchase_value")}</th>
                  <th onClick={() => toggle("last_purchase")}  style={thStyle("last_purchase")}>Last Purchase{sortIndicator("last_purchase")}</th>
                  <th style={S.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => {
                  const rowBg = i % 2 === 0 ? C.white : C.gray50;
                  const stockColor =
                    r.current_stock <= 0 ? C.red :
                    r.current_stock <= 3 ? C.amber :
                    C.green;
                  return (
                    <tr key={r.sku_id} style={{ background: rowBg }}
                      onMouseEnter={e => (e.currentTarget.style.background = "#F0FFF4")}
                      onMouseLeave={e => (e.currentTarget.style.background = rowBg)}
                    >
                      <td style={{ ...S.td, fontFamily: "monospace", fontWeight: 700, color: C.orange, fontSize: 13 }}>{r.sku_id}</td>
                      <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace" }}>{r.purchased_qty}</td>
                      <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", color: C.red }}>{r.sold_qty}</td>
                      <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", color: C.green }}>{r.rto_qty}</td>
                      <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 800, fontSize: 15, color: stockColor }}>
                        {r.current_stock}
                      </td>
                      <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace" }}>{fmt(r.purchase_value)}</td>
                      <td style={{ ...S.td, color: C.gray500, whiteSpace: "nowrap" }}>
                        {r.last_purchase ? r.last_purchase : "—"}
                      </td>
                      <td style={S.td}><StockBadge stock={r.current_stock} /></td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ ...S.td, textAlign: "center", padding: 52, color: C.gray400 }}>
                      {search
                        ? "No SKUs match your search."
                        : "No inventory data yet — add purchases first via the Purchases tab."}
                    </td>
                  </tr>
                )}
              </tbody>
              {filtered.length > 0 && (
                <tfoot>
                  <tr style={{ background: "#FFF0EA" }}>
                    <td style={{ ...S.td, fontWeight: 700 }}>Total</td>
                    <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 700 }}>
                      {filtered.reduce((s, r) => s + r.purchased_qty, 0)}
                    </td>
                    <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: C.red }}>
                      {filtered.reduce((s, r) => s + r.sold_qty, 0)}
                    </td>
                    <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: C.green }}>
                      {filtered.reduce((s, r) => s + r.rto_qty, 0)}
                    </td>
                    <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 800, fontSize: 15, color: C.orange }}>
                      {filtered.reduce((s, r) => s + r.current_stock, 0)}
                    </td>
                    <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: C.orange }}>
                      {`₹${filtered.reduce((s, r) => s + parseFloat(r.purchase_value || 0), 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`}
                    </td>
                    <td colSpan={2} style={S.td} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>

      {/* Legend */}
      <div style={{ ...S.card, padding: "14px 20px" }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: C.gray400, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
          How stock is calculated
        </p>
        <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
          {[
            { icon: "🛒", label: "Purchased", desc: "Sum of non-exchange purchase items for this SKU" },
            { icon: "✅", label: "Sold (−)",   desc: "Count of DELIVERED Meesho orders" },
            { icon: "↩", label: "RTO Return (+)", desc: "Count of RTO_COMPLETE orders — item came back" },
            { icon: "🔄", label: "Exchange",   desc: "Exchanges are excluded from all counts" },
          ].map(l => (
            <div key={l.label} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <span style={{ fontSize: 16 }}>{l.icon}</span>
              <div>
                <p style={{ fontSize: 12, fontWeight: 700, color: C.gray700 }}>{l.label}</p>
                <p style={{ fontSize: 11, color: C.gray400 }}>{l.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
