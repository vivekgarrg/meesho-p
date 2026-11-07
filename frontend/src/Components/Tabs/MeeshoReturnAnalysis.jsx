import React, { useState, useEffect, useCallback, useMemo } from "react";
import { API, C, S, btn } from "../../App";
import { CircularProgress } from "@mui/material";
import { useIsMobile } from "../../shared";
import { ParentLinkButton } from "./ParentLink";

/*
 * Meesho → Return Analysis, kept simple:
 *
 *   1. how many orders reached customers, how many customers sent back, how many were RTO
 *   2. every product (open one for its SKUs): returned of delivered, its return %, a status
 *      flag — and beside the flag, Pause / Resume (or Link to parent for a SKU without one)
 *   3. why customers send things back
 *   4. the Auto-pause switch — off unless an admin turns it on
 *
 * Counted per order (server: return_guard.simple_view): of the orders placed in the window,
 * each counts once by how it ended. Return % = returned by customers ÷ delivered to customers.
 * RTOs (never reached a customer) and parcels still on the way are not in it. The window
 * ends 10 days ago so its customers have had time to return.
 */

const STATUS = {
  over: { label: "Over limit", fg: "#B91C1C", bg: "#FEE2E2" },
  high: { label: "High", fg: "#B45309", bg: "#FEF3C7" },
  ok: { label: "OK", fg: "#15803D", bg: "#DCFCE7" },
  few: { label: "Too few orders", fg: "#64748B", bg: "#F1F5F9" },
  paused: { label: "Paused", fg: "#FFFFFF", bg: "#475569" },
};
const FILTERS = [["all", "All"], ["over", "Over limit"], ["high", "High"], ["paused", "Paused"]];
const fmtDay = (iso) => new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const n = (v) => Number(v || 0).toLocaleString("en-IN");

async function post(path, body) {
  const r = await fetch(`${API}/meesho-orders/return-analysis/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
  return j;
}

function Flag({ status }) {
  const s = STATUS[status] || STATUS.ok;
  return <span style={{ display: "inline-block", fontSize: 12, fontWeight: 800, color: s.fg, background: s.bg, padding: "3px 10px", borderRadius: 999, whiteSpace: "nowrap" }}>{s.label}</span>;
}

/** Returned of delivered, as one bar: kept (green) and returned (red). */
function Bar({ e }) {
  if (!e.orders) return <div style={{ height: 8, borderRadius: 4, background: C.gray100 }} />;
  return (
    <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", background: C.gray100 }} role="img" aria-label={`${e.returns} returned of ${e.orders} delivered`}>
      <span style={{ width: `${(100 * e.delivered) / e.orders}%`, background: "#86EFAC" }} />
      <span style={{ width: `${(100 * e.returns) / e.orders}%`, background: "#EF4444" }} />
    </div>
  );
}

function Tile({ label, value, sub, color }) {
  return (
    <div style={{ ...S.card, padding: "14px 16px", borderTop: `4px solid ${color}`, minWidth: 0 }}>
      <div style={{ fontSize: 12.5, fontWeight: 800, color: C.gray500 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 900, color: C.gray900, lineHeight: 1.15, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ fontSize: 12.5, color: C.gray500, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

/** What can be done beside a row's flag: Pause / Resume, or Link to parent. */
function Action({ e, d, onDone, parentPaused }) {
  const [busy, setBusy] = useState(false);
  if (e.level === "unlinked") {
    return d.can_link.includes(e.business)
      ? <ParentLinkButton compact businessId={e.business} businessName={e.business_name} sku={e.key} onLinked={onDone} />
      : <span style={{ fontSize: 11.5, color: C.gray400 }}>No parent</span>;
  }
  if (!d.can_pause) return null;
  if (e.level === "sku" && parentPaused) return <span style={{ fontSize: 11.5, color: C.gray400 }}>Paused with product</span>;
  const what = e.level === "sku" ? `SKU ${e.key}` : `${e.key}${e.skus?.length > 1 ? ` and its ${e.skus.length} SKUs` : ""}`;
  const act = async (ev) => {
    ev.stopPropagation();
    if (!window.confirm(e.paused ? `Make ${what} active again?` : `Pause ${what}? It disappears from the Listing Hub (not from Meesho).`)) return;
    setBusy(true);
    try {
      await post("pause/", { business: e.business, ...(e.level === "sku" ? { sku: e.key } : { parent: e.key }), paused: !e.paused,
        note: e.rate != null ? `${e.rate}% returned (${e.returns} of ${e.orders} delivered)` : "" });
      onDone();
    } catch (err) { window.alert(err.message); } finally { setBusy(false); }
  };
  return (
    <button onClick={act} disabled={busy}
      style={{ ...btn(e.paused ? "ghost" : e.status === "over" ? "danger" : "ghost", "sm"), minHeight: 34, whiteSpace: "nowrap" }}>
      {busy ? "…" : e.paused ? "▶ Resume" : "⏸ Pause"}
    </button>
  );
}

/** One product (or SKU) row: picture, name, returned of delivered, return %, flag, and the action beside the flag. */
function Row({ e, d, onDone, mobile, open, onToggle, sub = false, parentPaused = false }) {
  const canOpen = !sub && e.skus?.length > 0;
  const rateColor = e.status === "over" ? "#B91C1C" : e.status === "high" ? "#B45309" : C.gray900;
  return (
    <div onClick={canOpen ? onToggle : undefined} role={canOpen ? "button" : undefined} aria-expanded={canOpen ? open : undefined}
      style={{ display: "grid", alignItems: "center", gap: mobile ? 8 : 14, cursor: canOpen ? "pointer" : "default",
        gridTemplateColumns: mobile ? "minmax(0, 1fr) auto" : "minmax(0, 2.2fr) minmax(0, 1.6fr) 70px auto",
        padding: sub ? (mobile ? "8px 10px 8px 22px" : "8px 14px 8px 48px") : "10px 14px",
        background: sub ? C.gray50 : open ? "#F5F3FF" : C.white, borderTop: `1px solid ${C.gray100}` }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
        {!sub && e.image && <img src={e.image} alt="" loading="lazy" style={{ width: 42, height: 42, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: sub ? 700 : 900, fontSize: sub ? 13 : 14, color: C.gray900, wordBreak: "break-word" }}>
            {canOpen && <span aria-hidden style={{ color: C.gray400, marginRight: 6 }}>{open ? "▾" : "▸"}</span>}{e.key}
          </div>
          <div style={{ fontSize: 12, color: C.gray500 }}>
            {sub ? "SKU" : e.level === "unlinked" ? "SKU without a parent" : `${e.skus.length} SKU${e.skus.length === 1 ? "" : "s"}`}
            {d.businesses.length > 1 && !sub ? ` · ${e.business_name}` : ""}
          </div>
        </div>
      </div>
      {mobile ? (
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 20, fontWeight: 900, color: rateColor, fontVariantNumeric: "tabular-nums" }}>{e.rate == null ? "—" : `${e.rate}%`}</div>
        </div>
      ) : (
        <div style={{ minWidth: 0 }}>
          <Bar e={e} />
          <div style={{ fontSize: 12, color: C.gray600, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>
            <b>{n(e.returns)}</b> returned of <b>{n(e.orders)}</b> delivered{e.rto ? <span style={{ color: C.gray400 }}> · {n(e.rto)} RTO</span> : null}
          </div>
        </div>
      )}
      {mobile ? (
        <div style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 6 }}>
          <Bar e={e} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: C.gray600 }}><b>{n(e.returns)}</b> returned of <b>{n(e.orders)}</b> delivered{e.rto ? ` · ${n(e.rto)} RTO` : ""}</span>
            <span style={{ display: "flex", gap: 8, alignItems: "center" }}><Flag status={e.status} /><Action e={e} d={d} onDone={onDone} parentPaused={parentPaused} /></span>
          </div>
        </div>
      ) : (
        <>
          <div style={{ fontSize: 20, fontWeight: 900, color: rateColor, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{e.rate == null ? "—" : `${e.rate}%`}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end", minWidth: 210 }}>
            <Flag status={e.status} /><Action e={e} d={d} onDone={onDone} parentPaused={parentPaused} />
          </div>
        </>
      )}
    </div>
  );
}

function AutoPause({ d, onChange }) {
  const [busy, setBusy] = useState(false);
  const on = d.auto_pause;
  const r = d.rules;
  const flip = async () => {
    if (!on && !window.confirm(`Turn on auto-pause?\n\nEvery morning at 7 am, any product (or SKU) whose customers return more than ${r.return_pct}% of what was delivered — with at least ${r.min_orders} delivered — is paused by itself.`)) return;
    setBusy(true);
    try { await post("auto/", { on: !on }); onChange(); } catch (e) { window.alert(e.message); } finally { setBusy(false); }
  };
  return (
    <div style={{ ...S.card, padding: "12px 16px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between",
      borderLeft: `5px solid ${on ? "#DC2626" : C.gray300}` }}>
      <div style={{ minWidth: 0, flex: "1 1 260px" }}>
        <div style={{ fontWeight: 900, fontSize: 14.5, color: C.gray900 }}>Auto-pause is {on ? "ON" : "OFF"}</div>
        <div style={{ fontSize: 12.5, color: C.gray500, marginTop: 2 }}>
          {on ? `Every morning at 7 am, products over ${r.return_pct}% (with ${r.min_orders}+ delivered) are paused by themselves.`
            : "Nothing is paused by itself. Pause a product yourself with the button beside its flag."}
        </div>
      </div>
      {d.can_pause && (
        <button role="switch" aria-checked={on} onClick={flip} disabled={busy}
          style={{ display: "inline-flex", alignItems: "center", gap: 10, border: "none", background: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: 800, fontSize: 13.5, color: C.gray700 }}>
          <span aria-hidden style={{ width: 44, height: 24, borderRadius: 999, background: on ? "#DC2626" : C.gray300, position: "relative", transition: "background .15s" }}>
            <span style={{ position: "absolute", top: 3, left: on ? 23 : 3, width: 18, height: 18, borderRadius: 999, background: "#fff", transition: "left .15s", boxShadow: "0 1px 2px rgba(0,0,0,.3)" }} />
          </span>
          {busy ? "Saving…" : on ? "Turn off" : "Turn on"}
        </button>
      )}
    </div>
  );
}

export function MeeshoReturnAnalysis() {
  const mobile = useIsMobile();
  const [days, setDays] = useState(30);
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/meesho-orders/return-analysis/simple/?days=${days}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || j.detail || "Couldn't read the returns.");
      setD(j); setErr(null);
    } catch (e) { setErr(e.message === "Failed to fetch" ? "Couldn't reach the server." : e.message); }
    finally { setLoading(false); }
  }, [days]);
  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const c = { all: 0, over: 0, high: 0, paused: 0 };
    for (const e of d?.products || []) { c.all += 1; if (c[e.status] !== undefined) c[e.status] += 1; }
    return c;
  }, [d]);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (d?.products || []).filter((e) => (filter === "all" || e.status === filter)
      && (!needle || e.key.toLowerCase().includes(needle) || e.skus.some((s) => s.key.toLowerCase().includes(needle))));
  }, [d, filter, q]);

  if (!d) {
    return err
      ? <div role="alert" style={{ ...S.card, color: C.red, fontWeight: 700 }}>✕ {err} <button onClick={load} style={{ ...btn("ghost", "sm"), marginLeft: 8 }}>Try again</button></div>
      : <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><CircularProgress style={{ color: C.orange }} /></div>;
  }
  const t = d.totals;
  const r = d.rules;
  const maxReason = Math.max(1, ...d.reasons.map((x) => x.count));
  const seg = (on) => ({ border: "none", cursor: "pointer", fontFamily: "inherit", padding: "8px 14px", borderRadius: 9, minHeight: 38, fontSize: 13.5,
    fontWeight: on ? 900 : 700, background: on ? C.white : "transparent", color: on ? C.gray900 : C.gray600, boxShadow: on ? "0 1px 3px rgba(15,23,42,.12)" : "none" });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, opacity: loading ? 0.6 : 1, transition: "opacity .15s", maxWidth: 1200, minWidth: 0 }}>
      {/* Period + what it covers */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontSize: 13.5, color: C.gray600, minWidth: 0, flex: "1 1 280px", lineHeight: 1.5 }}>
          Orders placed <b>{fmtDay(d.from)} – {fmtDay(d.to)}</b>{d.businesses.length > 1 ? ` · ${d.businesses.length} businesses` : ""}.
          <span style={{ color: C.gray400 }}> The last {d.settle_days} days are left out — customers can still return those.</span>
        </div>
        <div role="tablist" aria-label="Period" style={{ display: "flex", gap: 4, padding: 4, background: C.gray100, borderRadius: 12 }}>
          {[30, 60, 90].map((x) => <button key={x} role="tab" aria-selected={days === x} onClick={() => setDays(x)} style={seg(days === x)}>{x} days</button>)}
        </div>
      </div>

      {err && <div role="alert" style={{ color: C.red, fontWeight: 700, fontSize: 13.5 }}>✕ {err}</div>}

      {/* The four numbers */}
      <div style={{ display: "grid", gridTemplateColumns: mobile ? "repeat(2, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))", gap: mobile ? 8 : 12 }}>
        <Tile label="Delivered to customers" value={n(t.orders)} color="#22C55E" sub={`of ${n(t.shipped)} shipped`} />
        <Tile label="Returned by customers" value={t.rate == null ? "—" : `${t.rate}%`} color="#EF4444" sub={`${n(t.returns)} of ${n(t.orders)} delivered`} />
        <Tile label="RTO — never reached" value={n(t.rto)} color="#F59E0B" sub={t.rto_rate == null ? "" : `${t.rto_rate}% of shipped · not in return %`} />
        <Tile label="Still on the way" value={n(t.open)} color={C.gray300} sub="no result yet · not counted" />
      </div>

      <AutoPause d={d} onChange={load} />

      {/* Products */}
      <section style={{ ...S.card, padding: 0, overflow: "hidden", minWidth: 0 }}>
        <div style={{ padding: "12px 14px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderBottom: `1px solid ${C.gray100}` }}>
          <div style={{ fontWeight: 900, fontSize: 15, color: C.gray900, flex: "1 1 160px" }}>Products</div>
          <div role="tablist" aria-label="Show" style={{ display: "flex", gap: 4, padding: 4, background: C.gray100, borderRadius: 12, overflowX: "auto", maxWidth: "100%" }}>
            {FILTERS.map(([k, l]) => <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)} style={{ ...seg(filter === k), whiteSpace: "nowrap" }}>{l} · {counts[k]}</button>)}
          </div>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search product or SKU…" aria-label="Search"
            style={{ ...S.inp, width: mobile ? "100%" : 220, minHeight: 38 }} />
        </div>
        <div style={{ padding: "8px 14px", fontSize: 12.5, color: C.gray500, background: C.gray50 }}>
          Return % = returned by customers ÷ delivered to customers (RTO not counted).
          <b style={{ color: STATUS.over.fg }}> Over limit</b> = above {r.return_pct}% with {r.min_orders}+ delivered ·
          <b style={{ color: STATUS.high.fg }}> High</b> = {r.watch_pct}%+ · tap a product for its SKUs.
        </div>
        {!mobile && (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2.2fr) minmax(0, 1.6fr) 70px auto", gap: 14, padding: "8px 14px", fontSize: 11.5, fontWeight: 800,
            color: C.gray500, textTransform: "uppercase", letterSpacing: ".04em" }}>
            <span>Product</span><span>Returned of delivered</span><span style={{ textAlign: "right" }}>Return %</span><span style={{ textAlign: "right", minWidth: 210 }}>Status</span>
          </div>
        )}
        {list.length === 0
          ? <div style={{ padding: 28, textAlign: "center", color: C.gray500, fontSize: 13.5 }}>Nothing here.</div>
          : list.map((e) => {
            const k = `${e.level}|${e.business}|${e.key}`;
            return (
              <React.Fragment key={k}>
                <Row e={e} d={d} onDone={load} mobile={mobile} open={!!open[k]} onToggle={() => setOpen((o) => ({ ...o, [k]: !o[k] }))} />
                {open[k] && e.skus.map((s) => <Row key={s.key} e={s} d={d} onDone={load} mobile={mobile} sub parentPaused={e.paused} />)}
              </React.Fragment>
            );
          })}
      </section>

      {/* Why */}
      {d.reasons.length > 0 && (
        <section style={{ ...S.card, padding: "14px 16px" }}>
          <div style={{ fontWeight: 900, fontSize: 15, color: C.gray900, marginBottom: 10 }}>Why customers send things back</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {d.reasons.map((x) => (
              <div key={x.reason} style={{ display: "grid", gridTemplateColumns: mobile ? "minmax(0, 1fr) 40px" : "minmax(0, 320px) minmax(0, 1fr) 48px", gap: 10, alignItems: "center" }}>
                <span style={{ fontSize: 13, color: C.gray700, fontWeight: 600 }}>{x.reason}</span>
                {!mobile && <span style={{ height: 10, borderRadius: 4, background: C.gray100 }}><span style={{ display: "block", height: "100%", width: `${(100 * x.count) / maxReason}%`, background: "#EF4444", borderRadius: 4 }} /></span>}
                <span style={{ fontSize: 13, fontWeight: 900, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{n(x.count)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
