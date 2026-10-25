import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { API, C, S, btn, Tag, useIsMobile } from "../../App";
import { BarcodeScanner } from "../shared/BarcodeScanner";
import { PlatformToggle, useLabelPlatform } from "../PlatformToggle";
import { CourierSummary } from "./CourierSummary";
import QrCodeScannerIcon from "@mui/icons-material/QrCodeScanner";
import RefreshIcon from "@mui/icons-material/Refresh";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import { CircularProgress } from "@mui/material";

/*
 * Order scan — the packing desk.
 *
 * Every label uploaded for the day is an order assigned to be packed. This screen
 * lists them all and works the list down: scan a parcel and it leaves "To pack".
 * It also keeps the running record — how many were assigned, how many are packed,
 * and what Meesho's own sheets say about each (shipped, not shipped, cancelled).
 *
 *   Phone   — a fixed, full-screen layout (like a delivery app): progress up top,
 *             the result of the last scan in one fixed panel, the queue below and a
 *             big Scan button — nothing moves while you work.
 *   Desktop — a scan box that keeps the cursor, the assigned list, and the log.
 */

const STATE_META = {
  PENDING:    { label: "To pack",    tag: "gray" },
  SCANNED:    { label: "Scanned",    tag: "blue" },
  PACKED:     { label: "Packed",     tag: "green" },
  DISPATCHED: { label: "Dispatched", tag: "green" },
  ON_HOLD:    { label: "On hold",    tag: "orange" },
  ISSUE:      { label: "Problem",    tag: "red" },
  CANCELLED:  { label: "Cancelled",  tag: "gray" },
};
const SHIP_META = {
  SHIPPED:     { label: "Shipped",         tag: "green", color: C.green },
  NOT_SHIPPED: { label: "Not shipped yet", tag: "amber", color: C.amber },
  CANCELLED:   { label: "Cancelled",       tag: "red",   color: C.red },
  UNKNOWN:     { label: "No status yet",   tag: "gray",  color: C.gray500 },
};
const MODES = [
  { key: "PACKED",     label: "Packed",     help: "marking parcels as packed" },
  { key: "DISPATCHED", label: "Dispatched", help: "marking parcels handed to the courier" },
];

/** Today's packing day: it runs noon to noon, so before 12 pm it's still yesterday's. */
function packingDayISO() {
  const now = new Date();
  if (now.getHours() < 12) now.setDate(now.getDate() - 1);
  const p = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
const fmtDay = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "");
function dayLabel(iso, current) {
  if (!iso) return "";
  if (iso === current) return `Today · ${fmtDay(iso)} (from 12 pm)`;
  const prev = new Date(`${current}T00:00:00`); prev.setDate(prev.getDate() - 1);
  const p = (n) => String(n).padStart(2, "0");
  const prevIso = `${prev.getFullYear()}-${p(prev.getMonth() + 1)}-${p(prev.getDate())}`;
  return iso === prevIso ? `Previous day · ${fmtDay(iso)}` : fmtDay(iso);
}

const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

function Photo({ url, size = 48, radius = 8 }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [url]);
  const box = {
    width: size, height: size, borderRadius: radius, flexShrink: 0, overflow: "hidden", background: C.gray50,
    border: `1px solid ${C.gray200}`, display: "flex", alignItems: "center", justifyContent: "center", color: C.gray300,
  };
  if (!url || broken) return <div style={{ ...box, fontSize: size * 0.4 }}>📦</div>;
  return <div style={box}><img src={url} alt="" onError={() => setBroken(true)} style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>;
}

// ── The desk: queue, scanning, record ─────────────────────────────────────────

function useScanDesk(platform) {
  // The day picked by hand; "" while the screen follows today. Following, the
  // server decides what to show: today's list — or, after 12 pm until today's
  // first scan or labels, the previous day's, so the screen never goes blank.
  const [picked, setPicked] = useState("");
  const following = !picked;
  const [queue, setQueue] = useState(null);       // { date, summary, items, dates }
  const date = picked || queue?.date || "";
  const setDate = (d) => { if (!(following && d === queue?.date)) setPicked(d); };
  const [loading, setLoading] = useState(true);
  const [mode, setModeState] = useState(() => {
    try { return localStorage.getItem("scan_mode") === "DISPATCHED" ? "DISPATCHED" : "PACKED"; } catch { return "PACKED"; }
  });
  const [latest, setLatest] = useState(null);     // what the last scan did
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const queueRef = useRef(null);
  queueRef.current = queue;
  const seq = useRef(0);
  const reloadTimer = useRef(null);

  const setMode = (m) => { setModeState(m); try { localStorage.setItem("scan_mode", m); } catch { /* ignore */ } };

  const load = useCallback(async () => {
    const p = new URLSearchParams({ platform });
    if (picked) p.set("date", picked);
    try {
      const res = await fetch(`${API}/order-scan/queue/?${p}`);
      if (res.ok) setQueue(await res.json());
    } finally { setLoading(false); }
  }, [picked, platform]);

  useEffect(() => { setLoading(true); setLatest(null); load(); }, [load]);

  // After a scan the list is already ticked off locally; the full list is
  // fetched again only once scanning pauses, not after every parcel.
  const reloadSoon = useCallback(() => {
    clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => load(), 1500);
  }, [load]);
  useEffect(() => () => clearTimeout(reloadTimer.current), []);

  // At 12 pm a new packing day starts: ask the server again, which keeps the
  // previous day's list up until the new day has its first scan or labels.
  const seenDay = useRef(packingDayISO());
  useEffect(() => {
    const t = setInterval(() => {
      const today = packingDayISO();
      if (today !== seenDay.current) { seenDay.current = today; if (following) load(); }
    }, 30000);
    return () => clearInterval(t);
  }, [following, load]);

  /** Record one scan and describe, in one line each, what it means for the desk. */
  const record = async (codeRaw) => {
    const code = (codeRaw ?? "").trim();
    if (!code) return null;
    setBusy(true); setError(null);
    const my = ++seq.current;
    try {
      const res = await fetch(`${API}/order-scan/`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        // Following today: let the server's own noon cut-off decide the day, so a
        // device clock a minute off around 12 pm can't misfile a scan. A day
        // picked by hand is sent as-is.
        body: JSON.stringify({ code, status: mode, platform, day: picked || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const out = { kind: "err", title: "Not recorded", lines: [data.error || "Could not record that scan."], code };
        if (my === seq.current) setLatest(out);
        return out;
      }
      const row = data.row;
      const items = queueRef.current?.items || [];
      const sameBiz = (i) => !i.business_id || !row.business || i.business_id === row.business;
      const item = items.find((i) => sameBiz(i) && (i.order_id === row.sub_order_no || (row.awb_number && i.awb === row.awb_number)));
      const ship = row.ship_status;
      const lines = [];
      const what = row.sku ? `${row.sku} × ${row.qty}` : item ? `${item.sku} × ${item.qty}` : null;
      if (what) lines.push(what);
      const where = [item?.courier || row.courier_name, item?.customer_city || row.customer_city].filter(Boolean).join(" · ");
      if (where) lines.push(where);

      let kind = "ok";
      let title = mode === "DISPATCHED" ? "Dispatched" : "Packed";
      if (ship === "CANCELLED") {
        kind = "err"; title = "CANCELLED — do not ship";
        lines.push("Meesho shows this order as cancelled.");
        navigator.vibrate?.([120, 80, 120]);
      } else if (row.matched_from === "NONE") {
        kind = "warn"; title = "Not recognised — saved anyway";
        if (!what) lines.unshift(code);
        lines.push("No label or order matches this code yet. It's kept in the scan record and links up once its label / orders sheet is uploaded.");
      } else if (!item) {
        kind = "warn"; title = `${title} · not in this day's list`;
      } else if (data.already_scanned) {
        kind = "warn"; title = `Already scanned ${row.scan_count}×`;
      } else if (mode === "DISPATCHED" && ship === "NOT_SHIPPED") {
        kind = "warn"; title = "Dispatched · Meesho not showing shipped";
        lines.push("The panel still lists it as ready to ship.");
      }
      if (data.cross_business) lines.push(`Filed under ${data.business_name}`);
      if (row.platform && row.platform !== platform) lines.push(`${row.platform === "flipkart" ? "Flipkart" : "Meesho"} parcel`);

      const out = { kind, title, lines, code: row.sub_order_no, image_url: item?.image_url };
      if (my === seq.current) setLatest(out);

      // Mark it off the list straight away; the refetch below confirms.
      setQueue((q) => q && {
        ...q,
        items: q.items.map((i) => (i === item ? { ...i, state: row.status, scan_id: row.id, scan_count: row.scan_count, ship_status: ship } : i)),
      });
      reloadSoon();
      return out;
    } catch {
      const out = { kind: "err", title: "Network error", lines: ["The scan was not recorded."], code };
      if (my === seq.current) setLatest(out);
      return out;
    } finally {
      setBusy(false);
    }
  };

  /** Admin: set the status of orders on the list by hand (PENDING puts them back to pack). */
  const setStatusByHand = async (items, status) => {
    const res = await fetch(`${API}/order-scan/queue/status/`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, day: queueRef.current?.date, items: items.map((i) => ({ business_id: i.business_id, order_id: i.order_id })) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.error || "Could not change the status." };
    await load();
    return data;
  };

  /** Admin: move earlier days' unsent orders onto `toDay` — or, with undo, back to their own day. */
  const shiftOrders = async (items, { toDay, undo } = {}) => {
    const res = await fetch(`${API}/order-scan/shift/`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to_day: toDay, undo: !!undo, items: items.map((i) => ({ business_id: i.business_id, order_id: i.order_id })) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.error || "Could not move those orders." };
    await load();
    return data;
  };

  const currentDay = queue?.current_day || packingDayISO();
  const backToToday = () => setPicked("");
  const startToday = () => setPicked(currentDay);
  return { date, setDate, following, currentDay, backToToday, startToday, queue, loading, mode, setMode, latest, busy, error, setError, record, reload: load, setStatusByHand, shiftOrders };
}

// ── Pieces ────────────────────────────────────────────────────────────────────

const KIND_STYLE = {
  ok:   { bg: C.greenLight, border: C.greenBorder, fg: C.green, mark: "✓" },
  warn: { bg: C.amberLight, border: C.amberBorder, fg: "#92400E", mark: "!" },
  err:  { bg: C.redLight,   border: C.redBorder,   fg: C.red,   mark: "✕" },
};

/** One fixed-size panel for the last scan — it changes in place, so nothing jumps. */
function LatestPanel({ latest, busy, minHeight = 130 }) {
  const k = latest ? KIND_STYLE[latest.kind] : null;
  return (
    <div style={{
      minHeight, borderRadius: 14, padding: "14px 16px", display: "flex", gap: 14, alignItems: "center",
      background: k ? k.bg : C.gray50, border: `2px solid ${k ? k.border : C.gray200}`,
    }}>
      {busy ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 700, color: C.gray600 }}>
          <CircularProgress size={20} style={{ color: C.orange }} /> Checking…
        </div>
      ) : latest ? (
        <>
          <Photo url={latest.image_url} size={86} radius={12} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: k.fg, lineHeight: 1.2 }}>{k.mark} {latest.title}</div>
            {latest.lines.map((l, i) => (
              <div key={i} style={{ fontSize: 14, color: C.gray800, marginTop: 4, fontWeight: i === 0 ? 800 : 500, fontFamily: i === 0 ? "monospace" : "inherit", wordBreak: "break-all" }}>{l}</div>
            ))}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 14, color: C.gray500, fontWeight: 600 }}>Scan a parcel — what it is and whether it's good to go shows here.</div>
      )}
    </div>
  );
}

function ProgressBar({ done, total, label }) {
  const pct = total ? Math.min(100, (done / total) * 100) : 0;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.gray600 }}>{label}</span>
        <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 24, color: C.gray900 }}>
          {done}<span style={{ color: C.gray400, fontSize: 16 }}> / {total}</span>
        </span>
      </div>
      <div style={{ height: 10, borderRadius: 99, background: C.gray100, overflow: "hidden", marginTop: 6 }}>
        <div style={{ height: "100%", width: `${pct}%`, background: C.green, borderRadius: 99, transition: "width 0.25s" }} />
      </div>
    </div>
  );
}

function ItemRow({ item, compact, showBusiness, admin, selecting, selected, onToggle, onSetStatus, onMoveBack }) {
  const st = STATE_META[item.state] || STATE_META.PENDING;
  const ship = SHIP_META[item.ship_status] || SHIP_META.UNKNOWN;
  const cancelled = item.ship_status === "CANCELLED";
  return (
    <div onClick={selecting ? onToggle : undefined} style={{
      display: "flex", gap: 12, alignItems: "center", padding: compact ? "10px 12px" : "11px 16px",
      borderBottom: `1px solid ${C.gray100}`, background: selected ? C.orangeLight : cancelled ? C.redLight : C.white,
      cursor: selecting ? "pointer" : "default",
    }}>
      {selecting && <input type="checkbox" checked={!!selected} onChange={onToggle} onClick={(e) => e.stopPropagation()}
        style={{ width: 20, height: 20, accentColor: C.orange, flexShrink: 0 }} />}
      <Photo url={item.image_url} size={compact ? 46 : 52} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 13.5, color: C.gray900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.sku || "—"}</span>
          <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 13, color: C.orange }}>×{item.qty}</span>
        </div>
        <div style={{ fontSize: 11.5, color: C.gray500, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {[showBusiness && item.business_name, item.courier, item.customer_city, item.awb].filter(Boolean).join(" · ")}
        </div>
        {item.shifted_from && (
          <div style={{ marginTop: 3, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <Tag variant="amber">↻ Moved from {fmtDay(item.shifted_from)}</Tag>
            {admin && !selecting && onMoveBack && (
              <button onClick={(e) => { e.stopPropagation(); onMoveBack(); }}
                style={{ border: "none", background: "none", padding: 0, fontSize: 11, fontWeight: 700, color: C.gray500, cursor: "pointer", textDecoration: "underline" }}>
                Move back
              </button>
            )}
          </div>
        )}
      </div>
      <div style={{ textAlign: "right", flexShrink: 0, display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
        {admin && !selecting && !compact ? (
          <select value={item.state} onChange={(e) => onSetStatus(e.target.value)} title="Change status (admin)"
            style={{ ...S.inp, padding: "4px 8px", fontSize: 12, width: "auto", fontWeight: 700 }}>
            {Object.entries(STATE_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
          </select>
        ) : <Tag variant={st.tag}>{st.label}</Tag>}
        {(item.state !== "PENDING" || cancelled) && item.ship_status !== "UNKNOWN" && (
          <span style={{ fontSize: 10.5, fontWeight: 700, color: ship.color }}>{ship.label}</span>
        )}
      </div>
    </div>
  );
}

/**
 * Admin: pick orders on the list and set their status by hand — mark them
 * dispatched without scanning, put them on hold, or back to "to pack".
 */
function useAdminSelect(desk, shown) {
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState(() => new Set());
  const [note, setNote] = useState(null);
  const keyOf = (i) => `${i.business_id}-${i.order_id}`;
  const toggle = (i) => setPicked((s) => { const n = new Set(s); n.has(keyOf(i)) ? n.delete(keyOf(i)) : n.add(keyOf(i)); return n; });
  const stop = () => { setSelecting(false); setPicked(new Set()); };
  const apply = async (items, status) => {
    if (!items.length) return;
    const d = await desk.setStatusByHand(items, status);
    if (d.error) { setNote(`⚠ ${d.error}`); return; }
    {
      const n = d.updated + d.created + d.reset;
      setNote(`${n} order${n === 1 ? "" : "s"} set to ${STATE_META[status]?.label || status}${d.not_found ? ` · ${d.not_found} not found` : ""}`);
      stop();
      setTimeout(() => setNote(null), 5000);
    }
  };
  return {
    admin: !!desk.queue?.is_admin, selecting, start: () => setSelecting(true), stop, note,
    isPicked: (i) => picked.has(keyOf(i)), toggle,
    count: picked.size,
    allShown: () => setPicked(new Set(shown.map(keyOf))),
    applyPicked: (status) => apply((desk.queue?.items || []).filter((i) => picked.has(keyOf(i))), status),
    applyOne: (i, status) => apply([i], status),
  };
}

function AdminBar({ sel, shownCount, compact }) {
  const [status, setStatus] = useState("DISPATCHED");
  if (!sel.admin) return null;
  if (!sel.selecting) {
    return (
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={sel.start} style={btn("ghostOrange", "sm")}>✎ Change status{compact ? "" : " (admin)"}</button>
        {sel.note && <span style={{ fontSize: 12, fontWeight: 700, color: sel.note.startsWith("⚠") ? C.red : C.green }}>{sel.note.startsWith("⚠") ? "" : "✓ "}{sel.note}</span>}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "8px 10px", borderRadius: 10,
      background: C.orangeLight, border: `1.5px solid ${C.orange}` }}>
      <span style={{ fontSize: 12.5, fontWeight: 800, color: C.gray800 }}>{sel.count} selected</span>
      <button onClick={sel.allShown} style={btn("ghost", "sm")}>Select all {shownCount}</button>
      <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...S.inp, padding: "5px 8px", fontSize: 12.5, width: "auto", fontWeight: 700 }}>
        {Object.entries(STATE_META).map(([k, m]) => <option key={k} value={k}>{k === "PENDING" ? "To pack (undo scan)" : m.label}</option>)}
      </select>
      <button onClick={() => sel.applyPicked(status)} disabled={!sel.count} style={{ ...btn("primary", "sm"), opacity: sel.count ? 1 : 0.5 }}>Apply</button>
      <button onClick={sel.stop} style={btn("ghost", "sm")}>Cancel</button>
    </div>
  );
}

const FILTERS = [
  { key: "pending",   label: "To pack",   test: (i) => i.state === "PENDING" && i.ship_status !== "CANCELLED" },
  { key: "done",      label: "Packed",    test: (i) => ["PACKED", "DISPATCHED", "SCANNED"].includes(i.state) },
  { key: "issues",    label: "Issues",    test: (i) => ["ON_HOLD", "ISSUE"].includes(i.state) || i.ship_status === "CANCELLED" },
  { key: "all",       label: "All",       test: () => true },
];

/**
 * Courier tiles from the list itself, so a tile ticks the moment a parcel is
 * scanned (the list is updated straight away; the server copy only after a pause).
 */
function courierStats(items) {
  const by = new Map();
  for (const i of items) {
    const name = (i.courier || "").split(/\s+/).filter(Boolean).join(" ") || "No courier on label";
    const key = name.toLowerCase();
    if (!by.has(key)) by.set(key, { courier: name, assigned: 0, scanned: 0, dispatched: 0, left: 0 });
    const c = by.get(key);
    if (i.ship_status === "CANCELLED" && !i.scan_id) continue;
    c.assigned += 1;
    if (i.scan_id) { c.scanned += 1; if (i.state === "DISPATCHED") c.dispatched += 1; } else c.left += 1;
  }
  return [...by.values()].filter((c) => c.assigned).sort((a, b) => b.assigned - a.assigned || a.courier.localeCompare(b.courier));
}

const courierKey = (c) => (c || "").split(/\s+/).filter(Boolean).join(" ").toLowerCase() || "no courier on label";

function summaryCounts(items) {
  const out = {};
  FILTERS.forEach((f) => { out[f.key] = items.filter(f.test).length; });
  return out;
}

/** Which packing day is open: today's (counting since 12 pm) or an earlier one picked on purpose. */
function DayNotice({ desk, compact }) {
  const { date, currentDay, backToToday, startToday, following, queue } = desk;
  if (!date) return null;
  if (following && queue?.carried_over) {
    return (
      <div style={{ background: "#EFF6FF", border: "1.5px solid #BFDBFE", borderRadius: 12, padding: compact ? "8px 12px" : "10px 14px",
        display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
        <span style={{ fontSize: compact ? 12.5 : 13, fontWeight: 700, color: "#1E3A8A" }}>
          Showing {fmtDay(date)}'s orders{compact ? "" : ` — today's list (from 12 pm) takes over once a new order is scanned or today's labels are uploaded.`}
        </span>
        <button onClick={startToday} style={{ ...btn("ghost", "sm") }}>Start today's list</button>
      </div>
    );
  }
  if (date === currentDay) {
    if (compact) return null;
    return (
      <div style={{ fontSize: 12, color: C.gray500 }}>
        Counting since <b>{fmtDay(currentDay)}, 12:00 pm</b> — the count starts fresh at 12 pm every day.
      </div>
    );
  }
  return (
    <div style={{ background: C.amberLight, border: `1.5px solid ${C.amberBorder}`, borderRadius: 12, padding: compact ? "8px 12px" : "10px 14px",
      display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
      <span style={{ fontSize: compact ? 12.5 : 13, fontWeight: 700, color: "#92400E" }}>
        Scanning for {dayLabel(date, currentDay).toLowerCase().startsWith("previous") ? "the previous day" : "an earlier day"}, {fmtDay(date)}
        {compact ? "" : " — scans count toward that day's list."}
      </span>
      <button onClick={backToToday} style={{ ...btn("primary", "sm") }}>Back to today</button>
    </div>
  );
}

// ── Which businesses the desk combines ────────────────────────────────────────

/**
 * Order Scan merges every business the person is assigned to. An admin can
 * choose which ones are counted together; that choice is saved to their
 * account on the server, so it holds on every device.
 */
function useDeskBusinesses() {
  const [info, setInfo] = useState(null);
  const load = useCallback(() => {
    fetch(`${API}/order-scan/settings/`).then((r) => (r.ok ? r.json() : null)).then(setInfo).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  const save = async (ids) => {
    const res = await fetch(`${API}/order-scan/settings/`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ business_ids: ids }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || "Couldn't save.");
    setInfo(d);
    return d;
  };
  return { info, save, reload: load };
}

function DeskBusinesses({ desk, onChanged, compact }) {
  const { info, save } = desk;
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => { if (info) setPicked(new Set(info.selected)); }, [info]);
  if (!info || info.available.length < 2) return null;

  const names = info.available.filter((b) => info.selected.includes(b.id)).map((b) => b.name);
  const label = names.length === info.available.length && info.all
    ? `All ${names.length} businesses` : names.join(" + ");
  const submit = async () => {
    setBusy(true); setErr(null);
    try { await save([...picked]); setOpen(false); onChanged?.(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => info.is_admin && setOpen((v) => !v)} title={info.is_admin ? "Choose which businesses are combined" : "Combined from the businesses you're assigned to"}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: compact ? "6px 10px" : "8px 12px", borderRadius: 10,
          border: `1.5px solid ${C.orangeBorder}`, background: C.orangeLight, color: C.orange, fontWeight: 800,
          fontSize: compact ? 11.5 : 12.5, fontFamily: "inherit", cursor: info.is_admin ? "pointer" : "default",
          maxWidth: compact ? 170 : 360, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        🏢 {compact ? `${names.length} businesses` : `Combining: ${label}`}{info.is_admin ? " ▾" : ""}
      </button>
      {open && (
        <div style={{ position: compact ? "fixed" : "absolute", top: compact ? 60 : "calc(100% + 6px)", right: compact ? 12 : 0,
          left: compact ? 12 : "auto", zIndex: 3200, minWidth: 260, background: C.white, border: `1px solid ${C.gray200}`,
          borderRadius: 12, boxShadow: "0 12px 30px rgba(0,0,0,.15)", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: C.gray800 }}>Combine these businesses</div>
          <div style={{ fontSize: 11.5, color: C.gray500 }}>Saved to your account — the same on every device.</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 260, overflowY: "auto" }}>
            {info.available.map((b) => (
              <label key={b.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.gray700, cursor: "pointer" }}>
                <input type="checkbox" checked={picked.has(b.id)}
                  onChange={() => setPicked((s) => { const n = new Set(s); if (n.has(b.id)) n.delete(b.id); else n.add(b.id); return n; })} />
                {b.name}
              </label>
            ))}
          </div>
          {err && <div style={{ fontSize: 12, color: C.red, fontWeight: 600 }}>{err}</div>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={() => setPicked(new Set(info.available.map((b) => b.id)))} style={btn("ghost", "sm")}>All</button>
            <button onClick={() => setOpen(false)} style={btn("ghost", "sm")}>Cancel</button>
            <button onClick={submit} disabled={busy || picked.size === 0} style={{ ...btn("primary", "sm"), opacity: busy || !picked.size ? 0.5 : 1 }}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Courier tiles ─────────────────────────────────────────────────────────────

/** One tile per courier: how many it takes today, how many are scanned, how many are left. */
function CourierTiles({ couriers, offList, active, onPick, compact }) {
  if (!couriers?.length && !offList) return null;
  if (compact) {
    // Phone: one line of chips, so the packing list keeps the screen.
    return (
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
        {couriers.map((c) => {
          const on = active === c.courier;
          const done = c.left === 0;
          return (
            <button key={c.courier} onClick={() => onPick(on ? null : c.courier)}
              style={{ flex: "0 0 auto", display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 999,
                fontFamily: "inherit", fontSize: 12.5, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap",
                border: `1.5px solid ${on ? C.orange : done ? C.greenBorder : C.gray200}`, background: on ? C.orangeLight : C.white,
                color: C.gray800 }}>
              🚚 {c.courier} <span style={{ fontFamily: "monospace" }}>{c.scanned}/{c.assigned}</span>
              <span style={{ color: done ? C.green : C.red, fontWeight: 700 }}>{done ? "✓" : `${c.left} left`}</span>
            </button>
          );
        })}
        {offList > 0 && (
          <span style={{ flex: "0 0 auto", padding: "6px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap",
            border: `1.5px dashed ${C.amberBorder}`, background: C.amberLight, color: "#92400E" }}>+{offList} not on list</span>
        )}
      </div>
    );
  }
  return (
    <div style={{ display: compact ? "flex" : "grid", gap: 10, overflowX: compact ? "auto" : undefined,
      gridTemplateColumns: compact ? undefined : "repeat(auto-fill, minmax(170px, 1fr))", paddingBottom: compact ? 2 : 0 }}>
      {(couriers || []).map((c) => {
        const pct = c.assigned ? Math.round((c.scanned / c.assigned) * 100) : 0;
        const on = active === c.courier;
        const done = c.left === 0 && c.assigned > 0;
        return (
          <button key={c.courier} onClick={() => onPick(on ? null : c.courier)}
            style={{ flex: compact ? "0 0 150px" : undefined, textAlign: "left", cursor: "pointer", fontFamily: "inherit",
              background: on ? C.orangeLight : C.white, border: `1.5px solid ${on ? C.orange : done ? C.greenBorder : C.gray200}`,
              borderRadius: 12, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 12.5, fontWeight: 800, color: C.gray800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>🚚 {c.courier}</span>
              {done && <span style={{ fontSize: 11, color: C.green, fontWeight: 800 }}>✓ done</span>}
            </div>
            <div style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 20, color: C.gray900, lineHeight: 1 }}>
              {c.scanned}<span style={{ color: C.gray400, fontSize: 14 }}> / {c.assigned}</span>
            </div>
            <div style={{ height: 6, borderRadius: 99, background: C.gray100, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pct}%`, background: done ? C.green : C.orange, transition: "width .25s" }} />
            </div>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: c.left ? C.red : C.green }}>
              {c.left ? `${c.left} left to scan` : "All scanned"}{c.dispatched ? ` · ${c.dispatched} dispatched` : ""}
            </span>
          </button>
        );
      })}
      {offList > 0 && (
        <div style={{ flex: compact ? "0 0 150px" : undefined, borderRadius: 12, padding: "10px 12px", border: `1.5px dashed ${C.amberBorder}`,
          background: C.amberLight, display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12.5, fontWeight: 800, color: "#92400E" }}>Scanned, not on this list</span>
          <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 20, color: "#92400E" }}>{offList}</span>
          <span style={{ fontSize: 11, color: "#92400E" }}>Kept in the scan record</span>
        </div>
      )}
    </div>
  );
}

/**
 * The courier KPIs, always shown. With labels for the day: each courier's
 * scanned / left. Scans that aren't on the day's labels are counted per courier
 * too. With nothing for the day, it says why and offers the latest day that
 * has labels.
 */
function CourierSection({ desk, items, sum, active, onPick, compact }) {
  const tiles = courierStats(items);
  const off = (sum?.off_list_by_courier || []).filter((c) => c.scanned);
  const latest = desk.queue?.latest_label_day;
  if (!tiles.length && !off.length) {
    if (desk.loading && !desk.queue) return null;
    const msg = `No labels uploaded for ${fmtDay(desk.date)} yet — courier-wise counts appear once that day's labels are uploaded on Labels.`;
    return (
      <div style={{ border: `1.5px dashed ${C.gray200}`, borderRadius: 12, padding: compact ? "8px 12px" : "12px 16px",
        background: C.gray50, display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
        <span style={{ fontSize: compact ? 12 : 13, color: C.gray600, fontWeight: 600 }}>🚚 {msg}</span>
        {latest && latest !== desk.date && (
          <button onClick={() => desk.setDate(latest)} style={btn("ghostOrange", "sm")}>Open {fmtDay(latest)} (latest labels)</button>
        )}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {tiles.length > 0 && <CourierTiles couriers={tiles} offList={0} active={active} onPick={onPick} compact={compact} />}
      {off.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: compact ? "nowrap" : "wrap", overflowX: compact ? "auto" : undefined, alignItems: "center" }}>
          <span style={{ fontSize: 11.5, fontWeight: 800, color: "#92400E", whiteSpace: "nowrap" }}>Scanned, not on this day's labels:</span>
          {off.map((c) => (
            <span key={c.courier} style={{ flex: "0 0 auto", padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700,
              whiteSpace: "nowrap", border: `1.5px dashed ${C.amberBorder}`, background: C.amberLight, color: "#92400E" }}>
              🚚 {c.courier} · {c.scanned}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── "Not sent" alerts ─────────────────────────────────────────────────────────

const ALERT_GROUPS = [
  { key: "not_packed", title: "Labels never scanned", help: "Labels from earlier days nobody has scanned at the desk — and not cancelled or shipped." },
  { key: "not_dispatched", title: "Packed, not marked dispatched", help: "Scanned over a day ago but never marked as handed to the courier." },
  { key: "not_shipped", title: "Sent, but marketplace says not shipped", help: "Packed or dispatched over a day ago, yet the latest sheet still shows it as not shipped — its status wasn't updated." },
  { key: "unrecognised", title: "Scanned but no order found", help: "Codes scanned this week that match no order yet — upload their labels / orders sheet." },
];

export function useScanAlerts(platform, tick = 0) {
  const [alerts, setAlerts] = useState(null);
  const load = useCallback(() => {
    const q = new URLSearchParams({ scope: "desk" });
    if (platform) q.set("platform", platform);
    const p = `?${q}`;
    fetch(`${API}/order-scan/alerts/${p}`).then((r) => (r.ok ? r.json() : null)).then(setAlerts).catch(() => {});
  }, [platform, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  return [alerts, load];
}

function AlertsPanel({ alerts, onClose }) {
  return (
    <div style={{ ...S.card, border: `1.5px solid ${C.redBorder}`, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.gray900 }}>Orders not sent (last 7 days)</div>
          <div style={{ fontSize: 12, color: C.gray500 }}>Check each one — pack it, mark it dispatched, or update its status on the marketplace panel.</div>
        </div>
        <button onClick={onClose} style={btn("ghost", "sm")}>Close</button>
      </div>
      {ALERT_GROUPS.filter((g) => alerts[g.key]?.count).map((g) => (
        <div key={g.key} style={{ border: `1px solid ${C.gray100}`, borderRadius: 12, overflow: "hidden" }}>
          <div style={{ padding: "10px 14px", background: C.gray50 }}>
            <span style={{ fontSize: 13.5, fontWeight: 800, color: C.gray800 }}>{g.title} · {alerts[g.key].count}</span>
            <div style={{ fontSize: 12, color: C.gray500 }}>{g.help}</div>
          </div>
          {alerts[g.key].items.map((i) => (
            <div key={`${g.key}-${i.order_id}`} style={{ display: "flex", gap: 10, padding: "8px 14px", borderTop: `1px solid ${C.gray100}`, fontSize: 12.5, flexWrap: "wrap" }}>
              <span style={{ fontFamily: "monospace", fontWeight: 700, color: C.gray800 }}>{i.order_id}</span>
              <span style={{ color: C.gray500 }}>{[i.sku && `${i.sku} × ${i.qty}`, i.courier, i.awb, i.platform === "flipkart" ? "Flipkart" : null].filter(Boolean).join(" · ")}</span>
              <span style={{ marginLeft: "auto", color: C.gray400 }}>{i.date || fmtTime(i.scanned_at)}{i.ship_status_raw ? ` · sheet: ${i.ship_status_raw}` : ""}</span>
            </div>
          ))}
          {alerts[g.key].count > alerts[g.key].items.length && (
            <div style={{ padding: "6px 14px", fontSize: 11.5, color: C.gray400 }}>…and {alerts[g.key].count - alerts[g.key].items.length} more</div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Admin only: orders from earlier days that never went out. Nothing moves by
 * itself — the admin picks which ones go onto the day on screen.
 */
function UnsentBanner({ desk, onOpen, compact }) {
  const u = desk.queue?.earlier_unsent;
  if (!u?.count) return null;
  return (
    <button onClick={onOpen} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", cursor: "pointer",
      fontFamily: "inherit", background: "#FFFBEB", border: `1.5px solid ${C.amberBorder}`, borderRadius: 12, padding: compact ? "8px 12px" : "10px 14px" }}>
      <span style={{ fontSize: compact ? 16 : 18 }}>↻</span>
      <span style={{ flex: 1, minWidth: 0, fontSize: compact ? 12.5 : 13.5, fontWeight: 800, color: "#92400E" }}>
        {u.count} order{u.count === 1 ? "" : "s"} from earlier days not sent
        {!compact && <span style={{ fontWeight: 600 }}> · {u.by_day.map((d) => `${fmtDay(d.day)}: ${d.count}`).join(" · ")}</span>}
      </span>
      <span style={{ fontSize: 12.5, fontWeight: 800, color: C.orange, whiteSpace: "nowrap" }}>Move to {fmtDay(desk.date)} →</span>
    </button>
  );
}

function ShiftPanel({ desk, onClose }) {
  const u = desk.queue?.earlier_unsent || { items: [], count: 0, by_day: [] };
  const key = (i) => `${i.business_id}-${i.order_id}`;
  const [picked, setPicked] = useState(() => new Set(u.items.map(key)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const toggle = (i) => setPicked((s) => { const n = new Set(s); n.has(key(i)) ? n.delete(key(i)) : n.add(key(i)); return n; });
  const days = u.by_day.map((d) => d.day);
  const move = async () => {
    setBusy(true); setError(null);
    const d = await desk.shiftOrders(u.items.filter((i) => picked.has(key(i))), { toDay: desk.date });
    setBusy(false);
    if (d.error) setError(d.error); else onClose(d.moved);
  };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 3300, background: "rgba(0,0,0,.35)", padding: 12, overflowY: "auto" }}
      onClick={() => onClose()}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ ...S.card, maxWidth: 720, margin: "24px auto", padding: 0, overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: "calc(100dvh - 48px)" }}>
        <div style={{ padding: "14px 16px", borderBottom: `1px solid ${C.gray100}` }}>
          <div style={{ fontSize: 16, fontWeight: 900, color: C.gray900 }}>Move unsent orders to {fmtDay(desk.date)}</div>
          <div style={{ fontSize: 12.5, color: C.gray500, marginTop: 3 }}>
            These never went out on their own day — not dispatched here, and not shipped or cancelled on the marketplace.
            The ones you move join {fmtDay(desk.date)}'s list and courier counts; the rest stay where they are.
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button onClick={() => setPicked(new Set(u.items.map(key)))} style={btn("ghost", "sm")}>Select all</button>
            <button onClick={() => setPicked(new Set())} style={btn("ghost", "sm")}>Clear</button>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: C.gray600 }}>{picked.size} of {u.items.length} selected</span>
          </div>
        </div>
        <div style={{ overflowY: "auto", flex: 1 }}>
          {days.map((day) => (
            <div key={day}>
              <div style={{ padding: "8px 16px", background: C.gray50, fontSize: 12, fontWeight: 800, color: C.gray600, display: "flex", justifyContent: "space-between" }}>
                <span>{fmtDay(day)}</span>
                <button onClick={() => setPicked((s) => { const n = new Set(s); u.items.filter((i) => i.day === day).forEach((i) => n.add(key(i))); return n; })}
                  style={{ border: "none", background: "none", color: C.orange, fontWeight: 800, cursor: "pointer", fontSize: 12 }}>Select day</button>
              </div>
              {u.items.filter((i) => i.day === day).map((i) => (
                <label key={key(i)} style={{ display: "flex", gap: 10, alignItems: "center", padding: "9px 16px", borderBottom: `1px solid ${C.gray100}`, cursor: "pointer",
                  background: picked.has(key(i)) ? C.orangeLight : C.white }}>
                  <input type="checkbox" checked={picked.has(key(i))} onChange={() => toggle(i)} style={{ width: 18, height: 18, accentColor: C.orange }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 13 }}>{i.sku || "—"} <span style={{ color: C.orange }}>×{i.qty}</span></div>
                    <div style={{ fontSize: 11.5, color: C.gray500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {[i.business_name, i.courier, i.awb, i.order_id].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <Tag variant={(STATE_META[i.state] || STATE_META.PENDING).tag}>{(STATE_META[i.state] || STATE_META.PENDING).label}</Tag>
                </label>
              ))}
            </div>
          ))}
        </div>
        <div style={{ padding: "12px 16px", borderTop: `1px solid ${C.gray100}`, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {error && <span style={{ fontSize: 12.5, color: C.red, fontWeight: 700 }}>{error}</span>}
          <button onClick={() => onClose()} style={{ ...btn("ghost", "md"), marginLeft: "auto" }}>Cancel</button>
          <button onClick={move} disabled={!picked.size || busy} style={{ ...btn("primary", "md"), opacity: !picked.size || busy ? 0.5 : 1 }}>
            {busy ? "Moving…" : `Move ${picked.size} to ${fmtDay(desk.date)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function AlertBanner({ alerts, onOpen, compact }) {
  if (!alerts?.total) return null;
  if (compact) {
    return (
      <button onClick={onOpen} style={{ cursor: "pointer", fontFamily: "inherit", background: C.redLight, border: `1.5px solid ${C.redBorder}`,
        borderRadius: 10, padding: "7px 12px", color: C.red, fontSize: 12.5, fontWeight: 800, display: "flex", justifyContent: "space-between" }}>
        <span>⚠️ {alerts.total} order{alerts.total === 1 ? "" : "s"} not sent</span><span>Review →</span>
      </button>
    );
  }
  const parts = ALERT_GROUPS.filter((g) => alerts[g.key]?.count).map((g) => `${alerts[g.key].count} ${g.title.toLowerCase()}`);
  return (
    <button onClick={onOpen} style={{ textAlign: "left", cursor: "pointer", fontFamily: "inherit", background: C.redLight,
      border: `1.5px solid ${C.redBorder}`, borderRadius: 12, padding: "10px 14px", color: C.red, display: "flex", gap: 10, alignItems: "center" }}>
      <span style={{ fontSize: 20 }}>⚠️</span>
      <span style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>{alerts.total} order{alerts.total === 1 ? "" : "s"} not sent: {parts.join(" · ")}</span>
      <span style={{ fontSize: 12.5, fontWeight: 800 }}>Review →</span>
    </button>
  );
}

// ── Phone: full screen, stable ────────────────────────────────────────────────

function MobilePack({ desk, platform, setPlatform, businesses, onScopeChanged, scopeTick, multi }) {
  const navigate = useNavigate();
  const { queue, loading, mode, setMode, latest, busy, date, setDate, record } = desk;
  const [camera, setCamera] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [tab, setTab] = useState("pending");
  const [typed, setTyped] = useState("");
  const [courier, setCourier] = useState(null);
  const [alerts, reloadAlerts] = useScanAlerts(platform, scopeTick);
  const [showAlerts, setShowAlerts] = useState(false);
  const [showShift, setShowShift] = useState(false);

  const items = queue?.items || [];
  const sum = queue?.summary;
  const inCourier = courier ? items.filter((i) => courierKey(i.courier) === courierKey(courier)) : items;
  const counts = useMemo(() => summaryCounts(inCourier), [inCourier]);
  const shown = inCourier.filter(FILTERS.find((f) => f.key === tab).test);
  const sel = useAdminSelect(desk, shown);
  const progress = { done: sum?.packed ?? 0, total: (sum?.assigned ?? 0) - (sum?.cancelled ?? 0), label: `${MODES.find((m) => m.key === mode).label}` };

  // Lock the page behind the fixed screen so it can't scroll under it.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 3000, background: C.white, display: "flex", flexDirection: "column",
      height: "100dvh", paddingTop: "env(safe-area-inset-top)",
    }}>
      {camera && (
        <BarcodeScanner
          continuous
          title="Pack orders"
          hint={`${MODES.find((m) => m.key === mode).help} — keep scanning`}
          progress={progress}
          latest={latest}
          busy={busy}
          onDetected={(code) => record(code)}
          onClose={() => setCamera(false)}
        />
      )}

      {/* Header */}
      <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", borderBottom: `1px solid ${C.gray100}`, flexShrink: 0 }}>
        <button onClick={() => navigate(-1)} aria-label="Back" style={{ background: "none", border: "none", padding: 4, cursor: "pointer", lineHeight: 0, color: C.gray700 }}>
          <ArrowBackIcon />
        </button>
        <div style={{ flex: "1 1 150px", minWidth: 150 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.gray900, whiteSpace: "nowrap" }}>Pack orders</div>
          <select value={date} onChange={(e) => setDate(e.target.value)}
            style={{ border: "none", background: "none", fontSize: 12, color: C.gray500, fontWeight: 600, padding: 0, fontFamily: "inherit", maxWidth: "100%" }}>
            {[...new Set([date, ...(queue?.dates || [])])].filter(Boolean).sort().reverse().map((d) => <option key={d} value={d}>{dayLabel(d, desk.currentDay)}</option>)}
          </select>
        </div>
        <DeskBusinesses desk={businesses} onChanged={onScopeChanged} compact />
        <PlatformToggle platform={platform} onChange={setPlatform} />
        <button onClick={() => setShowSummary(true)} style={{ ...btn("ghost", "sm"), minHeight: 38 }}>🖨 Courier summary</button>
      </div>
      {showSummary && (
        <div style={{ position: "fixed", inset: 0, zIndex: 3200, background: C.white, overflowY: "auto",
          padding: "calc(12px + env(safe-area-inset-top)) 14px calc(16px + env(safe-area-inset-bottom))" }}>
          <button onClick={() => setShowSummary(false)} style={{ ...btn("ghost", "sm"), marginBottom: 12 }}>← Back to scanning</button>
          <CourierSummary platform={platform} day={date} compact />
        </div>
      )}

      {/* Everything between the header and the scan bar scrolls as one, so the
          list always has room however many notices are showing. */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
      {/* Progress + last result */}
      <div style={{ padding: "12px 14px 10px", display: "flex", flexDirection: "column", gap: 12 }}>
        {loading && !queue ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 24 }}><CircularProgress style={{ color: C.orange }} /></div>
        ) : (
          <>
            <DayNotice desk={desk} compact />
            <ProgressBar done={progress.done} total={progress.total} label={`${progress.label} · ${sum?.pieces_packed ?? 0} of ${sum?.pieces ?? 0} pieces`} />
            <CourierSection desk={desk} items={items} sum={sum} active={courier} onPick={setCourier} compact />
            <AlertBanner alerts={alerts} onOpen={() => setShowAlerts(true)} compact />
            <UnsentBanner desk={desk} onOpen={() => setShowShift(true)} compact />
            {showShift && <ShiftPanel desk={desk} onClose={(moved) => { setShowShift(false); if (moved) reloadAlerts(); }} />}
            <LatestPanel latest={latest} busy={busy} minHeight={118} />
          </>
        )}
      </div>

      {showAlerts && alerts && (
        <div style={{ position: "fixed", inset: 0, zIndex: 3100, background: "rgba(0,0,0,.35)", padding: 12, overflowY: "auto" }}>
          <AlertsPanel alerts={alerts} onClose={() => setShowAlerts(false)} />
        </div>
      )}

      {/* Queue — the filters stay in view while the list scrolls */}
      <div style={{ display: "flex", gap: 6, padding: "8px 14px", position: "sticky", top: 0, zIndex: 2, background: C.white }}>
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setTab(f.key)}
            style={{
              flex: 1, padding: "8px 4px", borderRadius: 10, fontSize: 12.5, fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
              border: `1.5px solid ${tab === f.key ? C.orange : C.gray200}`,
              background: tab === f.key ? C.orange : C.white, color: tab === f.key ? "#fff" : C.gray600,
            }}>
            {f.label} {counts[f.key] ?? 0}
          </button>
        ))}
      </div>
      {sel.admin && <div style={{ padding: "0 14px 8px" }}><AdminBar sel={sel} shownCount={shown.length} compact /></div>}
      <div style={{ borderTop: `1px solid ${C.gray100}` }}>
        {shown.length === 0 ? (
          <div style={{ textAlign: "center", padding: 36, color: C.gray400, fontSize: 13 }}>
            {!items.length ? "No orders assigned for this day — upload the labels first." : tab === "pending" ? "Everything is packed. 🎉" : "Nothing here."}
          </div>
        ) : shown.map((i) => <ItemRow key={`${i.business_id}-${i.order_id}`} item={i} compact showBusiness={multi}
              admin={sel.admin} selecting={sel.selecting} selected={sel.isPicked(i)} onToggle={() => sel.toggle(i)} onSetStatus={(st) => sel.applyOne(i, st)}
              onMoveBack={async () => { await desk.shiftOrders([i], { undo: true }); reloadAlerts(); }} />)}
      </div>
      </div>

      {/* Bottom bar */}
      <div style={{ flexShrink: 0, padding: "10px 14px calc(10px + env(safe-area-inset-bottom))", borderTop: `1px solid ${C.gray200}`, background: C.white, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="…or type AWB / order no"
            onKeyDown={(e) => { if (e.key === "Enter") { record(typed); setTyped(""); } }}
            autoComplete="off" style={{ ...S.inp, flex: 1, fontFamily: "monospace", minWidth: 0 }} />
          <div style={{ display: "flex", background: C.gray100, borderRadius: 10, padding: 3 }}>
            {MODES.map((m) => (
              <button key={m.key} onClick={() => setMode(m.key)}
                style={{ border: "none", borderRadius: 8, padding: "6px 9px", fontSize: 11.5, fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
                  background: mode === m.key ? C.white : "transparent", color: mode === m.key ? C.orange : C.gray500 }}>{m.label}</button>
            ))}
          </div>
        </div>
        <button onClick={() => setCamera(true)}
          style={{ ...btn("primary", "lg"), padding: "17px 20px", fontSize: 18, borderRadius: 14, width: "100%" }}>
          <QrCodeScannerIcon style={{ fontSize: 26, verticalAlign: "-7px" }} />&nbsp;Scan parcel
        </button>
      </div>
    </div>
  );
}

// ── Desktop ───────────────────────────────────────────────────────────────────

function Tile({ label, value, color, onClick, active }) {
  return (
    <button onClick={onClick} style={{
      cursor: onClick ? "pointer" : "default", textAlign: "left", fontFamily: "inherit", background: active ? color : C.white,
      border: `1px solid ${active ? color : C.gray200}`, borderTop: `3px solid ${color}`, borderRadius: 12, padding: "10px 16px", minWidth: 112,
    }}>
      <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "monospace", color: active ? "#fff" : C.gray900, lineHeight: 1.1 }}>{value ?? "—"}</div>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: active ? "rgba(255,255,255,0.9)" : C.gray500, marginTop: 2 }}>{label}</div>
    </button>
  );
}

/** The scan record: every scan ever made, with Meesho's status beside our own. */
function ScanRecord({ platform, multi }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [ship, setShip] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const PAGE = 40;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page, page_size: PAGE });
      if (q.trim()) p.set("q", q.trim());
      if (ship === "UNMATCHED") p.set("matched", "no");
      else if (ship) p.set("ship", ship);
      if (platform) p.set("platform", platform);
      const res = await fetch(`${API}/order-scan/?${p}`);
      const data = await res.json();
      setRows(data.results || []); setTotal(data.total ?? 0); setStats(data.stats || null);
    } finally { setLoading(false); }
  }, [page, q, ship, platform]);
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);
  useEffect(() => { setPage(1); }, [q, ship]);

  const recheck = async () => {
    setBusy(true);
    try {
      const d = await fetch(`${API}/order-scan/refresh-ship/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then((r) => r.json());
      setNote(`Checked ${d.checked} · ${d.changed} status change(s)${d.relinked ? ` · ${d.relinked} unrecognised scan(s) now matched an order` : ""}`);
      await load();
    } finally { setBusy(false); }
  };
  const setStatus = async (id, status) => {
    await fetch(`${API}/order-scan/${id}/`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    load();
  };
  const remove = async (id) => {
    if (!window.confirm("Remove this scan from the record? The order itself is not touched.")) return;
    await fetch(`${API}/order-scan/${id}/`, { method: "DELETE" });
    load();
  };

  const SHIPS = [["", "All"], ["PROBLEM", "Cancelled / not shipped"], ["SHIPPED", "Shipped"], ["NOT_SHIPPED", "Not shipped yet"], ["CANCELLED", "Cancelled"], ["UNKNOWN", "No status"], ["UNMATCHED", "Not recognised"]];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {stats && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Tile label="Scanned in total" value={stats.total} color={C.orange} />
          <Tile label="Packed" value={stats.packed + stats.dispatched} color={C.green} />
          <Tile label="Shipped (marketplace)" value={stats.ship_shipped} color={C.green} />
          <Tile label="Not recognised" value={stats.unrecognised} color={C.amber} onClick={() => setShip("UNMATCHED")} active={ship === "UNMATCHED"} />
          <Tile label="Not shipped yet" value={stats.ship_not_shipped} color={C.amber} />
          <Tile label="Cancelled" value={stats.ship_cancelled} color={C.red} />
          <Tile label="On hold / problem" value={stats.needs_attention} color={C.red} />
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order / AWB / SKU…" style={{ ...S.inp, maxWidth: 280 }} />
        {SHIPS.map(([k, l]) => (
          <button key={k} onClick={() => setShip(k)}
            style={{ padding: "6px 12px", borderRadius: 20, fontSize: 12, fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
              border: `1.5px solid ${ship === k ? C.orange : C.gray200}`, background: ship === k ? C.orange : C.white, color: ship === k ? "#fff" : C.gray600 }}>{l}</button>
        ))}
        <button onClick={recheck} disabled={busy} style={{ ...btn("ghost", "sm"), marginLeft: "auto", opacity: busy ? 0.5 : 1 }}>
          <RefreshIcon style={{ fontSize: 15, verticalAlign: "-3px" }} />&nbsp;Re-check with uploaded sheets
        </button>
      </div>
      {note && <div style={{ fontSize: 12.5, color: C.green, fontWeight: 700 }}>✓ {note}</div>}
      <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
        {loading && !rows.length ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 40 }}><CircularProgress style={{ color: C.orange }} /></div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr>{["Scanned", "Order", "Item", "Our status", "Marketplace says", ""].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={6} style={{ ...S.td, textAlign: "center", padding: 36, color: C.gray400 }}>Nothing scanned yet.</td></tr>}
              {rows.map((r, idx) => {
                const ship = SHIP_META[r.ship_status] || SHIP_META.UNKNOWN;
                return (
                  <tr key={r.id} style={{ background: r.ship_status === "CANCELLED" ? C.redLight : idx % 2 ? C.gray50 : C.white }}>
                    <td style={{ ...S.td, whiteSpace: "nowrap", fontSize: 12, color: C.gray500 }}>{fmtTime(r.last_scanned_at)}{r.scan_count > 1 ? ` · ${r.scan_count}×` : ""}</td>
                    <td style={{ ...S.td, fontFamily: "monospace", fontSize: 12 }}>{r.sub_order_no}
                      <div style={{ color: C.gray400, fontSize: 11 }}>{[multi && r.business_name, r.awb_number, r.courier_name].filter(Boolean).join(" · ")}</div>
                      {r.matched_from === "NONE" && <Tag variant="amber">Not recognised</Tag>}</td>
                    <td style={S.td}><span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 12.5 }}>{r.sku || "—"}</span> <span style={{ color: C.orange, fontWeight: 800 }}>×{r.qty}</span></td>
                    <td style={S.td}>
                      <select value={r.status} onChange={(e) => setStatus(r.id, e.target.value)} style={{ ...S.inp, padding: "4px 8px", fontSize: 12, width: "auto" }}>
                        {Object.entries(STATE_META).filter(([k]) => k !== "PENDING").map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
                      </select>
                    </td>
                    <td style={S.td}><Tag variant={ship.tag}>{ship.label}</Tag>{r.ship_status_raw && <div style={{ fontSize: 10.5, color: C.gray400, marginTop: 2 }}>{r.ship_status_raw}</div>}</td>
                    <td style={S.td}><button onClick={() => remove(r.id)} title="Remove scan" style={{ background: "none", border: "none", cursor: "pointer", color: C.gray400 }}><DeleteOutlineIcon style={{ fontSize: 18 }} /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {total > PAGE && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", borderTop: `1px solid ${C.gray100}` }}>
            <span style={{ fontSize: 12, color: C.gray400 }}>{(page - 1) * PAGE + 1}–{Math.min(page * PAGE, total)} of {total}</span>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setPage((p) => p - 1)} disabled={page === 1} style={{ ...btn("ghost", "sm"), opacity: page === 1 ? 0.4 : 1 }}>← Prev</button>
              <button onClick={() => setPage((p) => p + 1)} disabled={page * PAGE >= total} style={{ ...btn("ghost", "sm"), opacity: page * PAGE >= total ? 0.4 : 1 }}>Next →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DesktopPack({ desk, platform, setPlatform, businesses, onScopeChanged, scopeTick, multi }) {
  const { queue, loading, mode, setMode, latest, busy, date, setDate, record, reload } = desk;
  const [view, setView] = useState("queue");          // queue | record | summary
  const [tab, setTab] = useState("pending");
  const [scan, setScan] = useState("");
  const [courier, setCourier] = useState(null);
  const [alerts, reloadAlerts] = useScanAlerts(platform, scopeTick);
  const [showAlerts, setShowAlerts] = useState(false);
  const [showShift, setShowShift] = useState(false);
  const input = useRef(null);
  const refocus = useCallback(() => setTimeout(() => input.current?.focus(), 0), []);
  useEffect(() => { if (view === "queue") refocus(); }, [view, refocus]);

  const items = queue?.items || [];
  const sum = queue?.summary;
  const inCourier = courier ? items.filter((i) => courierKey(i.courier) === courierKey(courier)) : items;
  const counts = useMemo(() => summaryCounts(inCourier), [inCourier]);
  const shown = inCourier.filter(FILTERS.find((f) => f.key === tab).test);
  const sel = useAdminSelect(desk, shown);

  const submit = async () => {
    const code = scan.trim();
    if (!code) return;
    setScan("");                       // cleared as soon as it is read — ready for the next parcel
    await record(code);
    refocus();
  };

  const toGo = (sum?.assigned ?? 0) - (sum?.cancelled ?? 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: C.gray900 }}>Order scan</h1>
          <p style={{ fontSize: 12, color: C.gray400, marginTop: 3 }}>Every label for the day is an order to pack — scan each parcel to tick it off and keep the record.</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <DeskBusinesses desk={businesses} onChanged={onScopeChanged} />
          <PlatformToggle platform={platform} onChange={setPlatform} />
          <select value={date} onChange={(e) => setDate(e.target.value)} style={{ ...S.inp, width: "auto" }}>
            {[...new Set([date, ...(queue?.dates || [])])].filter(Boolean).sort().reverse().map((d) => <option key={d} value={d}>{dayLabel(d, desk.currentDay)}</option>)}
          </select>
          <div style={{ display: "flex", background: C.gray100, borderRadius: 10, padding: 3 }}>
            {["queue", "record", "summary"].map((v) => (
              <button key={v} onClick={() => setView(v)}
                style={{ border: "none", borderRadius: 8, padding: "7px 16px", fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
                  background: view === v ? C.white : "transparent", color: view === v ? C.orange : C.gray500 }}>
                {v === "queue" ? "Today's list" : v === "record" ? "Scan record" : "🖨 Courier summary"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {view === "summary" ? <CourierSummary key={scopeTick} platform={platform} day={date} /> :
       view === "record" ? <ScanRecord key={scopeTick} platform={platform} multi={multi} /> : (
        <>
          <DayNotice desk={desk} />
          <AlertBanner alerts={alerts} onOpen={() => { setShowAlerts((v) => !v); reloadAlerts(); }} />
          <UnsentBanner desk={desk} onOpen={() => setShowShift(true)} />
          {showShift && <ShiftPanel desk={desk} onClose={(moved) => { setShowShift(false); if (moved) reloadAlerts(); }} />}
          {showAlerts && alerts && <AlertsPanel alerts={alerts} onClose={() => setShowAlerts(false)} />}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: C.gray700 }}>By courier — scanned / to send</span>
              {courier && <button onClick={() => setCourier(null)} style={btn("ghost", "sm")}>Show all couriers</button>}
            </div>
            <CourierSection desk={desk} items={items} sum={sum} active={courier} onPick={(c) => { setCourier(c); setTab(c ? "pending" : tab); refocus(); }} />
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Tile label="Assigned" value={sum?.assigned} color={C.gray600} onClick={() => setTab("all")} active={tab === "all"} />
            <Tile label="Packed" value={sum?.packed} color={C.green} onClick={() => setTab("done")} active={tab === "done"} />
            <Tile label="To pack" value={sum?.remaining} color={C.orange} onClick={() => setTab("pending")} active={tab === "pending"} />
            <Tile label={`Shipped (${platform === "flipkart" ? "Flipkart" : "Meesho"})`} value={sum?.shipped} color={C.green} />
            <Tile label="Not shipped yet" value={sum?.not_shipped} color={C.amber} />
            <Tile label="Cancelled" value={sum?.cancelled} color={C.red} onClick={() => setTab("issues")} active={tab === "issues"} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(380px, 440px)", gap: 18, alignItems: "start" }}>
            <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
              <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderBottom: `1px solid ${C.gray100}`, alignItems: "center" }}>
                {FILTERS.map((f) => (
                  <button key={f.key} onClick={() => { setTab(f.key); refocus(); }}
                    style={{ padding: "6px 13px", borderRadius: 20, fontSize: 12.5, fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
                      border: `1.5px solid ${tab === f.key ? C.orange : C.gray200}`, background: tab === f.key ? C.orange : C.white, color: tab === f.key ? "#fff" : C.gray600 }}>
                    {f.label} · {counts[f.key] ?? 0}
                  </button>
                ))}
                {courier && <Tag variant="orange">🚚 {courier}</Tag>}
                <button onClick={() => { reload(); refocus(); }} style={{ ...btn("ghost", "sm"), marginLeft: "auto" }}>
                  <RefreshIcon style={{ fontSize: 15, verticalAlign: "-3px" }} />&nbsp;Refresh
                </button>
              </div>
              {sel.admin && <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.gray100}` }}><AdminBar sel={sel} shownCount={shown.length} /></div>}
              {loading && !queue ? (
                <div style={{ display: "flex", justifyContent: "center", padding: 44 }}><CircularProgress style={{ color: C.orange }} /></div>
              ) : shown.length === 0 ? (
                <div style={{ textAlign: "center", padding: 44, color: C.gray400, fontSize: 13 }}>
                  {!items.length ? "No orders assigned for this day — upload the labels first." : tab === "pending" ? "Everything is packed. 🎉" : "Nothing here."}
                </div>
              ) : shown.map((i) => <ItemRow key={`${i.business_id}-${i.order_id}`} item={i} showBusiness={multi}
                    admin={sel.admin} selecting={sel.selecting} selected={sel.isPicked(i)} onToggle={() => sel.toggle(i)} onSetStatus={(st) => sel.applyOne(i, st)}
              onMoveBack={async () => { await desk.shiftOrders([i], { undo: true }); reloadAlerts(); }} />)}
            </div>

            <div style={{ position: "sticky", top: 12, display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ ...S.card, padding: "16px 18px", borderTop: `3px solid ${C.orange}`, display: "flex", flexDirection: "column", gap: 14 }}>
                <ProgressBar done={sum?.packed ?? 0} total={toGo} label={`Packed · ${sum?.pieces_packed ?? 0} of ${sum?.pieces ?? 0} pieces`} />
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: C.gray500 }}>Marking as</span>
                  <div style={{ display: "flex", background: C.gray100, borderRadius: 10, padding: 3 }}>
                    {MODES.map((m) => (
                      <button key={m.key} onClick={() => { setMode(m.key); refocus(); }}
                        style={{ border: "none", borderRadius: 8, padding: "6px 14px", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
                          background: mode === m.key ? C.white : "transparent", color: mode === m.key ? C.orange : C.gray500 }}>{m.label}</button>
                    ))}
                  </div>
                </div>
                <div style={{ position: "relative" }}>
                  <QrCodeScannerIcon style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: C.orange, fontSize: 24 }} />
                  <input
                    ref={input}
                    value={scan}
                    onChange={(e) => setScan(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                    onBlur={(e) => { if (view === "queue" && !e.relatedTarget) refocus(); }}
                    placeholder="Scan the parcel…"
                    autoComplete="off" spellCheck={false}
                    style={{ ...S.inp, width: "100%", boxSizing: "border-box", fontSize: 20, fontFamily: "monospace", fontWeight: 700,
                      padding: "14px 16px 14px 48px", background: C.orangeLight, borderColor: C.orangeBorder }}
                  />
                </div>
                <LatestPanel latest={latest} busy={busy} />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Tab ───────────────────────────────────────────────────────────────────────
export function OrderScanTab() {
  const isMobile = useIsMobile();
  const [platform, setPlatform] = useLabelPlatform();
  const desk = useScanDesk(platform);
  const businesses = useDeskBusinesses();
  // Bumped when the combined businesses change, so everything re-reads.
  const [scopeTick, setScopeTick] = useState(0);
  const onScopeChanged = () => { setScopeTick((t) => t + 1); desk.reload(); };
  const props = { desk, platform, setPlatform, businesses, onScopeChanged, scopeTick,
    multi: (businesses.info?.selected?.length || 0) > 1 };
  return isMobile ? <MobilePack {...props} /> : <DesktopPack {...props} />;
}
