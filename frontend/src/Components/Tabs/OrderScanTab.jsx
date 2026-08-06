import React, { useState, useEffect, useRef, useCallback } from "react";
import { API, C, S, btn, Tag, useIsMobile } from "../../App";
import { useDateFilter } from "../../contexts/DateFilterContext";
import { BarcodeScanner } from "../shared/BarcodeScanner";
import QrCodeScannerIcon from "@mui/icons-material/QrCodeScanner";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineOutlined";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import Inventory2Icon from "@mui/icons-material/Inventory2";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import CloseIcon from "@mui/icons-material/Close";
import { CircularProgress } from "@mui/material";

const PAGE_SIZE = 40;

// Where the parcel is in *our* process.
const STATUS_META = {
  SCANNED:    { label: "Scanned",    tag: "blue",   accent: C.blue },
  PACKED:     { label: "Packed",     tag: "amber",  accent: C.amber },
  DISPATCHED: { label: "Dispatched", tag: "green",  accent: C.green },
  ON_HOLD:    { label: "On hold",    tag: "orange", accent: C.orange },
  ISSUE:      { label: "Problem",    tag: "red",    accent: C.red },
  CANCELLED:  { label: "Cancelled",  tag: "gray",   accent: C.gray400 },
};
const STATUS_ORDER = ["SCANNED", "PACKED", "DISPATCHED", "ON_HOLD", "ISSUE", "CANCELLED"];

// What Meesho's own sheets say happened to it. This is the check that matters:
// a parcel we packed that Meesho still lists as READY_TO_SHIP never went out.
const SHIP_META = {
  SHIPPED:     { label: "Shipped",     tag: "green", accent: C.green,   short: "shipped" },
  NOT_SHIPPED: { label: "NOT shipped", tag: "red",   accent: C.red,     short: "not shipped" },
  CANCELLED:   { label: "Cancelled",   tag: "gray",  accent: C.gray500, short: "cancelled" },
  UNKNOWN:     { label: "No status",   tag: "amber", accent: C.amber,   short: "no status yet" },
};

const MATCH_META = {
  LABEL:   { label: "From label",     tag: "green" },
  PAYMENT: { label: "From payments",  tag: "blue" },
  ORDER:   { label: "From orders",    tag: "blue" },
  NONE:    { label: "Not recognised", tag: "amber" },
};

// The segmented views. "Not shipped" is first after All because it is the only
// one that needs someone to do something today.
const VIEWS = [
  { key: "",            label: "All" },
  { key: "PROBLEM",     label: "Not shipped" },
  { key: "SHIPPED",     label: "Shipped" },
  { key: "UNKNOWN",     label: "No status" },
];

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
      <div style={{ fontSize: 13.5, color: C.gray800, fontWeight: 600, fontFamily: mono ? "monospace" : "inherit", wordBreak: "break-word" }}>
        {value || <span style={{ color: C.gray300, fontWeight: 400 }}>—</span>}
      </div>
    </div>
  );
}

/** Compact metric chip — replaces the oversized pills, which crowded the page. */
function Metric({ label, value, accent, onClick, active }) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      style={{
        background: active ? accent : C.white,
        border: `1px solid ${active ? accent : C.border}`,
        borderLeft: `3px solid ${accent}`,
        borderRadius: 9, padding: "8px 14px",
        cursor: onClick ? "pointer" : "default",
        display: "flex", alignItems: "baseline", gap: 8,
        fontFamily: "inherit", textAlign: "left",
      }}
    >
      <span style={{
        fontSize: 19, fontWeight: 800, fontFamily: "monospace", lineHeight: 1,
        color: active ? C.white : C.gray800,
      }}>{value ?? "—"}</span>
      <span style={{
        fontSize: 11, fontWeight: 600, whiteSpace: "nowrap",
        color: active ? "rgba(255,255,255,0.9)" : C.gray500,
      }}>{label}</span>
    </button>
  );
}

/** The big verdict banner on the just-scanned card. */
function ShipVerdict({ row }) {
  const meta = SHIP_META[row.ship_status] || SHIP_META.UNKNOWN;
  const bad = row.ship_status === "NOT_SHIPPED" || row.ship_status === "CANCELLED";
  const unknown = row.ship_status === "UNKNOWN";
  return (
    <div style={{
      padding: "12px 16px", borderRadius: 10, marginTop: 14,
      background: bad ? C.redLight : unknown ? C.amberLight : C.greenLight,
      border: `1px solid ${bad ? C.redBorder : unknown ? C.amberBorder : C.greenBorder}`,
      color: bad ? C.red : unknown ? "#92400E" : C.green,
      fontSize: 13.5, fontWeight: 600, display: "flex", alignItems: "flex-start", gap: 9,
    }}>
      {bad ? <WarningAmberIcon style={{ fontSize: 19, flexShrink: 0 }} />
           : unknown ? <ErrorOutlineIcon style={{ fontSize: 19, flexShrink: 0 }} />
           : <LocalShippingIcon style={{ fontSize: 19, flexShrink: 0 }} />}
      <div>
        {row.ship_status === "SHIPPED" && <>Meesho has this as dispatched — good to send out.</>}
        {row.ship_status === "NOT_SHIPPED" && (
          <>Meesho still lists this as <strong>{row.ship_status_raw || "not dispatched"}</strong> — it has not shipped. Don't hand it over until the panel updates.</>
        )}
        {row.ship_status === "CANCELLED" && (
          <>This order is <strong>cancelled</strong> on Meesho — do not ship it.</>
        )}
        {unknown && (
          <>No uploaded sheet covers this order yet, so its shipping status is unknown. Upload the latest Orders export and hit Re-check.</>
        )}
      </div>
    </div>
  );
}

// ── The card shown right after a scan ─────────────────────────────────────────
function ScannedCard({ result, onStatus, onNotes, saving, onClose }) {
  const isMobile = useIsMobile();
  const row = result.row;
  const meta = STATUS_META[row.status] || STATUS_META.SCANNED;
  const match = MATCH_META[row.matched_from] || MATCH_META.NONE;
  const ship = SHIP_META[row.ship_status] || SHIP_META.UNKNOWN;
  const [notes, setNotes] = useState(row.notes || "");

  useEffect(() => { setNotes(row.notes || ""); }, [row.id, row.notes]);

  return (
    <div style={{ ...S.card, padding: 0, overflow: "hidden", borderTop: `4px solid ${ship.accent}` }}>
      <div style={{ padding: isMobile ? "16px 14px" : "20px 24px", background: C.gray50, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
            <Tag variant={ship.tag} fontSize={12}>{ship.label}</Tag>
            <Tag variant={meta.tag} fontSize={12}>{meta.label}</Tag>
            <Tag variant={match.tag} fontSize={12}>{match.label}</Tag>
            {result.already_scanned && (
              <Tag variant="amber" fontSize={12}>Already scanned · {row.scan_count}×</Tag>
            )}
            {result.cross_business && (
              <Tag variant="blue" fontSize={12}>◈ {result.business_name}</Tag>
            )}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: C.gray400, padding: 2 }}>
            <CloseIcon style={{ fontSize: 20 }} />
          </button>
        </div>

        {/* SKU and qty are what the operator physically checks against the parcel. */}
        <div style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "minmax(220px, 2fr) 90px minmax(150px, 1fr)",
          gap: isMobile ? 12 : 20, alignItems: "start",
        }}>
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: C.gray400, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 5 }}>SKU</div>
            <div style={{
              fontSize: isMobile ? 22 : 29, fontWeight: 800, fontFamily: "monospace",
              lineHeight: 1.15, color: C.gray900, wordBreak: "break-all",
            }}>
              {row.sku || <span style={{ color: C.gray300, fontSize: 18 }}>unknown</span>}
            </div>
            {row.size && row.size !== "Free Size" && (
              <div style={{ fontSize: 13, color: C.gray600, marginTop: 3, fontWeight: 600 }}>Size: {row.size}</div>
            )}
          </div>
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: C.gray400, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 5 }}>Qty</div>
            <div style={{ fontSize: isMobile ? 30 : 38, fontWeight: 800, fontFamily: "monospace", lineHeight: 1, color: C.gray900 }}>{row.qty}</div>
          </div>
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: C.gray400, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 5 }}>Courier</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.gray900 }}>{row.courier_name || "—"}</div>
            {row.payment_type && <div style={{ fontSize: 12, color: C.gray500, marginTop: 3 }}>{row.payment_type}</div>}
          </div>
        </div>

        {row.product_name && (
          <div style={{ fontSize: 13.5, color: C.gray700, marginTop: 12, fontWeight: 500 }}>{row.product_name}</div>
        )}

        <ShipVerdict row={row} />

        {result.cross_business && (
          <div style={{
            marginTop: 10, padding: "10px 14px", borderRadius: 10,
            background: C.blueLight, border: "1px solid #BFDBFE",
            color: "#1E40AF", fontSize: 12.5, fontWeight: 600,
          }}>
            This parcel belongs to <strong>{result.business_name}</strong>, not the business you have
            selected — it has been recorded there. Tick “All my businesses” below to see it in the list.
          </div>
        )}

        {result.already_scanned && (
          <div style={{
            marginTop: 10, padding: "10px 14px", borderRadius: 10,
            background: C.amberLight, border: `1px solid ${C.amberBorder}`,
            color: "#92400E", fontSize: 12.5, fontWeight: 600,
          }}>
            Already recorded — first scanned {fmtDateTime(row.first_scanned_at)}. Its status was left as
            <strong> {meta.label}</strong>.
          </div>
        )}

        {row.matched_from === "NONE" && (
          <div style={{
            marginTop: 10, padding: "10px 14px", borderRadius: 10,
            background: C.blueLight, border: "1px solid #BFDBFE",
            color: "#1E40AF", fontSize: 12.5, fontWeight: 600,
          }}>
            Nothing in the system matches this code, so it was logged with no product details.
            Upload the labels PDF for this batch and they'll fill in.
          </div>
        )}
      </div>

      {/* ── Move it along ── */}
      <div style={{ padding: isMobile ? "14px" : "16px 24px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: C.gray600, marginBottom: 9, letterSpacing: "0.02em" }}>
          WHERE IS THIS PARCEL NOW?
        </div>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          {STATUS_ORDER.map((s) => (
            <button key={s} onClick={() => onStatus(row.id, s)} disabled={saving}
              style={btn(row.status === s ? "primary" : "ghost", "sm")}>
              {STATUS_META[s].label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Note + details ── */}
      <div style={{ padding: isMobile ? "14px" : "18px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <label style={S.label}>Note</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input value={notes} onChange={(e) => setNotes(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") onNotes(row.id, notes); }}
              placeholder="Anything worth remembering about this parcel"
              style={{ ...S.inp, flex: "1 1 220px", minWidth: 0 }} />
            <button onClick={() => onNotes(row.id, notes)} disabled={saving || notes === (row.notes || "")}
              style={{ ...btn("ghostOrange", "md"), opacity: saving || notes === (row.notes || "") ? 0.5 : 1 }}>
              Save
            </button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 16 }}>
          <Field label="Sub-order no" value={row.sub_order_no} mono />
          <Field label="AWB number" value={row.awb_number} mono />
          <Field label="Meesho status" value={row.ship_status_raw || (row.meesho_status && row.meesho_status.status)} />
          <Field label="Status found via" value={row.ship_source} />
          <Field label="Customer" value={[row.customer_name, row.customer_city].filter(Boolean).join(" · ")} />
          <Field label="First scanned" value={fmtDateTime(row.first_scanned_at)} />
          <Field label="Scanned by" value={row.scanned_by_name} />
        </div>
      </div>
    </div>
  );
}

// ── Tab ───────────────────────────────────────────────────────────────────────
export function OrderScanTab() {
  const { range, label: periodLabel } = useDateFilter();
  const isMobile = useIsMobile();

  const [scan, setScan]           = useState("");
  const [scanning, setScanning]   = useState(false);
  const [scanError, setScanError] = useState(null);
  const [msgFlash, setMsgFlash]   = useState(null);
  const [result, setResult]       = useState(null);
  const [saving, setSaving]       = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [feed, setFeed]           = useState([]);   // live outcomes inside the camera
  const scanRef = useRef(null);
  const feedSeq = useRef(0);

  const [scanStatus, setScanStatus] = useState("SCANNED");

  const [rows, setRows]       = useState([]);
  const [total, setTotal]     = useState(0);
  const [stats, setStats]     = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage]       = useState(1);
  const [search, setSearch]   = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [shipFilter, setShipFilter]     = useState("");
  const [selected, setSelected] = useState([]);
  // Pool across every business this account belongs to. A parcel for a sibling
  // business is filed against that business, so without this the scan you just
  // made would vanish from the list.
  const [pooled, setPooled] = useState(false);

  // Status/ship filters are deliberately all-time: a parcel that never shipped
  // must not be hidden by whatever month is picked in the global date bar.
  const ignorePeriod = !!statusFilter || !!shipFilter;

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", page);
      params.set("page_size", PAGE_SIZE);
      if (search.trim())  params.set("q", search.trim());
      if (statusFilter)   params.set("status", statusFilter);
      if (shipFilter)     params.set("ship", shipFilter);
      if (pooled)         params.set("pool", "1");
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
  }, [page, search, statusFilter, shipFilter, pooled, ignorePeriod, range.date_from, range.date_to]);

  useEffect(() => { fetchList(); }, [fetchList]);
  useEffect(() => { setPage(1); setSelected([]); }, [search, statusFilter, shipFilter, range.date_from, range.date_to]);
  useEffect(() => { scanRef.current?.focus(); }, []);

  /** Turn a scan response into one line for the in-camera feed. */
  const pushFeed = (data) => {
    const row = data.row;
    const ship = SHIP_META[row.ship_status] || SHIP_META.UNKNOWN;
    const bad = row.ship_status === "NOT_SHIPPED" || row.ship_status === "CANCELLED";
    const lines = [];
    if (row.sku) lines.push(`${row.sku} × ${row.qty}`);
    lines.push(`Meesho: ${ship.short}${row.ship_status_raw ? ` (${row.ship_status_raw})` : ""}`
      + (row.ship_source ? ` · ${row.ship_source}` : ""));
    if (data.cross_business) lines.push(`↦ filed under ${data.business_name}`);
    if (data.already_scanned) lines.push(`Already scanned ${row.scan_count}×`);
    if (row.matched_from === "NONE") lines.push("Not recognised — no product details");

    setFeed((prev) => [{
      id: ++feedSeq.current,
      code: row.sub_order_no,
      kind: bad ? "err" : data.already_scanned || row.ship_status === "UNKNOWN" ? "warn" : "ok",
      title: bad ? `DO NOT SHIP — ${ship.label}` : data.already_scanned ? "Already scanned" : "Recorded",
      lines,
    }, ...prev].slice(0, 30));
  };

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
        setFeed((prev) => [{
          id: ++feedSeq.current, code, kind: "err",
          title: "Rejected", lines: [data.error || "Could not record that scan."],
        }, ...prev].slice(0, 30));
      } else {
        setResult(data);
        setStats(data.stats || stats);
        setScan("");
        pushFeed(data);
        fetchList();
      }
    } catch {
      setScanError("Network error — the scan was not recorded.");
      setFeed((prev) => [{
        id: ++feedSeq.current, code, kind: "err",
        title: "Network error", lines: ["The scan was not recorded."],
      }, ...prev].slice(0, 30));
    } finally {
      setScanning(false);
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
      if (!res.ok) { setScanError(data.error || "Could not save."); return; }
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
      if (!res.ok) { setScanError("Could not delete that scan."); return; }
      setResult(prev => (prev?.row?.id === id ? null : prev));
      setSelected(prev => prev.filter(s => s !== id));
      fetchList();
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
      if (!res.ok) { setScanError(data.error || "Could not update those scans."); return; }
      setSelected([]);
      fetchList();
    } finally {
      setSaving(false);
    }
  };

  /** Re-ask the sheets. A scan made before its Orders export existed is UNKNOWN
      until something re-checks it — this is that something. */
  const refreshShip = async () => {
    setRefreshing(true);
    setScanError(null);
    try {
      const res = await fetch(`${API}/order-scan/refresh-ship/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) { setScanError(data.error || "Could not re-check."); return; }
      setStats(data.stats || stats);
      fetchList();
      setMsgFlash(`Re-checked ${data.checked} scan(s) — ${data.changed} status change(s).`);
    } catch {
      setScanError("Network error — could not re-check.");
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!msgFlash) return;
    const t = setTimeout(() => setMsgFlash(null), 5000);
    return () => clearTimeout(t);
  }, [msgFlash]);

  const toggleSelected = (id) =>
    setSelected(prev => (prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]));
  const allOnPageSelected = rows.length > 0 && rows.every(r => selected.includes(r.id));
  const toggleAllOnPage = () =>
    setSelected(prev => (allOnPageSelected
      ? prev.filter(id => !rows.some(r => r.id === id))
      : [...new Set([...prev, ...rows.map(r => r.id)])]));

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const notShipped = stats?.ship_problem ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

      {cameraOpen && (
        <BarcodeScanner
          continuous
          title="Scan orders"
          hint={`Recording each scan as “${STATUS_META[scanStatus].label}” — keep going`}
          results={feed}
          busy={scanning}
          onDetected={(code) => recordScan(code)}
          onClose={() => setCameraOpen(false)}
        />
      )}

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <Inventory2Icon style={{ color: C.orange, fontSize: 21 }} />
            <h1 style={{ fontSize: 19, fontWeight: 800, color: C.gray800 }}>Order Scan</h1>
          </div>
          <p style={{ fontSize: 12, color: C.gray400, marginTop: 3 }}>
            Scan every outgoing parcel · we check Meesho's own status so nothing unshipped goes out · {periodLabel}
          </p>
        </div>
        <button onClick={refreshShip} disabled={refreshing} style={{ ...btn("ghost", "sm"), opacity: refreshing ? 0.5 : 1 }}>
          {refreshing ? <CircularProgress size={13} /> : <RefreshIcon style={{ fontSize: 15, verticalAlign: "-3px" }} />}
          &nbsp;Re-check shipping
        </button>
      </div>

      {msgFlash && (
        <div style={{
          padding: "10px 16px", borderRadius: 10, background: C.greenLight,
          border: `1px solid ${C.greenBorder}`, color: C.green, fontSize: 13, fontWeight: 600,
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <CheckCircleIcon style={{ fontSize: 17 }} />{msgFlash}
        </div>
      )}

      {/* ── The alert that justifies this whole feature ── */}
      {notShipped > 0 && (
        <div style={{
          padding: "13px 18px", borderRadius: 12,
          background: C.redLight, border: `1px solid ${C.redBorder}`,
          color: C.red, fontSize: 13.5, fontWeight: 600,
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        }}>
          <WarningAmberIcon style={{ fontSize: 20 }} />
          <span>
            {notShipped} scanned order{notShipped === 1 ? "" : "s"} {notShipped === 1 ? "is" : "are"} not
            shipped or cancelled on Meesho — check {notShipped === 1 ? "it" : "them"} before dispatch.
          </span>
          <button onClick={() => { setShipFilter("PROBLEM"); setStatusFilter(""); }}
            style={{ ...btn("danger", "sm"), marginLeft: "auto" }}>
            Show {notShipped === 1 ? "it" : "them"}
          </button>
        </div>
      )}

      {/* ── Scanner ── */}
      <div style={{ ...S.card, borderTop: `4px solid ${C.orange}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12, flexWrap: "wrap" }}>
          <QrCodeScannerIcon style={{ color: C.orange, fontSize: 19 }} />
          <span style={{ fontSize: 13.5, fontWeight: 700, color: C.gray800 }}>Scan the shipping label</span>
          <span style={{ fontSize: 11.5, color: C.gray400 }}>AWB or sub-order number</span>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: C.gray500 }}>record as</span>
            {STATUS_ORDER.slice(0, 3).map((s) => (
              <button key={s} onClick={() => setScanStatus(s)}
                style={btn(scanStatus === s ? "primary" : "ghost", "sm")}>
                {STATUS_META[s].label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
          <button onClick={() => { setFeed([]); setCameraOpen(true); }}
            style={{ ...btn("secondary", "lg"), flex: isMobile ? "1 1 100%" : "0 0 auto", padding: "13px 22px" }}>
            <PhotoCameraIcon style={{ fontSize: 19, verticalAlign: "-5px" }} />
            &nbsp;Camera — keeps scanning
          </button>
          <input
            ref={scanRef}
            value={scan}
            onChange={(e) => setScan(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") recordScan(scan); }}
            placeholder="Waiting for scan…"
            autoComplete="off"
            spellCheck={false}
            style={{
              ...S.inp, flex: "1 1 200px", minWidth: 0, fontSize: 19, fontFamily: "monospace",
              fontWeight: 700, padding: "12px 16px", letterSpacing: "0.02em",
              borderColor: C.orangeBorder, background: C.orangeLight,
            }}
          />
          <button onClick={() => recordScan(scan)} disabled={scanning || !scan.trim()}
            style={{ ...btn("primary", "lg"), opacity: scanning || !scan.trim() ? 0.5 : 1 }}>
            {scanning ? <CircularProgress size={15} style={{ color: "#fff" }} /> : "Record"}
          </button>
        </div>

        {scanError && (
          <div style={{
            marginTop: 11, padding: "10px 15px", borderRadius: 10,
            background: C.redLight, border: `1px solid ${C.redBorder}`, color: C.red,
            fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 8,
          }}>
            <ErrorOutlineIcon style={{ fontSize: 16 }} />
            {scanError}
            <button onClick={() => setScanError(null)}
              style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "inherit", fontSize: 16 }}>×</button>
          </div>
        )}
      </div>

      {result && (
        <ScannedCard
          result={result}
          saving={saving}
          onStatus={(id, s) => patchRow(id, { status: s })}
          onNotes={(id, notes) => patchRow(id, { notes })}
          onClose={() => { setResult(null); scanRef.current?.focus(); }}
        />
      )}

      {/* ── Metrics ── */}
      {stats && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Metric label="scanned" value={stats.total} accent={C.orange}
            onClick={() => { setShipFilter(""); setStatusFilter(""); }}
            active={!shipFilter && !statusFilter} />
          <Metric label="today" value={stats.scanned_today} accent={C.blue} />
          <Metric label="shipped" value={stats.ship_shipped} accent={C.green}
            onClick={() => { setShipFilter("SHIPPED"); setStatusFilter(""); }}
            active={shipFilter === "SHIPPED"} />
          <Metric label="not shipped" value={stats.ship_problem} accent={C.red}
            onClick={() => { setShipFilter("PROBLEM"); setStatusFilter(""); }}
            active={shipFilter === "PROBLEM"} />
          <Metric label="no status yet" value={stats.ship_unknown} accent={C.amber}
            onClick={() => { setShipFilter("UNKNOWN"); setStatusFilter(""); }}
            active={shipFilter === "UNKNOWN"} />
          <Metric label="needs a look" value={stats.needs_attention} accent={C.orange}
            onClick={() => { setStatusFilter("ATTENTION"); setShipFilter(""); }}
            active={statusFilter === "ATTENTION"} />
          <Metric label="re-scanned" value={stats.rescanned} accent={C.gray600} />
        </div>
      )}

      {/* ── Segmented views + search ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "inline-flex", background: C.gray100, borderRadius: 10, padding: 3, border: `1px solid ${C.border}` }}>
          {VIEWS.map((v) => {
            const active = shipFilter === v.key && !statusFilter;
            const count = v.key === "PROBLEM" ? stats?.ship_problem
              : v.key === "SHIPPED" ? stats?.ship_shipped
              : v.key === "UNKNOWN" ? stats?.ship_unknown
              : stats?.total;
            return (
              <button key={v.key || "all"}
                onClick={() => { setShipFilter(v.key); setStatusFilter(""); }}
                style={{
                  border: "none", cursor: "pointer", fontFamily: "inherit",
                  background: active ? C.white : "transparent",
                  color: active ? (v.key === "PROBLEM" ? C.red : C.gray800) : C.gray500,
                  fontWeight: active ? 800 : 600, fontSize: 12.5,
                  padding: "6px 13px", borderRadius: 8,
                  boxShadow: active ? "0 1px 3px rgba(0,0,0,0.10)" : "none",
                }}>
                {v.label}{count != null && <span style={{ opacity: 0.6 }}> {count}</span>}
              </button>
            );
          })}
        </div>
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search sub-order / AWB / SKU / customer…"
          style={{ ...S.inp, maxWidth: 300, flex: "1 1 200px" }} />
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setShipFilter(""); }}
          style={{ ...S.inp, maxWidth: 175 }}>
          <option value="">Any desk status</option>
          <option value="OPEN">Still in our hands</option>
          <option value="ATTENTION">On hold or problem</option>
          {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5,
                        fontWeight: 600, color: pooled ? C.blue : C.gray500, cursor: "pointer" }}>
          <input type="checkbox" checked={pooled} onChange={(e) => setPooled(e.target.checked)} />
          All my businesses
        </label>
        {(statusFilter || shipFilter) && (
          <button onClick={() => { setStatusFilter(""); setShipFilter(""); }} style={btn("ghost", "sm")}>Clear</button>
        )}
      </div>
      {ignorePeriod && (
        <div style={{ fontSize: 11.5, color: C.gray400, marginTop: -8 }}>
          Showing all time — the period filter is ignored so nothing unshipped is hidden.
        </div>
      )}

      {/* ── Bulk bar ── */}
      {selected.length > 0 && (
        <div style={{
          ...S.card, padding: "11px 16px", display: "flex", alignItems: "center",
          gap: 8, flexWrap: "wrap", borderLeft: `3px solid ${C.blue}`,
        }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: C.gray700 }}>{selected.length} selected — mark as:</span>
          {STATUS_ORDER.map(s => (
            <button key={s} onClick={() => bulkStatus(s)} disabled={saving} style={btn("ghost", "sm")}>
              {STATUS_META[s].label}
            </button>
          ))}
          <button onClick={() => setSelected([])} style={{ ...btn("ghost", "sm"), marginLeft: "auto" }}>Clear</button>
        </div>
      )}

      {/* ── Log ── */}
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
                    <th style={{ ...S.th, width: 34 }}>
                      <input type="checkbox" checked={allOnPageSelected} onChange={toggleAllOnPage} />
                    </th>
                    {["Meesho says", "Scanned", "SKU", "Qty", "Sub-order", "Courier / Customer", "Desk status", ""].map(h => (
                      <th key={h} style={S.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan={9} style={{ ...S.td, textAlign: "center", padding: 40, color: C.gray400 }}>
                      {stats?.total ? "No scans match these filters" : "Nothing scanned yet — scan a shipping label above to start the log"}
                    </td></tr>
                  ) : rows.map((r, idx) => {
                    const meta  = STATUS_META[r.status] || STATUS_META.SCANNED;
                    const ship  = SHIP_META[r.ship_status] || SHIP_META.UNKNOWN;
                    const bad   = r.ship_status === "NOT_SHIPPED" || r.ship_status === "CANCELLED";
                    const isActive = result?.row?.id === r.id;
                    const rowBg = isActive ? C.orangeLight : bad ? C.redLight : idx % 2 === 0 ? C.white : C.gray50;
                    return (
                      <tr key={r.id} style={{ background: rowBg }}>
                        <td style={S.td}>
                          <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggleSelected(r.id)} />
                        </td>
                        {/* Shipping verdict leads — it's the reason to look at this table. */}
                        <td style={{ ...S.td, whiteSpace: "nowrap" }}>
                          <Tag variant={ship.tag} fontSize={11.5}>{ship.label}</Tag>
                          {r.ship_status_raw && (
                            <div style={{ fontSize: 10, color: C.gray400, fontFamily: "monospace", marginTop: 2 }}>
                              {r.ship_status_raw}
                            </div>
                          )}
                          {/* Where the verdict came from — the first thing you
                              want when a status looks wrong. */}
                          {r.ship_source && (
                            <div style={{ fontSize: 9.5, color: C.gray300, marginTop: 1 }}>
                              from {r.ship_source}
                            </div>
                          )}
                        </td>
                        <td style={{ ...S.td, whiteSpace: "nowrap", fontSize: 12, color: C.gray600 }}>
                          {fmtDateTime(r.last_scanned_at)}
                          {r.scan_count > 1 && (
                            <div style={{ fontSize: 10, color: C.amber, fontWeight: 700 }}>{r.scan_count}× scanned</div>
                          )}
                        </td>
                        <td style={{ ...S.td, maxWidth: 220 }}>
                          <div style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: C.orange }}>
                            {r.sku || "—"}
                          </div>
                          {r.product_name && (
                            <div style={{ fontSize: 11.5, color: C.gray400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 210 }}
                              title={r.product_name}>{r.product_name}</div>
                          )}
                        </td>
                        <td style={{ ...S.td, fontFamily: "monospace", fontWeight: 700 }}>{r.qty}</td>
                        <td style={{ ...S.td, fontFamily: "monospace", fontSize: 11.5, color: C.gray600, maxWidth: 165 }}>
                          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }}
                            title={r.sub_order_no}>{r.sub_order_no}</div>
                          {r.matched_from === "NONE" && <Tag variant="amber">Not recognised</Tag>}
                          {pooled && r.business_name && (
                            <div style={{ marginTop: 2 }}>
                              <Tag variant="blue" fontSize={10}>◈ {r.business_name}</Tag>
                            </div>
                          )}
                        </td>
                        <td style={{ ...S.td, fontSize: 12, color: C.gray600, maxWidth: 175 }}>
                          <div>{r.courier_name || "—"}</div>
                          <div style={{ fontSize: 11, color: C.gray400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 165 }}>
                            {[r.customer_name, r.customer_city].filter(Boolean).join(" · ") || "—"}
                          </div>
                        </td>
                        <td style={S.td}>
                          <select value={r.status} onChange={(e) => patchRow(r.id, { status: e.target.value })}
                            disabled={saving}
                            style={{
                              ...S.inp, width: 128, fontSize: 12, fontWeight: 700,
                              padding: "5px 8px", color: meta.accent, borderColor: meta.accent,
                            }}>
                            {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
                          </select>
                        </td>
                        <td style={S.td}>
                          <button onClick={() => deleteRow(r.id)} disabled={saving} title="Remove from the log"
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
