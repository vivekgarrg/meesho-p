/**
 * content.js
 * -----------------------------------------------------------------------------
 * Message bridge between the popup and the live Meesho page.
 * Delegates the heavy lifting to window.MeeshoFieldScanner (fieldScanner.js,
 * injected just before this file per manifest order).
 *
 * Also draws a small floating badge so the user knows the extension is live and
 * how many fields were detected on the current page.
 */
(function () {
  "use strict";

  const Scanner = window.MeeshoFieldScanner;
  if (!Scanner) {
    console.warn("[MeeshoLister] field scanner not loaded");
    return;
  }

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
    badgeEl.textContent = "Meesho Lister";
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
          b.textContent = `Meesho Lister · ${n} fields`;
        }
      } catch (_) {}
    }, 1200);
  });
})();
