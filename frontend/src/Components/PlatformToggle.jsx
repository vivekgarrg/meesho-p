import React, { useState } from "react";
import { C } from "../App";

const KEY = "label_platform";

export const PLATFORMS = {
  meesho: { label: "Meesho", color: "#9F2089" },
  flipkart: { label: "Flipkart", color: "#2874F0" },
};

/** Which marketplace's labels the tab is working on. Remembered across visits. */
export function useLabelPlatform() {
  const [platform, setPlatformState] = useState(() => {
    try {
      const v = localStorage.getItem(KEY);
      return v === "flipkart" ? "flipkart" : "meesho";
    } catch {
      return "meesho";
    }
  });
  const setPlatform = (p) => {
    setPlatformState(p);
    try { localStorage.setItem(KEY, p); } catch { /* preference just won't persist */ }
  };
  return [platform, setPlatform];
}

/**
 * Meesho | Flipkart switch. Each marketplace is sorted, cropped and saved on its
 * own — a Meesho tray and a Flipkart tray are never mixed into one stack.
 */
export function PlatformToggle({ platform, onChange, disabled }) {
  return (
    <div style={{ display: "inline-flex", gap: 3, background: C.gray100, borderRadius: 10, padding: 4 }}>
      {Object.entries(PLATFORMS).map(([id, p]) => {
        const on = platform === id;
        return (
          <button
            key={id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(id)}
            style={{
              padding: "7px 18px",
              border: "none",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: on ? 800 : 600,
              cursor: disabled ? "default" : "pointer",
              background: on ? p.color : "transparent",
              color: on ? "#fff" : C.gray500,
              opacity: disabled && !on ? 0.5 : 1,
            }}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

/** Amber note listing pages left out because they belong to the other marketplace. */
export function SkippedPagesNote({ skipped }) {
  const entries = Object.entries(skipped || {}).filter(([, n]) => n > 0);
  if (!entries.length) return null;
  return (
    <div style={{
      padding: "10px 14px", borderRadius: 10, fontSize: 13, background: C.amberLight || "#FFFBEB",
      border: `1px solid ${C.amberBorder || "#FDE68A"}`, color: C.gray700,
    }}>
      Left out of this batch:{" "}
      {entries.map(([k, n]) => `${n} ${PLATFORMS[k]?.label || k} label${n === 1 ? "" : "s"}`).join(", ")}
      {" "}— upload {entries.length === 1 ? "that file" : "those"} in the {entries.map(([k]) => PLATFORMS[k]?.label || k).join(" / ")} tab.
    </div>
  );
}
