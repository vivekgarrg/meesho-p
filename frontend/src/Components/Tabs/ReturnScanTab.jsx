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
import SearchIcon from "@mui/icons-material/Search";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import CloseIcon from "@mui/icons-material/Close";
import { CircularProgress } from "@mui/material";

/*
 * Returns Received & Claims.
 *
 * One return at a time, shown the same way on every screen: its photo, SKU,
 * quantity and the reason it came back — the four things you compare against
 * the parcel in your hand — then the claim decision.
 *
 *   Phone  — Scan → the return → "Scan next". Nothing else on screen.
 *   Desktop — one search box that keeps the cursor (a machine scan + Enter opens
 *            the return and clears the box; typing filters the list), a clean list
 *            on the left and the selected return on the right.
 *
 * When a claim is required, the packet id off the parcel is the next step: it is
 * different on every return, so it is stored against that return (and finds it
 * again later).
 */

const PAGE_SIZE = 30;

const CLAIM_LABELS = {
  UNREVIEWED: "Not reviewed", NOT_REQUIRED: "No claim needed", REQUIRED: "Claim required",
  RAISED: "Claim raised", APPROVED: "Claim approved", REJECTED: "Claim rejected",
};
const CLAIM_TAG = {
  UNREVIEWED: "gray", NOT_REQUIRED: "gray", REQUIRED: "amber", RAISED: "blue", APPROVED: "green", REJECTED: "red",
};
const URGENCY_COLOR = {
  ok: C.green, warning: C.amber, last_day: C.red, expired: C.red, none: C.gray500, unknown: C.gray500,
};

/** One short line about the claim window — enough to know if it's urgent. */
function windowText(row) {
  const cs = row.claim_status;
  if (["RAISED", "APPROVED", "REJECTED", "NOT_REQUIRED"].includes(cs)) return "";
  const left = row.days_left;
  if (row.claim_urgency === "unknown" || left == null) return "No delivered date";
  if (left < 0) return `Window missed by ${Math.abs(left)}d`;
  if (left === 0) return "Last day to claim — today";
  return `${left} day${left === 1 ? "" : "s"} left to claim`;
}

const isRTO = (row) => (row.type_of_return || "").toLowerCase().includes("rto");

// ── Pieces ────────────────────────────────────────────────────────────────────

function Photo({ url, size = 64, radius = 10 }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [url]);
  const box = {
    width: size, height: size, borderRadius: radius, flexShrink: 0, overflow: "hidden",
    border: `1px solid ${C.gray200}`, background: C.gray50,
    display: "flex", alignItems: "center", justifyContent: "center", color: C.gray300,
  };
  if (!url || broken) return <div style={{ ...box, fontSize: size * 0.4 }}>📷</div>;
  return <div style={box}><img src={url} alt="" onError={() => setBroken(true)} style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>;
}

function Label({ children }) {
  return (
    <div style={{ fontSize: 10.5, fontWeight: 700, color: C.gray400, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 3 }}>
      {children}
    </div>
  );
}

function Field({ label, value, mono }) {
  return (
    <div>
      <Label>{label}</Label>
      <div style={{ fontSize: 13, color: C.gray800, fontWeight: 600, fontFamily: mono ? "monospace" : "inherit", wordBreak: "break-word" }}>
        {value || <span style={{ color: C.gray300, fontWeight: 400 }}>—</span>}
      </div>
    </div>
  );
}

/** What this return is: photo, SKU, qty, reason — big enough to read at arm's length. */
function ReturnSummary({ row, compact }) {
  const ctx = row.order_context || {};
  const shippedSku = ctx.label?.sku || ctx.payments?.supplier_sku || null;
  const shippedQty = ctx.label?.qty ?? ctx.payments?.quantity ?? null;
  const skuMismatch = shippedSku && shippedSku.trim().toLowerCase() !== (row.sku || "").trim().toLowerCase();
  const qtyMismatch = shippedQty != null && Number(row.qty) > Number(shippedQty);
  const win = windowText(row);

  return (
    <div>
      <div style={{ display: "flex", gap: compact ? 14 : 18, alignItems: "flex-start" }}>
        <Photo url={row.image_url} size={compact ? 118 : 150} radius={14} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <Label>SKU</Label>
          <div style={{
            fontFamily: "monospace", fontWeight: 800, lineHeight: 1.2, wordBreak: "break-all",
            fontSize: compact ? 21 : 26, color: skuMismatch ? C.red : C.gray900,
          }}>{row.sku || "—"}</div>
          {row.variation && row.variation !== "Free Size" && (
            <div style={{ fontSize: 13, color: C.gray600, marginTop: 3, fontWeight: 600 }}>{row.variation}</div>
          )}
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 12 }}>
            <div>
              <Label>Qty</Label>
              <div style={{ fontFamily: "monospace", fontWeight: 800, fontSize: compact ? 38 : 44, lineHeight: 1, color: qtyMismatch ? C.red : C.gray900 }}>
                {row.qty}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16, padding: "12px 14px", borderRadius: 10, background: C.gray50, border: `1px solid ${C.gray200}` }}>
        <Label>Why it was returned</Label>
        <div style={{ fontSize: compact ? 16 : 15, fontWeight: 700, color: C.gray900, lineHeight: 1.4 }}>
          {row.return_reason || <span style={{ color: C.gray400, fontWeight: 500 }}>No reason on the sheet</span>}
        </div>
        {row.detailed_return_reason && (
          <div style={{ fontSize: 13, color: C.gray600, marginTop: 5, lineHeight: 1.5 }}>“{row.detailed_return_reason}”</div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
        <Tag variant={isRTO(row) ? "red" : "orange"}>{isRTO(row) ? "RTO" : "Customer return"}</Tag>
        <Tag variant={CLAIM_TAG[row.claim_status]}>{CLAIM_LABELS[row.claim_status]}</Tag>
        {row.business_name && <Tag variant="blue">◈ {row.business_name}</Tag>}
        {win && (
          <span style={{ fontSize: 12.5, fontWeight: 700, color: URGENCY_COLOR[row.claim_urgency] || C.gray500 }}>{win}</span>
        )}
      </div>

      {(skuMismatch || qtyMismatch) && (
        <div style={{
          marginTop: 12, padding: "10px 14px", borderRadius: 10, background: C.redLight, border: `1px solid ${C.redBorder}`,
          color: C.red, fontSize: 13, fontWeight: 600, display: "flex", gap: 8, alignItems: "flex-start",
        }}>
          <ErrorOutlineIcon style={{ fontSize: 18, flexShrink: 0 }} />
          <div>
            Doesn't match what we shipped:
            {skuMismatch && <div>· shipped <strong>{shippedSku}</strong>, sheet says <strong>{row.sku}</strong></div>}
            {qtyMismatch && <div>· shipped <strong>{shippedQty}</strong>, but <strong>{row.qty}</strong> came back</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The packet id on the returned parcel. It's different on every return, so when a
 * claim is required it is stored against that return — scan it (or type it) and
 * press Enter. `autoFocus` puts the cursor here so a machine scan lands in it.
 */
function PacketStep({ row, onPatch, saving, onScanPacket, onDone, autoFocus, isMobile }) {
  const [packet, setPacket] = useState(row.packet_id ?? "");
  const input = useRef(null);
  useEffect(() => { setPacket(row.packet_id ?? ""); }, [row.id, row.packet_id]);
  useEffect(() => { if (autoFocus && !isMobile) input.current?.focus(); }, [autoFocus, row.id, isMobile]);

  const saved = !!row.packet_id;
  const dup = row.packet_duplicate_of || [];
  const save = async () => {
    const v = packet.trim();
    if (!v || v === (row.packet_id ?? "")) { onDone?.(); return; }
    await onPatch(row.id, { packet_id: v });
    onDone?.();
  };

  return (
    <div style={{
      padding: "14px 16px", borderRadius: 12,
      background: saved ? C.greenLight : C.amberLight, border: `1.5px solid ${saved ? C.greenBorder : C.amberBorder}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <QrCodeScannerIcon style={{ fontSize: 19, color: saved ? C.green : C.amber }} />
        <span style={{ fontSize: 14, fontWeight: 800, color: C.gray900 }}>
          {saved ? "Packet ID saved" : "Scan the packet ID on this parcel"}
        </span>
        {saved && <CheckCircleIcon style={{ fontSize: 18, color: C.green }} />}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {isMobile && (
          <button onClick={onScanPacket} disabled={saving} style={{ ...btn("secondary", "md"), flex: "1 1 100%" }}>
            <PhotoCameraIcon style={{ fontSize: 18, verticalAlign: "-4px" }} />&nbsp;{saved ? "Scan again" : "Scan packet"}
          </button>
        )}
        <input
          ref={input}
          value={packet}
          onChange={(e) => setPacket(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); }}
          placeholder={isMobile ? "…or type it" : "Scan with the machine, or type it, then press Enter"}
          autoComplete="off" spellCheck={false}
          style={{ ...S.inp, flex: "1 1 200px", minWidth: 0, fontFamily: "monospace", fontWeight: 700, fontSize: 15, background: C.white }}
        />
        <button onClick={save} disabled={saving || !packet.trim()}
          style={{ ...btn("primary", "md"), opacity: saving || !packet.trim() ? 0.5 : 1 }}>
          Save
        </button>
        {saved && (
          <button onClick={() => onPatch(row.id, { packet_id: "" })} disabled={saving} style={btn("ghost", "md")}>Clear</button>
        )}
      </div>
      {dup.length > 0 && (
        <div style={{ marginTop: 9, fontSize: 12.5, color: C.red, fontWeight: 700 }}>
          ⚠ This packet ID is already saved on {dup.join(", ")} — every parcel's ID is different, so check you scanned the right one.
        </div>
      )}
      {row.packet_check === "MISMATCH" && (
        <div style={{ marginTop: 9, fontSize: 12.5, color: C.red, fontWeight: 700 }}>
          This packet doesn't match what we shipped for this sub-order — check you're holding the right parcel.
        </div>
      )}
      {row.packet_check === "MATCH" && (
        <div style={{ marginTop: 9, fontSize: 12.5, color: C.green, fontWeight: 700 }}>Matches what we shipped — good evidence for the claim.</div>
      )}
      {!saved && (
        <div style={{ marginTop: 9, fontSize: 12, color: "#92400E", lineHeight: 1.5 }}>
          Meesho rejects claims when the packet's order / AWB isn't visible. Saving it here keeps the proof with this return.
        </div>
      )}
    </div>
  );
}

/** The decision: is a claim needed, and where is it up to. */
function ClaimPanel({ row, onPatch, saving, onScanPacket, justFlagged, onPacketDone, isMobile }) {
  const [amount, setAmount] = useState(row.claim_amount ?? "");
  const [reference, setReference] = useState(row.claim_reference ?? "");
  const [notes, setNotes] = useState(row.claim_notes ?? "");
  useEffect(() => {
    setAmount(row.claim_amount ?? ""); setReference(row.claim_reference ?? ""); setNotes(row.claim_notes ?? "");
  }, [row.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const cs = row.claim_status;
  const decided = ["RAISED", "APPROVED", "REJECTED"].includes(cs);
  const big = isMobile ? "lg" : "lg";

  if (cs === "UNREVIEWED") {
    return (
      <div>
        <div style={{ fontSize: 14, fontWeight: 800, color: C.gray900, marginBottom: 10 }}>Is a claim required?</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <button onClick={() => onPatch(row.id, { claim_status: "REQUIRED" }, { flagged: true })} disabled={saving}
            style={{ ...btn("primary", big), padding: "16px 10px", fontSize: 15 }}>
            Claim required
          </button>
          <button onClick={() => onPatch(row.id, { claim_status: "NOT_REQUIRED" })} disabled={saving}
            style={{ ...btn("ghost", big), padding: "16px 10px", fontSize: 15 }}>
            No claim
          </button>
        </div>
      </div>
    );
  }

  if (cs === "REQUIRED") {
    const details = { claim_amount: amount === "" ? null : amount, claim_reference: reference, claim_notes: notes };
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <PacketStep row={row} onPatch={onPatch} saving={saving} onScanPacket={onScanPacket}
          autoFocus={justFlagged} onDone={onPacketDone} isMobile={isMobile} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.gray700, marginBottom: 8 }}>Claim details <span style={{ fontWeight: 400, color: C.gray400 }}>(optional — fill in once raised on Meesho)</span></div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <div>
              <label style={S.label}>Amount (₹)</label>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" step="0.01" style={S.inp} />
            </div>
            <div>
              <label style={S.label}>Meesho ticket ref</label>
              <input value={reference} onChange={(e) => setReference(e.target.value)} style={S.inp} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={S.label}>Notes</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What was wrong, what proof was attached…" style={S.inp} />
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={() => onPatch(row.id, { claim_status: "RAISED", ...details })} disabled={saving}
            style={{ ...btn("success", "lg"), flex: isMobile ? "1 1 100%" : "none" }}>
            <CheckCircleIcon style={{ fontSize: 17, verticalAlign: "-3px" }} />&nbsp;Claim raised on Meesho
          </button>
          <button onClick={() => onPatch(row.id, details)} disabled={saving} style={btn("ghostOrange", "md")}>Save details</button>
          <button onClick={() => onPatch(row.id, { claim_status: "NOT_REQUIRED" })} disabled={saving} style={btn("ghost", "md")}>Actually, no claim</button>
        </div>
      </div>
    );
  }

  if (decided) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
          <Field label="Claim amount" value={row.claim_amount != null ? fmt(row.claim_amount) : null} mono />
          <Field label="Reference" value={row.claim_reference} mono />
          <Field label="Raised" value={row.claim_raised_at ? new Date(row.claim_raised_at).toLocaleDateString("en-IN") : null} />
          <Field label="Packet ID" value={row.packet_id} mono />
        </div>
        {row.claim_notes && <Field label="Notes" value={row.claim_notes} />}
        {!row.packet_id && (
          <PacketStep row={row} onPatch={onPatch} saving={saving} onScanPacket={onScanPacket}
            onDone={onPacketDone} isMobile={isMobile} />
        )}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {cs === "RAISED" && (
            <>
              <button onClick={() => onPatch(row.id, { claim_status: "APPROVED" })} disabled={saving} style={btn("success", "md")}>Mark approved</button>
              <button onClick={() => onPatch(row.id, { claim_status: "REJECTED" })} disabled={saving} style={btn("danger", "md")}>Mark rejected</button>
            </>
          )}
          <button onClick={() => onPatch(row.id, { claim_status: "REQUIRED" })} disabled={saving} style={btn("ghost", "md")}>Reopen</button>
        </div>
      </div>
    );
  }

  // NOT_REQUIRED
  return (
    <button onClick={() => onPatch(row.id, { claim_status: "REQUIRED" }, { flagged: true })} disabled={saving} style={btn("ghostOrange", "md")}>
      Claim is needed after all
    </button>
  );
}

/** Product-in-hand check and every other detail, tucked away until wanted. */
function MoreDetails({ row, onPatch, saving }) {
  const [open, setOpen] = useState(false);
  const ctx = row.order_context || {};
  const shipped = ctx.label;
  const payments = ctx.payments;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.gray700 }}>Product in hand:</span>
        <button onClick={() => onPatch(row.id, { verify_result: "MATCH" })} disabled={saving}
          style={btn(row.verify_result === "MATCH" ? "success" : "ghost", "sm")}>✓ Correct</button>
        <button onClick={() => onPatch(row.id, { verify_result: "MISMATCH" })} disabled={saving}
          style={btn(row.verify_result === "MISMATCH" ? "danger" : "ghost", "sm")}>✗ Wrong / damaged</button>
      </div>
      <button onClick={() => setOpen((o) => !o)}
        style={{ marginTop: 12, background: "none", border: "none", padding: 0, cursor: "pointer", color: C.blue, fontWeight: 700, fontSize: 12.5, fontFamily: "inherit" }}>
        {open ? "▾ Hide all details" : "▸ All details"}
      </button>
      {open && (
        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14 }}>
          <Field label="Sub-order" value={row.suborder_no} mono />
          <Field label="Order no" value={row.order_no} mono />
          <Field label="AWB" value={row.awb_number} mono />
          <Field label="Courier" value={row.courier_partner} />
          <Field label="Returned on" value={row.delivered_date} mono />
          <Field label="Dispatched on" value={row.dispatch_date} mono />
          <Field label="Category" value={row.category} />
          <Field label="Product" value={row.product_name} />
          {shipped && <Field label="Label SKU / qty" value={`${shipped.sku || "—"} × ${shipped.qty ?? "—"}`} mono />}
          {shipped && <Field label="Customer" value={[shipped.customer_name, shipped.customer_city].filter(Boolean).join(" · ")} />}
          {payments && <Field label="Net settlement" value={fmt(payments.net_settlement)} mono />}
          {payments && <Field label="Return shipping" value={fmt(payments.return_shipping_charge)} mono />}
          <div style={{ gridColumn: "1 / -1", display: "flex", gap: 14, flexWrap: "wrap" }}>
            {row.tracking_link && (
              <a href={row.tracking_link} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: C.blue, fontWeight: 600, textDecoration: "none" }}>
                Track return <OpenInNewIcon style={{ fontSize: 12, verticalAlign: "-2px" }} />
              </a>
            )}
            {row.proof_of_delivery && (
              <a href={row.proof_of_delivery} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: C.blue, fontWeight: 600, textDecoration: "none" }}>
                Proof of delivery <OpenInNewIcon style={{ fontSize: 12, verticalAlign: "-2px" }} />
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** One return, in full — shared by the phone result screen and the desktop side panel. */
function ReturnDetail({ row, onPatch, saving, onScanPacket, justFlagged, onPacketDone, isMobile, onClose }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {onClose && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: -10 }}>
          <button onClick={onClose} title="Close" style={{ background: "none", border: "none", cursor: "pointer", color: C.gray400, padding: 0 }}>
            <CloseIcon style={{ fontSize: 20 }} />
          </button>
        </div>
      )}
      <ReturnSummary row={row} compact={isMobile} />
      <div style={{ borderTop: `1px solid ${C.gray100}`, paddingTop: 16 }}>
        <ClaimPanel row={row} onPatch={onPatch} saving={saving} onScanPacket={onScanPacket}
          justFlagged={justFlagged} onPacketDone={onPacketDone} isMobile={isMobile} />
      </div>
      <div style={{ borderTop: `1px solid ${C.gray100}`, paddingTop: 14 }}>
        <MoreDetails row={row} onPatch={onPatch} saving={saving} />
      </div>
    </div>
  );
}

// ── Shared behaviour: lookup, save, list ──────────────────────────────────────

function useReturnsDesk() {
  const [active, setActive] = useState(null);
  const [matches, setMatches] = useState([]);
  const [saving, setSaving] = useState(false);
  const [looking, setLooking] = useState(false);
  const [error, setError] = useState(null);
  const [justFlagged, setJustFlagged] = useState(null);   // id of the return just marked "claim required"
  const [recent, setRecent] = useState([]);                // this session's scans, newest first

  const lookup = async (codeRaw) => {
    const code = (codeRaw ?? "").trim();
    if (!code) return { found: false };
    setLooking(true); setError(null);
    try {
      const res = await fetch(`${API}/returns/lookup/?q=${encodeURIComponent(code)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.found) {
        setError(data.message || data.error || "No matching return found.");
        return { found: false };
      }
      setMatches(data.matches);
      setActive(data.matches[0]);
      setJustFlagged(null);
      setRecent((prev) => [data.matches[0], ...prev.filter((r) => r.id !== data.matches[0].id)].slice(0, 12));
      return { found: true, row: data.matches[0], data };
    } catch {
      setError("Network error — could not look that up.");
      return { found: false };
    } finally {
      setLooking(false);
    }
  };

  // A row opened from the list comes without the shipped/settlement context —
  // fetch the full record so it reads exactly as a scan would.
  const open = async (row) => {
    setError(null); setJustFlagged(null); setActive(row); setMatches([row]);
    try {
      const res = await fetch(`${API}/returns/${row.id}/`);
      if (!res.ok) return;
      const data = await res.json();
      setActive((p) => (p?.id === data.id ? data : p));
      setMatches((p) => p.map((m) => (m.id === data.id ? data : m)));
    } catch { /* the list row is already on screen */ }
  };

  const patch = async (id, payload, opts = {}) => {
    setSaving(true);
    try {
      const res = await fetch(`${API}/returns/${id}/`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || "Could not save."); return null; }
      setActive(data);
      setMatches((p) => p.map((m) => (m.id === data.id ? data : m)));
      setRecent((p) => p.map((m) => (m.id === data.id ? { ...m, ...data } : m)));
      if (opts.flagged) setJustFlagged(data.id);
      return data;
    } catch {
      setError("Network error — could not save.");
      return null;
    } finally {
      setSaving(false);
    }
  };

  const clear = () => { setActive(null); setMatches([]); setJustFlagged(null); };
  return { active, setActive, matches, saving, looking, error, setError, justFlagged, recent, lookup, open, patch, clear };
}

// ── Phone ─────────────────────────────────────────────────────────────────────

function MobileReturns({ desk }) {
  const { active, matches, setActive, saving, looking, error, setError, justFlagged, recent, lookup, open, patch, clear } = desk;
  const [camera, setCamera] = useState(false);
  const [packetFor, setPacketFor] = useState(null);
  const [typed, setTyped] = useState("");

  const scanned = async (code) => {
    setCamera(false);
    await lookup(code);
  };
  const flagAndScan = async (id, payload, opts) => {
    const data = await patch(id, payload, opts);
    // Claim required → straight into scanning the packet id.
    if (data && payload.claim_status === "REQUIRED" && !data.packet_id) setPacketFor(id);
    return data;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: active ? 84 : 0 }}>
      {camera && (
        <BarcodeScanner title="Scan the return" hint="Scan the label on the returned parcel" busy={looking}
          onDetected={scanned} onClose={() => setCamera(false)} />
      )}
      {packetFor && (
        <BarcodeScanner title="Scan the packet ID" hint="The order / AWB on the parcel's own waybill"
          onDetected={(code) => { const id = packetFor; setPacketFor(null); patch(id, { packet_id: code }); }}
          onClose={() => setPacketFor(null)} />
      )}

      {!active && (
        <>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: C.gray900 }}>Returns</h1>
            <p style={{ fontSize: 12.5, color: C.gray500, marginTop: 3 }}>Scan a returned parcel to see what it is.</p>
          </div>
          <button onClick={() => { setError(null); setCamera(true); }}
            style={{ ...btn("primary", "lg"), padding: "22px 20px", fontSize: 18, borderRadius: 14, width: "100%" }}>
            <PhotoCameraIcon style={{ fontSize: 26, verticalAlign: "-7px" }} />&nbsp;Scan return
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="…or type AWB / sub-order"
              onKeyDown={(e) => { if (e.key === "Enter") { lookup(typed).then((r) => r.found && setTyped("")); } }}
              autoComplete="off" style={{ ...S.inp, flex: 1, fontFamily: "monospace" }} />
            <button onClick={() => lookup(typed).then((r) => r.found && setTyped(""))} disabled={looking || !typed.trim()}
              style={{ ...btn("ghostOrange", "md"), opacity: looking || !typed.trim() ? 0.5 : 1 }}>Find</button>
          </div>
          {error && (
            <div style={{ padding: "11px 14px", borderRadius: 10, background: C.redLight, border: `1px solid ${C.redBorder}`, color: C.red, fontSize: 13, fontWeight: 600 }}>
              {error}
            </div>
          )}
          {recent.length > 0 && (
            <div>
              <Label>Scanned this session</Label>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
                {recent.map((r) => (
                  <div key={r.id} onClick={() => open(r)}
                    style={{ ...S.card, padding: "10px 12px", display: "flex", gap: 10, alignItems: "center", cursor: "pointer" }}>
                    <Photo url={r.image_url} size={44} radius={8} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 13, color: C.gray900, wordBreak: "break-all" }}>{r.sku} × {r.qty}</div>
                      <div style={{ fontSize: 11.5, color: C.gray500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.return_reason || "No reason"}</div>
                    </div>
                    <Tag variant={CLAIM_TAG[r.claim_status]}>{CLAIM_LABELS[r.claim_status]}</Tag>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {active && (
        <>
          {matches.length > 1 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {matches.map((m) => (
                <button key={m.id} onClick={() => setActive(m)}
                  style={{ ...btn(active.id === m.id ? "primary" : "ghost", "sm"), fontFamily: "monospace" }}>
                  {m.sku} ×{m.qty}
                </button>
              ))}
            </div>
          )}
          {error && (
            <div style={{ padding: "10px 14px", borderRadius: 10, background: C.redLight, border: `1px solid ${C.redBorder}`, color: C.red, fontSize: 13, fontWeight: 600 }}>
              {error}
            </div>
          )}
          <div style={{ ...S.card, padding: "16px 14px" }}>
            <ReturnDetail row={active} isMobile saving={saving} onPatch={flagAndScan}
              onScanPacket={() => setPacketFor(active.id)} justFlagged={justFlagged === active.id} />
          </div>

          {/* The one thing to do next, always in reach. */}
          <div style={{
            position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 20, padding: "10px 14px calc(10px + env(safe-area-inset-bottom))",
            background: "rgba(255,255,255,0.97)", borderTop: `1px solid ${C.gray200}`, display: "flex", gap: 10,
          }}>
            <button onClick={clear} style={{ ...btn("ghost", "lg"), padding: "14px 16px" }}>Done</button>
            <button onClick={() => { clear(); setError(null); setCamera(true); }}
              style={{ ...btn("primary", "lg"), flex: 1, padding: "14px 16px", fontSize: 16 }}>
              <QrCodeScannerIcon style={{ fontSize: 22, verticalAlign: "-5px" }} />&nbsp;Scan next
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Desktop ───────────────────────────────────────────────────────────────────

const FILTERS = [
  { key: "all",       label: "All",              claim: "",           urgency: "" },
  { key: "review",    label: "Needs decision",   claim: "",           urgency: "unreviewed" },
  { key: "required",  label: "Claim required",   claim: "REQUIRED",   urgency: "" },
  { key: "attention", label: "Closing soon",     claim: "",           urgency: "attention" },
  { key: "raised",    label: "Raised",           claim: "RAISED",     urgency: "" },
];

function DesktopReturns({ desk }) {
  const { range, label: periodLabel } = useDateFilter();
  const { active, matches, setActive, saving, looking, error, setError, justFlagged, lookup, open, patch, clear } = desk;

  const [query, setQuery] = useState("");
  const [listQuery, setListQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [notFound, setNotFound] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState(null);
  const search = useRef(null);
  const fileRef = useRef(null);

  const f = FILTERS.find((x) => x.key === filter);
  // "Closing soon" and "Needs decision" are all-time: an expiring claim must never
  // be hidden by whichever period the global date bar happens to show.
  const ignorePeriod = !!f.urgency;

  // The cursor lives in the search box. Anything that could steal it hands it back.
  const refocus = useCallback(() => setTimeout(() => search.current?.focus(), 0), []);
  useEffect(() => { refocus(); }, [refocus]);

  // Typing filters the list (after a short pause); Enter looks the code up.
  useEffect(() => {
    const t = setTimeout(() => setListQuery(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => { setPage(1); }, [listQuery, filter, range.date_from, range.date_to]);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page, page_size: PAGE_SIZE });
      if (listQuery) p.set("q", listQuery);
      if (f.claim) p.set("claim_status", f.claim);
      if (f.urgency) p.set("urgency", f.urgency);
      if (!ignorePeriod) {
        if (range.date_from) p.set("date_from", range.date_from);
        if (range.date_to) p.set("date_to", range.date_to);
      }
      const res = await fetch(`${API}/returns/?${p}`);
      const data = await res.json();
      setRows(data.results || []); setTotal(data.total ?? 0); setStats(data.stats || null);
    } finally { setLoading(false); }
  }, [page, listQuery, f.claim, f.urgency, ignorePeriod, range.date_from, range.date_to]);
  useEffect(() => { fetchList(); }, [fetchList]);

  const onEnter = async () => {
    const code = query.trim();
    if (!code) return;
    setNotFound(false);
    const r = await lookup(code);
    if (r.found) {
      setQuery(""); setListQuery("");     // scanned in: clear, ready for the next parcel
    } else {
      setNotFound(true);                  // typed search: keep the text, the list shows partial matches
    }
    refocus();
  };

  const save = async (id, payload, opts) => {
    const data = await patch(id, payload, opts);
    fetchList();
    // After a decision the cursor goes back to the search — except right after
    // "Claim required", where the packet field takes it for the machine scan.
    if (!opts?.flagged) refocus();
    return data;
  };

  const handleFile = async (file) => {
    if (!file) return;
    const form = new FormData(); form.append("file", file);
    setUploading(true); setUploadMsg(null);
    try {
      const res = await fetch(`${API}/returns/upload/`, { method: "POST", body: form });
      const data = await res.json();
      setUploadMsg(data.success
        ? { ok: true, text: `Uploaded — ${data.created} new, ${data.updated} updated, ${data.skipped} skipped.` }
        : { ok: false, text: data.error || "Upload failed." });
      if (data.success) fetchList();
    } catch { setUploadMsg({ ok: false, text: "Network error during upload." }); }
    finally { setUploading(false); }
  };

  const counts = {
    all: stats?.total, review: stats?.unreviewed, required: stats?.claim_required,
    attention: stats?.needs_attention, raised: stats?.claim_raised,
  };
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: C.gray900 }}>Returns &amp; Claims</h1>
          <p style={{ fontSize: 12, color: C.gray400, marginTop: 3 }}>
            Scan a parcel to see what it is and decide on the claim · {ignorePeriod ? "all time" : periodLabel}
          </p>
        </div>
        <button onClick={() => setShowUpload((s) => !s)} style={btn("ghostOrange", "md")}>
          <UploadFileIcon style={{ fontSize: 16, verticalAlign: "-3px" }} />&nbsp;{showUpload ? "Hide upload" : "Upload returns sheet"}
        </button>
      </div>

      {showUpload && (
        <div>
          <div onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}
            style={{ border: `2px dashed ${C.gray200}`, borderRadius: 12, padding: "20px", background: C.gray50, textAlign: "center", cursor: "pointer" }}>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: "none" }} onChange={(e) => handleFile(e.target.files[0])} />
            {uploading ? <CircularProgress size={20} style={{ color: C.orange }} /> : (
              <span style={{ fontSize: 13, color: C.gray600, fontWeight: 600 }}>
                Drop the Meesho “Returns → Completed/Delivered” export here, or click to browse — re-uploading is safe, claim work is never overwritten.
              </span>
            )}
          </div>
          {uploadMsg && (
            <div style={{ marginTop: 10, padding: "10px 14px", borderRadius: 10, fontSize: 13, fontWeight: 600,
              background: uploadMsg.ok ? C.greenLight : C.redLight, color: uploadMsg.ok ? C.green : C.red,
              border: `1px solid ${uploadMsg.ok ? C.greenBorder : C.redBorder}` }}>{uploadMsg.text}</div>
          )}
        </div>
      )}

      {/* The one search box — scan into it, or type to find */}
      <div style={{ ...S.card, padding: "14px 16px", borderTop: `3px solid ${C.orange}` }}>
        <div style={{ position: "relative" }}>
          <SearchIcon style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: C.orange, fontSize: 24 }} />
          <input
            ref={search}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setNotFound(false); setError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") onEnter(); if (e.key === "Escape") { setQuery(""); setNotFound(false); } }}
            placeholder="Scan a return, or type an AWB / sub-order / packet ID / SKU / product…"
            autoComplete="off" spellCheck={false}
            style={{ ...S.inp, width: "100%", boxSizing: "border-box", fontSize: 20, fontFamily: "monospace", fontWeight: 700,
              padding: "14px 18px 14px 50px", background: C.orangeLight, borderColor: C.orangeBorder }}
          />
          {looking && <CircularProgress size={18} style={{ position: "absolute", right: 16, top: 16, color: C.orange }} />}
        </div>
        {(notFound || error) && (
          <div style={{ marginTop: 10, fontSize: 13, fontWeight: 600, color: notFound ? C.amber : C.red }}>
            {notFound ? "No exact match for that code — showing the closest results below." : error}
          </div>
        )}
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {FILTERS.map((x) => {
          const on = filter === x.key;
          const n = counts[x.key];
          const hot = x.key === "attention" && n > 0;
          return (
            <button key={x.key} onClick={() => { setFilter(x.key); refocus(); }}
              style={{
                padding: "7px 14px", borderRadius: 20, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                border: `1.5px solid ${on ? C.orange : hot ? C.redBorder : C.gray200}`,
                background: on ? C.orange : hot ? C.redLight : C.white, color: on ? "#fff" : hot ? C.red : C.gray600,
              }}>
              {x.label}{n != null ? ` · ${n}` : ""}
            </button>
          );
        })}
        {(stats?.expired ?? 0) > 0 && (
          <span style={{ fontSize: 12, color: C.red, fontWeight: 600, marginLeft: 6 }}>{stats.expired} claim window(s) missed</span>
        )}
      </div>

      {/* List + selected return */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(400px, 460px)", gap: 18, alignItems: "start" }}>
        <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
          {loading && !rows.length ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 44 }}><CircularProgress style={{ color: C.orange }} /></div>
          ) : rows.length === 0 ? (
            <div style={{ textAlign: "center", padding: 44, color: C.gray400, fontSize: 13 }}>
              {stats?.total ? "No returns match." : "No returns yet — upload the Meesho returns export to get started."}
            </div>
          ) : (
            rows.map((r) => {
              const on = active?.id === r.id;
              const win = windowText(r);
              return (
                <div key={r.id} onClick={() => { open(r); refocus(); }}
                  style={{
                    display: "flex", gap: 12, alignItems: "center", padding: "11px 16px", cursor: "pointer",
                    borderBottom: `1px solid ${C.gray100}`, background: on ? C.orangeLight : C.white,
                    borderLeft: `4px solid ${on ? C.orange : "transparent"}`,
                  }}>
                  <Photo url={r.image_url} size={52} radius={8} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 14, color: C.gray900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.sku || "—"}
                      </span>
                      <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 13, color: C.orange }}>×{r.qty}</span>
                    </div>
                    <div style={{ fontSize: 12, color: C.gray500, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.return_reason || "No reason on the sheet"}
                    </div>
                    <div style={{ fontSize: 11, color: C.gray400, fontFamily: "monospace", marginTop: 2 }}>
                      {r.suborder_no}{r.packet_id ? ` · packet ${r.packet_id}` : ""}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <Tag variant={CLAIM_TAG[r.claim_status]}>{CLAIM_LABELS[r.claim_status]}</Tag>
                    {win && <div style={{ fontSize: 11, fontWeight: 700, marginTop: 4, color: URGENCY_COLOR[r.claim_urgency] || C.gray500 }}>{win}</div>}
                  </div>
                </div>
              );
            })
          )}
          {total > PAGE_SIZE && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderTop: `1px solid ${C.gray100}` }}>
              <span style={{ fontSize: 12, color: C.gray400 }}>{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => setPage((p) => p - 1)} disabled={page === 1} style={{ ...btn("ghost", "sm"), opacity: page === 1 ? 0.4 : 1 }}>← Prev</button>
                <button onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages} style={{ ...btn("ghost", "sm"), opacity: page >= totalPages ? 0.4 : 1 }}>Next →</button>
              </div>
            </div>
          )}
        </div>

        <div style={{ position: "sticky", top: 12 }}>
          {active ? (
            <div style={{ ...S.card, padding: "18px 20px", maxHeight: "calc(100vh - 40px)", overflowY: "auto" }}>
              {matches.length > 1 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
                  {matches.map((m) => (
                    <button key={m.id} onClick={() => setActive(m)}
                      style={{ ...btn(active.id === m.id ? "primary" : "ghost", "sm"), fontFamily: "monospace" }}>{m.sku} ×{m.qty}</button>
                  ))}
                </div>
              )}
              <ReturnDetail row={active} isMobile={false} saving={saving} onPatch={save}
                onScanPacket={() => {}} justFlagged={justFlagged === active.id}
                onPacketDone={refocus} onClose={() => { clear(); refocus(); }} />
            </div>
          ) : (
            <div style={{ ...S.card, padding: "44px 24px", textAlign: "center", color: C.gray400 }}>
              <QrCodeScannerIcon style={{ fontSize: 44, color: C.gray300 }} />
              <div style={{ fontSize: 15, fontWeight: 700, color: C.gray600, marginTop: 8 }}>Scan a return to see it here</div>
              <div style={{ fontSize: 12.5, marginTop: 4 }}>or pick one from the list</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Tab ───────────────────────────────────────────────────────────────────────
export function ReturnScanTab() {
  const isMobile = useIsMobile();
  const desk = useReturnsDesk();
  return isMobile ? <MobileReturns desk={desk} /> : <DesktopReturns desk={desk} />;
}
