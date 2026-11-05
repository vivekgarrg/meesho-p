import React, { useState, useEffect, useCallback, useMemo } from "react";
import { API, C, S, btn, Tag, useIsMobile } from "../../App";
import { CircularProgress } from "@mui/material";
import { Panel, Kpi, BarList, StatusDot, ago, at, dayLabel, num } from "./MeeshoUI";
import { ParentLinkButton } from "./ParentLink";

/*
 * Orders Panel — every Meesho order across the businesses on this desk, as the
 * worker last pulled them, in tabs like the Meesho supplier panel:
 *
 *   Pending        accepted, label not generated yet (orders not accepted yet on request)
 *   Ready to ship  label downloaded, waiting for pickup
 *   Shipped
 *   Cancelled
 *
 * Each tab lists orders one by one, or grouped by parent SKU (SKU Pricing) —
 * a SKU with no parent stands on its own, with a button to link it.
 *
 * Days turn at the packing-day cutoff (the server's PACKING_DAY_STARTS): an
 * order placed before it ships that day, one after it ships the next day.
 */

// Status → tone and colour. Colour always comes with the word.
const META = {
  to_accept: { tone: "info", color: "#2563EB", label: "Not accepted yet" },
  on_hold: { tone: "neutral", color: "#94A3B8", label: "On hold" },
  to_download: { tone: "warn", color: "#F59E0B", label: "Label to download" },
  downloaded: { tone: "brand", color: "#6D28D9", label: "Label downloaded" },
  shipped: { tone: "good", color: "#059669", label: "Shipped" },
  cancelled: { tone: "bad", color: "#E11D48", label: "Cancelled" },
};
const ORDER = ["to_accept", "on_hold", "to_download", "downloaded", "shipped", "cancelled"];
const OPEN = ["to_accept", "on_hold", "to_download", "downloaded"];
const TABS = [
  { key: "pending", label: "Pending", hint: "Accepted — label not generated yet", statuses: ["to_download"] },
  { key: "ready", label: "Ready to Ship", hint: "Label downloaded — waiting for pickup", statuses: ["downloaded"] },
  { key: "shipped", label: "Shipped", hint: "Picked up — last 7 days", statuses: ["shipped"] },
  { key: "cancelled", label: "Cancelled", hint: "Last 7 days", statuses: ["cancelled"] },
];
const PAGE = 100;

const hourText = (h) => (h === 12 ? "12 pm" : h === 0 ? "12 am" : h > 12 ? `${h - 12} pm` : `${h} am`);
const shortDay = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
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

/** One stacked bar: each status a segment, 2px gaps, hover names the segment. */
function StackBar({ day, max }) {
  const [hover, setHover] = useState(null);
  const parts = ORDER.filter((k) => day[k] > 0);
  return (
    <div style={{ display: "flex", gap: 2, height: 12, width: `${Math.max(day.total ? 4 : 0, (100 * day.total) / max)}%`, minWidth: day.total ? 6 : 0 }}>
      {parts.map((k, i) => (
        <span key={k} title={`${META[k].label}: ${day[k]}`} onMouseEnter={() => setHover(k)} onMouseLeave={() => setHover(null)}
          style={{ flex: day[k], background: META[k].color, opacity: hover && hover !== k ? 0.5 : 1,
            borderRadius: `${i === 0 ? 4 : 0}px ${i === parts.length - 1 ? 4 : 0}px ${i === parts.length - 1 ? 4 : 0}px ${i === 0 ? 4 : 0}px`,
            transition: "opacity .15s" }} />
      ))}
    </div>
  );
}

function Legend() {
  return (
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
      {ORDER.map((k) => (
        <span key={k} style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12, color: C.gray600, fontWeight: 600 }}>
          <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: META[k].color }} />{META[k].label}
        </span>
      ))}
    </div>
  );
}

/** An on/off switch with its words. */
function Switch({ on, onChange, label }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => onChange(!on)}
      style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit",
        fontSize: 13, fontWeight: 800, color: on ? C.orange : C.gray600, padding: "4px 0" }}>
      <span aria-hidden style={{ width: 34, height: 20, borderRadius: 999, background: on ? C.orange : C.gray300, position: "relative", transition: "background .15s", flexShrink: 0 }}>
        <span style={{ position: "absolute", top: 2, left: on ? 16 : 2, width: 16, height: 16, borderRadius: 999, background: C.white, transition: "left .15s",
          boxShadow: "0 1px 2px rgba(0,0,0,.25)" }} />
      </span>
      {label}
    </button>
  );
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
  ? <img src={src} alt="" loading="lazy" style={{ width: size, height: size, borderRadius: 8, objectFit: "cover", flexShrink: 0, border: `1px solid ${C.gray100}` }} />
  : <span aria-hidden style={{ width: size, height: size, borderRadius: 8, background: C.gray100, flexShrink: 0 }} />);

/** The orders, one per row — like the Meesho panel's order list. */
function OrderTable({ rows, today, isMobile }) {
  if (isMobile) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((r) => (
          <div key={`${r.business_id}-${r.sub_order_num}`} style={{ display: "flex", gap: 10, padding: 10, border: `1px solid ${C.gray200}`, borderRadius: 10, background: C.white }}>
            <Img src={r.image} size={56} />
            <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
              <div style={{ fontWeight: 800, fontSize: 13.5, color: C.gray900, wordBreak: "break-all" }}>{r.sku}{r.quantity > 1 ? ` × ${r.quantity}` : ""}</div>
              <div style={{ fontSize: 12, color: C.gray500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.product_name}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <StatusDot tone={META[r.status].tone}>{META[r.status].label}</StatusDot><Sla r={r} today={today} />
              </div>
              <div style={{ fontSize: 12, color: C.gray500 }}>
                {r.business_name} · ships {r.ship_day ? dayName(r.ship_day, today) : "—"}{r.dispatch_by ? ` · due ${shortDay(r.dispatch_by)}` : ""}{r.courier ? ` · ${r.courier}` : ""}
              </div>
              <div style={{ fontSize: 11.5, color: C.gray400, wordBreak: "break-all" }}>{r.sub_order_num}{r.awb ? ` · AWB ${r.awb}` : ""}</div>
            </div>
          </div>
        ))}
      </div>
    );
  }
  const th = { ...S.th, padding: "10px 12px" };
  const td = { ...S.td, padding: "10px 12px", verticalAlign: "top" };
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>
          {["Product details", "Order", "Business", "Ordered on", "Dispatch", "Courier / AWB"].map((h) => <th key={h} style={th}>{h}</th>)}
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.business_id}-${r.sub_order_num}`}>
              <td style={td}>
                <div style={{ display: "flex", gap: 10, minWidth: 260 }}>
                  <Img src={r.image} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: C.gray800, fontWeight: 600, maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.product_name}>{r.product_name || "—"}</div>
                    <div style={{ fontSize: 12, color: C.gray500, marginTop: 2 }}>
                      SKU <b style={{ color: C.gray800 }}>{r.sku}</b>{r.variation ? ` · ${r.variation}` : ""} · Qty <b style={{ color: C.gray800 }}>{r.quantity}</b>{r.express ? " · ⚡ Express" : ""}
                    </div>
                    {r.parent && r.parent.toLowerCase() !== String(r.sku).toLowerCase() && <div style={{ fontSize: 11.5, color: C.gray400, marginTop: 2 }}>Parent {r.parent}</div>}
                  </div>
                </div>
              </td>
              <td style={{ ...td, whiteSpace: "nowrap", fontSize: 12.5 }}>
                <div style={{ color: C.gray800, fontWeight: 600 }}>{r.sub_order_num}</div>
                <div style={{ marginTop: 4 }}><StatusDot tone={META[r.status].tone}>{META[r.status].label}</StatusDot></div>
              </td>
              <td style={{ ...td, whiteSpace: "nowrap" }}>{r.business_name}</td>
              <td style={{ ...td, whiteSpace: "nowrap" }}>{r.created_at ? shortDay(r.created_at.slice(0, 10)) : "—"}
                <div style={{ fontSize: 11.5, color: C.gray400 }}>{r.created_at ? new Date(r.created_at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : ""}</div></td>
              <td style={{ ...td, whiteSpace: "nowrap" }}>
                <div style={{ fontWeight: 700, color: C.gray800 }}>Ships {r.ship_day ? dayName(r.ship_day, today) : "—"}</div>
                <div style={{ fontSize: 11.5, color: C.gray500 }}>{r.dispatch_by ? `Meesho due ${shortDay(r.dispatch_by)}` : ""}</div>
                <div style={{ marginTop: 3 }}><Sla r={r} today={today} /></div>
              </td>
              <td style={{ ...td, whiteSpace: "nowrap" }}>{r.courier || "—"}<div style={{ fontSize: 11.5, color: C.gray400 }}>{r.awb || ""}</div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Orders grouped by parent SKU: one row per parent (a SKU with no parent on its own), its orders underneath. */
function ParentGroups({ rows, today, isMobile, canLink, businesses, onLinked }) {
  const [open, setOpen] = useState({});
  const groups = useMemo(() => {
    const acc = {};
    for (const r of rows) {
      const name = r.parent || r.sku || "—";
      const k = `${r.parent ? "p" : "s"}|${name.toLowerCase()}`;
      const g = acc[k] || (acc[k] = { key: k, parent: r.parent, name, orders: [], qty: 0, skus: {}, biz: {}, image: r.image, product: r.product_name });
      g.orders.push(r); g.qty += r.quantity;
      g.skus[r.sku] = (g.skus[r.sku] || 0) + r.quantity;
      g.biz[r.business_id] = (g.biz[r.business_id] || 0) + 1;
      g.image = g.image || r.image;
    }
    return Object.values(acc).sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));
  }, [rows]);
  const nameOf = (id) => businesses.find((b) => String(b.id) === String(id))?.name || "";
  const loose = groups.filter((g) => !g.parent).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 12.5, color: C.gray500 }}>
        {num(groups.length - loose)} parent{groups.length - loose === 1 ? "" : "s"}{loose ? ` · ${num(loose)} SKU${loose === 1 ? "" : "s"} with no parent on SKU Pricing` : ""} · tap one to see its orders
      </div>
      {groups.map((g) => {
        const isOpen = !!open[g.key];
        const skuList = Object.entries(g.skus).sort((a, b) => b[1] - a[1]);
        const linkable = !g.parent ? Object.keys(g.biz).filter((id) => canLink.has(Number(id))) : [];
        return (
          <div key={g.key} style={{ border: `1px solid ${isOpen ? C.orangeBorder : C.gray200}`, borderRadius: 12, overflow: "hidden", background: C.white }}>
            <div role="button" tabIndex={0} aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [g.key]: !o[g.key] }))}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((o) => ({ ...o, [g.key]: !o[g.key] })); } }}
              style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 12px", cursor: "pointer", flexWrap: isMobile ? "wrap" : "nowrap",
                background: isOpen ? C.orangeLight : C.white }}>
              <span aria-hidden style={{ color: C.gray400, fontSize: 12, width: 10 }}>{isOpen ? "▾" : "▸"}</span>
              <Img src={g.image} size={48} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 900, fontSize: 14.5, color: C.gray900, wordBreak: "break-all" }}>{g.name}</span>
                  {!g.parent && <Tag variant="amber">No parent</Tag>}
                </div>
                <div style={{ fontSize: 12, color: C.gray500, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: isMobile ? "normal" : "nowrap" }}>
                  {g.parent ? skuList.map(([k, n]) => `${k} ×${n}`).join(" · ") : g.product}
                </div>
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
              <div style={{ display: "flex", gap: 18, flexShrink: 0, textAlign: "right" }}>
                <div><div style={{ fontSize: 20, fontWeight: 900, color: C.gray900, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{num(g.orders.length)}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.gray500 }}>orders</div></div>
                <div><div style={{ fontSize: 20, fontWeight: 900, color: C.gray900, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{num(g.qty)}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.gray500 }}>pieces</div></div>
              </div>
            </div>
            {isOpen && <div style={{ borderTop: `1px solid ${C.gray100}`, padding: isMobile ? 8 : 0 }}><OrderTable rows={g.orders} today={today} isMobile={isMobile} /></div>}
          </div>
        );
      })}
    </div>
  );
}

export function OrdersPanelTab() {
  const isMobile = useIsMobile();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTabState] = useState(() => store.get("orders_panel_tab", "pending"));
  const [grouped, setGroupedState] = useState(() => store.get("orders_panel_grouped", "1") === "1");
  const [withUnaccepted, setWithUnaccepted] = useState(false);
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
  useEffect(() => { setShown(PAGE); }, [tab, day, biz, q, grouped, withUnaccepted]);

  const current = TABS.find((t) => t.key === tab) || TABS[0];
  const statuses = tab === "pending" && withUnaccepted ? ["to_accept", "on_hold", ...current.statuses] : current.statuses;
  const base = useMemo(() => (d ? d.orders.filter((r) => (day === "all" || r.ship_day === day) && (biz === "all" || String(r.business_id) === biz)) : []), [d, day, biz]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return base.filter((r) => statuses.includes(r.status)
      && (!needle || [r.sku, r.parent, r.product_name, r.sub_order_num, r.awb, r.courier].some((v) => String(v || "").toLowerCase().includes(needle))));
  }, [base, statuses.join(","), q]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!d) {
    return err ? <div role="alert" style={{ ...S.card, color: C.red, fontWeight: 700 }}>✕ {err} <button onClick={load} style={btn("ghost", "sm")}>Try again</button></div>
      : <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><CircularProgress style={{ color: C.orange }} /></div>;
  }

  const t = d.totals;
  const cut = hourText(d.cutoff_hour);
  const today = d.today;
  const tomorrow = addDays(today, 1);
  const byDate = Object.fromEntries(d.days.map((x) => [x.date, x]));
  const stale = d.updated_at && Date.now() - new Date(d.updated_at) > 45 * 60000;
  const maxDay = Math.max(1, ...d.days.map((x) => x.total));
  const canLink = new Set(d.can_link || []);
  const countOf = (k) => base.filter((r) => k.includes(r.status)).length;
  const unaccepted = countOf(["to_accept", "on_hold"]);
  const goTab = (k) => { setTab(k); document.getElementById("orders-tabs")?.scrollIntoView({ behavior: "smooth" }); };
  const pickDay = (iso) => { setDay(iso); document.getElementById("orders-tabs")?.scrollIntoView({ behavior: "smooth" }); };
  const windowText = (x) => `orders ${shortDay(addDays(x.date, -1))} ${cut} → ${shortDay(x.date)} ${cut}`;
  const grid = (min) => ({ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${isMobile ? 150 : min}px, 1fr))`, gap: 12 });
  const a = d.automation;
  const sel = { padding: "8px 10px", borderRadius: 10, border: `1.5px solid ${C.gray200}`, fontFamily: "inherit", fontSize: 13, background: C.white };

  const DayCard = ({ iso, title }) => {
    const x = byDate[iso] || { date: iso, total: 0, quantity: 0 };
    return (
      <button onClick={() => pickDay(iso)} style={{ ...S.card, padding: "14px 16px", textAlign: "left", fontFamily: "inherit", cursor: "pointer",
        border: `${day === iso ? 2 : 1}px solid ${day === iso ? C.orange : C.gray200}`, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
          <span style={{ fontWeight: 900, fontSize: 15, color: C.gray900 }}>{title} <span style={{ fontWeight: 600, color: C.gray500, fontSize: 12.5 }}>· ships {dayLabel(iso)}</span></span>
          <span style={{ fontSize: 28, fontWeight: 900, fontVariantNumeric: "tabular-nums", color: C.gray900 }}>{num(x.total)}</span>
        </div>
        <div style={{ fontSize: 12, color: C.gray500 }}>{windowText(x)}{x.quantity && x.quantity !== x.total ? ` · ${num(x.quantity)} pieces` : ""}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
          {ORDER.filter((k) => x[k]).map((k) => <StatusDot key={k} tone={META[k].tone}>{num(x[k])} {META[k].label.toLowerCase()}</StatusDot>)}
          {!x.total && <span style={{ fontSize: 12.5, color: C.gray400 }}>No orders yet</span>}
        </div>
        {(x.by_business || []).length > 1 && (
          <div style={{ fontSize: 12, color: C.gray500 }}>{x.by_business.map((b) => `${b.business} ${b.count}`).join(" · ")}</div>
        )}
      </button>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1280 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap", justifyContent: "space-between" }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: C.gray900, margin: 0 }}>Orders Panel</h1>
          <p style={{ fontSize: 13, color: C.gray500, margin: "4px 0 0" }}>
            Every Meesho order across {d.businesses.length === 1 ? d.businesses[0].name : `${d.businesses.length} businesses`} ·
            days turn at {cut}: ordered before {cut} ships that day, after {cut} ships the next · read from Meesho {ago(d.updated_at)}
          </p>
        </div>
        <button onClick={load} disabled={loading} style={btn("ghost", "sm")}>
          {loading ? <CircularProgress size={13} style={{ color: C.orange }} /> : "↻ Refresh"}</button>
      </div>

      {err && <div role="alert" style={{ color: C.red, fontWeight: 700, fontSize: 13.5 }}>✕ {err}</div>}
      {stale && (
        <div role="status" style={{ ...S.card, padding: "10px 14px", background: C.amberLight, borderColor: C.amberBorder, color: "#92400E", fontSize: 13, fontWeight: 600 }}>
          ⚠ These orders were last read from Meesho {ago(d.updated_at)} ({at(d.updated_at)}). Counts may be behind — check the sync on Meesho Settings.
        </div>
      )}

      <div style={grid(170)}>
        <Kpi label="Pending — label to generate" value={num(t.to_download)} tone="warn" active={tab === "pending"} onClick={() => goTab("pending")}
          sub={a.next_labels_at ? `Next automatic labels ${at(a.next_labels_at)}` : "Accepted, label not generated yet"} />
        <Kpi label="Ready to ship" value={num(t.downloaded)} tone="brand" active={tab === "ready"} onClick={() => goTab("ready")}
          sub="Label downloaded — waiting for pickup" />
        <Kpi label="Not accepted yet" value={num(t.to_accept + t.on_hold)} tone="info"
          onClick={() => { setWithUnaccepted(true); goTab("pending"); }}
          sub={a.enabled && a.accept_every_minutes ? `Auto-accept every ${a.accept_every_minutes} min · next ${at(a.next_accept_at)}` : "Auto-accept is off"} />
        <Kpi label="SLA breached" value={num(t.breached)} tone={t.breached ? "bad" : "neutral"} sub={`${num(t.breaching_soon)} breaching soon`} />
        <Kpi label="Shipped today" value={num(t.shipped)} tone="good" active={tab === "shipped"} onClick={() => goTab("shipped")}
          sub={`${num(t.cancelled)} cancelled today`} />
      </div>

      <div style={grid(300)}>
        <DayCard iso={today} title="Today" />
        <DayCard iso={tomorrow} title="Tomorrow" />
      </div>

      {/* The orders, in the Meesho panel's tabs */}
      <section id="orders-tabs" style={{ ...S.card, padding: 0, overflow: "hidden" }}>
        <div role="tablist" aria-label="Order status" style={{ display: "flex", borderBottom: `1px solid ${C.gray200}`, overflowX: "auto" }}>
          {TABS.map((x) => {
            const on = x.key === tab;
            const n = countOf(x.statuses);
            return (
              <button key={x.key} role="tab" aria-selected={on} onClick={() => setTab(x.key)}
                style={{ flex: isMobile ? "0 0 auto" : 1, padding: isMobile ? "12px 14px" : "14px 16px", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit",
                  borderBottom: `3px solid ${on ? C.orange : "transparent"}`, color: on ? C.orange : C.gray600, fontWeight: on ? 900 : 700, fontSize: 14, whiteSpace: "nowrap" }}>
                {x.label} <span style={{ marginLeft: 4, padding: "1px 8px", borderRadius: 999, fontSize: 12, fontWeight: 800,
                  background: on ? C.orange : C.gray100, color: on ? C.white : C.gray600 }}>{num(n)}</span>
              </button>
            );
          })}
        </div>

        <div style={{ padding: isMobile ? 12 : 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 12.5, color: C.gray500 }}>{current.hint}{day !== "all" ? ` · ships ${dayName(day, today)}` : ""}</div>
          {tab === "pending" && unaccepted > 0 && (
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "8px 12px", borderRadius: 10, background: "#EFF6FF", color: "#1E3A8A", fontSize: 13 }}>
              <span>ℹ {num(unaccepted)} order{unaccepted === 1 ? " isn't" : "s aren't"} accepted yet{a.enabled && a.next_accept_at ? ` — auto-accept next ${at(a.next_accept_at)}` : ""}.</span>
              <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontWeight: 700, cursor: "pointer" }}>
                <input type="checkbox" checked={withUnaccepted} onChange={(e) => setWithUnaccepted(e.target.checked)} /> Show them here too
              </label>
            </div>
          )}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <Switch on={grouped} onChange={setGrouped} label="Group by parent SKU" />
            <select value={day} onChange={(e) => setDay(e.target.value)} aria-label="Dispatch day" style={sel}>
              <option value="all">Every day</option>
              {d.days.map((x) => <option key={x.date} value={x.date}>Ships {dayName(x.date, today)} · {shortDay(x.date)} ({x.total})</option>)}
            </select>
            {d.businesses.length > 1 && (
              <select value={biz} onChange={(e) => setBiz(e.target.value)} aria-label="Business" style={sel}>
                <option value="all">Every business</option>
                {d.businesses.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
              </select>
            )}
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search SKU, parent, product, sub-order, AWB…" aria-label="Search orders"
              style={{ ...sel, flex: 1, minWidth: 200, padding: "8px 12px" }} />
            {(day !== "all" || biz !== "all" || q) && (
              <button onClick={() => { setDay("all"); setBiz("all"); setQ(""); }} style={btn("ghost", "sm")}>Clear</button>
            )}
          </div>

          {!rows.length ? <div style={{ padding: "28px 8px", textAlign: "center", color: C.gray500, fontSize: 13.5 }}>No orders here.</div>
            : grouped ? <ParentGroups rows={rows} today={today} isMobile={isMobile} canLink={canLink} businesses={d.businesses} onLinked={load} />
              : (
                <>
                  <div style={{ fontSize: 12.5, color: C.gray500 }}>{num(rows.length)} orders · {num(rows.reduce((n, r) => n + r.quantity, 0))} pieces</div>
                  <OrderTable rows={rows.slice(0, shown)} today={today} isMobile={isMobile} />
                  {rows.length > shown && (
                    <button onClick={() => setShown((n) => n + PAGE * 3)} style={{ ...btn("ghost", "sm"), alignSelf: "center" }}>
                      Show more ({num(rows.length - shown)} left)</button>
                  )}
                </>
              )}
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 3fr) minmax(0, 2fr)", gap: 16 }}>
        <Panel title="Orders by dispatch day" subtitle={`Each day is ${cut} to ${cut}; tap a day to filter the tabs`}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Legend />
            <div role="table" style={{ display: "flex", flexDirection: "column" }}>
              {d.days.map((x) => (
                <button key={x.date} role="row" onClick={() => pickDay(x.date)} title={windowText(x)}
                  style={{ display: "grid", gridTemplateColumns: isMobile ? "84px 1fr 40px" : "120px 1fr 48px", gap: 10, alignItems: "center",
                    padding: "7px 6px", border: "none", borderBottom: `1px solid ${C.gray100}`, background: day === x.date ? C.orangeLight : "transparent",
                    cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: C.gray700 }}>
                    {dayName(x.date, today)}{[today, tomorrow, addDays(today, -1)].includes(x.date) && !isMobile ? <span style={{ color: C.gray400, fontWeight: 600 }}> · {shortDay(x.date)}</span> : null}
                  </span>
                  <StackBar day={x} max={maxDay} />
                  <span style={{ fontSize: 13, fontWeight: 800, color: C.gray900, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{num(x.total)}</span>
                </button>
              ))}
            </div>
          </div>
        </Panel>

        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <Panel title="Meesho dispatch deadline" subtitle="Open orders by the dispatch-by date Meesho gives">
            <BarList rows={[
              { label: "Overdue", value: d.due.overdue, color: C.red },
              { label: "Due today", value: d.due.today, color: "#F59E0B" },
              { label: "Due tomorrow", value: d.due.tomorrow, color: "#2563EB" },
              { label: "Later", value: d.due.later, color: C.gray400 },
            ]} />
          </Panel>
          <Panel title="Labels by courier" subtitle="Pending (label to generate) vs ready to ship">
            {d.by_courier.length ? (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr><th style={{ ...S.th, padding: "8px 6px" }}>Courier</th><th style={{ ...S.th, padding: "8px 6px", textAlign: "right" }}>Pending</th>
                  <th style={{ ...S.th, padding: "8px 6px", textAlign: "right" }}>Ready</th></tr></thead>
                <tbody>{d.by_courier.map((c) => (
                  <tr key={c.courier}><td style={{ ...S.td, padding: "8px 6px" }}>{c.courier}</td>
                    <td style={{ ...S.td, padding: "8px 6px", textAlign: "right", fontWeight: c.to_download ? 800 : 400 }}>{num(c.to_download)}</td>
                    <td style={{ ...S.td, padding: "8px 6px", textAlign: "right" }}>{num(c.downloaded)}</td></tr>
                ))}</tbody>
              </table>
            ) : <div style={{ fontSize: 13, color: C.gray500 }}>Nothing accepted waiting to ship.</div>}
          </Panel>
        </div>
      </div>

      <Panel title="By business" subtitle="Open now; shipped and cancelled as far back as Meesho's tabs go">
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={{ ...S.th, padding: "8px 6px" }}>Business</th>
              {[["to_accept", "Not accepted"], ["to_download", "Pending"], ["downloaded", "Ready to ship"], ["shipped", "Shipped"], ["cancelled", "Cancelled"]].map(([k, l]) =>
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
