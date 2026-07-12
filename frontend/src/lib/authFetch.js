const ACCESS_KEY = "access_token";
const REFRESH_KEY = "refresh_token";

const EXEMPT_PATHS = ["/api/auth/login/", "/api/auth/token/refresh/"];

export function getAccessToken() {
  return localStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken() {
  return localStorage.getItem(REFRESH_KEY);
}

export function setTokens({ access, refresh }) {
  if (access) localStorage.setItem(ACCESS_KEY, access);
  if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
}

export function clearTokens() {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

function resolvePathname(url) {
  try {
    return new URL(url, window.location.origin).pathname;
  } catch {
    return "";
  }
}

function isApiPath(url) {
  return resolvePathname(url).startsWith("/api");
}

function isExemptPath(url) {
  const pathname = resolvePathname(url);
  return EXEMPT_PATHS.includes(pathname);
}

const originalFetch = window.fetch.bind(window);

let refreshPromise = null;

async function refreshAccessToken() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const refresh = getRefreshToken();
    if (!refresh) return false;
    try {
      const res = await originalFetch("/api/auth/token/refresh/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      if (!data.access) return false;
      setTokens({ access: data.access, refresh });
      return true;
    } catch {
      return false;
    }
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

function withAuthHeader(input, init, token) {
  const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return { ...init, headers };
}

window.fetch = async function patchedFetch(input, init) {
  const url = typeof input === "string" ? input : input?.url || "";

  if (!isApiPath(url)) {
    return originalFetch(input, init);
  }

  const exempt = isExemptPath(url);

  const doFetch = (token) => originalFetch(input, withAuthHeader(input, init, exempt ? null : token));

  let response = await doFetch(getAccessToken());

  if (!exempt && response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      response = await doFetch(getAccessToken());
    } else {
      clearTokens();
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
  }

  return response;
};
