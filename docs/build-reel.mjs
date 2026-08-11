/*
 * Record docs/promo-reel.html to docs/Rudam-Reel.mp4.
 *
 *   node docs/build-reel.mjs
 *
 * The page draws itself on a canvas and records that canvas with MediaRecorder,
 * which on macOS Chrome encodes H.264 in an MP4 container — the format
 * Instagram accepts. The browser does the encoding, so there is no ffmpeg to
 * install; the only thing this script needs is a way to drive Chrome:
 *
 *     npm i -D playwright-core        (or run with NODE_PATH set to an install)
 *
 * Needs a headed browser: headless Chrome has no compositor driving
 * requestAnimationFrame at a steady rate, and the recording comes out with
 * dropped and unevenly-spaced frames. It runs off-screen instead.
 */

import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "promo-reel.html");
const out = resolve(here, process.env.FMT === "webm" ? "Rudam-Reel.webm" : "Rudam-Reel.mp4");

if (!existsSync(src)) {
  console.error(`Missing ${src}`);
  process.exit(1);
}

const browser = await chromium.launch({
  channel: "chrome",
  headless: false,
  args: [
    "--autoplay-policy=no-user-gesture-required",
    "--window-position=40,40",
    "--window-size=420,780",
    // Chrome throttles requestAnimationFrame in a window it thinks nobody can
    // see, which is exactly what an off-screen window looks like. Left alone,
    // an 18-second reel records as about 7 seconds of stuttering video.
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling",
    "--disable-features=CalculateNativeWinOcclusion",
  ],
});

const ctx = await browser.newContext({ viewport: { width: 600, height: 1040 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on("console", (m) => console.log("page:", m.text()));

await page.goto(`file://${src}?record=1${process.env.FMT === "webm" ? "&fmt=webm" : ""}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
console.log("rendering (two passes: calibrate, then record)…");
const t0 = Date.now();

const download = await page.waitForEvent("download", { timeout: 240000 });
await download.saveAs(out);

// A reel that recorded at a fraction of the intended rate still produces a
// perfectly valid file, so the frame count is worth printing.
const wall = ((Date.now() - t0) / 1000).toFixed(2);
const measured = await page.evaluate(() => window.__measured || 0);
console.log(`built in ${wall}s · finished clip is ${measured.toFixed(2)}s long`);

await browser.close();
console.log(`Wrote ${out}`);
