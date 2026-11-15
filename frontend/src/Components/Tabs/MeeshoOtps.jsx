import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API, C, S } from "../../App";

/*
 * Delivery OTPs, live. Every business's couriers and the OTP each needs to hand
 * returns back, asked of Meesho directly (meesho-orders/otps/live/) every 30
 * seconds while the page is open and on screen — and the moment it comes back
 * into view. Compact: one line per courier, grouped by business.
 */

const EVERY = 30;   // seconds

const left = (exp, now) => {
  if (!exp) return { text: "", tone: C.gray400 };
  const ms = new Date(exp) - now;
  if (ms <= 0) return { text: "expired", tone: C.red };
  const m = Math.round(ms / 60000);
  return { text: m < 60 ? `${m} min left` : `${Math.floor(m / 60)} h ${m % 60} min left`, tone: m < 30 ? "#B45309" : "#15803D" };
};
const ago = (iso, now) => {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - new Date(iso)) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};

function Row({ o, now, needle }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const l = left(o.expires_at, now);
  const hit = needle && o.awbs.some((a) => a.toUpperCase().includes(needle));
  const copy = async () => {
    try { await navigator.clipboard.writeText(o.otp); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { /* blocked */ }
  };
  return (
    <div style={{ borderTop: `1px solid ${C.gray100}`, background: hit ? C.orangeLight : undefined }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) auto minmax(0, 1fr) auto", gap: 10, alignItems: "center", padding: "6px 12px", fontSize: 12.5 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          {o.courier_icon && <img src={o.courier_icon} alt="" style={{ width: 16, height: 16, objectFit: "contain" }} />}
          <span style={{ fontWeight: 700, color: C.gray800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.courier || "Courier"}</span>
        </span>
        <button onClick={copy} disabled={!o.otp} title="Copy" aria-label={`OTP ${o.otp.split("").join(" ")} — copy`}
          style={{ border: `1px solid ${C.gray200}`, background: "#fff", borderRadius: 6, padding: "2px 8px", cursor: "pointer",
            fontFamily: "monospace", fontSize: 15, fontWeight: 800, letterSpacing: ".12em",
            color: l.tone === C.red ? C.gray400 : C.gray900, textDecoration: l.tone === C.red ? "line-through" : "none" }}>
          {copied ? "copied" : o.otp || "—"}
        </button>
        <span style={{ color: C.gray500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {o.shipments} parcel{o.shipments === 1 ? "" : "s"}{l.text && <> · <span style={{ color: l.tone, fontWeight: 700 }}>{l.text}</span></>}
        </span>
        {o.awbs.length > 0 ? (
          <button onClick={() => setOpen(!open)} style={{ border: "none", background: "none", color: C.orange, fontWeight: 700, fontSize: 11.5, cursor: "pointer", padding: 0 }}>
            {open || hit ? "hide" : `${o.awbs.length} AWB${o.awbs.length === 1 ? "" : "s"}`}
          </button>
        ) : <span />}
      </div>
      {(open || hit) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "0 12px 8px" }}>
          {o.awbs.map((a) => (
            <span key={a} style={{ fontFamily: "monospace", fontSize: 11, padding: "1px 6px", borderRadius: 4, border: `1px solid ${C.gray200}`,
              background: needle && a.toUpperCase().includes(needle) ? "#FED7AA" : C.gray50 }}>{a}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export function MeeshoOtps() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [q, setQ] = useState("");
  const [nextIn, setNextIn] = useState(EVERY);
  const inflight = useRef(null);
  const countdown = useRef(EVERY);

  const load = useCallback(async () => {
    inflight.current?.abort();
    const ctrl = new AbortController();
    inflight.current = ctrl;
    setBusy(true);
    try {
      const r = await fetch(`${API}/meesho-orders/otps/live/`, { signal: ctrl.signal });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error || j?.detail || `HTTP ${r.status}`);
      setD(j); setErr(null);
    } catch (e) {
      if (e.name !== "AbortError") setErr(e.message || "Couldn't read the OTPs");
    } finally {
      if (inflight.current === ctrl) { setBusy(false); countdown.current = EVERY; setNextIn(EVERY); }
    }
  }, []);

  // Every 30 s while on screen; at once when the page comes back into view.
  useEffect(() => {
    load();
    const tick = setInterval(() => {
      setNow(new Date());
      if (document.visibilityState !== "visible") return;
      countdown.current -= 1;
      if (countdown.current <= 0) { countdown.current = EVERY; load(); }
      setNextIn(countdown.current);
    }, 1000);
    const onShow = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onShow);
    return () => { clearInterval(tick); document.removeEventListener("visibilitychange", onShow); inflight.current?.abort(); };
  }, [load]);

  const needle = q.replace(/\s+/g, "").toUpperCase();
  const groups = useMemo(() => (d?.businesses || []).map((b) => ({
    ...b,
    rows: (d.otps || []).filter((o) => o.business_id === b.business_id
      && (!needle || o.courier.toUpperCase().includes(needle) || o.awbs.some((a) => a.toUpperCase().includes(needle)))),
  })), [d, needle]);

  if (!d) {
    return err ? <div role="alert" style={{ ...S.card, color: C.red, fontWeight: 700 }}>✕ {err} <button onClick={load}>Retry</button></div>
      : <div style={{ padding: 40, textAlign: "center", color: C.gray400, fontSize: 13 }}>Asking Meesho for the OTPs…</div>;
  }
  const total = d.otps.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 980 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: busy ? C.gray500 : "#15803D" }}>
          <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, background: busy ? C.gray300 : "#22C55E",
            boxShadow: busy ? "none" : "0 0 0 3px rgba(34,197,94,.2)" }} />
          {busy ? "Asking Meesho…" : `Live · next in ${nextIn}s`}
        </span>
        <span style={{ fontSize: 12, color: C.gray500 }}>{total} courier OTP{total === 1 ? "" : "s"} · {d.businesses.length} business{d.businesses.length === 1 ? "" : "es"}</span>
        <button onClick={load} disabled={busy} style={{ border: `1px solid ${C.gray200}`, background: "#fff", borderRadius: 8, padding: "4px 10px",
          fontSize: 12, fontWeight: 700, cursor: busy ? "default" : "pointer", color: C.gray700 }}>↻ Now</button>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an AWB or courier…" aria-label="Find an AWB or courier"
          style={{ ...S.inp, width: 240, padding: "5px 10px", fontSize: 12.5, marginLeft: "auto" }} />
      </div>
      {err && <div role="alert" style={{ fontSize: 12, color: C.red, fontWeight: 700 }}>✕ {err} — showing the last OTPs read.</div>}

      {groups.map((g) => (
        <section key={g.business_id} style={{ ...S.card, padding: 0, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", background: C.gray50, fontSize: 12.5 }}>
            <b style={{ color: C.gray900 }}>{g.business_name}</b>
            <span style={{ color: g.live ? "#15803D" : C.gray500 }}>{g.live ? "● live" : "○ last read"} · {ago(g.read_at, now)}</span>
            {g.problem && <span style={{ color: C.red, fontWeight: 700, marginLeft: "auto", fontSize: 11.5 }}>{g.problem}</span>}
          </div>
          {g.rows.length === 0 ? (
            <div style={{ padding: "8px 12px", fontSize: 12, color: C.gray500 }}>
              {needle ? `No OTP here covers “${q}”.` : "No courier has returns to hand over right now."}
            </div>
          ) : g.rows.map((o) => <Row key={`${o.courier}-${o.otp}`} o={o} now={now} needle={needle} />)}
        </section>
      ))}
    </div>
  );
}
