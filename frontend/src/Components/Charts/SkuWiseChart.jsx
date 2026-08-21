import React from "react";
import { C } from "../../App";
import { ResponsiveBar } from "@nivo/bar";
import { nivoTheme, ANIMATE } from "./nivoTheme";

// Same three color bands as before: below 50 orders, 50–85, above 85.
const THRESHOLDS = [50, 85];
const BAND_COLORS = [C.red, C.blue, C.amber];
const BAND_LABELS = ["3rd Highest Orders", "Medium Highest Orders", "Highest Orders"];

function bandFor(value) {
  if (value < THRESHOLDS[0]) return 0;
  if (value < THRESHOLDS[1]) return 1;
  return 2;
}

/** A full-width shaded track behind every bar, so a short bar still shows
    the row it belongs to — the same "progress bar in a track" effect the
    original custom slot gave this chart. */
function TrackLayer({ bars, innerWidth }) {
  return (
    <g>
      {bars.map((bar) => (
        <rect key={bar.key} x={0} y={bar.y} width={innerWidth} height={bar.height}
          fill={C.gray800} opacity={0.06} />
      ))}
    </g>
  );
}

/** The value label sits at the bar's own base (its left edge, +8px), not
    centered inside it — matches the original's BarLabelAtBase. */
function BaseLabelLayer({ bars }) {
  return (
    <g>
      {bars.map((bar) => (
        <text key={bar.key} x={bar.x + 8} y={bar.y + bar.height / 2}
          dominantBaseline="central" fontSize={11} fontWeight={700} fill={C.white}>
          {bar.data.value}
        </text>
      ))}
    </g>
  );
}

export default function SkuWiseChart({ topSkus }) {
  const dataset = topSkus.map((s) => ({ sku: s.sku || "—", count: s.count, qty: s.total_qty ?? s.count }));
  const height = Math.max(180, topSkus.length * 30 + 40);

  return (
    <div>
      <div style={{ height, width: "100%" }}>
        <ResponsiveBar
          data={dataset}
          keys={["count"]}
          indexBy="sku"
          layout="horizontal"
          margin={{ top: 8, right: 20, bottom: 28, left: 90 }}
          padding={0.3}
          borderRadius={5}
          colors={(bar) => BAND_COLORS[bandFor(bar.value)]}
          theme={nivoTheme}
          enableGridY={false}
          enableGridX
          {...ANIMATE}
          axisBottom={{ tickSize: 0, tickPadding: 8 }}
          axisLeft={{ tickSize: 0, tickPadding: 8 }}
          layers={["grid", "axes", TrackLayer, "bars", BaseLabelLayer, "markers", "legends", "annotations"]}
          tooltip={({ indexValue, value }) => (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%",
                background: BAND_COLORS[bandFor(value)], display: "inline-block" }} />
              <span style={{ color: C.gray500 }}>{indexValue}:</span>
              <b>{value} orders</b>
            </div>
          )}
        />
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center", marginTop: 4 }}>
        {BAND_LABELS.map((label, i) => (
          <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: C.gray600 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: BAND_COLORS[i], display: "inline-block" }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
