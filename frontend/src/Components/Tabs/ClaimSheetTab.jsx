import React, { useState, useEffect, useRef, useCallback } from "react";
import { API, C, S, btn, Tag, fmt, useIsMobile } from "../../App";
import { useDateFilter } from "../../contexts/DateFilterContext";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineOutlined";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import { CircularProgress } from "@mui/material";

const PAGE_SIZE = 40;

const STATUS_META = {
  OPEN:     { label: "Open",     tag: "blue",  accent: C.blue },
  APPROVED: { label: "Approved", tag: "green", accent: C.green },
  REJECTED: { label: "Rejected", tag: "red",   accent: C.red },
  OTHER:    { label: "Other",    tag: "gray",  accent: C.gray400 },
};

const PAY_META = {
  PAID:      { label: "Paid",      tag: "green" },
  SCHEDULED: { label: "Scheduled", tag: "amber" },
  NONE:      { label: "—",         tag: "gray" },
};

const VIEWS = [
  { key: "",           label: "All",        stat: "total" },
  { key: "OPEN",       label: "Open",       stat: "open" },
  { key: "APPROVED",   label: "Approved",   stat: "approved" },
  { key: "REJECTED",   label: "Rejected",   stat: "rejected" },
  { key: "REOPENABLE", label: "Can reopen", stat: "reopenable" },
];

const fmtDate = (v) => (v ? new Date(v).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");

function Metric({ label, value, accent, money, onClick, active }) {
  return (
    <button onClick={onClick} disabled={!onClick} style={{
      background: active ? accent : C.white,
      border: `1px solid ${active ? accent : C.border}`,
      borderLeft: `3px solid ${accent}`,
      borderRadius: 9, padding: "9px 15px",
      cursor: onClick ? "pointer" : "default",
      display: "flex", flexDirection: "column", gap: 2,
      fontFamily: "inherit", textAlign: "left", minWidth: 96,
    }}>
      <span style={{
        fontSize: 18, fontWeight: 800, fontFamily: "monospace", lineHeight: 1.1,
        color: active ? C.white : money ? C.green : C.gray800,
      }}>{money ? fmt(value) : (value ?? "—")}</span>
      <span style={{
        fontSize: 10.5, fontWeight: 600, whiteSpace: "nowrap",
        color: active ? "rgba(255,255,255,0.9)" : C.gray500,
      }}>{label}</span>
    </button>
  );
}

export function ClaimSheetTab() {
  const { range, label: periodLabel } = useDateFilter();
  const isMobile = useIsMobile();

  const [rows, setRows]     = useState([]);
  const [total, setTotal]   = useState(0);
  const [stats, setStats]   = useState(null);
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage]     = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [payFilter, setPayFilter]       = useState("");
  const [issueFilter, setIssueFilter]   = useState("");
  const [onlyUnlinked, setOnlyUnlinked] = useState(false);
  const [expanded, setExpanded]         = useState(null);

  const [uploading, setUploading] = useState(false);
  const [msg, setMsg]             = useState(null);
  const [dragging, setDragging]   = useState(false);
  const [relinking, setRelinking] = useState(false);
  const fileRef = useRef(null);

  // Status filters are all-time on purpose: a rejection you can still argue must
  // not vanish because the date bar is on this month.
  const ignorePeriod = !!statusFilter || !!payFilter || onlyUnlinked;

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      p.set("page", page);
      p.set("page_size", PAGE_SIZE);
      if (search.trim())  p.set("q", search.trim());
      if (statusFilter)   p.set("ticket_status", statusFilter);
      if (payFilter)      p.set("payment", payFilter);
      if (issueFilter)    p.set("issue", issueFilter);
      if (onlyUnlinked)   p.set("linked", "no");
      if (!ignorePeriod) {
        if (range.date_from) p.set("date_from", range.date_from);
        if (range.date_to)   p.set("date_to", range.date_to);
      }
      const res  = await fetch(`${API}/claims/?${p}`);
      const data = await res.json();
      setRows(data.results || []);
      setTotal(data.total ?? 0);
      setStats(data.stats || null);
      setIssues(data.issues || []);
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, payFilter, issueFilter, onlyUnlinked, ignorePeriod, range.date_from, range.date_to]);

  useEffect(() => { fetchList(); }, [fetchList]);
  useEffect(() => { setPage(1); }, [search, statusFilter, payFilter, issueFilter, onlyUnlinked, range.date_from, range.date_to]);

  const handleFile = async (file) => {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    setUploading(true);
    setMsg(null);
    try {
      const res  = await fetch(`${API}/claims/upload/`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setMsg({ type: "error", text: data.error || "Upload failed." });
        return;
      }
      const bits = [`${data.created} new`, `${data.updated} updated`];
      if (data.skipped) bits.push(`${data.skipped} skipped`);
      setMsg({
        type: "success",
        text: `Uploaded — ${bits.join(", ")}. ${data.linked} ticket(s) matched a return and had its claim status updated`
          + (data.unlinked ? `; ${data.unlinked} had no matching return yet.` : "."),
      });
      setStats(data.stats || stats);
      fetchList();
    } catch {
      setMsg({ type: "error", text: "Network error during upload." });
    } finally {
      setUploading(false);
    }
  };

  const relink = async () => {
    setRelinking(true);
    setMsg(null);
    try {
      const res  = await fetch(`${API}/claims/relink/`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) { setMsg({ type: "error", text: data.error || "Could not re-link." }); return; }
      setMsg({ type: "success", text: `Checked ${data.checked} unlinked ticket(s) — ${data.linked} now matched a return.` });
      setStats(data.stats || stats);
      fetchList();
    } catch {
      setMsg({ type: "error", text: "Network error." });
    } finally {
      setRelinking(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <ReceiptLongIcon style={{ color: C.orange, fontSize: 21 }} />
            <h1 style={{ fontSize: 19, fontWeight: 800, color: C.gray800 }}>Claim Sheet</h1>
          </div>
          <p style={{ fontSize: 12, color: C.gray400, marginTop: 3 }}>
            Upload the supplier-panel ticket export — approvals, rejections and money land against your returns · {periodLabel}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {stats?.unlinked > 0 && (
            <button onClick={relink} disabled={relinking} style={{ ...btn("ghost", "sm"), opacity: relinking ? 0.5 : 1 }}>
              {relinking ? <CircularProgress size={13} /> : <LinkOffIcon style={{ fontSize: 15, verticalAlign: "-3px" }} />}
              &nbsp;Re-link {stats.unlinked}
            </button>
          )}
          <button onClick={() => fileRef.current?.click()} style={btn("primary", "sm")}>
            <UploadFileIcon style={{ fontSize: 15, verticalAlign: "-3px" }} />&nbsp;Upload sheet
          </button>
        </div>
      </div>

      {/* ── Dropzone ── */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
        onClick={() => fileRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? C.orange : C.gray200}`,
          borderRadius: 14, padding: "22px 20px",
          background: dragging ? C.orangeLight : C.gray50,
          textAlign: "center", cursor: "pointer",
        }}
      >
        <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: "none" }}
          onChange={(e) => { handleFile(e.target.files[0]); e.target.value = ""; }} />
        {uploading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
            <CircularProgress size={18} style={{ color: C.orange }} />
            <span style={{ color: C.gray500, fontSize: 13.5 }}>Reading the sheet…</span>
          </div>
        ) : (
          <>
            <UploadFileIcon style={{ fontSize: 30, color: C.gray300, marginBottom: 4 }} />
            <p style={{ fontSize: 13.5, fontWeight: 600, color: C.gray600 }}>
              Drop <code>Supplier-…_Status-all_Created-from-…csv</code> here, or click to browse
            </p>
            <p style={{ fontSize: 11.5, color: C.gray400, marginTop: 4, lineHeight: 1.6 }}>
              Matched on ticket id, so re-uploading an overlapping range updates rather than duplicates.
              Amounts and transaction ids are read out of the sheet's own wording. Your hand-written claim
              notes are never overwritten.
            </p>
          </>
        )}
      </div>

      {msg && (
        <div style={{
          padding: "11px 16px", borderRadius: 10, fontSize: 13, fontWeight: 500,
          background: msg.type === "success" ? C.greenLight : C.redLight,
          color: msg.type === "success" ? C.green : C.red,
          border: `1px solid ${msg.type === "success" ? C.greenBorder : C.redBorder}`,
          display: "flex", alignItems: "flex-start", gap: 8,
        }}>
          {msg.type === "success" ? <CheckCircleIcon style={{ fontSize: 17, flexShrink: 0 }} /> : <WarningAmberIcon style={{ fontSize: 17, flexShrink: 0 }} />}
          <span style={{ flex: 1 }}>{msg.text}</span>
          <button onClick={() => setMsg(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", fontSize: 16 }}>×</button>
        </div>
      )}

      {/* ── Money + counts ── */}
      {stats && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Metric label="approved ₹" value={stats.amount_approved} accent={C.green} money />
            <Metric label="paid ₹" value={stats.amount_paid} accent={C.green} money
              onClick={() => { setPayFilter("PAID"); setStatusFilter(""); }} active={payFilter === "PAID"} />
            <Metric label="scheduled ₹" value={stats.amount_scheduled} accent={C.amber} money
              onClick={() => { setPayFilter("SCHEDULED"); setStatusFilter(""); }} active={payFilter === "SCHEDULED"} />
            <Metric label="tickets" value={stats.total} accent={C.orange}
              onClick={() => { setStatusFilter(""); setPayFilter(""); setOnlyUnlinked(false); }}
              active={!statusFilter && !payFilter && !onlyUnlinked} />
            <Metric label="rejected" value={stats.rejected} accent={C.red}
              onClick={() => { setStatusFilter("REJECTED"); setPayFilter(""); }} active={statusFilter === "REJECTED"} />
            <Metric label="no return matched" value={stats.unlinked} accent={C.gray500}
              onClick={() => { setOnlyUnlinked(true); setStatusFilter(""); setPayFilter(""); }} active={onlyUnlinked} />
          </div>

          {stats.reopenable > 0 && (
            <div style={{
              padding: "12px 18px", borderRadius: 12,
              background: C.amberLight, border: `1px solid ${C.amberBorder}`,
              color: "#92400E", fontSize: 13.5, fontWeight: 600,
              display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
            }}>
              <WarningAmberIcon style={{ fontSize: 19, color: C.amber }} />
              <span>{stats.reopenable} rejected claim(s) can still be reopened — their window hasn't closed yet.</span>
              <button onClick={() => { setStatusFilter("REOPENABLE"); setPayFilter(""); }}
                style={{ ...btn("primary", "sm"), marginLeft: "auto" }}>Show them</button>
            </div>
          )}

          {stats.unlinked > 0 && (
            <div style={{
              padding: "11px 18px", borderRadius: 12,
              background: C.blueLight, border: "1px solid #BFDBFE",
              color: "#1E40AF", fontSize: 12.5, fontWeight: 600,
            }}>
              {stats.unlinked} ticket(s) have no matching return on file, so their claim status can't be
              written back yet. Upload the Returns export covering those dates, then hit <strong>Re-link</strong>.
            </div>
          )}
        </>
      )}

      {/* ── Views + filters ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "inline-flex", background: C.gray100, borderRadius: 10, padding: 3, border: `1px solid ${C.border}` }}>
          {VIEWS.map((v) => {
            const active = statusFilter === v.key && !payFilter && !onlyUnlinked;
            return (
              <button key={v.key || "all"}
                onClick={() => { setStatusFilter(v.key); setPayFilter(""); setOnlyUnlinked(false); }}
                style={{
                  border: "none", cursor: "pointer", fontFamily: "inherit",
                  background: active ? C.white : "transparent",
                  color: active ? C.gray800 : C.gray500,
                  fontWeight: active ? 800 : 600, fontSize: 12.5,
                  padding: "6px 13px", borderRadius: 8,
                  boxShadow: active ? "0 1px 3px rgba(0,0,0,0.10)" : "none",
                }}>
                {v.label}{stats?.[v.stat] != null && <span style={{ opacity: 0.6 }}> {stats[v.stat]}</span>}
              </button>
            );
          })}
        </div>
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search ticket / sub-order / SKU / txn id…"
          style={{ ...S.inp, maxWidth: 290, flex: "1 1 190px" }} />
        <select value={issueFilter} onChange={(e) => setIssueFilter(e.target.value)} style={{ ...S.inp, maxWidth: 260 }}>
          <option value="">Any issue</option>
          {issues.map((i) => <option key={i} value={i}>{i}</option>)}
        </select>
        {(statusFilter || payFilter || issueFilter || onlyUnlinked) && (
          <button onClick={() => { setStatusFilter(""); setPayFilter(""); setIssueFilter(""); setOnlyUnlinked(false); }}
            style={btn("ghost", "sm")}>Clear</button>
        )}
      </div>

      {/* ── Table ── */}
      <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
            <CircularProgress style={{ color: C.orange }} />
          </div>
        ) : (
          <>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
                <thead>
                  <tr>
                    {["Status", "Raised", "Issue", "Amount", "Payment", "Sub-order", "Return", "Reopen by", ""].map(h => (
                      <th key={h} style={S.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan={9} style={{ ...S.td, textAlign: "center", padding: 40, color: C.gray400 }}>
                      {stats?.total ? "No tickets match these filters" : "No claim tickets yet — upload the supplier-panel export above"}
                    </td></tr>
                  ) : rows.map((t, idx) => {
                    const meta = STATUS_META[t.ticket_status] || STATUS_META.OTHER;
                    const pay  = PAY_META[t.payment_state] || PAY_META.NONE;
                    const open = expanded === t.id;
                    return (
                      <React.Fragment key={t.id}>
                        <tr style={{ background: open ? C.orangeLight : idx % 2 === 0 ? C.white : C.gray50 }}>
                          <td style={{ ...S.td, whiteSpace: "nowrap" }}>
                            <Tag variant={meta.tag} fontSize={11.5}>{meta.label}</Tag>
                            {t.is_reopenable && (
                              <div style={{ fontSize: 10, color: C.amber, fontWeight: 700, marginTop: 2 }}>
                                can reopen
                              </div>
                            )}
                          </td>
                          <td style={{ ...S.td, whiteSpace: "nowrap", fontSize: 12, color: C.gray600 }}>
                            {fmtDate(t.created_at_meesho)}
                            <div style={{ fontSize: 10, color: C.gray400, fontFamily: "monospace" }}>{t.ticket_id}</div>
                          </td>
                          <td style={{ ...S.td, maxWidth: 220, fontSize: 12.5, color: C.gray700 }}>
                            <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 210 }}
                              title={t.issue}>{t.issue || "—"}</div>
                          </td>
                          <td style={{ ...S.td, fontFamily: "monospace", fontWeight: 700, whiteSpace: "nowrap",
                                       color: t.claim_amount ? C.green : C.gray300 }}>
                            {t.claim_amount ? fmt(t.claim_amount) : "—"}
                          </td>
                          <td style={{ ...S.td, whiteSpace: "nowrap" }}>
                            {t.payment_state !== "NONE" ? (
                              <>
                                <Tag variant={pay.tag} fontSize={11}>{pay.label}</Tag>
                                {t.settled_on && (
                                  <div style={{ fontSize: 10, color: C.gray400, fontFamily: "monospace", marginTop: 2 }}>
                                    {fmtDate(t.settled_on)}
                                  </div>
                                )}
                              </>
                            ) : <span style={{ color: C.gray300 }}>—</span>}
                          </td>
                          <td style={{ ...S.td, fontFamily: "monospace", fontSize: 11.5, color: C.gray600, maxWidth: 160 }}>
                            <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 155 }}
                              title={t.suborder_no}>{t.suborder_no || "—"}</div>
                          </td>
                          <td style={S.td}>
                            {t.linked_return ? (
                              <Tag variant="green" fontSize={11}>matched</Tag>
                            ) : (
                              <Tag variant="gray" fontSize={11}>not on file</Tag>
                            )}
                          </td>
                          <td style={{ ...S.td, whiteSpace: "nowrap", fontSize: 12, color: C.gray600 }}>
                            {t.reopen_validity ? (
                              <>
                                {fmtDate(t.reopen_validity)}
                                {t.days_to_reopen != null && (
                                  <div style={{ fontSize: 10, fontWeight: 700, color: t.days_to_reopen >= 0 ? C.amber : C.gray400 }}>
                                    {t.days_to_reopen >= 0 ? `${t.days_to_reopen}d left` : "closed"}
                                  </div>
                                )}
                              </>
                            ) : "—"}
                          </td>
                          <td style={S.td}>
                            <button onClick={() => setExpanded(open ? null : t.id)} style={btn("ghost", "sm")}>
                              {open ? "Hide" : "Why"}
                            </button>
                          </td>
                        </tr>
                        {open && (
                          <tr>
                            <td colSpan={9} style={{ ...S.td, background: C.gray50, padding: "14px 18px" }}>
                              <div style={{ fontSize: 10.5, fontWeight: 700, color: C.gray400, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 6 }}>
                                What Meesho said
                              </div>
                              <div style={{ fontSize: 13, color: C.gray700, lineHeight: 1.65, maxWidth: 900 }}>
                                {t.last_update_text || <span style={{ color: C.gray300 }}>No update recorded.</span>}
                              </div>
                              {t.transaction_id && (
                                <div style={{ fontSize: 12, color: C.gray500, marginTop: 8, fontFamily: "monospace" }}>
                                  transaction id: {t.transaction_id}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {total > PAGE_SIZE && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 18px", borderTop: `1px solid ${C.gray100}` }}>
                <span style={{ fontSize: 12, color: C.gray400 }}>
                  {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
                </span>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => setPage(p => p - 1)} disabled={page === 1}
                    style={{ ...btn("ghost", "sm"), opacity: page === 1 ? 0.4 : 1 }}>← Prev</button>
                  <span style={{ fontSize: 12, color: C.gray500, padding: "0 6px", alignSelf: "center" }}>Page {page} / {totalPages}</span>
                  <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages}
                    style={{ ...btn("ghost", "sm"), opacity: page >= totalPages ? 0.4 : 1 }}>Next →</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
