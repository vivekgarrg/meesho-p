import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { API, C, S, btn, Tag, useIsMobile } from "../../App";
import { CircularProgress } from "@mui/material";

/*
 * Meesho Orders — one of the Meesho panel's order lists as the sync last
 * pulled it, as its own tab on the Meesho page (status = pending |
 * ready_to_ship | shipped | cancelled): the numbers that matter for that step,
 * one row of filters, the orders, and that step's action — accept (Pending),
 * make labels and link packets (Ready to ship), check links (Shipped).
 * Refresh pulls now; otherwise the sync pulls every few minutes.
 */

const TONE = { hold: "#B45309", pending: C.orange, ready_to_ship: "#2563EB", shipped: "#059669", cancelled: C.red };
const SLA = {
  breached: { label: "SLA breached", tag: "red" },
  breaching_soon: { label: "Breaching soon", tag: "amber" },
  sla_others: { label: "On time", tag: "gray" },
};
const slaOf = (s) => SLA[s] || (s && s.includes("breach") ? SLA.breached : s ? { label: s.replace(/_/g, " "), tag: "gray" } : null);
const day = (iso) => (iso ? new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso.replace(/([+-]\d\d)(\d\d)$/, "$1:$2"))
  .toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—");
const time = (iso) => (iso ? new Date(iso.replace(/([+-]\d\d)(\d\d)$/, "$1:$2")).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const ago = (iso) => {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso)) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return time(iso);
};
const labelText = (l) => (l === false || l === "Not Downloaded" ? "Label not downloaded" : l === true ? "Label ready" : l || "");
const labelDone = (r) => !(r.label === false || r.label === "Not Downloaded" || !r.label);
const LABEL_FILTERS = [
  { key: "all", label: "All labels", test: () => true },
  { key: "todo", label: "Label not downloaded", test: (r) => !labelDone(r) },
  { key: "done", label: "Label downloaded", test: labelDone },
];
const isBreached = (r) => !!r.sla_status && r.sla_status.includes("breach") && !r.sla_status.includes("soon");
const SLA_FILTERS = [
  { key: "all", label: "Any SLA", test: () => true },
  { key: "breached", label: "Breached", test: isBreached },
  { key: "soon", label: "Breaching soon", test: (r) => r.sla_status === "breaching_soon" },
  { key: "ok", label: "On time", test: (r) => !isBreached(r) && r.sla_status !== "breaching_soon" },
];
const keyOf = (r) => `${r.business_id}:${r.sub_order_num}`;
const BUSY = ["QUEUED", "RUNNING"];

/** Packet ID (from the Orders CSV) and AWB (once Meesho has labelled it). */
function ShipIds({ r, compact }) {
  if (!r.packet_id && !r.awb) return compact ? null : <span style={{ color: C.gray400 }}>—</span>;
  return (
    <span style={{ display: "inline-flex", flexDirection: compact ? "row" : "column", gap: compact ? 8 : 1, flexWrap: "wrap", fontFamily: "monospace", fontSize: 11.5 }}>
      {r.packet_id && <span title="Packet ID"><span style={{ color: C.gray400 }}>PKT </span><b style={{ color: C.gray800 }}>{r.packet_id}</b></span>}
      {r.awb && <span title="AWB"><span style={{ color: C.gray400 }}>AWB </span><span style={{ color: C.gray700 }}>{r.awb}</span></span>}
    </span>
  );
}

const PREVIEW = 300;
function Img({ src, size = 44 }) {
  const [bad, setBad] = useState(false);
  const [at, setAt] = useState(null);     // where the enlarged preview sits while the pointer is over the image
  const box = {
    width: size, height: size, borderRadius: 8, flexShrink: 0, overflow: "hidden", background: C.gray50, border: `1px solid ${C.gray200}`,
    display: "flex", alignItems: "center", justifyContent: "center"
  };
  if (!src || bad) return <div style={{ ...box, fontSize: size * 0.4 }}>📦</div>;
  const place = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const left = r.right + 12 + PREVIEW < window.innerWidth ? r.right + 12 : Math.max(8, r.left - 12 - PREVIEW);
    const top = Math.min(Math.max(8, r.top + r.height / 2 - PREVIEW / 2), window.innerHeight - PREVIEW - 8);
    setAt({ left, top });
  };
  return (
    <div style={{ ...box, cursor: "zoom-in" }} onMouseEnter={place} onMouseLeave={() => setAt(null)}>
      <img src={src} alt="" loading="lazy" onError={() => setBad(true)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      {at && (
        <div style={{
          position: "fixed", left: at.left, top: at.top, width: PREVIEW, height: PREVIEW, zIndex: 3500, pointerEvents: "none",
          background: C.white, borderRadius: 14, border: `1px solid ${C.gray200}`, boxShadow: "0 18px 50px rgba(15,23,42,.28)", overflow: "hidden"
        }}>
          <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
        </div>
      )}
    </div>
  );
}

function OrderCard({ r, cancelled, shipped, selectable, picked, onPick, showBiz }) {
  const sla = slaOf(r.sla_status);
  return (
    <div onClick={selectable ? onPick : undefined}
      style={{ display: "flex", gap: 10, padding: "12px", borderBottom: `1px solid ${C.gray100}`, background: picked ? C.orangeLight : C.white, cursor: selectable ? "pointer" : "default" }}>
      {selectable && <input type="checkbox" checked={picked} onChange={onPick} onClick={(e) => e.stopPropagation()} aria-label={`Select ${r.sub_order_num}`}
        style={{ width: 20, height: 20, accentColor: C.orange, flexShrink: 0, alignSelf: "center" }} />}
      <Img src={r.image} size={52} />
      <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
          <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.sku || "—"}</span>
          <span style={{ fontFamily: "monospace", fontWeight: 900, fontSize: 12, color: C.orange }}>×{r.quantity ?? 1}</span>
        </div>
        <span style={{ fontSize: 12, color: C.gray500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.product_name}{r.variation && r.variation !== "Free Size" ? ` · ${r.variation}` : ""}</span>
        <span style={{ fontSize: 11.5, color: C.gray500, fontFamily: "monospace" }}>{r.sub_order_num}</span>
        <ShipIds r={r} compact />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 2 }}>
          {showBiz && <Tag variant="gray">{r.business_name}</Tag>}
          {cancelled
            ? <Tag variant="red">{r.cancelled_message || "Cancelled"}</Tag>
            : shipped ? <Tag variant="green">Shipped</Tag>
              : <>{sla && <Tag variant={sla.tag}>{sla.label}</Tag>}<span style={{ fontSize: 12, fontWeight: 700, color: C.gray700 }}>Dispatch by {day(r.dispatch_by)}</span></>}
          {r.is_express && <Tag variant="blue">Express</Tag>}
        </div>
      </div>
    </div>
  );
}

const toneOf = (busy, ok, status) => (busy ? { bg: "#EFF6FF", border: "#BFDBFE", fg: "#1E3A8A" }
  : ok ? { bg: C.greenLight, border: C.greenBorder, fg: "#166534" }
    : status === "STUCK" ? { bg: C.amberLight, border: C.amberBorder, fg: "#92400E" }
      : { bg: C.redLight, border: C.redBorder, fg: C.red });
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** The accepts sent together with the newest one (one per business). */
const latestAccepts = (accepts) => {
  const first = accepts?.[0];
  if (!first) return [];
  const t = new Date(first.queued_at);
  return accepts.filter((a) => Math.abs(t - new Date(a.queued_at)) < 60 * 1000);
};

/** How the latest accept went — shown on the Pending tab for half an hour. */
function AcceptStatus({ runs, showBiz }) {
  if (!runs.length || Date.now() - new Date(runs[0].queued_at) > 30 * 60 * 1000) return null;
  const busy = runs.some((r) => BUSY.includes(r.status));
  const ok = runs.every((r) => r.status === "OK");
  const tone = toneOf(busy, ok, runs.find((r) => r.status !== "OK")?.status);
  const n = runs.reduce((t, r) => t + (r.records || 0), 0);
  return (
    <div role="status" style={{
      background: tone.bg, border: `1.5px solid ${tone.border}`, borderRadius: 12, padding: "10px 14px", color: tone.fg,
      fontSize: 13.5, fontWeight: 700, display: "flex", flexDirection: "column", gap: 4
    }}>
      <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {busy && <CircularProgress size={14} style={{ color: tone.fg }} />}
        {busy ? `Accepting ${plural(n, "order")} on Meesho…` : ok && runs.length === 1 ? `✓ ${runs[0].message}` : ok ? `✓ Accepted ${plural(n, "order")}` : "Some orders weren't accepted"}
      </span>
      {(showBiz || runs.length > 1) && runs.map((r) => (
        <span key={r.id} style={{ fontSize: 12.5, fontWeight: 600 }}>
          {r.business_name}: {BUSY.includes(r.status) ? `accepting ${plural(r.records, "order")}…` : r.message}
        </span>
      ))}
    </div>
  );
}

/**
 * The latest label request — one Meesho run per business. While any is still
 * generating it waits; once done, every business's labels download as one
 * PDF, sorted by parent SKU.
 */
function LabelStatus({ batch, onDownload, downloading, showBiz }) {
  if (!batch || Date.now() - new Date(batch.queued_at) > 3 * 60 * 60 * 1000) return null;
  const { runs } = batch;
  const busy = batch.busy;
  const canDownload = !busy && batch.ready > 0;
  const allOk = runs.every((r) => r.ready);
  const tone = toneOf(busy, canDownload && allOk, runs.find((r) => !r.ready)?.status);
  const names = [...new Set(runs.map((r) => r.business_name))];
  return (
    <div role="status" style={{
      background: tone.bg, border: `1.5px solid ${tone.border}`, borderRadius: 12, padding: "10px 14px", color: tone.fg,
      fontSize: 13.5, fontWeight: 700, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap"
    }}>
      <span style={{ flex: "1 1 260px", display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {busy && <CircularProgress size={14} style={{ color: tone.fg }} />}
          {busy ? `Generating ${plural(batch.orders, "label")} on Meesho${names.length > 1 ? ` for ${names.length} businesses` : ""}…`
            : canDownload ? `✓ ${plural(batch.success || batch.orders, "label")} ready${names.length > 1 ? ` from ${names.join(", ")}` : ""} — download them as one file`
              : runs.length === 1 ? runs[0].message : "The labels couldn't be generated"}
        </span>
        {(showBiz || runs.length > 1) && runs.map((r) => (
          <span key={r.id} style={{ fontSize: 12.5, fontWeight: 600 }}>
            {r.business_name}: {BUSY.includes(r.status) ? `generating ${plural(r.records, "label")}…` : r.message}
          </span>
        ))}
      </span>
      {canDownload && (
        <button onClick={() => onDownload(batch)} disabled={downloading} style={{ ...btn("primary", "md"), opacity: downloading ? 0.6 : 1 }}>
          {downloading ? <><CircularProgress size={13} style={{ color: "#fff", marginRight: 6, verticalAlign: "-2px" }} />Merging & sorting…</>
            : `⬇ Download ${names.length > 1 ? "merged" : "sorted"} labels`}
        </button>
      )}
    </div>
  );
}

function ConfirmAccept({ count, businesses, onYes, onNo, busy }) {
  return (
    <div role="dialog" aria-modal="true" aria-label="Accept orders" onClick={onNo}
      style={{ position: "fixed", inset: 0, zIndex: 3400, background: "rgba(15,23,42,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...S.card, maxWidth: 420, width: "100%", padding: 20, display: "flex", flexDirection: "column", gap: 12, borderTop: `5px solid ${C.orange}` }}>
        <div style={{ fontSize: 18, fontWeight: 900, color: C.gray900 }}>Accept {count} order{count === 1 ? "" : "s"} on Meesho?</div>
        <div style={{ fontSize: 13.5, color: C.gray700, lineHeight: 1.55 }}>
          {businesses > 1 && <>Each goes to its own business's Meesho account ({businesses} businesses). </>}
          They move to <b>Ready to ship</b> on the Meesho panel and must be dispatched by their dates. This can't be undone from here.
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onNo} disabled={busy} style={btn("ghost", "md")}>Cancel</button>
          <button onClick={onYes} disabled={busy} style={{ ...btn("primary", "md"), opacity: busy ? 0.6 : 1 }}>{busy ? "Sending…" : `Accept ${count}`}</button>
        </div>
      </div>
    </div>
  );
}


// What each tab is for, which panel lists it shows, and its action.
const VIEWS = {
  pending: { tabs: ["pending"], title: "Pending", action: "accept",
    help: "New orders waiting to be accepted — accept them before their dispatch date. Orders Meesho holds back are listed under On hold." },
  ready_to_ship: { tabs: ["ready_to_ship"], title: "Ready to ship", action: "labels",
    help: "Accepted orders: make their labels, pack them, and link each AWB to its packet." },
  shipped: { tabs: ["shipped"], title: "Shipped", action: null,
    help: "With the courier, until delivered. Check every AWB is linked to its packet on Meesho." },
  cancelled: { tabs: ["cancelled"], title: "Cancelled", action: null, help: "Recently cancelled orders and why." },
};

// Where an AWB ↔ packet link stands (meesho_linking.link_state).
const LINK = {
  linked: { label: "Linked on Meesho", tag: "green" },
  other_packet: { label: "Different packet on Meesho", tag: "red" },
  linked_here_only: { label: "Not on Meesho yet", tag: "amber" },
  not_linked: { label: "Not linked", tag: "gray" },
  no_awb: { label: "No label yet", tag: "gray" },
};
const LINK_FILTERS = [
  { key: "all", label: "Any link", test: () => true },
  { key: "linked", label: "Linked on Meesho", test: (r) => r.link_state === "linked" },
  { key: "todo", label: "Needs linking", test: (r) => ["not_linked", "linked_here_only", "other_packet"].includes(r.link_state) },
  { key: "other_packet", label: "Different packet", test: (r) => r.link_state === "other_packet" },
  { key: "no_awb", label: "No label yet", test: (r) => r.link_state === "no_awb" },
];
const PAGE = 200;

/** A compact dropdown filter: label, options with counts. */
function Pick({ label, options, value, onChange, rows }) {
  return (
    <label style={{ display: "inline-flex", flexDirection: "column", gap: 3, fontSize: 11.5, fontWeight: 700, color: C.gray500, minWidth: 0 }}>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}
        style={{ ...S.inp, width: "auto", padding: "7px 10px", fontWeight: 700, color: value === "all" ? C.gray700 : C.gray900,
          borderColor: value === "all" ? C.gray200 : "#2563EB", background: value === "all" ? C.white : "#EFF6FF" }}>
        {options.map((o) => <option key={o.key} value={o.key}>{o.label} ({rows.filter(o.test).length})</option>)}
      </select>
    </label>
  );
}

/** A headline number that also filters the list when clicked. */
function Num({ label, value, tone = C.gray900, sub, on, onClick }) {
  return (
    <button onClick={onClick} disabled={!onClick} aria-pressed={on}
      style={{ ...S.card, padding: "12px 14px", textAlign: "left", fontFamily: "inherit", cursor: onClick ? "pointer" : "default", minWidth: 0,
        border: `${on ? 2 : 1}px solid ${on ? tone : C.gray200}`, background: on ? C.gray50 : C.white, display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: C.gray500 }}>{label}</span>
      <span style={{ fontSize: 26, fontWeight: 900, lineHeight: 1, color: tone, fontVariantNumeric: "tabular-nums" }}>{value}</span>
      {sub && <span style={{ fontSize: 11.5, color: C.gray500 }}>{sub}</span>}
    </button>
  );
}

function LinkCell({ r, onLink }) {
  const st = LINK[r.link_state];
  if (!st) return null;
  const can = ["not_linked", "linked_here_only", "other_packet"].includes(r.link_state);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
      <Tag variant={st.tag}>{st.label}</Tag>
      {r.link_state === "other_packet" && (
        <span style={{ fontSize: 11, color: C.gray600, fontFamily: "monospace" }}>Meesho {r.meesho_packet} · here {r.link?.packet_id}</span>
      )}
      {can && onLink && (
        <button onClick={() => onLink(r)} style={{ ...btn(r.link_state === "not_linked" ? "primary" : "ghost", "sm"), padding: "3px 10px" }}>
          {r.link_state === "not_linked" ? "🔗 Link" : "↻ Relink"}
        </button>
      )}
    </div>
  );
}

/**
 * Link (or relink) one shipment's AWB to its packet — on Meesho, as the panel's
 * Scan now does, through Order linking (stored, logged, marked packed).
 */
function LinkDialog({ r, onClose, onDone }) {
  const [packet, setPacket] = useState(r.link_state === "other_packet" ? "" : (r.link?.packet_id || ""));
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const relink = !!r.link;
  const submit = async (override = false) => {
    if (!packet.trim()) return;
    setBusy(true); setRes(null);
    try {
      const path = relink ? `meesho-orders/linking/${r.link.id}/relink/` : "meesho-orders/linking/";
      const resp = await fetch(`${API}/${path}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ awb: r.awb, packet_id: packet.trim(), override, awb_method: "MANUAL", packet_method: "SCAN",
          awb_ts: Date.now() - 1000, packet_ts: Date.now() }),
      });
      const d = await resp.json().catch(() => ({}));
      // Only a link Meesho made now marks the parcel packed; anything else is an error.
      if (resp.ok) { setRes({ ok: true, text: `Linked ${r.awb} → ${d.link?.packet_id || packet} and marked packed.` }); onDone(); }
      else setRes({ ok: false, text: `${d.error || "Couldn't link it."} Not marked packed.`, canOverride: d.can_override });
    } catch { setRes({ ok: false, text: "Network error." }); }
    finally { setBusy(false); }
  };
  return (
    <div role="dialog" aria-modal="true" aria-label="Link packet" onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 3400, background: "rgba(15,23,42,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...S.card, maxWidth: 460, width: "100%", padding: 20, display: "flex", flexDirection: "column", gap: 12, borderTop: `5px solid #2563EB` }}>
        <div style={{ fontSize: 18, fontWeight: 900, color: C.gray900 }}>{relink ? "Relink packet" : "Link packet"}</div>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", fontSize: 13 }}>
          <span style={{ color: C.gray500 }}>Order</span><b style={{ fontFamily: "monospace" }}>{r.sub_order_num}{r.sku ? ` · ${r.sku}` : ""}</b>
          <span style={{ color: C.gray500 }}>AWB</span><b style={{ fontFamily: "monospace" }}>{r.awb}</b>
          <span style={{ color: C.gray500 }}>On Meesho</span><span style={{ fontFamily: "monospace" }}>{r.meesho_packet || "no packet yet"}</span>
          {r.link && <><span style={{ color: C.gray500 }}>Linked here</span><span style={{ fontFamily: "monospace" }}>{r.link.packet_id}</span></>}
        </div>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, fontWeight: 800, color: C.gray600 }}>
          Packet ID (scan the KP… QR)
          <input autoFocus value={packet} onChange={(e) => setPacket(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder="KP…" style={{ ...S.inp, fontFamily: "monospace", fontSize: 16, fontWeight: 800 }} />
        </label>
        {res && <div style={{ fontSize: 13, fontWeight: 700, color: res.ok ? "#15803D" : C.red }}>{res.ok ? "✓ " : "✕ "}{res.text}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button onClick={onClose} style={btn("ghost", "md")}>{res?.ok ? "Done" : "Cancel"}</button>
          {res?.canOverride && <button onClick={() => submit(true)} disabled={busy} style={btn("ghost", "md")}>Link anyway</button>}
          {!res?.ok && <button onClick={() => submit()} disabled={busy || !packet.trim()} style={{ ...btn("primary", "md"), opacity: busy || !packet.trim() ? 0.5 : 1 }}>
            {busy ? "Linking on Meesho…" : relink ? "Relink on Meesho" : "Link on Meesho"}
          </button>}
        </div>
      </div>
    </div>
  );
}

export function MeeshoOrdersTab({ status = "pending" }) {
  const isMobile = useIsMobile();
  const view = VIEWS[status] || VIEWS.pending;
  const [data, setData] = useState(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  const [confirming, setConfirming] = useState(false);
  const [labelFilter, setLabelFilter] = useState("all");
  const [slaFilter, setSlaFilter] = useState("all");
  const [linkFilter, setLinkFilter] = useState("all");
  const [bizFilter, setBizFilter] = useState("all");
  const [downloading, setDownloading] = useState(false);
  const [linking, setLinking] = useState(null);
  const [shown, setShown] = useState(PAGE);
  const [showHold, setShowHold] = useState(false);
  useEffect(() => { setShown(PAGE); }, [q, labelFilter, slaFilter, linkFilter, bizFilter]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/meesho-orders/`);
      if (res.ok) setData(await res.json());
      else if (res.status === 403) setError("This page isn't enabled for your account.");
    } catch { /* keep the last data */ }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, data?.syncing ? 3000 : 30000);
    return () => clearInterval(t);
  }, [load, data?.syncing]);

  const post = async (path, body, fail) => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`${API}/meesho-orders/${path}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setError(d.error || fail);
      else if (body) setPicked(new Set());
      await load();
      return res.ok;
    } finally { setBusy(false); }
  };
  const refresh = () => post("refresh/", null, "Couldn't start a refresh.");
  const accept = async () => { await post("accept/", { orders: chosen() }, "Couldn't accept those orders."); setConfirming(false); };
  const generateLabels = () => post("labels/", { orders: chosen() }, "Couldn't generate those labels.");
  const downloadLabels = async (batch) => {
    setDownloading(true); setError(null);
    try {
      const path = batch.batch.startsWith("run-") ? `labels/${batch.runs[0].id}/pdf/` : `labels/batch/${encodeURIComponent(batch.batch)}/pdf/`;
      const res = await fetch(`${API}/meesho-orders/${path}`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.sorted_pdf_b64) { setError(d.error || "Couldn't download the labels."); return; }
      const bytes = Uint8Array.from(atob(d.sorted_pdf_b64), (ch) => ch.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = url; link.download = d.file_name || "meesho-labels.pdf";
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } finally { setDownloading(false); }
  };

  const tabOf = (k) => data?.tabs.find((t) => t.key === k);
  const all = useMemo(() => view.tabs.flatMap((k) => tabOf(k)?.rows || []), [data, status]);   // eslint-disable-line react-hooks/exhaustive-deps
  const byBiz = useMemo(() => all.filter((r) => bizFilter === "all" || String(r.business_id) === bizFilter), [all, bizFilter]);
  const rows = useMemo(() => {
    let out = byBiz;
    if (status === "ready_to_ship") out = out.filter(LABEL_FILTERS.find((f) => f.key === labelFilter).test);
    if (status === "pending" || status === "ready_to_ship") out = out.filter(SLA_FILTERS.find((f) => f.key === slaFilter).test);
    if (status === "ready_to_ship" || status === "shipped") out = out.filter(LINK_FILTERS.find((f) => f.key === linkFilter).test);
    const s = q.trim().toLowerCase();
    if (!s) return out;
    return out.filter((r) => [r.sku, r.sub_order_num, r.order_num, r.product_name, r.packet_id, r.awb, r.business_name, r.meesho_packet]
      .some((v) => (v || "").toLowerCase().includes(s)));
  }, [byBiz, q, status, labelFilter, slaFilter, linkFilter]);

  if (!data) {
    return error
      ? <div style={{ ...S.card, color: C.red, fontWeight: 700 }}>{error}</div>
      : <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><CircularProgress style={{ color: C.orange }} /></div>;
  }
  const current = tabOf(view.tabs[0]);
  const accounts = data.accounts || (data.account ? [data.account] : []);
  const multi = accounts.length > 1;
  const syncing = data.syncing || busy;
  const lastAccepts = latestAccepts(data.accepts);
  const lastLabels = data.label_batches?.[0];
  const working = (status === "pending" && lastAccepts.some((r) => BUSY.includes(r.status))) || (status === "ready_to_ship" && !!lastLabels?.busy);
  const synced = accounts.map((x) => x.last_sync_at).filter(Boolean).sort()[0];
  const failedAccounts = accounts.filter((x) => x.last_sync_status === "FAILED" || x.status === "FAILED");
  const canAct = !!view.action && data.is_admin && data.connected;
  const inTab = new Set(all.map(keyOf));
  const pickedNow = [...picked].filter((x) => inTab.has(x));
  const pickedBiz = new Set(pickedNow.map((k) => k.split(":")[0])).size;
  const allShownPicked = rows.length > 0 && rows.every((r) => picked.has(keyOf(r)));
  const togglePick = (k) => setPicked((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const pickAllShown = () => setPicked((p) => {
    const n = new Set(p);
    if (allShownPicked) rows.forEach((r) => n.delete(keyOf(r))); else rows.forEach((r) => n.add(keyOf(r)));
    return n;
  });
  const chosen = () => all.filter((r) => picked.has(keyOf(r))).map((r) => ({ business_id: r.business_id, sub_order_num: r.sub_order_num }));
  const bizOptions = [{ key: "all", label: "All businesses", test: () => true },
    ...accounts.map((x) => ({ key: String(x.business_id), label: x.business_name, test: (r) => r.business_id === x.business_id }))];
  const filtered = [labelFilter, slaFilter, linkFilter, bizFilter].some((f) => f !== "all") || q;
  const clear = () => { setLabelFilter("all"); setSlaFilter("all"); setLinkFilter("all"); setBizFilter("all"); setQ(""); };
  const hold = tabOf("hold")?.rows || [];
  const count = (test) => byBiz.filter(test).length;
  const today = (r) => r.dispatch_by === data.today;
  const needsLink = LINK_FILTERS.find((f) => f.key === "todo").test;

  // The headline numbers for this step — each one filters the list.
  const nums = {
    pending: [
      { label: "To accept", value: byBiz.length, tone: C.orange, on: slaFilter === "all", onClick: () => setSlaFilter("all") },
      { label: "Past SLA", value: count(isBreached), tone: C.red, on: slaFilter === "breached", onClick: () => setSlaFilter("breached") },
      { label: "Breaching soon", value: count((r) => r.sla_status === "breaching_soon"), tone: "#B45309", on: slaFilter === "soon", onClick: () => setSlaFilter("soon") },
      { label: "Dispatch today", value: count(today), tone: C.gray900 },
      { label: "On hold", value: hold.length, tone: C.gray600, sub: "Meesho holds these back", onClick: hold.length ? () => setShowHold((x) => !x) : null, on: showHold },
    ],
    ready_to_ship: [
      { label: "Ready to ship", value: byBiz.length, tone: "#2563EB", on: !filtered, onClick: clear },
      { label: "Labels to make", value: count((r) => !labelDone(r)), tone: C.orange, on: labelFilter === "todo", onClick: () => setLabelFilter(labelFilter === "todo" ? "all" : "todo") },
      { label: "Needs linking", value: count(needsLink), tone: "#7C3AED", on: linkFilter === "todo", onClick: () => setLinkFilter(linkFilter === "todo" ? "all" : "todo") },
      { label: "Past SLA", value: count(isBreached), tone: C.red, on: slaFilter === "breached", onClick: () => setSlaFilter(slaFilter === "breached" ? "all" : "breached") },
      { label: "Dispatch today", value: count(today), tone: C.gray900 },
    ],
    shipped: [
      { label: "Shipped", value: byBiz.length, tone: "#059669", on: linkFilter === "all", onClick: () => setLinkFilter("all") },
      { label: "Linked on Meesho", value: count((r) => r.link_state === "linked"), tone: "#15803D", on: linkFilter === "linked", onClick: () => setLinkFilter("linked") },
      { label: "Needs linking", value: count(needsLink), tone: "#7C3AED", on: linkFilter === "todo", onClick: () => setLinkFilter("todo") },
      { label: "Different packet", value: count((r) => r.link_state === "other_packet"), tone: C.red, on: linkFilter === "other_packet", onClick: () => setLinkFilter("other_packet") },
    ],
    cancelled: [{ label: "Cancelled", value: byBiz.length, tone: C.red }],
  }[status];

  const showLink = status === "ready_to_ship" || status === "shipped";
  const cols = [
    ...(canAct ? [""] : []), "Product", ...(multi ? ["Business"] : []), "Qty", "Sub-order",
    ...(showLink ? ["AWB / Packet", "Link"] : []),
    ...(status === "ready_to_ship" ? ["Label"] : []),
    status === "cancelled" ? "Reason" : status === "shipped" ? "Ordered" : "Dispatch by",
    ...(["pending", "ready_to_ship"].includes(status) ? ["SLA"] : []),
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: pickedNow.length ? 72 : 0 }}>
      {/* What this tab is for, how fresh it is, and Refresh */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, maxWidth: 760 }}>
          <div style={{ fontSize: 13.5, color: C.gray600 }}>{view.help}</div>
          <div style={{ fontSize: 12, color: C.gray500, marginTop: 3 }}>
            {data.connected ? <>From the Meesho panel{multi ? ` · ${accounts.length} businesses` : ""} · updated <b>{ago(current?.fetched_at || synced)}</b></>
              : "Connect a Meesho account to see its orders here."}
          </div>
        </div>
        {data.connected && (
          <button onClick={refresh} disabled={syncing} style={{ ...btn("ghost", "md"), minWidth: 120, opacity: syncing ? 0.7 : 1 }}>
            {syncing ? <><CircularProgress size={13} style={{ marginRight: 6, verticalAlign: "-2px" }} />Syncing…</> : "↻ Refresh"}
          </button>
        )}
      </div>

      {!data.connected && (
        <div style={{ ...S.card, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", borderTop: `4px solid ${C.orange}` }}>
          <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: C.gray700 }}>No Meesho account connected yet.</span>
          <Link to="/meesho/settings" style={{ ...btn("primary", "md"), textDecoration: "none" }}>Connect Meesho</Link>
        </div>
      )}
      {failedAccounts.map((x) => (
        <div key={x.business_id} style={{ background: C.redLight, border: `1.5px solid ${C.redBorder}`, borderRadius: 12, padding: "10px 14px", color: C.red, fontSize: 13, fontWeight: 700 }}>
          {multi ? `${x.business_name}: last` : "Last"} sync failed: {x.last_sync_message || x.status_message} <Link to="/meesho/settings" style={{ color: C.red }}>Fix it under Settings →</Link>
        </div>
      ))}
      {error && <div role="alert" style={{ color: C.red, fontWeight: 700, fontSize: 13 }}>{error}</div>}

      <div style={{ display: "grid", gap: 10, gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : `repeat(${nums.length}, minmax(0, 1fr))` }}>
        {nums.map((n) => <Num key={n.label} {...n} />)}
      </div>

      {status === "pending" && <AcceptStatus runs={lastAccepts} showBiz={multi} />}
      {status === "ready_to_ship" && <LabelStatus batch={lastLabels} onDownload={downloadLabels} downloading={downloading} showBiz={multi} />}
      {status === "pending" && showHold && hold.length > 0 && (
        <div style={{ ...S.card, padding: 0, overflow: "hidden", borderTop: `4px solid ${TONE.hold}` }}>
          <div style={{ padding: "10px 14px", fontWeight: 800, color: TONE.hold }}>On hold · {hold.length}</div>
          {hold.map((r) => <OrderCard key={keyOf(r)} r={r} showBiz={multi} />)}
        </div>
      )}
      {confirming && <ConfirmAccept count={pickedNow.length} businesses={pickedBiz} busy={busy} onYes={accept} onNo={() => setConfirming(false)} />}
      {linking && <LinkDialog r={linking} onClose={() => setLinking(null)} onDone={load} />}

      <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
        {/* One row of filters */}
        <div style={{ padding: "12px 14px", display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", borderBottom: `1px solid ${C.gray100}`, background: C.gray50 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search SKU, sub-order, AWB, packet…" aria-label="Search orders"
            style={{ ...S.inp, flex: "1 1 240px", minWidth: 0 }} />
          {multi && <Pick label="Business" options={bizOptions} value={bizFilter} onChange={setBizFilter} rows={all} />}
          {status === "ready_to_ship" && <Pick label="Label" options={LABEL_FILTERS} value={labelFilter} onChange={setLabelFilter} rows={byBiz} />}
          {["pending", "ready_to_ship"].includes(status) && <Pick label="SLA" options={SLA_FILTERS} value={slaFilter} onChange={setSlaFilter} rows={byBiz} />}
          {showLink && <Pick label="Packet link" options={LINK_FILTERS} value={linkFilter} onChange={setLinkFilter} rows={byBiz} />}
          {filtered && <button onClick={clear} style={{ ...btn("ghost", "sm"), alignSelf: "flex-end" }}>Clear filters</button>}
        </div>
        <div style={{ padding: "8px 14px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderBottom: `1px solid ${C.gray100}`, fontSize: 12.5, color: C.gray500 }}>
          {canAct && rows.length > 0 && (
            <label style={{ display: "inline-flex", gap: 8, alignItems: "center", fontWeight: 700, color: C.gray700, cursor: "pointer" }}>
              <input type="checkbox" checked={allShownPicked} onChange={pickAllShown} disabled={working} style={{ width: 17, height: 17, accentColor: C.orange }} />
              Select all {rows.length}{filtered ? " shown" : ""}
            </label>
          )}
          <span>{rows.length} of {byBiz.length} {view.title.toLowerCase()} order{byBiz.length === 1 ? "" : "s"}</span>
        </div>

        {rows.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: C.gray500, fontSize: 14 }}>
            {!current?.fetched_at ? "Not pulled yet — press Refresh." : filtered ? "No orders match these filters." : `No ${view.title.toLowerCase()} orders right now.`}
          </div>
        ) : isMobile ? (
          rows.slice(0, shown).map((r) => (
            <div key={keyOf(r)}>
              <OrderCard r={r} cancelled={status === "cancelled"} shipped={status === "shipped"} showBiz={multi}
                selectable={canAct && !working} picked={picked.has(keyOf(r))} onPick={() => togglePick(keyOf(r))} />
              {showLink && <div style={{ padding: "0 12px 12px 74px" }}><LinkCell r={r} onLink={data.is_admin ? setLinking : null} /></div>}
            </div>
          ))
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr>{cols.map((h, i) => <th key={i} style={{ ...S.th, whiteSpace: "nowrap", ...(h === "" ? { width: 36 } : {}) }}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.slice(0, shown).map((r) => {
                  const sla = slaOf(r.sla_status);
                  const on = picked.has(keyOf(r));
                  return (
                    <tr key={keyOf(r)} style={{ background: on ? C.orangeLight : undefined }}>
                      {canAct && (
                        <td style={{ ...S.td, width: 36 }}>
                          <input type="checkbox" checked={on} onChange={() => togglePick(keyOf(r))} disabled={working}
                            aria-label={`Select ${r.sub_order_num}`} style={{ width: 17, height: 17, accentColor: C.orange }} />
                        </td>
                      )}
                      <td style={S.td}>
                        <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 240 }}>
                          <Img src={r.image} />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontFamily: "monospace", fontWeight: 800 }}>{r.sku || "—"}</div>
                            <div style={{ fontSize: 12, color: C.gray500, maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.product_name}>
                              {r.product_name}{r.variation && r.variation !== "Free Size" ? ` · ${r.variation}` : ""}
                            </div>
                          </div>
                        </div>
                      </td>
                      {multi && <td style={{ ...S.td, whiteSpace: "nowrap" }}>{r.business_name}</td>}
                      <td style={{ ...S.td, fontFamily: "monospace", fontWeight: 800 }}>{r.quantity ?? 1}</td>
                      <td style={{ ...S.td, fontFamily: "monospace", fontSize: 12, whiteSpace: "nowrap" }}>
                        {r.sub_order_num}
                        {status !== "shipped" && <div style={{ fontSize: 11, color: C.gray400, fontFamily: "inherit" }}>{time(r.created_iso)}</div>}
                      </td>
                      {showLink && <td style={{ ...S.td, whiteSpace: "nowrap" }}><ShipIds r={r} /></td>}
                      {showLink && <td style={S.td}><LinkCell r={r} onLink={data.is_admin ? setLinking : null} /></td>}
                      {status === "ready_to_ship" && <td style={{ ...S.td, fontSize: 12 }}><Tag variant={labelDone(r) ? "green" : "amber"}>{labelDone(r) ? "Downloaded" : "To make"}</Tag></td>}
                      {status === "cancelled"
                        ? <td style={S.td}><Tag variant="red">{r.cancelled_message || "Cancelled"}</Tag></td>
                        : status === "shipped"
                          ? <td style={{ ...S.td, whiteSpace: "nowrap" }}>{time(r.created_iso)}</td>
                          : <td style={{ ...S.td, whiteSpace: "nowrap", fontWeight: today(r) ? 800 : 500, color: today(r) ? C.gray900 : C.gray700 }}>{day(r.dispatch_by)}{today(r) ? " · today" : ""}</td>}
                      {["pending", "ready_to_ship"].includes(status) && (
                        <td style={S.td}>{sla && <Tag variant={sla.tag}>{sla.label}</Tag>}{r.is_express && <> <Tag variant="blue">Express</Tag></>}</td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > shown && (
          <div style={{ padding: 10, textAlign: "center", borderTop: `1px solid ${C.gray100}` }}>
            <button onClick={() => setShown((n) => n + PAGE)} style={btn("ghost", "sm")}>Show {Math.min(PAGE, rows.length - shown)} more of {rows.length - shown}</button>
          </div>
        )}
      </div>

      {/* The step's action, always in reach while orders are ticked */}
      {canAct && pickedNow.length > 0 && (
        <div role="region" aria-label="Selected orders"
          style={{ position: "sticky", bottom: 12, zIndex: 30, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap",
            padding: "12px 16px", borderRadius: 14, background: C.gray900, color: "#fff", boxShadow: "0 12px 30px rgba(15,23,42,.3)" }}>
          <b>{pickedNow.length} selected</b>
          {pickedBiz > 1 && <span style={{ fontSize: 12.5, opacity: 0.8 }}>across {pickedBiz} businesses</span>}
          <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8 }}>
            <button onClick={() => setPicked(new Set())} disabled={working} style={{ ...btn("ghost", "sm"), background: "transparent", color: "#fff", borderColor: "rgba(255,255,255,.4)" }}>Clear</button>
            {view.action === "labels" ? (
              <button onClick={generateLabels} disabled={working || busy} style={{ ...btn("primary", "md"), opacity: working || busy ? 0.5 : 1 }}>
                🏷 Make {pickedNow.length} label{pickedNow.length === 1 ? "" : "s"}
              </button>
            ) : (
              <button onClick={() => setConfirming(true)} disabled={working} style={{ ...btn("primary", "md"), opacity: working ? 0.5 : 1 }}>
                ✓ Accept {pickedNow.length} order{pickedNow.length === 1 ? "" : "s"}
              </button>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
