import { C, CHART_COLORS } from "../../shared";

/*
 * One theme object shared by every chart wrapper in this folder, so a chart
 * on the Overview tab and a chart on Inventory look like the same product
 * instead of each carrying its own ad-hoc styling.
 */
const FONT = "'Inter', 'Segoe UI', system-ui, sans-serif";

export const nivoTheme = {
  fontFamily: FONT,
  fontSize: 11,
  textColor: C.gray600,
  axis: {
    domain: { line: { stroke: C.gray200, strokeWidth: 1 } },
    ticks: { line: { stroke: C.gray200, strokeWidth: 1 }, text: { fill: C.gray500, fontSize: 11 } },
    legend: { text: { fill: C.gray500, fontSize: 11, fontWeight: 700 } },
  },
  grid: { line: { stroke: C.gray100, strokeWidth: 1 } },
  legends: { text: { fill: C.gray600, fontSize: 11.5, fontWeight: 600 } },
  tooltip: {
    container: {
      background: C.white, color: C.gray800, fontSize: 12.5,
      borderRadius: 10, boxShadow: "0 6px 20px rgba(19,17,28,0.16)",
      border: `1px solid ${C.border}`, padding: "8px 12px",
    },
  },
  labels: { text: { fill: C.gray700, fontSize: 11, fontWeight: 700 } },
};

export { CHART_COLORS };
// "stiff" settles quickly with almost no overshoot — bars/lines move straight
// to their new value instead of springing past it and wobbling back, which
// reads as jittery on a chart that redraws often (a filter change, a period
// switch). "gentle" (react-spring's default-ish preset) looks lively on a
// single one-off animation but wobbly on a dashboard that redraws a lot.
export const ANIMATE = { animate: true, motionConfig: "stiff" };

/**
 * A color for a category that doesn't carry semantic meaning (a SKU, a
 * date, an arbitrary label) — same string always maps to the same color,
 * regardless of that category's position in the array. Assigning by array
 * index instead (`CHART_COLORS[i % n]`) looks fine once, but reshuffles
 * every color the moment the data re-sorts or a zero-value row drops out
 * in one render and comes back in the next — the same category visibly
 * changes color for no reason a viewer can see. Hashing the label sidesteps
 * that entirely.
 */
export function colorForKey(key) {
  let hash = 0;
  const str = String(key ?? "");
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return CHART_COLORS[hash % CHART_COLORS.length];
}
