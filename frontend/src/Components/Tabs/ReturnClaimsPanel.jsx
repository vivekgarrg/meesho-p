import React, { useState, useCallback, useEffect } from "react";
import { API, C, S, btn, Tag, fmt, useIsMobile } from "../../App";
import AddIcon from "@mui/icons-material/Add";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import SendIcon from "@mui/icons-material/Send";
import SearchIcon from "@mui/icons-material/Search";
import { CircularProgress } from "@mui/material";
import { field, tap, scrollRow, Metric, STATUS_META, CLAIM_VIDEO_MAX_MB } from "./TeamTasksShared";

/** Same create form as before — only the RETURN_CLAIM branch survives the redesign. */
function NewClaimForm({ workers, platforms, rates, onCreate, onCancel }) {
  const isMobile = useIsMobile();
  const [platform, setPlatform] = useState("MEESHO");
  const [picked, setPicked] = useState([]);
  const [form, setForm] = useState({ title: "", source_link: "", instructions: "", suborder_no: "" });
  const [rateOverride, setRateOverride] = useState("");
  const [err, setErr] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const standing = React.useMemo(() => {
    if (picked.length === 1) {
      const personal = rates.find((r) => r.platform === platform && r.task_type === "RETURN_CLAIM" && r.user === picked[0]);
      if (personal) return personal;
    }
    return rates.find((r) => r.platform === platform && r.task_type === "RETURN_CLAIM" && !r.user);
  }, [rates, platform, picked]);

  const submit = async () => {
    if (!picked.length) return setErr("Pick at least one person.");
    const body = { ...form, task_type: "RETURN_CLAIM", platform, assignees: picked };
    if (rateOverride !== "") body.reward_amount = rateOverride;
    const e = await onCreate(body);
    if (e) setErr(e);
  };

  return (
    <div style={{ ...S.card, borderTop: `4px solid ${C.orange}`, padding: isMobile ? 15 : 22 }}>
      <div style={{ ...S.cardTitle, marginBottom: 14 }}>New return claim</div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {platforms.map((p) => (
          <button key={p.value} onClick={() => setPlatform(p.value)}
            style={btn(platform === p.value ? "secondary" : "ghost", "md")}>
            {p.label}
          </button>
        ))}
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={S.label}>Assign to — pick as many as you like</label>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          {workers.map((w) => {
            const on = picked.includes(w.id);
            return (
              <button key={w.id}
                onClick={() => setPicked((p) => on ? p.filter(x => x !== w.id) : [...p, w.id])}
                style={btn(on ? "primary" : "ghost", "sm")}>
                {on ? "✓ " : ""}{w.username}
              </button>
            );
          })}
          {workers.length === 0 && <span style={{ fontSize: 12.5, color: C.gray400 }}>No members in this business yet.</span>}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
        <div>
          <label style={S.label}>Title</label>
          <input value={form.title} onChange={set("title")} style={field(isMobile)}
            placeholder="e.g. Claim for damaged return" />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={S.label}>Link to the claim video</label>
          <input value={form.source_link} onChange={set("source_link")} style={field(isMobile)}
            placeholder="https://drive.google.com/…" />
        </div>
        <div>
          <label style={S.label}>Sub-order number</label>
          <input value={form.suborder_no} onChange={set("suborder_no")}
            style={field(isMobile, { fontFamily: "monospace" })} placeholder="3078…_1" />
        </div>
        <div>
          <label style={S.label}>Rate per claim (₹)</label>
          <input value={rateOverride} onChange={(e) => setRateOverride(e.target.value)} type="number"
            inputMode="decimal" style={field(isMobile)}
            placeholder={standing ? `${standing.reward_amount} (standing rate)` : "set a rate below"} />
          <div style={{ fontSize: 11, color: C.gray400, marginTop: 4 }}>
            {standing
              ? `Leave blank to use ${standing.user ? `${standing.user_name}'s rate` : `the ${platform} rate`} of ${fmt(standing.reward_amount)}.`
              : `No standing ${platform} rate yet — set one in Rates per platform.`}
          </div>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={S.label}>Instructions</label>
          <textarea value={form.instructions} onChange={set("instructions")} rows={2}
            style={field(isMobile, { resize: "vertical" })}
            placeholder={`Download the video, compress under ${CLAIM_VIDEO_MAX_MB}MB, raise the claim.`} />
        </div>
      </div>

      {err && (
        <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 10, background: C.redLight,
          border: `1px solid ${C.redBorder}`, color: C.red, fontSize: 13, fontWeight: 600 }}>{err}</div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button onClick={submit} style={{ ...btn("primary", "md"), flex: isMobile ? 1 : "none" }}>
          Create &amp; assign
        </button>
        <button onClick={onCancel} style={{ ...btn("ghost", "md"), flex: isMobile ? 1 : "none" }}>Cancel</button>
      </div>
    </div>
  );
}

function ClaimCard({ task, isAdmin, busy, onSubmit, onReview }) {
  const isMobile = useIsMobile();
  const meta = STATUS_META[task.status] || STATUS_META.ASSIGNED;
  const [reference_, setRef] = useState(task.submitted_reference || "");
  const [note, setNote] = useState(task.submitted_note || "");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <div style={{ ...S.card, padding: 0, overflow: "hidden", borderLeft: `4px solid ${meta.accent}` }}>
      <div style={{ padding: isMobile ? 13 : 18 }}>
        <div style={{ fontSize: isMobile ? 14.5 : 15.5, fontWeight: 800, color: C.gray900, lineHeight: 1.35 }}>
          {task.title || "Return claim"}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
          <Tag variant={task.platform === "MEESHO" ? "orange" : task.platform === "AMAZON" ? "amber" : "blue"} fontSize={10.5}>
            {task.platform}
          </Tag>
          <Tag variant={meta.tag} fontSize={10.5}>{meta.label}</Tag>
          {task.awaiting_bonus && <Tag variant="amber" fontSize={10.5}>bonus pending</Tag>}
          {(task.assignee_names || []).length > 0 && (
            <span style={{ fontSize: 11.5, color: C.gray400 }}>{task.assignee_names.join(", ")}</span>
          )}
        </div>
        <div style={{ fontSize: 12, color: C.gray500, marginTop: 6, fontWeight: 600 }}>
          {fmt(task.reward_amount)}/claim
        </div>
        {task.suborder_no && (
          <div style={{ fontSize: 12, color: C.gray500, fontFamily: "monospace", marginTop: 8 }}>
            {task.suborder_no}
          </div>
        )}
        {task.instructions && (
          <div style={{ fontSize: 13, color: C.gray600, lineHeight: 1.6, marginTop: 8 }}>{task.instructions}</div>
        )}
        {task.source_link && (
          <a href={task.source_link} target="_blank" rel="noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13, fontWeight: 700,
              color: C.blue, textDecoration: "none", marginTop: 8 }}>
            Open the video <OpenInNewIcon style={{ fontSize: 14 }} />
          </a>
        )}
      </div>

      <div style={{ padding: isMobile ? 13 : 18, background: C.gray50, borderTop: `1px solid ${C.border}` }}>
        {!isAdmin && task.status !== "APPROVED" ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
              <div>
                <label style={S.label}>Claim / ticket reference</label>
                <input value={reference_} onChange={(e) => setRef(e.target.value)}
                  style={field(isMobile, { fontFamily: "monospace" })} />
              </div>
              <div>
                <label style={S.label}>Note</label>
                <input value={note} onChange={(e) => setNote(e.target.value)} style={field(isMobile)} />
              </div>
            </div>
            <button onClick={() => onSubmit(task.id, { submitted_reference: reference_, submitted_note: note })}
              disabled={busy} style={{ ...btn("primary", "md"), marginTop: 12, width: isMobile ? "100%" : "auto" }}>
              <SendIcon style={{ fontSize: 15, verticalAlign: "-3px" }} />
              &nbsp;{task.status === "REJECTED" ? "Send again" : "Send for approval"}
            </button>
          </>
        ) : (
          <div style={{ fontSize: 13, color: C.gray600 }}>
            {task.submitted_reference && <>Ref <b style={{ fontFamily: "monospace" }}>{task.submitted_reference}</b> · </>}
            {task.submitted_by_name && <>by {task.submitted_by_name} · </>}
            sent {task.submitted_at ? new Date(task.submitted_at).toLocaleString("en-IN",
              { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
          </div>
        )}
        {isAdmin && task.status === "SUBMITTED" && !rejecting && (
          <div style={{ display: "flex", gap: 8, marginTop: 11, flexWrap: "wrap" }}>
            <button onClick={() => onReview(task.id, "APPROVE", "")} disabled={busy}
              style={{ ...btn("success", "md"), flex: isMobile ? 1 : "none" }}>
              Approve &amp; pay {fmt(task.reward_amount)}
            </button>
            <button onClick={() => { setRejecting(true); setReason(""); }} disabled={busy}
              style={{ ...btn("ghost", "md"), color: C.red, borderColor: C.redBorder, flex: isMobile ? 1 : "none" }}>
              Reject
            </button>
          </div>
        )}
        {isAdmin && rejecting && (
          <div style={{ marginTop: 11, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="What needs fixing?" style={field(isMobile, { flex: "1 1 190px" })} />
            <button disabled={busy || !reason.trim()}
              onClick={() => { onReview(task.id, "REJECT", reason.trim()); setRejecting(false); }}
              style={{ ...btn("danger", "sm"), opacity: reason.trim() ? 1 : 0.5 }}>
              Send back
            </button>
            <button onClick={() => setRejecting(false)} style={btn("ghost", "sm")}>Cancel</button>
          </div>
        )}
      </div>

      {task.review_comment && task.status !== "SUBMITTED" && (
        <div style={{ padding: `11px ${isMobile ? 13 : 18}px`,
          background: task.status === "REJECTED" ? C.redLight : C.greenLight,
          color: task.status === "REJECTED" ? C.red : C.green, fontSize: 12.5, fontWeight: 600 }}>
          {task.status === "REJECTED" ? "Rejected" : "Approved"}: {task.review_comment}
        </div>
      )}
    </div>
  );
}

export function ReturnClaimsPanel({ isAdmin, busy, setBusy, setMsg, post }) {
  const isMobile = useIsMobile();
  const [tasks, setTasks] = useState([]);
  const [stats, setStats] = useState(null);
  const [workers, setWorkers] = useState([]);
  const [rates, setRates] = useState([]);
  const [reference, setReference] = useState(null);
  const [view, setView] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ task_type: "RETURN_CLAIM" });
      if (view) p.set("status", view);
      if (search.trim()) p.set("q", search.trim());
      const res = await fetch(`${API}/worker-tasks/?${p}`);
      const d = await res.json();
      setTasks(d.results || []);
      setStats(d.stats || null);
    } finally { setLoading(false); }
  }, [view, search]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);
  useEffect(() => {
    fetch(`${API}/task-reference/`).then(r => r.ok ? r.json() : null).then(setReference).catch(() => {});
    fetch(`${API}/platform-rates/`).then(r => r.ok ? r.json() : null)
      .then(d => setRates(d?.results || [])).catch(() => {});
  }, []);
  useEffect(() => {
    if (!isAdmin) return;
    fetch(`${API}/worker-tasks/workers/`).then(r => r.json())
      .then(d => setWorkers(d.results || [])).catch(() => {});
  }, [isAdmin]);

  const submitTask = async (id, body) => {
    const { error } = await post(`${API}/worker-tasks/${id}/submit/`, body);
    if (error) setMsg({ type: "error", text: error });
    else { setMsg({ type: "success", text: "Sent for review." }); fetchTasks(); }
  };
  const reviewTask = async (id, decision, comment) => {
    const { data, error } = await post(`${API}/worker-tasks/${id}/review/`, { decision, comment });
    if (error) setMsg({ type: "error", text: error });
    else { setMsg({ type: "success", text: data.credited ? `Approved — ${fmt(data.credited)} added.` : "Recorded." }); fetchTasks(); }
  };

  const platforms = reference?.platforms || [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        {isAdmin && (
          <button onClick={() => setCreating(c => !c)}
            style={{ ...btn("primary", "sm"), padding: isMobile ? "10px 14px" : undefined }}>
            <AddIcon style={{ fontSize: 16, verticalAlign: "-4px" }} />&nbsp;New claim
          </button>
        )}
      </div>

      {creating && isAdmin && (
        <NewClaimForm workers={workers} platforms={platforms} rates={rates}
          onCancel={() => setCreating(false)}
          onCreate={async (body) => {
            const { error } = await post(`${API}/worker-tasks/`, body);
            if (error) return error;
            setMsg({ type: "success", text: "Claim created." });
            setCreating(false); fetchTasks();
            return null;
          }} />
      )}

      {stats && (
        <div style={scrollRow}>
          <Metric label="to do" value={stats.assigned} accent={C.gray500}
            onClick={() => setView(v => v === "ASSIGNED" ? "" : "ASSIGNED")} active={view === "ASSIGNED"} />
          <Metric label="to review" value={stats.submitted} accent={C.amber}
            onClick={() => setView(v => v === "SUBMITTED" ? "" : "SUBMITTED")} active={view === "SUBMITTED"} />
          <Metric label="approved" value={stats.approved} accent={C.green}
            onClick={() => setView(v => v === "APPROVED" ? "" : "APPROVED")} active={view === "APPROVED"} />
          {stats.awaiting_bonus > 0 && <Metric label="bonus pending" value={stats.awaiting_bonus} accent={C.orange} />}
        </div>
      )}

      <div style={{ position: "relative" }}>
        <SearchIcon style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)",
          fontSize: 17, color: C.gray400, pointerEvents: "none" }} />
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title / sub-order…"
          style={field(isMobile, { paddingLeft: 34, width: "100%", boxSizing: "border-box" })} />
      </div>

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
          <CircularProgress style={{ color: C.orange }} />
        </div>
      ) : tasks.length === 0 ? (
        <div style={{ ...S.card, textAlign: "center", padding: 40, color: C.gray400, fontSize: 13.5 }}>
          {isAdmin ? "No return claims yet." : "Nothing assigned to you right now."}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 260 : 320}px, 1fr))`, gap: 12 }}>
          {tasks.map((t) => (
            <ClaimCard key={t.id} task={t} isAdmin={isAdmin} busy={busy}
              onSubmit={submitTask} onReview={reviewTask} />
          ))}
        </div>
      )}
    </div>
  );
}
