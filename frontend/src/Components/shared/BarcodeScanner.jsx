import React, { useState, useEffect, useRef, useCallback } from "react";
import { C, btn } from "../../App";
import CloseIcon from "@mui/icons-material/Close";
import FlashlightOnIcon from "@mui/icons-material/FlashlightOn";
import CameraswitchIcon from "@mui/icons-material/Cameraswitch";
import { CircularProgress } from "@mui/material";

// Formats actually printed on Meesho / courier return labels. Restricting the
// list matters: every extra format is another decode attempt per frame, and on
// a phone that is the difference between instant and sluggish.
const FORMAT_NAMES = [
  "code_128",   // most courier AWBs (Xpress Bees, Delhivery, Shadowfax…)
  "code_39",
  "itf",
  "codabar",
  "qr_code",
  "data_matrix",
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
];

/**
 * Why a camera scan can be impossible before we even ask:
 * browsers only expose getUserMedia in a "secure context" — HTTPS, or
 * localhost. Opening the dev server over a LAN IP (http://192.168.x.x:3002)
 * on a phone is *not* secure, so the camera is blocked by the browser itself
 * and no amount of permission-granting helps. Detect that up front and say so,
 * rather than surfacing a bare NotAllowedError.
 */
function cameraBlockReason() {
  if (typeof window === "undefined") return null;
  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
  if (!window.isSecureContext && !isLocal) {
    return {
      title: "Camera needs a secure (HTTPS) connection",
      detail: `This page is open over plain HTTP at ${window.location.host}, and browsers only ` +
              `allow camera access on HTTPS (or on localhost). Open the site over its HTTPS ` +
              `address on your phone and the scanner will work. You can still type or paste the ` +
              `code below in the meantime.`,
    };
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return {
      title: "This browser can't open the camera",
      detail: "getUserMedia is unavailable here. Try Chrome or Safari, or type the code instead.",
    };
  }
  return null;
}

/** Native BarcodeDetector where it exists (Android Chrome), ZXing everywhere else. */
async function nativeDetectorOrNull() {
  if (!("BarcodeDetector" in window)) return null;
  try {
    const supported = await window.BarcodeDetector.getSupportedFormats();
    const usable = FORMAT_NAMES.filter(f => supported.includes(f));
    // If it can't do Code 128 it's useless for courier AWBs — fall back.
    if (!usable.includes("code_128")) return null;
    return new window.BarcodeDetector({ formats: usable });
  } catch {
    return null;
  }
}

function beep() {
  // Short confirmation tone — a scan often happens with the phone held away
  // from the operator's eyes, so audio is the real feedback channel.
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 1760;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.16);
    osc.start();
    osc.stop(ctx.currentTime + 0.16);
    setTimeout(() => ctx.close?.(), 400);
  } catch { /* audio blocked — the visual flash still confirms */ }
}

/**
 * Full-screen camera barcode scanner.
 *
 * onDetected(code) fires once per accepted scan. It closes on a hit by default:
 * the point of scanning is to then *read* the return's details, and a
 * full-screen camera would sit on top of them. Pass continuous to keep the
 * camera up (useful for bulk check-in where nothing needs reading).
 */
export function BarcodeScanner({ onDetected, onClose, continuous = false }) {
  const videoRef    = useRef(null);
  const controlsRef = useRef(null);   // ZXing IScannerControls
  const streamRef   = useRef(null);   // raw MediaStream (native path)
  const rafRef      = useRef(null);
  const lastCodeRef = useRef({ code: null, at: 0 });
  const closingRef  = useRef(false);

  const [starting, setStarting]   = useState(true);
  const [error, setError]         = useState(null);
  const [engine, setEngine]       = useState(null);      // "native" | "zxing"
  const [facing, setFacing]       = useState("environment");
  const [torchOn, setTorchOn]     = useState(false);
  const [torchable, setTorchable] = useState(false);
  const [lastHit, setLastHit]     = useState(null);
  const [flash, setFlash]         = useState(false);
  const [manual, setManual]       = useState("");

  const blocked = cameraBlockReason();

  // One accepted scan → feedback + callback. The same barcode staying in frame
  // would otherwise fire dozens of times a second, so ignore a repeat of the
  // same code within 2.5s while still allowing a genuine re-scan later.
  const accept = useCallback((code) => {
    const text = (code || "").trim();
    if (!text) return;
    const now = Date.now();
    if (lastCodeRef.current.code === text && now - lastCodeRef.current.at < 2500) return;
    lastCodeRef.current = { code: text, at: now };

    beep();
    navigator.vibrate?.(60);
    setLastHit(text);
    setFlash(true);
    setTimeout(() => setFlash(false), 220);

    onDetected(text);
    if (!continuous) stopAndClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDetected, continuous]);

  const teardown = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    try { controlsRef.current?.stop(); } catch { /* already stopped */ }
    controlsRef.current = null;
    streamRef.current?.getTracks?.().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const stopAndClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    teardown();
    onClose();
  }, [teardown, onClose]);

  // Start (and restart on camera flip). Cancelled via `dead` so a slow
  // getUserMedia resolving after unmount can't attach an orphan stream.
  useEffect(() => {
    if (blocked) { setStarting(false); return; }

    let dead = false;
    setStarting(true);
    setError(null);

    (async () => {
      const constraints = {
        video: {
          facingMode: { ideal: facing },
          width:  { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      };

      try {
        const native = await nativeDetectorOrNull();

        if (native) {
          const stream = await navigator.mediaDevices.getUserMedia(constraints);
          if (dead) { stream.getTracks().forEach(t => t.stop()); return; }
          streamRef.current = stream;
          const video = videoRef.current;
          if (!video) { stream.getTracks().forEach(t => t.stop()); return; }
          video.srcObject = stream;
          video.setAttribute("playsinline", "true");   // iOS: don't go fullscreen
          await video.play().catch(() => {});

          const track = stream.getVideoTracks()[0];
          setTorchable(!!track?.getCapabilities?.().torch);
          setEngine("native");
          setStarting(false);

          const tick = async () => {
            if (dead || !videoRef.current) return;
            try {
              const hits = await native.detect(videoRef.current);
              if (hits?.length) accept(hits[0].rawValue);
            } catch { /* transient decode failure — keep scanning */ }
            rafRef.current = requestAnimationFrame(tick);
          };
          rafRef.current = requestAnimationFrame(tick);
          return;
        }

        // ZXing fallback — lazily imported so it isn't in the main bundle for
        // everyone who never opens the scanner.
        const [{ BrowserMultiFormatReader }, { DecodeHintType, BarcodeFormat }] = await Promise.all([
          import("@zxing/browser"),
          import("@zxing/library"),
        ]);
        if (dead) return;

        const formats = [
          BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.ITF,
          BarcodeFormat.CODABAR, BarcodeFormat.QR_CODE, BarcodeFormat.DATA_MATRIX,
          BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
        ];
        const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, formats]]);
        const reader = new BrowserMultiFormatReader(hints, {
          delayBetweenScanAttempts: 120,
          delayBetweenScanSuccess: 600,
        });

        const controls = await reader.decodeFromConstraints(
          constraints,
          videoRef.current,
          (result) => { if (result) accept(result.getText()); },
        );
        if (dead) { controls.stop(); return; }
        controlsRef.current = controls;
        setTorchable(typeof controls.switchTorch === "function");
        setEngine("zxing");
        setStarting(false);
      } catch (err) {
        if (dead) return;
        setStarting(false);
        const name = err?.name || "";
        if (name === "NotAllowedError" || name === "SecurityError") {
          setError({
            title: "Camera permission denied",
            detail: "Allow camera access for this site in your browser settings, then reopen the scanner.",
          });
        } else if (name === "NotFoundError" || name === "OverconstrainedError") {
          setError({
            title: "No usable camera found",
            detail: "This device reported no camera matching the request. Try switching cameras.",
          });
        } else if (name === "NotReadableError") {
          setError({
            title: "Camera is busy",
            detail: "Another app or tab is using the camera. Close it and try again.",
          });
        } else {
          setError({ title: "Could not start the camera", detail: err?.message || String(err) });
        }
      }
    })();

    return () => { dead = true; teardown(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facing]);

  const toggleTorch = async () => {
    const next = !torchOn;
    try {
      if (controlsRef.current?.switchTorch) {
        await controlsRef.current.switchTorch(next);
      } else {
        const track = streamRef.current?.getVideoTracks?.()[0];
        await track?.applyConstraints({ advanced: [{ torch: next }] });
      }
      setTorchOn(next);
    } catch {
      setTorchable(false);   // capability lied — hide the control
    }
  };

  // Escape closes, matching every other overlay in the app.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") stopAndClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stopAndClose]);

  const unavailable = blocked || error;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 4000,
      background: "#000", display: "flex", flexDirection: "column",
    }}>
      {/* ── Top bar ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "14px 18px", background: "rgba(0,0,0,0.75)", color: "#fff",
        flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Scan return label</div>
          <div style={{ fontSize: 11, opacity: 0.7 }}>
            {starting ? "Starting camera…"
              : unavailable ? "Camera unavailable"
              : `Point at the barcode · ${engine === "native" ? "device scanner" : "ZXing"}`}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {torchable && !unavailable && (
            <button onClick={toggleTorch} aria-label="Toggle torch" style={{
              background: torchOn ? C.amber : "rgba(255,255,255,0.15)", color: "#fff",
              border: "none", borderRadius: 10, padding: 9, cursor: "pointer", lineHeight: 0,
            }}>
              <FlashlightOnIcon style={{ fontSize: 20 }} />
            </button>
          )}
          {!unavailable && (
            <button
              onClick={() => setFacing(f => (f === "environment" ? "user" : "environment"))}
              aria-label="Switch camera"
              style={{
                background: "rgba(255,255,255,0.15)", color: "#fff",
                border: "none", borderRadius: 10, padding: 9, cursor: "pointer", lineHeight: 0,
              }}>
              <CameraswitchIcon style={{ fontSize: 20 }} />
            </button>
          )}
          <button onClick={stopAndClose} aria-label="Close scanner" style={{
            background: "rgba(255,255,255,0.15)", color: "#fff",
            border: "none", borderRadius: 10, padding: 9, cursor: "pointer", lineHeight: 0,
          }}>
            <CloseIcon style={{ fontSize: 20 }} />
          </button>
        </div>
      </div>

      {/* ── Viewfinder ── */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden", minHeight: 0 }}>
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          style={{
            width: "100%", height: "100%", objectFit: "cover",
            display: unavailable ? "none" : "block",
            background: "#000",
          }}
        />

        {starting && !unavailable && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 12, color: "#fff",
          }}>
            <CircularProgress style={{ color: "#fff" }} />
            <span style={{ fontSize: 13, opacity: 0.8 }}>Opening camera…</span>
          </div>
        )}

        {/* Aiming guide — a wide, short box, because courier AWB barcodes are
            wide 1D codes and framing them fully is what makes them decode. */}
        {!starting && !unavailable && (
          <>
            <div style={{
              position: "absolute", top: "50%", left: "50%",
              transform: "translate(-50%, -50%)",
              width: "84%", maxWidth: 520, height: 150,
              border: `3px solid ${flash ? C.green : "rgba(255,255,255,0.85)"}`,
              borderRadius: 14,
              boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)",
              transition: "border-color 0.12s",
            }} />
            <div style={{
              position: "absolute", top: "50%", left: "50%",
              transform: "translate(-50%, -50%)",
              width: "84%", maxWidth: 520, height: 2,
              background: flash ? C.green : "rgba(225,29,72,0.8)",
            }} />
          </>
        )}

        {/* Unavailable / error state */}
        {unavailable && (
          <div style={{
            position: "absolute", inset: 0, padding: 26,
            display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", gap: 12, textAlign: "center", color: "#fff",
          }}>
            <div style={{ fontSize: 17, fontWeight: 700 }}>{unavailable.title}</div>
            <div style={{ fontSize: 13, opacity: 0.8, maxWidth: 460, lineHeight: 1.55 }}>
              {unavailable.detail}
            </div>
          </div>
        )}
      </div>

      {/* ── Bottom bar: last hit + typed fallback ── */}
      <div style={{
        padding: "14px 18px", background: "rgba(0,0,0,0.8)", color: "#fff",
        flexShrink: 0, display: "flex", flexDirection: "column", gap: 10,
      }}>
        {lastHit && (
          <div style={{
            background: "rgba(5,150,105,0.25)", border: `1px solid ${C.green}`,
            borderRadius: 10, padding: "9px 13px",
            fontSize: 15, fontFamily: "monospace", fontWeight: 700,
            wordBreak: "break-all",
          }}>
            ✓ {lastHit}
          </div>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={manual}
            onChange={e => setManual(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && manual.trim()) { accept(manual.trim()); setManual(""); }
            }}
            placeholder="…or type / paste the code"
            autoComplete="off"
            spellCheck={false}
            style={{
              flex: 1, background: "rgba(255,255,255,0.12)", color: "#fff",
              border: "1.5px solid rgba(255,255,255,0.25)", borderRadius: 10,
              padding: "10px 13px", fontSize: 15, fontFamily: "monospace",
              outline: "none", minWidth: 0,
            }}
          />
          <button
            onClick={() => { if (manual.trim()) { accept(manual.trim()); setManual(""); } }}
            disabled={!manual.trim()}
            style={{ ...btn("primary", "md"), opacity: manual.trim() ? 1 : 0.45 }}
          >
            Use
          </button>
        </div>
        {continuous && !unavailable && (
          <div style={{ fontSize: 11, opacity: 0.6 }}>
            Camera stays on — scan the next parcel, or close when you're done.
          </div>
        )}
      </div>
    </div>
  );
}
