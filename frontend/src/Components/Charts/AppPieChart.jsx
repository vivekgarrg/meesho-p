import React, { useMemo } from "react";
import { ResponsivePie } from "@nivo/pie";
import { C } from "../../shared";
import { nivoTheme, ANIMATE, colorForKey } from "./nivoTheme";

/**
 * Donut/pie — every current instance in the app is a donut (innerRadius > 0)
 * with its own legend built alongside it in the caller's own markup, so the
 * built-in legend defaults to off; pass `showLegend` where one is wanted.
 */
export function AppPieChart({ data, height = 200, innerRadius = 0.6, showLegend = false, valueFormatter }) {
  const rows = useMemo(() => data.map((d) => {
    const label = d.label ?? d.name ?? d.id;
    // Hashed off the label, not the array index (often just 0/1/2/... anyway)
    // or `id` — a slice's color shouldn't change just because a zero-value
    // slice elsewhere dropped out and shifted everyone's position.
    return { id: d.id ?? label, label, value: d.value, color: d.color || colorForKey(label) };
  }), [data]);
  const colorMap = useMemo(() => Object.fromEntries(rows.map((r) => [r.id, r.color])), [rows]);

  return (
    <div style={{ height, width: "100%" }}>
      <ResponsivePie
        data={rows}
        margin={{ top: 10, right: showLegend ? 110 : 10, bottom: 10, left: 10 }}
        innerRadius={innerRadius}
        padAngle={1.2}
        cornerRadius={3}
        activeOuterRadiusOffset={6}
        colors={(d) => colorMap[d.id] || C.orange}
        theme={nivoTheme}
        borderWidth={0}
        enableArcLinkLabels={false}
        enableArcLabels={false}
        {...ANIMATE}
        tooltip={({ datum }) => (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: datum.color, display: "inline-block" }} />
            <span style={{ color: C.gray500 }}>{datum.label}:</span>
            <b>{valueFormatter ? valueFormatter(datum.value) : datum.value}</b>
          </div>
        )}
        legends={showLegend ? [{
          anchor: "right", direction: "column", translateX: 100, itemWidth: 90, itemHeight: 20,
          symbolShape: "circle", symbolSize: 9, itemTextColor: C.gray600,
          data: rows.map((r) => ({ id: r.id, label: r.label, color: r.color })),
        }] : []}
      />
    </div>
  );
}
