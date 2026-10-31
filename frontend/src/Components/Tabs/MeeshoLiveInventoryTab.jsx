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

function ListingRow({ l, view, admin, picked, onPick, isMobile }) {
  const selectable = admin && view === "live";
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
    </div>
  );
}

function SkuBlock({ sku, view, admin, picked, toggle, onPause, isMobile, busy }) {
  const [open, setOpen] = useState(false);
  const ids = sku.listings.map((l) => l.id);
  const on = ids.filter((id) => picked.has(id)).length;
  const selectable = admin && view === "live";
  return (
    <div style={{ borderTop: `1px solid ${C.gray100}` }}>
      <div onClick={() => setOpen((v) => !v)} style={{ display: "flex", gap: 10, alignItems: "center", padding: "9px 10px", cursor: "pointer" }}>
        {selectable && <Check checked={on === ids.length} partial={on > 0} onChange={() => toggle(ids, on !== ids.length)} label={`Select ${sku.sku_id}`} />}
        <span style={{ color: C.gray400, width: 12, fontSize: 11 }}>{open ? "▾" : "▸"}</span>
        <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 13, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sku.sku_id}</span>
        <span style={{ fontSize: 12, color: C.gray500, whiteSpace: "nowrap" }}>{plural(sku.listings.length, "catalog")}</span>
        <span style={{ minWidth: 54, textAlign: "right", fontSize: 12.5 }}><StockTag n={sum(sku.listings, (l) => l.inventory)} /></span>
        {selectable && (
          <button onClick={(e) => { e.stopPropagation(); onPause(ids, `SKU ${sku.sku_id}`); }} disabled={busy}
            style={{ ...btn("ghost", "sm"), color: "#B45309", opacity: busy ? 0.5 : 1, whiteSpace: "nowrap" }}>Pause SKU</button>
        )}
      </div>
      {open && sku.listings.map((l) => (
        <ListingRow key={l.id} l={l} view={view} admin={admin} picked={picked.has(l.id)} onPick={() => toggle([l.id], !picked.has(l.id))} isMobile={isMobile} />
      ))}
    </div>
  );
}

function ParentCard({ g, view, admin, picked, toggle, onPause, showBiz, isMobile, busy }) {
  const [open, setOpen] = useState(false);
  const ids = g.skus.flatMap((s) => s.listings.map((l) => l.id));
  const on = ids.filter((id) => picked.has(id)).length;
  const selectable = admin && view === "live";
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
        {selectable && (
          <button onClick={(e) => { e.stopPropagation(); onPause(ids, g.parent ? `parent ${g.parent}` : `${plural(g.skus.length, "unlinked SKU")}`); }} disabled={busy}
            style={{ ...btn("ghost", "sm"), color: "#B45309", fontWeight: 800, opacity: busy ? 0.5 : 1, whiteSpace: "nowrap" }}>Pause parent</button>
        )}
        <span style={{ color: C.gray400, fontSize: 12 }}>{open ? "▾" : "▸"}</span>
      </div>
      {open && g.skus.map((s) => (
        <SkuBlock key={s.sku_id} sku={s} view={view} admin={admin} picked={picked} toggle={toggle} onPause={onPause} isMobile={isMobile} busy={busy} />
      ))}
    </div>
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
  const busy = sending || data.pausing;
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
          No Meesho account is connected here yet. <Link to="/meesho-orders?tab=settings" style={{ color: C.orange, fontWeight: 800 }}>Connect one under Settings</Link>.
        </div>
      )}
      {error && <div style={{ background: C.redLight, border: `1.5px solid ${C.redBorder}`, borderRadius: 12, padding: "10px 14px", color: C.red, fontWeight: 700, fontSize: 13 }}>{error}</div>}
      <PauseStatus pauses={data.pauses} showBiz={multi} />

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
            <ParentCard key={g.key} g={g} view={view} admin={admin} picked={picked} toggle={toggle} onPause={pause}
              showBiz={multi && biz === "all"} isMobile={isMobile} busy={busy} />
          ))}
          {groups.length > shown && (
            <button onClick={() => setShown((n) => n + GROUPS_PER_PAGE)} style={{ ...btn("ghost", "md"), alignSelf: "center" }}>
              Show more ({groups.length - shown} more parents)
            </button>
          )}
        </div>
      )}

      {admin && pickedLive.length > 0 && (
        <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 50, display: "flex", justifyContent: "center", padding: "10px 16px",
          background: C.white, borderTop: `1px solid ${C.gray200}`, boxShadow: "0 -6px 20px rgba(15,23,42,.08)" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", maxWidth: 1200, width: "100%" }}>
            <span style={{ fontWeight: 800, fontSize: 13.5, flex: 1 }}>
              {plural(pickedLive.length, "SKU")} selected in {plural(new Set(pickedLive.map((id) => listingById.get(id).catalog_id)).size, "catalog")}
            </span>
            <button onClick={() => setPicked(new Set())} style={btn("ghost", "md")}>Clear</button>
            <button onClick={() => pause(pickedLive)} disabled={busy}
              style={{ ...btn("primary", "md"), background: "#B45309", borderColor: "#B45309", opacity: busy ? 0.6 : 1 }}>
              {busy ? "Pausing…" : `Pause ${plural(pickedLive.length, "SKU")}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
