/**
 * storage.js
 * -----------------------------------------------------------------------------
 * Thin promise-based wrapper over chrome.storage.local. Exposed as `MLStore`.
 *
 * Templates are NOT stored here any more — they live on the Rudam server and are
 * owned by `MLApi` (see api.js), so the same templates follow you to any browser
 * you sign in from. What stays local is:
 *
 *   ml_settings         image-provider choice + API key (never sent to Rudam)
 *   ml_templates_cache  the last server response, per business
 *
 * The cache exists so the Templates tab paints instantly on open and still shows
 * something useful if the network is down. It is read-only: every write goes to
 * the server, because queueing offline edits would let two browsers diverge with
 * no way to reconcile them.
 */
(function () {
  "use strict";

  const SET_KEY = "ml_settings";
  const CACHE_KEY = "ml_templates_cache";

  function get(key, fallback) {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (res) => resolve(res[key] ?? fallback));
    });
  }
  function set(key, value) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, resolve);
    });
  }

  /* ------------------------------- settings -------------------------------- */
  async function getSettings() {
    return await get(SET_KEY, { provider: "openai", apiKey: "", model: "gpt-image-1" });
  }
  async function saveSettings(s) {
    const cur = await getSettings();
    await set(SET_KEY, { ...cur, ...s });
  }

  /* ---------------------------- template cache ----------------------------- */
  /**
   * Cached templates for one business, or [] when the cache is empty or belongs
   * to a different business (switching business must not show the old list).
   */
  async function getCachedTemplates(businessId) {
    const cache = await get(CACHE_KEY, null);
    if (!cache || !businessId || cache.businessId !== businessId) return [];
    return cache.items || [];
  }

  async function setCachedTemplates(businessId, items) {
    await set(CACHE_KEY, {
      businessId,
      items: items || [],
      fetchedAt: Date.now(),
    });
  }

  async function getCacheAge(businessId) {
    const cache = await get(CACHE_KEY, null);
    if (!cache || cache.businessId !== businessId) return null;
    return cache.fetchedAt || null;
  }

  async function clearCache() {
    await set(CACHE_KEY, null);
  }

  window.MLStore = {
    getSettings,
    saveSettings,
    getCachedTemplates,
    setCachedTemplates,
    getCacheAge,
    clearCache,
  };
})();
