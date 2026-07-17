// Admin / account API helpers. These endpoints are NOT business-scoped, so
// they always use absolute /api/... paths (the global authFetch wrapper adds
// the Authorization header). Every function throws Error(message) on failure.

async function request(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  if (res.status === 204) return null;
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    if (data && typeof data === "object") {
      message =
        data.detail ||
        data.error ||
        Object.values(data).flat().join(" ") ||
        message;
    }
    throw new Error(message);
  }
  return data;
}

// ── Businesses ────────────────────────────────────────────────────────────
export const listBusinesses = () => request("/api/businesses/");

export const createBusiness = (name) =>
  request("/api/businesses/", { method: "POST", body: JSON.stringify({ name }) });

export const updateBusiness = (id, payload) =>
  request(`/api/businesses/${id}/`, { method: "PUT", body: JSON.stringify(payload) });

// ── Memberships ───────────────────────────────────────────────────────────
export const listMembers = (businessId) =>
  request(`/api/businesses/${businessId}/memberships/`);

export const addMember = (businessId, userId) =>
  request(`/api/businesses/${businessId}/memberships/`, {
    method: "POST",
    body: JSON.stringify({ user_id: userId }),
  });

export const removeMember = (businessId, membershipId) =>
  request(`/api/businesses/${businessId}/memberships/${membershipId}/`, {
    method: "DELETE",
  });

// ── Users ─────────────────────────────────────────────────────────────────
export const listUsers = () => request("/api/auth/users/");

export const createUser = (payload) =>
  request("/api/auth/users/", { method: "POST", body: JSON.stringify(payload) });

export const updateUser = (id, payload) =>
  request(`/api/auth/users/${id}/`, { method: "PUT", body: JSON.stringify(payload) });

export const deleteUser = (id) =>
  request(`/api/auth/users/${id}/`, { method: "DELETE" });
