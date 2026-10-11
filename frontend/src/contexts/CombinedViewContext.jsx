import React, { createContext, useContext, useEffect, useState } from "react";
import { useBusiness } from "./BusinessContext";

/*
 * COMBINED VIEW — the global "merge 2+ businesses" setting.
 *
 * One switch + one business selection, shared by every screen that knows how
 * to use it — not a per-tab toggle. Today that's Combined Dashboard (Profit,
 * Orders, Payments, SKUs); other tabs read `enabled`/`businessIds` from here
 * too, so turning this on anywhere is the one thing that needs doing, but
 * each tab still decides for itself how (or whether) to merge its own data —
 * see the file-level comment in CombinedDashboardTab.jsx for why this isn't
 * done by blindly summing every field of every endpoint's JSON: a flat
 * generic merge would, for example, add up two different businesses' same-
 * named SKU as if it were one product, which is simply wrong.
 */

const ENABLED_KEY = "combined_view_enabled";
const SELECTION_KEY = "combined_dashboard_business_ids"; // shared with the pre-existing Combined Dashboard picker

const CombinedViewContext = createContext(null);

function loadSelection() {
  try {
    const raw = localStorage.getItem(SELECTION_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function CombinedViewProvider({ children }) {
  const { businesses } = useBusiness();

  const [enabled, setEnabledState] = useState(() => localStorage.getItem(ENABLED_KEY) === "true");
  const [selected, setSelected] = useState(() => {
    const stored = loadSelection();
    const validStored = stored?.filter((id) => businesses.some((b) => b.id === id));
    if (validStored?.length) return new Set(validStored);
    return new Set(businesses.map((b) => b.id));
  });

  // A business added or removed after first load shouldn't leave the
  // selection referencing an id that no longer exists, or stuck empty.
  // Also covers this provider's own first render: it lives at the app root
  // (unlike the page it was extracted from), so its very first render can
  // land before BusinessContext has resolved `businesses` — the initial
  // state above then defaults to an empty set, which this effect must still
  // correct once businesses actually arrive, not treat as "already settled".
  useEffect(() => {
    if (!businesses.length) return;
    setSelected((prev) => {
      const validIds = new Set(businesses.map((b) => b.id));
      const kept = [...prev].filter((id) => validIds.has(id));
      if (kept.length > 0 && kept.length === prev.size) return prev;
      return new Set(kept.length ? kept : businesses.map((b) => b.id));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businesses.map((b) => b.id).join(",")]);

  useEffect(() => {
    localStorage.setItem(SELECTION_KEY, JSON.stringify([...selected]));
  }, [selected]);

  const setEnabled = (next) => {
    setEnabledState(next);
    localStorage.setItem(ENABLED_KEY, String(next));
  };

  const toggleBusiness = (id) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // "Combined" only actually means anything with 2+ businesses ticked — one
  // ticked is just the active business, zero is nothing to show.
  const active = enabled && selected.size >= 2;

  const value = {
    enabled, setEnabled,
    selected, setSelected, toggleBusiness,
    selectedIds: [...selected].sort((a, b) => a - b),
    active,
  };

  return <CombinedViewContext.Provider value={value}>{children}</CombinedViewContext.Provider>;
}

export function useCombinedView() {
  const ctx = useContext(CombinedViewContext);
  if (!ctx) throw new Error("useCombinedView must be used within a CombinedViewProvider");
  return ctx;
}
