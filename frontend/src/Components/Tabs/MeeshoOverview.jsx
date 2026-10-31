import React from "react";
import { C, btn, useIsMobile } from "../../App";
import { Panel, Kpi, Stat, BarList, StatusDot, inr, inrShort, num, ago, at, dayLabel } from "./MeeshoUI";
import { AccountsHealth } from "./MeeshoAccounts";
import { LatestLabels } from "./MeeshoAutomation";

/*
 * Meesho → Overview: what needs doing now (the KPI strip — each tile opens the
 * tab that deals with it), how orders and money stand, stock, the labels to
 * print, the automation, and every account's health. Built from what the sync
 * worker last read (GET meesho-orders/summary/ + overview/).
 */

const STAGES = [
  { key: "hold", label: "On hold" },
  { key: "pending", label: "Pending" },
  { key: "ready_to_ship", label: "Ready to ship" },
  { key: "shipped", label: "Shipped" },
  { key: "cancelled", label: "Cancelled" },
];
const every = (m) => (!m ? "off" : m < 60 ? `every ${m} min` : m === 60 ? "every hour" : `every ${m / 60} h`);
const clock = (t) => { const [h, m] = t.split(":").map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }); };

export function MeeshoOverview({ summary, overview, go, onReconnect }) {
  const isMobile = useIsMobile();
  if (!summary || !overview) return null;
  const o = summary.orders, m = summary.money, st = summary.stock, p = summary.packing, auto = summary.automation;
  const atRisk = o.breached + o.breaching_soon;
  const grid = (min) => ({ display: "grid", gap: 12, gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : `repeat(auto-fit, minmax(${min}px, 1fr))` });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ── What needs doing now ─────────────────────────────────────────── */}
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(auto-fit, minmax(170px, 1fr))" }}>
        <Kpi icon="✋" label="To accept" value={num(o.tabs.pending.count)} tone={o.tabs.pending.count ? "brand" : "neutral"}
          sub={auto.enabled && auto.accept_every_minutes ? `Accepted automatically ${every(auto.accept_every_minutes)}` : "Accept them on Orders"}
          onClick={() => go("orders")} />
        <Kpi icon="📦" label="Ready to ship" value={num(o.tabs.ready_to_ship.count)} tone="info"
          sub={o.labels_pending ? `${num(o.labels_pending)} labels not downloaded` : "All labels downloaded"} onClick={() => go("orders")} />
        <Kpi icon="⏱" label="SLA at risk" value={num(atRisk)} tone={o.breached ? "bad" : atRisk ? "warn" : "good"}
          sub={atRisk ? `${num(o.breached)} breached · ${num(o.breaching_soon)} breaching soon` : `On time · ${num(o.due_today)} to dispatch today`}
          onClick={() => go("orders")} />
        <Kpi icon="🔗" label="Packed today" value={num(p.linked_today)} tone={p.open_problems ? "warn" : "good"}
          sub={p.open_problems ? `${num(p.open_problems)} linking problems to look at` : "AWBs linked to packets"} onClick={() => go("linking")} />
        <Kpi icon="₹" label="Next payout" value={m.next_payout ? inrShort(m.next_payout.net) : "—"} tone="good"
          sub={m.next_payout ? dayLabel(m.next_payout.date) : "Nothing scheduled"} onClick={() => go("payments")} />
        <Kpi icon="⌛" label="Outstanding" value={inrShort(m.outstanding_total)} tone="neutral"
          sub={`${num(m.outstanding_orders)} orders still to be paid`} onClick={() => go("payments")} />
      </div>

      {/* ── Orders & money ───────────────────────────────────────────────── */}
      <div style={grid(360)}>
        <Panel title="Order pipeline" subtitle={`${num(o.open)} open orders · updated ${ago(o.updated_at)}`}
          action={<button onClick={() => go("orders")} style={btn("ghost", "sm")}>Open orders</button>}>
          <BarList color="#2563EB" onRow={() => go("orders")}
            rows={STAGES.map((s) => ({
              key: s.key, label: s.label, value: o.tabs[s.key]?.count || 0,
              tooltip: `${s.label}: ${num(o.tabs[s.key]?.count || 0)}` + Object.entries(o.tabs[s.key]?.by_business || {}).map(([b, n]) => `\n${b}: ${num(n)}`).join(""),
            }))} />
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.gray100}` }}>
            <StatusDot tone={o.breached ? "bad" : "good"}>{num(o.breached)} past SLA</StatusDot>
            <StatusDot tone={o.breaching_soon ? "warn" : "good"}>{num(o.breaching_soon)} breaching soon</StatusDot>
            <StatusDot tone="info">{num(o.due_today)} to dispatch today</StatusDot>
          </div>
        </Panel>

        <Panel title="Money" subtitle={m.last_payout ? `Last payout ${inr(m.last_payout.net)} on ${dayLabel(m.last_payout.date)}` : "From Meesho's payments page"}
          action={<button onClick={() => go("payments")} style={btn("ghost", "sm")}>Open payments</button>}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginBottom: 14 }}>
            <Stat label="Paid · 30 days" value={inrShort(m.paid_30d)} tone="good" hint={inr(m.paid_30d)} />
            <Stat label="Upcoming · 7 days" value={inrShort(m.upcoming_7d)} tone="info" hint={inr(m.upcoming_7d)} />
            <Stat label="Outstanding" value={inrShort(m.outstanding_total)} hint={inr(m.outstanding_total)} />
          </div>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: C.gray500, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>Upcoming payouts</div>
          {m.upcoming.length ? (
            <BarList color="#15803D" format={(v) => inr(v)} rows={m.upcoming.map((d) => ({ key: d.date, label: dayLabel(d.date), value: d.net }))} />
          ) : <div style={{ fontSize: 12.5, color: C.gray400 }}>No payouts scheduled — or payments not read yet.</div>}
        </Panel>
      </div>

      {/* ── Stock, labels, automation ────────────────────────────────────── */}
      <div style={grid(300)}>
        <Panel title="Stock" subtitle={`${num(st.skus_live)} SKUs live on Meesho`}
          action={<button onClick={() => go("inventory")} style={btn("ghost", "sm")}>Open inventory</button>}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 }}>
            <Stat label="Live catalogs" value={num(st.active)} />
            <Stat label="Paused" value={num(st.paused)} tone={st.paused ? "warn" : undefined} />
            <Stat label="Out of stock" value={num(st.out_of_stock)} tone={st.out_of_stock ? "bad" : "good"} hint="Live SKUs with 0 stock" />
            <Stat label="Low stock" value={num(st.low_stock)} tone={st.low_stock ? "warn" : undefined} hint="Live SKUs with under 10 in stock" />
          </div>
          <div style={{ fontSize: 12, color: C.gray500, marginTop: 12 }}>
            {num(st.activation_pending)} waiting for activation · {num(st.blocked)} blocked
          </div>
        </Panel>

        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <LatestLabels emptyHint />
        </div>

        <Panel title="Automation" subtitle={auto.enabled ? "Running for every connected business" : "Switched off"}
          action={<button onClick={() => go("settings")} style={btn("ghost", "sm")}>Settings</button>}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
            <StatusDot tone={auto.enabled ? "good" : "neutral"}>{auto.enabled ? "On" : "Off — nothing is accepted or labelled by itself"}</StatusDot>
            <div><span style={{ color: C.gray500 }}>Accept pending: </span><b>{every(auto.accept_every_minutes)}</b>
              {auto.enabled && auto.next_accept_at ? <span style={{ color: C.gray500 }}> · next {at(auto.next_accept_at)}</span> : null}</div>
            <div><span style={{ color: C.gray500 }}>Make labels: </span><b>{auto.label_times.length ? auto.label_times.map(clock).join(", ") : "by hand only"}</b>
              {auto.enabled && auto.next_labels_at ? <span style={{ color: C.gray500 }}> · next {at(auto.next_labels_at)}</span> : null}</div>
          </div>
        </Panel>
      </div>

      {/* ── Accounts ─────────────────────────────────────────────────────── */}
      <Panel title="Meesho accounts" subtitle="When each business's data was last read from Meesho" pad={false}
        action={<button onClick={() => go("settings")} style={btn("ghost", "sm")}>Manage</button>}>
        <AccountsHealth businesses={overview.businesses} isAdmin={overview.is_admin} onReconnect={onReconnect} compact />
      </Panel>
    </div>
  );
}
