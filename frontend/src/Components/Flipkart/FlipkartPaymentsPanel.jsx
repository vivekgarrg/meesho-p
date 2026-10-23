import React, { useState } from 'react';
import CircularProgress from '@mui/material/CircularProgress';
import { C, S, fmt } from '../../shared';
import { useBusiness } from '../../contexts/BusinessContext';
import { useDateFilter } from '../../contexts/DateFilterContext';
import {
  EmptyState, ErrorNote, FLIPKART_COLOR, GROUP_STATUS_META, Kpi, KpiRow, Pager, PillFilter, Section, SearchBox, Signed,
  StatusBadge, useDebounced, useFlipkartApi,
} from './FlipkartShared';

const PAGE_SIZE = 50;
const CHARGES_PAGE_SIZE = 20;

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  ...Object.entries(GROUP_STATUS_META).map(([value, m]) => ({ value, label: m.label, color: m.color })),
];

const EXCLUDED_NOTE = {
  missing_price: 'no price set — left out of profit',
  non_loss_return: 'returned, not a loss — left out of profit',
};

const subTh = { ...S.th, fontSize: 10, padding: '6px 12px' };
const subTd = { ...S.td, fontSize: 12, padding: '7px 12px', fontFamily: 'monospace' };

function ItemBlock({ item }) {
  return (
    <div style={{ padding: '10px 20px 14px 52px', borderBottom: `1px solid ${C.gray100}` }}>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'baseline', marginBottom: 8 }}>
        <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: C.gray800 }}>{item.sku || '(no SKU)'}</span>
        <span style={{ fontSize: 11, color: C.gray400, fontFamily: 'monospace' }}>item {item.order_item_id}</span>
        <span style={{ fontSize: 11, color: C.gray500 }}>qty {item.quantity}</span>
        {item.order_report_status && <StatusBadge status={item.order_report_status} />}
        {item.is_return && <span style={{ fontSize: 11, color: C.red }}>↩ {item.return_type}</span>}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 18, fontSize: 12 }}>
          <span>settled <Signed value={item.settlement} /></span>
          <span style={{ color: C.gray500 }}>cost <span style={{ fontFamily: 'monospace', color: item.cost ? C.red : C.gray300 }}>{item.cost ? `−${fmt(item.cost)}` : '—'}</span></span>
          <span>profit <Signed value={item.net_profit} /></span>
        </span>
      </div>
      {item.excluded_reason && (
        <p style={{ fontSize: 11, color: C.gray400, fontStyle: 'italic', marginBottom: 6 }}>{EXCLUDED_NOTE[item.excluded_reason]}</p>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            <tr style={{ background: '#E0F2FE' }}>
              {['Payment date', 'NEFT', 'Type', 'Sale', 'Offer', 'Mkt fee', 'Taxes', 'Refund', 'TCS', 'TDS', 'Settlement'].map((h) => (
                <th key={h} style={subTh}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {item.rows.map((r, i) => (
              <tr key={`${r.neft_id}-${i}`} style={{ background: '#F0F9FF', borderBottom: `1px solid ${C.gray100}` }}>
                <td style={{ ...subTd, fontFamily: 'inherit', color: C.gray500 }}>{r.payment_date || '—'}</td>
                <td style={{ ...subTd, color: C.gray400, fontSize: 10.5 }} title={r.neft_id}>{(r.neft_id || '').slice(-10)}</td>
                <td style={{ ...subTd, fontFamily: 'inherit', color: r.return_type && r.return_type !== 'NA' ? C.red : C.gray500 }}>
                  {r.return_type && r.return_type !== 'NA' ? r.return_type : 'Sale'}
                </td>
                <td style={subTd}>{fmt(r.sale_amount)}</td>
                <td style={subTd}>{fmt(r.total_offer_amount)}</td>
                <td style={{ ...subTd, color: C.amber }}>{fmt(r.marketplace_fee)}</td>
                <td style={subTd}>{fmt(r.taxes)}</td>
                <td style={{ ...subTd, color: r.refund < 0 ? C.red : C.gray600 }}>{fmt(r.refund)}</td>
                <td style={{ ...subTd, color: C.gray400 }}>{fmt(r.tcs)}</td>
                <td style={{ ...subTd, color: C.gray400 }}>{fmt(r.tds)}</td>
                <td style={subTd}><Signed value={r.settlement_value} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OtherCharges() {
  const [page, setPage] = useState(1);
  const { data, loading } = useFlipkartApi('/flipkart-other-charges/', { page, page_size: CHARGES_PAGE_SIZE });
  if (!data || (data.total === 0 && !loading)) return null;
  return (
    <Section
      title="Ads, fines & other settlement charges"
      subtitle={`${data.summary.count} line(s) in the settlement reports · total ${fmt(data.summary.total)} — taken off profit in the overview`}
      style={{ padding: 0, overflow: 'hidden' }}
    >
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Payment date', 'Type', 'Reference', 'Details', 'NEFT', 'Amount'].map((h) => (
                <th key={h} style={{ ...S.th, fontSize: 10 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.results.map((r) => (
              <tr key={r.id} style={{ borderBottom: `1px solid ${C.gray100}` }}>
                <td style={{ ...S.td, fontSize: 12, color: C.gray500 }}>{r.payment_date || '—'}</td>
                <td style={{ ...S.td, fontSize: 12 }}>{r.category_label}</td>
                <td style={{ ...S.td, fontSize: 11, fontFamily: 'monospace', color: C.gray500 }}>{r.reference_id || '—'}</td>
                <td style={{ ...S.td, fontSize: 12, color: C.gray500 }}>{r.description || '—'}</td>
                <td style={{ ...S.td, fontSize: 10.5, fontFamily: 'monospace', color: C.gray400 }} title={r.neft_id}>{(r.neft_id || '').slice(-10)}</td>
                <td style={{ ...S.td, textAlign: 'right' }}><Signed value={r.amount} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={page} pageSize={CHARGES_PAGE_SIZE} total={data.total} onPage={setPage} />
    </Section>
  );
}

export function FlipkartPaymentsPanel() {
  const { activeBusiness } = useBusiness();
  const { label: periodLabel, range } = useDateFilter();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(new Set());
  const q = useDebounced(search);

  const { data, loading, error } = useFlipkartApi('/flipkart-payments/grouped/', {
    status, search: q, page, page_size: PAGE_SIZE,
  });

  const toggle = (id) =>
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const reset = (fn) => (v) => { fn(v); setPage(1); setOpen(new Set()); };

  if (error) return <ErrorNote message={error} />;
  if (!data) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
        <CircularProgress style={{ color: FLIPKART_COLOR }} />
      </div>
    );
  }

  const { kpi, groups, total } = data;
  const noData = kpi.total_groups === 0 && !status && !q;
  if (noData) {
    return (
      <EmptyState title={`No Flipkart payments for ${activeBusiness?.name || 'this business'} in ${periodLabel}`}>
        Upload the Flipkart Settlement Report from Upload Data{range.date_from ? ', or pick a different period' : ''}.
      </EmptyState>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: C.gray800, margin: 0 }}>Flipkart payments</h1>
        <p style={{ color: C.gray400, fontSize: 13, margin: '4px 0 0' }}>
          Settlement payments grouped by order id · profit = settlement − item cost from the SKU pricing table
        </p>
      </div>

      <KpiRow>
        <Kpi label="Orders" value={kpi.total_groups.toLocaleString('en-IN')} accent={FLIPKART_COLOR} sub={periodLabel} />
        <Kpi label="Net settlement" value={fmt(kpi.total_settlement)} accent={kpi.total_settlement >= 0 ? C.green : C.red} color={kpi.total_settlement >= 0 ? C.green : C.red} sub="after fees, taxes & refunds" />
        <Kpi label="Cost of goods" value={fmt(kpi.total_cost)} accent={C.gray600} color={C.red} />
        <Kpi label="Profit" value={fmt(kpi.total_profit)} accent={kpi.total_profit >= 0 ? C.green : C.red} color={kpi.total_profit >= 0 ? C.green : C.red} sub={kpi.missing_price_orders ? `${kpi.missing_price_orders} order(s) have no SKU price` : 'before ads & fines'} />
        {kpi.by_status.map((s) => {
          const m = GROUP_STATUS_META[s.status];
          return <Kpi key={s.status} label={m.label} value={s.count} accent={m.color} color={m.color} sub={`${fmt(s.settlement)} settled`} />;
        })}
      </KpiRow>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <PillFilter options={STATUS_FILTERS} value={status} onChange={reset(setStatus)} />
        <div style={{ marginLeft: 'auto' }}>
          <SearchBox value={search} onChange={reset(setSearch)} placeholder="Order id / SKU / product…" />
        </div>
      </div>

      <div style={{ ...S.card, padding: 0, overflow: 'hidden', opacity: loading ? 0.6 : 1, transition: 'opacity 0.15s' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                {['', 'Order ID', 'Status', 'SKU / product', 'Order date', 'Settlement', 'Cost', 'Profit', 'Items'].map((h) => (
                  <th key={h} style={{ ...S.th, fontSize: 10, textAlign: ['Settlement', 'Cost', 'Profit'].includes(h) ? 'right' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ ...S.td, textAlign: 'center', padding: 56, color: C.gray400 }}>
                    No payments match these filters.
                  </td>
                </tr>
              )}
              {groups.map((g, idx) => {
                const isOpen = open.has(g.order_id);
                return (
                  <React.Fragment key={g.order_id}>
                    <tr
                      onClick={() => toggle(g.order_id)}
                      style={{ cursor: 'pointer', background: idx % 2 ? C.gray50 : C.white, borderBottom: isOpen ? 'none' : `1px solid ${C.gray100}` }}
                    >
                      <td style={{ ...S.td, width: 36, color: C.orange, textAlign: 'center' }}>{isOpen ? '▾' : '▸'}</td>
                      <td style={S.td}>
                        <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: C.blue, background: '#EFF6FF', padding: '2px 7px', borderRadius: 5 }}>
                          {g.order_id}
                        </span>
                      </td>
                      <td style={S.td}><StatusBadge status={g.status} metaMap={GROUP_STATUS_META} /></td>
                      <td style={{ ...S.td, maxWidth: 240 }}>
                        <span style={{ fontSize: 11, fontFamily: 'monospace', color: C.orange, background: C.orangeLight, padding: '1px 6px', borderRadius: 4 }}>
                          {g.sku || '—'}
                        </span>
                        {g.item_count > 1 && <span style={{ marginLeft: 6, fontSize: 10.5, color: C.gray400 }}>+{g.item_count - 1} more</span>}
                        <div style={{ fontSize: 11, color: C.gray600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 3 }} title={g.product_title}>
                          {g.product_title || ''}
                        </div>
                      </td>
                      <td style={{ ...S.td, fontSize: 11, color: C.gray500, whiteSpace: 'nowrap' }}>{g.order_date || '—'}</td>
                      <td style={{ ...S.td, textAlign: 'right' }}><Signed value={g.settlement} /></td>
                      <td style={{ ...S.td, textAlign: 'right', fontFamily: 'monospace', color: g.cost ? C.red : C.gray300 }}>{g.cost ? `−${fmt(g.cost)}` : '—'}</td>
                      <td style={{ ...S.td, textAlign: 'right' }}>
                        {g.net_profit === null ? <span style={{ fontSize: 11, color: C.amber }}>no price</span> : <Signed value={g.net_profit} />}
                      </td>
                      <td style={{ ...S.td, color: C.gray500 }}>{g.item_count}</td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={9} style={{ padding: 0, background: '#F0F9FF', borderBottom: `4px solid ${C.gray100}` }}>
                          {g.items.map((item) => <ItemBlock key={item.order_item_id} item={item} />)}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pager page={page} pageSize={PAGE_SIZE} total={total} onPage={(p) => { setPage(p); setOpen(new Set()); }} />
      </div>

      <OtherCharges />
    </div>
  );
}
