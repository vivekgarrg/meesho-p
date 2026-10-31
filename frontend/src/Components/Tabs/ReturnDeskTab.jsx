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
];
const TONES = { pending: C.orange, received: C.green, extra: "#2563EB", in_transit: "#0891B2", missing: C.red };
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

  const record = async (raw) => {
    const code = (raw ?? "").trim();
    if (!code) return null;
    setBusy(true);
    const my = ++seq.current;
    try {
      const res = await fetch(`${API}/return-scan/`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, day: picked || undefined }),
      });
      const d = await res.json().catch(() => ({}));
      let out;
      if (!res.ok) {
        out = { kind: "err", title: "Not recorded", lines: [d.error || "Could not record that scan."] };
      } else if (!d.matched) {
        out = { kind: "err", title: "NOT RECOGNISED — keep aside", lines: [code, "No return matches this code. Upload the latest Delivered and In-transit sheets on Returns & Claims."] };
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
        out = { kind, title, lines, image_url: i.image_url };
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

  const undo = async (scanId) => {
    if (!window.confirm("Undo this scan? The return goes back to “to receive”.")) return;
    await fetch(`${API}/return-scan/${scanId}/`, { method: "DELETE" });
    load();
  };

  const today = queue?.today || todayISO();
  return { date, setDate: (d) => setPicked(d === today ? "" : d), today, queue, loading, latest, busy, record, undo, reload: load };
}

function rowsFor(queue, tab) {
  if (!queue) return [];
  if (tab === "extra") return queue.extra || [];
  if (tab === "in_transit") return queue.in_transit || [];
  if (tab === "missing") return queue.missing || [];
  return (queue.items || []).filter((i) => i.bucket === tab);
}

// ── Pieces ────────────────────────────────────────────────────────────────────

function ReturnRow({ r, onUndo, compact, showBusiness }) {
  const t = courierTone(r.courier);
  let tag;
  if (r.bucket === "received") tag = <Tag variant="green">✓ Received {r.received_day ? fmtDay(r.received_day) : ""}</Tag>;
  else if (r.bucket === "extra") tag = <Tag variant={r.why === "unknown" ? "red" : "blue"}>{WHY[r.why] || "Extra"}</Tag>;
  else if (r.bucket === "in_transit") tag = <Tag variant="blue">🚚 {r.transit_status || "In transit"}{r.expected_date ? ` · exp. ${fmtDay(r.expected_date)}` : ""}</Tag>;
  else if (r.bucket === "missing") tag = <Tag variant="red">Not received · delivered {fmtDay(r.delivered_date)}</Tag>;
  else tag = <Tag variant="gray">To receive</Tag>;
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", padding: compact ? "11px 12px" : "12px 16px", borderBottom: `1px solid ${C.gray100}`,
      background: r.bucket === "missing" ? C.redLight : C.white }}>
      <Photo url={r.image_url} size={compact ? 46 : 52} />
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
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end", flexShrink: 0 }}>
        {tag}
        {r.scan_id && onUndo && (
          <button onClick={() => onUndo(r.scan_id)} className="os-btn"
            style={{ border: "none", background: "none", padding: 0, fontSize: 11.5, fontWeight: 700, color: C.gray500, cursor: "pointer", textDecoration: "underline" }}>Undo scan</button>
        )}
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
};

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
      {camera && (
        <BarcodeScanner continuous title="Receive returns" hint="Scan the label on each returned parcel — keep scanning"
          progress={{ done: s?.received ?? 0, total: s?.expected ?? 0, label: "Received" }}
          latest={latest} busy={busy} onDetected={(code) => record(code)} onClose={() => setCamera(false)} />
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
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 10 }}>
          {loading && !queue ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 24 }}><CircularProgress style={{ color: C.orange }} /></div>
          ) : (
            <>
              <MissingBanner n={s?.missing} onOpen={() => v.setTab("missing")} compact />
              <CourierCards couriers={s?.by_courier} active={v.courier} onPick={v.setCourier} compact />
              <div style={{ background: C.white, border: `1px solid ${C.gray200}`, borderRadius: 16, padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
                {s && <MatchLine s={s} />}
                <div style={{ overflowX: "auto" }}>
                  <div style={{ minWidth: 420 }}><StatTabs tabs={TABS} tab={v.tab} onPick={v.setTab} counts={v.counts} tones={TONES} compact /></div>
                </div>
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
            : v.shown.map((r) => <ReturnRow key={`${r.id}-${r.scan_id}`} r={r} compact showBusiness={multi} onUndo={desk.undo} />)}
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
                : v.shown.map((r) => <ReturnRow key={`${r.id}-${r.scan_id}`} r={r} showBusiness={multi} onUndo={desk.undo} />)}
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
            {s && (
              <div style={{ fontSize: 12.5, color: C.gray500, lineHeight: 1.6 }}>
                Received today: <b style={{ color: C.gray800 }}>{s.received_today}</b>{s.extra ? <> · extra <b style={{ color: "#2563EB" }}>{s.extra}</b></> : null}
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
