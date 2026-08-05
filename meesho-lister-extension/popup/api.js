/**
 * api.js
 * -----------------------------------------------------------------------------
 * Client for the Rudam API (rudam.in). Owns authentication and template sync,
 * and is exposed on window as `MLApi`.
 *
 * Auth model: JWT. Logging in stores an access token (short-lived, 60 min) and a
 * refresh token (7 days). `authedFetch` transparently refreshes once on a 401 and
 * retries, so a popup left open overnight recovers instead of appearing logged
 * out. The server rotates refresh tokens, so the response's new refresh token is
 * always written back — dropping it would strand the session after the first
 * refresh.
 *
 * Everything template-related is business-scoped (/api/business/<id>/…) because
 * the rest of the Rudam API is: a user can belong to several businesses, and
 * templates are shared within one.
 */
(function () {
  "use strict";

  const AUTH_KEY = "ml_auth";
  const BASE_KEY = "ml_api_base";

  /* ------------------------------- storage --------------------------------- */
  function getLocal(key, fallback) {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (res) => resolve(res[key] ?? fallback));
    });
  }
  function setLocal(key, value) {
    return new Promise((resolve) => chrome.storage.local.set({ [key]: value }, resolve));
  }
  function removeLocal(key) {
    return new Promise((resolve) => chrome.storage.local.remove([key], resolve));
  }

  /* ------------------------------- API base -------------------------------- */
  /** A Settings override wins over the value baked in at download time. */
  async function getApiBase() {
    const override = (await getLocal(BASE_KEY, "")) || "";
    const baked = (self.ML_CONFIG && self.ML_CONFIG.apiBase) || "";
    return stripSlash(override || baked || "https://rudam.in");
  }
  async function setApiBase(url) {
    await setLocal(BASE_KEY, stripSlash((url || "").trim()));
  }
  function stripSlash(u) {
    return String(u).replace(/\/+$/, "");
  }

  /* --------------------------------- auth ---------------------------------- */
  /** {access, refresh, user, activeBusinessId} — or null when signed out. */
  async function getAuth() {
    return await getLocal(AUTH_KEY, null);
  }
  async function setAuth(patch) {
    const current = (await getAuth()) || {};
    const next = { ...current, ...patch };
    await setLocal(AUTH_KEY, next);
    return next;
  }
  async function isLoggedIn() {
    const auth = await getAuth();
    return !!(auth && auth.access);
  }
  async function logout() {
    await removeLocal(AUTH_KEY);
  }

  /**
   * Turn a DRF error body into one readable line.
   *
   * DRF speaks several dialects — {detail}, {error}, and
   * {field: [messages]} from serializer validation — and the popup has a single
   * toast to show, so they all have to collapse to a string.
   */
  function errorText(body, res) {
    if (!body) return `${res.status} ${res.statusText}`;
    if (typeof body === "string") return body;
    if (body.detail) return body.detail;
    if (body.error) return body.error;
    const first = Object.entries(body)[0];
    if (first) {
      const [field, msg] = first;
      const text = Array.isArray(msg) ? msg[0] : msg;
      return field === "non_field_errors" ? String(text) : `${field}: ${text}`;
    }
    return `${res.status} ${res.statusText}`;
  }

  async function parseBody(res) {
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (_) {
      return text;
    }
  }

  /** POST /api/auth/login/ then fetch the profile so we know the businesses. */
  async function login(username, password) {
    const base = await getApiBase();
    let res;
    try {
      res = await fetch(`${base}/api/auth/login/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
    } catch (e) {
      throw new Error(`Can't reach ${base}. Check the server URL in Settings.`);
    }
    const body = await parseBody(res);
    if (!res.ok) {
      // 401 here is a wrong username/password, which deserves plainer wording
      // than DRF's "No active account found with the given credentials".
      if (res.status === 401) throw new Error("Wrong username or password.");
      throw new Error(errorText(body, res));
    }

    await setAuth({ access: body.access, refresh: body.refresh });
    const user = await fetchMe();

    // Pre-select the business when there's no choice to make.
    const businesses = user.businesses || [];
    if (businesses.length === 1) await setAuth({ activeBusinessId: businesses[0].id });

    return user;
  }

  /** GET /api/auth/me/ — also the cheapest way to validate a stored token. */
  async function fetchMe() {
    const user = await authedJson("/api/auth/me/");
    await setAuth({ user });
    return user;
  }

  /** Exchange the refresh token for a fresh access token. */
  async function refreshAccess() {
    const auth = await getAuth();
    if (!auth || !auth.refresh) return false;
    const base = await getApiBase();
    let res;
    try {
      res = await fetch(`${base}/api/auth/token/refresh/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh: auth.refresh }),
      });
    } catch (_) {
      return false;
    }
    if (!res.ok) return false;
    const body = await parseBody(res);
    if (!body || !body.access) return false;
    // ROTATE_REFRESH_TOKENS is on server-side, so keep the new refresh token too.
    await setAuth({ access: body.access, refresh: body.refresh || auth.refresh });
    return true;
  }

  /* ------------------------------ requests --------------------------------- */
  /**
   * fetch with the bearer token attached, retrying once after a refresh.
   *
   * `retry` guards against a loop: if the refreshed token is also rejected we
   * clear the session and surface a "signed out" error for the popup to act on.
   */
  async function authedFetch(path, options = {}, retry = true) {
    const base = await getApiBase();
    const auth = await getAuth();
    if (!auth || !auth.access) throw new Error("Not signed in.");

    const headers = { ...(options.headers || {}), Authorization: `Bearer ${auth.access}` };
    if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";

    let res;
    try {
      res = await fetch(`${base}${path}`, { ...options, headers });
    } catch (e) {
      throw new Error(`Can't reach ${base}. Are you online?`);
    }

    if (res.status === 401 && retry) {
      if (await refreshAccess()) return authedFetch(path, options, false);
      await logout();
      const err = new Error("Session expired — please sign in again.");
      err.signedOut = true;
      throw err;
    }
    return res;
  }

  async function authedJson(path, options) {
    const res = await authedFetch(path, options);
    const body = await parseBody(res);
    if (!res.ok) throw new Error(errorText(body, res));
    return body;
  }

  /* ------------------------------ businesses ------------------------------- */
  async function getBusinesses() {
    const auth = await getAuth();
    if (auth && auth.user && auth.user.businesses) return auth.user.businesses;
    const user = await fetchMe();
    return user.businesses || [];
  }
  async function getActiveBusinessId() {
    const auth = await getAuth();
    return (auth && auth.activeBusinessId) || null;
  }
  async function setActiveBusinessId(id) {
    await setAuth({ activeBusinessId: id ? Number(id) : null });
  }

  async function businessPath(suffix) {
    const id = await getActiveBusinessId();
    if (!id) throw new Error("Pick a business first.");
    return `/api/business/${id}/${suffix}`;
  }

  /* ------------------------------- templates ------------------------------- */
  /** All templates for the active business, newest first. */
  async function listTemplates(query) {
    const qs = query ? `?q=${encodeURIComponent(query)}` : "";
    const data = await authedJson(await businessPath(`listing-templates/${qs}`));
    return (data && data.results) || [];
  }

  /** Create or overwrite by name — the server upserts, so this is idempotent. */
  async function saveTemplate({ name, fields, labels, sourceUrl }) {
    const data = await authedJson(await businessPath("listing-templates/"), {
      method: "POST",
      body: JSON.stringify({ name, fields, labels: labels || {}, source_url: sourceUrl || "" }),
    });
    return data.template;
  }

  async function updateTemplate(id, patch) {
    return await authedJson(await businessPath(`listing-templates/${id}/`), {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  }

  async function deleteTemplate(id) {
    const res = await authedFetch(await businessPath(`listing-templates/${id}/`), {
      method: "DELETE",
    });
    if (!res.ok) throw new Error(errorText(await parseBody(res), res));
  }

  /** Push a whole export file up; the server matches on name so names stay unique. */
  async function importTemplates(obj) {
    return await authedJson(await businessPath("listing-templates/import/"), {
      method: "POST",
      body: JSON.stringify({ templates: obj }),
    });
  }

  /** Pull every template in the extension's own export shape. */
  async function exportTemplates() {
    return await authedJson(await businessPath("listing-templates/export/"));
  }

  window.MLApi = {
    getApiBase,
    setApiBase,
    getAuth,
    isLoggedIn,
    login,
    logout,
    fetchMe,
    getBusinesses,
    getActiveBusinessId,
    setActiveBusinessId,
    listTemplates,
    saveTemplate,
    updateTemplate,
    deleteTemplate,
    importTemplates,
    exportTemplates,
  };
})();
