import React, { useState, useEffect, useRef, useCallback } from "react";
import { API, C, S, btn, Tag, useIsMobile } from "../../App";
import { useDateFilter } from "../../contexts/DateFilterContext";
import { BarcodeScanner } from "../shared/BarcodeScanner";
import QrCodeScannerIcon from "@mui/icons-material/QrCodeScanner";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineOutlined";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import Inventory2Icon from "@mui/icons-material/Inventory2";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import CloseIcon from "@mui/icons-material/Close";
import { CircularProgress } from "@mui/material";

const PAGE_SIZE = 40;

// One place that decides how each status looks and reads, so the pills, the
// inline row selector and the just-scanned card never disagree.
const STATUS_META = {
  SCANNED:    { label: "Scanned",    tag: "blue",   accent: C.blue },
  PACKED:     { label: "Packed",     tag: "amber",  accent: C.amber },
  DISPATCHED: { label: "Dispatched", tag: "green",  accent: C.green },
  ON_HOLD:    { label: "On hold",    tag: "orange", accent: C.orange },
  ISSUE:      { label: "Problem",    tag: "red",    accent: C.red },
  CANCELLED:  { label: "Cancelled",  tag: "gray",   accent: C.gray400 },
};

const STATUS_ORDER = ["SCANNED", "PACKED", "DISPATCHED", "ON_HOLD", "ISSUE", "CANCELLED"];

// Where the scanned code was recognised from. "Not recognised" is not a failure
// — the scan is still logged — so it reads as information, not as an error.
const MATCH_META = {
  LABEL:   { label: "From label",    tag: "green" },
  PAYMENT: { label: "From payments", tag: "blue" },
  ORDER:   { label: "From orders",   tag: "blue" },
  NONE:    { label: "Not recognised", tag: "amber" },
};

// Meesho's own status, bucketed server-side.
const MEESHO_TAG = {
  delivered: "green", rto: "red", return: "orange",
  cancelled: "gray", shipped: "blue", other: "gray",
};

const fmtDateTime = (iso) =>
  iso ? new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  }) : "—";

function Field({ label, value, mono }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.gray400, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 3 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, color: C.gray800, fontWeight: 600, fontFamily: mono ? "monospace" : "inherit", wordBreak: "break-word" }}>
        {value || <span style={{ color: C.gray300, fontWeight: 400 }}>—</span>}
      </div>
    </div>
  );
}

function StatPill({ label, value, accent, onClick, active }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: active ? accent : C.white,
        border: `1px solid ${active ? accent : C.border}`,
        borderTop: `3px solid ${accent}`,
        borderRadius: 12, padding: "12px 20px", minWidth: 120,
        cursor: onClick ? "pointer" : "default",
        display: "flex", flexDirection: "column", gap: 3,
      }}
    >
      <span style={{
        fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase",
        color: active ? "rgba(255,255,255,0.85)" : C.gray400,
      }}>{label}</span>
      <span style={{
        fontSize: 24, fontWeight: 800, fontFamily: "monospace",
        color: active ? C.white : C.gray800,
      }}>{value ?? "—"}</span>
    </div>
  );
}

// ── The card shown right after a scan, so the desk can eyeball the parcel ──────
function ScannedCard({ result, onStatus, onNotes, saving, onClose }) {
  const isMobile = useIsMobile();
  const row = result.row;
  const meta = STATUS_META[row.status] || STATUS_META.SCANNED;
  const match = MATCH_META[row.matched_from] || MATCH_META.NONE;
  const [notes, setNotes] = useState(row.notes || "");

  useEffect(() => { setNotes(row.notes || ""); }, [row.id, row.notes]);

  return (
    <div style={{ ...S.card, padding: 0, overflow: "hidden", borderTop: `4px solid ${meta.accent}` }}>
      <div style={{ padding: isMobile ? "16px 14px" : "22px 26px", background: C.gray50, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Tag variant={meta.tag} fontSize={12}>{meta.label}</Tag>
            <Tag variant={match.tag} fontSize={12}>{match.label}</Tag>
            {result.already_scanned && (
              <Tag variant="amber" fontSize={12}>Already scanned · {row.scan_count}×</Tag>
            )}
            {row.meesho_status && (
              <Tag variant={MEESHO_TAG[row.meesho_status.bucket] || "gray"} fontSize={12}>
                Meesho: {row.meesho_status.status}
              </Tag>
            )}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: C.gray400, padding: 2 }}>
            <CloseIcon style={{ fontSize: 20 }} />
          </button>
        </div>

        {/* Re-scanning is the one thing worth shouting about: it usually means
            the same parcel is about to go out twice. */}
        {result.already_scanned && (
          <div style={{
            marginBottom: 16, padding: "12px 16px", borderRadius: 10,
            background: C.amberLight, border: `1px solid ${C.amberBorder}`,
            color: "#92400E", fontSize: 13, fontWeight: 600,
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <WarningAmberIcon style={{ fontSize: 18 }} />
            This order was already recorded — first scanned {fmtDateTime(row.first_scanned_at)}.
            Its status was left as <strong>&nbsp;{meta.label}</strong>.
          </div>
        )}

        {row.matched_from === "NONE" && (
          <div style={{
            marginBottom: 16, padding: "12px 16px", borderRadius: 10,
            background: C.blueLight, border: "1px solid #BFDBFE",
            color: "#1E40AF", fontSize: 13, fontWeight: 600,
          }}>
            No label or sheet in the system matches this code, so it was logged as
            scanned with no product details. Upload the labels PDF for this batch and
            the details will show up against it.
          </div>
        )}

        <div style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "minmax(240px, 2fr) 100px minmax(160px, 1fr)",
          gap: isMobile ? 14 : 20, alignItems: "start",
        }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.gray400, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
              SKU
            </div>
            <div style={{
              fontSize: isMobile ? 24 : 32, fontWeight: 800, fontFamily: "monospace",
              lineHeight: 1.15, color: C.gray900, wordBreak: "break-all",
            }}>
              {row.sku || <span style={{ color: C.gray300, fontSize: 20 }}>unknown</span>}
            </div>
            {row.size && row.size !== "Free Size" && (
              <div style={{ fontSize: 14, color: C.gray600, marginTop: 4, fontWeight: 600 }}>Size: {row.size}</div>
            )}
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.gray400, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
              Qty
            </div>
            <div style={{ fontSize: isMobile ? 34 : 42, fontWeight: 800, fontFamily: "monospace", lineHeight: 1, color: C.gray900 }}>
              {row.qty}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.gray400, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
              Courier
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.gray900 }}>{row.courier_name || "—"}</div>
            {row.payment_type && (
              <div style={{ fontSize: 12, color: C.gray500, marginTop: 4 }}>{row.payment_type}</div>
            )}
          </div>
        </div>

        {row.product_name && (
          <div style={{ fontSize: 14, color: C.gray700, marginTop: 16, fontWeight: 500 }}>{row.product_name}</div>
        )}
      </div>

      {/* ── Set where this parcel is now ── */}
      <div style={{ padding: isMobile ? "16px 14px" : "18px 26px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.gray700, marginBottom: 10 }}>
          Where is this parcel now?
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {STATUS_ORDER.map((s) => (
            <button
              key={s}
              onClick={() => onStatus(row.id, s)}
              disabled={saving}
              style={btn(row.status === s ? "primary" : "ghost", "md")}
            >
              {STATUS_META[s].label}
            </button>
          ))}
        </div>
        {row.status_updated_at && (
          <div style={{ fontSize: 12, color: C.gray400, marginTop: 10 }}>
            status set {fmtDateTime(row.status_updated_at)}
          </div>
        )}
      </div>

      {/* ── Note + the rest of what we know ── */}
      <div style={{ padding: isMobile ? "16px 14px" : "20px 26px", display: "flex", flexDirection: "column", gap: 18 }}>
        <div>
          <label style={S.label}>Note (what was wrong, who asked for it, anything to remember)</label>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") onNotes(row.id, notes); }}
              placeholder="Optional"
              style={{ ...S.inp, flex: "1 1 220px", minWidth: 0 }}
            />
            <button onClick={() => onNotes(row.id, notes)} disabled={saving || notes === (row.notes || "")}
              style={{ ...btn("ghostOrange", "md"), opacity: saving || notes === (row.notes || "") ? 0.5 : 1 }}>
              Save note
            </button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 18 }}>
          <Field label="Sub-order no" value={row.sub_order_no} mono />
          <Field label="AWB number" value={row.awb_number} mono />
          <Field label="Scanned code" value={row.scanned_code} mono />
          <Field label="Customer" value={[row.customer_name, row.customer_city].filter(Boolean).join(" · ")} />
          <Field label="Pincode" value={row.customer_pincode} mono />
          <Field label="Order date" value={row.order_date} mono />
          <Field label="First scanned" value={fmtDateTime(row.first_scanned_at)} />
          <Field label="Last scanned" value={fmtDateTime(row.last_scanned_at)} />
          <Field label="Scanned by" value={row.scanned_by_name} />
          <Field
            label="Meesho says"
            value={row.meesho_status
              ? `${row.meesho_status.status}${row.meesho_status.as_of ? ` (as of ${row.meesho_status.as_of})` : ""}`
              : "Not reported yet"}
          />
        </div>
      </div>
    </div>
  );
}

// ── Tab ───────────────────────────────────────────────────────────────────────
export function OrderScanTab() {
  const { range, label: periodLabel } = useDateFilter();

  const [scan, setScan]           = useState("");
  const [scanning, setScanning]   = useState(false);
  const [scanError, setScanError] = useState(null);
  const [result, setResult]       = useState(null);   // the just-scanned row
  const [saving, setSaving]       = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const scanRef = useRef(null);

  // The status new scans are recorded with. Set it once and work through the
  // pile — scanning to "Packed" all morning shouldn't need a click per parcel.
  const [scanStatus, setScanStatus] = useState("SCANNED");

  const [rows, setRows]       = useState([]);
  const [total, setTotal]     = useState(0);
  const [stats, setStats]     = useState(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage]       = useState(1);
  const [search, setSearch]   = useState("");
  const [statusFilter, setStatusFilter]   = useState("");
  const [matchedFilter, setMatchedFilter] = useState("");
  const [selected, setSelected] = useState([]);

  // A status filter is deliberately all-time: a parcel stuck on hold must never
  // be hidden by whatever period is selected in the global date bar.
  const ignorePeriod = !!statusFilter;

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", page);
      params.set("page_size", PAGE_SIZE);
      if (search.trim())  params.set("q", search.trim());
      if (statusFilter)   params.set("status", statusFilter);
      if (matchedFilter)  params.set("matched", matchedFilter);
      if (!ignorePeriod) {
        if (range.date_from) params.set("date_from", range.date_from);
        if (range.date_to)   params.set("date_to", range.date_to);
      }
      const res  = await fetch(`${API}/order-scan/?${params}`);
      const data = await res.json();
      setRows(data.results || []);
      setTotal(data.total ?? 0);
      setStats(data.stats || null);
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, matchedFilter, ignorePeriod, range.date_from, range.date_to]);

  useEffect(() => { fetchList(); }, [fetchList]);
  useEffect(() => { setPage(1); setSelected([]); }, [search, statusFilter, matchedFilter, range.date_from, range.date_to]);
  useEffect(() => { scanRef.current?.focus(); }, []);

  const recordScan = async (codeRaw) => {
    const code = (codeRaw ?? "").trim();
    if (!code) return;
    setScanning(true);
    setScanError(null);
    try {
      const res  = await fetch(`${API}/order-scan/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, status: scanStatus }),
      });
      const data = await res.json();
      if (!res.ok) {
        setScanError(data.error || "Could not record that scan.");
      } else {
        setResult(data);
        setStats(data.stats || stats);
        setScan("");
        fetchList();
      }
    } catch {
      setScanError("Network error — the scan was not recorded.");
    } finally {
      setScanning(false);
      // Hand focus straight back so the next parcel can be scanned immediately.
      setTimeout(() => scanRef.current?.focus(), 0);
    }
  };

  const patchRow = async (id, payload) => {
    setSaving(true);
    try {
      const res  = await fetch(`${API}/order-scan/${id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setScanError(data.error || "Could not save.");
        return;
      }
      setStats(data.stats || stats);
      setResult(prev => (prev?.row?.id === data.id ? { ...prev, row: data } : prev));
      setRows(prev => prev.map(r => (r.id === data.id ? data : r)));
    } catch {
      setScanError("Network error — could not save.");
    } finally {
      setSaving(false);
    }
  };

  const deleteRow = async (id) => {
    if (!window.confirm("Remove this scan from the log? The order itself is not touched.")) return;
    setSaving(true);
    try {
      const res = await fetch(`${API}/order-scan/${id}/`, { method: "DELETE" });
      if (!res.ok) {
        setScanError("Could not delete that scan.");
        return;
      }
      setResult(prev => (prev?.row?.id === id ? null : prev));
      setSelected(prev => prev.filter(s => s !== id));
      fetchList();
    } catch {
      setScanError("Network error — could not delete.");
    } finally {
      setSaving(false);
    }
  };

  const bulkStatus = async (newStatus) => {
    if (!selected.length) return;
    setSaving(true);
    try {
      const res  = await fetch(`${API}/order-scan/bulk-status/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selected, status: newStatus }),
      });
      const data = await res.json();
      if (!res.ok) {
        setScanError(data.error || "Could not update those scans.");
        return;
      }
      setSelected([]);
      fetchList();
    } catch {
      setScanError("Network error — could not update.");
    } finally {
      setSaving(false);
    }
  };

  const toggleSelected = (id) =>
    setSelected(prev => (prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]));
  const allOnPageSelected = rows.length > 0 && rows.every(r => selected.includes(r.id));
  const toggleAllOnPage = () =>
    setSelected(prev => (allOnPageSelected
      ? prev.filter(id => !rows.some(r => r.id === id))
      : [...new Set([...prev, ...rows.map(r => r.id)])]));

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>

      {cameraOpen && (
        <BarcodeScanner
          onDetected={(code) => { setCameraOpen(false); recordScan(code); }}
          onClose={() => setCameraOpen(false)}
        />
      )}

      {/* ── Header ── */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Inventory2Icon style={{ color: C.orange, fontSize: 22 }} />
          <h1 style={{ fontSize: 20, fontWeight: 800, color: C.gray800 }}>Order Scan</h1>
        </div>
        <p style={{ fontSize: 12, color: C.gray400, marginTop: 4 }}>
          Scan every outgoing parcel to record it, then look its status up later · period: {periodLabel}
        </p>
      </div>

      {/* ── Anything sitting on hold or flagged ── */}
      {stats?.needs_attention > 0 && (
        <div style={{
          padding: "13px 18px", borderRadius: 12,
          background: C.amberLight, border: `1px solid ${C.amberBorder}`,
          color: "#92400E", fontSize: 14, fontWeight: 600,
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        }}>
          <WarningAmberIcon style={{ fontSize: 20, color: C.amber }} />
          <span>{stats.needs_attention} scanned order(s) are on hold or flagged as a problem.</span>
          <button onClick={() => { setStatusFilter("ATTENTION"); setMatchedFilter(""); }}
            style={{ ...btn("primary", "sm"), marginLeft: "auto" }}>
            Show them
          </button>
        </div>
      )}

      {/* ── Scanner ── */}
      <div style={{ ...S.card, borderTop: `4px solid ${C.orange}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
          <QrCodeScannerIcon style={{ color: C.orange, fontSize: 20 }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: C.gray800 }}>Scan the shipping label</span>
          <span style={{ fontSize: 12, color: C.gray400 }}>AWB or sub-order number — or type it and press Enter</span>
        </div>

        {/* Record-as selector: set it once, then work through the pile. */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: C.gray600 }}>Record each scan as:</span>
          {STATUS_ORDER.slice(0, 3).map((s) => (
            <button key={s} onClick={() => setScanStatus(s)}
              style={btn(scanStatus === s ? "primary" : "ghost", "sm")}>
              {STATUS_META[s].label}
            </button>
          ))}
        </div>

        {/* Camera scan — the primary action on a phone, a convenience on desktop
            where a USB/bluetooth scanner types into the box instead. */}
        <button onClick={() => setCameraOpen(true)}
          style={{ ...btn("secondary", "lg"), width: "100%", marginBottom: 12, padding: "14px 20px", fontSize: 15 }}>
          <PhotoCameraIcon style={{ fontSize: 20, verticalAlign: "-5px" }} />
          &nbsp;Scan with phone camera
        </button>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            ref={scanRef}
            value={scan}
            onChange={(e) => setScan(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") recordScan(scan); }}
            placeholder="Waiting for scan…"
            autoComplete="off"
            spellCheck={false}
            style={{
              ...S.inp, flex: "1 1 200px", minWidth: 0, fontSize: 22, fontFamily: "monospace",
              fontWeight: 700, padding: "14px 18px", letterSpacing: "0.03em",
              borderColor: C.orangeBorder, background: C.orangeLight,
            }}
          />
          <button onClick={() => recordScan(scan)} disabled={scanning || !scan.trim()}
            style={{ ...btn("primary", "lg"), opacity: scanning || !scan.trim() ? 0.5 : 1 }}>
            {scanning ? <CircularProgress size={16} style={{ color: "#fff" }} /> : "Record scan"}
          </button>
        </div>

        {scanError && (
          <div style={{
            marginTop: 12, padding: "11px 16px", borderRadius: 10,
            background: C.redLight, border: `1px solid ${C.redBorder}`, color: C.red,
            fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 8,
          }}>
            <ErrorOutlineIcon style={{ fontSize: 17 }} />
            {scanError}
            <button onClick={() => setScanError(null)}
              style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "inherit", fontSize: 16 }}>×</button>
          </div>
        )}

        {result && !result.already_scanned && (
          <div style={{
            marginTop: 12, padding: "11px 16px", borderRadius: 10,
            background: C.greenLight, border: `1px solid ${C.greenBorder}`, color: C.green,
            fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 8,
          }}>
            <CheckCircleIcon style={{ fontSize: 17 }} />
            Recorded {result.row.sub_order_no} as {STATUS_META[result.row.status]?.label}.
          </div>
        )}
      </div>

      {/* ── The parcel just scanned ── */}
      {result && (
        <>
          <ScannedCard
            result={result}
            saving={saving}
            onStatus={(id, s) => patchRow(id, { status: s })}
            onNotes={(id, notes) => patchRow(id, { notes })}
            onClose={() => { setResult(null); scanRef.current?.focus(); }}
          />
          <button onClick={() => setCameraOpen(true)} style={{ ...btn("secondary", "lg"), alignSelf: "flex-start" }}>
            <PhotoCameraIcon style={{ fontSize: 18, verticalAlign: "-4px" }} />
            &nbsp;Scan next parcel
          </button>
        </>
      )}

      {/* ── Stats (all-time, click to filter) ── */}
      {stats && (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <StatPill label="Scanned total" value={stats.total} accent={C.orange}
            onClick={() => { setStatusFilter(""); setMatchedFilter(""); }}
            active={!statusFilter && !matchedFilter} />
          <StatPill label="Today" value={stats.scanned_today} accent={C.blue} />
          <StatPill label="Still open" value={stats.open} accent={C.amber}
            onClick={() => { setStatusFilter("OPEN"); setMatchedFilter(""); }}
            active={statusFilter === "OPEN"} />
          <StatPill label="Dispatched" value={stats.dispatched} accent={C.green}
            onClick={() => { setStatusFilter("DISPATCHED"); setMatchedFilter(""); }}
            active={statusFilter === "DISPATCHED"} />
          <StatPill label="Needs a look" value={stats.needs_attention} accent={C.red}
            onClick={() => { setStatusFilter("ATTENTION"); setMatchedFilter(""); }}
            active={statusFilter === "ATTENTION"} />
          <StatPill label="Re-scanned" value={stats.rescanned} accent={C.gray600} />
          <StatPill label="Unrecognised" value={stats.unrecognised} accent={C.gray400}
            onClick={() => { setMatchedFilter("no"); setStatusFilter(""); }}
            active={matchedFilter === "no"} />
        </div>
      )}

      {/* ── Filters ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search sub-order / AWB / SKU / customer…"
          style={{ ...S.inp, maxWidth: 320 }} />
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setMatchedFilter(""); }}
          style={{ ...S.inp, maxWidth: 200 }}>
          <option value="">All statuses</option>
          <option value="OPEN">Still in our hands</option>
          <option value="ATTENTION">On hold or problem</option>
          {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </select>
        <select value={matchedFilter} onChange={(e) => setMatchedFilter(e.target.value)}
          style={{ ...S.inp, maxWidth: 190 }}>
          <option value="">Recognised or not</option>
          <option value="yes">Matched an order</option>
          <option value="no">Not recognised</option>
        </select>
        {(statusFilter || matchedFilter) && (
          <button onClick={() => { setStatusFilter(""); setMatchedFilter(""); }} style={btn("ghost", "sm")}>
            Clear filters
          </button>
        )}
        {ignorePeriod && (
          <span style={{ fontSize: 12, color: C.gray400 }}>
            Showing all time — the period filter is ignored so nothing open is hidden.
          </span>
        )}
      </div>

      {/* ── Bulk action bar ── */}
      {selected.length > 0 && (
        <div style={{
          ...S.card, padding: "12px 18px", display: "flex", alignItems: "center",
          gap: 10, flexWrap: "wrap", borderTop: `3px solid ${C.blue}`,
        }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.gray700 }}>
            {selected.length} selected — mark as:
          </span>
          {STATUS_ORDER.map(s => (
            <button key={s} onClick={() => bulkStatus(s)} disabled={saving} style={btn("ghost", "sm")}>
              {STATUS_META[s].label}
            </button>
          ))}
          <button onClick={() => setSelected([])} style={{ ...btn("ghost", "sm"), marginLeft: "auto" }}>
            Clear selection
          </button>
        </div>
      )}

      {/* ── The log ── */}
      <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 44 }}>
            <CircularProgress style={{ color: C.orange }} />
          </div>
        ) : (
          <>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ ...S.th, width: 34 }}>
                      <input type="checkbox" checked={allOnPageSelected} onChange={toggleAllOnPage} />
                    </th>
                    {["Scanned", "Sub-order", "SKU", "Qty", "Courier / Customer", "Status", "Meesho says", "Note", ""].map(h => (
                      <th key={h} style={S.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan={10} style={{ ...S.td, textAlign: "center", padding: 44, color: C.gray400 }}>
                      {stats?.total ? "No scans match these filters" : "Nothing scanned yet — scan a shipping label above to start the log"}
                    </td></tr>
                  ) : rows.map((r, idx) => {
                    const meta  = STATUS_META[r.status] || STATUS_META.SCANNED;
                    const match = MATCH_META[r.matched_from] || MATCH_META.NONE;
                    const isActive = result?.row?.id === r.id;
                    const rowBg = isActive ? C.orangeLight : idx % 2 === 0 ? C.white : C.gray50;
                    return (
                      <tr key={r.id} style={{ background: rowBg }}>
                        <td style={S.td}>
                          <input type="checkbox" checked={selected.includes(r.id)}
                            onChange={() => toggleSelected(r.id)} />
                        </td>
                        <td style={{ ...S.td, whiteSpace: "nowrap", fontFamily: "monospace", fontSize: 12 }}>
                          {fmtDateTime(r.last_scanned_at)}
                          {r.scan_count > 1 && (
                            <div style={{ fontSize: 10, color: C.amber, fontWeight: 700 }}>{r.scan_count}× scanned</div>
                          )}
                        </td>
                        <td style={{ ...S.td, fontFamily: "monospace", fontSize: 11, color: C.gray600, maxWidth: 170 }}>
                          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 165 }}
                            title={r.sub_order_no}>{r.sub_order_no}</div>
                          <Tag variant={match.tag}>{match.label}</Tag>
                        </td>
                        <td style={{ ...S.td, maxWidth: 210 }}>
                          <div style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: C.orange }}>
                            {r.sku || "—"}
                          </div>
                          {r.product_name && (
                            <div style={{ fontSize: 11, color: C.gray400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}
                              title={r.product_name}>{r.product_name}</div>
                          )}
                        </td>
                        <td style={{ ...S.td, fontFamily: "monospace", fontWeight: 700 }}>{r.qty}</td>
                        <td style={{ ...S.td, fontSize: 12, color: C.gray600, maxWidth: 180 }}>
                          <div>{r.courier_name || "—"}</div>
                          <div style={{ fontSize: 11, color: C.gray400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 170 }}>
                            {[r.customer_name, r.customer_city].filter(Boolean).join(" · ") || "—"}
                          </div>
                        </td>
                        {/* Status is editable inline — the whole point of the log
                            is being able to move a parcel along days later. */}
                        <td style={S.td}>
                          <select
                            value={r.status}
                            onChange={(e) => patchRow(r.id, { status: e.target.value })}
                            disabled={saving}
                            style={{
                              ...S.inp, width: 132, fontSize: 12, fontWeight: 700,
                              padding: "5px 8px", color: meta.accent, borderColor: meta.accent,
                            }}
                          >
                            {STATUS_ORDER.map(s => (
                              <option key={s} value={s}>{STATUS_META[s].label}</option>
                            ))}
                          </select>
                        </td>
                        <td style={{ ...S.td, whiteSpace: "nowrap" }}>
                          {r.meesho_status ? (
                            <>
                              <Tag variant={MEESHO_TAG[r.meesho_status.bucket] || "gray"}>
                                {r.meesho_status.status}
                              </Tag>
                              {r.meesho_status.as_of && (
                                <div style={{ fontSize: 10, color: C.gray400, fontFamily: "monospace", marginTop: 2 }}>
                                  {r.meesho_status.as_of}
                                </div>
                              )}
                            </>
                          ) : (
                            <span style={{ fontSize: 11, color: C.gray300 }}>not reported</span>
                          )}
                        </td>
                        <td style={{ ...S.td, fontSize: 11, color: C.gray500, maxWidth: 160 }}>
                          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 150 }}
                            title={r.notes}>{r.notes || "—"}</div>
                        </td>
                        <td style={S.td}>
                          <button onClick={() => deleteRow(r.id)} disabled={saving}
                            title="Remove this scan from the log"
                            style={{ background: "none", border: "none", cursor: "pointer", color: C.gray300, padding: 2 }}>
                            <DeleteOutlineIcon style={{ fontSize: 18 }} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {total > PAGE_SIZE && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 20px", borderTop: `1px solid ${C.gray100}` }}>
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
