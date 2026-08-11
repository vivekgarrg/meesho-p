/*
 * Render a document in docs/ to a printable PDF.
 *
 *   node docs/build-guide.mjs              -> seller-guide.html  -> Rudam-Seller-Guide.pdf
 *   node docs/build-guide.mjs one-pager    -> one-pager.html     -> Rudam-One-Pager.pdf
 *
 * Uses the Chrome already on the machine rather than a headless-browser npm
 * package: this is a document you regenerate a couple of times a year, and it
 * shouldn't drag a 300MB dependency into the repo to do it. Chrome's own
 * --print-to-pdf honours the @page rules in the stylesheet, so what you get is
 * what the CSS asks for.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DOCS = {
  "seller-guide": "Rudam-Seller-Guide.pdf",
  "one-pager":    "Rudam-One-Pager.pdf",
};

const name = process.argv[2] || "seller-guide";
if (!DOCS[name]) {
  console.error(`Unknown document "${name}". One of: ${Object.keys(DOCS).join(", ")}`);
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, `${name}.html`);
const out = resolve(here, DOCS[name]);

// Whichever of these exists first. Edge is Chromium too and prints identically.
const CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  process.env.CHROME_PATH,
].filter(Boolean);

const chrome = CANDIDATES.find((p) => existsSync(p));
if (!chrome) {
  console.error(
    "No Chrome/Chromium found. Install one, or set CHROME_PATH to its binary."
  );
  process.exit(1);
}

execFileSync(chrome, [
  "--headless",
  "--disable-gpu",
  // Chrome's own header/footer would stamp a URL and date across every page,
  // on top of the page furniture the stylesheet already draws.
  "--no-pdf-header-footer",
  `--print-to-pdf=${out}`,
  `file://${src}`,
], { stdio: "inherit" });

console.log(`Wrote ${out}`);
