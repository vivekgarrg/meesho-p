/**
 * labelSniffer.js
 * -----------------------------------------------------------------------------
 * Runs in the page's own JS world (manifest "world": "MAIN"), not the isolated
 * content-script world — this is what lets it see the exact same network
 * responses the page's own React code sees, using the page's own already-
 * authenticated session. It captures nothing on its own; it only reports a
 * captured PDF up to content.js (via window.postMessage — the two worlds
 * share the same document, so that's the standard bridge between them).
 *
 * Two capture strategies, because we don't know which one Meesho's "download
 * labels" button actually uses, and can't find out without a real login:
 *
 *   1. fetch()/XHR interception — for a React-style button that fetches the
 *      PDF via JS and hands the bytes to the page itself.
 *   2. <a href="....pdf" download> click interception — for a plain-link
 *      style download, which never goes through fetch/XHR at all (the
 *      browser's own network stack handles it, invisibly to page JS) unless
 *      we intercept the click and fetch it ourselves instead of letting the
 *      browser navigate to it.
 *
 * Either path ends the same way: read the response as a Blob, base64-encode
 * it (postMessage can't carry a Blob across worlds in every Chrome version,
 * so a data URL is the safe common denominator), and post it up.
 */
(function () {
  "use strict";

  const PDF_URL_HINT = /label|shipping/i;

  function looksLikePdfResponse(contentType, url) {
    if (contentType && contentType.toLowerCase().includes("pdf")) return true;
    if (url && PDF_URL_HINT.test(url) && /\.pdf(\?|$)/i.test(url)) return true;
    return false;
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function filenameFromUrl(url) {
    try {
      const path = new URL(url, location.href).pathname;
      return path.split("/").pop() || "labels.pdf";
    } catch {
      return "labels.pdf";
    }
  }

  async function reportCapture(blob, url) {
    try {
      const dataUrl = await blobToDataUrl(blob);
      window.postMessage(
        { source: "ml-label-sniffer", type: "ML_PDF_CAPTURED", dataUrl, filename: filenameFromUrl(url) },
        "*"
      );
    } catch (e) {
      // Nothing to do — content.js's own timeout will surface as "not captured".
      console.warn("[RudamLister] failed to encode captured PDF", e);
    }
  }

  /* ------------------------------ fetch() ----------------------------------- */
  const nativeFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await nativeFetch.apply(this, args);
    try {
      const url = typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || "";
      const contentType = res.headers.get("content-type") || "";
      if (looksLikePdfResponse(contentType, url)) {
        // Clone before reading — the page's own code still needs to consume
        // the original response body exactly as it normally would.
        res.clone().blob().then((blob) => reportCapture(blob, url));
      }
    } catch (_) {
      /* never let sniffing break the page's real request */
    }
    return res;
  };

  /* -------------------------------- XHR --------------------------------- */
  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__mlUrl = url;
    return nativeOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", () => {
      try {
        const contentType = this.getResponseHeader("content-type") || "";
        if (!looksLikePdfResponse(contentType, this.__mlUrl)) return;
        if (this.response instanceof Blob) {
          reportCapture(this.response, this.__mlUrl);
        } else if (typeof this.response === "string") {
          reportCapture(new Blob([this.response], { type: contentType || "application/pdf" }), this.__mlUrl);
        }
      } catch (_) {
        /* ignore */
      }
    });
    return nativeSend.apply(this, args);
  };

  /* --------------------------- plain <a> downloads ------------------------- */
  // Capturing phase so we see the click before the browser starts a native
  // download for it — a native download's bytes are invisible to page JS, so
  // this is the only way to grab a plain-link-style "Download Labels" button.
  document.addEventListener(
    "click",
    (event) => {
      const anchor = event.target && event.target.closest && event.target.closest("a[href]");
      if (!anchor) return;
      const href = anchor.href || "";
      if (!(/\.pdf(\?|$)/i.test(href) || (anchor.hasAttribute("download") && PDF_URL_HINT.test(href)))) return;

      event.preventDefault();
      event.stopPropagation();
      nativeFetch(href, { credentials: "include" })
        .then((res) => res.blob())
        .then((blob) => reportCapture(blob, href))
        .catch((e) => console.warn("[RudamLister] could not fetch label link", e));
    },
    true
  );
})();
