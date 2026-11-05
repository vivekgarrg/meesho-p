import React, { useState, useEffect, useCallback, useMemo } from "react";
import { API, C, S, btn, useIsMobile } from "../../App";
import { CircularProgress } from "@mui/material";
import { Panel, Kpi, BarList, StatusDot, ago, at, dayLabel, num } from "./MeeshoUI";

/*
 * Orders Panel — every Meesho order across the businesses on this desk, as the
 * worker last pulled them: what's still to accept, which labels are still to
 * download, what's downloaded and waiting for pickup, what shipped or was
 * cancelled — and how many orders each dispatch day has.
 *
 * Days turn at the packing-day cutoff (the server's PACKING_DAY_STARTS): an
 * order placed before it ships that day, one after it ships the next day.
 */

// Status → tone and colour. Colour always comes with the word.
const META = {
  to_accept: { tone: "info", color: "#2563EB", label: "To accept" },
  on_hold: { tone: "neutral", color: "#94A3B8", label: "On hold" },
  to_download: { tone: "warn", color: "#F59E0B", label: "Label to download" },
  downloaded: { tone: "brand", color: "#6D28D9", label: "Label downloaded" },
  shipped: { tone: "good", color: "#059669", label: "Shipped" },
  cancelled: { tone: "bad", color: "#E11D48", label: "Cancelled" },
};
const ORDER = ["to_accept", "on_hold", "to_download", "downloaded", "shipped", "cancelled"];
const OPEN = ["to_accept", "on_hold", "to_download", "downloaded"];
const PAGE = 100;

const hourText = (h) => (h === 12 ? "12 pm" : h === 0 ? "12 am" : h > 12 ? `${h - 12} pm` : `${h} am`);
const shortDay = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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

function Chip({ on, onClick, children }) {
  return (
    <button onClick={onClick} aria-pressed={on}
      style={{ padding: "6px 12px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
        border: `1.5px solid ${on ? C.orange : C.gray200}`, background: on ? C.orangeLight : C.white, color: on ? C.orange : C.gray600 }}>
      {children}
    </button>
  );
}

export function OrdersPanelTab() {
  const isMobile = useIsMobile();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("open");     // a status key, "open" or "all"
  const [day, setDay] = useState("all");
  const [biz, setBiz] = useState("all");
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);

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
  useEffect(() => { setShown(PAGE); }, [status, day, biz, q]);

  const rows = useMemo(() => {
    if (!d) return [];
    const needle = q.trim().toLowerCase();
    return d.orders.filter((r) =>
      (status === "all" || (status === "open" ? OPEN.includes(r.status) : r.status === status))
      && (day === "all" || r.ship_day === day)
      && (biz === "all" || String(r.business_id) === biz)
      && (!needle || [r.sku, r.product_name, r.sub_order_num, r.awb, r.courier].some((v) => String(v || "").toLowerCase().includes(needle))));
  }, [d, status, day, biz, q]);

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
  const pick = (s) => { setStatus(s); setDay("all"); document.getElementById("orders-list")?.scrollIntoView({ behavior: "smooth" }); };
  const pickDay = (iso) => { setDay(iso); setStatus("all"); document.getElementById("orders-list")?.scrollIntoView({ behavior: "smooth" }); };
  const windowText = (x) => `orders ${shortDay(addDays(x.date, -1))} ${cut} → ${shortDay(x.date)} ${cut}`;
  const grid = (min) => ({ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${isMobile ? 150 : min}px, 1fr))`, gap: 12 });

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

  const a = d.automation;
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

      {/* What needs doing now */}
      <div style={grid(170)}>
        <Kpi label="To accept" value={num(t.to_accept)} tone="info" active={status === "to_accept"} onClick={() => pick("to_accept")}
          sub={a.enabled && a.accept_every_minutes ? `Auto-accept every ${a.accept_every_minutes} min · next ${at(a.next_accept_at)}` : "Auto-accept is off"} />
        <Kpi label="Labels to download" value={num(t.to_download)} tone="warn" active={status === "to_download"} onClick={() => pick("to_download")}
          sub={a.next_labels_at ? `Next automatic labels ${at(a.next_labels_at)}` : "Accepted, label not downloaded yet"} />
        <Kpi label="Downloaded, to ship" value={num(t.downloaded)} tone="brand" active={status === "downloaded"} onClick={() => pick("downloaded")}
          sub="Label downloaded — waiting for pickup" />
        <Kpi label="Open orders" value={num(t.open)} active={status === "open"} onClick={() => pick("open")}
          sub={`${num(t.quantity_open)} pieces${t.on_hold ? ` · ${num(t.on_hold)} on hold` : ""}`} />
        <Kpi label="SLA breached" value={num(t.breached)} tone={t.breached ? "bad" : "neutral"}
          sub={`${num(t.breaching_soon)} breaching soon`} />
        <Kpi label="Shipped today" value={num(t.shipped)} tone="good" active={status === "shipped"} onClick={() => pick("shipped")}
          sub={`${num(t.cancelled)} cancelled today`} />
      </div>

      {/* Today / tomorrow by the cutoff */}
      <div style={grid(300)}>
        <DayCard iso={today} title="Today" />
        <DayCard iso={tomorrow} title="Tomorrow" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 3fr) minmax(0, 2fr)", gap: 16 }}>
        <Panel title="Orders by dispatch day" subtitle={`Each day is ${cut} to ${cut}; tap a day to see its orders`} action={null}>
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
          <Panel title="Labels by courier" subtitle="Accepted orders: label to download vs downloaded">
            {d.by_courier.length ? (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr><th style={{ ...S.th, padding: "8px 6px" }}>Courier</th><th style={{ ...S.th, padding: "8px 6px", textAlign: "right" }}>To download</th>
                  <th style={{ ...S.th, padding: "8px 6px", textAlign: "right" }}>Downloaded</th></tr></thead>
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

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 2fr) minmax(0, 3fr)", gap: 16 }}>
        <Panel title="By business" subtitle="Open now; shipped and cancelled as far back as Meesho's tabs go">
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={{ ...S.th, padding: "8px 6px" }}>Business</th>
                {["to_accept", "to_download", "downloaded", "shipped", "cancelled"].map((k) => <th key={k} style={{ ...S.th, padding: "8px 6px", textAlign: "right" }}>{META[k].label.replace("Label ", "")}</th>)}
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
        <Panel title="What to pack" subtitle="Open orders by SKU, most pieces first">
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            {d.skus.length ? d.skus.map((k) => (
              <button key={k.sku} onClick={() => { setQ(k.sku); setStatus("open"); setDay("all"); document.getElementById("orders-list")?.scrollIntoView({ behavior: "smooth" }); }}
                style={{ display: "flex", gap: 10, alignItems: "center", width: "100%", padding: "6px 0", border: "none", borderBottom: `1px solid ${C.gray100}`,
                  background: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
                {k.image ? <img src={k.image} alt="" loading="lazy" style={{ width: 36, height: 36, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
                  : <span style={{ width: 36, height: 36, borderRadius: 6, background: C.gray100, flexShrink: 0 }} />}
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 800, color: C.gray900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k.sku}</span>
                  <span style={{ display: "block", fontSize: 12, color: C.gray500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {[k.to_accept && `${k.to_accept} to accept`, k.to_download && `${k.to_download} to download`, k.downloaded && `${k.downloaded} downloaded`, k.on_hold && `${k.on_hold} on hold`].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span style={{ fontSize: 15, fontWeight: 900, color: C.gray900, fontVariantNumeric: "tabular-nums" }}>{num(k.quantity)}</span>
              </button>
            )) : <div style={{ fontSize: 13, color: C.gray500 }}>Nothing open.</div>}
          </div>
        </Panel>
      </div>

      {/* Every order */}
      <Panel title={`Orders · ${num(rows.length)}`} subtitle="Filter by state, dispatch day, business, or search by SKU, sub-order, AWB">
        <div id="orders-list" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Chip on={status === "open"} onClick={() => setStatus("open")}>Open · {num(t.open)}</Chip>
            {ORDER.map((k) => {
              const n = d.orders.filter((r) => r.status === k && (day === "all" || r.ship_day === day)).length;
              return <Chip key={k} on={status === k} onClick={() => setStatus(k)}>{META[k].label} · {num(n)}</Chip>;
            })}
            <Chip on={status === "all"} onClick={() => setStatus("all")}>All</Chip>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select value={day} onChange={(e) => setDay(e.target.value)} aria-label="Dispatch day"
              style={{ padding: "8px 10px", borderRadius: 10, border: `1.5px solid ${C.gray200}`, fontFamily: "inherit", fontSize: 13 }}>
              <option value="all">Every day</option>
              {d.days.map((x) => <option key={x.date} value={x.date}>{dayName(x.date, today)} · {shortDay(x.date)} ({x.total})</option>)}
            </select>
            {d.businesses.length > 1 && (
              <select value={biz} onChange={(e) => setBiz(e.target.value)} aria-label="Business"
                style={{ padding: "8px 10px", borderRadius: 10, border: `1.5px solid ${C.gray200}`, fontFamily: "inherit", fontSize: 13 }}>
                <option value="all">Every business</option>
                {d.businesses.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
              </select>
            )}
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search SKU, product, sub-order, AWB…" aria-label="Search orders"
              style={{ flex: 1, minWidth: 200, padding: "8px 12px", borderRadius: 10, border: `1.5px solid ${C.gray200}`, fontFamily: "inherit", fontSize: 13 }} />
            {(status !== "open" || day !== "all" || biz !== "all" || q) && (
              <button onClick={() => { setStatus("open"); setDay("all"); setBiz("all"); setQ(""); }} style={btn("ghost", "sm")}>Clear</button>
            )}
          </div>

          {!rows.length ? <div style={{ padding: 20, color: C.gray500, fontSize: 13.5 }}>No orders match.</div>
            : isMobile ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {rows.slice(0, shown).map((r) => (
                  <div key={`${r.business_id}-${r.sub_order_num}`} style={{ display: "flex", gap: 10, padding: 10, border: `1px solid ${C.gray200}`, borderRadius: 10 }}>
                    {r.image ? <img src={r.image} alt="" loading="lazy" style={{ width: 52, height: 52, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} /> : null}
                    <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
                      <div style={{ fontWeight: 800, fontSize: 13.5, color: C.gray900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.sku}{r.quantity > 1 ? ` × ${r.quantity}` : ""}</div>
                      <StatusDot tone={META[r.status].tone}>{META[r.status].label}</StatusDot>
                      <div style={{ fontSize: 12, color: C.gray500 }}>
                        {r.business_name} · ships {r.ship_day ? dayName(r.ship_day, today) : "—"}{r.dispatch_by ? ` · due ${shortDay(r.dispatch_by)}` : ""}{r.courier ? ` · ${r.courier}` : ""}
                      </div>
                      <div style={{ fontSize: 11.5, color: C.gray400, wordBreak: "break-all" }}>{r.sub_order_num}{r.awb ? ` · AWB ${r.awb}` : ""}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr>
                    {["Product", "State", "Business", "Ordered", "Ships", "Meesho due", "Courier / AWB", "Sub-order"].map((h) => <th key={h} style={S.th}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {rows.slice(0, shown).map((r) => {
                      const late = OPEN.includes(r.status) && r.dispatch_by && r.dispatch_by < today;
                      return (
                        <tr key={`${r.business_id}-${r.sub_order_num}`}>
                          <td style={{ ...S.td, padding: "8px 12px" }}>
                            <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 220 }}>
                              {r.image ? <img src={r.image} alt="" loading="lazy" style={{ width: 40, height: 40, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} /> : null}
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontWeight: 800, color: C.gray900 }}>{r.sku}{r.quantity > 1 ? ` × ${r.quantity}` : ""}{r.express ? " ⚡" : ""}</div>
                                <div style={{ fontSize: 12, color: C.gray500, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.product_name}>{r.product_name}</div>
                              </div>
                            </div>
                          </td>
                          <td style={{ ...S.td, padding: "8px 12px", whiteSpace: "nowrap" }}><StatusDot tone={META[r.status].tone}>{META[r.status].label}</StatusDot></td>
                          <td style={{ ...S.td, padding: "8px 12px", whiteSpace: "nowrap" }}>{r.business_name}</td>
                          <td style={{ ...S.td, padding: "8px 12px", whiteSpace: "nowrap" }}>{at(r.created_at)}<div style={{ fontSize: 11.5, color: C.gray400 }}>{r.created_at ? shortDay(r.created_at.slice(0, 10)) : ""}</div></td>
                          <td style={{ ...S.td, padding: "8px 12px", whiteSpace: "nowrap", fontWeight: 700 }}>{r.ship_day ? dayName(r.ship_day, today) : "—"}</td>
                          <td style={{ ...S.td, padding: "8px 12px", whiteSpace: "nowrap", color: late ? C.red : undefined, fontWeight: late ? 800 : 400 }}>
                            {r.dispatch_by ? shortDay(r.dispatch_by) : "—"}{late ? " · overdue" : ""}</td>
                          <td style={{ ...S.td, padding: "8px 12px", whiteSpace: "nowrap" }}>{r.courier || "—"}<div style={{ fontSize: 11.5, color: C.gray400 }}>{r.awb || ""}</div></td>
                          <td style={{ ...S.td, padding: "8px 12px", whiteSpace: "nowrap", fontSize: 12, color: C.gray500 }}>{r.sub_order_num}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          {rows.length > shown && (
            <button onClick={() => setShown((n) => n + PAGE * 3)} style={{ ...btn("ghost", "sm"), alignSelf: "center" }}>
              Show more ({num(rows.length - shown)} left)</button>
          )}
        </div>
      </Panel>
    </div>
  );
}
