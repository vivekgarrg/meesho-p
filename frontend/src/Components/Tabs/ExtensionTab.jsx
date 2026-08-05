import React, { useState, useEffect, useCallback, useRef } from "react";
import { API, C, S, btn, Tag, useIsMobile } from "../../App";
import ExtensionIcon from "@mui/icons-material/Extension";
import DownloadIcon from "@mui/icons-material/Download";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import { CircularProgress } from "@mui/material";

// The download/info endpoints are not business-scoped — the client is the same
// whichever business you're looking at — so they sit outside the API base.
const EXT_INFO = "/api/extension/info/";
const EXT_DOWNLOAD = "/api/extension/download/";

const fmtBytes = (n) =>
  n == null ? "—" : n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`;

const fmtWhen = (iso) => (iso ? new Date(iso).toLocaleString("en-IN") : "—");

function Step({ n, title, children }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <div style={{
        width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
        background: C.orangeLight, color: C.orange,
        border: `1px solid ${C.orangeBorder}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 12, fontWeight: 800,
      }}>{n}</div>
      <div style={{ paddingTop: 2 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.gray800 }}>{title}</div>
        {children && <div style={{ fontSize: 12, color: C.gray500, marginTop: 3, lineHeight: 1.6 }}>{children}</div>}
      </div>
    </div>
  );
}

export function ExtensionTab() {
  const isMobile = useIsMobile();

  const [info, setInfo] = useState(null);
  const [infoError, setInfoError] = useState(null);
  const [loading, setLoading] = useState(true);

  const [templates, setTemplates] = useState([]);
  const [tplLoading, setTplLoading] = useState(false);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(EXT_INFO);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || data.available === false) {
          setInfoError(data.error || "The extension isn't available on this server.");
        } else {
          setInfo(data);
        }
      } catch {
        if (!cancelled) setInfoError("Could not reach the server.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const loadTemplates = useCallback(async () => {
    setTplLoading(true);
    try {
      const res = await fetch(`${API}/listing-templates/?full=0`);
      const data = await res.json();
      setTemplates(res.ok ? data.results || [] : []);
    } catch {
      setTemplates([]);
    } finally {
      setTplLoading(false);
    }
  }, []);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  const exportTemplates = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`${API}/listing-templates/export/`);
      if (!res.ok) throw new Error();
      const payload = await res.json();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `meesho-templates-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg({ type: "success", text: `Exported ${Object.keys(payload).length} template(s).` });
    } catch {
      setMsg({ type: "error", text: "Export failed." });
    } finally {
      setBusy(false);
    }
  };

  const importTemplates = async (file) => {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const text = await file.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        setMsg({ type: "error", text: "That file isn't valid JSON." });
        return;
      }
      const res = await fetch(`${API}/listing-templates/import/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templates: parsed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ type: "error", text: data.error || "Import failed." });
        return;
      }
      const bits = [`${data.created} new`, `${data.updated} updated`];
      if (data.skipped) bits.push(`${data.skipped} skipped`);
      setMsg({ type: "success", text: `Imported — ${bits.join(", ")}.` });
      loadTemplates();
    } catch {
      setMsg({ type: "error", text: "Import failed." });
    } finally {
      setBusy(false);
    }
  };

  const deleteTemplate = async (row) => {
    if (!window.confirm(`Delete "${row.name}"? Anyone in this business using it will lose it.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`${API}/listing-templates/${row.id}/`, { method: "DELETE" });
      if (!res.ok) {
        setMsg({ type: "error", text: "Could not delete that template." });
        return;
      }
      loadTemplates();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      {/* ── Header ── */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ExtensionIcon style={{ color: C.orange, fontSize: 22 }} />
          <h1 style={{ fontSize: 20, fontWeight: 800, color: C.gray800 }}>Browser Extension</h1>
        </div>
        <p style={{ fontSize: 12, color: C.gray400, marginTop: 4 }}>
          Fill Meesho listing forms from saved templates — synced to this account
        </p>
      </div>

      {/* ── Download ── */}
      <div style={{ ...S.card, borderTop: `4px solid ${C.orange}` }}>
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 30 }}>
            <CircularProgress style={{ color: C.orange }} />
          </div>
        ) : infoError ? (
          <div style={{
            padding: "12px 16px", borderRadius: 10,
            background: C.redLight, border: `1px solid ${C.redBorder}`, color: C.red,
            fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 8,
          }}>
            <ErrorOutlineIcon style={{ fontSize: 18 }} />
            {infoError}
          </div>
        ) : (
          <div style={{
            display: "flex", gap: 20,
            flexDirection: isMobile ? "column" : "row",
            alignItems: isMobile ? "stretch" : "center",
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                <span style={{ fontSize: 15, fontWeight: 800, color: C.gray800 }}>{info.name}</span>
                <Tag variant="blue">v{info.version}</Tag>
                <Tag variant="gray">{fmtBytes(info.size_bytes)}</Tag>
              </div>
              <p style={{ fontSize: 12, color: C.gray500, lineHeight: 1.6 }}>{info.description}</p>
              <p style={{ fontSize: 11, color: C.gray400, marginTop: 6 }}>
                Pre-configured to sync with <strong style={{ fontFamily: "monospace" }}>{info.api_base}</strong> —
                nothing to set up after installing.
              </p>
            </div>
            <a href={EXT_DOWNLOAD} download style={{ textDecoration: "none" }}>
              <button style={{ ...btn("primary", "lg"), whiteSpace: "nowrap", width: isMobile ? "100%" : undefined }}>
                <DownloadIcon style={{ fontSize: 18, verticalAlign: "-4px" }} />
                &nbsp;Download extension (.zip)
              </button>
            </a>
          </div>
        )}
      </div>

      {/* ── Install steps ── */}
      <div style={S.card}>
        <div style={{ ...S.cardTitle, marginBottom: 16 }}>Install it in Chrome, Edge or Brave</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Step n={1} title="Unzip the download">
            You'll get a folder called <code>{info?.zip_root || "meesho-lister-extension"}</code>. Keep it
            somewhere permanent — the browser loads it from that path every time it starts.
          </Step>
          <Step n={2} title="Open the extensions page">
            Go to <code>chrome://extensions</code> (or <code>edge://extensions</code>) and turn on
            <strong> Developer mode</strong> in the top-right.
          </Step>
          <Step n={3} title="Load unpacked">
            Click <strong>Load unpacked</strong> and select the unzipped folder.
          </Step>
          <Step n={4} title="Sign in">
            Pin the extension, click its icon, and sign in with the same username and password you use
            here. Templates you save are stored on this account, so they're on every browser you sign
            in from.
          </Step>
          <Step n={5} title="Use it on Meesho">
            Open a Meesho listing form → <strong>Scan page</strong> → edit anything you like →
            <strong> Prefill all</strong>, or apply a saved template in one click.
          </Step>
        </div>
      </div>

      {/* ── Templates saved on this business ── */}
      <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
        <div style={{
          padding: "14px 20px", borderBottom: `1px solid ${C.border}`,
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        }}>
          <span style={{ ...S.cardTitle, marginBottom: 0 }}>
            Saved templates {templates.length ? `(${templates.length})` : ""}
          </span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button onClick={exportTemplates} disabled={busy || !templates.length}
              style={{ ...btn("ghost", "sm"), opacity: busy || !templates.length ? 0.5 : 1 }}>
              <DownloadIcon style={{ fontSize: 15, verticalAlign: "-3px" }} />
              &nbsp;Export
            </button>
            <button onClick={() => fileRef.current?.click()} disabled={busy}
              style={{ ...btn("ghostOrange", "sm"), opacity: busy ? 0.5 : 1 }}>
              <UploadFileIcon style={{ fontSize: 15, verticalAlign: "-3px" }} />
              &nbsp;Import
            </button>
            <input ref={fileRef} type="file" accept="application/json" style={{ display: "none" }}
              onChange={(e) => { importTemplates(e.target.files[0]); e.target.value = ""; }} />
          </div>
        </div>

        {msg && (
          <div style={{
            margin: "12px 20px 0", padding: "10px 14px", borderRadius: 10, fontSize: 13, fontWeight: 600,
            background: msg.type === "success" ? C.greenLight : C.redLight,
            color: msg.type === "success" ? C.green : C.red,
            border: `1px solid ${msg.type === "success" ? C.greenBorder : C.redBorder}`,
            display: "flex", alignItems: "center", gap: 8,
          }}>
            {msg.type === "success" ? <CheckCircleIcon style={{ fontSize: 17 }} /> : <ErrorOutlineIcon style={{ fontSize: 17 }} />}
            {msg.text}
            <button onClick={() => setMsg(null)}
              style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "inherit", fontSize: 16 }}>×</button>
          </div>
        )}

        {tplLoading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 34 }}>
            <CircularProgress style={{ color: C.orange }} />
          </div>
        ) : templates.length === 0 ? (
          <div style={{ padding: 34, textAlign: "center", color: C.gray400, fontSize: 13 }}>
            No templates yet — save one from the extension on a Meesho listing form, or import a
            JSON export here.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  {["Template", "Fields", "Saved from", "Updated", "By", ""].map((h) => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {templates.map((t, idx) => (
                  <tr key={t.id} style={{ background: idx % 2 === 0 ? C.white : C.gray50 }}>
                    <td style={{ ...S.td, fontWeight: 700, color: C.gray800 }}>{t.name}</td>
                    <td style={{ ...S.td, fontFamily: "monospace", fontWeight: 700 }}>{t.field_count}</td>
                    <td style={{ ...S.td, fontSize: 11, color: C.gray500, maxWidth: 240 }}>
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 230 }}
                        title={t.source_url}>{t.source_url || "—"}</div>
                    </td>
                    <td style={{ ...S.td, whiteSpace: "nowrap", fontSize: 12, color: C.gray600 }}>{fmtWhen(t.updated_at)}</td>
                    <td style={{ ...S.td, fontSize: 12, color: C.gray600 }}>
                      {t.updated_by_name || t.created_by_name || "—"}
                    </td>
                    <td style={S.td}>
                      <button onClick={() => deleteTemplate(t)} disabled={busy}
                        title="Delete this template"
                        style={{ background: "none", border: "none", cursor: "pointer", color: C.gray300, padding: 2 }}>
                        <DeleteOutlineIcon style={{ fontSize: 18 }} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── What gets stored where ── */}
      <div style={{ ...S.card, background: C.gray50 }}>
        <div style={{ ...S.cardTitle, marginBottom: 10 }}>What's stored where</div>
        <ul style={{ fontSize: 12, color: C.gray600, lineHeight: 1.9, paddingLeft: 18, margin: 0 }}>
          <li><strong>Listing templates</strong> — on this account, against the business selected in the
            extension. Everyone with access to that business can use them.</li>
          <li><strong>Your password</strong> — never stored. The extension exchanges it for a session
            token at sign-in and discards it.</li>
          <li><strong>Image-generation API key</strong> — stays in your browser and goes only to the
            image provider you choose, never to this server.</li>
        </ul>
      </div>
    </div>
  );
}
