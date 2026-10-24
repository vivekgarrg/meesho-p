import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CircularProgress from '@mui/material/CircularProgress';
import { API, C, S, fmt } from '../../shared';
import { useBusiness } from '../../contexts/BusinessContext';
import { useDateFilter } from '../../contexts/DateFilterContext';
import { AppBarChart } from '../Charts/AppBarChart';
import { AppLineChart } from '../Charts/AppLineChart';
import { AppPieChart } from '../Charts/AppPieChart';
import { FlipkartDeepDive } from './FlipkartDeepDive';
import { EmptyState, ErrorNote, FLIPKART_COLOR, HIDDEN_AMOUNT, ORDER_STATUS_META, useFlipkartApi } from './FlipkartShared';

/*
 * Flipkart overview — laid out exactly like the Meesho one: an Overview tab (net
 * P&L hero behind the eye, lifetime totals, outcome cards, the profit formula, the
 * settlement table, deductions) and an Insights & Charts tab (percentages, this
 * period against the last, and the charts). It is assembled from the Meesho
 * overview's own cards (handed in as `parts` by OverviewTab), so the two read the
 * same; only the numbers come from Flipkart's settlement and orders reports.
 */

const pctOf = (n, d) => (d > 0 ? ((Number(n) / Number(d)) * 100).toFixed(1) : '0.0');
const count = (n) => Number(n || 0).toLocaleString('en-IN');
const ratio = (n, d) => (Number(d) > 0 ? (Number(n) / Number(d)) * 100 : null);
const fmtPct = (v) => (v == null || Number.isNaN(v) ? '—' : `${v.toFixed(1)}%`);
const fmtNum = (v) => (v == null || Number.isNaN(v) ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: 1 }));

const DAY_MS = 86400000;
const ymd = (s) => {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** Days a period covers (capped at today); all-time falls back to first→last order. */
function daysIn(range, orders) {
  let from;
  let to;
  if (range?.date_from && range?.date_to) {
    from = ymd(range.date_from);
    to = ymd(range.date_to);
  } else {
    const ds = (orders?.daily || []).map((d) => d.order_date).sort();
    if (!ds.length) return 1;
    from = ymd(ds[0]);
    to = ymd(ds[ds.length - 1]);
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (to > today && from <= today) to = today;
  return Math.max(1, Math.round((to - from) / DAY_MS) + 1);
}

function metricsOf(d, days) {
  if (!d) return null;
  const items = d.orders.total_items || 0;
  const net = Number(d.net_profit || 0);
  const cost = Number(d.summary.totals.total_cost || 0);
  const sales = Number(d.summary.payment_breakdown?.sale_amount || 0);
  return {
    items, days, net,
    roi: ratio(net, cost),
    margin: ratio(net, sales),
    returnPct: Number(d.orders.return_rate_pct || 0),
    cancelPct: Number(d.orders.cancel_rate_pct || 0),
    deliveredPct: ratio(d.orders.delivered, items),
    ordersPerDay: items / days,
    profitPerDay: net / days,
    profitPerOrder: items > 0 ? net / items : null,
  };
}

function ReasonList({ rows, empty }) {
  if (!rows.length) return <p style={{ fontSize: 12, color: C.gray400 }}>{empty}</p>;
  const max = Math.max(...rows.map((r) => r.count));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map((r) => (
        <div key={r.reason}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
            <span style={{ color: C.gray700, overflowWrap: 'anywhere' }}>{r.reason}</span>
            <span style={{ fontFamily: 'monospace', fontWeight: 700, color: C.gray600 }}>{r.count}</span>
          </div>
          <div style={{ height: 5, borderRadius: 3, background: C.gray100 }}>
            <div style={{ height: 5, borderRadius: 3, width: `${(r.count / max) * 100}%`, background: C.gray400 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function FlipkartOverviewPanel({ parts }) {
  const { T, SectionCard, KPICard, StatRow, RateBar, FormulaStep, OutcomeCard, SettlementTable, DeductionRow, LifetimeTotals, Delta, previousRange } = parts;
  const navigate = useNavigate();
  const { activeBusiness } = useBusiness();
  const { range, label: periodLabel } = useDateFilter();
  const { data, loading, error } = useFlipkartApi('/flipkart-overview/');
  const [subTab, setSubTab] = useState('overview');
  const [deepSection, setDeepSection] = useState('fees');
  // Open the full breakdown of a figure (fees / sla / fines) from wherever it appears.
  const goDeep = (section) => { setDeepSection(section); setSubTab('deep'); };
  const [showPnl, setShowPnl] = useState(false);       // profit & loss stay masked until the eye is clicked

  // The previous period, only fetched once the Insights tab is opened.
  const prevRange = previousRange(range);
  const [prev, setPrev] = useState(null);
  useEffect(() => {
    if (subTab !== 'insights' || !prevRange) { setPrev(null); return undefined; }
    const ctrl = new AbortController();
    fetch(`${API}/flipkart-overview/?${new URLSearchParams(prevRange)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then(setPrev)
      .catch(() => {});
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab, JSON.stringify(range)]);

  const businessName = activeBusiness?.name || 'this business';
  const cur = useMemo(() => metricsOf(data, daysIn(range, data?.orders)), [data, range]);
  const prevM = useMemo(() => (prev && prev.orders.total_items > 0 ? metricsOf(prev, daysIn(prevRange, prev.orders)) : null), [prev]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !data) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
        <CircularProgress style={{ color: FLIPKART_COLOR }} />
      </div>
    );
  }
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;
  if (!data.has_data) {
    return (
      <EmptyState title={`No Flipkart data for ${businessName} yet`}>
        Upload the Flipkart Settlement Report and the Orders report from Upload Data and the Flipkart overview for {businessName} appears here.
        <br />
        <button
          type="button"
          onClick={() => navigate('/upload')}
          style={{ marginTop: 16, padding: '9px 20px', borderRadius: 10, border: 'none', background: FLIPKART_COLOR, color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
        >
          Go to Upload Data
        </button>
      </EmptyState>
    );
  }

  const { summary, orders, other_charges: other } = data;
  const totals = summary.totals;
  const pay = summary.payment_breakdown || {};
  const net = Number(data.net_profit || 0);
  const pos = net >= 0;
  const orderNet = Number(totals.net_profit || 0);
  const nTotal = totals.order_count || 0;
  const bucket = Object.fromEntries((summary.status_breakdown || []).map((b) => [b.status, b]));
  const delivered = bucket.Delivered || { count: 0, gross: 0, cost: 0, net: 0 };
  const returned = bucket.Returned || { count: 0, gross: 0, cost: 0, net: 0 };
  const sales = Number(pay.sale_amount || 0);

  // ── Deductions: what came off the sale on the way to the bank ─────────────
  const deductions = [
    { label: 'Marketplace fee', value: pay.marketplace_fee, color: '#D97706' },
    { label: 'Taxes (GST on sale)', value: pay.taxes, color: '#64748B' },
    { label: 'GST on marketplace fees', value: pay.gst_on_mp_fees, color: '#64748B' },
    { label: 'TCS', value: pay.tcs, color: '#64748B' },
    { label: 'TDS', value: pay.tds, color: '#64748B' },
    { label: 'Protection fund', value: pay.protection_fund, color: '#D97706' },
    { label: 'Refunds', value: pay.refund, color: C.red },
    { label: 'Offer adjustments', value: pay.offer_adjustments, color: C.red },
  ].filter((d) => Math.abs(Number(d.value || 0)) > 0.005);
  const deductPie = deductions.map((d) => ({ label: d.label, value: Math.abs(Number(d.value)) }));

  const settlementRows = [
    { icon: '✅', label: 'Delivered', count: delivered.count, gross: delivered.gross, cost: -Number(delivered.cost || 0), net: delivered.net, rate: pctOf(delivered.count, nTotal), netColor: C.green },
    { icon: '↩', label: 'Returned', count: returned.count, gross: returned.gross, cost: -Number(returned.cost || 0), net: returned.net, rate: pctOf(returned.count, nTotal), netColor: returned.net >= 0 ? C.gray600 : C.red },
  ];

  // ── Insights data ─────────────────────────────────────────────────────────
  const statusPie = orders.by_status.map((s) => ({
    id: s.status, label: (ORDER_STATUS_META[s.status] || {}).label || s.status, value: s.count,
    color: (ORDER_STATUS_META[s.status] || {}).color || C.gray400,
  }));
  const moneySplit = [
    { label: 'Net profit', value: Math.max(net, 0), color: C.green },
    { label: 'Cost of goods', value: Math.abs(Number(totals.total_cost || 0)), color: C.blue },
    { label: 'Marketplace fee', value: Math.abs(Number(pay.marketplace_fee || 0)), color: C.amber },
    { label: 'Taxes & TCS/TDS', value: Math.abs(Number(pay.taxes || 0)) + Math.abs(Number(pay.tcs || 0)) + Math.abs(Number(pay.tds || 0)) + Math.abs(Number(pay.gst_on_mp_fees || 0)), color: C.gray400 },
    { label: 'Ads, fines & other', value: Math.abs(Math.min(Number(other.total || 0), 0)), color: C.orange },
  ].filter((d) => d.value > 0.01);
  const outcomeBars = (summary.status_breakdown || []).filter((r) => r.count > 0).map((r) => ({ status: r.status, net: r.net }));
  const winners = summary.top_profit_skus || [];
  const losers = summary.top_loss_skus || [];
  const tornado = [...losers].reverse().concat(winners).map((r) => ({ sku: r.sku_id, net: r.net_profit }));
  const daily = orders.daily.map((d) => ({ day: d.order_date.slice(5), count: d.count }));
  // Settlements per payment day against orders placed per day — the same
  // "Daily Settlement Activity" chart as the Meesho Overview.
  const payments = data.payments || { daily: [], by_status: [] };
  const timelineData = (() => {
    const map = {};
    (payments.daily || []).forEach(({ payment_date, count: n }) => {
      const d = String(payment_date);
      map[d] = { ...(map[d] || { date: d, settlements: 0, orders: 0 }), settlements: n };
    });
    (orders.daily || []).forEach(({ order_date, count: n }) => {
      const d = String(order_date);
      map[d] = { ...(map[d] || { date: d, settlements: 0, orders: 0 }), orders: n };
    });
    return Object.values(map).sort((a, b) => (a.date > b.date ? 1 : -1));
  })();
  const orderStatusBars = (orders.by_status || []).map((r) => ({ status: String(r.status || 'UNKNOWN').replace(/_/g, ' '), count: r.count }));
  const paymentStatusBars = (payments.by_status || []).map((r) => ({ status: r.status, count: r.count }));

  const compareRows = cur && [
    { label: 'Order items', cur: cur.items, prev: prevM?.items, f: fmtNum, mode: 'pct' },
    { label: 'Net profit', cur: cur.net, prev: prevM?.net, f: fmt, mode: 'pct' },
    { label: 'ROI', cur: cur.roi, prev: prevM?.roi, f: fmtPct, mode: 'pts' },
    { label: 'Profit margin', cur: cur.margin, prev: prevM?.margin, f: fmtPct, mode: 'pts' },
    { label: 'Delivered %', cur: cur.deliveredPct, prev: prevM?.deliveredPct, f: fmtPct, mode: 'pts' },
    { label: 'Return %', cur: cur.returnPct, prev: prevM?.returnPct, f: fmtPct, mode: 'pts', down: true },
    { label: 'Cancelled %', cur: cur.cancelPct, prev: prevM?.cancelPct, f: fmtPct, mode: 'pts', down: true },
    { label: 'Avg orders / day', cur: cur.ordersPerDay, prev: prevM?.ordersPerDay, f: fmtNum, mode: 'pct' },
    { label: 'Avg profit / day', cur: cur.profitPerDay, prev: prevM?.profitPerDay, f: fmt, mode: 'pct' },
    { label: 'Avg profit / order', cur: cur.profitPerOrder, prev: prevM?.profitPerOrder, f: (v) => (v == null ? '—' : fmt(v)), mode: 'pct' },
  ];

  const tabBtn = (key, label) => (
    <button
      key={key}
      type="button"
      onClick={() => setSubTab(key)}
      style={{
        background: 'none', border: 'none', borderBottom: `3px solid ${subTab === key ? C.orange : 'transparent'}`,
        padding: '10px 18px', fontSize: 13, fontWeight: subTab === key ? 800 : 600,
        color: subTab === key ? C.gray800 : C.gray500, cursor: 'pointer', marginBottom: -1,
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: C.gray800, marginBottom: 4 }}>Flipkart overview — {businessName}</h2>
        <p style={{ fontSize: 12, color: C.gray400 }}>{periodLabel} · each business shows only its own Flipkart settlements and orders.</p>
      </div>

      <div style={{ display: 'flex', gap: 6, borderBottom: '1px solid #E2E8F0' }}>
        {tabBtn('overview', '📊 Overview')}
        {tabBtn('insights', '📈 Insights & Charts')}
        {tabBtn('deep', '🔎 Fees, SLA & Fines')}
      </div>

      {/* ── Hero ── same banner as Meesho's ─────────────────────────────── */}
      {summary.has_any_rows && (
        <div
          style={{
            ...T.card,
            background: `linear-gradient(135deg, ${!showPnl ? '#F8FAFC' : pos ? '#ECFDF5' : '#FFF1F2'} 0%, #fff 65%)`,
            border: `1.5px solid ${!showPnl ? C.gray200 : pos ? C.greenBorder : C.redBorder}`,
            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 24, padding: '24px 28px',
          }}
        >
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: C.gray400, letterSpacing: '0.12em', marginBottom: 8, textTransform: 'uppercase' }}>
              Net P&L — {periodLabel}
              <button
                type="button"
                onClick={() => setShowPnl((v) => !v)}
                title={showPnl ? 'Hide profit & loss' : 'Show profit & loss'}
                aria-label={showPnl ? 'Hide profit and loss' : 'Show profit and loss'}
                style={{ marginLeft: 8, verticalAlign: 'middle', cursor: 'pointer', border: `1px solid ${C.gray200}`, background: '#fff', borderRadius: 8, padding: '2px 8px', fontSize: 14, lineHeight: 1.4 }}
              >
                {showPnl ? '🙈' : '👁'}
              </button>
            </p>
            <p style={{ fontSize: 48, fontWeight: 900, fontFamily: 'monospace', color: !showPnl ? C.gray300 : pos ? C.green : C.red, lineHeight: 1, letterSpacing: '-0.03em' }}>
              {showPnl ? `${pos ? '+' : ''}${fmt(net)}` : HIDDEN_AMOUNT}
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              {showPnl && (
                <span style={{ background: pos ? C.greenLight : C.redLight, color: pos ? C.green : C.red, border: `1px solid ${pos ? C.greenBorder : C.redBorder}`, fontSize: 11, fontWeight: 700, padding: '3px 12px', borderRadius: 20 }}>
                  {pos ? '✅ Profitable' : '❌ In Loss'}
                </span>
              )}
              <span style={{ background: '#F8FAFC', color: C.gray600, border: '1px solid #E2E8F0', fontSize: 11, fontWeight: 600, padding: '3px 12px', borderRadius: 20 }}>
                {count(nTotal)} settled items
              </span>
              <span style={{ background: '#FFF7ED', color: C.amber, border: '1px solid #FDE68A', fontSize: 11, fontWeight: 600, padding: '3px 12px', borderRadius: 20 }}>
                {other.count} ads / fines / other
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
            {[
              { label: 'Gross Sales', value: fmt(sales), color: C.gray800 },
              { label: 'Net Settlement', value: fmt(pay.settlement_value), color: C.green },
              { label: 'Order Net P&L', value: showPnl ? fmt(orderNet) : HIDDEN_AMOUNT, color: !showPnl ? C.gray300 : orderNet >= 0 ? C.green : C.red },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ textAlign: 'right' }}>
                <p style={{ fontSize: 10, fontWeight: 700, color: C.gray400, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 5 }}>{label}</p>
                <p style={{ fontSize: 22, fontWeight: 800, fontFamily: 'monospace', color }}>{value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {summary.missing_price_count > 0 && (
        <div style={{ ...S.card, background: C.redLight, border: `1.5px solid ${C.redBorder}`, padding: '14px 20px' }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: C.red, marginBottom: 4 }}>
            ⚠ {summary.missing_price_count} settled item(s) left out of profit — {summary.missing_price_skus.length} SKU(s) have no price
          </p>
          <p style={{ fontSize: 12, color: C.gray600 }}>
            {summary.missing_price_skus.slice(0, 8).join(', ')}
            {summary.missing_price_skus.length > 8 && ` and ${summary.missing_price_skus.length - 8} more`}. Add a price, or link each to a parent, in{' '}
            <button type="button" onClick={() => navigate('/sku-analysis?platform=flipkart')}
              style={{ border: 'none', background: 'none', padding: 0, color: C.blue, fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>
              SKU Analysis
            </button>
            .
          </p>
        </div>
      )}

      {subTab === 'overview' && (
        <>
          <LifetimeTotals combinedIds={null} path="flipkart-overall/" />

          {/* Outcome cards */}
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            <OutcomeCard
              icon="✅" label="DELIVERED" count={delivered.count} rate={pctOf(delivered.count, nTotal)} rateColor={C.green}
              netLabel="Net Profit" net={Number(delivered.net || 0)} netColor={delivered.net > 0 ? C.green : C.red}
              onClick={() => navigate('/payments?platform=flipkart')}
              subStats={[
                { label: 'Gross settlement', value: fmt(delivered.gross) },
                { label: 'Item cost', value: fmt(delivered.cost), color: C.red },
              ]}
            />
            <OutcomeCard
              icon="↩" label="RETURNED" count={returned.count} rate={pctOf(returned.count, nTotal)} rateColor={returned.net >= 0 ? C.gray600 : C.red}
              netLabel="Net Profit" net={Number(returned.net || 0)} netColor={returned.net > 0 ? C.green : C.red}
              onClick={() => navigate('/payments?platform=flipkart')}
              subStats={[
                { label: 'Gross settlement', value: fmt(returned.gross) },
                { label: 'Item cost', value: fmt(returned.cost), color: C.red },
              ]}
            />
          </div>

          {/* Profit formula + order P&L */}
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            <SectionCard title="Profit Formula" style={{ flex: '1 1 340px', minWidth: 0 }}>
              <p style={{ fontSize: 11, color: C.gray400, marginBottom: 14, lineHeight: 1.7 }}>
                Marketplace fees, taxes and offers are already taken off inside Flipkart's settlement — not subtracted again here.
              </p>
              <FormulaStep sign="+" label="Net Settlement" value={totals.gross_payout} color={C.green} note="bank settlement of the order items we have a price for" />
              <FormulaStep sign="-" label="Cost of goods" value={totals.total_cost} color={C.red} note="item price, GST and packaging from the SKU pricing table" />
              <FormulaStep sign="=" label="Order Net P&L" value={orderNet} color={orderNet >= 0 ? C.green : C.red} bold divider />
              {other.by_category.map((c) => (
                <FormulaStep key={c.category} sign={c.total < 0 ? '−' : '+'} label={c.label} value={c.total} color={c.total < 0 ? C.orange : C.green} note={`${c.count} settlement line(s)`} />
              ))}
              <FormulaStep sign="=" label="NET P&L (Final)" value={net} color={pos ? C.green : C.red} bold divider />
            </SectionCard>

            <div style={{ flex: '1 1 380px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <SectionCard title="Order P&L Breakdown">
                <StatRow label={`✅ Delivered (${delivered.count})`} value={fmt(delivered.net)} color={C.green} sub="settlement − item cost" />
                <StatRow label={`↩ Returned (${returned.count}) · ${pctOf(returned.count, nTotal)}%`} value={fmt(returned.net)} color={returned.net >= 0 ? C.gray600 : C.red} sub="what the return cost after the refund" />
                <StatRow label={`⊘ Ads, fines & other · ${other.count} lines`} value={fmt(other.total)} color={other.total >= 0 ? C.gray600 : C.red} sub="settlement-report charges outside any order" />
              </SectionCard>
            </div>
          </div>

          {/* Settlement by status */}
          <SectionCard title="Settlement by Order Status">
            <SettlementTable
              rows={settlementRows}
              total={{ count: delivered.count + returned.count, gross: delivered.gross + returned.gross, cost: -(Number(delivered.cost || 0) + Number(returned.cost || 0)), net: orderNet }}
            />
          </SectionCard>

          {/* Deductions */}
          {deductions.length > 0 && (
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
              <SectionCard title="Flipkart Deductions" style={{ flex: '1 1 380px', minWidth: 0 }}>
                <button type="button" onClick={() => goDeep('fees')} style={{ float: 'right', border: 'none', background: 'none', color: C.blue, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                  Fee analysis →
                </button>
                <p style={{ fontSize: 11, color: C.gray400, marginBottom: 10 }}>
                  What came off {fmt(sales)} of sales on the way to {fmt(pay.settlement_value)} in the bank.
                </p>
                {deductions.map((d) => (
                  <DeductionRow key={d.label} label={d.label} value={d.value} pct={sales > 0 ? ((Math.abs(Number(d.value)) / sales) * 100).toFixed(1) : undefined} color={Number(d.value) < 0 ? C.red : C.gray800} />
                ))}
              </SectionCard>
              <SectionCard title="Deduction Split" style={{ flex: '0 0 340px' }}>
                <AppPieChart data={deductPie} height={230} showLegend valueFormatter={fmt} />
              </SectionCard>
            </div>
          )}

          {/* What the Orders report says */}
          {orders.total_items > 0 && (
            <>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                <div style={{ display: 'contents' }} onClick={() => goDeep('fees')}>
                  <KPICard style={{ cursor: 'pointer' }} label="Marketplace fee" value={fmt(Math.abs(Number(pay.marketplace_fee || 0)))} color={C.red} icon="🏷️"
                    sub={`${pctOf(Math.abs(Number(pay.marketplace_fee || 0)) + Math.abs(Number(pay.gst_on_mp_fees || 0)), sales)}% of sales · see why →`} />
                </div>
                <KPICard label="Order items" value={count(orders.total_items)} accent={FLIPKART_COLOR} icon="🛍️" sub={`${count(orders.total_units)} units`} />
                <KPICard label="Cancelled" value={count(orders.cancelled)} color={C.gray600} icon="🚫" sub={`${orders.cancel_rate_pct}% of orders`} />
                <KPICard label="Delivered, not paid yet" value={count(orders.delivered_unsettled)} color={orders.delivered_unsettled ? C.amber : undefined} icon="⏳" sub="No settlement row yet" />
                <KPICard label="Returned after payout" value={count(orders.returned_after_settlement)} color={orders.returned_after_settlement ? C.red : undefined} icon="↩" sub="Clawback due" />
                <div style={{ display: 'contents' }} onClick={() => goDeep('sla')}>
                  <KPICard style={{ cursor: 'pointer' }} label="SLA breaches" value={count(orders.dispatch_sla_breached + orders.delivery_sla_breached)} color={C.amber} icon="⏱" sub={`${orders.dispatch_sla_breached} dispatch · ${orders.delivery_sla_breached} delivery · see details →`} />
                </div>
                <div style={{ display: 'contents' }} onClick={() => goDeep('fines')}>
                  <KPICard style={{ cursor: 'pointer' }} label="Ads, fines & other" value={fmt(other.total)} color={other.total < 0 ? C.red : C.green} icon="💸" sub={`${other.count} line(s) · see every line →`} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
                {orders.return_reasons.length > 0 && (
                  <SectionCard title="Why items come back" style={{ flex: '1 1 340px' }}>
                    <ReasonList rows={orders.return_reasons} empty="No returns in this period." />
                  </SectionCard>
                )}
                {orders.cancel_reasons.length > 0 && (
                  <SectionCard title="Why orders are cancelled" style={{ flex: '1 1 340px' }}>
                    <ReasonList rows={orders.cancel_reasons} empty="No cancellations in this period." />
                  </SectionCard>
                )}
              </div>
            </>
          )}

          {/* Daily settlement activity — same as the Meesho Overview */}
          {timelineData.length > 0 && (
            <SectionCard title="Daily Settlement Activity">
              <p style={{ fontSize: 11, color: C.gray400, marginBottom: 10 }}>
                Settlements per day vs orders placed. Gap = pending settlement.
              </p>
              <AppLineChart
                dataset={timelineData}
                indexKey="date"
                series={[
                  { dataKey: 'settlements', label: 'Settlements', color: C.green },
                  { dataKey: 'orders', label: 'Orders Placed', color: FLIPKART_COLOR },
                ]}
                maxTicks={15}
                height={230}
              />
            </SectionCard>
          )}

          {/* Orders + Payments by status — same as the Meesho Overview */}
          {(orderStatusBars.length > 0 || paymentStatusBars.length > 0) && (
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
              {orderStatusBars.length > 0 && (
                <SectionCard title="Orders by Lifecycle Status" style={{ flex: '1 1 300px', minWidth: 0 }}>
                  <AppBarChart dataset={orderStatusBars} indexKey="status" series={[{ dataKey: 'count', label: 'Orders', color: FLIPKART_COLOR }]} height={200} />
                </SectionCard>
              )}
              {paymentStatusBars.length > 0 && (
                <SectionCard title="Payments by Settlement Status" style={{ flex: '1 1 300px', minWidth: 0 }}>
                  <AppBarChart dataset={paymentStatusBars} indexKey="status" series={[{ dataKey: 'count', label: 'Payments', color: FLIPKART_COLOR }]} height={200} />
                </SectionCard>
              )}
            </div>
          )}
        </>
      )}

      {subTab === 'deep' && <FlipkartDeepDive key={deepSection} initial={deepSection} />}

      {subTab === 'insights' && cur && (
        <>
          <SectionCard title="Percentage Insights">
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 18 }}>
              <KPICard label="ROI" value={fmtPct(cur.roi)} color={cur.roi == null ? C.gray800 : cur.roi >= 0 ? C.green : C.red} icon="📈" sub="net profit ÷ cost of goods" />
              <KPICard label="Return %" value={fmtPct(cur.returnPct)} color={C.red} icon="↩" sub={`${count(orders.returned)} returned items`} />
              <KPICard label="Cancelled %" value={fmtPct(cur.cancelPct)} color={C.gray600} icon="🚫" sub={`${count(orders.cancelled)} cancelled`} />
              <KPICard label="Orders vs last period" value={prevM ? <Delta cur={cur.items} prev={prevM.items} /> : '—'} icon="📦"
                sub={prevM ? `${fmtNum(prevM.items)} → ${fmtNum(cur.items)} items` : prevRange ? 'no earlier data' : 'select a month to compare'} />
              <KPICard label="Avg orders / day" value={fmtNum(cur.ordersPerDay)} icon="🗓️" sub={`over ${cur.days} day${cur.days === 1 ? '' : 's'}`} />
              <KPICard label="Avg profit / day" value={fmt(cur.profitPerDay)} color={cur.profitPerDay >= 0 ? C.green : C.red} icon="💰" sub={cur.profitPerOrder == null ? undefined : `${fmt(cur.profitPerOrder)} per order`} />
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    {['Metric', 'This period', prevM ? 'Previous' : 'Previous', 'Change'].map((h, i) => (
                      <th key={h + i} style={{ ...T.label, textAlign: i === 0 ? 'left' : 'right', padding: '6px 10px', borderBottom: '1px solid #E2E8F0' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {compareRows.map((r) => (
                    <tr key={r.label} style={{ borderBottom: '1px solid #F1F5F9' }}>
                      <td style={{ padding: '8px 10px', color: C.gray500 }}>{r.label}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: C.gray800 }}>{r.f(r.cur)}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: C.gray500 }}>{prevM ? r.f(r.prev) : '—'}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right' }}><Delta cur={r.cur} prev={r.prev} mode={r.mode} goodWhenDown={r.down} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>

          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            <SectionCard title="Outcome Rates" style={{ flex: '1 1 340px' }}>
              <RateBar label="✅ Delivered" pct={Number(pctOf(orders.delivered, orders.total_items))} count={orders.delivered} color={C.green} />
              <RateBar label="↩ Returned" pct={Number(orders.return_rate_pct || 0)} count={orders.returned} color={C.red} />
              <RateBar label="🚫 Cancelled" pct={Number(orders.cancel_rate_pct || 0)} count={orders.cancelled} color={C.gray400} />
            </SectionCard>
            <SectionCard title="Order Items by Status" style={{ flex: '0 0 320px' }}>
              <AppPieChart data={statusPie} height={210} showLegend />
            </SectionCard>
            <SectionCard title="Where the Money Goes" style={{ flex: '1 1 340px' }}>
              {moneySplit.length ? <AppPieChart data={moneySplit} height={230} showLegend valueFormatter={fmt} /> : <p style={{ fontSize: 12, color: C.gray400 }}>No data.</p>}
            </SectionCard>
          </div>

          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            {outcomeBars.length > 0 && (
              <SectionCard title="Net P&L by Outcome" style={{ flex: '1 1 380px' }}>
                <AppBarChart dataset={outcomeBars} indexKey="status" series={[{ dataKey: 'net', label: 'Net P&L' }]} diverging valueFormatter={fmt} height={220} />
              </SectionCard>
            )}
            {summary.monthly_trend.length > 1 && (
              <SectionCard title="Net P&L Trend" style={{ flex: '1 1 380px' }}>
                <AppLineChart
                  dataset={summary.monthly_trend}
                  indexKey="month"
                  series={[{ dataKey: 'gross', label: 'Settlement', color: C.blue }, { dataKey: 'net', label: 'Net P&L', color: C.green }]}
                  valueFormatter={fmt}
                  height={220}
                />
              </SectionCard>
            )}
          </div>

          {daily.length > 1 && (
            <SectionCard title="Orders per Day">
              <AppBarChart dataset={daily} indexKey="day" series={[{ dataKey: 'count', label: 'Orders', color: FLIPKART_COLOR }]} height={220} maxTicks={14} />
            </SectionCard>
          )}

          {tornado.length > 0 && (
            <SectionCard title="Biggest Winners & Losers" >
              <AppBarChart
                dataset={tornado}
                indexKey="sku"
                series={[{ dataKey: 'net', label: 'Net P&L' }]}
                diverging
                layout="horizontal"
                margin={{ top: 10, right: 30, bottom: 30, left: 180 }}
                valueFormatter={fmt}
                height={Math.max(160, tornado.length * 28)}
              />
            </SectionCard>
          )}
        </>
      )}
    </div>
  );
}
