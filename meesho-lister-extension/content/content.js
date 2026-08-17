/**
 * content.js
 * -----------------------------------------------------------------------------
 * Message bridge between the popup and the live Meesho or Flipkart Seller Hub
 * listing page. Delegates the heavy lifting to window.MeeshoFieldScanner
 * (fieldScanner.js, injected just before this file per manifest order) — the
 * scanner itself is DOM-heuristic based, not tied to either site.
 *
 * Also draws a small floating badge so the user knows the extension is live and
 * how many fields were detected on the current page.
 */
(function () {
  "use strict";

  const Scanner = window.MeeshoFieldScanner;
  if (!Scanner) {
    console.warn("[RudamLister] field scanner not loaded");
    return;
  }

  /** Which marketplace this tab is on, purely for the badge text. */
  const PLATFORM_LABEL = /flipkart\.com$/i.test(location.hostname) ? "Flipkart" : "Meesho";

  /* ---------------------------- message handling --------------------------- */
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    try {
      switch (msg && msg.type) {
        case "ML_SCAN": {
          const fields = Scanner.scan({ visibleOnly: msg.visibleOnly !== false });
          sendResponse({ ok: true, fields, url: location.href });
          break;
        }
        case "ML_APPLY": {
          // apply() is async (custom dropdowns need interaction); respond when done.
          Promise.resolve(Scanner.apply(msg.values || {}))
            .then((report) => {
              flashBadge(`Filled ${report.filled.length} field(s)`);
              sendResponse({ ok: true, report });
            })
            .catch((e) =>
              sendResponse({ ok: false, error: String(e && e.message ? e.message : e) })
            );
          break;
        }
        case "ML_PING": {
          sendResponse({ ok: true, url: location.href });
          break;
        }
        case "ML_HIGHLIGHT": {
          highlight(msg.key);
          sendResponse({ ok: true });
          break;
        }
        case "ML_GRAB_LABELS": {
          grabLabels().then(sendResponse);
          break;
        }
        default:
          sendResponse({ ok: false, error: "unknown message" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
    }
    return true; // keep the channel open for async sendResponse
  });

  /* -------------------------------- badge ---------------------------------- */
  let badgeEl;
  function ensureBadge() {
    if (badgeEl) return badgeEl;
    badgeEl = document.createElement("div");
    badgeEl.id = "ml-badge";
    badgeEl.textContent = `Rudam Lister · ${PLATFORM_LABEL}`;
    Object.assign(badgeEl.style, {
      position: "fixed",
      bottom: "16px",
      right: "16px",
      zIndex: 2147483647,
      background: "#570e44",
      color: "#fff",
      font: "600 12px/1 system-ui, sans-serif",
      padding: "8px 12px",
      borderRadius: "999px",
      boxShadow: "0 4px 14px rgba(0,0,0,.25)",
      cursor: "default",
      opacity: "0.92",
      transition: "transform .15s ease",
    });
    document.body.appendChild(badgeEl);
    return badgeEl;
  }

  function flashBadge(text) {
    const b = ensureBadge();
    const prev = b.textContent;
    b.textContent = text;
    b.style.transform = "scale(1.06)";
    setTimeout(() => {
      b.style.transform = "scale(1)";
      b.textContent = prev;
    }, 1600);
  }

  /* --------------------------- label PDF capture ---------------------------- */
  // labelSniffer.js runs in the page's own JS world (manifest "world": "MAIN")
  // so it can see the exact network responses the page sees; it can't talk to
  // the extension directly, so it posts a message into this same document,
  // which this isolated-world script (which CAN talk to the extension) relays.
  let latestCapture = null; // { dataUrl, filename, capturedAt }
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "ml-label-sniffer" || data.type !== "ML_PDF_CAPTURED") return;
    latestCapture = { dataUrl: data.dataUrl, filename: data.filename, capturedAt: Date.now() };
  });

  /** First visible element (button/link/role=button) whose text matches one
   * of these, tried in order — same "best effort, several common phrasings"
   * approach as the standalone label-downloader script. */
  function clickButtonByText(texts) {
    const candidates = Array.from(document.querySelectorAll("button, a, [role='button']"));
    for (const wanted of texts) {
      const w = wanted.toLowerCase();
      const match = candidates.find((el) => {
        if (!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)) return false; // hidden
        return (el.textContent || "").trim().toLowerCase().includes(w);
      });
      if (match) {
        match.click();
        return true;
      }
    }
    return false;
  }

  const AUTO_CLICK_TEXTS = ["download labels", "print labels", "download", "print", "export"];
  const AUTO_WINDOW_MS = 8000;   // how long the automatic click gets before we ask you to do it
  const TOTAL_WINDOW_MS = 45000; // how long we keep watching before giving up

  /**
   * Best-effort click the download button, then wait for labelSniffer.js to
   * report a captured PDF. If nothing shows up quickly, this doesn't fail —
   * it shows an on-page prompt and keeps watching, so a wrong/missing button
   * guess degrades to "you click it yourself" instead of breaking outright.
   */
  async function grabLabels() {
    const startedAt = Date.now();
    latestCapture = null;

    const clicked = clickButtonByText(AUTO_CLICK_TEXTS);
    if (!clicked) showActionBanner("Click your usual Download Labels button — I'll catch the file.");

    let promptedManual = clicked === false;
    while (Date.now() - startedAt < TOTAL_WINDOW_MS) {
      if (latestCapture && latestCapture.capturedAt >= startedAt) {
        hideActionBanner();
        flashBadge("Labels captured — sending to Rudam…");
        return { ok: true, dataUrl: latestCapture.dataUrl, filename: latestCapture.filename };
      }
      if (!promptedManual && Date.now() - startedAt > AUTO_WINDOW_MS) {
        promptedManual = true;
        showActionBanner("Click your usual Download Labels button now — I'll catch the file.");
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    hideActionBanner();
    return {
      ok: false,
      error: "Didn't see a labels PDF download. Try clicking Download Labels yourself, right after pressing the extension button again.",
    };
  }

  /* ---------------------------- action banner ------------------------------- */
  // Bigger and more insistent than the small corner badge — this one is only
  // shown when we genuinely need you to do something, so it has to be hard to
  // miss rather than a passive status indicator.
  let bannerEl;
  function showActionBanner(text) {
    if (!bannerEl) {
      bannerEl = document.createElement("div");
      bannerEl.id = "ml-action-banner";
      Object.assign(bannerEl.style, {
        position: "fixed",
        top: "16px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 2147483647,
        background: "#f43397",
        color: "#fff",
        font: "700 13px/1.4 system-ui, sans-serif",
        padding: "12px 20px",
        borderRadius: "10px",
        boxShadow: "0 8px 24px rgba(0,0,0,.3)",
        maxWidth: "80vw",
        textAlign: "center",
      });
      document.body.appendChild(bannerEl);
    }
    bannerEl.textContent = text;
    bannerEl.style.display = "block";
  }
  function hideActionBanner() {
    if (bannerEl) bannerEl.style.display = "none";
  }

  function highlight(key) {
    const el = document.querySelector(`[data-ml-key="${CSS.escape(key)}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const old = el.style.outline;
    el.style.outline = "3px solid #f43397";
    el.style.outlineOffset = "2px";
    setTimeout(() => (el.style.outline = old), 1500);
  }

  // Initial scan to show count on the badge.
  window.addEventListener("load", () => {
    setTimeout(() => {
      try {
        const n = Scanner.scan().length;
        if (n > 0) {
          const b = ensureBadge();
          b.textContent = `Rudam Lister · ${PLATFORM_LABEL} · ${n} fields`;
        }
      } catch (_) {}
    }, 1200);
  });
})();
