import React from "react";
import { C } from "../App";
import { useBusiness } from "../contexts/BusinessContext";

export default function BusinessSwitcher() {
  const { businesses, activeBusinessId, setActiveBusinessId, activeBusiness } = useBusiness();

  if (businesses.length === 0) return null;

  const initial = (activeBusiness?.name || "?").charAt(0).toUpperCase();

  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 8,
        background: C.orangeLight, border: `1px solid ${C.orangeBorder}`,
        borderRadius: 20, padding: "5px 10px 5px 12px",
      }}
    >
      <div
        style={{
          width: 18, height: 18, borderRadius: 6,
          background: "linear-gradient(135deg, #7C3AED 0%, #4F46E5 100%)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 10, fontWeight: 900, color: "#fff", flexShrink: 0,
        }}
      >
        {initial}
      </div>
      {businesses.length > 1 ? (
        <select
          value={activeBusinessId ?? ""}
          onChange={(e) => setActiveBusinessId(Number(e.target.value))}
          style={{
            fontSize: 12, fontWeight: 700, color: C.orange,
            background: "transparent", border: "none", outline: "none", cursor: "pointer",
          }}
        >
          {businesses.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      ) : (
        <span style={{ fontSize: 12, fontWeight: 700, color: C.orange }}>
          {activeBusiness?.name ?? "—"}
        </span>
      )}
    </div>
  );
}
