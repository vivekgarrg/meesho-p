import React, { useState } from "react";
import { C, S, btn, useIsMobile } from "../../App";
import VideocamIcon from "@mui/icons-material/Videocam";
import SearchIcon from "@mui/icons-material/Search";
import { field } from "./TeamTasksShared";
import { ClaimVideoWorkspace } from "./ClaimVideoTool";

/**
 * Standalone entry point for the claim video/screenshot prep tool — the same
 * `ClaimVideoWorkspace` used inside a specific claim card in Team Tasks
 * (`ReturnClaimsPanel.jsx`), just without a claim already on screen to supply
 * the sub-order number. So this page asks for it directly instead, then hands
 * it straight to the same workspace — useful for prepping a claim's files
 * ahead of actually claiming/submitting it in Team Tasks, or for anyone who'd
 * rather not open a specific card first.
 */
export function ClaimVideoToolTab() {
  const isMobile = useIsMobile();
  const [input, setInput] = useState("");
  const [suborderNo, setSuborderNo] = useState("");

  const look = () => setSuborderNo(input.trim());

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <VideocamIcon style={{ color: C.orange, fontSize: 21 }} />
          <h1 style={{ fontSize: isMobile ? 17 : 19, fontWeight: 800, color: C.gray800 }}>Claim Video Tool</h1>
        </div>
        <p style={{ fontSize: 12, color: C.gray400, marginTop: 3 }}>
          Compress an unboxing video to Meesho's 22MB claim limit and capture the AWB bill,
          packet id and product screenshots off the same video — all in your browser.
        </p>
      </div>

      <div style={{ ...S.card, padding: isMobile ? 15 : 22 }}>
        <label style={S.label}>Sub-order number</label>
        <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
          <div style={{ position: "relative", flex: "1 1 240px", minWidth: 0 }}>
            <SearchIcon style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)",
              fontSize: 17, color: C.gray400, pointerEvents: "none" }} />
            <input value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && input.trim()) look(); }}
              placeholder="e.g. 2024ABCD1234567"
              style={field(isMobile, { paddingLeft: 34, width: "100%", boxSizing: "border-box", fontFamily: "monospace" })} />
          </div>
          <button onClick={look} disabled={!input.trim()} style={btn("primary", "sm")}>Look up</button>
        </div>
        <div style={{ fontSize: 11, color: C.gray400, marginTop: 8 }}>
          Optional — pulls the AWB number, packet id and product from your return-delivery records if
          there's a match. You can still compress a video and take screenshots without one.
        </div>
      </div>

      <div style={{ ...S.card, padding: isMobile ? 15 : 22 }}>
        <ClaimVideoWorkspace suborderNo={suborderNo} />
      </div>
    </div>
  );
}
