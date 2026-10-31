import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { API, C, S, btn, Tag, useIsMobile } from "../../App";
import { CircularProgress } from "@mui/material";

/*
 * Meesho Payments — the panel's Payments page as the sync worker last read it
 * (every two hours): money paid in the last 30 days and due in the next 7, day
 * by day, and every order payment still outstanding. Completed payments are
 * imported into the Payments tables by the same worker; outstanding ones are
 * kept apart, because they haven't been paid yet.
 */

const BUSY = ["QUEUED", "RUNNING"];
const inr = (v) => (v === null || v === undefined ? "—" : `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`);
const inr2 = (v) => (v === null || v === undefined ? "—" : `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const day = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" }) : "—");
const when = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "never");
const sum = (xs, f) => xs.reduce((n, x) => n + (f(x) || 0), 0);

function Stat({ label, value, sub, tone }) {
  return (
    <div style={{ ...S.card, padding: "12px 14px", borderTop: `5px solid ${tone}`, display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
      <span style={{ fontSize: 12.5, fontWeight: 800, color: tone }}>{label}</span>
      <span style={{ fontFamily: "monospace", fontSize: 26, fontWeight: 900, lineHeight: 1.1 }}>{value}</span>
      {sub && <span style={{ fontSize: 11.5, color: C.gray500 }}>{sub}</span>}
    </div>
  );
}

/** Payouts by date, merged across businesses. */
function Payouts({ title, rows, upcoming, multi }) {
  const byDate = useMemo(() => {
    const m = new Map();
    rows.forEach((r) => {
      const d = m.get(r.date) || { date: r.date, net: 0, orders: 0, ads: 0, parts: [] };
      d.net += r.net || 0; d.orders += r.orders || 0; d.ads += r.ads || 0;
      d.parts.push(r);
      m.set(r.date, d);
    });
    return [...m.values()].sort((a, b) => (upcoming ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)));
  }, [rows, upcoming]);
  return (
    <div style={{ ...S.card, padding: 0, overflow: "hidden", minWidth: 0 }}>
      <div style={{ padding: "12px 14px", fontWeight: 800, fontSize: 14.5, borderBottom: `1px solid ${C.gray100}` }}>{title}</div>
      <div style={{ maxHeight: 360, overflowY: "auto" }}>
        {byDate.length === 0 && <div style={{ padding: 18, color: C.gray400, fontSize: 13, textAlign: "center" }}>Nothing here yet.</div>}
        {byDate.map((d) => (
          <div key={d.date} style={{ padding: "9px 14px", borderBottom: `1px solid ${C.gray100}`, display: "flex", flexDirection: "column", gap: 2 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
              <span style={{ fontWeight: 700, fontSize: 13.5 }}>{day(d.date)}</span>
              <span style={{ fontFamily: "monospace", fontWeight: 900, fontSize: 15, color: upcoming ? "#2563EB" : C.green }}>{inr2(d.net)}</span>
            </div>
            <span style={{ fontSize: 11.5, color: C.gray500 }}>
              orders {inr(d.orders)}{d.ads ? ` · ads ${inr(d.ads)}` : ""}
              {!upcoming && !multi && d.parts[0]?.transfer_id ? ` · UTR ${d.parts[0].transfer_id}` : ""}
            </span>
            {multi && d.parts.map((p) => (
              <span key={p.business_name} style={{ fontSize: 11.5, color: C.gray500 }}>
                {p.business_name}: {inr2(p.net)}{!upcoming && p.transfer_id ? ` · UTR ${p.transfer_id}` : ""}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function MeeshoPaymentsTab() {
  const isMobile = useIsMobile();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [due, setDue] = useState("all");
  const [biz, setBiz] = useState("all");
  const [shown, setShown] = useState(100);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/meesho-orders/payments/`);
      if (res.ok) setData(await res.json());
    } catch { /* keep the last state */ }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, data?.syncing ? 5000 : 60000);
    return () => clearInterval(t);
  }, [load, data?.syncing]);
  useEffect(() => { setShown(100); }, [q, due, biz]);

  const refresh = async () => {
    setError(null);
    const res = await fetch(`${API}/meesho-orders/payments/refresh/`, { method: "POST" }).catch(() => null);
    if (!res || !res.ok) {
      const d = res ? await res.json().catch(() => ({})) : {};
      setError(d.error || "Couldn't start a refresh.");
    }
    load();
  };

  const accounts = (data?.accounts || []).filter((a) => biz === "all" || String(a.business_id) === biz);
  const multi = (data?.accounts.length || 0) > 1;
  const outstanding = useMemo(() => (data?.outstanding || []).filter((o) => (biz === "all" || String(o.business_id) === biz)), [data, biz]);
  const dueDates = useMemo(() => [...new Set(outstanding.map((o) => o.expected).filter(Boolean))].sort(), [outstanding]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return outstanding.filter((o) => (due === "all" || o.expected === due)
      && (!needle || `${o.sub_order_no} ${o.sku} ${o.product} ${o.status}`.toLowerCase().includes(needle)));
  }, [outstanding, q, due]);

  if (!data) return <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><CircularProgress style={{ color: C.orange }} /></div>;
  if (!data.connected) {
    return <div style={{ ...S.card, padding: 18, fontSize: 13.5, color: C.gray600 }}>No Meesho account is connected here yet. <Link to="/meesho-orders?tab=settings" style={{ color: C.orange, fontWeight: 800 }}>Connect one under Settings</Link>.</div>;
  }

  const paid = accounts.flatMap((a) => a.paid.map((p) => ({ ...p, business_name: a.business_name })));
  const upcoming = accounts.flatMap((a) => a.upcoming.map((p) => ({ ...p, business_name: a.business_name })));
  const outTotal = sum(outstanding, (o) => o.amount);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <p style={{ fontSize: 13, color: C.gray500, margin: 0, maxWidth: 760 }}>
          Read from the Meesho panel every two hours. Completed payments of the last 30 days go straight into the{" "}
          <Link to="/payments" style={{ color: C.orange, fontWeight: 700 }}>Payments</Link> tables — no file to upload. Outstanding payments
          (next 7 days) are listed here and kept apart, since they haven't been paid yet.
        </p>
        <button onClick={refresh} disabled={data.syncing} style={{ ...btn("primary", "md"), minWidth: 170, opacity: data.syncing ? 0.6 : 1 }}>
          {data.syncing ? <><CircularProgress size={14} style={{ color: "#fff", marginRight: 6, verticalAlign: "-2px" }} />Reading payments…</> : "↻ Refresh payments"}
        </button>
      </div>
      {error && <div style={{ color: C.red, fontWeight: 700, fontSize: 13 }}>{error}</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12.5, color: C.gray500 }}>
        {accounts.map((a) => (
          <span key={a.business_id}>
            {multi && <b style={{ color: C.gray700 }}>{a.business_name}: </b>}
            {a.last_run ? (BUSY.includes(a.last_run.status) ? "reading now…"
              : <>last read {when(a.last_run.finished_at || a.last_run.queued_at)} — <span style={{ color: a.last_run.status === "FAILED" ? C.red : C.gray600 }}>{a.last_run.message}</span></>)
              : "not read yet — press Refresh payments"}
            {a.table_last_payment_date && <> · latest payment in the table: <b>{day(a.table_last_payment_date)}</b></>}
          </span>
        ))}
      </div>

      <div style={{ display: "grid", gap: 10, gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))" }}>
        <Stat label="Paid · last 30 days" value={inr(sum(accounts, (a) => a.paid_total))} sub={`${plural(paid.length, "payout")}`} tone={C.green} />
        <Stat label="Upcoming · next 7 days" value={inr(sum(accounts, (a) => a.upcoming_total))} sub="Meesho's estimate" tone="#2563EB" />
        <Stat label="Outstanding orders" value={outstanding.length.toLocaleString("en-IN")} sub={`${inr(outTotal)} to settle`} tone="#B45309" />
        <Stat label="Ads deducted · 30 days" value={inr(Math.abs(sum(paid, (p) => p.ads)))} sub="from paid payouts" tone={C.red} />
      </div>

      {multi && (
        <select value={biz} onChange={(e) => setBiz(e.target.value)} style={{ ...S.inp, width: "auto", padding: "6px 10px", alignSelf: "flex-start" }}>
          <option value="all">All businesses</option>
          {data.accounts.map((a) => <option key={a.business_id} value={String(a.business_id)}>{a.business_name}</option>)}
        </select>
      )}

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "repeat(2, minmax(0, 1fr))" }}>
        <Payouts title="Upcoming payouts" rows={upcoming} upcoming multi={multi && biz === "all"} />
        <Payouts title="Recent payouts" rows={paid} multi={multi && biz === "all"} />
      </div>

      <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 14px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderBottom: `1px solid ${C.gray100}` }}>
          <span style={{ fontWeight: 800, fontSize: 14.5, flex: 1, minWidth: 160 }}>Outstanding order payments</span>
          <select value={due} onChange={(e) => setDue(e.target.value)} style={{ ...S.inp, width: "auto", padding: "6px 10px" }}>
            <option value="all">Every date ({outstanding.length})</option>
            {dueDates.map((d) => <option key={d} value={d}>{day(d)} ({outstanding.filter((o) => o.expected === d).length})</option>)}
          </select>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sub-order, SKU, status…" style={{ ...S.inp, width: isMobile ? "100%" : 260 }} />
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead><tr>{["Expected", ...(multi && biz === "all" ? ["Business"] : []), "Sub-order", "SKU", "Status", "Qty", "Sale", "Settlement"].map((h) => (
              <th key={h} style={{ ...S.th, textAlign: ["Qty", "Sale", "Settlement"].includes(h) ? "right" : "left" }}>{h}</th>
            ))}</tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={8} style={{ ...S.td, textAlign: "center", color: C.gray400, padding: 24 }}>{outstanding.length ? "Nothing matches." : "Nothing outstanding — or not read yet."}</td></tr>}
              {rows.slice(0, shown).map((o) => (
                <tr key={`${o.business_id}-${o.sub_order_no}-${o.expected}`}>
                  <td style={{ ...S.td, whiteSpace: "nowrap" }}>{day(o.expected)}</td>
                  {multi && biz === "all" && <td style={S.td}>{o.business_name}</td>}
                  <td style={{ ...S.td, fontFamily: "monospace" }}>{o.sub_order_no}</td>
                  <td style={{ ...S.td, fontFamily: "monospace", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={o.product}>{o.sku}</td>
                  <td style={S.td}><Tag variant={/rto|return/i.test(o.status) ? "red" : /deliver/i.test(o.status) ? "green" : "blue"}>{o.status || "—"}</Tag></td>
                  <td style={{ ...S.td, textAlign: "right" }}>{o.quantity ?? "—"}</td>
                  <td style={{ ...S.td, textAlign: "right" }}>{inr2(o.sale)}</td>
                  <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 800, color: (o.amount || 0) < 0 ? C.red : C.gray800 }}>{inr2(o.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > shown && (
          <div style={{ padding: 10, textAlign: "center" }}>
            <button onClick={() => setShown((n) => n + 200)} style={btn("ghost", "sm")}>Show more ({rows.length - shown} more)</button>
          </div>
        )}
      </div>
    </div>
  );
}

const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
