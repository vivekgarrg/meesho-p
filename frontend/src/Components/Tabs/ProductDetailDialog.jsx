import React, { useState, useEffect, useCallback } from "react";
import { API, C, S, btn, Tag, fmt, useIsMobile } from "../../App";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import InventoryIcon from "@mui/icons-material/Inventory2Outlined";
import { CircularProgress } from "@mui/material";
import { field, tap } from "./TeamTasksShared";

const LISTING_STATUS_META = {
  PENDING:  { label: "Waiting", tag: "amber" },
  APPROVED: { label: "Approved", tag: "green" },
  REJECTED: { label: "Rejected", tag: "red" },
};

export function ProductDetailDialog({ productId, isAdmin, busy, setBusy, setMsg, post, onClose, onChanged }) {
  const isMobile = useIsMobile();
  const [product, setProduct] = useState(null);
  const [batches, setBatches] = useState([]);
  const [unlinkedBatches, setUnlinkedBatches] = useState([]);
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [pickedBatch, setPickedBatch] = useState("");
  const [approvingBatch, setApprovingBatch] = useState(null); // batch id currently being approved/rejected

  const fetchProduct = useCallback(async () => {
    const res = await fetch(`${API}/products/${productId}/`);
    if (!res.ok) return;
    const d = await res.json();
    setProduct(d);
    setForm({ name: d.name, size: d.size, weight: d.weight, hsn_code: d.hsn_code, drive_link: d.drive_link, description: d.description });
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

  /** One action: link (if a batch is picked and not yet linked) + approve
      every pending SKU in it — the "approved once" flow. Also used to
      approve/reject a batch's *remaining* pending SKUs once it's already
      linked. */
  const approveBatch = async (batchId, decision) => {
    setApprovingBatch(batchId);
    try {
      const body = { decision };
      if (batchId === pickedBatch) body.product_id = productId;
      const { data, error } = await post(`${API}/bulk-listing/batches/${batchId}/approve/`, body);
      if (error) { setMsg({ type: "error", text: error }); return; }
      const bits = [];
      if (data.approved_count) bits.push(`${data.approved_count} approved — ${fmt(data.credited_total)} paid`);
      if (data.rejected_count) bits.push(`${data.rejected_count} rejected`);
      if (data.retroactively_linked?.linked) bits.push(`${data.retroactively_linked.linked} already-approved SKU(s) joined the parent`);
      setMsg({ type: "success", text: bits.join(" · ") || "Done." });
      setPickedBatch("");
      await Promise.all([fetchBatches(), fetchUnlinked(), fetchListings(), fetchProduct()]);
      onChanged();
    } finally { setApprovingBatch(null); }
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
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={{ ...S.label, marginBottom: 3 }}>Drive folder link</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input value={form.drive_link} disabled={!isAdmin}
                      onChange={(e) => setForm((f) => ({ ...f, drive_link: e.target.value }))}
                      style={field(isMobile, { flex: 1 })} placeholder="https://drive.google.com/…" />
                    {product.drive_link && (
                      <a href={product.drive_link} target="_blank" rel="noreferrer"
                        style={{ ...btn("ghost", "sm"), display: "inline-flex", alignItems: "center",
                          textDecoration: "none", whiteSpace: "nowrap" }}>
                        Open <OpenInNewIcon style={{ fontSize: 13, marginLeft: 4 }} />
                      </a>
                    )}
                  </div>
                </div>
                <div>
                  <label style={{ ...S.label, marginBottom: 3 }}>HSN code</label>
                  <input value={form.hsn_code} disabled={!isAdmin}
                    onChange={(e) => setForm((f) => ({ ...f, hsn_code: e.target.value }))}
                    style={field(isMobile, { fontFamily: "monospace" })} placeholder="e.g. 6203" />
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
                  <label style={{ ...S.label, marginBottom: 3 }}>Short description</label>
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

            {/* Bulk listing batches — approved once, optionally linked in the same click */}
            <div>
              <div style={{ ...S.label, marginBottom: 8 }}>Bulk listing batches</div>
              {batches.length === 0 ? (
                <div style={{ fontSize: 12.5, color: C.gray400, marginBottom: isAdmin ? 10 : 0 }}>No batches linked yet.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: isAdmin ? 10 : 0 }}>
                  {batches.map((b) => (
                    <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
                      padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: 9, fontSize: 12.5 }}>
                      <Tag variant={b.platform === "meesho" ? "orange" : "blue"} fontSize={10}>{b.platform}</Tag>
                      <span style={{ flex: "1 1 140px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis",
                        whiteSpace: "nowrap", color: C.gray700 }}>{b.filename}</span>
                      <span style={{ color: C.gray500, fontWeight: 700, whiteSpace: "nowrap" }}>
                        {b.approved_count ?? 0}/{b.total_count} approved
                      </span>
                      {isAdmin && b.pending_count > 0 && (
                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={() => approveBatch(b.id, "APPROVE")} disabled={approvingBatch === b.id}
                            style={btn("success", "sm")}>
                            {approvingBatch === b.id ? "…" : `Approve remaining ${b.pending_count}`}
                          </button>
                          <button onClick={() => approveBatch(b.id, "REJECT")} disabled={approvingBatch === b.id}
                            style={{ ...btn("ghost", "sm"), color: C.red, borderColor: C.redBorder }}>
                            Reject
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {isAdmin && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <select value={pickedBatch} onChange={(e) => setPickedBatch(e.target.value)}
                    style={field(isMobile, { flex: "1 1 220px" })}>
                    <option value="">
                      {unlinkedBatches.length ? "Pick a generated batch…" : "No unlinked batches available"}
                    </option>
                    {unlinkedBatches.map((b) => (
                      <option key={b.id} value={b.id}>{b.filename} ({b.total_count} SKUs)</option>
                    ))}
                  </select>
                  <button onClick={() => approveBatch(pickedBatch, "APPROVE")}
                    disabled={!pickedBatch || approvingBatch === pickedBatch}
                    style={btn("success", "sm")}>
                    <CheckCircleIcon style={{ fontSize: 14, verticalAlign: "-2px" }} />
                    &nbsp;{approvingBatch === pickedBatch ? "Approving…" : "Approve batch"}
                  </button>
                </div>
              )}
              <div style={{ fontSize: 10.5, color: C.gray400, marginTop: 6 }}>
                Approving links the batch to this product's parent SKU (if not already) and approves every
                SKU in it in one step — no more approving each SKU one at a time.
              </div>
            </div>

            {/* SKUs — read-only status now that approval happens per batch above */}
            <div>
              <div style={{ ...S.label, marginBottom: 8 }}>SKUs on this product ({listings.length})</div>
              {listings.length === 0 ? (
                <div style={{ fontSize: 12.5, color: C.gray400 }}>
                  No SKUs yet — approve a batch above and its SKUs will show up here.
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                    <thead>
                      <tr>
                        {["SKU", "Status", "Reward"].map((h) => (
                          <th key={h} style={{ textAlign: h === "Reward" ? "right" : "left", padding: "6px 8px",
                            color: C.gray400, fontSize: 10.5, fontWeight: 800, textTransform: "uppercase",
                            letterSpacing: "0.05em", borderBottom: `1px solid ${C.border}` }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {listings.map((l) => {
                        const meta = LISTING_STATUS_META[l.status] || LISTING_STATUS_META.PENDING;
                        return (
                          <tr key={l.id}>
                            <td style={{ padding: "7px 8px", fontFamily: "monospace", fontWeight: 700, color: C.gray800 }}>
                              {l.sku_id}
                            </td>
                            <td style={{ padding: "7px 8px" }}><Tag variant={meta.tag} fontSize={10.5}>{meta.label}</Tag></td>
                            <td style={{ padding: "7px 8px", textAlign: "right", fontFamily: "monospace",
                              color: l.reward_credited_at ? C.green : C.gray400 }}>
                              {l.reward_credited_at ? fmt(l.reward_amount) : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
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
