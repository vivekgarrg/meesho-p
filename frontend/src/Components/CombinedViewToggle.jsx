import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { C } from "../App";
import { useBusiness } from "../contexts/BusinessContext";
import { useCombinedView } from "../contexts/CombinedViewContext";
import { CombinedBusinessPicker } from "./CombinedBusinessPicker";

/**
 * The global "Combined" switch, next to the business switcher — the one
 * place to turn merged-business numbers on, pick which businesses, and jump
 * to where they're actually shown (Combined Dashboard). See
 * CombinedViewContext for why this is a single shared setting rather than a
 * per-tab one, and CombinedDashboardTab's file-level comment for why most
 * other screens don't (yet) re-render themselves in combined mode — this
 * control still lights up everywhere so turning it on is discoverable from
 * any screen, not just that one.
 */
export default function CombinedViewToggle() {
  const { businesses } = useBusiness();
  const { enabled, setEnabled, selected, toggleBusiness, setSelected, active } = useCombinedView();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  if (businesses.length < 2) return null; // nothing to combine with just one business

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 7,
          background: active ? C.orange : C.white,
          color: active ? "#fff" : C.gray500,
          border: `1.5px solid ${active ? C.orange : C.gray200}`,
          borderRadius: 20, padding: "6px 12px", fontSize: 12, fontWeight: 700,
          cursor: "pointer", fontFamily: "inherit",
        }}
        title="Merge 2+ businesses' Profit, Orders, Payments and SKUs on Combined Dashboard"
      >
        <span>🧩</span>
        Combined
        {active && <span style={{ fontWeight: 800 }}>· {selected.size}</span>}
      </button>

      {open && (
        <div
          style={{
            position: "absolute", top: "calc(100% + 8px)", left: 0, zIndex: 50,
            width: 320, background: C.white, border: `1px solid ${C.border}`,
            borderRadius: 14, boxShadow: "0 12px 32px rgba(0,0,0,0.14)", padding: 14,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <p style={{ fontSize: 13, fontWeight: 800, color: C.gray800, margin: 0 }}>Combined view</p>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <span style={{ fontSize: 11.5, color: C.gray500, fontWeight: 600 }}>{enabled ? "On" : "Off"}</span>
              <span
                onClick={() => setEnabled(!enabled)}
                role="switch"
                aria-checked={enabled}
                style={{
                  width: 34, height: 19, borderRadius: 99, position: "relative",
                  background: enabled ? C.orange : C.gray200, transition: "background 0.15s", flexShrink: 0,
                }}
              >
                <span
                  style={{
                    position: "absolute", top: 2, left: enabled ? 17 : 2, width: 15, height: 15,
                    borderRadius: "50%", background: "#fff", transition: "left 0.15s",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                  }}
                />
              </span>
            </label>
          </div>

          <p style={{ fontSize: 11.5, color: C.gray400, marginBottom: 10, lineHeight: 1.5 }}>
            Tick 2 or more businesses, then open Combined Dashboard to see their Profit, Orders, Payments and
            SKUs rolled up together.
          </p>

          <CombinedBusinessPicker
            businesses={businesses}
            selected={selected}
            onToggle={toggleBusiness}
            onSelectAll={() => setSelected(new Set(businesses.map((b) => b.id)))}
            onSelectNone={() => setSelected(new Set())}
          />

          <button
            onClick={() => { setOpen(false); navigate("/combined-dashboard"); }}
            disabled={!active}
            style={{
              marginTop: 10, width: "100%", padding: "8px 0", borderRadius: 10, border: "none",
              background: active ? C.orange : C.gray100, color: active ? "#fff" : C.gray400,
              fontWeight: 700, fontSize: 12.5, cursor: active ? "pointer" : "default", fontFamily: "inherit",
            }}
          >
            Open Combined Dashboard →
          </button>
        </div>
      )}
    </div>
  );
}
