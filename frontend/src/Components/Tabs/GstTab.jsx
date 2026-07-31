import React, { useState, useEffect, useCallback, useRef } from "react";
import { API, C, S, btn, Tag, fmt, useIsMobile } from "../../App";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineOutlined";
import { CircularProgress, Tooltip } from "@mui/material";

// Meesho ships three separate exports; all of them are needed for a complete
// picture, so the tab tracks which ones have landed.
const EXPECTED_FILES = [
  { key: "TCS sales",            label: "tcs_sales.xlsx",            why: "the sales that create the liability" },
  { key: "TCS sales returns",    label: "tcs_sales_return.xlsx",     why: "returns that reduce it" },
  { key: "Tax invoice details",  label: "Tax_invoice_details.xlsx",  why: "invoice numbers, HSN and product names" },
];

const money = (v) => fmt(Number(v || 0));

function Kpi({ label, value, sub, accent = C.orange, big }) {
  return (
    <div style={{
      background: C.white, border: `1px solid ${C.border}`,
      borderTop: `3px solid ${accent}`, borderRadius: 12,
      padding: big ? "18px 24px" : "13px 18px", minWidth: 0, flex: "1 1 170px",
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: C.gray400,
        letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 5,
      }}>{label}</div>
      <div style={{
        fontSize: big ? 30 : 20, fontWeight: 800, fontFamily: "monospace",
        color: accent, lineHeight: 1.1, wordBreak: "break-all",
      }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.gray400, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function Section({ title, count, hint, children, actions }) {
  return (
    <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
      <div style={{
        padding: "12px 18px", borderBottom: `1px solid ${C.gray100}`,
        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
      }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: C.gray800 }}>{title}</span>
        {count !== undefined && (
          <span style={{
            fontSize: 11, fontWeight: 700, color: C.gray500,
            background: C.gray100, borderRadius: 10, padding: "2px 8px",
          }}>{count}</span>
        )}
        {hint && <span style={{ fontSize: 11, color: C.gray400, flex: 1, minWidth: 120 }}>{hint}</span>}
        {actions}
      </div>
      {children}
    </div>
  );
}

const th = { ...S.th, whiteSpace: "nowrap" };
const thR = { ...th, textAlign: "right" };
const tdR = { ...S.td, textAlign: "right", fontFamily: "monospace", whiteSpace: "nowrap" };

export function GstTab() {
  const isMobile = useIsMobile();

  const [periods, setPeriods]   = useState([]);
  const [period, setPeriod]     = useState(null);   // {financial_year, month_number}
  const [summary, setSummary]   = useState(null);
  const [mm, setMm]             = useState(null);
  const [loading, setLoading]   = useState(false);
  const [tcsRate, setTcsRate]   = useState("0.5");

  const [uploading, setUploading] = useState(false);
  const [uploadLog, setUploadLog] = useState([]);   // [{type, text}]
  const [dragging, setDragging]   = useState(false);
  const fileRef = useRef(null);

  const loadPeriods = useCallback(async () => {
    const res = await fetch(`${API}/gst/periods/`);
    const d = await res.json();
    setPeriods(d.periods || []);
    setPeriod((prev) => {
      if (prev && (d.periods || []).some(p => p.financial_year === prev.financial_year && p.month_number === prev.month_number)) return prev;
      return (d.periods || [])[0] || null;
    });
  }, []);

  useEffect(() => { loadPeriods(); }, [loadPeriods]);

  const loadPeriodData = useCallback(async () => {
    if (!period) { setSummary(null); setMm(null); return; }
    setLoading(true);
    try {
      const q = `fy=${period.financial_year}&month=${period.month_number}`;
      const [s, m] = await Promise.all([
        fetch(`${API}/gst/summary/?${q}&tcs_rate=${encodeURIComponent(tcsRate || "0")}`).then(r => r.json()),
        fetch(`${API}/gst/mismatches/?${q}`).then(r => r.json()),
      ]);
      setSummary(s);
      setMm(m);
    } finally {
      setLoading(false);
    }
  }, [period, tcsRate]);

  useEffect(() => { loadPeriodData(); }, [loadPeriodData]);

  // All three files can be dropped at once — each is identified server-side.
  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setUploading(true);
    setUploadLog([]);
    const log = [];
    for (const f of files) {
      try {
        const form = new FormData();
        form.append("file", f);
        const res = await fetch(`${API}/gst/upload/`, { method: "POST", body: form });
        const d = await res.json();
        if (!res.ok || !d.success) {
          log.push({ type: "error", text: `${f.name}: ${d.error || "upload failed"}` });
        } else {
          const replaced = d.rows_replaced ? `, replaced ${d.rows_replaced} existing` : "";
          log.push({
            type: "success",
            text: `${f.name} → ${d.file_type}: ${d.rows_imported} rows${replaced} (${(d.periods || []).join(", ")})`,
          });
        }
      } catch {
        log.push({ type: "error", text: `${f.name}: network error` });
      }
      setUploadLog([...log]);
    }
    setUploading(false);
    await loadPeriods();
    await loadPeriodData();
  };

  const loadedTypes = new Set(uploadLog.filter(l => l.type === "success").map(l => (/→ ([^:]+):/.exec(l.text) || [])[1]));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: C.gray800, display: "flex", alignItems: "center", gap: 8 }}>
            <AccountBalanceIcon style={{ color: C.orange, fontSize: 22 }} /> GST
          </h1>
          <p style={{ fontSize: 12, color: C.gray400, marginTop: 4 }}>
            Monthly GST from Meesho's TCS exports — output tax on sales less returns, with rate and HSN checks.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {periods.length > 0 && (
            <select
              value={period ? `${period.financial_year}-${period.month_number}` : ""}
              onChange={(e) => {
                const [fy, mn] = e.target.value.split("-").map(Number);
                setPeriod({ financial_year: fy, month_number: mn });
              }}
              style={{ ...S.inp, maxWidth: 230 }}
            >
              {periods.map(p => (
                <option key={`${p.financial_year}-${p.month_number}`} value={`${p.financial_year}-${p.month_number}`}>
                  {p.label} — {p.sale_lines} sales / {p.return_lines} returns
                </option>
              ))}
            </select>
          )}
          <button onClick={() => fileRef.current?.click()} disabled={uploading} style={btn("ghostOrange", "md")}>
            <UploadFileIcon style={{ fontSize: 16, verticalAlign: "-3px" }} />&nbsp;Upload files
          </button>
        </div>
      </div>

      {/* ── Upload ── */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
        onClick={() => fileRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? C.orange : C.gray200}`,
          borderRadius: 14, padding: isMobile ? "18px 14px" : "22px 20px",
          background: dragging ? C.orangeLight : C.gray50,
          textAlign: "center", cursor: "pointer",
        }}
      >
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" multiple style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files; handleFiles(f); e.target.value = ""; }} />
        {uploading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
            <CircularProgress size={18} style={{ color: C.orange }} />
            <span style={{ color: C.gray500, fontSize: 13 }}>Reading files…</span>
          </div>
        ) : (
          <>
            <UploadFileIcon style={{ fontSize: 30, color: C.gray300 }} />
            <p style={{ fontSize: 13, fontWeight: 600, color: C.gray600, marginTop: 4 }}>
              Drop all three Meesho GST exports here — or click to browse
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginTop: 8 }}>
              {EXPECTED_FILES.map(f => (
                <Tooltip key={f.key} title={f.why}>
                  <span>
                    <Tag variant={loadedTypes.has(f.key) ? "green" : "gray"}>
                      {loadedTypes.has(f.key) ? "✓ " : ""}{f.label}
                    </Tag>
                  </span>
                </Tooltip>
              ))}
            </div>
            <p style={{ fontSize: 11, color: C.gray400, marginTop: 8 }}>
              Each file is identified automatically. Re-uploading a month replaces that month's rows, so a corrected export supersedes the old one.
            </p>
          </>
        )}
      </div>

      {uploadLog.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {uploadLog.map((l, i) => (
            <div key={i} style={{
              padding: "10px 16px", borderRadius: 10, fontSize: 13, fontWeight: 500,
              background: l.type === "success" ? C.greenLight : C.redLight,
              color: l.type === "success" ? C.green : C.red,
              border: `1px solid ${l.type === "success" ? C.greenBorder : C.redBorder}`,
              display: "flex", alignItems: "flex-start", gap: 8,
            }}>
              {l.type === "success" ? <CheckCircleIcon style={{ fontSize: 17 }} /> : <WarningAmberIcon style={{ fontSize: 17 }} />}
              <span style={{ minWidth: 0 }}>{l.text}</span>
            </div>
          ))}
        </div>
      )}

      {loading && (
        <div style={{ display: "flex", justifyContent: "center", padding: 36 }}>
          <CircularProgress style={{ color: C.orange }} />
        </div>
      )}

      {!loading && !summary && periods.length === 0 && (
        <div style={{ ...S.card, textAlign: "center", padding: 40, color: C.gray400, fontSize: 13 }}>
          No GST data yet — upload the three Meesho exports above to see the monthly position.
        </div>
      )}

      {!loading && summary && (
        <>
          {/* ── Headline ── */}
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <Kpi big label="GST payable this month" value={money(summary.net.gst_payable)}
              accent={C.orange} sub="output tax on sales, less returns" />
            <Kpi label="Net taxable value" value={money(summary.net.taxable)} accent={C.blue}
              sub={`${summary.sales.lines} sale lines − ${summary.returns.lines} return lines`} />
            <Kpi label="Output tax on sales" value={money(summary.sales.tax)} accent={C.green}
              sub={`on ${money(summary.sales.taxable)} taxable`} />
            <Kpi label="Tax reversed on returns" value={money(summary.returns.tax)} accent={C.red}
              sub={`on ${money(summary.returns.taxable)} taxable`} />
          </div>

          {/* ── Place of supply ── */}
          <Section title="Split by place of supply"
            hint={`Your GSTIN is registered in ${summary.supplier_state || "—"}, so sales there are CGST+SGST and the rest is IGST.`}>
            <div style={{ padding: 18, display: "grid", gap: 14, gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr" }}>
              <div style={{ background: C.gray50, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.gray500, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Intra-state ({summary.supplier_state || "—"})
                </div>
                <div style={{ fontSize: 12, color: C.gray500, margin: "8px 0" }}>
                  Taxable <strong style={{ fontFamily: "monospace" }}>{money(summary.place_of_supply.intra_state.taxable)}</strong>
                </div>
                <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
                  <div><div style={{ fontSize: 10, color: C.gray400, fontWeight: 700 }}>CGST</div>
                    <div style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 16, color: C.gray800 }}>{money(summary.place_of_supply.intra_state.cgst)}</div></div>
                  <div><div style={{ fontSize: 10, color: C.gray400, fontWeight: 700 }}>SGST</div>
                    <div style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 16, color: C.gray800 }}>{money(summary.place_of_supply.intra_state.sgst)}</div></div>
                </div>
              </div>
              <div style={{ background: C.gray50, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.gray500, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Inter-state
                </div>
                <div style={{ fontSize: 12, color: C.gray500, margin: "8px 0" }}>
                  Taxable <strong style={{ fontFamily: "monospace" }}>{money(summary.place_of_supply.inter_state.taxable)}</strong>
                </div>
                <div><div style={{ fontSize: 10, color: C.gray400, fontWeight: 700 }}>IGST</div>
                  <div style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 16, color: C.gray800 }}>{money(summary.place_of_supply.inter_state.igst)}</div></div>
              </div>
            </div>
          </Section>

          {/* ── TCS (estimate) ── */}
          <Section title="TCS collected by Meesho — estimate"
            actions={
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 11, color: C.gray400 }}>rate %</span>
                <input value={tcsRate} onChange={(e) => setTcsRate(e.target.value)}
                  style={{ ...S.inp, width: 78, padding: "5px 9px", fontSize: 12, fontFamily: "monospace" }} />
              </div>
            }>
            <div style={{ padding: 18, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ fontSize: 26, fontWeight: 800, fontFamily: "monospace", color: C.blue }}>
                {money(summary.tcs.estimated_credit)}
              </div>
              <div style={{
                flex: 1, minWidth: 200, fontSize: 12, color: "#92400E",
                background: C.amberLight, border: `1px solid ${C.amberBorder}`,
                borderRadius: 8, padding: "9px 12px",
              }}>
                <strong>Estimate only.</strong> {summary.tcs.note}
              </div>
            </div>
          </Section>

          {/* ── Rate-wise ── */}
          <Section title="Rate-wise summary" count={summary.by_rate.length}
            hint="Net of returns — the shape GSTR-1 asks for">
            <div className="scroll-x">
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead><tr>
                  <th style={th}>GST rate</th><th style={thR}>Lines</th>
                  <th style={thR}>Sale taxable</th><th style={thR}>Sale tax</th>
                  <th style={thR}>Return taxable</th><th style={thR}>Return tax</th>
                  <th style={thR}>Net taxable</th><th style={thR}>Net tax</th>
                </tr></thead>
                <tbody>
                  {summary.by_rate.map((r, i) => (
                    <tr key={r.gst_rate} style={{ background: i % 2 ? C.gray50 : C.white }}>
                      <td style={S.td}><Tag variant="blue">{r.gst_rate}%</Tag></td>
                      <td style={tdR}>{r.lines}</td>
                      <td style={tdR}>{money(r.sale_taxable)}</td>
                      <td style={tdR}>{money(r.sale_tax)}</td>
                      <td style={{ ...tdR, color: C.red }}>{money(r.return_taxable)}</td>
                      <td style={{ ...tdR, color: C.red }}>{money(r.return_tax)}</td>
                      <td style={{ ...tdR, fontWeight: 700 }}>{money(r.net_taxable)}</td>
                      <td style={{ ...tdR, fontWeight: 800, color: C.orange }}>{money(r.net_tax)}</td>
                    </tr>
                  ))}
                  <tr style={{ background: C.gray100, fontWeight: 800 }}>
                    <td style={{ ...S.td, fontWeight: 800 }}>Total</td>
                    <td style={tdR}>{summary.by_rate.reduce((a, r) => a + r.lines, 0)}</td>
                    <td style={tdR}>{money(summary.sales.taxable)}</td>
                    <td style={tdR}>{money(summary.sales.tax)}</td>
                    <td style={tdR}>{money(summary.returns.taxable)}</td>
                    <td style={tdR}>{money(summary.returns.tax)}</td>
                    <td style={tdR}>{money(summary.net.taxable)}</td>
                    <td style={{ ...tdR, color: C.orange }}>{money(summary.net.tax)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Section>

          {/* ── DIFFERENCES: rate mismatch vs your catalogue ── */}
          {mm && (
            <Section
              title="Differences — GST rate filed vs your product rate"
              count={mm.rate_mismatches.length}
              hint={`${mm.coverage.lines_checked} lines checked · ${mm.coverage.lines_on_unpriced_skus} on SKUs with no rate set · ${mm.coverage.lines_without_matching_sub_order} sub-orders not in Order Payments`}
            >
              {mm.rate_mismatches.length === 0 ? (
                <div style={{ padding: 26, textAlign: "center", color: C.green, fontSize: 13, fontWeight: 600 }}>
                  <CheckCircleIcon style={{ fontSize: 18, verticalAlign: "-4px" }} />&nbsp;
                  Every filed line matches the GST rate configured for its SKU.
                </div>
              ) : (
                <>
                  <div style={{
                    margin: 14, padding: "11px 15px", borderRadius: 10, fontSize: 13,
                    background: Number(mm.rate_mismatch_total_difference) < 0 ? C.redLight : C.amberLight,
                    border: `1px solid ${Number(mm.rate_mismatch_total_difference) < 0 ? C.redBorder : C.amberBorder}`,
                    color: Number(mm.rate_mismatch_total_difference) < 0 ? C.red : "#92400E",
                    fontWeight: 600, display: "flex", alignItems: "flex-start", gap: 8,
                  }}>
                    <ErrorOutlineIcon style={{ fontSize: 18, flexShrink: 0 }} />
                    <span>
                      Net tax difference across these lines: <strong>{money(mm.rate_mismatch_total_difference)}</strong>.
                      {Number(mm.rate_mismatch_total_difference) < 0
                        ? " Negative means Meesho charged more GST than your catalogue expects — check whether your SKU rate is out of date or the filing is wrong."
                        : " Positive means less GST was charged than your catalogue expects."}
                    </span>
                  </div>
                  <div className="scroll-x">
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <thead><tr>
                        <th style={th}>SKU</th><th style={th}>HSN</th>
                        <th style={th}>Filed</th><th style={th}>Your rate</th>
                        <th style={thR}>Lines</th><th style={thR}>Net taxable</th>
                        <th style={thR}>Tax filed</th><th style={thR}>At your rate</th>
                        <th style={thR}>Difference</th>
                      </tr></thead>
                      <tbody>
                        {mm.rate_mismatches.map((r, i) => {
                          const diff = Number(r.difference);
                          return (
                            <tr key={`${r.sku}-${r.filed_rate}-${r.configured_rate}`} style={{ background: i % 2 ? C.gray50 : C.white }}>
                              <td style={{ ...S.td, maxWidth: 230 }}>
                                <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: C.orange }}>{r.sku}</span>
                                {!!r.sample_sub_orders?.length && (
                                  <div style={{ fontSize: 10, color: C.gray400, fontFamily: "monospace" }}>
                                    e.g. {r.sample_sub_orders[0]}
                                  </div>
                                )}
                              </td>
                              <td style={{ ...S.td, fontFamily: "monospace", fontSize: 12 }}>{r.hsn || "—"}</td>
                              <td style={S.td}><Tag variant="red">{r.filed_rate}%</Tag></td>
                              <td style={S.td}><Tag variant="green">{r.configured_rate}%</Tag></td>
                              <td style={tdR}>{r.lines}</td>
                              <td style={tdR}>{money(r.net_taxable)}</td>
                              <td style={tdR}>{money(r.tax_filed)}</td>
                              <td style={tdR}>{money(r.tax_at_configured_rate)}</td>
                              <td style={{ ...tdR, fontWeight: 800, color: diff < 0 ? C.red : C.green }}>
                                {diff > 0 ? "+" : ""}{money(r.difference)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </Section>
          )}

          {/* ── DIFFERENCES: one HSN, several rates ── */}
          {mm && mm.hsn_rate_conflicts.length > 0 && (
            <Section title="Differences — same HSN filed at more than one rate"
              count={mm.hsn_rate_conflicts.length}
              hint="An HSN code has a single statutory rate, so these are worth explaining before they're queried">
              <div className="scroll-x">
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead><tr>
                    <th style={th}>HSN</th><th style={th}>Rates it was filed at</th><th style={thR}>Total lines</th>
                  </tr></thead>
                  <tbody>
                    {mm.hsn_rate_conflicts.map((h, i) => (
                      <tr key={h.hsn} style={{ background: i % 2 ? C.gray50 : C.white }}>
                        <td style={{ ...S.td, fontFamily: "monospace", fontWeight: 700 }}>{h.hsn}</td>
                        <td style={S.td}>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {h.rates.map(r => (
                              <Tag key={r.gst_rate} variant="amber">
                                {r.gst_rate}% · {r.lines} lines · {money(r.net_taxable)}
                              </Tag>
                            ))}
                          </div>
                        </td>
                        <td style={tdR}>{h.total_lines}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {/* ── File arithmetic check ── */}
          <Section title="File consistency check"
            hint="Recomputes taxable × rate for every line and compares it with the tax in Meesho's file">
            <div style={{ padding: 18 }}>
              {summary.file_arithmetic_issues.length === 0 ? (
                <span style={{ color: C.green, fontSize: 13, fontWeight: 600 }}>
                  <CheckCircleIcon style={{ fontSize: 18, verticalAlign: "-4px" }} />&nbsp;
                  All {summary.sales.lines + summary.returns.lines} lines reconcile — taxable × rate equals the tax stated in the file.
                </span>
              ) : (
                <>
                  <div style={{ color: C.red, fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
                    {summary.file_arithmetic_issues.length} line(s) where the file's tax doesn't match taxable × rate:
                  </div>
                  <div className="scroll-x">
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead><tr>
                        <th style={th}>Sub-order</th><th style={th}>Kind</th><th style={thR}>Rate</th>
                        <th style={thR}>Taxable</th><th style={thR}>Tax in file</th>
                        <th style={thR}>Recomputed</th><th style={thR}>Diff</th>
                      </tr></thead>
                      <tbody>
                        {summary.file_arithmetic_issues.map((r, i) => (
                          <tr key={i} style={{ background: i % 2 ? C.gray50 : C.white }}>
                            <td style={{ ...S.td, fontFamily: "monospace", fontSize: 11 }}>{r.sub_order_num}</td>
                            <td style={S.td}><Tag variant={r.kind === "RETURN" ? "red" : "gray"}>{r.kind}</Tag></td>
                            <td style={tdR}>{r.gst_rate}%</td>
                            <td style={tdR}>{money(r.taxable)}</td>
                            <td style={tdR}>{money(r.tax_in_file)}</td>
                            <td style={tdR}>{money(r.tax_recomputed)}</td>
                            <td style={{ ...tdR, color: C.red, fontWeight: 700 }}>{money(r.difference)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </Section>

          {/* ── HSN summary ── */}
          <Section title="HSN summary" count={summary.by_hsn.length} hint="Net of returns">
            <div className="scroll-x">
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead><tr>
                  <th style={th}>HSN</th><th style={th}>Rate(s)</th><th style={thR}>Lines</th>
                  <th style={thR}>Net qty</th><th style={thR}>Net taxable</th><th style={thR}>Net tax</th>
                </tr></thead>
                <tbody>
                  {summary.by_hsn.map((h, i) => (
                    <tr key={h.hsn} style={{ background: i % 2 ? C.gray50 : C.white }}>
                      <td style={{ ...S.td, fontFamily: "monospace", fontWeight: 700 }}>{h.hsn}</td>
                      <td style={S.td}>
                        {h.rates.map(r => (
                          <Tag key={r} variant={h.rates.length > 1 ? "amber" : "gray"}>{r}%</Tag>
                        ))}
                      </td>
                      <td style={tdR}>{h.lines}</td>
                      <td style={tdR}>{h.qty}</td>
                      <td style={tdR}>{money(h.net_taxable)}</td>
                      <td style={tdR}>{money(h.net_tax)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {/* ── State summary ── */}
          <Section title="By customer state" count={summary.by_state.length} hint="Net of returns">
            <div className="scroll-x">
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead><tr>
                  <th style={th}>State</th><th style={thR}>Lines</th>
                  <th style={thR}>Net taxable</th><th style={thR}>Net tax</th>
                </tr></thead>
                <tbody>
                  {summary.by_state.map((s, i) => (
                    <tr key={s.state} style={{ background: i % 2 ? C.gray50 : C.white }}>
                      <td style={S.td}>{s.state}</td>
                      <td style={tdR}>{s.lines}</td>
                      <td style={tdR}>{money(s.net_taxable)}</td>
                      <td style={tdR}>{money(s.net_tax)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
