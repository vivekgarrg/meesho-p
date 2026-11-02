/*
 * Shrink a video under Meesho's 22 MB attachment cap, in the browser.
 *
 * Fast path: WebCodecs (the phone's / computer's own hardware encoder) through
 * mediabunny — a few seconds for a typical unpacking clip. Where the browser
 * has no WebCodecs encoder (older iPhones, some desktop browsers) it falls back
 * to ffmpeg.wasm, the same encoder the Claim Video Tool uses: slower, but works
 * everywhere.
 *
 * compressVideo(file, { target, skipUnder, onProgress(0..1), onStage(text) }) → File
 * A file up to `skipUnder` (24 MB) comes back as it is — no compression at all.
 *
 * Tuned for speed over polish (a claim video only has to show the parcel):
 * 720p, 24 fps, the hardware encoder, and the audio copied rather than
 * re-encoded — a typical 30–60 s phone clip takes a few seconds.
 */

export const MEESHO_VIDEO_TARGET = 21.5 * 1024 * 1024;   // headroom under 22 MB for container overhead
export const SKIP_UNDER = 24 * 1024 * 1024;              // up to this, a video is sent as it is
const AUDIO_BPS = 64_000;
const MIN_VIDEO_BPS = 250_000;
const MAX_VIDEO_BPS = 4_000_000;

const outName = (name) => `${(name || "video").replace(/\.[^.]+$/, "")}-small.mp4`;

function videoBitrate(target, seconds, scale = 1) {
  const total = (target * 8 * 0.92) / Math.max(1, seconds);
  return Math.max(MIN_VIDEO_BPS, Math.min(MAX_VIDEO_BPS, Math.floor((total - AUDIO_BPS) * scale)));
}

async function withWebCodecs(file, target, onProgress, onStage) {
  if (typeof window === "undefined" || !("VideoEncoder" in window)) throw new Error("no WebCodecs");
  const mb = await import("mediabunny");
  let scale = 1;
  for (let attempt = 0; attempt < 2; attempt++) {
    const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error("no video track");
      const seconds = await input.computeDuration();
      const bps = videoBitrate(target, seconds, scale);
      // The long side to 1280 px (854 px when the budget is thin) — plenty for a claim, and quick to encode.
      const longSide = bps < 900_000 ? 854 : 1280;
      const portrait = track.displayHeight > track.displayWidth;
      const big = Math.max(track.displayWidth, track.displayHeight) > longSide;
      const size = !big ? {} : portrait ? { height: longSide } : { width: longSide };
      const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }), target: new mb.BufferTarget() });
      const conversion = await mb.Conversion.init({
        input, output, tracks: "primary", showWarnings: false,
        video: { ...size, codec: "avc", bitrate: bps, forceTranscode: true, hardwareAcceleration: "prefer-hardware",
          frameRate: 24, keyFrameInterval: 4 },
        // The phone's AAC audio is copied as it is; only other audio is re-encoded.
        audio: { codec: "aac", bitrate: AUDIO_BPS },
      });
      if (!conversion.isValid) throw new Error("this video can't be converted here");
      onStage?.(attempt ? "Compressing again, a little smaller…" : "Compressing (fast)…");
      conversion.onProgress = (p) => onProgress?.(Math.min(1, Math.max(0, p)));
      await conversion.execute();
      const buf = output.target.buffer;
      if (buf && buf.byteLength <= target) return new File([buf], outName(file.name), { type: "video/mp4" });
      scale *= (target / (buf?.byteLength || target * 2)) * 0.9;
    } finally {
      input.dispose?.();
    }
  }
  throw new Error("still over 22 MB");
}

async function withFfmpeg(file, target, onProgress, onStage) {
  onStage?.("Compressing (this browser is slower — keep the page open)…");
  const [{ FFmpeg }, { fetchFile, toBlobURL }] = await Promise.all([import("@ffmpeg/ffmpeg"), import("@ffmpeg/util")]);
  const ffmpeg = new FFmpeg();
  ffmpeg.on("progress", ({ progress: p }) => onProgress?.(Math.min(1, Math.max(0, p || 0))));
  const base = `${import.meta.env.BASE_URL}ffmpeg-core`;
  const [coreURL, wasmURL] = await Promise.all([
    toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
    toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
  ]);
  await ffmpeg.load({ coreURL, wasmURL });
  const seconds = await durationOf(file);
  const inName = "in" + (file.name.match(/\.\w+$/)?.[0] || ".mp4");
  await ffmpeg.writeFile(inName, await fetchFile(file));
  let kbps = Math.floor(videoBitrate(target, seconds) / 1000);
  try {
    for (let i = 0; i < 3; i++) {
      const out = `out${i}.mp4`;
      // eslint-disable-next-line no-await-in-loop
      await ffmpeg.exec(["-i", inName, "-vf", "scale='min(1280,iw)':-2", "-r", "24", "-c:v", "libx264", "-preset", "ultrafast",
        "-b:v", `${kbps}k`, "-maxrate", `${Math.floor(kbps * 1.2)}k`, "-bufsize", `${kbps * 2}k`,
        "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", out]);
      // eslint-disable-next-line no-await-in-loop
      const data = await ffmpeg.readFile(out);
      if (data.byteLength <= target) return new File([data], outName(file.name), { type: "video/mp4" });
      kbps = Math.floor(kbps * (target / data.byteLength) * 0.9);
    }
  } finally {
    ffmpeg.terminate?.();
  }
  throw new Error("Couldn't get the video under 22 MB — record a shorter clip.");
}

export function durationOf(file) {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    const url = URL.createObjectURL(file);
    const done = (d) => { URL.revokeObjectURL(url); resolve(d); };
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? v.duration : 60);
    v.onerror = () => done(60);
    v.src = url;
  });
}

export async function compressVideo(file, { target = MEESHO_VIDEO_TARGET, skipUnder = SKIP_UNDER, onProgress, onStage } = {}) {
  if (file.size <= Math.max(target, skipUnder)) return file;
  try {
    return await withWebCodecs(file, target, onProgress, onStage);
  } catch (e) {
    console.warn("Fast compression unavailable, using ffmpeg:", e);
    onProgress?.(0);
    return withFfmpeg(file, target, onProgress, onStage);
  }
}
