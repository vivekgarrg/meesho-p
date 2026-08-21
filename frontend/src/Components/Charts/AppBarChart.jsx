import React, { useMemo } from "react";
import { ResponsiveBar } from "@nivo/bar";
import { C } from "../../shared";
import { nivoTheme, ANIMATE, colorForKey } from "./nivoTheme";

/**
 * The one bar chart every tab in the app renders through — vertical or
 * horizontal, grouped or stacked, and a `diverging` sign-colored mode
 * (green above zero, red below) for P&L-style charts. Takes the same
 * `dataset` (array of row objects) + `series` (`[{dataKey, label, color}]`)
 * shape every caller already had, so migrating a chart is a prop reshape,
 * not a rewrite.
 *
 * `onBarClick(indexValue, datum)` gets the clicked category's index value
 * first (e.g. a sku_id) since that's what every existing click-to-drill-down
 * caller actually needs — the full Nivo datum is there too for anything else.
 */
export function AppBarChart({
  dataset, indexKey, series, layout = "vertical", stacked = false,
  diverging = false, colorByIndex, colorful = false, onBarClick, height = 260, valueFormatter, margin,
  showLegend, maxTicks, indexFormatter,
}) {
  const keys = useMemo(() => series.map((s) => s.dataKey), [series]);
  // Thin the axis down to at most maxTicks labels (every Nth) instead of
  // rendering one per category — a day-by-day chart with 60+ points would
  // otherwise draw an unreadable wall of rotated text.
  const tickValues = useMemo(() => {
    if (!maxTicks || dataset.length <= maxTicks) return undefined;
    const every = Math.max(1, Math.ceil(dataset.length / maxTicks));
    return dataset.filter((_, i) => i % every === 0).map((row) => row[indexKey]);
  }, [dataset, indexKey, maxTicks]);
  const colorByKey = useMemo(
    () => Object.fromEntries(series.map((s) => [s.dataKey, s.color || colorForKey(s.dataKey)])),
    [series]);

  // Four coloring modes, in order of precedence: diverging (sign-based),
  // colorByIndex (one color per category — e.g. a status→color map, for a
  // single series whose bars each need their own color), colorful (a bar
  // per category, no semantic color to preserve — e.g. ranking a set of
  // SKUs — hashed off the category label so the same SKU keeps its color
  // across re-sorts/refetches instead of reshuffling), else one solid
  // color per series.
  const colors = diverging
    ? (bar) => (Number(bar.value) < 0 ? C.red : C.green)
    : colorByIndex
    ? (bar) => (typeof colorByIndex === "function" ? colorByIndex(bar.indexValue, bar.data) : colorByIndex[bar.indexValue]) || C.gray300
    : colorful
    ? (bar) => colorForKey(bar.indexValue)
    : (bar) => colorByKey[bar.id] || C.orange;

  const manyCategories = dataset.length > 8;
  const defaultMargin = layout === "horizontal"
    ? { top: 10, right: 24, bottom: 32, left: 104 }
    : { top: 16, right: 16, bottom: manyCategories ? 56 : 34, left: 54 };

  return (
    <div style={{ height, width: "100%" }}>
      <ResponsiveBar
        data={dataset}
        keys={keys}
        indexBy={indexKey}
        layout={layout}
        groupMode={stacked ? "stacked" : "grouped"}
        margin={margin || defaultMargin}
        padding={0.28}
        innerPadding={stacked ? 0 : 3}
        borderRadius={3}
        colors={colors}
        theme={nivoTheme}
        enableLabel={false}
        enableGridY={layout === "vertical"}
        enableGridX={layout === "horizontal"}
        {...ANIMATE}
        valueFormat={valueFormatter}
        axisBottom={layout === "vertical" ? {
          tickSize: 0, tickPadding: 8,
          tickRotation: manyCategories ? -32 : 0,
          tickValues, format: indexFormatter,
        } : { tickSize: 0, tickPadding: 8, format: valueFormatter }}
        axisLeft={layout === "vertical"
          ? { tickSize: 0, tickPadding: 8, format: valueFormatter }
          : { tickSize: 0, tickPadding: 8, format: indexFormatter }}
        onClick={onBarClick ? (bar) => onBarClick(bar.indexValue, bar) : undefined}
        isInteractive
        tooltip={({ id, value, indexValue, color }) => (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div style={{ fontWeight: 700, color: C.gray800 }}>{indexFormatter ? indexFormatter(indexValue) : indexValue}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block" }} />
              <span style={{ color: C.gray500 }}>{series.find((s) => s.dataKey === id)?.label || id}:</span>
              <b>{valueFormatter ? valueFormatter(value) : value}</b>
            </div>
          </div>
        )}
        legends={showLegend !== false && series.length > 1 && !diverging ? [{
          dataFrom: "keys", data: series.map((s) => ({ id: s.dataKey, label: s.label, color: colorByKey[s.dataKey] })),
          anchor: "top", direction: "row", translateY: -12, itemsSpacing: 14,
          itemWidth: 84, itemHeight: 16, symbolShape: "circle", symbolSize: 9,
        }] : []}
      />
    </div>
  );
}
