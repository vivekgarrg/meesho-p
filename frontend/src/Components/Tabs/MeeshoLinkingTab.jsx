import React, { useState, useEffect, useCallback, useRef } from "react";
import { API, C, S, btn, Tag, useIsMobile } from "../../App";
import { CircularProgress } from "@mui/material";

/*
 * Meesho Orders → Order linking: link each shipment's AWB to its packet QR
 * ("KP…") at the packing desk. Scan the two in either order; the link is
 * checked against the packet Meesho has for that AWB, stored, and the parcel
 * is recorded PACKED in Order Scan (so the packed counts are right). Every
 * attempt is logged — a failed one can be corrected and retried from the log.
 */

const isPacket = (c) => /^KP[A-Z0-9]{6,}$/.test(c);
const clean = (c) => String(c || "").replace(/\s+/g, "").toUpperCase();
const time = (iso) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "—");
const when = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" }) : "—");
const CHECK = {
  MATCH: { label: "Matches Meesho", tag: "green" },
  UNKNOWN: { label: "Not in Meesho data yet", tag: "gray" },
  OVERRIDDEN: { label: "Linked anyway", tag: "amber" },
};

async function call(path, method = "GET", body) {
  const res = await fetch(`${API}/meesho-orders/linking/${path}`, {
    method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

function Logs({ onChanged }) {
  const [errorsOnly, setErrorsOnly] = useState(true);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState({});        // log id → {awb, packet_id}
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState(null);

  const load = useCallback(async () => {
    const p = new URLSearchParams({ page: String(page) });
    if (errorsOnly) p.set("errors", "1");
    if (q.trim()) p.set("q", q.trim());
    const r = await call(`logs/?${p}`);
    if (r.ok) setData(r.data);
  }, [errorsOnly, q, page]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [errorsOnly, q]);

  const retry = async (log, override = false) => {
    setBusy(log.id); setNote(null);
    const e = editing[log.id] || {};
    const r = await call(`logs/${log.id}/`, "POST", { awb: e.awb ?? log.awb, packet_id: e.packet_id ?? log.packet_id, override });
    setBusy(null);
    setNote(r.ok ? { ok: true, text: `Linked ${r.data.link.awb} → ${r.data.link.packet_id} and marked packed.` }
      : { ok: false, text: r.data.error || "Retry failed.", log, canOverride: r.data.can_override });
    load(); onChanged();
  };
  const handled = async (log) => {
    await call(`logs/${log.id}/`, "PATCH", { resolved: !log.resolved });
    load(); onChanged();
  };

  return (
    <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "12px 14px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderBottom: `1px solid ${C.gray100}` }}>
        <span style={{ fontWeight: 800, fontSize: 14.5, flex: 1, minWidth: 140 }}>Log</span>
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13, fontWeight: 700 }}>
          <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} /> Open problems only
        </label>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search AWB, packet, error…" style={{ ...S.inp, width: 220 }} />
      </div>
      {note && (
        <div style={{ padding: "8px 14px", fontSize: 13, fontWeight: 700, color: note.ok ? C.green : C.red, display: "flex", gap: 8, alignItems: "center" }}>
          {note.text}
          {note.canOverride && <button onClick={() => retry(note.log, true)} style={{ ...btn("ghost", "sm"), color: "#B45309" }}>Link anyway</button>}
        </div>
      )}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead><tr>{["When", "What", "AWB", "Packet", "Result", "By", ""].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {data?.logs.length === 0 && <tr><td colSpan={7} style={{ ...S.td, textAlign: "center", color: C.gray400, padding: 20 }}>{errorsOnly ? "No open problems." : "Nothing logged yet."}</td></tr>}
            {data?.logs.map((l) => {
              const e = editing[l.id];
              const fixable = !l.ok && !l.resolved && ["LINK", "RELINK", "RETRY"].includes(l.action);
              return (
                <tr key={l.id} style={{ background: !l.ok && !l.resolved ? "#FEF2F2" : undefined }}>
                  <td style={{ ...S.td, whiteSpace: "nowrap", color: C.gray500 }}>{when(l.at)}</td>
                  <td style={S.td}>{l.action.toLowerCase()}{l.business_name ? <div style={{ fontSize: 11, color: C.gray400 }}>{l.business_name}</div> : null}</td>
                  <td style={{ ...S.td, fontFamily: "monospace" }}>
                    {e ? <input value={e.awb} onChange={(ev) => setEditing({ ...editing, [l.id]: { ...e, awb: clean(ev.target.value) } })} style={{ ...S.inp, width: 150, padding: "3px 6px" }} />
                      : l.awb || "—"}
                  </td>
                  <td style={{ ...S.td, fontFamily: "monospace" }}>
                    {e ? <input value={e.packet_id} onChange={(ev) => setEditing({ ...editing, [l.id]: { ...e, packet_id: clean(ev.target.value) } })} style={{ ...S.inp, width: 150, padding: "3px 6px" }} />
                      : l.packet_id || "—"}
                  </td>
                  <td style={{ ...S.td, maxWidth: 380 }}>
                    {l.ok ? <Tag variant="green">OK</Tag> : l.resolved ? <Tag variant="gray">Handled</Tag> : <Tag variant="red">Failed</Tag>}
                    {l.error && <div style={{ fontSize: 12, color: l.ok || l.resolved ? C.gray500 : C.red, marginTop: 3 }}>{l.error}</div>}
                  </td>
                  <td style={{ ...S.td, color: C.gray500 }}>{l.user || "—"}</td>
                  <td style={{ ...S.td, whiteSpace: "nowrap" }}>
                    {fixable && !e && <button onClick={() => setEditing({ ...editing, [l.id]: { awb: l.awb, packet_id: l.packet_id } })} style={btn("ghost", "sm")}>Edit</button>}
                    {fixable && <button onClick={() => retry(l)} disabled={busy === l.id} style={{ ...btn("primary", "sm"), marginLeft: 4 }}>{busy === l.id ? "…" : "Retry"}</button>}
                    {!l.ok && <button onClick={() => handled(l)} style={{ ...btn("ghost", "sm"), marginLeft: 4 }}>{l.resolved ? "Reopen" : "Mark handled"}</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {data && data.total > data.page_size && (
        <div style={{ padding: 10, display: "flex", gap: 8, justifyContent: "center", alignItems: "center", fontSize: 12.5 }}>
          <button disabled={page <= 1} onClick={() => setPage(page - 1)} style={btn("ghost", "sm")}>‹ Newer</button>
          Page {page} of {Math.ceil(data.total / data.page_size)}
          <button disabled={page * data.page_size >= data.total} onClick={() => setPage(page + 1)} style={btn("ghost", "sm")}>Older ›</button>
        </div>
      )}
    </div>
  );
}

export function MeeshoLinkingTab() {
  const isMobile = useIsMobile();
  const [data, setData] = useState(null);
  const [awb, setAwb] = useState("");
  const [packet, setPacket] = useState("");
  const [input, setInput] = useState("");
  const [result, setResult] = useState(null);
  const [sending, setSending] = useState(false);
  const [q, setQ] = useState("");
  const [logKey, setLogKey] = useState(0);
  const [courierBusy, setCourierBusy] = useState(false);
  const inputRef = useRef(null);

  const load = useCallback(async () => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    const r = await call(`?${p}`);
    if (r.ok) setData(r.data);
  }, [q]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const link = async (a, p, override = false) => {
    setSending(true);
    const r = await call("", "POST", { awb: a, packet_id: p, override });
    setSending(false);
    if (r.ok) {
      setResult({ ok: true, ...r.data });
      setAwb(""); setPacket("");
    } else {
      setResult({ ok: false, awb: a, packet: p, ...r.data });
    }
    load(); setLogKey((k) => k + 1);
    inputRef.current?.focus();
  };

  // A scanner types the code and presses Enter.
  const scan = (e) => {
    e.preventDefault();
    const code = clean(input);
    setInput("");
    if (!code) return;
    let a = awb, p = packet;
    if (isPacket(code)) p = code; else a = code;
    setAwb(a); setPacket(p);
    if (a && p) link(a, p);
  };

  const unlink = async (l) => {
    if (!window.confirm(`Unlink AWB ${l.awb} from packet ${l.packet_id}? (It stays packed in Order Scan.)`)) return;
    await call(`${l.id}/`, "DELETE");
    load(); setLogKey((k) => k + 1);
  };
  const refreshCouriers = async () => {
    setCourierBusy(true);
    await call("couriers/refresh/", "POST");
    setCourierBusy(false);
    load();
  };
  const renameCourier = async (c) => {
    const name = window.prompt(`Name for courier #${c.carrier_id}:`, c.name || "");
    if (name === null) return;
    await call(`couriers/${c.carrier_id}/`, "PATCH", { name });
    load();
  };

  if (!data) return <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><CircularProgress style={{ color: C.orange }} /></div>;
  const r = result;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <p style={{ fontSize: 13, color: C.gray500, margin: 0, maxWidth: 780 }}>
        Scan the AWB on the label and the packet QR (“KP…”), in either order. Each link is checked against the packet Meesho has for that AWB,
        stored, and the parcel is marked <b>packed</b> in Order Scan. Everything is logged below.
      </p>

      <div style={{ ...S.card, padding: 16, display: "flex", flexDirection: "column", gap: 12, borderTop: `4px solid ${C.orange}` }}>
        <form onSubmit={scan} style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} autoFocus disabled={sending}
            placeholder={!awb && !packet ? "Scan the AWB or the packet QR…" : awb ? "Now scan the packet QR (KP…)" : "Now scan the AWB on the label"}
            style={{ ...S.inp, flex: 1, minWidth: 240, fontSize: 18, fontFamily: "monospace", padding: "12px 14px" }} />
          <button type="submit" disabled={sending} style={{ ...btn("primary", "md"), minWidth: 100 }}>{sending ? "Linking…" : "Enter"}</button>
        </form>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", fontSize: 13 }}>
          <span style={{ padding: "6px 12px", borderRadius: 10, border: `1.5px dashed ${awb ? C.green : C.gray300}`, fontFamily: "monospace", fontWeight: 800 }}>
            AWB: {awb || "—"}
          </span>
          <span style={{ fontSize: 16, color: C.gray400 }}>↔</span>
          <span style={{ padding: "6px 12px", borderRadius: 10, border: `1.5px dashed ${packet ? C.green : C.gray300}`, fontFamily: "monospace", fontWeight: 800 }}>
            Packet: {packet || "—"}
          </span>
          {(awb || packet) && <button onClick={() => { setAwb(""); setPacket(""); inputRef.current?.focus(); }} style={btn("ghost", "sm")}>Clear</button>}
        </div>
        {r && (r.ok ? (
          <div role="status" style={{ background: C.greenLight, border: `1.5px solid ${C.greenBorder}`, borderRadius: 12, padding: "10px 14px", color: "#166534", fontSize: 13.5 }}>
            <b>✓ Linked and packed</b> — AWB <b style={{ fontFamily: "monospace" }}>{r.link.awb}</b> ↔ <b style={{ fontFamily: "monospace" }}>{r.link.packet_id}</b>
            {" · "}{r.link.business_name}{r.link.sub_order_no ? ` · ${r.link.sub_order_no}` : ""}{r.link.sku ? ` · ${r.link.sku}` : ""}
            {" · "}{r.link.courier || (r.link.carrier_id ? `courier #${r.link.carrier_id}` : "courier not known")}
            {" "}<Tag variant={CHECK[r.link.check]?.tag}>{CHECK[r.link.check]?.label}</Tag>
            {r.previous_packet && r.previous_packet !== r.link.packet_id && <div>Was linked to {r.previous_packet} before.</div>}
            {r.already_scanned && <div>This parcel had been scanned before — now marked packed.</div>}
          </div>
        ) : (
          <div role="alert" style={{ background: C.redLight, border: `1.5px solid ${C.redBorder}`, borderRadius: 12, padding: "10px 14px", color: C.red, fontSize: 13.5, fontWeight: 700, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ flex: 1, minWidth: 220 }}>✗ {r.error}</span>
            {r.can_override && <button onClick={() => link(r.awb, r.packet, true)} style={{ ...btn("ghost", "sm"), color: "#B45309" }}>Link anyway</button>}
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gap: 10, gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))" }}>
        <div style={{ ...S.card, padding: "12px 14px" }}><div style={{ fontSize: 12.5, fontWeight: 800, color: C.green }}>Linked today</div><div style={{ fontFamily: "monospace", fontSize: 28, fontWeight: 900 }}>{data.count}</div></div>
        <div style={{ ...S.card, padding: "12px 14px" }}><div style={{ fontSize: 12.5, fontWeight: 800, color: "#2563EB" }}>Match Meesho</div><div style={{ fontFamily: "monospace", fontSize: 28, fontWeight: 900 }}>{data.matched}</div></div>
        <div style={{ ...S.card, padding: "12px 14px" }}><div style={{ fontSize: 12.5, fontWeight: 800, color: C.red }}>Open problems</div><div style={{ fontFamily: "monospace", fontSize: 28, fontWeight: 900 }}>{data.open_errors}</div></div>
        <div style={{ ...S.card, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 3 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: C.gray600 }}>By courier</div>
          {data.by_courier.length === 0 ? <span style={{ fontSize: 12, color: C.gray400 }}>—</span>
            : data.by_courier.map((c) => <span key={c.courier} style={{ fontSize: 12.5 }}><b>{c.count}</b> {c.courier}</span>)}
        </div>
      </div>

      <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 14px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderBottom: `1px solid ${C.gray100}` }}>
          <span style={{ fontWeight: 800, fontSize: 14.5, flex: 1 }}>Today's links</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search AWB, packet, sub-order, SKU…" style={{ ...S.inp, width: 240 }} />
        </div>
        <div style={{ overflowX: "auto", maxHeight: 460, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead><tr>{["Time", "AWB", "Packet", "Business", "Sub-order / SKU", "Courier", "Check", "Order Scan", ""].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {data.links.length === 0 && <tr><td colSpan={9} style={{ ...S.td, textAlign: "center", color: C.gray400, padding: 20 }}>Nothing linked yet today.</td></tr>}
              {data.links.map((l) => (
                <tr key={l.id}>
                  <td style={{ ...S.td, whiteSpace: "nowrap", color: C.gray500 }}>{time(l.linked_at)}</td>
                  <td style={{ ...S.td, fontFamily: "monospace" }}>{l.awb}</td>
                  <td style={{ ...S.td, fontFamily: "monospace" }}>{l.packet_id}</td>
                  <td style={S.td}>{l.business_name}</td>
                  <td style={S.td}><span style={{ fontFamily: "monospace" }}>{l.sub_order_no || "—"}</span><div style={{ fontSize: 11.5, color: C.gray500 }}>{l.sku}</div></td>
                  <td style={S.td}>{l.courier || (l.carrier_id ? `#${l.carrier_id}` : "—")}</td>
                  <td style={S.td}><Tag variant={CHECK[l.check]?.tag}>{CHECK[l.check]?.label}</Tag></td>
                  <td style={S.td}>{l.scan_status ? <Tag variant={l.scan_status === "PACKED" ? "green" : "blue"}>{l.scan_status.toLowerCase()}</Tag> : "—"}</td>
                  <td style={S.td}><button onClick={() => unlink(l)} title="Unlink" style={{ border: "none", background: "none", color: C.gray400, cursor: "pointer", fontSize: 16 }}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ ...S.card, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 800, fontSize: 14.5, flex: 1 }}>Courier partners</span>
          <button onClick={refreshCouriers} disabled={courierBusy} style={btn("ghost", "sm")}>{courierBusy ? "Reading…" : "↻ Learn from shipments & labels"}</button>
        </div>
        <span style={{ fontSize: 12, color: C.gray500 }}>Meesho names couriers only by id; each id's name is read off the labels of its shipments.{data.is_admin ? " Click a name to change it." : ""}</span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {data.couriers.length === 0 && <span style={{ fontSize: 12.5, color: C.gray400 }}>None yet — press “Learn from shipments & labels”.</span>}
          {data.couriers.map((c) => (
            <button key={c.carrier_id} onClick={data.is_admin ? () => renameCourier(c) : undefined}
              style={{ border: `1px solid ${C.gray200}`, background: C.white, borderRadius: 10, padding: "6px 10px", fontSize: 12.5, cursor: data.is_admin ? "pointer" : "default", textAlign: "left" }}>
              <span style={{ color: C.gray400, fontFamily: "monospace" }}>#{c.carrier_id}</span> <b>{c.name || "name not known"}</b>
              <span style={{ color: C.gray400 }}> · {c.shipments} shipments{c.source === "manual" ? " · set by hand" : ""}</span>
            </button>
          ))}
        </div>
      </div>

      <Logs key={logKey} onChanged={load} />
    </div>
  );
}
