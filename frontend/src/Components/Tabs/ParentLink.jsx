import React, { useState, useEffect } from "react";
import { API, C, S, btn } from "../../App";
import { CircularProgress } from "@mui/material";

/*
 * "Link to parent" for a SKU that has no parent on SKU Pricing — from the
 * Orders Panel or a labels list. Picks one of that business's parents (the
 * likeliest first) and links it, as SKU Pricing does: the SKU then takes the
 * parent's price.
 */
export function ParentLinkButton({ businessId, businessName, sku, onLinked, compact = false }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={(e) => { e.stopPropagation(); setOpen(true); }} title={`Link ${sku} to a parent on SKU Pricing`}
        style={{ ...btn("ghostOrange", "sm"), padding: compact ? "3px 9px" : undefined, whiteSpace: "nowrap" }}>🔗 Link to parent</button>
      {open && <ParentLinkDialog businessId={businessId} businessName={businessName} sku={sku}
        onClose={() => setOpen(false)} onLinked={(p) => { setOpen(false); onLinked?.(p); }} />}
    </>
  );
}

function ParentLinkDialog({ businessId, businessName, sku, onClose, onLinked }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`${API}/meesho-orders/sku-parent/?business=${businessId}&sku=${encodeURIComponent(sku)}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || "Couldn't read the parents.");
        setD(j);
        setPick(j.current || j.suggestions?.[0]?.item_id || "");
      })
      .catch((e) => setErr(e.message === "Failed to fetch" ? "Couldn't reach the server." : e.message));
  }, [businessId, sku]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const known = d && d.parents.includes(pick);
  const link = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`${API}/meesho-orders/sku-parent/`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business: businessId, sku, parent: pick }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Couldn't link it.");
      onLinked(j.parent);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={`Link ${sku} to a parent`} onClick={(e) => { e.stopPropagation(); onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 4000, background: "rgba(15,23,42,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...S.card, width: "100%", maxWidth: 460, padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 900, color: C.gray900 }}>Link to a parent</div>
          <div style={{ fontSize: 12.5, color: C.gray500, marginTop: 2, wordBreak: "break-all" }}>
            <b style={{ fontFamily: "monospace", color: C.gray800 }}>{sku}</b> · {businessName}
          </div>
        </div>
        {!d && !err && <div style={{ display: "flex", justifyContent: "center", padding: 16 }}><CircularProgress size={22} style={{ color: C.orange }} /></div>}
        {d && (
          <>
            {d.suggestions.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 11.5, fontWeight: 800, color: C.gray500, textTransform: "uppercase", letterSpacing: ".04em" }}>Looks like</span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {d.suggestions.map((s) => (
                    <button key={s.item_id} onClick={() => setPick(s.item_id)} aria-pressed={pick === s.item_id}
                      style={{ padding: "6px 10px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
                        border: `1.5px solid ${pick === s.item_id ? C.orange : C.gray200}`, background: pick === s.item_id ? C.orangeLight : C.white,
                        color: pick === s.item_id ? C.orange : C.gray700 }}>{s.item_id}</button>
                  ))}
                </div>
              </div>
            )}
            <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11.5, fontWeight: 800, color: C.gray500, textTransform: "uppercase", letterSpacing: ".04em" }}>
              Parent on SKU Pricing ({d.parents.length})
              <input list="parent-link-options" value={pick} onChange={(e) => setPick(e.target.value)} placeholder="Type to search parents…" autoFocus
                style={{ ...S.inp, textTransform: "none", letterSpacing: 0, fontWeight: 600 }} />
              <datalist id="parent-link-options">{d.parents.map((p) => <option key={p} value={p} />)}</datalist>
            </label>
            {pick && !known && <div style={{ fontSize: 12.5, color: C.amber, fontWeight: 700 }}>No parent called “{pick}” — pick one from the list, or make it on SKU Pricing first.</div>}
            <div style={{ fontSize: 12, color: C.gray500 }}>As on SKU Pricing, the SKU then takes the parent's price.</div>
          </>
        )}
        {err && <div role="alert" style={{ color: C.red, fontWeight: 700, fontSize: 13 }}>✕ {err}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={btn("ghost", "sm")}>Cancel</button>
          <button onClick={link} disabled={!known || busy} style={{ ...btn("primary", "sm"), opacity: !known || busy ? 0.5 : 1 }}>
            {busy ? "Linking…" : "Link"}</button>
        </div>
      </div>
    </div>
  );
}
