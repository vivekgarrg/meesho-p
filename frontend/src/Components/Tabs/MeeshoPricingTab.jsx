import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { C, S, btn } from '../../App';
import { useBusiness } from '../../contexts/BusinessContext';
import DownloadIcon from '@mui/icons-material/Download';
import SaveIcon from '@mui/icons-material/Save';
import SearchIcon from '@mui/icons-material/Search';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import FilterAltIcon from '@mui/icons-material/FilterAlt';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
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

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [msg, setMsg] = useState(null);
  const [search, setSearch] = useState('');
  const [maxProfit, setMaxProfit] = useState('');
  const [page, setPage] = useState(1);

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

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(1);
  }, [search, maxProfit, workspaceBusinessId]);

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

  // Download the price-update sheet via fetch + blob (not a plain navigation)
  // so the patched fetch attaches the JWT — a window.location navigation would
  // hit the endpoint unauthenticated and 401.
  const handleDownload = async () => {
    if (!workspaceBase) return;
    try {
      const res = await fetch(`${workspaceBase}/meesho-price-update/download/`);
      if (!res.ok) {
        setMsg({ type: 'error', text: 'Could not download the price update sheet.' });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'meesho_price_update.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setMsg({ type: 'error', text: 'Could not download the price update sheet.' });
    }
  };

  const pageItems = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));

  const withMSP = items.filter((i) => {
    const e = edits[i.inventory_id];
    return e?.new_msp != null || i.new_msp != null;
  }).length;

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
              Fast repricing — set New MSP / WDRP / MRP and download the update sheet
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
          <strong>Flow:</strong> Pick a workspace business, set the New MSP (and optionally WDRP / MRP) for the SKUs you
          want to reprice, then <strong>Download Sheet</strong> to export the update file for Meesho.
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
      </div>

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
                        '#',
                        'Catalog / Style',
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
                        <td colSpan={10} style={{ ...S.td, textAlign: 'center', padding: 56, color: C.gray400 }}>
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

                        const msp = edit.new_msp !== undefined ? edit.new_msp : item.new_msp;
                        const wdrp = edit.new_wdrp !== undefined ? edit.new_wdrp : item.new_wdrp;
                        const mrp = edit.new_mrp !== undefined ? edit.new_mrp : item.new_mrp;

                        return (
                          <tr key={item.inventory_id} style={{ background: rowBg }}>
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

                            <td style={{ ...S.td, textAlign: 'right', fontFamily: 'monospace' }}>
                              {item.delivery_count > 0 ? (
                                <span
                                  style={{
                                    fontSize: 11,
                                    fontWeight: 700,
                                    color: C.green,
                                    background: C.greenLight,
                                    padding: '1px 6px',
                                    borderRadius: 4,
                                  }}
                                >
                                  {item.delivery_count}
                                </span>
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
