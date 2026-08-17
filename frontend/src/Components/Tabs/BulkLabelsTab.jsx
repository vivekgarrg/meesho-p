import React, { useMemo, useRef, useState } from "react";
import {
  Alert, Box, Button, Collapse, LinearProgress, Paper, Table, TableBody, TableCell,
  TableHead, TableRow, TextField, Tooltip, Typography, Chip, IconButton,
} from "@mui/material";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import DownloadIcon from "@mui/icons-material/Download";
import DeleteIcon from "@mui/icons-material/Delete";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import { C, API, useIsMobile } from "../../App";

/*
 * BULK LABELS
 *
 * A separate tab from Labels, for the case the single-file Batch view
 * doesn't cover: several exported label PDFs (e.g. one per Meesho supplier
 * account) that need to become one merged, business-sorted batch instead of
 * several separate uploads. Calls its own endpoint (bulk-labels/parse/) —
 * the existing Labels tab and its endpoint are untouched by this file.
 *
 * The response shape here is almost identical to the single-file endpoint's
 * (same per_business / ambiguous_skus / sku_table fields), since the backend
 * merges every uploaded file into one PDF before doing anything else — the
 * one difference is `sorted_pdf_b64` in place of `cropped_pdf_b64`: pages are
 * still reordered most-dispatched-first, but never cropped, since this batch
 * is meant to go straight to print exactly as Meesho generated each page.
 */

const todayISO = () => new Date().toISOString().slice(0, 10);

function downloadSortedPDF(b64, label) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `labels_sorted_${label || "bulk"}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Extract just `pages` (0-based positions within sorted_pdf_b64) from the
 * batch's PDF and download the result — shared by the per-parent-group and
 * per-AWB download buttons below. */
async function extractAndDownload(pdfB64, pages, filename) {
  const res = await fetch(`${API}/bulk-labels/extract/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pdf_b64: pdfB64, pages }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.pdf_b64) throw new Error(data.error || "Could not extract those pages.");
  downloadSortedPDF(data.pdf_b64, filename);
}

function Panel({ title, count, hint, defaultOpen = false, right, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Paper elevation={0} sx={{ border: `1px solid ${C.border}`, borderRadius: "12px", overflow: "hidden" }}>
      <Box onClick={() => setOpen((o) => !o)}
        sx={{ px: "16px", py: "12px", display: "flex", alignItems: "center", gap: "10px",
              cursor: "pointer", userSelect: "none", flexWrap: "wrap",
              "&:hover": { bgcolor: C.gray50 } }}>
        {open ? <KeyboardArrowUpIcon sx={{ fontSize: 18, color: C.gray400 }} />
              : <KeyboardArrowDownIcon sx={{ fontSize: 18, color: C.gray400 }} />}
        <Typography sx={{ fontSize: 13, fontWeight: 700, color: C.gray800 }}>{title}</Typography>
        {count != null && (
          <Chip label={count} size="small"
            sx={{ height: 19, fontSize: 11, fontWeight: 700, bgcolor: C.gray100, color: C.gray600 }} />
        )}
        {hint && <Typography sx={{ fontSize: 11, color: C.gray400 }}>{hint}</Typography>}
        {right && <Box sx={{ ml: "auto" }} onClick={(e) => e.stopPropagation()}>{right}</Box>}
      </Box>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ borderTop: `1px solid ${C.gray100}` }}>{children}</Box>
      </Collapse>
    </Paper>
  );
}

function Stat({ label, value, tone = C.gray800 }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{ fontSize: 10, fontWeight: 700, color: C.gray400, letterSpacing: "0.07em", textTransform: "uppercase" }}>
        {label}
      </Typography>
      <Typography sx={{ fontFamily: "monospace", fontWeight: 800, fontSize: 21, color: tone, lineHeight: 1.15 }}>
        {value}
      </Typography>
    </Box>
  );
}

export function BulkLabelsTab() {
  const isMobile = useIsMobile();
  const fileRef = useRef(null);

  const [pending, setPending] = useState([]); // File[] picked, not yet uploaded
  const [batchDate, setBatchDate] = useState(todayISO());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [extracting, setExtracting] = useState(null); // key of the group/row currently downloading
  const [extractError, setExtractError] = useState("");
  const [awbSearch, setAwbSearch] = useState("");

  const addFiles = (fileList) => {
    const picked = Array.from(fileList || []).filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    if (picked.length) setPending((prev) => [...prev, ...picked]);
  };
  const removePending = (i) => setPending((prev) => prev.filter((_, j) => j !== i));

  const upload = async () => {
    if (!pending.length) return;
    setLoading(true); setError(""); setResult(null);
    const form = new FormData();
    pending.forEach((f) => form.append("files", f));
    form.append("upload_date", batchDate);
    try {
      const res = await fetch(`${API}/bulk-labels/parse/`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || "Could not parse those PDFs.");
      } else {
        setResult(data);
        setPending([]);
      }
    } catch {
      setError("Could not reach the server — is the backend running?");
    }
    setLoading(false);
  };

  const skuTable = result?.sku_table || [];
  const pageDetails = result?.page_details || [];
  const labels = result?.total_labels ?? 0;
  const units = useMemo(() => skuTable.reduce((s, r) => s + (r.total_qty || 0), 0), [skuTable]);

  // page_details is in original upload order; page_order (see backend) is the
  // print order sorted_pdf_b64 actually uses. "sortedIndex" here is a page's
  // 0-based position within sorted_pdf_b64 — what the extract endpoint's
  // `pages` list needs, since it addresses positions in THAT pdf, not the
  // original one.
  const orderedDetails = useMemo(() => {
    const order = result?.page_order;
    if (!Array.isArray(order)) return [];
    return order.map((origIdx, sortedIndex) => ({ ...(pageDetails[origIdx] || {}), sortedIndex }));
  }, [result, pageDetails]);

  const canDownloadSubsets = !!(result?.sorted_pdf_b64 && orderedDetails.length);

  // Same grouping shape as the existing Labels tab's "Products in this
  // batch" panel (parent SKU → its child SKUs), computed independently here
  // rather than imported, so this file has no dependency on LabelsTab.jsx.
  const skuGroups = useMemo(() => {
    const m = {};
    skuTable.forEach((r) => {
      const linked = r.parent_sku && r.parent_sku !== r.sku;
      const key = linked ? r.parent_sku : `__${r.sku}`;
      (m[key] = m[key] || { parent: linked ? r.parent_sku : null, skus: [], count: 0 });
      m[key].skus.push(r.sku);
      m[key].count += r.count || 0;
    });
    return Object.values(m).sort((a, b) => b.count - a.count);
  }, [skuTable]);

  const downloadGroup = async (group) => {
    const key = group.parent || group.skus[0];
    setExtractError(""); setExtracting(key);
    try {
      const skuSet = new Set(group.skus);
      const pages = orderedDetails.filter((pd) => skuSet.has(pd.sku)).map((pd) => pd.sortedIndex);
      if (!pages.length) throw new Error("No pages found for this group.");
      await extractAndDownload(result.sorted_pdf_b64, pages, `${group.parent || group.skus[0]}_${batchDate}`);
    } catch (e) {
      setExtractError(e.message || "Could not download that group.");
    } finally {
      setExtracting(null);
    }
  };

  const downloadSingle = async (pd) => {
    const key = `awb-${pd.sortedIndex}`;
    setExtractError(""); setExtracting(key);
    try {
      await extractAndDownload(result.sorted_pdf_b64, [pd.sortedIndex], `${pd.awb || pd.order_id || "label"}_${batchDate}`);
    } catch (e) {
      setExtractError(e.message || "Could not download that label.");
    } finally {
      setExtracting(null);
    }
  };

  const filteredDetails = useMemo(() => {
    const q = awbSearch.trim().toLowerCase();
    const rows = orderedDetails.length ? orderedDetails : pageDetails.map((pd, i) => ({ ...pd, sortedIndex: i }));
    if (!q) return rows;
    return rows.filter((pd) => (pd.awb || "").toLowerCase().includes(q) || (pd.order_id || "").toLowerCase().includes(q));
  }, [orderedDetails, pageDetails, awbSearch]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: "9px" }}>
          <UploadFileIcon sx={{ color: C.orange, fontSize: 21 }} />
          <Typography sx={{ fontSize: 19, fontWeight: 800, color: C.gray800 }}>Bulk Labels</Typography>
        </Box>
        <Typography sx={{ fontSize: 12, color: C.gray400, mt: "3px" }}>
          Upload several labels PDFs at once (e.g. one export per Meesho account) — they're merged
          into one batch and sorted by business the same way a single upload already is.
        </Typography>
      </Box>

      <input
        ref={fileRef} type="file" accept="application/pdf" multiple style={{ display: "none" }}
        onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
      />

      <Paper elevation={0} sx={{ border: `1px solid ${C.border}`, borderRadius: "12px", p: "16px 18px" }}>
        <Box sx={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
          <Button onClick={() => fileRef.current?.click()} disabled={loading}
            sx={{ textTransform: "none", fontWeight: 800, fontSize: 14, px: "22px", py: "10px",
                  color: "#fff", bgcolor: C.orange, borderRadius: "10px",
                  boxShadow: "0 3px 12px rgba(109,40,217,0.28)",
                  "&:hover": { bgcolor: C.orange, filter: "brightness(0.94)" },
                  "&.Mui-disabled": { bgcolor: C.gray300, color: "#fff" } }}>
            <UploadFileIcon sx={{ fontSize: 18, mr: "6px" }} />Add PDFs
          </Button>
          <input type="date" value={batchDate} onChange={(e) => setBatchDate(e.target.value)}
            style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }} />
          <Button onClick={upload} disabled={loading || !pending.length}
            sx={{ textTransform: "none", fontWeight: 700, fontSize: 13, color: C.green,
                  border: `1px solid ${C.greenBorder}`, bgcolor: C.greenLight, borderRadius: "10px", px: "16px",
                  "&.Mui-disabled": { opacity: 0.5 } }}>
            {loading ? "Merging & parsing…" : `Merge & upload ${pending.length ? `(${pending.length})` : ""}`}
          </Button>
          {result?.sorted_pdf_b64 && (
            <Tooltip title="Full pages, merged and sorted most-dispatched-first — ready to print as-is">
              <Button onClick={() => downloadSortedPDF(result.sorted_pdf_b64, batchDate)}
                sx={{ textTransform: "none", fontWeight: 700, fontSize: 13, color: C.blue,
                      border: `1px solid #BFDBFE`, bgcolor: C.blueLight, borderRadius: "10px", px: "14px" }}>
                <DownloadIcon sx={{ fontSize: 17, mr: "5px" }} />Sorted PDF
              </Button>
            </Tooltip>
          )}
        </Box>

        {pending.length > 0 && (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: "6px", mt: "12px" }}>
            {pending.map((f, i) => (
              <Chip key={i} label={f.name} size="small" onDelete={() => removePending(i)}
                deleteIcon={<DeleteIcon />} sx={{ bgcolor: C.gray100, fontSize: 12 }} />
            ))}
          </Box>
        )}
      </Paper>

      {error && <Alert severity="error" sx={{ borderRadius: "10px" }}>{error}</Alert>}

      {loading && (
        <Paper elevation={0} sx={{ border: `1px solid ${C.border}`, borderRadius: "12px", p: "34px", textAlign: "center" }}>
          <LinearProgress sx={{ mb: "14px", borderRadius: 3 }} />
          <Typography sx={{ fontSize: 14, fontWeight: 700, color: C.gray700 }}>Merging and reading your files</Typography>
          <Typography sx={{ fontSize: 12, color: C.gray400, mt: "3px" }}>A large combined batch takes a few seconds</Typography>
        </Paper>
      )}

      {!result && !loading && !pending.length && (
        <Paper elevation={0} onClick={() => fileRef.current?.click()}
          sx={{ border: `2px dashed ${C.gray200}`, borderRadius: "14px", p: "48px 24px",
                textAlign: "center", cursor: "pointer", bgcolor: C.gray50,
                "&:hover": { borderColor: C.orange, bgcolor: C.orangeLight } }}>
          <UploadFileIcon sx={{ fontSize: 40, color: C.gray300 }} />
          <Typography sx={{ fontSize: 15, fontWeight: 700, color: C.gray700, mt: "8px" }}>
            Add two or more labels PDFs
          </Typography>
          <Typography sx={{ fontSize: 12, color: C.gray400, mt: "4px" }}>
            They'll be merged into one sorted batch — nothing uploaded yet
          </Typography>
        </Paper>
      )}

      {result && !loading && (
        <>
          {Object.keys(result.per_business || {}).length > 1 && (
            <Alert severity="info" sx={{ borderRadius: "10px" }}>
              <Typography sx={{ fontSize: 13, fontWeight: 800, mb: "4px" }}>
                This batch covers {Object.keys(result.per_business).length} businesses
              </Typography>
              {Object.entries(result.per_business).map(([name, n]) => (
                <Typography key={name} sx={{ fontSize: 12.5 }}>
                  <strong>{name}</strong> — {n} label{n === 1 ? "" : "s"}
                </Typography>
              ))}
              <Typography sx={{ fontSize: 11.5, mt: "5px", opacity: 0.85 }}>
                Each label was filed against the business whose catalogue prices its SKU.
              </Typography>
            </Alert>
          )}

          {(result.ambiguous_skus || []).length > 0 && (
            <Alert severity="warning" sx={{ borderRadius: "10px" }}>
              <Typography sx={{ fontSize: 13, fontWeight: 800, mb: "4px" }}>
                {result.ambiguous_skus.length} SKU{result.ambiguous_skus.length > 1 ? "s are" : " is"} priced
                by more than one business
              </Typography>
              {result.ambiguous_skus.map((a) => (
                <Typography key={a.sku} sx={{ fontSize: 12.5, fontFamily: "monospace" }}>
                  {a.sku} — {a.businesses.join(" · ")}
                </Typography>
              ))}
              <Typography sx={{ fontSize: 11.5, mt: "5px", opacity: 0.85 }}>
                There's no way to tell which one these belong to, so they were filed under the business
                you have selected.
              </Typography>
            </Alert>
          )}

          <Paper elevation={0} sx={{ border: `1px solid ${C.border}`, borderRadius: "12px", p: "14px 18px" }}>
            <Box sx={{ display: "flex", gap: "30px", flexWrap: "wrap" }}>
              <Stat label="Files merged" value={result.files_merged ?? "—"} tone={C.orange} />
              <Stat label="Pages" value={result.total_pages ?? 0} />
              <Stat label="Labels" value={labels} />
              <Stat label="Products" value={result.total_unique_skus ?? skuTable.length} />
              <Stat label="Units" value={units} />
              <Stat label="Saved / Updated" value={`${result.db_saved ?? 0} / ${result.db_updated ?? 0}`} />
            </Box>
          </Paper>

          {extractError && <Alert severity="error" sx={{ borderRadius: "10px" }} onClose={() => setExtractError("")}>{extractError}</Alert>}

          <Panel title="Products in this batch" count={skuGroups.length} hint="grouped by parent — download just this group's labels">
            <Box sx={{ overflowX: "auto" }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Parent / SKU</TableCell>
                    <TableCell align="right">Labels</TableCell>
                    <TableCell align="right">Download</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {skuGroups.length === 0 ? (
                    <TableRow><TableCell colSpan={3} align="center" sx={{ color: C.gray400, py: 3 }}>No products found.</TableCell></TableRow>
                  ) : skuGroups.map((g) => {
                    const key = g.parent || g.skus[0];
                    return (
                      <TableRow key={key}>
                        <TableCell>
                          {g.parent ? (
                            <>
                              <Typography sx={{ fontSize: 15, fontWeight: 800, color: C.orange, wordBreak: "break-all", lineHeight: 1.3 }}>
                                {g.parent}
                              </Typography>
                              <Box sx={{ pl: "11px", ml: "1px", mt: "3px", borderLeft: `2px solid ${C.orangeBorder}` }}>
                                {g.skus.map((sku) => (
                                  <Typography key={sku} sx={{ fontSize: 13, color: C.gray600, fontFamily: "monospace", wordBreak: "break-all", lineHeight: 1.5 }}>
                                    {sku}
                                  </Typography>
                                ))}
                              </Box>
                            </>
                          ) : (
                            <Typography sx={{ fontSize: 14, fontWeight: 700, color: C.gray800, fontFamily: "monospace", wordBreak: "break-all", lineHeight: 1.3 }}>
                              {g.skus[0]}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell align="right">{g.count}</TableCell>
                        <TableCell align="right">
                          <Tooltip title={canDownloadSubsets ? "Download just this group's labels, sorted" : "Not available for this batch"}>
                            <span>
                              <IconButton size="small" disabled={!canDownloadSubsets || extracting === key}
                                onClick={() => downloadGroup(g)}>
                                <DownloadIcon fontSize="inherit" />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Box>
          </Panel>

          <Paper elevation={0} sx={{ border: `1px solid ${C.border}`, borderRadius: "12px", overflow: "hidden" }}>
            <Box sx={{ p: "12px 16px", borderBottom: `1px solid ${C.gray100}`, display: "flex", alignItems: "center",
                       gap: "12px", flexWrap: "wrap" }}>
              <Typography sx={{ fontWeight: 700, fontSize: 13, color: C.gray800 }}>
                Every label in this batch ({filteredDetails.length}{filteredDetails.length !== pageDetails.length ? ` of ${pageDetails.length}` : ""})
              </Typography>
              <TextField size="small" placeholder="Search AWB or order ID" value={awbSearch}
                onChange={(e) => setAwbSearch(e.target.value)}
                sx={{ ml: "auto", minWidth: 220, "& input": { fontSize: 13, py: "7px" } }} />
            </Box>
            <Box sx={{ overflowX: "auto", maxHeight: 420 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Page</TableCell>
                    <TableCell>SKU</TableCell>
                    <TableCell>Order ID</TableCell>
                    <TableCell>AWB</TableCell>
                    <TableCell>Courier</TableCell>
                    <TableCell>Business</TableCell>
                    <TableCell align="right">Download</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredDetails.length === 0 ? (
                    <TableRow><TableCell colSpan={7} align="center" sx={{ color: C.gray400, py: 4 }}>No labels found.</TableCell></TableRow>
                  ) : filteredDetails.map((pd) => {
                    const rowKey = `awb-${pd.sortedIndex}`;
                    return (
                      <TableRow key={`${pd.page}-${pd.sortedIndex}`}>
                        <TableCell>{pd.page}</TableCell>
                        <TableCell sx={{ fontFamily: "monospace" }}>{pd.sku || "—"}</TableCell>
                        <TableCell>{pd.order_id || "—"}</TableCell>
                        <TableCell sx={{ fontFamily: "monospace" }}>{pd.awb || "—"}</TableCell>
                        <TableCell>{pd.courier || "—"}</TableCell>
                        <TableCell>{pd.business_name || ""}</TableCell>
                        <TableCell align="right">
                          <Tooltip title={canDownloadSubsets ? "Download just this one label" : "Not available for this batch"}>
                            <span>
                              <IconButton size="small" disabled={!canDownloadSubsets || extracting === rowKey}
                                onClick={() => downloadSingle(pd)}>
                                <DownloadIcon fontSize="inherit" />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Box>
          </Paper>
        </>
      )}
    </Box>
  );
}
