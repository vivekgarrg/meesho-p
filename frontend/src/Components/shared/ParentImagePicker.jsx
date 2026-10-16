import React, { useEffect, useMemo, useState } from "react";
import { API, C, S } from "../../App";
import { ImageUrlPreview } from "./ImageUrlPreview";

/**
 * Every parent SKU needs a picture: a pasted image link, or an uploaded file.
 * The link is stored as-is; an upload goes to object storage through the same
 * presign → PUT → confirm flow the Quadrant Cropper uses, and the server points
 * the parent at it (set_default_parent_image).
 *
 * State lives in the caller as `{ url, file }`; use imageFields() to build the
 * request body and imageProblem() to validate before sending.
 */

export const emptyImage = () => ({ url: "", file: null });

export function imageProblem(img) {
  if (img.file) return "";
  const url = (img.url || "").trim();
  if (!url) return "Add an image link, or upload an image — every parent needs one.";
  if (!/^https?:\/\/\S+$/i.test(url)) return "The image link must start with http:// or https://.";
  return "";
}

/** Body fields for parent-prices/ and parent-from-sku/. */
export function imageFields(img) {
  return img.file
    ? { image_url: "", image_upload_pending: true }
    : { image_url: (img.url || "").trim() };
}

async function sha256Hex(blob) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("This browser can't hash images here — open the app over https (or localhost) to upload.");
  }
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Upload `file` for an existing parent. Resolves to { ok, error }. */
export async function uploadParentImage(parentId, file) {
  try {
    const sha256 = await sha256Hex(file);
    const pre = await fetch(`${API}/listing-images/presign/`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parent_id: parentId, create_parent: false, product_name: parentId,
        files: [{ sha256, content_type: file.type, bytes: file.size }],
      }),
    });
    const presign = await pre.json().catch(() => ({}));
    if (!pre.ok) return { ok: false, error: presign.error || `upload could not start (${pre.status})` };
    const r = (presign.results || [])[0];
    if (!r) return { ok: false, error: "the server returned nothing to upload" };
    if (r.needs_upload) {
      let put;
      try {
        put = await fetch(r.put_url, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      } catch {
        return { ok: false, error: `the browser blocked the upload — the bucket's CORS policy must allow ${window.location.origin}` };
      }
      if (!put.ok) return { ok: false, error: `storage refused the upload (HTTP ${put.status})` };
      const c = await fetch(`${API}/listing-images/confirm/`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [r.id] }),
      });
      const done = await c.json().catch(() => ({}));
      if (!(done.confirmed || []).includes(r.id)) {
        return { ok: false, error: (done.failed || [])[0]?.reason || "the upload didn't finish" };
      }
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || "upload failed" };
  }
}

let _storage; // one config check per page load
function useImageStorage() {
  const [state, setState] = useState(_storage ?? null);
  useEffect(() => {
    if (_storage) return;
    fetch(`${API}/listing-images/config/`)
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .catch(() => ({ enabled: false }))
      .then((cfg) => { _storage = cfg; setState(cfg); });
  }, []);
  return state;
}

export function ParentImageInput({ value, onChange, error }) {
  const storage = useImageStorage();
  const canUpload = !!storage?.enabled;
  const [mode, setMode] = useState("link");
  const preview = useMemo(() => (value.file ? URL.createObjectURL(value.file) : ""), [value.file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const tab = (id, label) => (
    <button
      type="button"
      onClick={() => { setMode(id); onChange(emptyImage()); }}
      style={{
        padding: "3px 12px", border: "none", borderRadius: 6, fontSize: 11.5, cursor: "pointer", fontFamily: "inherit",
        fontWeight: mode === id ? 800 : 600,
        background: mode === id ? C.orange : "transparent", color: mode === id ? "#fff" : C.gray500,
      }}
    >{label}</button>
  );

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <label style={{ ...S.label, margin: 0 }}>Photo * <span style={{ fontWeight: 400, textTransform: "none" }}>(link or upload)</span></label>
        <div style={{ display: "inline-flex", gap: 2, background: C.gray100, borderRadius: 8, padding: 2 }}>
          {tab("link", "Paste link")}
          {canUpload && tab("upload", "Upload")}
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        {mode === "link" ? (
          <>
            <input
              value={value.url}
              onChange={(e) => onChange({ url: e.target.value, file: null })}
              placeholder="https://images.meesho.com/images/products/…"
              style={{ ...S.inp, flex: 1, fontFamily: "monospace", ...(error ? { borderColor: C.red } : {}) }}
            />
            <ImageUrlPreview url={value.url} />
          </>
        ) : (
          <>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => onChange({ url: "", file: e.target.files?.[0] || null })}
              style={{ ...S.inp, flex: 1, ...(error ? { borderColor: C.red } : {}) }}
            />
            {preview && <img src={preview} alt="" style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6, border: `1px solid ${C.gray200}` }} />}
          </>
        )}
      </div>
      {error && <div style={{ fontSize: 10.5, color: C.red, marginTop: 3, fontWeight: 600 }}>{error}</div>}
    </div>
  );
}
