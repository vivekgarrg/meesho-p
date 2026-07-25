import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart } from "@mui/x-charts/BarChart";
import {
  Box, Chip, CircularProgress, Paper, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Tooltip, Typography,
} from "@mui/material";
import { API, C, fmt } from "../../App";
import { useDateFilter } from "../../contexts/DateFilterContext";

function SectionLoader() {
  return (
    <Box display="flex" justifyContent="center" alignItems="center" py={8}>
      <CircularProgress size={36} sx={{ color: C.orange }} />
    </Box>
  );
}

function KpiCard({ label, value, sub, color = C.orange }) {
  return (
    <Paper variant="outlined" sx={{ flex: "1 1 150px", p: 2, borderRadius: 3, borderColor: "#E2E8F0", borderTop: `3px solid ${color}` }}>
      <Typography variant="caption" color="text.secondary" fontWeight={700} textTransform="uppercase" letterSpacing={0.5} fontSize={10}>
        {label}
      </Typography>
      <Typography sx={{ fontFamily: "monospace", fontWeight: 800, fontSize: 22, color, mt: 0.5 }}>{value}</Typography>
      {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
    </Paper>
  );
}

function OrderBadge({ icon, count, color, bg, border }) {
  if (!count) return null;
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, color, background: bg,
      padding: "1px 6px", borderRadius: 20, border: `1px solid ${border}`,
    }}>{icon} {count}</span>
  );
}

function ProfitCell({ value, sub }) {
  if (value == null) return <Typography sx={{ color: "#CBD5E1", fontFamily: "monospace", fontSize: 12 }}>—</Typography>;
  const pos = value >= 0;
  return (
    <Box sx={{ textAlign: "right" }}>
      <Typography sx={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13, color: pos ? C.green : C.red }}>
        {pos ? "+" : ""}{fmt(value)}
      </Typography>
      {sub && <Typography sx={{ fontSize: 10, color: "#94A3B8" }}>{sub}</Typography>}
    </Box>
  );
}

function fmtMonth(m) {
  if (!m || m === "Unknown") return "Unknown";
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleString("en-IN", { month: "short", year: "2-digit" });
}

// ── Per-SKU recommendation — cheap heuristic, not a backend concern ───────────
function recommendation(r) {
  if (r.order_count < 3) return null; // not enough signal yet
  if (r.net_profit < 0) {
    return { label: "⏸ Pause — losing money via ads", color: C.red, bg: "#FFF1F2", border: C.redBorder };
  }
  const hasOrganic = r.organic_avg_profit_per_piece != null && r.avg_profit_per_piece != null && r.organic_delivered_count >= 3;
  if (hasOrganic && r.avg_profit_per_piece >= r.organic_avg_profit_per_piece && r.net_profit > 0) {
    return { label: "📈 Scale up — beats organic", color: C.green, bg: "#ECFDF5", border: C.greenBorder };
  }
  if (hasOrganic && r.avg_profit_per_piece < r.organic_avg_profit_per_piece * 0.5) {
    return { label: "🔎 Review targeting — underperforms organic", color: C.amber, bg: "#FFFBEB", border: "#FDE68A" };
  }
  if (r.net_profit > 0) {
    return { label: "✓ Healthy", color: C.green, bg: "#ECFDF5", border: C.greenBorder };
  }
  return null;
}

const SORT_OPTIONS = [
  { key: "order_count",             label: "Ad Orders" },
  { key: "avg_profit_per_piece",    label: "Avg Profit/pc via Ads" },
  { key: "delivered_count",         label: "Delivered" },
  { key: "net_profit",              label: "Net P&L" },
];

export function AdsAnalysisTab() {
  const { range } = useDateFilter();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("net_profit");
  const [sortDir, setSortDir] = useState("asc");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (range.date_from) params.set("date_from", range.date_from);
      if (range.date_to) params.set("date_to", range.date_to);
      const r = await fetch(`${API}/ads/sku-analysis/?${params}`);
      setData(await r.json());
    } catch {
      setData(null);
    }
    setLoading(false);
  }, [range]);

  useEffect(() => { load(); }, [load]);

  const s = data?.summary || {};

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "net_profit" ? "asc" : "desc"); }
  };

  const results = useMemo(() => {
    const filtered = (data?.results || []).filter(
      r => !search || r.sku_id.toLowerCase().includes(search.toLowerCase()) || (r.parent_sku || "").toLowerCase().includes(search.toLowerCase())
    );
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = a[sortKey] ?? -Infinity, bv = b[sortKey] ?? -Infinity;
      return (av - bv) * dir;
    });
  }, [data, search, sortKey, sortDir]);

  const netBenefit = Number(s.net_benefit ?? 0);
  const hasSpend = s.total_ads_spend > 0;
  const benefitVerdict = !hasSpend
    ? { label: "No ads spend recorded for this period", color: C.gray500, bg: "#F8FAFC", border: "#E2E8F0" }
    : netBenefit >= 0
      ? { label: "✅ Ads are paying off — profit from ad orders covers ad spend", color: C.green, bg: "#ECFDF5", border: "#A7F3D0" }
      : { label: "❌ Ads are running at a net loss this period", color: C.red, bg: "#FFF1F2", border: "#FECDD3" };

  const pauseCount = (data?.results || []).filter(r => recommendation(r)?.label.startsWith("⏸")).length;
  const scaleCount = (data?.results || []).filter(r => recommendation(r)?.label.startsWith("📈")).length;

  const monthly = data?.monthly_trend || [];
  const chartDataset = monthly.map(m => ({
    month: fmtMonth(m.month),
    "Ad Profit": m.ad_profit,
    "Ads Spend": -Math.abs(m.ads_spend),
    "Net Benefit": m.net_benefit,
  }));

  const campaigns = data?.campaigns || [];

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1400, mx: "auto" }}>
      <Box mb={3}>
        <Typography variant="h5" fontWeight={800} color="text.primary">Ads Analysis</Typography>
        <Typography variant="caption" color="text.secondary">
          Per-SKU performance of orders that came through Meesho Ads (order_source = "Ad order") — use the period filter above to change the range
        </Typography>
      </Box>

      {loading ? <SectionLoader /> : !data ? (
        <Typography sx={{ textAlign: "center", py: 8, color: "text.secondary" }}>Failed to load ads analysis.</Typography>
      ) : (
        <Stack spacing={2.5}>
          {/* Benefit banner */}
          <Paper elevation={0} sx={{ p: "14px 18px", borderRadius: 3, background: benefitVerdict.bg, border: `1.5px solid ${benefitVerdict.border}` }}>
            <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ sm: "center" }} spacing={1}>
              <Box>
                <Typography sx={{ fontWeight: 800, fontSize: 15, color: benefitVerdict.color }}>{benefitVerdict.label}</Typography>
                {(pauseCount > 0 || scaleCount > 0) && (
                  <Typography sx={{ fontSize: 12, color: "text.secondary", mt: 0.5 }}>
                    {pauseCount > 0 && <>⏸ {pauseCount} SKU{pauseCount === 1 ? "" : "s"} losing money via ads</>}
                    {pauseCount > 0 && scaleCount > 0 && " · "}
                    {scaleCount > 0 && <>📈 {scaleCount} SKU{scaleCount === 1 ? "" : "s"} worth scaling</>}
                  </Typography>
                )}
              </Box>
              {hasSpend && (
                <Typography sx={{ fontFamily: "monospace", fontWeight: 800, fontSize: 20, color: benefitVerdict.color }}>
                  {netBenefit >= 0 ? "+" : ""}{fmt(netBenefit)} net
                </Typography>
              )}
            </Stack>
          </Paper>

          {/* KPI row */}
          <Stack direction="row" spacing={1.5} flexWrap="wrap">
            <KpiCard label="Ad Orders" value={(s.total_ad_orders || 0).toLocaleString()} color={C.blue} />
            <KpiCard label="Ad Delivery Rate" value={s.ad_delivery_rate_pct != null ? `${s.ad_delivery_rate_pct}%` : "—"}
              sub={s.organic_delivery_rate_pct != null ? `organic: ${s.organic_delivery_rate_pct}%` : ""}
              color={s.ad_delivery_rate_pct != null && s.organic_delivery_rate_pct != null && s.ad_delivery_rate_pct < s.organic_delivery_rate_pct ? C.amber : C.green} />
            <KpiCard label="Returned" value={(s.total_ad_return || 0).toLocaleString()} color={C.red} />
            <KpiCard label="RTO" value={(s.total_ad_rto || 0).toLocaleString()} color={C.amber} />
            <KpiCard label="Claims" value={(s.total_ad_claim || 0).toLocaleString()} color="#7C3AED" />
            <KpiCard label="Profit from Ad Orders" value={fmt(s.total_ad_net_profit)} color={s.total_ad_net_profit >= 0 ? C.green : C.red} />
            <KpiCard label="Total Ads Spend" value={fmt(s.total_ads_spend)} color={C.orange}
              sub={s.roi_pct != null ? `ROI ${s.roi_pct}%` : "no spend recorded"} />
          </Stack>

          <Typography sx={{ fontSize: 11, color: "#94A3B8" }}>
            Ads spend is only available in aggregate — Meesho's Ads Cost export has no SKU/catalog link, so it can't be split per SKU.
            "Profit from Ad Orders" is computed the same way as the SKU Analysis tab, restricted to orders sourced through ads.
          </Typography>

          {/* Monthly trend */}
          {chartDataset.length > 1 && (
            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3, borderColor: "#E2E8F0" }}>
              <Typography sx={{ fontWeight: 700, fontSize: 14, mb: 0.5 }}>Ads Profit vs Spend — Monthly Trend</Typography>
              <Typography sx={{ fontSize: 12, color: "#94A3B8", mb: 1.5 }}>Green = profit earned from ad orders · Red = ad spend · Net benefit is the gap</Typography>
              <BarChart
                dataset={chartDataset}
                xAxis={[{ scaleType: "band", dataKey: "month" }]}
                series={[
                  { dataKey: "Ad Profit", label: "Ad Profit", color: C.green },
                  { dataKey: "Ads Spend", label: "Ads Spend", color: C.red },
                  { dataKey: "Net Benefit", label: "Net Benefit", color: C.blue },
                ]}
                height={260} borderRadius={5}
                margin={{ left: 68, bottom: 40, right: 10, top: 10 }}
                slotProps={{ legend: { position: { vertical: "top", horizontal: "right" } } }}
              />
            </Paper>
          )}

          {/* Campaign spend breakdown */}
          {campaigns.length > 0 && (
            <Paper variant="outlined" sx={{ borderRadius: 3, borderColor: "#E2E8F0", overflow: "hidden" }}>
              <Box sx={{ px: 2.5, py: 1.5, borderBottom: "1px solid #E2E8F0" }}>
                <Typography sx={{ fontWeight: 700, fontSize: 14 }}>Spend by Campaign</Typography>
                <Typography sx={{ fontSize: 11, color: "#94A3B8" }}>Top {campaigns.length} campaigns by total cost — no SKU link available in Meesho's export</Typography>
              </Box>
              <TableContainer sx={{ maxHeight: 260 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      {["Campaign ID", "Entries", "Total Cost"].map((h, i) => (
                        <TableCell key={h} sx={{ fontWeight: 700, fontSize: 11, color: "#64748B", bgcolor: "#F8FAFC", textAlign: i === 2 ? "right" : "left" }}>{h}</TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {campaigns.map(c => (
                      <TableRow key={c.campaign_id} hover>
                        <TableCell sx={{ fontFamily: "monospace", fontSize: 12 }}>{c.campaign_id}</TableCell>
                        <TableCell sx={{ fontSize: 12, color: "#64748B" }}>{c.entries}</TableCell>
                        <TableCell sx={{ textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: C.red }}>{fmt(c.total_cost)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          )}

          {/* SKU table */}
          <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
            <Typography variant="subtitle2" fontWeight={700}>
              Per-SKU Ad Performance — {results.length} of {s.sku_count || 0} SKUs
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <input
                value={search} onChange={e => setSearch(e.target.value)} placeholder="Search SKU or parent…"
                style={{ padding: "7px 12px", borderRadius: 8, border: "1.5px solid #E2E8F0", fontSize: 12, width: 220, fontFamily: "inherit" }}
              />
            </Stack>
          </Stack>

          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 3, borderColor: "#E2E8F0" }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: "#F8FAFC" }}>
                  <TableCell sx={{ fontWeight: 700, fontSize: 11, color: "#64748B", py: 1.5 }}>SKU</TableCell>
                  {SORT_OPTIONS.map((opt, i) => (
                    <TableCell key={opt.key} onClick={() => toggleSort(opt.key)}
                      sx={{ fontWeight: 700, fontSize: 11, color: sortKey === opt.key ? C.orange : "#64748B", py: 1.5, textAlign: "right", cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}>
                      {opt.label}{sortKey === opt.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                    </TableCell>
                  ))}
                  <TableCell sx={{ fontWeight: 700, fontSize: 11, color: "#64748B", py: 1.5, textAlign: "right" }}>Organic Avg/pc</TableCell>
                  <TableCell sx={{ fontWeight: 700, fontSize: 11, color: "#64748B", py: 1.5 }}>Recommendation</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {results.length === 0 ? (
                  <TableRow><TableCell colSpan={7} align="center" sx={{ py: 6, color: "text.secondary" }}>No ad-sourced orders found for this period.</TableCell></TableRow>
                ) : results.map(r => {
                  const rec = recommendation(r);
                  return (
                    <TableRow key={r.sku_id} hover>
                      <TableCell sx={{ py: 1.25 }}>
                        <Chip label={r.sku_id} size="small" sx={{
                          fontFamily: "monospace", fontWeight: 700, fontSize: 12,
                          bgcolor: "#FFF7ED", color: "#C2410C", border: "1px solid #FED7AA", maxWidth: 220,
                          "& .MuiChip-label": { overflow: "hidden", textOverflow: "ellipsis" },
                        }} />
                        {r.parent_sku && <Typography sx={{ fontSize: 11, color: "#94A3B8", mt: 0.3 }}>↳ {r.parent_sku}</Typography>}
                      </TableCell>
                      <TableCell sx={{ textAlign: "right" }}>
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" justifyContent="flex-end" useFlexGap>
                          <OrderBadge icon="📦" count={r.order_count} color={C.blue} bg={C.blueLight} border="#BFDBFE" />
                          <OrderBadge icon="✅" count={r.delivered_count} color={C.green} bg={C.greenLight} border={C.greenBorder} />
                          <OrderBadge icon="↩" count={r.return_count} color={C.red} bg={C.redLight} border={C.redBorder} />
                          <OrderBadge icon="🔄" count={r.rto_count} color={C.amber} bg={C.amberLight} border="#FDE68A" />
                          <OrderBadge icon="⚠" count={r.claim_count} color="#7C3AED" bg="#F5F3FF" border="#DDD6FE" />
                        </Stack>
                      </TableCell>
                      <TableCell><ProfitCell value={r.avg_profit_per_piece} /></TableCell>
                      <TableCell sx={{ textAlign: "right", fontFamily: "monospace", fontSize: 13 }}>{r.delivered_count}</TableCell>
                      <TableCell>
                        <Box sx={{ textAlign: "right" }}>
                          <Chip
                            label={`${r.net_profit >= 0 ? "+" : ""}${fmt(r.net_profit)}`}
                            size="small"
                            sx={{
                              fontFamily: "monospace", fontWeight: 800, fontSize: 12,
                              bgcolor: r.net_profit >= 0 ? "#ECFDF5" : "#FFF1F2",
                              color: r.net_profit >= 0 ? C.green : C.red,
                              border: `1px solid ${r.net_profit >= 0 ? C.greenBorder : C.redBorder}`,
                            }}
                          />
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Tooltip title={r.organic_delivered_count ? `${r.organic_delivered_count} delivered organically` : "No organic sales for this SKU"}>
                          <Box><ProfitCell value={r.organic_avg_profit_per_piece} /></Box>
                        </Tooltip>
                      </TableCell>
                      <TableCell>
                        {rec ? (
                          <Chip label={rec.label} size="small" sx={{ bgcolor: rec.bg, color: rec.color, border: `1px solid ${rec.border}`, fontWeight: 700, fontSize: 11 }} />
                        ) : <Typography sx={{ fontSize: 11, color: "#CBD5E1" }}>—</Typography>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Stack>
      )}
    </Box>
  );
}
