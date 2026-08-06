import React, { useState, useEffect, useCallback } from "react";
import { API, C, S, btn, Tag, fmt, useIsMobile } from "../../App";
import ChecklistIcon from "@mui/icons-material/Checklist";
import AddIcon from "@mui/icons-material/Add";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineOutlined";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import { CircularProgress } from "@mui/material";

const TYPE_META = {
  LISTING:      { label: "Listing",      tag: "blue" },
  RETURN_CLAIM: { label: "Return claim", tag: "orange" },
};

const STATUS_META = {
  ASSIGNED:  { label: "To do",           tag: "gray",  accent: C.gray400 },
  SUBMITTED: { label: "Awaiting review", tag: "amber", accent: C.amber },
  APPROVED:  { label: "Approved",        tag: "green", accent: C.green },
  REJECTED:  { label: "Rejected",        tag: "red",   accent: C.red },
};

// Meesho's own cap — the reason the compression step exists at all.
const CLAIM_VIDEO_MAX_MB = 22;

const VIEWS = [
  { key: "",          label: "All" },
  { key: "SUBMITTED", label: "To review", stat: "submitted" },
  { key: "ASSIGNED",  label: "To do",     stat: "assigned" },
  { key: "APPROVED",  label: "Approved",  stat: "approved" },
  { key: "REJECTED",  label: "Rejected",  stat: "rejected" },
];

const fmtDate = (v) => (v ? new Date(v).toLocaleString("en-IN", {
  day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

function Money({ value, big, muted }) {
  return (
    <span style={{
      fontFamily: "monospace", fontWeight: 800,
      fontSize: big ? 22 : 14,
      color: muted ? C.gray400 : Number(value) < 0 ? C.red : C.green,
    }}>{fmt(value)}</span>
  );
}

function Metric({ label, value, accent, money, onClick, active }) {
  return (
    <button onClick={onClick} disabled={!onClick} style={{
      background: active ? accent : C.white,
      border: `1px solid ${active ? accent : C.border}`,
      borderLeft: `3px solid ${accent}`,
      borderRadius: 9, padding: "9px 15px", minWidth: 92,
      cursor: onClick ? "pointer" : "default",
      display: "flex", flexDirection: "column", gap: 2,
      fontFamily: "inherit", textAlign: "left",
    }}>
      <span style={{
        fontSize: 18, fontWeight: 800, fontFamily: "monospace", lineHeight: 1.1,
        color: active ? C.white : money ? C.green : C.gray800,
      }}>{money ? fmt(value) : (value ?? "—")}</span>
      <span style={{
        fontSize: 10.5, fontWeight: 600, whiteSpace: "nowrap",
        color: active ? "rgba(255,255,255,0.9)" : C.gray500,
      }}>{label}</span>
    </button>
  );
}

// ── Create a task (admin) ─────────────────────────────────────────────────────
function NewTaskForm({ workers, onCreated, onCancel }) {
  const [type, setType] = useState("LISTING");
  const [form, setForm] = useState({
    title: "", source_link: "", instructions: "", suborder_no: "",
    assigned_to: "", reward_amount: "40", bonus_amount: "25",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // The two task types pay differently, so the defaults follow the type.
  const pickType = (t) => {
    setType(t);
    setForm((f) => ({
      ...f,
      reward_amount: t === "LISTING" ? "40" : "10",
      bonus_amount: t === "LISTING" ? "0" : "25",
    }));
  };

  const submit = async () => {
    if (!form.assigned_to) return setErr("Pick who this is for.");
    setBusy(true); setErr("");
    try {
      const res = await fetch(`${API}/worker-tasks/`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, task_type: type }),
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || "Could not create the task."); return; }
      onCreated(d);
    } catch { setErr("Network error."); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ ...S.card, borderTop: `4px solid ${C.orange}` }}>
      <div style={{ ...S.cardTitle, marginBottom: 14 }}>New task</div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {["LISTING", "RETURN_CLAIM"].map((t) => (
          <button key={t} onClick={() => pickType(t)} style={btn(type === t ? "primary" : "ghost", "md")}>
            {TYPE_META[t].label}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
        <div>
          <label style={S.label}>Assign to</label>
          <select value={form.assigned_to} onChange={set("assigned_to")} style={S.inp}>
            <option value="">Pick a worker…</option>
            {workers.map((w) => <option key={w.id} value={w.id}>{w.username}</option>)}
          </select>
        </div>
        <div>
          <label style={S.label}>Title</label>
          <input value={form.title} onChange={set("title")} style={S.inp}
            placeholder={type === "LISTING" ? "e.g. Brass lota photoshoot" : "e.g. Claim for damaged return"} />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={S.label}>
            {type === "LISTING" ? "Google Drive folder with the photo" : "Link to the claim video"}
          </label>
          <input value={form.source_link} onChange={set("source_link")} style={S.inp}
            placeholder="https://drive.google.com/…" />
        </div>

        {type === "RETURN_CLAIM" && (
          <div>
            <label style={S.label}>Sub-order number</label>
            <input value={form.suborder_no} onChange={set("suborder_no")} style={{ ...S.inp, fontFamily: "monospace" }}
              placeholder="3078…_1" />
            <div style={{ fontSize: 11, color: C.gray400, marginTop: 4, lineHeight: 1.5 }}>
              Needed to release the bonus — the ticket sheet is matched on this.
            </div>
          </div>
        )}

        <div>
          <label style={S.label}>{type === "LISTING" ? "Pay per listing (₹)" : "Pay when the claim is raised (₹)"}</label>
          <input value={form.reward_amount} onChange={set("reward_amount")} type="number" step="1" style={S.inp} />
        </div>
        {type === "RETURN_CLAIM" && (
          <div>
            <label style={S.label}>Bonus if Meesho approves (₹)</label>
            <input value={form.bonus_amount} onChange={set("bonus_amount")} type="number" step="1" style={S.inp} />
          </div>
        )}

        <div style={{ gridColumn: "1 / -1" }}>
          <label style={S.label}>Instructions</label>
          <textarea value={form.instructions} onChange={set("instructions")} rows={2}
            style={{ ...S.inp, resize: "vertical" }}
            placeholder={type === "LISTING"
              ? "Download the photo, edit it, create the listing on Meesho, then enter the SKU id here."
              : `Download the video, compress it under ${CLAIM_VIDEO_MAX_MB}MB, raise the claim on Meesho.`} />
        </div>
      </div>

      {err && (
        <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 10, background: C.redLight,
                      border: `1px solid ${C.redBorder}`, color: C.red, fontSize: 13, fontWeight: 600 }}>
          {err}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button onClick={submit} disabled={busy} style={{ ...btn("primary", "md"), opacity: busy ? 0.5 : 1 }}>
          {busy ? "Creating…" : "Create & assign"}
        </button>
        <button onClick={onCancel} style={btn("ghost", "md")}>Cancel</button>
      </div>
    </div>
  );
}

// ── One task ──────────────────────────────────────────────────────────────────
function TaskCard({ task, isAdmin, onSubmit, onReview, busy }) {
  const isMobile = useIsMobile();
  const meta = STATUS_META[task.status] || STATUS_META.ASSIGNED;
  const type = TYPE_META[task.task_type] || TYPE_META.LISTING;
  const listing = task.task_type === "LISTING";

  const [sku, setSku] = useState(task.submitted_sku || "");
  const [reference, setReference] = useState(task.submitted_reference || "");
  const [note, setNote] = useState(task.submitted_note || "");
  const [comment, setComment] = useState("");

  useEffect(() => {
    setSku(task.submitted_sku || "");
    setReference(task.submitted_reference || "");
    setNote(task.submitted_note || "");
  }, [task.id, task.submitted_sku, task.submitted_reference, task.submitted_note]);

  const canWork = !isAdmin && task.status !== "APPROVED";

  return (
    <div style={{ ...S.card, padding: 0, overflow: "hidden", borderLeft: `4px solid ${meta.accent}` }}>
      <div style={{ padding: isMobile ? "13px" : "15px 18px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 7 }}>
          <Tag variant={type.tag} fontSize={11.5}>{type.label}</Tag>
          <Tag variant={meta.tag} fontSize={11.5}>{meta.label}</Tag>
          {isAdmin && <Tag variant="gray" fontSize={11.5}>{task.assigned_to_name}</Tag>}
          {task.awaiting_bonus && <Tag variant="amber" fontSize={11.5}>bonus pending Meesho</Tag>}
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "baseline", gap: 6 }}>
            {Number(task.earned) > 0
              ? <><span style={{ fontSize: 11, color: C.gray400 }}>earned</span><Money value={task.earned} /></>
              : <><span style={{ fontSize: 11, color: C.gray400 }}>pays</span><Money value={task.total_possible} muted /></>}
          </span>
        </div>

        <div style={{ fontSize: 15, fontWeight: 700, color: C.gray800 }}>
          {task.title || (listing ? "Listing task" : "Return claim task")}
        </div>
        {task.suborder_no && (
          <div style={{ fontSize: 12, color: C.gray500, fontFamily: "monospace", marginTop: 2 }}>
            {task.suborder_no}
          </div>
        )}
        {task.instructions && (
          <div style={{ fontSize: 13, color: C.gray600, marginTop: 7, lineHeight: 1.6 }}>{task.instructions}</div>
        )}
        {task.source_link && (
          <a href={task.source_link} target="_blank" rel="noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 9,
                     fontSize: 13, fontWeight: 700, color: C.blue, textDecoration: "none" }}>
            {listing ? "Open the photo folder" : "Open the video"} <OpenInNewIcon style={{ fontSize: 14 }} />
          </a>
        )}
        {!listing && (
          <div style={{ fontSize: 11.5, color: C.gray400, marginTop: 6 }}>
            Compress the video under {CLAIM_VIDEO_MAX_MB}MB before uploading the claim.
          </div>
        )}
      </div>

      {/* Worker's submission */}
      {(canWork || task.submitted_at) && (
        <div style={{ padding: isMobile ? "13px" : "14px 18px", background: C.gray50, borderBottom: `1px solid ${C.border}` }}>
          {canWork ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
                {listing ? (
                  <div>
                    <label style={S.label}>SKU id you created</label>
                    <input value={sku} onChange={(e) => setSku(e.target.value)}
                      style={{ ...S.inp, fontFamily: "monospace" }} placeholder="required" />
                  </div>
                ) : (
                  <div>
                    <label style={S.label}>Claim / ticket reference</label>
                    <input value={reference} onChange={(e) => setReference(e.target.value)}
                      style={{ ...S.inp, fontFamily: "monospace" }} placeholder="optional" />
                  </div>
                )}
                <div>
                  <label style={S.label}>Note</label>
                  <input value={note} onChange={(e) => setNote(e.target.value)} style={S.inp} placeholder="optional" />
                </div>
              </div>
              <button
                onClick={() => onSubmit(task.id, { submitted_sku: sku, submitted_reference: reference, submitted_note: note })}
                disabled={busy}
                style={{ ...btn("primary", "md"), marginTop: 11 }}>
                {task.status === "REJECTED" ? "Send again" : "Mark done"}
              </button>
            </>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, fontSize: 13 }}>
              {task.submitted_sku && <div><span style={{ color: C.gray400 }}>SKU: </span>
                <span style={{ fontFamily: "monospace", fontWeight: 700 }}>{task.submitted_sku}</span></div>}
              {task.submitted_reference && <div><span style={{ color: C.gray400 }}>Ref: </span>
                <span style={{ fontFamily: "monospace" }}>{task.submitted_reference}</span></div>}
              {task.submitted_note && <div><span style={{ color: C.gray400 }}>Note: </span>{task.submitted_note}</div>}
              <div style={{ color: C.gray400 }}>Sent {fmtDate(task.submitted_at)}</div>
            </div>
          )}
        </div>
      )}

      {/* Review */}
      {isAdmin && task.status === "SUBMITTED" && (
        <div style={{ padding: isMobile ? "13px" : "14px 18px" }}>
          <label style={S.label}>Comment (required if rejecting)</label>
          <input value={comment} onChange={(e) => setComment(e.target.value)} style={S.inp}
            placeholder="What's right or wrong with it" />
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <button onClick={() => onReview(task.id, "APPROVE", comment)} disabled={busy} style={btn("success", "md")}>
              <CheckCircleIcon style={{ fontSize: 16, verticalAlign: "-3px" }} />
              &nbsp;Approve &amp; pay {fmt(task.reward_amount)}
            </button>
            <button onClick={() => onReview(task.id, "REJECT", comment)} disabled={busy} style={btn("danger", "md")}>
              Reject
            </button>
          </div>
        </div>
      )}

      {task.review_comment && task.status !== "SUBMITTED" && (
        <div style={{
          padding: "11px 18px",
          background: task.status === "REJECTED" ? C.redLight : C.greenLight,
          color: task.status === "REJECTED" ? C.red : C.green,
          fontSize: 12.5, fontWeight: 600,
        }}>
          {task.status === "REJECTED" ? "Rejected" : "Approved"}
          {task.reviewed_by_name ? ` by ${task.reviewed_by_name}` : ""}: {task.review_comment}
        </div>
      )}
    </div>
  );
}

// ── Tab ───────────────────────────────────────────────────────────────────────
export function TeamTasksTab() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [stats, setStats] = useState(null);
  const [workers, setWorkers] = useState([]);
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState("");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState(null);
  const [showWallet, setShowWallet] = useState(false);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (view) p.set("status", view);
      if (search.trim()) p.set("q", search.trim());
      const res = await fetch(`${API}/worker-tasks/?${p}`);
      const d = await res.json();
      setIsAdmin(!!d.is_admin);
      setTasks(d.results || []);
      setStats(d.stats || null);
    } finally {
      setLoading(false);
    }
  }, [view, search]);

  const fetchWallet = useCallback(async () => {
    const res = await fetch(`${API}/wallet/`);
    if (res.ok) setWallet(await res.json());
  }, []);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);
  useEffect(() => { fetchWallet(); }, [fetchWallet]);
  useEffect(() => {
    if (!isAdmin) return;
    fetch(`${API}/worker-tasks/workers/`).then(r => r.json()).then(d => setWorkers(d.results || [])).catch(() => {});
  }, [isAdmin]);

  const act = async (url, body, okMsg) => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) { setMsg({ type: "error", text: d.error || "That didn't work." }); return null; }
      if (okMsg) setMsg({ type: "success", text: typeof okMsg === "function" ? okMsg(d) : okMsg });
      fetchTasks(); fetchWallet();
      return d;
    } catch {
      setMsg({ type: "error", text: "Network error." });
      return null;
    } finally { setBusy(false); }
  };

  const submitTask = (id, body) => act(`${API}/worker-tasks/${id}/submit/`, body, "Sent for review.");
  const reviewTask = (id, decision, comment) =>
    act(`${API}/worker-tasks/${id}/review/`, { decision, comment },
        (d) => d.credited ? `Approved — ${fmt(d.credited)} added to the wallet.` : "Recorded.");
  const settle = (userId, username) => {
    if (!window.confirm(`Mark everything outstanding for ${username} as paid?`)) return;
    const method = window.prompt("How was it paid? (UPI / cash / bank)", "UPI") || "";
    const reference = window.prompt("Reference / UTR (optional)", "") || "";
    act(`${API}/wallet/settle/`, { user_id: userId, method, reference },
        (d) => `Settled ${fmt(d.settlement.amount)} for ${username}.`);
  };

  const pending = wallet?.totals?.pending ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <ChecklistIcon style={{ color: C.orange, fontSize: 21 }} />
            <h1 style={{ fontSize: 19, fontWeight: 800, color: C.gray800 }}>Team Tasks</h1>
          </div>
          <p style={{ fontSize: 12, color: C.gray400, marginTop: 3 }}>
            {isAdmin ? "Assign listing and claim work, review it, and pay for it"
                     : "Your tasks and what you've earned"}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => setShowWallet(s => !s)} style={btn("ghost", "sm")}>
            <AccountBalanceWalletIcon style={{ fontSize: 15, verticalAlign: "-3px" }} />
            &nbsp;{isAdmin ? "Wallets" : "My wallet"} · {fmt(pending)}
          </button>
          {isAdmin && (
            <button onClick={() => setCreating(c => !c)} style={btn("primary", "sm")}>
              <AddIcon style={{ fontSize: 16, verticalAlign: "-4px" }} />&nbsp;New task
            </button>
          )}
        </div>
      </div>

      {msg && (
        <div style={{
          padding: "11px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600,
          background: msg.type === "success" ? C.greenLight : C.redLight,
          color: msg.type === "success" ? C.green : C.red,
          border: `1px solid ${msg.type === "success" ? C.greenBorder : C.redBorder}`,
          display: "flex", alignItems: "center", gap: 8,
        }}>
          {msg.type === "success" ? <CheckCircleIcon style={{ fontSize: 17 }} /> : <ErrorOutlineIcon style={{ fontSize: 17 }} />}
          <span style={{ flex: 1 }}>{msg.text}</span>
          <button onClick={() => setMsg(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", fontSize: 16 }}>×</button>
        </div>
      )}

      {creating && isAdmin && (
        <NewTaskForm workers={workers} onCancel={() => setCreating(false)}
          onCreated={() => { setCreating(false); setMsg({ type: "success", text: "Task created." }); fetchTasks(); }} />
      )}

      {/* Wallet panel */}
      {showWallet && wallet && (
        <div style={{ ...S.card, borderTop: `4px solid ${C.green}` }}>
          <div style={{ ...S.cardTitle, marginBottom: 12 }}>
            {isAdmin ? "Wallets" : "My wallet"}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            <Metric label="earned" value={wallet.totals.earned} accent={C.green} money />
            <Metric label="paid out" value={wallet.totals.settled} accent={C.gray500} money />
            <Metric label="still owed" value={wallet.totals.pending} accent={C.orange} money />
          </div>

          {wallet.per_user.length > 0 && (
            <div style={{ overflowX: "auto", marginBottom: 14 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
                <thead><tr>{["Worker", "Earned", "Paid", "Owed", ""].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {wallet.per_user.map((u, i) => (
                    <tr key={u.user_id} style={{ background: i % 2 ? C.gray50 : C.white }}>
                      <td style={{ ...S.td, fontWeight: 700 }}>{u.username}</td>
                      <td style={S.td}><Money value={u.earned} /></td>
                      <td style={S.td}><Money value={u.settled} muted /></td>
                      <td style={S.td}><Money value={u.pending} /></td>
                      <td style={S.td}>
                        {isAdmin && u.pending > 0 && (
                          <button onClick={() => settle(u.user_id, u.username)} disabled={busy} style={btn("ghost", "sm")}>
                            Mark paid
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ ...S.cardTitle, marginBottom: 8, fontSize: 12 }}>Recent ledger</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr>{["When", "Worker", "For", "Amount", "Status"].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {(wallet.entries || []).slice(0, 30).map((e, i) => (
                  <tr key={e.id} style={{ background: i % 2 ? C.gray50 : C.white }}>
                    <td style={{ ...S.td, whiteSpace: "nowrap", color: C.gray500, fontSize: 12 }}>{fmtDate(e.created_at)}</td>
                    <td style={S.td}>{e.user_name}</td>
                    <td style={{ ...S.td, fontSize: 12.5, color: C.gray600 }}>
                      {(e.kind || "").replace(/_/g, " ").toLowerCase()}
                      {e.note ? ` · ${e.note}` : ""}
                    </td>
                    <td style={S.td}><Money value={e.amount} /></td>
                    <td style={S.td}>
                      <Tag variant={e.is_settled ? "gray" : "amber"}>{e.is_settled ? "paid" : "owed"}</Tag>
                    </td>
                  </tr>
                ))}
                {(wallet.entries || []).length === 0 && (
                  <tr><td colSpan={5} style={{ ...S.td, textAlign: "center", padding: 26, color: C.gray400 }}>
                    Nothing earned yet.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Counts */}
      {stats && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Metric label="to do" value={stats.assigned} accent={C.gray500}
            onClick={() => setView("ASSIGNED")} active={view === "ASSIGNED"} />
          <Metric label="to review" value={stats.submitted} accent={C.amber}
            onClick={() => setView("SUBMITTED")} active={view === "SUBMITTED"} />
          <Metric label="approved" value={stats.approved} accent={C.green}
            onClick={() => setView("APPROVED")} active={view === "APPROVED"} />
          <Metric label="rejected" value={stats.rejected} accent={C.red}
            onClick={() => setView("REJECTED")} active={view === "REJECTED"} />
          {stats.awaiting_bonus > 0 && (
            <Metric label="bonus pending" value={stats.awaiting_bonus} accent={C.orange} />
          )}
          <Metric label="still owed" value={stats.pending} accent={C.orange} money />
        </div>
      )}

      {/* Views + search */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "inline-flex", background: C.gray100, borderRadius: 10, padding: 3, border: `1px solid ${C.border}` }}>
          {VIEWS.map((v) => (
            <button key={v.key || "all"} onClick={() => setView(v.key)}
              style={{
                border: "none", cursor: "pointer", fontFamily: "inherit",
                background: view === v.key ? C.white : "transparent",
                color: view === v.key ? C.gray800 : C.gray500,
                fontWeight: view === v.key ? 800 : 600, fontSize: 12.5,
                padding: "6px 13px", borderRadius: 8,
                boxShadow: view === v.key ? "0 1px 3px rgba(0,0,0,0.10)" : "none",
              }}>
              {v.label}{v.stat && stats?.[v.stat] != null && <span style={{ opacity: 0.6 }}> {stats[v.stat]}</span>}
            </button>
          ))}
        </div>
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title / SKU / sub-order…" style={{ ...S.inp, maxWidth: 280, flex: "1 1 180px" }} />
      </div>

      {/* Tasks */}
      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
          <CircularProgress style={{ color: C.orange }} />
        </div>
      ) : tasks.length === 0 ? (
        <div style={{ ...S.card, textAlign: "center", padding: 40, color: C.gray400, fontSize: 13.5 }}>
          {isAdmin ? "No tasks yet — create one to assign work to your team."
                   : "Nothing assigned to you right now."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {tasks.map((t) => (
            <TaskCard key={t.id} task={t} isAdmin={isAdmin} busy={busy}
              onSubmit={submitTask} onReview={reviewTask} />
          ))}
        </div>
      )}
    </div>
  );
}
