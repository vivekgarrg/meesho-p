import React from "react";
import { FilterBar } from "./FilterBar";
import { useDateFilter } from "../../contexts/DateFilterContext";

/**
 * The single, app-wide period filter — rendered once in AppShell so it stays
 * visible across every route. All tabs read the active range via useDateFilter()
 * instead of keeping their own date picker.
 */
export function GlobalDateFilterBar() {
  const {
    months, mode, setMode, selectedMonth, setSelectedMonth,
    customFrom, setCustomFrom, customTo, setCustomTo,
  } = useDateFilter();

  return (
    <div style={{ padding: "12px 32px 0" }}>
      <FilterBar
        months={months}
        mode={mode}
        setMode={setMode}
        selectedMonth={selectedMonth}
        setSelectedMonth={setSelectedMonth}
        customFrom={customFrom}
        setCustomFrom={setCustomFrom}
        customTo={customTo}
        setCustomTo={setCustomTo}
        onApply={() => {}}
      />
    </div>
  );
}
