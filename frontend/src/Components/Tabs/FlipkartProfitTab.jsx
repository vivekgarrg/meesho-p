import React, { useEffect, useMemo, useState } from 'react';
import CircularProgress from '@mui/material/CircularProgress';
import { AppBarChart } from '../Charts/AppBarChart';
import { AppPieChart } from '../Charts/AppPieChart';
import { AppLineChart } from '../Charts/AppLineChart';
import { ParentLinkInline } from './ParentLinkInline';
import { useDateFilter } from '../../contexts/DateFilterContext';
import { API, C, fmt } from '../../App';

// ─────────────────────────────────────────────────────────────────────────────
// Design tokens — mirrors EstimatedProfitTab's card/label language.
// ─────────────────────────────────────────────────────────────────────────────
const T = {
  card: {
    background: '#fff',
    border: '1px solid #E2E8F0',
    borderRadius: 16,
    padding: '20px 22px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
  },
  label: { fontSize: 11, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.07em', textTransform: 'uppercase' },
  mono: { fontFamily: 'monospace' },
};

function getStatusMeta() {
  return {
    Delivered: { color: C.green, icon: '✅' },
    Returned: { color: C.red, icon: '↩' },
  };
}

function SectionCard({ title, subtitle, children, style }) {
  return (
    <div style={{ ...T.card, ...style }}>
      {title && <p style={{ ...T.label, marginBottom: subtitle ? 4 : 14 }}>{title}</p>}
      {subtitle && <p style={{ fontSize: 11, color: C.gray400, marginBottom: 14 }}>{subtitle}</p>}
      {children}
    </div>
  );
}

function KPICard({ label, value, sub, color, accent }) {
  return (
    <div
      style={{
        ...T.card,
        borderTop: `3px solid ${accent || color || C.blue}`,
        flex: '1 1 170px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <p style={{ ...T.label, marginBottom: 6 }}>{label}</p>
      <p style={{ fontSize: 21, fontWeight: 800, ...T.mono, color: color || C.gray800, lineHeight: 1.1 }}>{value}</p>
      {sub && <p style={{ fontSize: 11, color: C.gray400, marginTop: 5 }}>{sub}</p>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Upload dropzone
// ─────────────────────────────────────────────────────────────────────────────
function UploadZone({ loading, error, onFile, hasResult }) {
  const [dragging, setDragging] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        onFile(e.dataTransfer.files[0]);
      }}
      style={{
        border: `2px dashed ${dragging ? C.orange : '#CBD5E1'}`,
        borderRadius: 16,
        padding: hasResult ? '18px 22px' : '36px 24px',
        textAlign: 'center',
        background: dragging ? C.orangeLight : '#F8FAFC',
        transition: 'all 0.15s',
      }}
    >
      {!hasResult && <p style={{ fontSize: 38, marginBottom: 8 }}>📦</p>}
      <p style={{ fontSize: hasResult ? 13 : 15, fontWeight: 700, color: C.gray800, marginBottom: 4 }}>
        {hasResult
          ? 'Upload a different Flipkart Settlement Report'
          : 'Drop your Flipkart Settlement Report (.xlsx) here'}
      </p>
      {!hasResult && (
        <p style={{ fontSize: 12, color: C.gray400, marginBottom: 16 }}>
          The "Orders" sheet of the report — Order ID · Order Item ID · Seller SKU · Bank Settlement Value · Quantity
        </p>
      )}
      <label style={{ display: 'inline-block' }}>
        <span
          style={{
            display: 'inline-block',
            padding: '9px 20px',
            borderRadius: 10,
            cursor: loading ? 'default' : 'pointer',
            background: C.orange,
            color: '#fff',
            fontWeight: 700,
            fontSize: 13,
            opacity: loading ? 0.6 : 1,
            boxShadow: '0 2px 6px rgba(109,40,217,0.3)',
          }}
        >
          {loading ? 'Processing…' : 'Choose Excel File'}
        </span>
        <input type="file" accept=".xlsx,.xls" hidden disabled={loading} onChange={(e) => onFile(e.target.files[0])} />
      </label>
      {error && (
        <p
          style={{
            marginTop: 14,
            fontSize: 12,
            fontWeight: 600,
            color: C.red,
            background: C.redLight,
            border: `1px solid ${C.redBorder}`,
            borderRadius: 8,
            padding: '8px 12px',
            display: 'inline-block',
          }}
        >
          ⚠ {error}
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Status breakdown table (Delivered vs Returned)
// ─────────────────────────────────────────────────────────────────────────────
function StatusBreakdownTable({ rows }) {
  const statusMeta = getStatusMeta();
  const total = rows.reduce(
    (a, r) => ({
      count: a.count + r.count,
      gross: a.gross + r.gross,
      cost: a.cost + r.cost,
      net: a.net + r.net,
    }),
    { count: 0, gross: 0, cost: 0, net: 0 },
  );

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 520 }}>
        <thead>
          <tr style={{ background: '#F8FAFC' }}>
            {['Status', 'Orders', 'Settlement', 'Cost Deducted', 'Net P&L'].map((h, i) => (
              <th
                key={h}
                style={{
                  padding: '7px 12px',
                  textAlign: i <= 1 ? 'left' : 'right',
                  fontSize: 10,
                  fontWeight: 700,
                  color: C.gray500,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  borderBottom: '2px solid #E2E8F0',
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const meta = statusMeta[r.status] || { color: C.gray500, icon: '•' };
            return (
              <tr
                key={r.status}
                style={{
                  borderBottom: i < rows.length - 1 ? '1px solid #F1F5F9' : '2px solid #E2E8F0',
                  opacity: r.count === 0 ? 0.45 : 1,
                }}
              >
                <td style={{ padding: '8px 12px' }}>
                  <span style={{ marginRight: 6 }}>{meta.icon}</span>
                  <span style={{ fontWeight: 600, color: C.gray700 }}>{r.status}</span>
                </td>
                <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: C.gray500 }}>
                  {r.count.toLocaleString()}
                </td>
                <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'monospace', color: C.gray700 }}>
                  {fmt(r.gross)}
                </td>
                <td
                  style={{
                    padding: '8px 12px',
                    textAlign: 'right',
                    fontFamily: 'monospace',
                    color: r.cost > 0 ? C.red : C.gray300,
                  }}
                >
                  {r.cost ? `−${fmt(r.cost)}` : '—'}
                </td>
                <td
                  style={{
                    padding: '8px 12px',
                    textAlign: 'right',
                    fontFamily: 'monospace',
                    fontWeight: 800,
                    color: r.net >= 0 ? C.green : C.red,
                  }}
                >
                  {fmt(r.net)}
                </td>
              </tr>
            );
          })}
          <tr style={{ background: '#F8FAFC' }}>
            <td style={{ padding: '9px 12px', fontWeight: 800, color: C.gray800, fontSize: 13 }}>Total</td>
            <td style={{ padding: '9px 12px', fontFamily: 'monospace', fontWeight: 700, color: C.gray600 }}>
              {total.count.toLocaleString()}
            </td>
            <td
              style={{
                padding: '9px 12px',
                textAlign: 'right',
                fontFamily: 'monospace',
                fontWeight: 700,
                color: C.gray700,
              }}
            >
              {fmt(total.gross)}
            </td>
            <td
              style={{
                padding: '9px 12px',
                textAlign: 'right',
                fontFamily: 'monospace',
                fontWeight: 700,
                color: C.red,
              }}
            >
              {total.cost ? `−${fmt(total.cost)}` : '—'}
            </td>
            <td
              style={{
                padding: '9px 12px',
                textAlign: 'right',
                fontFamily: 'monospace',
                fontWeight: 800,
                color: total.net >= 0 ? C.green : C.red,
              }}
            >
              {fmt(total.net)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic "label / count / settlement / cost / net" breakdown (fulfilment type,
// product category) — same column language as StatusBreakdownTable, without the
// fixed Delivered/Returned icon set.
// ─────────────────────────────────────────────────────────────────────────────
function SimpleBreakdownTable({ rows, nameHeader }) {
  if (!rows.length) return null;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 480 }}>
        <thead>
          <tr style={{ background: '#F8FAFC' }}>
            {[nameHeader, 'Orders', 'Settlement', 'Cost Deducted', 'Net P&L'].map((h, i) => (
              <th
                key={h}
                style={{
                  padding: '7px 12px',
                  textAlign: i <= 1 ? 'left' : 'right',
                  fontSize: 10,
                  fontWeight: 700,
                  color: C.gray500,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  borderBottom: '2px solid #E2E8F0',
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.label} style={{ borderBottom: i < rows.length - 1 ? '1px solid #F1F5F9' : 'none' }}>
              <td style={{ padding: '8px 12px', fontWeight: 600, color: C.gray700 }}>{r.label}</td>
              <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: C.gray500 }}>
                {r.count.toLocaleString()}
              </td>
              <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'monospace', color: C.gray700 }}>
                {fmt(r.gross)}
              </td>
              <td
                style={{
                  padding: '8px 12px',
                  textAlign: 'right',
                  fontFamily: 'monospace',
                  color: r.cost > 0 ? C.red : C.gray300,
                }}
              >
                {r.cost ? `−${fmt(r.cost)}` : '—'}
              </td>
              <td
                style={{
                  padding: '8px 12px',
                  textAlign: 'right',
                  fontFamily: 'monospace',
                  fontWeight: 800,
                  color: r.net >= 0 ? C.green : C.red,
                }}
              >
                {fmt(r.net)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Payment reconciliation — where the "Bank Settlement Value" actually came
// from, straight off the raw settlement-report columns (no SKU pricing
// involved, so it's available even for SKUs that haven't been priced yet).
// ─────────────────────────────────────────────────────────────────────────────
const PAYMENT_COMPONENT_ROWS = [
  { key: 'sale_amount', label: 'Sale Amount' },
  { key: 'total_offer_amount', label: 'Total Offer Amount' },
  { key: 'my_share', label: 'My Share' },
  { key: 'marketplace_fee', label: 'Marketplace Fee' },
  { key: 'taxes', label: 'Taxes' },
  { key: 'offer_adjustments', label: 'Offer Adjustments' },
  { key: 'protection_fund', label: 'Protection Fund' },
  { key: 'refund', label: 'Refund' },
];
const PAYMENT_DEDUCTION_ROWS = [
  { key: 'tcs', label: 'TCS' },
  { key: 'tds', label: 'TDS' },
  { key: 'gst_on_mp_fees', label: 'GST on MP Fees' },
];

function PaymentBreakdownTable({ breakdown }) {
  const row = (key, label, bold) => (
    <tr key={key} style={{ borderBottom: '1px solid #F1F5F9' }}>
      <td style={{ padding: '7px 12px', fontWeight: bold ? 800 : 500, color: bold ? C.gray800 : C.gray600 }}>
        {label}
      </td>
      <td
        style={{
          padding: '7px 12px',
          textAlign: 'right',
          fontFamily: 'monospace',
          fontWeight: bold ? 800 : 600,
          color: breakdown[key] < 0 ? C.red : bold ? C.gray800 : C.gray700,
        }}
      >
        {fmt(breakdown[key] || 0)}
      </td>
    </tr>
  );
  return (
    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
      <div style={{ overflowX: 'auto', flex: '1 1 320px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <tbody>
            {PAYMENT_COMPONENT_ROWS.map((r) => row(r.key, r.label))}
            {row('settlement_value', 'Bank Settlement Value', true)}
          </tbody>
        </table>
      </div>
      <div style={{ overflowX: 'auto', flex: '1 1 220px' }}>
        <p style={{ ...T.label, marginBottom: 6 }}>Withheld at Source</p>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <tbody>{PAYMENT_DEDUCTION_ROWS.map((r) => row(r.key, r.label))}</tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Full payment list — one row per SKU, every raw settlement component plus
// the final Bank Settlement Value. Independent of cost pricing (unlike the
// SKU-wise P&L table below): every SKU that was ever settled shows up here,
// including ones with no price set and ones that were only returns.
// ─────────────────────────────────────────────────────────────────────────────
const PAYMENT_LIST_COLUMNS = [
  { key: 'sale_amount', label: 'Sale Amt' },
  { key: 'total_offer_amount', label: 'Offer Amt' },
  { key: 'my_share', label: 'My Share' },
  { key: 'marketplace_fee', label: 'Mkt Fee' },
  { key: 'taxes', label: 'Taxes' },
  { key: 'offer_adjustments', label: 'Offer Adj' },
  { key: 'protection_fund', label: 'Prot. Fund' },
  { key: 'refund', label: 'Refund' },
  { key: 'tcs', label: 'TCS' },
  { key: 'tds', label: 'TDS' },
  { key: 'gst_on_mp_fees', label: 'GST' },
];

// Individual order-item payments for one SKU, shown inline when its row in
// SkuPaymentListTable is expanded — "all payments one by one" behind that
// SKU's aggregate.
function SkuPaymentDetailRows({ sku, dateQuery, colSpan }) {
  const [state, setState] = useState({ loading: true, error: null, payments: [] });

  useEffect(() => {
    let dead = false;
    setState({ loading: true, error: null, payments: [] });
    const params = new URLSearchParams(dateQuery);
    params.set('sku', sku);
    fetch(`${API}/flipkart-profit/sku-payments/?${params}`)
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (dead) return;
        setState(
          ok ? { loading: false, error: null, payments: d.payments || [] } : { loading: false, error: d.error || 'Failed to load', payments: [] },
        );
      })
      .catch(() => {
        if (!dead) setState({ loading: false, error: 'Network error', payments: [] });
      });
    return () => {
      dead = true;
    };
  }, [sku, dateQuery]);

  const thD = {
    padding: '5px 8px',
    textAlign: 'right',
    fontSize: 9.5,
    fontWeight: 700,
    color: C.gray400,
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
    borderBottom: '1.5px solid #E2E8F0',
    whiteSpace: 'nowrap',
  };
  const tdD = { padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, color: C.gray600, whiteSpace: 'nowrap' };

  return (
    <tr>
      <td colSpan={colSpan} style={{ padding: 0, background: '#FBFBFD', borderBottom: '1px solid #F1F5F9' }}>
        <div style={{ padding: '10px 16px 16px 40px' }}>
          {state.loading && <p style={{ fontSize: 11.5, color: C.gray400 }}>Loading payments…</p>}
          {state.error && <p style={{ fontSize: 11.5, color: C.red }}>⚠ {state.error}</p>}
          {!state.loading && !state.error && (
            <div style={{ overflowX: 'auto' }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: C.gray500, marginBottom: 6 }}>
                {state.payments.length} payment{state.payments.length === 1 ? '' : 's'} for {sku}
              </p>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1280 }}>
                <thead>
                  <tr>
                    <th style={{ ...thD, textAlign: 'left' }}>Order ID</th>
                    <th style={{ ...thD, textAlign: 'left' }}>Order Date</th>
                    <th style={thD}>Qty</th>
                    <th style={{ ...thD, textAlign: 'left' }}>Status</th>
                    {PAYMENT_LIST_COLUMNS.map((c) => (
                      <th key={c.key} style={thD}>{c.label}</th>
                    ))}
                    <th style={{ ...thD, color: C.gray700 }}>Settlement</th>
                    <th style={{ ...thD, color: C.gray700 }}>Net P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {state.payments.length === 0 && (
                    <tr>
                      <td colSpan={17} style={{ padding: 16, textAlign: 'center', color: C.gray400, fontSize: 11.5 }}>
                        No individual payments found for this period.
                      </td>
                    </tr>
                  )}
                  {state.payments.map((p) => (
                    <tr key={p.order_item_id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                      <td style={{ padding: '5px 8px', fontFamily: 'monospace', fontSize: 10.5, color: C.gray600, whiteSpace: 'nowrap' }}>
                        {p.order_id}
                      </td>
                      <td style={{ padding: '5px 8px', fontSize: 10.5, color: C.gray500, whiteSpace: 'nowrap' }}>
                        {p.order_date || '—'}
                      </td>
                      <td style={tdD}>{p.quantity}</td>
                      <td style={{ padding: '5px 8px', fontSize: 10.5, whiteSpace: 'nowrap' }}>
                        {p.is_return ? (
                          <span style={{ color: C.red }}>↩ {p.return_type}</span>
                        ) : (
                          <span style={{ color: C.green }}>✅ Delivered</span>
                        )}
                        {p.excluded_reason && (
                          <span style={{ marginLeft: 4, color: C.gray400, fontStyle: 'italic' }}>
                            ({p.excluded_reason === 'missing_price' ? 'no price set' : 'not a loss'})
                          </span>
                        )}
                      </td>
                      {PAYMENT_LIST_COLUMNS.map((c) => (
                        <td key={c.key} style={{ ...tdD, color: p[c.key] < 0 ? C.red : C.gray600 }}>
                          {fmt(p[c.key])}
                        </td>
                      ))}
                      <td style={{ ...tdD, fontWeight: 700, color: p.settlement_value >= 0 ? C.green : C.red }}>
                        {fmt(p.settlement_value)}
                      </td>
                      <td style={{ ...tdD, fontWeight: 800, color: p.net_profit >= 0 ? C.green : C.red }}>
                        {fmt(p.net_profit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

function SkuPaymentListTable({ rows, onRelinked, dateQuery }) {
  const [expanded, setExpanded] = useState({});
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('settlement_value');
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const f = rows.filter((r) => !search || r.sku_id.toLowerCase().includes(search.toLowerCase()));
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...f].sort((a, b) => (a[sortKey] - b[sortKey]) * dir);
  }, [rows, search, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const visible = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  const toggleSort = (key) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('desc');
    }
    setPage(1);
  };

  const thR = {
    padding: '8px 10px',
    textAlign: 'right',
    fontSize: 10,
    fontWeight: 700,
    color: C.gray500,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    borderBottom: '2px solid #E2E8F0',
    whiteSpace: 'nowrap',
  };
  const tdR = { padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: C.gray600, whiteSpace: 'nowrap' };

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 10,
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <p style={{ fontSize: 12, fontWeight: 700, color: C.gray600 }}>
          {filtered.length.toLocaleString()} SKUs{' '}
          <span style={{ fontWeight: 500, color: C.gray400 }}>· click a row to see every individual payment</span>
        </p>
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search SKU…"
          style={{
            padding: '7px 12px',
            borderRadius: 8,
            border: '1.5px solid #E2E8F0',
            fontSize: 12,
            width: 220,
            fontFamily: 'inherit',
          }}
        />
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 1180 }}>
          <thead>
            <tr style={{ background: '#F8FAFC' }}>
              <th
                style={{
                  padding: '8px 10px',
                  textAlign: 'left',
                  fontSize: 10,
                  fontWeight: 700,
                  color: C.gray500,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  borderBottom: '2px solid #E2E8F0',
                  whiteSpace: 'nowrap',
                }}
              >
                SKU ID
              </th>
              <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: C.gray500,
                           textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '2px solid #E2E8F0' }}>
                Pricing
              </th>
              <th
                style={{ ...thR, cursor: 'pointer', userSelect: 'none' }}
                onClick={() => toggleSort('order_count')}
              >
                Orders{sortKey === 'order_count' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
              </th>
              {PAYMENT_LIST_COLUMNS.map((c) => (
                <th
                  key={c.key}
                  style={{ ...thR, cursor: c.key === 'sale_amount' ? 'pointer' : 'default', userSelect: 'none' }}
                  onClick={c.key === 'sale_amount' ? () => toggleSort('sale_amount') : undefined}
                >
                  {c.label}
                  {sortKey === c.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
              <th
                style={{ ...thR, cursor: 'pointer', userSelect: 'none', color: C.gray700 }}
                onClick={() => toggleSort('settlement_value')}
              >
                Settlement Value{sortKey === 'settlement_value' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={15} style={{ padding: 30, textAlign: 'center', color: C.gray400, fontSize: 12 }}>
                  No SKUs match your search.
                </td>
              </tr>
            )}
            {visible.map((r, i) => (
              <React.Fragment key={r.sku_id}>
                <tr
                  onClick={() => setExpanded((e) => ({ ...e, [r.sku_id]: !e[r.sku_id] }))}
                  style={{
                    background: expanded[r.sku_id] ? '#FFF8F0' : i % 2 === 0 ? '#fff' : '#FAFBFC',
                    borderBottom: expanded[r.sku_id] ? 'none' : '1px solid #F1F5F9',
                    cursor: 'pointer',
                  }}
                >
                  <td style={{ padding: '8px 10px' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ fontSize: 10, color: C.gray400, width: 10, display: 'inline-block' }}>
                        {expanded[r.sku_id] ? '▾' : '▸'}
                      </span>
                      <span
                        style={{
                          fontFamily: 'monospace',
                          fontSize: 11,
                          color: C.orange,
                          fontWeight: 600,
                          background: C.orangeLight,
                          padding: '2px 6px',
                          borderRadius: 4,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {r.sku_id}
                      </span>
                    </span>
                  </td>
                  <td style={{ padding: '8px 10px' }} onClick={(e) => e.stopPropagation()}>
                    {r.parent_id ? (
                      <span style={{ fontSize: 10.5, color: C.gray500, whiteSpace: 'nowrap' }}>
                        ↳ <span style={{ fontWeight: 700, color: C.gray700 }}>{r.parent_id}</span>
                      </span>
                    ) : (
                      <span style={{ fontSize: 10.5, color: C.gray400, fontStyle: 'italic', whiteSpace: 'nowrap' }}>
                        standalone
                      </span>
                    )}
                    <div style={{ marginTop: 2 }}>
                      <ParentLinkInline sku={r.sku_id} currentParent={r.parent_id} onDone={() => onRelinked?.()} />
                    </div>
                  </td>
                  <td style={tdR}>{r.order_count}</td>
                  {PAYMENT_LIST_COLUMNS.map((c) => (
                    <td key={c.key} style={{ ...tdR, color: r[c.key] < 0 ? C.red : C.gray600 }}>
                      {fmt(r[c.key])}
                    </td>
                  ))}
                  <td style={{ ...tdR, fontWeight: 800, color: r.settlement_value >= 0 ? C.green : C.red }}>
                    {fmt(r.settlement_value)}
                  </td>
                </tr>
                {expanded[r.sku_id] && (
                  <SkuPaymentDetailRows sku={r.sku_id} dateQuery={dateQuery} colSpan={15} />
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 12,
            padding: '10px 0 0',
            borderTop: '1px solid #F1F5F9',
          }}
        >
          <span style={{ fontSize: 12, color: C.gray400 }}>
            {Math.min((pageSafe - 1) * PAGE_SIZE + 1, filtered.length)}–
            {Math.min(pageSafe * PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setPage((p) => p - 1)} disabled={pageSafe === 1} style={pagerBtn(pageSafe === 1)}>
              ← Prev
            </button>
            <span style={{ fontSize: 12, color: C.gray500, alignSelf: 'center', padding: '0 4px' }}>
              Page {pageSafe} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={pageSafe >= totalPages}
              style={pagerBtn(pageSafe >= totalPages)}
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SKU-wise table
// ─────────────────────────────────────────────────────────────────────────────
const SORT_OPTIONS = [
  { key: 'net_profit', label: 'Net P&L' },
  { key: 'order_count', label: 'Orders' },
  { key: 'gross_payout', label: 'Settlement' },
  { key: 'total_cost', label: 'Cost' },
];
const PAGE_SIZE = 25;

function SkuProfitTable({ rows, onRelinked }) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('net_profit');
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const f = rows.filter((r) => !search || r.sku_id.toLowerCase().includes(search.toLowerCase()));
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...f].sort((a, b) => (a[sortKey] - b[sortKey]) * dir);
  }, [rows, search, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const visible = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  const toggleSort = (key) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('desc');
    }
    setPage(1);
  };

  const thR = {
    padding: '8px 10px',
    textAlign: 'right',
    fontSize: 10,
    fontWeight: 700,
    color: C.gray500,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    borderBottom: '2px solid #E2E8F0',
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap',
  };

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 10,
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <p style={{ fontSize: 12, fontWeight: 700, color: C.gray600 }}>
          {filtered.length.toLocaleString()} SKUs · sorted by profit
        </p>
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search SKU…"
          style={{
            padding: '7px 12px',
            borderRadius: 8,
            border: '1.5px solid #E2E8F0',
            fontSize: 12,
            width: 220,
            fontFamily: 'inherit',
          }}
        />
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 980 }}>
          <thead>
            <tr style={{ background: '#F8FAFC' }}>
              <th
                style={{
                  padding: '8px 10px',
                  textAlign: 'left',
                  fontSize: 10,
                  fontWeight: 700,
                  color: C.gray500,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  borderBottom: '2px solid #E2E8F0',
                }}
              >
                SKU ID
              </th>
              <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: C.gray500,
                           textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '2px solid #E2E8F0' }}>
                Pricing
              </th>
              <th style={{ ...thR, textAlign: 'center', cursor: 'default' }}>Outcomes</th>
              {SORT_OPTIONS.map((opt) => (
                <th key={opt.key} style={thR} onClick={() => toggleSort(opt.key)}>
                  {opt.label}
                  {sortKey === opt.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
              <th style={{ ...thR, cursor: 'default', textAlign: 'left' }}>To Break Even</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: 30, textAlign: 'center', color: C.gray400, fontSize: 12 }}>
                  No SKUs match your search.
                </td>
              </tr>
            )}
            {visible.map((r, i) => (
              <tr
                key={r.sku_id}
                style={{ background: i % 2 === 0 ? '#fff' : '#FAFBFC', borderBottom: '1px solid #F1F5F9' }}
              >
                <td style={{ padding: '8px 10px' }}>
                  <span
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 11,
                      color: C.orange,
                      fontWeight: 600,
                      background: C.orangeLight,
                      padding: '2px 6px',
                      borderRadius: 4,
                    }}
                  >
                    {r.sku_id}
                  </span>
                </td>
                <td style={{ padding: '8px 10px' }}>
                  {r.parent_id ? (
                    <span style={{ fontSize: 10.5, color: C.gray500 }}>
                      ↳ <span style={{ fontWeight: 700, color: C.gray700 }}>{r.parent_id}</span>
                    </span>
                  ) : (
                    <span style={{ fontSize: 10.5, color: C.gray400, fontStyle: 'italic' }}>standalone price</span>
                  )}
                  <div style={{ marginTop: 2 }}>
                    <ParentLinkInline
                      sku={r.sku_id}
                      currentParent={r.parent_id}
                      onDone={() => onRelinked?.()}
                    />
                  </div>
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                  <div style={{ display: 'flex', gap: 4, justifyContent: 'center', flexWrap: 'wrap' }}>
                    {r.delivered_count > 0 && <Badge icon="✅" n={r.delivered_count} color={C.green} />}
                    {r.return_count > 0 && <Badge icon="↩" n={r.return_count} color={C.red} />}
                  </div>
                </td>
                <td
                  style={{
                    padding: '8px 10px',
                    textAlign: 'right',
                    fontFamily: 'monospace',
                    fontWeight: 800,
                    color: r.net_profit >= 0 ? C.green : C.red,
                  }}
                >
                  {fmt(r.net_profit)}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: C.gray600 }}>
                  {r.order_count}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: C.gray600 }}>
                  {fmt(r.gross_payout)}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: C.red }}>
                  {r.total_cost ? fmt(r.total_cost) : '—'}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'left' }}>
                  {!r.is_loss_making ? (
                    <span style={{ fontSize: 11, color: C.green, fontWeight: 700 }}>✓ already profitable</span>
                  ) : r.loss_all_from_returns ? (
                    <span style={{ fontSize: 11, color: C.red }}>
                      no delivered orders — loss is entirely returns, not fixable by price/cost
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, color: C.red }}>
                      cut cost (or raise price) by{' '}
                      <strong style={{ fontFamily: 'monospace' }}>{fmt(r.required_adjustment_per_unit)}</strong>
                      /unit across {r.delivered_count} delivered order{r.delivered_count === 1 ? '' : 's'}
                      <span style={{ color: C.gray400 }}> ({fmt(r.required_total_adjustment)} total)</span>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 12,
            padding: '10px 0 0',
            borderTop: '1px solid #F1F5F9',
          }}
        >
          <span style={{ fontSize: 12, color: C.gray400 }}>
            {Math.min((pageSafe - 1) * PAGE_SIZE + 1, filtered.length)}–
            {Math.min(pageSafe * PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setPage((p) => p - 1)} disabled={pageSafe === 1} style={pagerBtn(pageSafe === 1)}>
              ← Prev
            </button>
            <span style={{ fontSize: 12, color: C.gray500, alignSelf: 'center', padding: '0 4px' }}>
              Page {pageSafe} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={pageSafe >= totalPages}
              style={pagerBtn(pageSafe >= totalPages)}
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function pagerBtn(disabled) {
  return {
    padding: '5px 13px',
    fontSize: 12,
    borderRadius: 10,
    cursor: disabled ? 'default' : 'pointer',
    background: 'transparent',
    color: C.gray600,
    border: '1.5px solid #E2E8F0',
    opacity: disabled ? 0.4 : 1,
    fontFamily: 'inherit',
    fontWeight: 600,
  };
}

function Badge({ icon, n, color }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        color,
        background: `${color}14`,
        border: `1px solid ${color}33`,
        padding: '1px 5px',
        borderRadius: 20,
      }}
    >
      {icon} {n}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline "add price" form for a SKU missing pricing.
// ─────────────────────────────────────────────────────────────────────────────
const inputStyle = {
  width: 90,
  padding: '5px 8px',
  borderRadius: 7,
  border: '1.5px solid #E2E8F0',
  fontSize: 12,
  fontFamily: 'inherit',
};

function MissingPriceSkuRow({ sku, onSaved }) {
  const [open, setOpen] = useState(false);
  const [itemPrice, setItemPrice] = useState('');
  const [packagingCost, setPackagingCost] = useState('');
  const [taxPercent, setTaxPercent] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const save = async () => {
    if (!itemPrice) {
      setErr('Item price is required');
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`${API}/final-prices/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sku_id: sku,
          item_price: Number(itemPrice),
          packaging_cost: Number(packagingCost || 0),
          tax_percent: Number(taxPercent || 0),
          final_price: Number(itemPrice) + Number(packagingCost || 0),
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail || d.error || JSON.stringify(d) || 'Failed to save price');
      }
      setOpen(false);
      onSaved();
    } catch (e) {
      setErr(e.message || 'Failed to save price');
    }
    setSaving(false);
  };

  if (!open) {
    return (
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          background: '#fff',
          border: `1px solid ${C.redBorder}`,
          padding: '2px 7px',
          borderRadius: 6,
        }}
      >
        <span style={{ fontFamily: 'monospace', fontSize: 11, color: C.red, fontWeight: 600 }}>{sku}</span>
        <ParentLinkInline sku={sku} currentParent={null} onDone={() => onSaved()} />
        <button
          onClick={() => setOpen(true)}
          style={{
            fontFamily: 'monospace',
            fontSize: 11,
            color: C.orange,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            fontWeight: 800,
            padding: 0,
          }}
        >
          ＋ Add Price
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        background: '#fff',
        border: `1.5px solid ${C.orangeBorder}`,
        borderRadius: 10,
        padding: '10px 12px',
      }}
    >
      <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: C.gray700 }}>{sku}</span>
      <p style={{ fontSize: 10.5, color: C.gray400, margin: 0 }}>
        Setting a price here makes it standalone — use "link to parent" above instead if this SKU shares pricing
        with an existing product.
      </p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="number"
          placeholder="Item price*"
          value={itemPrice}
          onChange={(e) => setItemPrice(e.target.value)}
          style={inputStyle}
        />
        <input
          type="number"
          placeholder="Packaging"
          value={packagingCost}
          onChange={(e) => setPackagingCost(e.target.value)}
          style={inputStyle}
        />
        <input
          type="number"
          placeholder="Tax %"
          value={taxPercent}
          onChange={(e) => setTaxPercent(e.target.value)}
          style={inputStyle}
        />
        <button
          onClick={save}
          disabled={saving}
          style={{
            padding: '6px 12px',
            borderRadius: 7,
            border: 'none',
            cursor: saving ? 'default' : 'pointer',
            background: C.green,
            color: '#fff',
            fontWeight: 700,
            fontSize: 12,
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={() => setOpen(false)}
          disabled={saving}
          style={{
            padding: '6px 10px',
            borderRadius: 7,
            border: '1.5px solid #E2E8F0',
            cursor: 'pointer',
            background: 'transparent',
            color: C.gray500,
            fontWeight: 600,
            fontSize: 12,
          }}
        >
          Cancel
        </button>
      </div>
      {err && <span style={{ fontSize: 11, color: C.red, fontWeight: 600 }}>⚠ {err}</span>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main tab
// ─────────────────────────────────────────────────────────────────────────────
export function FlipkartProfitTab() {
  const { range, label: periodLabel } = useDateFilter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [fileName, setFileName] = useState('Saved Data');

  const dateQuery = () => {
    const params = new URLSearchParams();
    if (range.date_from) params.set('date_from', range.date_from);
    if (range.date_to) params.set('date_to', range.date_to);
    return params.toString();
  };

  const loadSaved = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/flipkart-profit/?${dateQuery()}`);
      const data = await res.json();
      if (res.ok) {
        setResult(data);
        setFileName('Saved Data');
      }
    } catch {
      // silent — an empty state is fine on first-ever load
    }
    setLoading(false);
  };
  useEffect(() => {
    loadSaved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.date_from, range.date_to]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetch(`${API}/flipkart-profit/?${dateQuery()}`);
      const data = await res.json();
      if (res.ok) setResult((prev) => (prev ? { ...prev, ...data } : data));
    } catch {
      // keep showing the last known result
    }
    setRefreshing(false);
  };

  const handleFile = async (file) => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setFileName(file.name);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch(`${API}/flipkart-profit/upload/?${dateQuery()}`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Upload failed');
      } else {
        setResult(data);
      }
    } catch {
      setError('Network error — is the backend running?');
    }
    setLoading(false);
  };

  const totals = result?.totals;
  const netProfit = Number(totals?.net_profit ?? 0);
  const pos = netProfit >= 0;

  const statusRows = result?.status_breakdown?.filter((r) => r.count > 0) || [];
  const divergingChartData = statusRows.map((r) => ({ status: r.status, net: r.net }));

  const statusMeta = getStatusMeta();
  const pieData = statusRows.map((r, i) => ({
    id: i,
    value: r.count,
    label: r.status,
    color: (statusMeta[r.status] || {}).color || C.gray400,
  }));

  const topProfit = result?.top_profit_skus || [];
  const topLoss = result?.top_loss_skus || [];
  const tornadoRows = [...topLoss].reverse().concat(topProfit);
  const tornadoData = tornadoRows.map((r) => ({ sku: r.sku_id, net: r.net_profit }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: C.gray800, marginBottom: 4 }}>
          Flipkart Profit — Settlement Report Upload
        </h2>
        <p style={{ fontSize: 12, color: C.gray400 }}>
          Upload a Flipkart Settlement Report (.xlsx) and each order item's Bank Settlement Value is matched to its
          Seller SKU's cost (same SKU pricing used for Meesho) to compute profit or loss. A returned item deducts no
          cost, and only counts if the settlement itself was actually negative. Rows are saved — re-uploading the same
          or an updated report refreshes existing rows instead of duplicating them. Scoped to <strong>{periodLabel}</strong> —
          change the period at the top of the page to see a different date range (e.g. 1–30 Sep, 1–31 Oct).
        </p>
      </div>

      <UploadZone loading={loading} error={error} onFile={handleFile} hasResult={!!result?.has_any_rows} />

      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '50px 0', gap: 12 }}>
          <CircularProgress color="primary" />
          <span style={{ fontSize: 13, color: C.gray400 }}>Matching SKUs and computing profit…</span>
        </div>
      )}

      {!loading && result?.saved_order_count > 0 && (
        <>
          <div
            style={{
              ...T.card,
              background: `linear-gradient(135deg, ${pos ? '#ECFDF5' : '#FFF1F2'} 0%, #fff 65%)`,
              border: `1.5px solid ${pos ? C.greenBorder : C.redBorder}`,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              flexWrap: 'wrap',
              gap: 24,
              padding: '22px 26px',
            }}
          >
            <div>
              <p
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: C.gray400,
                  letterSpacing: '0.12em',
                  marginBottom: 8,
                  textTransform: 'uppercase',
                }}
              >
                Net P&L — {fileName}
              </p>
              <p
                style={{
                  fontSize: 42,
                  fontWeight: 900,
                  fontFamily: 'monospace',
                  color: pos ? C.green : C.red,
                  lineHeight: 1,
                  letterSpacing: '-0.03em',
                }}
              >
                {pos ? '+' : ''}
                {fmt(netProfit)}
              </p>
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <span
                  style={{
                    background: pos ? C.greenLight : C.redLight,
                    color: pos ? C.green : C.red,
                    border: `1px solid ${pos ? C.greenBorder : C.redBorder}`,
                    fontSize: 11,
                    fontWeight: 700,
                    padding: '3px 12px',
                    borderRadius: 20,
                  }}
                >
                  {pos ? '✅ Profitable' : '❌ Loss'}
                </span>
                <span
                  style={{
                    background: '#F8FAFC',
                    color: C.gray600,
                    border: '1px solid #E2E8F0',
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '3px 12px',
                    borderRadius: 20,
                  }}
                >
                  {(totals.order_count ?? 0).toLocaleString()} order items scored
                </span>
                {result.created != null && (
                  <span
                    style={{
                      background: '#EFF6FF',
                      color: C.blue,
                      border: '1px solid #BFDBFE',
                      fontSize: 11,
                      fontWeight: 600,
                      padding: '3px 12px',
                      borderRadius: 20,
                    }}
                  >
                    💾 saved — {result.created} new · {result.updated} updated
                  </span>
                )}
              </div>
              {totals.is_loss_making && (
                <p style={{ fontSize: 12, color: C.gray600, marginTop: 12, maxWidth: 520, lineHeight: 1.5 }}>
                  {totals.loss_all_from_returns ? (
                    <>
                      This loss has <strong>no delivered orders</strong> behind it — every scored order item was a
                      return, so there's no per-unit price or cost to adjust. The fix here is fewer/cheaper returns,
                      not pricing.
                    </>
                  ) : (
                    <>
                      To break even, cut cost (or raise selling price) by{' '}
                      <strong style={{ color: C.red }}>{fmt(totals.required_adjustment_per_unit)}</strong> per
                      delivered unit, averaged across every delivered order this period — that closes the{' '}
                      <strong style={{ color: C.red }}>{fmt(totals.required_total_adjustment)}</strong> gap. See the
                      "To Break Even" column in the SKU-wise table below for which SKUs need it most.
                    </>
                  )}
                </p>
              )}
            </div>
            <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
              {[
                { label: 'Settlement Value', value: fmt(totals.gross_payout), color: C.gray800 },
                { label: 'Cost Deducted', value: fmt(totals.total_cost), color: C.red },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ textAlign: 'right' }}>
                  <p
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: C.gray400,
                      letterSpacing: '0.07em',
                      textTransform: 'uppercase',
                      marginBottom: 5,
                    }}
                  >
                    {label}
                  </p>
                  <p style={{ fontSize: 20, fontWeight: 800, fontFamily: 'monospace', color }}>{value}</p>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <KPICard
              label="Order Items Saved"
              value={(result.saved_order_count ?? 0).toLocaleString()}
              accent={C.gray600}
              sub="persisted across uploads"
            />
            <KPICard
              label="Order Items Scored"
              value={(totals.order_count ?? 0).toLocaleString()}
              accent={C.blue}
              sub="Delivered / Returned"
            />
            {result.total_rows != null && (
              <KPICard label="Rows in Last Upload" value={result.total_rows.toLocaleString()} accent={C.gray400} />
            )}
            {result.invalid_rows != null && (
              <KPICard
                label="Invalid Rows Skipped"
                value={result.invalid_rows.toLocaleString()}
                accent={C.gray400}
                sub="missing Seller SKU"
              />
            )}
            <KPICard
              label="SKUs Missing Pricing"
              value={result.missing_price_count.toLocaleString()}
              accent={result.missing_price_count > 0 ? C.red : C.green}
              sub={
                result.missing_price_count > 0
                  ? `${fmt(result.missing_price_settlement_sum)} settlement excluded`
                  : 'all matched'
              }
            />
            {result.non_loss_excluded_count > 0 && (
              <KPICard
                label="Non-Loss Returns Excluded"
                value={result.non_loss_excluded_count.toLocaleString()}
                accent={C.gray400}
                sub={`${fmt(result.non_loss_excluded_sum)} — returned, settlement wasn't negative`}
              />
            )}
          </div>

          {result.missing_price_count > 0 && (
            <div
              style={{ ...T.card, background: '#FFF1F2', border: `1.5px solid ${C.redBorder}`, padding: '14px 20px' }}
            >
              <p style={{ fontSize: 13, fontWeight: 700, color: C.red, marginBottom: 6 }}>
                ⚠ {result.missing_price_count} order item(s) excluded — SKU has no pricing set, so cost couldn't be
                computed
                {refreshing && <span style={{ fontWeight: 500, color: C.gray400 }}> · refreshing…</span>}
              </p>
              <p style={{ fontSize: 12, color: C.gray600, marginBottom: 10 }}>
                {fmt(result.missing_price_settlement_sum)} of settlement from these items is <strong>not</strong>{' '}
                included above. Add a price below and the profit updates immediately — no re-upload needed.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {result.missing_price_skus.map((sku) => (
                  <MissingPriceSkuRow key={sku} sku={sku} onSaved={refresh} />
                ))}
              </div>
            </div>
          )}

          <SectionCard title="Profit / Loss by Outcome">
            <StatusBreakdownTable rows={statusRows} />
          </SectionCard>

          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            {divergingChartData.length > 0 && (
              <SectionCard title="Net P&L by Outcome" style={{ flex: '1 1 380px' }}>
                <AppBarChart
                  dataset={divergingChartData}
                  indexKey="status"
                  series={[{ dataKey: 'net', label: 'Net P&L' }]}
                  diverging
                  valueFormatter={fmt}
                  height={230}
                />
              </SectionCard>
            )}
            {pieData.length > 0 && (
              <SectionCard title="Order Items by Outcome" style={{ flex: '0 0 300px' }}>
                <AppPieChart data={pieData} height={200} showLegend />
              </SectionCard>
            )}
          </div>

          {tornadoData.length > 0 && (
            <SectionCard
              title="Biggest Winners & Losers"
              subtitle="Top loss-making and top profit-making SKUs across all saved order items"
            >
              <AppBarChart
                dataset={tornadoData}
                indexKey="sku"
                series={[{ dataKey: 'net', label: 'Net P&L' }]}
                diverging
                layout="horizontal"
                valueFormatter={fmt}
                height={Math.max(160, tornadoData.length * 28)}
              />
            </SectionCard>
          )}

          {result.monthly_trend?.length > 1 && (
            <SectionCard title="Net P&L Trend" subtitle="Month-wise settlement vs. net profit, across priced order items">
              <AppLineChart
                dataset={result.monthly_trend}
                indexKey="month"
                series={[
                  { dataKey: 'gross', label: 'Settlement', color: C.blue },
                  { dataKey: 'net', label: 'Net P&L', color: C.green },
                ]}
                valueFormatter={fmt}
                height={240}
              />
            </SectionCard>
          )}

          {result.payment_breakdown && (
            <SectionCard
              title="Payment Reconciliation"
              subtitle="How the Bank Settlement Value was made up, straight from the settlement report — independent of SKU pricing"
            >
              <PaymentBreakdownTable breakdown={result.payment_breakdown} />
            </SectionCard>
          )}

          {result.sku_payment_list?.length > 0 && (
            <SectionCard
              title="Full Payment List — SKU-wise"
              subtitle="Every SKU that was settled, with the full breakdown of how its amount was settled and the final Bank Settlement Value — includes SKUs with no price set yet and return-only SKUs"
            >
              <SkuPaymentListTable rows={result.sku_payment_list} onRelinked={refresh} dateQuery={dateQuery()} />
            </SectionCard>
          )}

          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            {result.fulfilment_breakdown?.length > 0 && (
              <SectionCard title="P&L by Fulfilment Type" style={{ flex: '1 1 380px' }}>
                <SimpleBreakdownTable rows={result.fulfilment_breakdown} nameHeader="Fulfilment Type" />
              </SectionCard>
            )}
            {result.category_breakdown?.length > 0 && (
              <SectionCard title="P&L by Product Category" style={{ flex: '1 1 380px' }}>
                <SimpleBreakdownTable rows={result.category_breakdown} nameHeader="Category" />
              </SectionCard>
            )}
          </div>

          <SectionCard title="SKU-wise Profit / Loss">
            <SkuProfitTable rows={result.sku_wise} onRelinked={refresh} />
          </SectionCard>
        </>
      )}

      {!loading && !error && result?.saved_order_count === 0 && (
        <p style={{ fontSize: 12, color: C.gray400, textAlign: 'center', padding: '20px 0' }}>
          {result.has_any_rows
            ? `No Flipkart order items fall within ${periodLabel} — try a different period above.`
            : `Upload a Flipkart Settlement Report to see the profit / loss breakdown for ${periodLabel}.`}
        </p>
      )}
    </div>
  );
}
