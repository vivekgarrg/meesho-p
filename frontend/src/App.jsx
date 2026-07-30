import React from "react";
import { useState, useEffect } from "react";
import { Routes, Route, NavLink, useLocation, Navigate, useNavigate } from "react-router-dom";

// ── Shared design tokens / formatters / API base ─────────────────────────────
// IMPORTANT: this import must come BEFORE the Tab imports below. The tabs
// import these tokens back from App (re-exported at the bottom), and some use
// them at module scope (e.g. TaxCheckTab's STATUS_META). Importing ./shared
// first guarantees it initializes before any tab module evaluates, avoiding a
// "Cannot access 'C' before initialization" (TDZ) crash in the production build.
import { API, fmt, C, CHART_COLORS, STATUS_COLORS, S, useIsMobile } from "./shared";

// ── Tab components ─────────────────────────────────────────────────────────────
import { OverviewTab } from "./Components/Tabs/OverviewTab";
import { UnsettledOrdersTab } from "./Components/Tabs/UnsettledOrdersTab";
import { OrdersTab } from "./Components/Tabs/OrdersTab";
import { PaymentsTab } from "./Components/Tabs/PaymentsTab";
import { UnscheduledPaymentTab } from "./Components/Tabs/UnscheduledPaymentTab";
import { ExpensesTab } from "./Components/Tabs/ExpensesTab";
import { PricingTab } from "./Components/Tabs/PricingTab";
import { TaxCheckTab } from "./Components/Tabs/TaxCheckTab";
import { UploadTab } from "./Components/Tabs/UploadTab";
import { SKUAnalysisTab } from "./Components/Tabs/SKUProfitTab";
import { EstimatedProfitTab } from "./Components/Tabs/EstimatedProfitTab";
import { LabelsTab } from "./Components/Tabs/LabelsTab";
import { PurchasesTab } from "./Components/Tabs/PurchasesTab";
import { InventoryTab } from "./Components/Tabs/InventoryTab";
import { InventoryLabelsTab } from "./Components/Tabs/InventoryLabelsTab";
import { AdsAnalysisTab } from "./Components/Tabs/AdsAnalysisTab";
import { MeeshoStockTab } from "./Components/Tabs/MeeshoStockTab";
import { FraudCustomersTab } from "./Components/Tabs/FraudCustomersTab";
import { ProductPhotosTab } from "./Components/Tabs/ProductPhotosTab";
import { MismatchTab } from "./Components/Tabs/MismatchTab";
import { MeeshoInventoryTab } from "./Components/Tabs/MeeshoInventoryTab";
import { MeeshoPricingTab } from "./Components/Tabs/MeeshoPricingTab";
import { ReturnScanTab } from "./Components/Tabs/ReturnScanTab";
import { SKU_PAGE_SIZE as skuPageSize } from "./lib/helper";
import TableData from "./Components/Table/TableData";
import LoginPage from "./Components/Login/LoginPage";
import BusinessProfilePage from "./Components/BusinessProfile/BusinessProfilePage";
import BusinessSwitcher from "./Components/BusinessSwitcher";
import { useBusiness } from "./contexts/BusinessContext";
import { DateFilterProvider } from "./contexts/DateFilterContext";
import { GlobalDateFilterBar } from "./Components/shared/GlobalDateFilterBar";
import ChangePasswordModal from "./Components/ChangePasswordModal";
import AdminPanel from "./Components/Admin/AdminPanel";
import { useAuth } from "./contexts/AuthContext";

// Re-export the shared tokens (imported at the top of this file) so existing
// `import { C, fmt, ... } from "../App"` statements across the app keep working.
export { API, fmt, C, CHART_COLORS, STATUS_COLORS, S, useIsMobile, useIsTablet, BP } from "./shared";

export function btn(variant = "primary", size = "md") {
  const sizes = {
    sm: { padding: "5px 13px", fontSize: 12 },
    md: { padding: "9px 20px", fontSize: 13 },
    lg: { padding: "12px 28px", fontSize: 14 },
  };
  const variants = {
    primary: { background: C.orange, color: C.white, border: "none", boxShadow: "0 2px 6px rgba(109,40,217,0.3)" },
    secondary: { background: C.blue, color: C.white, border: "none", boxShadow: "0 2px 6px rgba(37,99,235,0.25)" },
    success: { background: C.green, color: C.white, border: "none", boxShadow: "0 2px 6px rgba(5,150,105,0.25)" },
    danger: { background: C.red, color: C.white, border: "none", boxShadow: "0 2px 6px rgba(225,29,72,0.25)" },
    ghost: { background: "transparent", color: C.gray600, border: `1.5px solid ${C.gray200}`, boxShadow: "none" },
    ghostOrange: { background: C.orangeLight, color: C.orange, border: `1.5px solid ${C.orangeBorder}`, boxShadow: "none" },
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
export const NAV_GROUPS = [
  {
    label: "Analytics",
    color: "#A78BFA",
    items: [
      { path: "/", label: "Overview", icon: "◈", end: true },
      { path: "/sku-analysis", label: "SKU Analysis", icon: "↗" },
      { path: "/ads-analysis", label: "Ads Analysis", icon: "◬" },
      { path: "/estimated-profit", label: "Estimated Profit", icon: "🧮" },
    ],
  },
  {
    label: "Operations",
    color: "#34D399",
    items: [
      { path: "/orders", label: "Orders", icon: "⊡" },
      { path: "/payments", label: "Payments", icon: "◎" },
      { path: "/unscheduled", label: "Unscheduled Pay", icon: "◷" },
      { path: "/unsettled", label: "Unsettled", icon: "⚡" },
      { path: "/mismatch", label: "Pay Mismatch", icon: "⊝" },
      { path: "/labels", label: "Labels", icon: "⊟" },
      { path: "/returns", label: "Returns & Claims", icon: "⟲" },
    ],
  },
  {
    label: "Catalog",
    color: "#60A5FA",
    items: [
      { path: "/pricing", label: "SKU Pricing", icon: "⊞" },
      { path: "/tax-check", label: "Tax Check", icon: "%" },
      { path: "/inventory", label: "Inventory", icon: "⊕" },
      { path: "/inventory-labels", label: "Labels & Barcodes", icon: "▥" },
      { path: "/meesho-inventory", label: "Meesho Stock", icon: "⊞" },
      { path: "/meesho-pricing", label: "Price Update", icon: "₹" },
      { path: "/purchases", label: "Purchases", icon: "⊗" },
      { path: "/expenses", label: "Expenses", icon: "⊜" },
    ],
  },
  {
    label: "Tools",
    color: "#FBBF24",
    items: [
      { path: "/upload", label: "Upload Data", icon: "⇧" },
      { path: "/product-photos", label: "AI Photos", icon: "✦" },
      { path: "/fraud", label: "Fraud Watch", icon: "⊘" },
      { path: "/business-profile", label: "Business Profile", icon: "⌂" },
    ],
  },
  {
    label: "Administration",
    color: "#F472B6",
    adminOnly: true,
    items: [
      { path: "/admin", label: "Admin Panel", icon: "⚙", adminOnly: true },
    ],
  },
];

const ALL_NAV = NAV_GROUPS.flatMap(g => g.items);

// ── Sidebar nav item ──────────────────────────────────────────────────────────
function NavItem({ item, collapsed, onNavigate, touch }) {
  const [hovered, setHovered] = useState(false);
  return (
    <NavLink
      to={item.path} end={item.end}
      title={collapsed ? item.label : undefined}
      onClick={onNavigate}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={({ isActive }) => ({
        display: "flex", alignItems: "center", gap: 11, textDecoration: "none",
        // Roomier rows on touch, where a 30px target is a miss risk.
        padding: collapsed ? "10px 0" : touch ? "12px 14px" : "8px 12px",
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
        <span style={{ fontSize: touch ? 14 : 13, fontWeight: 500, whiteSpace: "nowrap", letterSpacing: "0.005em" }}>
          {item.label}
        </span>
      )}
    </NavLink>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
const SIDEBAR_BG = "#13111C";
const SIDEBAR_BG2 = "#0E0C18";
const DIVIDER = "rgba(255,255,255,0.07)";

// Paths that must never be hidden by the visibility config, so a super-admin
// can always reach the Admin Panel to change the sidebar settings back.
export const ALWAYS_VISIBLE_PATHS = ["/admin"];

function Sidebar({ collapsed, setCollapsed, isMobile, mobileOpen, closeMobile }) {
  const [btnHovered, setBtnHovered] = useState(false);
  const { isSuperAdmin, navVisibility } = useAuth();

  // The visibility filter applies to everyone (including super-admins), but only
  // once an admin has actually configured a list. Until then, show every tab.
  const isConfigured = !!navVisibility?.configured;
  const visibleSet = new Set(navVisibility?.visiblePaths || []);
  const isPathVisible = (path) =>
    !isConfigured ||
    visibleSet.has(path) ||
    (isSuperAdmin && ALWAYS_VISIBLE_PATHS.includes(path));

  const navGroups = NAV_GROUPS
    .filter((g) => !g.adminOnly || isSuperAdmin)
    .map((g) => ({ ...g, items: g.items.filter((item) => isPathVisible(item.path)) }))
    .filter((g) => g.items.length > 0);
  // On mobile the sidebar is never collapsed-to-icons — it's an off-canvas
  // drawer that slides over the content, because a 232px rail on a 390px screen
  // leaves nothing usable behind it.
  const onMobile = isMobile;
  const iconsOnly = !onMobile && collapsed;
  const W = onMobile ? 268 : collapsed ? 60 : 232;

  const shellStyle = onMobile
    ? {
        width: W, minWidth: W,
        position: "fixed", top: 0, bottom: 0, left: 0,
        transform: mobileOpen ? "translateX(0)" : "translateX(-100%)",
        transition: "transform 0.24s cubic-bezier(.4,0,.2,1)",
        boxShadow: mobileOpen ? "4px 0 28px rgba(0,0,0,0.4)" : "none",
        zIndex: 1200,
      }
    : {
        width: W, minWidth: W, height: "100vh", position: "sticky", top: 0,
        transition: "width 0.22s cubic-bezier(.4,0,.2,1), min-width 0.22s cubic-bezier(.4,0,.2,1)",
        zIndex: 100,
      };

  return (
    <div style={{
      background: `linear-gradient(180deg, ${SIDEBAR_BG} 0%, ${SIDEBAR_BG2} 100%)`,
      display: "flex", flexDirection: "column",
      overflow: "hidden", flexShrink: 0,
      borderRight: `1px solid ${DIVIDER}`,
      ...shellStyle,
    }}>

      {/* Brand */}
      <div style={{
        height: 64, display: "flex", alignItems: "center", flexShrink: 0,
        padding: iconsOnly ? "0" : "0 18px",
        justifyContent: iconsOnly ? "center" : "flex-start", gap: 12,
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
        {!iconsOnly && (
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
        {navGroups.map((group, gi) => (
          <div key={group.label} style={{ marginBottom: iconsOnly ? 4 : 8 }}>
            {iconsOnly ? (
              <div style={{ height: 1, background: DIVIDER, margin: gi === 0 ? "0 10px 8px" : "8px 10px" }} />
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 18px 5px" }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: group.color, flexShrink: 0 }} />
                <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.25)", letterSpacing: "0.12em", textTransform: "uppercase" }}>
                  {group.label}
                </span>
              </div>
            )}
            {group.items.map(item => (
              <NavItem
                key={item.path}
                item={item}
                collapsed={iconsOnly}
                // Tapping a link on mobile should navigate *and* get the drawer
                // out of the way, which is what every drawer nav does.
                onNavigate={onMobile ? closeMobile : undefined}
                touch={onMobile}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Collapse toggle (desktop) / close drawer (mobile) */}
      <div style={{ borderTop: `1px solid ${DIVIDER}`, padding: "10px 8px" }}>
        <button
          onClick={() => (onMobile ? closeMobile() : setCollapsed(c => !c))}
          onMouseEnter={() => setBtnHovered(true)} onMouseLeave={() => setBtnHovered(false)}
          style={{
            display: "flex", alignItems: "center", justifyContent: iconsOnly ? "center" : "space-between",
            padding: iconsOnly ? "8px 0" : "8px 12px", width: "100%",
            background: btnHovered ? "rgba(255,255,255,0.06)" : "transparent",
            border: "none", borderRadius: 10, cursor: "pointer", fontFamily: "inherit",
            color: btnHovered ? "rgba(255,255,255,0.65)" : "rgba(255,255,255,0.3)",
            transition: "background 0.15s, color 0.15s",
          }}
        >
          {!iconsOnly && (
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.04em" }}>
              {onMobile ? "Close menu" : "Collapse"}
            </span>
          )}
          <span style={{ fontSize: 13 }}>{onMobile ? "✕" : iconsOnly ? "›" : "‹"}</span>
        </button>
      </div>
    </div>
  );
}

// ── User menu (top-right) ─────────────────────────────────────────────────────
function UserMenu({ onChangePassword, compact }) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  const initial = (user?.username || "?").charAt(0).toUpperCase();

  return (
    <div style={{ position: "relative" }} onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
          background: "transparent", border: "none", fontFamily: "inherit",
        }}
      >
        <div style={{
          width: 30, height: 30, borderRadius: "50%",
          background: "linear-gradient(135deg, #7C3AED 0%, #4F46E5 100%)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 13, fontWeight: 800, color: "#fff",
        }}>{initial}</div>
        {/* On mobile only the avatar shows — the name/role block is what pushed
            this row off the right edge of the screen. */}
        {!compact && (
          <>
            <div style={{ textAlign: "left", lineHeight: 1.2 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.gray800 }}>{user?.username}</div>
              <div style={{ fontSize: 10, color: C.gray400 }}>
                {user?.role === "super_admin" ? "Super Admin" : "Business User"}
              </div>
            </div>
            <span style={{ fontSize: 10, color: C.gray400 }}>▾</span>
          </>
        )}
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 8px)", right: 0, minWidth: 180,
          background: C.white, border: `1px solid ${C.border}`, borderRadius: 12,
          boxShadow: "0 8px 28px rgba(0,0,0,0.14)", padding: 6, zIndex: 500,
        }}>
          <button
            onClick={() => { setOpen(false); onChangePassword(); }}
            style={{
              width: "100%", textAlign: "left", padding: "9px 12px", borderRadius: 8,
              background: "transparent", border: "none", cursor: "pointer",
              fontFamily: "inherit", fontSize: 13, color: C.gray700,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = C.gray100)}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            🔑 Change password
          </button>
          <button
            onClick={handleLogout}
            style={{
              width: "100%", textAlign: "left", padding: "9px 12px", borderRadius: 8,
              background: "transparent", border: "none", cursor: "pointer",
              fontFamily: "inherit", fontSize: 13, color: C.red,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = C.redLight)}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            ⎋ Logout
          </button>
        </div>
      )}
    </div>
  );
}

// ── Top bar ───────────────────────────────────────────────────────────────────
function TopBar({ isMobile, onOpenMenu }) {
  const loc = useLocation();
  const [showChangePassword, setShowChangePassword] = useState(false);
  const current = ALL_NAV.find(item =>
    item.end ? loc.pathname === item.path : loc.pathname.startsWith(item.path)
  );
  const dateStr = new Date().toLocaleDateString("en-IN", {
    weekday: "short", day: "numeric", month: "long", year: "numeric",
  });

  return (
    <div style={{
      background: C.white, borderBottom: `1px solid ${C.border}`,
      padding: isMobile ? "0 12px" : "0 28px", height: 56, flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      gap: 8, boxShadow: "0 1px 0 rgba(0,0,0,0.06)",
    }}>
      {/* Left section — hamburger (mobile) + business selector + breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 8 : 16, minWidth: 0 }}>
        {isMobile && (
          <button
            onClick={onOpenMenu}
            aria-label="Open menu"
            style={{
              display: "flex", flexDirection: "column", justifyContent: "center", gap: 4,
              width: 38, height: 38, flexShrink: 0, padding: 9,
              background: C.gray100, border: `1px solid ${C.border}`,
              borderRadius: 10, cursor: "pointer",
            }}
          >
            {[0, 1, 2].map(i => (
              <span key={i} style={{ display: "block", height: 2, borderRadius: 2, background: C.gray700 }} />
            ))}
          </button>
        )}
        <BusinessSwitcher />
        {/* The breadcrumb duplicates the page's own <h1> — drop it on mobile
            where the row has no room to spare. */}
        {!isMobile && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, color: C.gray300 }}>/</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: C.gray800 }}>
              {current?.label ?? "Dashboard"}
            </span>
          </div>
        )}
      </div>

      {/* Right section */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexShrink: 0 }}>
        {!isMobile && (
          <span style={{ fontSize: 12, color: C.gray400, fontWeight: 500 }}>{dateStr}</span>
        )}
        <UserMenu onChangePassword={() => setShowChangePassword(true)} compact={isMobile} />
      </div>

      {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} />}
    </div>
  );
}

// ── Authenticated app shell ───────────────────────────────────────────────────
function AppShell() {
  const { activeBusinessId } = useBusiness();
  const isMobile = useIsMobile();
  const loc = useLocation();
  const [collapsed, setCollapsed] = useState(() =>
    localStorage.getItem("sidebar_collapsed") === "true"
  );
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem("sidebar_collapsed", String(collapsed));
  }, [collapsed]);

  // Close the drawer on navigation, and whenever the viewport grows back to
  // desktop — otherwise a stale open drawer overlays the restored sidebar.
  useEffect(() => { setDrawerOpen(false); }, [loc.pathname]);
  useEffect(() => { if (!isMobile) setDrawerOpen(false); }, [isMobile]);

  // Don't let the page behind the drawer scroll under your finger.
  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [drawerOpen]);

  return (
    <div style={{
      display: "flex",
      // 100dvh tracks the shrinking/growing mobile browser chrome; 100vh alone
      // leaves the bottom of the app hidden under Safari's toolbar.
      height: "100dvh", minHeight: "100vh",
      background: C.bg, color: C.gray800,
      fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
      overflow: "hidden",
    }}>
      <Sidebar
        collapsed={collapsed}
        setCollapsed={setCollapsed}
        isMobile={isMobile}
        mobileOpen={drawerOpen}
        closeMobile={() => setDrawerOpen(false)}
      />

      {/* Backdrop — tap anywhere to dismiss the drawer */}
      {isMobile && drawerOpen && (
        <div
          onClick={() => setDrawerOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 1100,
            background: "rgba(0,0,0,0.5)",
          }}
        />
      )}

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <TopBar isMobile={isMobile} onOpenMenu={() => setDrawerOpen(true)} />
        {/* Global period filter — stays mounted across route changes and
            business switches so it's never remounted, only its context value
            changes. Every tab reads the active range from useDateFilter(). */}
        <GlobalDateFilterBar />
        {/* key by active business so switching businesses remounts the routed
            view, forcing every tab (dashboard included) to refetch fresh data
            against the newly-set business-scoped API base. */}
        <div key={activeBusinessId ?? "none"} style={{
          flex: 1, overflowY: "auto", overflowX: "hidden",
          padding: isMobile ? "16px 12px 40px" : "28px 32px",
          WebkitOverflowScrolling: "touch",
        }}>
          <Routes>
            <Route path="/" element={<OverviewTab />} />
            <Route path="/orders" element={<OrdersTab />} />
            <Route path="/unsettled" element={<UnsettledOrdersTab />} />
            <Route path="/payments" element={<PaymentsTab />} />
            <Route path="/unscheduled" element={<UnscheduledPaymentTab />} />
            <Route path="/mismatch" element={<MismatchTab />} />
            <Route path="/sku-analysis" element={<SKUAnalysisTab />} />
            <Route path="/ads-analysis" element={<AdsAnalysisTab />} />
            <Route path="/estimated-profit" element={<EstimatedProfitTab />} />
            <Route path="/pricing" element={<PricingTab />} />
            <Route path="/tax-check" element={<TaxCheckTab />} />
            <Route path="/upload" element={<UploadTab />} />
            <Route path="/labels" element={<LabelsTab />} />
            <Route path="/returns" element={<ReturnScanTab />} />
            <Route path="/purchases" element={<PurchasesTab />} />
            <Route path="/expenses" element={<ExpensesTab />} />
            <Route path="/inventory" element={<InventoryTab />} />
            <Route path="/inventory-labels" element={<InventoryLabelsTab />} />
            <Route path="/meesho-inventory" element={<MeeshoInventoryTab />} />
            <Route path="/meesho-pricing" element={<MeeshoPricingTab />} />
            <Route path="/fraud" element={<FraudCustomersTab />} />
            <Route path="/product-photos" element={<ProductPhotosTab />} />
            <Route path="/business-profile" element={<BusinessProfilePage />} />
            <Route path="/admin" element={<AdminPanel />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div style={{
      height: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: C.bg, color: C.gray400, fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
      fontSize: 13, fontWeight: 600,
    }}>
      Loading…
    </div>
  );
}

// ── App root ──────────────────────────────────────────────────────────────────
export default function App() {
  const { user, loading } = useAuth();
  const loc = useLocation();

  if (loading) return <LoadingScreen />;

  if (loc.pathname === "/login") {
    return user ? <Navigate to="/" replace /> : <LoginPage />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <DateFilterProvider>
      <AppShell />
    </DateFilterProvider>
  );
}
