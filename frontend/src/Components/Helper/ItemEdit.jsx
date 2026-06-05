import React, { useState } from 'react';
import { C, S, btn, fmt } from '../../App';

export default function ItemEdit({ item, handleEdit, rowBg = "#fff" }) {
  const [expanded, setExpanded] = useState(false);
  const MAX = 3;
  const skusToShow = expanded ? item.sku_ids : item.sku_ids.slice(0, MAX);
  const hasMore    = !expanded && item.sku_ids.length > MAX;

  return (
    <tr
      style={{ background: rowBg }}
      onMouseEnter={e => e.currentTarget.style.background = "#F0F7FF"}
      onMouseLeave={e => e.currentTarget.style.background = rowBg}
    >
      {/* Item ID */}
      <td style={S.td}>
        <span style={{ fontFamily: "monospace", fontSize: 12, color: C.orange, fontWeight: 700, background: C.orangeLight, padding: "3px 9px", borderRadius: 6, border: `1px solid ${C.orangeBorder}` }}>
          📦 {item.item_id}
        </span>
      </td>

      {/* Price */}
      <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 600, color: C.gray700 }}>
        {fmt(item.item_price)}
      </td>

      {/* Tax */}
      <td style={{ ...S.td, textAlign: "center" }}>
        <span style={{ background: C.gray100, color: C.gray600, padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 600 }}>
          {item.tax_percent ?? 0}%
        </span>
      </td>

      {/* Packaging */}
      <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", color: C.gray500, fontSize: 12 }}>
        {fmt(item.packaging_cost)}
      </td>

      {/* Final Price */}
      <td style={{ ...S.td, textAlign: "right" }}>
        <span style={{ fontFamily: "monospace", fontWeight: 800, color: C.orange, background: C.orangeLight, padding: "3px 10px", borderRadius: 6, border: `1px solid ${C.orangeBorder}`, fontSize: 13 }}>
          {fmt(item.final_price)}
        </span>
      </td>

      {/* Linked SKUs */}
      <td style={{ ...S.td, maxWidth: 280 }}>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
          {skusToShow.map(sku => (
            <span key={sku} style={{ fontFamily: "monospace", fontSize: 10, color: C.blue, background: C.blueLight, padding: "2px 7px", borderRadius: 4, border: "1px solid #BFDBFE", fontWeight: 600 }}>
              ↳ {sku}
            </span>
          ))}
          {hasMore && (
            <button
              onClick={() => setExpanded(true)}
              style={{ fontSize: 10, color: C.gray500, background: C.gray100, border: `1px solid ${C.gray200}`, padding: "2px 7px", borderRadius: 4, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}
            >
              +{item.sku_ids.length - MAX} more
            </button>
          )}
          {item.sku_ids.length === 0 && (
            <span style={{ fontSize: 11, color: C.gray300, fontStyle: "italic" }}>no SKUs linked</span>
          )}
        </div>
      </td>

      {/* Edit button */}
      <td style={{ ...S.td, whiteSpace: "nowrap" }}>
        <button onClick={() => handleEdit(item)} style={{ ...btn("ghost", "sm"), fontSize: 11 }}>
          ✏️ Edit
        </button>
      </td>
    </tr>
  );
}
