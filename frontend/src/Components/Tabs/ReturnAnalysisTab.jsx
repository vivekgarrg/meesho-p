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

const fmtDate = (iso) =>
  iso
    ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : '—';

// Colour + wording for an action severity, shared by the actions list and the
// per-parent drill-down banner.
const ACTION_META = {
  high: { label: 'Action needed', icon: '🚨', bg: C.redLight, border: C.redBorder, fg: C.red },
  warn: { label: 'Watch', icon: '⚠️', bg: C.amberLight, border: C.amberBorder, fg: C.amber },
  ok: { label: 'Healthy', icon: '✅', bg: C.greenLight, border: C.greenBorder, fg: C.green },
};

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
  const [expanded, setExpanded] = useState(() => new Set());

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
  const insights = data?.insights || [];
  const reasons = data?.top_reasons || [];
  const trend = data?.trend || [];

  const toggle = (key) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

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

  // Short, readable category for the chart — the parent SKU (or the standalone
  // SKU when a product isn't linked to a parent), trimmed so a long id doesn't
  // become a paragraph on the axis.
  const productBars = useMemo(
    () =>
      parents.slice(0, 10).map((p) => ({
        name: p.parent && p.parent.length > 26 ? `${p.parent.slice(0, 24)}…` : p.parent,
        returns: p.returns,
      })),
    [parents],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: C.gray800, marginBottom: 4 }}>Return Analysis</h2>
        <p style={{ fontSize: 12, color: C.gray400, maxWidth: 780 }}>
          Grouped by <b>parent SKU</b> — click a row to drill into its child SKUs, full monthly history and first/last
          order date, with a recommended action for each. Built from your payment &amp; order data (any order with a
          RETURN / RTO status), by order date, so every month with payments is covered. · {periodLabel}
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
          {/* ── Recommended actions ── */}
          {insights.length > 0 && (
            <div style={{ ...S.card, borderLeft: `4px solid ${C.orange}` }}>
              <p
                style={{
                  fontSize: 12,
                  fontWeight: 800,
                  color: C.gray700,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  marginBottom: 10,
                }}
              >
                🎯 Recommended actions
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {insights.map((it, i) => {
                  const meta = ACTION_META[it.level] || ACTION_META.warn;
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

          {/* ── Return detail by parent SKU (click a row to drill in) ── */}
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
                Return Detail by Parent SKU
              </p>
              <p style={{ fontSize: 12, color: C.gray400, margin: '4px 0 12px' }}>
                Grouped by parent SKU. Click a row to see its child SKUs, full monthly history, first/last order date
                and the recommended action. Chase the red rows.
              </p>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    {[
                      'Parent SKU',
                      'Returns',
                      'Return Rate',
                      'Customer',
                      'RTO',
                      'First → Last order',
                      'Recovered',
                      'Net Settlement',
                    ].map((h, i) => (
                      <th key={h} style={{ ...S.th, textAlign: i === 0 ? 'left' : 'right' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parents.map((p, idx) => {
                    const key = `${p.parent}-${idx}`;
                    const isOpen = expanded.has(key);
                    const meta = ACTION_META[p.action?.level] || ACTION_META.ok;
                    return (
                      <React.Fragment key={key}>
                        <tr
                          onClick={() => toggle(key)}
                          style={{
                            background: isOpen ? C.orangeLight : idx % 2 === 0 ? C.white : C.gray50,
                            cursor: 'pointer',
                          }}
                        >
                          <td style={{ ...S.td, maxWidth: 300 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ color: C.gray400, fontSize: 11, width: 12 }}>{isOpen ? '▾' : '▸'}</span>
                              <div style={{ minWidth: 0 }}>
                                <div
                                  style={{
                                    fontWeight: 700,
                                    color: C.gray800,
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    maxWidth: 260,
                                  }}
                                >
                                  {p.parent}
                                </div>
                                <div style={{ fontSize: 11, color: C.gray400 }}>
                                  {p.is_grouped
                                    ? `${p.child_count} SKU${p.child_count === 1 ? '' : 's'}`
                                    : 'standalone SKU'}
                                  {p.action?.level === 'high' && (
                                    <span style={{ color: C.red, fontWeight: 700 }}> · action needed</span>
                                  )}
                                </div>
                              </div>
                            </div>
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
                            {p.rto ? <span style={{ color: C.gray400 }}> · {p.rto_share}%</span> : null}
                          </td>
                          <td
                            style={{
                              ...S.td,
                              textAlign: 'right',
                              fontFamily: 'monospace',
                              color: C.gray500,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {fmtDate(p.first_order_date)} → {fmtDate(p.last_order_date)}
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
                        {isOpen && (
                          <tr>
                            <td
                              colSpan={8}
                              style={{ padding: 0, background: C.gray50, borderBottom: `1px solid ${C.border}` }}
                            >
                              <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                                {/* action banner */}
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
                                    <div style={{ fontSize: 12.5, color: C.gray700, lineHeight: 1.5 }}>
                                      {p.action?.text}
                                    </div>
                                  </div>
                                </div>

                                <div
                                  style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'minmax(260px, 1fr) 2fr',
                                    gap: 16,
                                    alignItems: 'start',
                                  }}
                                >
                                  {/* monthly history */}
                                  <div>
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
                                      Monthly return history (all-time)
                                    </div>
                                    {p.monthly && p.monthly.length ? (
                                      <AppBarChart
                                        dataset={p.monthly}
                                        indexKey="month"
                                        series={[
                                          { dataKey: 'customer', label: 'Customer', color: C.amber },
                                          { dataKey: 'rto', label: 'RTO', color: C.red },
                                        ]}
                                        stacked
                                        indexFormatter={fmtMonth}
                                        valueFormatter={num}
                                        maxTicks={12}
                                        height={180}
                                      />
                                    ) : (
                                      <p style={{ fontSize: 12, color: C.gray400 }}>No history.</p>
                                    )}
                                    <div style={{ fontSize: 11.5, color: C.gray500, marginTop: 6 }}>
                                      First order {fmtDate(p.first_order_date)} · Last order{' '}
                                      {fmtDate(p.last_order_date)}
                                    </div>
                                  </div>

                                  {/* child SKUs */}
                                  <div style={{ overflowX: 'auto' }}>
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
                                      Child SKUs ({p.children.length})
                                    </div>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                                      <thead>
                                        <tr>
                                          {['SKU', 'Returns', 'Rate', 'Cust', 'RTO', 'Top Reason', 'Net'].map(
                                            (h, i) => (
                                              <th
                                                key={h}
                                                style={{
                                                  ...S.th,
                                                  padding: '8px 10px',
                                                  textAlign: i === 0 || i === 5 ? 'left' : 'right',
                                                }}
                                              >
                                                {h}
                                              </th>
                                            ),
                                          )}
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {p.children.map((c, ci) => (
                                          <tr key={`${c.sku}-${ci}`} style={{ background: C.white }}>
                                            <td style={{ ...S.td, padding: '8px 10px', maxWidth: 220 }}>
                                              <div
                                                style={{
                                                  fontWeight: 600,
                                                  color: C.gray800,
                                                  whiteSpace: 'nowrap',
                                                  overflow: 'hidden',
                                                  textOverflow: 'ellipsis',
                                                  maxWidth: 210,
                                                }}
                                              >
                                                {c.sku}
                                              </div>
                                              {c.product_name && (
                                                <div
                                                  style={{
                                                    fontSize: 10.5,
                                                    color: C.gray400,
                                                    whiteSpace: 'nowrap',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    maxWidth: 210,
                                                  }}
                                                >
                                                  {c.product_name}
                                                </div>
                                              )}
                                              <div style={{ fontSize: 10.5, color: C.gray400 }}>
                                                {fmtDate(c.first_order_date)} → {fmtDate(c.last_order_date)}
                                              </div>
                                            </td>
                                            <td
                                              style={{
                                                ...S.td,
                                                padding: '8px 10px',
                                                textAlign: 'right',
                                                fontFamily: 'monospace',
                                                fontWeight: 700,
                                              }}
                                            >
                                              {num(c.returns)}
                                            </td>
                                            <td
                                              style={{
                                                ...S.td,
                                                padding: '8px 10px',
                                                textAlign: 'right',
                                                fontFamily: 'monospace',
                                                color: c.return_rate >= 20 ? C.red : C.gray600,
                                              }}
                                            >
                                              {c.return_rate == null ? '—' : `${c.return_rate}%`}
                                            </td>
                                            <td
                                              style={{
                                                ...S.td,
                                                padding: '8px 10px',
                                                textAlign: 'right',
                                                fontFamily: 'monospace',
                                                color: C.amber,
                                              }}
                                            >
                                              {c.customer || '—'}
                                            </td>
                                            <td
                                              style={{
                                                ...S.td,
                                                padding: '8px 10px',
                                                textAlign: 'right',
                                                fontFamily: 'monospace',
                                                color: C.red,
                                              }}
                                            >
                                              {c.rto || '—'}
                                            </td>
                                            <td
                                              style={{
                                                ...S.td,
                                                padding: '8px 10px',
                                                color: C.gray600,
                                                maxWidth: 200,
                                                whiteSpace: 'nowrap',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                              }}
                                            >
                                              {c.top_reason || '—'}
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
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              </div>
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
