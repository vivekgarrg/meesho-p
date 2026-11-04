import React, { useState, useEffect, useCallback } from "react";
import { API, C, S, btn, Tag, useIsMobile } from "../../App";
import { CircularProgress } from "@mui/material";
import { LabelItems, fetchPdf } from "./MeeshoAutomation";

/*
 * Labels Downloaded — every labels PDF made (each automatic run, and each
 * Generate on Meesho Orders), newest first, with what's on it: the pick list
 * by SKU, or every order, packed vs left, by courier. The newest is open.
 *
 * For the packing desk: anyone with Order Scan sees it, without needing the
 * rest of Meesho.
 */

const when = (iso) => new Date(iso).toLocaleString("en-IN", { weekday: "short", day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" });

export function LabelsDownloadedTab() {
  const isMobile = useIsMobile();
  const [files, setFiles] = useState(null);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(null);         // the file whose items are shown
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    const res = await fetch(`${API}/meesho-orders/label-files/`).catch(() => null);
    if (!res) { setErr("Couldn't reach the server."); return; }
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(d.error || d.detail || "Couldn't read the labels."); return; }
    setErr(null);
    setFiles(d.files || []);
    setOpen((o) => o ?? (d.files?.[0]?.id || null));
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);

  const pdf = async (f, download) => {
    setBusy(`${download ? "d" : "p"}${f.id}`);
    try {
      const url = await fetchPdf(f, download);
      if (download) {
        const a = document.createElement("a");
        a.href = url; a.download = f.file_name;
        document.body.appendChild(a); a.click(); a.remove();
      } else {
        window.open(url, "_blank");
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { setErr(e.message); }
    finally { setBusy(null); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 1100 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: C.gray900, margin: 0 }}>Labels downloaded</h1>
        <p style={{ fontSize: 13, color: C.gray500, margin: "4px 0 0" }}>
          Every labels PDF made — each automatic run and each Generate — with what's on it, to pack from. Newest first.
        </p>
      </div>
      {err && <div role="alert" style={{ color: C.red, fontWeight: 700, fontSize: 13.5 }}>✕ {err}</div>}
      {!files ? <div style={{ display: "flex", justifyContent: "center", padding: 40 }}><CircularProgress style={{ color: C.orange }} /></div>
        : files.length === 0 ? (
          <div style={{ ...S.card, padding: 20, color: C.gray500, fontSize: 13.5 }}>
            No labels yet. They appear here after each automatic label run (set the times under Meesho → Settings) or a Generate on Meesho Orders → Ready to ship.
          </div>
        ) : files.map((f, i) => {
          const isOpen = open === f.id;
          return (
            <div key={f.id} style={{ ...S.card, padding: 0, overflow: "hidden", borderLeft: `5px solid ${i === 0 ? C.orange : C.gray200}` }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: isMobile ? "10px 12px" : "12px 16px" }}>
                <button onClick={() => setOpen(isOpen ? null : f.id)} aria-expanded={isOpen}
                  style={{ flex: 1, minWidth: 200, textAlign: "left", background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit" }}>
                  <div style={{ fontWeight: 900, fontSize: 15, color: C.gray900 }}>
                    {isOpen ? "▾" : "▸"} {f.labels} label{f.labels === 1 ? "" : "s"} · {when(f.created_at)}{" "}
                    <Tag variant={f.trigger === "AUTO" ? "blue" : "gray"}>{f.trigger === "AUTO" ? "Automatic" : "Generated"}</Tag>
                    {i === 0 && <> <Tag variant="amber">Latest</Tag></>}
                  </div>
                  <div style={{ fontSize: 12.5, color: C.gray500, marginTop: 2 }}>
                    {f.businesses.join(", ")}{f.sorted ? " · sorted by parent SKU" : ""}{f.pages ? ` · ${f.pages} pages` : ""}
                  </div>
                </button>
                <button onClick={() => pdf(f, false)} disabled={!!busy} style={btn("ghost", "sm")}>
                  {busy === `p${f.id}` ? <CircularProgress size={13} style={{ color: C.orange }} /> : "🖨 Open PDF"}</button>
                <button onClick={() => pdf(f, true)} disabled={!!busy} style={btn("ghost", "sm")}>
                  {busy === `d${f.id}` ? <CircularProgress size={13} style={{ color: C.orange }} /> : "⬇ Download"}</button>
                {!isOpen && <button onClick={() => setOpen(f.id)} style={btn("ghostOrange", "sm")}>📋 Items</button>}
              </div>
              {isOpen && <LabelItems file={f} inline />}
            </div>
          );
        })}
    </div>
  );
}
