import React, { useState, useEffect, useCallback, useMemo } from "react";
import { API, C, S, btn, Tag, fmt, useIsMobile } from "../../App";
import ChecklistIcon from "@mui/icons-material/Checklist";
import AddIcon from "@mui/icons-material/Add";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineOutlined";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import PauseCircleIcon from "@mui/icons-material/PauseCircle";
import PlayCircleIcon from "@mui/icons-material/PlayCircleFilled";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import PriceChangeIcon from "@mui/icons-material/PriceChange";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
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

const LISTING_STATUS = {
  PENDING:  { label: "Pending",  tag: "amber" },
  APPROVED: { label: "Approved", tag: "green" },
  REJECTED: { label: "Rejected", tag: "red" },
};

const PLATFORM_TAG = { MEESHO: "orange", AMAZON: "amber", FLIPKART: "blue" };
const CLAIM_VIDEO_MAX_MB = 22;

// The per-SKU fields, in the order they're filled. One definition drives the
// add form, the edit row and the table header, so they can't drift apart.
const LISTING_FIELDS = [
  { key: "sku_id",                label: "SKU id",            type: "text",  required: true, mono: true },
  { key: "sku_prefix",            label: "SKU starts with",   type: "text",  mono: true },
  { key: "listing_price",         label: "Price",             type: "money", platformLabel: true },
  { key: "mrp",                   label: "MRP",               type: "money" },
  { key: "wrong_defective_price", label: "Wrong/defective",   type: "money" },
  { key: "min_settlement_amount", label: "Min settlement",    type: "money" },
  { key: "hsn_code",              label: "HSN code",          type: "hsn" },
  { key: "tax_percent",           label: "Tax %",             type: "tax" },
];

const fmtDate = (v) => (v ? new Date(v).toLocaleString("en-IN", {
  day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

function Money({ value, muted }) {
  return <span style={{ fontFamily: "monospace", fontWeight: 800,
    color: muted ? C.gray400 : Number(value) < 0 ? C.red : C.green }}>{fmt(value)}</span>;
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
      <span style={{ fontSize: 18, fontWeight: 800, fontFamily: "monospace", lineHeight: 1.1,
        color: active ? C.white : money ? C.green : C.gray800 }}>
        {money ? fmt(value) : (value ?? "—")}
      </span>
      <span style={{ fontSize: 10.5, fontWeight: 600, whiteSpace: "nowrap",
        color: active ? "rgba(255,255,255,0.9)" : C.gray500 }}>{label}</span>
    </button>
  );
}

function Section({ icon, title, open, onToggle, right, children }) {
  return (
    <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
      <div onClick={onToggle} style={{
        display: "flex", alignItems: "center", gap: 9, padding: "12px 16px",
        cursor: "pointer", borderBottom: open ? `1px solid ${C.border}` : "none",
      }}>
        {icon}
        <span style={{ fontSize: 13.5, fontWeight: 700, color: C.gray800 }}>{title}</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}
          onClick={(e) => e.stopPropagation()}>{right}</div>
        <span style={{ color: C.gray400, fontSize: 13 }}>{open ? "▾" : "▸"}</span>
      </div>
      {open && <div style={{ padding: 16 }}>{children}</div>}
    </div>
  );
}

/** One SKU row — editable by its owner, reviewable by an admin. */
function ListingRow({ listing, isAdmin, platform, reference, frozen, onSave, onDelete, onReview, busy }) {
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState(listing);
  const [err, setErr] = useState("");
  const st = LISTING_STATUS[listing.status] || LISTING_STATUS.PENDING;

  useEffect(() => { setForm(listing); setErr(""); }, [listing]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    let payload;
    if (isAdmin) {
      payload = {};
      LISTING_FIELDS.forEach((f) => { payload[f.key] = form[f.key] ?? ""; });
      payload.notes = form.notes ?? "";
    } else {
      payload = { sku_id: form.sku_id, notes: form.notes ?? "" };
    }
    const e = await onSave(listing.id, payload);
    if (e) setErr(e); else { setEdit(false); setErr(""); }
  };

  if (edit) {
    return (
      <div style={{ border: `1px solid ${C.orangeBorder}`, borderRadius: 10, padding: 12, background: C.orangeLight }}>
        {isAdmin ? (
          <ListingFields form={form} set={set} platform={platform} reference={reference} />
        ) : (
          <div style={{ maxWidth: 320 }}>
            <label style={{ ...S.label, marginBottom: 3 }}>SKU id</label>
            <input value={form.sku_id ?? ""} onChange={set("sku_id")}
              style={{ ...S.inp, fontFamily: "monospace", fontWeight: 700 }} />
          </div>
        )}
        {err && <div style={{ fontSize: 12, color: C.red, fontWeight: 600, marginTop: 8 }}>{err}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button onClick={save} disabled={busy} style={btn("primary", "sm")}>Save</button>
          <button onClick={() => { setEdit(false); setForm(listing); setErr(""); }} style={btn("ghost", "sm")}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px",
      background: listing.status === "REJECTED" ? C.redLight : C.white,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 14, color: C.gray900 }}>
          {listing.sku_id}
        </span>
        <Tag variant={st.tag} fontSize={11}>{st.label}</Tag>
        {listing.prefix_ok === false && (
          <Tag variant="amber" fontSize={11}>doesn't start with {listing.sku_prefix}</Tag>
        )}
        {isAdmin && listing.created_by_name && (
          <span style={{ fontSize: 11.5, color: C.gray400 }}>by {listing.created_by_name}</span>
        )}
        <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {listing.reward_credited_at && <Money value={listing.reward_amount} />}
          {!frozen && (
            <button onClick={() => setEdit(true)} style={btn("ghost", "sm")}>Edit</button>
          )}
          {!frozen && !listing.reward_credited_at && (
            <button onClick={() => onDelete(listing.id)} disabled={busy}
              style={{ background: "none", border: "none", cursor: "pointer", color: C.gray300, padding: 2 }}>
              <DeleteOutlineIcon style={{ fontSize: 17 }} />
            </button>
          )}
        </span>
      </div>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 6, fontSize: 12, color: C.gray600 }}>
        {LISTING_FIELDS.filter((f) => f.key !== "sku_id" && listing[f.key]).map((f) => (
          <span key={f.key}>
            <span style={{ color: C.gray400 }}>{f.platformLabel ? `${platform} price` : f.label}: </span>
            <span style={{ fontWeight: 700, fontFamily: f.type === "money" ? "monospace" : "inherit" }}>
              {f.type === "money" ? fmt(listing[f.key]) : listing[f.key]}{f.type === "tax" ? "%" : ""}
            </span>
          </span>
        ))}
      </div>

      {listing.review_comment && (
        <div style={{ fontSize: 12, fontWeight: 600, marginTop: 6,
          color: listing.status === "REJECTED" ? C.red : C.green }}>
          {listing.review_comment}
        </div>
      )}

      {isAdmin && listing.status !== "APPROVED" && (
        <div style={{ display: "flex", gap: 7, marginTop: 9, flexWrap: "wrap" }}>
          <button onClick={() => onReview(listing.id, "APPROVE", "")} disabled={busy} style={btn("success", "sm")}>
            Approve &amp; pay
          </button>
          <button onClick={() => {
            const c = window.prompt("Why is it rejected?") || "";
            if (c) onReview(listing.id, "REJECT", c);
          }} disabled={busy} style={btn("danger", "sm")}>Reject</button>
        </div>
      )}
    </div>
  );
}

/** The per-SKU field set — shared by the add form and the edit row. */
function ListingFields({ form, set, platform, reference, hideSku }) {
  const hsnList = reference?.hsn_codes || [];
  const slabs = reference?.gst_slabs || [];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 9 }}>
      {LISTING_FIELDS.filter((f) => !(hideSku && f.key === "sku_id")).map((f) => (
        <div key={f.key}>
          <label style={{ ...S.label, marginBottom: 3 }}>
            {f.platformLabel ? `${platform} price` : f.label}{f.required ? " *" : ""}
          </label>
          {f.type === "hsn" ? (
            <select value={form[f.key] ?? ""} onChange={(e) => {
              set(f.key)(e);
              // Picking an HSN fills the tax rate you've actually filed under it.
              const hit = hsnList.find((h) => h.hsn === e.target.value);
              if (hit?.suggested_tax_percent) {
                set("tax_percent")({ target: { value: hit.suggested_tax_percent } });
              }
            }} style={{ ...S.inp, fontSize: 12.5 }}>
              <option value="">—</option>
              {hsnList.map((h) => (
                <option key={h.hsn} value={h.hsn}>
                  {h.hsn}{h.suggested_tax_percent ? ` (${h.suggested_tax_percent}%)` : ""}
                </option>
              ))}
            </select>
          ) : f.type === "tax" ? (
            <select value={form[f.key] ?? ""} onChange={set(f.key)} style={{ ...S.inp, fontSize: 12.5 }}>
              <option value="">—</option>
              {slabs.map((s) => <option key={s} value={s}>{s}%</option>)}
            </select>
          ) : (
            <input value={form[f.key] ?? ""} onChange={set(f.key)}
              type={f.type === "money" ? "number" : "text"} step="0.01"
              style={{ ...S.inp, fontSize: 12.5, fontFamily: f.mono ? "monospace" : "inherit" }} />
          )}
        </div>
      ))}
    </div>
  );
}

function AddListing({ task, reference, onAdd, busy, isAdmin }) {
  // Second and later SKUs of the same product share almost everything with the
  // first, so the form opens pre-filled from the last one added — only the SKU
  // itself is cleared.
  // Prefer the last SKU added (variants of one product are nearly identical),
  // and fall back to whatever the admin set on the task.
  const last = (task.listings || [])[0];
  const defaults = task.listing_defaults || {};
  const seed = () => {
    const base = { sku_id: "" };
    LISTING_FIELDS.forEach((f) => {
      if (f.key === "sku_id") return;
      base[f.key] = (last ? last[f.key] : null) ?? defaults[f.key] ?? "";
    });
    return base;
  };
  const [form, setForm] = useState(seed);
  const [err, setErr] = useState("");
  const [generating, setGenerating] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const add = async () => {
    if (!form.sku_id.trim()) return setErr("Enter the SKU id.");
    // A worker sends only the id; everything else is inherited server-side.
    const body = isAdmin ? form : { sku_id: form.sku_id };
    const e = await onAdd(task.id, body);
    if (e) { setErr(e); return; }
    setForm({ ...seed(), sku_id: "" });
    setErr("");
  };

  // The prefix an admin can type into the SKU-starts-with field, or the one
  // they already set on the task for a worker to inherit.
  const prefix = (isAdmin ? form.sku_prefix : defaults.sku_prefix) || "";

  const generateSku = async () => {
    if (!prefix.trim()) return setErr("Set a SKU prefix first, then generate.");
    setGenerating(true);
    try {
      const res = await fetch(`${API}/worker-tasks/${task.id}/generate-sku/?prefix=${encodeURIComponent(prefix.trim())}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(d.error || "Could not generate a SKU id."); return; }
      setForm((f) => ({ ...f, sku_id: d.sku_id }));
      setErr("");
    } catch { setErr("Network error."); }
    finally { setGenerating(false); }
  };

  return (
    <div style={{ border: `1px dashed ${C.gray200}`, borderRadius: 10, padding: 12, background: C.gray50 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: C.gray700, marginBottom: 8 }}>
        Add a SKU
      </div>
      {isAdmin ? (
        <ListingFields form={form} set={set} platform={task.platform} reference={reference} />
      ) : (
        <>
          <div style={{ maxWidth: 320 }}>
            <label style={{ ...S.label, marginBottom: 3 }}>SKU id *</label>
            <input value={form.sku_id} onChange={set("sku_id")} autoFocus
              placeholder={defaults.sku_prefix ? `${defaults.sku_prefix}…` : "the SKU you created"}
              style={{ ...S.inp, fontFamily: "monospace", fontWeight: 700 }} />
          </div>
          {/* The commercial values are the admin's; shown so the worker lists
              against the right numbers, but not editable. */}
          {Object.keys(defaults).length > 0 && (
            <div style={{ marginTop: 10, padding: "9px 12px", borderRadius: 8,
              background: C.white, border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: C.gray400,
                letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 5 }}>
                Use these values — set by the admin
              </div>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12.5, color: C.gray700 }}>
                {LISTING_FIELDS.filter((f) => f.key !== "sku_id" && defaults[f.key]).map((f) => (
                  <span key={f.key}>
                    <span style={{ color: C.gray400 }}>
                      {f.platformLabel ? `${task.platform} price` : f.label}:{" "}
                    </span>
                    <b style={{ fontFamily: f.type === "money" ? "monospace" : "inherit" }}>
                      {f.type === "money" ? fmt(defaults[f.key]) : defaults[f.key]}{f.type === "tax" ? "%" : ""}
                    </b>
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
      {prefix.trim() && (
        <button onClick={generateSku} disabled={generating} style={{ ...btn("ghost", "sm"), marginTop: 9 }}>
          {generating ? "Generating…" : `Generate SKU id (${prefix}…)`}
        </button>
      )}
      {err && (
        <div style={{ marginTop: 8, padding: "8px 11px", borderRadius: 8, background: C.redLight,
          border: `1px solid ${C.redBorder}`, color: C.red, fontSize: 12.5, fontWeight: 700 }}>
          {err}
        </div>
      )}
      <button onClick={add} disabled={busy} style={{ ...btn("primary", "sm"), marginTop: 10 }}>
        <AddIcon style={{ fontSize: 15, verticalAlign: "-3px" }} />&nbsp;Add SKU
      </button>
    </div>
  );
}

function TaskCard({ task, isAdmin, reference, collapsed, onToggleCollapse, onSubmit, onReview,
                    onPause, onDelete, onListingAdd, onListingSave, onListingDelete, onListingReview, busy }) {
  const isMobile = useIsMobile();
  const meta = STATUS_META[task.status] || STATUS_META.ASSIGNED;
  const type = TYPE_META[task.task_type] || TYPE_META.LISTING;
  const listing = task.task_type === "LISTING";
  const [reference_, setRef] = useState(task.submitted_reference || "");
  const [note, setNote] = useState(task.submitted_note || "");

  const listings = task.listings || [];
  const approved = listings.filter((l) => l.status === "APPROVED").length;

  return (
    <div style={{ ...S.card, padding: 0, overflow: "hidden",
      borderLeft: `4px solid ${task.is_paused ? C.gray400 : meta.accent}`,
      opacity: task.is_paused ? 0.92 : 1 }}>
      <div style={{ padding: isMobile ? "13px" : "15px 18px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginBottom: 7 }}>
          <Tag variant={PLATFORM_TAG[task.platform] || "gray"} fontSize={11.5}>{task.platform}</Tag>
          <Tag variant={type.tag} fontSize={11.5}>{type.label}</Tag>
          {task.is_paused && <Tag variant="gray" fontSize={11.5}>⏸ paused</Tag>}
          {!listing && <Tag variant={meta.tag} fontSize={11.5}>{meta.label}</Tag>}
          {task.awaiting_bonus && <Tag variant="amber" fontSize={11.5}>bonus pending</Tag>}
          {(task.assignee_names || []).length > 0 && (
            <span style={{ fontSize: 11.5, color: C.gray400 }}>
              {task.assignee_names.join(", ")}
            </span>
          )}
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontSize: 11, color: C.gray400 }}>{fmt(task.reward_amount)}/SKU</span>
            {Number(task.earned) > 0 && <Money value={task.earned} />}
          </span>
          <button onClick={onToggleCollapse} title={collapsed ? "Expand" : "Collapse"}
            style={{ background: "none", border: "none", cursor: "pointer", color: C.gray400,
              fontSize: 13, padding: "0 0 0 4px", lineHeight: 1 }}>
            {collapsed ? "▸" : "▾"}
          </button>
        </div>

        <div style={{ fontSize: 15, fontWeight: 700, color: C.gray800, cursor: "pointer" }} onClick={onToggleCollapse}>
          {task.title || (listing ? "Listing task" : "Return claim task")}
        </div>
        {task.suborder_no && (
          <div style={{ fontSize: 12, color: C.gray500, fontFamily: "monospace", marginTop: 2 }}>{task.suborder_no}</div>
        )}
        {(task.parent_sku_item_id || task.listing_template_name) && (
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 6 }}>
            {task.parent_sku_item_id && (
              <Tag variant="blue" fontSize={11}>
                Parent: {task.parent_sku_item_id}{task.parent_sku_price ? ` (${fmt(task.parent_sku_price)})` : ""}
              </Tag>
            )}
            {task.listing_template_name && (
              <Tag variant="gray" fontSize={11}>Template: {task.listing_template_name}</Tag>
            )}
          </div>
        )}
        {task.instructions && !collapsed && (
          <div style={{ fontSize: 13, color: C.gray600, marginTop: 7, lineHeight: 1.6 }}>{task.instructions}</div>
        )}
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 9, flexWrap: "wrap" }}>
          {task.source_link && (
            <a href={task.source_link} target="_blank" rel="noreferrer"
              style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13, fontWeight: 700,
                color: C.blue, textDecoration: "none" }}>
              {listing ? "Open the photo folder" : "Open the video"} <OpenInNewIcon style={{ fontSize: 14 }} />
            </a>
          )}
          {!listing && (
            <span style={{ fontSize: 11.5, color: C.gray400 }}>
              Compress under {CLAIM_VIDEO_MAX_MB}MB before uploading the claim.
            </span>
          )}
          {isAdmin && (
            <button onClick={() => onDelete(task.id, task.title)} disabled={busy}
              title="Delete this task"
              style={{ ...btn("ghost", "sm"), marginLeft: "auto", color: C.red, borderColor: C.redBorder }}>
              <DeleteOutlineIcon style={{ fontSize: 15, verticalAlign: "-3px" }} />&nbsp;Delete
            </button>
          )}
          {isAdmin && (
            <button onClick={() => onPause(task.id, !task.is_paused)} disabled={busy}
              style={btn("ghost", "sm")}>
              {task.is_paused
                ? <><PlayCircleIcon style={{ fontSize: 15, verticalAlign: "-3px" }} />&nbsp;Resume</>
                : <><PauseCircleIcon style={{ fontSize: 15, verticalAlign: "-3px" }} />&nbsp;Pause</>}
            </button>
          )}
        </div>
      </div>

      {/* Listing tasks: many SKUs */}
      {listing && !collapsed && (
        <div style={{ padding: isMobile ? "13px" : "14px 18px", background: C.gray50,
          display: "flex", flexDirection: "column", gap: 9 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: C.gray600 }}>
            SKUs · {listings.length} added, {approved} approved
          </div>
          {listings.map((l) => (
            <ListingRow key={l.id} listing={l} isAdmin={isAdmin} platform={task.platform}
              reference={reference} frozen={task.is_paused && !isAdmin} busy={busy}
              onSave={onListingSave} onDelete={onListingDelete} onReview={onListingReview} />
          ))}
          {task.is_paused ? (
            <div style={{ fontSize: 12.5, color: C.gray500, fontStyle: "italic", padding: "8px 0" }}>
              Paused — existing SKUs stay visible, but no new ones can be added.
            </div>
          ) : (
            <AddListing task={task} reference={reference} onAdd={onListingAdd} busy={busy} isAdmin={isAdmin} />
          )}
        </div>
      )}

      {/* Claim tasks: one submission */}
      {!listing && !collapsed && (
        <div style={{ padding: isMobile ? "13px" : "14px 18px", background: C.gray50 }}>
          {!isAdmin && task.status !== "APPROVED" ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                <div>
                  <label style={S.label}>Claim / ticket reference</label>
                  <input value={reference_} onChange={(e) => setRef(e.target.value)}
                    style={{ ...S.inp, fontFamily: "monospace" }} />
                </div>
                <div>
                  <label style={S.label}>Note</label>
                  <input value={note} onChange={(e) => setNote(e.target.value)} style={S.inp} />
                </div>
              </div>
              <button onClick={() => onSubmit(task.id, { submitted_reference: reference_, submitted_note: note })}
                disabled={busy} style={{ ...btn("primary", "md"), marginTop: 11 }}>
                {task.status === "REJECTED" ? "Send again" : "Mark done"}
              </button>
            </>
          ) : (
            <div style={{ fontSize: 13, color: C.gray600 }}>
              {task.submitted_reference && <>Ref <b style={{ fontFamily: "monospace" }}>{task.submitted_reference}</b> · </>}
              {task.submitted_by_name && <>by {task.submitted_by_name} · </>}
              sent {fmtDate(task.submitted_at)}
            </div>
          )}
          {isAdmin && task.status === "SUBMITTED" && (
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <button onClick={() => onReview(task.id, "APPROVE", "")} disabled={busy} style={btn("success", "md")}>
                Approve &amp; pay {fmt(task.reward_amount)}
              </button>
              <button onClick={() => {
                const c = window.prompt("Why is it rejected?") || "";
                if (c) onReview(task.id, "REJECT", c);
              }} disabled={busy} style={btn("danger", "md")}>Reject</button>
            </div>
          )}
        </div>
      )}

      {task.review_comment && task.status !== "SUBMITTED" && !collapsed && (
        <div style={{ padding: "11px 18px",
          background: task.status === "REJECTED" ? C.redLight : C.greenLight,
          color: task.status === "REJECTED" ? C.red : C.green, fontSize: 12.5, fontWeight: 600 }}>
          {task.status === "REJECTED" ? "Rejected" : "Approved"}: {task.review_comment}
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
  const [reference, setReference] = useState(null);
  const [docs, setDocs] = useState([]);
  const [rates, setRates] = useState([]);
  const [parentSkus, setParentSkus] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [collapsed, setCollapsed] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState("");
  const [platformFilter, setPlatformFilter] = useState("");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState(null);
  const [panel, setPanel] = useState(null);   // "wallet" | "docs" | "rates"

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (view) p.set("status", view);
      if (platformFilter) p.set("platform", platformFilter);
      if (search.trim()) p.set("q", search.trim());
      const res = await fetch(`${API}/worker-tasks/?${p}`);
      const d = await res.json();
      setIsAdmin(!!d.is_admin);
      setTasks(d.results || []);
      setStats(d.stats || null);
    } finally { setLoading(false); }
  }, [view, platformFilter, search]);

  const fetchAux = useCallback(async () => {
    const grab = async (url, set, key) => {
      try {
        const r = await fetch(url);
        if (r.ok) { const d = await r.json(); set(key ? (d[key] || []) : d); }
      } catch { /* panel just stays empty */ }
    };
    grab(`${API}/wallet/`, setWallet);
    grab(`${API}/task-reference/`, setReference);
    grab(`${API}/task-documents/`, setDocs, "results");
    grab(`${API}/platform-rates/`, setRates, "results");
    grab(`${API}/parent-prices/`, setParentSkus, "results");
    grab(`${API}/listing-templates/?full=0`, setTemplates, "results");
  }, []);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);
  useEffect(() => { fetchAux(); }, [fetchAux]);
  useEffect(() => {
    if (!isAdmin) return;
    fetch(`${API}/worker-tasks/workers/`).then(r => r.json())
      .then(d => setWorkers(d.results || [])).catch(() => {});
  }, [isAdmin]);

  // New tasks default expanded (need attention); approved/rejected ones default
  // collapsed (nothing left to do). Only fills in ids we haven't seen before, so
  // a manual toggle survives the next refetch.
  useEffect(() => {
    setCollapsed((prev) => {
      let changed = false;
      const next = { ...prev };
      tasks.forEach((t) => {
        if (!(t.id in next)) {
          next[t.id] = t.status === "APPROVED" || t.status === "REJECTED";
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [tasks]);
  const toggleCollapse = (id) => setCollapsed((c) => ({ ...c, [id]: !c[id] }));
  const setAllCollapsed = (value) =>
    setCollapsed((c) => ({ ...c, ...Object.fromEntries(tasks.map((t) => [t.id, value])) }));

  /** POST helper — returns an error string, or null on success. */
  const post = async (url, body, okMsg, method = "POST") => {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method, headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return d.error || "That didn't work.";
      if (okMsg) setMsg({ type: "success", text: typeof okMsg === "function" ? okMsg(d) : okMsg });
      fetchTasks(); fetchAux();
      return null;
    } catch { return "Network error."; }
    finally { setBusy(false); }
  };

  const submitTask = (id, body) => post(`${API}/worker-tasks/${id}/submit/`, body, "Sent for review.");
  const reviewTask = (id, decision, comment) =>
    post(`${API}/worker-tasks/${id}/review/`, { decision, comment },
      (d) => d.credited ? `Approved — ${fmt(d.credited)} added.` : "Recorded.");
  const pauseTask = (id, paused) =>
    post(`${API}/worker-tasks/${id}/`, { is_paused: paused },
      paused ? "Task paused — no new SKUs." : "Task resumed.", "PATCH");
  const deleteTask = async (id, title) => {
    if (!window.confirm(`Delete "${title || "this task"}"? Any wallet balance already earned from it is kept.`)) return;
    const e = await post(`${API}/worker-tasks/${id}/`, {}, (d) =>
      d.wallet_entries_kept ? `Task deleted — ${fmt(d.amount_kept)} already earned stays in the wallet.`
                            : "Task deleted.", "DELETE");
    if (e) setMsg({ type: "error", text: e });
  };
  const addListing = (taskId, form) => post(`${API}/worker-tasks/${taskId}/listings/`, form, "SKU added.");
  const saveListing = (id, form) => post(`${API}/task-listings/${id}/`, form, "Saved.", "PATCH");
  const deleteListing = async (id) => {
    if (!window.confirm("Remove this SKU?")) return null;
    const e = await post(`${API}/task-listings/${id}/`, {}, "Removed.", "DELETE");
    if (e) setMsg({ type: "error", text: e });
    return e;
  };
  const reviewListing = async (id, decision, comment) => {
    const e = await post(`${API}/task-listings/${id}/review/`, { decision, comment },
      (d) => d.credited ? `Approved — ${fmt(d.credited)} added.` : "Recorded.");
    if (e) setMsg({ type: "error", text: e });
  };
  /** A manual ledger line — a correction or a bonus. Requires a reason, so the
      balance never moves without an explanation attached. */
  const adjust = (userId, username) => {
    const raw = window.prompt(`Adjust ${username}'s balance by how much? Use a minus for a deduction.`, "");
    if (!raw) return;
    const note = window.prompt("Why? (recorded against the entry)", "");
    if (!note) { setMsg({ type: "error", text: "An adjustment needs a reason." }); return; }
    post(`${API}/wallet/adjust/`, { user_id: userId, amount: raw, note },
      `Adjusted ${username}'s balance by ${fmt(raw)}.`);
  };

  const settle = (userId, username) => {
    if (!window.confirm(`Mark everything outstanding for ${username} as paid?`)) return;
    const method = window.prompt("How was it paid? (UPI / cash / bank)", "UPI") || "";
    const ref = window.prompt("Reference / UTR (optional)", "") || "";
    post(`${API}/wallet/settle/`, { user_id: userId, method, reference: ref },
      (d) => `Settled ${fmt(d.settlement.amount)} for ${username}.`);
  };

  const pending = wallet?.totals?.pending ?? 0;
  const platforms = reference?.platforms || [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <ChecklistIcon style={{ color: C.orange, fontSize: 21 }} />
            <h1 style={{ fontSize: 19, fontWeight: 800, color: C.gray800 }}>Team Tasks</h1>
          </div>
          <p style={{ fontSize: 12, color: C.gray400, marginTop: 3 }}>
            {isAdmin ? "Assign listing and claim work, review each SKU, and pay for it"
                     : "Your tasks and what you've earned"}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={() => setPanel(p => p === "wallet" ? null : "wallet")} style={btn("ghost", "sm")}>
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
        <div style={{ padding: "11px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600,
          background: msg.type === "success" ? C.greenLight : C.redLight,
          color: msg.type === "success" ? C.green : C.red,
          border: `1px solid ${msg.type === "success" ? C.greenBorder : C.redBorder}`,
          display: "flex", alignItems: "center", gap: 8 }}>
          {msg.type === "success" ? <CheckCircleIcon style={{ fontSize: 17 }} /> : <ErrorOutlineIcon style={{ fontSize: 17 }} />}
          <span style={{ flex: 1 }}>{msg.text}</span>
          <button onClick={() => setMsg(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", fontSize: 16 }}>×</button>
        </div>
      )}

      {creating && isAdmin && (
        <NewTaskForm workers={workers} platforms={platforms} rates={rates} reference={reference}
          parentSkus={parentSkus} templates={templates}
          onCancel={() => setCreating(false)}
          onCreate={async (body) => {
            const e = await post(`${API}/worker-tasks/`, body, "Task created.");
            if (!e) setCreating(false);
            return e;
          }} />
      )}

      {/* How-to manuals — everyone can read them */}
      <Section icon={<MenuBookIcon style={{ fontSize: 18, color: C.blue }} />}
        title={`How-to documents${docs.length ? ` (${docs.length})` : ""}`}
        open={panel === "docs"} onToggle={() => setPanel(p => p === "docs" ? null : "docs")}
        right={isAdmin && panel === "docs" && (
          <button onClick={async () => {
            const title = window.prompt("Document title"); if (!title) return;
            const url = window.prompt("Link (Drive, Docs, video…)") || "";
            await post(`${API}/task-documents/`, { title, url }, "Document added.");
          }} style={btn("ghost", "sm")}>Add</button>
        )}>
        {docs.length === 0 ? (
          <div style={{ fontSize: 13, color: C.gray400 }}>
            No manuals yet.{isAdmin ? " Add the listing how-to so the team can follow it." : ""}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {docs.map((d) => (
              <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 10,
                padding: "9px 12px", border: `1px solid ${C.border}`, borderRadius: 9 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: C.gray800 }}>
                    {d.title}{d.platform ? <Tag variant="gray" fontSize={10}>&nbsp;{d.platform}</Tag> : null}
                  </div>
                  {d.description && <div style={{ fontSize: 12, color: C.gray500 }}>{d.description}</div>}
                </div>
                {d.url && (
                  <a href={d.url} target="_blank" rel="noreferrer"
                    style={{ fontSize: 12.5, fontWeight: 700, color: C.blue, textDecoration: "none", whiteSpace: "nowrap" }}>
                    Open <OpenInNewIcon style={{ fontSize: 13, verticalAlign: "-2px" }} />
                  </a>
                )}
                {isAdmin && (
                  <button onClick={() => post(`${API}/task-documents/${d.id}/`, {}, "Removed.", "DELETE")}
                    style={{ background: "none", border: "none", cursor: "pointer", color: C.gray300 }}>
                    <DeleteOutlineIcon style={{ fontSize: 17 }} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Standing rates */}
      {isAdmin && (
        <Section icon={<PriceChangeIcon style={{ fontSize: 18, color: C.green }} />}
          title="Rates per platform"
          open={panel === "rates"} onToggle={() => setPanel(p => p === "rates" ? null : "rates")}>
          <RatesEditor rates={rates} platforms={platforms} busy={busy}
            onSave={(rows) => post(`${API}/platform-rates/`, { rates: rows }, "Rates saved.", "PUT")} />
          <div style={{ borderTop: `1px solid ${C.border}`, margin: "16px 0" }} />
          <div style={{ fontSize: 12.5, fontWeight: 700, color: C.gray700, marginBottom: 3 }}>
            Per-worker rates
          </div>
          <WorkerRatesEditor rates={rates} platforms={platforms} workers={workers} busy={busy}
            onSave={(rows) => post(`${API}/platform-rates/`, { rates: rows }, "Rate saved.", "PUT")} />
        </Section>
      )}

      {/* Wallet */}
      {panel === "wallet" && wallet && (
        <div style={{ ...S.card, borderTop: `4px solid ${C.green}` }}>
          <div style={{ ...S.cardTitle, marginBottom: 12 }}>{isAdmin ? "Wallets" : "My wallet"}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            <Metric label="earned" value={wallet.totals.earned} accent={C.green} money />
            <Metric label="paid out" value={wallet.totals.settled} accent={C.gray500} money />
            <Metric label="still owed" value={wallet.totals.pending} accent={C.orange} money />
          </div>
          <div style={{ overflowX: "auto" }}>
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
                      {isAdmin && (
                        <span style={{ display: "flex", gap: 6 }}>
                          {u.pending > 0 && (
                            <button onClick={() => settle(u.user_id, u.username)} disabled={busy} style={btn("ghost", "sm")}>
                              Mark paid
                            </button>
                          )}
                          <button onClick={() => adjust(u.user_id, u.username)} disabled={busy} style={btn("ghost", "sm")}>
                            Adjust
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {wallet.per_user.length === 0 && (
                  <tr><td colSpan={5} style={{ ...S.td, textAlign: "center", padding: 24, color: C.gray400 }}>
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
          {stats.awaiting_bonus > 0 && <Metric label="bonus pending" value={stats.awaiting_bonus} accent={C.orange} />}
          <Metric label="still owed" value={stats.pending} accent={C.orange} money />
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "inline-flex", background: C.gray100, borderRadius: 10, padding: 3, border: `1px solid ${C.border}` }}>
          {[{ k: "", l: "All" }, { k: "SUBMITTED", l: "To review" }, { k: "ASSIGNED", l: "To do" },
            { k: "APPROVED", l: "Approved" }, { k: "REJECTED", l: "Rejected" }].map((v) => (
            <button key={v.k || "all"} onClick={() => setView(v.k)}
              style={{ border: "none", cursor: "pointer", fontFamily: "inherit",
                background: view === v.k ? C.white : "transparent",
                color: view === v.k ? C.gray800 : C.gray500,
                fontWeight: view === v.k ? 800 : 600, fontSize: 12.5,
                padding: "6px 13px", borderRadius: 8,
                boxShadow: view === v.k ? "0 1px 3px rgba(0,0,0,0.10)" : "none" }}>
              {v.l}
            </button>
          ))}
        </div>
        <select value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)}
          style={{ ...S.inp, maxWidth: 150 }}>
          <option value="">Any platform</option>
          {platforms.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title / SKU / sub-order…" style={{ ...S.inp, maxWidth: 260, flex: "1 1 170px" }} />
        {tasks.length > 1 && (
          <span style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
            <button onClick={() => setAllCollapsed(false)} style={btn("ghost", "sm")}>Expand all</button>
            <button onClick={() => setAllCollapsed(true)} style={btn("ghost", "sm")}>Collapse all</button>
          </span>
        )}
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
            <TaskCard key={t.id} task={t} isAdmin={isAdmin} reference={reference} busy={busy}
              collapsed={!!collapsed[t.id]} onToggleCollapse={() => toggleCollapse(t.id)}
              onSubmit={submitTask} onReview={reviewTask} onPause={pauseTask} onDelete={deleteTask}
              onListingAdd={addListing} onListingSave={saveListing}
              onListingDelete={deleteListing} onListingReview={reviewListing} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Create ────────────────────────────────────────────────────────────────────
function NewTaskForm({ workers, platforms, rates, reference, parentSkus, templates, onCreate, onCancel }) {
  const [type, setType] = useState("LISTING");
  const [defaults, setDefaults] = useState({});
  const setDefault = (k) => (e) => setDefaults((d) => ({ ...d, [k]: e.target.value }));
  const [platform, setPlatform] = useState("MEESHO");
  const [picked, setPicked] = useState([]);
  const [form, setForm] = useState({ title: "", source_link: "", instructions: "", suborder_no: "" });
  const [rateOverride, setRateOverride] = useState("");
  const [parentSkuId, setParentSkuId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [err, setErr] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // The standing rate for this platform — a picked worker's own override (the
  // point of req 2: an admin's per-person rate decision) takes precedence over
  // the business-wide one. Only meaningful with a single assignee, since one
  // task still pays one flat rate to everyone on it.
  const standing = useMemo(() => {
    if (picked.length === 1) {
      const personal = rates.find((r) => r.platform === platform && r.task_type === type && r.user === picked[0]);
      if (personal) return personal;
    }
    return rates.find((r) => r.platform === platform && r.task_type === type && !r.user);
  }, [rates, platform, type, picked]);

  const submit = async () => {
    if (!picked.length) return setErr("Pick at least one person.");
    const body = { ...form, task_type: type, platform, assignees: picked };
    if (rateOverride !== "") body.reward_amount = rateOverride;
    // Drop empties so a blank field doesn't override the worker's own entry.
    const kept = Object.fromEntries(Object.entries(defaults).filter(([, v]) => v !== "" && v != null));
    if (type === "LISTING") {
      if (Object.keys(kept).length) body.listing_defaults = kept;
      if (parentSkuId) body.parent_sku_item_id = parentSkuId;
      if (templateId) body.listing_template = templateId;
    }
    const e = await onCreate(body);
    if (e) setErr(e);
  };

  return (
    <div style={{ ...S.card, borderTop: `4px solid ${C.orange}` }}>
      <div style={{ ...S.cardTitle, marginBottom: 14 }}>New task</div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {["LISTING", "RETURN_CLAIM"].map((t) => (
          <button key={t} onClick={() => setType(t)} style={btn(type === t ? "primary" : "ghost", "md")}>
            {TYPE_META[t].label}
          </button>
        ))}
        <span style={{ width: 1, background: C.border, margin: "0 4px" }} />
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
          <input value={form.title} onChange={set("title")} style={S.inp}
            placeholder={type === "LISTING" ? "e.g. Brass lota photoshoot" : "e.g. Claim for damaged return"} />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={S.label}>
            {type === "LISTING" ? "Google Drive folder with the photo" : "Link to the claim video"}
          </label>
          <input value={form.source_link} onChange={set("source_link")} style={S.inp} placeholder="https://drive.google.com/…" />
        </div>
        {type === "RETURN_CLAIM" && (
          <div>
            <label style={S.label}>Sub-order number</label>
            <input value={form.suborder_no} onChange={set("suborder_no")}
              style={{ ...S.inp, fontFamily: "monospace" }} placeholder="3078…_1" />
          </div>
        )}
        <div>
          <label style={S.label}>Rate {type === "LISTING" ? "per SKU" : "per claim"} (₹)</label>
          <input value={rateOverride} onChange={(e) => setRateOverride(e.target.value)} type="number"
            style={S.inp} placeholder={standing ? `${standing.reward_amount} (standing rate)` : "set a rate below"} />
          <div style={{ fontSize: 11, color: C.gray400, marginTop: 4 }}>
            {standing
              ? `Leave blank to use ${standing.user ? `${standing.user_name}'s rate` : `the ${platform} rate`} of ${fmt(standing.reward_amount)}.`
              : `No standing ${platform} rate yet — set one in "Rates per platform".`}
          </div>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={S.label}>Instructions</label>
          <textarea value={form.instructions} onChange={set("instructions")} rows={2}
            style={{ ...S.inp, resize: "vertical" }}
            placeholder={type === "LISTING"
              ? "Download the photo, edit it, create the listings, then add each SKU below."
              : `Download the video, compress under ${CLAIM_VIDEO_MAX_MB}MB, raise the claim.`} />
        </div>
      </div>

      {/* Listing values you decide, not the worker: every SKU on this task
          starts from these, and they can still be corrected per variant. */}
      {type === "LISTING" && (
        <div style={{ marginTop: 16, padding: 13, borderRadius: 10,
          background: C.gray50, border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: C.gray700, marginBottom: 3 }}>
            Listing details for every SKU on this task
          </div>
          <div style={{ fontSize: 11.5, color: C.gray400, marginBottom: 10 }}>
            Optional — these prefill the worker's SKU form. Leave blank to let them fill it in.
          </div>
          <ListingFields form={defaults} set={setDefault} platform={platform} reference={reference}
            hideSku />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 9, marginTop: 12 }}>
            <div>
              <label style={{ ...S.label, marginBottom: 3 }}>Link to parent SKU</label>
              <input list="parent-sku-options" value={parentSkuId}
                onChange={(e) => setParentSkuId(e.target.value)}
                placeholder="Search parent item id…" style={{ ...S.inp, fontSize: 12.5 }} />
              <datalist id="parent-sku-options">
                {parentSkus.map((p) => <option key={p.item_id} value={p.item_id} />)}
              </datalist>
              <div style={{ fontSize: 10.5, color: C.gray400, marginTop: 3 }}>
                Every SKU approved on this task will link — and price itself — to this parent.
              </div>
            </div>
            <div>
              <label style={{ ...S.label, marginBottom: 3 }}>Use listing template</label>
              <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}
                style={{ ...S.inp, fontSize: 12.5 }}>
                <option value="">—</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} ({t.field_count} fields)</option>
                ))}
              </select>
              <div style={{ fontSize: 10.5, color: C.gray400, marginTop: 3 }}>
                Shown on the task so the team applies the same extension template.
              </div>
            </div>
          </div>
        </div>
      )}

      {err && (
        <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 10, background: C.redLight,
          border: `1px solid ${C.redBorder}`, color: C.red, fontSize: 13, fontWeight: 600 }}>{err}</div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button onClick={submit} style={btn("primary", "md")}>Create &amp; assign</button>
        <button onClick={onCancel} style={btn("ghost", "md")}>Cancel</button>
      </div>
    </div>
  );
}

function RatesEditor({ rates, platforms, onSave, busy }) {
  const [draft, setDraft] = useState({});
  // Business-wide rows only — the array may also hold per-worker overrides
  // (see WorkerRatesEditor), and those must never leak into the default table.
  const businessRates = useMemo(() => rates.filter((r) => !r.user), [rates]);
  const value = (platform, type, field) => {
    const k = `${platform}|${type}|${field}`;
    if (k in draft) return draft[k];
    const row = businessRates.find((r) => r.platform === platform && r.task_type === type);
    return row ? row[field] : "";
  };
  const set = (platform, type, field) => (e) =>
    setDraft((d) => ({ ...d, [`${platform}|${type}|${field}`]: e.target.value }));

  const save = () => {
    const rows = [];
    platforms.forEach((p) => ["LISTING", "RETURN_CLAIM"].forEach((t) => {
      rows.push({
        platform: p.value, task_type: t,
        reward_amount: value(p.value, t, "reward_amount") || 0,
        bonus_amount: value(p.value, t, "bonus_amount") || 0,
      });
    }));
    onSave(rows);
    setDraft({});
  };

  return (
    <>
      <div style={{ fontSize: 12, color: C.gray500, marginBottom: 10, lineHeight: 1.6 }}>
        A rate applies to tasks created from now on. Work already assigned or paid keeps the rate it had.
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr>{["Platform", "Listing / SKU", "Claim raised", "Claim bonus"].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {platforms.map((p, i) => (
              <tr key={p.value} style={{ background: i % 2 ? C.gray50 : C.white }}>
                <td style={{ ...S.td, fontWeight: 700 }}>{p.label}</td>
                <td style={S.td}>
                  <input value={value(p.value, "LISTING", "reward_amount")} onChange={set(p.value, "LISTING", "reward_amount")}
                    type="number" style={{ ...S.inp, width: 90 }} />
                </td>
                <td style={S.td}>
                  <input value={value(p.value, "RETURN_CLAIM", "reward_amount")} onChange={set(p.value, "RETURN_CLAIM", "reward_amount")}
                    type="number" style={{ ...S.inp, width: 90 }} />
                </td>
                <td style={S.td}>
                  <input value={value(p.value, "RETURN_CLAIM", "bonus_amount")} onChange={set(p.value, "RETURN_CLAIM", "bonus_amount")}
                    type="number" style={{ ...S.inp, width: 90 }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={save} disabled={busy} style={{ ...btn("primary", "sm"), marginTop: 12 }}>Save rates</button>
    </>
  );
}

/** A standing rate for one specific worker — overrides the business-wide rate
    above whenever a task is created for them alone (see NewTaskForm). */
function WorkerRatesEditor({ rates, platforms, workers, onSave, busy }) {
  const [workerId, setWorkerId] = useState(workers[0]?.id ?? "");
  const [draft, setDraft] = useState({});
  useEffect(() => { setDraft({}); }, [workerId]);

  const personalRates = useMemo(
    () => rates.filter((r) => String(r.user) === String(workerId)),
    [rates, workerId]);
  const value = (platform, type, field) => {
    const k = `${platform}|${type}|${field}`;
    if (k in draft) return draft[k];
    const row = personalRates.find((r) => r.platform === platform && r.task_type === type);
    return row ? row[field] : "";
  };
  const set = (platform, type, field) => (e) =>
    setDraft((d) => ({ ...d, [`${platform}|${type}|${field}`]: e.target.value }));

  const save = () => {
    if (!workerId) return;
    const rows = [];
    platforms.forEach((p) => ["LISTING", "RETURN_CLAIM"].forEach((t) => {
      rows.push({
        platform: p.value, task_type: t, user_id: workerId,
        reward_amount: value(p.value, t, "reward_amount") || 0,
        bonus_amount: value(p.value, t, "bonus_amount") || 0,
      });
    }));
    onSave(rows);
    setDraft({});
  };

  if (workers.length === 0) {
    return <div style={{ fontSize: 12.5, color: C.gray400 }}>No workers in this business yet.</div>;
  }

  return (
    <>
      <div style={{ fontSize: 12, color: C.gray500, marginBottom: 10, lineHeight: 1.6 }}>
        Pay one person more or less than everyone else. Leaving a field blank here
        (and saving) clears their override back to the business-wide rate.
      </div>
      <div style={{ marginBottom: 10, maxWidth: 220 }}>
        <label style={S.label}>Worker</label>
        <select value={workerId} onChange={(e) => setWorkerId(e.target.value)} style={S.inp}>
          {workers.map((w) => <option key={w.id} value={w.id}>{w.username}</option>)}
        </select>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr>{["Platform", "Listing / SKU", "Claim raised", "Claim bonus"].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {platforms.map((p, i) => (
              <tr key={p.value} style={{ background: i % 2 ? C.gray50 : C.white }}>
                <td style={{ ...S.td, fontWeight: 700 }}>{p.label}</td>
                <td style={S.td}>
                  <input value={value(p.value, "LISTING", "reward_amount")} onChange={set(p.value, "LISTING", "reward_amount")}
                    type="number" style={{ ...S.inp, width: 90 }} />
                </td>
                <td style={S.td}>
                  <input value={value(p.value, "RETURN_CLAIM", "reward_amount")} onChange={set(p.value, "RETURN_CLAIM", "reward_amount")}
                    type="number" style={{ ...S.inp, width: 90 }} />
                </td>
                <td style={S.td}>
                  <input value={value(p.value, "RETURN_CLAIM", "bonus_amount")} onChange={set(p.value, "RETURN_CLAIM", "bonus_amount")}
                    type="number" style={{ ...S.inp, width: 90 }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={save} disabled={busy || !workerId} style={{ ...btn("primary", "sm"), marginTop: 12 }}>
        Save {workers.find((w) => String(w.id) === String(workerId))?.username}'s rates
      </button>
    </>
  );
}
