import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "./AuthContext";
import { useBusiness } from "./BusinessContext";
import { NAV_GROUPS, ALWAYS_VISIBLE_PATHS } from "../navConfig";

const AccessContext = createContext(null);

const ALL_PATHS = NAV_GROUPS.flatMap((g) => g.items).map((i) => i.path);

/**
 * Which areas of the app the signed-in user may reach.
 *
 * The server resolves this — a user's own rule, else their business's, else the
 * global default — so this provider only has to ask, and ask again when the user
 * switches business (rules differ per business). It sits inside BusinessProvider
 * for that reason; AuthContext can't see the active business.
 *
 * `configured: false` means nothing restricts this user, and every tab shows.
 */
export function AccessProvider({ children }) {
  const { user, isSuperAdmin } = useAuth();
  const { activeBusinessId } = useBusiness();

  const [access, setAccess] = useState(null); // null until first load
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) { setAccess(null); setLoading(false); return null; }
    const qs = activeBusinessId ? `?business=${activeBusinessId}` : "";
    try {
      const res = await fetch(`/api/auth/nav-visibility/${qs}`);
      if (!res.ok) throw new Error("failed");
      const d = await res.json();
      const next = {
        visiblePaths: d.visible_paths || [],
        configured: !!d.configured,
        source: d.source || "none",
      };
      setAccess(next);
      return next;
    } catch {
      // Fail open: a visibility lookup that errors must not lock someone out of
      // their own app. The server still enforces the real restriction.
      const next = { visiblePaths: [], configured: false, source: "none" };
      setAccess(next);
      return next;
    } finally {
      setLoading(false);
    }
  }, [user, activeBusinessId]);

  useEffect(() => { load(); }, [load]);

  const value = useMemo(() => {
    const configured = !!access?.configured;
    const allowed = new Set(access?.visiblePaths || []);

    const isPathVisible = (path) =>
      !configured ||
      allowed.has(path) ||
      (isSuperAdmin && ALWAYS_VISIBLE_PATHS.includes(path));

    // Where to send someone who lands on a page they can't see. Falls back to
    // the first area they *can* see, in sidebar order.
    const visiblePathsInOrder = ALL_PATHS.filter(isPathVisible);
    const landingPath = visiblePathsInOrder[0] ?? null;

    return {
      loading,
      configured,
      source: access?.source || "none",
      visiblePaths: access?.visiblePaths || [],
      isPathVisible,
      landingPath,
      hasAnyAccess: visiblePathsInOrder.length > 0,
      refreshAccess: load,
    };
  }, [access, isSuperAdmin, loading, load]);

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess() {
  const ctx = useContext(AccessContext);
  if (!ctx) throw new Error("useAccess must be used within an AccessProvider");
  return ctx;
}
