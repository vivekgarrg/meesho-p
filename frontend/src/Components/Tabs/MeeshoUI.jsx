import React, { useState } from "react";
import { C, S } from "../../App";

/*
 * The Meesho page's building blocks — one card, one KPI tile, one bar list —
 * so every tab reads as the same dashboard: 8px spacing grid, a single card
 * style, numbers in tabular monospace, labels in muted ink, colour only where
 * it says something (status), never decoration.
 */

export const TONE = {
  neutral: { fg: C.gray900, accent: C.gray300, soft: C.gray50 },
  brand: { fg: C.orange, accent: C.orange, soft: C.orangeLight },
  good: { fg: "#15803D", accent: C.green, soft: C.greenLight },
  info: { fg: "#1D4ED8", accent: "#2563EB", soft: "#EFF6FF" },
  warn: { fg: "#B45309", accent: "#F59E0B", soft: C.amberLight },
  bad: { fg: C.red, accent: C.red, soft: C.redLight },
};

export const inr = (v, digits = 0) => (v === null || v === undefined ? "—"
  : `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`);
// ₹1.4L / ₹62.7K — for the big numbers, where the exact rupee doesn't matter.
export const inrShort = (v) => {
  if (v === null || v === undefined) return "—";
  const n = Math.abs(v);
  const s = n >= 1e7 ? `${(n / 1e7).toFixed(2)}Cr` : n >= 1e5 ? `${(n / 1e5).toFixed(2)}L` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(0);
  return `${v < 0 ? "−" : ""}₹${s}`;
};
export const num = (v) => (v === null || v === undefined ? "—" : Number(v).toLocaleString("en-IN"));
export const ago = (iso) => {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso)) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
};
export const at = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { weekday: "short", hour: "numeric", minute: "2-digit" }) : "—");
export const dayLabel = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }) : "—");

/** A card with a header (title, optional subtitle and action) and a body. */
export function Panel({ title, subtitle, action, children, pad = true, style }) {
  return (
    <section style={{ ...S.card, padding: 0, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden", ...style }}>
      {(title || action) && (
        <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, padding: "14px 16px 10px" }}>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: C.gray900, letterSpacing: "-0.005em" }}>{title}</h3>
            {subtitle && <div style={{ fontSize: 12, color: C.gray500, marginTop: 2 }}>{subtitle}</div>}
          </div>
          {action}
        </header>
      )}
      <div style={{ padding: pad ? "4px 16px 16px" : 0, flex: 1, minWidth: 0 }}>{children}</div>
    </section>
  );
}

/** A KPI tile: the number, what it is, what to do about it. Clickable when it leads somewhere. */
export function Kpi({ label, value, sub, tone = "neutral", onClick, icon }) {
  const t = TONE[tone] || TONE.neutral;
  const [hover, setHover] = useState(false);
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        ...S.card, padding: "14px 16px", textAlign: "left", fontFamily: "inherit", minWidth: 0,
        display: "flex", flexDirection: "column", gap: 6, cursor: onClick ? "pointer" : "default",
        border: `1px solid ${hover && onClick ? t.accent : C.gray200}`, boxShadow: hover && onClick ? "0 4px 14px rgba(15,23,42,.08)" : undefined,
        transition: "border-color .15s, box-shadow .15s", position: "relative", overflow: "hidden",
      }}>
      <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: t.accent }} />
      <span style={{ fontSize: 12, fontWeight: 700, color: C.gray500, display: "flex", gap: 6, alignItems: "center" }}>
        {icon && <span aria-hidden>{icon}</span>}{label}
      </span>
      <span style={{ fontSize: 28, fontWeight: 900, lineHeight: 1, color: tone === "neutral" ? C.gray900 : t.fg, fontVariantNumeric: "tabular-nums" }}>{value}</span>
      {sub && <span style={{ fontSize: 12, color: C.gray500, lineHeight: 1.35 }}>{sub}</span>}
      {onClick && <span aria-hidden style={{ position: "absolute", right: 12, top: 12, color: hover ? t.accent : C.gray300, fontSize: 14 }}>→</span>}
    </Tag>
  );
}

/** A small labelled number, for inside panels. */
export function Stat({ label, value, tone, hint }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }} title={hint}>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: C.gray500, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</span>
      <span style={{ fontSize: 20, fontWeight: 900, color: tone ? TONE[tone].fg : C.gray900, fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}

/**
 * Horizontal bars, one series: label · bar · value. Thin marks with rounded
 * ends, the value in text ink (never the bar colour), a hover tooltip per bar.
 */
export function BarList({ rows, color = "#2563EB", format = num, onRow }) {
  const max = Math.max(1, ...rows.map((r) => r.value || 0));
  const [hover, setHover] = useState(null);
  return (
    <div role="list" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {rows.map((r, i) => (
        <div key={r.key || r.label} role="listitem" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
          onClick={onRow ? () => onRow(r) : undefined} title={r.tooltip || `${r.label}: ${format(r.value)}`}
          style={{ display: "grid", gridTemplateColumns: "minmax(90px, 32%) 1fr auto", gap: 10, alignItems: "center",
            cursor: onRow ? "pointer" : "default", padding: "2px 0", background: hover === i ? C.gray50 : "transparent", borderRadius: 6 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: C.gray700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
          <span style={{ height: 10, background: C.gray100, borderRadius: 4, overflow: "hidden" }}>
            <span style={{ display: "block", height: "100%", width: `${Math.max(r.value ? 3 : 0, (100 * (r.value || 0)) / max)}%`,
              background: r.color || color, borderRadius: 4, opacity: hover === null || hover === i ? 1 : 0.55, transition: "opacity .15s" }} />
          </span>
          <span style={{ fontSize: 12.5, fontWeight: 800, color: C.gray900, fontVariantNumeric: "tabular-nums", minWidth: 56, textAlign: "right" }}>{format(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

/** A status dot with its word — state is never colour alone. */
export function StatusDot({ tone = "neutral", children }) {
  const t = TONE[tone] || TONE.neutral;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: tone === "neutral" ? C.gray600 : t.fg }}>
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, background: t.accent, flexShrink: 0 }} />{children}
    </span>
  );
}
