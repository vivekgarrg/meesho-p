import React, { useEffect, useMemo, useState } from 'react';
import CircularProgress from '@mui/material/CircularProgress';
import { API, C, S, fmt } from '../../App';
import { useDateFilter } from '../../contexts/DateFilterContext';
import { AppBarChart } from '../Charts/AppBarChart';
import { AppLineChart } from '../Charts/AppLineChart';
import { AppPieChart } from '../Charts/AppPieChart';

const num = (n) => Number(n || 0).toLocaleString('en-IN');
const pct = (v) => (v == null ? '—' : `${v}%`);

function fmtMonth(iso) {
  if (!iso) return '';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
}

const fmtDate = (iso) =>
  iso
    ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : '—';

const short = (s, n = 24) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s);

// Verdict → colours + wording, shared by the actions list, the table badges and
// the charts so a product reads the same colour everywhere.
const VERDICT = {
  fix: { label: 'Fix now', icon: '🚨', bg: C.redLight, border: C.redBorder, fg: C.red },
  watch: { label: 'Watch', icon: '⚠️', bg: C.amberLight, border: C.amberBorder, fg: C.amber },
  healthy: { label: 'Healthy', icon: '✅', bg: C.greenLight, border: C.greenBorder, fg: C.green },
  star: { label: 'Star', icon: '⭐', bg: C.greenLight, border: C.greenBorder, fg: C.green },
};
const verdictOf = (row) => VERDICT[row.action?.verdict] || VERDICT.healthy;

const GROUP_COLORS = {
  size_fit: C.blue,
  wrong_missing: C.orange,
  quality: C.red,
  not_as_listed: C.amber,
  changed_mind: C.gray400,
  delivery: '#7C3AED',
  other: C.gray300,
  unspecified: C.gray200 || C.gray300,
};

const SORTS = [
  { key: 'returns', label: 'Most returns' },
  { key: 'return_rate', label: 'Highest return rate' },
  { key: 'excess_loss', label: 'Most avoidable loss' },
  { key: 'loss', label: 'Biggest net loss' },
];

/** A plain count/text tile — prints whatever string it's handed as-is. */
function KpiTile({ label, value, sub, accent, icon }) {
  return (
    <div style={{ ...S.card, borderTop: `3px solid ${accent}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <p
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: C.gray400,
          letterSpacing: '0.07em',
          textTransform: 'uppercase',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
        }}
      >
        {icon && <span>{icon}</span>}
        {label}
      </p>
      <p style={{ fontSize: 24, fontWeight: 800, color: accent, fontFamily: 'monospace', lineHeight: 1.1 }}>{value}</p>
      {sub && <p style={{ fontSize: 11, color: C.gray400 }}>{sub}</p>}
    </div>
  );
}

function ChartCard({ title, hint, children, style }) {
  return (
    <div style={{ ...S.card, ...style }}>
      <p
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: C.gray500,
          letterSpacing: '0.07em',
          textTransform: 'uppercase',
          marginBottom: 4,
        }}
      >
        {title}
      </p>
      {hint && <p style={{ fontSize: 12, color: C.gray400, marginBottom: 14, lineHeight: 1.5 }}>{hint}</p>}
      {children}
    </div>
  );
}

function Badge({ row }) {
  const v = verdictOf(row);
  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: 10.5,
        fontWeight: 800,
        padding: '2px 9px',
        borderRadius: 20,
        background: v.bg,
        color: v.fg,
        border: `1px solid ${v.border}`,
        whiteSpace: 'nowrap',
      }}
    >
      {v.icon} {v.label}
    </span>
  );
}

function TrendCell({ trend }) {
  if (!trend) return <span style={{ color: C.gray300 }}>—</span>;
  const d = trend.delta_pts;
  if (Math.abs(d) < 1) return <span style={{ color: C.gray400, fontSize: 12 }}>→ flat</span>;
  const up = d > 0; // return rate rising is bad
  return (
    <span style={{ color: up ? C.red : C.green, fontWeight: 700, fontSize: 12, fontFamily: 'monospace' }}>
      {up ? '▲' : '▼'} {Math.abs(d).toFixed(1)} pts
    </span>
  );
}

function ReasonChips({ groups }) {
  if (!groups?.length) return <span style={{ color: C.gray300 }}>—</span>;
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {groups.slice(0, 2).map((g) => (
        <span
          key={g.group}
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            padding: '1px 7px',
            borderRadius: 10,
            background: C.gray100,
            color: C.gray600,
            borderLeft: `3px solid ${GROUP_COLORS[g.group] || C.gray300}`,
            whiteSpace: 'nowrap',
          }}
        >
          {g.label} · {g.count}
        </span>
      ))}
    </div>
  );
}

const SubHead = ({ children }) => (
  <div
    style={{
      fontSize: 11,
      fontWeight: 700,
      color: C.gray500,
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      marginBottom: 6,
    }}
  >
    {children}
  </div>
);

/** The expanded view under a parent or SKU row: advice, reasons, history. */
function Detail({ row, isParent }) {
  const meta = verdictOf(row);
  const groupPie = (row.reason_groups || []).map((g) => ({
    label: g.label,
    value: g.count,
    color: GROUP_COLORS[g.group] || C.gray300,
  }));
  return (
    <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'flex-start',
          padding: '10px 12px',
          borderRadius: 10,
          background: meta.bg,
          border: `1px solid ${meta.border}`,
        }}
      >
        <span style={{ fontSize: 15 }}>{meta.icon}</span>
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: meta.fg,
              marginBottom: 2,
            }}
          >
            {meta.label}
          </div>
          <div style={{ fontSize: 12.5, color: C.gray700, lineHeight: 1.55 }}>{row.action?.text}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
        <div>
          <SubHead>Why customers return it</SubHead>
          {groupPie.length ? (
            <>
              <AppPieChart data={groupPie} height={150} valueFormatter={num} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6 }}>
                {groupPie.map((g) => (
                  <span key={g.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.gray600 }}>
                    <span style={{ width: 9, height: 9, borderRadius: '50%', background: g.color }} />
                    {g.label} · <b>{num(g.value)}</b>
                  </span>
                ))}
              </div>
            </>
          ) : (
            <p style={{ fontSize: 12, color: C.gray400 }}>No reasons recorded.</p>
          )}
          {isParent && row.top_reasons?.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <SubHead>Exact wording</SubHead>
              {row.top_reasons.map((r) => (
                <div key={r.reason} style={{ fontSize: 12, color: C.gray600, lineHeight: 1.6 }}>
                  “{short(r.reason, 60)}” · <b>{r.count}</b>
                </div>
              ))}
            </div>
          )}
        </div>

        {isParent && (
          <div>
            <SubHead>Monthly return rate (all-time)</SubHead>
            {row.monthly?.length > 1 ? (
              <AppLineChart
                dataset={row.monthly}
                indexKey="month"
                series={[{ dataKey: 'rate', label: 'Return rate %', color: C.red }]}
                indexFormatter={fmtMonth}
                valueFormatter={(v) => `${v}%`}
                maxTicks={10}
                height={180}
              />
            ) : (
              <p style={{ fontSize: 12, color: C.gray400 }}>Not enough months for a trend yet.</p>
            )}
            <div style={{ fontSize: 11.5, color: C.gray500, marginTop: 6 }}>
              First order {fmtDate(row.first_order_date)} · Last order {fmtDate(row.last_order_date)}
            </div>
          </div>
        )}
      </div>

      {isParent && row.children?.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <SubHead>Child SKUs ({row.children.length})</SubHead>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr>
                {['SKU', 'Orders', 'Returns', 'Rate', 'Trend', 'Main reason', 'Net', 'Verdict'].map((h, i) => (
                  <th key={h} style={{ ...S.th, padding: '8px 10px', textAlign: i === 0 || i === 5 ? 'left' : 'right' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {row.children.map((c, ci) => (
                <tr key={`${c.sku}-${ci}`} style={{ background: C.white }}>
                  <td style={{ ...S.td, padding: '8px 10px', maxWidth: 220 }}>
                    <div style={{ fontWeight: 600, color: C.gray800 }}>{short(c.sku, 30)}</div>
                    {c.product_name && <div style={{ fontSize: 10.5, color: C.gray400 }}>{short(c.product_name, 36)}</div>}
                  </td>
                  <td style={{ ...S.td, padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace' }}>{num(c.orders_total)}</td>
                  <td style={{ ...S.td, padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>{num(c.returns)}</td>
                  <td
                    style={{
                      ...S.td,
                      padding: '8px 10px',
                      textAlign: 'right',
                      fontFamily: 'monospace',
                      color: c.action?.verdict === 'fix' ? C.red : C.gray600,
                      fontWeight: c.action?.verdict === 'fix' ? 800 : 400,
                    }}
                  >
                    {pct(c.return_rate)}
                  </td>
                  <td style={{ ...S.td, padding: '8px 10px', textAlign: 'right' }}>
                    <TrendCell trend={c.trend} />
                  </td>
                  <td style={{ ...S.td, padding: '8px 10px' }}>
                    <ReasonChips groups={c.reason_groups} />
                  </td>
                  <td
                    style={{
                      ...S.td,
                      padding: '8px 10px',
                      textAlign: 'right',
                      fontFamily: 'monospace',
                      fontWeight: 700,
                      color: c.net_settlement < 0 ? C.red : C.green,
                    }}
                  >
                    {fmt(c.net_settlement)}
                  </td>
                  <td style={{ ...S.td, padding: '8px 10px', textAlign: 'right' }}>
                    <Badge row={c} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function ReturnAnalysisTab() {
  const { range, label: periodLabel } = useDateFilter();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());
  const [level, setLevel] = useState('parent'); // 'parent' | 'sku'
  const [sortKey, setSortKey] = useState('returns');
  const [verdictFilter, setVerdictFilter] = useState('all');
  const [minOrders, setMinOrders] = useState(10);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (range.date_from) params.set('date_from', range.date_from);
    if (range.date_to) params.set('date_to', range.date_to);
    fetch(`${API}/returns/analysis/?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setError('Network error — could not load return analysis.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range.date_from, range.date_to]);

  const s = data?.summary;
  const parents = data?.parents || [];
  const skus = data?.skus || [];
  const insights = data?.insights || [];
  const stars = data?.stars || [];
  const trend = data?.trend || [];
  const groups = data?.reason_groups || [];
  const reasons = data?.top_reasons || [];
  const avgRate = s?.return_rate ?? 0;

  const toggle = (key) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const rows = useMemo(() => {
    const src = level === 'parent' ? parents : skus;
    const q = search.trim().toLowerCase();
    const sortVal = {
      returns: (r) => r.returns,
      return_rate: (r) => r.return_rate ?? -1,
      excess_loss: (r) => r.excess_loss,
      loss: (r) => -r.net_settlement,
    }[sortKey];
    return src
      .filter((r) => (r.orders_total || 0) >= minOrders || (sortKey === 'returns' && minOrders === 0))
      .filter((r) => verdictFilter === 'all' || r.action?.verdict === verdictFilter)
      .filter((r) => !q || `${r.parent} ${r.sku || ''} ${r.product_name || ''}`.toLowerCase().includes(q))
      .slice()
      .sort((a, b) => sortVal(b) - sortVal(a));
  }, [level, parents, skus, sortKey, verdictFilter, minOrders, search]);

  // ── chart datasets ──────────────────────────────────────────────────────
  const groupPie = useMemo(
    () => groups.map((g) => ({ label: g.label, value: g.count, color: GROUP_COLORS[g.group] || C.gray300 })),
    [groups],
  );
  const reasonBars = useMemo(
    () => reasons.slice(0, 8).map((r) => ({ reason: short(r.reason, 34), count: r.count })),
    [reasons],
  );

  const top10 = parents.slice(0, 10);
  const top10Share = s?.total_returns
    ? Math.round((top10.reduce((a, p) => a + p.returns, 0) * 100) / s.total_returns)
    : 0;
  const returnsBars = top10.map((p) => ({ name: short(p.parent, 22), returns: p.returns, verdict: p.action?.verdict }));

  const rateBars = parents
    .filter((p) => p.orders_total >= 10 && p.return_rate != null)
    .sort((a, b) => b.return_rate - a.return_rate)
    .slice(0, 10)
    .map((p) => ({ name: short(p.parent, 22), rate: p.return_rate, verdict: p.action?.verdict }));

  const lossBars = parents
    .filter((p) => p.excess_loss > 0)
    .sort((a, b) => b.excess_loss - a.excess_loss)
    .slice(0, 10)
    .map((p) => ({ name: short(p.parent, 22), loss: Math.round(p.excess_loss), verdict: p.action?.verdict }));

  const verdictColor = (_idx, datum) => (VERDICT[datum?.data?.verdict] || VERDICT.healthy).fg;

  const showMinHint = rows.length === 0 && (level === 'parent' ? parents.length : skus.length) > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: C.gray800, marginBottom: 4 }}>Return Analysis</h2>
        <p style={{ fontSize: 12, color: C.gray400, maxWidth: 820, lineHeight: 1.6 }}>
          <b>Customer returns only</b> — RTO (parcels that never reached the buyer) is left out of every number here.
          Return rate = returns ÷ orders that reached the customer (delivered + returned + exchanged). Products are
          judged against <b>your own average ({avgRate}%)</b>, so “high” means high for this business. · {periodLabel}
        </p>
      </div>

      {error && (
        <div
          style={{
            padding: '10px 16px',
            borderRadius: 10,
            background: C.redLight,
            border: `1px solid ${C.redBorder}`,
            color: C.red,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <CircularProgress style={{ color: C.orange }} />
        </div>
      ) : !s || s.total_returns === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: C.gray400 }}>
          <p style={{ fontSize: 14 }}>No customer returns found in this period.</p>
          <p style={{ fontSize: 12, marginTop: 6 }}>
            No order with a RETURN status settled in the selected date range — try a wider range or upload the payment
            sheet for these months.
          </p>
        </div>
      ) : (
        <>
          {/* ── KPI row ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
            <KpiTile
              label="Return rate"
              value={`${s.return_rate}%`}
              accent={s.return_rate >= 20 ? C.red : s.return_rate >= 12 ? C.amber : C.green}
              icon="↩"
              sub={`${num(s.total_returns)} returns of ${num(s.total_orders)} orders · ${num(s.total_qty)} unit(s)`}
            />
            <KpiTile
              label="Net money lost on returns"
              value={fmt(s.net_return_settlement)}
              accent={s.net_return_settlement < 0 ? C.red : C.green}
              icon="📉"
              sub={s.avg_loss_per_return ? `≈ ${fmt(s.avg_loss_per_return)} per return` : 'net settlement on returned orders'}
            />
            <KpiTile
              label="Avoidable loss"
              value={fmt(s.excess_loss_total)}
              accent={s.excess_loss_total > 0 ? C.orange : C.green}
              icon="🎯"
              sub="saved if every product returned at your average rate"
            />
            <KpiTile
              label="Products to fix"
              value={`${num(s.fix_now_count)} fix · ${num(s.watch_count)} watch`}
              accent={s.fix_now_count > 0 ? C.red : C.green}
              icon="🚨"
              sub={`of ${num(s.distinct_products)} parent products with returns`}
            />
            <KpiTile
              label="Return shipping"
              value={fmt(s.return_shipping_cost)}
              accent={C.red}
              icon="🚚"
              sub={`refunded to customers: ${fmt(s.refunded_amount)}`}
            />
            <KpiTile
              label="Claims recovered"
              value={fmt(s.claim_recovered_amount)}
              accent={C.green}
              icon="✅"
              sub={`${num(s.claim_recovered_count)} of ${num(s.total_returns)} returns claimed`}
            />
          </div>

          {/* ── What to do ── */}
          {(insights.length > 0 || stars.length > 0) && (
            <div style={{ display: 'grid', gridTemplateColumns: stars.length ? '2fr 1fr' : '1fr', gap: 16 }}>
              {insights.length > 0 && (
                <div style={{ ...S.card }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: C.gray500, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 12 }}>
                    🎯 What to do first — biggest money at stake on top
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {insights.map((it, i) => {
                      const meta = it.level === 'high' ? VERDICT.fix : VERDICT.watch;
                      return (
                        <div
                          key={i}
                          style={{
                            display: 'flex',
                            gap: 10,
                            alignItems: 'flex-start',
                            padding: '10px 12px',
                            borderRadius: 10,
                            background: meta.bg,
                            border: `1px solid ${meta.border}`,
                          }}
                        >
                          <span style={{ fontSize: 15 }}>{meta.icon}</span>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: C.gray800 }}>
                              {it.parent}{' '}
                              <span style={{ color: C.gray400, fontWeight: 500 }}>
                                · {num(it.returns)} returns{it.return_rate != null ? ` · ${it.return_rate}%` : ''}
                                {it.excess_loss > 0 ? ` · avoidable ${fmt(it.excess_loss)}` : ''}
                              </span>
                            </div>
                            <div style={{ fontSize: 12.5, color: C.gray700, lineHeight: 1.5 }}>{it.text}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {stars.length > 0 && (
                <div style={{ ...S.card }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: C.gray500, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 12 }}>
                    ⭐ Safe to scale
                  </p>
                  <p style={{ fontSize: 12, color: C.gray400, marginBottom: 10, lineHeight: 1.5 }}>
                    Good volume and well below your average return rate — the safest products to advertise.
                  </p>
                  {stars.map((st) => (
                    <div key={st.parent} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${C.gray100}`, fontSize: 12.5 }}>
                      <span style={{ fontWeight: 600, color: C.gray800 }}>{short(st.parent, 26)}</span>
                      <span style={{ fontFamily: 'monospace', color: C.green, fontWeight: 700 }}>
                        {st.return_rate}% <span style={{ color: C.gray400, fontWeight: 400 }}>· {num(st.orders_total)} orders</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Trend + reasons ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
            <ChartCard
              title="Return rate by month"
              hint="Is the business getting better or worse? Recent months read low until late returns land."
            >
              {trend.length > 1 ? (
                <AppLineChart
                  dataset={trend}
                  indexKey="month"
                  series={[{ dataKey: 'rate', label: 'Return rate %', color: C.red }]}
                  indexFormatter={fmtMonth}
                  valueFormatter={(v) => `${v}%`}
                  maxTicks={12}
                  height={230}
                />
              ) : (
                <p style={{ fontSize: 12, color: C.gray400 }}>Pick a wider range to see a monthly trend.</p>
              )}
            </ChartCard>

            <ChartCard title="Orders vs returns by month" hint="Volume behind the rate — a spike in returns on tiny volume is noise.">
              {trend.length ? (
                <AppBarChart
                  dataset={trend}
                  indexKey="month"
                  series={[
                    { dataKey: 'orders', label: 'Orders', color: C.blue },
                    { dataKey: 'returns', label: 'Returns', color: C.red },
                  ]}
                  indexFormatter={fmtMonth}
                  valueFormatter={num}
                  maxTicks={12}
                  height={230}
                />
              ) : (
                <p style={{ fontSize: 12, color: C.gray400 }}>No data.</p>
              )}
            </ChartCard>

            <ChartCard title="Why customers return" hint="Reasons grouped into causes you can act on — size, quality, listing, packing.">
              {groupPie.length ? (
                <>
                  <AppPieChart data={groupPie} height={190} valueFormatter={num} />
                  <div style={{ display: 'flex', gap: '4px 14px', justifyContent: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                    {groups.map((g) => (
                      <span key={g.group} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.gray600 }}>
                        <span style={{ width: 9, height: 9, borderRadius: '50%', background: GROUP_COLORS[g.group] || C.gray300 }} />
                        {g.label} · <b>{g.pct}%</b>
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <p style={{ fontSize: 12, color: C.gray400 }}>No data.</p>
              )}
            </ChartCard>

            <ChartCard title="Top return reasons (exact wording)" hint="The literal reasons from the Returns sheet / payment sheet.">
              {reasonBars.length ? (
                <AppBarChart
                  dataset={reasonBars}
                  indexKey="reason"
                  series={[{ dataKey: 'count', label: 'Returns', color: C.orange }]}
                  layout="horizontal"
                  colorful
                  valueFormatter={num}
                  height={Math.max(200, reasonBars.length * 32)}
                />
              ) : (
                <p style={{ fontSize: 12, color: C.gray400 }}>No reason recorded on these returns.</p>
              )}
            </ChartCard>
          </div>

          {/* ── Product-level charts ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
            <ChartCard
              title="Where the returns come from"
              hint={`Top ${top10.length} parent products = ${top10Share}% of all returns — fix these first.`}
            >
              <AppBarChart
                dataset={returnsBars}
                indexKey="name"
                series={[{ dataKey: 'returns', label: 'Returns' }]}
                layout="horizontal"
                colorByIndex={verdictColor}
                valueFormatter={num}
                height={Math.max(220, returnsBars.length * 32)}
              />
            </ChartCard>

            <ChartCard
              title="Return rate by product"
              hint={`Products with 10+ orders. Your average is ${avgRate}% — red bars are well above it.`}
            >
              {rateBars.length ? (
                <AppBarChart
                  dataset={rateBars}
                  indexKey="name"
                  series={[{ dataKey: 'rate', label: 'Return rate' }]}
                  layout="horizontal"
                  colorByIndex={verdictColor}
                  valueFormatter={(v) => `${v}%`}
                  height={Math.max(220, rateBars.length * 32)}
                />
              ) : (
                <p style={{ fontSize: 12, color: C.gray400 }}>No product has 10+ orders yet.</p>
              )}
            </ChartCard>

            <ChartCard
              title="Avoidable loss by product"
              hint="What each product costs over a product returning at your average — the rupee value of fixing it."
            >
              {lossBars.length ? (
                <AppBarChart
                  dataset={lossBars}
                  indexKey="name"
                  series={[{ dataKey: 'loss', label: 'Avoidable loss' }]}
                  layout="horizontal"
                  colorByIndex={verdictColor}
                  valueFormatter={fmt}
                  height={Math.max(220, lossBars.length * 32)}
                />
              ) : (
                <p style={{ fontSize: 12, color: C.gray400 }}>No product is returning above your average.</p>
              )}
            </ChartCard>
          </div>

          {/* ── Decision table ── */}
          <div style={{ ...S.card, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 18px 12px' }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: C.gray500, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                Decision table
              </p>
              <p style={{ fontSize: 12, color: C.gray400, margin: '4px 0 12px' }}>
                Switch between <b>parent</b> and <b>SKU</b> level. Click a row for the recommended action, causes and history.
              </p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: `1px solid ${C.border}` }}>
                  {[
                    ['parent', 'By parent'],
                    ['sku', 'By SKU'],
                  ].map(([k, l]) => (
                    <button
                      key={k}
                      onClick={() => {
                        setLevel(k);
                        setExpanded(new Set());
                      }}
                      style={{
                        padding: '6px 14px',
                        fontSize: 12,
                        fontWeight: 700,
                        border: 'none',
                        cursor: 'pointer',
                        background: level === k ? C.orange : C.white,
                        color: level === k ? '#fff' : C.gray600,
                      }}
                    >
                      {l}
                    </button>
                  ))}
                </div>
                {[
                  ['all', 'All'],
                  ['fix', '🚨 Fix now'],
                  ['watch', '⚠️ Watch'],
                  ['healthy', '✅ Healthy'],
                  ['star', '⭐ Star'],
                ].map(([k, l]) => (
                  <button
                    key={k}
                    onClick={() => setVerdictFilter(k)}
                    style={{
                      padding: '5px 12px',
                      fontSize: 11.5,
                      fontWeight: 700,
                      borderRadius: 20,
                      cursor: 'pointer',
                      border: `1px solid ${verdictFilter === k ? C.orange : C.border}`,
                      background: verdictFilter === k ? C.orangeLight : C.white,
                      color: verdictFilter === k ? C.orange : C.gray600,
                    }}
                  >
                    {l}
                  </button>
                ))}
                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value)}
                  style={{ ...S.inp, width: 'auto', padding: '6px 10px', fontSize: 12 }}
                >
                  {SORTS.map((o) => (
                    <option key={o.key} value={o.key}>
                      Sort: {o.label}
                    </option>
                  ))}
                </select>
                <select
                  value={minOrders}
                  onChange={(e) => setMinOrders(Number(e.target.value))}
                  style={{ ...S.inp, width: 'auto', padding: '6px 10px', fontSize: 12 }}
                >
                  {[0, 5, 10, 20, 50].map((n) => (
                    <option key={n} value={n}>
                      {n === 0 ? 'Any volume' : `${n}+ orders`}
                    </option>
                  ))}
                </select>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search SKU / product…"
                  style={{ ...S.inp, width: 190, padding: '6px 10px', fontSize: 12 }}
                />
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    {[
                      level === 'parent' ? 'Parent SKU' : 'SKU',
                      'Orders',
                      'Returns',
                      'Return rate',
                      'Trend',
                      'Net loss',
                      'Avoidable',
                      'Main causes',
                      'Verdict',
                    ].map((h, i) => (
                      <th key={h} style={{ ...S.th, textAlign: i === 0 || i === 7 ? 'left' : 'right' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={9} style={{ ...S.td, textAlign: 'center', padding: 30, color: C.gray400 }}>
                        {showMinHint
                          ? 'Nothing matches these filters — try “Any volume” or clear the verdict filter.'
                          : 'No rows.'}
                      </td>
                    </tr>
                  )}
                  {rows.map((p, idx) => {
                    const key = `${level}-${p.parent}-${p.sku || ''}-${idx}`;
                    const isOpen = expanded.has(key);
                    const isParent = level === 'parent';
                    const v = verdictOf(p);
                    return (
                      <React.Fragment key={key}>
                        <tr
                          onClick={() => toggle(key)}
                          style={{
                            background: isOpen ? C.orangeLight : idx % 2 === 0 ? C.white : C.gray50,
                            cursor: 'pointer',
                            borderLeft: `3px solid ${p.action?.verdict === 'fix' ? C.red : 'transparent'}`,
                          }}
                        >
                          <td style={{ ...S.td, maxWidth: 300 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ color: C.gray400, fontSize: 11, width: 12 }}>{isOpen ? '▾' : '▸'}</span>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontWeight: 700, color: C.gray800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 250 }}>
                                  {isParent ? p.parent : p.sku}
                                </div>
                                <div style={{ fontSize: 11, color: C.gray400 }}>
                                  {isParent
                                    ? p.is_grouped
                                      ? `${p.child_count} SKU${p.child_count === 1 ? '' : 's'}`
                                      : 'standalone SKU'
                                    : p.parent !== p.sku
                                      ? `in ${short(p.parent, 28)}`
                                      : 'standalone'}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td style={{ ...S.td, textAlign: 'right', fontFamily: 'monospace', color: C.gray600 }}>{num(p.orders_total)}</td>
                          <td style={{ ...S.td, textAlign: 'right', fontFamily: 'monospace', fontWeight: 800 }}>{num(p.returns)}</td>
                          <td style={{ ...S.td, textAlign: 'right', fontFamily: 'monospace', color: v.fg, fontWeight: 700 }}>
                            {pct(p.return_rate)}
                            {p.vs_avg != null && p.orders_total >= 10 && (
                              <span style={{ color: C.gray400, fontWeight: 400, fontSize: 11 }}> · {p.vs_avg}×</span>
                            )}
                          </td>
                          <td style={{ ...S.td, textAlign: 'right' }}>
                            <TrendCell trend={p.trend} />
                          </td>
                          <td style={{ ...S.td, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: p.net_settlement < 0 ? C.red : C.green }}>
                            {fmt(p.net_settlement)}
                          </td>
                          <td style={{ ...S.td, textAlign: 'right', fontFamily: 'monospace', color: p.excess_loss > 0 ? C.orange : C.gray300, fontWeight: 700 }}>
                            {p.excess_loss > 0 ? fmt(p.excess_loss) : '—'}
                          </td>
                          <td style={{ ...S.td }}>
                            <ReasonChips groups={p.reason_groups} />
                          </td>
                          <td style={{ ...S.td, textAlign: 'right' }}>
                            <Badge row={p} />
                          </td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td colSpan={9} style={{ padding: 0, background: C.gray50, borderBottom: `1px solid ${C.border}` }}>
                              <Detail row={p} isParent={isParent} />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
