import React, { useCallback, useEffect, useState } from "react";
import { API, C, S, btn, useIsMobile } from "../../App";

/*
 * Meesho Inventory → Leave: put a business on leave — every catalog live on Meesho
 * paused, kept paused (checked every hour: anything live again is paused again),
 * and brought back at the end, or when you end it. Server: meesho_leave.py; the
 * work is the sync worker's (MeeshoLeaveJob).
 */

const STATUS = {
  SCHEDULED: { label: "Scheduled", color: "#1D4ED8", bg: "#DBEAFE" },
  PAUSING: { label: "Pausing…", color: "#B45309", bg: "#FEF3C7" },
  ON_LEAVE: { label: "On leave", color: "#7C2D12", bg: "#FFEDD5" },
  RESUMING: { label: "Bringing back…", color: "#B45309", bg: "#FEF3C7" },
  ENDED: { label: "Ended", color: "#15803D", bg: "#DCFCE7" },
  CANCELLED: { label: "Cancelled", color: C.gray600, bg: C.gray100 },
  FAILED: { label: "Failed", color: C.red, bg: "#FEE2E2" },
};
const ITEM = {
  PAUSED: ["Paused", "#7C2D12"], PAUSE_FAILED: ["Not paused", C.red], RESUMED: ["Back", "#15803D"],
  RESUME_FAILED: ["Not back yet", C.red], KEPT_PAUSED: ["Stays paused (no stock)", C.gray600],
};
const at = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—");
// <input type="datetime-local"> value ↔ ISO.
const toLocal = (iso) => { if (!iso) return ""; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const fromLocal = (v) => (v ? new Date(v).toISOString() : "");

async function call(path, method = "GET", body) {
  const r = await fetch(`${API}/meesho-leave/${path}`, {
    method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined,
  });
  return { ok: r.ok, data: await r.json().catch(() => ({})) };
}

function Chip({ status }) {
  const s = STATUS[status] || STATUS.SCHEDULED;
  return <span style={{ fontSize: 12, fontWeight: 800, color: s.color, background: s.bg, borderRadius: 999, padding: "3px 10px", whiteSpace: "nowrap" }}>{s.label}</span>;
}

function Items({ leave, onClose }) {
  const [d, setD] = useState(null);
  const [q, setQ] = useState("");
  useEffect(() => { call(`${leave.id}/items/`).then((r) => setD(r.ok ? r.data : { items: [], error: r.data.error })); }, [leave.id]);
  const rows = (d?.items || []).filter((x) => !q || `${x.sku_id} ${x.catalog_id}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div style={{ borderTop: `1px solid ${C.gray100}`, paddingTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <b style={{ fontSize: 13 }}>SKUs this leave paused · {d?.items?.length ?? "…"}</b>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a SKU or catalog…" style={{ ...S.inp, width: 220, padding: "5px 9px", fontSize: 12.5 }} />
        <button onClick={onClose} style={{ ...btn("ghost", "sm"), marginLeft: "auto" }}>Hide</button>
      </div>
      {d?.error && <div style={{ color: C.red, fontSize: 12.5 }}>✕ {d.error}</div>}
      <div style={{ maxHeight: 360, overflowY: "auto", overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead><tr>{["SKU", "Catalog", "Stock then", "Now", "Found live again"].map((h) => <th key={h} style={{ ...S.th, textAlign: "left" }}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((x) => {
              const [label, color] = ITEM[x.state] || [x.state, C.gray600];
              return (
                <tr key={`${x.product_id}-${x.variation_id}`}>
                  <td style={{ ...S.td, fontFamily: "monospace", fontWeight: 700 }}>{x.sku_id || x.product_id}{x.variation && x.variation !== "Free Size" ? ` · ${x.variation}` : ""}</td>
                  <td style={{ ...S.td, fontFamily: "monospace", color: C.gray500 }}>{x.catalog_id}</td>
                  <td style={S.td}>{x.stock ?? "—"}</td>
                  <td style={S.td}><b style={{ color }}>{label}</b>{x.message ? <div style={{ fontSize: 11, color: C.gray500 }}>{x.message}</div> : null}</td>
                  <td style={S.td}>{x.times_repaused ? `${x.times_repaused}× — paused again` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LeaveCard({ b, admin, reload, setNote }) {
  const l = b.leave;
  const [ends, setEnds] = useState(toLocal(l?.ends_at));
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  useEffect(() => { setEnds(toLocal(l?.ends_at)); }, [l?.ends_at]);
  if (!l) {
    return (
      <div style={{ ...S.card, padding: "12px 14px", display: "flex", gap: 10, alignItems: "center" }}>
        <b style={{ fontSize: 14.5 }}>{b.business_name}</b>
        <span style={{ fontSize: 12.5, color: C.gray500 }}>{b.connected ? "Not on leave — selling as usual." : "Meesho account not connected."}</span>
      </div>
    );
  }
  const end = async () => {
    const what = l.status === "SCHEDULED" ? `Cancel ${b.business_name}'s leave? Nothing has been paused yet.`
      : `End ${b.business_name}'s leave now? Every catalog it paused is brought back on Meesho.`;
    if (!window.confirm(what)) return;
    setBusy(true);
    const r = await call(`${l.id}/end/`, "POST", {});
    setBusy(false);
    setNote(r.ok ? { ok: true, text: `${b.business_name}: ${l.status === "SCHEDULED" ? "cancelled" : "bringing every catalog back now"}.` }
      : { ok: false, text: r.data.error || "Couldn't end it." });
    reload();
  };
  const saveEnd = async () => {
    setBusy(true);
    const r = await call(`${l.id}/`, "PATCH", { ends_at: fromLocal(ends) });
    setBusy(false);
    setNote(r.ok ? { ok: true, text: `${b.business_name}: ends ${ends ? at(fromLocal(ends)) : "when you end it"}.` } : { ok: false, text: r.data.error || "Couldn't change it." });
    reload();
  };
  const c = l.counts || {};
  return (
    <div style={{ ...S.card, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10, borderLeft: "5px solid #EA580C" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <b style={{ fontSize: 15 }}>{b.business_name}</b>
        <Chip status={l.status} />
        {l.note && <span style={{ fontSize: 12.5, color: C.gray500 }}>“{l.note}”</span>}
        <span style={{ fontSize: 12.5, color: C.gray600, marginLeft: "auto" }}>
          {at(l.starts_at)} → {l.ends_at ? at(l.ends_at) : "until ended"}</span>
      </div>
      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}>
        {[["SKUs paused", c.PAUSED || 0], ["Catalogs", l.catalogs], ["Found live again", l.repaused, "and paused again"],
          ["Last hourly check", l.last_guard_at ? new Date(l.last_guard_at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "—"],
          ...(c.PAUSE_FAILED ? [["Not paused yet", c.PAUSE_FAILED, "tried again hourly"]] : [])].map(([k, v, sub]) => (
          <div key={k} style={{ background: C.gray50, borderRadius: 10, padding: "8px 10px" }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: C.gray500 }}>{k}</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: C.gray900 }}>{v}</div>
            {sub && <div style={{ fontSize: 11, color: C.gray500 }}>{sub}</div>}
          </div>
        ))}
      </div>
      {l.message && <div style={{ fontSize: 12.5, color: C.gray700 }}>{l.message}</div>}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {admin && ["SCHEDULED", "ON_LEAVE"].includes(l.status) && (
          <button onClick={end} disabled={busy} style={btn(l.status === "SCHEDULED" ? "ghost" : "primary", "sm")}>
            {l.status === "SCHEDULED" ? "Cancel" : "▶ End leave now — bring everything back"}</button>
        )}
        {admin && ["SCHEDULED", "PAUSING", "ON_LEAVE"].includes(l.status) && (
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, color: C.gray600 }}>Ends</span>
            <input type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} style={{ ...S.inp, width: "auto", padding: "5px 8px" }} />
            <button onClick={saveEnd} disabled={busy || ends === toLocal(l.ends_at)} style={btn("ghost", "sm")}>Save</button>
            {ends && <button onClick={() => setEnds("")} style={{ ...btn("ghost", "sm") }} title="Until I end it">No end</button>}
          </span>
        )}
        {l.skus > 0 && <button onClick={() => setShow(!show)} style={btn("ghost", "sm")}>{show ? "Hide SKUs" : `See the ${l.skus} SKUs`}</button>}
      </div>
      {show && <Items leave={l} onClose={() => setShow(false)} />}
    </div>
  );
}

export function MeeshoLeaveTab() {
  const mobile = useIsMobile();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [note, setNote] = useState(null);
  const [pick, setPick] = useState({});
  const [startNow, setStartNow] = useState(true);
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [openPast, setOpenPast] = useState(null);

  const load = useCallback(async () => {
    const r = await call("");
    if (r.ok) { setD(r.data); setErr(null); } else setErr(r.data.error || "Couldn't read the leaves.");
  }, []);
  const moving = (d?.businesses || []).some((b) => ["PAUSING", "RESUMING"].includes(b.leave?.status));
  useEffect(() => {
    load();
    const t = setInterval(load, moving ? 15000 : 60000);
    return () => clearInterval(t);
  }, [load, moving]);

  if (!d) return err ? <div role="alert" style={{ ...S.card, color: C.red, fontWeight: 700 }}>✕ {err}</div>
    : <div style={{ padding: 40, textAlign: "center", color: C.gray400 }}>Loading…</div>;
  const free = d.businesses.filter((b) => b.connected && !b.leave);
  const chosen = free.filter((b) => pick[b.business]);

  const go = async () => {
    const names = chosen.map((b) => b.business_name).join(", ");
    const when = startNow ? "now" : at(fromLocal(starts));
    if (!window.confirm(`Put ${names} on leave from ${when}${ends ? ` until ${at(fromLocal(ends))}` : " until you end it"}?\n\n`
      + "Every catalog live on Meesho is paused (each SKU's stock is recorded first), kept paused — checked every hour — and brought back at the end.")) return;
    setBusy(true); setNote(null);
    const r = await call("", "POST", { businesses: chosen.map((b) => b.business), starts_at: startNow ? "" : fromLocal(starts), ends_at: fromLocal(ends), note: why });
    setBusy(false);
    if (r.ok) { setNote({ ok: true, text: `${names}: ${startNow ? "pausing every live catalog now." : `on leave from ${when}.`}` }); setPick({}); setWhy(""); }
    else setNote({ ok: false, text: r.data.error || "Couldn't start the leave." });
    load();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 1100 }}>
      <p style={{ fontSize: 13, color: C.gray500, margin: 0, maxWidth: 860 }}>
        Away for a while? Put a business on leave: every catalog live on Meesho is paused — each SKU's stock recorded first — and
        kept paused (every hour, anything live again is paused again). At the end time, or when you end it, every catalog the leave
        paused comes back on.
      </p>
      {note && <div role="status" style={{ fontSize: 13, fontWeight: 700, color: note.ok ? "#15803D" : C.red }}>{note.ok ? "✓ " : "✕ "}{note.text}</div>}

      {d.businesses.map((b) => <LeaveCard key={b.business} b={b} admin={d.is_admin} reload={load} setNote={setNote} />)}

      {d.is_admin && free.length > 0 && (
        <section style={{ ...S.card, padding: 16, display: "flex", flexDirection: "column", gap: 12, borderTop: "4px solid #EA580C" }}>
          <b style={{ fontSize: 15 }}>🏖 New leave</b>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {free.map((b) => (
              <label key={b.business} style={{ display: "inline-flex", gap: 6, alignItems: "center", padding: "6px 12px", borderRadius: 10, cursor: "pointer",
                border: `1.5px solid ${pick[b.business] ? "#EA580C" : C.gray200}`, background: pick[b.business] ? "#FFF7ED" : C.white, fontWeight: 700, fontSize: 13.5 }}>
                <input type="checkbox" checked={!!pick[b.business]} onChange={(e) => setPick({ ...pick, [b.business]: e.target.checked })} />
                {b.business_name}
              </label>
            ))}
          </div>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: mobile ? "1fr" : "repeat(3, minmax(0, 1fr))" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, fontWeight: 700, color: C.gray600 }}>
              Starts
              <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <select value={startNow ? "now" : "at"} onChange={(e) => setStartNow(e.target.value === "now")} style={{ ...S.inp, width: "auto" }}>
                  <option value="now">Now</option><option value="at">At…</option>
                </select>
                {!startNow && <input type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} style={{ ...S.inp, width: "auto" }} />}
              </span>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, fontWeight: 700, color: C.gray600 }}>
              Ends (empty: until you end it)
              <input type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} style={{ ...S.inp, width: "auto" }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, fontWeight: 700, color: C.gray600 }}>
              Note (optional)
              <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. Diwali holidays" maxLength={200} style={S.inp} />
            </label>
          </div>
          <button onClick={go} disabled={busy || !chosen.length || (!startNow && !starts)}
            style={{ ...btn("primary", "md"), alignSelf: "flex-start", background: "#EA580C", opacity: busy || !chosen.length ? 0.5 : 1 }}>
            {busy ? "Starting…" : `🏖 Go on leave${chosen.length ? ` · ${chosen.length} business${chosen.length === 1 ? "" : "es"}` : ""}`}
          </button>
        </section>
      )}

      {d.past.length > 0 && (
        <section style={{ ...S.card, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "12px 14px", fontWeight: 900, fontSize: 14, borderBottom: `1px solid ${C.gray100}` }}>Past leaves</div>
          {d.past.map((l) => (
            <div key={l.id} style={{ padding: "10px 14px", borderTop: `1px solid ${C.gray100}`, display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
                <b>{l.business_name}</b><Chip status={l.status} />
                <span style={{ color: C.gray600 }}>{at(l.starts_at)} → {at(l.resumed_at || l.ends_at)}</span>
                <span style={{ color: C.gray500 }}>{l.ended_how === "manual" ? `ended by ${l.ended_by || "hand"}` : l.ended_how === "auto" ? "ended at its time" : ""}</span>
                <span style={{ color: C.gray600 }}>{(l.counts.RESUMED || 0)} back{l.counts.RESUME_FAILED ? ` · ${l.counts.RESUME_FAILED} not back yet` : ""}{l.counts.KEPT_PAUSED ? ` · ${l.counts.KEPT_PAUSED} stay paused` : ""}</span>
                {d.is_admin && l.can_retry && (
                  <button onClick={async () => { const r = await call(`${l.id}/end/`, "POST", {}); setNote(r.ok ? { ok: true, text: `${l.business_name}: bringing the rest back.` } : { ok: false, text: r.data.error }); load(); }}
                    style={btn("primary", "sm")}>Bring the rest back</button>
                )}
                {l.skus > 0 && <button onClick={() => setOpenPast(openPast === l.id ? null : l.id)} style={{ ...btn("ghost", "sm"), marginLeft: "auto" }}>
                  {openPast === l.id ? "Hide" : `${l.skus} SKUs`}</button>}
              </div>
              {l.message && <div style={{ fontSize: 12, color: C.gray500 }}>{l.message}</div>}
              {openPast === l.id && <Items leave={l} onClose={() => setOpenPast(null)} />}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
