import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { API, C, S, btn, Tag, useIsMobile } from "../../App";
import { BarcodeScanner } from "../shared/BarcodeScanner";
import QrCodeScannerIcon from "@mui/icons-material/QrCodeScanner";
import RefreshIcon from "@mui/icons-material/Refresh";
import MenuIcon from "@mui/icons-material/Menu";
import { CircularProgress } from "@mui/material";
import {
  Photo, LatestPanel, StatTabs, DeskBusinesses, useDeskBusinesses, DESK_CSS, courierTone, cleanCourier, fmtDay, fmtTime,
} from "./OrderScanTab";

/*
 * Return Scan — the returns desk, the same desk as Order Scan run the other way.
 *
 * The Returns → Delivered sheet uploaded on Returns & Claims says which returns
 * came back on each day: that is the day's list. Scan every returned parcel as
 * it is unpacked; the courier cards show received against the sheet's count, so
 * the desk knows the day matches. Returns still in transit on the In-transit
 * sheet are tracked by their expected date, and anything the sheet says was
 * delivered on an earlier day but never scanned is flagged as missing — the
 * ones to raise a claim for.
 *
 * Every parcel scanned is received — the counts go up the moment it's scanned,
 * whatever Meesho says. A return Meesho still shows in transit (handed over by the
 * delivery boy before Meesho caught up) waits on "In transit" until Meesho marks it
 * delivered, then moves to "Delivered" — courier by courier. The page refreshes
 * itself, so a second phone at the desk sees the same counts.
 */

const TABS = [
  { key: "received",   label: "Received" },
  { key: "pending",    label: "To receive" },
  { key: "verified",   label: "In transit" },
  { key: "delivered",  label: "Delivered" },
  { key: "upcoming",   label: "Upcoming" },
  { key: "extra",      label: "Not ours" },
  { key: "missing",    label: "Missing" },
  { key: "damaged",    label: "Damaged" },
];
const TONES = { pending: C.orange, received: C.green, upcoming: "#0891B2", verified: "#7C3AED", delivered: "#15803D", extra: "#2563EB", missing: C.red, damaged: "#B45309" };
const LIVE_EVERY = 20000;   // ms — the desk refreshes itself this often while it's on screen
const DUE = {
  out_for_delivery: { text: "🛵 Out for delivery", variant: "amber" },
  overdue: { text: "Overdue", variant: "red" },
  today: { text: "Due today", variant: "blue" },
  later: { text: "Expected", variant: "gray" },
};
const WHY = {
  early: "Arrived early — sheet still shows it in transit",
  earlier: "From an earlier day's list",
  later: "Sheet says delivered on a later day",
  unknown: "Not recognised — keep aside",
};
const todayISO = () => {
  const d = new Date(); const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const dayName = (iso, today) => (iso === today ? `Today · ${fmtDay(iso)}` : fmtDay(iso));

// ── The desk ──────────────────────────────────────────────────────────────────

function useReturnDesk() {
  const [picked, setPicked] = useState("");
  const [queue, setQueue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [latest, setLatest] = useState(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const scans = useRef(0);        // bumps on every scan: a load started before one is stale
  const lastScan = useRef(0);
  const timer = useRef(null);
  const date = picked || queue?.date || "";

  const load = useCallback(async () => {
    const p = new URLSearchParams();
    if (picked) p.set("date", picked);
    const at = scans.current;
    try {
      const res = await fetch(`${API}/return-scan/queue/?${p}`);
      // A scan landed while this was on its way: its answer is older than the counts on screen.
      if (res.ok) { const d = await res.json(); if (at === scans.current) setQueue(d); }
    } catch { /* offline a moment — the next refresh catches up */ } finally { setLoading(false); }
  }, [picked]);
  useEffect(() => { setLoading(true); setLatest(null); setQueue(null); load(); }, [load]);
  const reloadSoon = useCallback(() => { clearTimeout(timer.current); timer.current = setTimeout(load, 900); }, [load]);
  useEffect(() => () => clearTimeout(timer.current), []);
  // Live: refresh every LIVE_EVERY while on screen (not mid-scanning), and on coming back to the tab.
  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible" && Date.now() - lastScan.current > 4000) load(); };
    const id = setInterval(tick, LIVE_EVERY);
    const back = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", back); window.removeEventListener("focus", back); };
  }, [load]);

  const record = async (raw, extra = {}) => {
    const code = (raw ?? "").trim();
    if (!code) return null;
    setBusy(true);
    const my = ++seq.current;
    lastScan.current = Date.now();
    try {
      const res = await fetch(`${API}/return-scan/`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, day: picked || undefined, ...extra }),
      });
      const d = await res.json().catch(() => ({}));
      let out;
      if (!res.ok) {
        out = { kind: "err", title: "Not recorded", lines: [d.error || "Could not record that scan."] };
      } else if (!d.matched) {
        out = { kind: "err", title: "NOT RECOGNISED — keep aside", lines: [code, "No return of any business here matches this code yet — it's counted, and links up by itself if Meesho's returns list brings it in."],
          scanId: d.item?.scan_id, damaged: d.item?.damaged, label: code };
        navigator.vibrate?.([120, 80, 120]);
        scans.current += 1;
        setQueue((q) => q && addScan(q, d.item));
      } else {
        const i = d.item;
        const lines = [`${i.sku || i.suborder_no} × ${i.qty || 1}`, [i.courier, i.rto ? "RTO" : "Customer return", i.business_name].filter(Boolean).join(" · ")];
        if (i.return_reason) lines.push(i.return_reason);
        let kind = "ok"; let title = `Received · ${i.rto ? "RTO" : "customer return"}`;
        if (d.already_scanned) { kind = "warn"; title = `Already received · ${fmtDay(i.received_day)}`; }
        else if (d.where === "in_transit") { title = `Received · ${i.rto ? "RTO" : "customer return"} · in transit on Meesho`; lines.push(`It's with us now. Meesho still shows it in transit${i.expected_date ? ` (expected ${fmtDay(i.expected_date)})` : ""} — it moves to Delivered when ${cleanCourier(i.courier)} marks it delivered.`); }
        else if (d.where === "earlier") { kind = "warn"; title = `Received · from ${fmtDay(i.delivered_date)}'s list`; }
        else if (d.where === "later") { kind = "warn"; title = "Received · not on this day's list"; lines.push(`Sheet says delivered ${fmtDay(i.delivered_date)}.`); }
        out = { kind, title, lines, image_url: i.image_url, image_fallback_url: i.image_fallback_url, scanId: i.scan_id, damaged: i.damaged,
          label: [i.sku || i.suborder_no, i.awb].filter(Boolean).join(" · ") };
        scans.current += 1;
        setQueue((q) => q && addScan(q, i));
      }
      if (my === seq.current) setLatest(out);
      reloadSoon();
      return out;
    } catch {
      const out = { kind: "err", title: "Network error", lines: ["The scan was not recorded."] };
      if (my === seq.current) setLatest(out);
      return out;
    } finally { setBusy(false); }
  };

  // Damaged / tampered packet, and whether it was raised with the delivery boy.
  const mark = async (scanId, patch) => {
    const res = await fetch(`${API}/return-scan/${scanId}/`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
    }).catch(() => null);
    if (!res?.ok) { window.alert("Couldn't save that — try again."); return; }
    const d = await res.json();
    const upd = (r) => (r.scan_id === scanId ? { ...r, ...d } : r);
    setQueue((q) => q && { ...q, items: q.items.map(upd), extra: (q.extra || []).map(upd), damaged: (q.damaged || []).map(upd),
      verified: (q.verified || []).map(upd), scanned: (q.scanned || []).map(upd), delivered: (q.delivered || []).map(upd) });
    setLatest((l) => (l && l.scanId === scanId ? { ...l, damaged: d.damaged } : l));
    load();
  };
  // {scanId?, code?, label} — the packet the Damaged dialog is open for.
  const [damageFor, setDamageFor] = useState(null);
  const markDamaged = (scanId, on = true, label = "") => {
    if (!on) {
      if (!window.confirm("Take the damaged mark off this packet?")) return null;
      return mark(scanId, { damaged: false });
    }
    setDamageFor({ scanId, label });
    return null;
  };
  // A packet on the list that arrived damaged: receive it and mark it in one go.
  const receiveDamaged = (row) => setDamageFor({ code: row.awb || row.suborder_no, label: [row.sku || row.suborder_no, row.awb].filter(Boolean).join(" · ") });
  const saveDamage = async (note) => {
    const f = damageFor;
    setDamageFor(null);
    if (f?.scanId) await mark(f.scanId, { damaged: true, note });
    else if (f?.code) await record(f.code, { damaged: true, note });
  };

  const undo = async (scanId) => {
    if (!window.confirm("Undo this scan? The return goes back to “to receive”.")) return;
    const res = await fetch(`${API}/return-scan/${scanId}/`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) { window.alert("Couldn't undo that — try again."); return; }
    scans.current += 1;
    setQueue((q) => q && dropScan(q, scanId));
    setLatest((l) => (l && l.scanId === scanId ? null : l));
    load();
  };

  const today = queue?.today || todayISO();
  return { date, setDate: (d) => setPicked(d === today ? "" : d), today, queue, loading, latest, busy, record, undo, reload: load, mark, markDamaged,
    receiveDamaged, damageFor, closeDamage: () => setDamageFor(null), saveDamage };
}

// ── Live counts: the lists change the moment a scan lands; the counts follow them ──

/** The queue with one more scan in it: received now, off "to receive" / upcoming, on "in transit" if Meesho has it so. */
function addScan(q, i) {
  const row = { ...i, bucket: "scanned" };
  const scanned = [row, ...(q.scanned || []).filter((x) => x.scan_id !== i.scan_id)];
  const out = { ...q, scanned, upcoming: (q.upcoming || []).filter((x) => !i.id || x.id !== i.id) };
  const was = i.id && (q.upcoming || []).find((x) => x.id === i.id);
  if (was && q.summary) {
    // Off the way here: the server's counts (the list stops at 300) drop by one.
    const sm = q.summary;
    out.summary = { ...sm, upcoming: Math.max(0, sm.upcoming - 1), in_transit: Math.max(0, sm.in_transit - 1),
      ...(was.rto ? { upcoming_rto: Math.max(0, sm.upcoming_rto - 1) } : { upcoming_customer: Math.max(0, sm.upcoming_customer - 1) }) };
  }
  if (i.id) {
    out.items = (q.items || []).map((x) => (x.id === i.id ? { ...x, bucket: "received", scan_id: i.scan_id, received_day: i.received_day, received_at: i.received_at } : x));
    out.missing = (q.missing || []).filter((x) => x.id !== i.id);
    if (i.meesho === "in_transit" && !(q.verified || []).some((x) => x.scan_id === i.scan_id))
      out.verified = [{ ...i, bucket: "verified" }, ...(q.verified || [])];
  }
  return out;
}

function dropScan(q, scanId) {
  const gone = (x) => x.scan_id !== scanId;
  return { ...q, scanned: (q.scanned || []).filter(gone), verified: (q.verified || []).filter(gone), delivered: (q.delivered || []).filter(gone),
    damaged: (q.damaged || []).filter(gone), extra: (q.extra || []).filter(gone),
    items: (q.items || []).map((x) => (x.scan_id === scanId ? { ...x, bucket: "pending", scan_id: null, received_day: null } : x)) };
}

const blankTile = (courier) => ({ courier, expected: 0, received: 0, left: 0, scanned: 0, scanned_rto: 0, scanned_customer: 0,
  scanned_delivered: 0, scanned_in_transit: 0, tracked: 0, tracked_delivered: 0, tracked_waiting: 0 });

/** Today's numbers worked out from the lists on screen — so a scan moves them at once, before the server is asked again. */
function liveSummary(queue) {
  const s = queue?.summary;
  if (!s) return null;
  const scanned = queue.scanned || [];
  const items = queue.items || [];
  const tiles = new Map();
  const tile = (name) => {
    const k = cleanCourier(name).toLowerCase();
    if (!tiles.has(k)) tiles.set(k, blankTile(cleanCourier(name)));
    return tiles.get(k);
  };
  // Over the last weeks (the server's): received in transit, and how many Meesho has since marked delivered.
  (s.by_courier || []).forEach((c) => { if (c.tracked) Object.assign(tile(c.courier), { tracked: c.tracked, tracked_delivered: c.tracked_delivered, tracked_waiting: c.tracked_waiting }); });
  items.forEach((i) => { const t = tile(i.courier); t.expected += 1; if (i.bucket === "received") t.received += 1; else t.left += 1; });
  scanned.forEach((r) => {
    const t = tile(r.courier);
    t.scanned += 1;
    if (r.id) t[r.rto ? "scanned_rto" : "scanned_customer"] += 1;
    if (r.meesho === "delivered") t.scanned_delivered += 1;
    else if (r.meesho === "in_transit") t.scanned_in_transit += 1;
  });
  const known = scanned.filter((r) => r.id);
  const received = items.filter((i) => i.bucket === "received").length;
  return {
    ...s,
    scanned: scanned.length,
    scanned_rto: known.filter((r) => r.rto).length,
    scanned_customer: known.filter((r) => !r.rto).length,
    scanned_unknown: scanned.length - known.length,
    scanned_delivered: scanned.filter((r) => r.meesho === "delivered").length,
    scanned_in_transit: scanned.filter((r) => r.meesho === "in_transit").length,
    expected: items.length, received, left: items.length - received,
    upcoming_due: (queue.upcoming || []).filter((r) => r.due && r.due !== "later").length,
    out_for_delivery: (queue.upcoming || []).filter((r) => r.due === "out_for_delivery").length,
    verified: (queue.verified || []).length,
    missing: (queue.missing || []).length,
    by_courier: [...tiles.values()].sort((a, b) => (b.scanned + b.expected) - (a.scanned + a.expected) || b.tracked - a.tracked || a.courier.localeCompare(b.courier)),
  };
}

function rowsFor(queue, tab) {
  if (!queue) return [];
  if (tab === "received") {
    // Everything received this day, plus the sheet's own returns received earlier (before Meesho marked them delivered).
    const scanned = queue.scanned || [];
    const ids = new Set(scanned.map((r) => r.scan_id));
    return [...scanned, ...(queue.items || []).filter((i) => i.bucket === "received" && !ids.has(i.scan_id))];
  }
  if (tab === "extra") return (queue.scanned || []).filter((r) => !r.id);
  if (tab === "upcoming") return queue.upcoming || [];
  if (tab === "verified") return queue.verified || [];
  if (tab === "delivered") return queue.delivered || [];
  if (tab === "missing") return queue.missing || [];
  if (tab === "damaged") return queue.damaged || [];
  return (queue.items || []).filter((i) => i.bucket === tab);
}

// ── Pieces ────────────────────────────────────────────────────────────────────

function ReturnRow({ r, desk, compact, showBusiness }) {
  const navigate = useNavigate();
  const t = courierTone(r.courier);
  let tag;
  if (r.bucket === "scanned") tag = <ScannedTag r={r} />;
  else if (r.bucket === "delivered") tag = <Tag variant="green">✓ Received {fmtDay(r.received_day)} → delivered by {cleanCourier(r.courier)} {fmtDay(r.delivered_date)}</Tag>;
  else if (r.bucket === "received") tag = <Tag variant="green">✓ {r.received_early ? "Verified early" : "Received"} {r.received_day ? fmtDay(r.received_day) : ""}</Tag>;
  else if (r.bucket === "upcoming") {
    const due = DUE[r.due] || DUE.later;
    tag = <Tag variant={due.variant}>{due.text}{r.expected_date && r.due !== "today" ? ` · ${fmtDay(r.expected_date)}` : ""}</Tag>;
  }
  else if (r.bucket === "verified") tag = <Tag variant="blue">✓ Received {r.received_day ? fmtDay(r.received_day) : ""} · in transit on Meesho</Tag>;
  else if (r.bucket === "extra") tag = <Tag variant={r.why === "unknown" ? "red" : "blue"}>{WHY[r.why] || "Extra"}</Tag>;
  else if (r.bucket === "missing") tag = <Tag variant="red">Not received · delivered {fmtDay(r.delivered_date)}</Tag>;
  else if (r.bucket === "damaged") tag = <Tag variant="amber">⚠ Damaged · received {r.received_day ? fmtDay(r.received_day) : ""}</Tag>;
  else tag = <Tag variant="gray">To receive</Tag>;
  const label = [r.sku || r.suborder_no, r.awb].filter(Boolean).join(" · ");
  const small = { minHeight: 36, fontSize: 12.5, padding: "6px 12px", borderRadius: 10 };

  const actions = [];
  if (r.bucket === "damaged") {
    actions.push(
      <button key="rep" onClick={() => desk.mark(r.scan_id, { reported: !r.reported_at })} className="os-btn"
        style={{ ...btn(r.reported_at ? "ghost" : "primary", "sm"), ...small, ...(r.reported_at ? { color: "#15803D", borderColor: "#86EFAC" } : {}) }}>
        {r.reported_at ? `✓ Marked tampered with delivery boy · ${fmtTime(r.reported_at)}` : "🚩 Mark tampered with delivery boy"}
      </button>,
      <button key="off" onClick={() => desk.markDamaged(r.scan_id, false)} className="os-btn" style={{ ...btn("ghost", "sm"), ...small }}>Not damaged</button>,
    );
  } else if (r.scan_id) {
    actions.push(
      <button key="dmg" onClick={() => desk.markDamaged(r.scan_id, !r.damaged, label)} className="os-btn"
        style={{ ...btn("ghost", "sm"), ...small, color: "#B45309", borderColor: "#FCD34D", background: r.damaged ? "#FFFBEB" : C.white }}>
        {r.damaged ? "✕ Not damaged" : "⚠ Damaged / tampered"}
      </button>,
      <button key="undo" onClick={() => desk.undo(r.scan_id)} className="os-btn" style={{ ...btn("ghost", "sm"), ...small, color: C.gray500 }}>Undo scan</button>,
    );
  } else if ((r.bucket === "pending" || r.bucket === "missing" || r.bucket === "upcoming") && (r.awb || r.suborder_no)) {
    actions.push(
      <button key="rcv" onClick={() => desk.receiveDamaged(r)} className="os-btn"
        style={{ ...btn("ghost", "sm"), ...small, color: "#B45309", borderColor: "#FCD34D" }}>⚠ Received damaged</button>,
    );
  }

  // A return to claim for — damaged, missing, or anything received that's ours: straight to Raise Return Claim.
  if (r.id && (r.awb || r.suborder_no) && (r.damaged || ["missing", "damaged", "received", "scanned", "delivered"].includes(r.bucket))) {
    actions.push(
      <button key="claim" onClick={() => navigate(`/return-claim?code=${encodeURIComponent(r.awb || r.suborder_no)}`)} className="os-btn"
        style={{ ...btn("ghost", "sm"), ...small, color: "#1D4ED8", borderColor: "#93C5FD" }}>📨 Raise claim</button>,
    );
  }

  return (
    <div style={{ padding: compact ? "11px 12px" : "12px 16px", borderBottom: `1px solid ${C.gray100}`,
      background: r.bucket === "missing" ? C.redLight : r.damaged && r.bucket !== "damaged" ? "#FFFBEB" : C.white }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <Photo url={r.image_url} fallback={r.image_fallback_url} size={compact ? 46 : 52} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 14.5, color: C.gray900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.sku || r.suborder_no || "—"}</span>
            {r.qty ? <span style={{ fontFamily: "monospace", fontWeight: 900, fontSize: 12.5, color: C.orange, background: C.orangeLight, borderRadius: 6, padding: "1px 6px", flexShrink: 0 }}>×{r.qty}</span> : null}
            {r.id && <span style={{ fontSize: 10.5, fontWeight: 900, borderRadius: 6, padding: "0 5px", flexShrink: 0,
              color: r.rto ? "#B91C1C" : "#7C2D12", background: r.rto ? "#FEF2F2" : "#FFF7ED", border: `1px solid ${r.rto ? "#FCA5A5" : "#FDBA74"}` }}>{r.rto ? "RTO" : "Customer"}</span>}
          </div>
          <div style={{ fontSize: 12.5, color: C.gray600, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <span style={{ fontWeight: 800, color: t.fg, background: t.bg, border: `1px solid ${t.border}`, borderRadius: 6, padding: "0 6px", marginRight: 6 }}>{cleanCourier(r.courier)}</span>
            {[showBusiness && r.business_name, r.awb, r.suborder_no !== r.sku ? r.suborder_no : null].filter(Boolean).join(" · ")}
          </div>
          {r.return_reason && !compact && <div style={{ fontSize: 12, color: C.gray500, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.return_reason}</div>}
          {r.damaged && r.damage_note && <div style={{ fontSize: 12.5, color: "#92400E", marginTop: 3, fontWeight: 700 }}>⚠ {r.damage_note}</div>}
          {compact && <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 5 }}>{tag}{r.damaged && r.bucket !== "damaged" && <Tag variant="amber">⚠ Damaged</Tag>}</div>}
        </div>
        {!compact && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", flexShrink: 0 }}>
            {tag}
            {r.damaged && r.bucket !== "damaged" && <Tag variant="amber">⚠ Damaged</Tag>}
            {actions.length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>{actions}</div>}
          </div>
        )}
      </div>
      {compact && actions.length > 0 && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8, paddingLeft: 58 }}>{actions}</div>}
    </div>
  );
}

/** A parcel received this day: when, and where Meesho has it — delivered back by the courier, or still in transit. */
function ScannedTag({ r }) {
  const at = r.received_at ? fmtTime(r.received_at) : "";
  if (!r.id) return <Tag variant="red">Not recognised · keep aside{at ? ` · ${at}` : ""}</Tag>;
  let meesho;
  if (r.meesho === "delivered") {
    meesho = r.on_list || !r.delivered_date ? <Tag variant="green">Delivered · {cleanCourier(r.courier)}</Tag>
      : <Tag variant="amber">Delivered {fmtDay(r.delivered_date)} on Meesho</Tag>;
  } else if (r.meesho === "in_transit") meesho = <Tag variant="blue">In transit on Meesho</Tag>;
  else meesho = <Tag variant="red">Meesho: {r.meesho}</Tag>;
  return <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}><Tag variant="green">✓ Received {at}</Tag>{meesho}</span>;
}

const NOTES = ["Tape cut / resealed", "Packet torn", "Opened / tampered", "Wet", "Item missing", "Wrong item inside", "Crushed"];

/** Mark a packet damaged / tampered — quick reasons, or a note of one's own. */
function DamageDialog({ desk }) {
  const f = desk.damageFor;
  const [picked, setPicked] = useState([]);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { setPicked([]); setText(""); setSaving(false); }, [f]);
  if (!f) return null;
  const note = [...picked, text.trim()].filter(Boolean).join(", ");
  const save = async () => { setSaving(true); await desk.saveDamage(note); };
  const toggle = (n) => setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n]));
  return (
    <div role="dialog" aria-modal="true" aria-label="Packet damaged or tampered" onClick={saving ? undefined : desk.closeDamage}
      style={{ position: "fixed", inset: 0, zIndex: 5000, background: "rgba(15,23,42,.55)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: C.white, width: "100%", maxWidth: 520, borderRadius: "18px 18px 0 0", padding: "18px 16px calc(16px + env(safe-area-inset-bottom))",
          display: "flex", flexDirection: "column", gap: 12, borderTop: "6px solid #F59E0B", maxHeight: "90dvh", overflowY: "auto", boxSizing: "border-box" }}>
        <div style={{ fontSize: 18, fontWeight: 900, color: "#92400E" }}>⚠ Packet damaged / tampered</div>
        {f.label && <div style={{ fontFamily: "monospace", fontSize: 13.5, fontWeight: 700, color: C.gray700, wordBreak: "break-all" }}>{f.label}</div>}
        <div style={{ fontSize: 13, color: C.gray600 }}>
          {f.scanId ? "" : "It is received now and marked damaged. "}It shows on the <b>Damaged</b> tab, to raise with the delivery boy in the evening.
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {NOTES.map((n) => {
            const on = picked.includes(n);
            return (
              <button key={n} onClick={() => toggle(n)} aria-pressed={on} className="os-btn"
                style={{ minHeight: 40, padding: "8px 12px", borderRadius: 999, fontFamily: "inherit", fontSize: 13.5, fontWeight: 700, cursor: "pointer",
                  border: `1.5px solid ${on ? "#D97706" : C.gray200}`, background: on ? "#FEF3C7" : C.white, color: on ? "#92400E" : C.gray700 }}>
                {on ? "✓ " : ""}{n}
              </button>
            );
          })}
        </div>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Anything else (optional)" aria-label="Note"
          onKeyDown={(e) => { if (e.key === "Enter") save(); }} className="os-in" style={{ ...S.inp, minHeight: 46, fontSize: 15 }} />
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={desk.closeDamage} disabled={saving} className="os-btn" style={{ ...btn("ghost", "md"), flex: 1, minHeight: 50 }}>Cancel</button>
          <button onClick={save} disabled={saving} className="os-btn"
            style={{ ...btn("primary", "md"), flex: 2, minHeight: 50, background: "#D97706", borderColor: "#D97706", fontSize: 15.5 }}>
            {saving ? "Saving…" : "⚠ Mark damaged"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * One card per courier: received at the desk this day (RTO / customer), where
 * Meesho has those (delivered or still in transit), the Delivered sheet's own
 * count, and — over the last weeks — returns received in transit that the
 * courier has since marked delivered.
 */
function CourierCards({ couriers, active, onPick, compact }) {
  if (!couriers?.length) return null;
  const line = (color, text) => <span style={{ fontSize: 12, fontWeight: 700, color, lineHeight: 1.35 }}>{text}</span>;
  return (
    <div style={{ display: "grid", gap: compact ? 8 : 10, gridTemplateColumns: compact ? "repeat(2, minmax(0, 1fr))" : "repeat(auto-fill, minmax(200px, 1fr))" }}>
      {couriers.map((c) => {
        const t = courierTone(c.courier);
        const on = active === c.courier;
        const done = c.expected > 0 && c.left === 0;
        return (
          <button key={c.courier} onClick={() => onPick(on ? null : c.courier)} aria-pressed={on} className="os-btn"
            style={{ textAlign: "left", cursor: "pointer", fontFamily: "inherit", minWidth: 0, background: on ? t.bg : C.white,
              border: `2px solid ${on ? t.solid : t.border}`, borderTop: `6px solid ${t.solid}`, borderRadius: 14,
              padding: compact ? "8px 12px 10px" : "10px 14px 12px", display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: compact ? 13 : 14, fontWeight: 900, color: t.fg, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.courier}</span>
            <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ fontFamily: "monospace", fontWeight: 900, fontSize: compact ? 32 : 36, lineHeight: 1, color: C.gray900 }}>{c.scanned}</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: C.gray500 }}>received</span>
            </span>
            {c.scanned > 0 && (c.scanned_rto + c.scanned_customer) > 0 && line(C.gray700, `${c.scanned_rto} RTO · ${c.scanned_customer} customer`)}
            {c.scanned > 0 && (c.scanned_delivered > 0 || c.scanned_in_transit > 0) && line(C.gray600,
              [c.scanned_delivered && `${c.scanned_delivered} delivered`, c.scanned_in_transit && `${c.scanned_in_transit} in transit`].filter(Boolean).join(" · ") + " on Meesho")}
            {c.expected > 0 && line(done ? "#15803D" : C.red, done ? `✓ Sheet: all ${c.expected} received` : `Sheet: ${c.received}/${c.expected} · ${c.left} to receive`)}
            {c.tracked > 0 && line("#7C3AED", `Received in transit: ${c.tracked_delivered}/${c.tracked} delivered since`)}
          </button>
        );
      })}
    </div>
  );
}

/** The day in two lines: everything received (RTO / customer, where Meesho has it), then the Delivered sheet's check. */
function MatchLine({ s }) {
  const done = s.expected > 0 && s.left === 0;
  const pct = s.expected ? Math.min(100, (s.received / s.expected) * 100) : 0;
  const chip = (bg, fg, text) => <span style={{ background: bg, color: fg, borderRadius: 999, padding: "2px 9px", fontSize: 12.5, fontWeight: 800, whiteSpace: "nowrap" }}>{text}</span>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: C.gray800, marginRight: 4 }}>
          <span style={{ fontFamily: "monospace", fontSize: 26, color: C.gray900 }}>{s.scanned}</span>
          <span style={{ color: C.gray500 }}> received</span>
        </span>
        {chip("#FEF2F2", "#B91C1C", `${s.scanned_rto} RTO`)}
        {chip("#FFF7ED", "#9A3412", `${s.scanned_customer} customer return`)}
        {s.scanned_unknown > 0 && chip(C.gray100, C.gray700, `${s.scanned_unknown} not recognised`)}
        {s.scanned_in_transit > 0 && chip("#EFF6FF", "#1D4ED8", `${s.scanned_in_transit} still in transit on Meesho`)}
      </div>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "baseline", fontSize: 13, fontWeight: 700 }}>
          <span style={{ color: C.gray600 }}>
            Delivered sheet: <b style={{ color: C.gray900 }}>{s.received}</b> of {s.expected} received
            {s.expected > 0 && <span style={{ color: C.gray500, fontWeight: 600 }}> · {s.rto} RTO · {s.customer} customer</span>}
          </span>
          <span style={{ fontWeight: 800, color: s.expected === 0 ? C.gray500 : done ? C.green : C.orange }}>
            {s.expected === 0 ? "No sheet for this day" : done ? "✓ Matches the sheet" : `${s.left} still to receive`}
          </span>
        </div>
        <div role="progressbar" aria-valuemin={0} aria-valuemax={s.expected} aria-valuenow={s.received} aria-label="Delivered sheet received"
          style={{ height: 8, borderRadius: 99, background: C.gray100, overflow: "hidden", marginTop: 6 }}>
          <div style={{ height: "100%", width: `${pct}%`, background: C.green, borderRadius: 99, transition: "width .25s" }} />
        </div>
      </div>
    </div>
  );
}

function MissingBanner({ n, onOpen, compact }) {
  if (!n) return null;
  return (
    <button onClick={onOpen} className="os-btn" style={{ textAlign: "left", cursor: "pointer", fontFamily: "inherit", background: C.redLight,
      border: `1.5px solid ${C.redBorder}`, borderRadius: 12, padding: compact ? "8px 12px" : "10px 14px", color: C.red, display: "flex", gap: 10, alignItems: "center" }}>
      <span style={{ fontSize: 18 }}>⚠️</span>
      <span style={{ flex: 1, fontSize: 13, fontWeight: 800 }}>{n} return{n === 1 ? "" : "s"} delivered on earlier days never received — check, raise a claim</span>
      <span style={{ fontSize: 12.5, fontWeight: 800 }}>View →</span>
    </button>
  );
}

const sameCourier = (a, b) => cleanCourier(a).toLowerCase() === cleanCourier(b).toLowerCase();

function useDeskView(queue) {
  const [tab, setTab] = useState("received");
  const [courier, setCourier] = useState(null);
  const counts = useMemo(() => {
    const out = {};
    TABS.forEach((t) => { out[t.key] = rowsFor(queue, t.key).filter((r) => !courier || sameCourier(r.courier, courier)).length; });
    return out;
  }, [queue, courier]);
  const shown = rowsFor(queue, tab).filter((r) => !courier || sameCourier(r.courier, courier));
  const summary = useMemo(() => liveSummary(queue), [queue]);
  return { tab, setTab, courier, setCourier, counts, shown, summary };
}

function DaySelect({ desk, style }) {
  const dates = [...new Set([desk.date, ...(desk.queue?.dates || [])])].filter(Boolean).sort().reverse();
  return (
    <select value={desk.date} onChange={(e) => desk.setDate(e.target.value)} aria-label="Day" className="os-in" style={style}>
      {dates.map((d) => <option key={d} value={d}>{dayName(d, desk.today)}</option>)}
    </select>
  );
}

const EMPTY = {
  pending: "Every return on the sheet for this day is received. 🎉",
  received: "Nothing received yet for this day — scan a returned parcel.",
  extra: "Every parcel scanned is a return of ours.",
  upcoming: "No returns on the way — everything Meesho shows in transit is received.",
  verified: "Nothing waiting on Meesho — every return received is marked delivered.",
  delivered: "None yet — returns received while still in transit show here once Meesho marks them delivered.",
  missing: "No returns missing. 🎉",
  damaged: "No damaged packets.",
};

/** Under the latest scan: flag the packet just scanned as damaged / tampered. */
function DamageLatest({ desk, dark }) {
  const l = desk.latest;
  if (!l?.scanId || desk.busy) return null;
  const base = { width: "100%", minHeight: 50, borderRadius: 12, fontFamily: "inherit", fontSize: 15.5, fontWeight: 800, cursor: "pointer" };
  return l.damaged ? (
    <button onClick={() => desk.markDamaged(l.scanId, false)} className="os-btn"
      style={{ ...base, background: dark ? "rgba(245,158,11,.18)" : "#FFFBEB", color: dark ? "#FCD34D" : "#92400E", border: "2px solid #F59E0B" }}>
      ⚠ Marked damaged — tap to undo</button>
  ) : (
    <button onClick={() => desk.markDamaged(l.scanId, true, l.label)} className="os-btn"
      style={{ ...base, background: "#F59E0B", color: "#1F1300", border: "2px solid #D97706" }}>⚠ Packet damaged / tampered</button>
  );
}

/** Returns Meesho shows out for delivery or due — scan them as the delivery boy hands them over. */
function UpcomingBanner({ s, onOpen, compact }) {
  if (!s?.upcoming_due) return null;
  return (
    <button onClick={onOpen} className="os-btn" style={{ textAlign: "left", cursor: "pointer", fontFamily: "inherit", background: "#ECFEFF",
      border: "1.5px solid #67E8F9", borderRadius: 12, padding: compact ? "8px 12px" : "10px 14px", color: "#155E75", display: "flex", gap: 10, alignItems: "center" }}>
      <span style={{ fontSize: 18 }}>🛵</span>
      <span style={{ flex: 1, fontSize: 13, fontWeight: 800 }}>
        {s.upcoming_due} upcoming return{s.upcoming_due === 1 ? "" : "s"} due{s.out_for_delivery ? ` (${s.out_for_delivery} out for delivery)` : ""}{s.upcoming_rto != null ? ` · ${s.upcoming_rto} RTO, ${s.upcoming_customer} customer on the way` : ""} — scan each as it's handed over
      </span>
      <span style={{ fontSize: 12.5, fontWeight: 800 }}>View →</span>
    </button>
  );
}

/** Damaged packets not yet raised with the delivery boy — the evening's list. */
function DamagedBanner({ n, onOpen, compact }) {
  if (!n) return null;
  return (
    <button onClick={onOpen} className="os-btn" style={{ textAlign: "left", cursor: "pointer", fontFamily: "inherit", background: "#FFFBEB",
      border: "1.5px solid #FCD34D", borderRadius: 12, padding: compact ? "8px 12px" : "10px 14px", color: "#92400E", display: "flex", gap: 10, alignItems: "center" }}>
      <span style={{ fontSize: 18 }}>🚩</span>
      <span style={{ flex: 1, fontSize: 13, fontWeight: 800 }}>{n} damaged packet{n === 1 ? "" : "s"} to mark tampered with the delivery boy</span>
      <span style={{ fontSize: 12.5, fontWeight: 800 }}>View →</span>
    </button>
  );
}

// ── Phone ─────────────────────────────────────────────────────────────────────

function MobileDesk({ desk, businesses, onScopeChanged, multi }) {
  const { queue, loading, latest, busy, record } = desk;
  const v = useDeskView(queue);
  const [camera, setCamera] = useState(false);
  const [typed, setTyped] = useState("");
  const s = v.summary;
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);
  const submit = () => { if (typed.trim()) { record(typed); setTyped(""); } };

  return (
    <div className="os-desk" style={{ position: "fixed", inset: 0, zIndex: 3000, background: C.gray50, display: "flex", flexDirection: "column",
      height: "100dvh", paddingTop: "env(safe-area-inset-top)" }}>
      <style>{DESK_CSS}</style>
      <DamageDialog desk={desk} />
      {camera && (
        <BarcodeScanner continuous title="Receive returns" hint="Scan each returned parcel — delivered or still upcoming — keep scanning"
          progress={s ? { done: s.scanned, total: s.scanned + s.left + s.upcoming_due, label: `Received · ${s.scanned_rto} RTO · ${s.scanned_customer} customer` } : null}
          latest={latest} busy={busy} onDetected={(code) => record(code)} onClose={() => setCamera(false)}
          latestAction={<DamageLatest desk={desk} dark />} />
      )}
      <div style={{ padding: "6px 10px", display: "flex", alignItems: "center", gap: 6, background: C.white, borderBottom: `1px solid ${C.gray200}`, flexShrink: 0 }}>
        <button onClick={() => window.dispatchEvent(new Event("app:open-menu"))} aria-label="Menu — other tabs" className="os-btn"
          style={{ background: "none", border: "none", width: 44, height: 44, cursor: "pointer", lineHeight: 0, color: C.gray700, flexShrink: 0 }}>
          <MenuIcon />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 900, color: C.gray900, whiteSpace: "nowrap" }}>Receive returns</div>
          <DaySelect desk={desk} style={{ border: "none", background: "none", fontSize: 12.5, color: C.gray600, fontWeight: 700, padding: 0, fontFamily: "inherit", maxWidth: "100%" }} />
        </div>
        <DeskBusinesses desk={businesses} onChanged={onScopeChanged} compact />
      </div>
      <div style={{ padding: "8px 10px", background: C.white, borderBottom: `1px solid ${C.gray200}`, flexShrink: 0 }}>
        <LatestPanel latest={latest} busy={busy} minHeight={76} idle="Scan a returned parcel — the result shows here." />
        {latest?.scanId && !busy && <div style={{ marginTop: 8 }}><DamageLatest desk={desk} /></div>}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 10 }}>
          {loading && !queue ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 24 }}><CircularProgress style={{ color: C.orange }} /></div>
          ) : (
            <>
              <DamagedBanner n={s?.damaged_unreported} onOpen={() => v.setTab("damaged")} compact />
              <UpcomingBanner s={s} onOpen={() => v.setTab("upcoming")} compact />
              <MissingBanner n={s?.missing} onOpen={() => v.setTab("missing")} compact />
              <CourierCards couriers={s?.by_courier} active={v.courier} onPick={v.setCourier} compact />
              <div style={{ background: C.white, border: `1px solid ${C.gray200}`, borderRadius: 16, padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
                {s && <MatchLine s={s} />}
                <StatTabs tabs={TABS} tab={v.tab} onPick={v.setTab} counts={v.counts} tones={TONES} compact columns={4} />
                {v.courier && (
                  <button onClick={() => v.setCourier(null)} className="os-btn" style={{ ...btn("ghostOrange", "sm"), alignSelf: "flex-start", minHeight: 36 }}>🚚 {v.courier} · all couriers ✕</button>
                )}
              </div>
            </>
          )}
        </div>
        <div style={{ background: C.white, borderTop: `1px solid ${C.gray200}` }}>
          {v.shown.length === 0
            ? <div style={{ textAlign: "center", padding: 36, color: C.gray500, fontSize: 14 }}>{(s?.expected || v.tab !== "pending") ? EMPTY[v.tab] : "No returns on the Delivered sheet for this day — upload it on Returns & Claims."}</div>
            : v.shown.map((r) => <ReturnRow key={`${r.id}-${r.scan_id}`} r={r} compact showBusiness={multi} desk={desk} />)}
        </div>
      </div>
      <div style={{ flexShrink: 0, padding: "8px 10px calc(8px + env(safe-area-inset-bottom))", borderTop: `1px solid ${C.gray200}`, background: C.white, display: "flex", flexDirection: "column", gap: 8 }}>
        <button onClick={() => setCamera(true)} className="os-btn" style={{ ...btn("primary", "lg"), minHeight: 56, fontSize: 18, borderRadius: 14, width: "100%" }}>
          <QrCodeScannerIcon style={{ fontSize: 26, verticalAlign: "-7px" }} />&nbsp;Scan return
        </button>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type AWB / sub-order no" aria-label="Type an AWB or sub-order number"
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }} enterKeyHint="go" autoComplete="off" className="os-in"
          style={{ ...S.inp, fontFamily: "monospace", minHeight: 48, fontSize: 15 }} />
      </div>
    </div>
  );
}

// ── Desktop ───────────────────────────────────────────────────────────────────

function DesktopDesk({ desk, businesses, onScopeChanged, multi }) {
  const { queue, loading, latest, busy, record, reload } = desk;
  const v = useDeskView(queue);
  const [scan, setScan] = useState("");
  const input = useRef(null);
  const refocus = useCallback(() => setTimeout(() => input.current?.focus(), 0), []);
  useEffect(() => { refocus(); }, [refocus]);
  const s = v.summary;
  const submit = async () => { const code = scan.trim(); if (!code) return; setScan(""); await record(code); refocus(); };

  return (
    <div className="os-desk" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <style>{DESK_CSS}</style>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: C.gray900, margin: 0 }}>Return scan</h1>
          <p style={{ fontSize: 13, color: C.gray500, marginTop: 3 }}>
            Scan every returned parcel as it's handed over — it counts at once. One Meesho still shows in transit waits under In transit until the courier marks it delivered. Refreshes by itself.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <DeskBusinesses desk={businesses} onChanged={onScopeChanged} />
          <DaySelect desk={desk} style={{ ...S.inp, width: "auto", fontWeight: 700 }} />
        </div>
      </div>
      <DamageDialog desk={desk} />
      <DamagedBanner n={s?.damaged_unreported} onOpen={() => v.setTab("damaged")} />
      <UpcomingBanner s={s} onOpen={() => { v.setTab("upcoming"); refocus(); }} />
      <MissingBanner n={s?.missing} onOpen={() => { v.setTab("missing"); refocus(); }} />
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(360px, 420px)", gap: 20, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <div style={{ ...S.card, padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
            <span style={{ fontSize: 13.5, fontWeight: 800, color: C.gray800 }}>Received by courier · {fmtDay(desk.date)}</span>
            {s?.by_courier?.length
              ? <CourierCards couriers={s.by_courier} active={v.courier} onPick={(c) => { v.setCourier(c); refocus(); }} />
              : <div style={{ fontSize: 13, color: C.gray500 }}>Nothing received yet for {fmtDay(desk.date)}, and no Delivered sheet for it — scan a returned parcel.</div>}
            {s && <MatchLine s={s} />}
          </div>
          <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
            <div style={{ padding: 14, borderBottom: `1px solid ${C.gray100}`, display: "flex", flexDirection: "column", gap: 10 }}>
              <StatTabs tabs={TABS} tab={v.tab} onPick={(k) => { v.setTab(k); refocus(); }} counts={v.counts} tones={TONES} />
              <div style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 32 }}>
                {v.courier
                  ? <button onClick={() => v.setCourier(null)} className="os-btn" style={btn("ghostOrange", "sm")}>🚚 {v.courier} · all couriers ✕</button>
                  : <span style={{ fontSize: 12.5, color: C.gray500 }}>Showing {v.shown.length} · all couriers</span>}
                <button onClick={() => { reload(); refocus(); }} className="os-btn" style={{ ...btn("ghost", "sm"), marginLeft: "auto" }}>
                  <RefreshIcon style={{ fontSize: 15, verticalAlign: "-3px" }} />&nbsp;Refresh
                </button>
              </div>
            </div>
            {loading && !queue
              ? <div style={{ display: "flex", justifyContent: "center", padding: 44 }}><CircularProgress style={{ color: C.orange }} /></div>
              : v.shown.length === 0
                ? <div style={{ textAlign: "center", padding: 44, color: C.gray500, fontSize: 14 }}>{EMPTY[v.tab]}</div>
                : v.shown.map((r) => <ReturnRow key={`${r.id}-${r.scan_id}`} r={r} showBusiness={multi} desk={desk} />)}
          </div>
        </div>
        <div style={{ position: "sticky", top: 12 }}>
          <div style={{ ...S.card, padding: 18, borderTop: `4px solid ${C.orange}`, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.gray900 }}>Scan a returned parcel</div>
            <div style={{ position: "relative" }}>
              <QrCodeScannerIcon aria-hidden style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: C.orange, fontSize: 26 }} />
              <input ref={input} value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                onBlur={(e) => { if (!e.relatedTarget) refocus(); }}
                placeholder="Scan or type AWB / sub-order…" aria-label="Scan or type an AWB or sub-order number" autoComplete="off" spellCheck={false} className="os-in"
                style={{ ...S.inp, width: "100%", boxSizing: "border-box", fontSize: 20, fontFamily: "monospace", fontWeight: 700,
                  padding: "16px 16px 16px 52px", background: C.orangeLight, borderColor: C.orangeBorder }} />
            </div>
            <LatestPanel latest={latest} busy={busy} minHeight={150} idle="Scan a returned parcel — whether it's on the day's sheet shows here." />
            <DamageLatest desk={desk} />
            {s && (
              <div style={{ fontSize: 12.5, color: C.gray500, lineHeight: 1.6 }}>
                Received: <b style={{ color: C.gray800 }}>{s.scanned}</b> ({s.scanned_rto} RTO · {s.scanned_customer} customer{s.scanned_unknown ? ` · ${s.scanned_unknown} not recognised` : ""})
                {s.damaged ? <> · damaged <b style={{ color: "#B45309" }}>{s.damaged}</b>{s.damaged_unreported ? ` (${s.damaged_unreported} to raise with delivery boys)` : ""}</> : null}
                <br />Upcoming: <b style={{ color: C.gray800 }}>{s.upcoming}</b>{s.out_for_delivery ? <> (<b>{s.out_for_delivery}</b> out for delivery)</> : null}
                {" "}· received, in transit on Meesho: <b style={{ color: "#7C3AED" }}>{s.verified}</b>
                {s.tracked_delivered ? <> · delivered since: <b style={{ color: "#15803D" }}>{s.tracked_delivered}</b></> : null}
                <br />Missing earlier: <b style={{ color: s.missing ? C.red : C.gray800 }}>{s.missing}</b>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ReturnDeskTab() {
  const isMobile = useIsMobile();
  const desk = useReturnDesk();
  const businesses = useDeskBusinesses();
  const onScopeChanged = () => desk.reload();
  const props = { desk, businesses, onScopeChanged, multi: (businesses.info?.selected?.length || 0) > 1 };
  return isMobile ? <MobileDesk {...props} /> : <DesktopDesk {...props} />;
}
