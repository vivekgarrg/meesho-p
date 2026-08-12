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
 */

const MODES = [
  { id: "new", label: "New Sheet", hint: "Paste your own photo links" },
  { id: "prefilled", label: "Prefilled Sheet", hint: "Upload a sheet that already has one photo per row" },
];

// Categories carry however many image columns they carry — four in some, well
// over a dozen in others — so image roles are matched by shape, not listed.
const FIXED_PER_ROW_ROLES = new Set(["title", "sku", "style"]);
const isPerRowRole = (role) => FIXED_PER_ROW_ROLES.has(role) || /^image_\d+$/.test(role || "");

function parseImageUrls(text) {
  return (text || "").split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
}

function emptyRow() {
  return { title: "", sku: "", style: "" };
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
  return (
    <div style={wide ? { gridColumn: "1 / -1" } : undefined}>
      <label style={S.label}>{def.label}{def.required ? " *" : ""}</label>
      {def.type === "select" ? (
        <select value={value ?? ""} onChange={(e) => onChange(e.target.value)} style={S.inp}>
          <option value="">—</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : def.type === "textarea" ? (
        <textarea value={value ?? ""} onChange={(e) => onChange(e.target.value)} rows={2}
          style={{ ...S.inp, resize: "vertical" }} />
      ) : (
        <input value={value ?? ""} onChange={(e) => onChange(e.target.value)}
          type={def.type === "number" ? "number" : "text"} step="0.01" style={S.inp} />
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
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const switchMode = (id) => {
    if (id === mode) return;
    setMode(id);
    resetFlow();
  };

  const parseSource = async (src) => {
    setParsing(true);
    setMsg(null);
    try {
      const fd = new FormData();
      if (src.type === "file") fd.append("file", src.file);
      else fd.append("built_in", src.key);
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

  // The row inputs always track however many photos are in play — the
  // photos given *are* the rows (see bulk_listing.plan_images).
  useEffect(() => {
    setRows((rs) => {
      const n = imageUrls.length;
      if (n === rs.length) return rs;
      if (n < rs.length) return rs.slice(0, n);
      return [...rs, ...Array.from({ length: n - rs.length }, emptyRow)];
    });
  }, [imageUrls.length]);

  // How many photo columns this category actually has.
  const imageSlotCount = useMemo(
    () => (spec ? spec.fields.filter((f) => /^image_\d+$/.test(f.role || "")).length : 0),
    [spec]
  );

  const applyPrefix = () => {
    const p = prefix.trim();
    if (!p) return;
    setRows((rs) => rs.map((r, i) => {
      const auto = `${p}-${String(i + 1).padStart(3, "0")}`;
      return { ...r, sku: auto, style: auto };
    }));
  };

  const setRow = (i, key) => (value) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [key]: value } : r)));

  const sharedFields = useMemo(
    () => (spec ? spec.fields.filter((f) => !isPerRowRole(f.role)) : []),
    [spec]
  );
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
    const payload = {
      shared,
      rows: rows.map((r) => ({ product_name: r.title, sku_id: r.sku, style_id: r.style })),
      image_urls: imageUrls,
    };
    const fd = new FormData();
    if (source.type === "file") fd.append("file", source.file);
    else fd.append("built_in", source.key);
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
                of its gallery is a random pick from every other link.
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
                image; the rest of its gallery is a random pick from the others.
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

                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {rows.map((row, i) => (
                    <div key={i} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 12,
                      display: "flex", flexDirection: isMobile ? "column" : "row", gap: 10, alignItems: isMobile ? "stretch" : "flex-end" }}>
                      <Tag variant="blue" fontSize={11}>Row {i + 1}</Tag>
                      <div style={{ flex: 2, minWidth: 160 }}>
                        <label style={S.label}>Title *</label>
                        <input value={row.title} onChange={(e) => setRow(i, "title")(e.target.value)}
                          style={S.inp} placeholder={`Unique product name for listing ${i + 1}`} />
                      </div>
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
                      {/* The order of the other photos is decided per listing when
                          the sheet is built, so there is nothing truthful to preview
                          beyond this row's own front image. */}
                      {imageUrls[i] && (
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <img src={imageUrls[i]} alt="" style={{
                            width: 30, height: 30, objectFit: "cover", borderRadius: 6,
                            border: `2px solid ${C.green}`,
                          }} title="This row's own front image" />
                          {imageUrls.length > 1 && (
                            <span style={{ fontSize: 10.5, color: C.gray400, whiteSpace: "nowrap" }}>
                              +{Math.min(imageUrls.length - 1, Math.max(imageSlotCount - 1, 0))} shuffled
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
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
    </div>
  );
}
