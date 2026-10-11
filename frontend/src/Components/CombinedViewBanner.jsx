import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { C } from "../App";
import { useCombinedView } from "../contexts/CombinedViewContext";

// Pages that merge their own data when Combined is on (see lib/combinedMerge.js)
// and so show their own "combined" indicator instead of this generic banner.
const MERGE_AWARE_PATHS = ["/combined-dashboard", "/", "/sku-analysis"];

/**
 * Shown on every screen that *isn't* merge-aware yet while the global
 * Combined switch is on with 2+ businesses ticked — so turning it on from
 * anywhere is never silently invisible on the many tabs not wired up yet.
 * Deliberately does NOT claim this screen's own numbers are merged: a blind
 * generic merge of every endpoint's JSON would be actively wrong in places
 * (e.g. two businesses' same-named SKU) unless done carefully per endpoint —
 * see lib/combinedMerge.js for the tabs that have been.
 */
export default function CombinedViewBanner() {
  const { active, selected } = useCombinedView();
  const location = useLocation();
  const navigate = useNavigate();

  if (!active || MERGE_AWARE_PATHS.includes(location.pathname)) return null;

  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        background: C.orangeLight, border: `1px solid ${C.orangeBorder}`,
        borderRadius: 10, padding: "8px 14px", fontSize: 12.5, color: C.gray700,
        marginBottom: 18,
      }}
    >
      <span>🧩</span>
      <span>
        Combined view is on ({selected.size} businesses) — this screen still shows only the active business.
        Merged Profit, Orders, Payments and SKUs live on Combined Dashboard.
      </span>
      <button
        onClick={() => navigate("/combined-dashboard")}
        style={{
          marginLeft: "auto", background: "none", border: "none", color: C.orange,
          fontWeight: 700, cursor: "pointer", fontSize: 12.5, fontFamily: "inherit", whiteSpace: "nowrap",
        }}
      >
        Open it →
      </button>
    </div>
  );
}
