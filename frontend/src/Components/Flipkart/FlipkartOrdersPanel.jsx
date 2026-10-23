import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import CircularProgress from '@mui/material/CircularProgress';
import { C, S, fmt } from '../../shared';
import { useBusiness } from '../../contexts/BusinessContext';
import { useDateFilter } from '../../contexts/DateFilterContext';
import {
  EmptyState, ErrorNote, FLIPKART_COLOR, Kpi, KpiRow, ORDER_STATUS_META, Pager, PillFilter, SearchBox, Signed, StatusBadge,
  useDebounced, useFlipkartApi,
} from './FlipkartShared';

const PAGE_SIZE = 50;

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  ...Object.entries(ORDER_STATUS_META).map(([value, m]) => ({ value, label: m.label, color: m.color })),
];
const SETTLED_FILTERS = [
  { value: '', label: 'Any payment state' },
  { value: 'yes', label: 'Settled', color: C.green },
  { value: 'no', label: 'Not settled yet', color: C.amber },
];

const count = (n) => Number(n || 0).toLocaleString('en-IN');

export function FlipkartOrdersPanel() {
  const { activeBusiness } = useBusiness();
  const { label: periodLabel } = useDateFilter();
  // Overview's "delivered, not paid yet" card links here pre-filtered.
  const [params] = useSearchParams();
  const [status, setStatus] = useState(ORDER_STATUS_META[params.get('status')] ? params.get('status') : '');
  const [settled, setSettled] = useState(['yes', 'no'].includes(params.get('settled')) ? params.get('settled') : '');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(search);

  const { data, loading, error } = useFlipkartApi('/flipkart-orders/', { status, settled, search: q, page, page_size: PAGE_SIZE });
  const reset = (fn) => (v) => { fn(v); setPage(1); };

  if (error) return <ErrorNote message={error} />;
  if (!data) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
        <CircularProgress style={{ color: FLIPKART_COLOR }} />
      </div>
    );
  }

  const a = data.analytics;
  if (a.total_items === 0 && !status && !settled && !q) {
    return (
      <EmptyState title={`No Flipkart orders for ${activeBusiness?.name || 'this business'} in ${periodLabel}`}>
        Upload Flipkart's Orders report from Upload Data to see every order and its status here. Orders show whether
        they've been settled once the Settlement Report is uploaded too.
      </EmptyState>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: C.gray800, margin: 0 }}>Flipkart orders</h1>
        <p style={{ color: C.gray400, fontSize: 13, margin: '4px 0 0' }}>
          {periodLabel} · every order item in the Orders report, and whether Flipkart has paid for it yet
        </p>
      </div>

      <KpiRow>
        <Kpi label="Order items" value={count(a.total_items)} accent={FLIPKART_COLOR} sub={`${count(a.total_units)} units`} />
        <Kpi label="Delivered" value={count(a.delivered)} accent={C.green} color={C.green} />
        <Kpi label="Returned" value={count(a.returned)} accent={C.red} color={C.red} sub={`${a.return_rate_pct}% of shipped items`} />
        <Kpi label="Cancelled" value={count(a.cancelled)} accent={C.gray400} sub={`${a.cancel_rate_pct}% of orders`} />
        <Kpi label="Settled" value={count(a.settled_items)} accent={C.blue} sub={`${count(a.total_items - a.settled_items)} not paid yet`} />
        <Kpi label="Delivered, not paid" value={count(a.delivered_unsettled)} accent={C.amber} color={a.delivered_unsettled ? C.amber : undefined} />
        <Kpi label="Returned after payout" value={count(a.returned_after_settlement)} accent={C.red} color={a.returned_after_settlement ? C.red : undefined} sub="clawback expected" />
      </KpiRow>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <PillFilter options={STATUS_FILTERS} value={status} onChange={reset(setStatus)} />
        <PillFilter options={SETTLED_FILTERS} value={settled} onChange={reset(setSettled)} />
        <div style={{ marginLeft: 'auto' }}>
          <SearchBox value={search} onChange={reset(setSearch)} placeholder="Order id / SKU / product…" />
        </div>
      </div>

      <div style={{ ...S.card, padding: 0, overflow: 'hidden', opacity: loading ? 0.6 : 1, transition: 'opacity 0.15s' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 1100 }}>
            <thead>
              <tr>
                {['Order', 'Date', 'Status', 'SKU / product', 'Qty', 'Courier', 'Dispatched', 'Delivered', 'Reason', 'Payment'].map((h) => (
                  <th key={h} style={{ ...S.th, fontSize: 10 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.results.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ ...S.td, textAlign: 'center', padding: 56, color: C.gray400 }}>
                    No orders match these filters.
                  </td>
                </tr>
              )}
              {data.results.map((o, idx) => (
                <tr key={o.id} style={{ background: idx % 2 ? C.gray50 : C.white, borderBottom: `1px solid ${C.gray100}` }}>
                  <td style={S.td}>
                    <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: C.blue }}>{o.order_id}</div>
                    <div style={{ fontFamily: 'monospace', fontSize: 10.5, color: C.gray400 }}>item {o.order_item_id}</div>
                  </td>
                  <td style={{ ...S.td, fontSize: 11, color: C.gray500, whiteSpace: 'nowrap' }}>{o.order_date || '—'}</td>
                  <td style={S.td}>
                    <StatusBadge status={o.status} />
                    {(o.dispatch_sla_breached || o.delivery_sla_breached) && (
                      <div style={{ fontSize: 10, color: C.amber, marginTop: 3 }}>
                        ⚠ {o.dispatch_sla_breached ? 'dispatch' : 'delivery'} SLA missed
                      </div>
                    )}
                  </td>
                  <td style={{ ...S.td, maxWidth: 240 }}>
                    <span style={{ fontSize: 11, fontFamily: 'monospace', color: C.orange, background: C.orangeLight, padding: '1px 6px', borderRadius: 4 }}>{o.sku || '—'}</span>
                    <div style={{ fontSize: 11, color: C.gray600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 3 }} title={o.product_title}>
                      {o.product_title}
                    </div>
                  </td>
                  <td style={{ ...S.td, textAlign: 'center' }}>{o.quantity}</td>
                  <td style={{ ...S.td, fontSize: 11, color: C.gray500 }}>
                    {o.logistics_partner || '—'}
                    {o.delivery_tracking_id && <div style={{ fontFamily: 'monospace', fontSize: 10, color: C.gray400 }}>{o.delivery_tracking_id}</div>}
                  </td>
                  <td style={{ ...S.td, fontSize: 11, color: C.gray500, whiteSpace: 'nowrap' }}>{o.dispatched_date || '—'}</td>
                  <td style={{ ...S.td, fontSize: 11, color: C.gray500, whiteSpace: 'nowrap' }}>{o.delivery_date || '—'}</td>
                  <td style={{ ...S.td, fontSize: 11, color: C.gray500, maxWidth: 180 }}>
                    {o.return_reason || o.cancellation_reason || '—'}
                    {o.return_sub_reason && o.return_sub_reason !== o.return_reason && (
                      <div style={{ fontSize: 10, color: C.gray400 }}>{o.return_sub_reason}</div>
                    )}
                  </td>
                  <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                    {o.settled ? (
                      <><span style={{ fontSize: 10.5, fontWeight: 700, color: C.green }}>Settled </span><Signed value={o.settlement_value} /></>
                    ) : o.status === 'CANCELLED' ? (
                      <span style={{ fontSize: 11, color: C.gray300 }}>—</span>
                    ) : (
                      <span style={{ fontSize: 11, fontWeight: 600, color: C.amber }}>Not paid yet</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} />
      </div>
    </div>
  );
}
