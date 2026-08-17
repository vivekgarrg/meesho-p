import React, { useState, useEffect, useCallback } from "react";
import { API, C, S, useIsMobile } from "../../App";
import { CircularProgress } from "@mui/material";
import { ListingReviewRow } from "./TeamTasksShared";

/**
 * SKUs from listing tasks not tied to any product — almost always ones
 * created the old way, before Bulk Listing became the only path in. Kept
 * reachable so nothing already in the pipeline goes missing.
 */
export function LegacyListingsPanel({ isAdmin, busy, setMsg, post }) {
  const isMobile = useIsMobile();
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchListings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/legacy-listings/`);
      const d = await res.json();
      setListings(d.results || []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchListings(); }, [fetchListings]);

  const reviewListing = async (id, decision, comment) => {
    const { data, error } = await post(`${API}/task-listings/${id}/review/`, { decision, comment });
    if (error) { setMsg({ type: "error", text: error }); return; }
    setMsg({ type: "success", text: data.credited ? `Approved — ${data.credited} added.` : "Recorded." });
    fetchListings();
  };

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
        <CircularProgress style={{ color: C.orange }} />
      </div>
    );
  }

  if (listings.length === 0) {
    return (
      <div style={{ ...S.card, textAlign: "center", padding: 40, color: C.gray400, fontSize: 13.5 }}>
        No older, unlinked SKUs — everything's under a product.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <p style={{ fontSize: 12.5, color: C.gray500, lineHeight: 1.6 }}>
        SKUs added the old way, before this task was linked to a product. Link the
        underlying task to a product from its Product page to fold these into a
        parent SKU, or review them here as-is.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {listings.map((l) => (
          <ListingReviewRow key={l.id} listing={l} isMobile={isMobile} busy={busy}
            isAdmin={isAdmin} onReview={reviewListing} />
        ))}
      </div>
    </div>
  );
}
