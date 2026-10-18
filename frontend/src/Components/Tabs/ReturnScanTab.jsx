import React, { useState, useEffect, useRef, useCallback, createContext, useContext } from "react";
import { API, C, S, btn, Tag, fmt, useIsMobile } from "../../App";
import { useDateFilter } from "../../contexts/DateFilterContext";
import { useBusiness } from "../../contexts/BusinessContext";
import { BarcodeScanner } from "../shared/BarcodeScanner";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import QrCodeScannerIcon from "@mui/icons-material/QrCodeScanner";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineOutlined";
import SearchIcon from "@mui/icons-material/Search";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import CloseIcon from "@mui/icons-material/Close";
import StorefrontIcon from "@mui/icons-material/Storefront";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import FullscreenExitIcon from "@mui/icons-material/FullscreenExit";
import { CircularProgress } from "@mui/material";

/*
 * Returns Received & Claims.
 *
 * One return at a time, in full. Two sub-tabs on tablet / desktop:
 *
 *   Scan & details — one big scan box, then everything about the scanned
 *                    return: photo, SKU, qty, reason, the claim steps, and every
 *                    detail of the parcel, order, product and money. No list.
 *   All returns    — the filtered list. Picking one opens it in Scan & details.
 *
 * Phone: Scan → the return → "Scan next", nothing else on screen.
 *
 * A parcel may belong to another of the user's businesses (one desk receives
 * for all of them). It opens and saves the same way; a banner says whose it is.
 * The server only allows that in businesses the user is assigned to.
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

// Touch screens (iPad, phones): no auto-focus that pops the keyboard up, and a
// camera scan button. A Bluetooth / USB scanner still works — tap the box first.
const isTouch = () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

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
const fmtDay = (v) => (v ? new Date(v).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : null);

// ── Hindi alongside English ───────────────────────────────────────────────────
// Every step, question and button carries a Hindi line too, for staff who read
// Hindi more easily. A toggle turns it off; the choice is remembered.
const HINDI_KEY = "returns.hindi";
const HindiCtx = createContext(true);
const readPref = (k, dflt) => { try { const v = localStorage.getItem(k); return v == null ? dflt : v === "1"; } catch { return dflt; } };
const writePref = (k, v) => { try { localStorage.setItem(k, v ? "1" : "0"); } catch { /* private mode */ } };

/** A Hindi line under English text; nothing when Hindi is turned off. */
function Hi({ children, size = 12.5, color, inline }) {
  const on = useContext(HindiCtx);
  if (!on) return null;
  const Tag_ = inline ? "span" : "div";
  return (
    <Tag_ lang="hi" style={{ display: inline ? "inline" : "block", fontSize: size, fontWeight: 600, lineHeight: 1.45,
      color: color || "inherit", opacity: color ? 1 : 0.85, marginTop: inline ? 0 : 2 }}>
      {children}
    </Tag_>
  );
}

/** English label with its Hindi under it — for big buttons. */
function Two({ en, hi }) {
  return <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", lineHeight: 1.25 }}>{en}<Hi size={12}>{hi}</Hi></span>;
}

// ── Scanner guns ─────────────────────────────────────────────────────────────
// A scanner types a whole code in a burst (a few ms per character), with or
// without pressing Enter. When a burst ends, act as if Enter was pressed, so a
// scanner set up without an Enter suffix still saves on its own. Ordinary
// typing is far slower and never triggers it.
function useScannerInput(onScan, { minLen = 5, idleMs = 220 } = {}) {
  const last = useRef(0);
  const fast = useRef(0);
  const timer = useRef(null);
  const reset = () => { fast.current = 0; last.current = 0; clearTimeout(timer.current); };
  useEffect(() => () => clearTimeout(timer.current), []);
  return {
    onKeyDown: (e) => {
      if (e.key === "Enter") { reset(); return; }
      if (e.key.length !== 1) return;
      const now = performance.now();
      if (last.current && now - last.current < 45) fast.current += 1;
      last.current = now;
    },
    onValue: (value) => {
      clearTimeout(timer.current);
      const v = (value || "").trim();
      if (v.length >= minLen && fast.current >= minLen - 2) {
        timer.current = setTimeout(() => { reset(); onScan(v); }, idleMs);
      }
    },
    reset,
  };
}

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
  return (
    <a href={url} target="_blank" rel="noreferrer" title="Open full photo" style={box}>
      <img src={url} alt="" onError={() => setBroken(true)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    </a>
  );
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
    <div style={{ minWidth: 0 }}>
      <Label>{label}</Label>
      <div style={{ fontSize: 14, color: C.gray800, fontWeight: 600, fontFamily: mono ? "monospace" : "inherit", wordBreak: "break-word" }}>
        {value || <span style={{ color: C.gray300, fontWeight: 400 }}>—</span>}
      </div>
    </div>
  );
}

function Banner({ tone = "red", icon, children }) {
  const t = {
    red: [C.redLight, C.redBorder, C.red], amber: [C.amberLight, C.amberBorder, "#92400E"],
    blue: [C.blueLight, "#BFDBFE", C.blue], green: [C.greenLight, C.greenBorder, C.green],
  }[tone];
  return (
    <div style={{ padding: "11px 14px", borderRadius: 12, background: t[0], border: `1px solid ${t[1]}`, color: t[2],
      fontSize: 13.5, fontWeight: 600, display: "flex", gap: 9, alignItems: "flex-start", lineHeight: 1.5 }}>
      {icon}<div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

function StepHead({ n, title, hi, done }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
      <span style={{ width: 26, height: 26, borderRadius: 999, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 13, fontWeight: 800, background: done ? C.green : C.orange, color: C.white }}>{done ? "✓" : n}</span>
      <span style={{ fontSize: 15, fontWeight: 800, color: C.gray900 }}>{title}{hi && <Hi size={13} color={C.gray500}>{hi}</Hi>}</span>
    </div>
  );
}

const bigBtn = (variant) => ({ ...btn(variant, "lg"), padding: "16px 12px", fontSize: 15, borderRadius: 12, minHeight: 52 });

/** What this return is: photo, SKU, qty, reason — big enough to read at arm's length. */
function ReturnSummary({ row, compact }) {
  const ctx = row.order_context || {};
  const shippedSku = ctx.label?.sku || ctx.payments?.supplier_sku || null;
  const shippedQty = ctx.label?.qty ?? ctx.payments?.quantity ?? null;
  const skuMismatch = shippedSku && shippedSku.trim().toLowerCase() !== (row.sku || "").trim().toLowerCase();
  const qtyMismatch = shippedQty != null && Number(row.qty) > Number(shippedQty);
  const win = windowText(row);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: compact ? 14 : 20, alignItems: "flex-start", flexWrap: "wrap" }}>
        <Photo url={row.image_url} size={compact ? 118 : 150} radius={16} />
        <div style={{ minWidth: 0, flex: "1 1 200px" }}>
          <Label>SKU</Label>
          <div style={{ fontFamily: "monospace", fontWeight: 800, lineHeight: 1.2, wordBreak: "break-all",
            fontSize: compact ? 21 : 24, color: skuMismatch ? C.red : C.gray900 }}>{row.sku || "—"}</div>
          {row.variation && row.variation !== "Free Size" && (
            <div style={{ fontSize: 14, color: C.gray600, marginTop: 3, fontWeight: 600 }}>{row.variation}</div>
          )}
          {row.product_name && (
            <div style={{ fontSize: 13, color: C.gray500, marginTop: 4, lineHeight: 1.4 }}>{row.product_name}</div>
          )}
          <div style={{ display: "flex", gap: 22, marginTop: 12, flexWrap: "wrap" }}>
            <div>
              <Label>Qty</Label>
              <div style={{ fontFamily: "monospace", fontWeight: 800, fontSize: compact ? 38 : 46, lineHeight: 1, color: qtyMismatch ? C.red : C.gray900 }}>
                {row.qty}
              </div>
            </div>
            {row.packet_id && (
              <div style={{ minWidth: 0 }}>
                <Label>Packet ID</Label>
                <div style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 16, color: C.gray800, wordBreak: "break-all" }}>{row.packet_id}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ padding: "12px 14px", borderRadius: 12, background: C.gray50, border: `1px solid ${C.gray200}` }}>
        <Label>Why it was returned</Label>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.gray900, lineHeight: 1.4 }}>
          {row.return_reason || <span style={{ color: C.gray400, fontWeight: 500 }}>No reason on the sheet</span>}
        </div>
        {row.detailed_return_reason && (
          <div style={{ fontSize: 13.5, color: C.gray600, marginTop: 5, lineHeight: 1.5 }}>“{row.detailed_return_reason}”</div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Tag variant={isRTO(row) ? "red" : "orange"}>{isRTO(row) ? "RTO" : "Customer return"}</Tag>
        <Tag variant={CLAIM_TAG[row.claim_status]}>{CLAIM_LABELS[row.claim_status]}</Tag>
        {row.business_name && <Tag variant="blue">◈ {row.business_name}</Tag>}
        {win && <span style={{ fontSize: 13, fontWeight: 800, color: URGENCY_COLOR[row.claim_urgency] || C.gray500 }}>⏱ {win}</span>}
      </div>

      {(skuMismatch || qtyMismatch) && (
        <Banner icon={<ErrorOutlineIcon style={{ fontSize: 18, flexShrink: 0 }} />}>
          Doesn't match what we shipped:
          {skuMismatch && <div>· shipped <strong>{shippedSku}</strong>, sheet says <strong>{row.sku}</strong></div>}
          {qtyMismatch && <div>· shipped <strong>{shippedQty}</strong>, but <strong>{row.qty}</strong> came back</div>}
        </Banner>
      )}
    </div>
  );
}

/**
 * The packet id on the returned parcel. It's different on every return, so when a
 * claim is required it is stored against that return — scan it (or type it) and
 * press Enter. `autoFocus` puts the cursor here so a machine scan lands in it.
 */
function PacketStep({ row, onPatch, saving, onScanPacket, onDone, autoFocus, touch }) {
  const [packet, setPacket] = useState(row.packet_id ?? "");
  const input = useRef(null);
  useEffect(() => { setPacket(row.packet_id ?? ""); }, [row.id, row.packet_id]);
  // Right after "Claim required" the cursor jumps here (iPad included), so the
  // next thing the scanner gun reads lands in this box.
  useEffect(() => {
    if (!autoFocus) return;
    const el = input.current;
    el?.focus({ preventScroll: true });
    el?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [autoFocus, row.id]);

  const saved = !!row.packet_id;
  const dup = row.packet_duplicate_of || [];
  const save = async (value) => {
    const v = (value ?? packet).trim();
    if (!v || v === (row.packet_id ?? "")) { onDone?.(); return; }
    await onPatch(row.id, { packet_id: v });
    onDone?.();
  };
  const scanner = useScannerInput((v) => save(v));

  return (
    <div style={{
      padding: "14px 16px", borderRadius: 12,
      background: saved ? C.greenLight : C.amberLight, border: `1.5px solid ${saved ? C.greenBorder : C.amberBorder}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <QrCodeScannerIcon style={{ fontSize: 20, color: saved ? C.green : C.amber }} />
        <span style={{ fontSize: 14.5, fontWeight: 800, color: C.gray900 }}>
          {saved ? "Packet ID saved" : "Scan the packet ID on this parcel"}
          <Hi size={13} color={C.gray600}>{saved ? "पैकेट आईडी सेव हो गई" : "इस पार्सल की पैकेट आईडी स्कैन करें"}</Hi>
        </span>
        {saved && <CheckCircleIcon style={{ fontSize: 18, color: C.green }} />}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {touch && (
          <button onClick={onScanPacket} disabled={saving} style={{ ...bigBtn("secondary"), flex: "1 1 100%" }}>
            <PhotoCameraIcon style={{ fontSize: 19, verticalAlign: "-4px" }} />&nbsp;<Two en={saved ? "Scan again with camera" : "Scan with camera"} hi="कैमरे से स्कैन करें" />
          </button>
        )}
        <input
          ref={input}
          value={packet}
          onChange={(e) => { setPacket(e.target.value); scanner.onValue(e.target.value); }}
          onKeyDown={(e) => { scanner.onKeyDown(e); if (e.key === "Enter") save(); }}
          placeholder={touch ? "Scan with the gun, or type it" : "Scan with the machine — it saves by itself"}
          autoComplete="off" spellCheck={false} autoCapitalize="characters"
          style={{ ...S.inp, flex: "1 1 200px", minWidth: 0, fontFamily: "monospace", fontWeight: 700, fontSize: 16, padding: "12px 14px", background: C.white }}
        />
        <button onClick={() => save()} disabled={saving || !packet.trim()}
          style={{ ...btn("primary", "lg"), minHeight: 46, opacity: saving || !packet.trim() ? 0.5 : 1 }}>
          Save
        </button>
        {saved && (
          <button onClick={() => onPatch(row.id, { packet_id: "" })} disabled={saving} style={{ ...btn("ghost", "lg"), minHeight: 46 }}>Clear</button>
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
          <Hi size={12}>पैकेट पर ऑर्डर / AWB न दिखे तो Meesho क्लेम रिजेक्ट कर देता है। यहाँ सेव करने से सबूत इस रिटर्न के साथ रहता है।</Hi>
        </div>
      )}
    </div>
  );
}

/** The claim work, as numbered steps: check the parcel → decide → packet + details. */
function ClaimPanel({ row, onPatch, saving, onScanPacket, justFlagged, onPacketDone, touch, compact }) {
  const [amount, setAmount] = useState(row.claim_amount ?? "");
  const [reference, setReference] = useState(row.claim_reference ?? "");
  const [notes, setNotes] = useState(row.claim_notes ?? "");
  useEffect(() => {
    setAmount(row.claim_amount ?? ""); setReference(row.claim_reference ?? ""); setNotes(row.claim_notes ?? "");
  }, [row.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const cs = row.claim_status;
  const decided = ["RAISED", "APPROVED", "REJECTED"].includes(cs);
  const details = { claim_amount: amount === "" ? null : amount, claim_reference: reference, claim_notes: notes };

  const check = (
    <div>
      <StepHead n={1} title="Check the product in your hand" hi="हाथ में मौजूद सामान जाँचें" done={!!row.verify_result} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <button onClick={() => onPatch(row.id, { verify_result: "MATCH" })} disabled={saving}
          style={bigBtn(row.verify_result === "MATCH" ? "success" : "ghost")}><Two en="✓ Correct & fine" hi="सही और ठीक" /></button>
        <button onClick={() => onPatch(row.id, { verify_result: "MISMATCH" })} disabled={saving}
          style={bigBtn(row.verify_result === "MISMATCH" ? "danger" : "ghost")}><Two en="✗ Wrong / damaged" hi="गलत / टूटा हुआ" /></button>
      </div>
      {row.verify_result === "MISMATCH" && cs === "UNREVIEWED" && (
        <p style={{ fontSize: 12.5, color: C.red, fontWeight: 600, marginTop: 8 }}>Wrong or damaged usually means a claim is required.<Hi size={12}>गलत या टूटा सामान हो तो आमतौर पर क्लेम ज़रूरी होता है।</Hi></p>
      )}
    </div>
  );

  let decision;
  if (cs === "UNREVIEWED") {
    decision = (
      <div>
        <StepHead n={2} title="Is a claim required?" hi="क्या क्लेम करना ज़रूरी है?" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <button onClick={() => onPatch(row.id, { claim_status: "REQUIRED" }, { flagged: true })} disabled={saving} style={bigBtn("primary")}>
            <Two en="Claim required" hi="क्लेम ज़रूरी" />
          </button>
          <button onClick={() => onPatch(row.id, { claim_status: "NOT_REQUIRED" })} disabled={saving} style={bigBtn("ghost")}>
            <Two en="No claim" hi="क्लेम नहीं" />
          </button>
        </div>
      </div>
    );
  } else if (cs === "REQUIRED") {
    decision = (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <StepHead n={2} title="Claim required — fill in the details" hi="क्लेम ज़रूरी — जानकारी भरें" done />
        <PacketStep row={row} onPatch={onPatch} saving={saving} onScanPacket={onScanPacket}
          autoFocus={justFlagged} onDone={onPacketDone} touch={touch} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.gray700, marginBottom: 8 }}>
            Claim details <span style={{ fontWeight: 400, color: C.gray400 }}>(fill in once raised on Meesho)</span>
            <Hi size={12} color={C.gray500}>क्लेम की जानकारी (Meesho पर क्लेम करने के बाद भरें)</Hi>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: compact ? "1fr 1fr" : "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <div>
              <label style={S.label}>Amount (₹)</label>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" style={{ ...S.inp, padding: "11px 12px", fontSize: 15 }} />
            </div>
            <div>
              <label style={S.label}>Meesho ticket ref</label>
              <input value={reference} onChange={(e) => setReference(e.target.value)} style={{ ...S.inp, padding: "11px 12px", fontSize: 15 }} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={S.label}>Notes</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                placeholder="What was wrong, what proof was attached…"
                style={{ ...S.inp, padding: "11px 12px", fontSize: 15, width: "100%", boxSizing: "border-box", resize: "vertical", fontFamily: "inherit" }} />
            </div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: compact ? "1fr" : "1fr 1fr", gap: 10 }}>
          <button onClick={() => onPatch(row.id, { claim_status: "RAISED", ...details })} disabled={saving} style={bigBtn("success")}>
            <CheckCircleIcon style={{ fontSize: 18, verticalAlign: "-4px" }} />&nbsp;<Two en="Claim raised on Meesho" hi="Meesho पर क्लेम कर दिया" />
          </button>
          <button onClick={() => onPatch(row.id, details)} disabled={saving} style={bigBtn("ghostOrange")}><Two en="Save details" hi="जानकारी सेव करें" /></button>
        </div>
        <button onClick={() => onPatch(row.id, { claim_status: "NOT_REQUIRED" })} disabled={saving}
          style={{ ...btn("ghost", "md"), alignSelf: "flex-start" }}>Actually, no claim</button>
      </div>
    );
  } else if (decided) {
    decision = (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <StepHead n={2} title={CLAIM_LABELS[cs]} done />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12 }}>
          <Field label="Claim amount" value={row.claim_amount != null ? fmt(row.claim_amount) : null} mono />
          <Field label="Reference" value={row.claim_reference} mono />
          <Field label="Raised" value={fmtDay(row.claim_raised_at)} />
          <Field label="Packet ID" value={row.packet_id} mono />
        </div>
        {row.claim_notes && <Field label="Notes" value={row.claim_notes} />}
        {!row.packet_id && (
          <PacketStep row={row} onPatch={onPatch} saving={saving} onScanPacket={onScanPacket} onDone={onPacketDone} touch={touch} />
        )}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {cs === "RAISED" && (
            <>
              <button onClick={() => onPatch(row.id, { claim_status: "APPROVED" })} disabled={saving} style={{ ...bigBtn("success"), flex: "1 1 140px" }}>Mark approved</button>
              <button onClick={() => onPatch(row.id, { claim_status: "REJECTED" })} disabled={saving} style={{ ...bigBtn("danger"), flex: "1 1 140px" }}>Mark rejected</button>
            </>
          )}
          <button onClick={() => onPatch(row.id, { claim_status: "REQUIRED" })} disabled={saving} style={btn("ghost", "md")}>Reopen</button>
        </div>
      </div>
    );
  } else {
    decision = (
      <div>
        <StepHead n={2} title="No claim needed" done />
        <button onClick={() => onPatch(row.id, { claim_status: "REQUIRED" }, { flagged: true })} disabled={saving} style={bigBtn("ghostOrange")}>
          Claim is needed after all
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {check}
      <div style={{ borderTop: `1px dashed ${C.gray200}`, paddingTop: 16 }}>{decision}</div>
    </div>
  );
}

/** From dispatch to claim — where this return is in its life. */
function Timeline({ row }) {
  const deadline = row.days_left != null && row.claim_urgency !== "unknown"
    ? new Date(Date.now() + row.days_left * 86400000) : null;
  const steps = [
    { label: "Dispatched", date: row.dispatch_date },
    { label: "Return created", date: row.return_created_date },
    { label: "Came back", date: row.delivered_date },
    { label: "Claim raised", date: row.claim_raised_at, pending: !row.claim_raised_at && ["REQUIRED"].includes(row.claim_status) },
    { label: "Claim deadline", date: !row.claim_raised_at && deadline ? deadline : null, warn: true },
  ].filter((s) => s.date || s.pending);
  if (!steps.length) return null;
  return (
    <div style={{ display: "flex", gap: 0, overflowX: "auto", paddingBottom: 4 }}>
      {steps.map((s, i) => (
        <div key={s.label} style={{ flex: "1 0 120px", position: "relative", paddingTop: 18 }}>
          <div style={{ position: "absolute", top: 6, left: 0, right: i === steps.length - 1 ? "50%" : 0, height: 2,
            background: C.gray200, ...(i === 0 ? { left: "50%" } : {}) }} />
          <div style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", width: 14, height: 14, borderRadius: 999,
            background: s.pending ? C.white : s.warn ? URGENCY_COLOR[row.claim_urgency] || C.amber : C.orange,
            border: `2px solid ${s.warn ? URGENCY_COLOR[row.claim_urgency] || C.amber : C.orange}` }} />
          <div style={{ textAlign: "center", fontSize: 11.5, fontWeight: 700, color: C.gray500, marginTop: 6 }}>{s.label}</div>
          <div style={{ textAlign: "center", fontSize: 12.5, fontWeight: 800, color: s.warn ? URGENCY_COLOR[row.claim_urgency] || C.gray800 : C.gray800 }}>
            {s.pending ? "Not yet" : fmtDay(s.date)}
          </div>
        </div>
      ))}
    </div>
  );
}

function DetailCard({ title, children }) {
  return (
    <div style={{ border: `1px solid ${C.gray100}`, borderRadius: 14, padding: "14px 16px", background: C.white }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: C.gray500, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 12 }}>{title}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 14 }}>{children}</div>
    </div>
  );
}

/** Every other detail of the return — all shown, nothing to expand. */
function FullDetails({ row }) {
  const ctx = row.order_context || {};
  const shipped = ctx.label;
  const payments = ctx.payments;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Timeline row={row} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: 12 }}>
        <DetailCard title="📦 Parcel">
          <Field label="AWB" value={row.awb_number} mono />
          <Field label="Courier" value={row.courier_partner} />
          <Field label="Type" value={row.type_of_return} />
          <Field label="Sub type" value={row.sub_type} />
          <Field label="Packet ID" value={row.packet_id} mono />
          <Field label="Return price type" value={row.return_price_type} />
        </DetailCard>
        <DetailCard title="🧾 Order">
          <Field label="Sub-order" value={row.suborder_no} mono />
          <Field label="Order no" value={row.order_no} mono />
          <Field label="Dispatched" value={fmtDay(row.dispatch_date)} />
          <Field label="Came back" value={fmtDay(row.delivered_date)} />
          <Field label="Meesho PID" value={row.meesho_pid} mono />
          <Field label="Business" value={row.business_name} />
        </DetailCard>
        <DetailCard title="🏷️ Product">
          <Field label="Product" value={row.product_name} />
          <Field label="Category" value={row.category} />
          <Field label="Variation" value={row.variation} />
          <Field label="SKU" value={row.sku} mono />
        </DetailCard>
        {(shipped || payments) && (
          <DetailCard title="🚚 What we shipped & money">
            {shipped && <Field label="Label SKU × qty" value={`${shipped.sku || "—"} × ${shipped.qty ?? "—"}`} mono />}
            {shipped && <Field label="Customer" value={[shipped.customer_name, shipped.customer_city].filter(Boolean).join(" · ")} />}
            {payments && <Field label="Net settlement" value={fmt(payments.net_settlement)} mono />}
            {payments && <Field label="Return shipping" value={fmt(payments.return_shipping_charge)} mono />}
          </DetailCard>
        )}
      </div>
      {(row.tracking_link || row.proof_of_delivery) && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {row.tracking_link && (
            <a href={row.tracking_link} target="_blank" rel="noreferrer" style={{ ...btn("ghost", "md"), textDecoration: "none" }}>
              Track return <OpenInNewIcon style={{ fontSize: 14, verticalAlign: "-2px" }} />
            </a>
          )}
          {row.proof_of_delivery && (
            <a href={row.proof_of_delivery} target="_blank" rel="noreferrer" style={{ ...btn("ghost", "md"), textDecoration: "none" }}>
              Proof of delivery <OpenInNewIcon style={{ fontSize: 14, verticalAlign: "-2px" }} />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function OtherBusinessBanner({ row }) {
  const { activeBusinessId } = useBusiness();
  if (!row.business || String(row.business) === String(activeBusinessId)) return null;
  return (
    <Banner tone="blue" icon={<StorefrontIcon style={{ fontSize: 19, flexShrink: 0 }} />}>
      This return belongs to <b>{row.business_name}</b>. You can still check it, mark the claim and fill in the packet ID here —
      it's saved to {row.business_name}.
    </Banner>
  );
}

/** One return, in full — the phone result screen and the tablet/desktop detail view. */
function ReturnDetail({ row, onPatch, saving, onScanPacket, justFlagged, onPacketDone, compact, touch, onClose }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <OtherBusinessBanner row={row} />
      <div style={{ display: "grid", gridTemplateColumns: compact ? "1fr" : "repeat(auto-fit, minmax(min(100%, 360px), 1fr))", gap: 16, alignItems: "start" }}>
        <div style={{ ...S.card, padding: compact ? "16px 14px" : "20px 22px", position: "relative" }}>
          {onClose && (
            <button onClick={onClose} title="Close" aria-label="Close"
              style={{ position: "absolute", top: 10, right: 10, background: "none", border: "none", cursor: "pointer", color: C.gray400, padding: 6 }}>
              <CloseIcon style={{ fontSize: 22 }} />
            </button>
          )}
          <ReturnSummary row={row} compact={compact} />
        </div>
        <div style={{ ...S.card, padding: compact ? "16px 14px" : "20px 22px", borderTop: `4px solid ${C.orange}` }}>
          <ClaimPanel row={row} onPatch={onPatch} saving={saving} onScanPacket={onScanPacket}
            justFlagged={justFlagged} onPacketDone={onPacketDone} touch={touch} compact={compact} />
        </div>
      </div>
      <FullDetails row={row} />
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
  const [savedAt, setSavedAt] = useState(null);

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
      if (!res.ok) { setError(data.error || data.detail || "Could not save."); return null; }
      setActive(data);
      setMatches((p) => p.map((m) => (m.id === data.id ? data : m)));
      setRecent((p) => p.map((m) => (m.id === data.id ? { ...m, ...data } : m)));
      if (opts.flagged) setJustFlagged(data.id);
      setSavedAt(Date.now());
      return data;
    } catch {
      setError("Network error — could not save.");
      return null;
    } finally {
      setSaving(false);
    }
  };

  const clear = () => { setActive(null); setMatches([]); setJustFlagged(null); };
  return { active, setActive, matches, saving, looking, error, setError, justFlagged, recent, savedAt, lookup, open, patch, clear };
}

function SavedToast({ at }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!at) return undefined;
    setShow(true);
    const t = setTimeout(() => setShow(false), 1600);
    return () => clearTimeout(t);
  }, [at]);
  if (!show) return null;
  return (
    <div role="status" style={{ position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: "calc(96px + env(safe-area-inset-bottom, 0px))",
      zIndex: 30, background: C.gray900, color: C.white, padding: "9px 18px", borderRadius: 999, fontSize: 13.5, fontWeight: 700,
      boxShadow: "0 8px 24px rgba(0,0,0,.2)" }}>
      ✓ Saved
    </div>
  );
}

function RecentStrip({ recent, activeId, onOpen }) {
  if (!recent.length) return null;
  return (
    <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2, alignItems: "center" }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: C.gray400, letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>Scanned today</span>
      {recent.map((r) => (
        <button key={r.id} onClick={() => onOpen(r)}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px 5px 5px", borderRadius: 999, cursor: "pointer", whiteSpace: "nowrap",
            border: `1.5px solid ${r.id === activeId ? C.orange : C.gray200}`, background: r.id === activeId ? C.orangeLight : C.white, fontFamily: "inherit" }}>
          <Photo url={r.image_url} size={26} radius={999} />
          <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 12, color: C.gray800 }}>{r.sku} ×{r.qty}</span>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: { REQUIRED: C.amber, RAISED: C.blue, APPROVED: C.green, REJECTED: C.red }[r.claim_status] || C.gray300 }} />
        </button>
      ))}
    </div>
  );
}

// ── Phone ─────────────────────────────────────────────────────────────────────

function MobileReturns({ desk }) {
  const { active, matches, setActive, saving, looking, error, setError, justFlagged, recent, savedAt, lookup, open, patch, clear } = desk;
  const [camera, setCamera] = useState(false);
  const [packetFor, setPacketFor] = useState(null);
  const [typed, setTyped] = useState("");
  const scanner = useScannerInput((v) => lookup(v).then((r) => r.found && setTyped("")));

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
      <SavedToast at={savedAt} />

      {!active && (
        <>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: C.gray900 }}>Returns</h1>
            <p style={{ fontSize: 12.5, color: C.gray500, marginTop: 3 }}>Scan a returned parcel to see everything about it.</p>
            <Hi size={12.5} color={C.gray500}>लौटा हुआ पार्सल स्कैन करें — उसकी पूरी जानकारी दिखेगी।</Hi>
          </div>
          <DeskToolbar compact />
          <button onClick={() => { setError(null); setCamera(true); }}
            style={{ ...btn("primary", "lg"), padding: "22px 20px", fontSize: 18, borderRadius: 14, width: "100%" }}>
            <PhotoCameraIcon style={{ fontSize: 26, verticalAlign: "-7px" }} />&nbsp;<Two en="Scan return" hi="रिटर्न स्कैन करें" />
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={typed} onChange={(e) => { setTyped(e.target.value); scanner.onValue(e.target.value); }} placeholder="…or type AWB / sub-order / packet ID"
              onKeyDown={(e) => { scanner.onKeyDown(e); if (e.key === "Enter") { lookup(typed).then((r) => r.found && setTyped("")); } }}
              autoComplete="off" style={{ ...S.inp, flex: 1, fontFamily: "monospace", padding: "12px 14px", fontSize: 15 }} />
            <button onClick={() => lookup(typed).then((r) => r.found && setTyped(""))} disabled={looking || !typed.trim()}
              style={{ ...btn("ghostOrange", "md"), opacity: looking || !typed.trim() ? 0.5 : 1 }}>Find</button>
          </div>
          {error && <Banner>{error}</Banner>}
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
          {error && <Banner>{error}</Banner>}
          <ReturnDetail row={active} compact touch saving={saving} onPatch={flagAndScan}
            onScanPacket={() => setPacketFor(active.id)} justFlagged={justFlagged === active.id} />

          {/* The one thing to do next, always in reach. */}
          <div style={{
            position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 20, padding: "10px 14px calc(10px + env(safe-area-inset-bottom))",
            background: "rgba(255,255,255,0.97)", borderTop: `1px solid ${C.gray200}`, display: "flex", gap: 10,
          }}>
            <button onClick={clear} style={{ ...btn("ghost", "lg"), padding: "10px 16px" }}><Two en="Done" hi="हो गया" /></button>
            <button onClick={() => { clear(); setError(null); setCamera(true); }}
              style={{ ...btn("primary", "lg"), flex: 1, padding: "10px 16px", fontSize: 16 }}>
              <QrCodeScannerIcon style={{ fontSize: 22, verticalAlign: "-5px" }} />&nbsp;<Two en="Scan next" hi="अगला स्कैन करें" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Tablet & desktop ──────────────────────────────────────────────────────────

const FILTERS = [
  { key: "all",       label: "All",              claim: "",           urgency: "" },
  { key: "review",    label: "Needs decision",   claim: "",           urgency: "unreviewed" },
  { key: "required",  label: "Claim required",   claim: "REQUIRED",   urgency: "" },
  { key: "attention", label: "Closing soon",     claim: "",           urgency: "attention" },
  { key: "raised",    label: "Raised",           claim: "RAISED",     urgency: "" },
];

function SubTabs({ tab, setTab, total }) {
  const tabs = [
    { key: "scan", label: "Scan & details", icon: <QrCodeScannerIcon style={{ fontSize: 19 }} /> },
    { key: "list", label: `All returns${total != null ? ` · ${total}` : ""}`, icon: <SearchIcon style={{ fontSize: 19 }} /> },
  ];
  return (
    <div role="tablist" style={{ display: "inline-flex", gap: 4, padding: 4, background: C.gray100, borderRadius: 14, alignSelf: "flex-start", maxWidth: "100%" }}>
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
          style={{ display: "flex", alignItems: "center", gap: 7, padding: "11px 18px", borderRadius: 11, border: "none", cursor: "pointer",
            fontFamily: "inherit", fontSize: 14, fontWeight: 800, whiteSpace: "nowrap", minHeight: 44,
            background: tab === t.key ? C.white : "transparent", color: tab === t.key ? C.orange : C.gray500,
            boxShadow: tab === t.key ? "0 2px 8px rgba(0,0,0,.08)" : "none" }}>
          {t.icon}{t.label}
        </button>
      ))}
    </div>
  );
}

function ReturnsList({ onPick, activeId, touch }) {
  const { range, label: periodLabel } = useDateFilter();
  const [query, setQuery] = useState("");
  const [listQuery, setListQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);

  const f = FILTERS.find((x) => x.key === filter);
  // "Closing soon" and "Needs decision" are all-time: an expiring claim must never
  // be hidden by whichever period the global date bar happens to show.
  const ignorePeriod = !!f.urgency;

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

  const counts = {
    all: stats?.total, review: stats?.unreviewed, required: stats?.claim_required,
    attention: stats?.needs_attention, raised: stats?.claim_raised,
  };
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ position: "relative" }}>
        <SearchIcon style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: C.gray400, fontSize: 22 }} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} autoFocus={!touch}
          placeholder="Filter by SKU, sub-order, AWB, packet ID or product…" autoComplete="off" spellCheck={false}
          style={{ ...S.inp, width: "100%", boxSizing: "border-box", fontSize: 15, padding: "13px 16px 13px 46px" }} />
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {FILTERS.map((x) => {
          const on = filter === x.key;
          const n = counts[x.key];
          const hot = x.key === "attention" && n > 0;
          return (
            <button key={x.key} onClick={() => setFilter(x.key)}
              style={{
                padding: "9px 16px", borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", minHeight: 40,
                border: `1.5px solid ${on ? C.orange : hot ? C.redBorder : C.gray200}`,
                background: on ? C.orange : hot ? C.redLight : C.white, color: on ? "#fff" : hot ? C.red : C.gray600,
              }}>
              {x.label}{n != null ? ` · ${n}` : ""}
            </button>
          );
        })}
        <span style={{ fontSize: 12, color: C.gray400 }}>{ignorePeriod ? "all time" : periodLabel}</span>
        {(stats?.expired ?? 0) > 0 && <span style={{ fontSize: 12, color: C.red, fontWeight: 700 }}>{stats.expired} claim window(s) missed</span>}
      </div>

      {loading && !rows.length ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 44 }}><CircularProgress style={{ color: C.orange }} /></div>
      ) : rows.length === 0 ? (
        <div style={{ ...S.card, textAlign: "center", padding: 44, color: C.gray400, fontSize: 13 }}>
          {stats?.total ? "No returns match." : "No returns yet — upload the Meesho returns export to get started."}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 330px), 1fr))", gap: 10 }}>
          {rows.map((r) => {
            const on = activeId === r.id;
            const win = windowText(r);
            return (
              <button key={r.id} onClick={() => onPick(r)}
                style={{ ...S.card, display: "flex", gap: 12, alignItems: "center", padding: "12px 14px", cursor: "pointer", textAlign: "left",
                  fontFamily: "inherit", border: `1.5px solid ${on ? C.orange : C.gray100}`, background: on ? C.orangeLight : C.white, minHeight: 84 }}>
                <Photo url={r.image_url} size={58} radius={10} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 14, color: C.gray900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.sku || "—"}
                    </span>
                    <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 13, color: C.orange }}>×{r.qty}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: C.gray500, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.return_reason || "No reason on the sheet"}
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 5, flexWrap: "wrap" }}>
                    <Tag variant={CLAIM_TAG[r.claim_status]}>{CLAIM_LABELS[r.claim_status]}</Tag>
                    {win && <span style={{ fontSize: 11.5, fontWeight: 700, color: URGENCY_COLOR[r.claim_urgency] || C.gray500 }}>{win}</span>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
      {total > PAGE_SIZE && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <span style={{ fontSize: 12.5, color: C.gray400 }}>{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setPage((p) => p - 1)} disabled={page === 1} style={{ ...btn("ghost", "md"), opacity: page === 1 ? 0.4 : 1 }}>← Prev</button>
            <button onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages} style={{ ...btn("ghost", "md"), opacity: page >= totalPages ? 0.4 : 1 }}>Next →</button>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyScan() {
  const steps = [
    ["Scan", "Scan the label on the returned parcel — or type its AWB, sub-order or packet ID.",
     "स्कैन करें", "लौटे हुए पार्सल का लेबल स्कैन करें — या उसका AWB, सब-ऑर्डर या पैकेट आईडी टाइप करें।"],
    ["Check", "Compare the photo, SKU and quantity with what's in your hand.",
     "जाँचें", "फ़ोटो, SKU और मात्रा को अपने हाथ में मौजूद सामान से मिलाएँ।"],
    ["Decide", "Mark if a claim is required, then scan the packet ID and fill in the claim.",
     "फ़ैसला करें", "क्लेम ज़रूरी है तो चुनें, फिर पैकेट आईडी स्कैन करें और क्लेम की जानकारी भरें।"],
  ];
  return (
    <div style={{ ...S.card, padding: "36px 24px", textAlign: "center" }}>
      <QrCodeScannerIcon style={{ fontSize: 56, color: C.orange }} />
      <div style={{ fontSize: 18, fontWeight: 800, color: C.gray800, marginTop: 8 }}>Scan a returned parcel<Hi size={15} color={C.gray600}>लौटा हुआ पार्सल स्कैन करें</Hi></div>
      <div style={{ fontSize: 13, color: C.gray500, marginTop: 4 }}>Its full details open right here.<Hi size={12.5}>उसकी पूरी जानकारी यहीं खुलेगी।</Hi></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))", gap: 12, marginTop: 22, textAlign: "left" }}>
        {steps.map(([t, d, th, dh], i) => (
          <div key={t} style={{ display: "flex", gap: 10, padding: 12, borderRadius: 12, background: C.gray50 }}>
            <span style={{ width: 26, height: 26, borderRadius: 999, background: C.orange, color: C.white, fontWeight: 800, fontSize: 13,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{i + 1}</span>
            <div>
              <div style={{ fontWeight: 800, fontSize: 13.5, color: C.gray800 }}>{t}<Hi inline size={13} color={C.orange}> · {th}</Hi></div>
              <div style={{ fontSize: 12.5, color: C.gray500, lineHeight: 1.5 }}>{d}</div>
              <Hi size={12.5} color={C.gray600}>{dh}</Hi>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DesktopReturns({ desk }) {
  const { active, matches, setActive, saving, looking, error, setError, justFlagged, recent, savedAt, lookup, open, patch, clear } = desk;
  const touch = isTouch();
  const [tab, setTab] = useState("scan");
  const [query, setQuery] = useState("");
  const [camera, setCamera] = useState(false);
  const [packetFor, setPacketFor] = useState(null);
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState(null);
  const [total, setTotal] = useState(null);
  const search = useRef(null);
  const fileRef = useRef(null);
  const { gun, full } = useContext(DeskCtx);

  // With a scanner gun the cursor lives in the scan box. Off by default on touch
  // screens, where focusing pops the on-screen keyboard up — switch "Scanner gun"
  // on for an iPad with a Bluetooth gun.
  const refocus = useCallback(() => { if (gun) setTimeout(() => search.current?.focus({ preventScroll: true }), 0); }, [gun]);
  useEffect(() => { if (tab === "scan") refocus(); }, [tab, refocus]);
  useEffect(() => {
    fetch(`${API}/returns/?page_size=1`).then((r) => r.json()).then((d) => setTotal(d.stats?.total ?? d.total ?? null)).catch(() => {});
  }, []);

  const onEnter = async (code) => {
    const c = (code ?? query).trim();
    if (!c) return;
    const r = await lookup(c);
    if (r.found) setQuery("");
    refocus();
  };
  const scanner = useScannerInput((v) => onEnter(v));

  const save = async (id, payload, opts) => {
    const data = await patch(id, payload, opts);
    // After a decision the cursor goes back to the scan box — except right after
    // "Claim required", where the packet ID box takes it (on iPad too), so the
    // next scan is the packet ID.
    if (!opts?.flagged) refocus();
    return data;
  };

  const pick = (row) => { open(row); setTab("scan"); window.scrollTo?.({ top: 0, behavior: "smooth" }); };

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
    } catch { setUploadMsg({ ok: false, text: "Network error during upload." }); }
    finally { setUploading(false); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: active && tab === "scan" ? 90 : 0 }}>
      {camera && (
        <BarcodeScanner title="Scan the return" hint="Scan the label on the returned parcel" busy={looking}
          onDetected={(code) => { setCamera(false); onEnter(code); }} onClose={() => setCamera(false)} />
      )}
      {packetFor && (
        <BarcodeScanner title="Scan the packet ID" hint="The order / AWB on the parcel's own waybill"
          onDetected={(code) => { const id = packetFor; setPacketFor(null); patch(id, { packet_id: code }); }}
          onClose={() => setPacketFor(null)} />
      )}
      <SavedToast at={savedAt} />

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: C.gray900 }}>Returns &amp; Claims</h1>
          <p style={{ fontSize: 12.5, color: C.gray400, marginTop: 3 }}>Scan a returned parcel to see everything about it and decide on the claim.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <DeskToolbar />
          {!full && (
            <button onClick={() => setShowUpload((s) => !s)} style={{ ...btn("ghostOrange", "md"), minHeight: 42 }}>
              <UploadFileIcon style={{ fontSize: 16, verticalAlign: "-3px" }} />&nbsp;{showUpload ? "Hide upload" : "Upload returns sheet"}
            </button>
          )}
        </div>
      </div>

      {showUpload && (
        <div>
          <div onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}
            style={{ border: `2px dashed ${C.gray200}`, borderRadius: 14, padding: 22, background: C.gray50, textAlign: "center", cursor: "pointer" }}>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: "none" }} onChange={(e) => handleFile(e.target.files[0])} />
            {uploading ? <CircularProgress size={20} style={{ color: C.orange }} /> : (
              <span style={{ fontSize: 13.5, color: C.gray600, fontWeight: 600 }}>
                Tap to choose (or drop) the Meesho “Returns → Completed/Delivered” export — re-uploading is safe, claim work is never overwritten.
              </span>
            )}
          </div>
          {uploadMsg && <div style={{ marginTop: 10 }}><Banner tone={uploadMsg.ok ? "green" : "red"}>{uploadMsg.text}</Banner></div>}
        </div>
      )}

      <SubTabs tab={tab} setTab={setTab} total={total} />

      {tab === "list" ? (
        <ReturnsList onPick={pick} activeId={active?.id} touch={touch} />
      ) : (
        <>
          {/* The one scan box — scan into it, or type a code */}
          <div style={{ ...S.card, padding: "14px 16px", borderTop: `3px solid ${C.orange}`, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <div style={{ position: "relative", flex: "1 1 320px", minWidth: 0 }}>
                <SearchIcon style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: C.orange, fontSize: 24 }} />
                <input
                  ref={search}
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setError(null); scanner.onValue(e.target.value); }}
                  onKeyDown={(e) => { scanner.onKeyDown(e); if (e.key === "Enter") onEnter(); if (e.key === "Escape") setQuery(""); }}
                  placeholder="Scan a return, or type AWB / sub-order / packet ID…"
                  autoComplete="off" spellCheck={false} autoCapitalize="characters" enterKeyHint="search"
                  style={{ ...S.inp, width: "100%", boxSizing: "border-box", fontSize: 19, fontFamily: "monospace", fontWeight: 700,
                    padding: "15px 18px 15px 50px", background: C.orangeLight, borderColor: C.orangeBorder, minHeight: 56 }}
                />
                {looking && <CircularProgress size={18} style={{ position: "absolute", right: 16, top: 19, color: C.orange }} />}
              </div>
              <button onClick={() => onEnter()} disabled={looking || !query.trim()}
                style={{ ...btn("primary", "lg"), minHeight: 56, opacity: looking || !query.trim() ? 0.5 : 1 }}>Find</button>
              {touch && (
                <button onClick={() => { setError(null); setCamera(true); }} style={{ ...btn("secondary", "lg"), minHeight: 56 }}>
                  <PhotoCameraIcon style={{ fontSize: 20, verticalAlign: "-5px" }} />&nbsp;Camera
                </button>
              )}
            </div>
            {error && <Banner>{error} {!active && <>Try <b>All returns</b> to search by SKU or product.</>}</Banner>}
            <RecentStrip recent={recent} activeId={active?.id} onOpen={pick} />
          </div>

          {active ? (
            <>
              {matches.length > 1 && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontSize: 12.5, color: C.gray500, fontWeight: 700 }}>{matches.length} returns match:</span>
                  {matches.map((m) => (
                    <button key={m.id} onClick={() => setActive(m)}
                      style={{ ...btn(active.id === m.id ? "primary" : "ghost", "md"), fontFamily: "monospace" }}>{m.sku} ×{m.qty}</button>
                  ))}
                </div>
              )}
              <ReturnDetail row={active} saving={saving} onPatch={save} touch={touch}
                onScanPacket={() => setPacketFor(active.id)} justFlagged={justFlagged === active.id}
                onPacketDone={refocus} onClose={() => { clear(); refocus(); }} />
              <div style={{
                position: "sticky", bottom: 0, zIndex: 10, display: "flex", gap: 10, justifyContent: "flex-end",
                padding: "10px 0 calc(10px + env(safe-area-inset-bottom, 0px))", pointerEvents: "none",
              }}>
                <button onClick={() => { clear(); refocus(); }}
                  style={{ ...btn("ghost", "lg"), minHeight: 50, background: C.white, pointerEvents: "auto", boxShadow: "0 6px 18px rgba(0,0,0,.12)" }}><Two en="Done" hi="हो गया" /></button>
                <button onClick={() => { clear(); if (!gun && touch) setCamera(true); else refocus(); window.scrollTo?.({ top: 0, behavior: "smooth" }); }}
                  style={{ ...btn("primary", "lg"), minHeight: 50, fontSize: 15, pointerEvents: "auto", boxShadow: "0 6px 18px rgba(0,0,0,.18)" }}>
                  <QrCodeScannerIcon style={{ fontSize: 20, verticalAlign: "-5px" }} />&nbsp;<Two en="Scan next" hi="अगला स्कैन करें" />
                </button>
              </div>
            </>
          ) : (
            <EmptyScan />
          )}
        </>
      )}
    </div>
  );
}

// ── Desk settings: full screen, Hindi, scanner gun ───────────────────────────

const DeskCtx = createContext(null);
const GUN_KEY = "returns.scannerGun";

function fullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

/** Full screen, Hindi and scanner-gun switches, shown in the page header. */
function DeskToolbar({ compact }) {
  const d = useContext(DeskCtx);
  const pill = (on) => ({
    display: "inline-flex", alignItems: "center", gap: 6, padding: compact ? "8px 11px" : "9px 14px", borderRadius: 999,
    fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", minHeight: 42, whiteSpace: "nowrap",
    border: `1.5px solid ${on ? C.orange : C.gray200}`, background: on ? C.orangeLight : C.white, color: on ? C.orange : C.gray600,
  });
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <button onClick={() => d.setHindi(!d.hindi)} style={pill(d.hindi)} aria-pressed={d.hindi} title="Show Hindi with English">
        अ हिंदी {d.hindi ? "✓" : ""}
      </button>
      <button onClick={() => d.setGun(!d.gun)} style={pill(d.gun)} aria-pressed={d.gun}
        title="Keep the cursor in the scan box so a scanner gun works without tapping">
        <QrCodeScannerIcon style={{ fontSize: 18 }} />{compact ? "Gun" : "Scanner gun"} {d.gun ? "✓" : ""}
      </button>
      {/* In full screen the Exit button is pinned to the top corner instead. */}
      {!d.full && (
        <button onClick={d.enterFull} style={{ ...pill(false), color: C.gray700 }}>
          <FullscreenIcon style={{ fontSize: 20 }} />Full screen<Hi inline size={12}> · फ़ुल स्क्रीन</Hi>
        </button>
      )}
    </div>
  );
}

// ── Tab ───────────────────────────────────────────────────────────────────────
export function ReturnScanTab() {
  const isMobile = useIsMobile();
  const desk = useReturnsDesk();
  const shell = useRef(null);
  const [hindi, setHindiState] = useState(() => readPref(HINDI_KEY, true));
  const [gun, setGunState] = useState(() => readPref(GUN_KEY, !isTouch()));
  const [full, setFull] = useState(false);

  const setHindi = (v) => { setHindiState(v); writePref(HINDI_KEY, v); };
  const setGun = (v) => { setGunState(v); writePref(GUN_KEY, v); };

  // Full screen = the browser's own full screen where it's allowed (desktop,
  // iPad), plus a fixed overlay so the sidebar and header disappear even where
  // it isn't (iPhone). Esc / the browser's own exit leave both.
  const enterFull = async () => {
    setFull(true);
    const el = shell.current;
    try {
      if (el?.requestFullscreen) await el.requestFullscreen();
      else if (el?.webkitRequestFullscreen) el.webkitRequestFullscreen();
    } catch { /* overlay alone is fine */ }
  };
  const exitFull = async () => {
    setFull(false);
    try {
      if (fullscreenElement()) await (document.exitFullscreen?.() || document.webkitExitFullscreen?.());
    } catch { /* already out */ }
  };
  useEffect(() => {
    const onChange = () => { if (!fullscreenElement()) setFull(false); };
    // Esc leaves full screen — but not while typing, where Esc clears the box.
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (["INPUT", "TEXTAREA"].includes(e.target?.tagName)) return;
      setFull(false);
      if (fullscreenElement()) (document.exitFullscreen?.() || document.webkitExitFullscreen?.())?.catch?.(() => {});
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const fullStyle = full ? {
    position: "fixed", inset: 0, zIndex: 1200, background: C.bg, overflowY: "auto", WebkitOverflowScrolling: "touch",
    // Room at the top for the pinned Exit button, so it never covers the toolbar.
    padding: "calc(62px + env(safe-area-inset-top, 0px)) 20px calc(16px + env(safe-area-inset-bottom, 0px))",
  } : {};

  return (
    <DeskCtx.Provider value={{ hindi, setHindi, gun, setGun, full, enterFull, exitFull }}>
      <HindiCtx.Provider value={hindi}>
        <div ref={shell} style={fullStyle}>
          {full && (
            // Always in reach, however far down the page has scrolled.
            <button onClick={exitFull} aria-label="Exit full screen" title="Exit full screen (Esc)"
              style={{ position: "fixed", top: "calc(12px + env(safe-area-inset-top, 0px))", right: 14, zIndex: 1250,
                display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 999, border: "none",
                background: C.gray900, color: C.white, fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
                boxShadow: "0 6px 18px rgba(0,0,0,.25)", opacity: 0.92 }}>
              <FullscreenExitIcon style={{ fontSize: 19 }} />Exit<Hi inline size={12}> · बाहर निकलें</Hi>
            </button>
          )}
          <div style={full ? { maxWidth: 1400, margin: "0 auto" } : undefined}>
            {isMobile ? <MobileReturns desk={desk} /> : <DesktopReturns desk={desk} />}
          </div>
        </div>
      </HindiCtx.Provider>
    </DeskCtx.Provider>
  );
}
