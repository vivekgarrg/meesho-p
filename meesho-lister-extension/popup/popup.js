/**
 * popup.js
 * -----------------------------------------------------------------------------
 * Popup controller. Talks to:
 *   - the content script  (scan the page / prefill it)
 *   - the background worker (image generation)
 *   - the Rudam API via MLApi (sign-in + template sync)
 *
 * Templates are server-owned. The Templates tab paints from MLStore's cache
 * first so it never shows an empty flash, then refreshes from the server and
 * repaints. Writes go straight to the server and only touch the cache once the
 * server has confirmed them — so what you see is always something that really
 * exists in your account.
 */
(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  /** Current scan result: array of field descriptors + a live edit buffer. */
  let currentFields = [];
  let editBuffer = {}; // key -> value (what the user wants to push)
  let templates = []; // last known server list for the active business
  let activeTab = null;

  /* ------------------------------ utilities -------------------------------- */
  function toast(msg, kind) {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast " + (kind || "");
    t.classList.remove("hidden");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add("hidden"), 2400);
  }

  function show(el, visible) {
    $(el).classList.toggle("hidden", !visible);
  }

  async function activeMeeshoTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  function sendToTab(tabId, message) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, message, (resp) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(resp || { ok: false, error: "no response" });
        }
      });
    });
  }

  /**
   * Run an API call, and if the session turned out to be dead, drop back to the
   * sign-in screen instead of leaving a dead-looking UI behind.
   */
  async function guarded(fn, fallbackMsg) {
    try {
      return await fn();
    } catch (err) {
      if (err && err.signedOut) {
        await renderAuthState();
        toast(err.message, "err");
      } else {
        toast((err && err.message) || fallbackMsg || "Something went wrong", "err");
      }
      return null;
    }
  }

  /* -------------------------------- sign-in -------------------------------- */
  async function renderAuthState() {
    const base = await MLApi.getApiBase();
    $("#auth-server").textContent = base.replace(/^https?:\/\//, "");
    $("#auth-api-base").value = base;

    const loggedIn = await MLApi.isLoggedIn();
    show("#auth-gate", !loggedIn);
    show("#app-body", loggedIn);
    show("#btn-logout", loggedIn);

    if (!loggedIn) {
      $("#status-line").textContent = "Sign in to sync your templates.";
      return;
    }

    const auth = await MLApi.getAuth();
    const user = auth && auth.user;
    await renderBusinesses(user);
    refreshStatus();
    renderAccountLine(user, base);
    loadTemplates({ useCacheFirst: true });
  }

  async function doLogin() {
    const username = $("#auth-username").value.trim();
    const password = $("#auth-password").value;
    if (!username || !password) {
      return showAuthError("Enter your username and password.");
    }
    $("#btn-login").disabled = true;
    $("#btn-login").textContent = "Signing in…";
    try {
      await MLApi.login(username, password);
      $("#auth-password").value = "";
      showAuthError(null);
      await renderAuthState();
      toast("Signed in", "ok");
    } catch (err) {
      showAuthError((err && err.message) || "Sign-in failed.");
    } finally {
      $("#btn-login").disabled = false;
      $("#btn-login").textContent = "Sign in";
    }
  }

  function showAuthError(msg) {
    const el = $("#auth-error");
    el.textContent = msg || "";
    el.classList.toggle("hidden", !msg);
  }

  async function doLogout() {
    await MLApi.logout();
    await MLStore.clearCache();
    templates = [];
    currentFields = [];
    editBuffer = {};
    renderFields();
    await renderAuthState();
    toast("Signed out", "ok");
  }

  function renderAccountLine(user, base) {
    if (!user) return;
    const role = user.role === "super_admin" ? "Super admin" : "Business user";
    $("#account-line").textContent = `${user.username} · ${role} · ${base.replace(/^https?:\/\//, "")}`;
  }

  /* ------------------------------- businesses ------------------------------ */
  async function renderBusinesses(user) {
    const list = (user && user.businesses) || [];
    const select = $("#business-select");
    select.innerHTML = "";

    list.forEach((b) => {
      const opt = document.createElement("option");
      opt.value = b.id;
      opt.textContent = b.name;
      select.appendChild(opt);
    });

    let activeId = await MLApi.getActiveBusinessId();
    if (!activeId || !list.some((b) => b.id === activeId)) {
      // Nothing chosen yet, or the chosen one is no longer accessible.
      activeId = list.length ? list[0].id : null;
      await MLApi.setActiveBusinessId(activeId);
    }
    if (activeId) select.value = String(activeId);

    // With a single business there is no decision to make, so don't show a picker.
    show("#business-row", list.length > 1);
  }

  async function onBusinessChange() {
    await MLApi.setActiveBusinessId($("#business-select").value);
    templates = [];
    renderTemplates();
    await loadTemplates({ useCacheFirst: true });
  }

  /* ------------------------------ page status ------------------------------ */
  async function refreshStatus() {
    const tab = await activeMeeshoTab();
    const line = $("#status-line");
    if (!tab || !/meesho\.com/.test(tab.url || "")) {
      line.textContent = "Open a Meesho page to begin.";
      $("#btn-scan").disabled = true;
      return;
    }
    const resp = await sendToTab(tab.id, { type: "ML_PING" });
    line.textContent = resp.ok ? "Connected to Meesho ✓" : "Reload the Meesho tab to connect.";
    $("#btn-scan").disabled = false;
  }

  /* ------------------------------- tabs UI --------------------------------- */
  function initTabs() {
    $$(".tab").forEach((btn) => {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });
  }
  function switchTab(name) {
    activeTab = name;
    $$(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    $$(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === "tab-" + name));
    if (name === "templates") renderTemplates();
  }

  /* ------------------------------ FIELDS tab ------------------------------- */
  async function scanPage() {
    const tab = await activeMeeshoTab();
    if (!tab) return;
    const resp = await sendToTab(tab.id, { type: "ML_SCAN", visibleOnly: true });
    if (!resp.ok) {
      toast(resp.error || "Scan failed", "err");
      return;
    }
    currentFields = resp.fields || [];
    editBuffer = {};
    currentFields.forEach((f) => (editBuffer[f.key] = f.value));
    renderFields();
    if (currentFields.length) {
      $("#btn-fill-all").disabled = false;
      $("#btn-clear").disabled = false;
      $("#save-template-row").classList.remove("hidden");
      toast(`Detected ${currentFields.length} field(s)`, "ok");
    } else {
      toast("No editable fields found on this page", "err");
    }
  }

  function renderFields() {
    const list = $("#fields-list");
    const empty = $("#fields-empty");
    list.innerHTML = "";
    if (!currentFields.length) {
      empty.classList.remove("hidden");
      return;
    }
    empty.classList.add("hidden");
    currentFields.forEach((f) => list.appendChild(fieldCard(f)));
  }

  function fieldCard(f) {
    const card = document.createElement("div");
    card.className = "field-card";

    const head = document.createElement("div");
    head.className = "fc-head";
    head.innerHTML = `
      <span class="fc-label">${escapeHtml(f.label)} ${f.required ? '<span class="fc-req">*</span>' : ""}</span>
      <span class="fc-type">${escapeHtml(f.type)}</span>`;
    const locate = document.createElement("button");
    locate.className = "fc-locate";
    locate.textContent = "locate";
    locate.addEventListener("click", async () => {
      const tab = await activeMeeshoTab();
      sendToTab(tab.id, { type: "ML_HIGHLIGHT", key: f.key });
    });
    head.appendChild(locate);
    card.appendChild(head);

    let input;
    if (f.type === "textarea" || f.type === "contenteditable") {
      input = document.createElement("textarea");
      input.rows = 2;
    } else {
      input = document.createElement("input");
      input.type = f.type === "number" ? "number" : "text";
    }
    input.value = Array.isArray(f.value) ? f.value.join(", ") : (f.value ?? "");
    input.placeholder = f.placeholder || "";
    input.addEventListener("input", () => (editBuffer[f.key] = input.value));
    card.appendChild(input);
    return card;
  }

  async function fillAll() {
    const tab = await activeMeeshoTab();
    if (!tab) return;
    const resp = await sendToTab(tab.id, { type: "ML_APPLY", values: editBuffer });
    if (!resp.ok) return toast(resp.error || "Fill failed", "err");
    const { filled, missing } = resp.report;
    toast(`Filled ${filled.length}, skipped ${missing.length}`, "ok");
  }

  function clearFields() {
    currentFields = [];
    editBuffer = {};
    renderFields();
    $("#btn-fill-all").disabled = true;
    $("#btn-clear").disabled = true;
    $("#save-template-row").classList.add("hidden");
  }

  async function saveCurrentAsTemplate() {
    const name = $("#template-name").value.trim();
    if (!name) return toast("Enter a template name", "err");
    if (!currentFields.length) return toast("Scan a form first", "err");

    const labels = {};
    const fields = {};
    currentFields.forEach((f) => {
      labels[f.key] = f.label;
      const v = editBuffer[f.key];
      if (v !== "" && v !== null && v !== undefined) fields[f.key] = v;
    });
    if (!Object.keys(fields).length) {
      return toast("Nothing to save — every field is empty", "err");
    }

    const tab = await activeMeeshoTab();
    const btn = $("#btn-save-template");
    btn.disabled = true;
    const saved = await guarded(
      () => MLApi.saveTemplate({ name, fields, labels, sourceUrl: tab ? tab.url : "" }),
      "Could not save the template"
    );
    btn.disabled = false;
    if (!saved) return;

    $("#template-name").value = "";
    toast(`Saved "${saved.name}" to your account`, "ok");
    await loadTemplates({ useCacheFirst: false });
  }

  /* ----------------------------- TEMPLATES tab ----------------------------- */
  /**
   * Paint from cache, then fetch. `useCacheFirst` is false straight after a write,
   * where the server response is the only thing worth trusting.
   */
  async function loadTemplates({ useCacheFirst } = {}) {
    const businessId = await MLApi.getActiveBusinessId();
    if (!businessId) {
      setSyncStatus("Pick a business to load templates.");
      return;
    }

    if (useCacheFirst) {
      const cached = await MLStore.getCachedTemplates(businessId);
      if (cached.length) {
        templates = cached;
        renderTemplates();
        const at = await MLStore.getCacheAge(businessId);
        setSyncStatus(`Showing saved copy from ${when(at)} — refreshing…`);
      } else {
        setSyncStatus("Loading from your account…");
      }
    } else {
      setSyncStatus("Syncing…");
    }

    const fresh = await guarded(() => MLApi.listTemplates(), "Could not load templates");
    if (fresh === null) {
      // Offline or the call failed — keep whatever the cache gave us and say so.
      setSyncStatus(templates.length ? "Offline — showing the last saved copy." : "Could not reach the server.");
      return;
    }
    templates = fresh;
    await MLStore.setCachedTemplates(businessId, fresh);
    renderTemplates();
    setSyncStatus(`${fresh.length} template(s) synced just now.`);
  }

  function when(ts) {
    if (!ts) return "earlier";
    const mins = Math.round((Date.now() - ts) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} min ago`;
    return new Date(ts).toLocaleString();
  }

  function setSyncStatus(text) {
    $("#sync-status").textContent = text || "";
  }

  function renderTemplates() {
    const q = ($("#template-search").value || "").toLowerCase();
    const list = $("#templates-list");
    const empty = $("#templates-empty");
    list.innerHTML = "";
    const items = templates.filter((t) => (t.name || "").toLowerCase().includes(q));
    if (!items.length) {
      empty.classList.remove("hidden");
      return;
    }
    empty.classList.add("hidden");
    items.forEach((t) => list.appendChild(templateCard(t)));
  }

  function templateCard(t) {
    const card = document.createElement("div");
    card.className = "tpl-card";
    const count = t.field_count ?? Object.keys(t.fields || {}).length;
    const when = t.updated_at ? new Date(t.updated_at).toLocaleString() : "";
    const who = t.updated_by_name || t.created_by_name;
    card.innerHTML = `
      <div class="tpl-name">${escapeHtml(t.name)}</div>
      <div class="tpl-meta">${count} field(s) · updated ${escapeHtml(when)}${
      who ? " · by " + escapeHtml(who) : ""
    }</div>`;
    const actions = document.createElement("div");
    actions.className = "tpl-actions";

    const applyBtn = mkBtn("Apply", "btn primary", () => applyTemplate(t));
    const loadBtn = mkBtn("Load to Fields", "btn ghost", () => loadTemplateToFields(t));
    const delBtn = mkBtn("Delete", "btn danger", async () => {
      if (!confirm(`Delete "${t.name}" from your account? This affects everyone in this business.`)) return;
      const ok = await guarded(() => MLApi.deleteTemplate(t.id), "Could not delete");
      if (ok === null) return;
      toast("Deleted", "ok");
      await loadTemplates({ useCacheFirst: false });
    });
    actions.append(applyBtn, loadBtn, delBtn);
    card.appendChild(actions);
    return card;
  }

  /**
   * A list response may omit field values (?full=0), and the cache can predate a
   * change, so re-read the template before writing it to a page.
   */
  async function withFields(t) {
    if (t.fields && Object.keys(t.fields).length) return t;
    const fresh = await guarded(() => MLApi.listTemplates(), "Could not load that template");
    if (!fresh) return null;
    return fresh.find((x) => x.id === t.id) || t;
  }

  async function applyTemplate(t) {
    const tab = await activeMeeshoTab();
    if (!tab || !/meesho\.com/.test(tab.url || "")) {
      return toast("Open a Meesho form tab first", "err");
    }
    const full = await withFields(t);
    if (!full) return;
    const resp = await sendToTab(tab.id, { type: "ML_APPLY", values: full.fields });
    if (!resp.ok) return toast(resp.error || "Apply failed", "err");
    toast(`Applied "${full.name}" — ${resp.report.filled.length} field(s)`, "ok");
  }

  async function loadTemplateToFields(t) {
    const full = await withFields(t);
    if (!full) return;
    currentFields = Object.entries(full.fields || {}).map(([key, value]) => ({
      key,
      label: (full.labels && full.labels[key]) || key,
      type: Array.isArray(value) ? "select" : "text",
      value,
      required: false,
      placeholder: "",
    }));
    editBuffer = { ...(full.fields || {}) };
    switchTab("fields");
    renderFields();
    $("#btn-fill-all").disabled = false;
    $("#btn-clear").disabled = false;
    $("#save-template-row").classList.remove("hidden");
    $("#template-name").value = full.name;
    toast(`Loaded "${full.name}" — review then Prefill all`, "ok");
  }

  /** Download every template as a file — a backup, or a hand-off to another account. */
  async function exportTemplates() {
    const payload = await guarded(() => MLApi.exportTemplates(), "Export failed");
    if (!payload) return;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `meesho-templates-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`Exported ${Object.keys(payload).length} template(s)`, "ok");
  }

  function importTemplatesFromFile(file) {
    const reader = new FileReader();
    reader.onload = async () => {
      let obj;
      try {
        obj = JSON.parse(reader.result);
      } catch (e) {
        return toast("That file isn't valid JSON", "err");
      }
      const res = await guarded(() => MLApi.importTemplates(obj), "Import failed");
      if (!res) return;
      const bits = [`${res.created} new`, `${res.updated} updated`];
      if (res.skipped) bits.push(`${res.skipped} skipped`);
      toast(`Imported — ${bits.join(", ")}`, "ok");
      await loadTemplates({ useCacheFirst: false });
    };
    reader.readAsText(file);
  }

  /* ------------------------------ IMAGES tab ------------------------------- */
  let lastImageDataUrl = null;

  async function generateImage() {
    const prompt = $("#img-prompt").value.trim();
    if (!prompt) return toast("Enter a prompt", "err");
    const settings = await MLStore.getSettings();
    if (!settings.apiKey) {
      switchTab("settings");
      return toast("Add your API key in Settings first", "err");
    }
    const size = $("#img-size").value;
    $("#img-status").textContent = "Generating… this can take ~10–20s.";
    $("#btn-generate").disabled = true;

    const resp = await chrome.runtime.sendMessage({
      type: "ML_GENERATE_IMAGE",
      prompt,
      size,
      settings,
    });

    $("#btn-generate").disabled = false;
    if (!resp || !resp.ok) {
      $("#img-status").textContent = "";
      return toast((resp && resp.error) || "Generation failed", "err");
    }
    lastImageDataUrl = resp.dataUrl;
    $("#img-preview").src = resp.dataUrl;
    $("#img-result").classList.remove("hidden");
    $("#img-status").textContent = "Done. Download or copy below.";
    toast("Image generated", "ok");
  }

  function downloadImage() {
    if (!lastImageDataUrl) return;
    chrome.downloads.download({
      url: lastImageDataUrl,
      filename: `meesho-image-${Date.now()}.png`,
    });
  }

  async function copyImage() {
    if (!lastImageDataUrl) return;
    try {
      const blob = await (await fetch(lastImageDataUrl)).blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      toast("Copied to clipboard", "ok");
    } catch (e) {
      toast("Copy not supported here — use Download", "err");
    }
  }

  /* ----------------------------- SETTINGS tab ------------------------------ */
  async function loadSettings() {
    const s = await MLStore.getSettings();
    $("#api-provider").value = s.provider || "openai";
    $("#api-key").value = s.apiKey || "";
    $("#api-model").value = s.model || "gpt-image-1";
    $("#set-api-base").value = await MLApi.getApiBase();
  }

  async function saveSettings() {
    await MLStore.saveSettings({
      provider: $("#api-provider").value,
      apiKey: $("#api-key").value.trim(),
      model: $("#api-model").value.trim() || "gpt-image-1",
    });
    $("#settings-status").textContent = "Saved ✓";
    toast("Settings saved", "ok");
  }

  /**
   * Point the extension at a different server. Tokens are only valid on the
   * server that issued them, so this necessarily ends the session.
   */
  async function saveApiBase(inputSel) {
    const raw = $(inputSel).value.trim();
    if (!/^https?:\/\/.+/i.test(raw)) {
      return toast("Enter a full URL, e.g. https://rudam.in", "err");
    }
    const previous = await MLApi.getApiBase();
    await MLApi.setApiBase(raw);
    if (stripTrailing(raw) !== previous) {
      await MLApi.logout();
      await MLStore.clearCache();
      templates = [];
    }
    show("#server-row", false);
    await renderAuthState();
    await loadSettings();
    toast("Server updated", "ok");
  }

  function stripTrailing(u) {
    return String(u).replace(/\/+$/, "");
  }

  /* ------------------------------- helpers --------------------------------- */
  function mkBtn(text, cls, onClick) {
    const b = document.createElement("button");
    b.className = cls;
    b.textContent = text;
    b.addEventListener("click", onClick);
    return b;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  /* --------------------------------- init ---------------------------------- */
  function bind() {
    // sign-in
    $("#btn-login").addEventListener("click", doLogin);
    $("#auth-password").addEventListener("keydown", (e) => {
      if (e.key === "Enter") doLogin();
    });
    $("#auth-username").addEventListener("keydown", (e) => {
      if (e.key === "Enter") $("#auth-password").focus();
    });
    $("#btn-logout").addEventListener("click", doLogout);
    $("#link-change-server").addEventListener("click", (e) => {
      e.preventDefault();
      const row = $("#server-row");
      row.classList.toggle("hidden");
    });
    $("#btn-save-server").addEventListener("click", () => saveApiBase("#auth-api-base"));
    $("#business-select").addEventListener("change", onBusinessChange);

    // fields
    $("#btn-scan").addEventListener("click", scanPage);
    $("#btn-fill-all").addEventListener("click", fillAll);
    $("#btn-clear").addEventListener("click", clearFields);
    $("#btn-save-template").addEventListener("click", saveCurrentAsTemplate);

    // templates
    $("#template-search").addEventListener("input", renderTemplates);
    $("#btn-refresh").addEventListener("click", () => loadTemplates({ useCacheFirst: false }));
    $("#btn-export").addEventListener("click", exportTemplates);
    $("#btn-import").addEventListener("click", () => $("#import-file").click());
    $("#import-file").addEventListener("change", (e) => {
      if (e.target.files[0]) importTemplatesFromFile(e.target.files[0]);
      e.target.value = ""; // let the same file be picked again
    });

    // images
    $("#btn-generate").addEventListener("click", generateImage);
    $("#btn-download-img").addEventListener("click", downloadImage);
    $("#btn-copy-img").addEventListener("click", copyImage);

    // settings
    $("#btn-save-settings").addEventListener("click", saveSettings);
    $("#btn-save-api-base").addEventListener("click", () => saveApiBase("#set-api-base"));
    $("#api-provider").addEventListener("change", () => {
      $("#api-model").value = $("#api-provider").value === "openai" ? "gpt-image-1" : "sd3-medium";
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    initTabs();
    bind();
    await loadSettings();
    await renderAuthState();
  });
})();
