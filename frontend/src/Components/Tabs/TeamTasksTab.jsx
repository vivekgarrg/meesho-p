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
import SettingsIcon from "@mui/icons-material/Settings";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import SendIcon from "@mui/icons-material/Send";
import SearchIcon from "@mui/icons-material/Search";
import TaskAltIcon from "@mui/icons-material/TaskAlt";
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
  PENDING:  { label: "Waiting for approval", short: "Waiting",  tag: "amber", accent: C.amber },
  APPROVED: { label: "Approved",             short: "Approved", tag: "green", accent: C.green },
  REJECTED: { label: "Needs a fix",          short: "Rejected", tag: "red",   accent: C.red },
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

/**
 * Inputs are 13px on desktop, but iOS Safari zooms the whole page whenever a
 * focused input is under 16px — so every field grows on a phone. One helper so
 * no field in this tab can forget.
 */
const field = (isMobile, extra) => ({ ...S.inp, fontSize: isMobile ? 16 : 13, ...extra });

/** Buttons need a 40px tap target on touch; ghost icon buttons especially. */
const tap = (isMobile, extra) => ({
  background: "none", border: "none", cursor: "pointer", color: C.gray400,
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: isMobile ? 40 : 30, height: isMobile ? 40 : 30, borderRadius: 9,
  padding: 0, flexShrink: 0, ...extra,
});

function Chevron({ open, size = 20, color = C.gray400 }) {
  return (
    <ExpandMoreIcon style={{
      fontSize: size, color, flexShrink: 0,
      transition: "transform 0.18s ease",
      transform: open ? "rotate(180deg)" : "rotate(0deg)",
    }} />
  );
}

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
      borderRadius: 11, padding: "10px 15px", minWidth: 96,
      cursor: onClick ? "pointer" : "default",
      display: "flex", flexDirection: "column", gap: 2,
      fontFamily: "inherit", textAlign: "left", flexShrink: 0,
      boxShadow: active ? "none" : "0 1px 2px rgba(19,17,28,0.04)",
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
        <Chevron open={open} size={18} />
      </div>
      {open && <div style={{ padding: 16 }}>{children}</div>}
    </div>
  );
}

/** A three-segment bar: approved / waiting / rejected out of the whole task. */
function ProgressBar({ approved, pending, rejected }) {
  const total = approved + pending + rejected;
  if (!total) return null;
  const seg = (n, color) => n > 0 && (
    <div style={{ width: `${(n / total) * 100}%`, background: color }} />
  );
  return (
    <div style={{ display: "flex", height: 5, borderRadius: 99, overflow: "hidden",
      background: C.gray200 }}>
      {seg(approved, C.green)}
      {seg(pending, C.amber)}
      {seg(rejected, C.red)}
    </div>
  );
}

/** One SKU — compact by default, with its details a tap away on a phone. */
function ListingRow({ listing, isAdmin, platform, reference, frozen, onSave, onDelete, onReview, busy }) {
  const isMobile = useIsMobile();
  const [edit, setEdit] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [form, setForm] = useState(listing);
  const [err, setErr] = useState("");
  const st = LISTING_STATUS[listing.status] || LISTING_STATUS.PENDING;

  useEffect(() => { setForm(listing); setErr(""); }, [listing]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // sku_prefix is a property of the task, not of this SKU — it's already a chip
  // on the card header, so repeating it on every row is pure noise.
  const details = LISTING_FIELDS.filter(
    (f) => f.key !== "sku_id" && f.key !== "sku_prefix" && listing[f.key]);

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
      <div style={{ border: `1.5px solid ${C.orangeBorder}`, borderRadius: 12, padding: 13,
        background: C.orangeLight }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: C.orange, letterSpacing: "0.06em",
          textTransform: "uppercase", marginBottom: 9 }}>
          {listing.status === "REJECTED" ? "Fix and send again" : "Edit SKU"}
        </div>
        {isAdmin ? (
          <ListingFields form={form} set={set} platform={platform} reference={reference} />
        ) : (
          <div style={{ maxWidth: 340 }}>
            <label style={{ ...S.label, marginBottom: 3 }}>SKU id</label>
            <input value={form.sku_id ?? ""} onChange={set("sku_id")}
              style={field(isMobile, { fontFamily: "monospace", fontWeight: 700 })} />
          </div>
        )}
        {err && <div style={{ fontSize: 12.5, color: C.red, fontWeight: 700, marginTop: 9 }}>{err}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 11 }}>
          <button onClick={save} disabled={busy}
            style={{ ...btn("primary", "sm"), flex: isMobile ? 1 : "none", padding: isMobile ? "10px 14px" : undefined }}>
            {listing.status === "REJECTED" ? "Save & resend" : "Save"}
          </button>
          <button onClick={() => { setEdit(false); setForm(listing); setErr(""); }}
            style={{ ...btn("ghost", "sm"), flex: isMobile ? 1 : "none", padding: isMobile ? "10px 14px" : undefined }}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      border: `1px solid ${listing.status === "REJECTED" ? C.redBorder : C.border}`,
      borderLeft: `3px solid ${st.accent}`,
      borderRadius: 12, padding: isMobile ? "11px 12px" : "11px 14px",
      background: listing.status === "REJECTED" ? C.redLight : C.white,
    }}>
      {/* Line 1 — the identity of the SKU and where it stands. */}
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 14.5,
              color: C.gray900, wordBreak: "break-all" }}>
              {listing.sku_id}
            </span>
            <Tag variant={st.tag} fontSize={10.5}>{st.short}</Tag>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 3 }}>
            {isAdmin && listing.created_by_name && (
              <span style={{ fontSize: 11.5, color: C.gray400 }}>by {listing.created_by_name}</span>
            )}
            {listing.prefix_ok === false && (
              <span style={{ fontSize: 11.5, color: C.amber, fontWeight: 600 }}>
                doesn't start with {listing.sku_prefix}
              </span>
            )}
            {/* Only on a phone — on desktop the details are already on screen,
                so a toggle beside them just reads as a broken control. */}
            {isMobile && details.length > 0 && (
              <button onClick={() => setShowDetails((s) => !s)} style={{
                background: "none", border: "none", padding: 0, cursor: "pointer",
                fontFamily: "inherit", fontSize: 11.5, fontWeight: 700, color: C.blue,
                display: "inline-flex", alignItems: "center", gap: 2 }}>
                {showDetails ? "Hide" : "Details"}<Chevron open={showDetails} size={14} color={C.blue} />
              </button>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          {listing.reward_credited_at && <Money value={listing.reward_amount} />}
          {!frozen && (
            <button onClick={() => setEdit(true)} title="Edit" style={tap(isMobile, { color: C.gray500 })}>
              <EditOutlinedIcon style={{ fontSize: 17 }} />
            </button>
          )}
          {!frozen && !listing.reward_credited_at && (
            <button onClick={() => onDelete(listing.id)} disabled={busy} title="Remove"
              style={tap(isMobile, { color: C.gray300 })}>
              <DeleteOutlineIcon style={{ fontSize: 18 }} />
            </button>
          )}
        </div>
      </div>

      {/* Line 2 — the numbers. Always on desktop, on demand on a phone. */}
      {details.length > 0 && (!isMobile || showDetails) && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8, fontSize: 12,
          color: C.gray600, paddingTop: isMobile ? 8 : 0,
          borderTop: isMobile ? `1px dashed ${C.gray200}` : "none" }}>
          {details.map((f) => (
            <span key={f.key}>
              <span style={{ color: C.gray400 }}>{f.platformLabel ? `${platform} price` : f.label}: </span>
              <span style={{ fontWeight: 700, fontFamily: f.type === "money" ? "monospace" : "inherit" }}>
                {f.type === "money" ? fmt(listing[f.key]) : listing[f.key]}{f.type === "tax" ? "%" : ""}
              </span>
            </span>
          ))}
        </div>
      )}

      {listing.review_comment && (
        <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 8, lineHeight: 1.5,
          color: listing.status === "REJECTED" ? C.red : C.green }}>
          {listing.review_comment}
        </div>
      )}

      {/* A rejected SKU is the worker's to-do: put the fix one tap away. */}
      {!isAdmin && !frozen && listing.status === "REJECTED" && (
        <button onClick={() => setEdit(true)} style={{ ...btn("primary", "sm"), marginTop: 9,
          width: isMobile ? "100%" : "auto", padding: isMobile ? "10px 14px" : undefined }}>
          Fix &amp; send again
        </button>
      )}

      {isAdmin && listing.status !== "APPROVED" && !rejecting && (
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button onClick={() => onReview(listing.id, "APPROVE", "")} disabled={busy}
            style={{ ...btn("success", "sm"), flex: isMobile ? 1 : "none", padding: "8px 15px" }}>
            <CheckCircleIcon style={{ fontSize: 15, verticalAlign: "-3px" }} />&nbsp;Approve &amp; pay
          </button>
          <button onClick={() => { setRejecting(true); setReason(""); }} disabled={busy}
            style={{ ...btn("ghost", "sm"), color: C.red, borderColor: C.redBorder,
              flex: isMobile ? 1 : "none", padding: "8px 15px" }}>
            Reject
          </button>
        </div>
      )}

      {/* Rejecting asks for the reason inline — a browser prompt() loses what
          you typed the moment you tap outside it on a phone. */}
      {isAdmin && rejecting && (
        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="What needs fixing?"
            onKeyDown={(e) => { if (e.key === "Enter" && reason.trim()) {
              onReview(listing.id, "REJECT", reason.trim()); setRejecting(false); } }}
            style={field(isMobile, { flex: "1 1 190px" })} />
          <button disabled={busy || !reason.trim()}
            onClick={() => { onReview(listing.id, "REJECT", reason.trim()); setRejecting(false); }}
            style={{ ...btn("danger", "sm"), opacity: reason.trim() ? 1 : 0.5 }}>
            Send back
          </button>
          <button onClick={() => setRejecting(false)} style={btn("ghost", "sm")}>Cancel</button>
        </div>
      )}
    </div>
  );
}

/** The per-SKU field set — shared by the add form and the edit row. */
function ListingFields({ form, set, platform, reference, hideSku, excludeKeys = [] }) {
  const isMobile = useIsMobile();
  const hsnList = reference?.hsn_codes || [];
  const slabs = reference?.gst_slabs || [];
  return (
    <div style={{ display: "grid",
      gridTemplateColumns: `repeat(auto-fit, minmax(${isMobile ? 132 : 140}px, 1fr))`, gap: 10 }}>
      {LISTING_FIELDS.filter((f) => !(hideSku && f.key === "sku_id") && !excludeKeys.includes(f.key)).map((f) => (
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
            }} style={field(isMobile)}>
              <option value="">—</option>
              {hsnList.map((h) => (
                <option key={h.hsn} value={h.hsn}>
                  {h.hsn}{h.suggested_tax_percent ? ` (${h.suggested_tax_percent}%)` : ""}
                </option>
              ))}
            </select>
          ) : f.type === "tax" ? (
            <select value={form[f.key] ?? ""} onChange={set(f.key)} style={field(isMobile)}>
              <option value="">—</option>
              {slabs.map((s) => <option key={s} value={s}>{s}%</option>)}
            </select>
          ) : (
            <input value={form[f.key] ?? ""} onChange={set(f.key)}
              type={f.type === "money" ? "number" : "text"} step="0.01"
              inputMode={f.type === "money" ? "decimal" : undefined}
              style={field(isMobile, { fontFamily: f.mono ? "monospace" : "inherit" })} />
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Parent-SKU + listing-template pickers — shared by task creation
 * (NewTaskForm) and editing an existing task (TaskSettingsPanel). Both are
 * optional and only meaningful for LISTING tasks.
 */
function TaskLinkFields({ parentSkus, templates, parentSkuId, setParentSkuId, templateId, setTemplateId, datalistId }) {
  const isMobile = useIsMobile();
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
      <div>
        <label style={{ ...S.label, marginBottom: 3 }}>Link to parent SKU</label>
        <input list={datalistId} value={parentSkuId} onChange={(e) => setParentSkuId(e.target.value)}
          placeholder="Search parent item id…" style={field(isMobile)} />
        <datalist id={datalistId}>
          {parentSkus.map((p) => <option key={p.item_id} value={p.item_id} />)}
        </datalist>
        <div style={{ fontSize: 10.5, color: C.gray400, marginTop: 3 }}>
          Every SKU approved on this task links — and prices itself — to this parent.
        </div>
      </div>
      <div>
        <label style={{ ...S.label, marginBottom: 3 }}>Use listing template</label>
        <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} style={field(isMobile)}>
          <option value="">—</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>{t.name} ({t.field_count} fields)</option>
          ))}
        </select>
        <div style={{ fontSize: 10.5, color: C.gray400, marginTop: 3 }}>
          Shown on the task so the team applies the same browser-extension template.
        </div>
      </div>
    </div>
  );
}

/**
 * Admin-only editor for the three "set up once" things a LISTING task can
 * carry: the SKU prefix that powers auto-generation, a linked parent SKU, and
 * a linked browser-extension template. Separate from the create form so these
 * can be added or changed on a task that already exists, not just at creation.
 */
function TaskSettingsPanel({ task, parentSkus, templates, onSave, onCancel, busy }) {
  const isMobile = useIsMobile();
  const [prefix, setPrefix] = useState(task.listing_defaults?.sku_prefix || "");
  const [parentSkuId, setParentSkuId] = useState(task.parent_sku_item_id || "");
  const [templateId, setTemplateId] = useState(task.listing_template ? String(task.listing_template) : "");
  const [err, setErr] = useState("");

  const save = async () => {
    const listing_defaults = { ...(task.listing_defaults || {}) };
    if (prefix.trim()) listing_defaults.sku_prefix = prefix.trim();
    else delete listing_defaults.sku_prefix;
    const e = await onSave(task.id, {
      listing_defaults,
      parent_sku_item_id: parentSkuId,
      listing_template: templateId || "",
    });
    if (e) setErr(e); else onCancel();
  };

  return (
    <div style={{ border: `1px solid ${C.blue}44`, borderRadius: 12, padding: 13, background: C.blueLight }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: C.blue, letterSpacing: "0.06em",
        textTransform: "uppercase", marginBottom: 10 }}>
        Task settings
      </div>
      <div style={{ marginBottom: 12, maxWidth: 340 }}>
        <label style={{ ...S.label, marginBottom: 3 }}>Starting SKU name (prefix)</label>
        <input value={prefix} onChange={(e) => setPrefix(e.target.value)}
          placeholder="e.g. BRS-" style={field(isMobile, { fontFamily: "monospace" })} />
        <div style={{ fontSize: 10.5, color: C.gray400, marginTop: 3 }}>
          Powers "Generate" on the SKU box — e.g. BRS- generates BRS-001, BRS-002…
        </div>
      </div>
      <TaskLinkFields parentSkus={parentSkus} templates={templates}
        parentSkuId={parentSkuId} setParentSkuId={setParentSkuId}
        templateId={templateId} setTemplateId={setTemplateId}
        datalistId={`parent-sku-options-task-${task.id}`} />
      {err && <div style={{ fontSize: 12.5, color: C.red, fontWeight: 700, marginTop: 9 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button onClick={save} disabled={busy}
          style={{ ...btn("primary", "sm"), flex: isMobile ? 1 : "none", padding: isMobile ? "10px 14px" : undefined }}>
          Save
        </button>
        <button onClick={onCancel}
          style={{ ...btn("ghost", "sm"), flex: isMobile ? 1 : "none", padding: isMobile ? "10px 14px" : undefined }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * The one thing a worker comes to this screen to do: get the next SKU id and
 * send it for approval. Deliberately a single row — id field + Generate — with
 * everything else (the admin's prices, the optional overrides) tucked behind a
 * disclosure, so the whole job is "tap Generate, tap Send".
 */
function AddListing({ task, reference, onAdd, busy, isAdmin }) {
  const isMobile = useIsMobile();
  // Second and later SKUs of the same product share almost everything with the
  // first, so the form opens pre-filled from the last one added — only the SKU
  // itself is cleared. Prefer the last SKU added (variants of one product are
  // nearly identical), and fall back to whatever the admin set on the task.
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
  const [hint, setHint] = useState("");
  const [generating, setGenerating] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const add = async () => {
    if (!form.sku_id.trim()) return setErr("Generate or type the SKU id first.");
    // A worker sends only the id; everything else is inherited server-side.
    const body = isAdmin ? form : { sku_id: form.sku_id };
    const e = await onAdd(task.id, body);
    if (e) { setErr(e); setHint(""); return; }
    setForm({ ...seed(), sku_id: "" });
    setErr(""); setHint("");
  };

  // The prefix an admin can type into the SKU-starts-with field, or the one
  // they already set on the task for a worker to inherit.
  const prefix = (isAdmin ? form.sku_prefix : defaults.sku_prefix) || "";

  const generateSku = async () => {
    if (!prefix.trim()) return setErr("Set a starting SKU name first, then generate.");
    setGenerating(true);
    try {
      const res = await fetch(`${API}/worker-tasks/${task.id}/generate-sku/?prefix=${encodeURIComponent(prefix.trim())}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(d.error || "Could not generate a SKU id."); return; }
      setForm((f) => ({ ...f, sku_id: d.sku_id }));
      setErr("");
      setHint(isAdmin ? "Check it, then add it." : "Check it, then send it for approval.");
    } catch { setErr("Network error."); }
    finally { setGenerating(false); }
  };

  const shownDefaults = LISTING_FIELDS.filter((f) => f.key !== "sku_id" && defaults[f.key]);
  const ready = !!form.sku_id.trim();

  return (
    <div style={{ border: `1.5px solid ${C.orangeBorder}`, borderRadius: 14,
      padding: isMobile ? 13 : 16, background: C.orangeLight }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 11 }}>
        <AddIcon style={{ fontSize: 17, color: C.orange }} />
        <span style={{ fontSize: 13, fontWeight: 800, color: C.gray800 }}>Add a SKU</span>
        {prefix.trim() && !isAdmin && (
          <span style={{ marginLeft: "auto", fontSize: 11.5, color: C.gray500 }}>
            starts with <b style={{ fontFamily: "monospace", color: C.gray700 }}>{prefix}</b>
          </span>
        )}
      </div>

      {/* Step 1 — the id. Generate sits inside the same row as the field it
          fills, so there's no hunting for what "step 2" was. */}
      <label style={{ ...S.label, marginBottom: 5 }}>SKU id</label>
      <div style={{ display: "flex", gap: 8, flexDirection: isMobile ? "column" : "row" }}>
        <input value={form.sku_id} onChange={set("sku_id")}
          placeholder={prefix ? `${prefix}…` : "the SKU you created"}
          style={field(isMobile, { flex: 1, fontFamily: "monospace", fontWeight: 700,
            background: C.white, borderColor: form.sku_id ? C.orangeBorder : C.gray200 })} />
        <button onClick={generateSku} disabled={generating || !prefix.trim()}
          title={!prefix.trim() ? "No starting SKU name set on this task yet" : `Generate the next ${prefix} id`}
          style={{ ...btn("secondary", "sm"), padding: "10px 16px", whiteSpace: "nowrap",
            opacity: prefix.trim() ? 1 : 0.5, cursor: prefix.trim() ? "pointer" : "not-allowed" }}>
          <AutoAwesomeIcon style={{ fontSize: 15, verticalAlign: "-3px" }} />
          &nbsp;{generating ? "Generating…" : "Generate"}
        </button>
      </div>

      {!prefix.trim() && (
        <div style={{ fontSize: 11.5, color: C.amber, fontWeight: 600, marginTop: 6 }}>
          {isAdmin
            ? "Set a starting SKU name under “More details” to auto-generate ids."
            : "No starting SKU name yet — ask your admin to set one in this task's settings."}
        </div>
      )}
      {hint && !err && (
        <div style={{ fontSize: 11.5, color: C.green, fontWeight: 700, marginTop: 6 }}>{hint}</div>
      )}

      {/* Step 2 — everything optional, folded away. */}
      {isAdmin ? (
        <div>
          <button onClick={() => setShowMore((s) => !s)} style={{
            background: "none", border: "none", padding: 0, marginTop: 11, cursor: "pointer",
            fontFamily: "inherit", fontSize: 12, fontWeight: 700, color: C.blue,
            display: "inline-flex", alignItems: "center", gap: 3 }}>
            More details (price, HSN, tax)<Chevron open={showMore} size={16} color={C.blue} />
          </button>
          {showMore && (
            <div style={{ marginTop: 10, padding: 12, borderRadius: 10, background: C.white,
              border: `1px solid ${C.border}` }}>
              <ListingFields form={form} set={set} platform={task.platform} reference={reference}
                excludeKeys={["sku_id"]} />
            </div>
          )}
        </div>
      ) : shownDefaults.length > 0 && (
        <div>
          <button onClick={() => setShowMore((s) => !s)} style={{
            background: "none", border: "none", padding: 0, marginTop: 11, cursor: "pointer",
            fontFamily: "inherit", fontSize: 12, fontWeight: 700, color: C.blue,
            display: "inline-flex", alignItems: "center", gap: 3 }}>
            Values to list with ({shownDefaults.length})<Chevron open={showMore} size={16} color={C.blue} />
          </button>
          {showMore && (
            <div style={{ marginTop: 8, padding: "10px 12px", borderRadius: 10,
              background: C.white, border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, color: C.gray400,
                letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>
                Set by the admin — use exactly these
              </div>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12.5, color: C.gray700 }}>
                {shownDefaults.map((f) => (
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
        </div>
      )}

      {err && (
        <div style={{ marginTop: 10, padding: "9px 12px", borderRadius: 10, background: C.redLight,
          border: `1px solid ${C.redBorder}`, color: C.red, fontSize: 12.5, fontWeight: 700 }}>
          {err}
        </div>
      )}

      {/* Step 3 — one button, and it says exactly what happens next. */}
      <button onClick={add} disabled={busy || !ready}
        style={{ ...btn("primary", "md"), marginTop: 12, width: isMobile ? "100%" : "auto",
          opacity: ready ? 1 : 0.55, cursor: ready ? "pointer" : "not-allowed" }}>
        <SendIcon style={{ fontSize: 15, verticalAlign: "-3px" }} />
        &nbsp;{isAdmin ? "Add SKU" : "Send for approval"}
      </button>
      {!isAdmin && (
        <div style={{ fontSize: 11, color: C.gray500, marginTop: 6 }}>
          Your admin reviews it and the reward lands in your wallet on approval.
        </div>
      )}
    </div>
  );
}

/** A labelled band of SKU rows — the ones needing attention open by default. */
function ListingGroup({ title, accent, count, defaultOpen, right, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <div onClick={() => setOpen((o) => !o)} style={{ display: "flex", alignItems: "center",
        gap: 7, cursor: "pointer", padding: "3px 2px", userSelect: "none" }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: accent, flexShrink: 0 }} />
        <span style={{ fontSize: 11.5, fontWeight: 800, color: C.gray600,
          letterSpacing: "0.04em", textTransform: "uppercase" }}>
          {title} · {count}
        </span>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}
          onClick={(e) => e.stopPropagation()}>{right}</span>
        <Chevron open={open} size={17} />
      </div>
      {open && <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 7 }}>{children}</div>}
    </div>
  );
}

function TaskCard({ task, isAdmin, reference, parentSkus, templates, collapsed, onToggleCollapse,
                    onSubmit, onReview, onPause, onDelete, onSaveSettings,
                    onListingAdd, onListingSave, onListingDelete, onListingReview,
                    onListingApproveAll, busy }) {
  const isMobile = useIsMobile();
  const meta = STATUS_META[task.status] || STATUS_META.ASSIGNED;
  const type = TYPE_META[task.task_type] || TYPE_META.LISTING;
  const listing = task.task_type === "LISTING";
  const [reference_, setRef] = useState(task.submitted_reference || "");
  const [note, setNote] = useState(task.submitted_note || "");
  const [showSettings, setShowSettings] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const prefix = task.listing_defaults?.sku_prefix || "";

  const listings = task.listings || [];
  const approved = listings.filter((l) => l.status === "APPROVED");
  const pendingSkus = listings.filter((l) => l.status === "PENDING");
  const rejected = listings.filter((l) => l.status === "REJECTED");

  // The stripe down the left says, at a glance, whose move it is.
  const accent = task.is_paused ? C.gray400
    : listing ? (rejected.length ? C.red
      : pendingSkus.length ? C.amber
      : listings.length ? C.green : C.gray400)
    : meta.accent;

  // The one line the collapsed card has to earn its space with.
  const summary = listing
    ? (listings.length === 0 ? "No SKUs yet"
      : `${approved.length}/${listings.length} approved`
        + (pendingSkus.length ? ` · ${pendingSkus.length} waiting` : "")
        + (rejected.length ? ` · ${rejected.length} to fix` : ""))
    : meta.label;

  const pad = isMobile ? 13 : 18;

  const adminActions = isAdmin && (
    <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 11 }}>
      {listing && (
        <button onClick={() => setShowSettings((s) => !s)} disabled={busy}
          style={btn(showSettings ? "secondary" : "ghost", "sm")}>
          <SettingsIcon style={{ fontSize: 15, verticalAlign: "-3px" }} />&nbsp;Settings
        </button>
      )}
      <button onClick={() => onPause(task.id, !task.is_paused)} disabled={busy} style={btn("ghost", "sm")}>
        {task.is_paused
          ? <><PlayCircleIcon style={{ fontSize: 15, verticalAlign: "-3px" }} />&nbsp;Resume</>
          : <><PauseCircleIcon style={{ fontSize: 15, verticalAlign: "-3px" }} />&nbsp;Pause</>}
      </button>
      <button onClick={() => onDelete(task.id, task.title)} disabled={busy} title="Delete this task"
        style={{ ...btn("ghost", "sm"), color: C.red, borderColor: C.redBorder }}>
        <DeleteOutlineIcon style={{ fontSize: 15, verticalAlign: "-3px" }} />&nbsp;Delete
      </button>
    </div>
  );

  return (
    <div style={{ ...S.card, padding: 0, overflow: "hidden",
      borderLeft: `4px solid ${accent}`,
      opacity: task.is_paused ? 0.94 : 1 }}>

      {/* ── Header: the whole thing is the collapse control ────────────────── */}
      <div onClick={onToggleCollapse} style={{
        display: "flex", alignItems: "flex-start", gap: 10, padding: pad,
        cursor: "pointer", userSelect: "none",
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: isMobile ? 14.5 : 15.5, fontWeight: 800, color: C.gray900,
            lineHeight: 1.35, wordBreak: "break-word" }}>
            {task.title || (listing ? "Listing task" : "Return claim task")}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
            <Tag variant={PLATFORM_TAG[task.platform] || "gray"} fontSize={10.5}>{task.platform}</Tag>
            <Tag variant={type.tag} fontSize={10.5}>{type.label}</Tag>
            {task.is_paused && <Tag variant="gray" fontSize={10.5}>⏸ paused</Tag>}
            {!listing && <Tag variant={meta.tag} fontSize={10.5}>{meta.label}</Tag>}
            {task.awaiting_bonus && <Tag variant="amber" fontSize={10.5}>bonus pending</Tag>}
            {(task.assignee_names || []).length > 0 && (
              <span style={{ fontSize: 11.5, color: C.gray400, minWidth: 0,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {task.assignee_names.join(", ")}
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: C.gray500, marginTop: 6, fontWeight: 600 }}>
            {summary}
            <span style={{ color: C.gray300 }}> · </span>
            <span style={{ fontWeight: 500 }}>{fmt(task.reward_amount)}/{listing ? "SKU" : "claim"}</span>
          </div>
          {listing && listings.length > 0 && (
            <div style={{ marginTop: 7, maxWidth: 260 }}>
              <ProgressBar approved={approved.length} pending={pendingSkus.length} rejected={rejected.length} />
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          {Number(task.earned) > 0 && (
            <span style={{ fontSize: 13 }}><Money value={task.earned} /></span>
          )}
          <span style={tap(isMobile, { width: isMobile ? 36 : 28, height: isMobile ? 36 : 28 })}>
            <Chevron open={!collapsed} />
          </span>
        </div>
      </div>

      {/* ── Detail, only when open ─────────────────────────────────────────── */}
      {!collapsed && (
        <div style={{ padding: `0 ${pad}px ${pad}px`, borderBottom: `1px solid ${C.border}` }}>
          {task.suborder_no && (
            <div style={{ fontSize: 12, color: C.gray500, fontFamily: "monospace", marginBottom: 6 }}>
              {task.suborder_no}
            </div>
          )}
          {listing && (prefix || task.parent_sku_item_id || task.listing_template_name) && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              {prefix && <Tag variant="amber" fontSize={10.5}>SKU prefix: {prefix}</Tag>}
              {task.parent_sku_item_id && (
                <Tag variant="blue" fontSize={10.5}>
                  Parent: {task.parent_sku_item_id}{task.parent_sku_price ? ` (${fmt(task.parent_sku_price)})` : ""}
                </Tag>
              )}
              {task.listing_template_name && (
                <Tag variant="gray" fontSize={10.5}>Template: {task.listing_template_name}</Tag>
              )}
            </div>
          )}
          {task.instructions && (
            <div style={{ fontSize: 13, color: C.gray600, lineHeight: 1.6, marginBottom: 8 }}>
              {task.instructions}
            </div>
          )}
          {task.source_link && (
            <a href={task.source_link} target="_blank" rel="noreferrer"
              style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13, fontWeight: 700,
                color: C.blue, textDecoration: "none" }}>
              {listing ? "Open the photo folder" : "Open the video"} <OpenInNewIcon style={{ fontSize: 14 }} />
            </a>
          )}
          {!listing && (
            <div style={{ fontSize: 11.5, color: C.gray400, marginTop: 6 }}>
              Compress under {CLAIM_VIDEO_MAX_MB}MB before uploading the claim.
            </div>
          )}
          {adminActions}
          {isAdmin && listing && showSettings && (
            <div style={{ marginTop: 11 }}>
              <TaskSettingsPanel task={task} parentSkus={parentSkus} templates={templates} busy={busy}
                onSave={onSaveSettings} onCancel={() => setShowSettings(false)} />
            </div>
          )}
        </div>
      )}

      {/* ── Listing tasks: add first, then the SKUs grouped by what's needed ── */}
      {listing && !collapsed && (
        <div style={{ padding: pad, background: C.gray50,
          display: "flex", flexDirection: "column", gap: 14 }}>
          {task.is_paused ? (
            <div style={{ fontSize: 12.5, color: C.gray500, fontStyle: "italic" }}>
              Paused — existing SKUs stay visible, but no new ones can be added.
            </div>
          ) : (
            <AddListing task={task} reference={reference} onAdd={onListingAdd} busy={busy} isAdmin={isAdmin} />
          )}

          {rejected.length > 0 && (
            <ListingGroup title="Needs a fix" accent={C.red} count={rejected.length} defaultOpen>
              {rejected.map((l) => (
                <ListingRow key={l.id} listing={l} isAdmin={isAdmin} platform={task.platform}
                  reference={reference} frozen={task.is_paused && !isAdmin} busy={busy}
                  onSave={onListingSave} onDelete={onListingDelete} onReview={onListingReview} />
              ))}
            </ListingGroup>
          )}

          {pendingSkus.length > 0 && (
            <ListingGroup title={isAdmin ? "Waiting for your approval" : "Waiting for approval"}
              accent={C.amber} count={pendingSkus.length} defaultOpen
              right={isAdmin && pendingSkus.length > 1 && (
                <button onClick={() => onListingApproveAll(pendingSkus.map((l) => l.id))} disabled={busy}
                  style={btn("success", "sm")}>
                  <TaskAltIcon style={{ fontSize: 14, verticalAlign: "-2px" }} />
                  &nbsp;Approve all {pendingSkus.length}
                </button>
              )}>
              {pendingSkus.map((l) => (
                <ListingRow key={l.id} listing={l} isAdmin={isAdmin} platform={task.platform}
                  reference={reference} frozen={task.is_paused && !isAdmin} busy={busy}
                  onSave={onListingSave} onDelete={onListingDelete} onReview={onListingReview} />
              ))}
            </ListingGroup>
          )}

          {approved.length > 0 && (
            <ListingGroup title="Approved" accent={C.green} count={approved.length} defaultOpen={false}>
              {approved.map((l) => (
                <ListingRow key={l.id} listing={l} isAdmin={isAdmin} platform={task.platform}
                  reference={reference} frozen={task.is_paused && !isAdmin} busy={busy}
                  onSave={onListingSave} onDelete={onListingDelete} onReview={onListingReview} />
              ))}
            </ListingGroup>
          )}
        </div>
      )}

      {/* ── Claim tasks: one submission ────────────────────────────────────── */}
      {!listing && !collapsed && (
        <div style={{ padding: pad, background: C.gray50 }}>
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
                disabled={busy} style={{ ...btn("primary", "md"), marginTop: 12,
                  width: isMobile ? "100%" : "auto" }}>
                <SendIcon style={{ fontSize: 15, verticalAlign: "-3px" }} />
                &nbsp;{task.status === "REJECTED" ? "Send again" : "Send for approval"}
              </button>
            </>
          ) : (
            <div style={{ fontSize: 13, color: C.gray600 }}>
              {task.submitted_reference && <>Ref <b style={{ fontFamily: "monospace" }}>{task.submitted_reference}</b> · </>}
              {task.submitted_by_name && <>by {task.submitted_by_name} · </>}
              sent {fmtDate(task.submitted_at)}
            </div>
          )}
          {isAdmin && task.status === "SUBMITTED" && !rejecting && (
            <div style={{ display: "flex", gap: 8, marginTop: 11, flexWrap: "wrap" }}>
              <button onClick={() => onReview(task.id, "APPROVE", "")} disabled={busy}
                style={{ ...btn("success", "md"), flex: isMobile ? 1 : "none" }}>
                Approve &amp; pay {fmt(task.reward_amount)}
              </button>
              <button onClick={() => { setRejecting(true); setReason(""); }} disabled={busy}
                style={{ ...btn("ghost", "md"), color: C.red, borderColor: C.redBorder,
                  flex: isMobile ? 1 : "none" }}>
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
      )}

      {task.review_comment && task.status !== "SUBMITTED" && !collapsed && (
        <div style={{ padding: `11px ${pad}px`,
          background: task.status === "REJECTED" ? C.redLight : C.greenLight,
          color: task.status === "REJECTED" ? C.red : C.green, fontSize: 12.5, fontWeight: 600 }}>
          {task.status === "REJECTED" ? "Rejected" : "Approved"}: {task.review_comment}
        </div>
      )}
    </div>
  );
}

/**
 * Which tasks open on arrival. Everything else starts collapsed, so a screen of
 * fifteen tasks reads as a list rather than a wall — the point of the card
 * being collapsible at all.
 */
function needsAttention(task, isAdmin) {
  if (task.is_paused) return false;
  if (task.task_type !== "LISTING") {
    return isAdmin ? task.status === "SUBMITTED" : task.status !== "APPROVED";
  }
  const listings = task.listings || [];
  if (isAdmin) return listings.some((l) => l.status === "PENDING");
  return listings.length === 0 || listings.some((l) => l.status === "REJECTED");
}

// ── Tab ───────────────────────────────────────────────────────────────────────
export function TeamTasksTab() {
  const isMobile = useIsMobile();
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

  // Only tasks waiting on *you* open by default; everything else stays folded.
  // Only fills in ids we haven't seen before, so a manual toggle survives the
  // next refetch.
  useEffect(() => {
    setCollapsed((prev) => {
      let changed = false;
      const next = { ...prev };
      tasks.forEach((t) => {
        if (!(t.id in next)) {
          next[t.id] = !needsAttention(t, isAdmin);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [tasks, isAdmin]);
  const toggleCollapse = (id) => setCollapsed((c) => ({ ...c, [id]: !c[id] }));
  const setAllCollapsed = (value) =>
    setCollapsed((c) => ({ ...c, ...Object.fromEntries(tasks.map((t) => [t.id, value])) }));
  const allCollapsed = tasks.length > 0 && tasks.every((t) => collapsed[t.id]);

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
  const saveTaskSettings = (id, body) =>
    post(`${API}/worker-tasks/${id}/`, body, "Task settings saved.", "PATCH");
  const deleteTask = async (id, title) => {
    if (!window.confirm(`Delete "${title || "this task"}"? Any wallet balance already earned from it is kept.`)) return;
    const e = await post(`${API}/worker-tasks/${id}/`, {}, (d) =>
      d.wallet_entries_kept ? `Task deleted — ${fmt(d.amount_kept)} already earned stays in the wallet.`
                            : "Task deleted.", "DELETE");
    if (e) setMsg({ type: "error", text: e });
  };
  const addListing = (taskId, form) =>
    post(`${API}/worker-tasks/${taskId}/listings/`, form,
      isAdmin ? "SKU added." : "Sent for approval.");
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
  /** Approve a whole task's worth of SKUs in one go — one refetch at the end,
      not one per SKU, so a run of twenty doesn't thrash the list. */
  const approveAllListings = async (ids) => {
    if (!ids.length) return;
    if (!window.confirm(`Approve and pay for ${ids.length} SKUs?`)) return;
    setBusy(true);
    let credited = 0, failed = 0;
    try {
      for (const id of ids) {
        try {
          const res = await fetch(`${API}/task-listings/${id}/review/`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ decision: "APPROVE", comment: "" }),
          });
          const d = await res.json().catch(() => ({}));
          if (!res.ok) failed++; else credited += Number(d.credited || 0);
        } catch { failed++; }
      }
      setMsg(failed
        ? { type: "error", text: `${ids.length - failed} approved, ${failed} failed — open them to see why.` }
        : { type: "success", text: `Approved ${ids.length} SKUs — ${fmt(credited)} added.` });
    } finally {
      setBusy(false);
      fetchTasks(); fetchAux();
    }
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

  // A row that scrolls sideways rather than wrapping into four ragged lines on
  // a phone — the standard pattern for chips and stat tiles on mobile.
  const scrollRow = {
    display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2,
    WebkitOverflowScrolling: "touch", scrollbarWidth: "none",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between",
        gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <ChecklistIcon style={{ color: C.orange, fontSize: 21 }} />
            <h1 style={{ fontSize: isMobile ? 17 : 19, fontWeight: 800, color: C.gray800 }}>Team Tasks</h1>
          </div>
          <p style={{ fontSize: 12, color: C.gray400, marginTop: 3 }}>
            {isAdmin ? "Assign listing and claim work, review each SKU, and pay for it"
                     : "Your tasks and what you've earned"}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
          width: isMobile ? "100%" : "auto" }}>
          <button onClick={() => setPanel(p => p === "wallet" ? null : "wallet")}
            style={{ ...btn(panel === "wallet" ? "ghostOrange" : "ghost", "sm"),
              flex: isMobile ? 1 : "none", padding: isMobile ? "10px 14px" : undefined }}>
            <AccountBalanceWalletIcon style={{ fontSize: 15, verticalAlign: "-3px" }} />
            &nbsp;{isAdmin ? "Wallets" : "Wallet"} · {fmt(pending)}
          </button>
          {isAdmin && (
            <button onClick={() => setCreating(c => !c)}
              style={{ ...btn("primary", "sm"), flex: isMobile ? 1 : "none",
                padding: isMobile ? "10px 14px" : undefined }}>
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
                    style={tap(isMobile, { color: C.gray300 })}>
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
        <div style={{ ...S.card, borderTop: `4px solid ${C.green}`, padding: isMobile ? 15 : 22 }}>
          <div style={{ ...S.cardTitle, marginBottom: 12 }}>{isAdmin ? "Wallets" : "My wallet"}</div>
          <div style={{ ...scrollRow, marginBottom: 14 }}>
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

      {/* Counts — tap one to filter, tap it again to clear */}
      {stats && (
        <div style={scrollRow}>
          <Metric label="to do" value={stats.assigned} accent={C.gray500}
            onClick={() => setView(v => v === "ASSIGNED" ? "" : "ASSIGNED")} active={view === "ASSIGNED"} />
          <Metric label="to review" value={stats.submitted} accent={C.amber}
            onClick={() => setView(v => v === "SUBMITTED" ? "" : "SUBMITTED")} active={view === "SUBMITTED"} />
          <Metric label="approved" value={stats.approved} accent={C.green}
            onClick={() => setView(v => v === "APPROVED" ? "" : "APPROVED")} active={view === "APPROVED"} />
          {stats.awaiting_bonus > 0 && <Metric label="bonus pending" value={stats.awaiting_bonus} accent={C.orange} />}
          <Metric label="still owed" value={stats.pending} accent={C.orange} money />
        </div>
      )}

      {/* ── Filters ────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <div style={scrollRow}>
          <div style={{ display: "inline-flex", background: C.gray100, borderRadius: 11, padding: 3,
            border: `1px solid ${C.border}`, flexShrink: 0 }}>
            {[{ k: "", l: "All" }, { k: "SUBMITTED", l: "To review" }, { k: "ASSIGNED", l: "To do" },
              { k: "APPROVED", l: "Approved" }, { k: "REJECTED", l: "Rejected" }].map((v) => (
              <button key={v.k || "all"} onClick={() => setView(v.k)}
                style={{ border: "none", cursor: "pointer", fontFamily: "inherit",
                  background: view === v.k ? C.white : "transparent",
                  color: view === v.k ? C.gray800 : C.gray500,
                  fontWeight: view === v.k ? 800 : 600, fontSize: 12.5,
                  padding: isMobile ? "9px 14px" : "6px 13px", borderRadius: 9, whiteSpace: "nowrap",
                  boxShadow: view === v.k ? "0 1px 3px rgba(0,0,0,0.10)" : "none" }}>
                {v.l}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
          <div style={{ position: "relative", flex: "1 1 190px", minWidth: 0 }}>
            <SearchIcon style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)",
              fontSize: 17, color: C.gray400, pointerEvents: "none" }} />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title / SKU / sub-order…"
              style={field(isMobile, { paddingLeft: 34 })} />
          </div>
          <select value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)}
            style={field(isMobile, { maxWidth: 160, flex: "0 1 150px" })}>
            <option value="">Any platform</option>
            {platforms.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          {tasks.length > 1 && (
            <button onClick={() => setAllCollapsed(!allCollapsed)}
              style={{ ...btn("ghost", "sm"), whiteSpace: "nowrap",
                padding: isMobile ? "10px 14px" : undefined }}>
              {allCollapsed ? "Expand all" : "Collapse all"}
            </button>
          )}
        </div>
      </div>

      {/* ── Tasks ──────────────────────────────────────────────────────────── */}
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
              parentSkus={parentSkus} templates={templates}
              collapsed={!!collapsed[t.id]} onToggleCollapse={() => toggleCollapse(t.id)}
              onSubmit={submitTask} onReview={reviewTask} onPause={pauseTask} onDelete={deleteTask}
              onSaveSettings={saveTaskSettings}
              onListingAdd={addListing} onListingSave={saveListing}
              onListingDelete={deleteListing} onListingReview={reviewListing}
              onListingApproveAll={approveAllListings} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Create ────────────────────────────────────────────────────────────────────
function NewTaskForm({ workers, platforms, rates, reference, parentSkus, templates, onCreate, onCancel }) {
  const isMobile = useIsMobile();
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
    <div style={{ ...S.card, borderTop: `4px solid ${C.orange}`, padding: isMobile ? 15 : 22 }}>
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

      {type === "LISTING" && (
        <div style={{ marginBottom: 12, border: `1px solid ${C.blue}44`, borderRadius: 12,
          padding: 13, background: C.blueLight }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: C.gray700, marginBottom: 8 }}>
            Link to parent SKU &amp; template (optional)
          </div>
          <TaskLinkFields parentSkus={parentSkus} templates={templates}
            parentSkuId={parentSkuId} setParentSkuId={setParentSkuId}
            templateId={templateId} setTemplateId={setTemplateId}
            datalistId="parent-sku-options-new" />
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
        <div>
          <label style={S.label}>Title</label>
          <input value={form.title} onChange={set("title")} style={field(isMobile)}
            placeholder={type === "LISTING" ? "e.g. Brass lota photoshoot" : "e.g. Claim for damaged return"} />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={S.label}>
            {type === "LISTING" ? "Google Drive folder with the photo" : "Link to the claim video"}
          </label>
          <input value={form.source_link} onChange={set("source_link")} style={field(isMobile)}
            placeholder="https://drive.google.com/…" />
        </div>
        {type === "RETURN_CLAIM" && (
          <div>
            <label style={S.label}>Sub-order number</label>
            <input value={form.suborder_no} onChange={set("suborder_no")}
              style={field(isMobile, { fontFamily: "monospace" })} placeholder="3078…_1" />
          </div>
        )}
        <div>
          <label style={S.label}>Rate {type === "LISTING" ? "per SKU" : "per claim"} (₹)</label>
          <input value={rateOverride} onChange={(e) => setRateOverride(e.target.value)} type="number"
            inputMode="decimal" style={field(isMobile)}
            placeholder={standing ? `${standing.reward_amount} (standing rate)` : "set a rate below"} />
          <div style={{ fontSize: 11, color: C.gray400, marginTop: 4 }}>
            {standing
              ? `Leave blank to use ${standing.user ? `${standing.user_name}'s rate` : `the ${platform} rate`} of ${fmt(standing.reward_amount)}.`
              : `No standing ${platform} rate yet — set one in "Rates per platform".`}
          </div>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={S.label}>Instructions</label>
          <textarea value={form.instructions} onChange={set("instructions")} rows={2}
            style={field(isMobile, { resize: "vertical" })}
            placeholder={type === "LISTING"
              ? "Download the photo, edit it, create the listings, then add each SKU below."
              : `Download the video, compress under ${CLAIM_VIDEO_MAX_MB}MB, raise the claim.`} />
        </div>
      </div>

      {/* Listing values you decide, not the worker: every SKU on this task
          starts from these, and they can still be corrected per variant. */}
      {type === "LISTING" && (
        <div style={{ marginTop: 16, padding: 13, borderRadius: 12,
          background: C.gray50, border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: C.gray700, marginBottom: 3 }}>
            Listing details for every SKU on this task
          </div>
          <div style={{ fontSize: 11.5, color: C.gray400, marginBottom: 10 }}>
            Optional — these prefill the worker's SKU form. Leave blank to let them fill it in.
            Set <b>SKU starts with</b> here so the team can auto-generate ids.
          </div>
          <ListingFields form={defaults} set={setDefault} platform={platform} reference={reference}
            hideSku />
        </div>
      )}

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

function RatesEditor({ rates, platforms, onSave, busy }) {
  const [draft, setDraft] = useState({});
  // Business-wide rows only — the array may also hold per-worker overrides
  // (see WorkerRatesEditor), and those must never leak into the default table.
  const businessRates = useMemo(() => rates.filter((r) => !r.user), [rates]);
  const value = (platform, type, field_) => {
    const k = `${platform}|${type}|${field_}`;
    if (k in draft) return draft[k];
    const row = businessRates.find((r) => r.platform === platform && r.task_type === type);
    return row ? row[field_] : "";
  };
  const set = (platform, type, field_) => (e) =>
    setDraft((d) => ({ ...d, [`${platform}|${type}|${field_}`]: e.target.value }));

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
                    type="number" inputMode="decimal" style={{ ...S.inp, width: 90 }} />
                </td>
                <td style={S.td}>
                  <input value={value(p.value, "RETURN_CLAIM", "reward_amount")} onChange={set(p.value, "RETURN_CLAIM", "reward_amount")}
                    type="number" inputMode="decimal" style={{ ...S.inp, width: 90 }} />
                </td>
                <td style={S.td}>
                  <input value={value(p.value, "RETURN_CLAIM", "bonus_amount")} onChange={set(p.value, "RETURN_CLAIM", "bonus_amount")}
                    type="number" inputMode="decimal" style={{ ...S.inp, width: 90 }} />
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
  const value = (platform, type, field_) => {
    const k = `${platform}|${type}|${field_}`;
    if (k in draft) return draft[k];
    const row = personalRates.find((r) => r.platform === platform && r.task_type === type);
    return row ? row[field_] : "";
  };
  const set = (platform, type, field_) => (e) =>
    setDraft((d) => ({ ...d, [`${platform}|${type}|${field_}`]: e.target.value }));

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
                    type="number" inputMode="decimal" style={{ ...S.inp, width: 90 }} />
                </td>
                <td style={S.td}>
                  <input value={value(p.value, "RETURN_CLAIM", "reward_amount")} onChange={set(p.value, "RETURN_CLAIM", "reward_amount")}
                    type="number" inputMode="decimal" style={{ ...S.inp, width: 90 }} />
                </td>
                <td style={S.td}>
                  <input value={value(p.value, "RETURN_CLAIM", "bonus_amount")} onChange={set(p.value, "RETURN_CLAIM", "bonus_amount")}
                    type="number" inputMode="decimal" style={{ ...S.inp, width: 90 }} />
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
