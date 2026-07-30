import React, { useState, useEffect, useRef, useCallback } from "react";
import { API, C, S, btn, Tag, fmt, useIsMobile } from "../../App";
import { useDateFilter } from "../../contexts/DateFilterContext";
import { BarcodeScanner } from "../shared/BarcodeScanner";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import QrCodeScannerIcon from "@mui/icons-material/QrCodeScanner";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineOutlined";
import AssignmentTurnedInIcon from "@mui/icons-material/AssignmentTurnedIn";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import KeyboardReturnIcon from "@mui/icons-material/KeyboardReturn";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import CloseIcon from "@mui/icons-material/Close";
import { CircularProgress } from "@mui/material";

const PAGE_SIZE = 40;

// Claim window presentation — one place so the card, the chip and the table
// row all describe the same state in the same words and colour.
const URGENCY_META = {
  ok:       { color: C.green,   bg: C.greenLight, border: C.greenBorder },
  warning:  { color: C.amber,   bg: C.amberLight, border: C.amberBorder },
  last_day: { color: C.red,     bg: C.redLight,   border: C.redBorder },
  expired:  { color: C.red,     bg: C.redLight,   border: C.redBorder },
  none:     { color: C.gray500, bg: C.gray100,    border: C.gray200 },
  unknown:  { color: C.gray500, bg: C.gray100,    border: C.gray200 },
};

const CLAIM_LABELS = {
  UNREVIEWED:   "Not reviewed",
  NOT_REQUIRED: "No claim needed",
  REQUIRED:     "Claim required",
  RAISED:       "Claim raised",
  APPROVED:     "Claim approved",
  REJECTED:     "Claim rejected",
};

const CLAIM_TAG = {
  UNREVIEWED: "gray", NOT_REQUIRED: "gray", REQUIRED: "amber",
  RAISED: "blue", APPROVED: "green", REJECTED: "red",
};

function claimWindowText(row) {
  const { claim_urgency: u, days_left: left, claim_status: cs } = row;
  if (cs === "RAISED" || cs === "APPROVED" || cs === "REJECTED") {
    return row.claim_raised_at
      ? `Claim raised on ${new Date(row.claim_raised_at).toLocaleDateString("en-IN")}`
      : CLAIM_LABELS[cs];
  }
  if (cs === "NOT_REQUIRED") return "Marked as no claim needed";
  if (u === "unknown") return "No delivered date on the sheet — window unknown";
  if (u === "expired") return `Claim window closed ${Math.abs(left)} day${Math.abs(left) === 1 ? "" : "s"} ago`;
  if (u === "last_day") return "TODAY is the last day to raise the claim";
  if (u === "warning") return `Only ${left} day${left === 1 ? "" : "s"} left to raise the claim`;
  return `${left} days left to raise the claim`;
}

function ClaimWindowChip({ row, big }) {
  const meta = URGENCY_META[row.claim_urgency] || URGENCY_META.unknown;
  const urgent = row.claim_urgency === "warning" || row.claim_urgency === "last_day" || row.claim_urgency === "expired";
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 8,
      background: meta.bg, color: meta.color,
      border: `1px solid ${meta.border}`,
      borderRadius: 10, padding: big ? "10px 16px" : "5px 11px",
      fontSize: big ? 15 : 12, fontWeight: 700,
    }}>
      {urgent ? <WarningAmberIcon style={{ fontSize: big ? 20 : 15 }} />
              : <AccessTimeIcon style={{ fontSize: big ? 20 : 15 }} />}
      {claimWindowText(row)}
      {row.claim_deadline && row.claim_urgency !== "none" && (
        <span style={{ fontWeight: 500, opacity: 0.75 }}>· by {row.claim_deadline}</span>
      )}
    </div>
  );
}

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
        borderRadius: 12, padding: "12px 20px", minWidth: 128,
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

// ── The scan-and-verify card ───────────────────────────────────────────────────
function ReturnCard({ row, onPatch, saving, onClose }) {
  const isMobile = useIsMobile();
  const [amount, setAmount]       = useState(row.claim_amount ?? "");
  const [reference, setReference] = useState(row.claim_reference ?? "");
  const [notes, setNotes]         = useState(row.claim_notes ?? "");

  // Re-seed the claim form whenever a different return is loaded into the card.
  useEffect(() => {
    setAmount(row.claim_amount ?? "");
    setReference(row.claim_reference ?? "");
    setNotes(row.claim_notes ?? "");
  }, [row.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const ctx      = row.order_context || {};
  const shipped  = ctx.label;
  const payments = ctx.payments;

  // Cross-check: what we shipped vs what came back. Sources are the label PDF
  // (what physically went out) and the payment sheet (what Meesho billed on).
  const shippedSku = shipped?.sku || payments?.supplier_sku || null;
  const shippedQty = shipped?.qty ?? payments?.quantity ?? null;
  const skuMismatch = shippedSku && shippedSku.trim().toLowerCase() !== (row.sku || "").trim().toLowerCase();
  // Getting back fewer pieces than were shipped is a normal partial return, so
  // only more-back-than-went-out is actually wrong.
  const qtyMismatch = shippedQty != null && Number(row.qty) > Number(shippedQty);
  const partialReturn = shippedQty != null && Number(row.qty) < Number(shippedQty);

  const isRTO   = (row.type_of_return || "").toLowerCase().includes("rto");
  const decided = ["RAISED", "APPROVED", "REJECTED"].includes(row.claim_status);
  const urgency = URGENCY_META[row.claim_urgency] || URGENCY_META.unknown;

  return (
    <div style={{
      ...S.card, padding: 0, overflow: "hidden",
      borderTop: `4px solid ${urgency.color}`,
    }}>
      {/* ── Hero: the three things to check against the parcel in hand ── */}
      <div style={{ padding: isMobile ? "16px 14px" : "22px 26px", background: C.gray50, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Tag variant={isRTO ? "red" : "orange"} fontSize={12}>{row.type_of_return || "Return"}</Tag>
            <Tag variant="gray" fontSize={12}>{row.sub_type || "—"}</Tag>
            <Tag variant={CLAIM_TAG[row.claim_status]} fontSize={12}>{CLAIM_LABELS[row.claim_status]}</Tag>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: C.gray400, padding: 2 }}>
            <CloseIcon style={{ fontSize: 20 }} />
          </button>
        </div>

        {/* On a phone these three stack: the SKU gets the full width (they run
            long, e.g. medium-small-brass-plain-lota-medium-150), then qty and
            date share a row underneath. */}
        <div style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "minmax(240px, 2fr) 110px minmax(180px, 1fr)",
          gap: isMobile ? 14 : 20, alignItems: "start",
        }}>
          {/* SKU — the main thing to eyeball against the product */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.gray400, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
              SKU received back
            </div>
            <div style={{
              fontSize: isMobile ? 25 : 34, fontWeight: 800, fontFamily: "monospace", lineHeight: 1.15,
              color: skuMismatch ? C.red : C.gray900, wordBreak: "break-all",
            }}>
              {row.sku || "—"}
            </div>
            {row.variation && row.variation !== "Free Size" && (
              <div style={{ fontSize: 14, color: C.gray600, marginTop: 4, fontWeight: 600 }}>Variation: {row.variation}</div>
            )}
          </div>

          {/* Qty + returned-on: their own 2-up row on mobile, separate grid
              columns on desktop. */}
          <div style={{
            display: isMobile ? "grid" : "block",
            gridTemplateColumns: isMobile ? "100px 1fr" : undefined,
            gap: isMobile ? 14 : undefined,
          }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.gray400, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
                Qty
              </div>
              <div style={{
                fontSize: isMobile ? 40 : 46, fontWeight: 800, fontFamily: "monospace", lineHeight: 1,
                color: qtyMismatch ? C.red : C.gray900,
              }}>
                {row.qty}
              </div>
            </div>

            {/* Delivered back on — rendered here on mobile so it pairs with qty */}
            {isMobile && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.gray400, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
                  Returned on
                </div>
                <div style={{ fontSize: 20, fontWeight: 800, color: C.gray900, fontFamily: "monospace" }}>
                  {row.delivered_date || "—"}
                </div>
                {row.day_of_window != null && (
                  <div style={{ fontSize: 12, color: C.gray500, marginTop: 4 }}>
                    Day {row.day_of_window} of {row.claim_window_days}
                  </div>
                )}
              </div>
            )}
          </div>

          {!isMobile && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.gray400, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
                Returned to us on
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, color: C.gray900, fontFamily: "monospace" }}>
                {row.delivered_date || "—"}
              </div>
              {row.day_of_window != null && (
                <div style={{ fontSize: 12, color: C.gray500, marginTop: 4 }}>
                  Day {row.day_of_window} of {row.claim_window_days}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ fontSize: 14, color: C.gray700, marginTop: 16, fontWeight: 500 }}>
          {row.product_name}
        </div>

        {/* Cross-check warning */}
        {(skuMismatch || qtyMismatch) && (
          <div style={{
            marginTop: 14, padding: "12px 16px", borderRadius: 10,
            background: C.redLight, border: `1px solid ${C.redBorder}`,
            color: C.red, fontSize: 13, fontWeight: 600,
            display: "flex", alignItems: "flex-start", gap: 8,
          }}>
            <ErrorOutlineIcon style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }} />
            <div>
              Does not match what we shipped:
              {skuMismatch && <div>· shipped SKU <strong>{shippedSku}</strong>, return sheet says <strong>{row.sku}</strong></div>}
              {qtyMismatch && <div>· shipped qty <strong>{shippedQty}</strong>, but <strong>{row.qty}</strong> came back</div>}
            </div>
          </div>
        )}

        {/* Fewer pieces back than went out — expected for a partial return,
            but worth pointing out at the desk. */}
        {partialReturn && !skuMismatch && (
          <div style={{
            marginTop: 14, padding: "10px 16px", borderRadius: 10,
            background: C.blueLight, border: "1px solid #BFDBFE",
            color: "#1E40AF", fontSize: 13, fontWeight: 600,
          }}>
            Partial return — {row.qty} of {shippedQty} pieces shipped have come back.
          </div>
        )}
      </div>

      {/* ── Claim window + decision ── */}
      <div style={{ padding: isMobile ? "16px 14px" : "20px 26px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ marginBottom: 16 }}>
          <ClaimWindowChip row={row} big />
        </div>

        {row.claim_status === "UNREVIEWED" && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.gray700, marginBottom: 10 }}>
              Is a claim required for this return?
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                onClick={() => onPatch(row.id, { claim_status: "REQUIRED" })}
                disabled={saving}
                style={{ ...btn("primary", "lg") }}
              >
                <AssignmentTurnedInIcon style={{ fontSize: 17, verticalAlign: "-3px" }} />
                &nbsp;Yes — claim required
              </button>
              <button
                onClick={() => onPatch(row.id, { claim_status: "NOT_REQUIRED" })}
                disabled={saving}
                style={{ ...btn("ghost", "lg") }}
              >
                No claim needed
              </button>
            </div>
          </div>
        )}

        {row.claim_status === "REQUIRED" && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.gray700, marginBottom: 12 }}>
              Claim flagged — record it once raised on Meesho
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={S.label}>Claim amount (₹)</label>
                <input value={amount} onChange={e => setAmount(e.target.value)} type="number" step="0.01"
                  placeholder="Optional" style={S.inp} />
              </div>
              <div>
                <label style={S.label}>Meesho ticket / claim ref</label>
                <input value={reference} onChange={e => setReference(e.target.value)}
                  placeholder="Optional" style={S.inp} />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={S.label}>Notes</label>
                <input value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="What was wrong, what proof was attached…" style={S.inp} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                onClick={() => onPatch(row.id, {
                  claim_status: "RAISED",
                  claim_amount: amount === "" ? null : amount,
                  claim_reference: reference,
                  claim_notes: notes,
                })}
                disabled={saving}
                style={btn("success", "lg")}
              >
                <CheckCircleIcon style={{ fontSize: 17, verticalAlign: "-3px" }} />
                &nbsp;Claim raised on Meesho
              </button>
              <button
                onClick={() => onPatch(row.id, { claim_amount: amount === "" ? null : amount, claim_reference: reference, claim_notes: notes })}
                disabled={saving}
                style={btn("ghostOrange", "lg")}
              >
                Save details only
              </button>
              <button
                onClick={() => onPatch(row.id, { claim_status: "NOT_REQUIRED" })}
                disabled={saving}
                style={btn("ghost", "lg")}
              >
                Actually, no claim needed
              </button>
            </div>
          </div>
        )}

        {decided && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14, marginBottom: 14 }}>
              <Field label="Claim amount" value={row.claim_amount != null ? fmt(row.claim_amount) : null} mono />
              <Field label="Reference" value={row.claim_reference} mono />
              <Field label="Raised at" value={row.claim_raised_at ? new Date(row.claim_raised_at).toLocaleString("en-IN") : null} />
              <Field label="Notes" value={row.claim_notes} />
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {row.claim_status === "RAISED" && (
                <>
                  <button onClick={() => onPatch(row.id, { claim_status: "APPROVED" })} disabled={saving} style={btn("success", "md")}>
                    Mark approved
                  </button>
                  <button onClick={() => onPatch(row.id, { claim_status: "REJECTED" })} disabled={saving} style={btn("danger", "md")}>
                    Mark rejected
                  </button>
                </>
              )}
              <button onClick={() => onPatch(row.id, { claim_status: "REQUIRED" })} disabled={saving} style={btn("ghost", "md")}>
                Reopen — not actually raised
              </button>
            </div>
          </div>
        )}

        {row.claim_status === "NOT_REQUIRED" && (
          <button onClick={() => onPatch(row.id, { claim_status: "REQUIRED" })} disabled={saving} style={btn("ghostOrange", "md")}>
            Changed my mind — claim is required
          </button>
        )}
      </div>

      {/* ── Physical verification ── */}
      <div style={{ padding: isMobile ? "16px 14px" : "18px 26px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.gray700 }}>Product in hand:</span>
        <button
          onClick={() => onPatch(row.id, { verify_result: "MATCH" })}
          disabled={saving}
          style={{ ...btn(row.verify_result === "MATCH" ? "success" : "ghost", "md") }}
        >
          ✓ Correct product
        </button>
        <button
          onClick={() => onPatch(row.id, { verify_result: "MISMATCH" })}
          disabled={saving}
          style={{ ...btn(row.verify_result === "MISMATCH" ? "danger" : "ghost", "md") }}
        >
          ✗ Wrong / damaged product
        </button>
        {row.verified_at && (
          <span style={{ fontSize: 12, color: C.gray400 }}>
            checked {new Date(row.verified_at).toLocaleString("en-IN")}
          </span>
        )}
      </div>

      {/* ── Everything else about the return ── */}
      <div style={{ padding: isMobile ? "16px 14px" : "20px 26px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 18 }}>
        <Field label="Sub-order no" value={row.suborder_no} mono />
        <Field label="Order no" value={row.order_no} mono />
        <Field label="AWB number" value={row.awb_number} mono />
        <Field label="Courier" value={row.courier_partner} />
        <Field label="Category" value={row.category} />
        <Field label="Return price type" value={row.return_price_type} />
        <Field label="Dispatched on" value={row.dispatch_date} mono />
        <Field label="Return created on" value={row.return_created_date} mono />
        <Field label="OTP verified at" value={row.otp_verified_at ? new Date(row.otp_verified_at).toLocaleString("en-IN") : null} />
        <div style={{ gridColumn: "1 / -1" }}>
          <Field label="Return reason" value={row.return_reason} />
        </div>
        {row.detailed_return_reason && (
          <div style={{ gridColumn: "1 / -1" }}>
            <Field label="Customer said" value={row.detailed_return_reason} />
          </div>
        )}

        {/* What we shipped, for the cross-check */}
        {(shipped || payments) && (
          <div style={{ gridColumn: "1 / -1", borderTop: `1px solid ${C.gray100}`, paddingTop: 16 }}>
            <div style={{ ...S.cardTitle, marginBottom: 12 }}>What we shipped / what Meesho settled</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 16 }}>
              {shipped && <Field label="Label SKU" value={shipped.sku} mono />}
              {shipped && <Field label="Label qty" value={shipped.qty} mono />}
              {shipped && <Field label="Customer" value={[shipped.customer_name, shipped.customer_city].filter(Boolean).join(" · ")} />}
              {payments && <Field label="Payment statuses" value={(payments.statuses || []).join(", ")} />}
              {payments && <Field label="Net settlement" value={fmt(payments.net_settlement)} mono />}
              {payments && <Field label="Claims already paid" value={fmt(payments.claims_paid)} mono />}
              {payments && <Field label="Return shipping charge" value={fmt(payments.return_shipping_charge)} mono />}
            </div>
          </div>
        )}

        <div style={{ gridColumn: "1 / -1", display: "flex", gap: 14, flexWrap: "wrap" }}>
          {row.tracking_link && (
            <a href={row.tracking_link} target="_blank" rel="noreferrer"
              style={{ fontSize: 12, color: C.blue, fontWeight: 600, textDecoration: "none", display: "flex", alignItems: "center", gap: 4 }}>
              Track return <OpenInNewIcon style={{ fontSize: 13 }} />
            </a>
          )}
          {row.proof_of_delivery && (
            <a href={row.proof_of_delivery} target="_blank" rel="noreferrer"
              style={{ fontSize: 12, color: C.blue, fontWeight: 600, textDecoration: "none", display: "flex", alignItems: "center", gap: 4 }}>
              Proof of delivery <OpenInNewIcon style={{ fontSize: 13 }} />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Tab ───────────────────────────────────────────────────────────────────────
export function ReturnScanTab() {
  const { range, label: periodLabel } = useDateFilter();

  const [scan, setScan]           = useState("");
  const [scanning, setScanning]   = useState(false);
  const [scanError, setScanError] = useState(null);
  const [matches, setMatches]     = useState([]);   // >1 when an order no covers several sub-orders
  const [active, setActive]       = useState(null);
  const [saving, setSaving]       = useState(false);
  const scanRef                   = useRef(null);

  const [rows, setRows]     = useState([]);
  const [total, setTotal]   = useState(0);
  const [stats, setStats]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage]     = useState(1);
  const [search, setSearch] = useState("");
  const [claimFilter, setClaimFilter]     = useState("");   // "" | OPEN | REQUIRED | RAISED | …
  const [urgencyFilter, setUrgencyFilter] = useState("");   // "" | attention | expired | unreviewed

  const [cameraOpen, setCameraOpen] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading]   = useState(false);
  const [uploadMsg, setUploadMsg]   = useState(null);
  const [dragging, setDragging]     = useState(false);
  const fileRef = useRef(null);

  // An urgency filter is deliberately all-time: a claim about to expire must
  // never be hidden by whatever period is selected in the global date bar.
  const ignorePeriod = !!urgencyFilter;

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", page);
      params.set("page_size", PAGE_SIZE);
      if (search.trim())  params.set("q", search.trim());
      if (claimFilter)    params.set("claim_status", claimFilter);
      if (urgencyFilter)  params.set("urgency", urgencyFilter);
      if (!ignorePeriod) {
        if (range.date_from) params.set("date_from", range.date_from);
        if (range.date_to)   params.set("date_to", range.date_to);
      }
      const res  = await fetch(`${API}/returns/?${params}`);
      const data = await res.json();
      setRows(data.results || []);
      setTotal(data.total ?? 0);
      setStats(data.stats || null);
    } finally {
      setLoading(false);
    }
  }, [page, search, claimFilter, urgencyFilter, ignorePeriod, range.date_from, range.date_to]);

  useEffect(() => { fetchList(); }, [fetchList]);
  useEffect(() => { setPage(1); }, [search, claimFilter, urgencyFilter, range.date_from, range.date_to]);
  useEffect(() => { scanRef.current?.focus(); }, []);

  const doLookup = async (codeRaw) => {
    const code = (codeRaw ?? "").trim();
    if (!code) return;
    setScanning(true);
    setScanError(null);
    try {
      const res  = await fetch(`${API}/returns/lookup/?q=${encodeURIComponent(code)}`);
      const data = await res.json();
      if (!res.ok || !data.found) {
        setMatches([]);
        setActive(null);
        setScanError(data.message || data.error || "No matching return found.");
      } else {
        setMatches(data.matches);
        setActive(data.matches[0]);
        setScan("");
      }
    } catch {
      setScanError("Network error — could not look up that code.");
    } finally {
      setScanning(false);
      // Hand focus straight back so the next parcel can be scanned immediately.
      setTimeout(() => scanRef.current?.focus(), 0);
    }
  };

  // Table rows come from the list endpoint, which omits the shipped/settlement
  // cross-check context — refetch the single row so clicking a row shows
  // exactly what scanning it would.
  const loadRow = async (row) => {
    setScanError(null);
    setActive(row);
    setMatches([row]);
    try {
      const res = await fetch(`${API}/returns/${row.id}/`);
      if (!res.ok) return;
      const data = await res.json();
      setActive(prev => (prev?.id === data.id ? data : prev));
      setMatches(prev => prev.map(m => (m.id === data.id ? data : m)));
    } catch { /* the list row is already shown — context just stays absent */ }
  };

  const patchClaim = async (id, payload) => {
    setSaving(true);
    try {
      const res  = await fetch(`${API}/returns/${id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setScanError(data.error || "Could not save.");
        return;
      }
      setActive(data);
      setMatches(prev => prev.map(m => (m.id === data.id ? data : m)));
      fetchList();
    } catch {
      setScanError("Network error — could not save.");
    } finally {
      setSaving(false);
    }
  };

  const handleFile = async (file) => {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    setUploading(true);
    setUploadMsg(null);
    try {
      const res  = await fetch(`${API}/returns/upload/`, { method: "POST", body: form });
      const data = await res.json();
      if (data.success) {
        const extra = data.without_delivered_date
          ? ` ${data.without_delivered_date} row(s) had no delivered date — no claim window for those.`
          : "";
        setUploadMsg({
          type: "success",
          text: `Uploaded — ${data.created} new, ${data.updated} updated, ${data.skipped} skipped.${extra}`,
        });
        fetchList();
      } else {
        setUploadMsg({ type: "error", text: data.error || "Upload failed." });
      }
    } catch {
      setUploadMsg({ type: "error", text: "Network error during upload." });
    } finally {
      setUploading(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const attention  = stats?.needs_attention ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>

      {/* ── Camera scanner overlay ── */}
      {cameraOpen && (
        <BarcodeScanner
          onDetected={(code) => { setCameraOpen(false); doLookup(code); }}
          onClose={() => setCameraOpen(false)}
        />
      )}

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <KeyboardReturnIcon style={{ color: C.orange, fontSize: 22 }} />
            <h1 style={{ fontSize: 20, fontWeight: 800, color: C.gray800 }}>Returns Received &amp; Claims</h1>
          </div>
          <p style={{ fontSize: 12, color: C.gray400, marginTop: 4 }}>
            Scan a returned parcel to verify it, then track the 7-day claim window · period: {periodLabel}
          </p>
        </div>
        <button onClick={() => setShowUpload(s => !s)} style={btn("ghostOrange", "md")}>
          <UploadFileIcon style={{ fontSize: 16, verticalAlign: "-3px" }} />
          &nbsp;{showUpload ? "Hide upload" : "Upload returns sheet"}
        </button>
      </div>

      {/* ── Claim-expiry alerts ── */}
      {stats && (attention > 0 || stats.expired > 0 || stats.unreviewed_expiring > 0) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {attention > 0 && (
            <div style={{
              padding: "14px 18px", borderRadius: 12,
              background: C.amberLight, border: `1px solid ${C.amberBorder}`,
              color: "#92400E", fontSize: 14, fontWeight: 600,
              display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
            }}>
              <WarningAmberIcon style={{ fontSize: 20, color: C.amber }} />
              <span>
                {attention} claim{attention === 1 ? " is" : "s are"} flagged but not yet raised, with
                {stats.last_day > 0 && <strong> {stats.last_day} on the last day</strong>}
                {stats.last_day > 0 && stats.expiring > 0 && " and"}
                {stats.expiring > 0 && <strong> {stats.expiring} expiring in 1–2 days</strong>}.
              </span>
              <button onClick={() => { setUrgencyFilter("attention"); setClaimFilter(""); }}
                style={{ ...btn("primary", "sm"), marginLeft: "auto" }}>
                Show them
              </button>
            </div>
          )}
          {stats.unreviewed_expiring > 0 && (
            <div style={{
              padding: "12px 18px", borderRadius: 12,
              background: C.blueLight, border: "1px solid #BFDBFE",
              color: "#1E40AF", fontSize: 13, fontWeight: 600,
              display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
            }}>
              <ErrorOutlineIcon style={{ fontSize: 18, color: C.blue }} />
              <span>{stats.unreviewed_expiring} received return(s) are at day 5 or later and still not reviewed — decide whether a claim is needed.</span>
              <button onClick={() => { setUrgencyFilter("unreviewed"); setClaimFilter(""); }}
                style={{ ...btn("ghost", "sm"), marginLeft: "auto" }}>
                Review
              </button>
            </div>
          )}
          {stats.expired > 0 && (
            <div style={{
              padding: "12px 18px", borderRadius: 12,
              background: C.redLight, border: `1px solid ${C.redBorder}`,
              color: C.red, fontSize: 13, fontWeight: 600,
              display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
            }}>
              <ErrorOutlineIcon style={{ fontSize: 18 }} />
              <span>{stats.expired} flagged claim(s) passed the 7-day window without being raised.</span>
              <button onClick={() => { setUrgencyFilter("expired"); setClaimFilter(""); }}
                style={{ ...btn("ghost", "sm"), marginLeft: "auto" }}>
                Show
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Upload panel ── */}
      {showUpload && (
        <div>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
            onClick={() => fileRef.current?.click()}
            style={{
              border: `2px dashed ${dragging ? C.orange : C.gray200}`,
              borderRadius: 14, padding: "26px 20px",
              background: dragging ? C.orangeLight : C.gray50,
              textAlign: "center", cursor: "pointer",
            }}
          >
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: "none" }}
              onChange={(e) => handleFile(e.target.files[0])} />
            {uploading ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
                <CircularProgress size={20} style={{ color: C.orange }} />
                <span style={{ color: C.gray500, fontSize: 14 }}>Uploading…</span>
              </div>
            ) : (
              <>
                <UploadFileIcon style={{ fontSize: 34, color: C.gray300, marginBottom: 6 }} />
                <p style={{ fontSize: 14, fontWeight: 600, color: C.gray600 }}>
                  Drop the Meesho “Returns → Completed/Delivered” export here, or click to browse
                </p>
                <p style={{ fontSize: 12, color: C.gray400, marginTop: 4 }}>
                  Re-uploading an overlapping export is safe — rows are matched on sub-order + AWB and updated in place, and your claim notes are never overwritten.
                </p>
              </>
            )}
          </div>
          {uploadMsg && (
            <div style={{
              marginTop: 12, padding: "12px 18px", borderRadius: 10, fontSize: 13, fontWeight: 500,
              background: uploadMsg.type === "success" ? C.greenLight : C.redLight,
              color:      uploadMsg.type === "success" ? C.green : C.red,
              border: `1px solid ${uploadMsg.type === "success" ? C.greenBorder : C.redBorder}`,
              display: "flex", alignItems: "center", gap: 8,
            }}>
              {uploadMsg.type === "success" ? <CheckCircleIcon style={{ fontSize: 18 }} /> : <WarningAmberIcon style={{ fontSize: 18 }} />}
              {uploadMsg.text}
              <button onClick={() => setUploadMsg(null)}
                style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "inherit", fontSize: 16 }}>×</button>
            </div>
          )}
        </div>
      )}

      {/* ── Scanner ── */}
      <div style={{ ...S.card, borderTop: `4px solid ${C.orange}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
          <QrCodeScannerIcon style={{ color: C.orange, fontSize: 20 }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: C.gray800 }}>Scan the return label</span>
          <span style={{ fontSize: 12, color: C.gray400 }}>AWB, sub-order or order number — or type it and press Enter</span>
        </div>

        {/* Phone camera scan — the primary action on a phone, and a convenience
            on desktop where a USB/bluetooth scanner types into the box instead. */}
        <button onClick={() => setCameraOpen(true)}
          style={{ ...btn("secondary", "lg"), width: "100%", marginBottom: 12, padding: "14px 20px", fontSize: 15 }}>
          <PhotoCameraIcon style={{ fontSize: 20, verticalAlign: "-5px" }} />
          &nbsp;Scan with phone camera
        </button>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            ref={scanRef}
            value={scan}
            onChange={e => setScan(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") doLookup(scan); }}
            placeholder="Waiting for scan…"
            autoComplete="off"
            spellCheck={false}
            style={{
              ...S.inp, flex: "1 1 200px", minWidth: 0, fontSize: 22, fontFamily: "monospace", fontWeight: 700,
              padding: "14px 18px", letterSpacing: "0.03em",
              borderColor: C.orangeBorder, background: C.orangeLight,
            }}
          />
          <button onClick={() => doLookup(scan)} disabled={scanning || !scan.trim()}
            style={{ ...btn("primary", "lg"), opacity: scanning || !scan.trim() ? 0.5 : 1 }}>
            {scanning ? <CircularProgress size={16} style={{ color: "#fff" }} /> : "Look up"}
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
      </div>

      {/* ── Multiple sub-orders behind one scanned order number ── */}
      {matches.length > 1 && (
        <div style={{ ...S.card, padding: "14px 20px" }}>
          <div style={{ ...S.cardTitle, marginBottom: 10 }}>
            {matches.length} returns match that code — pick one
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {matches.map(m => (
              <button key={m.id} onClick={() => setActive(m)}
                style={{ ...btn(active?.id === m.id ? "primary" : "ghost", "sm"), fontFamily: "monospace" }}>
                {m.suborder_no} · {m.sku} ×{m.qty}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Active return ── */}
      {active && (
        <>
          <ReturnCard
            row={active}
            onPatch={patchClaim}
            saving={saving}
            onClose={() => { setActive(null); setMatches([]); scanRef.current?.focus(); }}
          />
          {/* One tap back into the camera, so working through a stack of
              parcels is scan → verify → decide → scan next. */}
          <button onClick={() => setCameraOpen(true)}
            style={{ ...btn("secondary", "lg"), alignSelf: "flex-start" }}>
            <PhotoCameraIcon style={{ fontSize: 18, verticalAlign: "-4px" }} />
            &nbsp;Scan next parcel
          </button>
        </>
      )}

      {/* ── Stats (all-time, click to filter) ── */}
      {stats && (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <StatPill label="Returns received" value={stats.total} accent={C.orange}
            onClick={() => { setUrgencyFilter(""); setClaimFilter(""); }}
            active={!urgencyFilter && !claimFilter} />
          <StatPill label="Not reviewed" value={stats.unreviewed} accent={C.gray400}
            onClick={() => { setUrgencyFilter("unreviewed"); setClaimFilter(""); }}
            active={urgencyFilter === "unreviewed"} />
          <StatPill label="Claim required" value={stats.claim_required} accent={C.amber}
            onClick={() => { setUrgencyFilter(""); setClaimFilter("REQUIRED"); }}
            active={claimFilter === "REQUIRED"} />
          <StatPill label="Needs action now" value={stats.needs_attention} accent={C.red}
            onClick={() => { setUrgencyFilter("attention"); setClaimFilter(""); }}
            active={urgencyFilter === "attention"} />
          <StatPill label="Claims raised" value={stats.claim_raised} accent={C.green}
            onClick={() => { setUrgencyFilter(""); setClaimFilter("RAISED"); }}
            active={claimFilter === "RAISED"} />
          <StatPill label="Window missed" value={stats.expired} accent={C.gray600}
            onClick={() => { setUrgencyFilter("expired"); setClaimFilter(""); }}
            active={urgencyFilter === "expired"} />
        </div>
      )}

      {/* ── Filters ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search sub-order / AWB / SKU / product…"
          style={{ ...S.inp, maxWidth: 320 }} />
        <select value={claimFilter} onChange={e => { setClaimFilter(e.target.value); setUrgencyFilter(""); }}
          style={{ ...S.inp, maxWidth: 200 }}>
          <option value="">All claim states</option>
          <option value="OPEN">Claim still owed</option>
          <option value="UNREVIEWED">Not reviewed</option>
          <option value="REQUIRED">Claim required</option>
          <option value="RAISED">Claim raised</option>
          <option value="APPROVED">Claim approved</option>
          <option value="REJECTED">Claim rejected</option>
          <option value="NOT_REQUIRED">No claim needed</option>
        </select>
        {(urgencyFilter || claimFilter) && (
          <button onClick={() => { setUrgencyFilter(""); setClaimFilter(""); }} style={btn("ghost", "sm")}>
            Clear filters
          </button>
        )}
        {ignorePeriod && (
          <span style={{ fontSize: 12, color: C.gray400 }}>
            Showing all time — the period filter is ignored so nothing urgent is hidden.
          </span>
        )}
      </div>

      {/* ── Table ── */}
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
                    {["Returned on", "SKU", "Qty", "Type", "Reason", "Claim", "Claim window", "Sub-order"].map(h => (
                      <th key={h} style={S.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan={8} style={{ ...S.td, textAlign: "center", padding: 44, color: C.gray400 }}>
                      {stats?.total ? "No returns match these filters" : "No returns yet — upload the Meesho returns export to get started"}
                    </td></tr>
                  ) : rows.map((r, idx) => {
                    const meta = URGENCY_META[r.claim_urgency] || URGENCY_META.unknown;
                    const rowBg = active?.id === r.id ? C.orangeLight : idx % 2 === 0 ? C.white : C.gray50;
                    return (
                      <tr key={r.id}
                        onClick={() => loadRow(r)}
                        style={{ background: rowBg, cursor: "pointer" }}>
                        <td style={{ ...S.td, fontFamily: "monospace", fontWeight: 600, whiteSpace: "nowrap" }}>
                          {r.delivered_date || "—"}
                        </td>
                        <td style={{ ...S.td, maxWidth: 220 }}>
                          <div style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: C.orange }}>{r.sku || "—"}</div>
                          <div style={{ fontSize: 11, color: C.gray400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 210 }}
                            title={r.product_name}>{r.product_name}</div>
                        </td>
                        <td style={{ ...S.td, fontFamily: "monospace", fontWeight: 700 }}>{r.qty}</td>
                        <td style={S.td}>
                          <Tag variant={(r.type_of_return || "").toLowerCase().includes("rto") ? "red" : "orange"}>
                            {(r.type_of_return || "").toLowerCase().includes("rto") ? "RTO" : "Customer"}
                          </Tag>
                        </td>
                        <td style={{ ...S.td, maxWidth: 200, fontSize: 12, color: C.gray600 }}>
                          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 190 }}
                            title={r.return_reason}>{r.return_reason || "—"}</div>
                        </td>
                        <td style={S.td}>
                          <Tag variant={CLAIM_TAG[r.claim_status]}>{CLAIM_LABELS[r.claim_status]}</Tag>
                        </td>
                        <td style={{ ...S.td, whiteSpace: "nowrap" }}>
                          <span style={{ color: meta.color, fontWeight: 700, fontSize: 12 }}>
                            {r.claim_urgency === "none" ? "—"
                              : r.claim_urgency === "unknown" ? "no date"
                              : r.days_left < 0 ? `missed by ${Math.abs(r.days_left)}d`
                              : r.days_left === 0 ? "last day!"
                              : `${r.days_left}d left`}
                          </span>
                          {r.claim_deadline && r.claim_urgency !== "none" && (
                            <div style={{ fontSize: 10, color: C.gray400, fontFamily: "monospace" }}>by {r.claim_deadline}</div>
                          )}
                        </td>
                        <td style={{ ...S.td, fontFamily: "monospace", fontSize: 11, color: C.gray500 }}>{r.suborder_no}</td>
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
