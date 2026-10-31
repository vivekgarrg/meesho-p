import React, { useState, useEffect, useCallback, useRef } from "react";
import { API, C, S, btn, Tag } from "../../App";
import { CircularProgress } from "@mui/material";

/*
 * Meesho Sync — log the business's Meesho supplier account in once; the sync
 * worker (Rails + Sidekiq, sync/) keeps the session and pulls the data on a
 * schedule (every 5 minutes by default). Refresh pulls straight away.
 */

const STATUS = {
  NEW:        { label: "Logging in…", tag: "blue" },
  LOGGING_IN: { label: "Logging in…", tag: "blue" },
  ACTIVE:     { label: "Connected", tag: "green" },
  FAILED:     { label: "Login failed", tag: "red" },
  DISABLED:   { label: "Disconnected", tag: "gray" },
};
const RUN_TAG = { QUEUED: "gray", RUNNING: "blue", OK: "green", FAILED: "red", STUCK: "amber" };
const when = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—");
const ago = (iso) => {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return when(iso);
};

function Card({ title, children, right }) {
  return (
    <div style={{ ...S.card, padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: C.gray900 }}>{title}</div>
        {right}
      </div>
      {children}
    </div>
  );
}

function Field({ label, children, hint }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: C.gray600 }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 11.5, color: C.gray400 }}>{hint}</span>}
    </label>
  );
}

function LoginForm({ onSubmit, busy, existing, onCancel }) {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [adv, setAdv] = useState(false);
  const [extra, setExtra] = useState({ device_id: existing?.advanced?.device_id || "", instance: existing?.advanced?.instance || "",
    browser_id: existing?.advanced?.browser_id || "", supplier_identifier: existing?.supplier_identifier || "" });
  const submit = (e) => { e.preventDefault(); onSubmit({ phone_number: phone, password, ...extra }); };
  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 440 }} autoComplete="off">
      <Field label="Meesho login phone number">
        <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" placeholder="10-digit mobile number" required
          style={{ ...S.inp }} autoComplete="off" />
      </Field>
      <Field label="Password" hint="Saved encrypted on the server so the sync can log in again by itself. It is never shown again.">
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required style={{ ...S.inp }} autoComplete="new-password" />
      </Field>
      <button type="button" onClick={() => setAdv((v) => !v)} style={{ ...btn("ghost", "sm"), alignSelf: "flex-start" }}>
        {adv ? "Hide" : "Show"} advanced (from the panel's login request)
      </button>
      {adv && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 12, borderRadius: 10, background: C.gray50, border: `1px solid ${C.gray200}` }}>
          <Field label="Supplier code" hint="The short code in the panel's address, e.g. …/fulfillment/xzvey/orders. Found automatically after login — set it only if orders don't pull.">
            <input value={extra.supplier_identifier} onChange={(e) => setExtra({ ...extra, supplier_identifier: e.target.value })} style={{ ...S.inp, fontFamily: "monospace" }} />
          </Field>
          <Field label="device_id" hint="Leave blank to use the phone number (what the panel sends).">
            <input value={extra.device_id} onChange={(e) => setExtra({ ...extra, device_id: e.target.value })} style={{ ...S.inp, fontFamily: "monospace" }} />
          </Field>
          <Field label="instance">
            <input value={extra.instance} onChange={(e) => setExtra({ ...extra, instance: e.target.value })} style={{ ...S.inp, fontFamily: "monospace" }} />
          </Field>
          <Field label="browser-id header">
            <input value={extra.browser_id} onChange={(e) => setExtra({ ...extra, browser_id: e.target.value })} style={{ ...S.inp, fontFamily: "monospace" }} />
          </Field>
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" disabled={busy} style={{ ...btn("primary", "md"), opacity: busy ? 0.6 : 1 }}>{busy ? "Saving…" : "Log in to Meesho"}</button>
        {onCancel && <button type="button" onClick={onCancel} style={btn("ghost", "md")}>Cancel</button>}
      </div>
    </form>
  );
}

function SetupNotice({ setup }) {
  if (!setup) return null;
  const issues = [];
  if (!setup.key) issues.push(`Server not set up: ${setup.key_message || "MEESHO_SYNC_KEY is missing."}`);
  if (!setup.queue) issues.push("The job queue (Redis) can't be reached on the server.");
  else if (!setup.worker) issues.push("The sync worker (Sidekiq) isn't running — logins and pulls will wait in the queue until it starts.");
  if (!issues.length) return null;
  return (
    <div style={{ background: C.amberLight, border: `1.5px solid ${C.amberBorder}`, borderRadius: 12, padding: "10px 14px", color: "#92400E", fontSize: 13, fontWeight: 700, display: "flex", flexDirection: "column", gap: 4 }}>
      {issues.map((i) => <span key={i}>⚠ {i}</span>)}
    </div>
  );
}

export function MeeshoSyncTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const timer = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/meesho-sync/`);
      if (res.ok) setData(await res.json());
    } catch { /* keep the last state */ }
  }, []);

  // Poll quickly while something is happening, slowly otherwise.
  const active = data && data.runs.some((r) => ["QUEUED", "RUNNING"].includes(r.status));
  useEffect(() => {
    load();
    timer.current = setInterval(load, active ? 3000 : 30000);
    return () => clearInterval(timer.current);
  }, [load, active]);

  const call = async (path, method = "POST", body) => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`${API}/meesho-sync/${path}`, {
        method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
      });
      const d = await res.json().catch(() => ({}));
      if (d.account !== undefined) setData(d);
      if (!res.ok) setError(d.error || "Something went wrong.");
      return res.ok;
    } catch {
      setError("Network error."); return false;
    } finally { setBusy(false); }
  };

  if (!data) return <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><CircularProgress style={{ color: C.orange }} /></div>;
  const a = data.account;
  const admin = data.is_admin;
  const connected = a && a.status !== "DISABLED";
  const st = a ? STATUS[a.status] || STATUS.NEW : null;
  const lastRun = data.runs.find((r) => r.kind === "SYNC");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1000 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: C.gray900, margin: 0 }}>Meesho Sync</h1>
        <p style={{ fontSize: 13, color: C.gray500, marginTop: 3 }}>
          Log in to the Meesho supplier panel once — the data is then pulled automatically every few minutes. Refresh pulls it now.
        </p>
      </div>
      <SetupNotice setup={data.setup} />
      {error && <div style={{ background: C.redLight, border: `1.5px solid ${C.redBorder}`, borderRadius: 12, padding: "10px 14px", color: C.red, fontWeight: 700, fontSize: 13 }}>{error}</div>}

      {(!connected || editing) ? (
        <Card title={connected ? "Change the Meesho login" : "Connect your Meesho account"}>
          {admin ? (
            <LoginForm busy={busy} existing={a} onCancel={connected ? () => setEditing(false) : null}
              onSubmit={async (body) => { if (await call("connect/", "POST", body)) setEditing(false); }} />
          ) : (
            <div style={{ fontSize: 13.5, color: C.gray600 }}>Ask an admin to connect the Meesho account.</div>
          )}
          {a?.status === "DISABLED" && <div style={{ fontSize: 12.5, color: C.gray500 }}>{a.status_message}</div>}
        </Card>
      ) : (
        <>
          <Card title="Meesho account" right={st && <Tag variant={st.tag}>{st.label}</Tag>}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
              <div><div style={{ fontSize: 11.5, color: C.gray500, fontWeight: 700 }}>Login</div><div style={{ fontFamily: "monospace", fontWeight: 800 }}>{a.phone}</div></div>
              <div><div style={{ fontSize: 11.5, color: C.gray500, fontWeight: 700 }}>Supplier</div>
                <div style={{ fontWeight: 800 }}>{a.supplier_name || <span style={{ color: C.gray400 }}>name not set</span>} · {a.supplier_id || <span style={{ color: C.red }}>ID not set</span>}
                  {admin && <button onClick={() => {
                    const id = window.prompt("Meesho supplier ID (a number, e.g. 4313711 — shown in the panel):", a.supplier_id || ""); if (id === null) return;
                    const name = window.prompt("Supplier name as on Meesho:", a.supplier_name || ""); if (name === null) return;
                    call("settings/", "PATCH", { supplier_id: id, supplier_name: name });
                  }} style={{ marginLeft: 6, border: "none", background: "none", color: C.orange, fontWeight: 800, cursor: "pointer", fontSize: 12 }}>edit</button>}
                </div></div>
              <div><div style={{ fontSize: 11.5, color: C.gray500, fontWeight: 700 }}>Supplier code</div>
                <div style={{ fontFamily: "monospace", fontWeight: 800 }}>
                  {a.supplier_identifier || <span style={{ color: C.gray400, fontFamily: "inherit" }}>not known yet</span>}
                  {admin && <button onClick={() => { const v = window.prompt("Supplier code (from the panel's address, e.g. …/fulfillment/xzvey/orders):", a.supplier_identifier || ""); if (v !== null) call("settings/", "PATCH", { supplier_identifier: v }); }}
                    style={{ marginLeft: 6, border: "none", background: "none", color: C.orange, fontWeight: 800, cursor: "pointer", fontSize: 12 }}>edit</button>}
                </div></div>
              <div><div style={{ fontSize: 11.5, color: C.gray500, fontWeight: 700 }}>Last login</div><div style={{ fontWeight: 700 }}>{when(a.last_login_at)}</div></div>
              <div><div style={{ fontSize: 11.5, color: C.gray500, fontWeight: 700 }}>Session</div><div style={{ fontWeight: 700, color: a.has_session ? C.green : C.gray500 }}>{a.has_session ? "Held" : "None"}</div></div>
            </div>
            {a.status_message && (
              <div style={{ fontSize: 13, fontWeight: 600, color: a.status === "FAILED" ? C.red : C.gray600 }}>
                {["NEW", "LOGGING_IN"].includes(a.status) && <CircularProgress size={13} style={{ color: C.orange, marginRight: 6, verticalAlign: "-2px" }} />}
                {a.status_message}
              </div>
            )}
            {admin && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={() => setEditing(true)} style={btn("ghost", "sm")}>{a.status === "FAILED" ? "Fix the login" : "Change login"}</button>
                <button onClick={() => { if (window.confirm("Disconnect Meesho? The saved password and session are deleted and syncing stops.")) call("disconnect/"); }}
                  style={{ ...btn("ghost", "sm"), color: C.red }}>Disconnect</button>
              </div>
            )}
          </Card>

          <Card title="Sync" right={
            <button onClick={() => call("refresh/")} disabled={busy || active} style={{ ...btn("primary", "md"), opacity: busy || active ? 0.6 : 1, minWidth: 150 }}>
              {active ? <><CircularProgress size={14} style={{ color: "#fff", marginRight: 6, verticalAlign: "-2px" }} />Syncing…</> : "↻ Refresh now"}
            </button>
          }>
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center", fontSize: 13.5 }}>
              <span>Last pull: <b>{ago(a.last_sync_at)}</b>{a.last_sync_status && <> · <Tag variant={a.last_sync_status === "OK" ? "green" : "red"}>{a.last_sync_status}</Tag></>}</span>
              {a.sync_enabled && a.next_sync_at && <span style={{ color: C.gray500 }}>Next: {when(a.next_sync_at)}</span>}
              {admin ? (
                <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                  <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontWeight: 700 }}>
                    <input type="checkbox" checked={a.sync_enabled} onChange={(e) => call("settings/", "PATCH", { sync_enabled: e.target.checked })} />
                    Auto-pull every
                  </label>
                  <select value={a.sync_interval_minutes} onChange={(e) => call("settings/", "PATCH", { sync_interval_minutes: Number(e.target.value) })}
                    style={{ ...S.inp, width: "auto", padding: "4px 8px" }}>
                    {[1, 2, 5, 10, 15, 30, 60].map((m) => <option key={m} value={m}>{m} min</option>)}
                  </select>
                </span>
              ) : <span style={{ color: C.gray500 }}>{a.sync_enabled ? `Auto-pull every ${a.sync_interval_minutes} min` : "Auto-pull is off"}</span>}
            </div>
            {a.last_sync_message && <div style={{ fontSize: 13, color: a.last_sync_status === "FAILED" ? C.red : C.gray600 }}>{a.last_sync_message}</div>}
            {lastRun && lastRun.status === "FAILED" && lastRun.message !== a.last_sync_message && <div style={{ fontSize: 13, color: C.red }}>{lastRun.message}</div>}
          </Card>

          <Card title="What's fetched">
            {data.snapshots.length === 0 ? (
              <div style={{ fontSize: 13, color: C.gray500 }}>Nothing pulled yet. Each Meesho endpoint the sync reads shows here with when it was last fetched.</div>
            ) : (
              data.snapshots.map((s) => (
                <div key={s.endpoint} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", gap: 14, alignItems: "baseline", flexWrap: "wrap", fontSize: 13 }}>
                    <span style={{ fontWeight: 800, fontSize: 14 }}>{s.endpoint.replace(/_/g, " ")}</span>
                    <span><b style={{ fontFamily: "monospace", fontSize: 16 }}>{s.rows ?? "—"}</b> rows</span>
                    <span style={{ color: C.gray500 }}>fetched {when(s.fetched_at)} · HTTP {s.http_status}</span>
                  </div>
                  {s.preview.length > 0 && (
                    <div style={{ overflowX: "auto", border: `1px solid ${C.gray100}`, borderRadius: 10 }}>
                      <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: "100%" }}>
                        <thead><tr>{s.columns.map((c) => <th key={c} style={{ ...S.th, whiteSpace: "nowrap" }}>{c}</th>)}</tr></thead>
                        <tbody>{s.preview.map((row, i) => (
                          <tr key={i}>{row.map((v, j) => <td key={j} style={{ ...S.td, whiteSpace: "nowrap", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }}>{v === null || v === undefined ? "—" : String(v)}</td>)}</tr>
                        ))}</tbody>
                      </table>
                    </div>
                  )}
                  {s.rows > s.preview.length && <span style={{ fontSize: 12, color: C.gray500 }}>Showing the first {s.preview.length} of {s.rows}.</span>}
                </div>
              ))
            )}
          </Card>
        </>
      )}

      {a && (
        <Card title="Recent runs">
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr>{["Queued", "What", "Status", "Rows", "Details"].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {data.runs.length === 0 && <tr><td colSpan={5} style={{ ...S.td, textAlign: "center", color: C.gray400, padding: 24 }}>No runs yet.</td></tr>}
                {data.runs.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...S.td, whiteSpace: "nowrap", color: C.gray500 }}>{when(r.queued_at)}</td>
                    <td style={{ ...S.td, whiteSpace: "nowrap" }}>{r.kind === "LOGIN" ? "Login" : "Pull"} · {r.trigger === "MANUAL" ? "manual" : "scheduled"}</td>
                    <td style={S.td}><Tag variant={RUN_TAG[r.status] || "gray"}>{r.status}</Tag></td>
                    <td style={S.td}>{r.records || "—"}</td>
                    <td style={{ ...S.td, color: r.status === "FAILED" ? C.red : C.gray600 }}>{r.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
