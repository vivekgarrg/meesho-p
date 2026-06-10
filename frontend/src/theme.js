import { createTheme } from "@mui/material/styles";

const RUDAM_VIOLET = "#6D28D9";
const RUDAM_LIGHT  = "#F5F3FF";

const theme = createTheme({
  palette: {
    primary:   { main: RUDAM_VIOLET, light: "#8B5CF6", dark: "#4C1D95", contrastText: "#fff" },
    secondary: { main: "#2563EB",    light: "#60A5FA", dark: "#1E40AF", contrastText: "#fff" },
    success:   { main: "#059669",    light: "#34D399", dark: "#065F46", contrastText: "#fff" },
    error:     { main: "#E11D48",    light: "#FB7185", dark: "#9F1239", contrastText: "#fff" },
    warning:   { main: "#D97706",    light: "#FBBf24", dark: "#92400E", contrastText: "#fff" },
    info:      { main: "#2563EB",    light: "#93C5FD", dark: "#1E40AF", contrastText: "#fff" },
    background: { default: "#F0F2FA", paper: "#FFFFFF" },
    text: {
      primary:   "#1E293B",
      secondary: "#64748B",
      disabled:  "#94A3B8",
    },
    divider: "#E2E8F0",
  },
  typography: {
    fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
    h1: { fontWeight: 800, letterSpacing: "-0.025em" },
    h2: { fontWeight: 700, letterSpacing: "-0.02em" },
    h3: { fontWeight: 700, letterSpacing: "-0.015em" },
    h4: { fontWeight: 700 },
    h5: { fontWeight: 600 },
    h6: { fontWeight: 600 },
    subtitle1: { fontWeight: 500 },
    subtitle2: { fontWeight: 600, fontSize: "0.75rem", letterSpacing: "0.06em", textTransform: "uppercase", color: "#94A3B8" },
    body1: { fontSize: "0.875rem" },
    body2: { fontSize: "0.813rem" },
    caption: { fontSize: "0.75rem", color: "#94A3B8" },
    button: { fontWeight: 600, textTransform: "none", letterSpacing: "0.01em" },
  },
  shape: { borderRadius: 12 },
  shadows: [
    "none",
    "0 1px 2px rgba(0,0,0,0.05)",
    "0 1px 3px rgba(0,0,0,0.08), 0 2px 6px rgba(0,0,0,0.05)",
    "0 2px 6px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.06)",
    "0 4px 12px rgba(0,0,0,0.1), 0 8px 24px rgba(0,0,0,0.07)",
    "0 8px 24px rgba(0,0,0,0.12), 0 16px 40px rgba(0,0,0,0.08)",
    ...Array(19).fill("0 8px 32px rgba(0,0,0,0.12)"),
  ],
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        "*, *::before, *::after": { boxSizing: "border-box" },
        body: { background: "#F0F2FA" },
        "::-webkit-scrollbar": { width: 6, height: 6 },
        "::-webkit-scrollbar-track": { background: "transparent" },
        "::-webkit-scrollbar-thumb": { background: "#CBD5E1", borderRadius: 8 },
        "::-webkit-scrollbar-thumb:hover": { background: "#94A3B8" },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 10, fontWeight: 600, textTransform: "none", padding: "8px 18px" },
        sizeSmall: { padding: "5px 13px", fontSize: "0.75rem" },
        sizeLarge: { padding: "11px 28px", fontSize: "0.9375rem" },
        containedPrimary: { boxShadow: "0 2px 6px rgba(109,40,217,0.3)" },
        containedSuccess: { boxShadow: "0 2px 6px rgba(5,150,105,0.25)" },
        containedError:   { boxShadow: "0 2px 6px rgba(225,29,72,0.25)" },
      },
    },
    MuiTextField: {
      defaultProps: { size: "small", variant: "outlined" },
      styleOverrides: {
        root: { "& .MuiOutlinedInput-root": { borderRadius: 10, fontSize: "0.875rem" } },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { borderRadius: 10 },
        notchedOutline: { borderColor: "#E2E8F0" },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 16, border: "1px solid #E2E8F0",
          boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.05)",
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        rounded: { borderRadius: 16 },
        elevation1: { boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.05)" },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 20, fontWeight: 600, fontSize: "0.75rem" },
      },
    },
    MuiTableHead: {
      styleOverrides: {
        root: {
          "& .MuiTableCell-head": {
            background: "#F8FAFC", fontWeight: 700, fontSize: "0.688rem",
            letterSpacing: "0.06em", textTransform: "uppercase", color: "#64748B",
            borderBottom: "1px solid #E2E8F0",
          },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderBottom: "1px solid #F1F5F9", fontSize: "0.813rem", padding: "12px 16px" },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          "&:hover": { background: "#F5F3FF" },
          "&:last-child .MuiTableCell-root": { borderBottom: "none" },
        },
      },
    },
    MuiDataGrid: {
      styleOverrides: {
        root: {
          border: "1px solid #E2E8F0", borderRadius: 16,
          fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
          fontSize: "0.813rem",
        },
        columnHeaders: {
          background: "#F8FAFC", fontSize: "0.688rem", fontWeight: 700,
          letterSpacing: "0.06em", textTransform: "uppercase", color: "#64748B",
          borderBottom: "1px solid #E2E8F0",
        },
        row: {
          "&:hover": { background: "#F5F3FF" },
          "&.Mui-selected": { background: RUDAM_LIGHT, "&:hover": { background: RUDAM_LIGHT } },
        },
        cell: { borderBottom: "1px solid #F1F5F9" },
        footerContainer: { borderTop: "1px solid #E2E8F0", background: "#FAFAFA" },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: { borderRadius: 20, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" },
      },
    },
    MuiDialogTitle: {
      styleOverrides: {
        root: { fontWeight: 700, fontSize: "1rem", padding: "20px 24px 12px" },
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: { borderRadius: 4, height: 6 },
        bar: { borderRadius: 4 },
      },
    },
    MuiAlert: {
      styleOverrides: { root: { borderRadius: 10, fontSize: "0.813rem" } },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: { fontSize: "0.75rem", borderRadius: 8, fontWeight: 500 },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: "none", fontWeight: 600, fontSize: "0.813rem",
          minHeight: 44, padding: "8px 16px",
        },
      },
    },
    MuiTabs: {
      styleOverrides: {
        indicator: { height: 3, borderRadius: "3px 3px 0 0", background: RUDAM_VIOLET },
      },
    },
  },
});

export default theme;
