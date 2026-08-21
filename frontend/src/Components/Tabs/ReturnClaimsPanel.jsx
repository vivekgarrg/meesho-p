import React, { useState, useCallback, useEffect, useMemo } from "react";
import { API, C, S, btn, Tag, fmt, useIsMobile } from "../../App";
import AddIcon from "@mui/icons-material/Add";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import SendIcon from "@mui/icons-material/Send";
import SearchIcon from "@mui/icons-material/Search";
import LocalShippingOutlinedIcon from "@mui/icons-material/LocalShippingOutlined";
import CardGiftcardIcon from "@mui/icons-material/CardGiftcard";
import FolderOpenIcon from "@mui/icons-material/FolderOpenOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import { CircularProgress } from "@mui/material";
import { field, STATUS_META } from "./TeamTasksShared";

const COLUMNS = ["ASSIGNED", "SUBMITTED", "APPROVED", "REJECTED"];
const COLUMN_WIDTH = 300;

/** A small monospace pill for an id that identifies the physical parcel. */
function IdChip({ label, value }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11,
      fontFamily: "monospace", fontWeight: 700, color: C.gray700, background: C.gray100,
      border: `1px solid ${C.gray200}`, borderRadius: 7, padding: "3px 8px", whiteSpace: "nowrap" }}>
      <span style={{ color: C.gray400, fontWeight: 600, fontFamily: "inherit" }}>{label}</span>{value}
    </span>
  );
}

/** Admin-only: upload one Drive folder covering many sub-orders' unboxing
    videos — replaces creating one task per video/assignee. */
function NewBatchForm({ platforms, onCancel, onCreate }) {
  const isMobile = useIsMobile();
  const [platform, setPlatform] = useState("MEESHO");
  const [driveLink, setDriveLink] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");

  const submit = async () => {
    if (!driveLink.trim()) return setErr("Paste the Drive folder link.");
    const e = await onCreate({ platform, drive_link: driveLink.trim(), note: note.trim() });
    if (e) setErr(e);
  };

  return (
    <div style={{ ...S.card, borderTop: `4px solid ${C.orange}`, padding: isMobile ? 15 : 22 }}>
      <div style={{ ...S.cardTitle, marginBottom: 14 }}>New return video batch</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {platforms.map((p) => (
          <button key={p.value} onClick={() => setPlatform(p.value)}
            style={btn(platform === p.value ? "secondary" : "ghost", "md")}>
            {p.label}
          </button>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={S.label}>Drive folder link</label>
          <input value={driveLink} onChange={(e) => setDriveLink(e.target.value)} style={field(isMobile)}
            placeholder="https://drive.google.com/… — every unboxing video for this batch" />
        </div>
        <div>
          <label style={S.label}>Note (optional)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} style={field(isMobile)}
            placeholder="e.g. Week 34 returns" />
        </div>
      </div>
      {err && (
        <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 10, background: C.redLight,
          border: `1px solid ${C.redBorder}`, color: C.red, fontSize: 13, fontWeight: 600 }}>{err}</div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button onClick={submit} style={{ ...btn("primary", "md"), flex: isMobile ? 1 : "none" }}>
          Create batch
        </button>
        <button onClick={onCancel} style={{ ...btn("ghost", "md"), flex: isMobile ? 1 : "none" }}>Cancel</button>
      </div>
    </div>
  );
}

/** One return-video batch — the self-serve entry point. Anyone can claim a
    sub-order off an open batch; only they can (the claim endpoint creates
    *their own* task), so there's no assignee picker here at all. */
function BatchRow({ batch, isAdmin, busy, onClaim, onToggleOpen }) {
  const isMobile = useIsMobile();
  const [suborder, setSuborder] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [err, setErr] = useState("");

  const claim = async () => {
    if (!suborder.trim()) return;
    setClaiming(true); setErr("");
    const e = await onClaim(batch.id, suborder.trim());
    if (e) setErr(e); else setSuborder("");
    setClaiming(false);
  };

  return (
    <div style={{ ...S.card, padding: isMobile ? 12 : 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Tag variant={batch.platform === "MEESHO" ? "orange" : batch.platform === "AMAZON" ? "amber" : "blue"} fontSize={10.5}>
          {batch.platform}
        </Tag>
        {batch.note && <span style={{ fontSize: 13, fontWeight: 700, color: C.gray800 }}>{batch.note}</span>}
        <Tag variant={batch.is_open ? "green" : "gray"} fontSize={10}>{batch.is_open ? "Open" : "Closed"}</Tag>
        <span style={{ fontSize: 11.5, color: C.gray400 }}>{batch.claimed_count} claimed</span>
        <a href={batch.drive_link} target="_blank" rel="noreferrer"
          style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12.5, fontWeight: 700,
            color: C.blue, textDecoration: "none", marginLeft: "auto" }}>
          <FolderOpenIcon style={{ fontSize: 14 }} /> Open folder <OpenInNewIcon style={{ fontSize: 12 }} />
        </a>
        {isAdmin && (
          <button onClick={() => onToggleOpen(batch.id, !batch.is_open)} disabled={busy}
            style={btn("ghost", "sm")}>
            {batch.is_open ? "Close" : "Reopen"}
          </button>
        )}
      </div>

      {batch.is_open ? (
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <input value={suborder} onChange={(e) => setSuborder(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && suborder.trim()) claim(); }}
            placeholder="Sub-order number you're raising a claim for"
            style={field(isMobile, { flex: "1 1 220px", fontFamily: "monospace" })} />
          <button onClick={claim} disabled={!suborder.trim() || claiming}
            style={{ ...btn("primary", "sm"), whiteSpace: "nowrap" }}>
            <SendIcon style={{ fontSize: 13, verticalAlign: "-2px" }} />
            &nbsp;{claiming ? "Claiming…" : "Claim this return"}
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 10, fontSize: 11.5, color: C.gray400 }}>
          <LockOutlinedIcon style={{ fontSize: 13 }} /> Closed — no new claims can be added
        </div>
      )}
      {err && <div style={{ fontSize: 12, color: C.red, fontWeight: 600, marginTop: 6 }}>{err}</div>}
    </div>
  );
}

/** One claim, redesigned dense for a kanban column — the status is already
    said by the column it's in, so the card doesn't repeat it. */
function ClaimCard({ task, isAdmin, busy, onSubmit, onReview }) {
  const isMobile = useIsMobile();
  const meta = STATUS_META[task.status] || STATUS_META.ASSIGNED;
  const [reference_, setRef] = useState(task.submitted_reference || "");
  const [packet, setPacket] = useState(task.return_packet_id || "");
  const [note, setNote] = useState(task.submitted_note || "");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const identity = [
    task.suborder_no && { label: "SUB ", value: task.suborder_no },
    task.return_packet_id && { label: "PKT ", value: task.return_packet_id },
  ].filter(Boolean);

  return (
    <div style={{ ...S.card, padding: 0, overflow: "hidden", borderLeft: `4px solid ${meta.accent}` }}>
      <div style={{ padding: isMobile ? 12 : 14 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: C.gray900, lineHeight: 1.3 }}>
          {task.title || "Return claim"}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
          <Tag variant={task.platform === "MEESHO" ? "orange" : task.platform === "AMAZON" ? "amber" : "blue"} fontSize={10}>
            {task.platform}
          </Tag>
          {task.video_batch_note && <Tag variant="gray" fontSize={10}>{task.video_batch_note}</Tag>}
          {isAdmin && (task.assignee_names || []).length > 0 && (
            <span style={{ fontSize: 11, color: C.gray400 }}>{task.assignee_names.join(", ")}</span>
          )}
        </div>

        {identity.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {identity.map((c) => <IdChip key={c.label} label={c.label} value={c.value} />)}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 9 }}>
          <span style={{ fontSize: 12, color: C.gray500, fontWeight: 600 }}>{fmt(task.reward_amount)}/claim</span>
          {task.source_link && (
            <a href={task.source_link} target="_blank" rel="noreferrer"
              style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 700,
                color: C.blue, textDecoration: "none" }}>
              Video <OpenInNewIcon style={{ fontSize: 12.5 }} />
            </a>
          )}
        </div>
      </div>

      <div style={{ padding: isMobile ? 12 : 14, background: C.gray50, borderTop: `1px solid ${C.border}` }}>
        {!isAdmin && task.status !== "APPROVED" ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
              <div>
                <label style={S.label}>Claim / ticket ref</label>
                <input value={reference_} onChange={(e) => setRef(e.target.value)}
                  style={field(isMobile, { fontFamily: "monospace" })} />
              </div>
              <div>
                <label style={S.label}>Return packet id</label>
                <input value={packet} onChange={(e) => setPacket(e.target.value)}
                  style={field(isMobile, { fontFamily: "monospace" })} placeholder="if known" />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={S.label}>Note</label>
                <input value={note} onChange={(e) => setNote(e.target.value)} style={field(isMobile)} />
              </div>
            </div>
            <button onClick={() => onSubmit(task.id, {
              submitted_reference: reference_, submitted_note: note, return_packet_id: packet,
            })}
              disabled={busy} style={{ ...btn("primary", "md"), marginTop: 11, width: "100%" }}>
              <SendIcon style={{ fontSize: 14, verticalAlign: "-3px" }} />
              &nbsp;{task.status === "REJECTED" ? "Send again" : "Send for approval"}
            </button>
          </>
        ) : (
          <div style={{ fontSize: 12.5, color: C.gray600, lineHeight: 1.7 }}>
            {task.submitted_reference && <>Ref <b style={{ fontFamily: "monospace" }}>{task.submitted_reference}</b><br /></>}
            {task.submitted_by_name && <>by {task.submitted_by_name} · </>}
            sent {task.submitted_at ? new Date(task.submitted_at).toLocaleString("en-IN",
              { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
          </div>
        )}
        {isAdmin && task.status === "SUBMITTED" && !rejecting && (
          <div style={{ display: "flex", gap: 7, marginTop: 10, flexWrap: "wrap" }}>
            <button onClick={() => onReview(task.id, "APPROVE", "")} disabled={busy}
              style={{ ...btn("success", "sm"), flex: 1 }}>
              Approve &amp; pay {fmt(task.reward_amount)}
            </button>
            <button onClick={() => { setRejecting(true); setReason(""); }} disabled={busy}
              style={{ ...btn("ghost", "sm"), color: C.red, borderColor: C.redBorder }}>
              Reject
            </button>
          </div>
        )}
        {isAdmin && task.status === "SUBMITTED" && (
          <div style={{ fontSize: 10.5, color: C.gray400, marginTop: 6 }}>
            Usually resolves itself once the claim sheet is uploaded — this is only needed if it never shows up there.
          </div>
        )}
        {isAdmin && rejecting && (
          <div style={{ marginTop: 10, display: "flex", gap: 7, flexWrap: "wrap" }}>
            <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="What needs fixing?" style={field(isMobile, { flex: "1 1 150px" })} />
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
        <div style={{ padding: `10px ${isMobile ? 12 : 14}px`,
          background: task.status === "REJECTED" ? C.redLight : C.greenLight,
          color: task.status === "REJECTED" ? C.red : C.green, fontSize: 12, fontWeight: 600 }}>
          {task.status === "REJECTED" ? "Rejected" : "Approved"}: {task.review_comment}
        </div>
      )}

      {task.awaiting_bonus && (
        <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 14px",
          background: C.amberLight, color: C.amber, fontSize: 11.5, fontWeight: 700 }}>
          <CardGiftcardIcon style={{ fontSize: 13 }} /> Bonus pending Meesho's own approval
        </div>
      )}
    </div>
  );
}

/** One lifecycle stage — a fixed-width scroll-snap column, so the whole set
    reads left-to-right as "what stage is each claim actually at" instead of
    a flat pile the admin has to filter to make sense of. */
function ClaimColumn({ status, tasks, count, extra, isAdmin, busy, onSubmit, onReview }) {
  const meta = STATUS_META[status];
  return (
    <div style={{ flex: `0 0 ${COLUMN_WIDTH}px`, width: COLUMN_WIDTH, scrollSnapAlign: "start",
      display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 2px" }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: meta.accent, flexShrink: 0 }} />
        <span style={{ fontSize: 12.5, fontWeight: 800, color: C.gray800 }}>{meta.label}</span>
        <span style={{ background: C.gray100, color: C.gray500, fontSize: 10.5, fontWeight: 700,
          padding: "1px 7px", borderRadius: 20, border: `1px solid ${C.gray200}` }}>
          {count}
        </span>
      </div>
      {extra && (
        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700,
          color: C.amber }}>
          <CardGiftcardIcon style={{ fontSize: 13 }} /> {extra}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {tasks.length === 0 ? (
          <div style={{ ...S.card, textAlign: "center", padding: 20, color: C.gray400, fontSize: 12 }}>
            Nothing here.
          </div>
        ) : tasks.map((t) => (
          <ClaimCard key={t.id} task={t} isAdmin={isAdmin} busy={busy}
            onSubmit={onSubmit} onReview={onReview} />
        ))}
      </div>
    </div>
  );
}

export function ReturnClaimsPanel({ isAdmin, busy, setBusy, setMsg, post }) {
  const isMobile = useIsMobile();
  const [tasks, setTasks] = useState([]);
  const [stats, setStats] = useState(null);
  const [batches, setBatches] = useState([]);
  const [reference, setReference] = useState(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [creatingBatch, setCreatingBatch] = useState(false);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ task_type: "RETURN_CLAIM" });
      if (search.trim()) p.set("q", search.trim());
      const res = await fetch(`${API}/worker-tasks/?${p}`);
      const d = await res.json();
      setTasks(d.results || []);
      setStats(d.stats || null);
    } finally { setLoading(false); }
  }, [search]);

  const fetchBatches = useCallback(async () => {
    const res = await fetch(`${API}/return-claim-batches/`);
    if (res.ok) setBatches((await res.json()).results || []);
  }, []);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);
  useEffect(() => { fetchBatches(); }, [fetchBatches]);
  useEffect(() => {
    fetch(`${API}/task-reference/`).then(r => r.ok ? r.json() : null).then(setReference).catch(() => {});
  }, []);

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
  const claimSuborder = async (batchId, suborderNo) => {
    const { error } = await post(`${API}/return-claim-batches/${batchId}/claim/`, { suborder_no: suborderNo });
    if (error) return error;
    setMsg({ type: "success", text: `Claimed ${suborderNo} — added to your To do column.` });
    fetchBatches(); fetchTasks();
    return null;
  };
  const toggleBatchOpen = async (batchId, isOpen) => {
    const { error } = await post(`${API}/return-claim-batches/${batchId}/`, { is_open: isOpen }, "PATCH");
    if (error) setMsg({ type: "error", text: error });
    else fetchBatches();
  };

  const platforms = reference?.platforms || [];

  const grouped = useMemo(() => {
    const g = { ASSIGNED: [], SUBMITTED: [], APPROVED: [], REJECTED: [] };
    tasks.forEach((t) => { if (g[t.status]) g[t.status].push(t); });
    return g;
  }, [tasks]);

  const counts = {
    ASSIGNED: stats?.assigned ?? grouped.ASSIGNED.length,
    SUBMITTED: stats?.submitted ?? grouped.SUBMITTED.length,
    APPROVED: stats?.approved ?? grouped.APPROVED.length,
    REJECTED: stats?.rejected ?? grouped.REJECTED.length,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 9, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: C.gray800 }}>Return video batches</div>
        {isAdmin && (
          <button onClick={() => setCreatingBatch(c => !c)}
            style={{ ...btn("primary", "sm"), padding: isMobile ? "10px 14px" : undefined }}>
            <AddIcon style={{ fontSize: 16, verticalAlign: "-4px" }} />&nbsp;New batch
          </button>
        )}
      </div>

      {creatingBatch && isAdmin && (
        <NewBatchForm platforms={platforms} onCancel={() => setCreatingBatch(false)}
          onCreate={async (body) => {
            const { error } = await post(`${API}/return-claim-batches/`, body);
            if (error) return error;
            setMsg({ type: "success", text: "Batch created." });
            setCreatingBatch(false); fetchBatches();
            return null;
          }} />
      )}

      {batches.length === 0 ? (
        <div style={{ ...S.card, textAlign: "center", padding: 24, color: C.gray400, fontSize: 13 }}>
          {isAdmin ? "No return video batches yet — create one and share it with the team."
                   : "No return video batches yet."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {batches.map((b) => (
            <BatchRow key={b.id} batch={b} isAdmin={isAdmin} busy={busy}
              onClaim={claimSuborder} onToggleOpen={toggleBatchOpen} />
          ))}
        </div>
      )}

      <div style={{ borderTop: `1px solid ${C.border}`, margin: "4px 0" }} />

      <div style={{ position: "relative" }}>
        <SearchIcon style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)",
          fontSize: 17, color: C.gray400, pointerEvents: "none" }} />
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title / sub-order / packet id…"
          style={field(isMobile, { paddingLeft: 34, width: "100%", boxSizing: "border-box" })} />
      </div>

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
          <CircularProgress style={{ color: C.orange }} />
        </div>
      ) : tasks.length === 0 && !search.trim() ? (
        <div style={{ ...S.card, textAlign: "center", padding: 40, color: C.gray400, fontSize: 13.5 }}>
          <LocalShippingOutlinedIcon style={{ fontSize: 26, color: C.gray300, marginBottom: 8 }} />
          <div>{isAdmin ? "No return claims yet — claim a sub-order from a batch above."
                        : "Nothing claimed yet — claim a sub-order from a batch above."}</div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 6,
          scrollSnapType: "x proximity", WebkitOverflowScrolling: "touch" }}>
          {COLUMNS.map((status) => (
            <ClaimColumn key={status} status={status} tasks={grouped[status]} count={counts[status]}
              extra={status === "APPROVED" && stats?.awaiting_bonus > 0
                ? `${stats.awaiting_bonus} awaiting bonus` : null}
              isAdmin={isAdmin} busy={busy} onSubmit={submitTask} onReview={reviewTask} />
          ))}
        </div>
      )}
    </div>
  );
}
