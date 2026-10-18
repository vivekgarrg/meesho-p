import React, { useEffect, useRef, useState } from "react";
import CircularProgress from "@mui/material/CircularProgress";
import { API, C, S, fmt } from "../../App";

/**
 * The money and AI sections of Business Insights: the Claude write-up (and
 * questions), rejected-claim losses from the claims sheet, and the payment
 * checks. Numbers come from meesho_app/insights_money.py and insights_ai.py.
 */

const fmtDay = (iso) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }) : "—");
const pct = (v) => (v == null ? "—" : `${v}%`);
const num = (v) => (v == null ? "—" : Number(v).toLocaleString("en-IN"));

const cardTitle = { fontSize: 11, fontWeight: 700, color: C.gray500, letterSpacing: "0.07em", textTransform: "uppercase" };
const chip = (color, bg) => ({ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase",
  color, background: bg, borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" });

function Tile({ label, value, sub, color = C.gray800 }) {
  return (
    <div style={{ background: C.gray50, borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, color: C.gray400, letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</span>
      <span style={{ fontSize: 18, fontWeight: 800, color, fontFamily: "monospace" }}>{value}</span>
      {sub && <span style={{ fontSize: 11, color: C.gray400 }}>{sub}</span>}
    </div>
  );
}

function SubTabs({ tabs, active, onChange }) {
  return (
    <div style={{ display: "flex", gap: 4, overflowX: "auto", borderBottom: `1px solid ${C.gray100}` }}>
      {tabs.map((t) => (
        <button key={t.key} onClick={() => onChange(t.key)}
          style={{ fontSize: 12.5, fontWeight: 700, padding: "8px 12px", whiteSpace: "nowrap", cursor: "pointer", border: "none",
            background: "none", borderBottom: `2px solid ${active === t.key ? C.orange : "transparent"}`,
            color: active === t.key ? C.orange : C.gray500 }}>
          {t.label}{t.n != null && <span style={{ color: C.gray400, fontWeight: 600 }}> {t.n}</span>}
        </button>
      ))}
    </div>
  );
}

/** A plain table from column definitions: [{ key, label, money?, pct?, date?, wrap? }]. */
function Table({ rows, cols, empty = "Nothing here." }) {
  if (!rows?.length) return <p style={{ padding: 20, textAlign: "center", color: C.gray400, fontSize: 13 }}>{empty}</p>;
  const cell = (r, c) => {
    const v = r[c.key];
    if (c.render) return c.render(r);
    if (c.money) return <span style={{ fontFamily: "monospace", color: v < 0 ? C.red : C.gray800 }}>{v == null ? "—" : fmt(v)}</span>;
    if (c.pct) return pct(v);
    if (c.date) return fmtDay(v);
    return v == null || v === "" ? "—" : typeof v === "number" ? num(v) : String(v);
  };
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead>
          <tr>{cols.map((c, i) => <th key={c.key} style={{ ...S.th, textAlign: i ? "right" : "left", whiteSpace: "nowrap" }}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={idx} style={{ background: idx % 2 ? C.gray50 : C.white }}>
              {cols.map((c, i) => (
                <td key={c.key} style={{ ...S.td, textAlign: i ? "right" : "left", whiteSpace: c.wrap ? "normal" : "nowrap",
                  maxWidth: c.wrap ? 320 : undefined, wordBreak: c.wrap ? "break-word" : undefined, fontWeight: i ? 400 : 700 }}>
                  {cell(r, c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── AI ───────────────────────────────────────────────────────────────────────

const VERDICT = {
  healthy: { label: "Healthy", color: C.green, bg: C.greenLight },
  watch:   { label: "Watch", color: C.amber, bg: C.amberLight },
  at_risk: { label: "At risk", color: C.red, bg: C.redLight },
};
const URGENCY = { today: ["Today", C.red, C.redLight], this_week: ["This week", C.amber, C.amberLight], this_month: ["This month", C.blue, C.blueLight] };

function Section({ title, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <p style={cardTitle}>{title}</p>
      {children}
    </div>
  );
}

function AIReport({ report }) {
  const v = VERDICT[report.verdict?.status] || VERDICT.watch;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ background: v.bg, borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ ...chip(v.color, C.white), alignSelf: "flex-start" }}>{v.label}</span>
        <p style={{ fontSize: 15.5, fontWeight: 800, color: C.gray800 }}>{report.verdict?.headline}</p>
        <p style={{ fontSize: 13, color: C.gray700, lineHeight: 1.55 }}>{report.verdict?.summary}</p>
      </div>

      {report.priorities?.length > 0 && (
        <Section title="Do these first">
          <ol style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
            {report.priorities.map((p, i) => {
              const [ul, uc, ub] = URGENCY[p.urgency] || URGENCY.this_week;
              return (
                <li key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <span style={{ flex: "0 0 26px", height: 26, borderRadius: 999, background: C.orangeLight, color: C.orange,
                    fontWeight: 800, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 13.5, fontWeight: 800, color: C.gray800 }}>{p.title}</span>
                      <span style={chip(uc, ub)}>{ul}</span>
                      {p.impact_rupees > 0 && <span style={{ fontSize: 12, fontWeight: 700, color: C.green }}>≈ {fmt(p.impact_rupees)}</span>}
                    </div>
                    <p style={{ fontSize: 12.5, color: C.gray600, lineHeight: 1.5 }}>{p.detail}</p>
                    {p.skus?.length > 0 && <p style={{ fontSize: 11, color: C.gray400, wordBreak: "break-word" }}>{p.skus.join(" · ")}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        </Section>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: 16 }}>
        {report.patterns?.length > 0 && (
          <Section title="Patterns the AI spotted">
            {report.patterns.map((p, i) => (
              <div key={i} style={{ fontSize: 12.5, lineHeight: 1.5 }}><b style={{ color: C.gray800 }}>{p.title}.</b> <span style={{ color: C.gray600 }}>{p.detail}</span></div>
            ))}
          </Section>
        )}
        {report.payment_findings?.length > 0 && (
          <Section title="Payments">
            {report.payment_findings.map((p, i) => (
              <div key={i} style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                <b style={{ color: C.gray800 }}>{p.title}.</b> <span style={{ color: C.gray600 }}>{p.detail}</span>
                <div style={{ color: C.gray700 }}><b>Do:</b> {p.what_to_do}</div>
              </div>
            ))}
          </Section>
        )}
        {report.claims_view && (
          <Section title="Claims">
            <p style={{ fontSize: 12.5, color: C.gray600, lineHeight: 1.5 }}>{report.claims_view}</p>
          </Section>
        )}
        {report.growth_ideas?.length > 0 && (
          <Section title="Ways to grow">
            {report.growth_ideas.map((g, i) => (
              <div key={i} style={{ fontSize: 12.5, lineHeight: 1.5 }}><b style={{ color: C.gray800 }}>{g.title}.</b> <span style={{ color: C.gray600 }}>{g.detail}</span></div>
            ))}
          </Section>
        )}
        {report.watch_next?.length > 0 && (
          <Section title="Check again next week">
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: C.gray600, lineHeight: 1.6 }}>
              {report.watch_next.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </Section>
        )}
      </div>
    </div>
  );
}

function AskBox({ params }) {
  const [q, setQ] = useState("");
  const [chat, setChat] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const examples = ["Why did my profit change vs last period?", "Which 3 SKUs should I stop selling?", "Where am I losing the most money?"];

  const ask = async (question) => {
    const text = (question ?? q).trim();
    if (!text || busy) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`${API}/insights/ai/ask/`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...params, question: text, history: chat.slice(-6) }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.error) throw new Error(d.error || `Could not get an answer (${res.status}).`);
      setChat((c) => [...c, { role: "user", content: text }, { role: "assistant", content: d.answer }]);
      setQ("");
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: `1px solid ${C.gray100}`, paddingTop: 14 }}>
      <p style={cardTitle}>Ask about your business</p>
      {chat.map((m, i) => (
        <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "92%",
          background: m.role === "user" ? C.orangeLight : C.gray50, borderRadius: 12, padding: "8px 12px",
          fontSize: 13, color: C.gray800, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
          {m.content}
        </div>
      ))}
      {chat.length === 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {examples.map((e) => (
            <button key={e} onClick={() => ask(e)} disabled={busy}
              style={{ fontSize: 12, padding: "5px 10px", borderRadius: 999, border: `1px solid ${C.gray200}`, background: C.white, color: C.gray600, cursor: "pointer" }}>
              {e}
            </button>
          ))}
        </div>
      )}
      <form onSubmit={(e) => { e.preventDefault(); ask(); }} style={{ display: "flex", gap: 8 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Which product should I run ads on?"
          style={{ ...S.inp, flex: 1, minWidth: 0, padding: "9px 12px", border: `1px solid ${C.gray200}` }} />
        <button type="submit" disabled={busy || !q.trim()}
          style={{ padding: "0 16px", borderRadius: 10, border: "none", fontWeight: 700, fontSize: 13, cursor: busy ? "wait" : "pointer",
            background: busy || !q.trim() ? C.gray200 : C.orange, color: C.white }}>
          {busy ? "Thinking…" : "Ask"}
        </button>
      </form>
      {err && <p style={{ fontSize: 12, color: C.red }}>{err}</p>}
    </div>
  );
}

export function AIPanel({ range, ai, period }) {
  const [state, setState] = useState({ loading: true });
  const [busy, setBusy] = useState(false);
  // What to analyse: the period the user picked (the server works out the same window).
  const params = { date_from: range.date_from || "", date_to: range.date_to || "" };

  useEffect(() => {
    if (!ai?.available) {
      setState({ available: false, message: "AI analysis isn't switched on for this server yet. Add ANTHROPIC_API_KEY to the server's env file and restart to enable it — everything else on this page works without it." });
      return undefined;
    }
    let cancelled = false;
    setState({ loading: true });
    // A saved report for exactly these numbers costs nothing to show.
    const q = new URLSearchParams({ hash: ai.hash || "", date_from: period?.date_from || "", date_to: period?.date_to || "" });
    fetch(`${API}/insights/ai/?${q}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setState(d); })
      .catch(() => { if (!cancelled) setState({ available: true, report: null }); });
    return () => { cancelled = true; };
  }, [ai?.available, ai?.hash, period?.date_from, period?.date_to]);

  const run = async (refresh) => {
    setBusy(true);
    try {
      const res = await fetch(`${API}/insights/ai/`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...params, refresh }),
      });
      const d = await res.json().catch(() => ({}));
      setState(res.ok ? d : { ...state, error: d.error || `AI analysis failed (${res.status}).` });
    } catch {
      setState({ ...state, error: "Network error — the analysis didn't finish." });
    } finally {
      setBusy(false);
    }
  };

  const shell = (children) => (
    <div style={{ ...S.card, border: `1px solid ${C.orangeBorder}`, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <p style={{ fontSize: 14.5, fontWeight: 800, color: C.gray800 }}>✨ AI analysis</p>
          <p style={{ fontSize: 11.5, color: C.gray400 }}>Claude reads everything on this page together — profit, returns, claims and payments — and tells you what matters most.</p>
        </div>
        {state.available && state.report && (
          <button onClick={() => run(true)} disabled={busy}
            style={{ fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 999, border: `1px solid ${C.gray200}`, background: C.white, color: C.gray600, cursor: busy ? "wait" : "pointer" }}>
            {busy ? "Analysing…" : "Refresh analysis"}
          </button>
        )}
      </div>
      {children}
    </div>
  );

  if (state.loading) return shell(<p style={{ fontSize: 12, color: C.gray400 }}>Checking for a saved analysis…</p>);
  if (state.available === false) {
    return shell(<p style={{ fontSize: 12.5, color: C.gray500 }}>{state.message}</p>);
  }
  return shell(
    <>
      {state.error && <p style={{ fontSize: 12.5, color: C.red, fontWeight: 600 }}>{state.error}</p>}
      {busy && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, color: C.gray500 }}>
          <CircularProgress size={18} style={{ color: C.orange }} /> Reading this period's numbers — this takes up to a minute…
        </div>
      )}
      {!busy && !state.report && (
        <button onClick={() => run(false)}
          style={{ alignSelf: "flex-start", padding: "10px 18px", borderRadius: 10, border: "none", fontWeight: 800, fontSize: 13.5, background: C.orange, color: C.white, cursor: "pointer" }}>
          Analyse this period with AI
        </button>
      )}
      {state.report && !busy && (
        <>
          {state.stale && (
            <p style={{ fontSize: 12, color: C.amber }}>Your numbers have changed since this was written — press "Refresh analysis" for an up-to-date one.</p>
          )}
          <AIReport report={state.report} />
          <p style={{ fontSize: 11, color: C.gray400 }}>
            Written {state.created_at ? new Date(state.created_at).toLocaleString("en-IN") : ""} by {state.model}. AI can be wrong — the figures it quotes are on this page to check.
          </p>
        </>
      )}
      <AskBox params={params} />
    </>
  );
}

// ── Claims ───────────────────────────────────────────────────────────────────

export function ClaimsUploadButton({ onUploaded, compact }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const upload = async (file) => {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`${API}/claims/upload/`, { method: "POST", body: form });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.success) throw new Error(d.error || `Upload failed (${res.status}).`);
      setMsg({ ok: true, text: `Claims sheet uploaded — ${d.created} new, ${d.updated} updated${d.skipped ? `, ${d.skipped} skipped` : ""}.` });
      onUploaded?.();
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: compact ? "flex-end" : "flex-start" }}>
      <input ref={ref} type="file" accept=".csv,.xlsx,.xls" style={{ display: "none" }} onChange={(e) => upload(e.target.files?.[0])} />
      <button onClick={() => ref.current?.click()} disabled={busy}
        style={{ padding: "8px 14px", borderRadius: 10, border: `1px solid ${C.orange}`, background: C.white, color: C.orange,
          fontWeight: 800, fontSize: 12.5, cursor: busy ? "wait" : "pointer", whiteSpace: "nowrap" }}>
        {busy ? "Uploading…" : "⬆ Upload claims sheet"}
      </button>
      {msg && <span style={{ fontSize: 11.5, color: msg.ok ? C.green : C.red, maxWidth: 320, textAlign: compact ? "right" : "left" }}>{msg.text}</span>}
    </div>
  );
}

export function ClaimsSection({ claims, onUploaded }) {
  const [tab, setTab] = useState("rejected");
  if (!claims) return null;
  if (!claims.uploaded) {
    return (
      <div style={{ ...S.card, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
        <div style={{ maxWidth: 620 }}>
          <p style={{ fontSize: 14, fontWeight: 800, color: C.gray800 }}>Claims</p>
          <p style={{ fontSize: 12.5, color: C.gray500, lineHeight: 1.5 }}>
            Upload the Meesho claims (ticket) export — the same file Claim Sheet takes. Each rejected claim is a product you lost
            without compensation; it is costed at its price on the order date and taken off profit to show your true profit.
          </p>
        </div>
        <ClaimsUploadButton onUploaded={onUploaded} />
      </div>
    );
  }
  const p = claims.period;
  const a = claims.all_time;
  const tp = claims.true_profit;
  const tabs = [
    { key: "rejected", label: "Rejected claims", n: claims.rejected.length },
    { key: "reopen", label: "Can reopen", n: claims.reopenable.length },
    { key: "issue", label: "By issue", n: claims.by_issue.length },
    { key: "sku", label: "By SKU", n: claims.by_sku.length },
    { key: "reasons", label: "Rejection reasons", n: claims.top_rejection_reasons.length },
  ];
  const ticketCols = [
    { key: "ticket_id", label: "Ticket" },
    { key: "sku", label: "SKU", wrap: true },
    { key: "issue", label: "Issue", wrap: true },
    { key: "order_date", label: "Ordered", date: true },
    { key: "product_cost", label: "Product cost", money: true },
    { key: "reopen_by", label: "Reopen by", date: true },
    { key: "reason", label: "Meesho's reply", wrap: true },
  ];
  const groupCols = (first) => [
    first,
    { key: "raised", label: "Raised" },
    { key: "approved", label: "Approved" },
    { key: "rejected", label: "Rejected" },
    { key: "rejection_rate", label: "Rejected %", pct: true },
    { key: "rejected_loss", label: "Lost", money: true, render: (r) => <span style={{ color: C.red, fontFamily: "monospace" }}>{fmt(r.rejected_loss)}</span> },
    { key: "approved_amount", label: "Recovered", money: true },
  ];

  return (
    <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div>
            <p style={{ fontSize: 14, fontWeight: 800, color: C.gray800 }}>Claims</p>
            <p style={{ fontSize: 12, color: C.gray400 }}>For orders placed in this period · latest ticket {fmtDay(claims.last_ticket)}</p>
          </div>
          <ClaimsUploadButton onUploaded={onUploaded} compact />
        </div>
        {tp && (
          <div style={{ background: tp.true_profit >= 0 ? C.greenLight : C.redLight, borderRadius: 10, padding: "10px 14px", fontSize: 13, color: C.gray700, lineHeight: 1.6 }}>
            Net profit <b style={{ fontFamily: "monospace" }}>{fmt(tp.net_profit)}</b> − rejected claims <b style={{ fontFamily: "monospace", color: C.red }}>{fmt(tp.rejected_loss)}</b>
            {" "}= <b style={{ fontFamily: "monospace", color: tp.true_profit >= 0 ? C.green : C.red }}>{fmt(tp.true_profit)}</b> true profit
            {tp.true_profit < 0 && <b style={{ color: C.red }}> — the business lost money this period once rejected claims are counted.</b>}
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
          <Tile label="Raised" value={num(p.raised)} sub={`all time ${num(a.raised)}`} />
          <Tile label="Approved" value={num(p.approved)} color={C.green} sub={`${fmt(p.approved_amount)} recovered`} />
          <Tile label="Rejected" value={num(p.rejected)} color={C.red} sub={`${pct(p.rejection_rate)} of decided`} />
          <Tile label="Lost to rejections" value={fmt(p.rejected_loss)} color={C.red} sub={`all time ${fmt(a.rejected_loss)}`} />
          <Tile label="Still open" value={num(p.open)} color={C.amber}
            sub={p.open_expected_loss != null ? `≈ ${fmt(p.open_expected_loss)} likely lost` : `${fmt(p.open_at_risk)} at stake`} />
          <Tile label="Can still reopen" value={num(claims.reopenable.length)} color={C.blue} sub={`worth ${fmt(claims.reopenable_value)}`} />
        </div>
        {(p.unpriced > 0 || a.unpriced > 0) && (
          <p style={{ fontSize: 11.5, color: C.amber }}>
            {num(a.unpriced)} ticket(s) couldn't be costed — their SKU isn't known or has no price on SKU Pricing, so they count as ₹0.
          </p>
        )}
      </div>
      <div style={{ padding: "0 10px" }}><SubTabs tabs={tabs} active={tab} onChange={setTab} /></div>
      {tab === "rejected" && <Table rows={claims.rejected} cols={ticketCols.map((c) => c.key === "product_cost" ? { ...c, label: "Lost" } : c)} empty="No rejected claims." />}
      {tab === "reopen" && <Table rows={claims.reopenable} cols={ticketCols} empty="No rejected claim is still inside its reopen window." />}
      {tab === "issue" && <Table rows={claims.by_issue} cols={groupCols({ key: "issue", label: "Issue", wrap: true })} />}
      {tab === "sku" && <Table rows={claims.by_sku} cols={groupCols({ key: "sku", label: "SKU", wrap: true })} />}
      {tab === "reasons" && <Table rows={claims.top_rejection_reasons} cols={[{ key: "reason", label: "Meesho's reply", wrap: true }, { key: "count", label: "Times" }]} />}
    </div>
  );
}

// ── Payments ─────────────────────────────────────────────────────────────────

const PAY_COLS = {
  high_return_fee: [
    { key: "sub_order_no", label: "Sub-order" }, { key: "sku", label: "SKU", wrap: true }, { key: "qty", label: "Qty" },
    { key: "fee", label: "Return fee", money: true }, { key: "usual_fee", label: "Usual for SKU", money: true },
    { key: "payment_date", label: "Paid", date: true }],
  shipping_jump: [
    { key: "sku", label: "SKU", wrap: true }, { key: "before", label: "Before / order", money: true },
    { key: "now", label: "Now / order", money: true }, { key: "orders", label: "Orders" }, { key: "extra_cost", label: "Extra paid", money: true }],
  shipping_outlier: [
    { key: "sub_order_no", label: "Sub-order" }, { key: "sku", label: "SKU", wrap: true }, { key: "qty", label: "Qty" },
    { key: "shipping", label: "Shipping / unit", money: true }, { key: "usual", label: "Usual", money: true },
    { key: "payment_date", label: "Paid", date: true }],
  many_rows: [
    { key: "sub_order_no", label: "Sub-order" }, { key: "sku", label: "SKU", wrap: true }, { key: "rows", label: "Rows" },
    { key: "statuses", label: "Lines", wrap: true }, { key: "net", label: "Net", money: true }],
  duplicates: [
    { key: "sub_order_no", label: "Sub-order" }, { key: "status", label: "Line", wrap: true }, { key: "settlement", label: "Amount", money: true },
    { key: "times", label: "Times" }, { key: "payment_date", label: "Paid", date: true }],
  unusual_deductions: [
    { key: "sub_order_no", label: "Sub-order" }, { key: "reason", label: "Reason", wrap: true },
    { key: "settlement", label: "Amount", money: true }, { key: "payment_date", label: "Paid", date: true }],
  adjustment_spike: [
    { key: "reason", label: "Adjustment", wrap: true }, { key: "prev_count", label: "Before" }, { key: "count", label: "Now" },
    { key: "prev_amount", label: "Before ₹", money: true }, { key: "amount", label: "Now ₹", money: true }],
  fee_drift: [
    { key: "orders", label: "Delivered orders" }, { key: "before", label: "Kept before", pct: true }, { key: "now", label: "Kept now", pct: true }],
  delivered_no_pay: [
    { key: "sub_order_no", label: "Sub-order" }, { key: "sku", label: "SKU", wrap: true },
    { key: "settlement", label: "Settled", money: true }, { key: "payment_date", label: "Paid", date: true }],
};
const SEV = { critical: [C.red, C.redLight, "Check now"], warning: [C.amber, C.amberLight, "Check"], info: [C.gray500, C.gray100, "FYI"] };

export function PaymentsSection({ payments }) {
  const [open, setOpen] = useState(null);
  const [showAdj, setShowAdj] = useState(false);
  if (!payments) return null;
  const s = payments.summary, pv = payments.previous, per = payments.period;
  return (
    <div style={{ ...S.card, display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <p style={{ fontSize: 14, fontWeight: 800, color: C.gray800 }}>Payment checks</p>
        <p style={{ fontSize: 12, color: C.gray400 }}>
          Meesho payment lines paid {fmtDay(per.date_from)} – {fmtDay(per.date_to)}, compared with the {per.days} days before.
        </p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
        <Tile label="Payment lines" value={num(s.rows)} sub={`was ${num(pv.rows)}`} />
        <Tile label="Sub-orders paid" value={num(s.sub_orders)} sub={`was ${num(pv.sub_orders)}`} />
        <Tile label="Lines per order" value={s.rows_per_order ?? "—"} sub={`was ${pv.rows_per_order ?? "—"}`} />
        <Tile label="Adjustment lines" value={num(s.adjustment_rows)} sub={`was ${num(pv.adjustment_rows)}`} />
        <Tile label="Net received" value={fmt(s.net)} sub={`was ${fmt(pv.net)}`} />
      </div>
      {payments.checks.length === 0 ? (
        <p style={{ fontSize: 13, color: C.green, fontWeight: 600 }}>✓ Nothing unusual in this period's payments.</p>
      ) : payments.checks.map((c) => {
        const [col, bg, label] = SEV[c.severity] || SEV.info;
        const isOpen = open === c.key;
        return (
          <div key={c.key} style={{ border: `1px solid ${C.gray100}`, borderLeft: `4px solid ${col}`, borderRadius: 10, overflow: "hidden" }}>
            <button onClick={() => setOpen(isOpen ? null : c.key)}
              style={{ width: "100%", textAlign: "left", background: C.white, border: "none", padding: "12px 14px", cursor: "pointer", display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={chip(col, bg)}>{label}</span>
                <span style={{ fontSize: 13.5, fontWeight: 800, color: C.gray800 }}>{c.title}</span>
                {c.amount ? <span style={{ fontSize: 12, fontWeight: 700, color: C.red }}>≈ {fmt(Math.abs(c.amount))}</span> : null}
                <span style={{ marginLeft: "auto", fontSize: 12, color: C.gray400 }}>{isOpen ? "Hide ▲" : "Show rows ▼"}</span>
              </div>
              <span style={{ fontSize: 12.5, color: C.gray600, lineHeight: 1.5 }}>{c.detail}</span>
              <span style={{ fontSize: 12.5, color: C.gray700, lineHeight: 1.5 }}><b>What to do:</b> {c.action}</span>
            </button>
            {isOpen && (
              <div style={{ borderTop: `1px solid ${C.gray100}` }}>
                <Table rows={c.rows} cols={PAY_COLS[c.key] || Object.keys(c.rows[0] || {}).map((k) => ({ key: k, label: k }))} />
                {c.count > c.rows.length && <p style={{ fontSize: 11.5, color: C.gray400, padding: "6px 14px" }}>Showing {c.rows.length} of {c.count}.</p>}
              </div>
            )}
          </div>
        );
      })}
      {payments.adjustments?.length > 0 && (
        <div>
          <button onClick={() => setShowAdj((v) => !v)}
            style={{ fontSize: 12.5, fontWeight: 700, color: C.orange, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
            {showAdj ? "Hide" : "Show"} all adjustment types ({payments.adjustments.length})
          </button>
          {showAdj && (
            <div style={{ marginTop: 8 }}>
              <Table rows={payments.adjustments} cols={[
                { key: "reason", label: "Adjustment", wrap: true }, { key: "prev_count", label: "Lines before" }, { key: "count", label: "Lines now" },
                { key: "prev_amount", label: "₹ before", money: true }, { key: "amount", label: "₹ now", money: true },
                { key: "new", label: "New?", render: (r) => (r.new ? <b style={{ color: C.amber }}>new</b> : "") }]} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
