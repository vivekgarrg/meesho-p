/*
 * Every code that can be read off a photo — a waybill, a packet's barcode.
 *
 *   1. barcodes: the browser's own BarcodeDetector (Android Chrome, recent
 *      Safari) reads every barcode in the photo at once; ZXing reads one
 *      elsewhere, tried on the photo and on it turned sideways.
 *   2. text (only when asked, and nothing was read): Tesseract reads the
 *      printed text, and anything that looks like an AWB / packet id is kept.
 *
 * readCodes(file, { text: true, onStage }) → ["R2718300838FPL", …], best first.
 */

const clean = (c) => String(c || "").replace(/\s+/g, "").split("|")[0].toUpperCase();
// An AWB / packet id / sub-order: 8–30 letters and digits with at least 5 digits.
const looksLikeCode = (c) => /^[A-Z0-9_-]{8,30}$/.test(c) && (c.match(/\d/g) || []).length >= 5;

async function bitmapOf(file) {
  if ("createImageBitmap" in window) return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

function canvasOf(img, rotate = 0, maxSide = 2000) {
  const w = img.width, h = img.height;
  const k = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement("canvas");
  const sw = Math.round(w * k), sh = Math.round(h * k);
  if (rotate) { c.width = sh; c.height = sw; } else { c.width = sw; c.height = sh; }
  const g = c.getContext("2d");
  if (rotate) { g.translate(sh, 0); g.rotate(Math.PI / 2); }
  g.drawImage(img, 0, 0, sw, sh);
  return c;
}

async function nativeCodes(img) {
  if (!("BarcodeDetector" in window)) return null;
  try {
    const formats = await window.BarcodeDetector.getSupportedFormats();
    const found = await new window.BarcodeDetector({ formats }).detect(img);
    return found.map((b) => b.rawValue);
  } catch {
    return null;
  }
}

async function zxingCodes(img) {
  const [{ BrowserMultiFormatReader }, { DecodeHintType }] = await Promise.all([import("@zxing/browser"), import("@zxing/library")]);
  const hints = new Map([[DecodeHintType.TRY_HARDER, true]]);
  const reader = new BrowserMultiFormatReader(hints);
  const out = [];
  for (const rotate of [0, 1]) {
    try {
      out.push(reader.decodeFromCanvas(canvasOf(img, rotate)).getText());
    } catch { /* nothing readable this way round */ }
  }
  return out;
}

async function textCodes(file, onStage) {
  onStage?.("Reading the printed text…");
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try {
    const { data } = await worker.recognize(file);
    return (data.text || "").toUpperCase().split(/[^A-Z0-9_-]+/).filter(looksLikeCode);
  } finally {
    await worker.terminate().catch(() => {});
  }
}

export async function readCodes(file, { text = false, onStage } = {}) {
  onStage?.("Reading the barcode…");
  const img = await bitmapOf(file);
  let codes = (await nativeCodes(img)) || [];
  if (!codes.length) codes = await zxingCodes(img).catch(() => []);
  let out = [...new Set(codes.map(clean).filter(Boolean))];
  if (!out.length && text) out = [...new Set(await textCodes(file, onStage).catch(() => []))];
  // Longer, digit-heavy codes first — an AWB beats a short routing code.
  return out.sort((a, b) => Number(looksLikeCode(b)) - Number(looksLikeCode(a)) || b.length - a.length);
}
