import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { C, S, btn, Tag } from '../../App';
import { useBusiness } from '../../contexts/BusinessContext';
import DownloadIcon from '@mui/icons-material/Download';
import SaveIcon from '@mui/icons-material/Save';
import SearchIcon from '@mui/icons-material/Search';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import FilterAltIcon from '@mui/icons-material/FilterAlt';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import LinkIcon from '@mui/icons-material/Link';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import HubIcon from '@mui/icons-material/Hub';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import { CircularProgress, Tooltip } from '@mui/material';

const PAGE_SIZE = 50;

const LOW_MARGIN_THRESHOLD = 50;

const baseForBusiness = (businessId) => `/api/business/${businessId}`;

async function jsonFetch(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.detail || data?.error || 'Request failed');
  }
  return data;
}

const fmt2 = (n) =>
  n === null || n === undefined
    ? '—'
    : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function ProfitBadge({ value }) {
  if (value === null || value === undefined) return <span style={{ color: C.gray300, fontSize: 12 }}>No data</span>;
  const color = value < 0 ? C.red : value < 50 ? C.amber : C.green;
  const bg = value < 0 ? C.redLight : value < 50 ? C.amberLight : C.greenLight;
  return (
    <span
      style={{
        fontFamily: 'monospace',
        fontWeight: 700,
        fontSize: 13,
        color,
        background: bg,
        padding: '3px 8px',
        borderRadius: 6,
        display: 'inline-block',
      }}
    >
      {value >= 0 ? '+' : ''}
      {fmt2(value)}
    </span>
  );
}

function NumInput({ value, placeholder, onChange, highlight }) {
  return (
    <input
      type="number"
      min={0}
      step={0.01}
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      style={{
        ...S.inp,
        width: 90,
        padding: '5px 8px',
        fontSize: 12,
        fontFamily: 'monospace',
        fontWeight: 600,
        borderColor: highlight ? C.orange : C.gray200,
        background: highlight ? C.orangeLight : C.white,
      }}
    />
  );
}

export function MeeshoPricingTab() {
  const { businesses, activeBusinessId } = useBusiness();

  const [workspaceBusinessId, setWorkspaceBusinessId] = useState(activeBusinessId ?? null);
  const [sourceBusinessId, setSourceBusinessId] = useState('');

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [linking, setLinking] = useState(false);
  const [creatingParent, setCreatingParent] = useState(false);

  const [msg, setMsg] = useState(null);
  const [search, setSearch] = useState('');
  const [maxProfit, setMaxProfit] = useState('');
  const [page, setPage] = useState(1);

  const [parents, setParents] = useState([]);
  const [unlinked, setUnlinked] = useState([]);
  const [sourceParents, setSourceParents] = useState([]);
  const [importSummary, setImportSummary] = useState(null);
  const [importRunning, setImportRunning] = useState(false);

  const [selectedParentId, setSelectedParentId] = useState('');
  const [newParentId, setNewParentId] = useState('');
  const [selectedSkuIds, setSelectedSkuIds] = useState(new Set());
  const [draggingSkuId, setDraggingSkuId] = useState('');
  const [dropParentId, setDropParentId] = useState('');

  const [edits, setEdits] = useState({});
  const [savedIds, setSavedIds] = useState(new Set());

  useEffect(() => {
    if (activeBusinessId) {
      setWorkspaceBusinessId(activeBusinessId);
    }
  }, [activeBusinessId]);

  const workspaceBusiness = useMemo(
    () => businesses.find((b) => b.id === workspaceBusinessId) || null,
    [businesses, workspaceBusinessId],
  );

  const workspaceBase = useMemo(
    () => (workspaceBusinessId ? baseForBusiness(workspaceBusinessId) : null),
    [workspaceBusinessId],
  );

  const currentSkuIds = useMemo(() => {
    const fromInventory = items.map((i) => (i.style_id || '').trim()).filter(Boolean);
    const fromUnlinked = unlinked.map((u) => (u.sku_id || '').trim()).filter(Boolean);
    return new Set([...fromInventory, ...fromUnlinked]);
  }, [items, unlinked]);

  const parentBySku = useMemo(() => {
    const map = {};
    parents.forEach((p) => {
      (p.sku_ids || []).forEach((sku) => {
        map[sku] = p.item_id;
      });
    });
    return map;
  }, [parents]);

  const selectedSkuList = useMemo(() => Array.from(selectedSkuIds), [selectedSkuIds]);

  const sourceOptions = useMemo(
    () => businesses.filter((b) => b.id !== workspaceBusinessId),
    [businesses, workspaceBusinessId],
  );

  const sourceSuggestions = useMemo(() => {
    return sourceParents
      .map((p) => {
        const allSkus = p.sku_ids || [];
        const matched = allSkus.filter((sku) => currentSkuIds.has(sku));
        if (!matched.length) return null;
        return {
          ...p,
          matchedSkus: matched,
          matchedCount: matched.length,
          totalCount: allSkus.length,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.matchedCount - a.matchedCount);
  }, [sourceParents, currentSkuIds]);

  const parentCards = useMemo(() => {
    return [...parents].sort((a, b) => (b.sku_ids || []).length - (a.sku_ids || []).length).slice(0, 14);
  }, [parents]);

  const sourceCoverage = useMemo(
    () => sourceSuggestions.reduce((acc, row) => acc + row.matchedCount, 0),
    [sourceSuggestions],
  );

  const fetchData = useCallback(async () => {
    if (!workspaceBase) return;
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (search.trim()) p.set('q', search.trim());
      if (maxProfit !== '') p.set('max_profit', maxProfit);
      const data = await jsonFetch(`${workspaceBase}/meesho-price-update/?${p.toString()}`);
      setItems(data.items || []);
      setTotal(data.total ?? 0);
    } finally {
      setLoading(false);
    }
  }, [workspaceBase, search, maxProfit]);

  const fetchGroupingData = useCallback(async () => {
    if (!workspaceBase) return;
    const [parentsData, unlinkedData] = await Promise.all([
      jsonFetch(`${workspaceBase}/parent-prices/`),
      jsonFetch(`${workspaceBase}/final-prices/unlinked/`),
    ]);
    setParents(parentsData.results || []);
    setUnlinked(unlinkedData.results || []);
  }, [workspaceBase]);

  const fetchSourceParents = useCallback(async () => {
    if (!sourceBusinessId) {
      setSourceParents([]);
      return;
    }
    const base = baseForBusiness(Number(sourceBusinessId));
    const data = await jsonFetch(`${base}/parent-prices/`);
    setSourceParents(data.results || []);
  }, [sourceBusinessId]);

  useEffect(() => {
    fetchData();
    fetchGroupingData();
    setSelectedSkuIds(new Set());
    setSelectedParentId('');
  }, [fetchData, fetchGroupingData]);

  useEffect(() => {
    setPage(1);
  }, [search, maxProfit, workspaceBusinessId]);

  useEffect(() => {
    fetchSourceParents();
  }, [fetchSourceParents]);

  const setEdit = (id, field, val) => {
    setEdits((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || {}), [field]: val },
    }));
    setSavedIds((prev) => {
      const s = new Set(prev);
      s.delete(id);
      return s;
    });
  };

  const pendingCount = Object.keys(edits).length;
  const selectedCount = selectedSkuIds.size;

  const handleSave = async () => {
    if (!workspaceBase) return;
    const payload = Object.entries(edits).map(([id, fields]) => ({
      inventory_id: Number(id),
      new_msp: fields.new_msp ?? null,
      new_wdrp: fields.new_wdrp ?? null,
      new_mrp: fields.new_mrp ?? null,
    }));
    setSaving(true);
    try {
      const data = await jsonFetch(`${workspaceBase}/meesho-price-update/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      setSavedIds((prev) => {
        const s = new Set(prev);
        payload.forEach((p) => s.add(p.inventory_id));
        return s;
      });
      setEdits({});
      setMsg({ type: 'success', text: `Saved ${data.updated} price update(s).` });
      fetchData();
    } catch {
      setMsg({ type: 'error', text: 'Failed to save changes.' });
    } finally {
      setSaving(false);
    }
  };

  const handleDownload = () => {
    if (!workspaceBase) return;
    window.location.href = `${workspaceBase}/meesho-price-update/download/`;
  };

  const toggleSkuSelection = (skuId) => {
    if (!skuId) return;
    setSelectedSkuIds((prev) => {
      const next = new Set(prev);
      if (next.has(skuId)) next.delete(skuId);
      else next.add(skuId);
      return next;
    });
  };

  const selectVisibleSkus = () => {
    setSelectedSkuIds((prev) => {
      const next = new Set(prev);
      pageItems.forEach((item) => {
        const sku = (item.style_id || '').trim();
        if (sku) next.add(sku);
      });
      return next;
    });
  };

  const clearSelections = () => setSelectedSkuIds(new Set());

  const linkSkusToParent = async (skuIds, parentId) => {
    if (!workspaceBase || !parentId || !skuIds.length) return { success: 0, failed: 0 };
    const result = await jsonFetch(`${workspaceBase}/link-sku/bulk/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent_id: parentId, sku_ids: skuIds }),
    });
    return {
      success: result.linked || 0,
      failed: result.failed || 0,
      failedSkus: result.failed_skus || [],
    };
  };

  const handleBatchLink = async () => {
    if (!selectedParentId || !selectedSkuList.length) return;
    setLinking(true);
    try {
      const result = await linkSkusToParent(selectedSkuList, selectedParentId);
      setMsg({
        type: result.failed ? 'error' : 'success',
        text: result.failed
          ? `Linked ${result.success} SKU(s); ${result.failed} failed.`
          : `Linked ${result.success} SKU(s) to ${selectedParentId}.`,
      });
      setSelectedSkuIds(new Set());
      await fetchGroupingData();
      await fetchData();
    } catch {
      setMsg({ type: 'error', text: 'Failed to link selected SKUs.' });
    } finally {
      setLinking(false);
    }
  };

  const handleCreateParent = async () => {
    const parentId = newParentId.trim();
    if (!workspaceBase || !parentId) return;
    setCreatingParent(true);
    try {
      await jsonFetch(`${workspaceBase}/parent-prices/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: parentId }),
      });
      setMsg({ type: 'success', text: `Created parent group ${parentId}.` });
      setNewParentId('');
      setSelectedParentId(parentId);
      await fetchGroupingData();
    } catch {
      setMsg({ type: 'error', text: 'Could not create parent group.' });
    } finally {
      setCreatingParent(false);
    }
  };

  const applySourceGroup = async (sourceParent) => {
    if (!workspaceBase) return;
    setImportRunning(true);
    try {
      const result = await jsonFetch(`${workspaceBase}/parent-groups/import/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_business_id: Number(sourceBusinessId),
          parent_ids: [sourceParent.item_id],
        }),
      });

      setImportSummary(result);

      const linked = result.linked || 0;
      const failed = result.failed || 0;
      setMsg({
        type: failed ? 'error' : 'success',
        text: failed
          ? `Imported ${linked} SKU(s) from source group; ${failed} failed.`
          : `Imported ${linked} SKU(s) from source group ${sourceParent.item_id}.`,
      });
      await fetchGroupingData();
      await fetchData();
    } catch {
      setMsg({ type: 'error', text: 'Failed to import source business grouping.' });
    } finally {
      setImportRunning(false);
    }
  };

  const importAllSourceGroups = async () => {
    if (!workspaceBase || !sourceBusinessId || sourceSuggestions.length === 0) return;
    setImportRunning(true);
    try {
      const result = await jsonFetch(`${workspaceBase}/parent-groups/import/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_business_id: Number(sourceBusinessId),
          parent_ids: sourceSuggestions.map((g) => g.item_id),
        }),
      });

      setImportSummary(result);
      setMsg({
        type: result.failed ? 'error' : 'success',
        text: result.failed
          ? `Imported ${result.linked || 0} SKU(s); ${result.failed || 0} failed.`
          : `Imported ${result.linked || 0} SKU(s) from ${result.groups_imported || 0} group(s).`,
      });
      await fetchGroupingData();
      await fetchData();
    } catch {
      setMsg({ type: 'error', text: 'Bulk import failed.' });
    } finally {
      setImportRunning(false);
    }
  };

  const handleDropToParent = async (parentId) => {
    if (!draggingSkuId || !parentId) return;
    setDropParentId('');
    setLinking(true);
    try {
      const result = await linkSkusToParent([draggingSkuId], parentId);
      setMsg({
        type: result.failed ? 'error' : 'success',
        text: result.failed
          ? `Could not link ${draggingSkuId} to ${parentId}.`
          : `Linked ${draggingSkuId} to ${parentId}.`,
      });
      setSelectedSkuIds((prev) => {
        const next = new Set(prev);
        next.delete(draggingSkuId);
        return next;
      });
      await fetchGroupingData();
      await fetchData();
    } catch {
      setMsg({ type: 'error', text: `Could not link ${draggingSkuId} to ${parentId}.` });
    } finally {
      setDraggingSkuId('');
      setLinking(false);
    }
  };

  const pageItems = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));

  const withMSP = items.filter((i) => {
    const e = edits[i.inventory_id];
    return e?.new_msp != null || i.new_msp != null;
  }).length;

  const linkedSkuCount = parents.reduce((acc, p) => acc + (p.sku_ids || []).length, 0);
  const lowMarginCount = items.filter((i) => i.avg_profit != null && i.avg_profit < LOW_MARGIN_THRESHOLD).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <TrendingDownIcon style={{ color: C.red, fontSize: 22 }} />
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: C.gray800 }}>SKU Pricing Studio</h1>
            <div style={{ fontSize: 12, color: C.gray400, marginTop: 2 }}>
              Architected for fast repricing and clean parent-SKU grouping across businesses
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <label style={S.label}>Workspace business</label>
            <select
              value={workspaceBusinessId ?? ''}
              onChange={(e) => setWorkspaceBusinessId(Number(e.target.value))}
              style={{ ...S.inp, width: 220, padding: '8px 12px' }}
            >
              {businesses.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          {pendingCount > 0 && (
            <button onClick={handleSave} disabled={saving} style={btn('success', 'md')}>
              {saving ? (
                <CircularProgress size={14} style={{ color: '#fff' }} />
              ) : (
                <SaveIcon style={{ fontSize: 16 }} />
              )}
              &nbsp;Save {pendingCount} change{pendingCount !== 1 ? 's' : ''}
            </button>
          )}
          <Tooltip
            title={withMSP === 0 ? 'Set New MSP for at least one SKU first' : `Download sheet for ${withMSP} SKU(s)`}
          >
            <span>
              <button
                onClick={handleDownload}
                disabled={withMSP === 0}
                style={{ ...btn('ghostOrange', 'md'), opacity: withMSP === 0 ? 0.5 : 1 }}
              >
                <DownloadIcon style={{ fontSize: 16 }} />
                &nbsp;Download Sheet ({withMSP})
              </button>
            </span>
          </Tooltip>
        </div>
      </div>

      <div
        style={{
          background: '#EEF2FF',
          border: '1px solid #C7D2FE',
          borderRadius: 12,
          padding: '14px 18px',
          fontSize: 13,
          color: '#3730A3',
          display: 'flex',
          gap: 10,
          alignItems: 'flex-start',
        }}
      >
        <span style={{ fontSize: 18, lineHeight: 1 }}>💡</span>
        <div>
          <strong>Flow:</strong> Pick a workspace business, reprice SKUs, and link loose SKUs into parent groups. Use{' '}
          <strong>Cross-business import</strong> in the side panel to copy parent grouping patterns from another
          business where SKU IDs overlap.
        </div>
      </div>

      {msg && (
        <div
          style={{
            padding: '12px 18px',
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 500,
            background: msg.type === 'success' ? C.greenLight : C.redLight,
            color: msg.type === 'success' ? C.green : C.red,
            border: `1px solid ${msg.type === 'success' ? C.greenBorder : C.redBorder}`,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {msg.type === 'success' ? (
            <CheckCircleIcon style={{ fontSize: 18 }} />
          ) : (
            <WarningAmberIcon style={{ fontSize: 18 }} />
          )}
          {msg.text}
          <button
            onClick={() => setMsg(null)}
            style={{
              marginLeft: 'auto',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'inherit',
              fontSize: 16,
            }}
          >
            ×
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        <div style={{ ...S.card, padding: '14px 16px', borderTop: `3px solid ${C.blue}` }}>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.gray500, fontSize: 12, fontWeight: 700 }}
          >
            <Inventory2Icon style={{ fontSize: 16 }} /> Loaded SKUs
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: C.gray800, marginTop: 6 }}>{total}</div>
        </div>
        <div style={{ ...S.card, padding: '14px 16px', borderTop: `3px solid ${C.red}` }}>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.gray500, fontSize: 12, fontWeight: 700 }}
          >
            <TrendingDownIcon style={{ fontSize: 16 }} /> Low Margin (&lt; ₹{LOW_MARGIN_THRESHOLD})
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: C.red, marginTop: 6 }}>{lowMarginCount}</div>
        </div>
        <div style={{ ...S.card, padding: '14px 16px', borderTop: `3px solid ${C.orange}` }}>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.gray500, fontSize: 12, fontWeight: 700 }}
          >
            <LinkIcon style={{ fontSize: 16 }} /> Unlinked SKUs
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: C.orange, marginTop: 6 }}>{unlinked.length}</div>
        </div>
        <div style={{ ...S.card, padding: '14px 16px', borderTop: `3px solid ${C.green}` }}>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.gray500, fontSize: 12, fontWeight: 700 }}
          >
            <HubIcon style={{ fontSize: 16 }} /> Linked in Groups
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: C.green, marginTop: 6 }}>{linkedSkuCount}</div>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: 16,
          alignItems: 'start',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label style={S.label}>
                <FilterAltIcon style={{ fontSize: 13, verticalAlign: 'middle' }} /> Show SKUs with avg profit below
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14, color: C.gray500, fontWeight: 600 }}>₹</span>
                <input
                  type="number"
                  value={maxProfit}
                  onChange={(e) => setMaxProfit(e.target.value)}
                  placeholder="e.g. 50 (blank = all)"
                  style={{ ...S.inp, width: 200 }}
                />
                {maxProfit !== '' && (
                  <button onClick={() => setMaxProfit('')} style={{ ...btn('ghost', 'sm'), padding: '6px 10px' }}>
                    ✕ Clear
                  </button>
                )}
              </div>
            </div>

            <div style={{ flex: 1, minWidth: 250 }}>
              <label style={S.label}>Search</label>
              <div style={{ position: 'relative' }}>
                <SearchIcon
                  style={{
                    position: 'absolute',
                    left: 10,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    fontSize: 17,
                    color: C.gray400,
                  }}
                />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Catalog / product / style ID"
                  style={{ ...S.inp, paddingLeft: 34 }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', alignSelf: 'flex-end', paddingBottom: 2 }}>
              <button onClick={selectVisibleSkus} style={btn('ghost', 'sm')}>
                Select Page
              </button>
              <button onClick={clearSelections} style={btn('ghost', 'sm')}>
                Clear
              </button>
              <span style={{ fontSize: 12, color: C.gray500, fontWeight: 600 }}>{selectedCount} selected</span>
            </div>
          </div>

          <div style={{ ...S.card, padding: 0, overflow: 'hidden' }}>
            <div
              style={{
                padding: '10px 14px',
                borderBottom: `1px solid ${C.gray100}`,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div style={{ fontSize: 12, color: C.gray500, fontWeight: 700 }}>
                {loading ? 'Loading' : `${total} SKU${total !== 1 ? 's' : ''}`} in{' '}
                {workspaceBusiness?.name || 'selected business'}
              </div>
              <div style={{ fontSize: 12, color: C.gray500 }}>
                Selected for grouping: <strong>{selectedCount}</strong>
              </div>
            </div>

            {loading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 56 }}>
                <CircularProgress style={{ color: C.orange }} />
              </div>
            ) : (
              <>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr>
                        {[
                          'Sel',
                          '#',
                          'Catalog / Style',
                          'Group',
                          'Deliveries',
                          'Avg Settlement',
                          'Cost',
                          'Avg Profit/unit',
                          'Current',
                          'New MSP',
                          'WDRP',
                          'MRP',
                        ].map((h) => (
                          <th key={h} style={{ ...S.th, fontSize: 10, whiteSpace: 'nowrap' }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pageItems.length === 0 ? (
                        <tr>
                          <td colSpan={12} style={{ ...S.td, textAlign: 'center', padding: 56, color: C.gray400 }}>
                            {total === 0 && !loading
                              ? maxProfit !== ''
                                ? `No SKUs with avg profit below ₹${maxProfit} - try raising the threshold`
                                : 'No inventory data. Upload a Meesho inventory file first.'
                              : 'No results.'}
                          </td>
                        </tr>
                      ) : (
                        pageItems.map((item, idx) => {
                          const globalIdx = (page - 1) * PAGE_SIZE + idx;
                          const rowBg = globalIdx % 2 === 0 ? C.white : C.gray50;
                          const edit = edits[item.inventory_id] || {};
                          const isSaved = savedIds.has(item.inventory_id);
                          const hasEdit = !!edits[item.inventory_id];
                          const skuId = (item.style_id || '').trim();
                          const isSelected = skuId && selectedSkuIds.has(skuId);

                          const msp = edit.new_msp !== undefined ? edit.new_msp : item.new_msp;
                          const wdrp = edit.new_wdrp !== undefined ? edit.new_wdrp : item.new_wdrp;
                          const mrp = edit.new_mrp !== undefined ? edit.new_mrp : item.new_mrp;

                          return (
                            <tr key={item.inventory_id} style={{ background: rowBg }}>
                              <td style={{ ...S.td, width: 36 }}>
                                <input
                                  type="checkbox"
                                  checked={!!isSelected}
                                  onChange={() => toggleSkuSelection(skuId)}
                                  disabled={!skuId}
                                />
                              </td>

                              <td style={{ ...S.td, color: C.gray400, fontSize: 10, width: 32 }}>{item.serial_no}</td>

                              <td style={{ ...S.td, maxWidth: 220 }}>
                                <div
                                  style={{
                                    fontWeight: 600,
                                    color: C.gray700,
                                    fontSize: 11,
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    maxWidth: 210,
                                  }}
                                  title={item.catalog_name}
                                >
                                  {item.catalog_name}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                                  <span
                                    style={{
                                      fontSize: 10,
                                      fontFamily: 'monospace',
                                      color: C.orange,
                                      background: C.orangeLight,
                                      display: 'inline-block',
                                      padding: '1px 5px',
                                      borderRadius: 4,
                                    }}
                                  >
                                    {item.style_id || '-'}
                                  </span>
                                  <span style={{ fontSize: 10, color: C.gray400 }}>{item.product_name || ''}</span>
                                </div>
                              </td>

                              <td style={{ ...S.td }}>
                                {skuId && parentBySku[skuId] ? (
                                  <Tag variant="green">{parentBySku[skuId]}</Tag>
                                ) : (
                                  <Tag variant="amber">unlinked</Tag>
                                )}
                              </td>

                              <td style={{ ...S.td, textAlign: 'right', fontFamily: 'monospace' }}>
                                {item.delivery_count > 0 ? (
                                  <Tag variant="green">{item.delivery_count}</Tag>
                                ) : (
                                  <span style={{ color: C.gray300 }}>-</span>
                                )}
                              </td>

                              <td style={{ ...S.td, textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>
                                {item.avg_settlement != null ? (
                                  fmt2(item.avg_settlement)
                                ) : (
                                  <span style={{ color: C.gray300 }}>-</span>
                                )}
                              </td>

                              <td style={{ ...S.td, textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>
                                {item.cost != null ? (
                                  fmt2(item.cost)
                                ) : (
                                  <span style={{ color: C.gray300 }}>No pricing</span>
                                )}
                              </td>

                              <td style={{ ...S.td, textAlign: 'center' }}>
                                <ProfitBadge value={item.avg_profit} />
                              </td>

                              <td
                                style={{
                                  ...S.td,
                                  textAlign: 'right',
                                  fontFamily: 'monospace',
                                  fontSize: 12,
                                  color: C.gray500,
                                }}
                              >
                                {item.current_price != null ? (
                                  fmt2(item.current_price)
                                ) : (
                                  <span style={{ color: C.gray300 }}>-</span>
                                )}
                              </td>

                              <td style={{ ...S.td }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <NumInput
                                    value={msp}
                                    placeholder="MSP"
                                    onChange={(val) => setEdit(item.inventory_id, 'new_msp', val)}
                                    highlight={msp != null}
                                  />
                                  {isSaved && !hasEdit && msp != null && (
                                    <Tooltip title="Saved">
                                      <CheckCircleIcon style={{ fontSize: 15, color: C.green }} />
                                    </Tooltip>
                                  )}
                                </div>
                              </td>

                              <td style={{ ...S.td }}>
                                <NumInput
                                  value={wdrp}
                                  placeholder="WDRP"
                                  onChange={(val) => setEdit(item.inventory_id, 'new_wdrp', val)}
                                  highlight={wdrp != null}
                                />
                              </td>

                              <td style={{ ...S.td }}>
                                <NumInput
                                  value={mrp}
                                  placeholder="MRP"
                                  onChange={(val) => setEdit(item.inventory_id, 'new_mrp', val)}
                                  highlight={mrp != null}
                                />
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {items.length > PAGE_SIZE && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 20px',
                      borderTop: `1px solid ${C.gray100}`,
                    }}
                  >
                    <span style={{ fontSize: 12, color: C.gray400 }}>
                      {Math.min((page - 1) * PAGE_SIZE + 1, items.length)}-{Math.min(page * PAGE_SIZE, items.length)} of{' '}
                      {items.length}
                    </span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => setPage((p) => p - 1)}
                        disabled={page === 1}
                        style={{ ...btn('ghost', 'sm'), opacity: page === 1 ? 0.4 : 1 }}
                      >
                        Prev
                      </button>
                      <span style={{ fontSize: 12, color: C.gray500, padding: '0 6px', alignSelf: 'center' }}>
                        Page {page} / {totalPages}
                      </span>
                      <button
                        onClick={() => setPage((p) => p + 1)}
                        disabled={page >= totalPages}
                        style={{ ...btn('ghost', 'sm'), opacity: page >= totalPages ? 0.4 : 1 }}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div style={{ ...S.card, position: 'sticky', top: 10, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AccountTreeIcon style={{ color: C.orange }} />
            <h3 style={{ fontSize: 15, fontWeight: 800, color: C.gray800 }}>SKU Grouping Studio</h3>
          </div>

          <div style={{ fontSize: 12, color: C.gray500, lineHeight: 1.5 }}>
            Build parent groups faster: select SKUs from the table or unlinked tray, pick a parent, and link in one
            action.
          </div>

          <div>
            <label style={S.label}>Target parent group</label>
            <select
              value={selectedParentId}
              onChange={(e) => setSelectedParentId(e.target.value)}
              style={{ ...S.inp, width: '100%' }}
            >
              <option value="">Select parent</option>
              {parents.map((p) => (
                <option key={p.item_id} value={p.item_id}>
                  {p.item_id} ({(p.sku_ids || []).length} skus)
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={newParentId}
              onChange={(e) => setNewParentId(e.target.value)}
              placeholder="Create new parent ID"
              style={{ ...S.inp, flex: 1 }}
            />
            <button
              onClick={handleCreateParent}
              disabled={creatingParent || !newParentId.trim()}
              style={btn('ghost', 'sm')}
            >
              {creatingParent ? 'Creating' : 'Create'}
            </button>
          </div>

          <button
            onClick={handleBatchLink}
            disabled={!selectedParentId || selectedCount === 0 || linking}
            style={{ ...btn('primary', 'md'), width: '100%' }}
          >
            {linking
              ? 'Linking'
              : `Link ${selectedCount} SKU${selectedCount !== 1 ? 's' : ''} to ${selectedParentId || 'parent'}`}
          </button>

          <div>
            <label style={S.label}>Unlinked SKU quick-pick ({unlinked.length})</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 140, overflowY: 'auto', padding: 2 }}>
              {unlinked.length === 0 ? (
                <span style={{ fontSize: 12, color: C.gray400 }}>No unlinked SKUs.</span>
              ) : (
                unlinked.map((u) => {
                  const isSelected = selectedSkuIds.has(u.sku_id);
                  return (
                    <button
                      key={u.sku_id}
                      onClick={() => toggleSkuSelection(u.sku_id)}
                      draggable
                      onDragStart={() => setDraggingSkuId(u.sku_id)}
                      onDragEnd={() => {
                        setDraggingSkuId('');
                        setDropParentId('');
                      }}
                      style={{
                        border: `1px solid ${isSelected ? C.blue : C.gray200}`,
                        background: isSelected ? C.blueLight : C.white,
                        color: isSelected ? C.blue : C.gray700,
                        borderRadius: 16,
                        fontSize: 11,
                        fontFamily: 'monospace',
                        cursor: 'pointer',
                        padding: '4px 8px',
                      }}
                    >
                      {u.sku_id}
                    </button>
                  );
                })
              )}
            </div>
            <div style={{ fontSize: 11, color: C.gray400, marginTop: 6 }}>
              Tip: drag an unlinked SKU chip and drop it onto a parent card below.
            </div>
          </div>

          <div style={{ borderTop: `1px solid ${C.gray100}`, paddingTop: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.gray700, marginBottom: 8 }}>Quick Drop Targets</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
              {parentCards.length === 0 ? (
                <div style={{ fontSize: 12, color: C.gray400 }}>No parent groups found.</div>
              ) : (
                parentCards.map((p) => {
                  const activeDrop = dropParentId === p.item_id;
                  return (
                    <div
                      key={p.item_id}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDropParentId(p.item_id);
                      }}
                      onDragLeave={() => setDropParentId('')}
                      onDrop={(e) => {
                        e.preventDefault();
                        handleDropToParent(p.item_id);
                      }}
                      style={{
                        border: `1px dashed ${activeDrop ? C.blue : C.gray300}`,
                        borderRadius: 10,
                        padding: '8px 10px',
                        background: activeDrop ? C.blueLight : C.white,
                        transition: 'all .15s ease',
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 700, color: C.gray700 }}>{p.item_id}</div>
                      <div style={{ fontSize: 11, color: C.gray500 }}>{(p.sku_ids || []).length} SKUs</div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div style={{ borderTop: `1px solid ${C.gray100}`, paddingTop: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <CompareArrowsIcon style={{ color: C.green, fontSize: 18 }} />
              <div style={{ fontSize: 13, fontWeight: 700, color: C.gray700 }}>Cross-Business Group Import</div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <select
                value={sourceBusinessId}
                onChange={(e) => setSourceBusinessId(e.target.value)}
                style={{ ...S.inp, flex: 1 }}
              >
                <option value="">Select source business</option>
                {sourceOptions.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <button
                onClick={importAllSourceGroups}
                disabled={!sourceBusinessId || sourceSuggestions.length === 0 || importRunning}
                style={btn('primary', 'sm')}
              >
                {importRunning ? 'Importing' : 'Import All'}
              </button>
            </div>

            <div style={{ fontSize: 12, color: C.gray500, marginTop: 8 }}>
              {sourceBusinessId
                ? `${sourceSuggestions.length} matching source groups found, ${sourceCoverage} SKU overlaps`
                : 'Choose a source business to discover overlapping parent groups'}
            </div>

            {sourceBusinessId && (
              <div
                style={{
                  marginTop: 8,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  maxHeight: 220,
                  overflowY: 'auto',
                }}
              >
                {sourceSuggestions.length === 0 ? (
                  <div style={{ fontSize: 12, color: C.gray400 }}>
                    No SKU overlap found between source and workspace business.
                  </div>
                ) : (
                  sourceSuggestions.map((row) => (
                    <div
                      key={row.item_id}
                      style={{
                        border: `1px solid ${C.gray200}`,
                        borderRadius: 10,
                        padding: '8px 10px',
                        background: C.gray50,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: C.gray700 }}>{row.item_id}</div>
                          <div style={{ fontSize: 11, color: C.gray500 }}>
                            Match {row.matchedCount}/{row.totalCount} SKUs
                          </div>
                        </div>
                        <button onClick={() => applySourceGroup(row)} disabled={linking} style={btn('ghost', 'sm')}>
                          Import
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {importSummary && (
              <div style={{ marginTop: 10, border: `1px solid ${C.gray200}`, borderRadius: 12, overflow: 'hidden' }}>
                <div
                  style={{
                    padding: '10px 12px',
                    background: C.gray50,
                    borderBottom: `1px solid ${C.gray200}`,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.gray700 }}>Last Import Result</div>
                  <button onClick={() => setImportSummary(null)} style={btn('ghost', 'sm')}>
                    Hide
                  </button>
                </div>

                <div style={{ padding: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 8 }}>
                  <div style={{ background: C.blueLight, border: '1px solid #BFDBFE', borderRadius: 8, padding: 8 }}>
                    <div style={{ fontSize: 10, color: C.gray500 }}>Requested</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: C.blue }}>{importSummary.groups_requested || 0}</div>
                  </div>
                  <div style={{ background: C.greenLight, border: `1px solid ${C.greenBorder}`, borderRadius: 8, padding: 8 }}>
                    <div style={{ fontSize: 10, color: C.gray500 }}>Imported</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: C.green }}>{importSummary.groups_imported || 0}</div>
                  </div>
                  <div style={{ background: C.orangeLight, border: `1px solid ${C.orangeBorder}`, borderRadius: 8, padding: 8 }}>
                    <div style={{ fontSize: 10, color: C.gray500 }}>Linked</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: C.orange }}>{importSummary.linked || 0}</div>
                  </div>
                  <div style={{ background: C.redLight, border: `1px solid ${C.redBorder}`, borderRadius: 8, padding: 8 }}>
                    <div style={{ fontSize: 10, color: C.gray500 }}>Failed</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: C.red }}>{importSummary.failed || 0}</div>
                  </div>
                </div>

                <div style={{ padding: '0 10px 10px' }}>
                  <div style={{ fontSize: 11, color: C.gray500, marginBottom: 6 }}>
                    Completed in {importSummary.elapsed_ms || 0} ms
                  </div>
                  <div style={{ maxHeight: 160, overflowY: 'auto', border: `1px solid ${C.gray100}`, borderRadius: 8 }}>
                    {(importSummary.results || []).length === 0 ? (
                      <div style={{ padding: 10, fontSize: 12, color: C.gray400 }}>No group-level rows returned.</div>
                    ) : (
                      (importSummary.results || []).map((r) => (
                        <div
                          key={`${r.source_parent_id}-${r.target_parent_id}`}
                          style={{
                            padding: '8px 10px',
                            borderBottom: `1px solid ${C.gray100}`,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 3,
                          }}
                        >
                          <div style={{ fontSize: 12, fontWeight: 700, color: C.gray700 }}>
                            {r.source_parent_id} -&gt; {r.target_parent_id}
                          </div>
                          <div style={{ fontSize: 11, color: C.gray500 }}>
                            matched {r.matched_skus || 0}, linked {r.linked || 0}, failed {r.failed || 0}
                          </div>
                          {Array.isArray(r.failed_skus) && r.failed_skus.length > 0 && (
                            <div style={{ fontSize: 11, color: C.red }}>
                              failed SKUs: {r.failed_skus.join(', ')}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {pendingCount > 0 && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            right: 32,
            background: C.orange,
            color: '#fff',
            borderRadius: 14,
            padding: '14px 24px',
            boxShadow: '0 8px 24px rgba(109,40,217,0.35)',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            zIndex: 999,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            {pendingCount} unsaved price change{pendingCount !== 1 ? 's' : ''}
          </span>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              background: '#fff',
              color: C.orange,
              border: 'none',
              borderRadius: 8,
              padding: '7px 18px',
              fontWeight: 700,
              cursor: 'pointer',
              fontSize: 13,
              fontFamily: 'inherit',
            }}
          >
            {saving ? 'Saving…' : 'Save All'}
          </button>
          <button
            onClick={() => setEdits({})}
            style={{
              background: 'rgba(255,255,255,0.15)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '7px 12px',
              cursor: 'pointer',
              fontSize: 13,
              fontFamily: 'inherit',
            }}
          >
            Discard
          </button>
        </div>
      )}
    </div>
  );
}
