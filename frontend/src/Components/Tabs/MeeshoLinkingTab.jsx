import React, { useState, useEffect, useCallback, useRef } from "react";
import { API, C, S, btn, Tag, useIsMobile } from "../../App";
import { CircularProgress } from "@mui/material";
import { Photo, courierTone } from "./OrderScanTab";
import { sounds, isMuted, setMuted } from "../../lib/sounds";
import { SubTabs, useTabParam } from "../shared/SubTabs";

/*
 * Meesho Orders → Order linking: link each shipment's AWB to its packet QR
 * ("KP…") at the packing desk. Scan the two in either order; the link is
 * checked against the packet Meesho has for that AWB, stored, and the parcel
 * is recorded PACKED in Order Scan (so the packed counts are right). Every
 * attempt is logged — a failed one can be corrected and retried from the log.
 *
 * Every outcome is heard: a chirp when linked, an alarm when not. The packed
 * count is live: every green scan is counted the moment Meesho answers — from
 * that answer itself, which carries the day's counts as they now stand — and
 * the counts are read again every few seconds, so a scan at another desk shows
 * here too. Nothing queued or synced adds to it: only a green scan here does,
 * and it stays counted until the order is cancelled or the link undone. The link itself goes through the server: the
 * Meesho session lives there, encrypted, and is never handed to a browser.
 */

const isPacket = (c) => /^KP[A-Z0-9]{6,}$/.test(c);
// As Order Scan: some couriers' barcodes carry the AWB and a routing code — "VL0085968979439|0G349GGK";
// only the part before the "|" is the AWB.
const clean = (c) => String(c || "").replace(/\s+/g, "").split("|")[0].toUpperCase();
const time = (iso) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "—");
const when = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" }) : "—");
// Where each link stands on Meesho now (meesho_linking.link_state), from its latest Ready to ship / Shipped lists.
const STATE = {
  linked: { label: "Linked on Meesho", tag: "green" },
  other_packet: { label: "Different packet on Meesho", tag: "red" },
  linked_here_only: { label: "Not on Meesho yet", tag: "amber" },
  not_seen: { label: "Not in Meesho's lists", tag: "gray" },
};
const CHECK = {
  MATCH: { label: "Matches Meesho", tag: "green" },
  UNKNOWN: { label: "Not in Meesho data yet", tag: "gray" },
  OVERRIDDEN: { label: "Linked anyway", tag: "amber" },
};

const TIMEOUT_MS = 30000;

async function call(path, method = "GET", body) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API}/meesho-orders/linking/${path}`, {
      method, signal: ctl.signal,
      headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined,
    });
    const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  } finally {
    clearTimeout(timer);
  }
}

const secs = (ms) => (ms == null ? "" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

/** The parcel just linked: its product, big enough to check against what's in hand. */
function LinkedCard({ r }) {
  const p = r.product || {};
  const l = r.link;
  const t = courierTone(l.courier || "");
  return (
    <div role="status" style={{ background: C.greenLight, border: `2px solid ${C.greenBorder}`, borderRadius: 14, padding: 12,
      display: "flex", gap: 12, alignItems: "center", color: "#166534" }}>
      <Photo url={p.image_url} fallback={p.image_fallback_url} size={72} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 17, fontWeight: 900 }}>✓ Linked & packed{r.ms != null ? <span style={{ fontSize: 12, fontWeight: 700, color: "#15803D" }}> · {secs(r.ms)}</span> : null}</div>
        <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", marginTop: 2 }}>
          <span style={{ fontFamily: "monospace", fontWeight: 900, fontSize: 16, color: C.gray900, wordBreak: "break-all" }}>{p.sku || l.sku || "—"}</span>
          {p.size ? <span style={{ fontSize: 13, fontWeight: 700, color: C.gray600 }}>{p.size}</span> : null}
          <span style={{ fontFamily: "monospace", fontWeight: 900, fontSize: 15, borderRadius: 6, padding: "0 7px",
            color: (p.qty || 1) > 1 ? "#fff" : C.orange, background: (p.qty || 1) > 1 ? C.red : C.orangeLight }}>×{p.qty || 1}</span>
        </div>
        <div style={{ fontSize: 12.5, color: C.gray700, marginTop: 3, wordBreak: "break-word" }}>
          <span style={{ fontWeight: 800, color: t.fg, background: t.bg, border: `1px solid ${t.border}`, borderRadius: 6, padding: "0 6px", marginRight: 6 }}>
            {l.courier || (l.carrier_id ? `Courier #${l.carrier_id}` : "Courier not known")}</span>
          <span style={{ fontFamily: "monospace" }}>{l.awb}</span> ↔ <span style={{ fontFamily: "monospace" }}>{l.packet_id}</span>
          {" · "}{l.business_name}{l.sub_order_no ? ` · ${l.sub_order_no}` : ""}
        </div>
        {" "}{CHECK[l.check] && l.check !== "MATCH" && <Tag variant={CHECK[l.check].tag}>{CHECK[l.check].label}</Tag>}
        {r.previous_packet && r.previous_packet !== l.packet_id && <div style={{ fontSize: 12.5 }}>Was linked to {r.previous_packet} before.</div>}
        {r.already_scanned && <div style={{ fontSize: 12.5 }}>Scanned before at the desk — now marked packed.</div>}
        {r.via && r.via !== l.business_name && <div style={{ fontSize: 12.5 }}>Sent through {r.via}'s Meesho session — {l.business_name}'s isn't connected right now.</div>}
      </div>
    </div>
  );
}

function Logs({ onChanged }) {
  const [errorsOnly, setErrorsOnly] = useState(true);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState({});        // log id → {awb, packet_id}
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState(null);

  const load = useCallback(async () => {
    const p = new URLSearchParams({ page: String(page) });
    if (errorsOnly) p.set("errors", "1");
    if (q.trim()) p.set("q", q.trim());
    const r = await call(`logs/?${p}`);
    if (r.ok) setData(r.data);
  }, [errorsOnly, q, page]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [errorsOnly, q]);

  const retry = async (log, override = false) => {
    setBusy(log.id); setNote(null);
    const e = editing[log.id] || {};
    const r = await call(`logs/${log.id}/`, "POST", { awb: e.awb ?? log.awb, packet_id: e.packet_id ?? log.packet_id, override });
    setBusy(null);
    setNote(r.ok ? { ok: true, text: `Linked ${r.data.link.awb} → ${r.data.link.packet_id} and marked packed.` }
      : { ok: false, text: r.data.error || "Retry failed.", log, canOverride: r.data.can_override });
    load(); onChanged();
  };
  const handled = async (log) => {
    await call(`logs/${log.id}/`, "PATCH", { resolved: !log.resolved });
    load(); onChanged();
  };

  return (
    <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "12px 14px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderBottom: `1px solid ${C.gray100}` }}>
        <span style={{ fontWeight: 800, fontSize: 14.5, flex: 1, minWidth: 140 }}>Log</span>
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13, fontWeight: 700 }}>
          <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} /> Open problems only
        </label>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search AWB, packet, error…" style={{ ...S.inp, width: 220 }} />
      </div>
      {note && (
        <div style={{ padding: "8px 14px", fontSize: 13, fontWeight: 700, color: note.ok ? C.green : C.red, display: "flex", gap: 8, alignItems: "center" }}>
          {note.text}
          {note.canOverride && <button onClick={() => retry(note.log, true)} style={{ ...btn("ghost", "sm"), color: "#B45309" }}>Link anyway</button>}
        </div>
      )}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead><tr>{["When", "What", "AWB", "Packet", "Result", "By", ""].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {data?.logs.length === 0 && <tr><td colSpan={7} style={{ ...S.td, textAlign: "center", color: C.gray400, padding: 20 }}>{errorsOnly ? "No open problems." : "Nothing logged yet."}</td></tr>}
            {data?.logs.map((l) => {
              const e = editing[l.id];
              const fixable = !l.ok && !l.resolved && ["LINK", "RELINK", "RETRY"].includes(l.action);
              return (
                <tr key={l.id} style={{ background: !l.ok && !l.resolved ? "#FEF2F2" : undefined }}>
                  <td style={{ ...S.td, whiteSpace: "nowrap", color: C.gray500 }}>{when(l.at)}</td>
                  <td style={S.td}>{l.action.toLowerCase()}{l.business_name ? <div style={{ fontSize: 11, color: C.gray400 }}>{l.business_name}</div> : null}</td>
                  <td style={{ ...S.td, fontFamily: "monospace" }}>
                    {e ? <input value={e.awb} onChange={(ev) => setEditing({ ...editing, [l.id]: { ...e, awb: clean(ev.target.value) } })} style={{ ...S.inp, width: 150, padding: "3px 6px" }} />
                      : l.awb || "—"}
                  </td>
                  <td style={{ ...S.td, fontFamily: "monospace" }}>
                    {e ? <input value={e.packet_id} onChange={(ev) => setEditing({ ...editing, [l.id]: { ...e, packet_id: clean(ev.target.value) } })} style={{ ...S.inp, width: 150, padding: "3px 6px" }} />
                      : l.packet_id || "—"}
                  </td>
                  <td style={{ ...S.td, maxWidth: 380 }}>
                    {l.ok ? <Tag variant="green">OK</Tag> : l.resolved ? <Tag variant="gray">Handled</Tag> : <Tag variant="red">Failed</Tag>}
                    {l.error && <div style={{ fontSize: 12, color: l.ok || l.resolved ? C.gray500 : C.red, marginTop: 3 }}>{l.error}</div>}
                  </td>
                  <td style={{ ...S.td, color: C.gray500 }}>{l.user || "—"}</td>
                  <td style={{ ...S.td, whiteSpace: "nowrap" }}>
                    {fixable && !e && <button onClick={() => setEditing({ ...editing, [l.id]: { awb: l.awb, packet_id: l.packet_id } })} style={btn("ghost", "sm")}>Edit</button>}
                    {fixable && <button onClick={() => retry(l)} disabled={busy === l.id} style={{ ...btn("primary", "sm"), marginLeft: 4 }}>{busy === l.id ? "…" : "Retry"}</button>}
                    {!l.ok && <button onClick={() => handled(l)} style={{ ...btn("ghost", "sm"), marginLeft: 4 }}>{l.resolved ? "Reopen" : "Mark handled"}</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {data && data.total > data.page_size && (
        <div style={{ padding: 10, display: "flex", gap: 8, justifyContent: "center", alignItems: "center", fontSize: 12.5 }}>
          <button disabled={page <= 1} onClick={() => setPage(page - 1)} style={btn("ghost", "sm")}>‹ Newer</button>
          Page {page} of {Math.ceil(data.total / data.page_size)}
          <button disabled={page * data.page_size >= data.total} onClick={() => setPage(page + 1)} style={btn("ghost", "sm")}>Older ›</button>
        </div>
      )}
    </div>
  );
}

/**
 * A linking error that stops the desk: nothing was marked packed, and nothing
 * can be scanned until someone presses OK. Enter / Space don't dismiss it — a
 * scanner ends every code with Enter, and the next parcel's scan mustn't slip
 * past the error.
 */
function BlockingError({ e, onOk, onOverride }) {
  const stopKeys = (ev) => { if (["Enter", " ", "Spacebar"].includes(ev.key)) { ev.preventDefault(); ev.stopPropagation(); } };
  useEffect(() => {
    const swallow = (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); ev.stopPropagation(); } };
    window.addEventListener("keydown", swallow, true);
    return () => window.removeEventListener("keydown", swallow, true);
  }, []);
  const already = e.code === "already_linked" || e.code === "already_linked_here";
  const cancelled = e.code === "cancelled";
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="link-error-title"
      style={{ position: "fixed", inset: 0, zIndex: 4000, background: "rgba(127,29,29,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ ...S.card, maxWidth: 520, width: "100%", padding: 22, display: "flex", flexDirection: "column", gap: 12, borderTop: `6px solid ${already ? "#D97706" : C.red}` }}>
        <div id="link-error-title" style={{ fontSize: 20, fontWeight: 900, color: already ? "#92400E" : C.red }}>
          {e.code === "already_linked_here" ? "⚠ Already linked here" : already ? "⚠ Already linked on Meesho" : cancelled ? "✕ Order cancelled" : "✕ Not linked"} — not marked packed
        </div>
        <div style={{ fontSize: 15, color: C.gray800, lineHeight: 1.5, fontWeight: 600 }}>{e.error || "Meesho didn't link it."}</div>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", fontSize: 13.5 }}>
          <span style={{ color: C.gray500 }}>AWB</span><b style={{ fontFamily: "monospace" }}>{e.awb || "—"}</b>
          <span style={{ color: C.gray500 }}>Packet</span><b style={{ fontFamily: "monospace" }}>{e.packet || "—"}</b>
          {e.meesho_code && <><span style={{ color: C.gray500 }}>Meesho said</span><span style={{ fontFamily: "monospace" }}>{e.meesho_code}</span></>}
        </div>
        <div style={{ fontSize: 12.5, color: C.gray500 }}>Put this parcel aside and check it. It's in the log below{onOverride ? " — or link it anyway if the packet is right" : ""}.</div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          {onOverride && <button onClick={onOverride} onKeyDown={stopKeys} style={btn("ghost", "lg")}>Link anyway</button>}
          <button onClick={onOk} onKeyDown={stopKeys} style={{ ...btn("primary", "lg"), minWidth: 140 }}>OK — next</button>
        </div>
      </div>
    </div>
  );
}

const dayName = (d) => {
  if (!d) return "Day not known";
  const t = new Date(); const k = (x) => x.toISOString().slice(0, 10);
  const y = new Date(Date.now() - 86400000);
  if (d === k(t)) return "Today";
  if (d === k(y)) return "Yesterday";
  return new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};
// Meesho names a courier only by id, and a label may carry none: those parcels
// are counted and listed, but get no courier card of their own.
const UNNAMED = new Set(["courier not known", "no courier on label"]);
const named = (c) => !UNNAMED.has(String(c || "").trim().toLowerCase());

// The board's kinds of parcel, in the order a desk deals with them.
const KINDS = [
  { k: "to_pack", label: "To pack", hint: "Label made, not scanned here yet", color: C.orange },
  { k: "no_label", label: "No label yet", hint: "On Meesho's Ready to ship, label not downloaded", color: "#64748B" },
  { k: "meesho_only", label: "Linked on Meesho only", hint: "Meesho has a packet for it, but it wasn't scanned here — scan it to count it", color: "#B45309" },
  { k: "packed", label: "Packed · waiting pickup", hint: "Scanned here; the courier hasn't picked it up yet", color: "#15803D" },
  { k: "cancelled_after", label: "Packed, then cancelled", hint: "Cancelled after packing — the parcel is here: keep it aside", color: C.red },
];

/** One big number with its label — the board's tiles. */
function Tile({ label, value, sub, color, on, onClick, big }) {
  return (
    <button onClick={onClick} aria-pressed={on} title={sub}
      style={{ textAlign: "left", fontFamily: "inherit", cursor: onClick ? "pointer" : "default", minWidth: 0,
        background: on ? `${color}14` : C.white, border: `2px solid ${on ? color : C.gray200}`, borderLeft: `6px solid ${color}`,
        borderRadius: 12, padding: big ? "12px 14px" : "9px 12px", display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 12, fontWeight: 800, color: C.gray600 }}>{label}</span>
      <span style={{ fontFamily: "monospace", fontWeight: 900, fontSize: big ? 34 : 26, color: value ? color : C.gray300, lineHeight: 1.1,
        fontVariantNumeric: "tabular-nums", transition: "color .2s" }}>{value ?? "—"}</span>
      {sub && <span style={{ fontSize: 11.5, color: C.gray500, lineHeight: 1.3 }}>{sub}</span>}
    </button>
  );
}

/** Everything still here: the totals, and each courier with its packed parcels by the day they were packed. */
function WithUsBoard({ w, kind, setKind, courier, setCourier, isMobile }) {
  if (!w) return null;
  const t = w.totals;
  const done = t.with_us > 0 && t.to_pack + t.no_label + t.meesho_only === 0;
  return (
    <section style={{ ...S.card, padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{ fontSize: 16, fontWeight: 900, color: C.gray900 }}>With us now</span>
        <span style={{ fontSize: 12.5, color: C.gray500, flex: 1, minWidth: 200 }}>
          Every Meesho order not picked up by the courier yet, whatever day it's from — from Meesho's Ready to ship
          {w.read_at ? ` (read ${when(w.read_at)})` : ""} and every scan here, counted the moment it's linked.
        </span>
        <span style={{ fontSize: 14, fontWeight: 900, color: done ? C.green : C.orange }}>
          {t.with_us === 0 ? "Nothing waiting" : done ? "✓ Everything here is packed" : `${t.to_pack + t.no_label + t.meesho_only} still to pack`}
        </span>
      </div>
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(auto-fit, minmax(150px, 1fr))" }}>
        <Tile big label="With us" value={t.with_us} color={C.gray900} sub="packed + to pack" on={!kind} onClick={() => setKind(null)} />
        {KINDS.map((x) => (
          <Tile key={x.k} label={x.label} value={t[x.k]} color={x.color} on={kind === x.k}
            sub={x.k === "to_pack" && t.overdue ? `${t.overdue} past dispatch-by` : x.hint} onClick={() => setKind(kind === x.k ? null : x.k)} />
        ))}
      </div>
      {w.packed_by_day.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", fontSize: 12.5 }}>
          <span style={{ fontWeight: 800, color: C.gray600 }}>Packed, waiting pickup:</span>
          {w.packed_by_day.map((d) => (
            <span key={d.day} style={{ background: C.greenLight, color: "#166534", borderRadius: 999, padding: "2px 10px", fontWeight: 800 }}>
              {dayName(d.day)} · {d.count}</span>
          ))}
        </div>
      )}
      {w.by_courier.some((c) => named(c.courier)) && (
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "repeat(auto-fill, minmax(250px, 1fr))" }}>
          {w.by_courier.filter((c) => named(c.courier)).map((c) => {
            const tone = courierTone(c.courier);
            const on = courier === c.courier;
            const left = c.to_pack + c.no_label + c.meesho_only;
            const pct = c.with_us ? (100 * c.packed) / c.with_us : 0;
            return (
              <button key={c.courier} onClick={() => setCourier(on ? null : c.courier)} aria-pressed={on}
                style={{ textAlign: "left", fontFamily: "inherit", cursor: "pointer", minWidth: 0, background: on ? tone.bg : C.white,
                  border: `2px solid ${on ? tone.solid : tone.border}`, borderTop: `5px solid ${tone.solid}`, borderRadius: 12, padding: "10px 12px",
                  display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontWeight: 900, color: tone.fg, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.courier}</span>
                  <span style={{ fontFamily: "monospace", fontWeight: 900, color: C.gray900 }}>{c.with_us} with us</span>
                </span>
                <span style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
                  <span><span style={{ fontFamily: "monospace", fontWeight: 900, fontSize: 26, color: "#15803D" }}>{c.packed}</span>
                    <span style={{ fontSize: 12, color: C.gray500 }}> packed</span></span>
                  <span><span style={{ fontFamily: "monospace", fontWeight: 900, fontSize: 26, color: left ? C.orange : C.gray300 }}>{left}</span>
                    <span style={{ fontSize: 12, color: C.gray500 }}> to pack</span></span>
                </span>
                <span style={{ height: 6, borderRadius: 99, background: C.gray100, overflow: "hidden" }}>
                  <span style={{ display: "block", height: "100%", width: `${pct}%`, background: left ? tone.solid : C.green, transition: "width .3s" }} /></span>
                {c.packed_by_day.length > 0 && (
                  <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {c.packed_by_day.map((d) => <span key={d.day} style={{ fontSize: 11.5, fontWeight: 800, background: C.greenLight, color: "#166534",
                      borderRadius: 999, padding: "1px 8px" }}>{dayName(d.day)} {d.count}</span>)}
                  </span>
                )}
                <span style={{ fontSize: 11.5, color: C.gray500 }}>
                  {[c.to_pack && `${c.to_pack} labelled`, c.no_label && `${c.no_label} no label`, c.meesho_only && `${c.meesho_only} on Meesho only`,
                    c.overdue && `${c.overdue} overdue`, c.cancelled_after && `${c.cancelled_after} cancelled after packing`].filter(Boolean).join(" · ") || (left ? "" : "✓ all packed")}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** The parcels of one kind (or every kind still to pack), by courier — cards that fit a phone or a desk. */
function BoardOrders({ w, kind, setKind, courier, setCourier, isMobile }) {
  const [q, setQ] = useState("");
  if (!w?.orders) return null;
  const k = kind || "to_pack_all";
  const list = k === "to_pack_all" ? [...w.orders.to_pack, ...w.orders.meesho_only, ...w.orders.no_label] : w.orders[k] || [];
  const needle = q.trim().toLowerCase();
  const rows = list.filter((o) => (!courier || o.courier === courier)
    && (!needle || [o.sku, o.awb, o.sub_order_no, o.business_name, o.packet_id].some((v) => String(v || "").toLowerCase().includes(needle))));
  const groups = {};
  for (const o of rows) {
    const g = k === "packed" ? `${o.courier} · packed ${dayName(String(o.packed_on || ""))}` : o.courier;
    (groups[g] = groups[g] || []).push(o);
  }
  const meta = KINDS.find((x) => x.k === k);
  const kindOf = new Map();
  KINDS.forEach((x) => (w.orders[x.k] || []).forEach((o) => kindOf.set(o, x)));
  const tabs = [{ k: null, label: "Still to pack", n: w.totals.to_pack + w.totals.no_label + w.totals.meesho_only }, ...KINDS.map((x) => ({ k: x.k, label: x.label, n: w.totals[x.k] }))];
  return (
    <section id="not-scanned" style={{ ...S.card, padding: 0, overflow: "hidden", scrollMarginTop: 12 }}>
      <div style={{ padding: "10px 14px", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", borderBottom: `1px solid ${C.gray100}` }}>
        {tabs.map((t) => (
          <button key={t.k || "all"} onClick={() => setKind(t.k)} aria-pressed={kind === t.k}
            style={{ ...btn(kind === t.k ? "ghostOrange" : "ghost", "sm"), minHeight: 36 }}>{t.label} · {t.n}</button>
        ))}
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search SKU, AWB, sub-order, packet…"
          style={{ ...S.inp, width: isMobile ? "100%" : 240, minHeight: 38, marginLeft: isMobile ? 0 : "auto" }} />
      </div>
      {courier && (
        <div style={{ padding: "6px 14px", fontSize: 12.5, borderBottom: `1px solid ${C.gray100}` }}>
          Showing {courier} only · <button onClick={() => setCourier(null)} style={{ ...btn("ghost", "sm"), padding: "0 8px" }}>All couriers</button>
        </div>
      )}
      {meta && <div style={{ padding: "6px 14px", fontSize: 12, color: C.gray500 }}>{meta.hint}</div>}
      {rows.length === 0 ? (
        <div style={{ padding: 22, textAlign: "center", fontSize: 14, fontWeight: 800, color: list.length ? C.gray500 : C.green }}>
          {list.length ? "Nothing matches." : k === "to_pack_all" ? "✓ Every parcel here is packed." : "None."}</div>
      ) : (
        <div style={{ maxHeight: isMobile ? "none" : 640, overflowY: isMobile ? "visible" : "auto" }}>
          {Object.entries(groups).map(([name, items]) => {
            const t = courierTone(items[0].courier);
            return (
              <div key={name}>
                <div style={{ position: "sticky", top: 0, zIndex: 1, padding: "6px 14px", background: t.bg, color: t.fg, fontWeight: 900, fontSize: 13,
                  borderTop: `1px solid ${t.border}`, borderBottom: `1px solid ${t.border}` }}>{name} · {items.length}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 290px), 1fr))" }}>
                  {items.map((o) => {
                    const ko = kindOf.get(o);
                    return (
                      <div key={`${o.business_id}-${o.sub_order_no}-${o.awb}`} style={{ display: "flex", gap: 10, alignItems: "center", padding: "9px 12px",
                        borderBottom: `1px solid ${C.gray100}`, borderRight: `1px solid ${C.gray100}`, minWidth: 0,
                        background: o.overdue ? "#FFF7ED" : undefined }}>
                        <Photo url={o.image_url} fallback={o.image_fallback_url} size={48} />
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 14, color: C.gray900, wordBreak: "break-all" }}>
                            {o.sku || "—"}{o.size && o.size !== "Free Size" ? <span style={{ fontWeight: 700, color: C.gray500, fontSize: 12 }}> · {o.size}</span> : null}
                            {(o.qty || 1) > 1 && <span style={{ marginLeft: 6, color: "#fff", background: C.red, borderRadius: 6, padding: "0 6px" }}>×{o.qty}</span>}
                          </div>
                          <div style={{ fontSize: 12, color: C.gray600, marginTop: 2, wordBreak: "break-all" }}>
                            <span style={{ fontFamily: "monospace" }}>{o.awb || "no AWB yet"}</span>
                            {o.packet_id ? <> ↔ <span style={{ fontFamily: "monospace" }}>{o.packet_id}</span></> : null}
                            {o.business_name ? ` · ${o.business_name}` : ""}</div>
                          <div style={{ fontSize: 11.5, color: C.gray400, display: "flex", gap: 6, flexWrap: "wrap" }}>
                            <span style={{ fontFamily: "monospace" }}>{o.sub_order_no}</span>
                            {o.dispatch_by && <span style={{ color: o.overdue ? C.red : C.gray500, fontWeight: o.overdue ? 800 : 600 }}>dispatch by {dayName(o.dispatch_by)}</span>}
                            {o.linked_at && <span>packed {when(o.linked_at)}</span>}
                            {k === "to_pack_all" && ko && ko.k !== "to_pack" && <span style={{ color: ko.color, fontWeight: 800 }}>{ko.label.toLowerCase()}</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/**
 * Scan → today: the day's labels, how many are packed and how many are left —
 * one big number and a bar — this session's pace, and each courier as a slim
 * row (tap one to list only its parcels).
 */
function TodayProgress({ w, plan, count, cancelledAfter, session, at, courier, setCourier, isMobile }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  if (!w) return null;
  const t0 = w.totals;
  const total = t0.with_us, packed = t0.packed, left = t0.to_pack + t0.no_label + t0.meesho_only;
  const pct = total ? Math.round((100 * packed) / total) : 0;
  const done = total > 0 && left === 0;
  const recent = session.filter((t) => Date.now() - t < 10 * 60000).length;
  const lastAt = session.length ? session[session.length - 1] : null;
  const since = lastAt ? Math.round((Date.now() - lastAt) / 1000) : null;
  const couriers = w.by_courier.filter((c) => named(c.courier) && c.with_us > 0)
    .map((c) => ({ courier: c.courier, total: c.with_us, linked: c.packed, left: c.to_pack + c.no_label + c.meesho_only }));
  return (
    <section style={{ ...S.card, padding: isMobile ? 12 : 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: C.gray600 }}>With us now</span>
        <LiveDot at={at} />
        <span style={{ marginLeft: "auto", fontSize: 12.5, color: C.gray600 }}><b style={{ color: "#15803D" }}>{count ?? 0}</b> packed today</span>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 14, flexWrap: "wrap" }}>
        <div style={{ lineHeight: 1 }}>
          <span style={{ fontFamily: "monospace", fontWeight: 900, fontSize: isMobile ? 40 : 48, color: done ? "#15803D" : C.gray900 }}>{packed}</span>
          <span style={{ fontSize: 16, fontWeight: 800, color: C.gray400 }}> / {total} packed</span>
        </div>
        <div style={{ fontSize: 15, fontWeight: 900, color: done ? "#15803D" : left ? C.orange : C.gray400, paddingBottom: 4 }}>
          {total === 0 ? "Nothing waiting" : done ? "✓ All packed" : `${left} left to pack`}
        </div>
      </div>
      <div style={{ height: 10, borderRadius: 99, background: C.gray100, overflow: "hidden" }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div style={{ width: `${pct}%`, height: "100%", borderRadius: 99, background: done ? "#16A34A" : C.orange, transition: "width .4s" }} />
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12.5, color: C.gray600 }}>
        <span>This session <b style={{ color: C.gray900 }}>{session.length}</b>{recent ? ` · ${(recent / 10).toFixed(1)}/min` : ""}</span>
        <span>Last scan <b style={{ color: C.gray900 }}>{since == null ? "—" : since < 60 ? `${since}s ago` : since < 3600 ? `${Math.floor(since / 60)} min ago` : time(new Date(lastAt).toISOString())}</b></span>
        {t0.overdue ? <span style={{ color: C.red, fontWeight: 700 }}>{t0.overdue} past dispatch-by</span> : null}
        {t0.cancelled_after || cancelledAfter ? <span style={{ color: C.red, fontWeight: 700 }}>{t0.cancelled_after || cancelledAfter} cancelled after packing — keep aside</span> : null}
        {plan?.total ? <span>Today's labels <b style={{ color: C.gray900 }}>{plan.linked}/{plan.total}</b></span> : null}
      </div>
      {couriers.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 260px), 1fr))", gap: "4px 16px",
          borderTop: `1px solid ${C.gray100}`, paddingTop: 10 }}>
          {couriers.map((c) => {
            const t = courierTone(c.courier);
            const on = courier === c.courier;
            const cp = c.total ? (100 * c.linked) / c.total : 0;
            return (
              <button key={c.courier} onClick={() => setCourier(on ? null : c.courier)} aria-pressed={on}
                style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "2px 10px", alignItems: "center", textAlign: "left",
                  border: `1.5px solid ${on ? t.solid : "transparent"}`, background: on ? t.bg : "transparent", borderRadius: 10,
                  padding: "6px 8px", cursor: "pointer", fontFamily: "inherit", minHeight: 0 }}>
                <span style={{ fontWeight: 800, fontSize: 13.5, color: t.fg, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.courier}</span>
                <span style={{ fontSize: 12.5, color: C.gray600, whiteSpace: "nowrap" }}>
                  <b style={{ fontFamily: "monospace", color: c.left ? C.gray900 : "#15803D" }}>{c.linked}/{c.total}</b>
                  {c.left ? <span style={{ color: C.orange, fontWeight: 800 }}> · {c.left} left</span> : " ✓"}
                </span>
                <span style={{ gridColumn: "1 / -1", height: 5, borderRadius: 99, background: C.gray100, overflow: "hidden" }}>
                  <span style={{ display: "block", height: "100%", width: `${cp}%`, background: c.left ? t.solid : "#16A34A", transition: "width .4s" }} />
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** Scan → the parcels: what's left to pack today, or what was packed — tap to switch; one courier when one is picked. */
function ScanLists({ w, courier, setCourier, isMobile }) {
  const [show, setShow] = useState("left");
  const [q, setQ] = useState("");
  if (!w?.orders) return null;
  const needle = q.trim().toLowerCase();
  const match = (o) => (!courier || o.courier === courier)
    && (!needle || [o.sku, o.awb, o.sub_order_no, o.packet_id, o.business_name].some((v) => String(v || "").toLowerCase().includes(needle)));
  // Overdue first, then by courier; packed newest first.
  const leftAll = [...w.orders.to_pack, ...w.orders.meesho_only, ...w.orders.no_label]
    .sort((a, b) => (b.overdue ? 1 : 0) - (a.overdue ? 1 : 0) || String(a.courier).localeCompare(String(b.courier)));
  const kindOf = new Map();
  KINDS.forEach((x) => (w.orders[x.k] || []).forEach((o) => kindOf.set(o, x)));
  const left = leftAll.filter(match);
  const packed = [...w.orders.packed].sort((a, b) => String(b.linked_at || "").localeCompare(String(a.linked_at || ""))).filter(match);
  const nLeft = w.totals.to_pack + w.totals.no_label + w.totals.meesho_only;
  const rows = show === "left" ? left : packed;
  const seg = (k, label, n, color) => (
    <button key={k} onClick={() => setShow(k)} aria-pressed={show === k}
      style={{ flex: 1, border: "none", borderRadius: 8, padding: "8px 12px", fontSize: 13.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
        background: show === k ? C.white : "transparent", color: show === k ? color : C.gray500,
        boxShadow: show === k ? "0 1px 3px rgba(15,23,42,.12)" : "none" }}>{label} · {n}</button>
  );
  return (
    <section style={{ ...S.card, padding: 0, overflow: "hidden" }}>
      <div style={{ padding: isMobile ? 10 : 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", borderBottom: `1px solid ${C.gray100}` }}>
        <div role="tablist" style={{ display: "flex", gap: 3, padding: 3, borderRadius: 10, background: C.gray100, flex: isMobile ? "1 1 100%" : "0 0 300px" }}>
          {seg("left", "Left to pack", nLeft, C.orange)}
          {seg("packed", "Packed", w.totals.packed, "#15803D")}
        </div>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search SKU, AWB, sub-order…" aria-label="Search parcels"
          style={{ ...S.inp, flex: 1, minWidth: 160, minHeight: 38 }} />
        {courier && <button onClick={() => setCourier(null)} style={{ ...btn("ghost", "sm") }}>{courier} ✕</button>}
      </div>
      {rows.length === 0 ? (
        <div style={{ padding: 22, textAlign: "center", fontSize: 14, fontWeight: 800, color: show === "left" && !needle && !courier ? C.green : C.gray500 }}>
          {needle || courier ? "Nothing matches." : show === "left" ? "✓ Every parcel with us is packed." : "Nothing packed and waiting for pickup."}
        </div>
      ) : (
        <div style={{ maxHeight: isMobile ? "none" : 600, overflowY: isMobile ? "visible" : "auto",
          display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 340px), 1fr))", alignContent: "start" }}>
          {rows.map((o) => {
            const t = courierTone(o.courier || "");
            const ko = show === "left" ? kindOf.get(o) : null;
            return (
              <div key={`${o.business_id}-${o.sub_order_no}-${o.awb}`}
                style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 12px", borderBottom: `1px solid ${C.gray100}`,
                  borderRight: isMobile ? "none" : `1px solid ${C.gray100}`, minWidth: 0,
                  background: o.overdue && show === "left" ? "#FFF7ED" : undefined }}>
                <Photo url={o.image_url} fallback={o.image_fallback_url} size={44} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap" }}>
                    <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 13.5, color: C.gray900, wordBreak: "break-all" }}>{o.sku || "—"}</span>
                    {o.size && o.size !== "Free Size" ? <span style={{ fontSize: 12, color: C.gray500, fontWeight: 700 }}>{o.size}</span> : null}
                    {(o.qty || 1) > 1 && <span style={{ fontSize: 12, fontWeight: 900, color: "#fff", background: C.red, borderRadius: 6, padding: "0 6px" }}>×{o.qty}</span>}
                  </div>
                  <div style={{ fontSize: 12, color: C.gray500, display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
                    {named(o.courier) && <span style={{ fontWeight: 800, color: t.fg }}>{o.courier}</span>}
                    <span style={{ fontFamily: "monospace", wordBreak: "break-all" }}>{o.awb || "no label yet"}{show === "packed" && o.packet_id ? ` ↔ ${o.packet_id}` : ""}</span>
                    {o.business_name && <span>· {o.business_name}</span>}
                  </div>
                  <div style={{ fontSize: 11.5, color: C.gray400, display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {show === "packed" && o.linked_at && <span style={{ color: "#15803D", fontWeight: 700 }}>packed {when(o.linked_at)}</span>}
                    {show === "left" && o.dispatch_by && <span style={{ color: o.overdue ? C.red : C.gray500, fontWeight: o.overdue ? 800 : 600 }}>dispatch by {dayName(o.dispatch_by)}</span>}
                    {ko && ko.k === "meesho_only" && <span style={{ color: ko.color, fontWeight: 800 }}>linked on Meesho — scan it here</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** "● Live" — the counts are read every few seconds; grey if they haven't been for a while. */
function LiveDot({ at }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 5000); return () => clearInterval(t); }, []);
  const stale = !at || Date.now() - at.getTime() > 20000;
  return (
    <span title={at ? `Counts read at ${at.toLocaleTimeString("en-IN")}` : "Not read yet"}
      style={{ display: "inline-flex", gap: 4, alignItems: "center", fontSize: 10.5, fontWeight: 800, color: stale ? C.gray400 : C.green,
        textTransform: "uppercase", letterSpacing: ".05em" }}>
      <span aria-hidden style={{ width: 7, height: 7, borderRadius: 99, background: stale ? C.gray300 : C.green }} />
      {stale ? "Reconnecting" : "Live"}
    </span>
  );
}

export function MeeshoLinkingTab() {
  const isMobile = useIsMobile();
  const [data, setData] = useState(null);
  const [awb, setAwb] = useState("");
  const [packet, setPacket] = useState("");
  const [result, setResult] = useState(null);
  const [blocked, setBlocked] = useState(null);     // an error the desk must acknowledge before scanning on
  const [sending, setSending] = useState(false);
  const [q, setQ] = useState("");
  const [logKey, setLogKey] = useState(0);
  const [courierBusy, setCourierBusy] = useState(false);
  const [relinking, setRelinking] = useState(null);     // {id, packet} — a link being sent to Meesho again
  const [checking, setChecking] = useState(false);
  const [rowNote, setRowNote] = useState(null);
  const [courier, setCourier] = useState(null);
  const [muted, setMute] = useState(isMuted());
  const [countsAt, setCountsAt] = useState(null);     // when the counts on screen were read
  const [kind, setKind] = useState(null);             // the board's list: null = everything still to pack
  const [session, setSession] = useState([]);         // when each green scan of this session was made
  const [showLinks, setShowLinks] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [pick, setPick] = useState(null);             // Scan: one courier's parcels only
  const [view, setView] = useTabParam("view", ["scan", "with-us"]);
  const inFlight = useRef(false);
  const reloadTimer = useRef(null);
  const awbRef = useRef(null);
  const packetRef = useRef(null);
  // When each code started arriving: a scanner types a whole code in a blink,
  // a person doesn't — Meesho is told which ("SCAN" / "MANUAL"), as its panel does.
  const typed = useRef({ awb: null, packet: null, awbAt: null });

  const load = useCallback(async () => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    const r = await call(`?${p}`);
    if (r.ok) { setData(r.data); setCountsAt(new Date()); }
  }, [q]);
  // The day's counts as the server has them right now — from a scan's own answer, or read again.
  const applyCounts = useCallback((c) => {
    if (!c) return false;
    let sameDay = true;
    setData((prev) => {
      if (!prev) return prev;
      if (String(c.day) !== String(prev.day)) { sameDay = false; return prev; }
      const left = c.plan.left_awbs ? new Set(c.plan.left_awbs) : null;
      const plan = prev.plan && { ...prev.plan, ...c.plan, left_awbs: undefined,
        left_orders: left ? prev.plan.left_orders.filter((o) => left.has(o.awb)) : prev.plan.left_orders };
      let with_us = prev.with_us;
      if (c.with_us && with_us) {
        const still = new Set(c.with_us.to_pack_awbs || []);
        with_us = { ...with_us, ...c.with_us, orders: with_us.orders && { ...with_us.orders,
          to_pack: with_us.orders.to_pack.filter((o) => still.has(o.awb)) } };
      }
      return { ...prev, count: c.count, cancelled_after: c.cancelled_after, by_courier: c.by_courier, plan, with_us };
    });
    setCountsAt(new Date());
    return sameDay;
  }, []);
  const readCounts = useCallback(async () => {
    const r = await call("counts/").catch(() => null);
    if (r?.ok && !applyCounts(r.data)) load();      // the packing day turned: read everything again
  }, [applyCounts, load]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { awbRef.current?.focus(); }, []);
  // The full list again a few seconds after the last link — never in a scan's way.
  const reloadSoon = useCallback((ms = 4000) => { clearTimeout(reloadTimer.current); reloadTimer.current = setTimeout(load, ms); }, [load]);
  useEffect(() => {
    const t = setInterval(() => { if (!inFlight.current) load(); }, 60000);   // labels downloaded meanwhile
    // The counts, live: read again every 5 seconds while the page is open — scans at another desk show too.
    const live = setInterval(() => { if (!inFlight.current && document.visibilityState === "visible") readCounts(); }, 5000);
    return () => { clearInterval(t); clearInterval(live); clearTimeout(reloadTimer.current); };
  }, [load, readCounts]);

  // A link Meesho took: shown from its own answer at once — the link, and the day's counts with it in them.
  const applyLinked = (d) => {
    if (!d?.link) return;
    const l = d.link;
    const fresh = !data?.links.some((x) => x.id === l.id);
    setData((prev) => {
      if (!prev) return prev;
      const links = [l, ...prev.links.filter((x) => x.id !== l.id)];
      // The parcel moves from "left to pack" to "packed" on the With us lists at once — the reload a few seconds later confirms it.
      const wo = prev.with_us?.orders;
      if (wo) {
        const hit = [...wo.to_pack, ...wo.meesho_only, ...wo.no_label].find((o) => o.awb === l.awb);
        const drop = (xs) => xs.filter((o) => o.awb !== l.awb);
        if (hit) {
          prev = { ...prev, with_us: { ...prev.with_us, orders: { ...wo, to_pack: drop(wo.to_pack), meesho_only: drop(wo.meesho_only), no_label: drop(wo.no_label),
            packed: [{ ...hit, packet_id: l.packet_id, linked_at: l.linked_at, packed_on: l.linked_at?.slice(0, 10) }, ...drop(wo.packed)] } } };
        }
      }
      if (d.counts) return { ...prev, links };
      // No counts in the answer: count it here — it's packed the moment Meesho said yes.
      let plan = prev.plan;
      const hit = plan?.left_orders.find((o) => o.awb === l.awb);
      if (plan && fresh) {
        const courier = hit?.courier;
        plan = { ...plan, linked: plan.linked + 1, total: hit ? plan.total : plan.total + 1, left: hit ? Math.max(0, plan.left - 1) : plan.left,
          left_orders: plan.left_orders.filter((o) => o.awb !== l.awb),
          by_courier: plan.by_courier.map((c) => (courier && c.courier === courier ? { ...c, linked: c.linked + 1, left: Math.max(0, c.left - 1) } : c)) };
      }
      return { ...prev, links, count: (prev.count || 0) + (fresh ? 1 : 0), plan };
    });
    if (d.counts) applyCounts(d.counts);
  };
  // Any error or alert: both fields are emptied at once, so the next scan starts fresh —
  // the error itself still shows which AWB and packet it was (and "Link anyway" uses those).
  const stop = (b) => {
    setResult(null);
    setAwb(""); setPacket("");
    typed.current = { awb: null, packet: null, awbAt: null };
    setBlocked(b);
    document.activeElement?.blur?.();
    if (String(b.code || "").startsWith("already_linked")) sounds.warn(); else sounds.error();
    navigator.vibrate?.([200, 100, 200, 100, 200]);
  };

  // Put the cursor in a field, its text selected — a fresh scan replaces it.
  const focusField = (ref) => setTimeout(() => { ref.current?.focus(); ref.current?.select(); }, 50);   // after the fields are enabled again
  // Which field a refusal is about — its border shows red.
  const AWB_ERRORS = ["unknown_awb", "two_packets", "scan_failed"];
  const method = (startedAt) => (startedAt && Date.now() - startedAt < 600 ? "SCAN" : "MANUAL");
  const onType = (field, setter) => (e) => {
    if (!e.target.value) typed.current[field] = null;
    else if (!typed.current[field]) typed.current[field] = Date.now();
    setter(e.target.value);
  };

  const link = async (a, p, override = false) => {
    if (inFlight.current) return;                          // one link at a time — a double Enter never sends twice
    // Linked here already with this very packet: said at once, without asking Meesho.
    const dup = !override && data?.links.find((x) => x.awb === a && x.packet_id === p);
    if (dup) {
      stop({ awb: a, packet: p, code: "already_linked_here",
        error: `AWB ${a} was linked to ${p} here at ${time(dup.linked_at)}${dup.linked_by ? ` by ${dup.linked_by}` : ""} — scan the next parcel.` });
      return;
    }
    inFlight.current = true;
    setSending(true);
    setBlocked(null);
    const t = typed.current;
    let r;
    try {
      r = await call("", "POST", {
        awb: a, packet_id: p, override,
        awb_method: t.awbMethod || "MANUAL", awb_ts: t.awbAt || Date.now(),
        packet_method: method(t.packet), packet_ts: Date.now(),
      });
    } catch (e) {
      r = { ok: false, data: e?.name === "AbortError"
        ? { error: "No answer in 30 seconds — it may or may not have linked. Check “Today's links” (or the log) before scanning this parcel again.", code: "timeout" }
        : { error: "Couldn't reach the server — nothing was linked or marked packed. Check the internet connection.", code: "network" } };
    } finally {
      inFlight.current = false;
      setSending(false);
    }
    if (r.ok) {
      // Linked on Meesho, and only then marked packed: on to the next parcel.
      sounds.ok();
      navigator.vibrate?.(60);
      setResult({ ok: true, ...r.data });
      if (!data?.links.some((x) => x.id === r.data.link?.id)) setSession((xs) => [...xs, Date.now()]);
      applyLinked(r.data);
      setAwb(""); setPacket("");
      typed.current = { awb: null, packet: null, awbAt: null };
      focusField(awbRef);
      reloadSoon();
    } else {
      // Anything else — refused, already linked, not found: nothing was marked
      // packed. The screen stops until someone presses OK.
      stop({ awb: a, packet: p, ...r.data });
      setLogKey((k) => k + 1);
      reloadSoon(r.data.code === "timeout" ? 500 : 4000);
    }
  };
  // OK on the error: both fields are already empty — start again from the AWB.
  const acknowledge = () => {
    setBlocked(null);
    setAwb(""); setPacket("");
    typed.current = { awb: null, packet: null, awbAt: null };
    focusField(awbRef);
  };

  // A scanner types the code and presses Enter: AWB → on to the packet; packet → link.
  const onAwbEnter = (e) => {
    e.preventDefault();
    const code = clean(awb);
    if (!code) return;
    if (isPacket(code)) {                                   // the packet QR scanned first: put it where it belongs
      setPacket(code); setAwb("");
      focusField(awbRef);
      return;
    }
    setAwb(code);
    typed.current.awbMethod = method(typed.current.awb);
    typed.current.awbAt = Date.now();
    if (clean(packet)) link(code, clean(packet));
    else focusField(packetRef);
  };
  const onPacketEnter = (e) => {
    e.preventDefault();
    const code = clean(packet);
    if (!code) return;
    setPacket(code);
    if (!clean(awb)) { focusField(awbRef); return; }
    link(clean(awb), code);
  };
  const clearAll = () => { setAwb(""); setPacket(""); setResult(null); focusField(awbRef); };

  // Send a link to Meesho again — the same packet, or a new one typed in.
  const relink = async (l, packetId) => {
    setRowNote(null);
    const r = await call(`${l.id}/relink/`, "POST", { packet_id: packetId || l.packet_id, packet_method: packetId ? "SCAN" : "MANUAL" })
      .catch(() => ({ ok: false, data: { error: "No answer from the server." } }));
    if (r.ok) sounds.ok(); else sounds.error();
    setRelinking(null);
    setRowNote(r.ok
      ? { ok: true, text: `Relinked ${l.awb} → ${r.data.link?.packet_id || packetId || l.packet_id} on Meesho.` }
      : { ok: false, text: `${r.data.error || "Relink failed — it's in the log."} Not marked packed.` });
    load(); setLogKey((k) => k + 1);
  };
  // Read Meesho's lists again, then show each link's state from them.
  const checkMeesho = async () => {
    setChecking(true);
    await call("check/", "POST");
    for (let i = 0; i < 20; i++) {
      await new Promise((ok) => setTimeout(ok, 3000));
      const st = await fetch(`${API}/meesho-orders/linking/`).then((x) => x.json()).catch(() => null);
      if (st && !st.syncing) break;
    }
    await load();
    setChecking(false);
  };
  const unlink = async (l) => {
    if (!window.confirm(`Unlink AWB ${l.awb} from packet ${l.packet_id}? (It stays packed in Order Scan.)`)) return;
    await call(`${l.id}/`, "DELETE");
    load(); setLogKey((k) => k + 1);
  };
  const refreshCouriers = async () => {
    setCourierBusy(true);
    await call("couriers/refresh/", "POST");
    setCourierBusy(false);
    load();
  };
  const renameCourier = async (c) => {
    const name = window.prompt(`Name for courier #${c.carrier_id}:`, c.name || "");
    if (name === null) return;
    await call(`couriers/${c.carrier_id}/`, "PATCH", { name });
    load();
  };

  if (!data) return <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><CircularProgress style={{ color: C.orange }} /></div>;
  const r = result;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {blocked && <BlockingError e={blocked} onOk={acknowledge}
        onOverride={blocked.can_override ? () => link(blocked.awb, blocked.packet, true) : null} />}

      <SubTabs value={view} onChange={setView} tabs={[
        { key: "scan", label: "Scan", icon: "⌗", count: data.with_us ? `${data.with_us.totals.packed}/${data.with_us.totals.with_us}` : null, color: "#9F2089" },
        { key: "with-us", label: "With us", icon: "📦", count: data.with_us?.totals.with_us ?? null, color: "#9F2089" },
      ]} />

      {view === "scan" && <>
        {/* The scanner: AWB, then packet — Enter (a scanner sends it) moves on and links. */}
        <div style={{ ...S.card, padding: isMobile ? 12 : 16, display: "flex", flexDirection: "column", gap: 10, borderTop: `4px solid #9F2089` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12.5, color: C.gray500, flex: 1 }}>Scan the label's AWB, then the packet QR. A chirp means linked; an alarm means stop and look.</span>
            <button onClick={() => { const m = !muted; setMuted(m); setMute(m); if (!m) sounds.ok(); }} aria-pressed={!muted} aria-label={muted ? "Sound off" : "Sound on"}
              style={{ ...btn("ghost", "sm"), minHeight: 34, padding: "4px 10px" }}>{muted ? "🔇" : "🔊"}</button>
          </div>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "minmax(0, 1fr) minmax(0, 1fr) auto", alignItems: "end" }}>
            <form onSubmit={onAwbEnter} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label htmlFor="link-awb" style={{ fontSize: 12.5, fontWeight: 800, color: C.gray600 }}>1 · AWB</label>
              <input id="link-awb" ref={awbRef} value={awb} onChange={onType("awb", setAwb)} autoFocus readOnly={sending} disabled={!!blocked}
                inputMode={isMobile ? "text" : undefined} enterKeyHint="next"
                autoComplete="off" placeholder="Scan the AWB…"
                style={{ ...S.inp, fontSize: 18, fontFamily: "monospace", padding: "12px 14px",
                  borderColor: r && !r.ok && (AWB_ERRORS.includes(r.code) || (r.code === "missing" && !awb)) ? C.red : undefined }} />
            </form>
            <form onSubmit={onPacketEnter} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label htmlFor="link-packet" style={{ fontSize: 12.5, fontWeight: 800, color: C.gray600 }}>2 · Packet QR (KP…)</label>
              <input id="link-packet" ref={packetRef} value={packet} onChange={onType("packet", setPacket)} readOnly={sending} disabled={!!blocked}
                enterKeyHint="go"
                autoComplete="off" placeholder="Scan the packet QR…"
                style={{ ...S.inp, fontSize: 18, fontFamily: "monospace", padding: "12px 14px",
                  borderColor: r && !r.ok && !AWB_ERRORS.includes(r.code) && !(r.code === "missing" && !awb) ? C.red : undefined }} />
            </form>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => (clean(awb) && clean(packet) ? link(clean(awb), clean(packet)) : focusField(clean(awb) ? packetRef : awbRef))}
                disabled={sending} style={{ ...btn("primary", "md"), flex: isMobile ? 1 : "none", minWidth: 110, padding: "12px 16px" }}>
                {sending ? "Linking…" : "Link"}
              </button>
              {(awb || packet || r) && <button onClick={clearAll} style={{ ...btn("ghost", "md"), padding: "12px 14px" }}>Clear</button>}
            </div>
          </div>
          {sending && (
            <div role="status" style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14, fontWeight: 800, color: C.gray600, padding: "4px 2px" }}>
              <CircularProgress size={18} style={{ color: C.orange }} /> Linking on Meesho…
            </div>
          )}
          {!sending && r?.ok && <LinkedCard r={r} />}
          {data.open_errors > 0 && (
            <button onClick={() => { setShowMore(true); setTimeout(() => document.getElementById("link-log")?.scrollIntoView({ behavior: "smooth" }), 50); }}
              style={{ ...btn("ghost", "sm"), color: C.red, alignSelf: "flex-start" }}>⚠ {data.open_errors} scan problem{data.open_errors === 1 ? "" : "s"} to look at</button>
          )}
        </div>

        <TodayProgress w={data.with_us} plan={data.plan} count={data.count} cancelledAfter={data.cancelled_after} session={session} at={countsAt}
          courier={pick} setCourier={setPick} isMobile={isMobile} />
        <ScanLists w={data.with_us} courier={pick} setCourier={setPick} isMobile={isMobile} />

        {/* Everything else, out of the way: every link with its state on Meesho (relink / unlink), courier names, the log. */}
        <button onClick={() => setShowMore((x) => !x)} aria-expanded={showMore}
          style={{ ...btn("ghost", "sm"), alignSelf: "flex-start", minHeight: 36 }}>{showMore ? "▾ Less" : "▸ More — today's links on Meesho, couriers, log"}</button>
        {showMore && <>
      <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 14px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderBottom: `1px solid ${C.gray100}` }}>
          <button onClick={() => setShowLinks((x) => !x)} style={{ ...btn("ghost", "sm"), minHeight: 32 }}>{showLinks ? "▾" : "▸"}</button>
          <span style={{ fontWeight: 800, fontSize: 14.5, flex: 1 }}>
            Today's links · {data.links.length}
            {data.states && <span style={{ fontSize: 12, fontWeight: 600, color: C.gray500, marginLeft: 8 }}>
              {Object.entries(data.states).map(([k, n]) => `${n} ${(STATE[k]?.label || k).toLowerCase()}`).join(" · ")}
              {data.checked_at ? ` · Meesho checked ${when(data.checked_at)}` : ""}
            </span>}
          </span>
          <button onClick={checkMeesho} disabled={checking} style={{ ...btn("ghost", "sm"), opacity: checking ? 0.6 : 1 }}>
            {checking ? "Checking with Meesho…" : "↻ Check with Meesho"}
          </button>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search AWB, packet, sub-order, SKU…" style={{ ...S.inp, width: 240 }} />
        </div>
        {rowNote && <div role="status" style={{ padding: "8px 14px", fontSize: 13, fontWeight: 700, color: rowNote.ok ? "#15803D" : C.red, borderBottom: `1px solid ${C.gray100}` }}>
          {rowNote.ok ? "✓ " : "✕ "}{rowNote.text}</div>}
        {showLinks && <div style={{ overflowX: "auto", maxHeight: 460, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead><tr>{["Time", "AWB", "Packet", "Business", "Sub-order / SKU", "Courier", "On Meesho now", "Order Scan", ""].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {data.links.length === 0 && <tr><td colSpan={9} style={{ ...S.td, textAlign: "center", color: C.gray400, padding: 20 }}>Nothing linked yet today.</td></tr>}
              {data.links.map((l) => (
                <tr key={l.id}>
                  <td style={{ ...S.td, whiteSpace: "nowrap", color: C.gray500 }}>{time(l.linked_at)}</td>
                  <td style={{ ...S.td, fontFamily: "monospace" }}>{l.awb}</td>
                  <td style={{ ...S.td, fontFamily: "monospace" }}>
                    {relinking?.id === l.id ? (
                      <span style={{ display: "inline-flex", gap: 4 }}>
                        <input autoFocus value={relinking.packet} onChange={(e) => setRelinking({ id: l.id, packet: e.target.value.toUpperCase() })}
                          onKeyDown={(e) => { if (e.key === "Enter") relink(l, relinking.packet.trim()); if (e.key === "Escape") setRelinking(null); }}
                          placeholder="New KP…" style={{ ...S.inp, width: 150, padding: "4px 8px", fontFamily: "monospace" }} />
                        <button onClick={() => relink(l, relinking.packet.trim())} style={btn("primary", "sm")}>Send</button>
                      </span>
                    ) : l.packet_id}
                  </td>
                  <td style={S.td}>{l.business_name}</td>
                  <td style={S.td}><span style={{ fontFamily: "monospace" }}>{l.sub_order_no || "—"}</span><div style={{ fontSize: 11.5, color: C.gray500 }}>{l.sku}</div></td>
                  <td style={S.td}>{l.courier || (l.carrier_id ? `#${l.carrier_id}` : "—")}</td>
                  <td style={S.td}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
                      {STATE[l.state] ? <Tag variant={STATE[l.state].tag}>{STATE[l.state].label}</Tag> : <Tag variant="gray">{l.meesho_status || "Not sent"}</Tag>}
                      {l.state === "other_packet" && <span style={{ fontSize: 11, fontFamily: "monospace", color: C.gray600 }}>Meesho has {l.meesho_packet}</span>}
                      {l.check === "OVERRIDDEN" && <Tag variant="amber">Linked anyway</Tag>}
                      {["linked_here_only", "other_packet"].includes(l.state) && (
                        <span style={{ display: "inline-flex", gap: 4 }}>
                          <button onClick={() => relink(l)} title="Send this AWB and packet to Meesho again" style={{ ...btn("ghost", "sm"), padding: "2px 8px" }}>↻ Relink</button>
                          <button onClick={() => setRelinking({ id: l.id, packet: "" })} title="Link a different packet" style={{ ...btn("ghost", "sm"), padding: "2px 8px" }}>New packet</button>
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={S.td}>{l.scan_status ? <Tag variant={l.scan_status === "PACKED" ? "green" : "blue"}>{l.scan_status.toLowerCase()}</Tag> : "—"}</td>
                  <td style={S.td}><button onClick={() => unlink(l)} title="Unlink" style={{ border: "none", background: "none", color: C.gray400, cursor: "pointer", fontSize: 16 }}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>}
      </div>

      <div style={{ ...S.card, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 800, fontSize: 14.5, flex: 1 }}>Courier partners</span>
          <button onClick={refreshCouriers} disabled={courierBusy} style={btn("ghost", "sm")}>{courierBusy ? "Reading…" : "↻ Learn from shipments & labels"}</button>
        </div>
        <span style={{ fontSize: 12, color: C.gray500 }}>Meesho names couriers only by id; each id's name is read off the labels of its shipments.{data.is_admin ? " Click a name to change it." : ""}</span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {data.couriers.length === 0 && <span style={{ fontSize: 12.5, color: C.gray400 }}>None yet — press “Learn from shipments & labels”.</span>}
          {data.couriers.map((c) => (
            <button key={c.carrier_id} onClick={data.is_admin ? () => renameCourier(c) : undefined}
              style={{ border: `1px solid ${C.gray200}`, background: C.white, borderRadius: 10, padding: "6px 10px", fontSize: 12.5, cursor: data.is_admin ? "pointer" : "default", textAlign: "left" }}>
              <span style={{ color: C.gray400, fontFamily: "monospace" }}>#{c.carrier_id}</span> <b>{c.name || "name not known"}</b>
              <span style={{ color: C.gray400 }}> · {c.shipments} shipments{c.source === "manual" ? " · set by hand" : ""}</span>
            </button>
          ))}
        </div>
      </div>

          <div id="link-log"><Logs key={logKey} onChanged={load} /></div>
        </>}
      </>}

      {view === "with-us" && <>
        <WithUsBoard w={data.with_us} kind={kind} setKind={setKind} courier={courier} setCourier={setCourier} isMobile={isMobile} />
        <BoardOrders w={data.with_us} kind={kind} setKind={setKind} courier={courier} setCourier={setCourier} isMobile={isMobile} />
      </>}
    </div>
  );
}

/**
 * Order Linking as a page of its own (/meesho-linking), so it can be given to a
 * packing-desk person on its own — without the rest of Meesho.
 */
export function MeeshoLinkingPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 1440 }}>
      <h1 style={{ fontSize: 22, fontWeight: 900, color: C.gray900, margin: 0, letterSpacing: "-0.02em" }}>
        <span aria-hidden>🔗 </span>Order linking
      </h1>
      <MeeshoLinkingTab />
    </div>
  );
}
