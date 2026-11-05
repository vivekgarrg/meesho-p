import React, { useState, useEffect, useMemo, useCallback } from "react";
import { API, C, S, btn, useIsMobile } from "../../App";
import { CircularProgress } from "@mui/material";
import { Panel, Kpi, BarList, StatusDot, TONE, inr, inrShort, num } from "./MeeshoUI";

/*
 * Meesho → Return analysis. Built on the returns Meesho's own API gives us
 * (kept in the returns table by the sync): how many came back in the last 7 and
 * 30 days, the return rate per parent SKU and SKU, which product comes back for
 * which reason and under which flag (customer return / RTO), what each return
 * cost — and a ranked list of what to do to stop the loss.
 *
 *   top      period switch, the headline numbers
 *   pointers what to do, biggest rupees first
 *   money    what returns cost: reversed sales, return shipping, what finally settled
 *   flags / reasons / couriers   the picture
 *   table    every parent (open it for its SKUs) or every SKU, sortable, filterable by flag
 */

const PERIODS = [7, 30, 60, 90];
const LEVEL = { high: { tone: "bad", label: "Act now" }, medium: { tone: "warn", label: "Watch" }, low: { tone: "info", label: "Note" }, ok: { tone: "good", label: "OK" }, watch: { tone: "neutral", label: "Too few to judge" } };
const pct = (v) => (v == null ? "—" : `${v}%`);
const sign = (n) => (n > 0 ? `+${n}` : `${n}`);

function Change({ change, invert = true }) {
  if (!change) return null;
  const up = change.abs > 0, flat = change.abs === 0;
  const bad = invert ? up : !up;
  const color = flat ? C.gray500 : bad ? C.red : "#15803D";
  return (
    <span style={{ color, fontWeight: 800 }}>
      {flat ? "no change" : `${up ? "▲" : "▼"} ${Math.abs(change.abs)}${change.pct != null ? ` (${sign(change.pct)}%)` : ""}`}
      <span style={{ color: C.gray500, fontWeight: 600 }}> vs before</span>
    </span>
  );
}

function Photo({ url, size = 44 }) {
  const [bad, setBad] = useState(false);
  const box = { width: size, height: size, borderRadius: 8, flexShrink: 0, overflow: "hidden", background: C.gray50, border: `1px solid ${C.gray200}`, display: "flex", alignItems: "center", justifyContent: "center", color: C.gray300 };
  if (!url || bad) return <div style={box} aria-hidden>📦</div>;
  return <div style={box}><img src={url} alt="" loading="lazy" onError={() => setBad(true)} style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>;
}

function RateBadge({ rate, vsAvg }) {
  if (rate == null) return <span style={{ color: C.gray400 }}>—</span>;
  const tone = vsAvg == null ? "neutral" : vsAvg >= 10 ? "bad" : vsAvg > 0 ? "warn" : "good";
  const t = TONE[tone];
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 5, padding: "2px 8px", borderRadius: 999, background: t.soft, color: t.fg, fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>
      {rate}%{vsAvg != null && <span style={{ fontSize: 11, fontWeight: 700 }}>{vsAvg > 0 ? `+${vsAvg}` : vsAvg} vs avg</span>}
    </span>
  );
}

function PointerCard({ p, onPick }) {
  const t = TONE[LEVEL[p.severity]?.tone || "neutral"];
  return (
    <div style={{ ...S.card, padding: 0, display: "flex", overflow: "hidden", border: `1px solid ${C.gray200}` }}>
      <span aria-hidden style={{ width: 6, background: t.accent, flexShrink: 0 }} />
      <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6, minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.05em", color: t.fg, background: t.soft, padding: "2px 8px", borderRadius: 999 }}>{LEVEL[p.severity]?.label}</span>
          {p.amount != null && p.amount > 0 && <span style={{ fontSize: 13, fontWeight: 900, color: C.gray900 }}>{inr(p.amount)} <span style={{ fontWeight: 600, color: C.gray500 }}>{p.amount_label}</span></span>}
        </div>
        <div style={{ fontSize: 14.5, fontWeight: 800, color: C.gray900, lineHeight: 1.35 }}>{p.title}</div>
        {p.detail && <div style={{ fontSize: 13, color: C.gray600, lineHeight: 1.45 }}>{p.detail}</div>}
        <div style={{ fontSize: 13, color: C.gray800, lineHeight: 1.45 }}><b>Do this:</b> {p.action}</div>
        {p.kind === "product" && <button onClick={() => onPick(p.target)} style={{ ...btn("ghost", "sm"), alignSelf: "flex-start", minHeight: 36 }}>Show {p.target} below ↓</button>}
      </div>
    </div>
  );
}

function ReasonChips({ reasons }) {
  if (!reasons?.length) return <span style={{ color: C.gray400, fontSize: 12.5 }}>—</span>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {reasons.map((r) => (
        <span key={r.reason} style={{ fontSize: 12.5, color: C.gray700 }}>
          <b style={{ fontVariantNumeric: "tabular-nums" }}>{r.count}</b> · {r.reason}{r.share != null && <span style={{ color: C.gray400 }}> ({r.share}%)</span>}
        </span>
      ))}
    </div>
  );
}

/** One parent / SKU row (table row on a screen, a card on a phone). */
function Entity({ e, mobile, flag, open, onToggle, children, depth = 0 }) {
  const shown = flag ? (e.flags?.[flag] || 0) : e.returns;
  const lvl = LEVEL[e.action.level] || LEVEL.ok;
  if (mobile) {
    return (
      <div style={{ ...S.card, padding: 12, marginLeft: depth * 10, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Photo url={e.image} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: C.gray900, overflow: "hidden", textOverflow: "ellipsis" }}>{e.label}</div>
            {e.product_name && <div style={{ fontSize: 12, color: C.gray500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.product_name}</div>}
          </div>
          <RateBadge rate={e.rate} vsAvg={e.vs_avg} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, textAlign: "center" }}>
          {[["Returns", shown], ["7 days", e.d7], ["30 days", e.d30], ["Lost", inrShort(e.money.loss)]].map(([l, v]) => (
            <div key={l}><div style={{ fontWeight: 900, fontSize: 16, fontVariantNumeric: "tabular-nums" }}>{v}</div><div style={{ fontSize: 11, color: C.gray500 }}>{l}</div></div>
          ))}
        </div>
        <ReasonChips reasons={e.top_reasons} />
        <div style={{ fontSize: 12.5 }}><StatusDot tone={lvl.tone}>{e.action.title}</StatusDot>{e.action.text && <div style={{ color: C.gray600, marginTop: 2 }}>{e.action.text}</div>}</div>
        {onToggle && <button onClick={onToggle} style={{ ...btn("ghost", "sm"), minHeight: 40 }}>{open ? "Hide SKUs" : "Show SKUs"}</button>}
        {open && children}
      </div>
    );
  }
  return (
    <>
      <tr style={{ background: depth ? C.gray50 : C.white, borderTop: `1px solid ${C.gray100}` }}>
        <td style={{ ...S.td, paddingLeft: 12 + depth * 22 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 220 }}>
            {onToggle && <button onClick={onToggle} aria-expanded={open} aria-label={open ? "Hide SKUs" : "Show SKUs"} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 13, color: C.gray500, width: 22 }}>{open ? "▾" : "▸"}</button>}
            <Photo url={e.image} size={depth ? 34 : 44} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 13.5, color: C.gray900 }}>{e.label}</div>
              {e.product_name && <div style={{ fontSize: 12, color: C.gray500, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.product_name}</div>}
            </div>
          </div>
        </td>
        <td style={{ ...S.td, textAlign: "right", fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>{shown}</td>
        <td style={{ ...S.td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{e.d7}</td>
        <td style={{ ...S.td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{e.d30}</td>
        <td style={{ ...S.td, textAlign: "right", fontVariantNumeric: "tabular-nums", color: C.gray600 }}>{num(e.orders)}</td>
        <td style={{ ...S.td, textAlign: "right" }}><RateBadge rate={e.rate} vsAvg={e.vs_avg} /></td>
        <td style={S.td}><ReasonChips reasons={e.top_reasons} /></td>
        <td style={{ ...S.td, textAlign: "right", fontWeight: 800, fontVariantNumeric: "tabular-nums" }} title={`Reversed ${inr(e.money.refunded)} · return shipping ${inr(e.money.shipping)}`}>{e.money.with_payment ? inr(e.money.loss) : <span style={{ color: C.gray400 }}>no payment yet</span>}</td>
        <td style={{ ...S.td, minWidth: 220 }}>
          <StatusDot tone={lvl.tone}>{e.action.title}</StatusDot>
          {e.action.text && <div style={{ fontSize: 12, color: C.gray600, marginTop: 2, lineHeight: 1.4 }}>{e.action.text}</div>}
          {e.excess_loss > 0 && <div style={{ fontSize: 12, fontWeight: 800, color: C.red, marginTop: 2 }}>Fixing it saves ≈ {inr(e.excess_loss)}</div>}
        </td>
      </tr>
      {open && children}
    </>
  );
}

export function MeeshoReturnAnalysis() {
  const mobile = useIsMobile();
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("parent");        // parent | sku
  const [flag, setFlag] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("loss");
  const [openKeys, setOpenKeys] = useState(() => new Set());

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${API}/meesho-orders/return-analysis/?days=${days}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `Couldn't load (${res.status})`);
      setData(d);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [days]);
  useEffect(() => { load(); }, [load]);

  const sorters = { loss: (a) => -(a.money.loss || 0), returns: (a) => -a.returns, rate: (a) => -(a.rate ?? -1), recent: (a) => -a.d7, saving: (a) => -a.excess_loss };
  const filt = useCallback((list) => {
    const needle = q.trim().toLowerCase();
    return list
      .filter((e) => (!flag || (e.flags?.[flag] || 0) > 0) && (!needle || e.label.toLowerCase().includes(needle) || (e.product_name || "").toLowerCase().includes(needle)))
      .sort((a, b) => sorters[sort](a) - sorters[sort](b) || b.returns - a.returns);
  }, [q, flag, sort]);   // eslint-disable-line react-hooks/exhaustive-deps

  const parents = useMemo(() => filt(data?.parents || []), [data, filt]);
  const skus = useMemo(() => filt(data?.skus || []), [data, filt]);
  const skusOf = useCallback((key) => (data?.skus || []).filter((s) => (s.parent || s.key) === key), [data]);
  const toggle = (k) => setOpenKeys((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const jump = (target) => {
    setView("parent"); setQ(target); setOpenKeys((s) => new Set(s).add(target));
    setTimeout(() => document.getElementById("ra-table")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  if (!data) {
    return error
      ? <div role="alert" style={{ ...S.card, padding: 20, color: C.red, fontWeight: 800 }}>✕ {error} <button onClick={load} style={{ ...btn("ghost", "sm"), marginLeft: 8 }}>Try again</button></div>
      : <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><CircularProgress style={{ color: C.orange }} /></div>;
  }
  const h = data.headline, p = h.picked, m = data.money;
  const rateTone = p.rate == null ? "neutral" : p.rate >= 25 ? "bad" : p.rate >= 15 ? "warn" : "good";
  const noReturns = p.returns === 0 && h.d30.returns === 0;

  const ThCell = ({ children, right, onClick, active }) => (
    <th onClick={onClick} style={{ ...S.th, textAlign: right ? "right" : "left", cursor: onClick ? "pointer" : "default", color: active ? C.orange : undefined, whiteSpace: "nowrap" }}>{children}{active ? " ↓" : ""}</th>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, opacity: loading ? 0.65 : 1, transition: "opacity .15s" }}>
      {/* ── Period ─────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div role="tablist" aria-label="Period" style={{ display: "flex", gap: 4, padding: 4, background: C.gray100, borderRadius: 12 }}>
          {PERIODS.map((d) => (
            <button key={d} role="tab" aria-selected={days === d} onClick={() => setDays(d)}
              style={{ border: "none", cursor: "pointer", fontFamily: "inherit", padding: "9px 16px", borderRadius: 9, minHeight: 40, fontSize: 13.5, fontWeight: days === d ? 800 : 700,
                background: days === d ? C.white : "transparent", color: days === d ? C.gray900 : C.gray600, boxShadow: days === d ? "0 1px 3px rgba(15,23,42,.12)" : "none" }}>
              Last {d} days
            </button>
          ))}
        </div>
        <span style={{ fontSize: 12.5, color: C.gray500 }}>
          {new Date(data.from).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} – {new Date(data.to).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
          {data.businesses.length > 1 ? ` · ${data.businesses.length} businesses combined` : ""}
        </span>
      </div>

      {noReturns && (
        <div style={{ ...S.card, padding: 24, textAlign: "center", color: C.gray600 }}>
          No returns in the last {days} days. Returns appear here as the Meesho sync reads them (every 10 minutes) — check Meesho → Settings if the sync isn't running.
        </div>
      )}

      {/* ── Headline numbers ───────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
        <Kpi label={`Returns · last ${days} days`} value={num(p.returns)} tone="brand" icon="↩"
          sub={<><Change change={p.change} /><br />{p.customer} customer · {p.rto} RTO</>} />
        <Kpi label="Return rate" value={pct(p.rate)} tone={rateTone} icon="％"
          sub={<>of {num(p.orders)} orders shipped in the same days{p.customer_rate != null ? ` · customer returns alone ${p.customer_rate}%` : ""}</>} />
        <Kpi label="Last 7 days" value={num(h.d7.returns)} tone="neutral" icon="7"
          sub={<><Change change={h.d7.change} /><br />{h.d7.customer} customer · {h.d7.rto} RTO · rate {pct(h.d7.rate)}</>} />
        <Kpi label="Last 30 days" value={num(h.d30.returns)} tone="neutral" icon="30"
          sub={<><Change change={h.d30.change} /><br />{h.d30.customer} customer · {h.d30.rto} RTO · rate {pct(h.d30.rate)}</>} />
        <Kpi label="Money lost to returns" value={m.with_payment ? inrShort(m.loss) : "—"} tone={m.loss > 0 ? "bad" : "neutral"} icon="₹"
          sub={m.with_payment ? <>net of what settled · {m.with_payment} of {data.data.of} returns have a payment</> : "Appears once the payments for these returns are synced"} />
      </div>

      {/* ── Stop the loss ──────────────────────────────────────────────── */}
      {data.pointers.length > 0 && (
        <Panel title="How to stop the loss" subtitle="What to do first — the biggest rupees at the top">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))", gap: 12 }}>
            {data.pointers.map((ptr, i) => <PointerCard key={i} p={ptr} onPick={jump} />)}
          </div>
        </Panel>
      )}

      {/* ── Money, flags, reasons, couriers ───────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", gap: 16, alignItems: "start" }}>
        <Panel title="What returns cost" subtitle={`From the payments sheet, for the ${m.with_payment} returns that have settled`}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            {[["Net loss (settled)", m.loss, "bad"], ["Sales reversed", m.refunded, "neutral"], ["Return shipping charged", m.shipping, "warn"], ["Claims paid back", m.claims, "good"]].map(([l, v, t]) => (
              <div key={l}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: C.gray500, textTransform: "uppercase", letterSpacing: "0.04em" }}>{l}</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: TONE[t].fg, fontVariantNumeric: "tabular-nums" }}>{inr(v)}</div>
              </div>
            ))}
          </div>
          {data.open_claims.count > 0 && <div style={{ marginTop: 12, fontSize: 13, color: "#92400E", background: TONE.warn.soft, padding: "8px 10px", borderRadius: 8, fontWeight: 700 }}>⚠ {data.open_claims.count} delivered return{data.open_claims.count === 1 ? "" : "s"} still have no claim raised.</div>}
        </Panel>

        <Panel title="By flag" subtitle="What kind of return Meesho marked it as">
          {data.by_flag.length ? (
            <BarList rows={data.by_flag.map((f) => ({ key: f.flag, label: f.flag, value: f.count, tooltip: `${f.flag}: ${f.count} (${f.share}%) — ${f.previous} in the period before`,
              color: f.flag.startsWith("RTO") ? "#F59E0B" : "#2563EB" }))} />
          ) : <div style={{ color: C.gray500, fontSize: 13 }}>Nothing to show.</div>}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
            {[["", "All flags"], ...data.by_flag.map((f) => [f.flag, f.flag])].map(([k, l]) => (
              <button key={k || "all"} onClick={() => setFlag(k)} aria-pressed={flag === k}
                style={{ ...btn(flag === k ? "primary" : "ghost", "sm"), minHeight: 34, fontSize: 12 }}>{l}</button>
            ))}
          </div>
        </Panel>

        <Panel title="Why customers return" subtitle="Meesho's stated reason · customer returns only">
          {data.by_reason.length ? (
            <BarList rows={data.by_reason.map((r) => ({ key: r.reason, label: r.reason, value: r.count, tooltip: `${r.reason}: ${r.count} (${r.share}%) · ${r.group_label}`, color: "#7C3AED" }))} />
          ) : <div style={{ color: C.gray500, fontSize: 13 }}>No customer returns in this period.</div>}
          {data.by_group.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
              {data.by_group.map((g) => <span key={g.group} style={{ fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: C.gray100, color: C.gray700 }}>{g.label} {g.share}%</span>)}
            </div>
          )}
        </Panel>

        {data.by_courier.length > 0 && (
          <Panel title="RTO by courier" subtitle="Parcels that never reached the buyer">
            <BarList rows={data.by_courier.filter((c) => c.rto).map((c) => ({ key: c.courier, label: c.courier, value: c.rto, tooltip: `${c.courier}: ${c.rto} RTO of ${c.all} returns`, color: "#F59E0B" }))} />
          </Panel>
        )}
      </div>

      {/* ── By product ─────────────────────────────────────────────────── */}
      <section id="ra-table" style={{ ...S.card, padding: 0, overflow: "hidden" }}>
        <header style={{ padding: "14px 16px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", borderBottom: `1px solid ${C.gray100}` }}>
          <div style={{ flex: "1 1 200px" }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: C.gray900 }}>Returns by product</h3>
            <div style={{ fontSize: 12.5, color: C.gray500, marginTop: 2 }}>Rate = returns in the period ÷ orders shipped in the same days. Returns lag orders by a week or so, so compare like with like.</div>
          </div>
          <div role="tablist" aria-label="Group by" style={{ display: "flex", gap: 4, padding: 3, background: C.gray100, borderRadius: 10 }}>
            {[["parent", "By parent SKU"], ["sku", "By SKU"]].map(([k, l]) => (
              <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)}
                style={{ border: "none", cursor: "pointer", fontFamily: "inherit", padding: "7px 14px", borderRadius: 8, minHeight: 38, fontSize: 13, fontWeight: view === k ? 800 : 700,
                  background: view === k ? C.white : "transparent", color: view === k ? C.gray900 : C.gray600 }}>{l}</button>
            ))}
          </div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search product or SKU…" aria-label="Search" style={{ ...S.inp, width: 220, minHeight: 40 }} />
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort by" style={{ ...S.inp, width: "auto", minHeight: 40 }}>
            <option value="loss">Most money lost</option><option value="saving">Biggest saving</option><option value="returns">Most returns</option>
            <option value="rate">Highest return rate</option><option value="recent">Most in last 7 days</option>
          </select>
        </header>
        {flag && <div style={{ padding: "8px 16px", fontSize: 12.5, fontWeight: 700, color: C.gray700, background: C.gray50 }}>Showing only “{flag}” · <button onClick={() => setFlag("")} style={{ border: "none", background: "none", color: C.orange, fontWeight: 800, cursor: "pointer" }}>clear</button></div>}

        {(view === "parent" ? parents : skus).length === 0 ? (
          <div style={{ padding: 36, textAlign: "center", color: C.gray500, fontSize: 14 }}>Nothing matches.</div>
        ) : mobile ? (
          <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            {(view === "parent" ? parents : skus).map((e) => (
              <Entity key={e.key + (e.parent || "")} e={e} mobile flag={flag}
                open={view === "parent" && openKeys.has(e.key)} onToggle={view === "parent" && e.has_parent ? () => toggle(e.key) : undefined}>
                {skusOf(e.key).map((s) => <Entity key={s.key} e={s} mobile flag={flag} depth={1} />)}
              </Entity>
            ))}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  <ThCell>{view === "parent" ? "Parent SKU" : "SKU"}</ThCell>
                  <ThCell right onClick={() => setSort("returns")} active={sort === "returns"}>Returns</ThCell>
                  <ThCell right onClick={() => setSort("recent")} active={sort === "recent"}>7 days</ThCell>
                  <ThCell right>30 days</ThCell>
                  <ThCell right>Orders</ThCell>
                  <ThCell right onClick={() => setSort("rate")} active={sort === "rate"}>Return rate</ThCell>
                  <ThCell>Why (top reasons)</ThCell>
                  <ThCell right onClick={() => setSort("loss")} active={sort === "loss"}>Money lost</ThCell>
                  <ThCell>Verdict</ThCell>
                </tr>
              </thead>
              <tbody>
                {(view === "parent" ? parents : skus).map((e) => (
                  <Entity key={e.key + (e.parent || "")} e={e} flag={flag}
                    open={view === "parent" && openKeys.has(e.key)} onToggle={view === "parent" && e.has_parent ? () => toggle(e.key) : undefined}>
                    {skusOf(e.key).map((s) => <Entity key={s.key} e={s} flag={flag} depth={1} />)}
                  </Entity>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p style={{ fontSize: 12, color: C.gray500, margin: 0, lineHeight: 1.5 }}>
        Returns are the ones Meesho's Returns page lists (read every 10 minutes), by the day each was raised; {data.data.synced} of {data.data.returns_in_range} in range came straight from the sync.
        Money comes from the payments sheet by sub-order — a return with no settled payment yet shows no loss.
      </p>
    </div>
  );
}
