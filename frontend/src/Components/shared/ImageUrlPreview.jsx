import React, { useEffect, useState } from "react";
import { C } from "../../App";

/**
 * A live thumbnail preview for a pasted image URL — used anywhere a
 * catalog/product image is set by pasting a link rather than uploading
 * (ParentItemPrice.image_url, MasterItem.image_url). Nothing is fetched or
 * stored beyond the link; a broken URL falls back to a plain placeholder
 * instead of a broken-image icon.
 */
export function ImageUrlPreview({ url, size = 52 }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [url]);
  const trimmed = (url || "").trim();

  return (
    <div style={{
      width: size, height: size, borderRadius: 8, flexShrink: 0, overflow: "hidden",
      border: `1px solid ${C.gray200}`, background: C.white,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      {trimmed && !broken ? (
        <img src={trimmed} alt="Preview" onError={() => setBroken(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <span style={{ fontSize: size * 0.35, color: C.gray300 }} title={trimmed ? "Couldn't load this URL" : "No URL yet"}>
          📷
        </span>
      )}
    </div>
  );
}

/** Small round thumbnail for a table/list row — a badge when there's no URL
 * or it failed to load, instead of taking up a full preview box. */
export function ImageUrlThumb({ url, size = 28 }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [url]);
  const trimmed = (url || "").trim();

  if (trimmed && !broken) {
    return (
      <img src={trimmed} alt="" onError={() => setBroken(true)}
        style={{ width: size, height: size, borderRadius: size * 0.22, objectFit: "cover", border: `1px solid ${C.gray200}`, flexShrink: 0 }} />
    );
  }
  return (
    <span
      title={trimmed ? "Image URL didn't load" : "No photo added yet"}
      style={{
        width: size, height: size, borderRadius: size * 0.22, flexShrink: 0,
        background: C.gray100, color: C.gray400, border: `1px solid ${C.gray200}`,
        display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.5,
      }}
    >
      📷
    </span>
  );
}
