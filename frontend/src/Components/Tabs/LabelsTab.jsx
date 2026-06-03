import { useRef, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from "recharts";
import { C, S, API, SectionHeader } from "../../App";

const CHART_COLORS = [
  "#E8510A", "#F59E0B", "#10B981", "#3B82F6", "#8B5CF6",
  "#EC4899", "#06B6D4", "#84CC16", "#EF4444", "#6366F1",
];

// ── Download helper ───────────────────────────────────────────────────────────

function downloadCroppedPDF(b64, fileName) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const blob  = new Blob([bytes], { type: "application/pdf" });
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement("a");
  a.href      = url;
  a.download  = `labels_only_${fileName.replace(/\.pdf$/i, "")}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, accent, icon, highlight }) {
  return (
    <div style={{
      ...S.card,
      borderTop: `3px solid ${accent}`,
      display: "flex", flexDirection: "column", gap: 6,
      background: highlight ? `${accent}0D` : C.white,
    }}>
      <p style={{ fontSize: 11, fontWeight: 700, color: C.gray400, letterSpacing: "0.07em", textTransform: "uppercase" }}>
        {icon} {label}
      </p>
      <p style={{ fontSize: 26, fontWeight: 800, color: accent, fontFamily: "'DM Mono', monospace", lineHeight: 1.1 }}>
        {value}
      </p>
      {sub && <p style={{ fontSize: 11, color: C.gray400 }}>{sub}</p>}
    </div>
  );
}

function DropZone({ onFile, disabled }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const handle = (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      alert("Please upload a PDF file.");
      return;
    }
    onFile(file);
  };

  return (
    <div
      onClick={() => !disabled && inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); if (!disabled) handle(e.dataTransfer.files[0]); }}
      style={{
        border: `2px dashed ${dragging ? C.orange : C.gray300}`,
        borderRadius: 14, padding: "48px 32px", textAlign: "center",
        cursor: disabled ? "not-allowed" : "pointer",
        background: dragging ? C.orangeLight : C.gray50,
        transition: "all 0.2s", opacity: disabled ? 0.6 : 1,
      }}
    >
      <div style={{ fontSize: 44, marginBottom: 12 }}>📄</div>
      <p style={{ fontSize: 15, fontWeight: 700, color: C.gray700, marginBottom: 6 }}>
        Drop your Meesho Labels PDF here
      </p>
      <p style={{ fontSize: 13, color: C.gray400, marginBottom: 18 }}>
        One label per page — extracts SKU + Qty from the Product Details table
      </p>
      <span style={{
        display: "inline-block", padding: "9px 22px", borderRadius: 8,
        background: C.orange, color: C.white, fontWeight: 600, fontSize: 13,
      }}>
        Choose PDF file
      </span>
      <input ref={inputRef} type="file" accept=".pdf" style={{ display: "none" }}
        onChange={(e) => handle(e.target.files[0])} />
    </div>
  );
}

function PageRow({ detail, idx }) {
  const [open, setOpen] = useState(false);
  const hasHighQty = detail.qty > 1;
  return (
    <div style={{ borderBottom: `1px solid ${C.gray100}` }}>
      <div onClick={() => setOpen((o) => !o)} style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "9px 14px", cursor: "pointer",
        background: open ? C.gray50 : C.white, transition: "background 0.1s",
      }}>
        <span style={{ fontSize: 11, color: C.gray400, fontFamily: "monospace", minWidth: 52 }}>
          pg {detail.page}
        </span>
        {detail.sku ? (
          <span style={{
            background: C.orangeLight, color: C.orange,
            border: `1px solid ${C.orangeBorder}`,
            padding: "2px 9px", borderRadius: 20, fontSize: 11,
            fontWeight: 600, fontFamily: "monospace", flex: 1,
          }}>{detail.sku}</span>
        ) : (
          <span style={{ fontSize: 12, color: C.gray400, flex: 1 }}>No SKU found</span>
        )}
        {hasHighQty && (
          <span style={{
            background: C.amberLight, color: C.amber,
            border: "1px solid #FDE68A",
            padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
          }}>
            Qty: {detail.qty}
          </span>
        )}
        {!hasHighQty && detail.sku && (
          <span style={{ fontSize: 11, color: C.gray400 }}>×1</span>
        )}
      </div>
    </div>
  );
}

// ── Main tab ──────────────────────────────────────────────────────────────────

export function LabelsTab() {
  const [result, setResult]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [search, setSearch]   = useState("");
  const [fileName, setFileName] = useState("");
  const [showPages, setShowPages] = useState(false);

  const handleFile = async (file) => {
    setLoading(true);
    setError("");
    setResult(null);
    setFileName(file.name);

    const form = new FormData();
    form.append("file", file);

    try {
      const res  = await fetch(`${API}/labels/parse/`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || "Upload failed.");
      } else {
        setResult(data);
      }
    } catch {
      setError("Could not reach the server — is the backend running?");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setResult(null);
    setError("");
    setFileName("");
    setSearch("");
    setShowPages(false);
  };

  // Filtered SKU table
  const filtered = (result?.sku_table || []).filter(
    (r) => !search || r.sku.toLowerCase().includes(search.toLowerCase())
  );

  const totalLabels  = result?.total_labels ?? 0;
  const totalOrders  = result?.total_pages  ?? 0;
  const highQtyCount = (result?.sku_table || []).reduce((s, r) => s + r.high_qty_orders, 0);

  // Chart: top 15 by label count
  const chartData = (result?.sku_table || []).slice(0, 15).map((r) => ({
    sku:   r.sku.length > 20 ? r.sku.slice(0, 18) + "…" : r.sku,
    fullSku: r.sku,
    count: r.count,
    totalQty: r.total_qty,
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: C.gray800, marginBottom: 4 }}>
            🏷 Label Scanner
          </h2>
          <p style={{ fontSize: 13, color: C.gray400 }}>
            Upload Meesho labels PDF — extracts SKU + Qty per label, crops invoice section, enables dispatch count view.
          </p>
        </div>
        {result && (
          <div style={{ display: "flex", gap: 10 }}>
            {result.cropped_pdf_b64 && (
              <button
                onClick={() => downloadCroppedPDF(result.cropped_pdf_b64, fileName)}
                style={{
                  padding: "8px 18px", borderRadius: 8, fontSize: 13,
                  border: `1.5px solid ${C.green}`, background: C.greenLight,
                  color: C.green, cursor: "pointer", fontFamily: "inherit",
                  fontWeight: 600, display: "flex", alignItems: "center", gap: 7,
                }}
              >
                ⬇ Download Cropped Labels
              </button>
            )}
            <button onClick={reset} style={{
              padding: "8px 16px", borderRadius: 8, fontSize: 13,
              border: `1px solid ${C.gray300}`, background: C.white,
              color: C.gray600, cursor: "pointer", fontFamily: "inherit", fontWeight: 500,
            }}>
              ↩ New Upload
            </button>
          </div>
        )}
      </div>

      {/* Upload zone */}
      {!result && !loading && <DropZone onFile={handleFile} />}

      {/* Loading */}
      {loading && (
        <div style={{ ...S.card, textAlign: "center", padding: "60px 32px" }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>⚙️</div>
          <p style={{ fontSize: 15, fontWeight: 700, color: C.gray700, marginBottom: 6 }}>Parsing labels…</p>
          <p style={{ fontSize: 13, color: C.gray400 }}>
            Extracting SKU + Qty from each page of <strong>{fileName}</strong>
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          ...S.card, borderColor: C.redBorder, background: C.redLight,
          padding: "16px 20px", display: "flex", alignItems: "flex-start", gap: 10,
        }}>
          <span style={{ fontSize: 20 }}>⚠️</span>
          <div>
            <p style={{ fontWeight: 700, color: C.red, marginBottom: 4 }}>Error</p>
            <p style={{ fontSize: 13, color: C.red }}>{error}</p>
          </div>
        </div>
      )}

      {/* Results */}
      {result && (
        <>
          {/* File chip */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{
              background: C.greenLight, border: `1px solid ${C.greenBorder}`,
              color: C.green, padding: "4px 12px", borderRadius: 20,
              fontSize: 12, fontWeight: 600,
            }}>✓ {fileName}</span>
            {highQtyCount > 0 && (
              <span style={{
                background: C.amberLight, border: "1px solid #FDE68A",
                color: C.amber, padding: "4px 12px", borderRadius: 20,
                fontSize: 12, fontWeight: 600,
              }}>
                ⚠ {highQtyCount} label{highQtyCount > 1 ? "s" : ""} with Qty &gt; 1 — check packing
              </span>
            )}
            {result.cropped_pdf_b64 && (
              <span style={{
                background: C.blueLight, border: "1px solid #BFDBFE",
                color: C.blue, padding: "4px 12px", borderRadius: 20,
                fontSize: 12, fontWeight: 600,
              }}>
                ✂ Invoice cropped — labels only PDF ready
              </span>
            )}
          </div>

          {/* KPI cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14 }}>
            <KpiCard label="Total Pages" value={result.total_pages} sub="one label per page" accent={C.blue} icon="📄" />
            <KpiCard label="Unique SKUs" value={result.total_unique_skus} sub="distinct products" accent={C.orange} icon="🏷" />
            <KpiCard
              label="Labels Found"
              value={totalLabels}
              sub={`${((totalLabels / Math.max(totalOrders, 1)) * 100).toFixed(0)}% coverage`}
              accent={totalLabels === totalOrders ? C.green : C.amber}
              icon="✅"
            />
            <KpiCard
              label="Multi-Qty Labels"
              value={highQtyCount}
              sub="orders with qty > 1"
              accent={highQtyCount > 0 ? C.amber : C.green}
              icon={highQtyCount > 0 ? "⚠️" : "✓"}
              highlight={highQtyCount > 0}
            />
          </div>

          {/* Bar chart */}
          {chartData.length > 0 && (
            <div style={S.card}>
              <p style={S.cardTitle}>SKU Distribution — Top {chartData.length}</p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} margin={{ top: 4, right: 12, left: -8, bottom: 50 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.gray100} />
                  <XAxis
                    dataKey="sku" tick={{ fill: C.gray500, fontSize: 10 }}
                    axisLine={false} tickLine={false}
                    angle={-40} textAnchor="end" interval={0}
                  />
                  <YAxis allowDecimals={false} tick={{ fill: C.gray400, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 8 }}
                    cursor={{ fill: C.gray50 }}
                    formatter={(v, name, props) => [
                      `${v} labels (${props.payload.totalQty} items total)`,
                      props.payload.fullSku,
                    ]}
                    labelFormatter={() => ""}
                  />
                  <Bar dataKey="count" radius={[5, 5, 0, 0]}>
                    {chartData.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* SKU table — main deliverable */}
          <div style={S.card}>
            <SectionHeader
              title="SKU Dispatch Count"
              count={`${filtered.length} SKUs`}
              actions={
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="🔍 Search SKU…"
                  style={{ ...S.inp, width: 200, fontSize: 12 }}
                />
              }
            />

            {highQtyCount > 0 && (
              <div style={{
                background: C.amberLight, border: "1px solid #FDE68A",
                borderRadius: 8, padding: "10px 14px", marginBottom: 14,
                fontSize: 12, color: C.amber, fontWeight: 600,
              }}>
                ⚠ Amber rows have at least one label with Qty &gt; 1 — pack multiple items for those orders.
              </div>
            )}

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {[
                      { h: "#",                  align: "left"  },
                      { h: "SKU",                align: "left"  },
                      { h: "Orders (Labels)",    align: "right" },
                      { h: "Total Items",        align: "right" },
                      { h: "Max Qty / Order",    align: "center"},
                      { h: "Multi-Qty Orders",   align: "center"},
                      { h: "% of Total",         align: "right" },
                      { h: "Share",              align: "left"  },
                    ].map(({ h, align }) => (
                      <th key={h} style={{ ...S.th, textAlign: align }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row, i) => {
                    const pct        = totalLabels > 0 ? (row.count / totalLabels) * 100 : 0;
                    const isHighQty  = row.max_qty > 1;
                    const rowBg      = isHighQty
                      ? (i % 2 === 0 ? "#FFFBEB" : "#FEF3C7")
                      : (i % 2 === 0 ? C.white : C.gray50);

                    return (
                      <tr
                        key={row.sku}
                        style={{ background: rowBg }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = isHighQty ? "#FDE68A55" : "#F0F7FF")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = rowBg)}
                      >
                        {/* # */}
                        <td style={{ ...S.td, color: C.gray400, fontSize: 11, width: 36 }}>{i + 1}</td>

                        {/* SKU */}
                        <td style={S.td}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            {isHighQty && (
                              <span title="Has multi-qty orders" style={{ fontSize: 14 }}>⚠️</span>
                            )}
                            <span style={{
                              fontFamily: "monospace", fontSize: 12,
                              color: C.orange, fontWeight: 700,
                              background: C.orangeLight,
                              padding: "3px 9px", borderRadius: 6,
                            }}>{row.sku}</span>
                          </div>
                        </td>

                        {/* Orders */}
                        <td style={{ ...S.td, textAlign: "right" }}>
                          <span style={{
                            fontFamily: "monospace", fontWeight: 800, fontSize: 20,
                            color: C.gray800,
                          }}>{row.count}</span>
                        </td>

                        {/* Total Items */}
                        <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 600, color: C.blue }}>
                          {row.total_qty}
                        </td>

                        {/* Max Qty */}
                        <td style={{ ...S.td, textAlign: "center" }}>
                          <span style={{
                            padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 700,
                            background: row.max_qty > 1 ? C.amberLight : C.gray100,
                            color: row.max_qty > 1 ? C.amber : C.gray500,
                            border: `1px solid ${row.max_qty > 1 ? "#FDE68A" : C.gray200}`,
                          }}>
                            {row.max_qty > 1 ? `× ${row.max_qty}` : "× 1"}
                          </span>
                        </td>

                        {/* Multi-qty orders count */}
                        <td style={{ ...S.td, textAlign: "center" }}>
                          {row.high_qty_orders > 0 ? (
                            <span style={{
                              background: C.amberLight, color: C.amber,
                              border: "1px solid #FDE68A",
                              padding: "2px 10px", borderRadius: 20,
                              fontSize: 12, fontWeight: 700,
                            }}>
                              {row.high_qty_orders} order{row.high_qty_orders > 1 ? "s" : ""}
                            </span>
                          ) : (
                            <span style={{ color: C.gray300, fontSize: 12 }}>—</span>
                          )}
                        </td>

                        {/* % of total */}
                        <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", color: C.gray500, fontSize: 12 }}>
                          {pct.toFixed(1)}%
                        </td>

                        {/* Progress bar */}
                        <td style={{ ...S.td, minWidth: 100 }}>
                          <div style={{ height: 8, background: C.gray100, borderRadius: 4, overflow: "hidden" }}>
                            <div style={{
                              width: `${pct}%`, height: "100%", borderRadius: 4,
                              background: isHighQty
                                ? "linear-gradient(90deg, #D97706, #F59E0B)"
                                : "linear-gradient(90deg, #E8510A, #F59E0B)",
                              transition: "width 0.4s ease",
                            }} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {/* Totals row */}
                  {filtered.length > 0 && (
                    <tr style={{ background: C.gray50, borderTop: `2px solid ${C.border}` }}>
                      <td colSpan={2} style={{ ...S.td, fontWeight: 700, color: C.gray700 }}>Total</td>
                      <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 800, fontSize: 18, color: C.orange }}>
                        {filtered.reduce((s, r) => s + r.count, 0)}
                      </td>
                      <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: C.blue }}>
                        {filtered.reduce((s, r) => s + r.total_qty, 0)}
                      </td>
                      <td colSpan={4} style={S.td} />
                    </tr>
                  )}

                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={8} style={{ ...S.td, textAlign: "center", padding: 40, color: C.gray400 }}>
                        {search ? `No SKU matching "${search}"` : "No SKUs extracted"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Per-page detail */}
          <div style={S.card}>
            <div
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
              onClick={() => setShowPages((o) => !o)}
            >
              <p style={{ ...S.cardTitle, marginBottom: 0 }}>
                Per-page detail — {result.page_details.length} pages
              </p>
              <span style={{ fontSize: 12, color: C.gray400, paddingBottom: 16 }}>
                {showPages ? "▲ Hide" : "▼ Show"}
              </span>
            </div>
            {showPages && (
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden", marginTop: 12 }}>
                {result.page_details.map((d) => (
                  <PageRow key={d.page} detail={d} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
