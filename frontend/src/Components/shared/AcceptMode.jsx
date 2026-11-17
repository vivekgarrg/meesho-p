import React from "react";
import { C, S } from "../../shared";

/*
 * How an automation accepts orders, as a plain choice (Meesho's and Flipkart's
 * automation cards). `every` is the accept interval in minutes; 0 means
 * "together": nothing is accepted between label times — each labels run accepts
 * every pending order first, then downloads and prints the labels, in one go.
 */
export function AcceptMode({ every, choices, onChange, disabled, labelTimes = [], color = C.orange }) {
  const together = !every;
  const intervals = choices.filter((m) => m > 0);
  const option = (on, title, sub, onPick, extra) => (
    <label style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", borderRadius: 12, minWidth: 0,
      border: `2px solid ${on ? color : C.gray200}`, background: on ? `${color}0F` : C.white, cursor: disabled ? "default" : "pointer" }}>
      <input type="radio" checked={on} disabled={disabled} onChange={onPick} style={{ marginTop: 3, accentColor: color }} />
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: "block", fontSize: 13.5, fontWeight: 800, color: C.gray900 }}>{title}</span>
        <span style={{ display: "block", fontSize: 12, color: C.gray500, marginTop: 2 }}>{sub}</span>
        {extra}
      </span>
    </label>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: C.gray600 }}>How orders are accepted</span>
      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))" }}>
        {option(together, "Accept & print together",
          "Only at the label times: every pending order is accepted, then its label downloaded and printed — in one run.",
          () => onChange(0))}
        {option(!together, "Accept on an interval",
          "Orders are accepted all day; labels are printed at the label times.",
          () => onChange(intervals.includes(30) ? 30 : intervals[0]),
          !together && (
            <select value={every} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))}
              onClick={(e) => e.stopPropagation()} style={{ ...S.inp, width: "auto", marginTop: 6, padding: "5px 8px" }}>
              {intervals.map((m) => <option key={m} value={m}>{m < 60 ? `Every ${m} minutes` : m === 60 ? "Every hour" : `Every ${m / 60} hours`}</option>)}
            </select>
          ))}
      </div>
      {together && labelTimes.length === 0 && (
        <span style={{ fontSize: 12, fontWeight: 700, color: C.red }}>Add a label time below — until then nothing is accepted by itself.</span>
      )}
    </div>
  );
}
