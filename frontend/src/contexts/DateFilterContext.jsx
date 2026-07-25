import React, { createContext, useContext, useEffect, useState } from "react";
import { API_BASE as API } from "../lib/apiBase";
import { useBusiness } from "./BusinessContext";

const DateFilterContext = createContext(null);
const STORAGE_KEY = "global_date_filter";

export function fmtMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-IN", { month: "long", year: "numeric" });
}

export function monthToRange(ym) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { date_from: `${ym}-01`, date_to: `${ym}-${String(last).padStart(2, "0")}` };
}

function loadStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/**
 * Single source of truth for the "period" filter — shared by every tab that
 * scopes its data by date. Selecting a month (or a custom range) here narrows
 * what every tab shows; there is no more per-tab date picker.
 */
export function DateFilterProvider({ children }) {
  const { activeBusinessId } = useBusiness();
  const initialStored = loadStored();

  const [mode, setMode] = useState(initialStored?.mode || "all");                 // "all" | "month" | "custom"
  const [selectedMonth, setSelectedMonth] = useState(initialStored?.selectedMonth || "");
  const [customFrom, setCustomFrom] = useState(initialStored?.customFrom || "");
  const [customTo, setCustomTo] = useState(initialStored?.customTo || "");
  const [months, setMonths] = useState([]);
  const [monthsLoading, setMonthsLoading] = useState(true);

  // Persist selection so it survives a page reload.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode, selectedMonth, customFrom, customTo }));
    } catch { /* storage unavailable — filter just won't survive a reload */ }
  }, [mode, selectedMonth, customFrom, customTo]);

  // Refetch available months whenever the active business changes (each
  // business has its own order history), and fall back to "all" if the
  // previously-selected month doesn't exist for the newly active business.
  useEffect(() => {
    if (!activeBusinessId) { setMonths([]); setMonthsLoading(false); return; }
    let cancelled = false;
    setMonthsLoading(true);
    fetch(`${API}/profit/available-months/`)
      .then(r => r.json())
      .then(list => {
        if (cancelled) return;
        const ms = Array.isArray(list) ? list : [];
        setMonths(ms);
        const hadStoredPreference = !!loadStored();
        if (!hadStoredPreference && ms.length > 0) {
          // First-ever visit for this browser — default to the most recent month,
          // matching the old per-tab dashboards' default instead of "all time".
          setMode("month");
          setSelectedMonth(ms[0]);
        } else if (selectedMonth && !ms.includes(selectedMonth)) {
          setMode("all");
          setSelectedMonth("");
        }
      })
      .catch(() => { if (!cancelled) setMonths([]); })
      .finally(() => { if (!cancelled) setMonthsLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBusinessId]);

  const range =
    mode === "month" && selectedMonth ? monthToRange(selectedMonth)
    : mode === "custom" && customFrom && customTo ? { date_from: customFrom, date_to: customTo }
    : {};

  const label =
    mode === "month" && selectedMonth ? fmtMonth(selectedMonth)
    : mode === "custom" && customFrom ? `${customFrom} → ${customTo}`
    : "All time";

  const clear = () => { setMode("all"); setSelectedMonth(""); setCustomFrom(""); setCustomTo(""); };

  const value = {
    mode, setMode,
    selectedMonth, setSelectedMonth,
    customFrom, setCustomFrom,
    customTo, setCustomTo,
    months, monthsLoading,
    range, label, clear,
  };

  return <DateFilterContext.Provider value={value}>{children}</DateFilterContext.Provider>;
}

export function useDateFilter() {
  const ctx = useContext(DateFilterContext);
  if (!ctx) throw new Error("useDateFilter must be used within a DateFilterProvider");
  return ctx;
}
