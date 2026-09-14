import React, { useEffect, useMemo, useState } from 'react';
import CircularProgress from '@mui/material/CircularProgress';
import { API, C, S, fmt } from '../../App';
import { useDateFilter } from '../../contexts/DateFilterContext';
import { AppBarChart } from '../Charts/AppBarChart';
import { AppPieChart } from '../Charts/AppPieChart';

const num = (n) => Number(n || 0).toLocaleString('en-IN');

function fmtMonth(iso) {
  if (!iso) return '';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
}

/**
 * A plain count/text tile. Unlike the shared money-oriented StatCard, this
 * prints whatever string it's handed as-is, so a return count isn't rendered
 * as "₹100.00" and a rising RTO count isn't painted green for being positive.
 */
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

function ChartCard({ title, hint, children }) {
  return (
    <div style={S.card}>
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
      {hint && <p style={{ fontSize: 12, color: C.gray400, marginBottom: 14 }}>{hint}</p>}
      {children}
    </div>
  );
}

export function ReturnAnalysisTab() {
  const { range, label: periodLabel } = useDateFilter();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
  const products = data?.top_products || [];
  const reasons = data?.top_reasons || [];
  const trend = data?.trend || [];

  const typePie = useMemo(
    () =>
      (data?.type_breakdown || [])
        .filter((t) => t.count > 0)
        .map((t) => ({
          label: t.label,
          value: t.count,
          color: t.label.toLowerCase().includes('rto') ? C.red : C.orange,
        })),
    [data],
  );

  const reasonBars = useMemo(() => reasons.slice(0, 10).map((r) => ({ reason: r.reason, count: r.count })), [reasons]);

  // A short, readable category for the products chart — the SKU when present,
  // otherwise a trimmed product name so the axis label isn't a paragraph.
  const productBars = useMemo(
    () =>
      products.slice(0, 10).map((p) => ({
        name: p.sku || (p.product_name ? p.product_name.slice(0, 24) : '—'),
        returns: p.returns,
      })),
    [products],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: C.gray800, marginBottom: 4 }}>Return Analysis</h2>
        <p style={{ fontSize: 12, color: C.gray400, maxWidth: 760 }}>
          Which products come back most, how often, why, and what returns are doing to your settlement — so you can spot
          loss-making SKUs and the top reason to fix. Built from your payment &amp; order data (any order with a RETURN
          / RTO status), by order date, so every month with payments is covered. · {periodLabel}
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
          <p style={{ fontSize: 14 }}>No returns found in this period.</p>
          <p style={{ fontSize: 12, marginTop: 6 }}>
            No order with a RETURN or RTO status settled in the selected date range — try a wider range or upload the
            payment sheet for these months.
          </p>
        </div>
      ) : (
        <>
          {/* ── KPI row ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14 }}>
            <KpiTile
              label="Total Returns"
              value={num(s.total_returns)}
              accent={C.orange}
              icon="↩"
              sub={`${s.return_rate}% of ${num(s.total_orders)} order(s) · ${num(s.total_qty)} unit(s)`}
            />
            <KpiTile
              label="Customer Returns"
              value={num(s.customer_returns)}
              accent={C.amber}
              icon="🙍"
              sub={`${s.customer_pct}% of returns`}
            />
            <KpiTile
              label="Courier / RTO"
              value={num(s.rto_returns)}
              accent={C.red}
              icon="🚚"
              sub={`${s.rto_pct}% of returns`}
            />
            <KpiTile
              label="Net Settlement on Returns"
              value={fmt(s.net_return_settlement)}
              accent={s.net_return_settlement < 0 ? C.red : C.green}
              icon="📉"
              sub="net money movement on returned orders"
            />
            <KpiTile
              label="Return Shipping Cost"
              value={fmt(s.return_shipping_cost)}
              accent={C.red}
              icon="₹"
              sub="charged to get parcels back"
            />
            <KpiTile
              label="Claims Recovered"
              value={fmt(s.claim_recovered_amount)}
              accent={C.green}
              icon="✅"
              sub={`${num(s.claim_recovered_count)} order(s) with a claim credit`}
            />
            <KpiTile
              label="Products Affected"
              value={num(s.distinct_products)}
              accent={C.blue}
              icon="📦"
              sub={`${num(s.distinct_reasons)} distinct reason(s)`}
            />
          </div>

          {/* ── Breakdown charts ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
            <ChartCard title="Return Type" hint="Customer returns vs courier returns (RTO).">
              {typePie.length ? (
                <>
                  <AppPieChart data={typePie} height={200} valueFormatter={num} />
                  <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                    {typePie.map((t) => (
                      <span
                        key={t.label}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.gray600 }}
                      >
                        <span style={{ width: 9, height: 9, borderRadius: '50%', background: t.color }} />
                        {t.label} · <b>{num(t.value)}</b>
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <p style={{ fontSize: 12, color: C.gray400 }}>No data.</p>
              )}
            </ChartCard>

            <ChartCard
              title="Top Return Reasons"
              hint="The reasons to chase first — fixing the top one moves the needle most."
            >
              {reasonBars.length ? (
                <AppBarChart
                  dataset={reasonBars}
                  indexKey="reason"
                  series={[{ dataKey: 'count', label: 'Returns', color: C.orange }]}
                  layout="horizontal"
                  colorful
                  valueFormatter={num}
                  height={Math.max(200, reasonBars.length * 34)}
                />
              ) : (
                <p style={{ fontSize: 12, color: C.gray400 }}>No reason recorded on these returns.</p>
              )}
            </ChartCard>
          </div>

          {/* ── Most returned products ── */}
          <ChartCard
            title="Most Returned Products"
            hint="Ranked by number of returns. Tallest bars are your biggest return problems."
          >
            {productBars.length ? (
              <AppBarChart
                dataset={productBars}
                indexKey="name"
                series={[{ dataKey: 'returns', label: 'Returns', color: C.orange }]}
                layout="horizontal"
                colorful
                valueFormatter={num}
                height={Math.max(220, productBars.length * 34)}
              />
            ) : (
              <p style={{ fontSize: 12, color: C.gray400 }}>No data.</p>
            )}
          </ChartCard>

          {/* ── Product-level detail table ── */}
          <div style={{ ...S.card, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 18px 0' }}>
              <p
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: C.gray500,
                  letterSpacing: '0.07em',
                  textTransform: 'uppercase',
                }}
              >
                Product Return Detail
              </p>
              <p style={{ fontSize: 12, color: C.gray400, margin: '4px 0 12px' }}>
                Per-SKU returns, return rate, top reason, and net settlement — chase the red rows.
              </p>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    {[
                      'SKU / Product',
                      'Returns',
                      'Return Rate',
                      'Customer',
                      'RTO',
                      'Top Reason',
                      'Recovered',
                      'Net Settlement',
                    ].map((h, i) => (
                      <th key={h} style={{ ...S.th, textAlign: i === 0 || i === 5 ? 'left' : 'right' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {products.map((p, idx) => (
                    <tr key={`${p.sku}-${idx}`} style={{ background: idx % 2 === 0 ? C.white : C.gray50 }}>
                      <td style={{ ...S.td, maxWidth: 280 }}>
                        <div style={{ fontWeight: 700, color: C.gray800 }}>{p.sku || '—'}</div>
                        {p.product_name && (
                          <div
                            style={{
                              fontSize: 11.5,
                              color: C.gray400,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              maxWidth: 260,
                            }}
                          >
                            {p.product_name}
                          </div>
                        )}
                      </td>
                      <td style={{ ...S.td, textAlign: 'right', fontFamily: 'monospace', fontWeight: 800 }}>
                        {num(p.returns)}
                      </td>
                      <td
                        style={{
                          ...S.td,
                          textAlign: 'right',
                          fontFamily: 'monospace',
                          color: p.return_rate >= 20 ? C.red : C.gray600,
                        }}
                      >
                        {p.return_rate == null ? '—' : `${p.return_rate}%`}
                        {p.orders_total ? <span style={{ color: C.gray400 }}> · {num(p.orders_total)}</span> : null}
                      </td>
                      <td style={{ ...S.td, textAlign: 'right', fontFamily: 'monospace', color: C.amber }}>
                        {p.customer || '—'}
                      </td>
                      <td style={{ ...S.td, textAlign: 'right', fontFamily: 'monospace', color: C.red }}>
                        {p.rto || '—'}
                      </td>
                      <td
                        style={{
                          ...S.td,
                          color: C.gray600,
                          maxWidth: 240,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {p.top_reason || '—'}
                      </td>
                      <td style={{ ...S.td, textAlign: 'right', fontFamily: 'monospace', color: C.green }}>
                        {p.claim_recovered ? fmt(p.claim_recovered) : '—'}
                      </td>
                      <td
                        style={{
                          ...S.td,
                          textAlign: 'right',
                          fontFamily: 'monospace',
                          fontWeight: 800,
                          color: p.net_settlement < 0 ? C.red : C.green,
                        }}
                      >
                        {fmt(p.net_settlement)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Return trend ── */}
          {trend.length > 1 && (
            <ChartCard title="Returns Over Time" hint="Monthly returns split by type — watch for a rising trend.">
              <AppBarChart
                dataset={trend}
                indexKey="month"
                series={[
                  { dataKey: 'customer', label: 'Customer', color: C.amber },
                  { dataKey: 'rto', label: 'RTO', color: C.red },
                ]}
                stacked
                indexFormatter={fmtMonth}
                valueFormatter={num}
                showLegend
                height={260}
              />
            </ChartCard>
          )}

          {/* ── Reasons table ── */}
          <div style={{ ...S.card, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 18px 0' }}>
              <p
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: C.gray500,
                  letterSpacing: '0.07em',
                  textTransform: 'uppercase',
                }}
              >
                Return Reasons
              </p>
              <p style={{ fontSize: 12, color: C.gray400, margin: '4px 0 12px' }}>
                Every recorded reason, most common first.
              </p>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    {['Reason', 'Returns', 'Share'].map((h, i) => (
                      <th key={h} style={{ ...S.th, textAlign: i === 0 ? 'left' : 'right' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reasons.map((r, idx) => (
                    <tr key={`${r.reason}-${idx}`} style={{ background: idx % 2 === 0 ? C.white : C.gray50 }}>
                      <td style={{ ...S.td, color: C.gray800 }}>{r.reason}</td>
                      <td style={{ ...S.td, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>
                        {num(r.count)}
                      </td>
                      <td style={{ ...S.td, textAlign: 'right', fontFamily: 'monospace', color: C.gray500 }}>
                        {r.pct}%
                      </td>
                    </tr>
                  ))}
                  {reasons.length === 0 && (
                    <tr>
                      <td colSpan={3} style={{ ...S.td, textAlign: 'center', color: C.gray400 }}>
                        No reasons recorded.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
