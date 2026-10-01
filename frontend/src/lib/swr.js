/**
 * Shared SWR fetcher — every `useSWR` call in the app that doesn't pass its
 * own `fetcher` uses this one (wired in as the default in main.jsx's
 * `<SWRConfig>`). Every endpoint here is business-scoped (lib/apiBase.js
 * rewrites API_BASE whenever the active business changes) and the patched
 * `window.fetch` (lib/authFetch.js) already attaches the auth header, so
 * this only has to do the fetch -> parse -> throw-on-error contract SWR
 * expects; callers pass a full URL as the key.
 */
export async function swrFetcher(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const error = new Error(`Request failed (${res.status})`);
    error.status = res.status;
    try {
      error.info = await res.json();
    } catch {
      /* not JSON — leave error.info unset */
    }
    throw error;
  }
  return res.json();
}
