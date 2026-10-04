import React, { useCallback, useEffect, useState } from "react";
import { API, C, S } from "../../App";
import { IconButton, Tooltip, CircularProgress } from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import EditIcon from "@mui/icons-material/Edit";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import HistoryIcon from "@mui/icons-material/History";
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";
import { InputAdornment, TextField } from "@mui/material";

const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" });
};

/**
 * Every bulk listing sheet ever generated on this business — "generate once,
 * reuse forever" (points 2 & 6 of the Bulk Listing rework): download the
 * exact same file again with no re-entry, or load it back into the form to
 * tweak and regenerate. Review status comes straight off the WorkerTask/
 * TaskListing rows the generation seeded, so it doubles as a quick read on
 * how much of a batch has cleared admin approval (and therefore been paid).
 *
 * Scoped to one platform via `platform`. It used to list every batch
 * regardless, so the Flipkart flow showed Meesho sheets alongside its own —
 * which is not just noise: a Meesho batch cannot be loaded back into the
 * Flipkart form at all, so every one of those rows was a dead end.
 */
export function BulkListingBatchesPanel({ isMobile, refreshKey, onLoadToEdit, onDuplicate, platform }) {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState(null);
  const [search, setSearch] = useState("");

  // Searched server-side rather than filtering what's already here: the list
  // is capped at 500 rows, so the sheet being looked for may not be in the
  // page the client holds — and the match runs over every SKU in each sheet,
  // which the client payload doesn't carry in full either.
  const load = useCallback((term) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (platform) params.set("platform", platform);
    const q = (term ?? "").trim();
    if (q) params.set("search", q);
    fetch(`${API}/bulk-listing/batches/?${params}`)
      .then((r) => r.json())
      .then((d) => setBatches(d.results || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [platform]);

  // Typing shouldn't fire a request per keystroke; an empty box reloads at
  // once so clearing it feels instant.
  useEffect(() => {
    const t = setTimeout(() => load(search), search ? 250 : 0);
    return () => clearTimeout(t);
  }, [search, load, refreshKey]);

  const download = async (batch) => {
    setDownloadingId(batch.id);
    try {
      const res = await fetch(`${API}/bulk-listing/batches/${batch.id}/download/`);
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = batch.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div style={{
      ...S.card, padding: 0, overflow: "hidden",
      width: isMobile ? "100%" : 340, flexShrink: 0,
      position: isMobile ? "static" : "sticky", top: isMobile ? undefined : 16,
      maxHeight: isMobile ? undefined : "calc(100vh - 32px)",
      display: "flex", flexDirection: "column",
    }}>
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.gray100}`, display: "flex", alignItems: "center", gap: 8 }}>
        <HistoryIcon style={{ fontSize: 17, color: C.gray400 }} />
        <span style={{ fontWeight: 700, fontSize: 13, color: C.gray800 }}>
          {platform === "flipkart" ? "Flipkart Files" : platform === "meesho" ? "Meesho Files" : "Generated Files"}
        </span>
        <span style={{ fontSize: 11, color: C.gray400, background: C.gray100, borderRadius: 10, padding: "2px 8px", fontWeight: 600 }}>
          {batches.length}
        </span>
      </div>

      <div style={{ padding: "10px 12px", borderBottom: `1px solid ${C.gray100}` }}>
        <TextField
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search SKU, file or category…"
          size="small"
          fullWidth
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon style={{ fontSize: 16, color: C.gray400 }} />
              </InputAdornment>
            ),
            endAdornment: search ? (
              <InputAdornment position="end">
                <IconButton size="small" onClick={() => setSearch("")} title="Clear search">
                  <ClearIcon style={{ fontSize: 15 }} />
                </IconButton>
              </InputAdornment>
            ) : undefined,
            sx: { fontSize: 12.5, borderRadius: "9px" },
          }}
        />
      </div>

      <div style={{ overflowY: "auto", flex: 1 }}>
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 24 }}><CircularProgress size={22} /></div>
        ) : batches.length === 0 ? (
          <div style={{ padding: "20px 16px", fontSize: 12, color: C.gray400 }}>
            {search.trim() ? (
              <>
                No sheet matches "<strong>{search.trim()}</strong>". The search covers the file name,
                the category, and every SKU inside each sheet.
              </>
            ) : (
              <>
                Nothing generated yet. Every sheet you generate is saved here — SKUs, titles and all —
                so you can re-download it or reload it to edit without retyping anything.
              </>
            )}
          </div>
        ) : (
          batches.map((b) => {
            const approved = b.approved_count;
            const total = b.total_count;
            const fullyApproved = approved !== null && approved === total && total > 0;
            return (
              <div key={b.id} style={{ padding: "10px 16px", borderBottom: `1px solid ${C.gray100}` }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: C.gray800, wordBreak: "break-all" }}>
                  {b.filename}
                </div>
                <div style={{ fontSize: 11, color: C.gray400, marginTop: 2 }}>
                  {b.first_sku_id}{b.row_count > 1 ? ` +${b.row_count - 1} more` : ""} · {b.category_label || b.platform}
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
                  <span style={{
                    fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: 8,
                    background: fullyApproved ? "#ECFDF5" : "#FFFBEB",
                    color: fullyApproved ? C.green : C.amber,
                  }}>
                    {approved !== null ? `${approved}/${total} approved` : "—"}
                  </span>
                  <span style={{ fontSize: 10.5, color: C.gray400 }}>{fmtDate(b.created_at)}</span>
                </div>
                <div style={{ display: "flex", gap: 4, marginTop: 6, justifyContent: "flex-end" }}>
                  {/* Duplicate rather than edit is usually what's wanted: every
                      SKU a generation produces is registered immediately, so
                      re-generating this batch under its own SKUs is always
                      rejected as a clash.

                      What it copies depends on what is already loaded — with a
                      sheet uploaded it brings the fields only and leaves those
                      photos alone, otherwise it brings photos too. See
                      duplicateBatch in BulkListingTab. */}
                  <Tooltip title="Duplicate — copy this listing's fields onto the sheet you've uploaded (or everything, if nothing is loaded)">
                    <span>
                      <IconButton size="small" onClick={() => onDuplicate?.(b)}
                        disabled={b.platform === "flipkart" || !onDuplicate}>
                        <ContentCopyIcon fontSize="inherit" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Load into the form to edit">
                    <span>
                      <IconButton size="small" onClick={() => onLoadToEdit(b)} disabled={b.platform === "flipkart"}>
                        <EditIcon fontSize="inherit" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Download again">
                    <IconButton size="small" onClick={() => download(b)} disabled={downloadingId === b.id}>
                      <DownloadIcon fontSize="inherit" />
                    </IconButton>
                  </Tooltip>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
