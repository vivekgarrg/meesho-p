import React, { useState, useRef, useEffect } from "react";
import { API, C, S, btn, useIsMobile } from "../../App";
import { field } from "./TeamTasksShared";
import CloseIcon from "@mui/icons-material/Close";
import VideocamIcon from "@mui/icons-material/Videocam";
import DownloadIcon from "@mui/icons-material/Download";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import WarningAmberIcon from "@mui/icons-material/WarningAmberOutlined";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";

// Headroom under Meesho's 22MB claim-video upload cap, to leave room for
// container/mux overhead so the encoder's own overshoot doesn't push us over.
const TARGET_BYTES = 21.5 * 1024 * 1024;
const MAX_RETRIES = 2;
// Not hard limits — the worker's own device, their own choice — just enough
// to warn before a WASM encode that could realistically take several minutes
// or destabilise a phone browser tab (see design notes on iOS Safari memory).
const LONG_DURATION_WARN_S = 240;
const WIDE_RESOLUTION_WARN_PX = 1920;

const SLOTS = [
  { key: "awb", label: "AWB bill" },
  { key: "packet", label: "Packet ID" },
  { key: "product", label: "Product" },
];

// How many evenly-spaced frames "Auto-detect" samples across the video —
// enough to have a real shot at catching the label/packet/product moments
// without OCR-ing every frame (each sample costs a Tesseract pass, so this
// is a real time/accuracy trade-off, not just a magic number).
const AUTO_SAMPLE_COUNT = 8;

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Grabs the frame currently shown by `video`. `requestVideoFrameCallback`
    (Safari 15.4+/Chromium) avoids a known WebKit race where `seeked` can fire
    before the new frame is actually painted — but it only fires on a *new*
    frame presentation, which a video sitting paused at its first frame (never
    played or scrubbed) may never produce. So it's raced against a short
    timeout that just captures whatever is currently on screen, rather than
    leaving the button stuck forever if the worker captures without scrubbing
    first. */
function captureFrame(video) {
  const draw = () => new Promise((resolve) => {
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.92);
  });
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; draw().then(resolve); } };
    if (video.requestVideoFrameCallback) {
      video.requestVideoFrameCallback(finish);
    }
    setTimeout(finish, 800);
  });
}

function drawCurrentFrameToCanvas(video) {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  return canvas;
}

function canvasToJpegBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92));
}

/** Seeks `video` to `time` and resolves once the browser confirms it — unlike
    `captureFrame`'s race, a programmatic seek to a genuinely different
    timestamp reliably fires `seeked`, so there's no need for a timeout guard
    here. */
function seekTo(video, time) {
  return new Promise((resolve) => {
    const onSeeked = () => { video.removeEventListener("seeked", onSeeked); resolve(); };
    video.addEventListener("seeked", onSeeked);
    video.currentTime = time;
  });
}

/**
 * The actual prep workspace: compresses a raw unboxing video to fit Meesho's
 * 22MB claim-upload cap, and captures the 3 stills Meesho asks for (AWB bill /
 * packet id / product) as frames off the same video — all client-side,
 * nothing uploaded here. AWB/packet id/product reference comes from the
 * existing `returns/lookup/` endpoint keyed on `suborderNo`, so whoever's
 * using this doesn't have to hunt for or retype what the app already knows.
 *
 * Used both inline (standalone `ClaimVideoToolTab`) and inside the modal
 * wrapper below (`ClaimVideoTool`, opened from a specific claim card) — the
 * only difference between those two call sites is where `suborderNo` comes
 * from and whether there's a `task` to feed a packet id back into.
 */
export function ClaimVideoWorkspace({ suborderNo, onPacketId }) {
  const isMobile = useIsMobile();
  const [lookup, setLookup] = useState(undefined); // undefined = loading, null = not found
  const [file, setFile] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [meta, setMeta] = useState(null); // { duration, width, height }
  const videoRef = useRef(null);

  const [shots, setShots] = useState({}); // key -> { blob, thumb, auto? }
  const [capturing, setCapturing] = useState(null);

  const [autoDetecting, setAutoDetecting] = useState(false);
  const [autoProgress, setAutoProgress] = useState(0);
  const [autoErr, setAutoErr] = useState("");

  const [compressing, setCompressing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [progress, setProgress] = useState(0);
  const [compressed, setCompressed] = useState(null); // { blob, size }
  const [compressErr, setCompressErr] = useState("");
  const ffmpegRef = useRef(null);

  useEffect(() => {
    if (!suborderNo) { setLookup(null); return; }
    let alive = true;
    setLookup(undefined);
    fetch(`${API}/returns/lookup/?q=${encodeURIComponent(suborderNo)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setLookup(d?.found ? d.matches[0] : null); })
      .catch(() => { if (alive) setLookup(null); });
    return () => { alive = false; };
  }, [suborderNo]);

  // Revoke every object URL this workspace ever created, on unmount.
  useEffect(() => () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    Object.values(shots).forEach((s) => s?.thumb && URL.revokeObjectURL(s.thumb));
    ffmpegRef.current?.terminate?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPickFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setFile(f);
    setVideoUrl(URL.createObjectURL(f));
    setMeta(null);
    setShots({});
    setCompressed(null);
    setCompressErr("");
  };

  const onLoadedMetadata = async () => {
    const v = videoRef.current;
    if (!v) return;
    let duration = v.duration;
    // Some videos (notably ones recorded via the browser's own MediaRecorder,
    // rather than a phone camera app) don't carry a real duration in their
    // container header — Chrome reports Infinity or a near-zero value until
    // forced to fully parse the file, which a seek near the end triggers.
    // Getting this wrong would silently break both the bitrate math below
    // (which divides by duration) and auto-detect's frame sampling.
    if (!Number.isFinite(duration) || duration < 0.5) {
      const seekAndWait = (t) => new Promise((resolve) => {
        const onSeeked = () => { v.removeEventListener("seeked", onSeeked); resolve(); };
        v.addEventListener("seeked", onSeeked);
        v.currentTime = t;
      });
      await seekAndWait(1e9);
      duration = v.duration;
      await seekAndWait(0);
    }
    setMeta({ duration, width: v.videoWidth, height: v.videoHeight });
  };

  const captureSlot = async (key) => {
    const v = videoRef.current;
    if (!v) return;
    setCapturing(key);
    try {
      const blob = await captureFrame(v);
      const thumb = URL.createObjectURL(blob);
      setShots((s) => {
        if (s[key]?.thumb) URL.revokeObjectURL(s[key].thumb);
        return { ...s, [key]: { blob, thumb } };
      });
    } finally {
      setCapturing(null);
    }
  };

  /**
   * Suggests the 3 frames instead of the worker scrubbing to find them —
   * samples evenly across the video, scores each frame by whether a barcode
   * decodes off it (ZXing, the same library the app's barcode scanner already
   * uses) and how much OCR-legible text it has (Tesseract.js), then picks:
   * the frame with a barcode as "packet id" (packet/AWB labels are the thing
   * in this video actually carrying a scannable code), the most text-dense
   * remaining frame as "AWB bill" (a shipping label is mostly printed text),
   * and the least text-dense of what's left as "product" (no reliable
   * positive signal for "this is the product," so this is the frame least
   * likely to be a label). Runs fully in the browser — no frame ever leaves
   * the device. Every pick still shows "Auto — check it" and can be retaken,
   * since these are heuristics on a handful of sampled frames, not a
   * trained classifier — they can and will guess wrong sometimes.
   */
  const autoDetectFrames = async () => {
    const video = videoRef.current;
    if (!video || !meta) return;
    setAutoDetecting(true);
    setAutoErr("");
    setAutoProgress(0);
    const resumeTime = video.currentTime;
    let ocrWorker = null;
    try {
      const [{ createWorker }, { BrowserMultiFormatReader }] = await Promise.all([
        import("tesseract.js"),
        import("@zxing/browser"),
      ]);
      ocrWorker = await createWorker("eng");
      const reader = new BrowserMultiFormatReader();

      const times = [];
      for (let i = 1; i <= AUTO_SAMPLE_COUNT; i++) {
        times.push((meta.duration * i) / (AUTO_SAMPLE_COUNT + 1));
      }

      const samples = [];
      for (let i = 0; i < times.length; i++) {
        // eslint-disable-next-line no-await-in-loop
        await seekTo(video, times[i]);
        const canvas = drawCurrentFrameToCanvas(video);
        let hasBarcode = false;
        try {
          reader.decodeFromCanvas(canvas); // synchronous — throws when nothing found
          hasBarcode = true;
        } catch { /* no barcode in this frame — true for most of them */ }
        // eslint-disable-next-line no-await-in-loop
        const { data } = await ocrWorker.recognize(canvas);
        // `data.words`/`data.blocks` need to be explicitly requested (off by
        // default — see tesseract.js's output options) and nest word-level
        // confidence several levels deep; recognized-text length is a simpler,
        // still-reliable proxy for "how label-like is this frame" without
        // depending on that nested structure at all.
        const textScore = (data.text || "").replace(/\s+/g, "").length;
        samples.push({ canvas, hasBarcode, textScore });
        setAutoProgress((i + 1) / times.length);
      }

      const byTextDesc = [...samples].sort((a, b) => b.textScore - a.textScore);
      const packet = samples.find((s) => s.hasBarcode) || byTextDesc[1] || byTextDesc[0];
      const rest1 = samples.filter((s) => s !== packet);
      const awb = [...rest1].sort((a, b) => b.textScore - a.textScore)[0] || rest1[0];
      const rest2 = rest1.filter((s) => s !== awb);
      // Least text wins, but a frame with a barcode is still almost certainly
      // packaging rather than the product itself — put those last even when
      // OCR reads zero text off them (small barcode-label text Tesseract
      // failed to pick up ties at 0 with a genuinely blank product frame
      // otherwise, and plain array order would wrongly favor the label).
      const product = [...rest2].sort((a, b) => {
        if (a.hasBarcode !== b.hasBarcode) return a.hasBarcode ? 1 : -1;
        return a.textScore - b.textScore;
      })[0] || rest2[0] || samples[0];

      const picks = { awb, packet, product };
      for (const key of Object.keys(picks)) {
        const sample = picks[key];
        if (!sample) continue;
        // eslint-disable-next-line no-await-in-loop
        const blob = await canvasToJpegBlob(sample.canvas);
        const thumb = URL.createObjectURL(blob);
        setShots((s) => {
          if (s[key]?.thumb) URL.revokeObjectURL(s[key].thumb);
          return { ...s, [key]: { blob, thumb, auto: true } };
        });
      }
    } catch (err) {
      console.error("Auto-detect failed:", err);
      setAutoErr(err?.message || "Auto-detect failed — capture the 3 frames manually below instead.");
    } finally {
      await ocrWorker?.terminate?.().catch(() => {});
      video.currentTime = resumeTime;
      setAutoDetecting(false);
    }
  };

  const compress = async () => {
    if (!file || !meta) return;
    setCompressing(true);
    setCompressErr("");
    setCompressed(null);
    setProgress(0);
    try {
      const [{ FFmpeg }, { fetchFile, toBlobURL }] = await Promise.all([
        import("@ffmpeg/ffmpeg"),
        import("@ffmpeg/util"),
      ]);
      if (!ffmpegRef.current) {
        const ffmpeg = new FFmpeg();
        ffmpeg.on("progress", ({ progress: p }) => setProgress(Math.min(1, Math.max(0, p || 0))));
        // Vite's `base` is "/" in dev but "/static/frontend/" in the production
        // build (see vite.config.js) — a bare "/ffmpeg-core/..." string 404s
        // once deployed, since it skips Vite's own base rewriting entirely.
        const ffmpegBase = `${import.meta.env.BASE_URL}ffmpeg-core`;
        // Fetched as blobs rather than passed as plain URLs: ffmpeg's own
        // worker dynamically `import()`s the core script, and the Vite dev
        // server intercepts that particular request (adds "?import" and
        // tries to run it through its own transform pipeline, which 500s on
        // this generated Emscripten file). Pre-fetching to a blob: URL here
        // sidesteps that entirely — plain fetch + Blob, nothing Vite watches.
        const [coreURL, wasmURL] = await Promise.all([
          toBlobURL(`${ffmpegBase}/ffmpeg-core.js`, "text/javascript"),
          toBlobURL(`${ffmpegBase}/ffmpeg-core.wasm`, "application/wasm"),
        ]);
        await ffmpeg.load({ coreURL, wasmURL });
        ffmpegRef.current = ffmpeg;
      }
      const ffmpeg = ffmpegRef.current;
      const inputName = "input" + (file.name.match(/\.\w+$/)?.[0] || ".mp4");
      await ffmpeg.writeFile(inputName, await fetchFile(file));

      // If the size budget works out to very few bits per pixel at the source
      // resolution, downscale first — a simple threshold, not a full quality
      // ladder, since this only needs to catch the "4K clip, tiny budget" case.
      const assumedFps = 25;
      let bitrateKbps = Math.floor((TARGET_BYTES * 8) / meta.duration / 1000);
      const bitsPerPixel = (bitrateKbps * 1000) / (meta.width * meta.height * assumedFps);
      const scaleArgs = bitsPerPixel < 0.03 && meta.width > 1280 ? ["-vf", "scale=1280:-2"] : [];

      let outBlob = null;
      let outSize = Infinity;
      for (let i = 0; i <= MAX_RETRIES; i++) {
        setAttempt(i + 1);
        const out = `out_${i}.mp4`;
        // eslint-disable-next-line no-await-in-loop
        await ffmpeg.exec([
          "-i", inputName,
          ...scaleArgs,
          "-c:v", "libx264",
          "-b:v", `${bitrateKbps}k`,
          "-maxrate", `${Math.floor(bitrateKbps * 1.2)}k`,
          "-bufsize", `${Math.floor(bitrateKbps * 2)}k`,
          "-preset", "veryfast",
          "-an",
          "-movflags", "+faststart",
          out,
        ]);
        // eslint-disable-next-line no-await-in-loop
        const data = await ffmpeg.readFile(out);
        outSize = data.byteLength;
        outBlob = new Blob([data], { type: "video/mp4" });
        // eslint-disable-next-line no-await-in-loop
        await ffmpeg.deleteFile(out);
        if (outSize <= TARGET_BYTES || i === MAX_RETRIES) break;
        bitrateKbps = Math.floor(bitrateKbps * (TARGET_BYTES / outSize) * 0.95);
      }
      await ffmpeg.deleteFile(inputName);
      setCompressed({ blob: outBlob, size: outSize });
    } catch (err) {
      console.error("Claim video compression failed:", err);
      setCompressErr(err?.message || "Compression failed — try a shorter or lower-resolution clip.");
    } finally {
      setCompressing(false);
    }
  };

  const longOrWide = meta && (meta.duration > LONG_DURATION_WARN_S || meta.width > WIDE_RESOLUTION_WARN_PX);
  const allShotsReady = SLOTS.every((s) => shots[s.key]);
  const subOrder = suborderNo || "claim";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {!suborderNo ? null : lookup === undefined ? (
        <div style={{ fontSize: 12.5, color: C.gray400 }}>Looking up return details…</div>
      ) : lookup ? (
        <div style={{ padding: 12, borderRadius: 10, background: C.gray50, border: `1px solid ${C.border}`,
          fontSize: 12.5, display: "flex", flexDirection: "column", gap: 5 }}>
          <div><b>AWB:</b>{" "}
            <span style={{ fontFamily: "monospace" }}>{lookup.awb_number || "—"}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span><b>Packet id:</b>{" "}
              <span style={{ fontFamily: "monospace" }}>{lookup.packet_id || "not scanned yet"}</span>
            </span>
            {lookup.packet_id && onPacketId && (
              <button onClick={() => onPacketId(lookup.packet_id)} style={{ ...btn("ghost", "sm"), padding: "3px 10px" }}>
                Use this
              </button>
            )}
          </div>
          <div><b>Product:</b> {lookup.product_name || lookup.sku || "—"}
            {lookup.variation ? ` · ${lookup.variation}` : ""}
          </div>
          {lookup.days_left != null && (
            <div style={{ color: lookup.days_left <= 2 ? C.red : C.gray500, fontWeight: 600 }}>
              {lookup.days_left} day{lookup.days_left === 1 ? "" : "s"} left in the claim window
            </div>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: C.gray400 }}>
          No return-delivery record found for this sub-order yet — you can still continue below,
          just enter the details manually when you submit.
        </div>
      )}

      <div>
        <label style={S.label}>Raw unboxing video</label>
        <input type="file" accept="video/*" onChange={onPickFile}
          style={field(isMobile, { padding: 8 })} />
      </div>

      {longOrWide && (
        <div style={{ display: "flex", gap: 8, padding: "10px 12px", borderRadius: 10,
          background: C.amberLight, border: "1px solid #FDE68A", color: C.amber, fontSize: 12 }}>
          <WarningAmberIcon style={{ fontSize: 16, flexShrink: 0 }} />
          <span>
            This video is {meta.duration > LONG_DURATION_WARN_S ? "long" : "high-resolution"} —
            compression could take several minutes and may be unstable on some phones.
            Keep this tab open and in the foreground while it runs.
          </span>
        </div>
      )}

      {videoUrl && (
        <video ref={videoRef} src={videoUrl} controls onLoadedMetadata={onLoadedMetadata}
          style={{ width: "100%", borderRadius: 10, background: "#000", maxHeight: 260 }} />
      )}

      {videoUrl && (
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <label style={S.label}>Screenshots — scrub to the right moment, then capture</label>
            <button onClick={autoDetectFrames} disabled={autoDetecting || !meta}
              style={{ ...btn("secondary", "sm"), fontSize: 11.5, padding: "5px 11px" }}>
              <AutoAwesomeIcon style={{ fontSize: 13, verticalAlign: "-2px" }} />
              &nbsp;{autoDetecting ? `Scanning… ${Math.round(autoProgress * 100)}%` : "Auto-detect frames"}
            </button>
          </div>
          <div style={{ fontSize: 10.5, color: C.gray400, marginTop: 4 }}>
            Samples the video and guesses which frames are which, entirely on this device — nothing is sent
            anywhere. It's a guess, not a certainty, so check each pick and retake any that are wrong.
          </div>
          {autoErr && (
            <div style={{ fontSize: 11.5, color: C.red, fontWeight: 600, marginTop: 6 }}>{autoErr}</div>
          )}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10 }}>
            {SLOTS.map((slot) => (
              <div key={slot.key} style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
                <div style={{ width: 96, height: 72, borderRadius: 8, overflow: "hidden", background: C.gray100,
                  border: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center",
                  position: "relative" }}>
                  {shots[slot.key] ? (
                    <img src={shots[slot.key].thumb} alt={slot.label}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <PhotoCameraIcon style={{ fontSize: 20, color: C.gray300 }} />
                  )}
                  {shots[slot.key]?.auto && (
                    <span style={{ position: "absolute", bottom: 3, left: 3, right: 3, textAlign: "center",
                      fontSize: 8.5, fontWeight: 800, color: C.white, background: "rgba(217,119,6,0.85)",
                      borderRadius: 4, padding: "1px 0", letterSpacing: "0.02em" }}>
                      AUTO — CHECK IT
                    </span>
                  )}
                </div>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: C.gray600 }}>{slot.label}</span>
                <button onClick={() => captureSlot(slot.key)} disabled={capturing === slot.key}
                  style={{ ...btn("ghost", "sm"), fontSize: 11, padding: "5px 9px" }}>
                  {capturing === slot.key ? "…" : shots[slot.key] ? "Retake" : "Capture"}
                </button>
                {shots[slot.key] && (
                  <button onClick={() => downloadBlob(shots[slot.key].blob, `${subOrder}_${slot.key}.jpg`)}
                    style={{ ...btn("ghost", "sm"), fontSize: 11, padding: "5px 9px" }}>
                    <DownloadIcon style={{ fontSize: 12, verticalAlign: "-2px" }} />&nbsp;Save
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {videoUrl && meta && (
        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
          <div style={{ ...S.cardTitle, marginBottom: 8 }}>Compress to under 22MB</div>
          <div style={{ fontSize: 11, color: C.gray400, marginBottom: 10 }}>
            Audio is dropped so every bit goes to picture quality — these are compliance videos, not narration.
          </div>
          {!compressed && (
            <button onClick={compress} disabled={compressing} style={btn("primary", "sm")}>
              {compressing ? `Compressing… attempt ${attempt}/${MAX_RETRIES + 1}` : "Compress video"}
            </button>
          )}
          {compressing && (
            <div style={{ marginTop: 10, height: 6, borderRadius: 4, background: C.gray100, overflow: "hidden" }}>
              <div style={{ width: `${Math.round(progress * 100)}%`, height: "100%",
                background: C.orange, transition: "width 0.2s" }} />
            </div>
          )}
          {compressErr && (
            <div style={{ marginTop: 8, fontSize: 12, color: C.red, fontWeight: 600 }}>{compressErr}</div>
          )}
          {compressed && (
            <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4,
                color: compressed.size <= 22 * 1024 * 1024 ? C.green : C.red }}>
                <CheckCircleIcon style={{ fontSize: 15 }} /> {(compressed.size / (1024 * 1024)).toFixed(1)} MB
              </span>
              <button onClick={() => downloadBlob(compressed.blob, `${subOrder}_video.mp4`)} style={btn("success", "sm")}>
                <DownloadIcon style={{ fontSize: 14, verticalAlign: "-2px" }} />&nbsp;Download compressed video
              </button>
              <button onClick={compress} disabled={compressing} style={btn("ghost", "sm")}>Re-compress</button>
            </div>
          )}
        </div>
      )}

      {allShotsReady && compressed && (
        <div style={{ fontSize: 12, color: C.green, fontWeight: 700 }}>
          All 4 files ready — upload them to Meesho's claim panel, then fill in the claim details and submit.
        </div>
      )}
    </div>
  );
}

/** Modal wrapper around `ClaimVideoWorkspace` for the entry point on a
    specific claim card (`ReturnClaimsPanel.jsx`), where the sub-order is
    already known from `task` and a captured packet id can flow straight back
    into that card's own submit form. */
export function ClaimVideoTool({ task, onClose, onPacketId }) {
  const isMobile = useIsMobile();
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(19,17,28,0.55)", zIndex: 1200,
      display: "flex", alignItems: isMobile ? "flex-end" : "center", justifyContent: "center",
      padding: isMobile ? 0 : 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: C.white, borderRadius: isMobile ? "16px 16px 0 0" : 16,
        width: isMobile ? "100%" : "min(640px, 100%)", maxHeight: isMobile ? "92vh" : "88vh",
        overflowY: "auto", boxShadow: "0 20px 60px rgba(19,17,28,0.3)",
      }}>
        <div style={{ position: "sticky", top: 0, background: C.white, zIndex: 1,
          display: "flex", alignItems: "center", gap: 10, padding: "16px 20px",
          borderBottom: `1px solid ${C.border}` }}>
          <VideocamIcon style={{ color: C.orange, fontSize: 20 }} />
          <span style={{ fontSize: 15.5, fontWeight: 800, color: C.gray800, flex: 1 }}>
            Prep claim video &amp; screenshots
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer",
            color: C.gray400, display: "inline-flex", padding: 6 }}>
            <CloseIcon style={{ fontSize: 19 }} />
          </button>
        </div>

        <div style={{ padding: 20 }}>
          <ClaimVideoWorkspace suborderNo={task.suborder_no} onPacketId={onPacketId} />
        </div>
      </div>
    </div>
  );
}
