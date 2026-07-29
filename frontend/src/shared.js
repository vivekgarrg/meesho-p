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

export { API_BASE as API } from "./lib/apiBase";

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
    borderRadius: 16,
    padding: 24,
    boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.06)",
  },
  cardTitle: {
    fontSize: 11, fontWeight: 700, color: C.gray400,
    marginBottom: 16, letterSpacing: "0.08em", textTransform: "uppercase",
  },
  th: {
    padding: "12px 16px", textAlign: "left", color: C.gray500,
    fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
    textTransform: "uppercase", borderBottom: `1px solid ${C.border}`,
    background: C.gray50, whiteSpace: "nowrap",
  },
  td: {
    padding: "12px 16px", color: C.gray700, fontSize: 13,
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
