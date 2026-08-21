import React, { useMemo } from "react";
import { ResponsiveLine } from "@nivo/line";
import { C } from "../../shared";
import { nivoTheme, ANIMATE, colorForKey } from "./nivoTheme";

/**
 * Multi-series trend line. Callers keep passing the flat-row shape every
 * other chart uses (`dataset` + `series: [{dataKey, label, color}]`) —
 * reshaping that into Nivo's per-series `{id, data:[{x,y}]}` format is
 * exactly what this wrapper is for, so no caller needs to know Nivo's shape.
 */
export function AppLineChart({ dataset, indexKey, series, height = 260, valueFormatter, margin, indexFormatter, maxTicks }) {
  const lines = useMemo(() => series.map((s) => ({
    id: s.label || s.dataKey,
    color: s.color || colorForKey(s.dataKey),
    data: dataset.map((row) => ({ x: row[indexKey], y: row[s.dataKey] })),
  })), [dataset, indexKey, series]);

  const colorMap = useMemo(() => Object.fromEntries(lines.map((l) => [l.id, l.color])), [lines]);
  const manyPoints = dataset.length > 10;
  const tickValues = useMemo(() => {
    if (!maxTicks || dataset.length <= maxTicks) return undefined;
    const every = Math.max(1, Math.ceil(dataset.length / maxTicks));
    return dataset.filter((_, i) => i % every === 0).map((row) => row[indexKey]);
  }, [dataset, indexKey, maxTicks]);

  return (
    <div style={{ height, width: "100%" }}>
      <ResponsiveLine
        data={lines}
        margin={margin || { top: 16, right: 20, bottom: manyPoints ? 56 : 40, left: 54 }}
        xScale={{ type: "point" }}
        yScale={{ type: "linear", min: "auto", max: "auto", nice: true }}
        colors={(d) => colorMap[d.id] || C.orange}
        theme={nivoTheme}
        curve="monotoneX"
        lineWidth={2.5}
        pointSize={6}
        pointColor={{ theme: "background" }}
        pointBorderWidth={2}
        pointBorderColor={{ from: "serieColor" }}
        enableArea
        areaOpacity={0.08}
        enableGridX={false}
        useMesh
        {...ANIMATE}
        axisBottom={{ tickSize: 0, tickPadding: 8, tickRotation: manyPoints ? -32 : 0, format: indexFormatter, tickValues }}
        axisLeft={{ tickSize: 0, tickPadding: 8, format: valueFormatter }}
        tooltip={({ point }) => (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div style={{ fontWeight: 700, color: C.gray800 }}>{indexFormatter ? indexFormatter(point.data.x) : String(point.data.x)}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: point.seriesColor, display: "inline-block" }} />
              <span style={{ color: C.gray500 }}>{point.seriesId}:</span>
              <b>{valueFormatter ? valueFormatter(point.data.y) : point.data.y}</b>
            </div>
          </div>
        )}
        legends={lines.length > 1 ? [{
          anchor: "top", direction: "row", translateY: -12, itemsSpacing: 14,
          itemWidth: 90, itemHeight: 16, symbolShape: "circle", symbolSize: 9,
          data: lines.map((l) => ({ id: l.id, label: l.id, color: l.color })),
        }] : []}
      />
    </div>
  );
}
