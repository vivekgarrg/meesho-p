/*
 * Desk sounds — the packing desk works with its eyes on the parcel, not the
 * screen, so every scan's outcome is also heard:
 *
 *   ok()    a short bright double chirp — done, scan the next one
 *   warn()  two falling tones — look at the screen (e.g. already linked)
 *   error() a loud three-pulse alarm — stop, nothing was done
 *
 * One AudioContext, made on first use and resumed on any key / tap (a barcode
 * scanner's keystrokes count), since browsers keep audio locked until then.
 * Muting is remembered on this browser.
 */

const MUTE_KEY = "desk-sounds-muted";
let ctx = null;

function context() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!ctx) ctx = new Ctx();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

if (typeof window !== "undefined") {
  const unlock = () => { context(); };
  window.addEventListener("keydown", unlock, { capture: true, passive: true });
  window.addEventListener("pointerdown", unlock, { capture: true, passive: true });
}

export function isMuted() {
  try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; }
}

export function setMuted(on) {
  try { localStorage.setItem(MUTE_KEY, on ? "1" : "0"); } catch { /* sound still follows the switch for this page */ }
}

// [frequency Hz, start s, length s, wave, volume]
function play(notes) {
  if (isMuted()) return;
  const c = context();
  if (!c) return;
  const t0 = c.currentTime + 0.01;
  for (const [freq, at, len, type = "sine", vol = 0.3] of notes) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0 + at);
    gain.gain.setValueAtTime(0.0001, t0 + at);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len);
    osc.connect(gain).connect(c.destination);
    osc.start(t0 + at);
    osc.stop(t0 + at + len + 0.02);
  }
}

export const sounds = {
  ok: () => play([[1046, 0, 0.09], [1568, 0.1, 0.14]]),
  warn: () => play([[880, 0, 0.18, "triangle", 0.35], [587, 0.2, 0.28, "triangle", 0.35]]),
  error: () => play([
    [440, 0, 0.16, "square", 0.22], [330, 0.17, 0.16, "square", 0.22],
    [440, 0.38, 0.16, "square", 0.22], [330, 0.55, 0.16, "square", 0.22],
    [440, 0.76, 0.16, "square", 0.22], [330, 0.93, 0.3, "square", 0.22],
  ]),
};
