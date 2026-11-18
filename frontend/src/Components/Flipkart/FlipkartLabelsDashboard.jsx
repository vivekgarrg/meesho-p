import React, { useCallback, useEffect, useState } from "react";
import { API, C, S, btn, useIsMobile } from "../../App";

/*
 * Overview → Flipkart → Labels: every Flipkart labels run — automatic, by hand,
 * reprints — with how it went and its PDF to print or download again, the
 * totals, and a Reprint for orders whose labels are printed and waiting RTD.
 * Server: flipkart_auto.label_runs_view / reprint_view.
 */

const BLUE = "#2874F0";
const STATUS = {
  OK: { label: "Printed", color: "#15803D", bg: "#DCFCE7" },
  PARTIAL: { label: "Partly printed", color: "#B45309", bg: "#FEF3C7" },
  EMPTY: { label: "Nothing to print", color: C.gray600, bg: C.gray100 },
  FAILED: { label: "Failed", color: C.red, bg: "#FEE2E2" },
};
const at = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—");
const kindOf = (r) => (r.kind === "reprint" ? "Reprint" : r.trigger === "AUTO" ? "Automatic" : "Run by hand");

async function call(path, method = "GET", body) {
  const r = await fetch(`${API}/flipkart-seller/${path}`, {
    method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined,
  });
  return { ok: r.ok, data: await r.json().catch(() => ({})) };
}

async function pdfUrl(fileId, download) {
  const res = await fetch(`${API}/meesho-orders/label-files/${fileId}/pdf/${download ? "?download=1" : ""}`);
  if (!res.ok) throw new Error("Couldn't open that labels file.");
  return URL.createObjectURL(await res.blob());
}

function Tile({ label, value, sub, color = C.gray900 }) {
  return (
    <div style={{ ...S.card, padding: "12px 14px", minWidth: 0, borderTop: `4px solid ${color}` }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.gray600 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 900, color: C.gray900, fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: C.gray500 }}>{sub}</div>}
    </div>
  );
}

export function FlipkartLabelsDashboard() {
  const mobile = useIsMobile();
  const [days, setDays] = useState(30);
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState(null);
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    const r = await call(`label-runs/?days=${days}`);
    if (r.ok) { setD(r.data); setErr(null); } else setErr(r.data.error || "Couldn't read the labels history.");
  }, [days]);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);

  const print = async (id) => {
    setBusy(`p${id}`);
    try { window.open(await pdfUrl(id, false), "_blank"); } catch (e) { setNote({ ok: false, text: e.message }); }
    setBusy(null);
  };
  const download = async (id, name) => {
    setBusy(`d${id}`);
    try {
      const a = document.createElement("a");
      a.href = await pdfUrl(id, true); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { setNote({ ok: false, text: e.message }); }
    setBusy(null);
  };
  const reprint = async (b) => {
    setBusy(`r${b.business}`); setNote(null);
    const r = await call("auto/reprint/", "POST", { business: b.business });
    setBusy(null);
    const res = r.data.results?.[b.business_name];
    if (!r.ok && !res) setNote({ ok: false, text: r.data.error || "The reprint failed." });
    else if (res?.error) setNote({ ok: false, text: `${b.business_name}: ${res.error}` });
    else {
      setNote({ ok: true, text: `${b.business_name}: ${(res?.steps || []).join(" · ")}` });
      if (res?.file_id) print(res.file_id);
    }
    load();
  };

  if (!d) return err ? <div role="alert" style={{ ...S.card, color: C.red, fontWeight: 700 }}>✕ {err}</div>
    : <div style={{ padding: 40, textAlign: "center", color: C.gray400 }}>Loading the labels history…</div>;
  const t = d.totals, td = d.today;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 260px", fontSize: 13, color: C.gray500 }}>
          Every Flipkart labels run — automatic, by hand, reprints — and its PDF, kept to print or download again.
        </div>
        <div role="tablist" aria-label="Period" style={{ display: "flex", gap: 3, padding: 3, borderRadius: 10, background: C.gray100 }}>
          {[7, 30, 90].map((n) => (
            <button key={n} role="tab" aria-selected={days === n} onClick={() => setDays(n)}
              style={{ border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
                background: days === n ? BLUE : "transparent", color: days === n ? "#fff" : C.gray600 }}>{n} days</button>
          ))}
        </div>
        <a href="/business-profile?section=flipkart&part=automation" style={{ fontSize: 12.5, fontWeight: 800, color: BLUE }}>Automation settings →</a>
      </div>

      <div style={{ display: "grid", gap: 10, gridTemplateColumns: mobile ? "repeat(2, minmax(0, 1fr))" : "repeat(5, minmax(0, 1fr))" }}>
        <Tile label="Printed today" value={td.printed} sub={`${td.runs} run${td.runs === 1 ? "" : "s"} today`} color={BLUE} />
        <Tile label="Marked RTD today" value={td.rtd} color="#15803D" />
        <Tile label={`Printed · ${days} days`} value={t.printed} sub={`${t.runs} runs · ${t.accepted} accepted`} color={BLUE} />
        <Tile label={`Marked RTD · ${days} days`} value={t.rtd} color="#15803D" />
        <Tile label="Not printed / failed" value={`${t.not_printed} · ${t.failed}`} sub="orders left · runs failed" color={t.failed || t.not_printed ? C.red : C.gray300} />
      </div>

      {d.businesses.length > 0 && (
        <section style={{ ...S.card, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontWeight: 900, fontSize: 14, color: C.gray900 }}>Reprint</div>
          <div style={{ fontSize: 12.5, color: C.gray500 }}>
            The labels of every order already printed and waiting to be marked Ready to Dispatch, again — as Seller Hub's Reprint.
            The PDF is kept below. Nothing is marked RTD.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {d.businesses.map((b) => (
              <button key={b.business} onClick={() => reprint(b)} disabled={!b.connected || !!busy} title={b.connected ? "" : "Not connected — log in under Business Settings → Flipkart setup"}
                style={{ ...btn("ghost", "sm"), opacity: b.connected ? 1 : 0.5 }}>
                {busy === `r${b.business}` ? "Reprinting…" : `🖨 Reprint · ${b.business_name}`}{b.connected ? "" : " (not connected)"}
              </button>
            ))}
          </div>
        </section>
      )}
      {note && <div role="status" style={{ fontSize: 13, fontWeight: 700, color: note.ok ? "#15803D" : C.red }}>{note.ok ? "✓ " : "✕ "}{note.text}</div>}

      <section style={{ ...S.card, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 14px", fontWeight: 900, fontSize: 14, color: C.gray900, borderBottom: `1px solid ${C.gray100}` }}>
          Labels history · {d.runs.length} run{d.runs.length === 1 ? "" : "s"} in {days} days
        </div>
        {d.runs.length === 0 ? (
          <div style={{ padding: 22, fontSize: 13, color: C.gray500 }}>
            No Flipkart labels runs yet. They run at the label times under Automation settings, or by Run now / the one-order test there.
          </div>
        ) : d.runs.map((r) => {
          const st = STATUS[r.status] || STATUS.OK;
          const isOpen = open === r.id;
          return (
            <div key={r.id} style={{ borderTop: `1px solid ${C.gray100}`, padding: mobile ? "10px 12px" : "10px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontWeight: 900, fontSize: 13.5, color: C.gray900, minWidth: 120 }}>{at(r.started_at)}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: C.gray700 }}>{r.business_name}</span>
                <span style={{ fontSize: 11.5, fontWeight: 800, color: C.gray600, background: C.gray100, borderRadius: 999, padding: "2px 8px" }}>{kindOf(r)}</span>
                <span style={{ fontSize: 11.5, fontWeight: 800, color: st.color, background: st.bg, borderRadius: 999, padding: "2px 8px" }}>{st.label}</span>
                <span style={{ fontSize: 12.5, color: C.gray600, flex: "1 1 200px" }}>
                  {r.kind === "reprint" ? `${r.printed} reprinted` : `${r.accepted} accepted · ${r.printed} printed · ${r.rtd} marked RTD`}
                  {r.not_printed ? <b style={{ color: C.red }}> · {r.not_printed} not printed</b> : null}
                </span>
                {r.file && (
                  <span style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => print(r.file.id)} disabled={!!busy} style={btn("primary", "sm")}>{busy === `p${r.file.id}` ? "Opening…" : "🖨 Print"}</button>
                    <button onClick={() => download(r.file.id, r.file.name)} disabled={!!busy} style={btn("ghost", "sm")}>⬇ Download</button>
                  </span>
                )}
                <button onClick={() => setOpen(isOpen ? null : r.id)} aria-expanded={isOpen}
                  style={{ border: "none", background: "none", color: BLUE, fontWeight: 800, fontSize: 12, cursor: "pointer", padding: 0 }}>{isOpen ? "Less" : "Details"}</button>
              </div>
              {r.error && <div style={{ fontSize: 12.5, color: C.red }}>✕ {r.error}</div>}
              {isOpen && (
                <div style={{ fontSize: 12.5, color: C.gray600, background: C.gray50, borderRadius: 8, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 3 }}>
                  {(r.steps || []).map((s, i) => <div key={i}>• {s}</div>)}
                  {r.file && <div>PDF: {r.file.labels} labels · {r.file.pages} pages{r.file.sorted ? " · sorted by parent SKU" : " · not sorted"} — also under <a href="/label-items" style={{ color: BLUE }}>Labels Downloaded</a></div>}
                  <div>Took {r.finished_at ? Math.max(1, Math.round((new Date(r.finished_at) - new Date(r.started_at)) / 1000)) : "—"} s</div>
                </div>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}
