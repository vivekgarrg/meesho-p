import React from "react";
import { useState, useEffect } from "react";
import { Routes, Route, NavLink } from "react-router-dom";

// ── Tab components ─────────────────────────────────────────────────────────────
import { OverviewTab }         from "./Components/Tabs/OverviewTab";
import { UnsettledOrdersTab } from "./Components/Tabs/UnsettledOrdersTab";
import { OrdersTab }    from "./Components/Tabs/OrdersTab";
import { PaymentsTab }  from "./Components/Tabs/PaymentsTab";
import { PricingTab }   from "./Components/Tabs/PricingTab";
import { UploadTab }    from "./Components/Tabs/UploadTab";
import { SKUAnalysisTab } from "./Components/Tabs/SKUProfitTab";
import { LabelsTab }       from "./Components/Tabs/LabelsTab";
import { SKU_PAGE_SIZE as skuPageSize } from "./lib/helper";

// ── API base (re-exported for tabs that import directly from App) ───────────
export const API = "http://localhost:8000/api";

// ── Formatters ─────────────────────────────────────────────────────────────────
export const fmt = (n) =>
  n === null || n === undefined
    ? "—"
    : `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── Design tokens ─────────────────────────────────────────────────────────────
export const C = {
  orange: "#E8510A",
  orangeLight: "#FFF0EA",
  orangeBorder: "#F5C4AD",
  green: "#16A34A",
  greenLight: "#F0FDF4",
  greenBorder: "#BBF7D0",
  red: "#DC2626",
  redLight: "#FEF2F2",
  redBorder: "#FECACA",
  blue: "#2563EB",
  blueLight: "#EFF6FF",
  amber: "#D97706",
  amberLight: "#FFFBEB",
  gray50: "#F9FAFB",
  gray100: "#F3F4F6",
  gray200: "#E5E7EB",
  gray300: "#D1D5DB",
  gray400: "#9CA3AF",
  gray500: "#6B7280",
  gray600: "#4B5563",
  gray700: "#374151",
  gray800: "#1F2937",
  gray900: "#111827",
  white: "#FFFFFF",
  border: "#E5E7EB",
  bg: "#F5F6FA",
  surface: "#FFFFFF",
};

export const CHART_COLORS = [C.orange, "#F59E0B", "#10B981", "#3B82F6", "#8B5CF6", "#EC4899", "#06B6D4", "#84CC16"];

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
    borderRadius: 12,
    padding: 24,
    boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
  },
  cardTitle: {
    fontSize: 12, fontWeight: 700, color: C.gray500,
    marginBottom: 16, letterSpacing: "0.06em", textTransform: "uppercase",
  },
  th: {
    padding: "11px 14px", textAlign: "left", color: C.gray500,
    fontSize: 11, fontWeight: 700, letterSpacing: "0.05em",
    textTransform: "uppercase", borderBottom: `1px solid ${C.border}`,
    background: C.gray50, whiteSpace: "nowrap",
  },
  td: {
    padding: "10px 14px", color: C.gray700, fontSize: 13,
    borderBottom: `1px solid ${C.gray100}`,
  },
  inp: {
    background: C.white, border: `1px solid ${C.gray300}`,
    borderRadius: 8, padding: "9px 12px", color: C.gray800,
    fontSize: 13, outline: "none", width: "100%",
    fontFamily: "inherit", transition: "border-color 0.15s",
  },
  label: { fontSize: 12, fontWeight: 600, color: C.gray600, display: "block", marginBottom: 5 },
};

export function btn(variant = "primary", size = "md") {
  const sizes = {
    sm: { padding: "5px 12px", fontSize: 12 },
    md: { padding: "9px 18px", fontSize: 13 },
    lg: { padding: "11px 24px", fontSize: 14 },
  };
  const variants = {
    primary:      { background: C.orange, color: C.white, border: "none" },
    secondary:    { background: C.blue,   color: C.white, border: "none" },
    success:      { background: C.green,  color: C.white, border: "none" },
    danger:       { background: C.red,    color: C.white, border: "none" },
    ghost:        { background: "transparent", color: C.gray600, border: `1px solid ${C.gray300}` },
    ghostOrange:  { background: C.orangeLight, color: C.orange,  border: `1px solid ${C.orangeBorder}` },
  };
  return { ...variants[variant], ...sizes[size], borderRadius: 8, cursor: "pointer", fontWeight: 600, fontFamily: "inherit" };
}

// ── Shared components ─────────────────────────────────────────────────────────
export function Tag({ children, variant = "gray", fontSize }) {
  const vars = {
    green:  { bg: C.greenLight,  color: C.green,  border: C.greenBorder },
    red:    { bg: C.redLight,    color: C.red,     border: C.redBorder },
    orange: { bg: C.orangeLight, color: C.orange,  border: C.orangeBorder },
    blue:   { bg: C.blueLight,   color: C.blue,    border: "#BFDBFE" },
    gray:   { bg: C.gray100,     color: C.gray600, border: C.gray200 },
    amber:  { bg: C.amberLight,  color: C.amber,   border: "#FDE68A" },
  };
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
  const valColor = accent
    ? accent
    : value === null || value === undefined
      ? C.gray400
      : isNeg ? C.red : num > 0 ? C.green : C.gray700;
  return (
    <div style={{ ...S.card, position: "relative", borderTop: `3px solid ${accent}`, minWidth: "max-content" }}>
      <p style={{ fontSize: 11, fontWeight: 700, color: C.gray400, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 8, whiteSpace: "nowrap" }}>
        {icon && <span style={{ marginRight: 5 }}>{icon}</span>}{label}
      </p>
      <p style={{ fontSize: 24, fontWeight: 800, color: valColor, fontFamily: "'DM Mono', monospace", lineHeight: 1.2, whiteSpace: "nowrap" }}>
        {value !== null && value !== undefined ? fmt(value) : sub || "—"}
      </p>
      {sub && value !== null && value !== undefined && (
        <p style={{ fontSize: 11, color: C.gray400, marginTop: 5, whiteSpace: "nowrap" }}>{sub}</p>
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
  const [page,   setPage]   = useState(1);

  const filtered = data.filter(
    (s) => !search || s.sku_id.toLowerCase().includes(search.toLowerCase())
  );

  useEffect(() => { setPage(1); }, [search, data]);

  const visible = filtered.slice((page - 1) * SKU_PAGE_SIZE, page * SKU_PAGE_SIZE);

  const modeLabel =
    mode === "profit" ? "✅ Profitable SKUs" :
    mode === "loss"   ? "⚠️ Loss-making SKUs" :
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
              const globalIdx    = (page - 1) * SKU_PAGE_SIZE + i;
              const rowBg        = globalIdx % 2 === 0 ? C.white : C.gray100;
              const delCount     = s.delivered_count ?? 0;
              const retCount     = s.return_count    ?? 0;
              const rtoCount     = s.rto_count       ?? 0;
              const claimCount   = s.claims_count    ?? 0;
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

                  {/* Deliveries: count + profit */}
                  <td style={{ ...S.td, textAlign: "right" }}>
                    {delCount > 0 ? (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
                        <Tag variant="green">{delCount} orders</Tag>
                        <span style={{ fontFamily: "monospace", fontSize: 12, color: C.green, fontWeight: 600 }}>
                          +{fmt(s.delivered_profit)}
                        </span>
                      </div>
                    ) : <span style={{ color: C.gray300 }}>—</span>}
                  </td>

                  {/* Returns: count + loss */}
                  <td style={{ ...S.td, textAlign: "right" }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
                      <Tag variant={retCount>0 ?  "red": "gray"}>{retCount} returns</Tag>
                      {retCount> 0 && <span style={{ fontFamily: "monospace", fontSize: 12, color: C.red, fontWeight: 600 }}>
                        {fmt(s.return_loss)}
                      </span>}
                    </div>
                  </td>

                  {/* RTO: count + loss */}
                  <td style={{ ...S.td, textAlign: "right" }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
                      <Tag variant={rtoCount > 0 ? "amber" : "gray"}>{rtoCount} RTO</Tag>
                      {rtoCount > 0 && (
                        <span style={{ fontFamily: "monospace", fontSize: 12, color: C.amber, fontWeight: 600 }}>
                          {fmt(s.rto_loss)}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Cancelled: count only (settlement is always 0) */}
                  <td style={{ ...S.td, textAlign: "right" }}>
                    {(s.cancelled_count || 0) > 0
                      ? <Tag variant="gray">{s.cancelled_count} cancelled</Tag>
                      : <span style={{ color: C.gray300 }}>—</span>
                    }
                  </td>

                  {/* Claims: count + amount */}
                  <td style={{ ...S.td, textAlign: "right" }}>
                   
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
                        <Tag variant={claimCount>0 ?"blue":"gray"}>{claimCount} claims</Tag>
                        {claimCount>0 && <span style={{ fontFamily: "monospace", fontSize: 12, color: C.blue, fontWeight: 600 }}>
                          {fmt(s.claims_total)}
                        </span>}
                      </div>
                   
                  </td>

                  {/* Net P&L */}
                  <td style={{ ...S.td, textAlign: "right" }}>
                    <span style={{
                      fontFamily: "monospace", fontWeight: 700, fontSize: 13,
                      background: s.net_profit >= 0 ? C.greenLight : C.redLight,
                      color:      s.net_profit >= 0 ? C.green      : C.red,
                      border:     `1px solid ${s.net_profit >= 0 ? C.greenBorder : C.redBorder}`,
                      padding: "3px 10px", borderRadius: 6, display: "inline-block",
                    }}>
                      {fmt(s.net_profit)}
                    </span>
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr><td colSpan={9} style={{ ...S.td, textAlign: "center", padding: 40, color: C.gray400 }}>
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

// ── Navigation tabs config ────────────────────────────────────────────────────
const TABS = [
  { path: "/",              label: "Overview",       icon: "📊", end: true },
  { path: "/orders",        label: "Orders",         icon: "📦" },
//  { path: "/unsettled",     label: "Unsettled",      icon: "⚠️" },
  { path: "/payments",      label: "Payments",       icon: "💰" },
  { path: "/sku-analysis",  label: "SKU Analysis",   icon: "📊" },
  { path: "/pricing",       label: "SKU Pricing",    icon: "⚙️" },
  { path: "/upload",        label: "Upload",         icon: "⬆️" },
  { path: "/labels",        label: "Labels",         icon: "🏷" },
];

// ── App shell ─────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.gray800, fontFamily: "'Inter','Segoe UI',sans-serif" }}>

      {/* Header / Nav */}
      <div style={{
        background: C.white, borderBottom: `1px solid ${C.border}`,
        padding: "0 28px", height: 58,
        display: "flex", alignItems: "center", gap: 4,
        position: "sticky", top: 0, zIndex: 100,
        boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
      }}>
        {/* Brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: 20 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, background: C.orange,
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
          }}>🏪</div>
          <span style={{ fontSize: 15, fontWeight: 800, color: C.gray800, letterSpacing: "-0.02em" }}>
            Meesho <span style={{ color: C.orange }}>Profit</span>
          </span>
        </div>

        {/* Tab navigation */}
        <div style={{ display: "flex", gap: 2, overflowX: "auto" }}>
          {TABS.map((t) => (
            <NavLink
              key={t.path}
              to={t.path}
              end={t.end}
              style={({ isActive }) => ({
                padding: "6px 14px", borderRadius: 8, border: "none", cursor: "pointer",
                fontSize: 13, fontWeight: isActive ? 700 : 500, transition: "all 0.15s",
                background: isActive ? C.orangeLight : "transparent",
                color: isActive ? C.orange : C.gray500,
                whiteSpace: "nowrap", textDecoration: "none", display: "inline-block",
              })}
            >
              {t.icon} {t.label}
            </NavLink>
          ))}
        </div>
      </div>

      {/* Page content */}
      <div style={{ maxWidth: 1360, margin: "0 auto", padding: "28px 20px" }}>
        <Routes>
          <Route path="/"              element={<OverviewTab />} />
          <Route path="/orders"        element={<OrdersTab />} />
          <Route path="/unsettled"     element={<UnsettledOrdersTab />} />
          <Route path="/payments"      element={<PaymentsTab />} />
          <Route path="/sku-analysis"  element={<SKUAnalysisTab />} />
          <Route path="/pricing"       element={<PricingTab />} />
          <Route path="/upload"        element={<UploadTab />} />
          <Route path="/labels"        element={<LabelsTab />} />
        </Routes>
      </div>
    </div>
  );
}
