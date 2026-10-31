import React, { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { API, C, btn, useIsMobile } from "../../App";
import { CircularProgress } from "@mui/material";
import { MeeshoOrdersTab } from "./MeeshoOrdersTab";
import { MeeshoLiveInventoryTab } from "./MeeshoLiveInventoryTab";
import { MeeshoSyncTab } from "./MeeshoSyncTab";
import { MeeshoPaymentsTab } from "./MeeshoPaymentsTab";
import { MeeshoLinkingTab } from "./MeeshoLinkingTab";
import { MeeshoReturnsTab } from "./MeeshoReturnsTab";
import { SyncScheduleCard } from "./MeeshoSchedule";
import { AutomationCard, LatestLabels } from "./MeeshoAutomation";
import { MeeshoOverview } from "./MeeshoOverview";
import { SessionAlerts, ReconnectDialog, AccountsHealth } from "./MeeshoAccounts";
import { Panel, ago } from "./MeeshoUI";

/*
 * Meesho — everything the Meesho panel sync does, as one dashboard:
 *
 *   Overview       what needs doing now, orders, money, stock, accounts
 *   Orders         accept, ready to ship, labels
 *   Order linking  AWB ↔ packet at the packing desk
 *   Returns & OTPs couriers' delivery OTPs; returns by status
 *   Inventory      every SKU by parent; pause
 *   Payments       paid, upcoming, outstanding
 *   Settings       automation, Meesho accounts and their sessions
 *
 * ?tab= keeps the place. A broken session shows on every tab, with Reconnect
 * (password, or a session pasted from the browser).
 */

const TABS = [
  { key: "overview", label: "Overview", icon: "◧" },
  { key: "orders", label: "Orders", icon: "📦" },
  { key: "linking", label: "Order linking", icon: "🔗" },
  { key: "returns", label: "Returns & OTPs", icon: "↩" },
  { key: "inventory", label: "Inventory", icon: "▤" },
  { key: "payments", label: "Payments", icon: "₹" },
  { key: "settings", label: "Settings", icon: "⚙" },
];
// Older links (?tab=sync) land on Settings.
const ALIASES = { sync: "settings" };

function Badge({ n, tone }) {
  if (!n) return null;
  const bg = tone === "bad" ? C.red : tone === "brand" ? C.orange : C.gray500;
  return (
    <span style={{ minWidth: 18, height: 18, padding: "0 5px", borderRadius: 9, background: bg, color: "#fff", fontSize: 11, fontWeight: 800,
      display: "inline-flex", alignItems: "center", justifyContent: "center", fontVariantNumeric: "tabular-nums" }}>{n > 999 ? "999+" : n}</span>
  );
}

export function MeeshoHubTab() {
  const isMobile = useIsMobile();
  const [params, setParams] = useSearchParams();
  const asked = ALIASES[params.get("tab")] || params.get("tab");
  const tab = TABS.some((t) => t.key === asked) ? asked : "overview";
  const go = useCallback((key) => {
    setParams(key === "overview" ? {} : { tab: key }, { replace: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [setParams]);

  const [overview, setOverview] = useState(null);
  const [summary, setSummary] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [note, setNote] = useState(null);
  const [reconnect, setReconnect] = useState(null);

  const load = useCallback(async () => {
    const [ov, su] = await Promise.all([
      fetch(`${API}/meesho-orders/overview/`).catch(() => null),
      fetch(`${API}/meesho-orders/summary/`).catch(() => null),
    ]);
    if (ov?.ok) setOverview(await ov.json());
    if (su?.ok) setSummary(await su.json());
  }, []);
  const busy = overview?.businesses.some((b) => b.busy || b.logging_in);
  useEffect(() => {
    load();
    const t = setInterval(load, busy ? 5000 : 60000);
    return () => clearInterval(t);
  }, [load, busy]);

  const refreshAll = async () => {
    setRefreshing(true); setNote(null);
    try {
      const rs = await Promise.all(["meesho-orders/refresh/", "meesho-live-inventory/refresh/", "meesho-orders/payments/refresh/"]
        .map((p) => fetch(`${API}/${p}`, { method: "POST" }).catch(() => null)));
      setNote(rs.some((r) => r?.ok) ? { ok: true, text: "Reading orders, stock and payments from Meesho — the numbers update as each finishes." }
        : { ok: false, text: "Couldn't start a refresh — is a Meesho account connected?" });
      load();
    } finally { setRefreshing(false); }
  };

  const businesses = overview?.businesses || [];
  const connected = businesses.filter((b) => b.connected).length;
  const broken = businesses.filter((b) => b.needs_login).length;
  const failing = businesses.filter((b) => b.orders?.status === "FAILED" || b.inventory?.status === "FAILED" || b.payments?.status === "FAILED").length;
  const latest = businesses.map((b) => b.orders?.at).filter(Boolean).sort().pop();
  const health = !overview ? null
    : (!overview.queue || !overview.worker) ? { tone: "bad", text: !overview.queue ? "Job queue unreachable" : "Sync worker stopped" }
      : broken ? { tone: "bad", text: `${broken} session${broken === 1 ? "" : "s"} expired` }
        : failing ? { tone: "warn", text: `${failing} business${failing === 1 ? "" : "es"} with sync errors` }
          : connected ? { tone: "good", text: `In sync · ${ago(latest)}` } : { tone: "neutral", text: "Not connected" };
  const healthColor = { bad: C.red, warn: "#B45309", good: "#15803D", neutral: C.gray500 }[health?.tone || "neutral"];

  const badge = {
    orders: summary && <Badge n={summary.orders.tabs.pending.count} tone="brand" />,
    linking: summary && <Badge n={summary.packing.open_problems} tone="bad" />,
    inventory: summary && <Badge n={summary.stock.out_of_stock} />,
    settings: (broken || failing) ? <span title="Needs attention" style={{ width: 8, height: 8, borderRadius: 4, background: C.red }} /> : null,
  };

  if (!overview) return <div style={{ display: "flex", justifyContent: "center", padding: 80 }}><CircularProgress style={{ color: C.orange }} /></div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1440 }}>
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h1 style={{ fontSize: 24, fontWeight: 900, color: C.gray900, margin: 0, letterSpacing: "-0.02em" }}>Meesho</h1>
            {health && (
              <span role="status" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 999,
                background: C.white, border: `1px solid ${C.gray200}`, fontSize: 12.5, fontWeight: 700, color: healthColor }}>
                <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, background: healthColor }} />{health.text}
              </span>
            )}
          </div>
          <p style={{ fontSize: 13, color: C.gray500, margin: "4px 0 0" }}>
            Orders, packing, stock and payments for {connected} of {businesses.length} business{businesses.length === 1 ? "" : "es"}
            {businesses.length > 1 ? ` (${businesses.map((b) => b.business_name).join(", ")})` : ""} — kept in step with Meesho in the background.
          </p>
        </div>
        <button onClick={refreshAll} disabled={refreshing || !connected}
          style={{ ...btn("primary", "md"), minWidth: 170, opacity: refreshing || !connected ? 0.6 : 1 }}>
          {refreshing ? <><CircularProgress size={14} style={{ color: "#fff", marginRight: 6, verticalAlign: "-2px" }} />Starting…</> : "↻ Refresh everything"}
        </button>
      </header>

      <SessionAlerts businesses={businesses} isAdmin={overview.is_admin} onReconnect={setReconnect} />
      {(!overview.queue || !overview.worker) && (
        <div role="alert" style={{ background: C.amberLight, border: `1.5px solid ${C.amberBorder}`, borderRadius: 12, padding: "10px 14px", color: "#92400E", fontSize: 13, fontWeight: 700 }}>
          ⚠ {!overview.queue ? "The job queue (Redis) can't be reached" : "The sync worker (Sidekiq) isn't running"} — nothing is read from Meesho, and nothing updates, until it is.
        </div>
      )}
      {note && <div role="status" style={{ fontSize: 13, fontWeight: 700, color: note.ok ? C.gray600 : C.red }}>{note.text}</div>}

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      <nav role="tablist" aria-label="Meesho" style={{ display: "flex", gap: 4, padding: 4, background: C.gray100, borderRadius: 12, overflowX: "auto",
        position: "sticky", top: 0, zIndex: 20 }}>
        {TABS.map((t) => {
          const on = tab === t.key;
          return (
            <button key={t.key} role="tab" aria-selected={on} onClick={() => go(t.key)}
              style={{ border: "none", cursor: "pointer", fontFamily: "inherit", padding: isMobile ? "8px 12px" : "9px 16px", borderRadius: 9,
                background: on ? C.white : "transparent", boxShadow: on ? "0 1px 3px rgba(15,23,42,.12)" : "none",
                color: on ? C.gray900 : C.gray600, fontWeight: on ? 800 : 700, fontSize: 13.5, display: "flex", gap: 7, alignItems: "center",
                whiteSpace: "nowrap", flex: isMobile ? "0 0 auto" : 1, justifyContent: "center", transition: "background .15s" }}>
              <span aria-hidden style={{ opacity: on ? 1 : 0.7 }}>{t.icon}</span>{t.label}{badge[t.key]}
            </button>
          );
        })}
      </nav>

      {/* ── Content ──────────────────────────────────────────────────────── */}
      <div role="tabpanel" aria-label={TABS.find((t) => t.key === tab).label}>
        {tab === "overview" && (summary
          ? <MeeshoOverview summary={summary} overview={overview} go={go} onReconnect={setReconnect} />
          : <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><CircularProgress style={{ color: C.orange }} /></div>)}
        {tab === "orders" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <LatestLabels />
            <MeeshoOrdersTab embedded />
          </div>
        )}
        {tab === "linking" && <MeeshoLinkingTab />}
        {tab === "returns" && <MeeshoReturnsTab />}
        {tab === "inventory" && <MeeshoLiveInventoryTab embedded />}
        {tab === "payments" && <MeeshoPaymentsTab />}
        {tab === "settings" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1100 }}>
            <AutomationCard />
            <SyncScheduleCard isAdmin={overview.is_admin} />
            <Panel title="Meesho accounts" pad={false}
              subtitle="One Meesho supplier account per business. When a session expires, log in again here — the sync picks up straight after.">
              <AccountsHealth businesses={businesses} isAdmin={overview.is_admin} onReconnect={setReconnect} />
            </Panel>
            <Panel title="This business's connection"
              subtitle={`The account of the business on screen — supplier details, schedule and recent runs.${businesses.length > 1 ? " Switch business at the top of the app to manage another." : ""}`}>
              <MeeshoSyncTab embedded />
            </Panel>
          </div>
        )}
      </div>

      {reconnect && (
        <ReconnectDialog business={reconnect} onClose={() => { setReconnect(null); load(); }}
          onDone={() => { setNote({ ok: true, text: `${reconnect.business_name} is connected again — reading its data now.` }); setReconnect(null); load(); }} />
      )}
    </div>
  );
}
