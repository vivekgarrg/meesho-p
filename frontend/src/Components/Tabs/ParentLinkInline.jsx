import React, { useEffect, useState } from "react";
import { Box, Button, TextField, Typography } from "@mui/material";
import { C, API } from "../../App";

/*
 * Shared by LabelsTab and BulkLabelsTab: the inline "link this SKU to a
 * parent" control that lives right in a labels table, so linking doesn't
 * mean leaving the tab to go find the SKU in Pricing.
 */

/**
 * The list of parents, fetched once and shared by every row's picker across
 * both labels tabs.
 *
 * A module-level promise rather than per-row state: the labels table renders
 * hundreds of rows, and each one opening its own request would hammer the API
 * with identical calls. Invalidated whenever a parent is created so a brand-new
 * parent is immediately pickable elsewhere in the table.
 */
let _parentCache = null;
function loadParents(force) {
  if (force) _parentCache = null;
  if (!_parentCache) {
    _parentCache = fetch(`${API}/parent-prices/`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => {
        const items = d.items || d.results || d || [];
        return (Array.isArray(items) ? items : [])
          .map((p) => (typeof p === "string" ? p : p.item_id))
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b));
      })
      .catch(() => []);
  }
  return _parentCache;
}

/**
 * Link a SKU to a parent, from inside the table.
 *
 * Two things are possible and they are genuinely different operations: attaching
 * to a parent that already exists (`link-sku/`, so the SKU inherits that
 * parent's pricing) or inventing a new one (`parent-from-sku/`). The old control
 * only did the second, which meant every SKU got its own parent and the grouping
 * the parent level exists for never happened.
 */
export function ParentLinkInline({ sku, currentParent, onDone }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("link");      // "link" | "create"
  const [parents, setParents] = useState(null);
  const [choice, setChoice] = useState("");
  const [name, setName] = useState(sku || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    let dead = false;
    loadParents().then((list) => {
      if (dead) return;
      setParents(list);
      // Nothing to link to yet — don't offer an empty dropdown, go straight to create.
      if (!list.length) setMode("create");
    });
    return () => { dead = true; };
  }, [open]);

  const save = async () => {
    const linking = mode === "link";
    const parent_id = (linking ? choice : name).trim();
    if (!parent_id) { setErr(linking ? "Pick a parent." : "Enter a name."); return; }
    setBusy(true); setErr("");
    try {
      const res = await fetch(`${API}/${linking ? "link-sku" : "parent-from-sku"}/`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku_id: sku, parent_id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(d.error || `Could not ${linking ? "link" : "create"}.`); return; }
      if (!linking) loadParents(true);   // new parent — everyone else can pick it now
      setOpen(false);
      onDone?.(sku, parent_id);
    } catch { setErr("Network error."); }
    finally { setBusy(false); }
  };

  if (!open) {
    const relink = !!currentParent;
    return (
      <Button size="small" onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        sx={{ fontSize: 11, textTransform: "none", py: "1px", px: "8px", minWidth: 0,
              color: relink ? C.gray500 : C.blue, fontWeight: 600,
              border: `1px dashed ${relink ? C.gray300 : C.blue}`, borderRadius: "6px" }}>
        {relink ? "change parent" : "link to parent"}
      </Button>
    );
  }

  return (
    <Box onClick={(e) => e.stopPropagation()}
      sx={{ display: "flex", flexDirection: "column", gap: "5px", mt: "3px",
            p: "7px", borderRadius: "8px", background: C.gray50, border: `1px solid ${C.border}` }}>
      <Box sx={{ display: "flex", gap: "4px" }}>
        {["link", "create"].map((m) => (
          <Button key={m} size="small" onClick={() => { setMode(m); setErr(""); }}
            sx={{
              fontSize: 10.5, textTransform: "none", py: 0, px: "8px", minWidth: 0, fontWeight: 700,
              color: mode === m ? C.white : C.gray500,
              background: mode === m ? C.orange : "transparent",
              borderRadius: "6px", "&:hover": { background: mode === m ? C.orange : C.gray100 },
            }}>
            {m === "link" ? "Existing" : "New"}
          </Button>
        ))}
      </Box>

      {mode === "link" ? (
        parents === null ? (
          <Typography sx={{ fontSize: 11, color: C.gray400 }}>Loading parents…</Typography>
        ) : (
          <TextField select value={choice} onChange={(e) => setChoice(e.target.value)}
            size="small" slotProps={{ select: { native: true } }}
            sx={{ minWidth: 170, "& select": { fontSize: 11.5, py: "5px" } }}>
            <option value="">Pick a parent…</option>
            {parents.map((p) => <option key={p} value={p}>{p}</option>)}
          </TextField>
        )
      ) : (
        <TextField value={name} onChange={(e) => setName(e.target.value)} size="small" autoFocus
          placeholder="New parent name"
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setOpen(false); }}
          sx={{ minWidth: 170, "& input": { fontSize: 11.5, py: "5px" } }} />
      )}

      <Box sx={{ display: "flex", gap: "4px", alignItems: "center" }}>
        <Button size="small" disabled={busy} onClick={save}
          sx={{ fontSize: 11, textTransform: "none", py: 0, px: "10px", minWidth: 0,
                color: C.white, background: C.green, fontWeight: 700, borderRadius: "6px",
                "&:hover": { background: C.green } }}>
          {busy ? "…" : mode === "link" ? "Link" : "Create"}
        </Button>
        <Button size="small" onClick={() => { setOpen(false); setErr(""); }}
          sx={{ fontSize: 11, textTransform: "none", py: 0, px: "6px", minWidth: 0, color: C.gray400 }}>
          Cancel
        </Button>
      </Box>
      {err && <Typography sx={{ fontSize: 10.5, color: C.red }}>{err}</Typography>}
    </Box>
  );
}

/** Parent above, variant indented below — the two levels must never blur. */
export function ParentSkuCell({ sku, parentSku, onParentAdded }) {
  const linked = parentSku && parentSku !== sku;
  return (
    <Box sx={{ minWidth: 0 }}>
      {linked ? (
        <>
          <Typography sx={{ fontSize: 14.5, fontWeight: 800, color: C.orange, wordBreak: "break-all", lineHeight: 1.3 }}>
            {parentSku}
          </Typography>
          <Typography sx={{ fontSize: 13, color: C.gray600, fontFamily: "monospace",
                            wordBreak: "break-all", lineHeight: 1.35, pl: "10px",
                            borderLeft: `2px solid ${C.orangeBorder}`, ml: "1px", mt: "2px" }}>
            {sku || "—"}
          </Typography>
        </>
      ) : (
        <Typography sx={{ fontSize: 14, fontWeight: 700, color: C.gray800, fontFamily: "monospace",
                          wordBreak: "break-all", lineHeight: 1.3 }}>
          {sku || "—"}
        </Typography>
      )}
      {sku && (
        <Box sx={{ mt: "4px" }}>
          <ParentLinkInline sku={sku} currentParent={linked ? parentSku : null} onDone={onParentAdded} />
        </Box>
      )}
    </Box>
  );
}
