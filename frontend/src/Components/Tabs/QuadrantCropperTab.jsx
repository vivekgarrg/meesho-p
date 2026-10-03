import React, { useRef, useState, useCallback } from "react";
import JSZip from "jszip";
import { C, S, btn, useIsMobile } from "../../App";

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

let jobSeq = 0;

export function QuadrantCropperTab() {
  const isMobile = useIsMobile();
  const [jobs, setJobs] = useState([]);
  // One name for every photo in the batch — see the note at the top of the file.
  const [productName, setProductName] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [status, setStatus] = useState(null);
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

  const downloadAll = async () => {
    if (!jobs.length) return;
    if (nameMissing) {
      setStatus({ kind: "err", text: "Enter the product name before downloading — the files and the zip are named after it." });
      return;
    }
    setZipping(true);
    setStatus(null);
    try {
      const zip = new JSZip();
      const used = new Set();
      // Numbered straight through the batch rather than restarting per image,
      // so three grids give "<product>-1" … "-12" instead of three separate
      // runs of 1-4 that would collide on name.
      let n = 0;
      for (const job of jobs) {
        const ext = extFor(job.mime);
        for (const quad of job.quads) {
          const blob = await canvasToBlob(quad.canvas, job.mime);
          if (!blob) continue;
          n += 1;
          zip.file(uniqueName(used, `${nameBase}-${n}`, ext), blob);
        }
      }
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const zipName = `${nameBase}.zip`;
      downloadBlob(zipBlob, zipName);
      setStatus({ kind: "ok", text: `Saved ${used.size} images in one zip — ${zipName}` });
    } catch (err) {
      setStatus({ kind: "err", text: "Could not build the zip: " + (err?.message || "unknown error") });
    } finally {
      setZipping(false);
    }
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
                onKeyDown={(e) => { if (e.key === "Enter" && !nameMissing && !zipping) downloadAll(); }}
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
                onClick={downloadAll}
                disabled={zipping || nameMissing}
                title={nameMissing ? "Enter the product name first" : undefined}
                style={{ ...btn("primary", "sm"), ...(nameMissing ? { opacity: 0.5, cursor: "not-allowed" } : {}) }}
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
    </div>
  );
}
