import React,{ useState, useRef, useEffect } from "react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import "./datepicker.css";
import { C } from "../../App";

const PRESETS = [
  { label: "Last 1 month",  days: 30 },
  { label: "Last 2 months", days: 60 },
  { label: "Last 3 months", days: 90 },
];

function toISO(date) {
  if (!date) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function fromISO(str) {
  if (!str) return null;
  const [y, mo, d] = str.split("-").map(Number);
  return new Date(y, mo - 1, d);
}

function fmtLabel(isoStr) {
  if (!isoStr) return "…";
  const d = fromISO(isoStr);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" });
}

/**
 * DateRangePicker — controlled range picker backed by react-datepicker.
 * Props: from (ISO string), to (ISO string), onChange({ from, to })
 *
 * onChange is called ONLY when:
 *   - Both start + end dates are chosen in the calendar
 *   - A quick-select preset is clicked
 *   - Clear is clicked (fires with { from:"", to:"" })
 */
export function DateRangePicker({ from, to, onChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const [draftStart, setDraftStart] = useState(fromISO(from));
  const [draftEnd,   setDraftEnd]   = useState(fromISO(to));
  const wrapperRef = useRef(null);

  // Sync internal draft when parent resets (e.g. external clear)
  useEffect(() => {
    setDraftStart(fromISO(from));
    setDraftEnd(fromISO(to));
  }, [from, to]);

  // Close popup on outside click
  useEffect(() => {
    const onDown = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // react-datepicker selectsRange fires [start, end]; end is null until user picks it
  const handleCalendarChange = ([start, end]) => {
    setDraftStart(start);
    setDraftEnd(end);
    if (start && end) {
      onChange({ from: toISO(start), to: toISO(end) });
      setTimeout(() => setIsOpen(false), 120);
    }
  };

  const applyPreset = (days) => {
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    const start = new Date();
    start.setDate(start.getDate() - days);
    start.setHours(0, 0, 0, 0);
    setDraftStart(start);
    setDraftEnd(end);
    onChange({ from: toISO(start), to: toISO(end) });
    setIsOpen(false);
  };

  const clear = (e) => {
    e.stopPropagation();
    setDraftStart(null);
    setDraftEnd(null);
    onChange({ from: "", to: "" });
    setIsOpen(false);
  };

  const hasValue = !!(from || to);
  const displayText = hasValue
    ? `${fmtLabel(from)} → ${fmtLabel(to)}`
    : "Select date range";

  return (
    <div ref={wrapperRef} style={{ position: "relative", display: "inline-block" }}>

      {/* ── Trigger button ── */}
      <button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          padding: "7px 14px",
          borderRadius: 8,
          cursor: "pointer",
          border: `1.5px solid ${hasValue ? C.orange : C.gray300}`,
          background: hasValue ? C.orangeLight : C.white,
          color: hasValue ? C.orange : C.gray500,
          fontSize: 12,
          fontWeight: hasValue ? 600 : 400,
          fontFamily: "inherit",
          whiteSpace: "nowrap",
          transition: "all 0.15s",
          boxShadow: isOpen ? `0 0 0 3px ${C.orangeLight}` : "none",
        }}
      >
        <span role="img" aria-label="calendar" style={{ fontSize: 14 }}>📅</span>
        <span>{displayText}</span>
        {hasValue && (
          <span
            onClick={clear}
            title="Clear date filter"
            style={{
              marginLeft: 2,
              fontSize: 15,
              lineHeight: 1,
              color: C.orange,
              fontWeight: 700,
              opacity: 0.7,
              cursor: "pointer",
            }}
          >×</span>
        )}
      </button>

      {/* ── Dropdown popup ── */}
      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            left: 0,
            zIndex: 9999,
            background: C.white,
            borderRadius: 14,
            border: `1px solid ${C.border}`,
            boxShadow: "0 12px 40px rgba(0,0,0,0.14)",
            overflow: "hidden",
            minWidth: 310,
          }}
        >
          {/* Preset strip */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "10px 14px",
              borderBottom: `1px solid ${C.gray100}`,
              background: C.gray50,
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 600, color: C.gray400, marginRight: 2 }}>
              Quick:
            </span>
            {PRESETS.map((p) => (
              <PresetBtn key={p.label} label={p.label} onClick={() => applyPreset(p.days)} />
            ))}
          </div>

          {/* Calendar */}
          <div className="dp-orange" style={{ padding: "6px 8px 8px" }}>
            <DatePicker
              selected={draftStart}
              onChange={handleCalendarChange}
              startDate={draftStart}
              endDate={draftEnd}
              selectsRange
              inline
              showMonthDropdown
              showYearDropdown
              dropdownMode="select"
              maxDate={new Date()}
            />
          </div>

          {/* Footer hint */}
          <div
            style={{
              padding: "7px 14px 9px",
              borderTop: `1px solid ${C.gray100}`,
              background: C.gray50,
              fontSize: 11,
              color: C.gray400,
              textAlign: "center",
            }}
          >
            {draftStart && !draftEnd
              ? "Now pick an end date to apply"
              : "Pick a start date to begin"}
          </div>
        </div>
      )}
    </div>
  );
}

function PresetBtn({ label, onClick }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: "4px 12px",
        borderRadius: 20,
        fontSize: 11,
        cursor: "pointer",
        border: `1px solid ${hovered ? C.orange : C.gray300}`,
        background: hovered ? C.orangeLight : C.white,
        color: hovered ? C.orange : C.gray600,
        fontFamily: "inherit",
        fontWeight: 500,
        transition: "all 0.15s",
      }}
    >
      {label}
    </button>
  );
}
