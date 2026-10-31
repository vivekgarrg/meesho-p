import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { API, C, S, btn, Tag, useIsMobile } from "../../App";
import { CircularProgress } from "@mui/material";

/*
 * Meesho Orders — the Meesho supplier panel's order tabs (On hold, Pending,
 * Ready to ship, Cancelled) as the sync last pulled them: counts, what is close
 * to or past its dispatch SLA, and every order. Refresh pulls now; otherwise
 * the sync pulls on its own every few minutes (Meesho Sync page).
 */

const TONE = { hold: "#B45309", pending: C.orange, ready_to_ship: "#2563EB", shipped: "#059669", cancelled: C.red };
// Tabs already out of the seller's hands — no SLA, no dispatch date to chase.
const DONE = ["shipped", "cancelled"];
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
const PACKET_FILTERS = [
  { key: "all", label: "Any packet", test: () => true },
  { key: "has", label: "Has packet ID", test: (r) => !!r.packet_id },
  { key: "none", label: "No packet ID", test: (r) => !r.packet_id },
];
const keyOf = (r) => `${r.business_id}:${r.sub_order_num}`;
const BUSY = ["QUEUED", "RUNNING"];

function Chips({ options, value, onChange, rows, color = "#2563EB" }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {options.map((f) => {
        const on = value === f.key;
        return (
          <button key={f.key} onClick={() => onChange(f.key)} aria-pressed={on}
            style={{
              padding: "6px 12px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
              border: `1.5px solid ${on ? color : C.gray200}`, background: on ? color : C.white, color: on ? "#fff" : C.gray700
            }}>
            {f.label} · {rows.filter(f.test).length}
          </button>
        );
      })}
    </div>
  );
}

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

function TabTile({ t, on, onClick }) {
  const tone = TONE[t.key];
  const open = !DONE.includes(t.key);      // SLA means nothing once shipped or cancelled
  const notes = [
    open && t.breached ? { text: `${t.breached} past SLA`, color: C.red } : null,
    open && t.breaching_soon ? { text: `${t.breaching_soon} breaching soon`, color: "#B45309" } : null,
    open && t.due_today ? { text: `${t.due_today} to dispatch today`, color: C.gray600 } : null,
    t.key === "ready_to_ship" && t.label_pending ? { text: `${t.label_pending} labels not downloaded`, color: C.gray600 } : null,
  ].filter(Boolean);
  return (
    <button onClick={onClick} aria-pressed={on}
      style={{
        textAlign: "left", cursor: "pointer", fontFamily: "inherit", background: on ? tone : C.white, color: on ? "#fff" : C.gray900,
        border: `2px solid ${on ? tone : C.gray200}`, borderTop: `6px solid ${tone}`, borderRadius: 14, padding: "12px 14px",
        display: "flex", flexDirection: "column", gap: 4, minWidth: 0
      }}>
      <span style={{ fontSize: 13.5, fontWeight: 800, color: on ? "rgba(255,255,255,.95)" : tone }}>{t.label}</span>
      <span style={{ fontFamily: "monospace", fontSize: 34, fontWeight: 900, lineHeight: 1 }}>{t.count}</span>
      {notes.length ? notes.map((n) => (
        <span key={n.text} style={{ fontSize: 12, fontWeight: 700, color: on ? "#fff" : n.color }}>{n.text}</span>
      )) : <span style={{ fontSize: 12, color: on ? "rgba(255,255,255,.85)" : C.gray400 }}>{!t.count ? "None" : open ? "All on time" : t.key === "shipped" ? "On the way" : "Recent cancellations"}</span>}
    </button>
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

export function MeeshoOrdersTab({ embedded = false }) {
  const isMobile = useIsMobile();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("pending");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  const [confirming, setConfirming] = useState(false);
  const [labelFilter, setLabelFilter] = useState("all");
  const [slaFilter, setSlaFilter] = useState("all");
  const [packetFilter, setPacketFilter] = useState("all");
  const [bizFilter, setBizFilter] = useState("all");
  const [downloading, setDownloading] = useState(false);
  // A selection belongs to one tab — switching tabs starts afresh.
  useEffect(() => { setPicked(new Set()); }, [tab]);

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

  const refresh = async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`${API}/meesho-orders/refresh/`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setError(d.error || "Couldn't start a refresh.");
      await load();
    } finally { setBusy(false); }
  };

  const accept = async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`${API}/meesho-orders/accept/`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orders: chosen() }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setError(d.error || "Couldn't accept those orders.");
      else setPicked(new Set());
      setConfirming(false);
      await load();
    } finally { setBusy(false); }
  };
  const generateLabels = async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`${API}/meesho-orders/labels/`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orders: chosen() }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setError(d.error || "Couldn't generate those labels.");
      else setPicked(new Set());
      await load();
    } finally { setBusy(false); }
  };
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
  const togglePick = (k) => setPicked((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  // Each picked order goes to its own business's Meesho account.
  const chosen = () => (current?.rows || []).filter((r) => picked.has(keyOf(r)))
    .map((r) => ({ business_id: r.business_id, sub_order_num: r.sub_order_num }));

  const current = data?.tabs.find((t) => t.key === tab);
  const rows = useMemo(() => {
    let all = current?.rows || [];
    if (bizFilter !== "all") all = all.filter((r) => String(r.business_id) === bizFilter);
    if (tab === "ready_to_ship") {
      all = all.filter(LABEL_FILTERS.find((f) => f.key === labelFilter).test)
        .filter(SLA_FILTERS.find((f) => f.key === slaFilter).test)
        .filter(PACKET_FILTERS.find((f) => f.key === packetFilter).test);
    }
    const s = q.trim().toLowerCase();
    if (!s) return all;
    return all.filter((r) => [r.sku, r.sub_order_num, r.order_num, r.product_name, r.packet_id, r.awb, r.business_name]
      .some((v) => (v || "").toLowerCase().includes(s)));
  }, [current, q, tab, labelFilter, slaFilter, packetFilter, bizFilter]);

  if (!data) {
    return error
      ? <div style={{ ...S.card, color: C.red, fontWeight: 700 }}>{error}</div>
      : <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><CircularProgress style={{ color: C.orange }} /></div>;
  }
  const accounts = data.accounts || (data.account ? [data.account] : []);
  const multi = accounts.length > 1;
  const syncing = data.syncing || busy;
  const lastAccepts = latestAccepts(data.accepts);
  const lastLabels = data.label_batches?.[0];
  const accepting = (tab === "pending" && lastAccepts.some((r) => BUSY.includes(r.status)))
    || (tab === "ready_to_ship" && !!lastLabels?.busy);
  // Oldest pull across the combined accounts — what "updated" honestly means.
  const synced = accounts.map((x) => x.last_sync_at).filter(Boolean).sort()[0];
  const nextPull = accounts.filter((x) => x.sync_enabled && x.next_sync_at).map((x) => x.next_sync_at).sort()[0];
  const failedAccounts = accounts.filter((x) => x.last_sync_status === "FAILED" || x.status === "FAILED");
  // Pending: accept. Ready to ship: generate labels.
  const canAccept = data.is_admin && data.connected && (tab === "pending" || tab === "ready_to_ship");
  const isLabels = tab === "ready_to_ship";
  const rtsRows = (data.tabs.find((t) => t.key === "ready_to_ship")?.rows || [])
    .filter((r) => bizFilter === "all" || String(r.business_id) === bizFilter);
  // Only orders still in the list count as picked (accepted ones drop out on the next pull).
  const inTab = new Set((current?.rows || []).map(keyOf));
  const pickedNow = [...picked].filter((x) => inTab.has(x));
  const pickedBiz = new Set(pickedNow.map((k) => k.split(":")[0])).size;
  const allShownPicked = rows.length > 0 && rows.every((r) => picked.has(keyOf(r)));
  const pickAllShown = () => setPicked((p) => {
    const n = new Set(p);
    if (allShownPicked) rows.forEach((r) => n.delete(keyOf(r))); else rows.forEach((r) => n.add(keyOf(r)));
    return n;
  });
  const bizOptions = [{ key: "all", label: "All businesses", test: () => true },
  ...accounts.map((x) => ({ key: String(x.business_id), label: x.business_name, test: (r) => r.business_id === x.business_id }))];
  const total = data.tabs.filter((t) => !DONE.includes(t.key)).reduce((n, t) => n + t.count, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          {!embedded && <h1 style={{ fontSize: 22, fontWeight: 800, color: C.gray900, margin: 0 }}>Meesho Orders</h1>}
          <p style={{ fontSize: 13, color: C.gray500, marginTop: embedded ? 0 : 3 }}>
            {data.connected
              ? <>Live from the Meesho panel · {multi ? `${accounts.length} businesses combined (${accounts.map((x) => x.business_name).join(", ")})` : (accounts[0]?.supplier_name || accounts[0]?.business_name)}
                {" "}· updated <b>{ago(synced)}</b>{nextPull ? ` · next pull ${time(nextPull)}` : ""}</>
              : "Connect the Meesho account to see its orders here."}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {!embedded && <Link to="/meesho-orders?tab=sync" style={{ ...btn("ghost", "md"), textDecoration: "none" }}>Sync settings</Link>}
          {data.connected && (
            <button onClick={refresh} disabled={syncing} style={{ ...btn("primary", "md"), minWidth: 140, opacity: syncing ? 0.7 : 1 }}>
              {syncing ? <><CircularProgress size={14} style={{ color: "#fff", marginRight: 6, verticalAlign: "-2px" }} />Syncing…</> : "↻ Refresh"}
            </button>
          )}
        </div>
      </div>

      {!data.connected && (
        <div style={{ ...S.card, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", borderTop: `4px solid ${C.orange}` }}>
          <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: C.gray700 }}>No Meesho account connected yet.</span>
          <Link to="/meesho-orders?tab=sync" style={{ ...btn("primary", "md"), textDecoration: "none" }}>Connect Meesho</Link>
        </div>
      )}
      {data.connected && (!data.queue || !data.worker) && (
        <div style={{ background: C.amberLight, border: `1.5px solid ${C.amberBorder}`, borderRadius: 12, padding: "10px 14px", color: "#92400E", fontSize: 13, fontWeight: 700 }}>
          ⚠ {!data.queue ? "The job queue (Redis) can't be reached" : "The sync worker isn't running"} — these numbers won't update until it is.
        </div>
      )}
      {failedAccounts.map((x) => (
        <div key={x.business_id} style={{ background: C.redLight, border: `1.5px solid ${C.redBorder}`, borderRadius: 12, padding: "10px 14px", color: C.red, fontSize: 13, fontWeight: 700 }}>
          {multi ? `${x.business_name}: last` : "Last"} sync failed: {x.last_sync_message || x.status_message} <Link to="/meesho-orders?tab=sync" style={{ color: C.red }}>Fix it under Accounts &amp; sync →</Link>
        </div>
      ))}
      {error && <div style={{ color: C.red, fontWeight: 700, fontSize: 13 }}>{error}</div>}

      <div style={{ display: "grid", gap: 10, gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : `repeat(${data.tabs.length}, minmax(0, 1fr))` }}>
        {data.tabs.map((t) => <TabTile key={t.key} t={t} on={tab === t.key} onClick={() => setTab(t.key)} />)}
      </div>
      {data.connected && <div style={{ fontSize: 12.5, color: C.gray500 }}>{total} open order{total === 1 ? "" : "s"} on the panel (on hold, pending and ready to ship).</div>}

      {tab === "pending" && <AcceptStatus runs={lastAccepts} showBiz={multi} />}
      {tab === "ready_to_ship" && <LabelStatus batch={lastLabels} onDownload={downloadLabels} downloading={downloading} showBiz={multi} />}
      {(multi || tab === "ready_to_ship") && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {multi && <Chips options={bizOptions} value={bizFilter} onChange={setBizFilter} rows={current?.rows || []} color={C.gray800} />}
          {tab === "ready_to_ship" && <>
            <Chips options={LABEL_FILTERS} value={labelFilter} onChange={setLabelFilter} rows={rtsRows} />
            <Chips options={SLA_FILTERS} value={slaFilter} onChange={setSlaFilter} rows={rtsRows} color={C.red} />
            <Chips options={PACKET_FILTERS} value={packetFilter} onChange={setPacketFilter} rows={rtsRows} color="#7C3AED" />
          </>}
        </div>
      )}
      {confirming && <ConfirmAccept count={pickedNow.length} businesses={pickedBiz} busy={busy} onYes={accept} onNo={() => setConfirming(false)} />}

      <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
        {canAccept && (
          <div style={{
            padding: "10px 14px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderBottom: `1px solid ${C.gray100}`,
            background: pickedNow.length ? C.orangeLight : C.gray50
          }}>
            <label style={{ display: "inline-flex", gap: 8, alignItems: "center", fontSize: 13, fontWeight: 700, color: C.gray700, cursor: "pointer" }}>
              <input type="checkbox" checked={allShownPicked} onChange={pickAllShown} disabled={accepting || !rows.length}
                style={{ width: 18, height: 18, accentColor: C.orange }} />
              Select all {rows.length}{q ? " shown" : ""}
            </label>
            <span style={{ fontSize: 13, color: C.gray600 }}>{pickedNow.length ? `${pickedNow.length} selected${pickedBiz > 1 ? ` · ${pickedBiz} businesses` : ""}` : isLabels ? "Tick orders to make their labels" : "Tick orders to accept them"}</span>
            {pickedNow.length > 0 && (
              <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8 }}>
                <button onClick={() => setPicked(new Set())} disabled={accepting} style={btn("ghost", "sm")}>Clear</button>
                {isLabels ? (
                  <button onClick={generateLabels} disabled={accepting || busy} style={{ ...btn("primary", "md"), opacity: accepting || busy ? 0.5 : 1 }}>
                    🏷 Generate {pickedNow.length} label{pickedNow.length === 1 ? "" : "s"}
                  </button>
                ) : (
                  <button onClick={() => setConfirming(true)} disabled={accepting} style={{ ...btn("primary", "md"), opacity: accepting ? 0.5 : 1 }}>
                    ✓ Accept {pickedNow.length} order{pickedNow.length === 1 ? "" : "s"}
                  </button>
                )}
              </span>
            )}
          </div>
        )}
        <div style={{ padding: "12px 14px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderBottom: `1px solid ${C.gray100}` }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: TONE[tab] }}>{current?.label}</span>
          <span style={{ fontSize: 12.5, color: C.gray500 }}>{rows.length} of {current?.count ?? 0}{current?.fetched_at ? ` · fetched ${time(current.fetched_at)}` : ""}</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search SKU, sub-order, packet ID, AWB…"
            style={{ ...S.inp, marginLeft: "auto", width: isMobile ? "100%" : 280 }} />
        </div>
        {rows.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: C.gray500, fontSize: 14 }}>
            {!current?.fetched_at ? "Not pulled yet — press Refresh."
              : q ? "No orders match."
                : tab === "ready_to_ship" && [labelFilter, slaFilter, packetFilter].some((f) => f !== "all") ? "No orders match these filters."
                  : bizFilter !== "all" ? "No orders for this business here."
                    : `No ${current.label.toLowerCase()} orders right now.`}
          </div>
        ) : isMobile ? (
          rows.map((r) => <OrderCard key={keyOf(r)} r={r} cancelled={tab === "cancelled"} shipped={tab === "shipped"} showBiz={multi}
            selectable={canAccept && !accepting} picked={picked.has(keyOf(r))} onPick={() => togglePick(keyOf(r))} />)
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr>{canAccept && <th style={{ ...S.th, width: 36 }} />}{["Product", ...(multi ? ["Business"] : []), "Qty", "Sub-order", ...(["ready_to_ship", "shipped"].includes(tab) ? ["Packet ID / AWB"] : []), "Ordered", tab === "cancelled" ? "Status" : "Dispatch by", DONE.includes(tab) ? "" : "SLA", tab === "ready_to_ship" ? "Label" : ""]
                .map((h, i) => <th key={i} style={{ ...S.th, whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((r) => {
                  console.log(r, "~r")
                  const sla = slaOf(r.sla_status);
                  return (
                    <tr key={keyOf(r)} style={{ background: picked.has(keyOf(r)) ? C.orangeLight : undefined }}>
                      {canAccept && (
                        <td style={{ ...S.td, width: 36 }}>
                          <input type="checkbox" checked={picked.has(keyOf(r))} onChange={() => togglePick(keyOf(r))} disabled={accepting}
                            aria-label={`Select ${r.sub_order_num}`} style={{ width: 18, height: 18, accentColor: C.orange }} />
                        </td>
                      )}
                      <td style={S.td}>
                        <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 260 }}>
                          <Img src={r.image} />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontFamily: "monospace", fontWeight: 800 }}>{r.sku || "—"}</div>
                            <div style={{ fontSize: 12, color: C.gray500, maxWidth: 340, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {r.product_name}{r.variation && r.variation !== "Free Size" ? ` · ${r.variation}` : ""}
                            </div>
                          </div>
                        </div>
                      </td>
                      {multi && <td style={{ ...S.td, whiteSpace: "nowrap" }}><Tag variant="gray">{r.business_name}</Tag></td>}
                      <td style={{ ...S.td, fontFamily: "monospace", fontWeight: 800 }}>{r.quantity ?? 1}</td>
                      <td style={{ ...S.td, fontFamily: "monospace", fontSize: 12 }}>{r.sub_order_num}</td>
                      {["ready_to_ship", "shipped"].includes(tab) && <td style={{ ...S.td, whiteSpace: "nowrap" }}><ShipIds r={r} /></td>}
                      <td style={{ ...S.td, whiteSpace: "nowrap" }}>{time(r.created_iso)}</td>
                      {tab === "cancelled"
                        ? <td style={S.td}><Tag variant="red">{r.cancelled_message || "Cancelled"}</Tag></td>
                        : <td style={{ ...S.td, whiteSpace: "nowrap", fontWeight: r.dispatch_by === data.today ? 800 : 500 }}>{day(r.dispatch_by)}{r.dispatch_by === data.today ? " · today" : ""}</td>}
                      <td style={S.td}>{!DONE.includes(tab) && sla && <Tag variant={sla.tag}>{sla.label}</Tag>}{r.is_express && <> <Tag variant="blue">Express</Tag></>}</td>
                      <td style={{ ...S.td, fontSize: 12, color: C.gray600 }}>{tab === "ready_to_ship" ? labelText(r.label) : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
