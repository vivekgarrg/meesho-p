import React, { useState } from "react";
import { FilterBar } from "./FilterBar";
import { useDateFilter } from "../../contexts/DateFilterContext";
import { C, useIsMobile } from "../../shared";
import CalendarTodayIcon from "@mui/icons-material/CalendarToday";

/**
 * The single, app-wide period filter — rendered once in AppShell so it stays
 * visible across every route. All tabs read the active range via useDateFilter()
 * instead of keeping their own date picker.
 *
 * On a phone the full bar wraps into a ~500px tall block that buries the page's
 * actual content below the fold, so there it collapses to a one-line summary of
 * the active period and expands only when tapped.
 */
export function GlobalDateFilterBar() {
  const {
    months, mode, setMode, selectedMonth, setSelectedMonth,
    customFrom, setCustomFrom, customTo, setCustomTo, label,
  } = useDateFilter();

  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  const bar = (
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
  );

  if (!isMobile) {
    return <div style={{ padding: "12px 32px 0" }}>{bar}</div>;
  }

  return (
    <div style={{ padding: "10px 12px 0", flexShrink: 0 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8,
          background: C.white, border: `1px solid ${C.border}`, borderRadius: 10,
          padding: "10px 14px", cursor: "pointer", fontFamily: "inherit",
          textAlign: "left",
        }}
      >
        <CalendarTodayIcon style={{ fontSize: 15, color: C.gray400, flexShrink: 0 }} />
        <span style={{
          fontSize: 10, fontWeight: 700, color: C.gray400,
          letterSpacing: "0.07em", textTransform: "uppercase", flexShrink: 0,
        }}>
          Period
        </span>
        <span style={{
          fontSize: 13, fontWeight: 700, color: C.orange, minWidth: 0,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {label}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: C.gray400, flexShrink: 0 }}>
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open && <div style={{ marginTop: 10 }}>{bar}</div>}
    </div>
  );
}
