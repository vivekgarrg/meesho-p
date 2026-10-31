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

async function fetchPdf(file, download) {
  const res = await fetch(`${API}/meesho-orders/label-files/${file.id}/pdf/${download ? "?download=1" : ""}`);
  if (!res.ok) throw new Error("Couldn't get the labels.");
  return URL.createObjectURL(await res.blob());
}

export function LatestLabels({ emptyHint = false }) {
  const [files, setFiles] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`${API}/meesho-orders/label-files/`).catch(() => null);
    if (res?.ok) setFiles((await res.json()).files);
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
      <button onClick={() => download(f)} disabled={!!busy} style={btn("ghost", big ? "md" : "sm")}>
        {busy === `d${f.id}` ? <CircularProgress size={13} style={{ color: C.orange }} /> : "⬇ Download"}
      </button>
    </div>
  );

  return (
    <div style={{ ...S.card, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8, borderLeft: `5px solid ${C.orange}`, height: "100%", boxSizing: "border-box" }}>
      <span style={{ fontSize: 12, fontWeight: 800, color: C.orange, textTransform: "uppercase", letterSpacing: "0.05em" }}>Latest labels</span>
      <Row f={latest} big />
      {error && <span style={{ fontSize: 12.5, color: C.red, fontWeight: 700 }}>{error}</span>}
      {older.length > 0 && (
        <>
          <button onClick={() => setShowAll((v) => !v)} style={{ ...btn("ghost", "sm"), alignSelf: "flex-start" }}>
            {showAll ? "Hide earlier" : `Earlier labels (${older.length})`}
          </button>
          {showAll && older.map((f) => <Row key={f.id} f={f} />)}
        </>
      )}
    </div>
  );
}
