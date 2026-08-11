import { chromium } from "playwright-core";
import { writeFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const shim = resolve(here, "playtest.html");
writeFileSync(shim, `<body style="margin:0;background:#000">
<video id="v" src="Rudam-Reel.mp4" muted playsinline style="width:250px"></video></body>`);
const b = await chromium.launch({ channel: "chrome", headless: false,
  args: ["--window-position=-2400,-2400", "--disable-backgrounding-occluded-windows",
         "--disable-renderer-backgrounding", "--disable-background-timer-throttling",
         "--autoplay-policy=no-user-gesture-required"] });
const p = await (await b.newContext()).newPage();
await p.goto(`file://${shim}`, { waitUntil: "load" });
const r = await p.evaluate(() => new Promise((res) => {
  const v = document.getElementById("v");
  const t0 = performance.now();
  v.onended = () => res({ wall: +((performance.now() - t0) / 1000).toFixed(2),
                          reportedDuration: +v.duration.toFixed(2),
                          lastTime: +v.currentTime.toFixed(2) });
  v.play();
  setTimeout(() => res({ wall: -1, reportedDuration: +v.duration.toFixed(2),
                         lastTime: +v.currentTime.toFixed(2) }), 40000);
}));
console.log("playback:", JSON.stringify(r));
await b.close();
rmSync(shim, { force: true });
