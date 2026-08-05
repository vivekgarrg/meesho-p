/**
 * config.js — which Rudam server this copy of the extension syncs with.
 *
 * When you download the extension from the app (Tools → Browser Extension), this
 * file is REGENERATED with the origin that served the download, so a downloaded
 * copy needs no configuration at all.
 *
 * This checked-in default is what you get when loading the folder unpacked
 * straight from the repo. Override it at runtime in the extension's Settings tab
 * — handy for pointing a dev build at http://127.0.0.1:8000 — which takes
 * precedence over this value.
 *
 * Assigned to `self` rather than `window` so the same file is valid in the popup
 * and in a service worker, where `window` does not exist.
 */
self.ML_CONFIG = {
  apiBase: "https://rudam.in",
  generatedAt: null,
};
