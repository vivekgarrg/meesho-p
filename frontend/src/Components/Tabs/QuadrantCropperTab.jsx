import React, { useRef, useState, useCallback, useEffect } from "react";
import JSZip from "jszip";
import { API, C, S, btn, useIsMobile } from "../../App";
import {
  ParentPicker, emptyParentChoice, parentChoicePayload, parentChoiceReady, suggestParentId,
} from "../shared/ParentPicker";

/**
 * Splits a 2×2 grid product photo — the format Meesho listing sets get
 * exported in — into four individual images.
 *
 * Everything happens in the browser (canvas crop, zip packaging); no upload,
 * no backend call. The one thing sellers kept tripping on with a plain
 * "save each crop" flow was the browser prompting for a save location four
 * times per image, scattering crops across whatever folder happened to be
 * picked each time — so the only download path here is a single zip with
 * every crop flat at its root, whether that's 4 images or 40.
 *
 * One product name covers the whole batch: a listing set is photos OF ONE
 * PRODUCT, so naming each grid image separately was asking for the same name
 * to be typed four times and spelled three ways. The crops are numbered
 * straight through the batch — "<product>-1.jpg" … "-12.jpg" for three grids —
 * and the zip itself takes the product name, so what lands in Downloads says
 * which product it is without being opened.
 */

const MAX_DIM = 6000; // sanity cap so a bad file can't wedge the canvas

/**
 * The item name as typed, made safe to use as a filename: only characters no
 * OS allows in a name are dropped, so spaces and casing survive as entered.
 */
function itemFileBase(name) {
  return (name || "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "");
}

function extFor(mime) {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

function canvasToBlob(canvas, mime) {
  return new Promise((resolve) => canvas.toBlob(resolve, mime, 0.95));
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read " + file.name));
    };
    img.src = url;
  });
}

function buildQuads(img, splitX, splitY) {
  const w = Math.min(img.naturalWidth, MAX_DIM);
  const h = Math.min(img.naturalHeight, MAX_DIM);
  const sx = Math.round(w * splitX);
  const sy = Math.round(h * splitY);
  const boxes = [
    { key: "tl", label: "Top left", x: 0, y: 0, w: sx, h: sy },
    { key: "tr", label: "Top right", x: sx, y: 0, w: w - sx, h: sy },
    { key: "bl", label: "Bottom left", x: 0, y: sy, w: sx, h: h - sy },
    { key: "br", label: "Bottom right", x: sx, y: sy, w: w - sx, h: h - sy },
  ];
  return boxes.map((box) => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, box.w);
    canvas.height = Math.max(1, box.h);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
    return { ...box, canvas, dataUrl: canvas.toDataURL("image/jpeg", 0.85) };
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Flat, collision-safe filenames — everything lands in one folder once unzipped.
 *  Crops are numbered straight through the batch, so the suffix path here is
 *  only a backstop against a name that somehow repeats. */
function uniqueName(used, base, ext) {
  let name = `${base}.${ext}`;
  let n = 2;
  while (used.has(name)) {
    name = `${base}-${n}.${ext}`;
    n += 1;
  }
  used.add(name);
  return name;
}

/** Hex SHA-256 of a blob — lets the server recognise a crop it already has
 *  and hand back the existing image rather than storing a second copy.
 *  crypto.subtle exists only on https or localhost; anything else (the app
 *  opened over a plain-http LAN address) gets a clear error instead. */
async function sha256Hex(blob) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("This browser can't hash images here — open the app over https (or localhost) to upload.");
  }
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Run `fn` over `items`, at most `limit` at a time. A whole batch fired at
 *  once can stall a slow connection; one at a time wastes a fast one. */
async function runPool(items, limit, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

/**
 * "Which parent SKU are these photos for?" — asked at download time, because
 * that is when the answer is known: the whole batch is one product's photos.
 * Choose an existing parent or create one by name; price, tax and packaging
 * are left for SKU Pricing, not asked for here.
 */
/**
 * "Which parent SKU are these for?" — asked at download time, because that is
 * when the answer is known: the whole batch is one product's photos. The
 * picker itself is shared with Bulk Listing (shared/ParentPicker), so both
 * ask it the same way and both require pricing for a new parent.
 */
function ParentPickerDialog({ productName, onCancel, onConfirm, onDownloadOnly, busy, error }) {
  const [choice, setChoice] = useState(() => emptyParentChoice(suggestParentId(productName)));
  const ready = parentChoiceReady(choice);

  return (
    <div onClick={busy ? undefined : onCancel}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", zIndex: 1300,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ ...S.card, width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: C.gray800 }}>Which parent SKU are these for?</div>
        <div style={{ fontSize: 12, color: C.gray500, marginTop: 4, marginBottom: 14, lineHeight: 1.6 }}>
          The photos upload in the background and get linked to this parent, so they show up
          on its card in SKU Pricing. Your zip downloads straight away either way.
        </div>

        <ParentPicker value={choice} onChange={setChoice} />

        {error && (
          <div style={{ marginTop: 12, padding: "8px 11px", borderRadius: 8, fontSize: 12,
            color: C.red, background: C.redLight, border: `1px solid ${C.redBorder}` }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 18, flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={onCancel} disabled={busy} style={btn("ghost", "sm")}>Cancel</button>
          <button onClick={onDownloadOnly} disabled={busy} style={btn("ghost", "sm")}
            title="Just the zip — nothing uploaded or linked">
            Download only
          </button>
          <button
            onClick={() => onConfirm(parentChoicePayload(choice))}
            disabled={busy || !ready}
            style={{ ...btn("primary", "sm"), marginLeft: "auto", ...(!ready ? { opacity: 0.5 } : {}) }}>
            {busy ? "Preparing…" : "Upload & download"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The background upload's status. Stays put after the upload ends — a
 *  toast that fades is no use for something you have stopped watching. */
function UploadTray({ tray, onRetry, onDismiss }) {
  const pct = tray.total ? Math.round(((tray.done + tray.failed) / tray.total) * 100) : 0;
  const tone = tray.active ? C.amber : tray.failed ? C.red : C.green;
  return (
    <div style={{ ...S.card, padding: 14, borderLeft: `4px solid ${tone}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.gray800, flex: 1, minWidth: 200 }}>
          {tray.active ? (
            <>Uploading {tray.total} image{tray.total === 1 ? "" : "s"} to <code>{tray.parent}</code>…</>
          ) : tray.failed ? (
            <>{tray.done} of {tray.total} linked to <code>{tray.parent}</code> — {tray.failed} didn't upload</>
          ) : (
            <>✓ {tray.done} image{tray.done === 1 ? "" : "s"} linked to <code>{tray.parent}</code>
              {tray.folder && <span style={{ fontWeight: 600, color: C.gray500 }}> · folder <code>{tray.folder}</code></span>}</>
          )}
          {tray.created && !tray.active && (
            <span style={{ fontSize: 11.5, color: C.gray500, fontWeight: 600 }}> · new parent — set its price in SKU Pricing</span>
          )}
        </div>
        {!tray.active && tray.failed > 0 && (
          <button onClick={onRetry} style={btn("primary", "sm")}>Retry {tray.failed}</button>
        )}
        {!tray.active && (
          <button onClick={onDismiss} style={btn("ghost", "sm")}>Dismiss</button>
        )}
      </div>
      {tray.active && (
        <div style={{ height: 5, background: C.gray100, borderRadius: 99, marginTop: 10, overflow: "hidden" }}>
          <div style={{ width: `${Math.max(pct, 6)}%`, height: "100%", background: tone,
            transition: "width 0.3s" }} />
        </div>
      )}
      {!tray.active && tray.failed > 0 && (
        <div style={{ fontSize: 11.5, color: C.gray500, marginTop: 6, lineHeight: 1.6 }}>
          {tray.reason && (
            <div style={{ color: C.red, fontWeight: 700, marginBottom: 3 }}>Why: {tray.reason}</div>
          )}
          Those photos are still below, marked "not uploaded". Nothing was linked for them, so no
          listing can end up pointing at a missing image.
        </div>
      )}
    </div>
  );
}

/**
 * Whether uploads are working, always visible at the top — so "is storage
 * set up?" never has to be answered by cropping something and watching it
 * fail. "Test connection" runs a real round trip on the server (write, read
 * back over the public domain, delete) and shows each step.
 */
function StorageStatus({ storage, onRecheck }) {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState(null);

  const runCheck = async () => {
    setChecking(true);
    setResult(null);
    try {
      const r = await fetch(`${API}/listing-images/check/`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.detail || d.error || `HTTP ${r.status}`);
      setResult(d);
    } catch (err) {
      setResult({ ok: false, steps: [{ step: "request", ok: false, detail: err.message }] });
    } finally {
      setChecking(false);
      onRecheck();
    }
  };

  if (!storage.loaded) {
    return <div style={{ fontSize: 12, color: C.gray400 }}>Checking image storage…</div>;
  }

  const tone = storage.enabled ? C.green : storage.problem ? C.red : C.gray400;
  const label = storage.enabled
    ? <>Uploads <b>on</b> — images go to <code>{storage.publicBase}</code></>
    : storage.problem
      ? <>Uploads <b>off</b> — storage is set up but can't work</>
      : <>Uploads <b>off</b> — storage isn't configured, so Download just saves a zip</>;

  return (
    <div style={{ ...S.card, padding: "10px 14px", borderLeft: `4px solid ${tone}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: tone, flexShrink: 0 }} />
        <span style={{ fontSize: 12.5, color: C.gray700, flex: 1, minWidth: 220 }}>{label}</span>
        <button onClick={runCheck} disabled={checking} style={btn("ghost", "sm")}>
          {checking ? "Testing…" : "Test connection"}
        </button>
      </div>
      {storage.problem && (
        <div style={{ fontSize: 11.5, color: C.red, marginTop: 7, lineHeight: 1.6 }}>{storage.problem}</div>
      )}
      {result && (
        <div style={{ marginTop: 9, borderTop: `1px solid ${C.gray100}`, paddingTop: 8 }}>
          {result.steps.map((st) => (
            <div key={st.step} style={{ display: "flex", gap: 8, fontSize: 11.5, lineHeight: 1.7 }}>
              <span style={{ color: st.ok ? C.green : C.red, fontWeight: 800, width: 14 }}>{st.ok ? "✓" : "✗"}</span>
              <span style={{ fontWeight: 700, color: C.gray700, minWidth: 82 }}>{st.step}</span>
              <span style={{ color: st.ok ? C.gray500 : C.red, wordBreak: "break-all" }}>{st.detail}</span>
            </div>
          ))}
          <div style={{ fontSize: 12, fontWeight: 800, marginTop: 4, color: result.ok ? C.green : C.red }}>
            {result.ok ? "Storage is working end to end." : "Storage isn't working yet — fix the step marked ✗."}
          </div>
        </div>
      )}
    </div>
  );
}

let jobSeq = 0;

export function QuadrantCropperTab() {
  const isMobile = useIsMobile();
  const [jobs, setJobs] = useState([]);
  // One name for every photo in the batch — see the note at the top of the file.
  const [productName, setProductName] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [status, setStatus] = useState(null);
  // Upload to R2 + link to a parent. `storageEnabled` is false until the
  // server says object storage is configured — then Download simply zips,
  // exactly as before.
  const [storageEnabled, setStorageEnabled] = useState(false);
  // { loaded, enabled, problem, publicBase } — shown at the top of the page,
  // so whether uploads are working is visible before anything is cropped.
  const [storage, setStorage] = useState({ loaded: false });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  // { parent, total, done, failed, active } for the background upload tray.
  const [tray, setTray] = useState(null);
  // `${jobId}:${quadIndex}` -> "uploading" | "failed", for each card's badge.
  const [cropState, setCropState] = useState({});
  // The parent the last batch went to, so Retry doesn't ask again.
  const lastParentRef = useRef(null);

  const loadStorage = useCallback(() => {
    fetch(`${API}/listing-images/config/`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.detail || d.error || `HTTP ${r.status}`);
        return d;
      })
      .then((d) => {
        setStorageEnabled(!!d.enabled);
        setStorage({ loaded: true, enabled: !!d.enabled, problem: d.problem || "", publicBase: d.public_base_url || "" });
      })
      .catch((err) => {
        setStorageEnabled(false);
        setStorage({ loaded: true, enabled: false, problem: `Couldn't ask the server about storage: ${err.message}` });
      });
  }, []);

  useEffect(() => { loadStorage(); }, [loadStorage]);

  // Closing the tab kills an upload in flight. The browser's own "leave
  // site?" prompt is the only warning that survives a close.
  useEffect(() => {
    if (!tray?.active) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [tray?.active]);
  const fileInputRef = useRef(null);
  const dragStateRef = useRef(null);

  const addFiles = useCallback(async (fileList) => {
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    const loaded = [];
    for (const file of files) {
      try {
        const { img, url } = await loadImage(file);
        const job = {
          id: ++jobSeq,
          filename: file.name || `image-${jobSeq}.jpg`,
          mime: file.type === "image/png" ? "image/png" : "image/jpeg",
          objectUrl: url,
          img,
          splitX: 0.5,
          splitY: 0.5,
        };
        job.quads = buildQuads(img, job.splitX, job.splitY);
        loaded.push(job);
      } catch {
        // skip unreadable file
      }
    }
    setJobs((prev) => [...prev, ...loaded]);
    setStatus(null);
  }, []);

  const updateSplit = (jobId, splitX, splitY) => {
    setJobs((prev) =>
      prev.map((j) => {
        if (j.id !== jobId) return j;
        const next = { ...j, splitX, splitY };
        next.quads = buildQuads(j.img, splitX, splitY);
        return next;
      })
    );
  };

  const nameBase = itemFileBase(productName);
  const nameMissing = !nameBase;

  const removeJob = (jobId) => {
    setJobs((prev) => {
      const job = prev.find((j) => j.id === jobId);
      if (job) URL.revokeObjectURL(job.objectUrl);
      return prev.filter((j) => j.id !== jobId);
    });
  };

  const clearAll = () => {
    jobs.forEach((j) => URL.revokeObjectURL(j.objectUrl));
    setJobs([]);
    setStatus(null);
    // The name belongs to the batch, so it goes with the batch.
    setProductName("");
  };

  /** Every crop in batch order, as encoded blobs — the one list both the zip
   *  and the upload are built from, so they can never disagree. */
  const collectCrops = async (onlyJobs) => {
    const crops = [];
    for (const job of onlyJobs || jobs) {
      for (const [quadIndex, quad] of job.quads.entries()) {
        const blob = await canvasToBlob(quad.canvas, job.mime);
        if (blob) crops.push({ jobId: job.id, quadIndex, blob, mime: job.mime, ext: extFor(job.mime) });
      }
    }
    return crops;
  };

  /** Zip and download. `nameFor(crop, i)` gives each file its base name. */
  const downloadZip = async (crops, nameFor, zipName = `${nameBase}.zip`) => {
    const zip = new JSZip();
    const used = new Set();
    crops.forEach((crop, i) => zip.file(uniqueName(used, nameFor(crop, i), crop.ext), crop.blob));
    const zipBlob = await zip.generateAsync({ type: "blob" });
    downloadBlob(zipBlob, zipName);
    return used.size;
  };

  const requireName = () => {
    if (!jobs.length) return false;
    if (nameMissing) {
      setStatus({ kind: "err", text: "Enter the product name before downloading — the files and the zip are named after it." });
      return false;
    }
    return true;
  };

  // Download without uploading: numbered straight through the batch rather
  // than restarting per image, so three grids give "<product>-1" … "-12".
  const downloadOnly = async () => {
    if (!requireName()) return;
    setPickerOpen(false);
    setZipping(true);
    setStatus(null);
    try {
      const crops = await collectCrops();
      const n = await downloadZip(crops, (_c, i) => `${nameBase}-${i + 1}`);
      setStatus({ kind: "ok", text: `Saved ${n} images in one zip — ${nameBase}.zip` });
    } catch (err) {
      setStatus({ kind: "err", text: "Could not build the zip: " + (err?.message || "unknown error") });
    } finally {
      setZipping(false);
    }
  };

  const onDownloadClick = () => {
    if (!requireName()) return;
    if (storageEnabled) setPickerOpen(true);
    else downloadOnly();
  };

  /**
   * Upload this batch to R2 and link it to a parent.
   *
   * Numbers first: presign allocates every image its permanent number, so
   * the zip is named with the same numbers the images carry everywhere else
   * (`<product>-1042.jpg`). Then the zip downloads at once and the uploads
   * run in the background.
   *
   * A grid photo disappears from the cropper only when all four of its crops
   * are confirmed in the bucket — never before. A crop that fails keeps its
   * card on screen with Retry, so nothing can end up linked to a parent
   * through a url that 404s inside a Meesho listing.
   */
  const uploadBatch = async ({ parentId, create, pricing, jobsToSend, withZip }) => {
    setStatus(null);
    const sending = jobsToSend || jobs;
    let crops, presign;
    try {
      crops = await collectCrops(sending);
      const hashes = await Promise.all(crops.map((c) => sha256Hex(c.blob)));
      const res = await fetch(`${API}/listing-images/presign/`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parent_id: parentId, create_parent: create, product_name: productName.trim(),
          ...(create && pricing ? pricing : {}),
          files: crops.map((c, i) => ({ sha256: hashes[i], content_type: c.mime, bytes: c.blob.size })),
        }),
      });
      presign = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(presign.error || `upload could not start (${res.status})`);
    } catch (err) {
      // Returned, not just shown on the page: the dialog is still open on top
      // of the page, so a message set behind it would never be seen.
      return { ok: false, error: `${err.message} — nothing was uploaded or created.` };
    }

    const results = presign.results || [];
    const parentName = presign.parent?.item_id || parentId;
    lastParentRef.current = parentName;

    // The zip carries the bucket folder's name, and its files the same names
    // as the objects in it — so what's in Downloads and what's in R2 match.
    const folder = presign.folder || nameBase;
    const fileBase = presign.file_base || nameBase;
    if (withZip) {
      try {
        await downloadZip(crops, (_c, i) => `${fileBase}-${results[i].image_no}`, `${folder}.zip`);
      } catch (err) {
        setStatus({ kind: "err", text: "Could not build the zip: " + (err?.message || "unknown error") });
      }
    }

    // ── background part ─────────────────────────────────────────────────
    const keyOf = (c) => `${c.jobId}:${c.quadIndex}`;
    setCropState((st) => {
      const next = { ...st };
      crops.forEach((c) => { next[keyOf(c)] = "uploading"; });
      return next;
    });
    setTray({ parent: parentName, created: !!presign.parent?.created, total: crops.length,
      folder, done: 0, failed: 0, active: true });

    // One PUT per distinct image: a crop repeated in the batch shares an id.
    const toPut = [];
    const seenIds = new Set();
    results.forEach((r, i) => {
      if (r.needs_upload && !seenIds.has(r.id)) { seenIds.add(r.id); toPut.push({ r, crop: crops[i] }); }
    });
    const putOk = new Set();
    const reasons = [];
    await runPool(toPut, 3, async ({ r, crop }) => {
      try {
        const put = await fetch(r.put_url, {
          method: "PUT", headers: { "Content-Type": crop.mime }, body: crop.blob,
        });
        if (put.ok) putOk.add(r.id);
        else reasons.push(`storage refused the upload (HTTP ${put.status}) — use "Test connection" above`);
      } catch {
        // fetch() throws — rather than returning a status — when the browser
        // blocks the request, which for a direct-to-bucket PUT is nearly
        // always the bucket's CORS policy not listing this page's origin.
        reasons.push(`the browser blocked the upload — the bucket's CORS policy must allow ${window.location.origin}`);
      }
    });

    // Anything already uploaded before this batch counts as done; everything
    // else only counts once the server has seen it in the bucket.
    const confirmed = new Set(
      results.filter((r) => r.duplicate && !r.needs_upload && r.status === "uploaded").map((r) => r.id)
    );
    if (putOk.size) {
      try {
        const c = await fetch(`${API}/listing-images/confirm/`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [...putOk] }),
        });
        const d = await c.json().catch(() => ({}));
        (d.confirmed || []).forEach((id) => confirmed.add(id));
        (d.failed || []).forEach((f) => f.reason && reasons.push(f.reason));
      } catch {
        reasons.push("couldn't reach the server to confirm the uploads");
      }
    }

    const doneCrops = crops.filter((c, i) => confirmed.has(results[i].id));
    const failedCrops = crops.filter((c, i) => !confirmed.has(results[i].id));

    // A grid photo leaves the cropper only when every one of its crops made it.
    const failedJobs = new Set(failedCrops.map((c) => c.jobId));
    const finishedJobs = new Set(sending.map((j) => j.id).filter((id) => !failedJobs.has(id)));
    setJobs((prev) => {
      prev.filter((j) => finishedJobs.has(j.id)).forEach((j) => URL.revokeObjectURL(j.objectUrl));
      const left = prev.filter((j) => !finishedJobs.has(j.id));
      if (left.length === 0) setProductName("");
      return left;
    });
    setCropState((st) => {
      const next = { ...st };
      doneCrops.forEach((c) => { delete next[keyOf(c)]; });
      failedCrops.forEach((c) => { next[keyOf(c)] = "failed"; });
      return next;
    });
    // The most common reason first: one cause (bad key, CORS) usually fails
    // the whole batch, and saying it once beats a list of twelve.
    const counts = reasons.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map());
    const topReason = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    setTray((t) => ({ ...t, done: doneCrops.length, failed: failedCrops.length, active: false,
      reason: failedCrops.length ? topReason : "" }));
    return { ok: true };
  };

  const [pickerError, setPickerError] = useState("");

  const confirmParent = async (choice) => {
    setPreparing(true);
    setPickerError("");
    const { parent_id: parentId, create, ...pricing } = choice;
    const result = await uploadBatch({ parentId, create, pricing: create ? pricing : null, withZip: true });
    setPreparing(false);
    if (result.ok) setPickerOpen(false);
    else setPickerError(result.error);
  };

  // Retry only the photos still on screen — they are exactly the ones that
  // didn't fully make it. Already-uploaded crops among them come back as
  // duplicates, so nothing is stored twice and no numbers are burned.
  const retryFailed = () => {
    const pendingJobs = jobs.filter((j) => j.quads.some((_q, i) => cropState[`${j.id}:${i}`] === "failed"));
    if (!pendingJobs.length || !lastParentRef.current) return;
    uploadBatch({ parentId: lastParentRef.current, create: false, jobsToSend: pendingJobs, withZip: false })
      .then((result) => {
        // No dialog is open on a retry, so the page is the place to say it.
        if (!result.ok) setStatus({ kind: "err", text: result.error });
      });
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  };

  // ── Crosshair drag handling ──────────────────────────────────────────────
  const onHandlePointerDown = (job) => (e) => {
    e.preventDefault();
    const frame = e.currentTarget.parentElement;
    dragStateRef.current = { jobId: job.id, frame };
    const move = (ev) => {
      const state = dragStateRef.current;
      if (!state) return;
      const rect = state.frame.getBoundingClientRect();
      const point = ev.touches ? ev.touches[0] : ev;
      let x = (point.clientX - rect.left) / rect.width;
      let y = (point.clientY - rect.top) / rect.height;
      x = Math.min(0.92, Math.max(0.08, x));
      y = Math.min(0.92, Math.max(0.08, y));
      updateSplit(state.jobId, x, y);
    };
    const up = () => {
      dragStateRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ fontSize: 20 }}>✂️</span>
          <h1 style={{ fontSize: isMobile ? 17 : 19, fontWeight: 800, color: C.gray800 }}>Quadrant Cropper</h1>
        </div>
        <p style={{ fontSize: 12, color: C.gray400, marginTop: 3, maxWidth: 640 }}>
          Drop 2×2 grid photos and get back four individual images each — drag the crosshair if a
          grid isn't split dead-center. Name the product once: every crop and the zip itself are
          named after it. Everything downloads as one zip, never as separate save prompts.
        </p>
      </div>

      <StorageStatus storage={storage} onRecheck={loadStorage} />

      <div
        style={{
          ...S.card,
          padding: isMobile ? 18 : 26,
          border: `1.5px dashed ${dragOver ? C.orange : C.gray200}`,
          background: dragOver ? C.orangeLight : C.white,
          textAlign: "center",
          cursor: "pointer",
          transition: "border-color 0.15s, background 0.15s",
        }}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <div style={{ fontSize: 14, fontWeight: 700, color: C.gray700 }}>Drop images here, or click to browse</div>
        <div style={{ fontSize: 12, color: C.gray400, marginTop: 4 }}>PNG or JPG · each one gets split into four</div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {/* Outside the jobs block on purpose: a fully successful upload removes
          every photo, and the "linked to X" confirmation has to outlive them. */}
      {tray && <UploadTray tray={tray} onRetry={retryFailed} onDismiss={() => setTray(null)} />}

      {jobs.length > 0 && (
        <>
          {/* One product name for the whole batch — the files and the zip both
              take it, so it sits here with the download rather than on each
              image. */}
          <div style={{ ...S.card, padding: isMobile ? 14 : 18, border: `1.5px solid ${nameMissing ? C.redBorder : C.border}` }}>
            <label htmlFor="qc-product-name" style={{ display: "block", fontSize: 12, fontWeight: 700, color: C.gray700, marginBottom: 5 }}>
              Product name <span style={{ color: C.red }}>*</span>
            </label>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <input
                id="qc-product-name"
                type="text"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !nameMissing && !zipping && !tray?.active) onDownloadClick(); }}
                placeholder="e.g. Brass Pooja Plate 6 inch"
                autoFocus
                style={{
                  flex: "1 1 320px",
                  maxWidth: 460,
                  boxSizing: "border-box",
                  padding: "9px 11px",
                  fontSize: 13,
                  borderRadius: 8,
                  border: `1.5px solid ${nameMissing ? C.red : C.border}`,
                  outline: "none",
                }}
              />
              <button onClick={clearAll} style={btn("ghost", "sm")}>
                Clear all
              </button>
              <button
                onClick={onDownloadClick}
                disabled={zipping || nameMissing || !!tray?.active}
                title={nameMissing ? "Enter the product name first"
                  : tray?.active ? "Wait for the current upload to finish" : undefined}
                style={{ ...btn("primary", "sm"), ...(nameMissing || tray?.active ? { opacity: 0.5, cursor: "not-allowed" } : {}) }}
              >
                {zipping ? "Zipping…" : `Download all ${jobs.length * 4} as one zip`}
              </button>
            </div>
            <div style={{ fontSize: 11.5, marginTop: 6, color: nameMissing ? C.red : C.gray400 }}>
              {nameMissing ? (
                "Required — every crop and the zip are named after this."
              ) : (
                <>
                  {jobs.length} image{jobs.length === 1 ? "" : "s"} · {jobs.length * 4} crops →{" "}
                  <span style={{ fontFamily: "monospace", color: C.gray600 }}>{nameBase}-1.{extFor(jobs[0].mime)}</span>
                  {" … "}
                  <span style={{ fontFamily: "monospace", color: C.gray600 }}>{nameBase}-{jobs.length * 4}.{extFor(jobs[jobs.length - 1].mime)}</span>
                  {" inside "}
                  <span style={{ fontFamily: "monospace", color: C.gray600 }}>{nameBase}.zip</span>
                </>
              )}
            </div>
          </div>

          {status && (
            <div
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                color: status.kind === "ok" ? C.green : C.red,
              }}
            >
              {status.text}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {jobs.map((job) => (
              <div key={job.id} style={{ ...S.card, padding: isMobile ? 14 : 18 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 10,
                    marginBottom: 12,
                    paddingBottom: 10,
                    borderBottom: `1px solid ${C.gray100}`,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.gray800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {job.filename}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    {(() => {
                      const states = [0, 1, 2, 3].map((i) => cropState[`${job.id}:${i}`]);
                      const failed = states.filter((x) => x === "failed").length;
                      const uploading = states.filter((x) => x === "uploading").length;
                      if (failed) return (
                        <span style={{ fontSize: 11, fontWeight: 700, color: C.red, whiteSpace: "nowrap" }}>
                          {failed} of 4 not uploaded
                        </span>
                      );
                      if (uploading) return (
                        <span style={{ fontSize: 11, fontWeight: 700, color: C.amber, whiteSpace: "nowrap" }}>
                          uploading…
                        </span>
                      );
                      return null;
                    })()}
                    <span style={{ fontSize: 11, color: C.gray400, fontFamily: "monospace", whiteSpace: "nowrap" }}>
                      {job.img.naturalWidth} × {job.img.naturalHeight}px
                    </span>
                    <button onClick={() => removeJob(job.id)} style={{ ...btn("ghost", "sm"), color: C.red, borderColor: C.redBorder, padding: "4px 10px" }}>
                      Remove
                    </button>
                  </div>
                </div>

                {/* No name field here any more — one product name covers the
                    batch. This just says which of its numbers come from this
                    image, so a crop can be traced back to its grid. */}
                {!nameMissing && (() => {
                  const start = jobs.slice(0, jobs.findIndex((j) => j.id === job.id)).length * 4 + 1;
                  const ext = extFor(job.mime);
                  return (
                    <div style={{ fontSize: 11.5, color: C.gray400, marginBottom: 14 }}>
                      This image →{" "}
                      <span style={{ fontFamily: "monospace", color: C.gray600 }}>{nameBase}-{start}.{ext}</span>
                      {" … "}
                      <span style={{ fontFamily: "monospace", color: C.gray600 }}>{nameBase}-{start + 3}.{ext}</span>
                    </div>
                  );
                })()}

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: isMobile ? "1fr" : "minmax(0,1fr) minmax(0,1fr)",
                    gap: 16,
                  }}
                >
                  {/* Source with draggable crosshair */}
                  <div>
                    <div
                      style={{
                        position: "relative",
                        borderRadius: 10,
                        overflow: "hidden",
                        background: C.gray50,
                        border: `1px solid ${C.border}`,
                        touchAction: "none",
                      }}
                    >
                      <img src={job.objectUrl} alt={job.filename} draggable={false} style={{ display: "block", width: "100%", height: "auto" }} />
                      <div style={{ position: "absolute", top: 0, bottom: 0, left: `${job.splitX * 100}%`, width: 2, marginLeft: -1, background: "#FF4433", pointerEvents: "none" }} />
                      <div style={{ position: "absolute", left: 0, right: 0, top: `${job.splitY * 100}%`, height: 2, marginTop: -1, background: "#FF4433", pointerEvents: "none" }} />
                      <div
                        onPointerDown={onHandlePointerDown(job)}
                        style={{
                          position: "absolute",
                          left: `${job.splitX * 100}%`,
                          top: `${job.splitY * 100}%`,
                          width: 18,
                          height: 18,
                          borderRadius: "50%",
                          background: "#FF4433",
                          border: "2px solid #fff",
                          boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
                          transform: "translate(-50%, -50%)",
                          cursor: "grab",
                        }}
                        title="Drag to adjust the split"
                      />
                    </div>
                    <div style={{ fontSize: 11, color: C.gray400, marginTop: 6 }}>
                      Drag the dot to line up the split with the image gutters.
                    </div>
                  </div>

                  {/* Quadrant previews */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                    {job.quads.map((q, i) => (
                      <div
                        key={q.key}
                        style={{
                          position: "relative",
                          aspectRatio: "1 / 1",
                          borderRadius: 8,
                          overflow: "hidden",
                          background: C.gray50,
                          border: `1px solid ${C.border}`,
                        }}
                      >
                        <img src={q.dataUrl} alt={`${job.filename} — ${q.label}`} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
                        <span
                          style={{
                            position: "absolute",
                            top: 5,
                            left: 5,
                            fontSize: 10,
                            fontFamily: "monospace",
                            background: "rgba(20,20,20,0.62)",
                            color: "#fff",
                            padding: "2px 6px",
                            borderRadius: 5,
                          }}
                        >
                          {i + 1} · {q.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {pickerOpen && (
        <ParentPickerDialog
          productName={productName}
          busy={preparing}
          error={pickerError}
          onCancel={() => { setPickerOpen(false); setPickerError(""); }}
          onDownloadOnly={downloadOnly}
          onConfirm={confirmParent}
        />
      )}
    </div>
  );
}
