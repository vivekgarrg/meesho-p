import React from "react";
import { useState, useEffect } from "react";
import { Routes, Route, NavLink, useLocation } from "react-router-dom";

// ── Tab components ─────────────────────────────────────────────────────────────
import { OverviewTab } from "./Components/Tabs/OverviewTab";
import { UnsettledOrdersTab } from "./Components/Tabs/UnsettledOrdersTab";
import { OrdersTab } from "./Components/Tabs/OrdersTab";
import { PaymentsTab } from "./Components/Tabs/PaymentsTab";
import { PricingTab } from "./Components/Tabs/PricingTab";
import { UploadTab } from "./Components/Tabs/UploadTab";
import { SKUAnalysisTab } from "./Components/Tabs/SKUProfitTab";
import { LabelsTab } from "./Components/Tabs/LabelsTab";
import { PurchasesTab } from "./Components/Tabs/PurchasesTab";
import { InventoryTab } from "./Components/Tabs/InventoryTab";
import { FraudCustomersTab } from "./Components/Tabs/FraudCustomersTab";
import { ProductPhotosTab } from "./Components/Tabs/ProductPhotosTab";
import { MismatchTab } from "./Components/Tabs/MismatchTab";
import { ReturnClaimsTab } from "./Components/Tabs/ReturnClaimsTab";
import { ClaimedOrdersTab } from "./Components/Tabs/ClaimedOrdersTab";
import { SKU_PAGE_SIZE as skuPageSize } from "./lib/helper";
import TableData from "./Components/Table/TableData";

// ── API base (re-exported for tabs that import directly from App) ───────────
export const API = "/api";

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
  gray50:  "#F8FAFC",
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

export function btn(variant = "primary", size = "md") {
  const sizes = {
    sm: { padding: "5px 13px", fontSize: 12 },
    md: { padding: "9px 20px", fontSize: 13 },
    lg: { padding: "12px 28px", fontSize: 14 },
  };
  const variants = {
    primary:     { background: C.orange,      color: C.white,   border: "none",                          boxShadow: "0 2px 6px rgba(109,40,217,0.3)" },
    secondary:   { background: C.blue,        color: C.white,   border: "none",                          boxShadow: "0 2px 6px rgba(37,99,235,0.25)" },
    success:     { background: C.green,       color: C.white,   border: "none",                          boxShadow: "0 2px 6px rgba(5,150,105,0.25)" },
    danger:      { background: C.red,         color: C.white,   border: "none",                          boxShadow: "0 2px 6px rgba(225,29,72,0.25)" },
    ghost:       { background: "transparent", color: C.gray600, border: `1.5px solid ${C.gray200}`,      boxShadow: "none" },
    ghostOrange: { background: C.orangeLight, color: C.orange,  border: `1.5px solid ${C.orangeBorder}`, boxShadow: "none" },
  };
  return { ...variants[variant], ...sizes[size], borderRadius: 10, cursor: "pointer", fontWeight: 600, fontFamily: "inherit", transition: "opacity 0.15s, box-shadow 0.15s" };
}

const set = ["a", "b", "c", "d", "e", "f", "g"]

// ── Shared components ─────────────────────────────────────────────────────────
export function Tag({ children, variant = "gray", fontSize }) {
  const vars = {
    green: { bg: C.greenLight, color: C.green, border: C.greenBorder },
    red: { bg: C.redLight, color: C.red, border: C.redBorder },
    orange: { bg: C.orangeLight, color: C.orange, border: C.orangeBorder },
    blue: { bg: C.blueLight, color: C.blue, border: "#BFDBFE" },
    gray: { bg: C.gray100, color: C.gray600, border: C.gray200 },
    amber: { bg: C.amberLight, color: C.amber, border: "#FDE68A" },
  };
  C.colorsSet.map((color, index) => {
    vars[set[index]] = { bg: color, color: C.white, border: color }
  });
  const v = vars[variant] || vars.gray;
  return (
    <span style={{
      padding: "2px 8px", borderRadius: 20, fontSize: fontSize ?? 11, fontWeight: 600,
      background: v.bg, color: v.color, border: `1px solid ${v.border}`, whiteSpace: "nowrap",
    }}>{children}</span>
  );
}

export function StatusTag({ status }) {
  const s = (status || "").toUpperCase();
  const map = {
    DELIVERED: "green", RTO: "red", RETURN: "orange",
    PREMIUM_RETURN: "orange", PENDING: "blue", CANCELLED: "gray",
  };
  return <Tag variant={map[s] || "gray"}>{status || "—"}</Tag>;
}

export function StatCard({ label, value, sub, accent = C.orange, icon }) {
  const num = Number(value);
  const isNeg = !isNaN(num) && num < 0;
  const valColor = isNeg ? C.red : num > 0 ? C.green : C.gray800;
  return (
    <div style={{
      ...S.card,
      position: "relative", overflow: "hidden",
      borderTop: `3px solid ${accent}`, minWidth: "max-content",
    }}>
      {/* Corner accent glow */}
      <div style={{
        position: "absolute", top: -10, right: -10,
        width: 72, height: 72, borderRadius: "50%",
        background: accent, opacity: 0.08, pointerEvents: "none",
      }} />
      <p style={{ fontSize: 11, fontWeight: 700, color: C.gray400, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10, whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 5 }}>
        {icon && <span>{icon}</span>}{label}
      </p>
      <p style={{ fontSize: 26, fontWeight: 800, color: valColor, fontFamily: "monospace", lineHeight: 1.1, whiteSpace: "nowrap", letterSpacing: "-0.02em" }}>
        {value !== null && value !== undefined ? fmt(value) : sub || "—"}
      </p>
      {sub && value !== null && value !== undefined && (
        <p style={{ fontSize: 11, color: C.gray400, marginTop: 6, whiteSpace: "nowrap" }}>{sub}</p>
      )}
    </div>
  );
}

export function SectionHeader({ title, count, actions }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: C.gray800 }}>{title}</h2>
        {count !== undefined && (
          <span style={{ background: C.gray100, color: C.gray500, fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20, border: `1px solid ${C.gray200}` }}>
            {count}
          </span>
        )}
      </div>
      {actions && <div style={{ display: "flex", gap: 8 }}>{actions}</div>}
    </div>
  );
}

export function Pagination({ page, total, pageSize, onChange }) {
  const totalPages = Math.ceil(total / pageSize);
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14, padding: "10px 0 0", borderTop: `1px solid ${C.gray100}` }}>
      <span style={{ fontSize: 12, color: C.gray400 }}>
        {Math.min((page - 1) * pageSize + 1, total)}–{Math.min(page * pageSize, total)} of {total}
      </span>
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={() => onChange(page - 1)} disabled={page === 1} style={{ ...btn("ghost", "sm"), opacity: page === 1 ? 0.4 : 1 }}>← Prev</button>
        <span style={{ fontSize: 12, color: C.gray500, alignSelf: "center", padding: "0 4px" }}>Page {page} / {totalPages}</span>
        <button onClick={() => onChange(page + 1)} disabled={page >= totalPages} style={{ ...btn("ghost", "sm"), opacity: page >= totalPages ? 0.4 : 1 }}>Next →</button>
      </div>
    </div>
  );
}

// ── SKU Table (shared by SKU Analysis tab) ────────────────────────────────────
const SKU_PAGE_SIZE = skuPageSize;

export function SKUTable({ data, mode, onRowClick }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showTotalData, setShowTotalData] = useState(false);

  const filtered = data.filter(
    (s) => !search || s.sku_id.toLowerCase().includes(search.toLowerCase())
  );

  useEffect(() => { setPage(1); }, [search, data]);

  const visible = filtered.slice((page - 1) * SKU_PAGE_SIZE, page * SKU_PAGE_SIZE);

  const modeLabel =
    mode === "profit" ? "✅ Profitable SKUs" :
      mode === "loss" ? "⚠️ Loss-making SKUs" :
        "📊 All SKUs";

  const thR = { ...S.th, textAlign: "right" };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, flexWrap: "wrap", gap: 10 }}>
        <p style={{ ...S.cardTitle, marginBottom: 0 }}>
          {modeLabel} — {filtered.length} items
        </p>

        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search SKU…"
          style={{ ...S.inp, width: 220, fontSize: 12 }} />
      </div>
      <div style={{ display: "flex", alignItems: "center" }}>
        <input checked={showTotalData} onClick={() => setShowTotalData(prev => !prev)} type="checkbox" /> &nbsp;
        <span style={{ ...S.cardTitle, marginBottom: 0 }}>
          Show Total Data on Mouse Hover
        </span>

      </div>
      {onRowClick && (
        <p style={{ fontSize: 11, color: C.gray400, marginBottom: 12 }}>
          💡 Click any row to see monthly breakdown
        </p>
      )}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              <th style={S.th}>#</th>
              <th style={S.th}>SKU ID</th>
              <th style={thR}>Unit Price</th>
              <th style={thR}>Avg Profit/pc</th>
              <th style={thR}>Deliveries</th>
              <th style={thR}>Returns</th>
              <th style={thR}>RTO</th>
              <th style={thR}>Cancelled</th>
              <th style={thR}>Claims</th>
              <th style={thR}>Net P&L</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((s, i) => {
              const globalIdx = (page - 1) * SKU_PAGE_SIZE + i;
              const rowBg = globalIdx % 2 === 0 ? C.white : C.gray100;
              const delCount = s.delivered_count ?? 0;
              const retCount = s.return_count ?? 0;
              const rtoCount = s.rto_count ?? 0;
              const claimCount = s.claims_count ?? 0;
              return (
                <tr key={s.sku_id}
                  style={{ background: rowBg, cursor: onRowClick ? "pointer" : "default" }}
                  onClick={() => onRowClick?.(s)}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#F0F7FF")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = rowBg)}
                >
                  <td style={{ ...S.td, color: C.gray400, fontSize: 11 }}>{globalIdx + 1}</td>

                  {/* SKU ID */}
                  <td style={S.td}>
                    <span style={{ fontFamily: "monospace", fontSize: 12, color: C.orange, fontWeight: 600, background: C.orangeLight, padding: "2px 6px", borderRadius: 4 }}>
                      {s.sku_id}
                    </span>
                  </td>

                  {/* Unit Price */}
                  <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 600 }}>
                    {fmt(s.one_unit_price)}
                  </td>

                  {/* Avg Profit per piece */}
                  <td style={{ ...S.td, textAlign: "right" }}>
                    {s.avg_profit_per_piece != null
                      ? <span style={{
                          fontFamily: "monospace", fontWeight: 700, fontSize: 12,
                          color: s.avg_profit_per_piece >= 0 ? C.green : C.red,
                        }}>{s.avg_profit_per_piece >= 0 ? "+" : ""}{fmt(s.avg_profit_per_piece)}</span>
                      : <span style={{ color: C.gray300 }}>—</span>}
                  </td>

                  <TableData showTotalData={showTotalData} mainKey={delCount} data={s} dataKey="delivered" color="green" profit />
                  <TableData showTotalData={showTotalData} mainKey={retCount} data={s} dataKey="return" color="red" />
                  <TableData showTotalData={showTotalData} mainKey={rtoCount} data={s} dataKey="rto" />

                  {/* Cancelled: count only (settlement is always 0) */}
                  <td style={{ ...S.td, textAlign: "right" }}>
                    {(s.cancelled_count || 0) > 0
                      ? <Tag variant="gray">{s.cancelled_count} cancelled</Tag>
                      : <span style={{ color: C.gray300 }}>—</span>
                    }
                  </td>

                  <TableData showTotalData={showTotalData} mainKey={claimCount} data={s} dataKey="claims" color="blue" profit claims />

                  {/* Net P&L */}
                  <td style={{ ...S.td, textAlign: "right" }}>
                    <span style={{
                      fontFamily: "monospace", fontWeight: 700, fontSize: 13,
                      background: s.net_profit >= 0 ? C.greenLight : C.redLight,
                      color: s.net_profit >= 0 ? C.green : C.red,
                      border: `1px solid ${s.net_profit >= 0 ? C.greenBorder : C.redBorder}`,
                      padding: "3px 10px", borderRadius: 6, display: "inline-block",
                    }}>
                      {fmt(s.net_profit)}
                    </span>
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr><td colSpan={10} style={{ ...S.td, textAlign: "center", padding: 40, color: C.gray400 }}>
                {data.length === 0 ? "No data — upload Meesho report and add SKU pricing first" : "No results matching search"}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      {filtered.length > SKU_PAGE_SIZE && (
        <Pagination page={page} total={filtered.length} pageSize={SKU_PAGE_SIZE} onChange={setPage} />
      )}
    </div>
  );
}

// ── Navigation config ─────────────────────────────────────────────────────────
const NAV_GROUPS = [
  {
    label: "Analytics",
    color: "#A78BFA",
    items: [
      { path: "/",             label: "Overview",     icon: "◈" , end: true },
      { path: "/sku-analysis", label: "SKU Analysis", icon: "↗" },
    ],
  },
  {
    label: "Operations",
    color: "#34D399",
    items: [
      { path: "/orders",        label: "Orders",          icon: "⊡" },
      { path: "/payments",      label: "Payments",        icon: "◎" },
      { path: "/unsettled",     label: "Unsettled",       icon: "⚡" },
      { path: "/return-claims", label: "Returns & Claims", icon: "↩" },
      { path: "/claimed",       label: "Claimed Orders",  icon: "✦" },
      { path: "/mismatch",      label: "Pay Mismatch",    icon: "⊝" },
      { path: "/labels",        label: "Labels",          icon: "⊟" },
    ],
  },
  {
    label: "Catalog",
    color: "#60A5FA",
    items: [
      { path: "/pricing",   label: "SKU Pricing", icon: "⊞" },
      { path: "/inventory", label: "Inventory",   icon: "⊕" },
      { path: "/purchases", label: "Purchases",   icon: "⊗" },
    ],
  },
  {
    label: "Tools",
    color: "#FBBF24",
    items: [
      { path: "/upload",         label: "Upload Data", icon: "⇧" },
      { path: "/product-photos", label: "AI Photos",   icon: "✦" },
      { path: "/fraud",          label: "Fraud Watch", icon: "⊘" },
    ],
  },
];

const ALL_NAV = NAV_GROUPS.flatMap(g => g.items);

// ── Sidebar nav item ──────────────────────────────────────────────────────────
function NavItem({ item, collapsed }) {
  const [hovered, setHovered] = useState(false);
  return (
    <NavLink
      to={item.path} end={item.end}
      title={collapsed ? item.label : undefined}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={({ isActive }) => ({
        display: "flex", alignItems: "center", gap: 11, textDecoration: "none",
        padding: collapsed ? "10px 0" : "8px 12px",
        justifyContent: collapsed ? "center" : "flex-start",
        margin: "1px 8px", borderRadius: 10,
        transition: "background 0.12s, color 0.12s",
        background: isActive
          ? "rgba(167,139,250,0.14)"
          : hovered ? "rgba(255,255,255,0.06)" : "transparent",
        color: isActive ? "#E9D5FF" : hovered ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.45)",
        position: "relative",
      })}
    >
      {/* Active left indicator */}
      {!collapsed && (
        <div style={{
          position: "absolute", left: 0, top: "20%", bottom: "20%", width: 3,
          borderRadius: "0 3px 3px 0",
          background: "transparent",
        }} />
      )}
      <span style={{
        fontSize: 15, lineHeight: 1, flexShrink: 0, fontWeight: 500,
        fontFamily: "system-ui, sans-serif",
      }}>{item.icon}</span>
      {!collapsed && (
        <span style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", letterSpacing: "0.005em" }}>
          {item.label}
        </span>
      )}
    </NavLink>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
const SIDEBAR_BG   = "#13111C";
const SIDEBAR_BG2  = "#0E0C18";
const DIVIDER      = "rgba(255,255,255,0.07)";

function Sidebar({ collapsed, setCollapsed }) {
  const [btnHovered, setBtnHovered] = useState(false);
  const W = collapsed ? 60 : 232;

  return (
    <div style={{
      width: W, minWidth: W, height: "100vh", position: "sticky", top: 0,
      background: `linear-gradient(180deg, ${SIDEBAR_BG} 0%, ${SIDEBAR_BG2} 100%)`,
      display: "flex", flexDirection: "column",
      transition: "width 0.22s cubic-bezier(.4,0,.2,1), min-width 0.22s cubic-bezier(.4,0,.2,1)",
      overflow: "hidden", zIndex: 100, flexShrink: 0,
      borderRight: `1px solid ${DIVIDER}`,
    }}>

      {/* Brand */}
      <div style={{
        height: 64, display: "flex", alignItems: "center", flexShrink: 0,
        padding: collapsed ? "0" : "0 18px",
        justifyContent: collapsed ? "center" : "flex-start", gap: 12,
        borderBottom: `1px solid ${DIVIDER}`,
      }}>
        {/* Logo mark — "R" monogram */}
        <div style={{
          width: 34, height: 34, borderRadius: 10, flexShrink: 0,
          background: "linear-gradient(135deg, #7C3AED 0%, #4F46E5 100%)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 16, fontWeight: 900, color: "#fff",
          fontFamily: "system-ui, sans-serif",
          boxShadow: "0 4px 12px rgba(124,58,237,0.4)",
          letterSpacing: "-0.02em",
        }}>R</div>
        {!collapsed && (
          <div style={{ overflow: "hidden", minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#F8F8FF", letterSpacing: "-0.02em", whiteSpace: "nowrap" }}>
              Rudam
            </div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontWeight: 500, whiteSpace: "nowrap", letterSpacing: "0.02em" }}>
              Ecommerce Profit Analyser
            </div>
          </div>
        )}
      </div>

      {/* Nav */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 0 8px", scrollbarWidth: "none" }}>
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.label} style={{ marginBottom: collapsed ? 4 : 8 }}>
            {collapsed ? (
              <div style={{ height: 1, background: DIVIDER, margin: gi === 0 ? "0 10px 8px" : "8px 10px" }} />
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 18px 5px" }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: group.color, flexShrink: 0 }} />
                <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.25)", letterSpacing: "0.12em", textTransform: "uppercase" }}>
                  {group.label}
                </span>
              </div>
            )}
            {group.items.map(item => <NavItem key={item.path} item={item} collapsed={collapsed} />)}
          </div>
        ))}
      </div>

      {/* Collapse toggle */}
      <div style={{ borderTop: `1px solid ${DIVIDER}`, padding: "10px 8px" }}>
        <button
          onClick={() => setCollapsed(c => !c)}
          onMouseEnter={() => setBtnHovered(true)} onMouseLeave={() => setBtnHovered(false)}
          style={{
            display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "space-between",
            padding: collapsed ? "8px 0" : "8px 12px", width: "100%",
            background: btnHovered ? "rgba(255,255,255,0.06)" : "transparent",
            border: "none", borderRadius: 10, cursor: "pointer", fontFamily: "inherit",
            color: btnHovered ? "rgba(255,255,255,0.65)" : "rgba(255,255,255,0.3)",
            transition: "background 0.15s, color 0.15s",
          }}
        >
          {!collapsed && <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.04em" }}>Collapse</span>}
          <span style={{ fontSize: 13 }}>{collapsed ? "›" : "‹"}</span>
        </button>
      </div>
    </div>
  );
}

// ── Top bar ───────────────────────────────────────────────────────────────────
function TopBar() {
  const loc = useLocation();
  const current = ALL_NAV.find(item =>
    item.end ? loc.pathname === item.path : loc.pathname.startsWith(item.path)
  );
  const dateStr = new Date().toLocaleDateString("en-IN", {
    weekday: "short", day: "numeric", month: "long", year: "numeric",
  });

  return (
    <div style={{
      background: C.white, borderBottom: `1px solid ${C.border}`,
      padding: "0 28px", height: 56, flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      boxShadow: "0 1px 0 rgba(0,0,0,0.06)",
    }}>
      {/* Breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 12, color: C.gray400, fontWeight: 500 }}>Rudam</span>
        <span style={{ fontSize: 12, color: C.gray300 }}>/</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: C.gray800 }}>
          {current?.label ?? "Dashboard"}
        </span>
      </div>

      {/* Right section */}
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <span style={{ fontSize: 12, color: C.gray400, fontWeight: 500 }}>{dateStr}</span>
        {/* Brand pill */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          background: C.orangeLight, border: `1px solid ${C.orangeBorder}`,
          borderRadius: 20, padding: "5px 12px",
        }}>
          <div style={{ width: 18, height: 18, borderRadius: 6, background: "linear-gradient(135deg, #7C3AED 0%, #4F46E5 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 900, color: "#fff" }}>R</div>
          <span style={{ fontSize: 12, fontWeight: 700, color: C.orange }}>Rudam</span>
        </div>
      </div>
    </div>
  );
}

// ── App shell ─────────────────────────────────────────────────────────────────
export default function App() {
  const [collapsed, setCollapsed] = useState(() =>
    localStorage.getItem("sidebar_collapsed") === "true"
  );
  useEffect(() => {
    localStorage.setItem("sidebar_collapsed", String(collapsed));
  }, [collapsed]);

  return (
    <div style={{
      display: "flex", height: "100vh",
      background: C.bg, color: C.gray800,
      fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
      overflow: "hidden",
    }}>
      <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} />

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <TopBar />
        <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>
          <Routes>
            <Route path="/"               element={<OverviewTab />} />
            <Route path="/orders"         element={<OrdersTab />} />
            <Route path="/unsettled"       element={<UnsettledOrdersTab />} />
            <Route path="/payments"        element={<PaymentsTab />} />
            <Route path="/mismatch"        element={<MismatchTab />} />
            <Route path="/return-claims"   element={<ReturnClaimsTab />} />
            <Route path="/claimed"         element={<ClaimedOrdersTab />} />
            <Route path="/sku-analysis"   element={<SKUAnalysisTab />} />
            <Route path="/pricing"        element={<PricingTab />} />
            <Route path="/upload"         element={<UploadTab />} />
            <Route path="/labels"         element={<LabelsTab />} />
            <Route path="/purchases"      element={<PurchasesTab />} />
            <Route path="/inventory"      element={<InventoryTab />} />
            <Route path="/fraud"          element={<FraudCustomersTab />} />
            <Route path="/product-photos" element={<ProductPhotosTab />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
