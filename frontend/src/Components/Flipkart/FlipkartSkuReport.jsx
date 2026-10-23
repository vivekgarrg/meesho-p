import React, { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import CircularProgress from '@mui/material/CircularProgress';
import { API, fmt } from '../../shared';
import { useDateFilter } from '../../contexts/DateFilterContext';
import { AppBarChart } from '../Charts/AppBarChart';
import { AppLineChart } from '../Charts/AppLineChart';
import { AppPieChart } from '../Charts/AppPieChart';
import { SkuPaymentDetailRows } from '../Tabs/FlipkartProfitTab';

/*
 * Full report for one Flipkart SKU — the same window Meesho's SKU analysis opens:
 * a gradient header with the net P&L, then Overview · Settlement · Payments ·
 * Charts · Monthly History tabs, a period filter, and a full-screen toggle. Plus a
 * Returns & SLA tab for what Flipkart's Orders report adds.
 */

const label10 = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94A3B8' };
const card = { background: '#fff', border: '1px solid #E8EDF3', borderRadius: '14px', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' };
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0);
const monthName = (ym) => new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
const monthShort = (ym) => (ym && ym !== 'Unknown' ? new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }) : ym);
const monthRange = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return { date_from: `${ym}-01`, date_to: `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}` };
};

const COMPONENTS = [
  ['sale_amount', 'Sale amount', 1],
  ['total_offer_amount', 'Offers (Flipkart / seller funded)', 0],
  ['my_share', 'My share of offers', 0],
  ['marketplace_fee', 'Marketplace fee', 0],
  ['gst_on_mp_fees', 'GST on marketplace fee', 0],
  ['taxes', 'Taxes', 0],
  ['tcs', 'TCS', 0],
  ['tds', 'TDS', 0],
  ['offer_adjustments', 'Offer adjustments', 0],
  ['protection_fund', 'Protection fund', 0],
  ['refund', 'Refunds', 0],
];

export function FlipkartSkuReport({ sku, onClose }) {
  const { range: globalRange, label: globalLabel, months } = useDateFilter();
  const [period, setPeriod] = useState('selected');           // selected | all | YYYY-MM
  const [tab, setTab] = useState('overview');
  const [full, setFull] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const range = period === 'all' ? {} : period === 'selected' ? globalRange : monthRange(period);
  const label = period === 'all' ? 'All time' : period === 'selected' ? globalLabel : monthName(period);
  const query = new URLSearchParams(range).toString();

  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    fetch(`${API}/flipkart-sku-report/?${new URLSearchParams({ sku: sku.sku_id })}&${query}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { if (e.name !== 'AbortError') setLoading(false); });
    return () => ctrl.abort();
  }, [sku.sku_id, query]);

  const row = data?.row;
  const bucket = useMemo(() => Object.fromEntries((data?.status_breakdown || []).map((b) => [b.status, b])), [data]);
  const delivered = bucket.Delivered || { count: 0, gross: 0, cost: 0, net: 0 };
  const returned = bucket.Returned || { count: 0, gross: 0, cost: 0, net: 0 };
  const nTotal = delivered.count + returned.count;
  const net = Number(row?.net_profit ?? data?.totals?.net_profit ?? 0);
  const pos = net >= 0;
  const accent = pos ? '#059669' : '#E11D48';
  const delQty = Number(row?.delivered_quantity || 0);
  const avg = delQty > 0 ? Number(row.delivered_profit || 0) / delQty : null;
  const o = data?.orders;

  const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'settlement', label: 'Settlement' },
    { id: 'payments', label: nTotal > 0 ? `Payments (${nTotal})` : 'Payments' },
    { id: 'charts', label: 'Charts' },
    { id: 'history', label: 'Monthly History' },
    { id: 'orders', label: 'Returns & SLA' },
  ];

  const pie = [
    { id: 0, value: delivered.count, label: 'Delivered', color: '#059669' },
    { id: 1, value: returned.count, label: 'Returned', color: '#DC2626' },
  ].filter((x) => x.value > 0);
  const monthly = (data?.monthly || []).filter((m) => m.month !== 'Unknown');
  const monthlyBars = monthly.map((m) => ({ month: m.month, Profit: m.net }));

  const Kpi = ({ k, v, c, big }) => (
    <Box sx={{ flex: big ? '1 1 160px' : '1 1 110px', bgcolor: '#fff', border: '1px solid #E8EDF3', borderTop: `3px solid ${c}`, borderRadius: '12px', p: 1.75 }}>
      <Typography sx={label10}>{k}</Typography>
      <Typography sx={{ fontFamily: 'monospace', fontWeight: 800, fontSize: big ? 24 : 18, color: c, mt: 0.75, lineHeight: 1 }}>{v}</Typography>
    </Box>
  );

  return (
    <Dialog open maxWidth="lg" fullWidth fullScreen={full} onClose={onClose}
      PaperProps={{ sx: { borderRadius: full ? 0 : '20px', maxHeight: full ? 'none' : '94vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' } }}>
      {/* Header */}
      <Box sx={{
        background: pos ? 'linear-gradient(135deg,#ECFDF5 0%,#D1FAE5 100%)' : 'linear-gradient(135deg,#FFF1F2 0%,#FFE4E6 100%)',
        px: 3, pt: 2.5, pb: 0, borderBottom: `2px solid ${pos ? '#A7F3D0' : '#FECDD3'}`, flexShrink: 0,
      }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, mb: 1.5, flexWrap: 'wrap' }}>
          <Box sx={{ flex: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mb: 1 }}>
              <Chip label={sku.sku_id} sx={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 15, bgcolor: '#FFF7ED', color: '#C2410C', border: '1px solid #FED7AA', height: 32 }} />
              {(row?.one_unit_price || sku.one_unit_price) > 0 && (
                <Typography sx={{ fontSize: 12, color: '#64748B' }}>
                  Unit cost: <strong style={{ fontFamily: 'monospace', color: '#334155' }}>{fmt(row?.one_unit_price ?? sku.one_unit_price)}</strong>
                </Typography>
              )}
              {data?.parent_id && <Typography sx={{ fontSize: 12, color: '#94A3B8' }}>Parent: {data.parent_id}</Typography>}
            </Box>
            {!loading && (
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, flexWrap: 'wrap' }}>
                <Typography sx={{ fontFamily: 'monospace', fontWeight: 900, fontSize: 38, color: accent, lineHeight: 1 }}>{pos ? '+' : ''}{fmt(net)}</Typography>
                <Typography sx={{ fontSize: 13, color: '#94A3B8' }}>net P&L · {label}</Typography>
              </Box>
            )}
          </Box>
          <Tooltip title={full ? 'Exit full view' : 'Full view'}>
            <IconButton onClick={() => setFull((v) => !v)} sx={{ color: '#64748B' }}>{full ? '⤡' : '⤢'}</IconButton>
          </Tooltip>
          <IconButton onClick={onClose} sx={{ color: '#64748B' }}>✕</IconButton>
        </Box>
        <Box sx={{ display: 'flex', overflowX: 'auto' }}>
          {TABS.map((t) => (
            <Box key={t.id} onClick={() => setTab(t.id)} sx={{ px: 2.5, py: 1.25, cursor: 'pointer', whiteSpace: 'nowrap', borderBottom: tab === t.id ? `3px solid ${accent}` : '3px solid transparent' }}>
              <Typography sx={{ fontSize: 13, fontWeight: tab === t.id ? 700 : 500, color: tab === t.id ? accent : '#64748B' }}>{t.label}</Typography>
            </Box>
          ))}
        </Box>
      </Box>

      {/* Period */}
      <Box sx={{ px: 3, py: 1.25, bgcolor: '#F8FAFC', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: 1.5, flexShrink: 0 }}>
        <Typography sx={{ fontSize: 12, fontWeight: 700, color: '#94A3B8' }}>Period</Typography>
        <select value={period} onChange={(e) => setPeriod(e.target.value)}
          style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #E2E8F0', fontSize: 13, fontFamily: 'inherit' }}>
          <option value="selected">{globalLabel} (page filter)</option>
          <option value="all">All time</option>
          {(months || []).map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
        </select>
      </Box>

      <DialogContent sx={{ p: 0, overflowY: 'auto', flex: 1 }}>
        {loading ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 10, gap: 2 }}>
            <CircularProgress sx={{ color: accent }} />
            <Typography sx={{ color: '#94A3B8', fontSize: 14 }}>Loading {label}…</Typography>
          </Box>
        ) : !data || (nTotal === 0 && tab !== 'orders' && tab !== 'history') ? (
          <Box sx={{ textAlign: 'center', py: 10 }}>
            <Typography sx={{ fontSize: 44, mb: 1.5 }}>📭</Typography>
            <Typography sx={{ fontWeight: 700, fontSize: 18, mb: 0.5 }}>No settled orders for {label}</Typography>
            <Typography sx={{ color: '#94A3B8' }}>Select a different period above.</Typography>
          </Box>
        ) : (
          <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {tab === 'overview' && (
              <>
                {data.missing_price && (
                  <Box sx={{ p: 1.5, borderRadius: '10px', bgcolor: '#FFFBEB', border: '1px solid #FDE68A', fontSize: 13, color: '#92400E' }}>
                    This SKU has no price, so its orders are left out of profit. Add a price or link it to a parent from the SKU Analysis list.
                  </Box>
                )}
                <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                  <Kpi big k="Net P&L" v={fmt(net)} c={accent} />
                  <Kpi k="Settled items" v={nTotal.toLocaleString()} c="#3B82F6" />
                  <Kpi k="Delivery rate" v={`${pct(delivered.count, nTotal)}%`} c={pct(delivered.count, nTotal) >= 70 ? '#059669' : pct(delivered.count, nTotal) >= 45 ? '#D97706' : '#DC2626'} />
                  <Kpi k="Units delivered" v={delQty.toLocaleString()} c="#059669" />
                  {avg != null && <Kpi k="Avg profit / pc" v={fmt(avg)} c={avg >= 0 ? '#059669' : '#E11D48'} />}
                  <Kpi k="Margin" v={row?.margin_pct != null ? `${row.margin_pct}%` : '—'} c="#334155" />
                </Box>
                <Box sx={{ ...card, p: 2.5 }}>
                  <Typography sx={{ ...label10, mb: 1.5 }}>Outcome rates · {nTotal} settled</Typography>
                  <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                    {[
                      { label: '✅ Delivered', p: pct(delivered.count, nTotal), count: delivered.count, color: '#059669' },
                      { label: '↩ Returned', p: pct(returned.count, nTotal), count: returned.count, color: '#DC2626' },
                    ].map((r) => (
                      <Box key={r.label} sx={{ flex: '1 1 200px' }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 0.5 }}>
                          <Typography sx={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>{r.label}</Typography>
                          <Typography sx={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 14, color: r.color }}>{r.p}% <span style={{ fontSize: 11, fontWeight: 400, color: '#94A3B8' }}>({r.count})</span></Typography>
                        </Box>
                        <LinearProgress variant="determinate" value={r.p} sx={{ height: 8, borderRadius: 99, bgcolor: '#F1F5F9', '& .MuiLinearProgress-bar': { bgcolor: r.color, borderRadius: 99 } }} />
                      </Box>
                    ))}
                  </Box>
                </Box>
                {row?.is_loss_making && (
                  <Box sx={{ p: 1.5, borderRadius: '10px', bgcolor: '#FFF1F2', border: '1px solid #FECDD3', fontSize: 13, color: '#DC2626' }}>
                    {row.loss_all_from_returns
                      ? 'This SKU loses money only through returns — fewer returns is the fix, not price or cost.'
                      : `To break even, cut cost or raise the price by ${fmt(row.required_adjustment_per_unit)} per unit.`}
                  </Box>
                )}
              </>
            )}

            {tab === 'settlement' && (
              <>
                <Box sx={{ ...card, overflow: 'hidden' }}>
                  <Box sx={{ px: 2.5, py: 1.75, borderBottom: '1px solid #E8EDF3' }}>
                    <Typography sx={{ fontWeight: 700, fontSize: 15 }}>Settlement breakdown</Typography>
                    <Typography sx={{ fontSize: 12, color: '#94A3B8' }}>What Flipkart paid on each outcome, and what it cost to make</Typography>
                  </Box>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: '#F8FAFC' }}>
                        {['Outcome', 'Items', 'Gross settlement', 'Item cost', 'Net P&L'].map((h, i) => (
                          <th key={h} style={{ padding: '9px 14px', textAlign: i < 2 ? 'left' : 'right', ...label10, borderBottom: '2px solid #E8EDF3' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[['✅ Delivered', delivered, '#059669'], ['↩ Returned', returned, returned.net >= 0 ? '#64748B' : '#DC2626']].filter(([, b]) => b.count > 0).map(([n, b, c]) => (
                        <tr key={n} style={{ borderBottom: '1px solid #F1F5F9' }}>
                          <td style={{ padding: '10px 14px', fontWeight: 700 }}>{n}</td>
                          <td style={{ padding: '10px 14px' }}>{b.count}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'monospace' }}>{fmt(b.gross)}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'monospace', color: '#DC2626' }}>{b.cost ? `−${fmt(b.cost)}` : '—'}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, color: c }}>{fmt(b.net)}</td>
                        </tr>
                      ))}
                      <tr style={{ background: '#F8FAFC' }}>
                        <td style={{ padding: '10px 14px', fontWeight: 800 }}>Total</td>
                        <td style={{ padding: '10px 14px', fontWeight: 800 }}>{nTotal}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 800 }}>{fmt(delivered.gross + returned.gross)}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, color: '#DC2626' }}>−{fmt(delivered.cost + returned.cost)}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 900, color: accent }}>{fmt(net)}</td>
                      </tr>
                    </tbody>
                  </table>
                </Box>

                <Box sx={{ ...card, p: 2.5 }}>
                  <Typography sx={{ fontWeight: 700, fontSize: 15, mb: 0.25 }}>From sale to bank</Typography>
                  <Typography sx={{ fontSize: 12, color: '#94A3B8', mb: 1.5 }}>Every settlement component for this SKU, summed over {label}</Typography>
                  {COMPONENTS.filter(([k, , always]) => always || Math.abs(Number(data.payment_breakdown?.[k] || 0)) > 0.005).map(([k, name]) => {
                    const v = Number(data.payment_breakdown?.[k] || 0);
                    const sale = Number(data.payment_breakdown?.sale_amount || 0);
                    return (
                      <Box key={k} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 1, borderBottom: '1px solid #F1F5F9' }}>
                        <Typography sx={{ fontSize: 13, color: '#475569' }}>{name}</Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                          <Typography sx={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13, color: v < 0 ? '#DC2626' : '#334155' }}>{fmt(v)}</Typography>
                          {k !== 'sale_amount' && sale > 0 && (
                            <Typography sx={{ fontSize: 11, color: '#94A3B8', minWidth: 52, textAlign: 'right' }}>{((Math.abs(v) / sale) * 100).toFixed(1)}% of sale</Typography>
                          )}
                        </Box>
                      </Box>
                    );
                  })}
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', pt: 1.25 }}>
                    <Typography sx={{ fontWeight: 800, fontSize: 14 }}>= Bank settlement</Typography>
                    <Typography sx={{ fontFamily: 'monospace', fontWeight: 900, fontSize: 15, color: '#059669' }}>{fmt(data.payment_breakdown?.settlement_value)}</Typography>
                  </Box>
                </Box>
              </>
            )}

            {tab === 'payments' && (
              <Box sx={{ ...card, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody><SkuPaymentDetailRows sku={sku.sku_id} dateQuery={query} colSpan={12} /></tbody>
                </table>
              </Box>
            )}

            {tab === 'charts' && (
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <Box sx={{ ...card, p: 2.5, flex: '1 1 300px' }}>
                  <Typography sx={{ fontWeight: 700, fontSize: 14, mb: 0.5 }}>Order distribution</Typography>
                  <AppPieChart data={pie} height={220} showLegend />
                </Box>
                <Box sx={{ ...card, p: 2.5, flex: '1 1 340px' }}>
                  <Typography sx={{ fontWeight: 700, fontSize: 14, mb: 0.5 }}>Net P&L by outcome</Typography>
                  <AppBarChart
                    dataset={[{ s: 'Delivered', v: delivered.net }, { s: 'Returned', v: returned.net }]}
                    indexKey="s" series={[{ dataKey: 'v', label: 'Net P&L' }]} diverging valueFormatter={fmt} height={220}
                  />
                </Box>
              </Box>
            )}

            {tab === 'history' && (
              monthly.length === 0 ? (
                <Typography sx={{ color: '#94A3B8', textAlign: 'center', py: 6 }}>No monthly history yet.</Typography>
              ) : (
                <>
                  <Box sx={{ ...card, p: 2.5 }}>
                    <Typography sx={{ fontWeight: 700, fontSize: 14, mb: 0.5 }}>Monthly trend — all time</Typography>
                    <AppLineChart dataset={monthly.map((m) => ({ month: m.month, Settlement: m.gross, 'Net P&L': m.net }))} indexKey="month"
                      series={[{ dataKey: 'Settlement', label: 'Settlement', color: '#2563EB' }, { dataKey: 'Net P&L', label: 'Net P&L', color: '#059669' }]}
                      valueFormatter={fmt} indexFormatter={monthShort} height={240} />
                  </Box>
                  <Box sx={{ ...card, p: 2.5 }}>
                    <Typography sx={{ fontWeight: 700, fontSize: 14, mb: 0.5 }}>Profit by month</Typography>
                    <AppBarChart dataset={monthlyBars} indexKey="month" series={[{ dataKey: 'Profit', label: 'Net P&L' }]} diverging valueFormatter={fmt} indexFormatter={monthShort} height={220} />
                  </Box>
                  <Box sx={{ ...card, overflow: 'hidden' }}>
                    <Box sx={{ px: 2.5, py: 1.75, borderBottom: '1px solid #E8EDF3' }}><Typography sx={{ fontWeight: 700, fontSize: 14 }}>Month-by-month detail</Typography></Box>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead><tr style={{ background: '#F8FAFC' }}>
                        {['Month', 'Items', 'Settlement', 'Cost', 'Net P&L'].map((h, i) => <th key={h} style={{ padding: '9px 14px', textAlign: i === 0 ? 'left' : 'right', ...label10, borderBottom: '2px solid #E8EDF3' }}>{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {[...monthly].reverse().map((m) => (
                          <tr key={m.month} style={{ borderBottom: '1px solid #F1F5F9' }}>
                            <td style={{ padding: '9px 14px', fontWeight: 700 }}>{monthName(m.month)}</td>
                            <td style={{ padding: '9px 14px', textAlign: 'right', fontFamily: 'monospace' }}>{m.count}</td>
                            <td style={{ padding: '9px 14px', textAlign: 'right', fontFamily: 'monospace' }}>{fmt(m.gross)}</td>
                            <td style={{ padding: '9px 14px', textAlign: 'right', fontFamily: 'monospace', color: '#DC2626' }}>{m.cost ? `−${fmt(m.cost)}` : '—'}</td>
                            <td style={{ padding: '9px 14px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, color: m.net >= 0 ? '#059669' : '#DC2626' }}>{fmt(m.net)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Box>
                </>
              )
            )}

            {tab === 'orders' && o && (
              <>
                <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                  <Kpi k="Order items" v={o.total.toLocaleString()} c="#3B82F6" />
                  <Kpi k="Delivered" v={o.delivered} c="#059669" />
                  <Kpi k="Returned" v={o.returned} c="#DC2626" />
                  <Kpi k="Cancelled" v={o.cancelled} c="#64748B" />
                  <Kpi k="Late dispatch" v={o.dispatch_sla_breached} c={o.dispatch_sla_breached ? '#D97706' : '#059669'} />
                  <Kpi k="Late delivery" v={o.delivery_sla_breached} c={o.delivery_sla_breached ? '#DC2626' : '#059669'} />
                </Box>
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                  {[['Why items come back', o.return_reasons, 'No returns for this SKU.'], ['Why orders are cancelled', o.cancel_reasons, 'No cancellations for this SKU.']].map(([title, list, empty]) => (
                    <Box key={title} sx={{ ...card, p: 2.5, flex: '1 1 320px' }}>
                      <Typography sx={{ fontWeight: 700, fontSize: 14, mb: 1.5 }}>{title}</Typography>
                      {list.length === 0 ? <Typography sx={{ fontSize: 12, color: '#94A3B8' }}>{empty}</Typography> : list.map((r) => (
                        <Box key={r.reason} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 0.75, borderBottom: '1px solid #F1F5F9', fontSize: 13 }}>
                          <span style={{ color: '#475569', overflowWrap: 'anywhere' }}>{r.reason}</span>
                          <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{r.count}</span>
                        </Box>
                      ))}
                    </Box>
                  ))}
                </Box>
              </>
            )}
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}
