/**
 * fieldScanner.js
 * -----------------------------------------------------------------------------
 * Shared, framework-agnostic field detection for the Meesho and Flipkart
 * Seller Hub listing forms.
 *
 * Both are React apps whose DOM (ids, class names) is minified and changes
 * between deploys. Hardcoding selectors is brittle, so we derive a *stable
 * logical key* for every editable field from human-facing signals (associated
 * <label>, aria-label, placeholder, name) that tend to survive redesigns and
 * differ from one site to the other anyway. Templates are keyed on that
 * logical key, not on DOM paths, and naturally only match the site (and
 * often the exact form) they were captured on.
 *
 * Exposed on window as `MeeshoFieldScanner` (no modules in content scripts).
 */
(function () {
  "use strict";

  const EDITABLE_SELECTOR = [
    "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=file]):not([type=image]):not([type=reset])",
    "textarea",
    "select",
    "[contenteditable='true']",
    "[role='combobox']",
    "[role='listbox']",
    "[role='textbox']",
    "[aria-haspopup='listbox']",
    "[aria-haspopup='menu']",
    "[aria-haspopup='true']",
  ].join(",");

  const SKIP_INPUT_TYPES = new Set(["password"]);

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function normalize(text) {
    return (text || "")
      .replace(/\s+/g, " ")
      .replace(/[*:]+$/g, "")
      .trim();
  }

  /** Best-effort human label for an element. */
  function deriveLabel(el) {
    // 1. aria-label
    if (el.getAttribute("aria-label")) return normalize(el.getAttribute("aria-label"));

    // 2. aria-labelledby
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const parts = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((n) => normalize(n.textContent));
      if (parts.length) return parts.join(" ");
    }

    // 3. <label for=id>
    if (el.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl) return normalize(lbl.textContent);
    }

    // 4. wrapping <label>
    const wrapping = el.closest("label");
    if (wrapping) {
      const clone = wrapping.cloneNode(true);
      clone.querySelectorAll("input,textarea,select").forEach((n) => n.remove());
      const t = normalize(clone.textContent);
      if (t) return t;
    }

    // 5. label-ish text in an ancestor's subtree, widening one hop at a time.
    // A single closest-container check (the old behaviour here) misses
    // layouts like Meesho's, where the label and the input are cousins —
    // both children of a shared row div several levels up, not direct
    // neighbours — so an unnamed field (e.g. the Size dropdown, which has no
    // `name` attribute at all) fell through to "Select" or worse a volatile
    // auto id. Each hop searches the whole subtree of one more ancestor and
    // stops at the first one that finds real text, so the closest genuine
    // label still wins; capped well short of the document to avoid ever
    // matching unrelated page content.
    let group = el.parentElement;
    for (let hops = 0; group && hops < 6 && group !== document.body; hops++, group = group.parentElement) {
      const candidates = group.querySelectorAll("label,span,p,div");
      for (const c of candidates) {
        if (c.contains(el)) continue;
        const t = normalize(c.textContent);
        if (t && t.length <= 60 && /[a-zA-Z]/.test(t)) return t;
      }
    }

    // 6. placeholder / name fallback
    if (el.getAttribute("placeholder")) return normalize(el.getAttribute("placeholder"));
    if (el.getAttribute("name")) return normalize(el.getAttribute("name"));
    return "";
  }

  // Ids that are runtime-generated rather than authored, so they renumber
  // between page loads and can't be trusted as a stable key:
  //   - bare counters like "field123" (letters + 3-or-more digits, no separator)
  //   - MUI's own auto id scheme, "mui-17", "mui-142", etc. — this is the one
  //     Meesho's un-named dropdowns (e.g. the Size field) actually use, and
  //     keying on it is why such a field would stop matching a saved template
  //     the moment something else on the page mounts in a different order.
  const VOLATILE_ID = /^(?:[a-z]*\d{3,}|mui-\d+)$/i;

  /** Stable logical key used to match a saved value back to a field. */
  function deriveKey(el, label) {
    const name = el.getAttribute("name");
    if (name) return "name:" + name.toLowerCase();
    if (el.id && !VOLATILE_ID.test(el.id)) return "id:" + el.id.toLowerCase();
    if (label) return "label:" + label.toLowerCase();
    const ph = el.getAttribute("placeholder");
    if (ph) return "ph:" + normalize(ph).toLowerCase();
    return "auto:" + cssPath(el);
  }

  function cssPath(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 5) {
      let part = node.nodeName.toLowerCase();
      if (node.id) {
        part += "#" + node.id;
        parts.unshift(part);
        break;
      }
      const parent = node.parentNode;
      if (parent) {
        const sameTag = Array.from(parent.children).filter((c) => c.nodeName === node.nodeName);
        if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = node.parentNode;
    }
    return parts.join(">");
  }

  /**
   * Meesho's "select" fields are React widgets, not <select>. They render as a
   * div/button (often role=combobox/listbox, or just a styled box) that opens a
   * separate option list — sometimes in a portal at the end of <body>. We treat
   * anything that isn't a real input/textarea/select but still looks pickable as
   * a custom dropdown so it can be read and filled by interaction.
   */
  const DROPDOWN_ROLES = new Set(["combobox", "listbox"]);
  const DROPDOWN_HINT = /(select|dropdown|combobox|picker|menu)/i;

  function isCustomDropdown(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return false;
    const role = (el.getAttribute("role") || "").toLowerCase();
    if (DROPDOWN_ROLES.has(role)) return true;
    if (el.getAttribute("aria-haspopup")) return true;
    const cls = el.getAttribute("class") || "";
    return DROPDOWN_HINT.test(cls) || DROPDOWN_HINT.test(el.id || "");
  }

  /**
   * Meesho's MUI "Select" renders as a *readonly* text <input> that opens a
   * portal menu on click (e.g. supplier_gst_percent). A readonly input you
   * can't type into is, for our purposes, a dropdown trigger — not a text box.
   */
  function isDropdownInput(el) {
    if (el.tagName.toLowerCase() !== "input") return false;
    const type = (el.getAttribute("type") || "text").toLowerCase();
    if (!(type === "text" || type === "search" || type === "")) return false;
    if (el.disabled) return false;
    if (el.hasAttribute("readonly") || el.getAttribute("aria-readonly") === "true") return true;
    if (el.getAttribute("aria-haspopup")) return true;
    const role = (el.getAttribute("role") || "").toLowerCase();
    if (DROPDOWN_ROLES.has(role)) return true;
    // Ancestor declares a dropdown variant (Meesho's MUI wrapper).
    if (el.closest('[labeltextinputvariant="DROPDOWN"],[role="combobox"]')) return true;
    return false;
  }

  function fieldType(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === "select") return "select";
    if (tag === "textarea") return "textarea";
    if (el.getAttribute("contenteditable") === "true") return "contenteditable";
    if (isCustomDropdown(el) || isDropdownInput(el)) return "combobox";
    const t = (el.getAttribute("type") || "text").toLowerCase();
    return t;
  }

  /** Text currently shown by a custom dropdown (its selected label), if any. */
  function readDropdownDisplay(el) {
    // The MUI dropdown trigger is the readonly input itself — its value is the label.
    if (el.tagName.toLowerCase() === "input") return el.value || "";
    // A search-style combobox holds the value on a nested input.
    const inner = el.querySelector && el.querySelector("input");
    if (inner && inner.value) return inner.value;
    const placeholder = normalize(el.getAttribute("placeholder") || "");
    const text = normalize(el.innerText || el.textContent || "");
    // Don't report the placeholder ("Select category") as a real value.
    if (!text || (placeholder && text === placeholder)) return "";
    return text;
  }

  function readValue(el) {
    const type = fieldType(el);
    if (type === "checkbox" || type === "radio") return el.checked ? (el.value || "on") : "";
    if (type === "contenteditable") return el.innerText;
    if (type === "select") {
      const opts = Array.from(el.selectedOptions || []).map((o) => o.value || o.text);
      return el.multiple ? opts : (opts[0] ?? el.value);
    }
    if (type === "combobox") return readDropdownDisplay(el);
    return el.value;
  }

  /**
   * React/Meesho controls track value internally, so a naive `el.value = x`
   * is silently overwritten on the next render. We use the native setter and
   * dispatch input/change so React's onChange fires.
   */
  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
  }

  function fireEvents(el) {
    ["input", "change", "blur"].forEach((type) => {
      el.dispatchEvent(new Event(type, { bubbles: true }));
    });
    el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** A full pointer+mouse click sequence React dropdowns actually listen for. */
  function simulateClick(el) {
    const opts = { bubbles: true, cancelable: true, view: window };
    ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((t) => {
      const Ctor = t.startsWith("pointer") && window.PointerEvent ? PointerEvent : MouseEvent;
      el.dispatchEvent(new Ctor(t, opts));
    });
  }

  const stripNonAlnum = (s) => normalize(s).toLowerCase().replace(/[^a-z0-9]+/gi, "");

  const UNIT_WORDS = /\b(cm|mm|kg|gms?|g|ml|l|inch(?:es)?|in|m|pcs?|percent|%)\b/gi;
  /** A pure-number label ("45", "45 cm", "10.5%") -> its numeric value, else null. */
  function numericForm(s) {
    const t = normalize(s).toLowerCase().replace(UNIT_WORDS, "").replace(/[,\s]/g, "");
    return /^\d+(\.\d+)?$/.test(t) ? parseFloat(t) : null;
  }

  /**
   * Score a candidate label/value against the wanted value. Higher = better.
   *   3 exact (numeric equality for number lists, else exact text/data-value)
   *   2 exact ignoring punctuation/case ("5 %" == "5%")
   *   1 whole-token match ("Red" in "Red / Maroon")
   *   0 no match
   * NO substring/startsWith (that made "5%" pick "15%"); numbers compare
   * numerically so "45" never matches "4.5".
   */
  function scoreText(text, dataVal, wanted) {
    const t = normalize(text).toLowerCase();
    const d = normalize(dataVal).toLowerCase();
    const w = normalize(wanted).toLowerCase();
    if (!w || (!t && !d)) return 0;

    const wNum = numericForm(w);
    if (wNum !== null) {
      const tNum = numericForm(t);
      const dNum = numericForm(d);
      if (tNum !== null || dNum !== null) return tNum === wNum || dNum === wNum ? 3 : 0;
    }

    if (t === w || d === w) return 3;
    const ws = stripNonAlnum(w);
    if (ws && (stripNonAlnum(t) === ws || stripNonAlnum(d) === ws)) return 2;
    const tokens = t.split(/[^a-z0-9]+/i).filter(Boolean);
    if (tokens.includes(w)) return 1;
    return 0;
  }

  function scoreOption(optionEl, wanted) {
    return scoreText(
      optionEl.innerText || optionEl.textContent,
      optionEl.getAttribute("data-value") || "",
      wanted
    );
  }

  /** Best option from a list. Returns {el, score, unique} or null. */
  function bestOption(options, wanted) {
    let best = null;
    let bestCount = 0;
    options.forEach((o) => {
      const score = scoreOption(o, wanted);
      if (score === 0) return;
      if (!best || score > best.score) {
        best = { el: o, score };
        bestCount = 1;
      } else if (score === best.score) {
        bestCount++;
      }
    });
    if (best) best.unique = bestCount === 1;
    return best;
  }

  /** Read the authoritative option list from Meesho's MUI wrapper, if present. */
  function getConfiguredOptions(el) {
    const host = el.closest && el.closest("[menuoptions]");
    if (!host) return null;
    const raw = host.getAttribute("menuoptions") || "";
    const arr = raw.split(",").map((s) => s.trim()).filter(Boolean);
    return arr.length ? arr : null;
  }

  /** Find the scrollable container holding the currently open option list. */
  function currentListbox(options) {
    for (const o of options) {
      const lb = o.closest("ul,[role='listbox'],.MuiMenu-list,.MuiList-root");
      if (lb && lb.scrollHeight > lb.clientHeight + 2) return lb;
    }
    // Walk up from the first option to any scrollable ancestor.
    let n = options[0] && options[0].parentElement;
    while (n && n !== document.body) {
      const oy = window.getComputedStyle(n).overflowY;
      if (n.scrollHeight > n.clientHeight + 2 && /(auto|scroll|overlay)/.test(oy)) return n;
      n = n.parentElement;
    }
    return null;
  }

  /** React-controlled <select>: drive through the native value setter. */
  function writeNativeSelect(el, value) {
    const wanted = (Array.isArray(value) ? value : [value]).map((v) => normalize(String(v)).toLowerCase());
    let matched = false;
    let lastVal = null;
    Array.from(el.options).forEach((o) => {
      const hit =
        wanted.includes(normalize(o.value).toLowerCase()) ||
        wanted.includes(normalize(o.text).toLowerCase());
      o.selected = hit;
      if (hit) {
        matched = true;
        lastVal = o.value;
      }
    });
    if (matched && !el.multiple && lastVal !== null) setNativeValue(el, lastVal);
    fireEvents(el);
    return matched;
  }

  /** Collect candidate option nodes from any open dropdown/listbox/menu (incl. MUI portals). */
  function collectOpenOptions() {
    const sel = [
      "[role='option']",
      "[role='listbox'] li",
      "[role='menu'] [role='menuitem']",
      ".MuiMenuItem-root",            // MUI Select / Menu items
      ".MuiAutocomplete-option",      // MUI Autocomplete
      ".MuiMenu-list li",
      ".MuiPopover-root li",
      "ul[class*='option'] li",
      "ul[class*='menu'] li",
      "[class*='option']",
      "[class*='dropdown'] li",
    ].join(",");
    // De-dupe (selectors overlap) and keep only visible nodes.
    return Array.from(new Set(document.querySelectorAll(sel))).filter(isVisible);
  }

  /**
   * Find the matching option in an open (possibly virtualized) menu.
   * Strategy: if we know the full option list, jump the scroll roughly to the
   * target's position so the virtual list renders it; then sweep top→bottom to
   * guarantee every row is seen. Keep the best-scoring match across the sweep
   * and stop early on an exact (score 3) hit.
   */
  async function locateOption(want, initialOpts, configured) {
    let opts = initialOpts && initialOpts.length ? initialOpts : collectOpenOptions();
    let best = bestOption(opts, want);
    if (best && best.score === 3) return best;

    const listbox = currentListbox(opts);
    if (!listbox) {
      // Short, non-virtualized list — just poll a little for late renders.
      for (let i = 0; i < 10 && !(best && best.score === 3); i++) {
        await sleep(70);
        const r = bestOption(collectOpenOptions(), want);
        if (r && (!best || r.score > best.score)) best = r;
      }
      return best;
    }

    const maxScroll = () => Math.max(0, listbox.scrollHeight - listbox.clientHeight);

    // Targeted jump using the authoritative option order.
    if (configured && configured.length > 1) {
      const idx = configured.findIndex((v) => scoreText(v, v, want) >= 2);
      if (idx >= 0) {
        listbox.scrollTop = Math.round((idx / (configured.length - 1)) * maxScroll());
        await sleep(90);
        const r = bestOption(collectOpenOptions(), want);
        if (r && r.score === 3) return r;
        if (r && (!best || r.score > best.score)) best = r;
      }
    }

    // Full sweep top→bottom with overlap so no virtualized row is skipped.
    listbox.scrollTop = 0;
    await sleep(60);
    let lastTop = -1;
    const step = Math.max(listbox.clientHeight * 0.6, 40);
    for (let guard = 0; guard < 150; guard++) {
      const r = bestOption(collectOpenOptions(), want);
      if (r && r.score === 3) return r;
      if (r && (!best || r.score > best.score)) best = r;
      if (listbox.scrollTop === lastTop) break; // can't scroll further → reached bottom
      lastTop = listbox.scrollTop;
      listbox.scrollTop = Math.min(listbox.scrollTop + step, maxScroll());
      await sleep(55);
    }
    return best;
  }

  /** Open a custom dropdown and click the option whose label matches `wanted`. */
  async function pickFromDropdown(el, wanted) {
    const want = normalize(String(wanted));
    if (!want) return false;

    const isInput = el.tagName.toLowerCase() === "input";
    // MUI attaches the open handler to the InputBase wrapper; click input + wrapper.
    const wrapper = el.closest(".MuiInputBase-root,.MuiFormControl-root") || el;
    el.focus && el.focus();
    simulateClick(el);
    if (wrapper !== el) simulateClick(wrapper);

    // Searchable (non-readonly) comboboxes filter as you type; readonly MUI
    // selects must not be typed into — just rely on the opened menu.
    const search = isInput
      ? (el.hasAttribute("readonly") || el.getAttribute("aria-readonly") === "true" ? null : el)
      : el.querySelector("input:not([type=hidden]):not([readonly])");
    if (search) {
      setNativeValue(search, want);
      fireEvents(search);
    }

    // Wait for the menu to actually open.
    let opts = [];
    for (let i = 0; i < 12 && !opts.length; i++) {
      await sleep(70);
      opts = collectOpenOptions();
    }

    const configured = getConfiguredOptions(el); // authoritative full option list
    const best = await locateOption(want, opts, configured);

    // Accept exact (3) and punctuation-insensitive (2) matches. A weak token
    // match (1) is only trustworthy when it's the single candidate — otherwise
    // bail rather than fill the wrong value.
    const acceptable = best && (best.score >= 2 || (best.score === 1 && best.unique));
    if (!acceptable) {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      return false;
    }
    // A virtualized row can unmount after the sweep — re-acquire a live node
    // for the same match before clicking, so the click lands on a real element.
    let target = best.el;
    if (!target.isConnected) {
      const live = bestOption(collectOpenOptions(), want);
      if (!live || live.score < best.score) {
        el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        return false;
      }
      target = live.el;
    }
    target.scrollIntoView({ block: "nearest" });
    simulateClick(target);
    fireEvents(el);
    await sleep(60); // let the menu close before the next field opens
    return true;
  }

  async function writeCustomDropdown(el, value) {
    const values = Array.isArray(value) ? value : [value];
    let ok = false;
    for (const v of values) {
      if (await pickFromDropdown(el, v)) ok = true;
    }
    return ok;
  }

  /** Apply one value to one element. Async because dropdowns need interaction. */
  async function writeValue(el, value) {
    const type = fieldType(el);
    try {
      if (type === "checkbox") {
        el.checked = Boolean(value);
        fireEvents(el);
        return true;
      }
      if (type === "radio") {
        el.checked = el.value === value || Boolean(value);
        fireEvents(el);
        return true;
      }
      if (type === "contenteditable") {
        el.focus();
        el.innerText = value ?? "";
        fireEvents(el);
        return true;
      }
      if (type === "select") {
        return writeNativeSelect(el, value);
      }
      if (type === "combobox") {
        return await writeCustomDropdown(el, value);
      }
      el.focus();
      setNativeValue(el, value ?? "");
      fireEvents(el);
      return true;
    } catch (e) {
      console.warn("[MeeshoLister] write failed", e);
      return false;
    }
  }

  /** Returns the list of detected fields with metadata. */
  function scan(options = {}) {
    const { visibleOnly = true } = options;
    const nodes = Array.from(document.querySelectorAll(EDITABLE_SELECTOR));
    const seenKeys = new Map();
    const fields = [];

    nodes.forEach((el, index) => {
      const type = fieldType(el);
      if (SKIP_INPUT_TYPES.has(type)) return;
      if (visibleOnly && !isVisible(el)) return;

      const label = deriveLabel(el);
      let key = deriveKey(el, label);
      // De-dupe identical keys (e.g. radio groups, repeated rows)
      if (seenKeys.has(key)) {
        const n = seenKeys.get(key) + 1;
        seenKeys.set(key, n);
        key = `${key}#${n}`;
      } else {
        seenKeys.set(key, 0);
      }

      el.dataset.mlKey = key; // tag so we can rewrite later

      fields.push({
        key,
        label: label || `Field ${index + 1}`,
        type,
        value: readValue(el),
        required: el.required || el.getAttribute("aria-required") === "true",
        placeholder: el.getAttribute("placeholder") || "",
      });
    });

    return fields;
  }

  /**
   * Apply a {key: value} map back onto the live DOM. Returns a report.
   * Async + sequential: custom dropdowns open a shared portal menu, so filling
   * them one at a time avoids two open menus fighting over the same option list.
   */
  async function apply(values) {
    scan({ visibleOnly: false }); // re-tag current DOM
    const report = { filled: [], missing: [] };
    for (const [key, value] of Object.entries(values || {})) {
      if (value === "" || value === null || value === undefined) continue;
      const el = document.querySelector(`[data-ml-key="${CSS.escape(key)}"]`);
      if (el && (await writeValue(el, value))) report.filled.push(key);
      else report.missing.push(key);
    }
    return report;
  }

  window.MeeshoFieldScanner = { scan, apply, readValue, writeValue };
})();
