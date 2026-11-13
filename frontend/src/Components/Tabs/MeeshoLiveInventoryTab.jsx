import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { API, C, S, btn, Tag, useIsMobile } from "../../App";
import { CircularProgress } from "@mui/material";

/*
 * Meesho Inventory — the Meesho panel's Inventory page (Active, Paused,
 * Activation pending) as the sync worker last read it, for every business on
 * this desk, grouped by parent SKU (as linked on SKU Pricing). An admin can
 * pause a whole parent, a SKU, or any selection: the worker sends it to
 * Meesho one catalog per request and reads the inventory again afterwards.
 */

const VIEWS = [
  { key: "live", label: "Live", tone: "#059669" },
  { key: "paused", label: "Paused", tone: "#B45309" },
  { key: "pending", label: "Activation pending", tone: "#2563EB" },
];
const COUNT_TILES = [
  { key: "active", label: "Active", tone: "#059669" },
  { key: "paused", label: "Paused", tone: "#B45309" },
  { key: "activation_pending", label: "Activation pending", tone: "#2563EB" },
  { key: "blocked", label: "Blocked", tone: C.red },
];
const GROUPS_PER_PAGE = 60;
const BUSY = ["QUEUED", "RUNNING"];

const when = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const money = (v) => (v === null || v === undefined || v === "" ? "—" : `₹${Number(v).toLocaleString("en-IN")}`);
const sum = (xs, f) => xs.reduce((n, x) => n + (f(x) || 0), 0);

function Thumb({ src, size = 40 }) {
  const [bad, setBad] = useState(false);
  return (
    <div style={{ width: size, height: size, borderRadius: 8, overflow: "hidden", flexShrink: 0, background: C.gray50, border: `1px solid ${C.gray200}`,
      display: "flex", alignItems: "center", justifyContent: "center" }}>
      {src && !bad ? <img src={src} alt="" loading="lazy" onError={() => setBad(true)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        : <span style={{ fontSize: 10, color: C.gray400 }}>no image</span>}
    </div>
  );
}

function Check({ checked, partial, onChange, label }) {
  return (
    <input type="checkbox" aria-label={label} checked={checked} ref={(el) => { if (el) el.indeterminate = !checked && partial; }}
      onChange={onChange} onClick={(e) => e.stopPropagation()}
      style={{ width: 18, height: 18, accentColor: C.orange, flexShrink: 0, cursor: "pointer" }} />
  );
}

function StockTag({ n }) {
  if (n === null || n === undefined) return <span style={{ color: C.gray400 }}>—</span>;
  return <span style={{ fontFamily: "monospace", fontWeight: 800, color: n === 0 ? C.red : n < 10 ? "#B45309" : C.gray800 }}>{n}</span>;
}

/** How the latest pause went (one run per business, sent together). */
function PauseStatus({ pauses, showBiz }) {
  const first = pauses?.[0];
  if (!first || Date.now() - new Date(first.queued_at) > 60 * 60 * 1000) return null;
  const t = new Date(first.queued_at);
  const runs = pauses.filter((p) => Math.abs(t - new Date(p.queued_at)) < 60 * 1000);
  const busy = runs.some((r) => BUSY.includes(r.status));
  const ok = runs.every((r) => r.status === "OK");
  const tone = busy ? { bg: "#EFF6FF", border: "#BFDBFE", fg: "#1E3A8A" } : ok ? { bg: C.greenLight, border: C.greenBorder, fg: "#166534" }
    : { bg: C.redLight, border: C.redBorder, fg: C.red };
  const n = sum(runs, (r) => r.records);
  return (
    <div role="status" style={{ background: tone.bg, border: `1.5px solid ${tone.border}`, borderRadius: 12, padding: "10px 14px", color: tone.fg,
      fontSize: 13.5, fontWeight: 700, display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {busy && <CircularProgress size={14} style={{ color: tone.fg }} />}
        {busy ? `Pausing ${plural(n, "SKU")} on Meesho…` : ok && runs.length === 1 ? `✓ ${runs[0].message}` : ok ? `✓ Paused ${plural(n, "SKU")}` : "Some SKUs weren't paused"}
      </span>
      {(showBiz || runs.length > 1 || !ok) && runs.map((r) => (
        <span key={r.id} style={{ fontSize: 12.5, fontWeight: 600 }}>{runs.length > 1 || showBiz ? `${r.business_name}: ` : ""}{r.message}</span>
      ))}
    </div>
  );
}

/** How the latest stock update went (one run per business, sent together). */
function StockStatus({ runs: all, showBiz }) {
  const first = all?.[0];
  if (!first || Date.now() - new Date(first.queued_at) > 30 * 60 * 1000) return null;
  const t = new Date(first.queued_at);
  const runs = all.filter((p) => Math.abs(t - new Date(p.queued_at)) < 60 * 1000);
  const busy = runs.some((r) => ["QUEUED", "RUNNING"].includes(r.status));
  const ok = runs.every((r) => r.status === "OK");
  return (
    <div role="status" style={{ background: busy ? "#EFF6FF" : ok ? C.greenLight : C.redLight, border: `1.5px solid ${busy ? "#BFDBFE" : ok ? C.greenBorder : C.redBorder}`,
      borderRadius: 12, padding: "10px 14px", color: busy ? "#1E3A8A" : ok ? "#166534" : C.red, fontSize: 13.5, fontWeight: 700, display: "flex", flexDirection: "column", gap: 3 }}>
      <span>{busy ? "Setting stock on Meesho, SKU by SKU…" : ok ? `✓ ${runs.length === 1 ? runs[0].message : "Stock updated"}` : "Some SKUs weren't updated"}</span>
      {(showBiz || runs.length > 1 || !ok) && runs.map((r) => <span key={r.id} style={{ fontSize: 12.5, fontWeight: 600 }}>{r.business_name}: {r.message}</span>)}
    </div>
  );
}

/**
 * Set stock on the chosen SKUs — on Meesho, one SKU after another (a parent's
 * in order). Stock on a paused SKU unpauses it; 0 takes a live one out of stock.
 */
function StockDialog({ ask, listingById, onClose, onSent }) {
  const rows = ask.ids.map((id) => listingById.get(id)).filter(Boolean);
  const paused = rows.filter((l) => l.archived).length;
  const [stock, setStock] = useState(ask.unpause ? "1000" : String(rows.length === 1 ? rows[0].inventory ?? 1000 : 1000));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const n = Number(stock);
  const valid = stock !== "" && Number.isInteger(n) && n >= 0 && n <= 99999;
  const send = async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`${API}/meesho-live-inventory/stock/`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listings: rows.map((l) => l.id), inventory: n }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error || "Couldn't send it."); return; }
      onSent();
    } catch { setError("Network error."); }
    finally { setBusy(false); }
  };
  return (
    <div role="dialog" aria-modal="true" aria-label="Set stock" onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 3400, background: "rgba(15,23,42,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...S.card, maxWidth: 440, width: "100%", padding: 20, display: "flex", flexDirection: "column", gap: 12, borderTop: `5px solid ${C.green}` }}>
        <div style={{ fontSize: 18, fontWeight: 900, color: C.gray900 }}>{ask.unpause ? "Unpause" : "Set stock"}{ask.what ? ` — ${ask.what}` : ""}</div>
        <div style={{ fontSize: 13.5, color: C.gray700, lineHeight: 1.5 }}>
          {plural(rows.length, "SKU")} on Meesho, one after another.
          {paused > 0 && n > 0 && <> <b>{plural(paused, "paused SKU")}</b> will be unpaused.</>}
          {n === 0 && rows.length - paused > 0 && <> Stock 0 takes them out of stock.</>}
        </div>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, fontWeight: 800, color: C.gray600 }}>
          Stock for each SKU
          <input autoFocus type="number" min={0} max={99999} value={stock} onChange={(e) => setStock(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && valid && !busy) send(); }}
            style={{ ...S.inp, fontSize: 18, fontFamily: "monospace", fontWeight: 800 }} />
        </label>
        {error && <div style={{ color: C.red, fontWeight: 700, fontSize: 13 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} disabled={busy} style={btn("ghost", "md")}>Cancel</button>
          <button onClick={send} disabled={busy || !valid} style={{ ...btn("primary", "md"), background: C.green, borderColor: C.green, opacity: busy || !valid ? 0.5 : 1 }}>
            {busy ? "Sending…" : ask.unpause ? `Unpause ${plural(rows.length, "SKU")}` : `Set stock on ${plural(rows.length, "SKU")}`}
          </button>
        </div>
      </div>
    </div>
  );
}

const stockBtn = (busy) => ({ ...btn("ghost", "sm"), color: "#15803D", opacity: busy ? 0.5 : 1, whiteSpace: "nowrap" });

function ListingRow({ l, view, admin, picked, onPick, isMobile, onStock, busy }) {
  const selectable = admin;
  return (
    <div onClick={selectable ? onPick : undefined}
      style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 10px 8px 34px", borderTop: `1px solid ${C.gray100}`,
        background: picked ? C.orangeLight : "transparent", cursor: selectable ? "pointer" : "default", fontSize: 12.5 }}>
      {selectable && <Check checked={picked} onChange={onPick} label={`Select ${l.catalog_name}`} />}
      <Thumb src={l.image} size={32} />
      <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 1 }}>
        <span style={{ fontWeight: 700, color: C.gray800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name || l.catalog_name}</span>
        <span style={{ color: C.gray500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          Catalog <span style={{ fontFamily: "monospace" }}>{l.catalog_id}</span>{l.variation && l.variation !== "Free Size" ? ` · ${l.variation}` : ""}{!isMobile && l.category ? ` · ${l.category}` : ""}
        </span>
      </div>
      <span style={{ minWidth: 54, textAlign: "right" }} title="Stock on Meesho"><StockTag n={l.inventory} /></span>
      {!isMobile && <span style={{ minWidth: 64, textAlign: "right", color: C.gray600 }}>{money(l.price)}</span>}
      <span style={{ minWidth: isMobile ? 0 : 92, textAlign: "right" }}>
        {l.archived ? <Tag variant="amber">Paused{l.archived_at ? ` ${l.archived_at}` : ""}</Tag>
          : l.inventory === 0 ? <Tag variant="red">Out of stock</Tag> : <Tag variant="green">Live</Tag>}
      </span>
      {admin && onStock && (
        <button onClick={(e) => { e.stopPropagation(); onStock([l.id], l.sku_id || l.catalog_name, l.archived); }} disabled={busy} style={stockBtn(busy)}>
          {l.archived ? "Unpause" : "Stock"}
        </button>
      )}
    </div>
  );
}

function SkuBlock({ sku, view, admin, picked, toggle, onPause, onStock, isMobile, busy }) {
  const [open, setOpen] = useState(false);
  const ids = sku.listings.map((l) => l.id);
  const on = ids.filter((id) => picked.has(id)).length;
  const selectable = admin;
  const paused = view === "paused";
  return (
    <div style={{ borderTop: `1px solid ${C.gray100}` }}>
      <div onClick={() => setOpen((v) => !v)} style={{ display: "flex", gap: 10, alignItems: "center", padding: "9px 10px", cursor: "pointer" }}>
        {selectable && <Check checked={on === ids.length} partial={on > 0} onChange={() => toggle(ids, on !== ids.length)} label={`Select ${sku.sku_id}`} />}
        <span style={{ color: C.gray400, width: 12, fontSize: 11 }}>{open ? "▾" : "▸"}</span>
        <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 13, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sku.sku_id}</span>
        <span style={{ fontSize: 12, color: C.gray500, whiteSpace: "nowrap" }}>{plural(sku.listings.length, "catalog")}</span>
        <span style={{ minWidth: 54, textAlign: "right", fontSize: 12.5 }}><StockTag n={sum(sku.listings, (l) => l.inventory)} /></span>
        {admin && (
          <button onClick={(e) => { e.stopPropagation(); onStock(ids, `SKU ${sku.sku_id}`, paused); }} disabled={busy} style={stockBtn(busy)}>
            {paused ? "Unpause SKU" : "Set stock"}
          </button>
        )}
        {admin && !paused && (
          <button onClick={(e) => { e.stopPropagation(); onPause(ids, `SKU ${sku.sku_id}`); }} disabled={busy}
            style={{ ...btn("ghost", "sm"), color: "#B45309", opacity: busy ? 0.5 : 1, whiteSpace: "nowrap" }}>Pause SKU</button>
        )}
      </div>
      {open && sku.listings.map((l) => (
        <ListingRow key={l.id} l={{ ...l, sku_id: sku.sku_id }} view={view} admin={admin} picked={picked.has(l.id)} onPick={() => toggle([l.id], !picked.has(l.id))}
          isMobile={isMobile} onStock={onStock} busy={busy} />
      ))}
    </div>
  );
}

function ParentCard({ g, view, admin, picked, toggle, onPause, onStock, showBiz, isMobile, busy }) {
  const [open, setOpen] = useState(false);
  const ids = g.skus.flatMap((s) => s.listings.map((l) => l.id));
  const on = ids.filter((id) => picked.has(id)).length;
  const selectable = admin;
  const paused = view === "paused";
  const title = g.parent || "No parent SKU";
  return (
    <div style={{ ...S.card, padding: 0, overflow: "hidden", border: on ? `1.5px solid ${C.orangeBorder}` : undefined }}>
      <div onClick={() => setOpen((v) => !v)} style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 14px", cursor: "pointer", flexWrap: isMobile ? "wrap" : "nowrap" }}>
        {selectable && <Check checked={on === ids.length} partial={on > 0} onChange={() => toggle(ids, on !== ids.length)} label={`Select ${title}`} />}
        <Thumb src={g.image} size={44} />
        <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontWeight: 800, fontSize: 14.5, color: g.parent ? C.gray900 : C.gray500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {title}{!g.parent && <span style={{ fontWeight: 600, fontSize: 12 }}> — link these on <Link to="/pricing" onClick={(e) => e.stopPropagation()} style={{ color: C.orange }}>SKU Pricing</Link></span>}
          </span>
          <span style={{ fontSize: 12, color: C.gray500, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {showBiz && <Tag variant="gray">{g.business_name}</Tag>}
            {plural(g.skus.length, "SKU")} · {plural(ids.length, "listing")} · stock <StockTag n={sum(g.skus.flatMap((s) => s.listings), (l) => l.inventory)} />
          </span>
        </div>
        {admin && (
          <button onClick={(e) => { e.stopPropagation(); onStock(ids, g.parent ? `parent ${g.parent}` : plural(g.skus.length, "unlinked SKU"), paused); }}
            disabled={busy} style={{ ...stockBtn(busy), fontWeight: 800 }}>{paused ? "Unpause parent" : "Set stock"}</button>
        )}
        {admin && !paused && (
          <button onClick={(e) => { e.stopPropagation(); onPause(ids, g.parent ? `parent ${g.parent}` : `${plural(g.skus.length, "unlinked SKU")}`); }} disabled={busy}
            style={{ ...btn("ghost", "sm"), color: "#B45309", fontWeight: 800, opacity: busy ? 0.5 : 1, whiteSpace: "nowrap" }}>Pause parent</button>
        )}
        <span style={{ color: C.gray400, fontSize: 12 }}>{open ? "▾" : "▸"}</span>
      </div>
      {open && g.skus.map((s) => (
        <SkuBlock key={s.sku_id} sku={s} view={view} admin={admin} picked={picked} toggle={toggle} onPause={onPause} onStock={onStock} isMobile={isMobile} busy={busy} />
      ))}
    </div>
  );
}

// ── Whole-account actions (admin): pause the SKUs with no orders; stock to 0 and back ─────
// Server: meesho_bulk.py. The worker does the Meesho side (MeeshoArchiveJob, MeeshoStockHoldJob).
async function api(path, method = "GET", body) {
  const res = await fetch(`${API}/meesho-live-inventory/${path}`, {
    method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined,
  }).catch(() => null);
  const data = res ? await res.json().catch(() => ({})) : { error: "Couldn't reach the server." };
  return { ok: !!res && res.ok, data };
}
const day = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "never");
const HOLD_STATE = {
  ZEROED: ["At 0 — to restore", "#B45309"], RESTORE_FAILED: ["Restore refused — try again", C.red], RESTORED: ["Stock given back", "#059669"],
  SAVED: ["Saved, not set to 0", C.gray600], ZERO_FAILED: ["Meesho refused the 0 (kept its stock)", C.red],
  SKIPPED_PAUSED: ["Paused — not touched", C.gray500], SKIPPED_ZERO: ["Already 0 — not touched", C.gray500],
  SKIPPED_UNKNOWN: ["Stock unknown — not touched", C.gray500], READ_FAILED: ["Catalog unreadable — not touched", C.gray500],
  SKIPPED_CHANGED: ["Restocked since — left as is", C.gray500], PLANNED: ["Waiting to be read", C.gray500],
};
const HOLD_STATUS = {
  QUEUED: "Waiting for the worker…", HOLDING: "Reading and saving each SKU's stock, then setting it to 0…", HELD: "Held at 0",
  RESTORING: "Giving the stock back…", RESTORED: "Restored", FAILED: "Nothing was set to 0",
};

function IdlePause({ isMobile, onSent }) {
  const [days, setDays] = useState(30);
  const [perCatalog, setPerCatalog] = useState(false);
  const [res, setRes] = useState(null);
  const [off, setOff] = useState(() => new Set());       // unticked
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const find = async () => {
    setBusy(true); setMsg(null); setOff(new Set());
    const r = await api(`idle/?days=${days}&per_catalog=${perCatalog ? 1 : 0}`);
    setBusy(false);
    if (r.ok) setRes(r.data); else { setRes(null); setMsg({ bad: true, text: r.data.error || "Couldn't make the list." }); }
  };
  const usable = (res?.businesses || []).filter((b) => !b.stale && !b.problem);
  const chosen = usable.flatMap((b) => b.rows.filter((x) => !off.has(x.id)).map((x) => x.id));
  const pause = async () => {
    if (!window.confirm(`Pause ${chosen.length} SKU${chosen.length === 1 ? "" : "s"} on Meesho that had no order in the last ${res.days} days?\n\nThey can be brought back with Set stock.`)) return;
    setBusy(true); setMsg(null);
    const r = await api("idle/pause/", "POST", { days: res.days, per_catalog: res.per_catalog, listings: chosen });
    setBusy(false);
    if (r.ok) { setMsg({ text: `Pausing ${r.data.skus} SKUs — the worker sends them catalog by catalog; the list updates when it's done.` }); setRes(null); onSent(); }
    else setMsg({ bad: true, text: r.data.error || "Couldn't pause." });
  };
  const flip = (id) => setOff((o) => { const n = new Set(o); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <div style={{ ...S.card, padding: 14, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
      <div style={{ fontWeight: 900, color: C.gray900 }}>Pause SKUs with no orders</div>
      <div style={{ fontSize: 12.5, color: C.gray500 }}>
        Live SKUs without a single order in the chosen days (from the orders table). SKUs listed within those days are left alone, and nothing is
        paused for a business whose order data isn't current.
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ fontSize: 13, fontWeight: 700, color: C.gray700 }}>No orders in the last{" "}
          <select value={days} onChange={(e) => { setDays(Number(e.target.value)); setRes(null); }} style={{ ...S.inp, width: "auto", padding: "5px 8px" }}>
            {[7, 15, 30, 45, 60, 90, 120, 180].map((d) => <option key={d} value={d}>{d} days</option>)}
          </select></label>
        <label style={{ fontSize: 12.5, color: C.gray600, display: "flex", gap: 5, alignItems: "center" }}>
          <input type="checkbox" checked={perCatalog} onChange={(e) => { setPerCatalog(e.target.checked); setRes(null); }} />
          per catalog (a SKU's copy in a catalog that gets no orders counts as idle)</label>
        <button onClick={find} disabled={busy} style={{ ...btn("ghost", "sm"), opacity: busy ? 0.6 : 1 }}>{busy && !res ? "Finding…" : "Find SKUs"}</button>
      </div>
      {msg && <div role="status" style={{ fontSize: 13, fontWeight: 700, color: msg.bad ? C.red : "#059669" }}>{msg.bad ? "✕" : "✓"} {msg.text}</div>}
      {res && res.businesses.map((b) => (
        <div key={b.business_id} style={{ border: `1px solid ${C.gray200}`, borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 13, color: C.gray700 }}>
            <b>{b.business_name}</b> · {b.count} idle since {day(b.since)} · kept: {b.kept_ordered} with orders, {b.kept_new} listed too recently · newest order {day(b.newest_order)}
          </div>
          {b.problem && <div style={{ fontSize: 12.5, color: C.red, fontWeight: 700 }}>✕ {b.problem}</div>}
          {b.stale && <div style={{ fontSize: 12.5, color: C.red, fontWeight: 700 }}>✕ The newest order is from {day(b.newest_order)} — the order data isn't current (more than {res.fresh_days} days old), so nothing is paused here. Let the orders sync catch up first.</div>}
          {!b.stale && !b.problem && b.rows.length > 0 && (
            <div style={{ maxHeight: 280, overflowY: "auto", border: `1px solid ${C.gray100}`, borderRadius: 8 }}>
              {b.rows.map((x) => (
                <label key={x.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 8px", borderBottom: `1px solid ${C.gray100}`, cursor: "pointer", minWidth: 0 }}>
                  <input type="checkbox" checked={!off.has(x.id)} onChange={() => flip(x.id)} />
                  <Thumb src={x.image} size={30} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5 }}>
                    <b style={{ fontFamily: "monospace", wordBreak: "break-word" }}>{x.sku}</b>{x.variation ? ` · ${x.variation}` : ""}
                    <span style={{ color: C.gray500 }}> · catalog {x.catalog_id}</span></span>
                  <span style={{ fontSize: 12, color: C.gray500, whiteSpace: "nowrap" }}>last order {day(x.last_order)} · stock {x.inventory ?? "—"}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      ))}
      {res && chosen.length > 0 && (
        <button onClick={pause} disabled={busy} style={{ ...btn("primary", "md"), background: "#B45309", borderColor: "#B45309", alignSelf: isMobile ? "stretch" : "flex-start", opacity: busy ? 0.6 : 1 }}>
          {busy ? "Sending…" : `Pause ${chosen.length} SKU${chosen.length === 1 ? "" : "s"}`}</button>
      )}
    </div>
  );
}

function StockHold({ isMobile, onSent }) {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [open, setOpen] = useState(null);
  const load = useCallback(async () => {
    const r = await api("stock-hold/");
    if (r.ok) setD(r.data); else setMsg({ bad: true, text: r.data.error || "Couldn't read the stock holds." });
  }, []);
  useEffect(() => { load(); }, [load]);
  const working = (d?.businesses || []).some((b) => b.hold?.working);
  useEffect(() => { if (!working) return undefined; const t = setInterval(load, 5000); return () => clearInterval(t); }, [working, load]);
  const start = async (b) => {
    const typed = window.prompt(`Set the stock of every live SKU of ${b.business_name} on Meesho to 0?\n\n`
      + `First each SKU's stock is read from Meesho and saved; then it is set to 0. Paused SKUs are not touched. `
      + `The nightly stock top-up skips ${b.business_name} until you restore.\n\nType ZERO to go ahead.`);
    if ((typed || "").trim().toUpperCase() !== "ZERO") return;
    setBusy(true); setMsg(null);
    const r = await api("stock-hold/start/", "POST", { businesses: [b.business_id] });
    setBusy(false);
    if (r.ok) setMsg({ text: `${b.business_name}: saving each SKU's stock, then setting it to 0 — this page follows it.` });
    else setMsg({ bad: true, text: r.data.error || "Couldn't start." });
    load(); onSent();
  };
  const restore = async (b) => {
    const n = (b.hold.counts.ZEROED || 0) + (b.hold.counts.RESTORE_FAILED || 0);
    if (!window.confirm(`Give ${n} SKU${n === 1 ? "" : "s"} of ${b.business_name} their saved stock back on Meesho?\n\nOnly SKUs still live and still at 0 are changed — paused or restocked ones are left as they are.`)) return;
    setBusy(true); setMsg(null);
    const r = await api(`stock-hold/${b.hold.id}/restore/`, "POST", {});
    setBusy(false);
    if (r.ok) setMsg({ text: `${b.business_name}: giving the stock back — this page follows it.` });
    else setMsg({ bad: true, text: r.data.error || "Couldn't restore." });
    load(); onSent();
  };
  return (
    <div style={{ ...S.card, padding: 14, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
      <div style={{ fontWeight: 900, color: C.gray900 }}>Stock to 0 — and back</div>
      <div style={{ fontSize: 12.5, color: C.gray500 }}>
        Every live SKU's stock is read from Meesho and saved here first, then set to 0. Restore gives each exactly its saved stock — only SKUs still
        live and still at 0; paused SKUs and other catalogs are never touched.
      </div>
      {msg && <div role="status" style={{ fontSize: 13, fontWeight: 700, color: msg.bad ? C.red : "#059669" }}>{msg.bad ? "✕" : "✓"} {msg.text}</div>}
      {!d ? <CircularProgress size={20} style={{ color: C.orange }} /> : d.businesses.map((b) => {
        const h = b.hold;
        return (
          <div key={b.business_id} style={{ border: `1px solid ${C.gray200}`, borderLeft: `4px solid ${b.open ? "#B45309" : C.gray200}`, borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <b style={{ flex: 1, minWidth: 0, color: C.gray900 }}>{b.business_name}</b>
              <span style={{ fontSize: 12.5, color: C.gray500 }}>{b.live} live SKUs · {b.with_stock} with stock</span>
            </div>
            {b.problem && <div style={{ fontSize: 12.5, color: C.red, fontWeight: 700 }}>✕ {b.problem}</div>}
            {h && (
              <div style={{ fontSize: 12.5, color: C.gray700, display: "flex", flexDirection: "column", gap: 4 }}>
                <span><b>{HOLD_STATUS[h.status] || h.status}</b>{h.working && <CircularProgress size={11} style={{ marginLeft: 6, color: C.orange }} />} · started {when(h.created_at)}{h.created_by ? ` by ${h.created_by}` : ""}{h.restored_at ? ` · restored ${when(h.restored_at)}` : ""}</span>
                {h.message && <span style={{ color: C.gray500 }}>{h.message}</span>}
                <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {Object.entries(h.counts).map(([k, n]) => (
                    <span key={k} style={{ fontSize: 11.5, fontWeight: 800, color: (HOLD_STATE[k] || [k, C.gray600])[1], border: `1px solid ${C.gray200}`, borderRadius: 999, padding: "1px 8px" }}>
                      {n} · {(HOLD_STATE[k] || [k])[0]}</span>
                  ))}
                </span>
                <button onClick={() => setOpen(open === h.id ? null : h.id)} style={{ ...btn("ghost", "sm"), alignSelf: "flex-start" }}>{open === h.id ? "▾ Hide SKUs" : "▸ Each SKU"}</button>
                {open === h.id && (
                  <div style={{ maxHeight: 260, overflowY: "auto", border: `1px solid ${C.gray100}`, borderRadius: 8 }}>
                    {h.items.map((x) => (
                      <div key={`${x.catalog_id}-${x.sku}-${x.variation}`} style={{ display: "flex", gap: 8, padding: "5px 8px", borderBottom: `1px solid ${C.gray100}`, fontSize: 12, flexWrap: isMobile ? "wrap" : "nowrap" }}>
                        <span style={{ flex: 1, minWidth: 0, fontFamily: "monospace", wordBreak: "break-word" }}>{x.sku}{x.variation ? ` · ${x.variation}` : ""}</span>
                        <span style={{ whiteSpace: "nowrap" }}>saved {x.previous ?? "—"}</span>
                        <span style={{ color: (HOLD_STATE[x.state] || [x.state, C.gray600])[1], fontWeight: 700 }} title={x.message}>{(HOLD_STATE[x.state] || [x.state])[0]}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {!b.open && !b.problem && <button onClick={() => start(b)} disabled={busy} style={{ ...btn("ghost", "sm"), color: C.red, borderColor: C.redBorder, opacity: busy ? 0.6 : 1 }}>Set all live stock to 0…</button>}
              {h?.can_restore && <button onClick={() => restore(b)} disabled={busy} style={{ ...btn("primary", "sm"), background: "#059669", borderColor: "#059669", opacity: busy ? 0.6 : 1 }}>Restore saved stock</button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BulkActions({ isMobile, onSent }) {
  const [open, setOpen] = useState(false);
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <button onClick={() => setOpen(!open)} aria-expanded={open} style={{ ...btn("ghost", "sm"), alignSelf: "flex-start" }}>
        {open ? "▾" : "▸"} Whole-account actions — pause SKUs with no orders · stock to 0 and back</button>
      {open && (
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", alignItems: "start" }}>
          <IdlePause isMobile={isMobile} onSent={onSent} />
          <StockHold isMobile={isMobile} onSent={onSent} />
        </div>
      )}
    </section>
  );
}

export function MeeshoLiveInventoryTab({ embedded = false }) {
  const isMobile = useIsMobile();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [view, setView] = useState("live");
  const [q, setQ] = useState("");
  const [biz, setBiz] = useState("all");
  const [picked, setPicked] = useState(() => new Set());
  const [shown, setShown] = useState(GROUPS_PER_PAGE);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/meesho-live-inventory/`);
      if (res.ok) setData(await res.json());
      else setError("Couldn't load the inventory.");
    } catch { /* keep the last state */ }
  }, []);
  const active = data && (data.syncing || data.pausing);
  useEffect(() => {
    load();
    const t = setInterval(load, active ? 4000 : 60000);
    return () => clearInterval(t);
  }, [load, active]);
  useEffect(() => { setShown(GROUPS_PER_PAGE); }, [view, q, biz]);

  const multi = (data?.accounts.length || 0) > 1;

  // The groups and SKUs with something in this view, narrowed by business and search.
  const groups = useMemo(() => {
    if (!data || view === "pending") return [];
    const needle = q.trim().toLowerCase();
    const out = [];
    for (const g of data.groups) {
      if (biz !== "all" && String(g.business_id) !== biz) continue;
      const parentHit = needle && (g.parent || "").toLowerCase().includes(needle);
      const skus = [];
      for (const s of g.skus) {
        const listings = s.listings.filter((l) => (view === "paused" ? l.archived : !l.archived)
          && (!needle || parentHit || s.sku_id.toLowerCase().includes(needle) || (l.name || "").toLowerCase().includes(needle) || String(l.catalog_id).includes(needle)));
        if (listings.length) skus.push({ ...s, listings });
      }
      if (skus.length) out.push({ ...g, skus });
    }
    return out;
  }, [data, view, q, biz]);

  const pending = useMemo(() => (data?.pending || []).filter((c) => (biz === "all" || String(c.business_id) === biz)
    && (!q.trim() || `${c.name} ${c.catalog_id} ${c.category}`.toLowerCase().includes(q.trim().toLowerCase()))), [data, q, biz]);

  const listingById = useMemo(() => {
    const m = new Map();
    (data?.groups || []).forEach((g) => g.skus.forEach((s) => s.listings.forEach((l) => m.set(l.id, l))));
    return m;
  }, [data]);
  // Drop picks that are no longer live (paused meanwhile, or gone).
  const pickedLive = useMemo(() => [...picked].filter((id) => listingById.get(id) && !listingById.get(id).archived), [picked, listingById]);
  const pickedAll = useMemo(() => [...picked].filter((id) => listingById.get(id)), [picked, listingById]);
  // Set stock / unpause: {ids, what, unpause} while the dialog is open.
  const [stockAsk, setStockAsk] = useState(null);
  const openStock = useCallback((ids, what, unpause) => setStockAsk({ ids, what, unpause: !!unpause }), []);

  const toggle = useCallback((ids, on) => setPicked((prev) => {
    const next = new Set(prev);
    ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
    return next;
  }), []);

  const pause = async (ids, what) => {
    const live = ids.filter((id) => listingById.get(id) && !listingById.get(id).archived);
    if (!live.length) return;
    const catalogs = new Set(live.map((id) => listingById.get(id).catalog_id)).size;
    if (!window.confirm(`Pause ${what ? `${what} — ` : ""}${plural(live.length, "SKU")} in ${plural(catalogs, "catalog")} on Meesho?\n\n`
      + "They stop selling straight away. To sell them again, resume them on the Meesho panel (Inventory → Paused).")) return;
    setSending(true); setError(null);
    try {
      const res = await fetch(`${API}/meesho-live-inventory/pause/`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listings: live }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setError(d.error || "Couldn't send the pause.");
      else { setPicked((prev) => { const n = new Set(prev); live.forEach((id) => n.delete(id)); return n; }); load(); }
    } catch { setError("Network error."); }
    finally { setSending(false); }
  };

  const refresh = async () => {
    setError(null);
    const res = await fetch(`${API}/meesho-live-inventory/refresh/`, { method: "POST" }).catch(() => null);
    if (!res) { setError("Network error."); return; }
    if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || "Couldn't start a refresh."); }
    load();
  };

  if (!data) return <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><CircularProgress style={{ color: C.orange }} /></div>;
  const admin = data.is_admin;
  const accounts = data.accounts.filter((a) => biz === "all" || String(a.business_id) === biz);
  const counts = Object.fromEntries(COUNT_TILES.map((t) => [t.key, sum(accounts, (a) => a.counts?.[t.key])]));
  const haveCounts = accounts.some((a) => Object.keys(a.counts || {}).length);
  const waiting = sum(accounts, (a) => a.catalogs_waiting);
  const busy = sending || data.pausing || data.stocking;
  const viewCount = (k) => (k === "pending" ? (data.pending || []).filter((c) => biz === "all" || String(c.business_id) === biz).length
    : sum(data.groups.filter((g) => biz === "all" || String(g.business_id) === biz).flatMap((g) => g.skus.flatMap((s) => s.listings)),
      (l) => (k === "paused" ? l.archived : !l.archived) ? 1 : 0));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 1200, paddingBottom: pickedLive.length ? 80 : 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          {!embedded && <h1 style={{ fontSize: 22, fontWeight: 800, color: C.gray900, margin: 0 }}>Meesho Inventory</h1>}
          <p style={{ fontSize: 13, color: C.gray500, marginTop: embedded ? 0 : 3, maxWidth: 680 }}>
            Every SKU listed on the Meesho panel, grouped by its parent SKU. Read by the sync every half hour{admin ? " — pause a parent, a SKU, or a selection straight from here" : ""}.
          </p>
        </div>
        <button onClick={refresh} disabled={!data.connected || data.syncing} style={{ ...btn("primary", "md"), opacity: !data.connected || data.syncing ? 0.6 : 1, minWidth: 150 }}>
          {data.syncing ? <><CircularProgress size={14} style={{ color: "#fff", marginRight: 6, verticalAlign: "-2px" }} />Reading…</> : "↻ Refresh now"}
        </button>
      </div>

      {!data.connected && (
        <div style={{ ...S.card, padding: 18, fontSize: 13.5, color: C.gray600 }}>
          No Meesho account is connected here yet. <Link to="/meesho/settings" style={{ color: C.orange, fontWeight: 800 }}>Connect one under Settings</Link>.
        </div>
      )}
      {error && <div style={{ background: C.redLight, border: `1.5px solid ${C.redBorder}`, borderRadius: 12, padding: "10px 14px", color: C.red, fontWeight: 700, fontSize: 13 }}>{error}</div>}
      <PauseStatus pauses={data.pauses} showBiz={multi} />
      <StockStatus runs={data.stock_runs} showBiz={multi} />
      {admin && data.connected && <BulkActions isMobile={isMobile} onSent={load} />}
      {stockAsk && <StockDialog ask={stockAsk} listingById={listingById} onClose={() => setStockAsk(null)}
        onSent={() => { setStockAsk(null); setPicked(new Set()); load(); }} />}

      {haveCounts && (
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))" }}>
          {COUNT_TILES.map((t) => (
            <div key={t.key} style={{ ...S.card, padding: "12px 14px", borderTop: `5px solid ${t.tone}`, display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 12.5, fontWeight: 800, color: t.tone }}>{t.label}</span>
              <span style={{ fontFamily: "monospace", fontSize: 28, fontWeight: 900, lineHeight: 1 }}>{counts[t.key]}</span>
              <span style={{ fontSize: 11.5, color: C.gray400 }}>catalogs on Meesho</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, color: C.gray500 }}>
        {accounts.map((a) => (
          <span key={a.business_id}>
            {multi && <b style={{ color: C.gray700 }}>{a.business_name}: </b>}
            {a.last_run ? <>last read {when(a.last_run.finished_at || a.last_run.queued_at)}
              {a.last_run.status === "FAILED" ? <span style={{ color: C.red }}> — failed: {a.last_run.message}</span>
                : BUSY.includes(a.last_run.status) ? " — reading now…" : null}</> : "not read yet — press Refresh now"}
          </span>
        ))}
        {waiting > 0 && <span style={{ color: "#B45309", fontWeight: 700 }}>SKUs of {plural(waiting, "catalog")} are still loading — Meesho hands them over one catalog at a time, so a first load takes a few runs.</span>}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {VIEWS.map((v) => (
          <button key={v.key} onClick={() => setView(v.key)} aria-pressed={view === v.key}
            style={{ ...btn(view === v.key ? "primary" : "ghost", "sm"), ...(view === v.key ? { background: v.tone, borderColor: v.tone } : {}) }}>
            {v.label} <span style={{ fontFamily: "monospace", marginLeft: 4 }}>{viewCount(v.key)}</span>
          </button>
        ))}
        {multi && (
          <select value={biz} onChange={(e) => setBiz(e.target.value)} style={{ ...S.inp, width: "auto", padding: "6px 10px" }}>
            <option value="all">All businesses</option>
            {data.accounts.map((a) => <option key={a.business_id} value={String(a.business_id)}>{a.business_name}</option>)}
          </select>
        )}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search parent, SKU, product, catalog ID…"
          style={{ ...S.inp, flex: 1, minWidth: 200 }} />
      </div>

      {view === "pending" ? (
        <div style={{ ...S.card, padding: 0, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr>{["Catalog", ...(multi ? ["Business"] : []), "Category", "Expected live"].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {pending.length === 0 && <tr><td colSpan={4} style={{ ...S.td, textAlign: "center", color: C.gray400, padding: 24 }}>Nothing waiting for activation.</td></tr>}
              {pending.map((c) => (
                <tr key={`${c.business_id}-${c.catalog_id}`}>
                  <td style={S.td}><b>{c.name || "—"}</b><div style={{ fontFamily: "monospace", fontSize: 11.5, color: C.gray500 }}>{c.catalog_id}</div></td>
                  {multi && <td style={S.td}>{c.business_name}</td>}
                  <td style={S.td}>{c.category}</td>
                  <td style={{ ...S.td, whiteSpace: "nowrap" }}>{when(c.expected_live_at)}{c.delayed && <> <Tag variant="red">Delayed</Tag></>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {groups.length === 0 && (
            <div style={{ ...S.card, padding: 24, textAlign: "center", color: C.gray400, fontSize: 13.5 }}>
              {q ? "Nothing matches that search." : view === "paused" ? "Nothing paused." : waiting ? "SKUs are still loading…" : "Nothing here yet."}
            </div>
          )}
          {groups.slice(0, shown).map((g) => (
            <ParentCard key={g.key} g={g} view={view} admin={admin} picked={picked} toggle={toggle} onPause={pause} onStock={openStock}
              showBiz={multi && biz === "all"} isMobile={isMobile} busy={busy} />
          ))}
          {groups.length > shown && (
            <button onClick={() => setShown((n) => n + GROUPS_PER_PAGE)} style={{ ...btn("ghost", "md"), alignSelf: "center" }}>
              Show more ({groups.length - shown} more parents)
            </button>
          )}
        </div>
      )}

      {admin && pickedAll.length > 0 && (
        <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 50, display: "flex", justifyContent: "center", padding: "10px 16px",
          background: C.white, borderTop: `1px solid ${C.gray200}`, boxShadow: "0 -6px 20px rgba(15,23,42,.08)" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", maxWidth: 1200, width: "100%" }}>
            <span style={{ fontWeight: 800, fontSize: 13.5, flex: 1 }}>
              {plural(pickedAll.length, "SKU")} selected in {plural(new Set(pickedAll.map((id) => listingById.get(id).catalog_id)).size, "catalog")}
            </span>
            <button onClick={() => setPicked(new Set())} style={btn("ghost", "md")}>Clear</button>
            <button onClick={() => openStock(pickedAll, null, pickedAll.every((id) => listingById.get(id).archived))} disabled={busy}
              style={{ ...btn("primary", "md"), background: C.green, borderColor: C.green, opacity: busy ? 0.6 : 1 }}>
              {pickedAll.every((id) => listingById.get(id).archived) ? `Unpause ${plural(pickedAll.length, "SKU")}` : `Set stock on ${plural(pickedAll.length, "SKU")}`}
            </button>
            {pickedLive.length > 0 && <button onClick={() => pause(pickedLive)} disabled={busy}
              style={{ ...btn("primary", "md"), background: "#B45309", borderColor: "#B45309", opacity: busy ? 0.6 : 1 }}>
              {busy ? "Pausing…" : `Pause ${plural(pickedLive.length, "SKU")}`}
            </button>}
          </div>
        </div>
      )}
    </div>
  );
}
