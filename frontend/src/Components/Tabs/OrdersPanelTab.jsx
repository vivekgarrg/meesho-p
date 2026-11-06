import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { API, C, S, btn, Tag } from "../../App";
import { CircularProgress } from "@mui/material";
import { Panel, BarList, StatusDot, ago, at, dayLabel, num } from "./MeeshoUI";
import { ParentLinkButton } from "./ParentLink";

/*
 * Orders Panel — every Meesho order across the businesses on this desk, as the
 * worker last pulled them, in tabs like the Meesho supplier panel:
 *
 *   Pending        not accepted yet (auto-accept takes them) + accepted, label not generated
 *   Ready to ship  label downloaded, waiting for pickup
 *   Shipped        last 7 days
 *   Cancelled      last 7 days
 *
 * Each tab lists orders one by one, or grouped by parent SKU (SKU Pricing) —
 * a SKU with no parent stands on its own, with a button to link it.
 *
 * Days turn at the packing-day cutoff (the server's PACKING_DAY_STARTS): an
 * order placed before it ships that day, one after it ships the next day.
 *
 * Layout follows the page's own width, not the screen's — the sidebar takes a
 * different share on a phone, an iPad and a MacBook: "phone" (cards), "medium"
 * (a compact table) and "wide" (the full table).
 */

const META = {
  to_accept: { tone: "info", color: "#2563EB", label: "Not accepted yet" },
  on_hold: { tone: "neutral", color: "#94A3B8", label: "On hold" },
  to_download: { tone: "warn", color: "#F59E0B", label: "Label to generate" },
  downloaded: { tone: "brand", color: "#6D28D9", label: "Ready to ship" },
  shipped: { tone: "good", color: "#059669", label: "Shipped" },
  cancelled: { tone: "bad", color: "#E11D48", label: "Cancelled" },
};
const ORDER = ["to_accept", "on_hold", "to_download", "downloaded", "shipped", "cancelled"];
const OPEN = ["to_accept", "on_hold", "to_download", "downloaded"];
const TABS = [
  { key: "pending", label: "Pending", short: "Pending", statuses: ["to_accept", "on_hold", "to_download"] },
  { key: "ready", label: "Ready to Ship", short: "Ready", statuses: ["downloaded"] },
  { key: "shipped", label: "Shipped", short: "Shipped", statuses: ["shipped"] },
  { key: "cancelled", label: "Cancelled", short: "Cancelled", statuses: ["cancelled"] },
];
// Pending's own filter: everything, only what auto-accept will take, or only what's accepted.
const PENDING_VIEWS = [
  { key: "all", label: "All pending", statuses: ["to_accept", "on_hold", "to_download"] },
  { key: "accept", label: "Not accepted yet", statuses: ["to_accept", "on_hold"] },
  { key: "label", label: "Accepted — label to generate", statuses: ["to_download"] },
];
const PAGE = 60;

const hourText = (h) => (h === 12 ? "12 pm" : h === 0 ? "12 am" : h > 12 ? `${h - 12} pm` : `${h} am`);
const shortDay = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const timeOf = (iso) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "");
const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const store = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

function dayName(iso, today) {
  if (iso === today) return "Today";
  if (iso === addDays(today, 1)) return "Tomorrow";
  if (iso === addDays(today, -1)) return "Yesterday";
  return dayLabel(iso);
}

/** The width this page actually has (sidebar or not) → "phone" | "medium" | "wide". */
function useLayout() {
  const ref = useRef(null);
  const [w, setW] = useState(1200);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const set = () => setW(el.getBoundingClientRect().width || 1200);
    set();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", set);
      return () => window.removeEventListener("resize", set);
    }
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w < 640 ? "phone" : w < 1000 ? "medium" : "wide", w];
}

/** What an order is waiting on, in words — "Auto-accept 4:15 pm" for one not accepted yet. */
function State({ r, automation }) {
  if (r.status === "to_accept" && automation?.enabled && automation.accept_every_minutes) {
    return <StatusDot tone="info">Auto-accept {automation.next_accept_at ? timeOf(automation.next_accept_at) : "soon"}</StatusDot>;
  }
  return <StatusDot tone={META[r.status].tone}>{META[r.status].label}</StatusDot>;
}

function Sla({ r, today }) {
  if (!OPEN.includes(r.status)) return null;
  const s = String(r.sla_status || "");
  if (r.dispatch_by && r.dispatch_by < today) return <Tag variant="red">Overdue</Tag>;
  if (s.includes("breach") && !s.includes("soon")) return <Tag variant="red">SLA breached</Tag>;
  if (s === "breaching_soon") return <Tag variant="amber">Breaching soon</Tag>;
  return null;
}

const Img = ({ src, size = 44 }) => (src
  ? <img src={src} alt="" loading="lazy" style={{ width: size, height: size, borderRadius: 10, objectFit: "cover", flexShrink: 0, border: `1px solid ${C.gray100}`, background: C.gray50 }} />
  : <span aria-hidden style={{ width: size, height: size, borderRadius: 10, background: C.gray100, flexShrink: 0 }} />);

const ellipsis = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

function Switch({ on, onChange, label }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => onChange(!on)}
      style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit",
        fontSize: 13, fontWeight: 800, color: on ? C.orange : C.gray600, padding: "6px 0", minHeight: 36, whiteSpace: "nowrap" }}>
      <span aria-hidden style={{ width: 36, height: 20, borderRadius: 999, background: on ? C.orange : C.gray300, position: "relative", transition: "background .15s", flexShrink: 0 }}>
        <span style={{ position: "absolute", top: 2, left: on ? 18 : 2, width: 16, height: 16, borderRadius: 999, background: C.white, transition: "left .15s",
          boxShadow: "0 1px 2px rgba(0,0,0,.25)" }} />
      </span>
      {label}
    </button>
  );
}

/** One step of the order flow — clickable, it opens that tab. */
function Step({ label, value, sub, color, active, onClick, alert, wide }) {
  return (
    <button onClick={onClick} aria-pressed={active}
      style={{ ...S.card, padding: "12px 14px", gridColumn: wide ? "1 / -1" : "auto", textAlign: "left", fontFamily: "inherit", cursor: "pointer", minWidth: 0,
        display: "flex", flexDirection: "column", gap: 4, position: "relative", overflow: "hidden",
        border: `${active ? 2 : 1}px solid ${active ? color : C.gray200}`, background: active ? `${color}0D` : C.white,
        boxShadow: active ? `0 0 0 3px ${color}1F` : S.card.boxShadow, transition: "border-color .15s, box-shadow .15s" }}>
      <span aria-hidden style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: color }} />
      <span style={{ fontSize: 12, fontWeight: 800, color: C.gray500, ...ellipsis }}>{label}</span>
      <span style={{ fontSize: 26, fontWeight: 900, lineHeight: 1.05, color: alert ? C.red : C.gray900, fontVariantNumeric: "tabular-nums" }}>{value}</span>
      {sub && <span style={{ fontSize: 11.5, color: C.gray500, lineHeight: 1.35 }}>{sub}</span>}
    </button>
  );
}

/** The orders one by one — a card each on a phone, a table otherwise (compact when space is tight). */
function OrderList({ rows, today, layout, automation }) {
  if (layout === "phone") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((r) => (
          <div key={`${r.business_id}-${r.sub_order_num}`} style={{ display: "flex", gap: 10, padding: 10, border: `1px solid ${C.gray200}`, borderRadius: 12, background: C.white, minWidth: 0 }}>
            <Img src={r.image} size={60} />
            <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                <span style={{ fontWeight: 800, fontSize: 13.5, color: C.gray900, wordBreak: "break-all", minWidth: 0 }}>{r.sku}</span>
                <span style={{ fontWeight: 900, fontSize: 13, color: r.quantity > 1 ? C.white : C.gray700, background: r.quantity > 1 ? C.red : C.gray100,
                  borderRadius: 6, padding: "1px 7px", flexShrink: 0 }}>×{r.quantity}</span>
              </div>
              {r.product_name && <div style={{ fontSize: 12, color: C.gray500, ...ellipsis }}>{r.product_name}</div>}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <State r={r} automation={automation} /><Sla r={r} today={today} />
              </div>
              <div style={{ fontSize: 12, color: C.gray600 }}>
                Ships <b>{r.ship_day ? dayName(r.ship_day, today) : "—"}</b>{r.dispatch_by ? ` · Meesho due ${shortDay(r.dispatch_by)}` : ""}
              </div>
              <div style={{ fontSize: 11.5, color: C.gray400, wordBreak: "break-all" }}>
                {[r.business_name, r.courier, r.awb ? `AWB ${r.awb}` : "", r.sub_order_num].filter(Boolean).join(" · ")}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }
  const wide = layout === "wide";
  const th = { ...S.th, padding: "10px 12px", position: "sticky", top: 0, zIndex: 1 };
  const td = { ...S.td, padding: "10px 12px", verticalAlign: "top" };
  const cols = wide ? ["Product", "Order", "Business", "Ordered", "Dispatch", "Courier / AWB"] : ["Product", "Order", "Dispatch"];
  return (
    <div style={{ overflowX: "auto", border: `1px solid ${C.gray200}`, borderRadius: 12 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: wide ? "auto" : "fixed" }}>
        {!wide && <colgroup><col style={{ width: "48%" }} /><col style={{ width: "27%" }} /><col style={{ width: "25%" }} /></colgroup>}
        <thead><tr>{cols.map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.business_id}-${r.sub_order_num}`}>
              <td style={td}>
                <div style={{ display: "flex", gap: 10, minWidth: 0 }}>
                  <Img src={r.image} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, color: C.gray900, fontWeight: 800, wordBreak: "break-all" }}>
                      {r.sku}{r.quantity > 1 && <span style={{ marginLeft: 6, color: C.white, background: C.red, borderRadius: 6, padding: "0 6px", fontSize: 12 }}>×{r.quantity}</span>}
                      {r.express ? <span title="Express"> ⚡</span> : null}
                    </div>
                    <div style={{ fontSize: 12, color: C.gray500, marginTop: 2, ...ellipsis, maxWidth: wide ? 320 : "100%" }} title={r.product_name}>{r.product_name || "—"}</div>
                    {r.parent && r.parent.toLowerCase() !== String(r.sku).toLowerCase() && <div style={{ fontSize: 11.5, color: C.gray400, marginTop: 2, ...ellipsis }}>Parent · {r.parent}</div>}
                  </div>
                </div>
              </td>
              <td style={{ ...td, fontSize: 12.5 }}>
                <State r={r} automation={automation} />
                <div style={{ color: C.gray600, marginTop: 4, wordBreak: "break-all", fontSize: 12 }}>{r.sub_order_num}</div>
                {!wide && <div style={{ color: C.gray400, fontSize: 11.5, marginTop: 2, ...ellipsis }}>{r.business_name}{r.courier ? ` · ${r.courier}` : ""}</div>}
              </td>
              {wide && <td style={{ ...td, whiteSpace: "nowrap" }}>{r.business_name}</td>}
              {wide && <td style={{ ...td, whiteSpace: "nowrap" }}>{r.created_at ? shortDay(r.created_at.slice(0, 10)) : "—"}
                <div style={{ fontSize: 11.5, color: C.gray400 }}>{timeOf(r.created_at)}</div></td>}
              <td style={td}>
                <div style={{ fontWeight: 800, color: C.gray800, whiteSpace: "nowrap" }}>Ships {r.ship_day ? dayName(r.ship_day, today) : "—"}</div>
                {r.dispatch_by && <div style={{ fontSize: 11.5, color: C.gray500, whiteSpace: "nowrap" }}>Meesho due {shortDay(r.dispatch_by)}</div>}
                <div style={{ marginTop: 4 }}><Sla r={r} today={today} /></div>
              </td>
              {wide && <td style={{ ...td, whiteSpace: "nowrap" }}>{r.courier || "—"}<div style={{ fontSize: 11.5, color: C.gray400 }}>{r.awb || ""}</div></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Orders grouped by parent SKU: one row per parent (a SKU with no parent on its own), its orders underneath. */
function ParentGroups({ rows, today, layout, canLink, businesses, onLinked, automation }) {
  const [open, setOpen] = useState({});
  const phone = layout === "phone";
  const groups = useMemo(() => {
    const acc = {};
    for (const r of rows) {
      const name = r.parent || r.sku || "—";
      const k = `${r.parent ? "p" : "s"}|${name.toLowerCase()}`;
      const g = acc[k] || (acc[k] = { key: k, parent: r.parent, name, orders: [], qty: 0, skus: {}, biz: {}, states: {}, image: r.image, product: r.product_name });
      g.orders.push(r); g.qty += r.quantity;
      g.skus[r.sku] = (g.skus[r.sku] || 0) + r.quantity;
      g.biz[r.business_id] = (g.biz[r.business_id] || 0) + 1;
      g.states[r.status] = (g.states[r.status] || 0) + 1;
      g.image = g.image || r.image;
    }
    return Object.values(acc).sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));
  }, [rows]);
  const nameOf = (id) => businesses.find((b) => String(b.id) === String(id))?.name || "";
  const loose = groups.filter((g) => !g.parent).length;
  const toggle = (k) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", fontSize: 12.5, color: C.gray500 }}>
        <span>
          <b style={{ color: C.gray800 }}>{num(groups.length - loose)}</b> parent{groups.length - loose === 1 ? "" : "s"}
          {loose ? <> · <b style={{ color: C.amber }}>{num(loose)}</b> SKU{loose === 1 ? "" : "s"} with no parent</> : null}
          {" · "}{num(rows.length)} orders · {num(rows.reduce((n, r) => n + r.quantity, 0))} pieces
        </span>
        {groups.length > 1 && (
          <button onClick={() => setOpen(Object.keys(open).length ? {} : Object.fromEntries(groups.map((g) => [g.key, true])))}
            style={{ background: "none", border: "none", color: C.orange, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, padding: 0 }}>
            {Object.keys(open).length ? "Collapse all" : "Expand all"}</button>
        )}
      </div>
      {groups.map((g) => {
        const isOpen = !!open[g.key];
        const skuList = Object.entries(g.skus).sort((a, b) => b[1] - a[1]);
        const linkable = !g.parent ? Object.keys(g.biz).filter((id) => canLink.has(Number(id))) : [];
        const states = ORDER.filter((s) => g.states[s]);
        return (
          <div key={g.key} style={{ border: `1px solid ${isOpen ? C.orangeBorder : C.gray200}`, borderRadius: 12, background: C.white, minWidth: 0 }}>
            <div role="button" tabIndex={0} aria-expanded={isOpen} onClick={() => toggle(g.key)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(g.key); } }}
              style={{ display: "grid", gridTemplateColumns: phone ? "auto 1fr auto" : "auto auto 1fr auto", gap: phone ? 10 : 12, alignItems: "center",
                padding: phone ? "10px" : "10px 14px", cursor: "pointer", borderRadius: 12, background: isOpen ? C.orangeLight : C.white }}>
              {!phone && <span aria-hidden style={{ color: isOpen ? C.orange : C.gray500, fontSize: 14, width: 12, textAlign: "center" }}>{isOpen ? "▾" : "▸"}</span>}
              <Img src={g.image} size={phone ? 48 : 52} />
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 900, fontSize: phone ? 13.5 : 14.5, color: C.gray900, wordBreak: "break-word" }}>{g.name}</span>
                  {!g.parent && <Tag variant="amber">No parent</Tag>}
                </div>
                <div style={{ fontSize: 12, color: C.gray500, marginTop: 2, ...(phone ? { wordBreak: "break-word" } : ellipsis) }}>
                  {g.parent ? skuList.map(([k, n]) => `${k} ×${n}`).join(" · ") : g.product}
                </div>
                {states.length > 1 && (
                  <div style={{ display: "flex", gap: "2px 10px", flexWrap: "wrap", marginTop: 4 }}>
                    {states.map((s) => <StatusDot key={s} tone={META[s].tone}>{g.states[s]} {META[s].label.toLowerCase()}</StatusDot>)}
                  </div>
                )}
                {Object.keys(g.biz).length > 1 && (
                  <div style={{ fontSize: 11.5, color: C.gray400, marginTop: 2 }}>{Object.entries(g.biz).map(([id, n]) => `${nameOf(id)} ${n}`).join(" · ")}</div>
                )}
                {linkable.length > 0 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }} onClick={(e) => e.stopPropagation()}>
                    {linkable.map((id) => (
                      <span key={id} style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12, color: C.gray500 }}>
                        <ParentLinkButton compact businessId={Number(id)} businessName={nameOf(id)} sku={g.name} onLinked={onLinked} />
                        {linkable.length > 1 ? nameOf(id) : ""}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {phone ? (
                <div style={{ textAlign: "right", flexShrink: 0, whiteSpace: "nowrap" }}>
                  <div style={{ fontSize: 20, fontWeight: 900, color: C.gray900, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>×{num(g.qty)}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.gray500, marginTop: 3 }}>{num(g.orders.length)} order{g.orders.length === 1 ? "" : "s"}</div>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 18, textAlign: "right", flexShrink: 0 }}>
                  <div><div style={{ fontSize: 22, fontWeight: 900, color: C.gray900, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{num(g.qty)}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.gray500 }}>pieces</div></div>
                  <div><div style={{ fontSize: 22, fontWeight: 900, color: C.gray900, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{num(g.orders.length)}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.gray500 }}>orders</div></div>
                </div>
              )}
            </div>
            {isOpen && (
              <div style={{ borderTop: `1px solid ${C.gray100}`, padding: phone ? 8 : 10 }}>
                <OrderList rows={g.orders} today={today} layout={layout} automation={automation} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StackBar({ day, max }) {
  const parts = ORDER.filter((k) => day[k] > 0);
  return (
    <div style={{ display: "flex", gap: 2, height: 12, width: `${Math.max(day.total ? 4 : 0, (100 * day.total) / max)}%`, minWidth: day.total ? 6 : 0 }}>
      {parts.map((k, i) => (
        <span key={k} title={`${META[k].label}: ${day[k]}`}
          style={{ flex: day[k], background: META[k].color,
            borderRadius: `${i === 0 ? 4 : 0}px ${i === parts.length - 1 ? 4 : 0}px ${i === parts.length - 1 ? 4 : 0}px ${i === 0 ? 4 : 0}px` }} />
      ))}
    </div>
  );
}

export function OrdersPanelTab() {
  const [rootRef, layout] = useLayout();
  const phone = layout === "phone";
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTabState] = useState(() => store.get("orders_panel_tab", "pending"));
  const [grouped, setGroupedState] = useState(() => store.get("orders_panel_grouped", "1") === "1");
  const [pendingView, setPendingView] = useState("all");
  const [day, setDay] = useState("all");
  const [biz, setBiz] = useState("all");
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  const setTab = (t) => { setTabState(t); store.set("orders_panel_tab", t); };
  const setGrouped = (g) => { setGroupedState(g); store.set("orders_panel_grouped", g ? "1" : "0"); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/meesho-orders/panel/`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || j.detail || "Couldn't read the orders.");
      setD(j); setErr(null);
    } catch (e) { setErr(e.message === "Failed to fetch" ? "Couldn't reach the server." : e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);
  useEffect(() => { setShown(PAGE); }, [tab, day, biz, q, grouped, pendingView]);

  const current = TABS.find((t) => t.key === tab) || TABS[0];
  const statuses = tab === "pending" ? (PENDING_VIEWS.find((v) => v.key === pendingView) || PENDING_VIEWS[0]).statuses : current.statuses;
  const base = useMemo(() => (d ? d.orders.filter((r) => (day === "all" || r.ship_day === day) && (biz === "all" || String(r.business_id) === biz)) : []), [d, day, biz]);
  const statusKey = statuses.join(",");
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const want = statusKey.split(",");
    return base.filter((r) => want.includes(r.status)
      && (!needle || [r.sku, r.parent, r.product_name, r.sub_order_num, r.awb, r.courier].some((v) => String(v || "").toLowerCase().includes(needle))));
  }, [base, statusKey, q]);

  const shell = (children) => <div ref={rootRef} style={{ width: "100%", maxWidth: 1320, minWidth: 0 }}>{children}</div>;
  if (!d) {
    return shell(err
      ? <div role="alert" style={{ ...S.card, color: C.red, fontWeight: 700, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>✕ {err} <button onClick={load} style={btn("ghost", "sm")}>Try again</button></div>
      : <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><CircularProgress style={{ color: C.orange }} /></div>);
  }

  const t = d.totals;
  const a = d.automation;
  const cut = hourText(d.cutoff_hour);
  const today = d.today;
  const tomorrow = addDays(today, 1);
  const byDate = Object.fromEntries(d.days.map((x) => [x.date, x]));
  const stale = d.updated_at && Date.now() - new Date(d.updated_at) > 45 * 60000;
  const maxDay = Math.max(1, ...d.days.map((x) => x.total));
  const canLink = new Set(d.can_link || []);
  const countOf = (k) => base.filter((r) => k.includes(r.status)).length;
  const autoOn = a.enabled && a.accept_every_minutes;
  const goTab = (k, view) => { setTab(k); if (view) setPendingView(view); document.getElementById("orders-tabs")?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  const pickDay = (iso) => { setDay(iso); document.getElementById("orders-tabs")?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  const windowText = (x) => `orders ${shortDay(addDays(x.date, -1))} ${cut} → ${shortDay(x.date)} ${cut}`;
  const gap = phone ? 12 : 16;
  const control = { ...S.inp, width: "auto", minHeight: 38, padding: "8px 10px", background: C.white };

  const DayCard = ({ iso, title }) => {
    const x = byDate[iso] || { date: iso, total: 0, quantity: 0 };
    const on = day === iso;
    return (
      <button onClick={() => pickDay(on ? "all" : iso)} aria-pressed={on}
        style={{ ...S.card, padding: phone ? "12px 14px" : "14px 16px", textAlign: "left", fontFamily: "inherit", cursor: "pointer", minWidth: 0,
          border: `${on ? 2 : 1}px solid ${on ? C.orange : C.gray200}`, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 900, fontSize: 15, color: C.gray900 }}>{title}</div>
            <div style={{ fontSize: 12, color: C.gray500, marginTop: 2 }}>Ships {dayLabel(iso)} · {windowText(x)}</div>
          </div>
          <span style={{ fontSize: 30, fontWeight: 900, fontVariantNumeric: "tabular-nums", color: C.gray900, lineHeight: 1 }}>{num(x.total)}</span>
        </div>
        {x.total > 0 && (
          <div style={{ display: "flex", gap: 2, height: 8, borderRadius: 4, overflow: "hidden", background: C.gray100 }}>
            {ORDER.filter((k) => x[k]).map((k) => <span key={k} title={`${META[k].label}: ${x[k]}`} style={{ flex: x[k], background: META[k].color }} />)}
          </div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
          {ORDER.filter((k) => x[k]).map((k) => <StatusDot key={k} tone={META[k].tone}>{num(x[k])} {META[k].label.toLowerCase()}</StatusDot>)}
          {!x.total && <span style={{ fontSize: 12.5, color: C.gray400 }}>No orders yet</span>}
        </div>
        {(x.by_business || []).length > 1 && <div style={{ fontSize: 12, color: C.gray500 }}>{x.by_business.map((b) => `${b.business} ${b.count}`).join(" · ")}</div>}
      </button>
    );
  };

  return shell(
    <div style={{ display: "flex", flexDirection: "column", gap }}>
      {/* Header */}
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: "1 1 260px" }}>
          <h1 style={{ fontSize: phone ? 20 : 24, fontWeight: 900, color: C.gray900, margin: 0, letterSpacing: "-0.01em" }}>Orders Panel</h1>
          <p style={{ fontSize: 13, color: C.gray500, margin: "4px 0 0", lineHeight: 1.5 }}>
            {d.businesses.length === 1 ? d.businesses[0].name : `${d.businesses.length} businesses`} · ordered before {cut} ships that day, after {cut} the next
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span title={d.updated_at ? at(d.updated_at) : ""} style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12, fontWeight: 700,
            color: stale ? "#92400E" : C.gray600, background: stale ? C.amberLight : C.gray100, borderRadius: 999, padding: "5px 10px" }}>
            <span aria-hidden style={{ width: 7, height: 7, borderRadius: 4, background: stale ? C.amber : C.green }} />
            Read from Meesho {ago(d.updated_at)}
          </span>
          <button onClick={load} disabled={loading} style={{ ...btn("ghost", "sm"), minHeight: 34 }}>
            {loading ? <CircularProgress size={13} style={{ color: C.orange }} /> : "↻ Refresh"}</button>
        </div>
      </div>

      {err && <div role="alert" style={{ color: C.red, fontWeight: 700, fontSize: 13.5 }}>✕ {err}</div>}
      {stale && (
        <div role="status" style={{ padding: "10px 14px", borderRadius: 12, background: C.amberLight, border: `1px solid ${C.amberBorder}`, color: "#92400E", fontSize: 13, fontWeight: 600 }}>
          ⚠ Orders were last read from Meesho {ago(d.updated_at)} — counts may be behind. Check the sync on Meesho Settings.
        </div>
      )}

      {/* The flow: not accepted → label to generate → ready to ship → shipped */}
      <div style={{ display: "grid", gridTemplateColumns: phone ? "repeat(2, minmax(0, 1fr))" : layout === "medium" ? "repeat(3, minmax(0, 1fr))" : "repeat(5, minmax(0, 1fr))", gap: phone ? 8 : 12 }}>
        <Step label="Not accepted yet" value={num(t.to_accept + t.on_hold)} color="#2563EB" active={tab === "pending" && pendingView === "accept"}
          onClick={() => goTab("pending", "accept")}
          sub={autoOn ? `Auto-accept every ${a.accept_every_minutes} min · next ${timeOf(a.next_accept_at)}` : "Auto-accept is off"} />
        <Step label="Label to generate" value={num(t.to_download)} color="#F59E0B" active={tab === "pending" && pendingView === "label"}
          onClick={() => goTab("pending", "label")} sub={a.next_labels_at ? `Next labels ${at(a.next_labels_at)}` : "Accepted, no label yet"} />
        <Step label="Ready to ship" value={num(t.downloaded)} color="#6D28D9" active={tab === "ready"} onClick={() => goTab("ready")} sub="Downloaded · awaiting pickup" />
        <Step label="Shipped today" value={num(t.shipped)} color="#059669" active={tab === "shipped"} onClick={() => goTab("shipped")} sub={`${num(t.cancelled)} cancelled today`} />
        <Step wide={phone} label="SLA" value={num(t.breached)} color={C.red} alert={t.breached > 0} active={false} onClick={() => goTab("pending", "all")}
          sub={`breached · ${num(t.breaching_soon)} breaching soon`} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: phone ? "minmax(0, 1fr)" : "repeat(2, minmax(0, 1fr))", gap: phone ? 8 : 12 }}>
        <DayCard iso={today} title="Today" />
        <DayCard iso={tomorrow} title="Tomorrow" />
      </div>

      {/* The orders, in the Meesho panel's tabs */}
      <section id="orders-tabs" style={{ ...S.card, padding: 0, minWidth: 0, scrollMarginTop: 12 }}>
        <div role="tablist" aria-label="Order status"
          style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", borderBottom: `1px solid ${C.gray200}` }}>
          {TABS.map((x) => {
            const on = x.key === tab;
            const n = countOf(x.statuses);
            return (
              <button key={x.key} role="tab" aria-selected={on} onClick={() => setTab(x.key)}
                style={{ padding: phone ? "10px 4px" : "14px 12px", background: on ? C.orangeLight : "none", border: "none", cursor: "pointer", fontFamily: "inherit",
                  borderBottom: `3px solid ${on ? C.orange : "transparent"}`, color: on ? C.orange : C.gray600, minWidth: 0,
                  display: "flex", flexDirection: phone ? "column" : "row", alignItems: "center", justifyContent: "center", gap: phone ? 2 : 8,
                  borderTopLeftRadius: x.key === "pending" ? 14 : 0, borderTopRightRadius: x.key === "cancelled" ? 14 : 0 }}>
                <span style={{ fontWeight: on ? 900 : 700, fontSize: phone ? 12.5 : 14, ...ellipsis, maxWidth: "100%" }}>{phone ? x.short : x.label}</span>
                <span style={{ padding: "1px 8px", borderRadius: 999, fontSize: 12, fontWeight: 800, fontVariantNumeric: "tabular-nums",
                  background: on ? C.orange : C.gray100, color: on ? C.white : C.gray600 }}>{num(n)}</span>
              </button>
            );
          })}
        </div>

        <div style={{ padding: phone ? 10 : 16, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          {tab === "pending" && (
            <div role="radiogroup" aria-label="Which pending orders"
              style={{ display: "flex", gap: 4, padding: 4, background: C.gray100, borderRadius: 12, overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
              {PENDING_VIEWS.map((v) => {
                const on = pendingView === v.key;
                return (
                  <button key={v.key} role="radio" aria-checked={on} onClick={() => setPendingView(v.key)}
                    style={{ flex: "1 0 auto", padding: "8px 12px", borderRadius: 9, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, whiteSpace: "nowrap",
                      fontWeight: on ? 900 : 700, background: on ? C.white : "transparent", color: on ? C.gray900 : C.gray600,
                      boxShadow: on ? "0 1px 3px rgba(15,23,42,.12)" : "none" }}>
                    {v.key === "accept" && autoOn ? "Will be auto-accepted" : v.label} · {num(countOf(v.statuses))}
                  </button>
                );
              })}
            </div>
          )}
          {tab === "pending" && pendingView !== "label" && countOf(["to_accept"]) > 0 && (
            <div style={{ fontSize: 12.5, color: "#1E3A8A", background: "#EFF6FF", borderRadius: 10, padding: "8px 12px" }}>
              {autoOn
                ? <>ℹ {num(countOf(["to_accept"]))} not accepted yet — auto-accept takes them every {a.accept_every_minutes} min (next {timeOf(a.next_accept_at)}), then they need a label.</>
                : <>ℹ {num(countOf(["to_accept"]))} not accepted yet, and auto-accept is off — accept them on Meesho Orders or turn it on in Meesho Settings.</>}
            </div>
          )}

          {/* Filters */}
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: phone ? "repeat(2, minmax(0, 1fr))" : layout === "medium" ? "auto minmax(0, 1fr) minmax(0, 1fr)" : "auto minmax(0, 200px) minmax(0, 180px) minmax(160px, 1fr) auto", alignItems: "center" }}>
            <div style={{ gridColumn: phone ? "1 / -1" : "auto" }}><Switch on={grouped} onChange={setGrouped} label="Group by parent SKU" /></div>
            <select value={day} onChange={(e) => setDay(e.target.value)} aria-label="Dispatch day" style={{ ...control, width: "100%", minWidth: 0, textOverflow: "ellipsis" }}>
              <option value="all">Every day</option>
              {d.days.map((x) => <option key={x.date} value={x.date}>Ships {dayName(x.date, today)} · {shortDay(x.date)} ({x.total})</option>)}
            </select>
            {d.businesses.length > 1 ? (
              <select value={biz} onChange={(e) => setBiz(e.target.value)} aria-label="Business" style={{ ...control, width: "100%", minWidth: 0, textOverflow: "ellipsis" }}>
                <option value="all">Every business</option>
                {d.businesses.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
              </select>
            ) : <span />}
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search SKU, parent, product, sub-order, AWB…" aria-label="Search orders"
              style={{ ...control, width: "100%", gridColumn: layout === "wide" ? "auto" : "1 / -1" }} />
            {(day !== "all" || biz !== "all" || q) ? (
              <button onClick={() => { setDay("all"); setBiz("all"); setQ(""); }} style={{ ...btn("ghost", "sm"), minHeight: 38, gridColumn: layout === "wide" ? "auto" : "1 / -1" }}>Clear filters</button>
            ) : (layout === "wide" && <span />)}
          </div>

          {!rows.length ? (
            <div style={{ padding: "36px 12px", textAlign: "center", color: C.gray500, fontSize: 13.5, border: `1px dashed ${C.gray200}`, borderRadius: 12 }}>
              <div style={{ fontSize: 26, marginBottom: 6 }} aria-hidden>📭</div>
              No {tab === "pending" ? "pending" : current.label.toLowerCase()} orders{day !== "all" ? ` shipping ${dayName(day, today).toLowerCase()}` : ""}{q ? ` matching “${q}”` : ""}.
            </div>
          ) : grouped ? (
            <ParentGroups rows={rows} today={today} layout={layout} canLink={canLink} businesses={d.businesses} onLinked={load} automation={a} />
          ) : (
            <>
              <div style={{ fontSize: 12.5, color: C.gray500 }}><b style={{ color: C.gray800 }}>{num(rows.length)}</b> orders · {num(rows.reduce((n, r) => n + r.quantity, 0))} pieces</div>
              <OrderList rows={rows.slice(0, shown)} today={today} layout={layout} automation={a} />
              {rows.length > shown && (
                <button onClick={() => setShown((n) => n + PAGE * 3)} style={{ ...btn("ghost", "sm"), alignSelf: "center", minHeight: 36 }}>
                  Show more ({num(rows.length - shown)} left)</button>
              )}
            </>
          )}
        </div>
      </section>

      {/* Analytics */}
      <div style={{ display: "grid", gridTemplateColumns: layout === "wide" ? "minmax(0, 3fr) minmax(0, 2fr)" : "minmax(0, 1fr)", gap }}>
        <Panel title="Orders by dispatch day" subtitle={`Each day is ${cut} to ${cut} · tap one to filter the tabs`}>
          <div style={{ display: "flex", gap: "6px 14px", flexWrap: "wrap", marginBottom: 10 }}>
            {ORDER.map((k) => (
              <span key={k} style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12, color: C.gray600, fontWeight: 600 }}>
                <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: META[k].color }} />{META[k].label}
              </span>
            ))}
          </div>
          <div role="table">
            {d.days.map((x) => (
              <button key={x.date} role="row" onClick={() => pickDay(day === x.date ? "all" : x.date)} title={windowText(x)}
                style={{ display: "grid", gridTemplateColumns: phone ? "78px minmax(0,1fr) 36px" : "130px minmax(0,1fr) 48px", gap: 10, alignItems: "center", width: "100%",
                  padding: "8px 6px", border: "none", borderBottom: `1px solid ${C.gray100}`, background: day === x.date ? C.orangeLight : "transparent",
                  cursor: "pointer", fontFamily: "inherit", textAlign: "left", borderRadius: 6 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: C.gray700, ...ellipsis }}>
                  {dayName(x.date, today)}{!phone && [today, tomorrow, addDays(today, -1)].includes(x.date) ? <span style={{ color: C.gray400, fontWeight: 600 }}> · {shortDay(x.date)}</span> : null}
                </span>
                <StackBar day={x} max={maxDay} />
                <span style={{ fontSize: 13, fontWeight: 800, color: C.gray900, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{num(x.total)}</span>
              </button>
            ))}
          </div>
        </Panel>

        <div style={{ display: "grid", gridTemplateColumns: layout === "medium" ? "repeat(2, minmax(0, 1fr))" : "minmax(0, 1fr)", gap, alignContent: "start" }}>
          <Panel title="Meesho dispatch deadline" subtitle="Open orders by Meesho's dispatch-by date">
            <BarList rows={[
              { label: "Overdue", value: d.due.overdue, color: C.red },
              { label: "Due today", value: d.due.today, color: "#F59E0B" },
              { label: "Due tomorrow", value: d.due.tomorrow, color: "#2563EB" },
              { label: "Later", value: d.due.later, color: C.gray400 },
            ]} />
          </Panel>
          <Panel title="Labels by courier" subtitle="Label to generate vs ready to ship">
            {d.by_courier.length ? (
              <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                <thead><tr><th style={{ ...S.th, padding: "8px 6px" }}>Courier</th><th style={{ ...S.th, padding: "8px 6px", textAlign: "right", width: 70 }}>To label</th>
                  <th style={{ ...S.th, padding: "8px 6px", textAlign: "right", width: 60 }}>Ready</th></tr></thead>
                <tbody>{d.by_courier.map((c) => (
                  <tr key={c.courier}><td style={{ ...S.td, padding: "8px 6px", ...ellipsis }} title={c.courier}>{c.courier}</td>
                    <td style={{ ...S.td, padding: "8px 6px", textAlign: "right", fontWeight: c.to_download ? 800 : 400 }}>{num(c.to_download)}</td>
                    <td style={{ ...S.td, padding: "8px 6px", textAlign: "right" }}>{num(c.downloaded)}</td></tr>
                ))}</tbody>
              </table>
            ) : <div style={{ fontSize: 13, color: C.gray500 }}>Nothing accepted waiting to ship.</div>}
          </Panel>
        </div>
      </div>

      <Panel title="By business" subtitle="Open now; shipped and cancelled as far back as Meesho's tabs go">
        <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
            <thead><tr>
              <th style={{ ...S.th, padding: "8px 6px" }}>Business</th>
              {[["to_accept", "Not accepted"], ["to_download", "To label"], ["downloaded", "Ready"], ["shipped", "Shipped"], ["cancelled", "Cancelled"]].map(([k, l]) =>
                <th key={k} style={{ ...S.th, padding: "8px 6px", textAlign: "right" }}>{l}</th>)}
            </tr></thead>
            <tbody>{d.by_business.map((b) => {
              const f = d.fetched.find((x) => x.business === b.business);
              const seen = f ? Object.values(f.tabs).sort()[0] : null;
              return (
                <tr key={b.business}>
                  <td style={{ ...S.td, padding: "8px 6px", fontWeight: 700 }}>{b.business}<div style={{ fontSize: 11.5, color: C.gray400, fontWeight: 500 }}>read {ago(seen)}</div></td>
                  {["to_accept", "to_download", "downloaded", "shipped", "cancelled"].map((k) => <td key={k} style={{ ...S.td, padding: "8px 6px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{num(b[k])}</td>)}
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
