import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
 */

const TABS = [
  { key: "pending",    label: "To receive" },
  { key: "received",   label: "Received" },
  { key: "extra",      label: "Extra" },
  { key: "in_transit", label: "In transit" },
  { key: "missing",    label: "Missing" },
  { key: "damaged",    label: "Damaged" },
];
const TONES = { pending: C.orange, received: C.green, extra: "#2563EB", in_transit: "#0891B2", missing: C.red, damaged: "#B45309" };
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
  const timer = useRef(null);
  const date = picked || queue?.date || "";

  const load = useCallback(async () => {
    const p = new URLSearchParams();
    if (picked) p.set("date", picked);
    try {
      const res = await fetch(`${API}/return-scan/queue/?${p}`);
      if (res.ok) setQueue(await res.json());
    } finally { setLoading(false); }
  }, [picked]);
  useEffect(() => { setLoading(true); setLatest(null); load(); }, [load]);
  const reloadSoon = useCallback(() => { clearTimeout(timer.current); timer.current = setTimeout(load, 1200); }, [load]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const record = async (raw, extra = {}) => {
    const code = (raw ?? "").trim();
    if (!code) return null;
    setBusy(true);
    const my = ++seq.current;
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
        out = { kind: "err", title: "NOT RECOGNISED — keep aside", lines: [code, "No return of any business here matches this code — it may not be ours."],
          scanId: d.item?.scan_id, damaged: d.item?.damaged, label: code };
        navigator.vibrate?.([120, 80, 120]);
      } else {
        const i = d.item;
        const lines = [`${i.sku || i.suborder_no} × ${i.qty || 1}`, [i.courier, i.rto ? "RTO" : "Customer return", i.business_name].filter(Boolean).join(" · ")];
        if (i.return_reason) lines.push(i.return_reason);
        let kind = "ok"; let title = "Received";
        if (d.already_scanned) { kind = "warn"; title = `Already received · ${fmtDay(i.received_day)}`; }
        else if (d.where === "in_transit") { kind = "warn"; title = "Received · arrived early"; lines.push(`Sheet still shows it in transit${i.expected_date ? ` (expected ${fmtDay(i.expected_date)})` : ""}.`); }
        else if (d.where === "earlier") { kind = "warn"; title = `Received · from ${fmtDay(i.delivered_date)}'s list`; }
        else if (d.where === "later") { kind = "warn"; title = "Received · not on this day's list"; lines.push(`Sheet says delivered ${fmtDay(i.delivered_date)}.`); }
        out = { kind, title, lines, image_url: i.image_url, image_fallback_url: i.image_fallback_url, scanId: i.scan_id, damaged: i.damaged,
          label: [i.sku || i.suborder_no, i.awb].filter(Boolean).join(" · ") };
        setQueue((q) => q && { ...q, items: q.items.map((x) => (x.id === i.id ? { ...x, bucket: "received", scan_id: i.scan_id, received_day: i.received_day } : x)) });
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
    setQueue((q) => q && { ...q, items: q.items.map(upd), extra: (q.extra || []).map(upd), damaged: (q.damaged || []).map(upd) });
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
    await fetch(`${API}/return-scan/${scanId}/`, { method: "DELETE" });
    load();
  };

  const today = queue?.today || todayISO();
  return { date, setDate: (d) => setPicked(d === today ? "" : d), today, queue, loading, latest, busy, record, undo, reload: load, mark, markDamaged,
    receiveDamaged, damageFor, closeDamage: () => setDamageFor(null), saveDamage };
}

function rowsFor(queue, tab) {
  if (!queue) return [];
  if (tab === "extra") return queue.extra || [];
  if (tab === "in_transit") return queue.in_transit || [];
  if (tab === "missing") return queue.missing || [];
  if (tab === "damaged") return queue.damaged || [];
  return (queue.items || []).filter((i) => i.bucket === tab);
}

// ── Pieces ────────────────────────────────────────────────────────────────────

function ReturnRow({ r, desk, compact, showBusiness }) {
  const t = courierTone(r.courier);
  let tag;
  if (r.bucket === "received") tag = <Tag variant="green">✓ Received {r.received_day ? fmtDay(r.received_day) : ""}</Tag>;
  else if (r.bucket === "extra") tag = <Tag variant={r.why === "unknown" ? "red" : "blue"}>{WHY[r.why] || "Extra"}</Tag>;
  else if (r.bucket === "in_transit") tag = <Tag variant="blue">🚚 {r.transit_status || "In transit"}{r.expected_date ? ` · exp. ${fmtDay(r.expected_date)}` : ""}</Tag>;
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
  } else if ((r.bucket === "pending" || r.bucket === "missing" || r.bucket === "in_transit") && (r.awb || r.suborder_no)) {
    actions.push(
      <button key="rcv" onClick={() => desk.receiveDamaged(r)} className="os-btn"
        style={{ ...btn("ghost", "sm"), ...small, color: "#B45309", borderColor: "#FCD34D" }}>⚠ Received damaged</button>,
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

/** One card per courier: received against what the sheet says came back, and how many are left. */
function CourierCards({ couriers, active, onPick, compact }) {
  if (!couriers?.length) return null;
  return (
    <div style={{ display: "grid", gap: compact ? 8 : 10, gridTemplateColumns: compact ? "repeat(2, minmax(0, 1fr))" : "repeat(auto-fill, minmax(190px, 1fr))" }}>
      {couriers.map((c) => {
        const t = courierTone(c.courier);
        const on = active === c.courier;
        const done = c.expected > 0 && c.left === 0;
        return (
          <button key={c.courier} onClick={() => onPick(on ? null : c.courier)} aria-pressed={on} className="os-btn"
            style={{ textAlign: "left", cursor: "pointer", fontFamily: "inherit", minWidth: 0, background: on ? t.bg : C.white,
              border: `2px solid ${on ? t.solid : t.border}`, borderTop: `6px solid ${t.solid}`, borderRadius: 14,
              padding: compact ? "8px 12px 10px" : "10px 14px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: compact ? 13 : 14, fontWeight: 900, color: t.fg, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.courier}</span>
            <span style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
              <span style={{ fontFamily: "monospace", fontWeight: 900, fontSize: compact ? 32 : 36, lineHeight: 1, color: C.gray900 }}>{c.received}</span>
              <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 16, color: C.gray400 }}>/ {c.expected}</span>
            </span>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: done ? "#15803D" : c.expected ? C.red : C.gray500 }}>
              {c.expected === 0 ? "None on the sheet" : done ? "✓ all received" : `${c.left} not received yet`}
            </span>
            {c.extra > 0 && <span style={{ fontSize: 12, fontWeight: 700, color: "#2563EB" }}>+{c.extra} extra received</span>}
          </button>
        );
      })}
    </div>
  );
}

function MatchLine({ s }) {
  const done = s.expected > 0 && s.left === 0;
  const pct = s.expected ? Math.min(100, (s.received / s.expected) * 100) : 0;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: C.gray800 }}>
          <span style={{ fontFamily: "monospace", fontSize: 22, color: C.gray900 }}>{s.received}</span>
          <span style={{ color: C.gray500 }}> of {s.expected} returns received</span>
          <span style={{ color: C.gray500, fontWeight: 600, fontSize: 12.5 }}> · {s.rto} RTO · {s.customer} customer</span>
        </span>
        <span style={{ fontSize: 14, fontWeight: 800, color: s.expected === 0 ? C.gray500 : done ? C.green : C.orange }}>
          {s.expected === 0 ? "Nothing on the sheet for this day" : done ? "✓ Matches the sheet" : `${s.left} still to receive`}
        </span>
      </div>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={s.expected} aria-valuenow={s.received} aria-label="Returns received"
        style={{ height: 10, borderRadius: 99, background: C.gray100, overflow: "hidden", marginTop: 8 }}>
        <div style={{ height: "100%", width: `${pct}%`, background: C.green, borderRadius: 99, transition: "width .25s" }} />
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
  const [tab, setTab] = useState("pending");
  const [courier, setCourier] = useState(null);
  const counts = useMemo(() => {
    const out = {};
    TABS.forEach((t) => { out[t.key] = rowsFor(queue, t.key).filter((r) => !courier || sameCourier(r.courier, courier)).length; });
    return out;
  }, [queue, courier]);
  const shown = rowsFor(queue, tab).filter((r) => !courier || sameCourier(r.courier, courier));
  return { tab, setTab, courier, setCourier, counts, shown };
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
  received: "Nothing received yet for this day.",
  extra: "No extra parcels.",
  in_transit: "Nothing due from the In-transit sheet.",
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
  const s = queue?.summary;
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
        <BarcodeScanner continuous title="Receive returns" hint="Scan the label on each returned parcel — keep scanning"
          progress={{ done: s?.received ?? 0, total: s?.expected ?? 0, label: "Received" }}
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
              <MissingBanner n={s?.missing} onOpen={() => v.setTab("missing")} compact />
              <CourierCards couriers={s?.by_courier} active={v.courier} onPick={v.setCourier} compact />
              <div style={{ background: C.white, border: `1px solid ${C.gray200}`, borderRadius: 16, padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
                {s && <MatchLine s={s} />}
                <StatTabs tabs={TABS} tab={v.tab} onPick={v.setTab} counts={v.counts} tones={TONES} compact columns={3} />
                {v.courier && (
                  <button onClick={() => v.setCourier(null)} className="os-btn" style={{ ...btn("ghostOrange", "sm"), alignSelf: "flex-start", minHeight: 36 }}>🚚 {v.courier} · all couriers ✕</button>
                )}
              </div>
            </>
          )}
        </div>
        <div style={{ background: C.white, borderTop: `1px solid ${C.gray200}` }}>
          {v.shown.length === 0
            ? <div style={{ textAlign: "center", padding: 36, color: C.gray500, fontSize: 14 }}>{(queue?.summary?.expected || v.tab !== "pending") ? EMPTY[v.tab] : "No returns on the Delivered sheet for this day — upload it on Returns & Claims."}</div>
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
  const s = queue?.summary;
  const submit = async () => { const code = scan.trim(); if (!code) return; setScan(""); await record(code); refocus(); };

  return (
    <div className="os-desk" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <style>{DESK_CSS}</style>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: C.gray900, margin: 0 }}>Return scan</h1>
          <p style={{ fontSize: 13, color: C.gray500, marginTop: 3 }}>
            Scan every returned parcel — the day must match the Delivered sheet uploaded on Returns &amp; Claims.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <DeskBusinesses desk={businesses} onChanged={onScopeChanged} />
          <DaySelect desk={desk} style={{ ...S.inp, width: "auto", fontWeight: 700 }} />
        </div>
      </div>
      <DamageDialog desk={desk} />
      <DamagedBanner n={s?.damaged_unreported} onOpen={() => v.setTab("damaged")} />
      <MissingBanner n={s?.missing} onOpen={() => { v.setTab("missing"); refocus(); }} />
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(360px, 420px)", gap: 20, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <div style={{ ...S.card, padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
            <span style={{ fontSize: 13.5, fontWeight: 800, color: C.gray800 }}>Received by courier · {fmtDay(desk.date)}</span>
            {s?.by_courier?.length
              ? <CourierCards couriers={s.by_courier} active={v.courier} onPick={(c) => { v.setCourier(c); refocus(); }} />
              : <div style={{ fontSize: 13, color: C.gray500 }}>No returns on the Delivered sheet for {fmtDay(desk.date)} — upload it on Returns &amp; Claims.</div>}
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
                Received today: <b style={{ color: C.gray800 }}>{s.received_today}</b>{s.extra ? <> · extra <b style={{ color: "#2563EB" }}>{s.extra}</b></> : null}
                {s.damaged ? <> · damaged <b style={{ color: "#B45309" }}>{s.damaged}</b>{s.damaged_unreported ? ` (${s.damaged_unreported} to raise with delivery boys)` : ""}</> : null}
                <br />In transit (due): <b style={{ color: C.gray800 }}>{s.in_transit}</b> · missing earlier: <b style={{ color: s.missing ? C.red : C.gray800 }}>{s.missing}</b>
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
