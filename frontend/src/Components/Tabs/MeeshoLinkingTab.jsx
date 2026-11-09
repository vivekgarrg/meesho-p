import React, { useState, useEffect, useCallback, useRef } from "react";
import { API, C, S, btn, Tag, useIsMobile } from "../../App";
import { CircularProgress } from "@mui/material";
import { Photo, courierTone } from "./OrderScanTab";
import { sounds, isMuted, setMuted } from "../../lib/sounds";

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

/** The day's Meesho parcels: linked against the total, per courier and overall, and what's left. */
function Progress({ plan, isMobile, courier, setCourier }) {
  if (!plan) return null;
  const pct = (a, b) => (b ? Math.min(100, (a / b) * 100) : 0);
  const done = plan.total > 0 && plan.left === 0;
  return (
    <div style={{ ...S.card, padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: C.gray800 }}>
          <span style={{ fontFamily: "monospace", fontSize: 26, color: C.gray900 }}>{plan.linked}</span>
          <span style={{ color: C.gray500 }}> of {plan.total} packed</span>
          <span style={{ display: "block", color: C.gray500, fontWeight: 600, fontSize: 12.5 }}>
            {plan.downloaded ?? plan.total + plan.cancelled} labels downloaded for this packing day (1 pm to 1 pm)
            {plan.cancelled ? ` · ${plan.cancelled} cancelled` : ""}
            {plan.not_on_labels ? ` · ${plan.not_on_labels} more scanned that aren't on these labels` : ""}
          </span>
        </span>
        <span style={{ fontSize: 15, fontWeight: 900, color: plan.total === 0 ? C.gray500 : done ? C.green : C.orange }}>
          {plan.total === 0 ? "No Meesho labels downloaded for this day yet" : done ? "✓ All packed" : `${plan.left} left to scan`}
        </span>
      </div>
      {plan.on_meesho_only > 0 && (
        <div style={{ fontSize: 12.5, color: "#92400E", fontWeight: 600 }}>
          {plan.on_meesho_only} of those left show linked on Meesho already but weren't scanned here — they count only once scanned here.
        </div>
      )}
      <div role="progressbar" aria-label="Linked" aria-valuemin={0} aria-valuemax={plan.total} aria-valuenow={plan.linked}
        style={{ height: 10, borderRadius: 99, background: C.gray100, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct(plan.linked, plan.total)}%`, background: C.green, transition: "width .25s" }} />
      </div>
      {plan.by_courier.length > 0 && (
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(auto-fill, minmax(180px, 1fr))" }}>
          {plan.by_courier.map((c) => {
            const t = courierTone(c.courier);
            const on = courier === c.courier;
            const cdone = c.total > 0 && c.left === 0;
            return (
              <button key={c.courier} onClick={() => setCourier(on ? null : c.courier)} aria-pressed={on}
                style={{ textAlign: "left", cursor: "pointer", fontFamily: "inherit", minWidth: 0, background: on ? t.bg : C.white,
                  border: `2px solid ${on ? t.solid : t.border}`, borderTop: `5px solid ${t.solid}`, borderRadius: 12, padding: "8px 12px",
                  display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: 13, fontWeight: 900, color: t.fg, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.courier}</span>
                <span><span style={{ fontFamily: "monospace", fontWeight: 900, fontSize: 26, color: C.gray900 }}>{c.linked}</span>
                  <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 14, color: C.gray400 }}> / {c.total}</span></span>
                <span style={{ height: 5, borderRadius: 99, background: C.gray100, overflow: "hidden" }}>
                  <span style={{ display: "block", height: "100%", width: `${pct(c.linked, c.total)}%`, background: cdone ? C.green : t.solid }} /></span>
                <span style={{ fontSize: 12, fontWeight: 800, color: cdone ? "#15803D" : C.red }}>{cdone ? "✓ all packed" : `${c.left} left`}</span>
              </button>
            );
          })}
        </div>
      )}
      {plan.left > 0 && (
        <button onClick={() => document.getElementById("not-scanned")?.scrollIntoView({ behavior: "smooth", block: "start" })}
          style={{ ...btn("ghost", "sm"), minHeight: 36, alignSelf: "flex-start" }}>↓ See the {plan.left} not scanned yet</button>
      )}
    </div>
  );
}

/**
 * The day's parcels not scanned (linked) yet — always open at the bottom of the
 * page, by courier, as cards that fit a phone, an iPad or a desktop. A parcel
 * leaves the list the moment its scan goes green (here or at another desk).
 */
function NotScanned({ plan, courier, setCourier, isMobile }) {
  const [q, setQ] = useState("");
  if (!plan) return null;
  const needle = q.trim().toLowerCase();
  const all = plan.left_orders;
  const rows = all.filter((o) => (!courier || o.courier === courier)
    && (!needle || [o.sku, o.awb, o.sub_order_no, o.business_name].some((v) => String(v || "").toLowerCase().includes(needle))));
  const couriers = plan.by_courier.filter((c) => c.left > 0);
  const groups = {};
  for (const o of rows) (groups[o.courier] = groups[o.courier] || []).push(o);
  return (
    <section id="not-scanned" style={{ ...S.card, padding: 0, overflow: "hidden", scrollMarginTop: 12 }}>
      <div style={{ padding: "12px 14px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderBottom: `1px solid ${C.gray100}` }}>
        <span style={{ fontWeight: 900, fontSize: 15, flex: "1 1 200px", color: C.gray900 }}>
          Not scanned yet <span style={{ fontFamily: "monospace", color: plan.left ? C.red : C.green }}>{plan.left}</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: C.gray500, marginLeft: 8 }}>labels downloaded for the day, not linked here</span>
        </span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search SKU, AWB, sub-order…" aria-label="Search not scanned"
          style={{ ...S.inp, width: isMobile ? "100%" : 240, minHeight: 40 }} />
      </div>
      {couriers.length > 1 && (
        <div style={{ padding: "8px 14px", display: "flex", gap: 6, flexWrap: "wrap", borderBottom: `1px solid ${C.gray100}` }}>
          <button onClick={() => setCourier(null)} style={{ ...btn(courier ? "ghost" : "ghostOrange", "sm"), minHeight: 36 }}>All · {plan.left}</button>
          {couriers.map((c) => {
            const t = courierTone(c.courier);
            const on = courier === c.courier;
            return (
              <button key={c.courier} onClick={() => setCourier(on ? null : c.courier)} aria-pressed={on}
                style={{ minHeight: 36, borderRadius: 999, padding: "4px 12px", fontFamily: "inherit", fontSize: 13, fontWeight: 800, cursor: "pointer",
                  border: `1.5px solid ${on ? t.solid : t.border}`, background: on ? t.bg : C.white, color: t.fg }}>{c.courier} · {c.left}</button>
            );
          })}
        </div>
      )}
      {plan.left === 0 ? (
        <div style={{ padding: 22, textAlign: "center", fontSize: 14, fontWeight: 800, color: plan.total ? C.green : C.gray500 }}>
          {plan.total ? "✓ Every parcel for the day is scanned." : "No Meesho labels downloaded for this day yet."}</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 22, textAlign: "center", fontSize: 13.5, color: C.gray500 }}>Nothing matches.</div>
      ) : (
        <div style={{ maxHeight: isMobile ? "none" : 620, overflowY: isMobile ? "visible" : "auto" }}>
          {Object.entries(groups).map(([name, list]) => {
            const t = courierTone(name);
            return (
              <div key={name}>
                <div style={{ position: "sticky", top: 0, zIndex: 1, padding: "6px 14px", background: t.bg, color: t.fg, fontWeight: 900, fontSize: 13,
                  borderTop: `1px solid ${t.border}`, borderBottom: `1px solid ${t.border}` }}>{name} · {list.length}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 280px), 1fr))" }}>
                  {list.map((o) => (
                    <div key={`${o.business_name}-${o.sub_order_no}`} style={{ display: "flex", gap: 10, alignItems: "center", padding: "9px 12px",
                      borderBottom: `1px solid ${C.gray100}`, borderRight: `1px solid ${C.gray100}`, minWidth: 0 }}>
                      <Photo url={o.image_url} fallback={o.image_fallback_url} size={48} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 14, color: C.gray900, wordBreak: "break-all" }}>
                          {o.sku}{o.size ? <span style={{ fontWeight: 700, color: C.gray500, fontSize: 12 }}> · {o.size}</span> : null}
                          <span style={{ marginLeft: 6, color: (o.qty || 1) > 1 ? "#fff" : C.orange, background: (o.qty || 1) > 1 ? C.red : C.orangeLight, borderRadius: 6, padding: "0 6px" }}>×{o.qty || 1}</span>
                        </div>
                        <div style={{ fontSize: 12, color: C.gray600, marginTop: 2, wordBreak: "break-all" }}>
                          <span style={{ fontFamily: "monospace" }}>{o.awb || "no AWB"}</span>{o.business_name ? ` · ${o.business_name}` : ""}</div>
                        <div style={{ fontSize: 11.5, color: C.gray400, fontFamily: "monospace" }}>{o.sub_order_no}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {plan.left > all.length && !courier && !needle && <div style={{ padding: 10, fontSize: 12, color: C.gray500 }}>…and {plan.left - all.length} more.</div>}
        </div>
      )}
    </section>
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
      return { ...prev, count: c.count, cancelled_after: c.cancelled_after, by_courier: c.by_courier, plan };
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
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {blocked && <BlockingError e={blocked} onOk={acknowledge}
        onOverride={blocked.can_override ? () => link(blocked.awb, blocked.packet, true) : null} />}
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
        <p style={{ fontSize: 13, color: C.gray500, margin: 0, maxWidth: 780, flex: 1, minWidth: 220 }}>
          Scan the AWB on the label, then the packet QR (“KP…”). Each pair is linked <b>on Meesho</b> (as its Scan now page does), then stored here
          and the parcel marked <b>packed</b> in Order Scan. A chirp means linked; an alarm means stop and look.
        </p>
        <button onClick={() => { const m = !muted; setMuted(m); setMute(m); if (!m) sounds.ok(); }} aria-pressed={!muted}
          style={{ ...btn("ghost", "sm"), minHeight: 36 }}>{muted ? "🔇 Sound off" : "🔊 Sound on"}</button>
      </div>

      <div style={{ ...S.card, padding: 16, display: "flex", flexDirection: "column", gap: 12, borderTop: `4px solid ${C.orange}` }}>
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "minmax(0, 1fr) minmax(0, 1fr) auto", alignItems: "end" }}>
          <form onSubmit={onAwbEnter} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label htmlFor="link-awb" style={{ fontSize: 12.5, fontWeight: 800, color: C.gray600 }}>1 · AWB (on the label)</label>
            <input id="link-awb" ref={awbRef} value={awb} onChange={onType("awb", setAwb)} autoFocus readOnly={sending} disabled={!!blocked}
              inputMode={isMobile ? "text" : undefined} enterKeyHint="next"
              autoComplete="off" placeholder="Scan the AWB…"
              style={{ ...S.inp, fontSize: 18, fontFamily: "monospace", padding: "12px 14px",
                borderColor: r && !r.ok && (AWB_ERRORS.includes(r.code) || (r.code === "missing" && !awb)) ? C.red : undefined }} />
          </form>
          <form onSubmit={onPacketEnter} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label htmlFor="link-packet" style={{ fontSize: 12.5, fontWeight: 800, color: C.gray600 }}>2 · Packet ID (KP… QR)</label>
            <input id="link-packet" ref={packetRef} value={packet} onChange={onType("packet", setPacket)} readOnly={sending} disabled={!!blocked}
              enterKeyHint="go"
              autoComplete="off" placeholder="Scan the packet QR…"
              style={{ ...S.inp, fontSize: 18, fontFamily: "monospace", padding: "12px 14px",
                borderColor: r && !r.ok && !AWB_ERRORS.includes(r.code) && !(r.code === "missing" && !awb) ? C.red : undefined }} />
          </form>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => (clean(awb) && clean(packet) ? link(clean(awb), clean(packet)) : focusField(clean(awb) ? packetRef : awbRef))}
              disabled={sending} style={{ ...btn("primary", "md"), minWidth: 110, padding: "12px 16px" }}>
              {sending ? "Linking…" : "Link"}
            </button>
            {(awb || packet || r) && <button onClick={clearAll} style={{ ...btn("ghost", "md"), padding: "12px 14px" }}>Clear</button>}
          </div>
        </div>
        {sending && (
          <div role="status" style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14, fontWeight: 800, color: C.gray600, padding: "6px 2px" }}>
            <CircularProgress size={18} style={{ color: C.orange }} /> Linking on Meesho…
          </div>
        )}
        {!sending && r?.ok && <LinkedCard r={r} />}
      </div>

      <Progress plan={data.plan} isMobile={isMobile} courier={courier} setCourier={setCourier} />

      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        <div style={{ ...S.card, padding: "10px 12px" }}><div style={{ fontSize: 12, fontWeight: 800, color: C.green, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          Packed today <LiveDot at={countsAt} /></div>
          <div style={{ fontFamily: "monospace", fontSize: 24, fontWeight: 900 }}>{data.count}</div>
          {data.cancelled_after ? <div style={{ fontSize: 11.5, color: C.gray500 }}>{data.cancelled_after} cancelled after packing — not counted</div> : null}</div>
        <div style={{ ...S.card, padding: "10px 12px" }}><div style={{ fontSize: 12, fontWeight: 800, color: "#2563EB" }}>Match Meesho</div><div style={{ fontFamily: "monospace", fontSize: 24, fontWeight: 900 }}>{data.matched}</div></div>
        <div style={{ ...S.card, padding: "10px 12px" }}><div style={{ fontSize: 12, fontWeight: 800, color: C.red }}>Open problems</div><div style={{ fontFamily: "monospace", fontSize: 24, fontWeight: 900 }}>{data.open_errors}</div></div>
      </div>

      <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 14px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderBottom: `1px solid ${C.gray100}` }}>
          <span style={{ fontWeight: 800, fontSize: 14.5, flex: 1 }}>
            Today's links
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
        <div style={{ overflowX: "auto", maxHeight: 460, overflowY: "auto" }}>
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
        </div>
      </div>

      <NotScanned plan={data.plan} courier={courier} setCourier={setCourier} isMobile={isMobile} />

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

      <Logs key={logKey} onChanged={load} />
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
