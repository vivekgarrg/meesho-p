import React, { useState, useEffect, useCallback } from "react";
import { API, C, S, btn } from "../../App";
import { Panel, StatusDot, ago } from "./MeeshoUI";

/*
 * Meesho → Settings → Sync schedule: how often each kind of data is read from
 * Meesho, and how much of it each time (MeeshoSyncSetting). The sync worker
 * follows it from the next minute.
 */

const mins = (m) => (m === 0 ? "Off" : m < 60 ? `Every ${m} min` : m === 60 ? "Every hour" : m % 60 === 0 ? `Every ${m / 60} hours` : `Every ${m} min`);
const WINDOWS = { last_2_week: "Last 2 weeks", last_1_month: "Last month" };

// What is read, and the settings for it. `every` lists the intervals offered.
const ROWS = [
  { key: "orders", title: "Orders", what: "On hold, Pending, Ready to ship and Cancelled — and the orders table follows them.",
    last: "sync", fields: [{ f: "orders_every", label: "Read", every: [1, 2, 5, 10, 15, 30, 60] }] },
  { key: "shipped", title: "Shipped orders", what: "The Shipped tab — hundreds of orders, so read less often.",
    last: "sync", fields: [{ f: "shipped_every", label: "Read", every: [5, 10, 15, 30, 60, 120, 240] }] },
  { key: "inventory", title: "Inventory", what: "Every catalog and its SKUs, and the Meesho Stock table.",
    last: "inventory", fields: [
      { f: "inventory_every", label: "Read", every: [0, 15, 30, 60, 120, 240, 720, 1440] },
      { f: "inventory_sku_reads", label: "Catalogs' SKUs read per run", number: true, hint: "Meesho gives SKUs one catalog per request — the rest follow in the next runs." },
    ] },
  { key: "payments", title: "Payments", what: "Completed payments into the Payments tables, and outstanding payments.",
    last: "payments", fields: [
      { f: "payments_every", label: "Read", every: [0, 30, 60, 120, 240, 720, 1440] },
      { f: "payments_paid_days", label: "Completed payments for the last (days)", number: true },
      { f: "payments_upcoming_days", label: "Outstanding payments for the next (days)", number: true },
    ] },
  { key: "returns", title: "Returns & OTPs", what: "Courier OTPs, and every return in transit, out for delivery, delivered, lost or disposed.",
    last: "returns", fields: [
      { f: "returns_every", label: "Read", every: [0, 5, 10, 15, 30, 60, 120, 240] },
      { f: "returns_window", label: "Delivered and lost returns from the", window: true },
    ] },
];

export function SyncScheduleCard({ isAdmin }) {
  const [s, setS] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    const r = await fetch(`${API}/meesho-orders/sync-settings/`).catch(() => null);
    if (r?.ok) { const d = await r.json(); setS(d); setDraft(d); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!s || !draft) return null;
  const fields = ROWS.flatMap((r) => r.fields.map((x) => x.f));
  const changed = fields.filter((f) => String(draft[f]) !== String(s[f]));

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const body = Object.fromEntries(changed.map((f) => [f, f === "returns_window" ? draft[f] : Number(draft[f])]));
      const r = await fetch(`${API}/meesho-orders/sync-settings/`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ ok: false, text: d.error || "Couldn't save." }); return; }
      setS(d); setDraft(d); setMsg({ ok: true, text: "Saved — the sync follows it from the next minute." });
    } catch { setMsg({ ok: false, text: "Network error." }); }
    finally { setBusy(false); }
  };

  const control = (x) => {
    const lim = s.limits[x.f];
    const value = draft[x.f];
    if (!isAdmin) {
      return <b>{x.every ? mins(value) : x.window ? WINDOWS[value] : value}</b>;
    }
    if (x.every) {
      return (
        <select value={value} onChange={(e) => setDraft({ ...draft, [x.f]: Number(e.target.value) })} style={{ ...S.inp, width: "auto", padding: "6px 10px" }}>
          {[...new Set([...x.every, value])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{mins(m)}</option>)}
        </select>
      );
    }
    if (x.window) {
      return (
        <select value={value} onChange={(e) => setDraft({ ...draft, [x.f]: e.target.value })} style={{ ...S.inp, width: "auto", padding: "6px 10px" }}>
          {s.returns_windows.map((w) => <option key={w} value={w}>{WINDOWS[w] || w}</option>)}
        </select>
      );
    }
    const bad = value === "" || Number(value) < lim.min || Number(value) > lim.max;
    return (
      <input type="number" min={lim.min} max={lim.max} value={value} onChange={(e) => setDraft({ ...draft, [x.f]: e.target.value })}
        aria-invalid={bad} title={`${lim.min}–${lim.max}`} style={{ ...S.inp, width: 96, padding: "6px 10px", borderColor: bad ? C.red : undefined }} />
    );
  };

  return (
    <Panel title="Sync schedule" subtitle="How often each kind of data is read from Meesho, and how much each time. Reading more often means more requests to Meesho — it answers bursts with “too many requests”." pad={false}
      action={isAdmin && changed.length > 0 && (
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setDraft(s)} style={btn("ghost", "sm")}>Undo</button>
          <button onClick={save} disabled={busy} style={btn("primary", "sm")}>{busy ? "Saving…" : `Save ${changed.length} change${changed.length === 1 ? "" : "s"}`}</button>
        </div>
      )}>
      {msg && <div role="status" style={{ padding: "0 16px 8px", fontSize: 12.5, fontWeight: 700, color: msg.ok ? C.green : C.red }}>{msg.text}</div>}
      <div>
        {ROWS.map((row, i) => (
          <div key={row.key} style={{ display: "grid", gridTemplateColumns: "minmax(200px, 1fr) minmax(260px, 1.6fr)", gap: 16, padding: "14px 16px",
            borderTop: `1px solid ${C.gray100}`, background: i % 2 ? C.gray50 : "transparent" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 13.5, color: C.gray900 }}>{row.title}</div>
              <div style={{ fontSize: 12, color: C.gray500, marginTop: 2 }}>{row.what}</div>
              <div style={{ marginTop: 6 }}><StatusDot tone={s.last_read[row.last] ? "good" : "neutral"}>last read {ago(s.last_read[row.last])}</StatusDot></div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {row.fields.map((x) => (
                <label key={x.f} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12.5, color: C.gray600, fontWeight: 700 }}>
                  <span style={{ minWidth: 150 }}>{x.label}</span>
                  {control(x)}
                  {x.number && isAdmin && <span style={{ fontWeight: 500, color: C.gray400 }}>{s.limits[x.f].min}–{s.limits[x.f].max}</span>}
                  {x.hint && <span style={{ flexBasis: "100%", fontWeight: 500, color: C.gray400, fontSize: 11.5 }}>{x.hint}</span>}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
