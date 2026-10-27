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
  // Parcels scanned that belong to an earlier day's list. Nothing is added to
  // today's list until someone says yes (addEarlier) — or an admin moves them.
  const [asks, setAsks] = useState([]);
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
        kind = "err"; title = "NOT RECOGNISED — check with admin";
        if (!what) lines.unshift(code);
        lines.push("No label or order matches this code. Set this parcel aside — an admin checks it and files it under the right courier.");
        navigator.vibrate?.([120, 80, 120]);
      } else if (!item) {
        kind = "warn"; title = `${title} · not in this day's list`;
      } else if (data.already_scanned) {
        kind = "warn"; title = `Already scanned ${row.scan_count}×`;
      } else if (mode === "DISPATCHED" && ship === "NOT_SHIPPED") {
        kind = "warn"; title = "Dispatched · Meesho not showing shipped";
        lines.push("The panel still lists it as ready to ship.");
      }
      if (data.earlier_day) {
        lines.push(`From ${fmtDay(data.earlier_day.day)}'s list — not on today's. Add it to today's list below.`);
        if (kind === "ok") { kind = "warn"; title = `${title} · earlier day's order`; }
        setAsks((a) => (a.some((x) => x.order_id === data.earlier_day.order_id && x.business_id === data.earlier_day.business_id)
          ? a : [...a, { ...data.earlier_day, sku: row.sku, qty: row.qty, courier: row.courier_name }]));
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

  /** Yes to "add to today's list?": move the asked-about orders onto the open day. */
  const addEarlier = async (items) => {
    const res = await fetch(`${API}/order-scan/shift/`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to_day: queueRef.current?.date, items: items.map((i) => ({ business_id: i.business_id, order_id: i.order_id })) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.error || "Could not add those orders." };
    setAsks((a) => a.filter((x) => !items.some((i) => i.order_id === x.order_id && i.business_id === x.business_id)));
    await load();
    return data;
  };
  const dismissAsks = () => setAsks([]);

  /** Admin: file a scan nothing recognised under a courier, so it counts there. */
  const assignCourier = async (scanId, courier) => {
    const res = await fetch(`${API}/order-scan/${scanId}/`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ courier_name: courier }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.error || "Could not assign that courier." };
    await load();
    return data;
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
  return { date, setDate, following, currentDay, backToToday, startToday, queue, loading, mode, setMode, latest, busy, error, setError, record, reload: load, setStatusByHand, shiftOrders, assignCourier, asks, addEarlier, dismissAsks };
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
    <div role="status" aria-live="polite" style={{
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

function ItemRow({ item, compact, showBusiness, admin, selecting, selected, onToggle, onSetStatus, onMoveBack }) {
  const bucket = bucketOf(item);
  // The badge says where the order is now, not just the last thing scanned.
  const st = bucket === "shipped" ? { label: "Shipped", tag: "green" }
    : bucket === "cancelled" ? { label: "Cancelled", tag: "red" }
    : item.state === "DISPATCHED" ? { label: "Dispatched · not shipped yet", tag: "amber" }
    : (STATE_META[item.state] || STATE_META.PENDING);
  const ship = SHIP_META[item.ship_status] || SHIP_META.UNKNOWN;
  const cancelled = bucket === "cancelled";
  return (
    <div onClick={selecting ? onToggle : undefined} style={{
      display: "flex", gap: 12, alignItems: "center", padding: compact ? "12px 12px" : "12px 16px",
      borderBottom: `1px solid ${C.gray100}`, background: selected ? C.orangeLight : cancelled ? C.redLight : C.white,
      cursor: selecting ? "pointer" : "default",
    }}>
      {selecting && <input type="checkbox" checked={!!selected} onChange={onToggle} onClick={(e) => e.stopPropagation()}
        style={{ width: 20, height: 20, accentColor: C.orange, flexShrink: 0 }} />}
      <Photo url={item.image_url} size={compact ? 46 : 52} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 14.5, color: C.gray900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.sku || "—"}</span>
          <span style={{ fontFamily: "monospace", fontWeight: 900, fontSize: 12.5, color: C.orange, background: C.orangeLight, borderRadius: 6, padding: "1px 6px", flexShrink: 0 }}>×{item.qty}</span>
        </div>
        <div style={{ fontSize: 12.5, color: C.gray600, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.courier && <span style={{ fontWeight: 800, color: courierTone(item.courier).fg, background: courierTone(item.courier).bg,
            border: `1px solid ${courierTone(item.courier).border}`, borderRadius: 6, padding: "0 6px", marginRight: 6 }}>{cleanCourier(item.courier)}</span>}
          {[showBusiness && item.business_name, item.customer_city, item.awb].filter(Boolean).join(" · ")}
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
        {(item.state !== "PENDING" || cancelled) && item.ship_status !== "UNKNOWN" && bucket !== "shipped" && !cancelled && item.state !== "DISPATCHED" && (
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

/**
 * Where an order sits on the desk — exactly one place, so the tab counts add up
 * and an order never shows in two lists:
 *   cancelled → shipped → on hold / problem → to pack (never scanned) → packed.
 * "Shipped" means the MARKETPLACE shows it shipped. Marking a parcel Dispatched
 * here is only our hand-over to the courier: it stays under Packed (with a
 * Dispatched badge) until Meesho / Flipkart's sheet confirms it shipped, and
 * until then an unshipped order carries over to the next day.
 */
function bucketOf(i) {
  if (i.ship_status === "CANCELLED" || i.state === "CANCELLED") return "cancelled";
  if (i.ship_status === "SHIPPED") return "shipped";
  if (i.state === "ON_HOLD" || i.state === "ISSUE") return "issues";
  if (i.state === "PENDING") return "pending";
  return "packed";
}

const FILTERS = [
  { key: "pending",   label: "To pack",   test: (i) => bucketOf(i) === "pending" },
  { key: "packed",    label: "Packed",    test: (i) => bucketOf(i) === "packed" },
  { key: "shipped",   label: "Shipped",   test: (i) => bucketOf(i) === "shipped" },
  { key: "cancelled", label: "Cancelled", test: (i) => bucketOf(i) === "cancelled" },
  { key: "issues",    label: "On hold",   test: (i) => bucketOf(i) === "issues" },
  { key: "all",       label: "All",       test: () => true },
];
// On a phone only these show their orders; the rest show per-courier counts.
const PHONE_LIST_TABS = ["pending", "issues"];

const cleanCourier = (c) => (c || "").split(/\s+/).filter(Boolean).join(" ") || "No courier on label";

/**
 * Brand colour per courier, so a card is recognised before it is read:
 * Valmo blue, Ekart sky blue, Delhivery red, XpressBees orange (#F58220) and
 * Shadowfax green (#008771) — the last two from their published brand palettes.
 * Anything else stays neutral.
 */
function courierTone(name) {
  const n = (name || "").toLowerCase();
  if (n.includes("valmo")) return { fg: "#1D4ED8", bg: "#EFF6FF", border: "#93C5FD", solid: "#2563EB" };
  if (n.includes("ekart")) return { fg: "#0369A1", bg: "#F0F9FF", border: "#7DD3FC", solid: "#0EA5E9" };
  if (/delhivery|delivery/.test(n)) return { fg: "#B91C1C", bg: "#FEF2F2", border: "#FCA5A5", solid: "#DC2626" };
  if (n.includes("xpress")) return { fg: "#B45309", bg: "#FFF7ED", border: "#FDBA74", solid: "#F58220" };
  if (n.includes("shadowfax")) return { fg: "#006B5A", bg: "#F0FDFA", border: "#5EEAD4", solid: "#008771" };
  return { fg: C.gray700, bg: C.gray50, border: C.gray200, solid: C.gray500 };
}

/**
 * Courier tiles from the list itself, so a tile moves the moment a parcel is
 * scanned (the list is updated straight away; the server copy only after a pause).
 * `total` is everything packed for that courier on the day — still waiting for
 * pickup (`packed`) plus already shipped (`shipped`) — so the number holds
 * steady after a sheet marks parcels shipped, and a previous day's figure stays
 * on screen until the new day starts. `left` is what is still to pack.
 * Cancelled orders are not in it.
 */
function courierStats(items, offList = []) {
  const by = new Map();
  for (const i of items) {
    const b = bucketOf(i);
    if (b === "cancelled") continue;
    const name = cleanCourier(i.courier);
    const key = name.toLowerCase();
    if (!by.has(key)) by.set(key, { courier: name, packed: 0, shipped: 0, left: 0, total: 0 });
    const c = by.get(key);
    if (b === "packed") c.packed += 1;
    else if (b === "shipped") c.shipped += 1;
    else if (b === "pending") c.left += 1;
    c.total = c.packed + c.shipped;
  }
  // Parcels scanned that day that aren't on its labels (labels not uploaded
  // yet, or a code the system didn't know) are still packed — count them under
  // their courier so the day's number is never short.
  for (const o of offList) {
    const name = cleanCourier(o.courier);
    const key = name.toLowerCase();
    if (!by.has(key)) by.set(key, { courier: name, packed: 0, shipped: 0, left: 0, total: 0 });
    const c = by.get(key);
    c.packed += o.scanned;
    c.total = c.packed + c.shipped;
  }
  return [...by.values()].filter((c) => c.total || c.left)
    .sort((a, b) => b.total - a.total || b.left - a.left || a.courier.localeCompare(b.courier));
}

/** Orders per courier for one set of items — the phone's stand-in for a list. */
function countsByCourier(items) {
  const by = new Map();
  for (const i of items) {
    const name = cleanCourier(i.courier);
    const key = name.toLowerCase();
    if (!by.has(key)) by.set(key, { courier: name, orders: 0, pieces: 0 });
    const c = by.get(key);
    c.orders += 1; c.pieces += Number(i.qty) || 0;
  }
  return [...by.values()].sort((a, b) => b.orders - a.orders || a.courier.localeCompare(b.courier));
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
          Showing {fmtDay(date)}'s counts{compact ? " until today's first scan" : ` — they stay up until the first new order is scanned today (from 12 pm), then today's list takes over.`}
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

/**
 * One card per courier, in the courier's colour: the PACKED total, big — the
 * number the pickup is checked against — with how many are still waiting, how
 * many have shipped, and how many are left to pack. Tapping a card narrows the
 * list below to that courier. Two to a row on a phone.
 */
function CourierTiles({ couriers, active, onPick, compact }) {
  if (!couriers?.length) return null;
  return (
    <div style={{ display: "grid", gap: compact ? 8 : 10,
      gridTemplateColumns: compact ? "repeat(2, minmax(0, 1fr))" : "repeat(auto-fill, minmax(190px, 1fr))" }}>
      {couriers.map((c) => {
        const on = active === c.courier;
        const t = courierTone(c.courier);
        const done = c.left === 0;
        const detail = [c.packed ? `${c.packed} waiting` : null, c.shipped ? `${c.shipped} shipped` : null].filter(Boolean).join(" · ");
        return (
          <button key={c.courier} onClick={() => onPick(on ? null : c.courier)} aria-pressed={on} className="os-btn"
            aria-label={`${c.courier}: ${c.total} packed${detail ? ` (${detail})` : ""}, ${c.left} left to pack`}
            style={{ textAlign: "left", cursor: "pointer", fontFamily: "inherit", minWidth: 0, overflow: "hidden",
              background: on ? t.bg : C.white, border: `2px solid ${on ? t.solid : t.border}`, borderTop: `6px solid ${t.solid}`,
              borderRadius: 14, padding: compact ? "8px 12px 10px" : "10px 14px 12px", display: "flex", flexDirection: "column", gap: 4,
              boxShadow: on ? `0 0 0 2px ${t.border}` : "none" }}>
            <span style={{ fontSize: compact ? 13 : 14, fontWeight: 900, color: t.fg, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {c.courier}
            </span>
            <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ fontFamily: "monospace", fontWeight: 900, fontSize: compact ? 34 : 38, lineHeight: 1, color: C.gray900 }}>{c.total}</span>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: C.gray600 }}>packed</span>
            </span>
            {detail && <span style={{ fontSize: 12, fontWeight: 600, color: C.gray600 }}>{detail}</span>}
            <span style={{ fontSize: 12.5, fontWeight: 800, color: done ? "#15803D" : C.red }}>
              {done ? "✓ none left to pack" : `${c.left} left to pack`}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The courier KPIs, always shown: each courier's packed count (waiting for
 * pickup) and how many are left to pack. Scans that aren't on the day's labels
 * are counted per courier too. With nothing for the day, it says why and offers
 * the latest day that has labels.
 */
function CourierSection({ desk, items, sum, active, onPick, compact }) {
  const off = (sum?.off_list_by_courier || []).filter((c) => c.scanned);
  const tiles = courierStats(items, off);
  const latest = desk.queue?.latest_label_day;
  const packedTotal = tiles.reduce((n, c) => n + c.total, 0);
  if (!items.length && !off.length) {
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 13.5, fontWeight: 800, color: C.gray800 }}>Packed by courier · {fmtDay(desk.date)}</span>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: C.gray600 }}>
          <b style={{ fontFamily: "monospace", color: C.gray900, fontSize: 16 }}>{packedTotal}</b> in total
        </span>
      </div>
      {tiles.length > 0
        ? <CourierTiles couriers={tiles} active={active} onPick={onPick} compact={compact} />
        : <div style={{ fontSize: 12.5, fontWeight: 700, color: C.green }}>Nothing packed or left to pack for this day.</div>}
    </div>
  );
}

/**
 * Phone stand-in for a list: orders per courier for the open tab. The full
 * order-by-order list is for the bigger screen — on a phone the number per
 * delivery partner is what matters and it can be read at a glance.
 */
function BucketCounts({ items, label, hint, color }) {
  const rows = countsByCourier(items);
  const total = items.length;
  return (
    <div style={{ padding: "14px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: C.gray700 }}>{label} by courier</span>
        <span style={{ fontFamily: "monospace", fontWeight: 900, fontSize: 28, color }}>{total}</span>
      </div>
      {rows.length === 0 ? (
        <div style={{ textAlign: "center", padding: 28, color: C.gray400, fontSize: 13 }}>Nothing here.</div>
      ) : (
        <div style={{ border: `1px solid ${C.gray100}`, borderRadius: 12, overflow: "hidden" }}>
          {rows.map((r, idx) => (
            <div key={r.courier} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px",
              borderTop: idx ? `1px solid ${C.gray100}` : "none", borderLeft: `6px solid ${courierTone(r.courier).solid}`, background: C.white }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 800, color: courierTone(r.courier).fg, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.courier}
              </span>
              <span style={{ fontSize: 12.5, color: C.gray500 }}>{r.pieces} pcs</span>
              <span style={{ fontFamily: "monospace", fontWeight: 900, fontSize: 22, color, minWidth: 34, textAlign: "right" }}>{r.orders}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ fontSize: 12.5, color: C.gray500, marginTop: 10, lineHeight: 1.5 }}>{hint} The full order list opens on a larger screen.</div>
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
      <span style={{ fontSize: 12.5, fontWeight: 800, color: C.orange, whiteSpace: "nowrap" }}>Move to today →</span>
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
            Nothing moves by itself — you pick which ones. They haven't shipped on the marketplace; packed ones and
            cancelled ones you scanned (still in the bag) are included. The ones you move join {fmtDay(desk.date)}'s
            list and courier counts; the rest stay where they are.
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
                  {i.ship_status === "CANCELLED"
                    ? <Tag variant="red">Cancelled · in bag</Tag>
                    : <Tag variant={(STATE_META[i.state] || STATE_META.PENDING).tag}>{(STATE_META[i.state] || STATE_META.PENDING).label}</Tag>}
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

/**
 * Scanned parcels that belong to an earlier day's list. They are only added to
 * today's list when someone says so — scanning one never moves it by itself.
 */
function EarlierAskBanner({ desk, compact }) {
  const { asks, addEarlier, dismissAsks, date } = desk;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (!asks.length) return null;
  const days = [...new Set(asks.map((a) => fmtDay(a.day)))].join(", ");
  const add = async () => {
    setBusy(true); setError(null);
    const d = await addEarlier(asks);
    setBusy(false);
    if (d.error) setError(d.error);
  };
  return (
    <div role="alert" style={{ background: "#EFF6FF", border: "2px solid #60A5FA", borderRadius: 12, padding: compact ? "10px 12px" : "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: compact ? 13.5 : 14.5, fontWeight: 800, color: "#1E3A8A", lineHeight: 1.4 }}>
        {asks.length} scanned parcel{asks.length === 1 ? " is" : "s are"} from an earlier day ({days}).
        <span style={{ fontWeight: 600 }}> Add {asks.length === 1 ? "it" : "them"} to {date === desk.currentDay ? "today's" : `${fmtDay(date)}'s`} list?</span>
      </div>
      <div style={{ fontSize: 12.5, color: "#1E3A8A", fontFamily: "monospace", wordBreak: "break-all" }}>
        {asks.slice(0, 3).map((a) => a.sku || a.order_id).join(" · ")}{asks.length > 3 ? ` · +${asks.length - 3} more` : ""}
      </div>
      {error && <div style={{ fontSize: 12.5, color: C.red, fontWeight: 700 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={add} disabled={busy} className="os-btn" style={{ ...btn("primary", "md"), minHeight: 44, flex: 1, opacity: busy ? 0.6 : 1 }}>
          {busy ? "Adding…" : `Add ${asks.length} to today's list`}
        </button>
        <button onClick={dismissAsks} disabled={busy} className="os-btn" style={{ ...btn("ghost", "md"), minHeight: 44 }}>Not now</button>
      </div>
    </div>
  );
}

/** A small pill — the list of parcels nothing recognised opens only when it is clicked. */
function UnrecognisedChip({ desk, onOpen }) {
  const n = desk.queue?.unrecognised?.length || 0;
  if (!n) return null;
  return (
    <button onClick={onOpen} className="os-btn" aria-label={`${n} parcels not recognised — view`}
      style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", fontFamily: "inherit",
        minHeight: 36, padding: "6px 12px", borderRadius: 999, background: C.white, border: `1.5px solid ${C.red}`, color: C.red, fontSize: 12.5, fontWeight: 800 }}>
      ✕ Not recognised · {n}
    </button>
  );
}

const COURIER_CHOICES = ["Valmo", "Delhivery", "XpressBees", "Shadowfax", "Ekart"];

function UnrecognisedPanel({ desk, onClose }) {
  const list = desk.queue?.unrecognised || [];
  const admin = !!desk.queue?.is_admin;
  const couriers = useMemo(() => {
    const seen = new Map(COURIER_CHOICES.map((c) => [c.toLowerCase(), c]));
    (desk.queue?.items || []).forEach((i) => { const n = cleanCourier(i.courier); if (i.courier && !seen.has(n.toLowerCase())) seen.set(n.toLowerCase(), n); });
    return [...seen.values()];
  }, [desk.queue]);
  const [pick, setPick] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);
  const assign = async (u) => {
    const courier = pick[u.id];
    if (!courier) return;
    setBusyId(u.id); setError(null);
    const d = await desk.assignCourier(u.id, courier);
    setBusyId(null);
    if (d.error) setError(d.error);
  };
  return (
    <div role="dialog" aria-modal="true" aria-label="Parcels not recognised" onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 3300, background: "rgba(0,0,0,.4)", padding: 12, overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...S.card, maxWidth: 640, margin: "24px auto", padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "14px 16px", borderBottom: `1px solid ${C.gray100}`, display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 900, color: C.red }}>✕ Parcels not recognised · {list.length}</div>
            <div style={{ fontSize: 12.5, color: C.gray600, marginTop: 3, lineHeight: 1.5 }}>
              No label or order matches these codes. {admin
                ? "Check the parcel, then pick its courier — it is then counted under that courier."
                : "Keep them aside — an admin checks each one and files it under the right courier."}
            </div>
          </div>
          <button onClick={onClose} className="os-btn" style={btn("ghost", "sm")}>Close</button>
        </div>
        {error && <div style={{ padding: "8px 16px", color: C.red, fontWeight: 700, fontSize: 13 }}>{error}</div>}
        {list.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", color: C.green, fontWeight: 800 }}>✓ All filed.</div>
        ) : list.map((u) => (
          <div key={u.id} style={{ padding: "12px 16px", borderTop: `1px solid ${C.gray100}`, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 200px", minWidth: 0 }}>
              <div style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 14, wordBreak: "break-all" }}>{u.code}</div>
              <div style={{ fontSize: 12, color: C.gray500 }}>{fmtTime(u.scanned_at)}{u.scan_count > 1 ? ` · scanned ${u.scan_count}×` : ""}</div>
            </div>
            {admin && (
              <>
                <select value={pick[u.id] || ""} onChange={(e) => setPick((p) => ({ ...p, [u.id]: e.target.value }))} aria-label={`Courier for ${u.code}`} className="os-in"
                  style={{ ...S.inp, width: "auto", minHeight: 44, fontWeight: 700 }}>
                  <option value="">Choose courier…</option>
                  {couriers.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <button onClick={() => assign(u)} disabled={!pick[u.id] || busyId === u.id} className="os-btn"
                  style={{ ...btn("primary", "md"), minHeight: 44, opacity: !pick[u.id] || busyId === u.id ? 0.5 : 1 }}>
                  {busyId === u.id ? "Saving…" : "Assign"}
                </button>
              </>
            )}
          </div>
        ))}
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

// ── Shared layout pieces ──────────────────────────────────────────────────────

const TAB_TONE = { pending: C.orange, packed: C.green, shipped: "#15803D", cancelled: C.red, issues: "#B45309", all: C.gray700 };

/** Focus rings and reduced motion for the whole desk — keyboard and switch users can see where they are. */
const DESK_CSS = `
  .os-btn:focus-visible, .os-in:focus-visible { outline: 3px solid #2563EB; outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) { .os-desk * { transition: none !important; } }
`;

/**
 * The status tabs. The big number IS the tab: one control that both reports the
 * count and switches the list, instead of a row of tiles repeating a row of tabs.
 */
function StatTabs({ tabs, tab, onPick, counts, compact }) {
  return (
    <div role="tablist" aria-label="Orders by status"
      style={{ display: "grid", gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))`, gap: compact ? 6 : 8 }}>
      {tabs.map((f) => {
        const on = tab === f.key;
        const tone = TAB_TONE[f.key] || C.gray700;
        return (
          <button key={f.key} role="tab" aria-selected={on} className="os-btn" onClick={() => onPick(f.key)}
            style={{ cursor: "pointer", fontFamily: "inherit", minHeight: compact ? 64 : 74, padding: "8px 4px", borderRadius: 14,
              border: `2px solid ${on ? tone : C.gray200}`, background: on ? tone : C.white, color: on ? "#fff" : C.gray800,
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, transition: "background .15s" }}>
            <span style={{ fontFamily: "monospace", fontWeight: 900, fontSize: compact ? 24 : 28, lineHeight: 1 }}>{counts[f.key] ?? 0}</span>
            <span style={{ fontSize: compact ? 12 : 13, fontWeight: 700, color: on ? "rgba(255,255,255,.95)" : C.gray600 }}>{f.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** One line of progress: how much of the day has gone out, and what is left to pack. */
function DayProgress({ counts, pieces }) {
  const total = counts.pending + counts.packed + counts.shipped + counts.issues;
  const done = counts.packed + counts.shipped;
  const pct = total ? Math.min(100, (done / total) * 100) : 0;
  const left = counts.pending;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: C.gray800 }}>
          <span style={{ fontFamily: "monospace", fontSize: 22, color: C.gray900 }}>{done}</span>
          <span style={{ color: C.gray500 }}> of {total} packed</span>
          {pieces ? <span style={{ color: C.gray500, fontWeight: 600, fontSize: 12.5 }}> · {pieces.packed}/{pieces.total} pcs</span> : null}
        </span>
        <span style={{ fontSize: 14, fontWeight: 800, color: left ? C.orange : C.green }}>
          {total === 0 ? "" : left ? `${left} left to pack` : "✓ All packed"}
        </span>
      </div>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Orders packed"
        style={{ height: 10, borderRadius: 99, background: C.gray100, overflow: "hidden", marginTop: 8 }}>
        <div style={{ height: "100%", width: `${pct}%`, background: C.green, borderRadius: 99, transition: "width .25s" }} />
      </div>
    </div>
  );
}

/** Pack / Dispatch — what a scan will do. Large enough to hit, and says what it means. */
function ModeSwitch({ mode, setMode, onChanged, showHelp }) {
  return (
    <div>
      <div role="radiogroup" aria-label="What a scan does" style={{ display: "flex", background: C.gray100, borderRadius: 12, padding: 4, gap: 4 }}>
        {MODES.map((m) => {
          const on = mode === m.key;
          return (
            <button key={m.key} role="radio" aria-checked={on} className="os-btn" onClick={() => { setMode(m.key); onChanged?.(); }}
              style={{ flex: 1, minHeight: 44, border: "none", borderRadius: 9, padding: "8px 12px", fontSize: 14, fontWeight: 800, fontFamily: "inherit",
                cursor: "pointer", background: on ? C.white : "transparent", color: on ? C.orange : C.gray600,
                boxShadow: on ? "0 1px 3px rgba(0,0,0,.15)" : "none" }}>
              {m.key === "PACKED" ? "📦 Pack" : "🚚 Dispatch"}
            </button>
          );
        })}
      </div>
      {showHelp && <div style={{ fontSize: 12, color: C.gray500, marginTop: 6 }}>Scans are {MODES.find((m) => m.key === mode).help}.</div>}
    </div>
  );
}

function Notice({ children }) { return <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>; }

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
  const [showUnrec, setShowUnrec] = useState(false);

  const items = queue?.items || [];
  const sum = queue?.summary;
  const inCourier = courier ? items.filter((i) => courierKey(i.courier) === courierKey(courier)) : items;
  const counts = useMemo(() => summaryCounts(inCourier), [inCourier]);
  const allCounts = useMemo(() => summaryCounts(items), [items]);
  const shown = inCourier.filter(FILTERS.find((f) => f.key === tab).test);
  const sel = useAdminSelect(desk, shown);
  const progress = { done: sum?.packed ?? 0, total: (sum?.assigned ?? 0) - (sum?.cancelled ?? 0), label: `${MODES.find((m) => m.key === mode).label}` };
  const listTab = PHONE_LIST_TABS.includes(tab);
  const tabs = FILTERS.filter((f) => f.key !== "all" && (f.key !== "issues" || allCounts.issues > 0 || tab === "issues"));
  const TAB_INFO = {
    packed:    { label: "Packed", color: C.green, hint: "Packed (or handed to the courier) but the marketplace doesn't show it shipped yet." },
    shipped:   { label: "Shipped", color: "#15803D", hint: "The marketplace shows these as shipped." },
    cancelled: { label: "Cancelled", color: C.red, hint: "Don't hand these over — keep them aside." },
  };
  const submitTyped = () => { if (typed.trim()) { record(typed); setTyped(""); } };

  // Lock the page behind the fixed screen so it can't scroll under it.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div className="os-desk" style={{
      position: "fixed", inset: 0, zIndex: 3000, background: C.gray50, display: "flex", flexDirection: "column",
      height: "100dvh", paddingTop: "env(safe-area-inset-top)",
    }}>
      <style>{DESK_CSS}</style>
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

      {/* Header — title and day on one line, the rest in one scrollable row */}
      <div style={{ padding: "8px 12px", display: "flex", flexDirection: "column", gap: 8, background: C.white, borderBottom: `1px solid ${C.gray200}`, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={() => navigate(-1)} aria-label="Back" className="os-btn"
            style={{ background: "none", border: "none", width: 44, height: 44, cursor: "pointer", lineHeight: 0, color: C.gray700, flexShrink: 0 }}>
            <ArrowBackIcon />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: C.gray900, whiteSpace: "nowrap" }}>Pack orders</div>
            <select value={date} onChange={(e) => setDate(e.target.value)} aria-label="Packing day" className="os-in"
              style={{ border: "none", background: "none", fontSize: 13, color: C.gray600, fontWeight: 700, padding: 0, fontFamily: "inherit", maxWidth: "100%" }}>
              {[...new Set([date, ...(queue?.dates || [])])].filter(Boolean).sort().reverse().map((d) => <option key={d} value={d}>{dayLabel(d, desk.currentDay)}</option>)}
            </select>
          </div>
          <PlatformToggle platform={platform} onChange={setPlatform} />
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", overflowX: "auto" }}>
          <DeskBusinesses desk={businesses} onChanged={onScopeChanged} compact />
          <button onClick={() => setShowSummary(true)} className="os-btn" style={{ ...btn("ghost", "sm"), minHeight: 40, whiteSpace: "nowrap", flexShrink: 0 }}>🖨 Courier summary</button>
        </div>
      </div>
      {showSummary && (
        <div style={{ position: "fixed", inset: 0, zIndex: 3200, background: C.white, overflowY: "auto",
          padding: "calc(12px + env(safe-area-inset-top)) 14px calc(16px + env(safe-area-inset-bottom))" }}>
          <button onClick={() => setShowSummary(false)} className="os-btn" style={{ ...btn("ghost", "md"), marginBottom: 12 }}>← Back to scanning</button>
          <CourierSummary platform={platform} day={date} compact />
        </div>
      )}

      {/* Everything between the header and the scan bar scrolls as one. */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <div style={{ padding: "12px 12px 10px", display: "flex", flexDirection: "column", gap: 12 }}>
          {loading && !queue ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 24 }}><CircularProgress style={{ color: C.orange }} /></div>
          ) : (
            <>
              <DayNotice desk={desk} compact />
              <CourierSection desk={desk} items={items} sum={sum} active={courier} onPick={setCourier} compact />
              <div style={{ background: C.white, border: `1px solid ${C.gray200}`, borderRadius: 16, padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
                <DayProgress counts={allCounts} pieces={sum ? { packed: sum.pieces_packed ?? 0, total: sum.pieces ?? 0 } : null} />
                <StatTabs tabs={tabs} tab={tab} onPick={setTab} counts={counts} compact />
                {courier && (
                  <button onClick={() => setCourier(null)} className="os-btn" style={{ ...btn("ghostOrange", "sm"), alignSelf: "flex-start", minHeight: 36 }}>
                    🚚 {courier} · show all couriers ✕
                  </button>
                )}
                <UnrecognisedChip desk={desk} onOpen={() => setShowUnrec(true)} />
              </div>
              <EarlierAskBanner desk={desk} compact />
              {showUnrec && <UnrecognisedPanel desk={desk} onClose={() => setShowUnrec(false)} />}
              <AlertBanner alerts={alerts} onOpen={() => setShowAlerts(true)} compact />
              <UnsentBanner desk={desk} onOpen={() => setShowShift(true)} compact />
              {showShift && <ShiftPanel desk={desk} onClose={(moved) => { setShowShift(false); if (moved) reloadAlerts(); }} />}
              <LatestPanel latest={latest} busy={busy} minHeight={110} />
            </>
          )}
        </div>

        {showAlerts && alerts && (
          <div style={{ position: "fixed", inset: 0, zIndex: 3100, background: "rgba(0,0,0,.35)", padding: 12, overflowY: "auto" }}>
            <AlertsPanel alerts={alerts} onClose={() => setShowAlerts(false)} />
          </div>
        )}

        {sel.admin && listTab && <div style={{ padding: "0 12px 8px" }}><AdminBar sel={sel} shownCount={shown.length} compact /></div>}
        {!listTab ? (
          <div style={{ background: C.white, borderTop: `1px solid ${C.gray200}` }}>
            <BucketCounts items={shown} {...(TAB_INFO[tab] || TAB_INFO.packed)} />
          </div>
        ) : (
          <div style={{ background: C.white, borderTop: `1px solid ${C.gray200}` }}>
            {shown.length === 0 ? (
              <div style={{ textAlign: "center", padding: 36, color: C.gray500, fontSize: 14 }}>
                {!items.length ? "No orders assigned for this day — upload the labels first." : tab === "pending" ? "Everything is packed. 🎉" : "Nothing here."}
              </div>
            ) : shown.map((i) => <ItemRow key={`${i.business_id}-${i.order_id}`} item={i} compact showBusiness={multi}
                  admin={sel.admin} selecting={sel.selecting} selected={sel.isPicked(i)} onToggle={() => sel.toggle(i)} onSetStatus={(st) => sel.applyOne(i, st)} />)}
          </div>
        )}
      </div>

      {/* Bottom bar — in thumb reach: the big action, then the mode and a typed fallback */}
      <div style={{ flexShrink: 0, padding: "10px 12px calc(10px + env(safe-area-inset-bottom))", borderTop: `1px solid ${C.gray200}`, background: C.white, display: "flex", flexDirection: "column", gap: 8 }}>
        <button onClick={() => setCamera(true)} className="os-btn"
          style={{ ...btn("primary", "lg"), minHeight: 58, padding: "14px 20px", fontSize: 18, borderRadius: 14, width: "100%" }}>
          <QrCodeScannerIcon style={{ fontSize: 26, verticalAlign: "-7px" }} />&nbsp;Scan parcel
        </button>
        <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
          <div style={{ width: 168, flexShrink: 0 }}><ModeSwitch mode={mode} setMode={setMode} /></div>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type AWB / order no" aria-label="Type an AWB or order number"
            onKeyDown={(e) => { if (e.key === "Enter") submitTyped(); }} enterKeyHint="go"
            autoComplete="off" className="os-in" style={{ ...S.inp, flex: 1, fontFamily: "monospace", minWidth: 0, minHeight: 52, fontSize: 15 }} />
        </div>
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
  const [showUnrec, setShowUnrec] = useState(false);
  const input = useRef(null);
  const refocus = useCallback(() => setTimeout(() => input.current?.focus(), 0), []);
  useEffect(() => { if (view === "queue") refocus(); }, [view, refocus]);

  const items = queue?.items || [];
  const sum = queue?.summary;
  const inCourier = courier ? items.filter((i) => courierKey(i.courier) === courierKey(courier)) : items;
  const counts = useMemo(() => summaryCounts(inCourier), [inCourier]);
  const allCounts = useMemo(() => summaryCounts(items), [items]);
  const shown = inCourier.filter(FILTERS.find((f) => f.key === tab).test);
  const sel = useAdminSelect(desk, shown);
  const tabs = FILTERS.filter((f) => f.key !== "issues" || allCounts.issues > 0 || tab === "issues");

  const submit = async () => {
    const code = scan.trim();
    if (!code) return;
    setScan("");                       // cleared as soon as it is read — ready for the next parcel
    await record(code);
    refocus();
  };

  return (
    <div className="os-desk" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <style>{DESK_CSS}</style>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: C.gray900, margin: 0 }}>Order scan</h1>
          <p style={{ fontSize: 13, color: C.gray500, marginTop: 3 }}>Scan each parcel to tick it off the day's list and keep the record.</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <DeskBusinesses desk={businesses} onChanged={onScopeChanged} />
          <PlatformToggle platform={platform} onChange={setPlatform} />
          <select value={date} onChange={(e) => setDate(e.target.value)} aria-label="Packing day" className="os-in" style={{ ...S.inp, width: "auto", fontWeight: 700 }}>
            {[...new Set([date, ...(queue?.dates || [])])].filter(Boolean).sort().reverse().map((d) => <option key={d} value={d}>{dayLabel(d, desk.currentDay)}</option>)}
          </select>
          <div role="tablist" aria-label="Screen" style={{ display: "flex", background: C.gray100, borderRadius: 10, padding: 3 }}>
            {["queue", "record", "summary"].map((v) => (
              <button key={v} role="tab" aria-selected={view === v} className="os-btn" onClick={() => setView(v)}
                style={{ border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
                  background: view === v ? C.white : "transparent", color: view === v ? C.orange : C.gray600 }}>
                {v === "queue" ? "Today's list" : v === "record" ? "Scan record" : "🖨 Courier summary"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {view === "summary" ? <CourierSummary key={scopeTick} platform={platform} day={date} /> :
       view === "record" ? <ScanRecord key={scopeTick} platform={platform} multi={multi} /> : (
        <>
          <Notice>
            <DayNotice desk={desk} />
            <EarlierAskBanner desk={desk} />
            <AlertBanner alerts={alerts} onOpen={() => { setShowAlerts((v) => !v); reloadAlerts(); }} />
            <UnsentBanner desk={desk} onOpen={() => setShowShift(true)} />
          </Notice>
          {showShift && <ShiftPanel desk={desk} onClose={(moved) => { setShowShift(false); if (moved) reloadAlerts(); }} />}
          {showUnrec && <UnrecognisedPanel desk={desk} onClose={() => setShowUnrec(false)} />}
          {showAlerts && alerts && <AlertsPanel alerts={alerts} onClose={() => setShowAlerts(false)} />}

          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(360px, 420px)", gap: 20, alignItems: "start" }}>
            {/* Left: where every courier stands, then the list */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
              <div style={{ ...S.card, padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
                <CourierSection desk={desk} items={items} sum={sum} active={courier} onPick={(c) => { setCourier(c); setTab(c ? "packed" : tab); refocus(); }} />
                <DayProgress counts={allCounts} pieces={sum ? { packed: sum.pieces_packed ?? 0, total: sum.pieces ?? 0 } : null} />
              </div>

              <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
                <div style={{ padding: 14, borderBottom: `1px solid ${C.gray100}`, display: "flex", flexDirection: "column", gap: 10 }}>
                  <StatTabs tabs={tabs} tab={tab} onPick={(k) => { setTab(k); refocus(); }} counts={counts} />
                  <div style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 32 }}>
                    {courier
                      ? <button onClick={() => setCourier(null)} className="os-btn" style={btn("ghostOrange", "sm")}>🚚 {courier} · show all couriers ✕</button>
                      : <span style={{ fontSize: 12.5, color: C.gray500 }}>Showing {shown.length} order{shown.length === 1 ? "" : "s"} · all couriers</span>}
                    <UnrecognisedChip desk={desk} onOpen={() => setShowUnrec(true)} />
                    <button onClick={() => { reload(); refocus(); }} className="os-btn" style={{ ...btn("ghost", "sm"), marginLeft: "auto" }}>
                      <RefreshIcon style={{ fontSize: 15, verticalAlign: "-3px" }} />&nbsp;Refresh
                    </button>
                  </div>
                </div>
                {sel.admin && <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.gray100}` }}><AdminBar sel={sel} shownCount={shown.length} /></div>}
                {loading && !queue ? (
                  <div style={{ display: "flex", justifyContent: "center", padding: 44 }}><CircularProgress style={{ color: C.orange }} /></div>
                ) : shown.length === 0 ? (
                  <div style={{ textAlign: "center", padding: 44, color: C.gray500, fontSize: 14 }}>
                    {!items.length ? "No orders assigned for this day — upload the labels first." : tab === "pending" ? "Everything is packed. 🎉" : "Nothing here."}
                  </div>
                ) : shown.map((i) => <ItemRow key={`${i.business_id}-${i.order_id}`} item={i} showBusiness={multi}
                      admin={sel.admin} selecting={sel.selecting} selected={sel.isPicked(i)} onToggle={() => sel.toggle(i)} onSetStatus={(st) => sel.applyOne(i, st)} />)}
              </div>
            </div>

            {/* Right: the scan desk — always in view */}
            <div style={{ position: "sticky", top: 12 }}>
              <div style={{ ...S.card, padding: 18, borderTop: `4px solid ${C.orange}`, display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: C.gray900 }}>Scan a parcel</div>
                <ModeSwitch mode={mode} setMode={setMode} onChanged={refocus} showHelp />
                <div style={{ position: "relative" }}>
                  <QrCodeScannerIcon aria-hidden style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: C.orange, fontSize: 26 }} />
                  <input
                    ref={input}
                    value={scan}
                    onChange={(e) => setScan(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                    onBlur={(e) => { if (view === "queue" && !e.relatedTarget) refocus(); }}
                    placeholder="Scan or type AWB / order no…"
                    aria-label="Scan or type an AWB or order number"
                    autoComplete="off" spellCheck={false} className="os-in"
                    style={{ ...S.inp, width: "100%", boxSizing: "border-box", fontSize: 20, fontFamily: "monospace", fontWeight: 700,
                      padding: "16px 16px 16px 52px", background: C.orangeLight, borderColor: C.orangeBorder }}
                  />
                </div>
                <LatestPanel latest={latest} busy={busy} minHeight={150} />
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
