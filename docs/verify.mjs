/*
 * Sanity-check the recorded reel: does it decode, is it the right size and
 * length, and do real frames come out of it?
 *
 *   node docs/verify.mjs
 *
 * Written because "the file exists and is 4MB" proves nothing — a broken
 * recording is exactly that size and all black. This loads the MP4 in Chrome,
 * reads its metadata, then seeks to a few moments and dumps them as PNGs so
 * they can be looked at.
 */

import { chromium } from "playwright-core";
import { writeFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const mp4 = resolve(here, "Rudam-Reel.mp4");
const outDir = process.argv[2] || here;

const browser = await chromium.launch({
  channel: "chrome", headless: false, args: ["--window-position=-2400,-2400"],
});
// The page has to be served from file:// itself — a document created with
// setContent() sits on an opaque origin and Chrome refuses to load a file://
// video into it, which just looks like the video failing to decode.
const shim = resolve(here, "verify-player.html");
writeFileSync(shim, `<body style="margin:0;background:#000">
  <video id="v" src="Rudam-Reel.mp4" muted playsinline style="width:270px"></video>
  <canvas id="cv" width="1080" height="1920" style="display:none"></canvas>
</body>`);

const page = await (await browser.newContext()).newPage();
await page.goto(`file://${shim}`, { waitUntil: "load" });
await page.waitForTimeout(1200);

const meta = await page.evaluate(() => new Promise((res, rej) => {
  const v = document.getElementById("v");
  const done = () => res({ w: v.videoWidth, h: v.videoHeight, dur: +v.duration.toFixed(2) });
  // HAVE_METADATA or better means it already loaded while the page settled —
  // attaching a listener at that point would wait for an event long since past.
  if (v.readyState >= 1) return done();
  v.onloadedmetadata = done;
  v.onerror = () => rej(new Error("the browser could not decode this file"));
  setTimeout(() => rej(new Error("timed out reading metadata")), 20000);
}));
console.log("decoded:", JSON.stringify(meta));

for (const t of [1.5, 5.5, 9.5, 13.5, 17.0]) {
  await page.evaluate((tt) => new Promise((res) => {
    const v = document.getElementById("v");
    const grab = () => {
      document.getElementById("cv").getContext("2d").drawImage(v, 0, 0, 1080, 1920);
      res();
    };
    v.onseeked = grab;
    v.currentTime = tt;
    setTimeout(grab, 5000);   // don't hang the run on a seek that never reports
  }), t);
  // toDataURL is refused once a file:// video has been drawn in (tainted
  // canvas), so the frame is captured by screenshotting the element.
  await page.locator("#v").screenshot({ path: resolve(outDir, `frame-${t}.png`) });
  console.log(`frame @${t}s captured`);
}

await browser.close();
rmSync(shim, { force: true });
