import React, { useState } from 'react';
import CircularProgress from '@mui/material/CircularProgress';
import { C, S, fmt } from '../../shared';
import { AppBarChart } from '../Charts/AppBarChart';
import { AppLineChart } from '../Charts/AppLineChart';
import { AppPieChart } from '../Charts/AppPieChart';
import { ErrorNote, FLIPKART_COLOR, Kpi, KpiRow, PillFilter, Section, useFlipkartApi } from './FlipkartShared';

/*
 * The numbers behind three Overview figures, taken apart: the marketplace fee,
 * SLA breaches, and fines / other settlement charges. Each section answers "what
 * is this, how big, where does it come from, and what should I look at".
 */

const th = { padding: '8px 10px', textAlign: 'right', fontSize: 10.5, fontWeight: 700, color: C.gray500, textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: `2px solid ${C.gray200}`, background: C.gray50, whiteSpace: 'nowrap' };
const td = { padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 12.5, color: C.gray700, borderBottom: `1px solid ${C.gray100}`, whiteSpace: 'nowrap' };
const tdL = { ...td, textAlign: 'left', fontFamily: 'inherit', whiteSpace: 'normal' };
const pct = (v) => (v == null ? '—' : `${v}%`);
const monthLabel = (m) => (m && m !== 'Unknown' ? new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }) : m);

function Table({ cols, rows, empty = 'Nothing in this period.', maxHeight }) {
  if (!rows.length) return <p style={{ fontSize: 12, color: C.gray400 }}>{empty}</p>;
  return (
    <div style={{ overflow: 'auto', maxHeight }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>{cols.map((c, i) => <th key={c.label} style={{ ...th, textAlign: i === 0 ? 'left' : 'right', position: maxHeight ? 'sticky' : undefined, top: 0 }}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>{cols.map((c, i) => <td key={c.label} style={i === 0 ? tdL : { ...td, ...(c.style ? c.style(r) : {}) }}>{c.render(r)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A plain-language read of the numbers — the "so what". */
function Insight({ children, tone = 'info' }) {
  const t = { info: [C.blueLight, '#BFDBFE', '#1E40AF'], warn: [C.amberLight, C.amberBorder, '#92400E'], bad: [C.redLight, C.redBorder, C.red], good: [C.greenLight, C.greenBorder, C.green] }[tone];
  return (
    <div style={{ background: t[0], border: `1px solid ${t[1]}`, color: t[2], borderRadius: 10, padding: '10px 14px', fontSize: 12.5, lineHeight: 1.6, fontWeight: 500 }}>
      {children}
    </div>
  );
}

// ── Marketplace fees ──────────────────────────────────────────────────────────

function Fees({ f }) {
  if (!f.items) return <Section title="Marketplace fees"><p style={{ fontSize: 12, color: C.gray400 }}>No settled items in this period.</p></Section>;
  const avg = f.rate_pct || 0;
  const monthly = f.by_month.map((m) => ({ month: m.month, rate: m.rate_pct ?? 0, fee: m.fee }));
  const high = f.by_sku.filter((s) => s.rate_pct != null && s.rate_pct > avg * 1.25 && s.items >= 2);
  const biggest = f.by_sku[0];
  return (
    <>
      <KpiRow>
        <Kpi label="Total marketplace cost" value={fmt(f.total_fee)} accent={C.amber} color={C.red} sub={`fee ${fmt(f.marketplace_fee)} + GST ${fmt(f.gst_on_fee)}`} />
        <Kpi label="Effective fee rate" value={pct(f.rate_pct)} accent={FLIPKART_COLOR} sub="of the sale amount" />
        <Kpi label="Avg fee per item" value={fmt(f.avg_fee_per_item)} accent={C.gray600} sub={`${f.items.toLocaleString('en-IN')} settled items`} />
        <Kpi label="Gross sales" value={fmt(f.sale)} accent={C.gray600} sub="before fees and refunds" />
      </KpiRow>

      <Insight>
        Out of every <b>₹100</b> you sell, Flipkart keeps about <b>₹{avg}</b> in marketplace fees and the GST on them. Flipkart reports the fee
        as one figure per item, so the split below is by <b>where</b> it was charged — month, fulfilment type, category and SKU.
        {biggest && <> Your biggest fee bill is <b>{biggest.sku}</b> at {fmt(biggest.fee)} ({pct(biggest.rate_pct)} of its sales).</>}
      </Insight>
      {high.length > 0 && (
        <Insight tone="warn">
          {high.length} SKU{high.length === 1 ? ' is' : 's are'} paying a fee rate more than a quarter above your {avg}% average:{' '}
          <b>{high.slice(0, 4).map((s) => `${s.sku} (${s.rate_pct}%)`).join(', ')}</b>. Check the weight/price slab or the category on those listings.
        </Insight>
      )}

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        {monthly.length > 1 && (
          <Section title="Fee rate by month" subtitle="% of sales taken as marketplace fee" style={{ flex: '1 1 380px' }}>
            <AppLineChart dataset={monthly} indexKey="month" series={[{ dataKey: 'rate', label: 'Fee rate %', color: C.amber }]} valueFormatter={(v) => `${v}%`} indexFormatter={monthLabel} height={220} />
          </Section>
        )}
        {monthly.length > 0 && (
          <Section title="Fee paid by month" style={{ flex: '1 1 380px' }}>
            <AppBarChart dataset={monthly} indexKey="month" series={[{ dataKey: 'fee', label: 'Fee', color: C.red }]} valueFormatter={fmt} indexFormatter={monthLabel} height={220} />
          </Section>
        )}
      </div>

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        <Section title="By fulfilment type" style={{ flex: '1 1 340px' }}>
          <Table
            cols={[
              { label: 'Type', render: (r) => r.label },
              { label: 'Items', render: (r) => r.items },
              { label: 'Sales', render: (r) => fmt(r.sale) },
              { label: 'Fee', render: (r) => fmt(r.fee), style: () => ({ color: C.red }) },
              { label: 'Rate', render: (r) => pct(r.rate_pct) },
            ]}
            rows={f.by_fulfilment}
          />
        </Section>
        <Section title="By category" subtitle="Top categories by fee" style={{ flex: '1 1 340px' }}>
          <Table
            cols={[
              { label: 'Category', render: (r) => r.label },
              { label: 'Items', render: (r) => r.items },
              { label: 'Fee', render: (r) => fmt(r.fee), style: () => ({ color: C.red }) },
              { label: 'Rate', render: (r) => pct(r.rate_pct) },
            ]}
            rows={f.by_category}
          />
        </Section>
      </div>

      <Section title="SKUs paying the most fee" subtitle="Highlighted when the fee rate is well above your average">
        <Table
          cols={[
            { label: 'SKU', render: (r) => <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{r.sku}</span> },
            { label: 'Items', render: (r) => r.items },
            { label: 'Sales', render: (r) => fmt(r.sale) },
            { label: 'Fee', render: (r) => fmt(r.fee), style: () => ({ color: C.red }) },
            { label: 'Per item', render: (r) => fmt(r.fee_per_item) },
            { label: 'Rate', render: (r) => pct(r.rate_pct), style: (r) => (r.rate_pct > avg * 1.25 ? { color: C.red, fontWeight: 800 } : {}) },
          ]}
          rows={f.by_sku}
        />
      </Section>

      {f.highest_rate_items.length > 0 && (
        <Section title="Individual items with the highest fee rate" subtitle="Fee as a share of that one item's sale — worth checking against the order">
          <Table
            cols={[
              { label: 'Order item', render: (r) => <span style={{ fontFamily: 'monospace' }}>{r.order_item_id}</span> },
              { label: 'SKU', render: (r) => r.sku || '—' },
              { label: 'Sale', render: (r) => fmt(r.sale) },
              { label: 'Fee', render: (r) => fmt(r.fee), style: () => ({ color: C.red }) },
              { label: 'Rate', render: (r) => pct(r.rate_pct), style: () => ({ fontWeight: 800 }) },
            ]}
            rows={f.highest_rate_items}
          />
        </Section>
      )}
    </>
  );
}

// ── SLA breaches ──────────────────────────────────────────────────────────────

function Sla({ s, finesTotal }) {
  if (!s.items) return <Section title="SLA breaches"><p style={{ fontSize: 12, color: C.gray400 }}>No orders in this period — upload the Orders report.</p></Section>;
  const worse = s.bad_outcome_rate_breached_pct != null && s.bad_outcome_rate_on_time_pct != null
    && s.bad_outcome_rate_breached_pct > s.bad_outcome_rate_on_time_pct;
  const months = s.by_month.map((m) => ({ month: m.label, Dispatch: m.dispatch, Delivery: m.delivery }));
  const colsBy = (name) => [
    { label: name, render: (r) => r.label },
    { label: 'Items', render: (r) => r.items },
    { label: 'Dispatch late', render: (r) => r.dispatch || '—' },
    { label: 'Delivery late', render: (r) => r.delivery || '—' },
    { label: 'Breach rate', render: (r) => pct(r.rate_pct), style: (r) => (r.rate_pct >= 20 ? { color: C.red, fontWeight: 800 } : {}) },
  ];
  return (
    <>
      <KpiRow>
        <Kpi label="Items with a breach" value={s.any_breached.toLocaleString('en-IN')} accent={s.any_breached ? C.amber : C.green} color={s.any_breached ? C.amber : undefined} sub={`of ${s.items.toLocaleString('en-IN')} order items`} />
        <Kpi label="Dispatched late" value={s.dispatch_breached.toLocaleString('en-IN')} accent={C.amber} sub={`${s.dispatch_rate_pct}% of live orders`} />
        <Kpi label="Delivered late" value={s.delivery_breached.toLocaleString('en-IN')} accent={C.red} sub={`${s.delivery_rate_pct}% of live orders`} />
        <Kpi label="Avg days late (dispatch)" value={s.avg_dispatch_days_late == null ? '—' : `${s.avg_dispatch_days_late}d`} accent={C.gray600} sub={s.worst_dispatch_days_late ? `worst: ${s.worst_dispatch_days_late} days` : 'no late dispatches'} />
        <Kpi label="Avg days late (delivery)" value={s.avg_delivery_days_late == null ? '—' : `${s.avg_delivery_days_late}d`} accent={C.gray600} />
      </KpiRow>

      {s.any_breached === 0 ? (
        <Insight tone="good">No SLA breaches in this period — every order was dispatched and delivered inside its deadline.</Insight>
      ) : (
        <>
          <Insight tone={s.dispatch_rate_pct >= 10 ? 'bad' : 'warn'}>
            <b>{s.dispatch_breached}</b> item{s.dispatch_breached === 1 ? ' was' : 's were'} dispatched after the dispatch-by date
            {s.avg_dispatch_days_late != null && <>, on average <b>{s.avg_dispatch_days_late} day(s) late</b></>}.
            {' '}<b>{s.delivery_breached}</b> reached the customer after the promised date — usually the courier, but dispatching late makes it far more likely.
            {finesTotal > 0 && <> Fines in the same period total <b>{fmt(finesTotal)}</b> (see the Fines tab).</>}
          </Insight>
          {s.bad_outcome_rate_breached_pct != null && (
            <Insight tone={worse ? 'bad' : 'info'}>
              Items that missed an SLA ended up returned or cancelled <b>{s.bad_outcome_rate_breached_pct}%</b> of the time, against{' '}
              <b>{s.bad_outcome_rate_on_time_pct}%</b> for on-time items{worse ? ' — late orders are costing you sales.' : '.'}
            </Insight>
          )}
        </>
      )}

      {months.length > 0 && s.any_breached > 0 && (
        <Section title="Breaches by order month">
          <AppBarChart dataset={months} indexKey="month" stacked series={[{ dataKey: 'Dispatch', label: 'Dispatch late', color: C.amber }, { dataKey: 'Delivery', label: 'Delivery late', color: C.red }]} indexFormatter={monthLabel} height={220} />
        </Section>
      )}

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        <Section title="By logistics partner" style={{ flex: '1 1 340px' }}>
          <Table cols={colsBy('Partner')} rows={s.by_partner} />
        </Section>
        <Section title="By fulfilment type" style={{ flex: '1 1 340px' }}>
          <Table cols={colsBy('Type')} rows={s.by_fulfilment} />
        </Section>
      </div>
      <Section title="SKUs with the most breaches">
        <Table cols={colsBy('SKU')} rows={s.by_sku.filter((r) => r.breached > 0)} empty="No SKU has a breach." />
      </Section>

      {s.worst_orders.length > 0 && (
        <Section title="Worst offenders" subtitle="The orders that were furthest past their deadline">
          <Table
            cols={[
              { label: 'Order item', render: (r) => <span style={{ fontFamily: 'monospace' }}>{r.order_item_id}</span> },
              { label: 'SKU', render: (r) => r.sku || '—' },
              { label: 'Status', render: (r) => r.status },
              { label: 'Dispatch by', render: (r) => r.dispatch_by || '—' },
              { label: 'Dispatched', render: (r) => r.dispatched || '—' },
              { label: 'Late', render: (r) => (r.dispatch_days_late != null ? `${r.dispatch_days_late}d` : '—'), style: () => ({ color: C.amber, fontWeight: 700 }) },
              { label: 'Deliver by', render: (r) => r.deliver_by || '—' },
              { label: 'Delivered', render: (r) => r.delivered || '—' },
              { label: 'Late ', render: (r) => (r.delivery_days_late != null ? `${r.delivery_days_late}d` : '—'), style: () => ({ color: C.red, fontWeight: 700 }) },
            ]}
            rows={s.worst_orders}
          />
        </Section>
      )}
    </>
  );
}

// ── Fines & other charges ─────────────────────────────────────────────────────

const CAT_COLORS = { ads: C.orange, fines: C.red, spf: C.green, mp_fee_rebate: C.green, storage_recall: C.amber, services: C.blue, tax: C.gray400 };

function Fines({ c }) {
  const [cat, setCat] = useState('');
  if (!c.count) return <Section title="Fines & other charges"><p style={{ fontSize: 12, color: C.gray400 }}>No settlement-report charges in this period.</p></Section>;
  const cats = c.by_category.map((x) => x.category);
  const monthly = c.by_month.map((m) => ({ ...m, month: m.month }));
  const lines = c.lines.filter((l) => !cat || l.category === cat);
  const pie = c.by_category.filter((x) => x.out < 0).map((x) => ({ label: x.label, value: Math.abs(x.out), color: CAT_COLORS[x.category] }));
  return (
    <>
      <KpiRow>
        <Kpi label="Net other charges" value={fmt(c.total)} accent={c.total < 0 ? C.red : C.green} color={c.total < 0 ? C.red : C.green} sub={`${c.count} line(s)`} />
        <Kpi label="Money out" value={fmt(c.money_out)} accent={C.red} color={C.red} />
        <Kpi label="Money back in" value={fmt(c.money_in)} accent={C.green} color={c.money_in ? C.green : undefined} sub="rebates, SPF payouts, recoveries" />
        <Kpi label="Ads spend" value={fmt(c.ads_spend)} accent={C.orange} sub={c.ads_pct_of_sales != null ? `${c.ads_pct_of_sales}% of sales` : undefined} />
        <Kpi label="Fines" value={fmt(c.fines_total)} accent={C.red} color={c.fines_total ? C.red : undefined} sub={c.fines_pct_of_sales != null ? `${c.fines_pct_of_sales}% of sales` : 'none charged'} />
      </KpiRow>

      <Insight tone={c.fines_total > 0 ? 'warn' : 'info'}>
        Beyond order payouts, Flipkart moved <b>{fmt(Math.abs(c.money_out))}</b> out of your account in this period
        {c.ads_spend > 0 && <> — <b>{fmt(c.ads_spend)}</b> of it on ads{c.ads_pct_of_sales != null && <> ({c.ads_pct_of_sales}% of sales)</>}</>}
        {c.fines_total > 0 && <>, and <b>{fmt(c.fines_total)}</b> in fines</>}.
        {c.money_in > 0 && <> <b>{fmt(c.money_in)}</b> came back as rebates / payouts.</>}
      </Insight>

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        <Section title="By category" style={{ flex: '1 1 420px' }}>
          <Table
            cols={[
              { label: 'Category', render: (r) => <><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: CAT_COLORS[r.category] || C.gray400, marginRight: 7 }} />{r.label}</> },
              { label: 'Lines', render: (r) => r.count },
              { label: 'Out', render: (r) => (r.out ? fmt(r.out) : '—'), style: () => ({ color: C.red }) },
              { label: 'In', render: (r) => (r.in ? fmt(r.in) : '—'), style: () => ({ color: C.green }) },
              { label: 'Net', render: (r) => fmt(r.net), style: (r) => ({ fontWeight: 800, color: r.net < 0 ? C.red : C.green }) },
            ]}
            rows={c.by_category}
          />
        </Section>
        {pie.length > 0 && (
          <Section title="Where the money out went" style={{ flex: '0 0 320px' }}>
            <AppPieChart data={pie} height={210} showLegend valueFormatter={fmt} />
          </Section>
        )}
      </div>

      {monthly.length > 0 && (
        <Section title="By month" subtitle="Negative = money out, positive = money in">
          <AppBarChart
            dataset={monthly}
            indexKey="month"
            stacked
            series={cats.map((k) => ({ dataKey: k, label: c.by_category.find((x) => x.category === k)?.label || k, color: CAT_COLORS[k] }))}
            valueFormatter={fmt}
            indexFormatter={monthLabel}
            height={230}
          />
        </Section>
      )}

      {c.biggest.length > 0 && (
        <Section title="Biggest charges" subtitle="The ten largest deductions in the period">
          <Table
            cols={[
              { label: 'Date', render: (r) => r.date || '—' },
              { label: 'Category', render: (r) => r.category },
              { label: 'Description', render: (r) => r.description || '—' },
              { label: 'Reference', render: (r) => <span style={{ fontFamily: 'monospace' }}>{r.reference || '—'}</span> },
              { label: 'Amount', render: (r) => fmt(r.amount), style: () => ({ color: C.red, fontWeight: 800 }) },
            ]}
            rows={c.biggest}
          />
        </Section>
      )}

      <Section title="Every line" subtitle={`${lines.length} of ${c.count} shown${c.count > 200 ? ' (latest 200)' : ''}`}>
        <div style={{ marginBottom: 12 }}>
          <PillFilter value={cat} onChange={setCat} options={[{ value: '', label: 'All' }, ...c.by_category.map((x) => ({ value: x.category, label: x.label, color: CAT_COLORS[x.category] }))]} />
        </div>
        <Table
          maxHeight={420}
          cols={[
            { label: 'Date', render: (r) => r.date || '—' },
            { label: 'Category', render: (r) => r.category_label },
            { label: 'Report sheet', render: (r) => r.sheet || '—' },
            { label: 'Description', render: (r) => r.description || '—' },
            { label: 'Reference', render: (r) => <span style={{ fontFamily: 'monospace' }}>{r.reference || '—'}</span> },
            { label: 'NEFT', render: (r) => <span style={{ fontFamily: 'monospace', color: C.gray400 }}>{r.neft_id || '—'}</span> },
            { label: 'Amount', render: (r) => fmt(r.amount), style: (r) => ({ fontWeight: 800, color: r.amount < 0 ? C.red : C.green }) },
          ]}
          rows={lines}
        />
      </Section>
    </>
  );
}

// ── The tab ───────────────────────────────────────────────────────────────────

export function FlipkartDeepDive({ initial = 'fees' }) {
  const [section, setSection] = useState(initial);
  const { data, loading, error } = useFlipkartApi('/flipkart-deep-dive/');
  if (loading && !data) return <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><CircularProgress style={{ color: FLIPKART_COLOR }} /></div>;
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PillFilter
        value={section}
        onChange={setSection}
        options={[
          { value: 'fees', label: '🏷️ Marketplace fees', color: C.amber },
          { value: 'sla', label: '⏱ SLA breaches', color: C.red },
          { value: 'fines', label: '💸 Fines & other charges', color: C.orange },
        ]}
      />
      {section === 'fees' && <Fees f={data.fees} />}
      {section === 'sla' && <Sla s={data.sla} finesTotal={data.fines.fines_total} />}
      {section === 'fines' && <Fines c={data.fines} />}
    </div>
  );
}
