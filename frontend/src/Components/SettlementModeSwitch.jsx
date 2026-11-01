import React from "react";
import { C } from "../App";
import { useSettlementMode } from "../contexts/SettlementModeContext";

/**
 * The global Settled-only switch, next to the business switcher. Off
 * (default): every payment counts — paid, and outstanding (expected from
 * Meesho's outstanding file, not paid yet): the overall profit. On: only
 * payments Meesho has paid (with a bank transfer): the settled profit. Flipping it is enough on its own — see
 * SettlementModeContext for why no tab needs to read this directly; every
 * API call already carries the X-Settlement-Mode header, and the backend's
 * one shared filter (_apply_settlement_filter) is what every money-touching
 * endpoint runs through.
 */
export default function SettlementModeSwitch() {
  const { isSettled, toggle } = useSettlementMode();

  return (
    <button
      onClick={toggle}
      title="On: settled profit — only payments Meesho has paid (with a bank transfer). Off (default): overall profit — paid payments plus outstanding ones (Meesho's outstanding file, not paid yet)."
      style={{
        display: "flex", alignItems: "center", gap: 7,
        background: isSettled ? C.greenLight : C.white,
        color: isSettled ? C.green : C.gray500,
        border: `1.5px solid ${isSettled ? C.greenBorder : C.gray200}`,
        borderRadius: 20, padding: "6px 12px", fontSize: 12, fontWeight: 700,
        cursor: "pointer", fontFamily: "inherit",
      }}
    >
      <span
        style={{
          width: 28, height: 16, borderRadius: 99, position: "relative", flexShrink: 0,
          background: isSettled ? C.green : C.gray300, transition: "background 0.15s",
        }}
      >
        <span
          style={{
            position: "absolute", top: 2, left: isSettled ? 14 : 2, width: 12, height: 12,
            borderRadius: "50%", background: "#fff", transition: "left 0.15s",
            boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
          }}
        />
      </span>
      <span>{isSettled ? "✅ Settled only" : "Settled only"}</span>
    </button>
  );
}
