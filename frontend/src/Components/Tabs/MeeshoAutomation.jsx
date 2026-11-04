import React, { useState, useEffect, useCallback } from "react";
import { API, C, S, btn, Tag } from "../../App";
import { CircularProgress } from "@mui/material";

/*
 * The Meesho automation and its labels, for the Meesho Orders page:
 *
 *  AutomationCard — admins set how often pending orders are accepted and at
 *    what times of day labels are made (IST). The sync worker's every-minute
 *    scheduler follows it (MeeshoAutoSetting).
 *  LatestLabels — the newest labels PDFs (automatic runs and Generate), merged
 *    and sorted by parent SKU, kept in the app so they can be printed or
 *    downloaded straight away — Meesho's own links expire.
 */

const when = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { weekday: "short", day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" }) : "—");
const everyLabel = (m) => (m === 0 ? "Never (accept by hand)" : m < 60 ? `Every ${m} minutes` : m === 60 ? "Every hour" : `Every ${m / 60} hours`);
const timeLabel = (t) => {
  const [h, m] = t.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
};

const CHANNEL = { whatsapp: "WhatsApp", telegram: "Telegram", email: "Email" };

/** Send each automatic labels PDF as soon as it's made — on the channels set up in the server's .env. */
function SendLabels({ s, admin, busy, onToggle }) {
  const channels = s.send_channels || [];
  const names = channels.map((c) => CHANNEL[c] || c).join(", ");
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap",
      padding: "12px 14px", borderRadius: 12, background: C.gray50, border: `1px solid ${C.gray200}` }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: C.gray900 }}>Send the labels {names ? `to ${names}` : ""}</div>
        <div style={{ fontSize: 12.5, color: C.gray500, marginTop: 2 }}>
          {channels.length
            ? "After each automatic labels run, the sorted PDF is sent straight away."
            : "No channel set up yet — add the WhatsApp settings to the server's .env (WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TEMPLATE, WHATSAPP_TO)."}
        </div>
      </div>
      {admin ? (
        <button onClick={onToggle} disabled={busy || (!channels.length && !s.send_labels)}
          style={{ ...btn(s.send_labels ? "ghost" : "primary", "sm"), minWidth: 110, opacity: !channels.length && !s.send_labels ? 0.5 : 1,
            ...(s.send_labels ? { color: C.red } : {}) }}>
          {s.send_labels ? "Stop sending" : "Start sending"}
        </button>
      ) : <Tag variant={s.send_labels ? "green" : "gray"}>{s.send_labels ? "Sending" : "Not sending"}</Tag>}
    </div>
  );
}

/** Every night: each live (not paused) SKU's stock on Meesho set back to a quantity, so nothing runs out by itself. */
function NightlyStock({ s, admin, busy, save }) {
  const [time, setTime] = useState(s.stock_refill_time || "21:00");
  const [qty, setQty] = useState(String(s.stock_refill_qty ?? 5000));
  useEffect(() => { setTime(s.stock_refill_time || "21:00"); setQty(String(s.stock_refill_qty ?? 5000)); }, [s.stock_refill_time, s.stock_refill_qty]);
  const changed = time !== s.stock_refill_time || Number(qty) !== s.stock_refill_qty;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 14px", borderRadius: 12, background: C.gray50, border: `1px solid ${C.gray200}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: C.gray900 }}>Nightly stock</div>
          <div style={{ fontSize: 12.5, color: C.gray500, marginTop: 2 }}>
            Every night at {timeLabel(s.stock_refill_time || "21:00")}, every <b>live</b> SKU of every business is set to {s.stock_refill_qty} on Meesho —
            one SKU after another; paused ones are left alone.{s.last_stock_refill_at ? ` Last: ${when(s.last_stock_refill_at)}.` : ""}
          </div>
        </div>
        {admin ? (
          <button onClick={() => save({ stock_refill_enabled: !s.stock_refill_enabled })} disabled={busy}
            style={{ ...btn(s.stock_refill_enabled ? "ghost" : "primary", "sm"), minWidth: 110, ...(s.stock_refill_enabled ? { color: C.red } : {}) }}>
            {s.stock_refill_enabled ? "Switch off" : "Switch on"}
          </button>
        ) : <Tag variant={s.stock_refill_enabled ? "green" : "gray"}>{s.stock_refill_enabled ? "On" : "Off"}</Tag>}
      </div>
      {admin && (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12, fontWeight: 700, color: C.gray600 }}>
            At (India time)<input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ ...S.inp, width: 130 }} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12, fontWeight: 700, color: C.gray600 }}>
            Stock per SKU<input type="number" min={1} max={99999} value={qty} onChange={(e) => setQty(e.target.value)} style={{ ...S.inp, width: 120 }} />
          </label>
          {changed && <button onClick={() => save({ stock_refill_time: time, stock_refill_qty: Number(qty) })} disabled={busy} style={btn("primary", "sm")}>Save</button>}
        </div>
      )}
    </div>
  );
}

export function AutomationCard() {
  const [s, setS] = useState(null);
  const [draft, setDraft] = useState(null);
  const [newTime, setNewTime] = useState("17:00");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [admin, setAdmin] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`${API}/meesho-orders/automation/`).catch(() => null);
    if (res?.ok) { const d = await res.json(); setS(d); setDraft(d); }
    const ov = await fetch(`${API}/meesho-orders/overview/`).catch(() => null);
    if (ov?.ok) setAdmin((await ov.json()).is_admin);
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (patch) => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`${API}/meesho-orders/automation/`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ error: true, text: d.error || "Couldn't save." }); return; }
      setS(d); setDraft(d); setMsg({ error: false, text: "Saved — the worker follows it from the next minute." });
    } catch { setMsg({ error: true, text: "Network error." }); }
    finally { setBusy(false); }
  };

  if (!s || !draft) return null;
  const changed = draft.accept_every_minutes !== s.accept_every_minutes || draft.label_times.join() !== s.label_times.join();
  const addTime = () => {
    if (!newTime || draft.label_times.includes(newTime)) return;
    setDraft({ ...draft, label_times: [...draft.label_times, newTime].sort() });
  };

  return (
    <div style={{ ...S.card, padding: 18, display: "flex", flexDirection: "column", gap: 14, borderTop: `4px solid ${s.enabled ? C.green : C.gray300}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.gray900 }}>Automation</div>
          <div style={{ fontSize: 12.5, color: C.gray500, marginTop: 2 }}>
            For every connected business: accept pending orders on a schedule, and make the labels of every ready-to-ship
            order not downloaded yet at set times — ready to print under “Latest labels”.
          </div>
        </div>
        {admin ? (
          <button onClick={() => save({ enabled: !s.enabled })} disabled={busy}
            style={{ ...btn(s.enabled ? "ghost" : "primary", "md"), minWidth: 140, ...(s.enabled ? { color: C.red } : {}) }}>
            {s.enabled ? "Switch off" : "Switch on"}
          </button>
        ) : <Tag variant={s.enabled ? "green" : "gray"}>{s.enabled ? "On" : "Off"}</Tag>}
      </div>

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: C.gray600 }}>Accept pending orders</span>
          {admin ? (
            <select value={draft.accept_every_minutes} onChange={(e) => setDraft({ ...draft, accept_every_minutes: Number(e.target.value) })}
              style={{ ...S.inp, maxWidth: 260 }}>
              {s.accept_choices.map((m) => <option key={m} value={m}>{everyLabel(m)}</option>)}
            </select>
          ) : <b>{everyLabel(s.accept_every_minutes)}</b>}
          {s.enabled && <span style={{ fontSize: 12, color: C.gray500 }}>
            Last: {when(s.last_accept_at)}{s.next_accept_at ? ` · next: ${when(s.next_accept_at)}` : ""}
          </span>}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: C.gray600 }}>Make labels at (India time)</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {draft.label_times.length === 0 && <span style={{ fontSize: 12.5, color: C.gray400 }}>No label times — labels by hand only.</span>}
            {draft.label_times.map((t) => (
              <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 999,
                background: C.orangeLight, border: `1px solid ${C.orangeBorder}`, fontWeight: 800, fontSize: 13 }}>
                {timeLabel(t)}
                {admin && <button aria-label={`Remove ${timeLabel(t)}`} onClick={() => setDraft({ ...draft, label_times: draft.label_times.filter((x) => x !== t) })}
                  style={{ border: "none", background: "none", cursor: "pointer", color: C.gray500, fontSize: 15, lineHeight: 1, padding: 0 }}>×</button>}
              </span>
            ))}
          </div>
          {admin && (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} style={{ ...S.inp, width: 130 }} />
              <button onClick={addTime} style={btn("ghost", "sm")}>+ Add time</button>
            </div>
          )}
          {s.enabled && <span style={{ fontSize: 12, color: C.gray500 }}>
            Last: {when(s.last_labels_at)}{s.next_labels_at ? ` · next: ${when(s.next_labels_at)}` : ""}
          </span>}
        </div>
      </div>

      <SendLabels s={s} admin={admin} busy={busy} onToggle={() => save({ send_labels: !s.send_labels })} />
      <NightlyStock s={s} admin={admin} busy={busy} save={save} />

      {admin && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={() => save({ accept_every_minutes: draft.accept_every_minutes, label_times: draft.label_times })}
            disabled={!changed || busy} style={{ ...btn("primary", "md"), opacity: !changed || busy ? 0.5 : 1 }}>
            {busy ? "Saving…" : "Save schedule"}
          </button>
          {changed && <button onClick={() => setDraft(s)} style={btn("ghost", "md")}>Undo</button>}
          {msg && <span style={{ fontSize: 12.5, fontWeight: 700, color: msg.error ? C.red : C.green }}>{msg.text}</span>}
        </div>
      )}
      {!s.enabled && <div style={{ fontSize: 12, color: C.gray500 }}>
        Switched off — nothing is accepted or labelled by itself. Each copy of the app has its own switch, so a test copy stays off.
      </div>}
    </div>
  );
}

export async function fetchPdf(file, download) {
  const res = await fetch(`${API}/meesho-orders/label-files/${file.id}/pdf/${download ? "?download=1" : ""}`);
  if (!res.ok) throw new Error("Couldn't get the labels.");
  return URL.createObjectURL(await res.blob());
}

export function LatestLabels({ emptyHint = false }) {
  const [files, setFiles] = useState(null);
  const [meta, setMeta] = useState({ channels: [], admin: false });
  const [sent, setSent] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [itemsOf, setItemsOf] = useState(null);       // the file whose items table is open

  const load = useCallback(async () => {
    const res = await fetch(`${API}/meesho-orders/label-files/`).catch(() => null);
    if (res?.ok) {
      const d = await res.json();
      setFiles(d.files);
      setMeta({ channels: d.send_channels || [], admin: !!d.is_admin });
    }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  const print = async (f) => {
    setBusy(`p${f.id}`); setError(null);
    try {
      const url = await fetchPdf(f, false);
      // Print straight from a hidden frame; if the browser won't, open the PDF to print from its viewer.
      const frame = document.createElement("iframe");
      frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
      frame.src = url;
      frame.onload = () => {
        try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch { window.open(url, "_blank"); }
        setTimeout(() => { frame.remove(); URL.revokeObjectURL(url); }, 60000);
      };
      document.body.appendChild(frame);
    } catch (e) { setError(e.message); }
    finally { setBusy(null); }
  };
  const download = async (f) => {
    setBusy(`d${f.id}`); setError(null);
    try {
      const url = await fetchPdf(f, true);
      const a = document.createElement("a");
      a.href = url; a.download = f.file_name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) { setError(e.message); }
    finally { setBusy(null); }
  };

  // Send a kept PDF now — to the Telegram group (and any other channel set up).
  const send = async (f) => {
    setBusy(`s${f.id}`); setError(null); setSent(null);
    try {
      const res = await fetch(`${API}/meesho-orders/label-files/${f.id}/send/`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error || Object.values(d.sent || {}).join("; ") || "Couldn't send it."); return; }
      setSent(`Sent ${f.labels} labels — ${Object.entries(d.sent).map(([k, v]) => `${k}: ${v}`).join(", ")}`);
    } catch { setError("Network error."); }
    finally { setBusy(null); }
  };
  const canSend = meta.admin && meta.channels.length > 0;
  const sendLabel = meta.channels.includes("telegram") ? "Telegram" : meta.channels.map((c) => c[0].toUpperCase() + c.slice(1)).join(" / ");

  if (!files || files.length === 0) {
    if (!emptyHint || !files) return null;
    return (
      <div style={{ ...S.card, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 6, height: "100%", boxSizing: "border-box" }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: C.gray900 }}>Latest labels</span>
        <span style={{ fontSize: 12.5, color: C.gray500 }}>No labels yet. Generate them on Orders → Ready to ship, or set label times under Settings — they'll be here, sorted and ready to print.</span>
      </div>
    );
  }
  const [latest, ...older] = files;
  const Row = ({ f, big }) => (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: big ? 0 : "8px 0", borderTop: big ? "none" : `1px solid ${C.gray100}` }}>
      <div style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontWeight: 800, fontSize: big ? 15 : 13.5, color: C.gray900 }}>
          {f.labels} label{f.labels === 1 ? "" : "s"} · {when(f.created_at)}
          {" "}<Tag variant={f.trigger === "AUTO" ? "blue" : "gray"}>{f.trigger === "AUTO" ? "Automatic" : "Generated"}</Tag>
          {!f.sorted && <> <Tag variant="amber">Not sorted</Tag></>}
        </span>
        <span style={{ fontSize: 12, color: C.gray500 }}>{f.businesses.join(", ")}{f.sorted ? " · sorted by parent SKU" : ""}{f.pages ? ` · ${f.pages} pages` : ""}</span>
      </div>
      <button onClick={() => print(f)} disabled={!!busy} style={{ ...btn(big ? "primary" : "ghost", big ? "md" : "sm"), minWidth: big ? 110 : 0 }}>
        {busy === `p${f.id}` ? <CircularProgress size={13} style={{ color: big ? "#fff" : C.orange }} /> : "🖨 Print"}
      </button>
      <button onClick={() => setItemsOf(f)} title="What's on these labels — to pack from" style={btn(big ? "ghostOrange" : "ghost", big ? "md" : "sm")}>
        📋 Items
      </button>
      <button onClick={() => download(f)} disabled={!!busy} style={btn("ghost", big ? "md" : "sm")}>
        {busy === `d${f.id}` ? <CircularProgress size={13} style={{ color: C.orange }} /> : "⬇ Download"}
      </button>
      {canSend && (
        <button onClick={() => send(f)} disabled={!!busy} title={`Send this PDF to ${sendLabel} now`} style={btn("ghost", big ? "md" : "sm")}>
          {busy === `s${f.id}` ? <CircularProgress size={13} style={{ color: C.orange }} /> : `📨 Send to ${sendLabel}`}
        </button>
      )}
    </div>
  );

  return (
    <div style={{ ...S.card, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8, borderLeft: `5px solid ${C.orange}`, height: "100%", boxSizing: "border-box" }}>
      <span style={{ fontSize: 12, fontWeight: 800, color: C.orange, textTransform: "uppercase", letterSpacing: "0.05em" }}>Latest labels</span>
      <Row f={latest} big />
      {error && <span style={{ fontSize: 12.5, color: C.red, fontWeight: 700 }}>{error}</span>}
      {sent && <span style={{ fontSize: 12.5, color: "#15803D", fontWeight: 700 }}>✓ {sent}</span>}
      {older.length > 0 && (
        <>
          <button onClick={() => setShowAll((v) => !v)} style={{ ...btn("ghost", "sm"), alignSelf: "flex-start" }}>
            {showAll ? "Hide earlier" : `Earlier labels (${older.length})`}
          </button>
          {showAll && older.map((f) => <Row key={f.id} f={f} />)}
        </>
      )}
      {itemsOf && <LabelItems file={itemsOf} onClose={() => setItemsOf(null)} />}
    </div>
  );
}

// ── What's on a labels PDF ──────────────────────────────────────────────────

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function Thumb({ url, fallback, size = 44 }) {
  const [src, setSrc] = useState(url || fallback || "");
  useEffect(() => { setSrc(url || fallback || ""); }, [url, fallback]);
  if (!src) return <span style={{ width: size, height: size, borderRadius: 8, background: C.gray100, flexShrink: 0, display: "inline-block" }} />;
  return <img src={src} alt="" loading="lazy" onError={() => setSrc(src === url && fallback ? fallback : "")}
    style={{ width: size, height: size, borderRadius: 8, objectFit: "cover", flexShrink: 0, background: C.gray100 }} />;
}

/**
 * Every item on one labels PDF, to pack from: a pick list (each SKU and size
 * with how many pieces, over how many orders, and how many are packed) or the
 * orders one by one, in the PDF's order. Filter by courier, show only what's
 * left, search; print it or take it as CSV.
 */
export function LabelItems({ file, onClose, inline = false }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [view, setView] = useState("skus");
  const [courier, setCourier] = useState("");
  const [left, setLeft] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    fetch(`${API}/meesho-orders/label-files/${file.id}/items/`)
      .then(async (r) => { const d = await r.json().catch(() => ({})); if (r.ok) setData(d); else setErr(d.error || "Couldn't read the labels."); })
      .catch(() => setErr("Network error."));
  }, [file.id]);
  useEffect(() => {
    if (inline || !onClose) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, inline]);

  const couriers = data ? [...new Set(data.orders.map((o) => o.courier))].sort() : [];
  const needle = q.trim().toLowerCase();
  const orders = (data?.orders || []).filter((o) => (!courier || o.courier === courier) && (!left || !o.packed)
    && (!needle || [o.sku, o.order_id, o.awb, o.size].some((v) => String(v || "").toLowerCase().includes(needle))));
  // The pick list follows the same filters, from the orders that pass them.
  const skus = Object.values(orders.reduce((acc, o) => {
    const k = `${(o.sku || "").toLowerCase()}|${(o.size || "").toLowerCase()}`;
    const g = acc[k] || (acc[k] = { sku: o.sku, size: o.size, qty: 0, orders: 0, packed_qty: 0, image_url: o.image_url, image_fallback_url: o.image_fallback_url, couriers: {} });
    g.qty += o.qty; g.orders += 1; g.packed_qty += o.packed ? o.qty : 0;
    g.couriers[o.courier] = (g.couriers[o.courier] || 0) + 1;
    return acc;
  }, {})).sort((a, b) => b.qty - a.qty || String(a.sku).localeCompare(String(b.sku)));
  const pieces = orders.reduce((n, o) => n + o.qty, 0);
  const title = `Labels ${new Date(file.created_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" })}`;

  const csv = () => {
    const rows = view === "skus"
      ? [["SKU", "Size", "Pieces", "Orders", "Packed pieces", "Couriers"], ...skus.map((g) => [g.sku, g.size, g.qty, g.orders, g.packed_qty,
        Object.entries(g.couriers).map(([c, n]) => `${c} ${n}`).join("; ")])]
      : [["#", "Sub-order", "SKU", "Size", "Qty", "Courier", "AWB", "Business", "Packed"], ...orders.map((o, i) => [i + 1, o.order_id, o.sku, o.size, o.qty,
        o.courier, o.awb, o.business_name, o.packed ? "yes" : "no"])];
    const text = rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    a.download = `${title.replace(/[^A-Za-z0-9]+/g, "-")}-${view}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
  };
  const print = () => {
    const head = view === "skus" ? ["", "SKU", "Size", "Pieces", "Orders", "Couriers", "✓"] : ["#", "", "SKU", "Size", "Qty", "Courier", "AWB", "✓"];
    const img = (u) => (u ? `<img src="${esc(u)}" style="width:40px;height:40px;object-fit:cover;border-radius:4px">` : "");
    const body = view === "skus"
      ? skus.map((g) => `<tr><td>${img(g.image_url || g.image_fallback_url)}</td><td><b>${esc(g.sku)}</b></td><td>${esc(g.size)}</td><td style="font-size:18px"><b>${g.qty}</b></td><td>${g.orders}</td><td>${esc(Object.entries(g.couriers).map(([c, n]) => `${c} ${n}`).join(", "))}</td><td>☐</td></tr>`).join("")
      : orders.map((o, i) => `<tr><td>${i + 1}</td><td>${img(o.image_url || o.image_fallback_url)}</td><td><b>${esc(o.sku)}</b></td><td>${esc(o.size)}</td><td><b>${o.qty}</b></td><td>${esc(o.courier)}</td><td>${esc(o.awb)}</td><td>${o.packed ? "✔" : "☐"}</td></tr>`).join("");
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
      body{font-family:system-ui,sans-serif;margin:16px;color:#111} h1{font-size:16px;margin:0 0 4px} p{margin:0 0 10px;font-size:12px;color:#555}
      table{border-collapse:collapse;width:100%;font-size:12px} th,td{border:1px solid #ccc;padding:4px 6px;text-align:left;vertical-align:middle}
      th{background:#f3f4f6} tr{page-break-inside:avoid}</style></head><body>
      <h1>${esc(title)} — ${view === "skus" ? "pick list" : "orders"}</h1>
      <p>${esc((file.businesses || []).join(", "))} · ${orders.length} orders · ${pieces} pieces${courier ? ` · ${esc(courier)}` : ""}${left ? " · left to pack" : ""}</p>
      <table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></body></html>`);
    w.document.close();
    w.onload = () => w.print();
    setTimeout(() => { try { w.print(); } catch { /* the window was closed */ } }, 800);
  };

  const pill = (on) => ({ border: `1.5px solid ${on ? C.orange : C.gray200}`, background: on ? C.orangeLight : C.white, color: on ? C.orange : C.gray700,
    borderRadius: 999, padding: "6px 12px", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", minHeight: 36 });

  // A pop-up from Latest labels, or part of the Labels Downloaded page.
  const wrap = (content) => (inline ? content : (
    <div role="dialog" aria-modal="true" aria-label={`${title} — items`} onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 3500, background: "rgba(15,23,42,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
      {content}
    </div>
  ));
  return wrap(
      <div onClick={(e) => e.stopPropagation()} style={{ ...(inline ? {} : S.card), width: "100%", maxWidth: inline ? "none" : 1000,
        maxHeight: inline ? "75vh" : "94dvh", display: "flex", flexDirection: "column",
        padding: 0, overflow: "hidden", borderTop: inline ? `1px solid ${C.gray100}` : `5px solid ${C.orange}` }}>
        <div style={{ padding: "12px 14px", borderBottom: `1px solid ${C.gray100}`, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 17, fontWeight: 900, color: C.gray900 }}>📋 {title}</div>
              <div style={{ fontSize: 12.5, color: C.gray500 }}>
                {(file.businesses || []).join(", ")}{data ? ` · ${data.summary.orders} orders · ${data.summary.pieces} pieces · ${data.summary.skus} SKUs · ${data.summary.packed} packed` : ""}
              </div>
            </div>
            <button onClick={print} disabled={!data} style={btn("ghost", "sm")}>🖨 Print</button>
            <button onClick={csv} disabled={!data} style={btn("ghost", "sm")}>⬇ CSV</button>
            {onClose && <button onClick={onClose} aria-label="Close" style={{ ...btn("ghost", "sm"), minWidth: 36 }}>✕</button>}
          </div>
          {data && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button onClick={() => setView("skus")} style={pill(view === "skus")}>By SKU ({skus.length})</button>
              <button onClick={() => setView("orders")} style={pill(view === "orders")}>Every order ({orders.length})</button>
              <select value={courier} onChange={(e) => setCourier(e.target.value)} aria-label="Courier" style={{ ...S.inp, width: "auto", minHeight: 36 }}>
                <option value="">All couriers</option>
                {couriers.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13, fontWeight: 700 }}>
                <input type="checkbox" checked={left} onChange={(e) => setLeft(e.target.checked)} /> Left to pack only
              </label>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search SKU, sub-order, AWB…" aria-label="Search"
                style={{ ...S.inp, flex: 1, minWidth: 160, minHeight: 36 }} />
            </div>
          )}
        </div>
        <div style={{ overflowY: "auto", flex: 1 }}>
          {err ? <div style={{ padding: 20, color: C.red, fontWeight: 700 }}>✕ {err}</div>
            : !data ? <div style={{ display: "flex", justifyContent: "center", padding: 40 }}><CircularProgress style={{ color: C.orange }} /></div>
              : data.orders.length === 0 ? <div style={{ padding: 20, color: C.gray500 }}>No orders could be read off these labels.</div>
                : view === "skus" ? skus.map((g) => {
                  const done = g.packed_qty >= g.qty;
                  return (
                    <div key={`${g.sku}|${g.size}`} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 14px", borderBottom: `1px solid ${C.gray100}`,
                      background: done ? C.greenLight : C.white }}>
                      <Thumb url={g.image_url} fallback={g.image_fallback_url} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 14, color: C.gray900, wordBreak: "break-all" }}>{g.sku || "—"}
                          {g.size && <span style={{ fontFamily: "inherit", fontWeight: 700, fontSize: 12, color: C.gray500 }}> · {g.size}</span>}</div>
                        <div style={{ fontSize: 12, color: C.gray500 }}>{g.orders} order{g.orders === 1 ? "" : "s"} · {Object.entries(g.couriers).map(([c, n]) => `${c} ${n}`).join(", ")}</div>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div style={{ fontFamily: "monospace", fontWeight: 900, fontSize: 22, color: C.gray900, lineHeight: 1 }}>×{g.qty}</div>
                        <div style={{ fontSize: 11.5, fontWeight: 800, color: done ? "#15803D" : g.packed_qty ? C.orange : C.gray400 }}>
                          {done ? "✓ packed" : g.packed_qty ? `${g.packed_qty} packed` : "to pack"}</div>
                      </div>
                    </div>
                  );
                }) : orders.map((o, i) => (
                  <div key={o.order_id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 14px", borderBottom: `1px solid ${C.gray100}`,
                    background: o.packed ? C.greenLight : C.white }}>
                    <span style={{ width: 26, fontSize: 12, color: C.gray400, textAlign: "right", flexShrink: 0 }}>{i + 1}</span>
                    <Thumb url={o.image_url} fallback={o.image_fallback_url} size={40} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 13.5, color: C.gray900, wordBreak: "break-all" }}>{o.sku || "—"}
                        {o.size && <span style={{ fontFamily: "inherit", fontWeight: 700, fontSize: 12, color: C.gray500 }}> · {o.size}</span>}
                        {o.qty > 1 && <span style={{ marginLeft: 6, color: "#fff", background: C.red, borderRadius: 6, padding: "0 6px" }}>×{o.qty}</span>}</div>
                      <div style={{ fontSize: 12, color: C.gray500, wordBreak: "break-all" }}>{[o.courier, o.awb, o.order_id, o.business_name].filter(Boolean).join(" · ")}</div>
                    </div>
                    <Tag variant={o.packed ? "green" : "gray"}>{o.packed ? "✓ Packed" : "To pack"}</Tag>
                  </div>
                ))}
          {data?.summary.not_found > 0 && <div style={{ padding: "8px 14px", fontSize: 12, color: C.gray500 }}>{data.summary.not_found} label(s) on the PDF aren't in the labels table.</div>}
        </div>
      </div>
  );
}
