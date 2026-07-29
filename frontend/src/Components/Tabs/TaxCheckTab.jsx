import React, { useState, useEffect, useCallback } from "react";
import { API, C, S, btn } from "../../App";
import SearchIcon from "@mui/icons-material/Search";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import { CircularProgress } from "@mui/material";

function KpiCard({ label, value, color, bg, sub, onClick, active }) {
  return (
    <div onClick={onClick} style={{
      padding: "14px 16px", borderRadius: 14, background: bg || C.white,
      border: `1.5px solid ${active ? (color || C.orange) : C.gray200}`, borderTop: `3px solid ${color || C.orange}`,
      minWidth: 0, cursor: onClick ? "pointer" : "default", boxShadow: active ? `0 2px 10px ${color}22` : "none",
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.gray400, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: color || C.gray800, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.gray400, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

const STATUS_META = {
  mismatch: { label: "Mismatch", bg: "#FFF1F2", fg: C.red, border: "#FECDD3" },
  match: { label: "Match", bg: C.greenLight, fg: C.green, border: C.greenBorder },
  no_data: { label: "No Meesho data", bg: C.gray100, fg: C.gray500, border: C.gray200 },
  unset: { label: "Tax not set", bg: "#FFFBEB", fg: "#D97706", border: "#FDE68A" },
};
const pctTax = (v) => (v === null || v === undefined ? "—" : `${v}%`);

export function TaxCheckTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("mismatch");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ status: filter });
      if (search) p.set("search", search);
      const r = await fetch(`${API}/tax-check/?${p}`);
      setData(await r.json());
    } finally { setLoading(false); }
  }, [filter, search]);

  useEffect(() => { load(); }, [load]);

  const k = data?.kpi || {};
  const rows = data?.results || [];

  const FILTERS = [
    ["mismatch", "Mismatched", k.mismatched],
    ["match", "Matched", k.matched],
    ["no_data", "No Meesho data", k.no_meesho_data],
    ["unset", "Tax not set", k.unset],
    ["all", "All", k.priced_skus],
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: C.gray800, margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
          <ReceiptLongIcon style={{ color: C.orange }} /> Tax Check
        </h1>
        <p style={{ color: C.gray400, fontSize: 13, margin: "4px 0 0" }}>
          Compare the tax % you set on each SKU (in SKU Pricing) against the GST % Meesho actually charges on that SKU's payments.
        </p>
      </div>

      {/* KPIs (clickable → filter) */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
        <KpiCard label="Priced SKUs" value={k.priced_skus ?? "—"} color={C.blue} onClick={() => setFilter("all")} active={filter === "all"} />
        <KpiCard label="Mismatched" value={k.mismatched ?? "—"} color={C.red} bg="#FFF1F2" sub="tax ≠ Meesho GST" onClick={() => setFilter("mismatch")} active={filter === "mismatch"} />
        <KpiCard label="Matched" value={k.matched ?? "—"} color={C.green} bg="#ECFDF5" onClick={() => setFilter("match")} active={filter === "match"} />
        <KpiCard label="No Meesho data" value={k.no_meesho_data ?? "—"} color={C.gray500} sub="no orders with GST" onClick={() => setFilter("no_data")} active={filter === "no_data"} />
        <KpiCard label="Unpriced (in orders)" value={k.unpriced_with_orders ?? "—"} color="#D97706" bg="#FFFBEB" sub="sold but no SKU price" />
      </div>

      {/* Filter chips + search */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {FILTERS.map(([id, label, count]) => (
            <button key={id} onClick={() => setFilter(id)} style={{ ...btn(filter === id ? "primary" : "ghost", "sm"), borderRadius: 20, padding: "5px 14px", fontSize: 12 }}>
              {label}{count != null ? ` (${count})` : ""}
            </button>
          ))}
        </div>
        <div style={{ position: "relative", marginLeft: "auto", minWidth: 220 }}>
          <SearchIcon style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 16, color: C.gray400 }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="SKU / parent…" style={{ ...S.inp, paddingLeft: 32, fontSize: 12 }} />
        </div>
      </div>

      <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 48 }}><CircularProgress style={{ color: C.orange }} /></div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr>{["SKU", "Parent", "Your Tax %", "Meesho GST %", "Diff", "Orders", "Status"].map((h) => (
                <th key={h} style={{ ...S.th, fontSize: 10, whiteSpace: "nowrap" }}>{h}</th>))}</tr></thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={7} style={{ ...S.td, textAlign: "center", padding: 40, color: C.gray400 }}>No SKUs in this view.</td></tr>
                ) : rows.map((r, i) => {
                  const m = STATUS_META[r.status] || STATUS_META.no_data;
                  return (
                    <tr key={r.sku_id} style={{ background: i % 2 ? C.gray50 : C.white, borderBottom: `1px solid ${C.gray100}` }}>
                      <td style={{ ...S.td }}>
                        <span style={{ fontSize: 11, fontFamily: "monospace", color: C.orange, background: C.orangeLight, padding: "1px 6px", borderRadius: 4 }}>{r.sku_id}</span>
                      </td>
                      <td style={{ ...S.td, color: C.gray500, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.parent || ""}>{r.parent || "—"}</td>
                      <td style={{ ...S.td, textAlign: "center", fontWeight: 700, fontFamily: "monospace" }}>{pctTax(r.set_tax)}</td>
                      <td style={{ ...S.td, textAlign: "center", fontFamily: "monospace" }}>
                        {pctTax(r.meesho_gst)}
                        {r.multiple_meesho && <span style={{ fontSize: 10, color: C.amber, marginLeft: 4 }} title={`Meesho GST varies across orders: ${r.meesho_values.join("%, ")}%`}>⚠ [{r.meesho_values.join(", ")}]</span>}
                      </td>
                      <td style={{ ...S.td, textAlign: "center", fontWeight: 700, fontFamily: "monospace", color: r.diff ? C.red : C.gray400 }}>
                        {r.diff === null || r.diff === undefined ? "—" : `${r.diff > 0 ? "+" : ""}${r.diff}`}
                      </td>
                      <td style={{ ...S.td, textAlign: "center", fontFamily: "monospace", color: C.gray500 }}>{r.order_count}</td>
                      <td style={{ ...S.td }}>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: m.bg, color: m.fg, border: `1px solid ${m.border}` }}>{m.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ fontSize: 12, color: C.gray400, lineHeight: 1.6 }}>
        <b>Your Tax %</b> is from SKU Pricing (final price). <b>Meesho GST %</b> is the most common <code>product_gst_percent</code> Meesho
        reports for that SKU across its payment rows. A <b>⚠</b> means Meesho used more than one GST rate for the same SKU. Use this to
        correct the tax on mismatched SKUs so your cost/profit math matches what Meesho actually deducts.
      </div>
    </div>
  );
}
