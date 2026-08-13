import React, { useState, useEffect, useMemo, useRef } from "react";
import { API, C, S, btn, Tag, useIsMobile } from "../../App";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import DownloadIcon from "@mui/icons-material/Download";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineOutlined";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import SaveIcon from "@mui/icons-material/Save";
import ChangeCircleIcon from "@mui/icons-material/ChangeCircle";
import { CircularProgress } from "@mui/material";

/**
 * Turns any Meesho category bulk-listing template (uploaded fresh, or one of
 * the bundled quick-starts) + a set of photos into a ready-to-upload `.xlsx`
 * — one listing per photo given, unique title/SKU each, sharing every other
 * detail. Each listing's own photo stays its front image; the rest of its
 * gallery is a random pick of every *other* listing's photo, so the listings
 * aren't identical copies of one gallery. The server parses whatever
 * template it's given and derives the form's fields from it — nothing about
 * a category is hardcoded here. See backend/meesho_app/bulk_listing.py.
 *
 * Two ways to supply the photos (see MODES below) — both end up going
 * through the exact same generation pipeline, they only differ in where the
 * photo list comes from.
 *
 * Fully stateless re: the template: the File the user picked (or the
 * built-in key) is kept in this component's state and resent on Generate,
 * same as it was sent for Parse — nothing about it is stored server-side.
 *
 * A third mode, Flipkart Listing, is a genuinely different flow (see
 * FlipkartFlow below) — Flipkart's template already has each row's SKU and
 * images filled in before it's ever uploaded here, attribute values can
 * differ row to row instead of being one shared form, and there's no image
 * shuffle at all — so it keeps its own state and UI rather than being
 * squeezed into this component's Meesho-shaped logic.
 */

const MODES = [
  { id: "new", label: "New Sheet", hint: "Paste your own photo links (Meesho)" },
  { id: "prefilled", label: "Prefilled Sheet", hint: "Upload a Meesho sheet that already has one photo per row" },
  { id: "flipkart", label: "Flipkart Listing", hint: "Upload your Flipkart category template" },
];

// Categories carry however many image columns they carry — four in some, well
// over a dozen in others — so image roles are matched by shape, not listed.
const FIXED_PER_ROW_ROLES = new Set(["title", "sku", "style", "group_id"]);
const isPerRowRole = (role) => FIXED_PER_ROW_ROLES.has(role) || /^image_\d+$/.test(role || "");
const isImageRole = (role) => /^image_\d+$/.test(role || "");

// Mirrors bulk_listing_flipkart.FORCED_ATTRIBUTE_VALUES — always filled in
// server-side regardless of what's sent, so there's nothing for the seller
// to do with it here; hidden rather than shown disabled, to keep the
// per-row field grid to what actually needs filling. Procurement type is
// NOT in this set — it's a normal, visible, editable field that just
// starts out prefilled with "express" (see DEFAULT_ATTRIBUTE_VALUES
// server-side, applied in extract_prefilled_rows).
const FORCED_ATTRIBUTE_LABELS = new Set(["shipping provider"]);

const LISTING_TYPES = [
  { id: "unique", label: "Unique Listing", hint: "Every row is its own catalog — a different Group ID per row" },
  { id: "variation", label: "Variation Listing", hint: "Every row is a variant of the same product — one Group ID for all" },
];

function parseImageUrls(text) {
  return (text || "").split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
}

function emptyRow() {
  // `images: null` means "not seeded yet" — distinct from `[]`/an all-blank
  // array, which means the seller deliberately cleared every slot and the
  // row-seeding effect (see BulkListingTab) must leave it alone.
  // `overrides`: field key -> this row's own replacement for the shared
  // Product Details value — untouched fields simply fall back to `shared`.
  return { title: "", sku: "", style: "", groupId: "", images: null, overrides: {} };
}

/** Mirrors bulk_listing.plan_group_ids server-side, for the live preview. */
function planGroupIds(rowCount, listingType, base) {
  const b = (base || "Group").trim() || "Group";
  return Array.from({ length: rowCount }, (_, i) => (listingType === "variation" ? `${b} 1` : `${b} ${i + 1}`));
}

/**
 * Mirrors bulk_listing.validate_money server-side: a positive number, at
 * most 2 decimal places, strictly under moneyMax. Checked here too so a
 * value Meesho would reject (and that the server would also reject) gets
 * flagged the moment it's typed, not after a round trip.
 */
function validateMoney(value, moneyMax) {
  const text = String(value ?? "").trim();
  if (!text) return true; // blank is a "required" concern, not a money-format one
  const n = Number(text);
  if (!Number.isFinite(n) || n <= 0 || n >= moneyMax) return false;
  const cents = Math.round(n * 100);
  return Math.abs(n * 100 - cents) < 1e-6;
}

function Section({ title, right, children }) {
  return (
    <div style={S.card}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 15 }}>
        <div style={{ ...S.cardTitle, marginBottom: 0 }}>{title}</div>
        {right && <div style={{ marginLeft: "auto" }}>{right}</div>}
      </div>
      {children}
    </div>
  );
}

function FieldGrid({ children }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
      {children}
    </div>
  );
}

function Field({ def, value, onChange }) {
  const options = def.options || [];
  const wide = def.type === "textarea";
  const empty = def.required && !String(value ?? "").trim();
  const moneyInvalid = def.money_max != null && !validateMoney(value, def.money_max);
  const invalid = empty || moneyInvalid;
  const inpStyle = invalid ? { ...S.inp, borderColor: C.red } : S.inp;
  return (
    <div style={wide ? { gridColumn: "1 / -1" } : undefined}>
      <label style={S.label}>{def.label}{def.required ? " *" : ""}</label>
      {def.type === "select" ? (
        <select value={value ?? ""} onChange={(e) => onChange(e.target.value)} style={inpStyle}>
          <option value="">—</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : def.type === "textarea" ? (
        <textarea value={value ?? ""} onChange={(e) => onChange(e.target.value)} rows={2}
          style={{ ...inpStyle, resize: "vertical" }} />
      ) : def.type === "number" ? (
        // A native <input type="number"> silently reports an empty .value for
        // perfectly normal in-progress text — a bare "-", a trailing ".", a
        // comma typed as a decimal separator — so a real number the user
        // typed can vanish from state without any error ever firing. Plain
        // text with a numeric keyboard hint avoids that whole class of bug;
        // the actual numeric coercion happens server-side (see
        // bulk_listing.coerce_cell) regardless of what's typed here.
        <input value={value ?? ""} onChange={(e) => onChange(e.target.value)}
          type="text" inputMode="decimal" style={inpStyle} />
      ) : (
        <input value={value ?? ""} onChange={(e) => onChange(e.target.value)}
          type="text" style={inpStyle} />
      )}
      {moneyInvalid && (
        <div style={{ fontSize: 10.5, color: C.red, marginTop: 3, fontWeight: 600 }}>
          Must be a positive number under {def.money_max.toLocaleString("en-IN")}, with at most 2 decimal places.
        </div>
      )}
    </div>
  );
}

function ImageThumb({ url, index, isOwn }) {
  return (
    <div style={{ position: "relative", width: 64, height: 64 }}>
      <img src={url} alt={`photo ${index + 1}`} onError={(e) => { e.target.style.opacity = 0.15; }}
        style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8, border: `1px solid ${C.border}` }} />
      <span style={{ position: "absolute", top: -6, left: -6, height: 18, borderRadius: 9,
        padding: isOwn ? "0 6px" : 0, width: isOwn ? "auto" : 18,
        background: isOwn ? C.green : C.orange, color: C.white, fontSize: 10.5, fontWeight: 800,
        display: "flex", alignItems: "center", justifyContent: "center" }}>
        {isOwn ? `row ${index + 1}` : index + 1}
      </span>
    </div>
  );
}

/** Fisher-Yates — the randomness behind planRowImages/shuffleRowImages
 * below. Everything that used to be an invisible, non-reproducible
 * server-side shuffle at download time now happens here instead, so a
 * seller can actually see and control it before generating. */
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Mirrors bulk_listing.plan_images server-side, for one row: `urls[ownIndex]`
 * stays fixed as that row's own front image; the rest of the slots get a
 * random sample of every *other* row's photo. Always returns exactly
 * `slotCount` entries — padded with "" (an empty slot) when there aren't
 * enough other photos to fill every slot.
 */
function planRowImages(urls, ownIndex, slotCount) {
  const own = urls[ownIndex] || "";
  const others = shuffleArray(urls.filter((_, j) => j !== ownIndex));
  const picked = [own, ...others].slice(0, slotCount);
  while (picked.length < slotCount) picked.push("");
  return picked;
}

function MsgBanner({ msg, onClose }) {
  if (!msg) return null;
  return (
    <div style={{ padding: "11px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600,
      background: msg.type === "success" ? C.greenLight : C.redLight,
      color: msg.type === "success" ? C.green : C.red,
      border: `1px solid ${msg.type === "success" ? C.greenBorder : C.redBorder}`,
      display: "flex", alignItems: "center", gap: 8 }}>
      {msg.type === "success" ? <CheckCircleIcon style={{ fontSize: 17 }} /> : <ErrorOutlineIcon style={{ fontSize: 17 }} />}
      <span style={{ flex: 1 }}>{msg.text}</span>
      <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", fontSize: 16 }}>×</button>
    </div>
  );
}

/** One image slot inside a Flipkart row's own gallery — draggable so a
 * seller can reorder which photo is the Main Image vs. Other 1-4, since
 * (unlike Meesho) there's no cross-row shuffle to fall back on here; the
 * order a row's own images end up in is entirely down to this. */
function DraggableThumb({ url, index, isMain, onDragStart, onDrop }) {
  return (
    <div draggable={!!url}
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); onDrop(index); }}
      style={{ position: "relative", width: 64, height: 64, cursor: url ? "grab" : "default" }}>
      {url ? (
        <img src={url} alt={`slot ${index + 1}`} onError={(e) => { e.target.style.opacity = 0.15; }}
          style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8,
            border: `2px solid ${isMain ? C.green : C.border}` }} />
      ) : (
        <div style={{ width: 64, height: 64, borderRadius: 8, border: `2px dashed ${C.border}`,
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9.5, color: C.gray400 }}>
          empty
        </div>
      )}
      <span style={{ position: "absolute", top: -6, left: -6, height: 18, minWidth: 18, borderRadius: 9,
        padding: "0 5px", background: isMain ? C.green : C.gray400, color: C.white, fontSize: 10, fontWeight: 800,
        display: "flex", alignItems: "center", justifyContent: "center" }}>
        {isMain ? "Main" : index + 1}
      </span>
    </div>
  );
}

/**
 * The Flipkart Listing sub-tab — deliberately its own component with its
 * own state rather than another branch through BulkListingTab's Meesho
 * logic, because the shape of the problem is different in every way that
 * matters:
 *
 * - Rows aren't synthesised from pasted photo links; they're read straight
 *   off the uploaded sheet (Flipkart's own bulk image-upload tool already
 *   drops a SKU and its images into each row before a seller downloads the
 *   file) — see backend's extract_prefilled_rows.
 * - A row's images stay its own — no cross-row shuffle — but can be
 *   manually dragged into a different order within that row.
 * - Attribute values are per-row, not one shared form for every row, with a
 *   "copy to all other rows" convenience that only fills blanks.
 * - Templates can be saved to the database and reused without re-uploading
 *   (Flipkart-only — see FlipkartBulkTemplate on the backend).
 */
function FlipkartFlow() {
  const fileInputRef = useRef(null);

  const [templates, setTemplates] = useState([]);
  const [spec, setSpec] = useState(null);
  const [source, setSource] = useState(null); // { type: "file", file } | { type: "template", id, name }
  const [parsing, setParsing] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);

  const [rows, setRows] = useState([]); // { sku, images: [...], attributes: {} }
  const [expanded, setExpanded] = useState(new Set());
  const [dragging, setDragging] = useState(null); // { row, from }
  const [syncFromRow1, setSyncFromRow1] = useState(false);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => { refreshTemplates(); }, []);

  const refreshTemplates = () => {
    fetch(`${API}/bulk-listing/flipkart-templates/`).then((r) => r.json())
      .then((d) => setTemplates(d.results || [])).catch(() => {});
  };

  const attributeFields = useMemo(
    () => (spec
      ? spec.fields.filter((f) => f.role !== "sku" && !isImageRole(f.role)
        && !FORCED_ATTRIBUTE_LABELS.has(f.label.trim().toLowerCase()))
      : []),
    [spec]
  );

  // While checked, Row 1's own attribute values (never its SKU id or
  // images — those stay per-row) are mirrored onto every other row,
  // overwriting whatever was there, so a seller can fill Row 1 once and
  // watch the rest fill in live. Unchecking stops the mirroring — that's
  // the point at which "I will edit the required info only" per row
  // starts making sense, since further Row 1 edits would otherwise keep
  // clobbering any row-specific tweaks made afterward.
  useEffect(() => {
    if (!syncFromRow1 || rows.length < 2) return;
    const src = rows[0]?.attributes || {};
    setRows((rs) => rs.map((r, i) => (i === 0 ? r : { ...r, attributes: { ...src } })));
  }, [syncFromRow1, rows[0]?.attributes]);

  const slotFields = useMemo(
    () => (spec ? spec.fields.filter((f) => isImageRole(f.role)) : []),
    [spec]
  );
  const mainRequired = !!slotFields[0]?.required;

  const rowErrors = useMemo(() => {
    const skuCounts = {};
    rows.forEach((r) => {
      const k = r.sku.trim().toLowerCase();
      if (k) skuCounts[k] = (skuCounts[k] || 0) + 1;
    });
    return rows.map((row) => {
      const errs = [];
      const k = row.sku.trim().toLowerCase();
      if (!k) errs.push("SKU id");
      else if (skuCounts[k] > 1) errs.push("SKU id (duplicate)");
      if (mainRequired && !row.images[0]) errs.push(slotFields[0]?.label || "Main image");
      attributeFields.forEach((f) => {
        if (f.required && !String(row.attributes[f.key] ?? "").trim()) errs.push(f.label);
      });
      return errs;
    });
  }, [rows, attributeFields, mainRequired, slotFields]);

  const resetFlow = () => {
    setSpec(null);
    setSource(null);
    setRows([]);
    setExpanded(new Set());
    setDragging(null);
    setSyncFromRow1(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const parseSource = async (src) => {
    setParsing(true);
    setMsg(null);
    try {
      const fd = new FormData();
      if (src.type === "file") fd.append("file", src.file);
      else fd.append("template_id", src.id);
      fd.append("platform", "flipkart");
      const res = await fetch(`${API}/bulk-listing/parse/`, { method: "POST", body: fd });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ type: "error", text: d.error || "Could not read that template." });
        return;
      }
      setSpec(d);
      setSource(src);
      const newRows = (d.prefilled_rows || []).map((r) => ({
        sku: r.sku_id, images: [...r.images], attributes: { ...(r.attributes || {}) }, error: r.error || null,
      }));
      setRows(newRows);
      // Rows Flipkart already rejected open by default — that's exactly
      // what needs fixing, so there's nothing to gain from making the
      // seller click into each one to discover that.
      setExpanded(new Set(newRows.map((r, i) => (r.error ? i : null)).filter((i) => i !== null)));
      setSyncFromRow1(false);
      const errorCount = newRows.filter((r) => r.error).length;
      if (errorCount > 0) {
        setMsg({
          type: "error",
          text: `This looks like a Flipkart error sheet — ${errorCount} of ${newRows.length} row(s) were `
            + `rejected. Details are shown on each affected row below; fix what's needed and generate again.`,
        });
      }
    } catch {
      setMsg({ type: "error", text: "Network error while reading the template." });
    } finally {
      setParsing(false);
    }
  };

  const onFilePicked = (e) => {
    const file = e.target.files?.[0];
    if (file) parseSource({ type: "file", file });
  };

  const changeTemplate = () => resetFlow();

  const saveTemplate = async () => {
    if (!source || source.type !== "file") return;
    const name = window.prompt("Save this Flipkart template for reuse, named:", spec?.category_label || "");
    if (!name || !name.trim()) return;
    setSavingTemplate(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("name", name.trim());
      fd.append("file", source.file);
      const res = await fetch(`${API}/bulk-listing/flipkart-templates/`, { method: "POST", body: fd });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ type: "error", text: d.error || "Could not save the template." }); return; }
      setMsg({ type: "success", text: `Saved "${name.trim()}" — pick it from "Use a saved template" next time.` });
      refreshTemplates();
    } catch {
      setMsg({ type: "error", text: "Network error." });
    } finally {
      setSavingTemplate(false);
    }
  };

  const deleteTemplate = async (id, name) => {
    if (!window.confirm(`Delete the saved template "${name}"?`)) return;
    try {
      const res = await fetch(`${API}/bulk-listing/flipkart-templates/${id}/`, { method: "DELETE" });
      if (!res.ok) { setMsg({ type: "error", text: "Could not delete that template." }); return; }
      refreshTemplates();
    } catch {
      setMsg({ type: "error", text: "Network error." });
    }
  };

  const setRowSku = (i) => (value) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, sku: value } : r)));

  const setRowAttr = (i, key) => (value) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, attributes: { ...r.attributes, [key]: value } } : r)));

  const toggleExpanded = (i) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });

  const handleImageDrop = (rowIndex, to) => {
    setDragging((d) => {
      if (!d || d.row !== rowIndex || d.from === to) return null;
      const from = d.from;
      setRows((rs) => rs.map((r, j) => {
        if (j !== rowIndex) return r;
        const imgs = [...r.images];
        const [moved] = imgs.splice(from, 1);
        imgs.splice(to, 0, moved);
        return { ...r, images: imgs };
      }));
      return null;
    });
  };

  /** Fills blanks on every other row from this row's own attribute values —
   * never overwrites a value another row already has, so hand-edits already
   * made elsewhere are never clobbered by a later copy. */
  const copyRowToOthers = (i) => {
    setRows((rs) => {
      const src = rs[i].attributes;
      const keys = Object.keys(src).filter((k) => String(src[k] ?? "").trim() !== "");
      if (!keys.length || rs.length < 2) return rs;
      return rs.map((r, j) => {
        if (j === i) return r;
        const merged = { ...r.attributes };
        keys.forEach((k) => {
          if (String(merged[k] ?? "").trim() === "") merged[k] = src[k];
        });
        return { ...r, attributes: merged };
      });
    });
    setMsg({ type: "success", text: `Copied to ${rows.length - 1} other row(s) — only filled in blanks, existing edits were kept.` });
  };

  const generate = async () => {
    setMsg(null);
    if (!spec || !source) {
      setMsg({ type: "error", text: "Pick a template first." });
      return;
    }
    if (rows.length === 0) {
      setMsg({ type: "error", text: "No rows to generate — upload a template with at least one row." });
      return;
    }
    if (rowErrors.some((e) => e.length)) {
      setMsg({ type: "error", text: "Fix the highlighted row(s) before generating." });
      return;
    }
    const payload = { rows: rows.map((r) => ({ sku_id: r.sku, images: r.images, attributes: r.attributes })) };
    const fd = new FormData();
    if (source.type === "file") fd.append("file", source.file);
    else fd.append("template_id", source.id);
    fd.append("platform", "flipkart");
    fd.append("payload", JSON.stringify(payload));

    setBusy(true);
    try {
      const res = await fetch(`${API}/bulk-listing/generate/`, { method: "POST", body: fd });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setMsg({ type: "error", text: d.error || "Could not generate the sheet." });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // Same filename it was uploaded (or saved) under — matches what the
      // server names it (_download_filename in bulk_listing_views.py); the
      // `download` attribute is what actually wins for a blob: URL like
      // this, so the response's own Content-Disposition header is moot here.
      a.download = source.type === "file" ? source.file.name : (source.originalFilename || "bulk-listing.xls");
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMsg({ type: "success", text: "Sheet downloaded — ready to upload on Flipkart." });
    } catch {
      setMsg({ type: "error", text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <MsgBanner msg={msg} onClose={() => setMsg(null)} />

      <Section title="Template">
        {spec ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Tag variant="green" fontSize={12}>{spec.category_label}</Tag>
            <span style={{ fontSize: 11.5, color: C.gray400 }}>
              {source?.type === "file" ? `from ${source.file.name}` : `saved template "${source.name}"`}
              {" "}· {spec.fields.length} fields detected · {rows.length} row{rows.length === 1 ? "" : "s"} found
            </span>
            {source?.type === "file" && (
              <button onClick={saveTemplate} disabled={savingTemplate} style={btn("ghost", "sm")}>
                <SaveIcon style={{ fontSize: 14, verticalAlign: "-3px" }} />&nbsp;Save this template for reuse
              </button>
            )}
            <button onClick={changeTemplate} style={{ ...btn("ghost", "sm"), marginLeft: source?.type === "file" ? 0 : "auto" }}>
              <ChangeCircleIcon style={{ fontSize: 15, verticalAlign: "-3px" }} />&nbsp;Change template
            </button>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <input ref={fileInputRef} type="file" accept=".xls,.xlsx" onChange={onFilePicked}
                disabled={parsing} style={{ fontSize: 12.5 }} />
              {templates.length > 0 && (
                <>
                  <span style={{ fontSize: 11.5, color: C.gray400 }}>or</span>
                  <select disabled={parsing} defaultValue="" style={{ ...S.inp, maxWidth: 260, width: "auto" }}
                    onChange={(e) => {
                      const t = templates.find((x) => String(x.id) === e.target.value);
                      if (t) parseSource({ type: "template", id: t.id, name: t.name, originalFilename: t.original_filename });
                      e.target.value = "";
                    }}>
                    <option value="" disabled>Use a saved template…</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name} ({t.category_label})</option>
                    ))}
                  </select>
                </>
              )}
              {parsing && <CircularProgress size={18} style={{ color: C.orange }} />}
            </div>
            <div style={{ fontSize: 11, color: C.gray400, marginTop: 8 }}>
              Upload the category template you download from Flipkart's seller panel — one that
              already has each row's Seller SKU ID and images filled in (e.g. straight after using
              Flipkart's own bulk image upload tool). Its own fields, dropdowns, and required
              markers drive everything below — nothing here is hardcoded to one category.
            </div>
            {templates.length > 0 && (
              <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
                {templates.map((t) => (
                  <span key={t.id} style={{ display: "inline-flex", alignItems: "center", gap: 5,
                    fontSize: 11, color: C.gray500, background: C.gray50, border: `1px solid ${C.border}`,
                    borderRadius: 8, padding: "3px 5px 3px 9px" }}>
                    {t.name}
                    <button onClick={() => deleteTemplate(t.id, t.name)} title="Delete this saved template"
                      style={{ background: "none", border: "none", cursor: "pointer", color: C.gray400, fontSize: 14, padding: "0 3px" }}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </Section>

      {spec && (
        <>
          <Section title={`The ${rows.length} listing${rows.length === 1 ? "" : "s"}`.trim()}>
            {rows.length === 0 ? (
              <div style={{ fontSize: 12.5, color: C.gray400 }}>No rows found in this template.</div>
            ) : (
              <>
                {rows.length > 1 && (
                  <div style={{ marginBottom: 14, padding: 12, borderRadius: 10,
                    background: C.gray50, border: `1px solid ${C.border}`,
                    display: "flex", alignItems: "flex-start", gap: 9 }}>
                    <input type="checkbox" id="fk-sync-row1" checked={syncFromRow1}
                      onChange={(e) => setSyncFromRow1(e.target.checked)}
                      style={{ marginTop: 2, cursor: "pointer" }} />
                    <label htmlFor="fk-sync-row1" style={{ fontSize: 12, color: C.gray600, fontWeight: 600, cursor: "pointer" }}>
                      Copy Row 1's attributes to every other row (SKU id and images stay their own)
                      <div style={{ fontSize: 11, color: C.gray400, fontWeight: 500, marginTop: 2 }}>
                        Fill in Row 1 while this is checked — the rest mirror it live. Uncheck it
                        when you're ready to edit only what's different, row by row.
                      </div>
                    </label>
                  </div>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {rows.map((row, i) => {
                  const isOpen = expanded.has(i);
                  const errs = rowErrors[i] || [];
                  const filledCount = attributeFields.filter((f) => String(row.attributes[f.key] ?? "").trim()).length;
                  return (
                    <div key={i} style={{ border: `1px solid ${errs.length ? C.redBorder : row.error ? C.orangeBorder : C.border}`, borderRadius: 10, padding: 12 }}>
                      <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap" }}>
                        <Tag variant="blue" fontSize={11}>Row {i + 1}</Tag>
                        {row.error && <Tag variant="orange" fontSize={11}>Rejected by Flipkart</Tag>}
                        <div style={{ display: "flex", gap: 4 }}>
                          {row.images.map((u, idx) => (
                            u ? (
                              <img key={idx} src={u} alt="" onError={(e) => { e.target.style.opacity = 0.15; }}
                                style={{ width: 30, height: 30, objectFit: "cover", borderRadius: 6,
                                  border: `2px solid ${idx === 0 ? C.green : C.border}` }}
                                title={idx === 0 ? "Main image" : `Other image ${idx}`} />
                            ) : (
                              <div key={idx} style={{ width: 30, height: 30, borderRadius: 6, background: C.gray100 }} />
                            )
                          ))}
                        </div>
                        <div style={{ flex: 1, minWidth: 160 }}>
                          <label style={S.label}>SKU id *</label>
                          <input value={row.sku} onChange={(e) => setRowSku(i)(e.target.value)}
                            style={{ ...S.inp, fontFamily: "monospace" }} />
                        </div>
                        <button onClick={() => toggleExpanded(i)} style={btn("secondary", "sm")}>
                          {isOpen ? "Done editing" : `Edit attributes (${filledCount}/${attributeFields.length})`}
                        </button>
                      </div>

                      {row.error && (
                        <div style={{ marginTop: 10, padding: "9px 12px", borderRadius: 8,
                          background: C.orangeLight, border: `1px solid ${C.orangeBorder}` }}>
                          <div style={{ fontSize: 11.5, color: C.orange, fontWeight: 700 }}>
                            Flipkart rejected this row{row.error.status ? ` — ${row.error.status}` : ""}:
                          </div>
                          {row.error.message && (
                            <div style={{ fontSize: 11, color: C.gray600, marginTop: 4, whiteSpace: "pre-line", lineHeight: 1.5 }}>
                              {row.error.message}
                            </div>
                          )}
                        </div>
                      )}

                      {errs.length > 0 && (
                        <div style={{ fontSize: 11, color: C.red, marginTop: 8, fontWeight: 600 }}>
                          Missing: {errs.join(", ")}
                        </div>
                      )}

                      {isOpen && (
                        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
                          <label style={S.label}>Images — drag to reorder (first is the Main Image)</label>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
                            {row.images.map((u, idx) => (
                              <DraggableThumb key={idx} url={u} index={idx} isMain={idx === 0}
                                onDragStart={(from) => setDragging({ row: i, from })}
                                onDrop={(to) => handleImageDrop(i, to)} />
                            ))}
                          </div>

                          <div style={{ display: "flex", alignItems: "center", marginBottom: 10, gap: 10, flexWrap: "wrap" }}>
                            <label style={{ ...S.label, marginBottom: 0 }}>Product attributes</label>
                            <button onClick={() => copyRowToOthers(i)} disabled={rows.length < 2}
                              style={{ ...btn("ghost", "sm"), marginLeft: "auto" }}>
                              Copy to all other rows (fills blanks only)
                            </button>
                          </div>
                          <FieldGrid>
                            {attributeFields.map((f) => (
                              <Field key={f.key} def={f} value={row.attributes[f.key]} onChange={setRowAttr(i, f.key)} />
                            ))}
                          </FieldGrid>
                        </div>
                      )}
                    </div>
                  );
                })}
                </div>
              </>
            )}
          </Section>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button onClick={generate} disabled={busy || rows.length === 0} style={btn("primary", "lg")}>
              {busy
                ? "Generating…"
                : <><DownloadIcon style={{ fontSize: 17, verticalAlign: "-3px" }} />&nbsp;Generate &amp; download sheet</>}
            </button>
          </div>
        </>
      )}
    </>
  );
}

export function BulkListingTab() {
  const isMobile = useIsMobile();
  const fileInputRef = useRef(null);

  const [mode, setMode] = useState("new");
  const [builtIns, setBuiltIns] = useState([]);
  const [spec, setSpec] = useState(null);           // { category_label, fields }
  const [source, setSource] = useState(null);        // { type: "file", file } | { type: "built_in", key }
  const [parsing, setParsing] = useState(false);

  const [presets, setPresets] = useState([]);
  const [presetId, setPresetId] = useState("");
  const [coveredKeys, setCoveredKeys] = useState(new Set());
  const [savingPreset, setSavingPreset] = useState(false);

  const [shared, setShared] = useState({});
  const [imageText, setImageText] = useState("");     // "New Sheet" mode input
  const [prefilledImages, setPrefilledImages] = useState([]); // "Prefilled Sheet" mode input
  const [prefix, setPrefix] = useState("");
  const [listingType, setListingType] = useState("unique");
  const [groupIdBase, setGroupIdBase] = useState("Group");
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    fetch(`${API}/bulk-listing/built-ins/`).then((r) => r.json())
      .then((d) => setBuiltIns(d.results || [])).catch(() => {});
    refreshPresets();
  }, []);

  const refreshPresets = () => {
    fetch(`${API}/bulk-listing/presets/`).then((r) => r.json())
      .then((d) => setPresets(d.results || [])).catch(() => {});
  };

  const resetFlow = () => {
    setSpec(null);
    setSource(null);
    setShared({});
    setPresetId("");
    setCoveredKeys(new Set());
    setImageText("");
    setPrefilledImages([]);
    setRows([]);
    setImageDragging(null);
    setAddPickerFor(null);
    setExpandedOverrides(new Set());
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const switchMode = (id) => {
    if (id === mode) return;
    setMode(id);
    setMsg(null);
    resetFlow();
  };

  const parseSource = async (src) => {
    setParsing(true);
    setMsg(null);
    try {
      const fd = new FormData();
      if (src.type === "file") fd.append("file", src.file);
      else fd.append("built_in", src.key);
      fd.append("platform", "meesho");
      const res = await fetch(`${API}/bulk-listing/parse/`, { method: "POST", body: fd });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ type: "error", text: d.error || "Could not read that template." });
        return;
      }
      if (mode === "prefilled") {
        const found = d.prefilled_images || [];
        if (!found.length) {
          setMsg({
            type: "error",
            text: "No photos found in this sheet's own Image 1 (Front) column — make sure "
              + "you're uploading a sheet where photos are already dropped in row by row "
              + "(e.g. via Meesho's Image Link Generator), or switch to New Sheet.",
          });
          return;
        }
        setPrefilledImages(found);
      }
      setSpec(d);
      setSource(src);
      setShared({});
      setPresetId("");
      setCoveredKeys(new Set());
    } catch {
      setMsg({ type: "error", text: "Network error while reading the template." });
    } finally {
      setParsing(false);
    }
  };

  const onFilePicked = (e) => {
    const file = e.target.files?.[0];
    if (file) parseSource({ type: "file", file });
  };

  const changeTemplate = () => resetFlow();

  const setField = (key) => (value) => setShared((s) => ({ ...s, [key]: value }));

  const imageUrls = useMemo(
    () => (mode === "prefilled" ? prefilledImages : parseImageUrls(imageText)),
    [mode, prefilledImages, imageText]
  );

  // How many photo columns this category actually has.
  const imageSlotCount = useMemo(
    () => (spec ? spec.fields.filter((f) => isImageRole(f.role)).length : 0),
    [spec]
  );

  // The row inputs always track however many photos are in play — the
  // photos given *are* the rows. Any row whose gallery hasn't been seeded
  // yet (images === null, see emptyRow) gets one via planRowImages; a row
  // the seller has already customized (or deliberately cleared to []) is
  // left alone, same principle as Flipkart's per-row `attributes`.
  useEffect(() => {
    setRows((rs) => {
      const n = imageUrls.length;
      let next = rs;
      if (n !== rs.length) {
        next = n < rs.length ? rs.slice(0, n) : [...rs, ...Array.from({ length: n - rs.length }, emptyRow)];
      }
      if (!imageSlotCount) return next;
      let changed = next !== rs;
      const seeded = next.map((r, i) => {
        if (r.images) return r;
        changed = true;
        return { ...r, images: planRowImages(imageUrls, i, imageSlotCount) };
      });
      return changed ? seeded : next;
    });
  }, [imageUrls, imageSlotCount]);

  const setRowImages = (i, updater) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, images: updater(r.images || []) } : r)));

  const [imageDragging, setImageDragging] = useState(null); // { row, from }
  const [addPickerFor, setAddPickerFor] = useState(null);   // row index, or null
  const [expandedOverrides, setExpandedOverrides] = useState(new Set()); // row indices

  const shuffleRowImages = (i) => setRowImages(i, (imgs) => {
    const front = imgs[0] || imageUrls[i] || "";
    const others = shuffleArray(imageUrls.filter((u) => u && u !== front)).slice(0, Math.max(imageSlotCount - 1, 0));
    const next = [front, ...others];
    while (next.length < imageSlotCount) next.push("");
    return next;
  });

  const deleteRowImage = (i, idx) => setRowImages(i, (imgs) => {
    const next = [...imgs];
    next[idx] = "";
    return next;
  });

  const addRowImage = (i, url) => {
    setRowImages(i, (imgs) => {
      const next = [...imgs];
      const emptyIdx = next.findIndex((u) => !u);
      if (emptyIdx === -1) return imgs;
      next[emptyIdx] = url;
      return next;
    });
    setAddPickerFor(null);
  };

  const handleRowImageDrop = (rowIndex, to) => {
    setImageDragging((d) => {
      if (!d || d.row !== rowIndex || d.from === to) return null;
      const from = d.from;
      setRowImages(rowIndex, (imgs) => {
        const next = [...imgs];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      });
      return null;
    });
  };

  const applyPrefix = () => {
    const p = prefix.trim();
    if (!p) return;
    setRows((rs) => rs.map((r, i) => {
      const auto = `${p}-${String(i + 1).padStart(3, "0")}`;
      return { ...r, sku: auto, style: auto };
    }));
  };

  const applyGroupIds = () => {
    const planned = planGroupIds(rows.length, listingType, groupIdBase);
    setRows((rs) => rs.map((r, i) => ({ ...r, groupId: planned[i] })));
  };

  const setRow = (i, key) => (value) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [key]: value } : r)));

  // Every row starts from the one shared Product Details form; overriding
  // a specific field on a specific row only changes that row — everything
  // else about it still tracks the shared value, including live edits made
  // to the shared form afterward (see the effective-value read in the row
  // override grid below, which only stores what's actually been changed).
  const setRowOverride = (i, key) => (value) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, overrides: { ...r.overrides, [key]: value } } : r)));

  const resetRowOverrides = (i) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, overrides: {} } : r)));

  const sharedFields = useMemo(
    () => (spec ? spec.fields.filter((f) => !isPerRowRole(f.role)) : []),
    [spec]
  );
  const groupIdField = useMemo(() => spec?.fields.find((f) => f.role === "group_id") || null, [spec]);
  const titleField = useMemo(() => spec?.fields.find((f) => f.role === "title") || null, [spec]);
  const frontImageField = useMemo(() => spec?.fields.find((f) => f.role === "image_1") || null, [spec]);
  const importerFields = useMemo(
    () => sharedFields.filter((f) => f.role && f.role.startsWith("importer_")),
    [sharedFields]
  );
  const countryField = useMemo(() => sharedFields.find((f) => f.role === "country_of_origin"), [sharedFields]);
  const wdrpField = useMemo(() => sharedFields.find((f) => f.role === "wrong_defective_price"), [sharedFields]);
  const meeshoPriceField = useMemo(
    () => sharedFields.find((f) => /meesho price/i.test(f.label)),
    [sharedFields]
  );

  const country = String(countryField ? shared[countryField.key] ?? "" : "")
    .trim()
    .toLowerCase();
  const needsImporter = importerFields.length > 0 && country && country !== "india";

  const wdrpPlaceholder = useMemo(() => {
    if (!meeshoPriceField) return "";
    const p = Number(shared[meeshoPriceField.key]);
    return Number.isFinite(p) && p > 20 ? String(p - 20) : "";
  }, [shared, meeshoPriceField]);

  // Ordinary fields shown in the main grid: not per-row, not importer (its
  // own conditional block below), and not tucked away by a loaded preset.
  const excludedFromGrid = useMemo(() => new Set(importerFields.map((f) => f.key)), [importerFields]);

  const visibleFields = sharedFields.filter((f) => !excludedFromGrid.has(f.key) && !coveredKeys.has(f.key));
  const hiddenByPreset = sharedFields.filter((f) => coveredKeys.has(f.key));

  // Caught here, before the network call, so a required field that's empty
  // (Meesho Price included) can never silently produce a blank cell — the
  // server would reject it too, but a clear message beats a round trip.
  // Importer fields are exempt exactly when the template itself would mark
  // them "Not Required" (country of origin is India).
  const missingRequired = useMemo(
    () => sharedFields.filter((f) => {
      if (!f.required) return false;
      if (importerFields.some((imp) => imp.key === f.key) && !needsImporter) return false;
      return !String(shared[f.key] ?? "").trim();
    }),
    [sharedFields, importerFields, needsImporter, shared]
  );

  // Money-shaped fields (Meesho Price, MRP, …) get checked whenever they
  // have a value, required or not — same rule the server enforces, just
  // surfaced before the round trip.
  const invalidMoney = useMemo(
    () => sharedFields.filter((f) => {
      if (f.money_max == null) return false;
      const v = String(shared[f.key] ?? "").trim();
      return v !== "" && !validateMoney(v, f.money_max);
    }),
    [sharedFields, shared]
  );

  // Only checks keys a row actually overrides — an untouched field falls
  // back to the shared value, which missingRequired/invalidMoney above
  // already cover, so re-checking it here per row would just be noise.
  const rowOverrideErrors = useMemo(() => rows.map((row) => {
    const errs = [];
    Object.entries(row.overrides || {}).forEach(([key, value]) => {
      const f = sharedFields.find((sf) => sf.key === key);
      if (!f) return;
      if (f.required && !String(value ?? "").trim()) { errs.push(f.label); return; }
      const v = String(value ?? "").trim();
      if (!v) return;
      if (f.money_max != null && !validateMoney(v, f.money_max)) errs.push(`${f.label} (invalid amount)`);
      else if (f.options?.length && !f.options.includes(value)) errs.push(`${f.label} (invalid value)`);
    });
    return errs;
  }), [rows, sharedFields]);

  const loadPreset = (id) => {
    setPresetId(id);
    if (!id) { setCoveredKeys(new Set()); return; }
    const preset = presets.find((p) => String(p.id) === String(id));
    if (!preset) return;
    setShared((s) => ({ ...s, ...preset.fields }));
    setCoveredKeys(new Set(Object.keys(preset.fields || {}).filter((k) => preset.fields[k] !== "")));
  };

  const savePreset = async () => {
    const name = window.prompt("Save these field values as a preset named:");
    if (!name || !name.trim()) return;
    const fields = {};
    const labels = {};
    sharedFields.forEach((f) => {
      const v = shared[f.key];
      if (v !== undefined && v !== null && v !== "") {
        fields[f.key] = v;
        labels[f.key] = f.label;
      }
    });
    if (!Object.keys(fields).length) {
      setMsg({ type: "error", text: "Fill in some fields before saving a preset." });
      return;
    }
    setSavingPreset(true);
    try {
      const res = await fetch(`${API}/bulk-listing/presets/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), fields, labels, source_label: spec?.category_label || "" }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ type: "error", text: d.error || "Could not save the preset." }); return; }
      setMsg({ type: "success", text: `Saved "${name.trim()}" — ${Object.keys(fields).length} field(s).` });
      refreshPresets();
    } catch {
      setMsg({ type: "error", text: "Network error." });
    } finally {
      setSavingPreset(false);
    }
  };

  const generate = async () => {
    setMsg(null);
    if (!spec || !source) {
      setMsg({ type: "error", text: "Pick a template first." });
      return;
    }
    if (imageUrls.length === 0) {
      setMsg({
        type: "error",
        text: mode === "prefilled" ? "No photos found to build listings from." : "Paste at least one image link.",
      });
      return;
    }
    if (missingRequired.length) {
      setMsg({ type: "error", text: `Fill in: ${missingRequired.map((f) => f.label).join(", ")}.` });
      return;
    }
    if (invalidMoney.length) {
      setMsg({ type: "error", text: `Fix: ${invalidMoney.map((f) => f.label).join(", ")} — positive number, at most 2 decimal places.` });
      return;
    }
    if (frontImageField?.required && rows.some((r) => !(r.images && r.images[0]))) {
      setMsg({ type: "error", text: `Every row needs a ${frontImageField.label} — check the highlighted row(s) below.` });
      return;
    }
    if (rowOverrideErrors.some((e) => e.length)) {
      setMsg({ type: "error", text: "Fix the row-specific overrides highlighted below." });
      return;
    }
    const payload = {
      shared,
      rows: rows.map((r) => ({
        product_name: r.title, sku_id: r.sku, style_id: r.style, group_id: r.groupId,
        images: r.images || [], overrides: r.overrides || {},
      })),
      image_urls: imageUrls,
    };
    const fd = new FormData();
    if (source.type === "file") fd.append("file", source.file);
    else fd.append("built_in", source.key);
    fd.append("platform", "meesho");
    fd.append("payload", JSON.stringify(payload));

    setBusy(true);
    try {
      const res = await fetch(`${API}/bulk-listing/generate/`, { method: "POST", body: fd });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setMsg({ type: "error", text: d.error || "Could not generate the sheet." });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "bulk-listing.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMsg({ type: "success", text: "Sheet downloaded — ready to upload on Meesho." });
    } catch {
      setMsg({ type: "error", text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  const rowCount = rows.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <UploadFileIcon style={{ color: C.orange, fontSize: 21 }} />
          <h1 style={{ fontSize: 19, fontWeight: 800, color: C.gray800 }}>Bulk Listing</h1>
        </div>
        <p style={{ fontSize: 12, color: C.gray400, marginTop: 3 }}>
          Fill one product's details once, give a set of photos, and get back a
          ready-to-upload sheet with one unique listing per photo.
        </p>
      </div>

      <div style={{ display: "inline-flex", background: C.gray100, borderRadius: 10, padding: 3,
        border: `1px solid ${C.border}`, width: "fit-content" }}>
        {MODES.map((m) => (
          <button key={m.id} onClick={() => switchMode(m.id)} title={m.hint}
            style={{ border: "none", cursor: "pointer", fontFamily: "inherit",
              background: mode === m.id ? C.white : "transparent",
              color: mode === m.id ? C.gray800 : C.gray500,
              fontWeight: mode === m.id ? 800 : 600, fontSize: 12.5,
              padding: "7px 16px", borderRadius: 8,
              boxShadow: mode === m.id ? "0 1px 3px rgba(0,0,0,0.10)" : "none" }}>
            {m.label}
          </button>
        ))}
      </div>

      {mode === "flipkart" ? (
        <FlipkartFlow />
      ) : (
        <>
          <MsgBanner msg={msg} onClose={() => setMsg(null)} />

          <Section title="Template">
            {spec ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <Tag variant="green" fontSize={12}>{spec.category_label}</Tag>
                <span style={{ fontSize: 11.5, color: C.gray400 }}>
                  {source?.type === "file" ? `from ${source.file.name}` : "bundled quick-start"} · {spec.fields.length} fields detected
                  {mode === "prefilled" && ` · ${prefilledImages.length} photo(s) found`}
                </span>
                <button onClick={changeTemplate} style={{ ...btn("ghost", "sm"), marginLeft: "auto" }}>
                  <ChangeCircleIcon style={{ fontSize: 15, verticalAlign: "-3px" }} />&nbsp;Change template
                </button>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <input ref={fileInputRef} type="file" accept=".xlsx" onChange={onFilePicked}
                    disabled={parsing} style={{ fontSize: 12.5 }} />
                  {mode === "new" && builtIns.length > 0 && (
                    <>
                      <span style={{ fontSize: 11.5, color: C.gray400 }}>or</span>
                      {builtIns.map((b) => (
                        <button key={b.id} onClick={() => parseSource({ type: "built_in", key: b.id })}
                          disabled={parsing} style={btn("secondary", "sm")}>
                          Use {b.label}
                        </button>
                      ))}
                    </>
                  )}
                  {parsing && <CircularProgress size={18} style={{ color: C.orange }} />}
                </div>
                <div style={{ fontSize: 11, color: C.gray400, marginTop: 8 }}>
                  {mode === "new"
                    ? 'Upload the category template you download from Meesho’s supplier panel (Bulk Upload → download template), or start from a bundled one. Its own fields, dropdowns, and required markers drive everything below — nothing here is hardcoded to one category.'
                    : "Upload a sheet where you've already dropped one photo per row into its Image 1 (Front) column — e.g. straight after using Meesho's Image Link Generator. We'll read those photos out and build fresh listings from them, keeping each row's own photo as that listing's front image."}
                </div>
              </>
            )}
          </Section>

          {spec && (
            <>
              {mode === "new" ? (
                <Section title="Photos">
                  <label style={S.label}>Paste your image links (one per line)</label>
                  <textarea value={imageText} onChange={(e) => setImageText(e.target.value)} rows={5}
                    placeholder={"https://…/photo1.jpg\nhttps://…/photo2.jpg\nhttps://…/photo3.jpg\n…"}
                    style={{ ...S.inp, resize: "vertical", fontFamily: "monospace", fontSize: 12.5 }} />
                  <div style={{ fontSize: 11.5, color: C.gray500, marginTop: 6, lineHeight: 1.6 }}>
                    <b style={{ color: imageUrls.length ? C.green : C.gray400 }}>
                      {imageUrls.length} link{imageUrls.length === 1 ? "" : "s"} pasted
                    </b>
                    {imageSlotCount > 0 && <> · this category has {imageSlotCount} photo slot{imageSlotCount === 1 ? "" : "s"}</>}
                    <br />
                    One listing per link — each link is that listing's own front image; the rest
                    of its gallery is a random pick from every other link — shuffle, delete, or
                    add a different photo per row below.
                  </div>
                  {imageUrls.length > 0 && (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                      {imageUrls.map((u, i) => <ImageThumb key={i} url={u} index={i} isOwn />)}
                    </div>
                  )}
                </Section>
              ) : (
                <Section title="Photos found in this sheet">
                  <div style={{ fontSize: 11.5, color: C.gray500, lineHeight: 1.6 }}>
                    <b style={{ color: C.green }}>{imageUrls.length} photo{imageUrls.length === 1 ? "" : "s"} found</b>,
                    {" "}one per row from the uploaded sheet. Each stays that row's own front
                    image; the rest of its gallery is a random pick from the others — shuffle,
                    delete, or add a different photo per row below.
                  </div>
                  {imageUrls.length > 0 && (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                      {imageUrls.map((u, i) => <ImageThumb key={i} url={u} index={i} isOwn />)}
                    </div>
                  )}
                </Section>
              )}

              <Section title="Saved presets" right={
                <button onClick={savePreset} disabled={savingPreset} style={btn("ghost", "sm")}>
                  <SaveIcon style={{ fontSize: 14, verticalAlign: "-3px" }} />&nbsp;Save current fields as preset
                </button>
              }>
                {presets.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: C.gray400 }}>
                    No presets saved yet — fill in the product details below, then "Save current
                    fields as preset" to reuse them on future products.
                  </div>
                ) : (
                  <>
                    <label style={S.label}>Load a preset</label>
                    <select value={presetId} onChange={(e) => loadPreset(e.target.value)} style={{ ...S.inp, maxWidth: 360 }}>
                      <option value="">— pick a saved preset —</option>
                      {presets.map((p) => (
                        <option key={p.id} value={p.id}>{p.name} ({p.field_count} fields{p.source_label ? ` · ${p.source_label}` : ""})</option>
                      ))}
                    </select>
                  </>
                )}
                {hiddenByPreset.length > 0 && (
                  <div style={{ marginTop: 10, padding: "9px 12px", borderRadius: 8,
                    background: C.greenLight, border: `1px solid ${C.greenBorder}`,
                    display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12.5, color: C.green, fontWeight: 700 }}>
                      Prefilled from "{presets.find((p) => String(p.id) === String(presetId))?.name}" —
                      {" "}{hiddenByPreset.length} field(s) set and hidden below.
                    </span>
                    <button onClick={() => setCoveredKeys(new Set())} style={{ ...btn("ghost", "sm"), marginLeft: "auto" }}>
                      Edit these fields
                    </button>
                  </div>
                )}
              </Section>

              <Section title="Product Details">
                <FieldGrid>
                  {visibleFields.map((f) => (
                    <Field key={f.key} def={f} value={shared[f.key]} onChange={setField(f.key)} />
                  ))}
                </FieldGrid>
                {wdrpField && !shared[wdrpField.key] && wdrpPlaceholder && (
                  <div style={{ fontSize: 11, color: C.gray400, marginTop: 8 }}>
                    Leave "{wdrpField.label}" blank to use {wdrpPlaceholder} (Meesho Price − 20).
                  </div>
                )}
              </Section>

              {importerFields.length > 0 && (
                <Section title="Importer">
                  {needsImporter ? (
                    <FieldGrid>
                      {importerFields.map((f) => (
                        <Field key={f.key} def={f} value={shared[f.key]} onChange={setField(f.key)} />
                      ))}
                    </FieldGrid>
                  ) : (
                    <div style={{ fontSize: 11, color: C.gray400 }}>
                      "Not Required" — {countryField ? countryField.label : "Country of Origin"} is India.
                    </div>
                  )}
                </Section>
              )}

              <Section title={`The ${rowCount || ""} listing${rowCount === 1 ? "" : "s"}`.trim()}>
                {rowCount === 0 ? (
                  <div style={{ fontSize: 12.5, color: C.gray400 }}>
                    {mode === "new" ? "Paste some photo links above to create listings." : "No photos to build listings from."}
                  </div>
                ) : (
                  <>
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                      <div style={{ maxWidth: 260 }}>
                        <label style={S.label}>SKU / Style prefix</label>
                        <input value={prefix} onChange={(e) => setPrefix(e.target.value)}
                          placeholder="e.g. BRS" style={{ ...S.inp, fontFamily: "monospace" }} />
                      </div>
                      <button onClick={applyPrefix} disabled={!prefix.trim()} style={btn("secondary", "sm")}>
                        <AutoAwesomeIcon style={{ fontSize: 15, verticalAlign: "-3px" }} />&nbsp;Suggest SKU ids for all {rowCount}
                      </button>
                    </div>

                    {groupIdField && (
                      <div style={{ marginBottom: 14, padding: 12, borderRadius: 10,
                        background: C.gray50, border: `1px solid ${C.border}` }}>
                        <label style={S.label}>Listing type</label>
                        <div style={{ display: "flex", alignItems: "flex-end", gap: 8, flexWrap: "wrap" }}>
                          <div style={{ display: "inline-flex", background: C.white, borderRadius: 10, padding: 3,
                            border: `1px solid ${C.border}` }}>
                            {LISTING_TYPES.map((t) => (
                              <button key={t.id} onClick={() => setListingType(t.id)} title={t.hint}
                                style={{ border: "none", cursor: "pointer", fontFamily: "inherit",
                                  background: listingType === t.id ? C.orange : "transparent",
                                  color: listingType === t.id ? C.white : C.gray600,
                                  fontWeight: listingType === t.id ? 800 : 600, fontSize: 12.5,
                                  padding: "6px 13px", borderRadius: 8 }}>
                                {t.label}
                              </button>
                            ))}
                          </div>
                          <div style={{ maxWidth: 180 }}>
                            <label style={S.label}>Group ID base</label>
                            <input value={groupIdBase} onChange={(e) => setGroupIdBase(e.target.value)}
                              placeholder="Group" style={S.inp} />
                          </div>
                          <button onClick={applyGroupIds} style={btn("secondary", "sm")}>
                            <AutoAwesomeIcon style={{ fontSize: 15, verticalAlign: "-3px" }} />&nbsp;Apply group ids
                          </button>
                        </div>
                        <div style={{ fontSize: 11, color: C.gray400, marginTop: 8 }}>
                          {listingType === "unique"
                            ? `Unique Listing — every row gets its own group (${planGroupIds(Math.min(rowCount, 3), "unique", groupIdBase).join(", ")}${rowCount > 3 ? ", …" : ""}), so each becomes its own catalog.`
                            : `Variation Listing — every row shares one group (${planGroupIds(1, "variation", groupIdBase)[0]}), so Meesho treats them as variants of the same product.`}
                        </div>
                      </div>
                    )}

                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      {rows.map((row, i) => {
                        const rowImages = row.images || [];
                        const frontMissing = frontImageField?.required && !rowImages[0];
                        const hasEmptySlot = rowImages.some((u) => !u);
                        return (
                          <div key={i} style={{ border: `1px solid ${frontMissing ? C.redBorder : C.border}`, borderRadius: 10, padding: 12 }}>
                            <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 10, alignItems: isMobile ? "stretch" : "flex-end" }}>
                              <Tag variant="blue" fontSize={11}>Row {i + 1}</Tag>
                              {titleField && (
                                <div style={{ flex: 2, minWidth: 160 }}>
                                  <label style={S.label}>Title *</label>
                                  <input value={row.title} onChange={(e) => setRow(i, "title")(e.target.value)}
                                    style={S.inp} placeholder={`Unique product name for listing ${i + 1}`} />
                                </div>
                              )}
                              <div style={{ flex: 1, minWidth: 120 }}>
                                <label style={S.label}>SKU id *</label>
                                <input value={row.sku} onChange={(e) => setRow(i, "sku")(e.target.value)}
                                  style={{ ...S.inp, fontFamily: "monospace" }} />
                              </div>
                              <div style={{ flex: 1, minWidth: 120 }}>
                                <label style={S.label}>Style ID</label>
                                <input value={row.style} onChange={(e) => setRow(i, "style")(e.target.value)}
                                  style={{ ...S.inp, fontFamily: "monospace" }} placeholder="defaults to SKU id" />
                              </div>
                              {groupIdField && (
                                <div style={{ flex: 1, minWidth: 120 }}>
                                  <label style={S.label}>Group ID</label>
                                  <input value={row.groupId} onChange={(e) => setRow(i, "groupId")(e.target.value)}
                                    style={{ ...S.inp, fontFamily: "monospace" }} placeholder="e.g. Group 1" />
                                </div>
                              )}
                            </div>

                            <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                                <label style={{ ...S.label, marginBottom: 0 }}>Photos for this row — drag to reorder</label>
                                <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
                                  <button onClick={() => shuffleRowImages(i)} disabled={imageUrls.length < 2} style={btn("ghost", "sm")}>
                                    <ChangeCircleIcon style={{ fontSize: 15, verticalAlign: "-3px" }} />&nbsp;Shuffle
                                  </button>
                                  <button onClick={() => setAddPickerFor(addPickerFor === i ? null : i)}
                                    disabled={!hasEmptySlot} style={btn("ghost", "sm")}>
                                    + Add photo
                                  </button>
                                </div>
                              </div>
                              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                {rowImages.map((u, idx) => (
                                  <div key={idx} style={{ position: "relative" }}>
                                    <DraggableThumb url={u} index={idx} isMain={idx === 0}
                                      onDragStart={(from) => setImageDragging({ row: i, from })}
                                      onDrop={(to) => handleRowImageDrop(i, to)} />
                                    {u && (
                                      <button onClick={() => deleteRowImage(i, idx)} title="Remove this photo"
                                        style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: 9,
                                          background: C.red, color: C.white, border: `1.5px solid ${C.white}`, cursor: "pointer",
                                          fontSize: 11, fontWeight: 800, lineHeight: 1, padding: 0,
                                          display: "flex", alignItems: "center", justifyContent: "center" }}>
                                        ×
                                      </button>
                                    )}
                                  </div>
                                ))}
                              </div>
                              {frontMissing && (
                                <div style={{ fontSize: 11, color: C.red, marginTop: 8, fontWeight: 600 }}>
                                  Missing: {frontImageField.label}
                                </div>
                              )}
                              {addPickerFor === i && (
                                <div style={{ marginTop: 10, padding: 10, borderRadius: 8,
                                  background: C.gray50, border: `1px solid ${C.border}` }}>
                                  <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
                                    <span style={{ fontSize: 11, color: C.gray500, fontWeight: 600 }}>
                                      Pick a photo to add to this row
                                    </span>
                                    <button onClick={() => setAddPickerFor(null)}
                                      style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: C.gray400, fontSize: 14 }}>
                                      ×
                                    </button>
                                  </div>
                                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                    {imageUrls.map((u, pi) => (
                                      <img key={pi} src={u} alt="" onClick={() => addRowImage(i, u)}
                                        onError={(e) => { e.target.style.opacity = 0.15; }}
                                        style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6,
                                          border: `1px solid ${C.border}`, cursor: "pointer" }} />
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>

                            {sharedFields.length > 0 && (() => {
                              const overrideCount = Object.keys(row.overrides || {}).length;
                              const overrideErrs = rowOverrideErrors[i] || [];
                              const isOverrideOpen = expandedOverrides.has(i);
                              return (
                                <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                    <button onClick={() => setExpandedOverrides((prev) => {
                                      const next = new Set(prev);
                                      next.has(i) ? next.delete(i) : next.add(i);
                                      return next;
                                    })} style={btn("secondary", "sm")}>
                                      {isOverrideOpen ? "Done editing" : `Edit this row's details${overrideCount ? ` (${overrideCount} overridden)` : ""}`}
                                    </button>
                                    {overrideCount > 0 && (
                                      <button onClick={() => resetRowOverrides(i)} style={btn("ghost", "sm")}>
                                        Reset to shared defaults
                                      </button>
                                    )}
                                  </div>
                                  {overrideErrs.length > 0 && (
                                    <div style={{ fontSize: 11, color: C.red, marginTop: 8, fontWeight: 600 }}>
                                      Missing/invalid: {overrideErrs.join(", ")}
                                    </div>
                                  )}
                                  {isOverrideOpen && (
                                    <div style={{ marginTop: 10 }}>
                                      <div style={{ fontSize: 11, color: C.gray400, marginBottom: 8 }}>
                                        Starts from the shared Product Details values above — change
                                        anything here to override it just for this row.
                                      </div>
                                      <FieldGrid>
                                        {sharedFields.map((f) => (
                                          <Field key={f.key} def={f}
                                            value={row.overrides?.[f.key] ?? shared[f.key]}
                                            onChange={setRowOverride(i, f.key)} />
                                        ))}
                                      </FieldGrid>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </Section>

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button onClick={generate} disabled={busy || rowCount === 0} style={btn("primary", "lg")}>
                  {busy
                    ? "Generating…"
                    : <><DownloadIcon style={{ fontSize: 17, verticalAlign: "-3px" }} />&nbsp;Generate &amp; download sheet</>}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
