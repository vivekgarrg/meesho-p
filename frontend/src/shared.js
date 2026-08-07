// Shared design tokens, formatters, and API base.
//
// These were originally defined in App.jsx, but App.jsx imports every Tab
// component, and those components import these tokens back from App.jsx — a
// circular import. In the minified production build that cycle caused a
// "Cannot access '…' before initialization" (temporal dead zone) error,
// because these `const` values were being read before App.jsx finished
// initializing. Moving them into this dependency-free leaf module breaks the
// cycle: this file imports nothing from App or the components, so it always
// initializes first.

import { useState, useEffect } from "react";

export { API_BASE as API } from "./lib/apiBase";

// ── Responsive breakpoints ────────────────────────────────────────────────────
// Almost all styling in this app is inline, and inline styles can't be
// overridden by a CSS media query — so responsive layout has to be decided in
// JS. These hooks are the single source of truth for "are we on a small
// screen", used by the shell and by any tab that needs to restructure rather
// than merely reflow.
export const BP = { mobile: 768, tablet: 1024 };

function useMediaQuery(query) {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (e) => setMatches(e.matches);
    setMatches(mql.matches);   // re-sync in case it changed before this ran
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** True on phones and small tablets in portrait — the layout-changing breakpoint. */
export const useIsMobile = () => useMediaQuery(`(max-width: ${BP.mobile - 1}px)`);

/** True on narrow desktop / tablet landscape, where the sidebar still fits but space is tight. */
export const useIsTablet = () => useMediaQuery(`(max-width: ${BP.tablet - 1}px)`);

// ── Formatters ─────────────────────────────────────────────────────────────────
export const fmt = (n) =>
  n === null || n === undefined
    ? "—"
    : `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── Design tokens — Rudam brand ───────────────────────────────────────────────
export const C = {
  // Brand primary — Rudam Indigo
  orange: "#6D28D9",
  orangeLight: "#F5F3FF",
  orangeBorder: "#C4B5FD",
  // Profit / success — emerald
  green: "#059669",
  greenLight: "#ECFDF5",
  greenBorder: "#A7F3D0",
  // Loss / danger
  red: "#E11D48",
  redLight: "#FFF1F2",
  redBorder: "#FECDD3",
  // Info
  blue: "#2563EB",
  blueLight: "#EFF6FF",
  // Warning / attention
  amber: "#D97706",
  amberLight: "#FFFBEB",
  amberBorder: "#FDE68A",
  // Neutrals — slate scale (cooler, more premium than gray)
  gray50: "#F8FAFC",
  gray100: "#F1F5F9",
  gray200: "#E2E8F0",
  gray300: "#CBD5E1",
  gray400: "#94A3B8",
  gray500: "#64748B",
  gray600: "#475569",
  gray700: "#334155",
  gray800: "#1E293B",
  gray900: "#0F172A",
  white: "#FFFFFF",
  border: "#E2E8F0",
  bg: "#F0F2FA",
  surface: "#FFFFFF",
  colorsSet: ["#6D28D9", "#059669", "#2563EB", "#D97706", "#EC4899", "#06B6D4", "#10B981"],
};

export const CHART_COLORS = ["#6D28D9", "#059669", "#2563EB", "#D97706", "#EC4899", "#06B6D4", "#10B981", "#8B5CF6"];

export const STATUS_COLORS = {
  DELIVERED: C.green,
  RTO: C.red,
  RETURN: C.orange,
  PREMIUM_RETURN: C.orange,
  PENDING: C.blue,
  CANCELLED: C.gray400,
};

// ── Shared styles ─────────────────────────────────────────────────────────────
export const S = {
  card: {
    background: C.white,
    border: `1px solid ${C.border}`,
    borderRadius: 14,
    padding: 22,
    // Softer and lower than before: the old double shadow made every card
    // float at the same depth, so a page of eight cards read as noise.
    boxShadow: "0 1px 2px rgba(19,17,28,0.04), 0 8px 24px rgba(19,17,28,0.05)",
  },
  cardTitle: {
    fontSize: 11.5, fontWeight: 800, color: C.gray500,
    marginBottom: 15, letterSpacing: "0.07em", textTransform: "uppercase",
  },
  th: {
    padding: "12px 16px", textAlign: "left", color: C.gray500,
    fontSize: 11.5, fontWeight: 800, letterSpacing: "0.05em",
    textTransform: "uppercase", borderBottom: `1px solid ${C.border}`,
    background: C.gray50, whiteSpace: "nowrap",
  },
  td: {
    // A row of numbers read at arm's length needs more than 13px and 12px of
    // padding; this is the single change that most improves every table.
    padding: "13px 16px", color: C.gray700, fontSize: 13.5,
    borderBottom: `1px solid ${C.gray100}`,
  },
  inp: {
    background: C.white, border: `1.5px solid ${C.gray200}`,
    borderRadius: 10, padding: "9px 13px", color: C.gray800,
    fontSize: 13, outline: "none", width: "100%",
    fontFamily: "inherit", transition: "border-color 0.15s, box-shadow 0.15s",
  },
  label: { fontSize: 12, fontWeight: 600, color: C.gray600, display: "block", marginBottom: 5 },
};
