import React, { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import { fmt } from '../../shared';
import { useBusiness } from '../../contexts/BusinessContext';
import { useDateFilter } from '../../contexts/DateFilterContext';
import { AppBarChart } from '../Charts/AppBarChart';
import { MissingPriceSkuRow } from '../Tabs/FlipkartProfitTab';
import { FlipkartSkuReport } from './FlipkartSkuReport';
import { EmptyState, ErrorNote, FLIPKART_COLOR, useFlipkartApi } from './FlipkartShared';

/*
 * Flipkart SKU P&L analysis — the same page as Meesho's: a profit hero, the
 * delivered / returned breakdown, view chips (All · Profitable · In loss · Low
 * margin), SKU or Parent-SKU grouping with drill-down, the top-impact chart, and
 * the SKU table. It is built from Meesho's own panels (handed in as `parts` by
 * SKUProfitTab) so the two cannot drift apart; only the data differs.
 */

const card = {
  background: '#fff',
  border: '1px solid #E8EDF3',
  borderRadius: '14px',
  boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
};

const THRESHOLD_DEFAULT = 50;

export function FlipkartSkuAnalysis({ parts }) {
  const { SKUDataTable, MetricsPanel, LowMarginPanel } = parts;
  const { activeBusiness } = useBusiness();
  const { label } = useDateFilter();
  const { data, loading, error, reload } = useFlipkartApi('/flipkart-sku-analysis/');

  const [view, setView] = useState('all');
  const [groupBy, setGroupBy] = useState('sku');
  const [drillParent, setDrillParent] = useState(null);
  const [selSku, setSelSku] = useState(null);
  const [marginThreshold, setMarginThreshold] = useState(THRESHOLD_DEFAULT);

  // Priced SKUs with settled orders are the analysis; the rest are listed in the
  // panel above it (as Meesho does) until they have a price or a payment.
  const allData = useMemo(() => {
    if (!data) return [];
    return data.skus
      .filter((r) => !r.missing_price && r.payment_items > 0)
      .map((r) => {
        const dq = Number(r.delivered_quantity || 0);
        const dp = Number(r.delivered_profit || 0);
        return {
          ...r,
          id: r.sku_id,
          parent: r.parent_id || null,
          parent_item_id: r.parent_id || null,
          cancelled_count: r.report_cancelled || 0,
          rto_count: 0,
          claim_count: 0,
          net_profit: Number(r.net_profit || 0),
          delivered_profit: dp,
          delivered_quantity: dq,
          avg_profit_per_piece: dq > 0 ? dp / dq : null,
        };
      })
      .sort((a, b) => b.net_profit - a.net_profit);
  }, [data]);

  // One row per parent (or per un-parented SKU as a group of one); numbers are
  // summed, the per-unit average is recomputed from the sums.
  const groupedData = useMemo(() => {
    const groups = {};
    for (const row of allData) {
      const key = row.parent_item_id || row.sku_id;
      const g = (groups[key] ||= { id: key, sku_id: key, parent_item_id: row.parent_item_id, is_group: true, child_count: 0 });
      g.child_count += 1;
      for (const [f, v] of Object.entries(row)) {
        if (typeof v === 'number' && f !== 'avg_profit_per_piece' && f !== 'one_unit_price') g[f] = (g[f] || 0) + v;
      }
    }
    return Object.values(groups)
      .map((g) => ({ ...g, avg_profit_per_piece: g.delivered_quantity > 0 ? g.delivered_profit / g.delivered_quantity : null }))
      .sort((a, b) => b.net_profit - a.net_profit);
  }, [allData]);

  // What the shared MetricsPanel reads: Meesho's /profit/ shape, filled from Flipkart's numbers.
  const profitSummary = useMemo(() => {
    if (!data) return null;
    const by = Object.fromEntries((data.status_breakdown || []).map((b) => [b.status, b]));
    const sum = (b) => ({ order_count: b?.count || 0, net_profit_loss: b?.net || 0 });
    return {
      order_summary: { delivered_summary: sum(by.Delivered), return_summary: sum(by.Returned) },
      order_count: data.totals.order_count,
      gross_revenue: data.totals.gross_payout,
      net_revenue: data.totals.net_profit,
      net_profit_loss: data.totals.net_profit,
    };
  }, [data]);

  if (loading && !data) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}>
        <CircularProgress sx={{ color: FLIPKART_COLOR }} />
      </Box>
    );
  }
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;
  if (!data.has_data) {
    return (
      <EmptyState title={`No Flipkart SKUs for ${activeBusiness?.name || 'this business'} in ${label}`}>
        Upload the Flipkart Settlement Report and Orders report from Upload Data — or pick a different period — to analyse SKUs.
      </EmptyState>
    );
  }

  const activeData = groupBy === 'parent' ? groupedData : allData;
  const drillRows = drillParent ? allData.filter((s) => (s.parent_item_id || s.sku_id) === drillParent) : null;
  const profitRows = activeData.filter((s) => s.net_profit > 0);
  const lossRows = activeData.filter((s) => s.net_profit < 0).reverse();
  const lowMarginRows = activeData
    .filter((s) => s.avg_profit_per_piece !== null && s.avg_profit_per_piece < marginThreshold && (s.delivered_quantity || 0) > 0)
    .sort((a, b) => a.avg_profit_per_piece - b.avg_profit_per_piece);
  const viewData = view === 'profit' ? profitRows : view === 'loss' ? lossRows : view === 'low-margin' ? lowMarginRows : activeData;
  const chartData = [...activeData].sort((a, b) => Math.abs(b.net_profit) - Math.abs(a.net_profit)).slice(0, 12);

  const open = (row) => (groupBy === 'parent' ? setDrillParent(row.sku_id) : setSelSku(row));

  const VIEWS = [
    { id: 'all', label: 'All SKUs', count: activeData.length, activeBg: '#1E3A5F', activeText: '#fff', idleBg: '#EFF6FF', idleText: '#1E3A5F', idleBorder: '#BFDBFE' },
    { id: 'profit', label: 'Profitable', count: profitRows.length, activeBg: '#059669', activeText: '#fff', idleBg: '#ECFDF5', idleText: '#059669', idleBorder: '#A7F3D0' },
    { id: 'loss', label: 'In Loss', count: lossRows.length, activeBg: '#DC2626', activeText: '#fff', idleBg: '#FFF1F2', idleText: '#DC2626', idleBorder: '#FECDD3' },
    { id: 'low-margin', label: 'Low Margin', count: lowMarginRows.length, activeBg: '#D97706', activeText: '#fff', idleBg: '#FFFBEB', idleText: '#D97706', idleBorder: '#FDE68A' },
  ];

  // SKUs that can't be in the numbers yet, and why.
  const unpriced = data.missing_price_skus || [];
  const unsettled = data.skus.filter((r) => !r.missing_price && r.payment_items === 0);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {/* Header + view chips */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography sx={{ fontWeight: 900, fontSize: 26, color: '#0F172A', lineHeight: 1.1 }}>SKU P&L Analysis</Typography>
          <Typography sx={{ fontSize: 13, color: '#94A3B8', mt: 0.5 }}>
            Flipkart settled orders · <strong style={{ color: '#475569' }}>{label}</strong>
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {VIEWS.map((v) => {
            const active = view === v.id;
            return (
              <Box
                key={v.id}
                onClick={() => setView(v.id)}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 0.75, px: 1.75, py: 0.875,
                  bgcolor: active ? v.activeBg : v.idleBg, border: `1.5px solid ${active ? v.activeBg : v.idleBorder}`,
                  borderRadius: '10px', cursor: 'pointer', transition: 'all 0.15s', '&:hover': { boxShadow: '0 2px 8px rgba(0,0,0,0.1)' },
                }}
              >
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: active ? v.activeText : v.idleText }}>{v.label}</Typography>
                <Box sx={{ minWidth: 22, height: 22, borderRadius: '6px', bgcolor: active ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Typography sx={{ fontSize: 11, fontWeight: 800, color: active ? v.activeText : v.idleText }}>{v.count}</Typography>
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>

      {/* Group by */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography sx={{ fontSize: 12, fontWeight: 700, color: '#94A3B8' }}>Group by:</Typography>
        <Box sx={{ display: 'inline-flex', bgcolor: '#F1F5F9', borderRadius: '10px', p: '3px', border: '1px solid #E2E8F0' }}>
          {[{ id: 'sku', label: 'SKU' }, { id: 'parent', label: 'Parent SKU' }].map((g) => {
            const active = groupBy === g.id;
            return (
              <Box
                key={g.id}
                onClick={() => { setGroupBy(g.id); setDrillParent(null); setView('all'); }}
                sx={{ px: 1.75, py: 0.625, borderRadius: '8px', cursor: 'pointer', bgcolor: active ? '#fff' : 'transparent', boxShadow: active ? '0 1px 3px rgba(0,0,0,0.12)' : 'none' }}
              >
                <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: active ? '#0F172A' : '#64748B' }}>{g.label}</Typography>
              </Box>
            );
          })}
        </Box>
        {groupBy === 'parent' && (
          <Typography sx={{ fontSize: 11.5, color: '#94A3B8' }}>
            {groupedData.length} parent group{groupedData.length === 1 ? '' : 's'} · SKUs with no parent show as their own group
          </Typography>
        )}
      </Box>

      {/* SKUs that need a price (or a parent) before they count */}
      {unpriced.length > 0 && (
        <Box sx={{ ...card, p: 2, border: '1px solid #FDE68A', bgcolor: '#FFFBEB' }}>
          <Typography sx={{ fontSize: 14, fontWeight: 700, color: '#92400E', mb: 0.5 }}>
            {unpriced.length} SKU{unpriced.length === 1 ? '' : 's'} left out of profit — no price
            {data.missing_price_count ? ` (${data.missing_price_count} orders)` : ''}
          </Typography>
          <Typography sx={{ fontSize: 12, color: '#78350F', mb: 1.25 }}>
            Add a price, or link the SKU to a parent to use that parent's — the analysis updates straight away, no re-upload.
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {unpriced.map((sku) => <MissingPriceSkuRow key={sku} sku={sku} onSaved={reload} />)}
          </Box>
        </Box>
      )}
      {unsettled.length > 0 && (
        <Typography sx={{ fontSize: 12, color: '#94A3B8' }}>
          {unsettled.length} SKU{unsettled.length === 1 ? ' has' : 's have'} orders that haven't been paid yet, so {unsettled.length === 1 ? 'it isn\'t' : 'they aren\'t'} in the analysis: {unsettled.slice(0, 6).map((r) => r.sku_id).join(', ')}{unsettled.length > 6 ? '…' : ''}
        </Typography>
      )}

      {allData.length === 0 ? (
        <Box sx={{ ...card, textAlign: 'center', py: 8 }}>
          <Typography sx={{ fontSize: 44, mb: 1.5 }}>📭</Typography>
          <Typography sx={{ fontWeight: 800, fontSize: 20, mb: 0.5, color: '#0F172A' }}>No priced, settled orders for {label}</Typography>
          <Typography sx={{ color: '#94A3B8' }}>Add prices above, or try All time or another month.</Typography>
        </Box>
      ) : (
        <>
          <MetricsPanel data={allData} filterLabel={label} profitSummary={profitSummary} flipkart />

          {!drillParent && chartData.length > 0 && (
            <Box sx={{ ...card, p: 2.5 }}>
              <Typography sx={{ fontWeight: 700, fontSize: 15, mb: 0.25 }}>
                Top {chartData.length} {groupBy === 'parent' ? 'Parent Groups' : 'SKUs'} by Absolute Impact
              </Typography>
              <Typography sx={{ fontSize: 12, color: '#94A3B8', mb: 1.5 }}>
                Click a bar to {groupBy === 'parent' ? "see that group's SKUs" : "open that SKU's orders"} · Green = profit, Red = loss
              </Typography>
              <AppBarChart
                dataset={chartData}
                indexKey="sku_id"
                series={[{ dataKey: 'net_profit', label: 'Net P&L' }]}
                diverging
                valueFormatter={fmt}
                height={230}
                onBarClick={(key, bar) => {
                  const row = bar?.data ?? activeData.find((s) => s.sku_id === key);
                  if (row) open(row);
                }}
              />
            </Box>
          )}

          {!drillParent && view === 'low-margin' && (
            <LowMarginPanel rows={lowMarginRows} threshold={marginThreshold} setThreshold={setMarginThreshold} onRowClick={open} />
          )}

          {drillParent && (
            <Box sx={{ ...card, overflow: 'hidden' }}>
              <Box sx={{ px: 2.5, py: 1.75, borderBottom: '1px solid #E8EDF3', display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Button size="small" onClick={() => setDrillParent(null)} sx={{ textTransform: 'none', fontWeight: 700, minWidth: 0, px: 1 }}>
                  ← Back
                </Button>
                <Box>
                  <Typography sx={{ fontWeight: 700, fontSize: 15 }}>
                    {drillRows.length} SKU{drillRows.length === 1 ? '' : 's'}
                    <Typography component="span" sx={{ fontSize: 13, fontWeight: 400, color: '#94A3B8', ml: 1 }}>
                      under <Box component="span" sx={{ fontFamily: 'monospace', fontWeight: 700, color: '#0F172A' }}>{drillParent}</Box>
                    </Typography>
                  </Typography>
                  <Typography sx={{ fontSize: 12, color: '#94A3B8', mt: 0.25 }}>Click any row to see its orders and payments</Typography>
                </Box>
              </Box>
              <SKUDataTable data={drillRows} onRowClick={setSelSku} />
            </Box>
          )}

          {!drillParent && view !== 'low-margin' && (
            <Box sx={{ ...card, overflow: 'hidden' }}>
              <Box sx={{ px: 2.5, py: 1.75, borderBottom: '1px solid #E8EDF3' }}>
                <Typography sx={{ fontWeight: 700, fontSize: 15 }}>
                  {viewData.length} {groupBy === 'parent' ? `parent group${viewData.length === 1 ? '' : 's'}` : 'SKUs'}
                  <Typography component="span" sx={{ fontSize: 13, fontWeight: 400, color: '#94A3B8', ml: 1 }}>
                    {view === 'profit' ? '— profitable' : view === 'loss' ? '— in loss' : '— all'}
                  </Typography>
                </Typography>
                <Typography sx={{ fontSize: 12, color: '#94A3B8', mt: 0.25 }}>
                  {groupBy === 'parent' ? "Click any row to see that parent's SKUs" : 'Click any row to see its orders and payments'}
                </Typography>
              </Box>
              <SKUDataTable data={viewData} mode={groupBy} onRowClick={open} />
            </Box>
          )}
        </>
      )}

      {/* One SKU: the full report — the same window Meesho opens */}
      {selSku && <FlipkartSkuReport sku={selSku} onClose={() => setSelSku(null)} />}
    </Box>
  );
}
