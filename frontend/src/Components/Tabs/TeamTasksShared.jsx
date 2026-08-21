import React from "react";
import { C, S, fmt, btn, Tag } from "../../App";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

export const PLATFORM_TAG = { MEESHO: "orange", AMAZON: "amber", FLIPKART: "blue" };
export const CLAIM_VIDEO_MAX_MB = 22;

export const STATUS_META = {
  ASSIGNED:  { label: "To do",           tag: "gray",  accent: C.gray400 },
  SUBMITTED: { label: "Awaiting review", tag: "amber", accent: C.amber },
  APPROVED:  { label: "Approved",        tag: "green", accent: C.green },
  REJECTED:  { label: "Rejected",        tag: "red",   accent: C.red },
};

export const LISTING_STATUS = {
  PENDING:  { label: "Waiting for approval", short: "Waiting",  tag: "amber", accent: C.amber },
  APPROVED: { label: "Approved",             short: "Approved", tag: "green", accent: C.green },
  REJECTED: { label: "Needs a fix",          short: "Rejected", tag: "red",   accent: C.red },
};

export const fmtDate = (v) => (v ? new Date(v).toLocaleString("en-IN", {
  day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

/**
 * Inputs are 13px on desktop, but iOS Safari zooms the whole page whenever a
 * focused input is under 16px — so every field grows on a phone. One helper so
 * no field in this tab can forget.
 */
export const field = (isMobile, extra) => ({ ...S.inp, fontSize: isMobile ? 16 : 13, ...extra });

/** Buttons need a 40px tap target on touch; ghost icon buttons especially. */
export const tap = (isMobile, extra) => ({
  background: "none", border: "none", cursor: "pointer", color: C.gray400,
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: isMobile ? 40 : 30, height: isMobile ? 40 : 30, borderRadius: 9,
  padding: 0, flexShrink: 0, ...extra,
});

/** A row that scrolls sideways rather than wrapping into ragged lines on a
    phone. The mask fades the trailing edge so an item cut off mid-word reads
    as "more to scroll" rather than as truncated, broken text. */
export const scrollRow = {
  display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2,
  WebkitOverflowScrolling: "touch", scrollbarWidth: "none",
  maskImage: "linear-gradient(to right, black calc(100% - 20px), transparent 100%)",
  WebkitMaskImage: "linear-gradient(to right, black calc(100% - 20px), transparent 100%)",
};

export function Chevron({ open, size = 20, color = C.gray400 }) {
  return (
    <ExpandMoreIcon style={{
      fontSize: size, color, flexShrink: 0,
      transition: "transform 0.18s ease",
      transform: open ? "rotate(180deg)" : "rotate(0deg)",
    }} />
  );
}

export function Money({ value, muted }) {
  return <span style={{ fontFamily: "monospace", fontWeight: 800,
    color: muted ? C.gray400 : Number(value) < 0 ? C.red : C.green }}>{fmt(value)}</span>;
}

export function Metric({ label, value, accent, money, onClick, active }) {
  return (
    <button onClick={onClick} disabled={!onClick} style={{
      background: active ? accent : C.white,
      border: `1px solid ${active ? accent : C.border}`,
      borderLeft: `3px solid ${accent}`,
      borderRadius: 11, padding: "10px 15px", minWidth: 96,
      cursor: onClick ? "pointer" : "default",
      display: "flex", flexDirection: "column", gap: 2,
      fontFamily: "inherit", textAlign: "left", flexShrink: 0,
      boxShadow: active ? "none" : "0 1px 2px rgba(19,17,28,0.04)",
    }}>
      <span style={{ fontSize: 18, fontWeight: 800, fontFamily: "monospace", lineHeight: 1.1,
        color: active ? C.white : money ? C.green : C.gray800 }}>
        {money ? fmt(value) : (value ?? "—")}
      </span>
      <span style={{ fontSize: 10.5, fontWeight: 600, whiteSpace: "nowrap",
        color: active ? "rgba(255,255,255,0.9)" : C.gray500 }}>{label}</span>
    </button>
  );
}

export function Section({ icon, title, open, onToggle, right, children }) {
  return (
    <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
      <div onClick={onToggle} style={{
        display: "flex", alignItems: "center", gap: 9, padding: "12px 16px",
        cursor: "pointer", borderBottom: open ? `1px solid ${C.border}` : "none",
      }}>
        {icon}
        <span style={{ fontSize: 13.5, fontWeight: 700, color: C.gray800 }}>{title}</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}
          onClick={(e) => e.stopPropagation()}>{right}</div>
        <Chevron open={open} size={18} />
      </div>
      {open && <div style={{ padding: 16 }}>{children}</div>}
    </div>
  );
}

/** One SKU row's approve / reject action strip — shared by Product detail and Legacy listings. */
export function ListingReviewRow({ listing, isMobile, busy, onReview, isAdmin = true }) {
  const [rejecting, setRejecting] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const st = LISTING_STATUS[listing.status] || LISTING_STATUS.PENDING;

  return (
    <div style={{
      border: `1px solid ${listing.status === "REJECTED" ? C.redBorder : C.border}`,
      borderLeft: `3px solid ${st.accent}`,
      borderRadius: 12, padding: isMobile ? "11px 12px" : "11px 14px",
      background: listing.status === "REJECTED" ? C.redLight : C.white,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 14.5,
              color: C.gray900, wordBreak: "break-all" }}>
              {listing.sku_id}
            </span>
            <Tag variant={st.tag} fontSize={10.5}>{st.short}</Tag>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 3 }}>
            {listing.created_by_name && (
              <span style={{ fontSize: 11.5, color: C.gray400 }}>by {listing.created_by_name}</span>
            )}
            {listing.reward_credited_at && <Money value={listing.reward_amount} />}
          </div>
        </div>
      </div>

      {listing.review_comment && (
        <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 8, lineHeight: 1.5,
          color: listing.status === "REJECTED" ? C.red : C.green }}>
          {listing.review_comment}
        </div>
      )}

      {isAdmin && listing.status !== "APPROVED" && !rejecting && (
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button onClick={() => onReview(listing.id, "APPROVE", "")} disabled={busy}
            style={{ ...btn("success", "sm"), flex: isMobile ? 1 : "none", padding: "8px 15px" }}>
            Approve &amp; pay
          </button>
          <button onClick={() => { setRejecting(true); setReason(""); }} disabled={busy}
            style={{ ...btn("ghost", "sm"), color: C.red, borderColor: C.redBorder,
              flex: isMobile ? 1 : "none", padding: "8px 15px" }}>
            Reject
          </button>
        </div>
      )}

      {isAdmin && rejecting && (
        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="What needs fixing?"
            onKeyDown={(e) => { if (e.key === "Enter" && reason.trim()) {
              onReview(listing.id, "REJECT", reason.trim()); setRejecting(false); } }}
            style={field(isMobile, { flex: "1 1 190px" })} />
          <button disabled={busy || !reason.trim()}
            onClick={() => { onReview(listing.id, "REJECT", reason.trim()); setRejecting(false); }}
            style={{ ...btn("danger", "sm"), opacity: reason.trim() ? 1 : 0.5 }}>
            Send back
          </button>
          <button onClick={() => setRejecting(false)} style={btn("ghost", "sm")}>Cancel</button>
        </div>
      )}
    </div>
  );
}
