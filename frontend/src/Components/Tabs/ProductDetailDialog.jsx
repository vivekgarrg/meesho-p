import React, { useState, useEffect, useCallback } from "react";
import { API, C, S, btn, Tag, fmt, useIsMobile } from "../../App";
import CloseIcon from "@mui/icons-material/Close";
import AddAPhotoIcon from "@mui/icons-material/AddAPhoto";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import LinkIcon from "@mui/icons-material/Link";
import InventoryIcon from "@mui/icons-material/Inventory2Outlined";
import { CircularProgress } from "@mui/material";
import { field, tap, ListingReviewRow } from "./TeamTasksShared";

export function ProductDetailDialog({ productId, isAdmin, busy, setBusy, setMsg, post, onClose, onChanged }) {
  const isMobile = useIsMobile();
  const [product, setProduct] = useState(null);
  const [batches, setBatches] = useState([]);
  const [unlinkedBatches, setUnlinkedBatches] = useState([]);
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [addingPhotos, setAddingPhotos] = useState(false);
  const [photoLinks, setPhotoLinks] = useState("");
  const [linking, setLinking] = useState(false);
  const [pickedBatch, setPickedBatch] = useState("");

  const fetchProduct = useCallback(async () => {
    const res = await fetch(`${API}/products/${productId}/`);
    if (!res.ok) return;
    const d = await res.json();
    setProduct(d);
    setForm({ name: d.name, size: d.size, weight: d.weight, description: d.description });
  }, [productId]);

  const fetchBatches = useCallback(async () => {
    const res = await fetch(`${API}/bulk-listing/batches/?product_id=${productId}`);
    if (res.ok) setBatches((await res.json()).results || []);
  }, [productId]);

  const fetchUnlinked = useCallback(async () => {
    const res = await fetch(`${API}/bulk-listing/batches/unlinked/`);
    if (res.ok) setUnlinkedBatches((await res.json()).results || []);
  }, []);

  const fetchListings = useCallback(async () => {
    const res = await fetch(`${API}/products/${productId}/listings/`);
    if (res.ok) setListings((await res.json()).results || []);
  }, [productId]);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([fetchProduct(), fetchBatches(), fetchListings(), isAdmin ? fetchUnlinked() : Promise.resolve()]);
    } finally { setLoading(false); }
  }, [fetchProduct, fetchBatches, fetchListings, fetchUnlinked, isAdmin]);

  useEffect(() => { refreshAll(); }, [refreshAll]);

  const saveDetails = async () => {
    const { error } = await post(`${API}/products/${productId}/`, form, "PUT");
    if (error) { setMsg({ type: "error", text: error }); return; }
    setMsg({ type: "success", text: "Product saved." });
    fetchProduct(); onChanged();
  };

  const addPhotoLinks = async () => {
    if (!photoLinks.trim()) return;
    setAddingPhotos(true);
    try {
      const { error } = await post(`${API}/products/${productId}/photos/`, { links: photoLinks });
      if (error) { setMsg({ type: "error", text: error }); return; }
      setPhotoLinks("");
      fetchProduct();
    } finally { setAddingPhotos(false); }
  };

  const deletePhoto = async (photoId) => {
    if (!window.confirm("Remove this photo?")) return;
    const { error } = await post(`${API}/products/photos/${photoId}/`, null, "DELETE");
    if (error) setMsg({ type: "error", text: error });
    else fetchProduct();
  };

  const linkBatch = async () => {
    if (!pickedBatch) return;
    setLinking(true);
    try {
      const { data, error } = await post(`${API}/products/${productId}/link-batch/`, { batch_id: pickedBatch });
      if (error) { setMsg({ type: "error", text: error }); return; }
      const r = data.retroactively_linked;
      setMsg({ type: "success", text: r?.linked ? `Batch linked — ${r.linked} already-approved SKU(s) joined the parent SKU.` : "Batch linked." });
      setPickedBatch("");
      await Promise.all([fetchBatches(), fetchUnlinked(), fetchListings(), fetchProduct()]);
      onChanged();
    } finally { setLinking(false); }
  };

  const reviewListing = async (id, decision, comment) => {
    const { data, error } = await post(`${API}/task-listings/${id}/review/`, { decision, comment });
    if (error) { setMsg({ type: "error", text: error }); return; }
    setMsg({ type: "success", text: data.credited ? `Approved — ${fmt(data.credited)} added.` : "Recorded." });
    fetchListings(); fetchProduct(); onChanged();
  };

  const deleteProduct = async () => {
    if (!window.confirm(`Delete "${product.name}"? This only removes the product card — SKUs and pricing stay.`)) return;
    const { error } = await post(`${API}/products/${productId}/`, null, "DELETE");
    if (error) { setMsg({ type: "error", text: error }); return; }
    setMsg({ type: "success", text: "Product deleted." });
    onChanged(); onClose();
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(19,17,28,0.55)", zIndex: 1000,
      display: "flex", alignItems: isMobile ? "flex-end" : "center", justifyContent: "center",
      padding: isMobile ? 0 : 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: C.white, borderRadius: isMobile ? "16px 16px 0 0" : 16,
        width: isMobile ? "100%" : "min(720px, 100%)", maxHeight: isMobile ? "92vh" : "88vh",
        overflowY: "auto", boxShadow: "0 20px 60px rgba(19,17,28,0.3)",
      }}>
        <div style={{ position: "sticky", top: 0, background: C.white, zIndex: 1,
          display: "flex", alignItems: "center", gap: 10, padding: "16px 20px",
          borderBottom: `1px solid ${C.border}` }}>
          <InventoryIcon style={{ color: C.orange, fontSize: 20 }} />
          <span style={{ fontSize: 15.5, fontWeight: 800, color: C.gray800, flex: 1 }}>
            {product?.name || "Product"}
          </span>
          <button onClick={onClose} style={tap(isMobile)}><CloseIcon style={{ fontSize: 19 }} /></button>
        </div>

        {loading || !product || !form ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 50 }}>
            <CircularProgress style={{ color: C.orange }} />
          </div>
        ) : (
          <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>

            {/* Photos */}
            <div>
              <div style={{ ...S.label, marginBottom: 8 }}>Photos</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {(product.photos || []).map((p) => (
                  <div key={p.id} style={{ position: "relative", width: 84, height: 84 }}>
                    <img src={p.url} alt="" style={{ width: 84, height: 84, objectFit: "cover",
                      borderRadius: 10, border: `1px solid ${C.border}` }} />
                    {isAdmin && (
                      <button onClick={() => deletePhoto(p.id)} title="Remove" style={{
                        position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: "50%",
                        background: C.white, border: `1px solid ${C.redBorder}`, color: C.red,
                        display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                        boxShadow: "0 1px 4px rgba(0,0,0,0.15)" }}>
                        <DeleteOutlineIcon style={{ fontSize: 13 }} />
                      </button>
                    )}
                  </div>
                ))}
                {(product.photos || []).length === 0 && !isAdmin && (
                  <span style={{ fontSize: 12.5, color: C.gray400 }}>No photos yet.</span>
                )}
              </div>
              {isAdmin && (
                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <input value={photoLinks} onChange={(e) => setPhotoLinks(e.target.value)}
                    placeholder="Paste a photo link, or several separated by commas"
                    style={field(isMobile, { flex: "1 1 260px" })} />
                  <button onClick={addPhotoLinks} disabled={!photoLinks.trim() || addingPhotos}
                    style={btn("secondary", "sm")}>
                    {addingPhotos ? <CircularProgress size={13} style={{ color: C.white }} /> : (
                      <><AddAPhotoIcon style={{ fontSize: 14, verticalAlign: "-2px" }} />&nbsp;Add</>
                    )}
                  </button>
                </div>
              )}
            </div>

            {/* Details */}
            <div>
              <div style={{ ...S.label, marginBottom: 8 }}>Details</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
                <div>
                  <label style={{ ...S.label, marginBottom: 3 }}>Name</label>
                  <input value={form.name} disabled={!isAdmin}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    style={field(isMobile)} />
                </div>
                <div>
                  <label style={{ ...S.label, marginBottom: 3 }}>Size</label>
                  <input value={form.size} disabled={!isAdmin}
                    onChange={(e) => setForm((f) => ({ ...f, size: e.target.value }))}
                    style={field(isMobile)} placeholder="e.g. Medium" />
                </div>
                <div>
                  <label style={{ ...S.label, marginBottom: 3 }}>Weight</label>
                  <input value={form.weight} disabled={!isAdmin}
                    onChange={(e) => setForm((f) => ({ ...f, weight: e.target.value }))}
                    style={field(isMobile)} placeholder="e.g. 250g" />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={{ ...S.label, marginBottom: 3 }}>Description</label>
                  <textarea value={form.description} disabled={!isAdmin} rows={2}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    style={field(isMobile, { resize: "vertical" })} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
                <Tag variant="blue" fontSize={11}>Parent: {product.parent_sku_item_id}</Tag>
                {isAdmin && (
                  <button onClick={saveDetails} disabled={busy} style={btn("primary", "sm")}>Save</button>
                )}
                {isAdmin && (
                  <button onClick={deleteProduct} disabled={busy}
                    style={{ ...btn("ghost", "sm"), color: C.red, borderColor: C.redBorder, marginLeft: "auto" }}>
                    <DeleteOutlineIcon style={{ fontSize: 14, verticalAlign: "-2px" }} />&nbsp;Delete product
                  </button>
                )}
              </div>
            </div>

            {/* Stats */}
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", padding: "12px 14px",
              background: C.gray50, borderRadius: 12, border: `1px solid ${C.border}` }}>
              <Stat label="SKUs" value={product.sku_count} />
              <Stat label="paid" value={fmt(product.total_paid)} />
              <Stat label="pending" value={fmt(product.pending_value)} accent={product.pending_count > 0 ? C.amber : C.gray800} />
              <Stat label="batches" value={product.batches_count} />
            </div>

            {/* Linked batches */}
            <div>
              <div style={{ ...S.label, marginBottom: 8 }}>Linked bulk listing batches</div>
              {batches.length === 0 ? (
                <div style={{ fontSize: 12.5, color: C.gray400 }}>No batches linked yet.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: isAdmin ? 10 : 0 }}>
                  {batches.map((b) => (
                    <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 8,
                      padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: 9, fontSize: 12.5 }}>
                      <Tag variant={b.platform === "meesho" ? "orange" : "blue"} fontSize={10}>{b.platform}</Tag>
                      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis",
                        whiteSpace: "nowrap", color: C.gray700 }}>{b.filename}</span>
                      <span style={{ color: C.gray500, fontWeight: 700, whiteSpace: "nowrap" }}>
                        {b.approved_count ?? 0}/{b.total_count} approved
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {isAdmin && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <select value={pickedBatch} onChange={(e) => setPickedBatch(e.target.value)}
                    style={field(isMobile, { flex: "1 1 220px" })}>
                    <option value="">
                      {unlinkedBatches.length ? "Link a generated batch…" : "No unlinked batches available"}
                    </option>
                    {unlinkedBatches.map((b) => (
                      <option key={b.id} value={b.id}>{b.filename} ({b.total_count} SKUs)</option>
                    ))}
                  </select>
                  <button onClick={linkBatch} disabled={!pickedBatch || linking}
                    style={btn("secondary", "sm")}>
                    <LinkIcon style={{ fontSize: 14, verticalAlign: "-2px" }} />&nbsp;{linking ? "Linking…" : "Link"}
                  </button>
                </div>
              )}
            </div>

            {/* SKUs */}
            <div>
              <div style={{ ...S.label, marginBottom: 8 }}>SKUs on this product ({listings.length})</div>
              {listings.length === 0 ? (
                <div style={{ fontSize: 12.5, color: C.gray400 }}>
                  No SKUs yet — link a batch above and its SKUs will show up here.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {listings.map((l) => (
                    <ListingReviewRow key={l.id} listing={l} isMobile={isMobile} busy={busy}
                      isAdmin={isAdmin} onReview={reviewListing} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div>
      <div style={{ fontSize: 17, fontWeight: 800, fontFamily: "monospace", color: accent || C.gray800 }}>{value}</div>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: C.gray400, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
    </div>
  );
}
