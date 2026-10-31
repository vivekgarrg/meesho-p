import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { API, C, S, btn, useIsMobile } from "../../App";
import { CircularProgress } from "@mui/material";
import { Panel, Kpi, StatusDot, num, ago, dayLabel } from "./MeeshoUI";

/*
 * Meesho → Returns & OTPs. The delivery OTP each courier needs to hand returns
 * back (as the panel's Returns page shows them), for every business on the
 * desk — searchable by AWB, with when each expires. Below, the returns by
 * status, kept in the Returns & Claims table by the sync every 10 minutes.
 */

const remaining = (iso, now) => {
  if (!iso) return { text: "no expiry given", tone: "neutral" };
  const ms = new Date(iso) - now;
  if (ms <= 0) return { text: "expired", tone: "bad" };
  const m = Math.round(ms / 60000);
  const text = m < 60 ? `expires in ${m} min` : `expires in ${Math.floor(m / 60)} h ${m % 60} min`;
  return { text, tone: m < 30 ? "warn" : "good" };
};

function OtpCard({ o, now, highlight, showBiz }) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const left = remaining(o.expires_at, now);
  const copy = async () => {
    try { await navigator.clipboard.writeText(o.otp); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };
  return (
    <div style={{ ...S.card, padding: 16, display: "flex", flexDirection: "column", gap: 10, minWidth: 0,
      border: `1.5px solid ${highlight ? C.orange : C.gray200}`, boxShadow: highlight ? "0 0 0 4px rgba(249,115,22,.15)" : undefined }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {o.courier_icon ? <img src={o.courier_icon} alt="" style={{ width: 28, height: 28, objectFit: "contain", borderRadius: 6 }} />
          : <span aria-hidden style={{ width: 28, height: 28, borderRadius: 6, background: C.gray100, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>🚚</span>}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 14.5, color: C.gray900 }}>{o.courier}</div>
          {showBiz && <div style={{ fontSize: 12, color: C.gray500 }}>{o.business_name}</div>}
        </div>
        <span style={{ fontSize: 12, color: C.gray500 }}>{num(o.shipments)} parcel{o.shipments === 1 ? "" : "s"}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span aria-label={`${o.kind} ${o.otp.split("").join(" ")}`} style={{ fontFamily: "monospace", fontSize: 34, fontWeight: 900, letterSpacing: "0.18em",
          color: left.tone === "bad" ? C.gray400 : C.gray900, textDecoration: left.tone === "bad" ? "line-through" : "none" }}>{o.otp || "—"}</span>
        <button onClick={copy} disabled={!o.otp} style={btn("ghost", "sm")}>{copied ? "✓ Copied" : "Copy"}</button>
      </div>
      <StatusDot tone={left.tone}>{left.text}</StatusDot>
      {o.awbs.length > 0 && (
        <div>
          <button onClick={() => setOpen((v) => !v)} style={{ border: "none", background: "none", padding: 0, cursor: "pointer", color: C.orange, fontWeight: 700, fontSize: 12.5 }}>
            {open || highlight ? "Hide AWBs" : `Show ${o.awbs.length} AWB${o.awbs.length === 1 ? "" : "s"}`}
          </button>
          {(open || highlight) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
              {o.awbs.map((a) => (
                <span key={a} style={{ fontFamily: "monospace", fontSize: 12, padding: "2px 8px", borderRadius: 6,
                  background: highlight && a.toUpperCase().includes(highlight) ? C.orangeLight : C.gray50, border: `1px solid ${C.gray200}` }}>{a}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


const STAGES = [
  { key: "in_transit", label: "In transit", icon: "🚚", tone: () => "info", sub: "On their way back" },
  { key: "out_for_delivery", label: "Out for delivery", icon: "📍", tone: (n) => (n ? "warn" : "neutral"), sub: "Expect them today — have the OTP ready" },
  { key: "delivered", label: "Delivered", icon: "✅", tone: () => "good", sub: "Back with you — check and claim" },
  { key: "lost", label: "Lost", icon: "❓", tone: (n) => (n ? "bad" : "neutral"), sub: "Meesho settles these" },
  { key: "disposed", label: "Disposed", icon: "🗑", tone: () => "neutral", sub: "Not coming back" },
];
// The date that matters in each status, as a column.
const KEY_DATE = {
  in_transit: ["Expected back", (x) => x.expected], out_for_delivery: ["Expected back", (x) => x.expected],
  delivered: ["Delivered", (x) => x.delivered], lost: ["Lost on", (x) => x.closed_at], disposed: ["Disposed on", (x) => x.closed_at],
};
const CLAIM_TONE = { NOT_REQUIRED: "neutral", UNREVIEWED: "warn", REQUIRED: "bad", RAISED: "info", APPROVED: "good", REJECTED: "bad" };

function ReturnsTable({ stage, accounts, multi }) {
  const isMobile = useIsMobile();
  const [q, setQ] = useState("");
  const [biz, setBiz] = useState("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { setPage(1); setOpen(null); }, [stage, q, biz]);
  useEffect(() => {
    let stop = false;
    const t = setTimeout(async () => {
      setLoading(true);
      const p = new URLSearchParams({ stage, page: String(page) });
      if (q.trim()) p.set("q", q.trim());
      if (biz !== "all") p.set("business", biz);
      const r = await fetch(`${API}/meesho-orders/returns/list/?${p}`).catch(() => null);
      if (!stop && r?.ok) setData(await r.json());
      if (!stop) setLoading(false);
    }, q ? 250 : 0);
    return () => { stop = true; clearTimeout(t); };
  }, [stage, q, biz, page]);

  const label = STAGES.find((s) => s.key === stage).label;
  const [dateLabel, dateOf] = KEY_DATE[stage];
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const cols = ["Return", ...(multi && biz === "all" ? ["Business"] : []), "Product", "Courier", "Status", dateLabel, "Claim", ""];

  return (
    <Panel title={`${label} returns`} subtitle={data ? `${num(data.total)} return${data.total === 1 ? "" : "s"}${q ? ` matching “${q}”` : ""}` : "Loading…"} pad={false}
      action={
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {multi && (
            <select value={biz} onChange={(e) => setBiz(e.target.value)} style={{ ...S.inp, width: "auto", padding: "6px 10px" }}>
              <option value="all">All businesses</option>
              {accounts.map((a) => <option key={a.business_id} value={String(a.business_id)}>{a.business_name}</option>)}
            </select>
          )}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sub-order, AWB, SKU, courier…" aria-label="Search returns"
            style={{ ...S.inp, width: isMobile ? "100%" : 240 }} />
        </div>
      }>
      <div style={{ overflowX: "auto", opacity: loading ? 0.6 : 1, transition: "opacity .15s" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead><tr>{cols.map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {data && data.returns.length === 0 && (
              <tr><td colSpan={cols.length} style={{ ...S.td, textAlign: "center", color: C.gray400, padding: 28 }}>
                {q ? "Nothing matches that search." : `No ${label.toLowerCase()} returns.`}
              </td></tr>
            )}
            {data?.returns.map((x) => {
              const isOpen = open === x.id;
              return (
                <React.Fragment key={x.id}>
                  <tr onClick={() => setOpen(isOpen ? null : x.id)} style={{ cursor: "pointer", background: isOpen ? C.gray50 : undefined }}>
                    <td style={{ ...S.td, whiteSpace: "nowrap" }}>
                      <div style={{ fontFamily: "monospace", fontWeight: 800 }}>{x.suborder_no}</div>
                      <div style={{ fontSize: 11.5, color: C.gray500 }}>{x.type || "—"}{x.awb ? <> · <span style={{ fontFamily: "monospace" }}>{x.awb}</span></> : null}</div>
                    </td>
                    {multi && biz === "all" && <td style={S.td}>{x.business_name}</td>}
                    <td style={{ ...S.td, maxWidth: 280 }}>
                      <div style={{ fontFamily: "monospace", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.sku || "—"}</div>
                      <div style={{ fontSize: 11.5, color: C.gray500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.product}</div>
                    </td>
                    <td style={{ ...S.td, whiteSpace: "nowrap" }}>{x.courier || "—"}</td>
                    <td style={{ ...S.td, whiteSpace: "nowrap" }}>
                      {x.meesho_status || "—"}{x.attempts ? <div style={{ fontSize: 11.5, color: C.gray500 }}>{typeof x.attempts === "number" ? `${x.attempts} attempt${x.attempts === 1 ? "" : "s"}` : x.attempts}</div> : null}
                    </td>
                    <td style={{ ...S.td, whiteSpace: "nowrap" }}>{dayLabel(dateOf(x))}</td>
                    <td style={{ ...S.td, whiteSpace: "nowrap" }}><StatusDot tone={CLAIM_TONE[x.claim_status] || "neutral"}>{x.claim_label}</StatusDot></td>
                    <td style={{ ...S.td, color: C.gray400 }}>{isOpen ? "▾" : "▸"}</td>
                  </tr>
                  {isOpen && (
                    <tr><td colSpan={cols.length} style={{ ...S.td, background: C.gray50, padding: "12px 16px" }}>
                      <div style={{ display: "grid", gap: "8px 24px", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, minmax(0, 1fr))", fontSize: 12.5 }}>
                        {[
                          ["Order", x.order_no], ["Variation · qty", `${x.variation || "—"} · ${x.qty}`], ["Return type", `${x.type || "—"}${x.sub_type ? ` (${x.sub_type})` : ""}`],
                          ["Dispatched", dayLabel(x.dispatch_date)], ["Return created", dayLabel(x.created)], ["Expected back", dayLabel(x.expected)],
                          ["Delivered back", dayLabel(x.delivered)], ["Lost / disposed", x.closed_at ? dayLabel(x.closed_at) : "—"], ["Price type", x.price_type || "—"],
                          ["Reason", x.reason || "—"], ["Customer said", x.detailed_reason || "—"], ["Meesho note", x.note || "—"],
                        ].map(([k, val]) => (
                          <div key={k}><div style={{ fontSize: 11, fontWeight: 700, color: C.gray500, textTransform: "uppercase", letterSpacing: "0.04em" }}>{k}</div>
                            <div style={{ color: C.gray800 }}>{val || "—"}</div></div>
                        ))}
                      </div>
                      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                        {x.tracking_link && <a href={x.tracking_link} target="_blank" rel="noreferrer" style={{ ...btn("ghost", "sm"), textDecoration: "none" }}>Track with {x.courier || "courier"} ↗</a>}
                        {x.proof_of_delivery && /^https?:/.test(x.proof_of_delivery) && <a href={x.proof_of_delivery} target="_blank" rel="noreferrer" style={{ ...btn("ghost", "sm"), textDecoration: "none" }}>Proof of delivery ↗</a>}
                        <Link to="/returns" style={{ ...btn("ghost", "sm"), textDecoration: "none" }}>Claim in Returns &amp; Claims</Link>
                        {x.synced_at && <span style={{ fontSize: 11.5, color: C.gray400, alignSelf: "center" }}>read from Meesho {ago(x.synced_at)}</span>}
                      </div>
                    </td></tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {data && data.total > data.page_size && (
        <div style={{ padding: 10, display: "flex", gap: 8, justifyContent: "center", alignItems: "center", fontSize: 12.5 }}>
          <button disabled={page <= 1} onClick={() => setPage(page - 1)} style={btn("ghost", "sm")}>‹ Previous</button>
          Page {page} of {pages}
          <button disabled={page >= pages} onClick={() => setPage(page + 1)} style={btn("ghost", "sm")}>Next ›</button>
        </div>
      )}
    </Panel>
  );
}

export function MeeshoReturnsTab() {
  const isMobile = useIsMobile();
  const [data, setData] = useState(null);
  const [q, setQ] = useState("");
  const [biz, setBiz] = useState("all");
  const [now, setNow] = useState(() => new Date());
  const [note, setNote] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [stage, setStage] = useState("in_transit");

  const load = useCallback(async () => {
    const r = await fetch(`${API}/meesho-orders/returns/`).catch(() => null);
    if (r?.ok) setData(await r.json());
  }, []);
  const reading = data?.accounts.some((a) => ["QUEUED", "RUNNING"].includes(a.last_run?.status));
  useEffect(() => {
    load();
    const t = setInterval(load, reading ? 5000 : 60000);
    return () => clearInterval(t);
  }, [load, reading]);
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);

  const refresh = async () => {
    setRefreshing(true); setNote(null);
    const r = await fetch(`${API}/meesho-orders/returns/refresh/`, { method: "POST" }).catch(() => null);
    setRefreshing(false);
    if (!r?.ok) { const d = r ? await r.json().catch(() => ({})) : {}; setNote(d.error || "Couldn't start a refresh."); }
    load();
  };

  const needle = q.replace(/\s+/g, "").toUpperCase();
  const otps = useMemo(() => (data?.otps || []).filter((o) => biz === "all" || String(o.business_id) === biz), [data, biz]);
  const matches = needle ? otps.filter((o) => o.awbs.some((a) => a.toUpperCase().includes(needle)) || o.courier.toUpperCase().includes(needle)) : otps;

  if (!data) return <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><CircularProgress style={{ color: C.orange }} /></div>;
  const multi = data.accounts.length > 1;
  const r = data.returns;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <p style={{ fontSize: 13, color: C.gray500, margin: 0, maxWidth: 760 }}>
          The OTP each courier needs to hand returns back to you, for every business — and every return by status, kept in{" "}
          <Link to="/returns" style={{ color: C.orange, fontWeight: 700 }}>Returns &amp; Claims</Link> by the sync every 10 minutes.
        </p>
        <button onClick={refresh} disabled={refreshing || reading} style={{ ...btn("primary", "md"), minWidth: 160, opacity: refreshing || reading ? 0.6 : 1 }}>
          {reading ? <><CircularProgress size={14} style={{ color: "#fff", marginRight: 6, verticalAlign: "-2px" }} />Reading…</> : "↻ Refresh now"}
        </button>
      </div>
      {note && <div role="alert" style={{ fontSize: 13, fontWeight: 700, color: C.red }}>{note}</div>}

      <Panel title="Delivery OTPs" subtitle="Give the courier the OTP for its returns. Search an AWB to find which OTP it needs."
        action={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {multi && (
              <select value={biz} onChange={(e) => setBiz(e.target.value)} style={{ ...S.inp, width: "auto", padding: "6px 10px" }}>
                <option value="all">All businesses</option>
                {data.accounts.map((a) => <option key={a.business_id} value={String(a.business_id)}>{a.business_name}</option>)}
              </select>
            )}
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search AWB or courier…" aria-label="Search AWB or courier"
              style={{ ...S.inp, width: isMobile ? "100%" : 220 }} />
          </div>
        }>
        {otps.length === 0 ? (
          <div style={{ fontSize: 13, color: C.gray500, padding: "8px 0" }}>No courier OTPs right now — they appear when a courier has returns to hand over.</div>
        ) : matches.length === 0 ? (
          <div style={{ fontSize: 13, color: C.gray500, padding: "8px 0" }}>No OTP covers “{q}”. The return may not be out for delivery yet — press Refresh now.</div>
        ) : (
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "repeat(auto-fill, minmax(260px, 1fr))" }}>
            {matches.map((o) => (
              <OtpCard key={`${o.business_id}-${o.courier}`} o={o} now={now} highlight={needle && o.awbs.some((a) => a.toUpperCase().includes(needle)) ? needle : ""}
                showBiz={multi && biz === "all"} />
            ))}
          </div>
        )}
      </Panel>

      <div role="tablist" aria-label="Returns by status" style={{ display: "grid", gap: 12, gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(5, minmax(0, 1fr))" }}>
        {STAGES.map((st) => (
          <Kpi key={st.key} icon={st.icon} label={st.label} value={num(r[st.key])} tone={st.tone(r[st.key])} sub={st.sub}
            active={stage === st.key} onClick={() => setStage(st.key)} />
        ))}
      </div>

      <ReturnsTable stage={stage} accounts={data.accounts} multi={multi} />

      <Panel title="Last read from Meesho" pad={false}
        action={<Link to="/returns" style={{ ...btn("ghost", "sm"), textDecoration: "none" }}>Open Returns &amp; Claims</Link>}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead><tr>{["Business", "Returns", "OTPs"].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {data.accounts.map((a) => (
                <tr key={a.business_id}>
                  <td style={{ ...S.td, fontWeight: 800 }}>{a.business_name}</td>
                  <td style={S.td}>
                    {a.last_run ? (["QUEUED", "RUNNING"].includes(a.last_run.status) ? <StatusDot tone="info">reading now…</StatusDot>
                      : <StatusDot tone={a.last_run.status === "OK" ? "good" : "bad"}>{ago(a.last_run.finished_at || a.last_run.queued_at)} — {a.last_run.message}</StatusDot>)
                      : <StatusDot>not read yet</StatusDot>}
                  </td>
                  <td style={{ ...S.td, whiteSpace: "nowrap" }}><StatusDot tone={a.otps_read_at ? "good" : "neutral"}>{ago(a.otps_read_at)}</StatusDot></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
