import React, { createContext, useContext, useLayoutEffect, useState } from "react";
import { useAuth } from "./AuthContext";
import { setActiveBusinessId as setApiBaseBusinessId } from "../lib/apiBase";

const ACTIVE_BUSINESS_KEY = "active_business_id";

const BusinessContext = createContext(null);

export function BusinessProvider({ children }) {
  const { user } = useAuth();
  const businesses = user?.businesses ?? [];

  // Apply synchronously during the lazy initializer (render phase, before any
  // effect anywhere in the tree runs) so a child's mount-time fetch never
  // races ahead of the business-scoped API base being set.
  const [activeBusinessId, setActiveBusinessIdState] = useState(() => {
    const stored = localStorage.getItem(ACTIVE_BUSINESS_KEY);
    const id = stored ? Number(stored) : null;
    setApiBaseBusinessId(id);
    return id;
  });

  // useLayoutEffect (not useEffect): all layout effects across the tree flush
  // before any passive effect, so this resolution — including the case where
  // `user` just became available and children are mounting for the first
  // time — always lands before those children's useEffect data fetches.
  useLayoutEffect(() => {
    if (!user) {
      setApiBaseBusinessId(null);
      setActiveBusinessIdState(null);
      return;
    }
    const stored = localStorage.getItem(ACTIVE_BUSINESS_KEY);
    const storedId = stored ? Number(stored) : null;
    const isValid = storedId != null && businesses.some((b) => b.id === storedId);
    const resolvedId = isValid ? storedId : businesses.length > 0 ? businesses[0].id : null;
    setApiBaseBusinessId(resolvedId);
    setActiveBusinessIdState(resolvedId);
    if (resolvedId) {
      localStorage.setItem(ACTIVE_BUSINESS_KEY, String(resolvedId));
    } else {
      localStorage.removeItem(ACTIVE_BUSINESS_KEY);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const setActiveBusinessId = (id) => {
    setApiBaseBusinessId(id);
    if (id) {
      localStorage.setItem(ACTIVE_BUSINESS_KEY, String(id));
    } else {
      localStorage.removeItem(ACTIVE_BUSINESS_KEY);
    }
    setActiveBusinessIdState(id);
  };

  const activeBusiness = businesses.find((b) => b.id === activeBusinessId) ?? null;

  return (
    <BusinessContext.Provider
      value={{ businesses, activeBusinessId, setActiveBusinessId, activeBusiness }}
    >
      {children}
    </BusinessContext.Provider>
  );
}

export function useBusiness() {
  const ctx = useContext(BusinessContext);
  if (!ctx) throw new Error("useBusiness must be used within a BusinessProvider");
  return ctx;
}
