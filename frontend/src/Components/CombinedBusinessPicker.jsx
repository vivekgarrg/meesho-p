import React from "react";
import { C, S, btn } from "../App";

/** Tick/untick businesses for the combined view — shared by the header
 * toggle's popover and the Combined Dashboard page, so there is exactly one
 * selection UI rather than two that could drift apart. */
export function CombinedBusinessPicker({ businesses, selected, onToggle, onSelectAll, onSelectNone }) {
  if (businesses.length === 0) {
    return (
      <div style={{ ...S.card, fontSize: 12.5, color: C.gray400 }}>No businesses on this account yet.</div>
    );
  }
  return (
    <div style={S.card}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        <p style={{ ...S.cardTitle, marginBottom: 0 }}>
          {selected.size} of {businesses.length} business{businesses.length === 1 ? "" : "es"} selected
        </p>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={onSelectAll} style={btn("ghost", "sm")}>Select all</button>
          <button onClick={onSelectNone} style={btn("ghost", "sm")}>Clear</button>
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {businesses.map((b) => {
          const on = selected.has(b.id);
          return (
            <button
              key={b.id}
              onClick={() => onToggle(b.id)}
              style={{
                display: "flex", alignItems: "center", gap: 7,
                padding: "7px 12px", borderRadius: 20, fontSize: 12.5, fontWeight: 700,
                cursor: "pointer", fontFamily: "inherit",
                background: on ? C.orangeLight : C.white,
                color: on ? C.orange : C.gray500,
                border: `1.5px solid ${on ? C.orangeBorder : C.gray200}`,
                transition: "background 0.14s, border-color 0.14s, color 0.14s",
              }}
            >
              <span
                style={{
                  width: 15, height: 15, borderRadius: 4, flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 10, color: "#fff",
                  background: on ? C.orange : "transparent",
                  border: `1.5px solid ${on ? C.orange : C.gray300}`,
                }}
              >
                {on ? "✓" : ""}
              </span>
              {b.name}
            </button>
          );
        })}
      </div>
      {businesses.length === 1 && (
        <p style={{ fontSize: 11, color: C.gray400, marginTop: 8 }}>
          Only one business on this account right now — there's nothing to combine until there's a second one.
        </p>
      )}
    </div>
  );
}
