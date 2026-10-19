import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { API, C, S, btn, Tag, useIsMobile } from "../../App";
import { BarcodeScanner } from "../shared/BarcodeScanner";
import { PlatformToggle, useLabelPlatform } from "../PlatformToggle";
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
  const [date, setDate] = useState("");
  const [queue, setQueue] = useState(null);       // { date, summary, items, dates }
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

  const setMode = (m) => { setModeState(m); try { localStorage.setItem("scan_mode", m); } catch { /* ignore */ } };

  const load = useCallback(async (forDate = date) => {
    const p = new URLSearchParams({ platform });
    if (forDate) p.set("date", forDate);
    try {
      const res = await fetch(`${API}/order-scan/queue/?${p}`);
      if (res.ok) {
        const data = await res.json();
        setQueue(data);
        if (!forDate) setDate(data.date);
      }
    } finally { setLoading(false); }
  }, [date, platform]);

  useEffect(() => { setLoading(true); setLatest(null); load(date); }, [platform, date]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Record one scan and describe, in one line each, what it means for the desk. */
  const record = async (codeRaw) => {
    const code = (codeRaw ?? "").trim();
    if (!code) return null;
    setBusy(true); setError(null);
    const my = ++seq.current;
    try {
      const res = await fetch(`${API}/order-scan/`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, status: mode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const out = { kind: "err", title: "Not recorded", lines: [data.error || "Could not record that scan."], code };
        if (my === seq.current) setLatest(out);
        return out;
      }
      const row = data.row;
      const items = queueRef.current?.items || [];
      const item = items.find((i) => i.order_id === row.sub_order_no || (row.awb_number && i.awb === row.awb_number));
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
        kind = "warn"; title = "Not recognised";
        lines.push("No label or order matches this code.");
      } else if (!item) {
        kind = "warn"; title = `${title} · not in this day's list`;
      } else if (data.already_scanned) {
        kind = "warn"; title = `Already scanned ${row.scan_count}×`;
      } else if (mode === "DISPATCHED" && ship === "NOT_SHIPPED") {
        kind = "warn"; title = "Dispatched · Meesho not showing shipped";
        lines.push("The panel still lists it as ready to ship.");
      }
      if (data.cross_business) lines.push(`Filed under ${data.business_name}`);

      const out = { kind, title, lines, code: row.sub_order_no, image_url: item?.image_url };
      if (my === seq.current) setLatest(out);

      // Mark it off the list straight away; the refetch below confirms.
      setQueue((q) => q && {
        ...q,
        items: q.items.map((i) => (i === item ? { ...i, state: row.status, scan_id: row.id, scan_count: row.scan_count, ship_status: ship } : i)),
      });
      load();
      return out;
    } catch {
      const out = { kind: "err", title: "Network error", lines: ["The scan was not recorded."], code };
      if (my === seq.current) setLatest(out);
      return out;
    } finally {
      setBusy(false);
    }
  };

  return { date, setDate, queue, loading, mode, setMode, latest, busy, error, setError, record, reload: load };
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

function ItemRow({ item, compact }) {
  const st = STATE_META[item.state] || STATE_META.PENDING;
  const ship = SHIP_META[item.ship_status] || SHIP_META.UNKNOWN;
  const cancelled = item.ship_status === "CANCELLED";
  return (
    <div style={{
      display: "flex", gap: 12, alignItems: "center", padding: compact ? "10px 12px" : "11px 16px",
      borderBottom: `1px solid ${C.gray100}`, background: cancelled ? C.redLight : C.white,
    }}>
      <Photo url={item.image_url} size={compact ? 46 : 52} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 13.5, color: C.gray900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.sku || "—"}</span>
          <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 13, color: C.orange }}>×{item.qty}</span>
        </div>
        <div style={{ fontSize: 11.5, color: C.gray500, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {[item.courier, item.customer_city, item.awb].filter(Boolean).join(" · ")}
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0, display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
        <Tag variant={st.tag}>{st.label}</Tag>
        {(item.state !== "PENDING" || cancelled) && item.ship_status !== "UNKNOWN" && (
          <span style={{ fontSize: 10.5, fontWeight: 700, color: ship.color }}>{ship.label}</span>
        )}
      </div>
    </div>
  );
}

const FILTERS = [
  { key: "pending",   label: "To pack",   test: (i) => i.state === "PENDING" && i.ship_status !== "CANCELLED" },
  { key: "done",      label: "Packed",    test: (i) => ["PACKED", "DISPATCHED", "SCANNED"].includes(i.state) },
  { key: "issues",    label: "Issues",    test: (i) => ["ON_HOLD", "ISSUE"].includes(i.state) || i.ship_status === "CANCELLED" },
  { key: "all",       label: "All",       test: () => true },
];

function summaryCounts(items) {
  const out = {};
  FILTERS.forEach((f) => { out[f.key] = items.filter(f.test).length; });
  return out;
}

// ── Phone: full screen, stable ────────────────────────────────────────────────

function MobilePack({ desk, platform, setPlatform }) {
  const navigate = useNavigate();
  const { queue, loading, mode, setMode, latest, busy, date, setDate, record } = desk;
  const [camera, setCamera] = useState(false);
  const [tab, setTab] = useState("pending");
  const [typed, setTyped] = useState("");

  const items = queue?.items || [];
  const sum = queue?.summary;
  const counts = useMemo(() => summaryCounts(items), [items]);
  const shown = items.filter(FILTERS.find((f) => f.key === tab).test);
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
      <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, borderBottom: `1px solid ${C.gray100}`, flexShrink: 0 }}>
        <button onClick={() => navigate(-1)} aria-label="Back" style={{ background: "none", border: "none", padding: 4, cursor: "pointer", lineHeight: 0, color: C.gray700 }}>
          <ArrowBackIcon />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.gray900 }}>Pack orders</div>
          <select value={date} onChange={(e) => setDate(e.target.value)}
            style={{ border: "none", background: "none", fontSize: 12, color: C.gray500, fontWeight: 600, padding: 0, fontFamily: "inherit" }}>
            {(queue?.dates?.length ? queue.dates : [date]).filter(Boolean).map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <PlatformToggle platform={platform} onChange={setPlatform} />
      </div>

      {/* Progress + last result: fixed, never reflows */}
      <div style={{ padding: "12px 14px 10px", display: "flex", flexDirection: "column", gap: 12, flexShrink: 0 }}>
        {loading && !queue ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 24 }}><CircularProgress style={{ color: C.orange }} /></div>
        ) : (
          <>
            <ProgressBar done={progress.done} total={progress.total} label={`${progress.label} · ${sum?.pieces_packed ?? 0} of ${sum?.pieces ?? 0} pieces`} />
            <LatestPanel latest={latest} busy={busy} minHeight={118} />
          </>
        )}
      </div>

      {/* Queue */}
      <div style={{ display: "flex", gap: 6, padding: "0 14px 8px", flexShrink: 0 }}>
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
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", borderTop: `1px solid ${C.gray100}` }}>
        {shown.length === 0 ? (
          <div style={{ textAlign: "center", padding: 36, color: C.gray400, fontSize: 13 }}>
            {!items.length ? "No orders assigned for this day — upload the labels first." : tab === "pending" ? "Everything is packed. 🎉" : "Nothing here."}
          </div>
        ) : shown.map((i) => <ItemRow key={i.order_id} item={i} compact />)}
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
function ScanRecord({ platform }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [ship, setShip] = useState("");
  const [busy, setBusy] = useState(false);
  const PAGE = 40;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page, page_size: PAGE });
      if (q.trim()) p.set("q", q.trim());
      if (ship) p.set("ship", ship);
      const res = await fetch(`${API}/order-scan/?${p}`);
      const data = await res.json();
      setRows(data.results || []); setTotal(data.total ?? 0); setStats(data.stats || null);
    } finally { setLoading(false); }
  }, [page, q, ship]);
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);
  useEffect(() => { setPage(1); }, [q, ship]);

  const recheck = async () => {
    setBusy(true);
    try { await fetch(`${API}/order-scan/refresh-ship/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); await load(); }
    finally { setBusy(false); }
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

  const SHIPS = [["", "All"], ["PROBLEM", "Cancelled / not shipped"], ["SHIPPED", "Shipped"], ["NOT_SHIPPED", "Not shipped yet"], ["CANCELLED", "Cancelled"], ["UNKNOWN", "No status"]];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {stats && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Tile label="Scanned in total" value={stats.total} color={C.orange} />
          <Tile label="Packed" value={stats.packed + stats.dispatched} color={C.green} />
          <Tile label="Shipped (Meesho)" value={stats.ship_shipped} color={C.green} />
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
          <RefreshIcon style={{ fontSize: 15, verticalAlign: "-3px" }} />&nbsp;Re-check with Meesho sheets
        </button>
      </div>
      <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
        {loading && !rows.length ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 40 }}><CircularProgress style={{ color: C.orange }} /></div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr>{["Scanned", "Order", "Item", "Our status", "Meesho says", ""].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={6} style={{ ...S.td, textAlign: "center", padding: 36, color: C.gray400 }}>Nothing scanned yet.</td></tr>}
              {rows.map((r, idx) => {
                const ship = SHIP_META[r.ship_status] || SHIP_META.UNKNOWN;
                return (
                  <tr key={r.id} style={{ background: r.ship_status === "CANCELLED" ? C.redLight : idx % 2 ? C.gray50 : C.white }}>
                    <td style={{ ...S.td, whiteSpace: "nowrap", fontSize: 12, color: C.gray500 }}>{fmtTime(r.last_scanned_at)}{r.scan_count > 1 ? ` · ${r.scan_count}×` : ""}</td>
                    <td style={{ ...S.td, fontFamily: "monospace", fontSize: 12 }}>{r.sub_order_no}<div style={{ color: C.gray400, fontSize: 11 }}>{r.awb_number}</div></td>
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

function DesktopPack({ desk, platform, setPlatform }) {
  const { queue, loading, mode, setMode, latest, busy, date, setDate, record, reload } = desk;
  const [view, setView] = useState("queue");          // queue | record
  const [tab, setTab] = useState("pending");
  const [scan, setScan] = useState("");
  const input = useRef(null);
  const refocus = useCallback(() => setTimeout(() => input.current?.focus(), 0), []);
  useEffect(() => { if (view === "queue") refocus(); }, [view, refocus]);

  const items = queue?.items || [];
  const sum = queue?.summary;
  const counts = useMemo(() => summaryCounts(items), [items]);
  const shown = items.filter(FILTERS.find((f) => f.key === tab).test);

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
          <PlatformToggle platform={platform} onChange={setPlatform} />
          <select value={date} onChange={(e) => setDate(e.target.value)} style={{ ...S.inp, width: "auto" }}>
            {(queue?.dates?.length ? queue.dates : [date]).filter(Boolean).map((d) => <option key={d} value={d}>Labels of {d}</option>)}
          </select>
          <div style={{ display: "flex", background: C.gray100, borderRadius: 10, padding: 3 }}>
            {["queue", "record"].map((v) => (
              <button key={v} onClick={() => setView(v)}
                style={{ border: "none", borderRadius: 8, padding: "7px 16px", fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
                  background: view === v ? C.white : "transparent", color: view === v ? C.orange : C.gray500 }}>
                {v === "queue" ? "Today's list" : "Scan record"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {view === "record" ? <ScanRecord platform={platform} /> : (
        <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Tile label="Assigned" value={sum?.assigned} color={C.gray600} onClick={() => setTab("all")} active={tab === "all"} />
            <Tile label="Packed" value={sum?.packed} color={C.green} onClick={() => setTab("done")} active={tab === "done"} />
            <Tile label="To pack" value={sum?.remaining} color={C.orange} onClick={() => setTab("pending")} active={tab === "pending"} />
            <Tile label="Shipped (Meesho)" value={sum?.shipped} color={C.green} />
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
                <button onClick={() => { reload(); refocus(); }} style={{ ...btn("ghost", "sm"), marginLeft: "auto" }}>
                  <RefreshIcon style={{ fontSize: 15, verticalAlign: "-3px" }} />&nbsp;Refresh
                </button>
              </div>
              {loading && !queue ? (
                <div style={{ display: "flex", justifyContent: "center", padding: 44 }}><CircularProgress style={{ color: C.orange }} /></div>
              ) : shown.length === 0 ? (
                <div style={{ textAlign: "center", padding: 44, color: C.gray400, fontSize: 13 }}>
                  {!items.length ? "No orders assigned for this day — upload the labels first." : tab === "pending" ? "Everything is packed. 🎉" : "Nothing here."}
                </div>
              ) : shown.map((i) => <ItemRow key={i.order_id} item={i} />)}
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
  return isMobile
    ? <MobilePack desk={desk} platform={platform} setPlatform={setPlatform} />
    : <DesktopPack desk={desk} platform={platform} setPlatform={setPlatform} />;
}
