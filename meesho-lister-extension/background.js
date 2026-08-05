/**
 * background.js (service worker, type: module)
 * -----------------------------------------------------------------------------
 * Handles image generation so API calls happen off the page (avoids page CSP
 * and keeps the key out of content scripts). Supports OpenAI and Stability AI.
 * Returns a data: URL the popup can preview, download, or copy.
 */

const PROVIDERS = {
  openai: {
    url: "https://api.openai.com/v1/images/generations",
    build: ({ prompt, size, model }) => ({
      headers: { "Content-Type": "application/json" },
      auth: (key) => ({ Authorization: `Bearer ${key}` }),
      body: JSON.stringify({
        model: model || "gpt-image-1",
        prompt,
        size,
        n: 1,
      }),
    }),
    // gpt-image-1 returns b64_json; dall-e returns b64_json when requested.
    parse: async (json) => {
      const item = json && json.data && json.data[0];
      if (!item) throw new Error(json.error ? json.error.message : "No image returned");
      if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;
      if (item.url) return await urlToDataUrl(item.url);
      throw new Error("Unexpected OpenAI response");
    },
  },
  stability: {
    // Stability v2beta returns image bytes directly.
    url: "https://api.stability.ai/v2beta/stable-image/generate/core",
    build: ({ prompt }) => {
      const form = new FormData();
      form.append("prompt", prompt);
      form.append("output_format", "png");
      return {
        headers: { Accept: "image/*" },
        auth: (key) => ({ Authorization: `Bearer ${key}` }),
        body: form,
        raw: true,
      };
    },
    parse: null, // handled specially (binary)
  },
};

async function urlToDataUrl(url) {
  const res = await fetch(url);
  const blob = await res.blob();
  return await blobToDataUrl(blob);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("Failed to read image"));
    fr.onload = () => resolve(fr.result);
    fr.readAsDataURL(blob);
  });
}

async function generateImage({ prompt, size, settings }) {
  const provider = PROVIDERS[settings.provider] || PROVIDERS.openai;
  const cfg = provider.build({ prompt, size, model: settings.model });

  const headers = { ...cfg.headers, ...cfg.auth(settings.apiKey) };
  const res = await fetch(provider.url, {
    method: "POST",
    headers,
    body: cfg.body,
  });

  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const errJson = await res.json();
      if (errJson.error) detail = errJson.error.message || detail;
      else if (errJson.errors) detail = errJson.errors.join("; ");
    } catch (_) {}
    throw new Error(detail);
  }

  // Stability returns raw image bytes; OpenAI returns JSON.
  if (cfg.raw) {
    const blob = await res.blob();
    return await blobToDataUrl(blob);
  }
  const json = await res.json();
  return await provider.parse(json);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "ML_GENERATE_IMAGE") {
    generateImage(msg)
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true; // async
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("[MeeshoLister] installed");
});
