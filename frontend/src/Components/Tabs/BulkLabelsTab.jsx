import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  LinearProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  Chip,
  IconButton,
  Tabs,
  Tab,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DownloadIcon from '@mui/icons-material/Download';
import DeleteIcon from '@mui/icons-material/Delete';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import LocalPrintshopIcon from '@mui/icons-material/LocalPrintshop';
import { C, API, useIsMobile } from '../../App';
import { ParentSkuCell } from './ParentLinkInline';

/*
 * BULK LABELS (shown to the user simply as "Labels")
 *
 * A separate tab from the single-file Labels view, for the case that one
 * doesn't cover: several exported label PDFs (e.g. one per Meesho supplier
 * account) that need to become one merged, business-sorted batch instead of
 * several separate uploads. Calls its own endpoint (bulk-labels/parse/) —
 * the existing Labels tab and its endpoint are untouched by this file; that
 * route just isn't linked from the sidebar any more (see navConfig.js).
 *
 * The response shape here is almost identical to the single-file endpoint's
 * (same per_business / ambiguous_skus / sku_table fields), since the backend
 * merges every uploaded file into one PDF before doing anything else — the
 * one difference is `sorted_pdf_b64` in place of `cropped_pdf_b64`: pages are
 * still reordered most-dispatched-first, but never cropped, since this batch
 * is meant to go straight to print exactly as Meesho generated each page.
 */

function pad2(n) {
  return String(n).padStart(2, '0');
}
function toLocalISO(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// A "processing day" runs noon-to-noon, not midnight-to-midnight: labels
// downloaded late at night and the rest packed the next morning before noon
// are one night's work, so both should default to the same batch date. Only
// once it's past noon does the default roll over to the new calendar day.
function businessDateISO() {
  const now = new Date();
  if (now.getHours() < 12) now.setDate(now.getDate() - 1);
  return toLocalISO(now);
}

function downloadSortedPDF(b64, label) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `labels_sorted_${label || 'bulk'}.pdf`;
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
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pdf_b64: pdfB64, pages }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.pdf_b64) throw new Error(data.error || 'Could not extract those pages.');
  downloadSortedPDF(data.pdf_b64, filename);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Draws today's KPI summary as a 4×6in dispatch label (300dpi -> 1200x1800px,
 * the same physical size as the shipping labels this tab already prints) so
 * it can be stuck on the outgoing bag or shared as a quick end-of-day count.
 * Pure canvas — no PDF/image library needed for something this simple, and
 * a PNG prints true-to-size at "actual size" / 100% scale on any printer.
 */
function drawDispatchLabelCanvas(todaySummary) {
  const DPI = 300;
  const W = 4 * DPI;
  const H = 6 * DPI;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const orange = '#6D28D9';
  const gray800 = '#1E293B';
  const gray500 = '#64748B';
  const gray300 = '#CBD5E1';
  const orangeLight = '#F5F3FF';

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);

  const M = 60; // print margin

  // Cut-line border, like a real shipping label
  ctx.strokeStyle = gray300;
  ctx.setLineDash([10, 8]);
  ctx.lineWidth = 3;
  ctx.strokeRect(M / 2, M / 2, W - M, H - M);
  ctx.setLineDash([]);

  let y = M + 60;

  ctx.fillStyle = orange;
  ctx.font = '900 64px system-ui, Helvetica, Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('RUDAM', M, y);

  ctx.fillStyle = gray500;
  ctx.font = '700 26px system-ui, Helvetica, Arial, sans-serif';
  ctx.fillText('DISPATCH SUMMARY', M, y + 42);

  y += 90;
  ctx.strokeStyle = orange;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(M, y);
  ctx.lineTo(W - M, y);
  ctx.stroke();

  y += 60;
  const dateLabel = todaySummary?.business_date
    ? new Date(todaySummary.business_date).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  ctx.fillStyle = gray800;
  ctx.font = '600 32px system-ui, Helvetica, Arial, sans-serif';
  ctx.fillText(dateLabel, M, y);

  // Big total, centered
  y += 130;
  ctx.fillStyle = gray500;
  ctx.font = '700 24px system-ui, Helvetica, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('LABELS PROCESSED TODAY', W / 2, y);

  y += 150;
  ctx.fillStyle = orange;
  ctx.font = '900 220px monospace';
  ctx.fillText(String((todaySummary?.total ?? 0).toLocaleString('en-IN')), W / 2, y);

  if (todaySummary?.reset_at) {
    y += 44;
    ctx.fillStyle = gray500;
    ctx.font = '500 22px system-ui, Helvetica, Arial, sans-serif';
    const resetTime = new Date(todaySummary.reset_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    ctx.fillText(`counting fresh since ${resetTime}`, W / 2, y);
  }

  // Per-courier breakdown
  const couriers = todaySummary?.couriers || [];
  if (couriers.length) {
    y += 70;
    ctx.strokeStyle = gray300;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(M, y);
    ctx.lineTo(W - M, y);
    ctx.stroke();

    y += 56;
    ctx.textAlign = 'left';
    ctx.fillStyle = gray500;
    ctx.font = '700 22px system-ui, Helvetica, Arial, sans-serif';
    ctx.fillText('BY DELIVERY PARTNER', M, y);
    y += 20;

    const rowH = 64;
    couriers.forEach((c, i) => {
      const rowY = y + 30 + i * rowH;
      if (rowY > H - M - 120) return; // stop before running into the footer
      if (i % 2 === 0) {
        ctx.fillStyle = orangeLight;
        ctx.fillRect(M, rowY - 34, W - 2 * M, rowH - 10);
      }
      ctx.fillStyle = gray800;
      ctx.font = '700 30px system-ui, Helvetica, Arial, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(c.courier_name, M + 24, rowY);
      ctx.font = '900 30px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(c.count.toLocaleString('en-IN'), W - M - 24, rowY);
    });
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = gray500;
  ctx.font = '500 20px system-ui, Helvetica, Arial, sans-serif';
  ctx.fillText(`Generated ${new Date().toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })} · via Rudam`, W / 2, H - M - 20);

  return canvas;
}

function labelCanvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 0.98));
}

function whatsappSummaryText(todaySummary) {
  const total = (todaySummary?.total ?? 0).toLocaleString('en-IN');
  const dateLabel = todaySummary?.business_date || new Date().toLocaleDateString('en-IN');
  const lines = [`📦 Labels processed today (${dateLabel}): *${total}*`];
  (todaySummary?.couriers || []).forEach((c) => lines.push(`• ${c.courier_name}: ${c.count.toLocaleString('en-IN')}`));
  lines.push('— via Rudam');
  return lines.join('\n');
}

function Stat({ label, value, tone = C.gray800 }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography
        sx={{ fontSize: 10, fontWeight: 700, color: C.gray400, letterSpacing: '0.07em', textTransform: 'uppercase' }}
      >
        {label}
      </Typography>
      <Typography sx={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 21, color: tone, lineHeight: 1.15 }}>
        {value}
      </Typography>
    </Box>
  );
}

export function BulkLabelsTab() {
  const isMobile = useIsMobile();
  const fileRef = useRef(null);

  const [pending, setPending] = useState([]); // File[] picked, not yet uploaded
  const [batchDate, setBatchDate] = useState(businessDateISO());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [extracting, setExtracting] = useState(null); // key of the group/row currently downloading
  const [extractError, setExtractError] = useState('');
  const [awbSearch, setAwbSearch] = useState('');
  // Which section of the results is showing — replaces the old stacked-panel
  // layout so a large batch's SKU table, courier table and full label list
  // don't all have to render (and scroll) at once.
  const [activeTab, setActiveTab] = useState('overview');
  // Persisted "how many orders on which date, via which courier" record —
  // computed live from every LabelOrder saved so far (see label_batch_history),
  // not just the batch currently on screen, so it survives across sessions.
  const [history, setHistory] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  // The highlighted KPI banner is the CURRENT business day only (noon
  // cutoff, falls back to the last non-empty day) — not the lifetime total
  // `history` holds. That's what answers "how many will the courier collect
  // today", which is what the banner is for; the lifetime figures live in
  // the Processing History tab instead.
  const [todaySummary, setTodaySummary] = useState(null);
  const [todayLoading, setTodayLoading] = useState(true);
  // Parents linked from inside this view, same pattern as LabelsTab — keyed
  // by sku so a just-linked SKU regroups immediately without a re-upload.
  const [parentOverride, setParentOverride] = useState({});
  const onParentAdded = useCallback((sku, parentId) => setParentOverride((o) => ({ ...o, [sku]: parentId })), []);

  const addFiles = (fileList) => {
    const picked = Array.from(fileList || []).filter((f) => f.name.toLowerCase().endsWith('.pdf'));
    if (picked.length) setPending((prev) => [...prev, ...picked]);
  };
  const removePending = (i) => setPending((prev) => prev.filter((_, j) => j !== i));

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`${API}/bulk-labels/history/`);
      if (res.ok) setHistory(await res.json());
    } catch {
      // silent — the current-batch view still works without history
    }
    setHistoryLoading(false);
  }, []);

  const loadTodaySummary = useCallback(async () => {
    setTodayLoading(true);
    try {
      const res = await fetch(`${API}/bulk-labels/today/`);
      if (res.ok) setTodaySummary(await res.json());
    } catch {
      // silent — banner just stays blank
    }
    setTodayLoading(false);
  }, []);

  useEffect(() => {
    loadHistory();
    loadTodaySummary();
  }, [loadHistory, loadTodaySummary]);

  const [resetting, setResetting] = useState(false);
  const resetTodayCount = async () => {
    setResetting(true);
    try {
      const res = await fetch(`${API}/bulk-labels/today/reset/`, { method: 'POST' });
      if (res.ok) setTodaySummary(await res.json());
    } catch {
      // silent — banner keeps its last known value
    }
    setResetting(false);
  };

  // ── Dispatch label: today's KPI count as a 4×6in printable, or a WhatsApp share ──
  const [labelBusy, setLabelBusy] = useState(false);
  const downloadDispatchLabel = async () => {
    setLabelBusy(true);
    try {
      const canvas = drawDispatchLabelCanvas(todaySummary);
      const blob = await labelCanvasToBlob(canvas);
      const dateTag = (todaySummary?.business_date || businessDateISO()).replace(/[^0-9-]/g, '');
      downloadBlob(blob, `dispatch_summary_${dateTag}.png`);
    } finally {
      setLabelBusy(false);
    }
  };

  const shareOnWhatsApp = async () => {
    const text = whatsappSummaryText(todaySummary);
    // Native share sheet (mobile) can attach the actual label image and still
    // let the user pick WhatsApp from it; wa.me only ever supports prefilled
    // text, so that's the fallback everywhere the file share isn't available.
    try {
      const canvas = drawDispatchLabelCanvas(todaySummary);
      const blob = await labelCanvasToBlob(canvas);
      const file = new File([blob], 'dispatch_summary.png', { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text, title: 'Dispatch summary' });
        return;
      }
    } catch (e) {
      if (e?.name === 'AbortError') return; // user cancelled the share sheet
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };

  const upload = async () => {
    if (!pending.length) return;
    setLoading(true);
    setError('');
    setResult(null);
    const form = new FormData();
    pending.forEach((f) => form.append('files', f));
    form.append('upload_date', batchDate);
    try {
      const res = await fetch(`${API}/bulk-labels/parse/`, { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || 'Could not parse those PDFs.');
      } else {
        setResult(data);
        setPending([]);
        loadHistory(); // this batch just added to the persisted record
        loadTodaySummary();
      }
    } catch {
      setError('Could not reach the server — is the backend running?');
    }
    setLoading(false);
  };

  const rawSkuTable = result?.sku_table || [];
  const pageDetails = result?.page_details || [];
  const labels = result?.total_labels ?? 0;

  // A SKU linked from inside this view (see onParentAdded) overrides what the
  // upload itself found, the same way LabelsTab applies parentOverride.
  const skuTable = useMemo(
    () => rawSkuTable.map((r) => (parentOverride[r.sku] ? { ...r, parent_sku: parentOverride[r.sku] } : r)),
    [rawSkuTable, parentOverride],
  );

  const units = useMemo(() => skuTable.reduce((s, r) => s + (r.total_qty || 0), 0), [skuTable]);
  // How many SKUs had at least one order asking for more than one unit — the
  // same "check before packing" signal LabelsTab already surfaces.
  const multiQty = useMemo(() => skuTable.reduce((s, r) => s + (r.high_qty_orders || 0), 0), [skuTable]);

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
  // batch" panel (parent SKU → its child SKUs) — full rows are kept per
  // child (not just the sku string) so units/max-qty can be rolled up per
  // group, the same numbers LabelsTab already shows.
  const skuGroups = useMemo(() => {
    const m = {};
    skuTable.forEach((r) => {
      const linked = r.parent_sku && r.parent_sku !== r.sku;
      const key = linked ? r.parent_sku : `__${r.sku}`;
      m[key] = m[key] || { parent: linked ? r.parent_sku : null, children: [], count: 0 };
      m[key].children.push(r);
      m[key].count += r.count || 0;
    });
    return Object.values(m).sort((a, b) => b.count - a.count);
  }, [skuTable]);

  const downloadGroup = async (group) => {
    const firstSku = group.children[0]?.sku;
    const key = group.parent || firstSku;
    setExtractError('');
    setExtracting(key);
    try {
      const skuSet = new Set(group.children.map((c) => c.sku));
      const pages = orderedDetails.filter((pd) => skuSet.has(pd.sku)).map((pd) => pd.sortedIndex);
      if (!pages.length) throw new Error('No pages found for this group.');
      await extractAndDownload(result.sorted_pdf_b64, pages, `${group.parent || firstSku}_${batchDate}`);
    } catch (e) {
      setExtractError(e.message || 'Could not download that group.');
    } finally {
      setExtracting(null);
    }
  };

  const downloadSingle = async (pd) => {
    const key = `awb-${pd.sortedIndex}`;
    setExtractError('');
    setExtracting(key);
    try {
      await extractAndDownload(
        result.sorted_pdf_b64,
        [pd.sortedIndex],
        `${pd.awb || pd.order_id || 'label'}_${batchDate}`,
      );
    } catch (e) {
      setExtractError(e.message || 'Could not download that label.');
    } finally {
      setExtracting(null);
    }
  };

  // Same idea as skuGroups, grouped by delivery partner instead of product —
  // backs both the "By Delivery Partner" tab and its per-courier download.
  const courierGroups = useMemo(() => {
    const m = {};
    (orderedDetails.length ? orderedDetails : pageDetails).forEach((pd) => {
      const courier = pd.courier || 'Unknown';
      m[courier] = m[courier] || { courier, count: 0, units: 0 };
      m[courier].count += 1;
      m[courier].units += pd.qty || 1;
    });
    return Object.values(m).sort((a, b) => b.count - a.count);
  }, [orderedDetails, pageDetails]);

  const downloadCourier = async (courierName) => {
    const key = `courier-${courierName}`;
    setExtractError('');
    setExtracting(key);
    try {
      const pages = orderedDetails
        .filter((pd) => (pd.courier || 'Unknown') === courierName)
        .map((pd) => pd.sortedIndex);
      if (!pages.length) throw new Error('No pages found for this delivery partner.');
      await extractAndDownload(result.sorted_pdf_b64, pages, `${courierName}_${batchDate}`);
    } catch (e) {
      setExtractError(e.message || "Could not download that delivery partner's labels.");
    } finally {
      setExtracting(null);
    }
  };

  const filteredDetails = useMemo(() => {
    const q = awbSearch.trim().toLowerCase();
    const rows = orderedDetails.length ? orderedDetails : pageDetails.map((pd, i) => ({ ...pd, sortedIndex: i }));
    if (!q) return rows;
    return rows.filter(
      (pd) => (pd.awb || '').toLowerCase().includes(q) || (pd.order_id || '').toLowerCase().includes(q),
    );
  }, [orderedDetails, pageDetails, awbSearch]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
          <UploadFileIcon sx={{ color: C.orange, fontSize: 21 }} />
          <Typography sx={{ fontSize: 19, fontWeight: 800, color: C.gray800 }}>Labels</Typography>
        </Box>
        <Typography sx={{ fontSize: 12, color: C.gray400, mt: '3px' }}>
          Upload several labels PDFs at once (e.g. one export per Meesho account) — they're merged into one batch and
          sorted by business the same way a single upload already is.
        </Typography>
      </Box>

      {/* Always-visible KPI — the CURRENT business day only (noon cutoff,
          falls back to the last non-empty day), not the lifetime total —
          "how many will the courier collect today". Lifetime figures live
          in the Processing History tab instead. */}
      <Paper
        elevation={0}
        sx={{
          border: `1px solid ${C.orangeBorder}`,
          borderRadius: '12px',
          p: '16px 18px',
          bgcolor: C.orangeLight,
          display: 'flex',
          alignItems: 'center',
          gap: '24px',
          flexWrap: 'wrap',
        }}
      >
        <Box>
          <Typography
            sx={{ fontSize: 10, fontWeight: 700, color: C.orange, letterSpacing: '0.07em', textTransform: 'uppercase' }}
          >
            Labels processed today{todaySummary?.business_date ? ` (${todaySummary.business_date})` : ''}
          </Typography>
          <Typography sx={{ fontFamily: 'monospace', fontWeight: 900, fontSize: 32, color: C.orange, lineHeight: 1.1 }}>
            {todayLoading && !todaySummary ? '…' : (todaySummary?.total ?? 0).toLocaleString()}
          </Typography>
          {todaySummary?.reset_at && (
            <Typography sx={{ fontSize: 11, color: C.gray500, mt: '2px' }}>
              Counting fresh since {new Date(todaySummary.reset_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Typography>
          )}
        </Box>
        {!!todaySummary?.couriers?.length && (
          <Box sx={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {todaySummary.couriers.map((c) => (
              <Chip
                key={c.courier_name}
                label={`${c.courier_name}: ${c.count.toLocaleString()}`}
                size="small"
                sx={{
                  bgcolor: '#fff',
                  color: C.gray700,
                  fontWeight: 800,
                  fontSize: 12.5,
                  border: `1px solid ${C.orangeBorder}`,
                }}
              />
            ))}
          </Box>
        )}
        <Box sx={{ display: 'flex', gap: '8px', flexWrap: 'wrap', ml: 'auto' }}>
          <Tooltip title="Share today's count as a WhatsApp message — with the label image attached where your device supports it">
            <span>
              <Button
                onClick={shareOnWhatsApp}
                disabled={labelBusy || todayLoading}
                startIcon={<WhatsAppIcon sx={{ fontSize: 17 }} />}
                sx={{
                  textTransform: 'none', fontWeight: 700, fontSize: 12.5, color: '#25D366',
                  border: '1px solid #25D366', bgcolor: '#fff', borderRadius: '9px', px: '12px',
                  '&.Mui-disabled': { opacity: 0.6 },
                }}
              >
                Share
              </Button>
            </span>
          </Tooltip>
          <Tooltip title="Download today's count as a 4×6in label, sized to print on the same media as your shipping labels">
            <span>
              <Button
                onClick={downloadDispatchLabel}
                disabled={labelBusy || todayLoading}
                startIcon={<LocalPrintshopIcon sx={{ fontSize: 17 }} />}
                sx={{
                  textTransform: 'none', fontWeight: 700, fontSize: 12.5, color: C.orange,
                  border: `1px solid ${C.orangeBorder}`, bgcolor: '#fff', borderRadius: '9px', px: '12px',
                  '&.Mui-disabled': { opacity: 0.6 },
                }}
              >
                {labelBusy ? 'Preparing…' : '4×6 label'}
              </Button>
            </span>
          </Tooltip>
          <Tooltip title="Mark everything processed so far as handed to the courier — the count above starts fresh from 0 for the rest of today">
            <span>
              <Button
                onClick={() => {
                  if (window.confirm('Reset today\u2019s label count to 0? Already-processed labels stay saved — this only resets the counter.')) resetTodayCount();
                }}
                disabled={resetting}
                sx={{
                  textTransform: 'none', fontWeight: 700, fontSize: 12.5, color: C.orange,
                  border: `1px solid ${C.orangeBorder}`, bgcolor: '#fff', borderRadius: '9px', px: '12px',
                  '&.Mui-disabled': { opacity: 0.6 },
                }}
              >
                {resetting ? 'Resetting…' : 'Reset count'}
              </Button>
            </span>
          </Tooltip>
        </Box>
      </Paper>

      <input
        ref={fileRef}
        type="file"
        accept="application/pdf"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = '';
        }}
      />

      <Paper elevation={0} sx={{ border: `1px solid ${C.border}`, borderRadius: '12px', p: '16px 18px' }}>
        <Box sx={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <Button
            onClick={() => fileRef.current?.click()}
            disabled={loading}
            sx={{
              textTransform: 'none',
              fontWeight: 800,
              fontSize: 14,
              px: '22px',
              py: '10px',
              color: '#fff',
              bgcolor: C.orange,
              borderRadius: '10px',
              boxShadow: '0 3px 12px rgba(109,40,217,0.28)',
              '&:hover': { bgcolor: C.orange, filter: 'brightness(0.94)' },
              '&.Mui-disabled': { bgcolor: C.gray300, color: '#fff' },
            }}
          >
            <UploadFileIcon sx={{ fontSize: 18, mr: '6px' }} />
            Add PDFs
          </Button>
          <input
            type="date"
            value={batchDate}
            onChange={(e) => setBatchDate(e.target.value)}
            style={{
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              padding: '8px 10px',
              fontFamily: 'inherit',
              fontSize: 13,
            }}
          />
          <Button
            onClick={upload}
            disabled={loading || !pending.length}
            sx={{
              textTransform: 'none',
              fontWeight: 700,
              fontSize: 13,
              color: C.green,
              border: `1px solid ${C.greenBorder}`,
              bgcolor: C.greenLight,
              borderRadius: '10px',
              px: '16px',
              '&.Mui-disabled': { opacity: 0.5 },
            }}
          >
            {loading ? 'Merging & parsing…' : `Merge & upload ${pending.length ? `(${pending.length})` : ''}`}
          </Button>
          {result?.sorted_pdf_b64 && (
            <Tooltip title="Full pages, merged and sorted most-dispatched-first — ready to print as-is">
              <Button
                onClick={() => downloadSortedPDF(result.sorted_pdf_b64, batchDate)}
                sx={{
                  textTransform: 'none',
                  fontWeight: 700,
                  fontSize: 13,
                  color: C.blue,
                  border: `1px solid #BFDBFE`,
                  bgcolor: C.blueLight,
                  borderRadius: '10px',
                  px: '14px',
                }}
              >
                <DownloadIcon sx={{ fontSize: 17, mr: '5px' }} />
                Sorted PDF
              </Button>
            </Tooltip>
          )}
        </Box>

        {pending.length > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '6px', mt: '12px' }}>
            {pending.map((f, i) => (
              <Chip
                key={i}
                label={f.name}
                size="small"
                onDelete={() => removePending(i)}
                deleteIcon={<DeleteIcon />}
                sx={{ bgcolor: C.gray100, fontSize: 12 }}
              />
            ))}
          </Box>
        )}
      </Paper>

      {error && (
        <Alert severity="error" sx={{ borderRadius: '10px' }}>
          {error}
        </Alert>
      )}

      {loading && (
        <Paper
          elevation={0}
          sx={{ border: `1px solid ${C.border}`, borderRadius: '12px', p: '34px', textAlign: 'center' }}
        >
          <LinearProgress sx={{ mb: '14px', borderRadius: 3 }} />
          <Typography sx={{ fontSize: 14, fontWeight: 700, color: C.gray700 }}>
            Merging and reading your files
          </Typography>
          <Typography sx={{ fontSize: 12, color: C.gray400, mt: '3px' }}>
            A large combined batch takes a few seconds
          </Typography>
        </Paper>
      )}

      {!result && !loading && !pending.length && (
        <Paper
          elevation={0}
          onClick={() => fileRef.current?.click()}
          sx={{
            border: `2px dashed ${C.gray200}`,
            borderRadius: '14px',
            p: '48px 24px',
            textAlign: 'center',
            cursor: 'pointer',
            bgcolor: C.gray50,
            '&:hover': { borderColor: C.orange, bgcolor: C.orangeLight },
          }}
        >
          <UploadFileIcon sx={{ fontSize: 40, color: C.gray300 }} />
          <Typography sx={{ fontSize: 15, fontWeight: 700, color: C.gray700, mt: '8px' }}>
            Add two or more labels PDFs
          </Typography>
          <Typography sx={{ fontSize: 12, color: C.gray400, mt: '4px' }}>
            They'll be merged into one sorted batch — nothing uploaded yet
          </Typography>
        </Paper>
      )}

      {!loading && (
        <Paper elevation={0} sx={{ border: `1px solid ${C.border}`, borderRadius: '12px', overflow: 'hidden' }}>
          <Tabs
            value={activeTab}
            onChange={(_, v) => setActiveTab(v)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{
              borderBottom: `1px solid ${C.gray100}`,
              minHeight: 42,
              '& .MuiTab-root': { textTransform: 'none', fontWeight: 700, fontSize: 12.5, minHeight: 42, py: '8px' },
            }}
          >
            <Tab value="overview" label="Overview" />
            <Tab value="sku" label={`By SKU${skuGroups.length ? ` (${skuGroups.length})` : ''}`} />
            <Tab
              value="courier"
              label={`By Delivery Partner${courierGroups.length ? ` (${courierGroups.length})` : ''}`}
            />
            <Tab value="all" label={`All Labels${pageDetails.length ? ` (${pageDetails.length})` : ''}`} />
            <Tab value="history" label="Processing History" />
          </Tabs>

          {/* ── Overview ─────────────────────────────────────────────────── */}
          {activeTab === 'overview' && (
            <Box sx={{ p: '16px 18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {!result ? (
                <Typography sx={{ fontSize: 12, color: C.gray400 }}>Upload a batch to see its stats here.</Typography>
              ) : (
                <>
                  {Object.keys(result.per_business || {}).length > 1 && (
                    <Alert severity="info" sx={{ borderRadius: '10px' }}>
                      <Typography sx={{ fontSize: 13, fontWeight: 800, mb: '4px' }}>
                        This batch covers {Object.keys(result.per_business).length} businesses
                      </Typography>
                      {Object.entries(result.per_business).map(([name, n]) => (
                        <Typography key={name} sx={{ fontSize: 12.5 }}>
                          <strong>{name}</strong> — {n} label{n === 1 ? '' : 's'}
                        </Typography>
                      ))}
                      <Typography sx={{ fontSize: 11.5, mt: '5px', opacity: 0.85 }}>
                        Each label was filed against the business whose catalogue prices its SKU.
                      </Typography>
                    </Alert>
                  )}

                  {(result.ambiguous_skus || []).length > 0 && (
                    <Alert severity="warning" sx={{ borderRadius: '10px' }}>
                      <Typography sx={{ fontSize: 13, fontWeight: 800, mb: '4px' }}>
                        {result.ambiguous_skus.length} SKU{result.ambiguous_skus.length > 1 ? 's are' : ' is'} priced by
                        more than one business
                      </Typography>
                      {result.ambiguous_skus.map((a) => (
                        <Typography key={a.sku} sx={{ fontSize: 12.5, fontFamily: 'monospace' }}>
                          {a.sku} — {a.businesses.join(' · ')}
                        </Typography>
                      ))}
                      <Typography sx={{ fontSize: 11.5, mt: '5px', opacity: 0.85 }}>
                        There's no way to tell which one these belong to, so they were filed under the business you have
                        selected.
                      </Typography>
                    </Alert>
                  )}

                  <Box sx={{ display: 'flex', gap: '30px', flexWrap: 'wrap' }}>
                    <Stat label="Files merged" value={result.files_merged ?? '—'} tone={C.orange} />
                    <Stat label="Pages" value={result.total_pages ?? 0} />
                    <Stat label="Labels" value={labels} />
                    <Stat label="Products" value={result.total_unique_skus ?? skuTable.length} />
                    <Stat label="Units" value={units} />
                    {multiQty > 0 && <Stat label="Multi-qty" value={multiQty} tone={C.amber} />}
                    <Stat label="Saved / Updated" value={`${result.db_saved ?? 0} / ${result.db_updated ?? 0}`} />
                  </Box>

                  {extractError && (
                    <Alert severity="error" sx={{ borderRadius: '10px' }} onClose={() => setExtractError('')}>
                      {extractError}
                    </Alert>
                  )}
                </>
              )}
            </Box>
          )}

          {/* ── By SKU ───────────────────────────────────────────────────── */}
          {activeTab === 'sku' && (
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Parent / SKU</TableCell>
                    <TableCell align="right">Labels</TableCell>
                    <TableCell align="right">Units</TableCell>
                    <TableCell align="right">Max qty</TableCell>
                    <TableCell align="right">Download</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {skuGroups.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} align="center" sx={{ color: C.gray400, py: 3 }}>
                        Upload a batch to see products here.
                      </TableCell>
                    </TableRow>
                  ) : (
                    skuGroups.map((g) => {
                      const firstSku = g.children[0]?.sku;
                      const key = g.parent || firstSku;
                      const nUnits = g.children.reduce((s, r) => s + (r.total_qty || 0), 0);
                      const maxQ = g.children.reduce((s, r) => Math.max(s, r.max_qty || 0), 0);
                      return (
                        <TableRow key={key}>
                          <TableCell>
                            {g.parent ? (
                              <>
                                <Typography
                                  sx={{
                                    fontSize: 15,
                                    fontWeight: 800,
                                    color: C.orange,
                                    wordBreak: 'break-all',
                                    lineHeight: 1.3,
                                  }}
                                >
                                  {g.parent}
                                </Typography>
                                <Box
                                  sx={{ pl: '11px', ml: '1px', mt: '3px', borderLeft: `2px solid ${C.orangeBorder}` }}
                                >
                                  {g.children.map((ch) => (
                                    <Typography
                                      key={ch.sku}
                                      sx={{
                                        fontSize: 13,
                                        color: C.gray600,
                                        fontFamily: 'monospace',
                                        wordBreak: 'break-all',
                                        lineHeight: 1.5,
                                      }}
                                    >
                                      {ch.sku} <span style={{ color: C.gray400, fontWeight: 700 }}>×{ch.count}</span>
                                    </Typography>
                                  ))}
                                </Box>
                              </>
                            ) : (
                              <ParentSkuCell sku={firstSku} parentSku={null} onParentAdded={onParentAdded} />
                            )}
                          </TableCell>
                          <TableCell align="right">{g.count}</TableCell>
                          <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
                            {nUnits}
                          </TableCell>
                          <TableCell
                            align="right"
                            sx={{
                              fontFamily: 'monospace',
                              color: maxQ > 1 ? C.amber : C.gray400,
                              fontWeight: maxQ > 1 ? 800 : 400,
                            }}
                          >
                            {maxQ}
                          </TableCell>
                          <TableCell align="right">
                            <Tooltip
                              title={
                                canDownloadSubsets
                                  ? "Download just this group's labels, sorted"
                                  : 'Not available for this batch'
                              }
                            >
                              <span>
                                <IconButton
                                  size="small"
                                  disabled={!canDownloadSubsets || extracting === key}
                                  onClick={() => downloadGroup(g)}
                                >
                                  <DownloadIcon fontSize="inherit" />
                                </IconButton>
                              </span>
                            </Tooltip>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </Box>
          )}

          {/* ── By Delivery Partner ──────────────────────────────────────── */}
          {activeTab === 'courier' && (
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Delivery partner</TableCell>
                    <TableCell align="right">Labels</TableCell>
                    <TableCell align="right">Units</TableCell>
                    <TableCell align="right">% of batch</TableCell>
                    <TableCell align="right">Download</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {courierGroups.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} align="center" sx={{ color: C.gray400, py: 3 }}>
                        Upload a batch to see delivery partners here.
                      </TableCell>
                    </TableRow>
                  ) : (
                    courierGroups.map((c) => {
                      const key = `courier-${c.courier}`;
                      return (
                        <TableRow key={c.courier}>
                          <TableCell sx={{ fontWeight: 700 }}>{c.courier}</TableCell>
                          <TableCell align="right" sx={{ fontFamily: 'monospace', fontWeight: 700 }}>
                            {c.count}
                          </TableCell>
                          <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
                            {c.units}
                          </TableCell>
                          <TableCell align="right" sx={{ fontFamily: 'monospace', color: C.gray400 }}>
                            {pageDetails.length ? ((c.count / pageDetails.length) * 100).toFixed(0) : 0}%
                          </TableCell>
                          <TableCell align="right">
                            <Tooltip
                              title={
                                canDownloadSubsets
                                  ? "Download just this delivery partner's labels, sorted"
                                  : 'Not available for this batch'
                              }
                            >
                              <span>
                                <IconButton
                                  size="small"
                                  disabled={!canDownloadSubsets || extracting === key}
                                  onClick={() => downloadCourier(c.courier)}
                                >
                                  <DownloadIcon fontSize="inherit" />
                                </IconButton>
                              </span>
                            </Tooltip>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </Box>
          )}

          {/* ── All Labels ───────────────────────────────────────────────── */}
          {activeTab === 'all' && (
            <Box>
              <Box
                sx={{
                  p: '12px 16px',
                  borderBottom: `1px solid ${C.gray100}`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  flexWrap: 'wrap',
                }}
              >
                <Typography sx={{ fontWeight: 700, fontSize: 13, color: C.gray800 }}>
                  {filteredDetails.length}
                  {filteredDetails.length !== pageDetails.length ? ` of ${pageDetails.length}` : ''} label
                  {filteredDetails.length === 1 ? '' : 's'}
                </Typography>
                <TextField
                  size="small"
                  placeholder="Search AWB or order ID"
                  value={awbSearch}
                  onChange={(e) => setAwbSearch(e.target.value)}
                  sx={{ ml: 'auto', minWidth: 220, '& input': { fontSize: 13, py: '7px' } }}
                />
              </Box>
              <Box sx={{ overflowX: 'auto', maxHeight: 480 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>Page</TableCell>
                      <TableCell>SKU</TableCell>
                      <TableCell align="right">Qty</TableCell>
                      <TableCell>Order ID</TableCell>
                      <TableCell>AWB</TableCell>
                      <TableCell>Courier</TableCell>
                      <TableCell>Business</TableCell>
                      <TableCell align="right">Download</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredDetails.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} align="center" sx={{ color: C.gray400, py: 4 }}>
                          No labels found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredDetails.map((pd) => {
                        const rowKey = `awb-${pd.sortedIndex}`;
                        return (
                          <TableRow key={`${pd.page}-${pd.sortedIndex}`}>
                            <TableCell>{pd.page}</TableCell>
                            <TableCell sx={{ fontFamily: 'monospace' }}>{pd.sku || '—'}</TableCell>
                            <TableCell
                              align="right"
                              sx={{
                                fontFamily: 'monospace',
                                fontWeight: (pd.qty || 1) > 1 ? 800 : 400,
                                color: (pd.qty || 1) > 1 ? C.amber : C.gray700,
                              }}
                            >
                              {pd.qty || 1}
                            </TableCell>
                            <TableCell>{pd.order_id || '—'}</TableCell>
                            <TableCell sx={{ fontFamily: 'monospace' }}>{pd.awb || '—'}</TableCell>
                            <TableCell>{pd.courier || '—'}</TableCell>
                            <TableCell>{pd.business_name || ''}</TableCell>
                            <TableCell align="right">
                              <Tooltip
                                title={
                                  canDownloadSubsets ? 'Download just this one label' : 'Not available for this batch'
                                }
                              >
                                <span>
                                  <IconButton
                                    size="small"
                                    disabled={!canDownloadSubsets || extracting === rowKey}
                                    onClick={() => downloadSingle(pd)}
                                  >
                                    <DownloadIcon fontSize="inherit" />
                                  </IconButton>
                                </span>
                              </Tooltip>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </Box>
            </Box>
          )}

          {/* ── Processing History ───────────────────────────────────────── */}
          {activeTab === 'history' && (
            <Box sx={{ p: '12px 16px' }}>
              {historyLoading && !history ? (
                <Typography sx={{ fontSize: 12, color: C.gray400 }}>Loading…</Typography>
              ) : !history?.days?.length ? (
                <Typography sx={{ fontSize: 12, color: C.gray400 }}>No labels processed yet.</Typography>
              ) : (
                <>
                  <Typography sx={{ fontSize: 11, color: C.gray400, mb: '10px' }}>
                    Every order processed so far, by date and delivery partner — {history.total_labels} labels total.
                  </Typography>
                  <Box sx={{ display: 'flex', gap: '8px', flexWrap: 'wrap', mb: '14px' }}>
                    {history.courier_totals.map((c) => (
                      <Chip
                        key={c.courier_name}
                        label={`${c.courier_name}: ${c.count}`}
                        size="small"
                        sx={{ bgcolor: C.gray100, color: C.gray700, fontWeight: 700, fontSize: 12 }}
                      />
                    ))}
                  </Box>
                  <Box sx={{ overflowX: 'auto', maxHeight: 420 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell>Date</TableCell>
                          <TableCell align="right">Orders processed</TableCell>
                          <TableCell>By delivery partner</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {history.days.map((d) => (
                          <TableRow key={d.date}>
                            <TableCell sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{d.date}</TableCell>
                            <TableCell align="right" sx={{ fontFamily: 'monospace', fontWeight: 800 }}>
                              {d.total}
                            </TableCell>
                            <TableCell>
                              <Box sx={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                {d.couriers.map((c) => (
                                  <Chip
                                    key={c.courier_name}
                                    label={`${c.courier_name} · ${c.count}`}
                                    size="small"
                                    sx={{
                                      bgcolor: C.orangeLight,
                                      color: C.orange,
                                      fontWeight: 700,
                                      fontSize: 11,
                                      height: 22,
                                    }}
                                  />
                                ))}
                              </Box>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Box>
                </>
              )}
            </Box>
          )}
        </Paper>
      )}
    </Box>
  );
}
