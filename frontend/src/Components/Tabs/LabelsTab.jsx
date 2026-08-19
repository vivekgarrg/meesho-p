import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert, Box, Button, Chip, Collapse, IconButton, LinearProgress,
  Paper, Table, TableBody, TableCell, TableHead, TableRow,
  TextField, Tooltip, Typography,
} from "@mui/material";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import BlockIcon from "@mui/icons-material/Block";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import DownloadIcon from "@mui/icons-material/Download";
import CloseIcon from "@mui/icons-material/Close";
import Inventory2Icon from "@mui/icons-material/Inventory2";
import { C, API, fmt, useIsMobile } from "../../App";
import { useDateFilter } from "../../contexts/DateFilterContext";
import { ParentSkuCell } from "./ParentLinkInline";

/*
 * LABELS
 *
 * Three views, one job each, so nothing competes for attention:
 *
 *   Batch      the bench workflow — upload a PDF, check it, pack it
 *   Labels     every label as a searchable, sortable list
 *   Customers  who ordered, matched on name + full address, with history
 *
 * Design rules applied here:
 *  · One primary action per screen. The Batch view has exactly one: upload.
 *  · Progressive disclosure. A batch leads with its pack queue; the product
 *    and per-label breakdowns stay collapsed until asked for.
 *  · Numbers that only matter when they're wrong (page-vs-label coverage,
 *    multi-qty orders, blocked customers) appear only when they're wrong.
 *  · Parent and variant SKU are always visually distinct, never merged.
 *
 * No backend behaviour changes: the same endpoints are called with the same
 * parameters as before.
 */

// ── Batch persistence (unchanged storage contract) ───────────────────────────
const LS_PREFIX = "labels_parse_";

function saveParseResult(date, fileName, result) {
  try {
    localStorage.setItem(LS_PREFIX + date, JSON.stringify({ fileName, result, savedAt: Date.now() }));
  } catch { /* quota — the batch just won't be restored after a reload */ }
}

function loadParseResult(date) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + date);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

const todayISO = () => new Date().toISOString().slice(0, 10);

function daysAgo(iso) {
  const ms = new Date(todayISO()).getTime() - new Date(iso).getTime();
  return Math.round(ms / 86400000);
}

function downloadCroppedPDF(b64, fileName) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `labels_only_${(fileName || "labels").replace(/\.pdf$/i, "")}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// A courier should be recognisable without reading.
const COURIER_COLORS = {
  "valmo":       { bg: "#EEF2FF", fg: "#4338CA" },
  "shadowfax":   { bg: "#FEF3C7", fg: "#B45309" },
  "delhivery":   { bg: "#FCE7F3", fg: "#BE185D" },
  "xpress bees": { bg: "#DBEAFE", fg: "#1D4ED8" },
  "xpressbees":  { bg: "#DBEAFE", fg: "#1D4ED8" },
  "ecom express":{ bg: "#D1FAE5", fg: "#047857" },
  "pocketship":  { bg: "#EDE9FE", fg: "#6D28D9" },
};

const courierStyle = (name) =>
  COURIER_COLORS[(name || "").trim().toLowerCase()] || { bg: C.gray100, fg: C.gray600 };

const STATUS_STYLE = {
  DELIVERED: { bg: C.greenLight, fg: C.green },
  RETURN:    { bg: C.redLight,   fg: C.red },
  RETURNED:  { bg: C.redLight,   fg: C.red },
  RTO:       { bg: C.amberLight, fg: C.amber },
  CANCELLED: { bg: C.gray100,    fg: C.gray500 },
  PENDING:   { bg: C.gray100,    fg: C.gray400 },
};

function StatusChip({ status }) {
  const raw = (status || "PENDING").toString();
  const st = STATUS_STYLE[raw.toUpperCase()] || { bg: C.blueLight, fg: C.blue };
  const label = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  return <Chip label={label} size="small"
    sx={{ height: 20, fontSize: 10, fontWeight: 700, bgcolor: st.bg, color: st.fg }} />;
}

// ── Shared primitives ────────────────────────────────────────────────────────

/** A number that earns its place: label, value, optional hint. Nothing else. */
function Stat({ label, value, tone = C.gray800, hint }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{ fontSize: 10, fontWeight: 700, color: C.gray400, letterSpacing: "0.07em", textTransform: "uppercase" }}>
        {label}
      </Typography>
      <Typography sx={{ fontFamily: "monospace", fontWeight: 800, fontSize: 21, color: tone, lineHeight: 1.15 }}>
        {value}
      </Typography>
      {hint && (
        <Typography sx={{ fontSize: 11, color: C.gray400, maxWidth: 190, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {hint}
        </Typography>
      )}
    </Box>
  );
}

/** Collapsible panel — the mechanism that keeps detail out of the way. */
function Panel({ title, count, hint, defaultOpen = false, right, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Paper elevation={0} sx={{ border: `1px solid ${C.border}`, borderRadius: "12px", overflow: "hidden" }}>
      <Box onClick={() => setOpen(o => !o)}
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

// The labels table is read at arm's length while packing, off a screen on a
// bench — 10px headers and 11px body text were being squinted at. Everything in
// the table steps up, and rows get more vertical room so the two-line
// parent/variant cell doesn't feel crushed.
const thSx = {
  fontSize: 12, fontWeight: 700, color: C.gray500, textTransform: "uppercase",
  letterSpacing: "0.05em", whiteSpace: "nowrap", bgcolor: C.gray50, py: "11px",
};

/** Body-cell defaults for the labels table. */
const tdSx = { fontSize: 14, py: "11px", color: C.gray800 };

function SortTh({ label, field, sort, setSort, align = "left" }) {
  const active = sort === field || sort === `-${field}`;
  const desc = sort === `-${field}`;
  return (
    <TableCell onClick={() => setSort(active && !desc ? `-${field}` : field)}
      sx={{ ...thSx, textAlign: align, cursor: "pointer", color: active ? C.orange : C.gray400,
            "&:hover": { color: C.orange } }}>
      {label}{active ? (desc ? " ↓" : " ↑") : ""}
    </TableCell>
  );
}

// ── Parent / SKU ─────────────────────────────────────────────────────────────
// ParentLinkInline / ParentSkuCell now live in ./ParentLinkInline, shared with
// BulkLabelsTab so both tabs offer the same inline "link this SKU to a
// parent" control instead of Bulk Labels lacking it entirely.

// ══════════════════════════════════════════════════════════════════════════════
// PACK — the hero of the Batch view
// ══════════════════════════════════════════════════════════════════════════════
function PackPanel({ orders, onToggle, onMarkAll }) {
  const [scan, setScan] = useState("");
  const [flash, setFlash] = useState(null);
  const [showDone, setShowDone] = useState(false);
  const scanRef = useRef(null);

  const packed = orders.filter(o => o.is_packed);
  const pending = orders.filter(o => !o.is_packed);
  const pct = orders.length ? Math.round((packed.length / orders.length) * 100) : 0;
  const done = pending.length === 0;

  // Grouped by product: you pack one product at a time, not one order at a time.
  const groups = useMemo(() => {
    const m = {};
    pending.forEach(o => {
      const k = o.sku || "—";
      (m[k] = m[k] || { sku: k, orders: [] }).orders.push(o);
    });
    return Object.values(m).sort((a, b) => b.orders.length - a.orders.length);
  }, [pending]);

  const submitScan = async () => {
    const v = scan.trim();
    if (!v) return;
    const hit = orders.find(o =>
      String(o.order_id) === v || String(o.order_id).endsWith(v) ||
      (o.awb_number && String(o.awb_number) === v));
    if (!hit) setFlash({ t: "err", m: `Nothing in this batch matches “${v}”` });
    else if (hit.is_packed) setFlash({ t: "warn", m: `${hit.sku || hit.order_id} already packed` });
    else {
      await onToggle(hit.order_id);
      setFlash({ t: "ok", m: `Packed ${hit.sku || hit.order_id}` });
      navigator.vibrate?.(40);
    }
    setScan("");
    setTimeout(() => scanRef.current?.focus(), 0);
  };

  return (
    <Paper elevation={0} sx={{ borderRadius: "12px", overflow: "hidden",
                               border: `1px solid ${done ? C.greenBorder : C.orangeBorder}` }}>
      <Box sx={{ px: "18px", pt: "16px", pb: "12px", bgcolor: done ? C.greenLight : C.orangeLight }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", mb: "10px" }}>
          <Inventory2Icon sx={{ fontSize: 20, color: done ? C.green : C.orange }} />
          <Typography sx={{ fontSize: 14, fontWeight: 800, color: done ? C.green : C.orange }}>
            {done ? "Batch packed" : "Pack this batch"}
          </Typography>
          <Typography sx={{ fontSize: 24, fontWeight: 800, fontFamily: "monospace", color: done ? C.green : C.gray800, lineHeight: 1 }}>
            {packed.length}<span style={{ color: C.gray400, fontSize: 16 }}>/{orders.length}</span>
          </Typography>
          {!done && <Typography sx={{ fontSize: 12, color: C.gray500 }}>{pending.length} left</Typography>}
          {!done && (
            <Button size="small" onClick={onMarkAll}
              sx={{ ml: "auto", textTransform: "none", fontWeight: 700, fontSize: 12, color: "#fff",
                    bgcolor: C.green, px: "14px", "&:hover": { bgcolor: C.green, filter: "brightness(0.94)" } }}>
              Pack all
            </Button>
          )}
        </Box>
        <LinearProgress variant="determinate" value={pct}
          sx={{ height: 8, borderRadius: 4, bgcolor: "rgba(0,0,0,0.07)",
                "& .MuiLinearProgress-bar": { bgcolor: done ? C.green : C.orange, borderRadius: 4 } }} />
      </Box>

      {!done && (
        <>
          <Box sx={{ p: "14px 18px", borderBottom: `1px solid ${C.gray100}` }}>
            <Box sx={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <TextField inputRef={scanRef} autoFocus value={scan}
                onChange={(e) => setScan(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitScan(); }}
                placeholder="Scan sub-order or AWB, then Enter"
                sx={{ flex: "1 1 220px", "& input": { fontSize: 16, fontFamily: "monospace", fontWeight: 700, py: "10px" } }} />
              <Button onClick={submitScan} disabled={!scan.trim()}
                sx={{ textTransform: "none", fontWeight: 700, fontSize: 14, px: "18px", color: "#fff", bgcolor: C.orange,
                      "&:hover": { bgcolor: C.orange, filter: "brightness(0.94)" },
                      "&.Mui-disabled": { bgcolor: C.gray300, color: "#fff" } }}>
                Pack
              </Button>
            </Box>
            {flash && (
              <Typography sx={{ mt: "8px", fontSize: 12, fontWeight: 700,
                                color: flash.t === "ok" ? C.green : flash.t === "warn" ? C.amber : C.red }}>
                {flash.t === "ok" ? "✓" : flash.t === "warn" ? "!" : "✕"} {flash.m}
              </Typography>
            )}
          </Box>

          <Box sx={{ p: "12px 18px", display: "flex", flexDirection: "column", gap: "10px" }}>
            {groups.map(g => (
              <Box key={g.sku} sx={{ border: `1px solid ${C.border}`, borderRadius: "10px", overflow: "hidden" }}>
                <Box sx={{ px: "12px", py: "8px", bgcolor: C.gray50, display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <Typography sx={{ fontSize: 12, fontWeight: 800, fontFamily: "monospace", color: C.gray800, wordBreak: "break-all" }}>
                    {g.sku}
                  </Typography>
                  <Chip label={g.orders.length} size="small"
                    sx={{ height: 18, fontSize: 10, fontWeight: 700, bgcolor: C.orangeLight, color: C.orange }} />
                  <Button size="small" onClick={() => g.orders.forEach(o => onToggle(o.order_id))}
                    sx={{ ml: "auto", fontSize: 11, textTransform: "none", fontWeight: 700, color: C.green }}>
                    Pack all {g.orders.length}
                  </Button>
                </Box>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: "6px", p: "10px 12px" }}>
                  {g.orders.map(o => (
                    <Button key={o.order_id} onClick={() => onToggle(o.order_id)}
                      sx={{ textTransform: "none", fontFamily: "monospace", fontSize: 12, fontWeight: 700,
                            px: "10px", py: "7px", minWidth: 0, borderRadius: "8px",
                            border: `1px solid ${C.gray300}`, color: C.gray700, bgcolor: "#fff",
                            "&:hover": { bgcolor: C.greenLight, borderColor: C.greenBorder, color: C.green } }}>
                      …{String(o.order_id).slice(-8)}{o.qty > 1 ? ` ×${o.qty}` : ""}
                    </Button>
                  ))}
                </Box>
              </Box>
            ))}
          </Box>
        </>
      )}

      {packed.length > 0 && (
        <Box sx={{ borderTop: `1px solid ${C.gray100}` }}>
          <Button onClick={() => setShowDone(v => !v)} fullWidth
            sx={{ justifyContent: "flex-start", textTransform: "none", fontSize: 12, fontWeight: 700,
                  color: C.gray500, py: "8px", px: "18px" }}>
            {showDone ? "Hide" : "Show"} {packed.length} packed
          </Button>
          <Collapse in={showDone} unmountOnExit>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: "6px", px: "18px", pb: "14px" }}>
              {packed.map(o => (
                <Button key={o.order_id} onClick={() => onToggle(o.order_id)} title="Tap to un-pack"
                  sx={{ textTransform: "none", fontFamily: "monospace", fontSize: 11, fontWeight: 700,
                        px: "9px", py: "5px", minWidth: 0, borderRadius: "8px",
                        border: `1px solid ${C.greenBorder}`, color: C.green, bgcolor: C.greenLight }}>
                  ✓ …{String(o.order_id).slice(-8)}
                </Button>
              ))}
            </Box>
          </Collapse>
        </Box>
      )}
    </Paper>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// BATCH VIEW
// ══════════════════════════════════════════════════════════════════════════════
function BatchView({
  batchDate, setBatchDate, result, fileName, loading, error, onPickFile, onReset, packedCount, pendingCount, onGoPack,
}) {
  const isMobile = useIsMobile();
  const [skuSearch, setSkuSearch] = useState("");
  const back = daysAgo(batchDate);

  // Parents linked from inside this view. `result` is the stored parse output, so
  // it can't know about a link made after the PDF was processed — without this,
  // linking a SKU here would appear to do nothing until the batch was re-parsed.
  const [parentOverride, setParentOverride] = useState({});
  const onParentAdded = useCallback(
    (sku, parentId) => setParentOverride((o) => ({ ...o, [sku]: parentId })), []);

  // Group SKUs under their parent so the dispatch list reads by product family.
  const skuGroups = useMemo(() => {
    const withParents = (result?.sku_table || []).map(r =>
      parentOverride[r.sku] ? { ...r, parent_sku: parentOverride[r.sku] } : r);
    const rows = withParents.filter(r =>
      !skuSearch ||
      (r.sku || "").toLowerCase().includes(skuSearch.toLowerCase()) ||
      (r.parent_sku || "").toLowerCase().includes(skuSearch.toLowerCase()));
    const m = {};
    rows.forEach(r => {
      const linked = r.parent_sku && r.parent_sku !== r.sku;
      const key = linked ? r.parent_sku : `__${r.sku}`;
      (m[key] = m[key] || { parent: linked ? r.parent_sku : null, children: [] }).children.push(r);
    });
    return Object.values(m).sort((a, b) =>
      b.children.reduce((s, r) => s + r.count, 0) - a.children.reduce((s, r) => s + r.count, 0));
  }, [result, skuSearch, parentOverride]);

  const pages = result?.total_pages ?? 0;
  const labels = result?.total_labels ?? 0;
  const missing = pages - labels;
  const blocked = result?.blocked_customers_found || [];
  const multiQty = (result?.sku_table || []).reduce((s, r) => s + (r.high_qty_orders || 0), 0);
  const units = (result?.sku_table || []).reduce((s, r) => s + (r.total_qty || 0), 0);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: "14px" }}>

      {/* Action bar — batch date, and the single primary action */}
      <Paper elevation={0} sx={{ border: `1px solid ${C.border}`, borderRadius: "12px", p: "14px 16px" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: 10, fontWeight: 700, color: C.gray400, letterSpacing: "0.07em", textTransform: "uppercase" }}>
              Batch date
            </Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: "8px", mt: "3px" }}>
              <TextField type="date" size="small" value={batchDate}
                onChange={(e) => setBatchDate(e.target.value || todayISO())}
                sx={{ "& input": { fontSize: 13, py: "6px", fontFamily: "monospace" } }} />
              {back > 0 && (
                <Chip label={`${back}d back-dated`} size="small"
                  sx={{ height: 20, fontSize: 10, fontWeight: 700, bgcolor: C.amberLight, color: C.amber }} />
              )}
            </Box>
          </Box>

          <Box sx={{ ml: isMobile ? 0 : "auto", display: "flex", gap: "8px", flexWrap: "wrap",
                     width: isMobile ? "100%" : "auto" }}>
            <Button onClick={onPickFile} disabled={loading}
              sx={{ textTransform: "none", fontWeight: 800, fontSize: 14, px: "22px", py: "10px",
                    color: "#fff", bgcolor: C.orange, borderRadius: "10px",
                    boxShadow: "0 3px 12px rgba(109,40,217,0.28)", flex: isMobile ? 1 : "none",
                    "&:hover": { bgcolor: C.orange, filter: "brightness(0.94)" },
                    "&.Mui-disabled": { bgcolor: C.gray300, color: "#fff" } }}>
              <UploadFileIcon sx={{ fontSize: 18, mr: "6px" }} />
              {loading ? "Parsing…" : result ? "Upload another PDF" : "Upload labels PDF"}
            </Button>
            {result?.cropped_pdf_b64 && (
              <Tooltip title="Labels only — the invoice half cropped off, ready to print">
                <Button onClick={() => downloadCroppedPDF(result.cropped_pdf_b64, fileName)}
                  sx={{ textTransform: "none", fontWeight: 700, fontSize: 13, color: C.green,
                        border: `1px solid ${C.greenBorder}`, bgcolor: C.greenLight, borderRadius: "10px", px: "14px" }}>
                  <DownloadIcon sx={{ fontSize: 17, mr: "5px" }} />Cropped PDF
                </Button>
              </Tooltip>
            )}
          </Box>
        </Box>
      </Paper>

      {error && <Alert severity="error" sx={{ borderRadius: "10px" }}>{error}</Alert>}

      {loading && (
        <Paper elevation={0} sx={{ border: `1px solid ${C.border}`, borderRadius: "12px", p: "34px", textAlign: "center" }}>
          <LinearProgress sx={{ mb: "14px", borderRadius: 3 }} />
          <Typography sx={{ fontSize: 14, fontWeight: 700, color: C.gray700 }}>Reading {fileName}</Typography>
          <Typography sx={{ fontSize: 12, color: C.gray400, mt: "3px" }}>One label per page — a large batch takes a few seconds</Typography>
        </Paper>
      )}

      {/* Empty state — one instruction, one action */}
      {!result && !loading && (
        <Paper elevation={0} onClick={onPickFile}
          sx={{ border: `2px dashed ${C.gray200}`, borderRadius: "14px", p: "48px 24px",
                textAlign: "center", cursor: "pointer", bgcolor: C.gray50,
                "&:hover": { borderColor: C.orange, bgcolor: C.orangeLight } }}>
          <UploadFileIcon sx={{ fontSize: 40, color: C.gray300 }} />
          <Typography sx={{ fontSize: 15, fontWeight: 700, color: C.gray700, mt: "8px" }}>
            Upload the Meesho labels PDF
          </Typography>
          <Typography sx={{ fontSize: 12, color: C.gray400, mt: "4px" }}>
            Nothing recorded for {batchDate} yet
          </Typography>
        </Paper>
      )}

      {result && !loading && (
        <>
          {/* Only-when-wrong alerts */}
          {blocked.length > 0 && (
            <Alert severity="error" sx={{ borderRadius: "10px" }}>
              <Typography sx={{ fontSize: 13, fontWeight: 800, mb: "4px" }}>
                {blocked.length} blocked customer{blocked.length > 1 ? "s" : ""} in this batch — do not ship
              </Typography>
              {blocked.map((b, i) => (
                <Typography key={i} sx={{ fontSize: 12 }}>
                  <strong>{b.customer_name}</strong>
                  {b.customer_pincode ? ` · ${b.customer_pincode}` : ""}
                  {b.sku ? ` · ${b.sku}` : ""}
                </Typography>
              ))}
            </Alert>
          )}
          {missing > 0 && (
            <Alert severity="warning" sx={{ borderRadius: "10px", fontSize: 13 }}>
              {missing} of {pages} pages had no readable order — {labels} labels captured.
            </Alert>
          )}

          {/* One tray of labels can cover several businesses. Say where they went,
              rather than silently filing another business's parcels here. */}
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
                you have selected. Rename one side's SKU to split them properly.
              </Typography>
            </Alert>
          )}

          {/* Slim stat strip — facts, not cards competing for attention */}
          <Paper elevation={0} sx={{ border: `1px solid ${C.border}`, borderRadius: "12px", p: "14px 18px" }}>
            <Box sx={{ display: "flex", gap: "30px", flexWrap: "wrap", alignItems: "flex-start" }}>
              <Stat label="Labels" value={labels} tone={C.orange} hint={fileName || undefined} />
              <Stat label="Products" value={result.total_unique_skus ?? (result.sku_table || []).length} />
              <Stat label="Units" value={units} />
              {multiQty > 0 && <Stat label="Multi-qty" value={multiQty} tone={C.amber} hint="check before packing" />}
              <Box sx={{ ml: "auto" }}>
                <Button size="small" onClick={onReset} sx={{ fontSize: 12, textTransform: "none", color: C.gray500 }}>
                  Clear batch
                </Button>
              </Box>
            </Box>
          </Paper>

          {/* Packing lives in its own tab; point at it rather than duplicating it. */}
          {pendingCount + packedCount > 0 && (
            <Paper elevation={0} onClick={onGoPack}
              sx={{ border: `1px solid ${pendingCount ? C.orangeBorder : C.greenBorder}`, borderRadius: "12px",
                    p: "14px 18px", cursor: "pointer", bgcolor: pendingCount ? C.orangeLight : C.greenLight,
                    display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap",
                    "&:hover": { filter: "brightness(0.98)" } }}>
              <Inventory2Icon sx={{ fontSize: 20, color: pendingCount ? C.orange : C.green }} />
              <Typography sx={{ fontSize: 13, fontWeight: 800, color: pendingCount ? C.orange : C.green }}>
                {pendingCount ? `${pendingCount} of ${pendingCount + packedCount} still to pack` : "Everything packed"}
              </Typography>
              <Typography sx={{ fontSize: 12, color: C.gray500, ml: "auto" }}>
                Open the Pack tab →
              </Typography>
            </Paper>
          )}

          {/* Detail, collapsed until wanted */}
          <Panel title="Products in this batch" count={skuGroups.length} hint="grouped by parent"
            right={
              <TextField size="small" value={skuSearch} onChange={(e) => setSkuSearch(e.target.value)}
                placeholder="Search SKU / parent"
                sx={{ width: 180, "& input": { fontSize: 12, py: "6px" } }} />
            }>
            <Box sx={{ overflowX: "auto" }}>
              <Table size="small" sx={{ minWidth: 520 }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={thSx}>Parent / SKU</TableCell>
                    <TableCell sx={{ ...thSx, textAlign: "right" }}>Labels</TableCell>
                    <TableCell sx={{ ...thSx, textAlign: "right" }}>Units</TableCell>
                    <TableCell sx={{ ...thSx, textAlign: "right" }}>Max qty</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {skuGroups.map((g, gi) => {
                    const nLabels = g.children.reduce((s, r) => s + r.count, 0);
                    const nUnits = g.children.reduce((s, r) => s + r.total_qty, 0);
                    const maxQ = g.children.reduce((s, r) => Math.max(s, r.max_qty || 0), 0);
                    return (
                      <TableRow key={g.parent || g.children[0].sku} sx={{ bgcolor: gi % 2 ? C.gray50 : "#fff" }}>
                        <TableCell sx={tdSx}>
                          {g.parent ? (
                            <>
                              <Typography sx={{ fontSize: 15, fontWeight: 800, color: C.orange, wordBreak: "break-all", lineHeight: 1.3 }}>
                                {g.parent}
                              </Typography>
                              {/* Children hang off a rule rather than an arrow glyph:
                                  with several variants the arrows read as noise, a
                                  rule reads as one family. */}
                              <Box sx={{ pl: "11px", ml: "1px", mt: "3px", borderLeft: `2px solid ${C.orangeBorder}` }}>
                                {g.children.map(ch => (
                                  <Typography key={ch.sku} sx={{ fontSize: 13, color: C.gray600, fontFamily: "monospace", wordBreak: "break-all", lineHeight: 1.5 }}>
                                    {ch.sku} <span style={{ color: C.gray400, fontWeight: 700 }}>×{ch.count}</span>
                                  </Typography>
                                ))}
                              </Box>
                            </>
                          ) : (
                            <ParentSkuCell sku={g.children[0].sku} parentSku={null}
                              onParentAdded={onParentAdded} />
                          )}
                        </TableCell>
                        <TableCell sx={{ ...tdSx, textAlign: "right", fontFamily: "monospace", fontWeight: 800, fontSize: 17 }}>{nLabels}</TableCell>
                        <TableCell sx={{ ...tdSx, textAlign: "right", fontFamily: "monospace", fontSize: 15 }}>{nUnits}</TableCell>
                        <TableCell sx={{ ...tdSx, textAlign: "right", fontFamily: "monospace", fontSize: 15,
                                         color: maxQ > 1 ? C.amber : C.gray400, fontWeight: maxQ > 1 ? 800 : 400 }}>
                          {maxQ}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {skuGroups.length === 0 && (
                    <TableRow><TableCell colSpan={4} sx={{ textAlign: "center", py: "24px", color: C.gray400, fontSize: 13 }}>
                      No products match that search.
                    </TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </Box>
          </Panel>

          <Panel title="Every label in this batch" count={(result.page_details || []).length} hint="page by page">
            <Box sx={{ overflowX: "auto" }}>
              <Table size="small" sx={{ minWidth: 720 }}>
                <TableHead>
                  <TableRow>
                    {["Page", "Sub-order", "SKU", "Qty", "Courier", "Customer", "City"].map(h => (
                      <TableCell key={h} sx={thSx}>{h}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(result.page_details || []).map((p, i) => (
                    <TableRow key={`${p.page}-${i}`} sx={{ bgcolor: i % 2 ? C.gray50 : "#fff" }}>
                      <TableCell sx={{ fontSize: 11, color: C.gray400, fontFamily: "monospace" }}>{p.page}</TableCell>
                      <TableCell sx={{ fontSize: 10, fontFamily: "monospace", color: C.gray500 }}>{p.order_id || "—"}</TableCell>
                      <TableCell sx={{ fontSize: 11, fontFamily: "monospace", fontWeight: 700 }}>{p.sku || "—"}</TableCell>
                      <TableCell sx={{ fontSize: 11, fontFamily: "monospace", fontWeight: 800,
                                       color: (p.qty || 1) > 1 ? C.amber : C.gray700 }}>{p.qty || 1}</TableCell>
                      <TableCell sx={{ fontSize: 11 }}>{p.courier || "—"}</TableCell>
                      <TableCell sx={{ fontSize: 11, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {p.customer_name || "—"}
                      </TableCell>
                      <TableCell sx={{ fontSize: 11, color: C.gray500 }}>{p.customer_city || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </Panel>
        </>
      )}
    </Box>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// PACK VIEW — the packing bench, on its own so nothing else competes with it
// ══════════════════════════════════════════════════════════════════════════════
function PackView({ batchDate, setBatchDate, orders, fileName, onToggle, onMarkAll, onGoBatch }) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {/* Which batch am I packing? Changeable here so a previous day can be
          finished without hopping tabs. */}
      <Paper elevation={0} sx={{ border: `1px solid ${C.border}`, borderRadius: "12px", p: "14px 16px" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
          <Box>
            <Typography sx={{ fontSize: 10, fontWeight: 700, color: C.gray400, letterSpacing: "0.07em", textTransform: "uppercase" }}>
              Packing batch
            </Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: "8px", mt: "3px" }}>
              <TextField type="date" size="small" value={batchDate}
                onChange={(e) => setBatchDate(e.target.value || todayISO())}
                sx={{ "& input": { fontSize: 13, py: "6px", fontFamily: "monospace" } }} />
              {fileName && (
                <Typography sx={{ fontSize: 11, color: C.gray400, maxWidth: 220, overflow: "hidden",
                                  textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {fileName}
                </Typography>
              )}
            </Box>
          </Box>
        </Box>
      </Paper>

      {orders.length === 0 ? (
        <Paper elevation={0} sx={{ border: `1px solid ${C.border}`, borderRadius: "12px", p: "44px 24px", textAlign: "center" }}>
          <Inventory2Icon sx={{ fontSize: 38, color: C.gray300 }} />
          <Typography sx={{ fontSize: 15, fontWeight: 700, color: C.gray700, mt: "8px" }}>
            Nothing to pack for {batchDate}
          </Typography>
          <Typography sx={{ fontSize: 12, color: C.gray400, mt: "4px" }}>
            Upload that day's labels PDF first, or pick another date above.
          </Typography>
          <Button onClick={onGoBatch}
            sx={{ mt: "16px", textTransform: "none", fontWeight: 700, fontSize: 13, color: "#fff",
                  bgcolor: C.orange, px: "20px", py: "9px", borderRadius: "10px",
                  "&:hover": { bgcolor: C.orange, filter: "brightness(0.94)" } }}>
            Go to Batch
          </Button>
        </Paper>
      ) : (
        <PackPanel orders={orders} onToggle={onToggle} onMarkAll={onMarkAll} />
      )}
    </Box>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// LABELS VIEW
// ══════════════════════════════════════════════════════════════════════════════
const SORTS = [
  ["-date", "Newest"], ["date", "Oldest"], ["courier", "Courier"],
  ["sku", "SKU"], ["-qty", "Qty"], ["name", "Customer"],
];

function LabelsView({ onViewCustomer }) {
  const { range, label: periodLabel } = useDateFilter();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState("-date");
  const [q, setQ] = useState("");
  const [courier, setCourier] = useState("");
  const [allCouriers, setAllCouriers] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams({ page_size: 1000, sort });
    if (range?.date_from) p.set("date_from", range.date_from);
    if (range?.date_to) p.set("date_to", range.date_to);
    if (q.trim()) p.set("q", q.trim());
    if (courier) p.set("courier", courier);
    try {
      const r = await fetch(`${API}/labels/orders/?${p}`);
      if (r.ok) {
        const data = (await r.json()).results || [];
        setRows(data);
        // Keep the courier list stable — it must not shrink to whatever the
        // current filter happens to return.
        if (!courier && !q.trim()) {
          setAllCouriers([...new Set(data.map(d => d.courier_name).filter(Boolean))].sort());
        }
      }
    } finally { setLoading(false); }
  }, [sort, q, courier, JSON.stringify(range)]); // eslint-disable-line

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);   // debounce typing only
    return () => clearTimeout(t);
  }, [load]); // eslint-disable-line

  const noParent = rows.filter(r => !r.parent_sku).length;
  const onParentAdded = (sku, parentId) =>
    setRows(prev => prev.map(r => (r.sku === sku ? { ...r, parent_sku: parentId } : r)));

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <Paper elevation={0} sx={{ border: `1px solid ${C.border}`, borderRadius: "12px", p: "12px 16px" }}>
        <Box sx={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          <TextField size="small" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search sub-order, AWB, SKU, customer, pincode"
            sx={{ flex: "1 1 250px", "& input": { fontSize: 13, py: "7px" } }} />
          <TextField select size="small" value={courier} onChange={(e) => setCourier(e.target.value)}
            slotProps={{ select: { native: true } }} sx={{ minWidth: 130, "& select": { fontSize: 13, py: "7px" } }}>
            <option value="">All couriers</option>
            {allCouriers.map(c => <option key={c} value={c}>{c}</option>)}
          </TextField>
          <Box sx={{ display: "flex", gap: "3px", bgcolor: C.gray100, borderRadius: "8px", p: "3px" }}>
            {SORTS.map(([id, label]) => (
              <Button key={id} size="small" onClick={() => setSort(id)}
                sx={{ px: "10px", py: "4px", minWidth: 0, fontSize: 11, textTransform: "none", borderRadius: "6px",
                      fontWeight: sort === id ? 800 : 500,
                      bgcolor: sort === id ? "#fff" : "transparent",
                      color: sort === id ? C.orange : C.gray500,
                      boxShadow: sort === id ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                      "&:hover": { bgcolor: sort === id ? "#fff" : "transparent" } }}>
                {label}
              </Button>
            ))}
          </Box>
        </Box>
        <Box sx={{ display: "flex", gap: "16px", mt: "10px", flexWrap: "wrap" }}>
          <Typography sx={{ fontSize: 12, color: C.gray500 }}>
            <strong style={{ color: C.gray800 }}>{rows.length}</strong> labels · {periodLabel}
          </Typography>
          {noParent > 0 && (
            <Typography sx={{ fontSize: 12, color: C.amber, fontWeight: 700 }}>
              {noParent} without a parent SKU
            </Typography>
          )}
          <Typography sx={{ fontSize: 12, color: C.gray400 }}>Tap a row for that customer's history</Typography>
        </Box>
      </Paper>

      {loading ? (
        <Box sx={{ p: "36px" }}><LinearProgress /></Box>
      ) : rows.length === 0 ? (
        <Paper elevation={0} sx={{ border: `1px solid ${C.border}`, borderRadius: "12px", p: "40px", textAlign: "center" }}>
          <Typography sx={{ fontSize: 13, color: C.gray400 }}>No labels for this period or search.</Typography>
        </Paper>
      ) : (
        <Paper elevation={0} sx={{ border: `1px solid ${C.border}`, borderRadius: "12px", overflow: "hidden" }}>
          <Box sx={{ overflowX: "auto" }}>
            <Table size="small" sx={{ minWidth: 860 }}>
              <TableHead>
                <TableRow>
                  <SortTh label="Date" field="date" sort={sort} setSort={setSort} />
                  <SortTh label="Courier" field="courier" sort={sort} setSort={setSort} />
                  <SortTh label="Parent / SKU" field="sku" sort={sort} setSort={setSort} />
                  <SortTh label="Qty" field="qty" sort={sort} setSort={setSort} align="right" />
                  <SortTh label="Customer" field="name" sort={sort} setSort={setSort} />
                  <TableCell sx={thSx}>Sub-order / AWB</TableCell>
                  <TableCell sx={thSx}>Pay</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((o, i) => {
                  const cst = courierStyle(o.courier_name);
                  return (
                    <TableRow key={o.order_id} hover
                      onClick={() => onViewCustomer({ name: o.customer_name, pincode: o.customer_pincode, address: o.customer_address })}
                      sx={{ cursor: "pointer", bgcolor: i % 2 ? C.gray50 : "#fff" }}>
                      <TableCell sx={{ ...tdSx, fontSize: 13, color: C.gray500, whiteSpace: "nowrap", fontFamily: "monospace" }}>
                        {o.uploaded_date || "—"}
                      </TableCell>
                      <TableCell sx={tdSx}>
                        <Chip label={o.courier_name || "—"} size="small"
                          sx={{ height: 24, fontSize: 12, fontWeight: 700, bgcolor: cst.bg, color: cst.fg }} />
                      </TableCell>
                      <TableCell sx={{ ...tdSx, minWidth: 200 }}>
                        <ParentSkuCell sku={o.sku} parentSku={o.parent_sku} onParentAdded={onParentAdded} />
                      </TableCell>
                      <TableCell sx={{ ...tdSx, textAlign: "right", fontFamily: "monospace", fontWeight: 800, fontSize: 17,
                                       color: (o.qty || 1) > 1 ? C.amber : C.gray700 }}>
                        {o.qty || 1}
                      </TableCell>
                      <TableCell sx={{ ...tdSx, maxWidth: 180 }}>
                        <Typography sx={{ fontSize: 14, fontWeight: 700, color: C.gray800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {o.customer_name || "—"}
                          {o.is_blocked && <Chip label="blocked" size="small" sx={{ ml: "5px", height: 18, fontSize: 10, fontWeight: 700, bgcolor: C.redLight, color: C.red }} />}
                        </Typography>
                        <Typography sx={{ fontSize: 12, color: C.gray400 }}>
                          {[o.customer_city, o.customer_pincode].filter(Boolean).join(" · ") || "—"}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ ...tdSx, fontSize: 12.5, fontFamily: "monospace", color: C.gray500, whiteSpace: "nowrap", lineHeight: 1.5 }}>
                        …{String(o.order_id).slice(-12)}
                        <br />{o.awb_number || "—"}
                      </TableCell>
                      <TableCell sx={tdSx}>
                        {o.payment_type === "COD"
                          ? <Chip label="COD" size="small" sx={{ height: 22, fontSize: 11, fontWeight: 700, bgcolor: C.amberLight, color: C.amber }} />
                          : o.payment_type
                          ? <Chip label="Prepaid" size="small" sx={{ height: 22, fontSize: 11, fontWeight: 700, bgcolor: C.greenLight, color: C.green }} />
                          : <span style={{ color: C.gray300 }}>—</span>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Box>
        </Paper>
      )}
    </Box>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// CUSTOMERS VIEW
// ══════════════════════════════════════════════════════════════════════════════
function CustomersView() {
  const { range } = useDateFilter();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [minOrders, setMinOrders] = useState(2);
  const [sort, setSort] = useState("orders");
  const [open, setOpen] = useState(null);
  const [page, setPage] = useState(1);
  const PER = 25;

  const load = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams({ min_orders: String(minOrders), sort, page: String(page), page_size: String(PER) });
    if (q.trim()) p.set("q", q.trim());
    if (range?.date_from) p.set("date_from", range.date_from);
    if (range?.date_to) p.set("date_to", range.date_to);
    try {
      const r = await fetch(`${API}/labels/customers/?${p}`);
      if (r.ok) setData(await r.json());
    } finally { setLoading(false); }
  }, [minOrders, sort, page, q, JSON.stringify(range)]); // eslint-disable-line

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load]); // eslint-disable-line
  useEffect(() => { setPage(1); }, [minOrders, sort, q]);

  const blockCustomer = async (c) => {
    if (!window.confirm(`Block ${c.customer_name}?`)) return;
    await fetch(`${API}/blocked-customers/`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer_name: c.customer_name, customer_pincode: c.customer_pincode,
        customer_city: c.customer_city, customer_state: c.customer_state,
        reason: `Blocked from Labels — ${c.returned + c.rto} of ${c.order_count} orders came back`,
      }),
    });
    load();
  };

  const rows = data?.results || [];
  const pages = Math.max(1, Math.ceil((data?.total || 0) / PER));

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <Paper elevation={0} sx={{ border: `1px solid ${C.border}`, borderRadius: "12px", p: "12px 16px" }}>
        <Box sx={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          <TextField size="small" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, address, city, SKU"
            sx={{ flex: "1 1 240px", "& input": { fontSize: 13, py: "7px" } }} />
          <Box sx={{ display: "flex", gap: "3px", bgcolor: C.gray100, borderRadius: "8px", p: "3px" }}>
            {[1, 2, 3].map(n => (
              <Button key={n} size="small" onClick={() => setMinOrders(n)}
                sx={{ px: "10px", py: "4px", minWidth: 0, fontSize: 11, textTransform: "none", borderRadius: "6px",
                      fontWeight: minOrders === n ? 800 : 500,
                      bgcolor: minOrders === n ? "#fff" : "transparent",
                      color: minOrders === n ? C.orange : C.gray500,
                      "&:hover": { bgcolor: minOrders === n ? "#fff" : "transparent" } }}>
                {n}+ orders
              </Button>
            ))}
          </Box>
        </Box>
        {data && (
          <Typography sx={{ fontSize: 12, color: C.gray500, mt: "10px" }}>
            <strong style={{ color: C.gray800 }}>{data.totals.customers}</strong> customers ·{" "}
            <strong style={{ color: C.gray800 }}>{data.totals.repeat_customers}</strong> ordered more than once ·
            matched on name + full address · tap a row for full history
          </Typography>
        )}
      </Paper>

      {loading ? (
        <Box sx={{ p: "36px" }}><LinearProgress /></Box>
      ) : rows.length === 0 ? (
        <Paper elevation={0} sx={{ border: `1px solid ${C.border}`, borderRadius: "12px", p: "40px", textAlign: "center" }}>
          <Typography sx={{ fontSize: 13, color: C.gray400 }}>No customers match these filters.</Typography>
        </Paper>
      ) : (
        <Paper elevation={0} sx={{ border: `1px solid ${C.border}`, borderRadius: "12px", overflow: "hidden" }}>
          <Box sx={{ overflowX: "auto" }}>
            <Table size="small" sx={{ minWidth: 840 }}>
              <TableHead>
                <TableRow>
                  <SortTh label="Customer" field="name" sort={sort} setSort={setSort} />
                  <TableCell sx={thSx}>Address</TableCell>
                  <SortTh label="Orders" field="orders" sort={sort} setSort={setSort} align="right" />
                  <TableCell sx={{ ...thSx, textAlign: "center" }}>Outcome</TableCell>
                  <SortTh label="Return" field="return_rate" sort={sort} setSort={setSort} align="right" />
                  <TableCell sx={{ ...thSx, textAlign: "right" }}>Settlement</TableCell>
                  <SortTh label="Last" field="last" sort={sort} setSort={setSort} />
                  <TableCell sx={thSx} />
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((c, i) => {
                  const key = `${c.customer_name}|${c.customer_pincode}|${i}`;
                  const isOpen = open === key;
                  const bad = c.returned + c.rto;
                  const rate = Math.round((c.return_rate || 0) * 100);
                  return (
                    <React.Fragment key={key}>
                      <TableRow hover onClick={() => setOpen(isOpen ? null : key)}
                        sx={{ cursor: "pointer", bgcolor: isOpen ? C.orangeLight : i % 2 ? C.gray50 : "#fff" }}>
                        <TableCell sx={{ fontSize: 12, fontWeight: 700, color: C.gray800, maxWidth: 180 }}>
                          {isOpen ? <KeyboardArrowUpIcon sx={{ fontSize: 14, verticalAlign: "-2px" }} />
                                  : <KeyboardArrowDownIcon sx={{ fontSize: 14, verticalAlign: "-2px" }} />}
                          &nbsp;{c.customer_name || "—"}
                          {c.is_blocked && <Chip label="blocked" size="small" sx={{ ml: "5px", height: 15, fontSize: 8, bgcolor: C.redLight, color: C.red }} />}
                        </TableCell>
                        <TableCell sx={{ fontSize: 11, color: C.gray500, maxWidth: 240 }}>
                          <span style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 230 }}>
                            {(c.customer_address || "").replace(/\s+/g, " ").trim() || "—"}
                          </span>
                          <span style={{ color: C.gray400 }}>
                            {[c.customer_city, c.customer_pincode].filter(Boolean).join(" · ") || "no city on label"}
                          </span>
                        </TableCell>
                        <TableCell sx={{ textAlign: "right", fontFamily: "monospace", fontWeight: 800, fontSize: 14, whiteSpace: "nowrap" }}>
                          {c.order_count}
                          <Typography component="span" sx={{ fontSize: 10, color: C.gray400, ml: "3px" }}>
                            /{c.total_qty}u
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ textAlign: "center", whiteSpace: "nowrap" }}>
                          {c.delivered > 0 && <Tooltip title="Delivered"><Chip label={c.delivered} size="small" sx={{ height: 17, minWidth: 24, fontSize: 9, mr: "3px", bgcolor: C.greenLight, color: C.green, fontWeight: 700 }} /></Tooltip>}
                          {c.returned > 0 && <Tooltip title="Returned"><Chip label={c.returned} size="small" sx={{ height: 17, minWidth: 24, fontSize: 9, mr: "3px", bgcolor: C.redLight, color: C.red, fontWeight: 700 }} /></Tooltip>}
                          {c.rto > 0 && <Tooltip title="RTO"><Chip label={c.rto} size="small" sx={{ height: 17, minWidth: 24, fontSize: 9, mr: "3px", bgcolor: C.amberLight, color: C.amber, fontWeight: 700 }} /></Tooltip>}
                          {c.pending > 0 && <Tooltip title="Pending"><Chip label={c.pending} size="small" sx={{ height: 17, minWidth: 24, fontSize: 9, bgcolor: C.gray100, color: C.gray500, fontWeight: 700 }} /></Tooltip>}
                        </TableCell>
                        <TableCell sx={{ textAlign: "right", fontFamily: "monospace", fontWeight: 800, fontSize: 12,
                                         color: rate >= 50 ? C.red : rate > 0 ? C.amber : C.gray300 }}>
                          {bad > 0 ? `${rate}%` : "—"}
                        </TableCell>
                        <TableCell sx={{ textAlign: "right", fontFamily: "monospace", fontSize: 12 }}>
                          {fmt(Number(c.net_settlement))}
                        </TableCell>
                        <TableCell sx={{ fontSize: 11, color: C.gray500, whiteSpace: "nowrap" }}>{c.last_ordered || "—"}</TableCell>
                        <TableCell>
                          {!c.is_blocked && (
                            <Tooltip title="Block this customer">
                              <IconButton size="small" onClick={(e) => { e.stopPropagation(); blockCustomer(c); }}>
                                <BlockIcon sx={{ fontSize: 15, color: C.red }} />
                              </IconButton>
                            </Tooltip>
                          )}
                        </TableCell>
                      </TableRow>

                      {isOpen && (
                        <TableRow>
                          <TableCell colSpan={8} sx={{ bgcolor: C.gray50, p: "14px 18px" }}>
                            <Typography sx={{ fontSize: 11, fontWeight: 700, color: C.gray500, mb: "8px" }}>
                              {c.order_count} order{c.order_count > 1 ? "s" : ""} · {c.total_qty} unit{c.total_qty > 1 ? "s" : ""}
                              {c.first_ordered && ` · ${c.first_ordered} → ${c.last_ordered}`}
                            </Typography>
                            <Box sx={{ overflowX: "auto" }}>
                              <Table size="small" sx={{ minWidth: 700, bgcolor: "#fff", borderRadius: "8px" }}>
                                <TableHead>
                                  <TableRow>
                                    {["Date", "Sub-order", "Parent / SKU", "Qty", "Status", "Courier", "Settlement"].map(h => (
                                      <TableCell key={h} sx={thSx}>{h}</TableCell>
                                    ))}
                                  </TableRow>
                                </TableHead>
                                <TableBody>
                                  {c.orders.map(o => (
                                    <TableRow key={o.order_id}>
                                      <TableCell sx={{ fontSize: 11, whiteSpace: "nowrap", fontFamily: "monospace" }}>
                                        {o.label_date || o.order_date || "—"}
                                      </TableCell>
                                      <TableCell sx={{ fontSize: 10, fontFamily: "monospace", color: C.gray500 }}>{o.order_id}</TableCell>
                                      <TableCell sx={{ fontSize: 11 }}>
                                        {o.parent_sku && o.parent_sku !== o.sku ? (
                                          <>
                                            <strong style={{ color: C.orange }}>{o.parent_sku}</strong><br />
                                            <span style={{ fontFamily: "monospace", color: C.gray500 }}>↳ {o.sku}</span>
                                          </>
                                        ) : <span style={{ fontFamily: "monospace" }}>{o.sku || "—"}</span>}
                                      </TableCell>
                                      <TableCell sx={{ fontSize: 11, fontFamily: "monospace", fontWeight: 700 }}>{o.qty}</TableCell>
                                      <TableCell><StatusChip status={o.status} /></TableCell>
                                      <TableCell sx={{ fontSize: 11 }}>{o.courier_name || "—"}</TableCell>
                                      <TableCell sx={{ fontSize: 11, fontFamily: "monospace" }}>{fmt(Number(o.settlement))}</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </Box>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </Box>
          {pages > 1 && (
            <Box sx={{ p: "10px 16px", borderTop: `1px solid ${C.gray100}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <Typography sx={{ fontSize: 11, color: C.gray400 }}>Page {page} of {pages} · {data.total} customers</Typography>
              <Box sx={{ display: "flex", gap: "6px" }}>
                <Button size="small" disabled={page === 1} onClick={() => setPage(p => p - 1)} sx={{ fontSize: 11, textTransform: "none" }}>← Prev</Button>
                <Button size="small" disabled={page >= pages} onClick={() => setPage(p => p + 1)} sx={{ fontSize: 11, textTransform: "none" }}>Next →</Button>
              </Box>
            </Box>
          )}
        </Paper>
      )}
    </Box>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// CUSTOMER HISTORY DRAWER — opened from a label row
// ══════════════════════════════════════════════════════════════════════════════
function CustomerHistoryDrawer({ query, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const p = new URLSearchParams();
    if (query.name) p.set("name", query.name);
    if (query.pincode) p.set("pincode", query.pincode);
    // Address disambiguates two customers who share a name.
    if (query.address) p.set("address", query.address);
    setLoading(true);
    fetch(`${API}/labels/customer-history/?${p}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [query.name, query.pincode, query.address]);

  const orders = data?.orders || [];
  const s = data?.summary || {};

  return (
    <Box onClick={onClose}
      sx={{ position: "fixed", inset: 0, zIndex: 1300, bgcolor: "rgba(15,23,42,0.45)", display: "flex", justifyContent: "flex-end" }}>
      <Paper onClick={(e) => e.stopPropagation()} elevation={8}
        sx={{ width: { xs: "100%", sm: 580 }, height: "100%", overflowY: "auto", borderRadius: 0 }}>
        <Box sx={{ p: "18px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "flex-start",
                   gap: "10px", position: "sticky", top: 0, bgcolor: "#fff", zIndex: 1 }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontSize: 16, fontWeight: 800, color: C.gray800 }}>
              {query.name || `Pincode ${query.pincode}`}
            </Typography>
            <Typography sx={{ fontSize: 11, color: C.gray400 }}>
              {loading ? "Loading history…" : `${orders.length} order${orders.length === 1 ? "" : "s"} on record`}
            </Typography>
          </Box>
          <IconButton size="small" onClick={onClose}><CloseIcon sx={{ fontSize: 18 }} /></IconButton>
        </Box>

        {loading ? (
          <Box sx={{ p: "30px" }}><LinearProgress /></Box>
        ) : orders.length === 0 ? (
          <Typography sx={{ p: "30px", fontSize: 13, color: C.gray400, textAlign: "center" }}>
            No history for this customer.
          </Typography>
        ) : (
          <>
            <Box sx={{ p: "14px 20px", display: "flex", gap: "24px", flexWrap: "wrap", borderBottom: `1px solid ${C.gray100}` }}>
              {s.total_orders != null && <Stat label="Orders" value={s.total_orders} />}
              {s.total_items != null && <Stat label="Units" value={s.total_items} />}
              {s.delivered != null && <Stat label="Delivered" value={s.delivered} tone={C.green} />}
              {s.rto != null && <Stat label="RTO" value={s.rto} tone={C.amber} />}
              {s.pending != null && <Stat label="Pending" value={s.pending} tone={C.gray500} />}
              {s.total_settlement != null && <Stat label="Settlement" value={fmt(Number(s.total_settlement))} />}
            </Box>
            <Box sx={{ overflowX: "auto" }}>
              <Table size="small" sx={{ minWidth: 540 }}>
                <TableHead>
                  <TableRow>
                    {["Date", "SKU", "Qty", "Status", "Courier", "Settlement"].map(h => (
                      <TableCell key={h} sx={thSx}>{h}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {orders.map((o, i) => (
                    <TableRow key={o.order_id || i} sx={{ bgcolor: i % 2 ? C.gray50 : "#fff" }}>
                      <TableCell sx={{ fontSize: 11, fontFamily: "monospace", whiteSpace: "nowrap" }}>
                        {o.uploaded_date || o.order_date || "—"}
                      </TableCell>
                      <TableCell sx={{ fontSize: 11, fontFamily: "monospace", wordBreak: "break-all", maxWidth: 150 }}>
                        {o.sku || "—"}
                      </TableCell>
                      <TableCell sx={{ fontSize: 11, fontFamily: "monospace", fontWeight: 700 }}>{o.qty ?? 1}</TableCell>
                      <TableCell><StatusChip status={o.delivery_status || o.live_order_status || "PENDING"} /></TableCell>
                      <TableCell sx={{ fontSize: 11 }}>{o.courier_name || "—"}</TableCell>
                      <TableCell sx={{ fontSize: 11, fontFamily: "monospace",
                                       color: o.is_settled ? (Number(o.settlement_amount) >= 0 ? C.green : C.red) : C.gray300 }}>
                        {o.is_settled ? fmt(Number(o.settlement_amount)) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </>
        )}
      </Paper>
    </Box>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SHELL
// ══════════════════════════════════════════════════════════════════════════════
const VIEWS = [["batch", "Batch"], ["pack", "Pack"], ["labels", "Labels"], ["customers", "Customers"]];

const SUBTITLE = {
  batch: "Upload a labels PDF and check what came out of it",
  pack: "Work through the batch — scan or tap each parcel",
  labels: "Every label shipped — searchable and sortable",
  customers: "Who ordered — matched on name and full address",
};

export function LabelsTab() {
  const isMobile = useIsMobile();
  const [view, setView] = useState("batch");

  const [batchDate, setBatchDate] = useState(todayISO());
  const [result, setResult] = useState(null);
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [packingOrders, setPackingOrders] = useState([]);
  const fileRef = useRef(null);

  const [historyQuery, setHistoryQuery] = useState(null);

  const packedCount = packingOrders.filter(o => o.is_packed).length;
  const pendingCount = packingOrders.length - packedCount;

  const packQueueFrom = (parsed) =>
    (parsed?.page_details || [])
      .filter(p => p.order_id)
      .map(p => ({ order_id: p.order_id, sku: p.sku, qty: p.qty || 1, awb_number: p.awb, is_packed: false }));

  // Restore a previously parsed batch for this date.
  useEffect(() => {
    const saved = loadParseResult(batchDate);
    if (saved) {
      setResult(saved.result);
      setFileName(saved.fileName);
      setPackingOrders(packQueueFrom(saved.result));
    } else {
      setResult(null); setFileName(""); setPackingOrders([]);
    }
    setError("");
  }, [batchDate]);

  const handleFile = async (file) => {
    if (!file) return;
    setLoading(true); setError(""); setResult(null); setPackingOrders([]);
    setFileName(file.name);
    const form = new FormData();
    form.append("file", file);
    form.append("upload_date", batchDate);
    try {
      const res = await fetch(`${API}/labels/parse/`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || "Could not parse that PDF.");
      } else {
        setResult(data);
        saveParseResult(batchDate, file.name, data);
        setPackingOrders(packQueueFrom(data));
      }
    } catch {
      setError("Could not reach the server — is the backend running?");
    }
    setLoading(false);
  };

  const togglePack = async (order_id) => {
    const current = packingOrders.find(o => o.order_id === order_id)?.is_packed ?? false;
    const res = await fetch(`${API}/labels/orders/${encodeURIComponent(order_id)}/pack/`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packed: !current }),
    });
    if (res.ok) setPackingOrders(prev => prev.map(o => o.order_id === order_id ? { ...o, is_packed: !current } : o));
  };

  const markAllPacked = async () => {
    const ids = packingOrders.filter(o => !o.is_packed).map(o => o.order_id);
    if (!ids.length) return;
    const res = await fetch(`${API}/labels/bulk-pack/`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_ids: ids, packed: true }),
    });
    if (res.ok) setPackingOrders(prev => prev.map(o => ({ ...o, is_packed: true })));
  };

  // Clears only the locally-cached batch view; parsed labels stay in the
  // database and remain visible under the Labels view.
  const resetBatch = () => {
    try { localStorage.removeItem(LS_PREFIX + batchDate); } catch { /* ignore */ }
    setResult(null); setFileName(""); setPackingOrders([]); setError("");
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {historyQuery && <CustomerHistoryDrawer query={historyQuery} onClose={() => setHistoryQuery(null)} />}
      <input ref={fileRef} type="file" accept="application/pdf" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; handleFile(f); }} />

      <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
        <Box>
          <Typography sx={{ fontSize: 20, fontWeight: 800, color: C.gray800 }}>Labels</Typography>
          <Typography sx={{ fontSize: 12, color: C.gray400, mt: "2px" }}>{SUBTITLE[view]}</Typography>
        </Box>
        <Box sx={{ display: "flex", gap: "3px", bgcolor: C.gray100, borderRadius: "10px", p: "4px",
                   width: isMobile ? "100%" : "auto" }}>
          {VIEWS.map(([id, label]) => (
            <Button key={id} onClick={() => setView(id)}
              sx={{ px: isMobile ? "10px" : "16px", py: "7px", borderRadius: "8px", fontSize: 13, textTransform: "none",
                    flex: isMobile ? 1 : "none", minWidth: 0,
                    fontWeight: view === id ? 800 : 500,
                    bgcolor: view === id ? "#fff" : "transparent",
                    color: view === id ? C.orange : C.gray500,
                    boxShadow: view === id ? "0 1px 4px rgba(0,0,0,0.1)" : "none",
                    "&:hover": { bgcolor: view === id ? "#fff" : "transparent" } }}>
              {label}
              {id === "pack" && pendingCount > 0 && (
                <Chip label={pendingCount} size="small"
                  sx={{ ml: "6px", height: 17, minWidth: 20, fontSize: 9, fontWeight: 800,
                        bgcolor: C.orange, color: "#fff", "& .MuiChip-label": { px: "5px" } }} />
              )}
            </Button>
          ))}
        </Box>
      </Box>

      {view === "batch" && (
        <BatchView
          batchDate={batchDate} setBatchDate={setBatchDate}
          result={result} fileName={fileName} loading={loading} error={error}
          onPickFile={() => fileRef.current?.click()}
          onReset={resetBatch}
          packedCount={packedCount}
          pendingCount={pendingCount}
          onGoPack={() => setView("pack")}
        />
      )}
      {view === "pack" && (
        <PackView
          batchDate={batchDate} setBatchDate={setBatchDate}
          orders={packingOrders} fileName={fileName}
          onToggle={togglePack} onMarkAll={markAllPacked}
          onGoBatch={() => setView("batch")}
        />
      )}
      {view === "labels" && <LabelsView onViewCustomer={setHistoryQuery} />}
      {view === "customers" && <CustomersView />}
    </Box>
  );
}
