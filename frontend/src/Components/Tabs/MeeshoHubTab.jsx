import React, { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { API, C, S, btn, Tag, useIsMobile } from "../../App";
import { CircularProgress } from "@mui/material";
import { MeeshoOrdersTab } from "./MeeshoOrdersTab";
import { MeeshoLiveInventoryTab } from "./MeeshoLiveInventoryTab";
import { MeeshoSyncTab } from "./MeeshoSyncTab";
import { MeeshoPaymentsTab } from "./MeeshoPaymentsTab";
import { AutomationCard, LatestLabels } from "./MeeshoAutomation";
import { MeeshoLinkingTab } from "./MeeshoLinkingTab";

/*
 * Meesho — one place for everything the Meesho panel sync does: Orders,
 * Inventory, Payments and the account/sync settings, as tabs (?tab= keeps the choice in
 * the address). The header shows, per business on this desk, whether its
 * account is connected, when its orders and inventory were last read, and when
 * the app's own tables (orders, Meesho Stock) were last brought up to date
 * from them — the Sidekiq worker does all of that in the background.
 */

const TABS = [
  { key: "orders", label: "Orders", icon: "📦" },
  { key: "linking", label: "Order linking", icon: "🔗" },
  { key: "inventory", label: "Inventory", icon: "▤" },
  { key: "payments", label: "Payments", icon: "₹" },
  { key: "sync", label: "Accounts & sync", icon: "⟳" },
];
const BUSY = ["QUEUED", "RUNNING"];

const ago = (iso) => {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso)) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

const STATE = {
  ACTIVE: { label: "Connected", tag: "green" },
  NEW: { label: "Logging in…", tag: "blue" },
  LOGGING_IN: { label: "Logging in…", tag: "blue" },
  FAILED: { label: "Needs attention", tag: "red" },
  DISABLED: { label: "Disconnected", tag: "gray" },
};

function Line({ label, at, status, detail, busy }) {
  const failed = status === "FAILED";
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 12.5, minWidth: 0 }}>
      <span style={{ width: 8, height: 8, borderRadius: 4, flexShrink: 0, alignSelf: "center",
        background: busy || BUSY.includes(status) ? C.blue : failed ? C.red : at ? C.green : C.gray300 }} />
      <span style={{ color: C.gray500, width: 104, flexShrink: 0 }}>{label}</span>
      <span style={{ fontWeight: 700, color: failed ? C.red : C.gray800, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        title={detail || undefined}>
        {BUSY.includes(status) ? "reading now…" : ago(at)}{detail ? <span style={{ fontWeight: 500, color: failed ? C.red : C.gray500 }}> · {detail}</span> : null}
      </span>
    </div>
  );
}

function BusinessCard({ b, current, onFix }) {
  const st = b.status ? STATE[b.status] || STATE.NEW : { label: "Not connected", tag: "gray" };
  const failedMsg = b.status === "FAILED" ? b.status_message
    : b.orders?.status === "FAILED" ? b.orders.message
      : b.inventory?.status === "FAILED" ? b.inventory.message
        : b.payments?.status === "FAILED" ? b.payments.message : "";
  return (
    <div style={{ ...S.card, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 7, minWidth: 0,
      borderTop: `4px solid ${failedMsg ? C.red : b.connected ? C.green : C.gray300}` }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontWeight: 800, fontSize: 14.5, color: C.gray900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {b.business_name}{current && <span style={{ fontWeight: 600, fontSize: 11.5, color: C.gray400 }}> · on screen</span>}
        </span>
        <span style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
          {b.busy && <CircularProgress size={12} style={{ color: C.blue }} />}
          <Tag variant={st.tag}>{st.label}</Tag>
        </span>
      </div>
      {b.status ? (
        <>
          <Line label="Orders pulled" at={b.orders.at} status={b.orders.status} busy={b.busy} />
          <Line label="Inventory read" at={b.inventory.at} status={b.inventory.status} />
          <Line label="Orders table" at={b.orders.table_changed_at} detail="updated from Meesho" />
          <Line label="Meesho Stock" at={b.inventory.stock_changed_at} detail={`${b.inventory.stock_rows} SKUs`} />
          <Line label="Payments" at={b.payments?.at} status={b.payments?.status} detail="imported to Payments" />
          {failedMsg && (
            <div style={{ fontSize: 12, color: C.red, display: "flex", gap: 8, alignItems: "flex-start" }}>
              <span style={{ flex: 1, minWidth: 0 }}>{String(failedMsg).slice(0, 180)}</span>
              {current && <button onClick={onFix} style={{ ...btn("ghost", "sm"), color: C.red, whiteSpace: "nowrap" }}>Fix</button>}
            </div>
          )}
        </>
      ) : (
        <div style={{ fontSize: 12.5, color: C.gray500 }}>
          {current ? <>No Meesho account yet. <button onClick={onFix} style={{ border: "none", background: "none", color: C.orange, fontWeight: 800, cursor: "pointer", padding: 0 }}>Connect it →</button></>
            : "No Meesho account yet — switch to this business to connect it."}
        </div>
      )}
    </div>
  );
}

export function MeeshoHubTab() {
  const isMobile = useIsMobile();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.key === params.get("tab")) ? params.get("tab") : "orders";
  const setTab = (key) => setParams(key === "orders" ? {} : { tab: key }, { replace: true });
  const [data, setData] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [note, setNote] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/meesho-orders/overview/`);
      if (res.ok) setData(await res.json());
    } catch { /* keep the last state */ }
  }, []);
  const anyBusy = data?.businesses.some((b) => b.busy);
  useEffect(() => {
    load();
    const t = setInterval(load, anyBusy ? 5000 : 60000);
    return () => clearInterval(t);
  }, [load, anyBusy]);

  // Orders and inventory for every connected business, in one go.
  const refreshAll = async () => {
    setRefreshing(true); setNote(null);
    try {
      const [o, i] = await Promise.all([
        fetch(`${API}/meesho-orders/refresh/`, { method: "POST" }),
        fetch(`${API}/meesho-live-inventory/refresh/`, { method: "POST" }),
      ]);
      if (!o.ok && !i.ok) {
        const d = await o.json().catch(() => ({}));
        setNote({ error: true, text: d.error || "Couldn't start a refresh." });
      } else {
        setNote({ error: false, text: "Pulling orders and inventory from Meesho — the tables update as each finishes." });
      }
      load();
    } catch {
      setNote({ error: true, text: "Network error." });
    } finally {
      setRefreshing(false);
    }
  };

  const businesses = data?.businesses || [];
  const connected = businesses.filter((b) => b.connected).length;
  const needsAttention = businesses.some((b) => b.status === "FAILED" || b.orders?.status === "FAILED" || b.inventory?.status === "FAILED" || b.payments?.status === "FAILED");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 24, fontWeight: 900, color: C.gray900, margin: 0, letterSpacing: "-0.01em" }}>Meesho</h1>
          <p style={{ fontSize: 13, color: C.gray500, marginTop: 3, maxWidth: 720 }}>
            Orders, inventory and the account sync in one place. The sync worker reads the Meesho panel in the background and keeps
            the app's orders and Meesho Stock tables up to date — {data ? `${connected} of ${businesses.length} business${businesses.length === 1 ? "" : "es"} connected` : "loading…"}.
          </p>
        </div>
        <button onClick={refreshAll} disabled={refreshing || !connected}
          style={{ ...btn("primary", "md"), minWidth: 170, opacity: refreshing || !connected ? 0.6 : 1 }}>
          {refreshing ? <><CircularProgress size={14} style={{ color: "#fff", marginRight: 6, verticalAlign: "-2px" }} />Starting…</> : "↻ Refresh everything"}
        </button>
      </div>

      {data && (!data.queue || !data.worker) && (
        <div style={{ background: C.amberLight, border: `1.5px solid ${C.amberBorder}`, borderRadius: 12, padding: "10px 14px", color: "#92400E", fontSize: 13, fontWeight: 700 }}>
          ⚠ {!data.queue ? "The job queue (Redis) can't be reached" : "The sync worker (Sidekiq) isn't running"} — nothing is read from Meesho, and the tables don't update, until it is.
        </div>
      )}
      {note && (
        <div style={{ fontSize: 13, fontWeight: 700, color: note.error ? C.red : C.gray600 }}>{note.text}</div>
      )}

      {businesses.length > 0 && (
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "repeat(auto-fill, minmax(300px, 1fr))" }}>
          {businesses.map((b) => (
            <BusinessCard key={b.business_id} b={b} current={b.business_id === data.current_business_id} onFix={() => setTab("sync")} />
          ))}
        </div>
      )}

      <LatestLabels />

      <div role="tablist" style={{ display: "flex", gap: 4, borderBottom: `2px solid ${C.gray200}`, overflowX: "auto" }}>
        {TABS.map((t) => {
          const on = tab === t.key;
          return (
            <button key={t.key} role="tab" aria-selected={on} onClick={() => setTab(t.key)}
              style={{ border: "none", background: "none", cursor: "pointer", fontFamily: "inherit", padding: "10px 16px", marginBottom: -2,
                borderBottom: `3px solid ${on ? C.orange : "transparent"}`, color: on ? C.gray900 : C.gray500,
                fontWeight: on ? 800 : 700, fontSize: 14.5, display: "flex", gap: 7, alignItems: "center", whiteSpace: "nowrap" }}>
              <span aria-hidden>{t.icon}</span>{t.label}
              {t.key === "sync" && needsAttention && <span title="Needs attention" style={{ width: 8, height: 8, borderRadius: 4, background: C.red }} />}
            </button>
          );
        })}
      </div>

      <div role="tabpanel">
        {tab === "orders" && <MeeshoOrdersTab embedded />}
        {tab === "linking" && <MeeshoLinkingTab />}
        {tab === "inventory" && <MeeshoLiveInventoryTab embedded />}
        {tab === "payments" && <MeeshoPaymentsTab />}
        {tab === "sync" && (
          <>
            {businesses.length > 1 && (
              <div style={{ fontSize: 12.5, color: C.gray500, marginBottom: 10 }}>
                Settings for the business on screen. Switch business at the top of the app to manage another one's Meesho account.
              </div>
            )}
            <div style={{ marginBottom: 16 }}><AutomationCard /></div>
            <MeeshoSyncTab embedded />
          </>
        )}
      </div>
    </div>
  );
}
