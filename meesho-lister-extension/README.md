# Meesho Dynamic Lister — Chrome Extension

A Manifest V3 Chrome extension that **auto-detects the fields on any Meesho listing/catalog form**, lets you **save those values as named, reusable templates on your Rudam account**, **prefills an entire form in one click**, and **generates product images** from a text prompt.

Built to be resilient to Meesho UI changes: nothing is hardcoded to specific Meesho element IDs.

---

## Features

- **Dynamic field detection.** Scans the live page for every editable control (inputs, textareas, selects, contenteditable, comboboxes) and derives a human label for each from its `<label>`, `aria-label`, placeholder, or surrounding text.
- **Account-synced templates.** Sign in with your Rudam (rudam.in) credentials; templates are saved server-side against the business you pick, so they follow you to any browser and are shared with your team.
- **Reusable templates.** Save the current form's values under a name (e.g. *"Cotton Kurti – Default"*). Apply any template to a fresh listing in one click. Search, delete, import/export as JSON.
- **One-click prefill.** Writes values back through React-safe native setters so Meesho's framework actually registers the change.
- **Editable before push.** Review/tweak any detected value in the popup before filling.
- **"Locate" each field.** Scrolls to and highlights a field on the page.
- **Image generation (bring-your-own key).** Generate e-commerce product images via OpenAI (`gpt-image-1` / DALL·E 3) or Stability AI. Download or copy the result.

---

## Install

### The easy way — download from Rudam

1. Sign in to **rudam.in** → **Tools → Browser Extension**.
2. Click **Download extension (.zip)** and unzip it.
3. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick the unzipped `meesho-lister-extension` folder.

The download is stamped with the server that served it, so a copy downloaded from rudam.in already points at rudam.in — there is nothing to configure.

### From this repo

Load the folder unpacked as above. The checked-in `config.js` points at `https://rudam.in`; to work against a local backend, open the extension's **Settings** tab and set the Rudam server to `http://127.0.0.1:8000`.

---

## Sign in

The popup shows a sign-in screen until you authenticate, because templates live on your Rudam account rather than in the browser.

- Use your normal Rudam username and password.
- If your account has more than one business, a **Business** picker appears under the header — templates are read from and written to the selected business.
- Sessions use JWTs: a 60-minute access token refreshed automatically from a 7-day refresh token, both stored only in `chrome.storage.local`. Your password is never stored.
- **Sign out** is in the top-right of the popup.

---

## Usage

**Prefill a listing**
1. Open a Meesho add-product / catalog form.
2. Click the extension → **Scan page**. Detected fields appear with their labels.
3. Edit values inline if needed → **Prefill all**.

**Save a template**
1. After scanning/filling, enter a name in the bottom bar → **Save to my account**. Saving under a name that already exists updates it in place rather than creating a duplicate.

**Reuse a template**
1. **Templates** tab → find it → **Apply** (writes straight to the page) or **Load to Fields** (review first).

**Move templates between accounts**
1. **Templates** tab → **⬇︎** exports every template for the current business as a JSON file.
2. **⬆︎** imports such a file. Templates are matched by name, so importing the same file twice updates rather than duplicates — which also makes it safe to import a colleague's export.
3. **⟳** re-reads from the server, e.g. after a teammate adds one.

**Generate an image**
1. **Settings** tab → choose provider, paste your API key, save.
2. **Images** tab → write a prompt, pick a size → **Generate image** → Download / Copy.

---

## Architecture

```
manifest.json              MV3 config, permissions, script registration
config.js                  Which Rudam server to sync with (regenerated on download)
background.js              Service worker — image-generation API calls (off-page)
content/
  fieldScanner.js          Pure detection/read/write engine (window.MeeshoFieldScanner)
  content.js               Message bridge popup <-> page, floating badge, highlight
popup/
  popup.html / .css        UI: sign-in gate + Fields / Templates / Images / Settings
  storage.js               chrome.storage.local wrapper — settings + template cache
  api.js                   Rudam client: JWT auth, businesses, template sync (MLApi)
  popup.js                 Controller wiring UI to content script + background + API
icons/                     16/48/128 px
```

**Server endpoints used** (all under `https://rudam.in`):

| Endpoint | Purpose |
|---|---|
| `POST /api/auth/login/` | Exchange username/password for JWTs |
| `POST /api/auth/token/refresh/` | Renew an expired access token |
| `GET /api/auth/me/` | Profile + the businesses you can pick |
| `GET/POST /api/business/<id>/listing-templates/` | List / upsert templates |
| `PATCH/DELETE /api/business/<id>/listing-templates/<pk>/` | Edit / delete one |
| `POST /api/business/<id>/listing-templates/import/` | Bulk import a JSON export |
| `GET /api/business/<id>/listing-templates/export/` | Download all as JSON |

**Why templates are server-side, cached locally.** The server is the source of truth so a template saved on your desktop is there on your laptop. The last server response is cached in `chrome.storage.local` purely so the Templates tab paints instantly and still shows something when offline. The cache is read-only: every write goes to the server, because queueing offline edits would let two browsers diverge with no way to reconcile them.

**Why the API base is generated, not hardcoded.** Downloading from the app rewrites `config.js` with the origin that served the download, so the same codebase works against production and a local dev server without anyone editing a URL. A Settings override takes precedence when you need to point it somewhere else.

**Why a logical key, not a CSS selector.** Meesho is a React app with minified, deploy-varying class names. Templates are keyed on a *stable logical key* derived from `name` → `id` → label → placeholder, so a saved template keeps matching fields after Meesho ships a redesign. See `deriveKey()` in `fieldScanner.js`.

**Why native setters.** React tracks input state internally; `el.value = x` is reverted on the next render. `setNativeValue()` uses the prototype's native value setter and dispatches `input`/`change`/`blur` so React's `onChange` fires. See `writeValue()`.

**Why image calls live in the background worker.** Keeps the API key out of page context, avoids the page's Content-Security-Policy, and centralizes provider handling (OpenAI JSON `b64_json`/`url`, Stability raw bytes).

---

## Privacy & security

- **Listing templates** are stored on your Rudam account, against the business you select, and are visible to others with access to that business. A local copy is cached on your device for offline reading.
- **Your Rudam password** is never stored — it is exchanged for tokens at sign-in and discarded. Tokens live in `chrome.storage.local` and are cleared on sign-out.
- **Your image API key** stays in `chrome.storage.local` and is sent **only** to the provider you select, when you click Generate. It never goes to Rudam.
- Host access is limited to `meesho.com`, your Rudam server, and the two image-API domains.
- The extension's `chrome-extension://` origin is allowed through the server's CORS policy by regex, but that grants nothing on its own: every template endpoint still requires a valid JWT and is scoped to the businesses that account belongs to.

---

## Notes & limits

- Image generation requires your own paid API key (OpenAI or Stability).
- File-upload fields (product photos) are intentionally not auto-filled — browsers block programmatic file injection for security. Use the Images tab to create an image, then upload it manually.
- Detection covers standard and most custom React controls. Exotic widgets that render no real form element may show as "Field N" — use **Locate** to confirm, and rename/save anyway since the logical key still works.
- Tested against Manifest V3 on Chromium. Selectors are heuristic, not selectors against Meesho internals, so they should survive most UI updates.
