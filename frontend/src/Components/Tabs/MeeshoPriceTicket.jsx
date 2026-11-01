import React, { useState, useEffect } from "react";
import { C, S, btn, Tag } from "../../App";
import { CircularProgress } from "@mui/material";

/*
 * Send a price change straight to Meesho — the sheet the Download button gives,
 * uploaded and attached to a Support ticket ("change the price of these
 * catalogs") on the chosen business's Meesho account.
 *
 * The business is picked here every time (nothing is preselected unless the
 * sheet can only belong to one business), and named again on the button, so a
 * price change never goes to the wrong account. Callback number and email are
 * remembered on this browser.
 */

const REMEMBER = "meesho-price-ticket";
const remembered = () => {
  try { return JSON.parse(localStorage.getItem(REMEMBER) || "{}"); } catch { return {}; }
};

export function PriceTicketDialog({ base, what, rows, lockBusiness = null, send, onClose }) {
  const [info, setInfo] = useState(null);
  const [target, setTarget] = useState(lockBusiness ? String(lockBusiness.id) : "");
  const mem = remembered();
  const [form, setForm] = useState({
    description: "I want to change the price of these catalogs.", reason: "raw_material_cost_increase",
    callback_number: mem.callback_number || "", email: mem.email || "",
  });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    fetch(`${base}/meesho-price-tickets/`).then((r) => (r.ok ? r.json() : null)).then(setInfo).catch(() => setInfo(null));
  }, [base]);

  const businesses = (info?.businesses || []).filter((b) => !lockBusiness || b.id === lockBusiness.id);
  const chosen = businesses.find((b) => String(b.id) === target);
  const ready = chosen?.connected && /^\d{10}$/.test(form.callback_number.replace(/\D/g, "").slice(-10)) && /\S+@\S+\.\S+/.test(form.email);

  const go = async () => {
    setBusy(true); setResult(null);
    try { localStorage.setItem(REMEMBER, JSON.stringify({ callback_number: form.callback_number, email: form.email })); } catch { /* fine */ }
    try {
      const { ok, data } = await send({ ...form, target_business: Number(target) });
      setResult(ok ? { ok: true, ...data } : { ok: false, ...data });
    } catch { setResult({ ok: false, error: "Network error — nothing may have been sent; check the ticket log before trying again." }); }
    finally { setBusy(false); }
  };

  const field = (label, el) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, fontWeight: 800, color: C.gray600 }}>{label}{el}</label>
  );

  return (
    <div role="dialog" aria-modal="true" aria-label="Send price change to Meesho" onClick={busy ? undefined : onClose}
      style={{ position: "fixed", inset: 0, zIndex: 3400, background: "rgba(15,23,42,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...S.card, maxWidth: 520, width: "100%", padding: 20, display: "flex", flexDirection: "column", gap: 12,
        borderTop: `5px solid ${C.orange}`, maxHeight: "92vh", overflowY: "auto" }}>
        <div style={{ fontSize: 18, fontWeight: 900, color: C.gray900 }}>Send the price change to Meesho</div>
        <div style={{ fontSize: 13, color: C.gray600, lineHeight: 1.5 }}>
          {what} — {rows} row{rows === 1 ? "" : "s"}. The sheet is uploaded to the business's Meesho account and attached to a
          Support ticket, as the panel does it. Meesho checks the sheet and changes the prices from the ticket.
        </div>

        {result?.ok ? (
          <div role="status" style={{ background: C.greenLight, border: `1.5px solid ${C.greenBorder}`, borderRadius: 12, padding: "12px 14px", color: "#166534", fontSize: 13.5 }}>
            <b>✓ Sent to Meesho for {result.run?.business_name}</b>
            <div style={{ marginTop: 4 }}>{result.run?.message}</div>
            {result.skipped?.length > 0 && <div style={{ marginTop: 4, fontSize: 12.5 }}>Left out: {result.skipped.map((s) => `${s.sku_id} (${s.why})`).join("; ")}</div>}
          </div>
        ) : (
          <>
            {!info ? <div style={{ display: "flex", justifyContent: "center", padding: 12 }}><CircularProgress size={20} style={{ color: C.orange }} /></div> : (
              field("Which business is this price change for?", (
                <select value={target} onChange={(e) => setTarget(e.target.value)} disabled={!!lockBusiness}
                  style={{ ...S.inp, fontWeight: 800, borderColor: target ? C.gray200 : C.orange }}>
                  {!lockBusiness && <option value="">— choose the business —</option>}
                  {businesses.map((b) => <option key={b.id} value={b.id} disabled={!b.connected}>{b.name}{b.connected ? "" : " (Meesho not connected)"}</option>)}
                </select>
              ))
            )}
            {field("Description", <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={{ ...S.inp, resize: "vertical" }} />)}
            {field("Why do you want to change the price?", (
              <select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} style={S.inp}>
                {(info?.reasons || [{ key: "raw_material_cost_increase", label: "Increase in raw material costs temporarily" }])
                  .map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
            ))}
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
              {field("Callback number", <input inputMode="numeric" value={form.callback_number} placeholder="10 digits"
                onChange={(e) => setForm({ ...form, callback_number: e.target.value })} style={S.inp} />)}
              {field("Email for Meesho's reply", <input type="email" value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })} style={S.inp} />)}
            </div>
            {result && !result.ok && (
              <div role="alert" style={{ background: C.redLight, border: `1.5px solid ${C.redBorder}`, borderRadius: 12, padding: "10px 14px", color: C.red, fontSize: 13.5, fontWeight: 700 }}>
                ✕ {result.error || "Meesho refused it."}
                {result.skipped?.length > 0 && <div style={{ fontWeight: 600, marginTop: 4 }}>Left out: {result.skipped.map((s) => `${s.sku_id} (${s.why})`).join("; ")}</div>}
              </div>
            )}
          </>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button onClick={onClose} disabled={busy} style={btn("ghost", "md")}>{result?.ok ? "Done" : "Cancel"}</button>
          {!result?.ok && (
            <button onClick={go} disabled={!ready || busy} style={{ ...btn("primary", "md"), opacity: !ready || busy ? 0.5 : 1 }}>
              {busy ? <><CircularProgress size={13} style={{ color: "#fff", marginRight: 6, verticalAlign: "-2px" }} />Uploading & raising the ticket…</>
                : chosen ? `📨 Send to Meesho for ${chosen.name}` : "Choose the business first"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The price changes sent to Meesho lately — with their ticket, or why Meesho refused. */
export function PriceTicketLog({ base, refreshKey = 0 }) {
  const [tickets, setTickets] = useState(null);
  useEffect(() => {
    fetch(`${base}/meesho-price-tickets/`).then((r) => (r.ok ? r.json() : null)).then((d) => setTickets(d?.tickets || [])).catch(() => setTickets([]));
  }, [base, refreshKey]);
  if (!tickets || tickets.length === 0) return null;
  return (
    <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", fontWeight: 800, fontSize: 14, borderBottom: `1px solid ${C.gray100}` }}>Price changes sent to Meesho</div>
      {tickets.map((t) => (
        <div key={t.id} style={{ padding: "8px 14px", borderBottom: `1px solid ${C.gray100}`, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 12.5 }}>
          <Tag variant={t.status === "OK" ? "green" : t.status === "FAILED" ? "red" : "blue"}>{t.status === "OK" ? (t.ticket ? `Ticket ${t.ticket}` : "Sent") : t.status === "FAILED" ? "Refused" : "Sending"}</Tag>
          <b>{t.business_name}</b>
          <span style={{ color: C.gray600 }}>{t.what} · {t.rows} rows</span>
          <span style={{ color: C.gray500, flex: 1, minWidth: 200 }}>{t.status === "OK" ? "" : t.message}</span>
          <span style={{ color: C.gray400, whiteSpace: "nowrap" }}>{t.at ? new Date(t.at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}{t.by ? ` · ${t.by}` : ""}</span>
        </div>
      ))}
    </div>
  );
}
