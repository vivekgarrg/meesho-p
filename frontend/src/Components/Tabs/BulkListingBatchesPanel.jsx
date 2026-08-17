import React, { useCallback, useEffect, useState } from "react";
import { API, C, S } from "../../App";
import { IconButton, Tooltip, CircularProgress } from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import EditIcon from "@mui/icons-material/Edit";
import HistoryIcon from "@mui/icons-material/History";

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
 */
export function BulkListingBatchesPanel({ isMobile, refreshKey, onLoadToEdit }) {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`${API}/bulk-listing/batches/`)
      .then((r) => r.json())
      .then((d) => setBatches(d.results || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

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
        <span style={{ fontWeight: 700, fontSize: 13, color: C.gray800 }}>Generated Files</span>
        <span style={{ fontSize: 11, color: C.gray400, background: C.gray100, borderRadius: 10, padding: "2px 8px", fontWeight: 600 }}>
          {batches.length}
        </span>
      </div>

      <div style={{ overflowY: "auto", flex: 1 }}>
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 24 }}><CircularProgress size={22} /></div>
        ) : batches.length === 0 ? (
          <div style={{ padding: "20px 16px", fontSize: 12, color: C.gray400 }}>
            Nothing generated yet. Every sheet you generate is saved here — SKUs, titles and all —
            so you can re-download it or reload it to edit without retyping anything.
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
