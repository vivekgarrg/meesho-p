import React, { createContext, useContext, useState } from "react";
import { getSettlementMode, setSettlementMode } from "../lib/authFetch";

/*
 * SETTLEMENT MODE — the global Settled-only switch.
 *
 * Off (default, "all"): every payment row, unfiltered — today's behavior
 * from before this switch existed, so nothing changes until a seller opts
 * in. On ("settled"): only orders Meesho has actually paid out, i.e. their
 * payment row carries a transaction_id (Meesho's export has no genuine
 * bank-settlement-confirmation field the way Flipkart's neft_id is — this is
 * a known-imperfect proxy, not a real bank-transfer check). The switch only
 * ever narrows the data; it never swaps it for a different subset.
 *
 * This isn't a per-tab opt-in like Combined View — the mode is sent as the
 * X-Settlement-Mode header on every single API call (see lib/authFetch.js's
 * patched window.fetch), and the backend's one shared filter
 * (_apply_settlement_filter in views.py) is what every money-touching
 * endpoint should run its OrderPayment query through. Flipping the switch
 * here is therefore enough on its own; no tab needs to read this context to
 * behave correctly — it exists so the UI has something to flip and display.
 */

const SettlementModeContext = createContext(null);

export function SettlementModeProvider({ children }) {
  const [mode, setMode] = useState(getSettlementMode);

  const setModeAndPersist = (next) => {
    setSettlementMode(next);
    setMode(next);
  };

  const value = {
    mode,
    isSettled: mode === "settled",
    setMode: setModeAndPersist,
    toggle: () => setModeAndPersist(mode === "settled" ? "all" : "settled"),
  };

  return <SettlementModeContext.Provider value={value}>{children}</SettlementModeContext.Provider>;
}

export function useSettlementMode() {
  const ctx = useContext(SettlementModeContext);
  if (!ctx) throw new Error("useSettlementMode must be used within a SettlementModeProvider");
  return ctx;
}
