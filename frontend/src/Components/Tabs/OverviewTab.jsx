import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Grid from "@mui/material/Grid";
import LinearProgress from "@mui/material/LinearProgress";
import Divider from "@mui/material/Divider";
import CircularProgress from "@mui/material/CircularProgress";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import TextField from "@mui/material/TextField";
import Table from "@mui/material/Table";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableCell from "@mui/material/TableCell";
import TableBody from "@mui/material/TableBody";
import Alert from "@mui/material/Alert";
import { BarChart } from "@mui/x-charts/BarChart";
import { LineChart } from "@mui/x-charts/LineChart";
import { PieChart } from "@mui/x-charts/PieChart";
import { API, C, CHART_COLORS, fmt } from "../../App";

const STATUS_COLOR = { DELIVERED: "#059669", RTO_COMPLETE: "#E11D48", CANCELLED: "#94A3B8" };

function fmtMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-IN", { month: "long", year: "numeric" });
}
function monthToRange(ym) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { date_from: `${ym}-01`, date_to: `${ym}-${String(last).padStart(2, "0")}` };
}

function KpiCard({ label, value, sub, accent, icon, onClick }) {
  return (
    <Card onClick={onClick} elevation={1} sx={{
      borderTop: `3px solid ${accent}`, minWidth: 170, cursor: onClick ? "pointer" : "default",
      position: "relative", overflow: "hidden",
      transition: "box-shadow 0.15s", "&:hover": onClick ? { boxShadow: 4 } : {},
    }}>
      <Box sx={{ position: "absolute", top: -12, right: -12, width: 64, height: 64, borderRadius: "50%", background: accent, opacity: 0.08 }} />
      <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
        <Typography variant="subtitle2" sx={{ mb: 0.75, display: "flex", alignItems: "center", gap: 0.5 }}>{icon} {label}</Typography>
        <Typography variant="h5" sx={{ fontWeight: 800, color: accent, fontFamily: "monospace", lineHeight: 1.15 }}>{value}</Typography>
        {sub && <Typography variant="caption" sx={{ display: "block", mt: 0.5 }}>{sub}</Typography>}
        {onClick && <Typography variant="caption" sx={{ display: "block", color: accent, mt: 0.5, opacity: 0.8 }}>View details →</Typography>}
      </CardContent>
    </Card>
  );
}

function FilterBar({ mode, setMode, selectedMonth, setSelectedMonth, months,
                     customFrom, setCustomFrom, customTo, setCustomTo, onApply }) {
  return (
    <Paper elevation={1} sx={{ p: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
        <Typography variant="subtitle2">Period</Typography>
        <Button size="small" variant={mode === "all" ? "contained" : "outlined"} disableElevation
          onClick={() => { setMode("all"); onApply({}); }}>All Time</Button>
        <Select size="small" displayEmpty value={mode === "month" ? (selectedMonth || "") : ""}
          onChange={e => { const m = e.target.value; if (!m) return; setMode("month"); setSelectedMonth(m); onApply(monthToRange(m)); }}
          sx={{ minWidth: 175, fontSize: 13 }}>
          <MenuItem value=""><em>Select month…</em></MenuItem>
          {months.map(m => <MenuItem key={m} value={m}>{fmtMonth(m)}</MenuItem>)}
        </Select>
        {mode === "month" && selectedMonth && <Chip label={fmtMonth(selectedMonth)} color="primary" size="small" />}
        <Divider orientation="vertical" flexItem />
        <Typography variant="body2" color="text.secondary">Custom:</Typography>
        <TextField size="small" type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} InputLabelProps={{ shrink: true }} label="From" sx={{ width: 155 }} />
        <Typography variant="body2">→</Typography>
        <TextField size="small" type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} InputLabelProps={{ shrink: true }} label="To" sx={{ width: 155 }} />
        <Button size="small" variant={mode === "custom" ? "contained" : "outlined"} disableElevation
          disabled={!customFrom || !customTo}
          onClick={() => { if (customFrom && customTo) { setMode("custom"); onApply({ date_from: customFrom, date_to: customTo }); } }}>
          Apply
        </Button>
        {mode === "custom" && customFrom && <Chip label={`${customFrom} → ${customTo}`} color="primary" size="small" onDelete={() => { setMode("all"); onApply({}); }} />}
      </Box>
    </Paper>
  );
}

function PLRow({ label, val, color, bold }) {
  return (
    <Box sx={{ display: "flex", justifyContent: "space-between", py: 0.75, borderBottom: "1px solid", borderColor: "divider" }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography variant="body2" sx={{ fontFamily: "monospace", fontWeight: bold ? 800 : 600, color: color || "text.primary" }}>{fmt(val)}</Typography>
    </Box>
  );
}

export function OverviewTab() {
  const navigate = useNavigate();
  const [profit,  setProfit]  = useState(null);
  const [dash,    setDash]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [months,  setMonths]  = useState([]);
  const [mode,          setMode]          = useState("all");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [customFrom,    setCustomFrom]    = useState("");
  const [customTo,      setCustomTo]      = useState("");
  const [activeRange,   setActiveRange]   = useState(null);

  useEffect(() => {
    fetch(`${API}/profit/available-months/`).then(r => r.json()).then(ms => {
      setMonths(ms);
      if (ms.length > 0) { setMode("month"); setSelectedMonth(ms[0]); setActiveRange(monthToRange(ms[0])); }
      else setActiveRange({});
    }).catch(() => setActiveRange({}));
  }, []);

  useEffect(() => {
    if (activeRange === null) return;
    setLoading(true);
    const qs = Object.keys(activeRange).length ? `?${new URLSearchParams(activeRange)}` : "";
    Promise.all([
      fetch(`${API}/profit/${qs}`).then(r => r.json()),
      fetch(`${API}/dashboard/${qs}`).then(r => r.json()),
    ]).then(([p, d]) => { setProfit(p); setDash(d); setLoading(false); }).catch(() => setLoading(false));
  }, [activeRange]);

  const netProfit  = Number(profit?.net_revenue ?? 0);
  const { order_stats, payment_stats, join_stats, status_settlement, unsettled } = dash || {};
  const matchRate  = join_stats?.match_rate ?? 0;
  const netSettle  = payment_stats?.total_settlement ?? 0;
  const totalSale  = payment_stats?.total_sale ?? 0;
  const settleEff  = totalSale > 0 ? ((netSettle / totalSale) * 100).toFixed(1) : "—";
  const filterLabel = mode === "month" ? fmtMonth(selectedMonth) : mode === "custom" ? `${customFrom} → ${customTo}` : "All Time";

  const matchPieData = [
    { id: 0, value: join_stats?.matched_count   ?? 0, label: "Matched",   color: C.green },
    { id: 1, value: join_stats?.unmatched_count ?? 0, label: "Unmatched", color: C.amber },
  ].filter(d => d.value > 0);

  const pieData = [
    { label: "Commission", value: Math.abs(Number(profit?.total_commission_paid)) },
    { label: "Ads Cost",   value: Math.abs(Number(profit?.total_ads_cost)) },
    { label: "TCS",        value: Math.abs(Number(profit?.total_tcs)) },
    { label: "TDS",        value: Math.abs(Number(profit?.total_tds)) },
    { label: "Shipping",   value: Math.abs(Number(profit?.total_shipping_cost)) },
  ].filter(d => d.value > 0.01).map((d, i) => ({ ...d, id: i, color: CHART_COLORS[i % CHART_COLORS.length] }));

  const timelineData = (() => {
    if (!dash) return [];
    const map = {};
    (dash.payment_stats?.daily || []).forEach(({ payment_date, count }) => {
      const d = String(payment_date); if (!map[d]) map[d] = { date: d, settlements: 0, orders: 0 }; map[d].settlements = count;
    });
    (dash.order_stats?.daily || []).forEach(({ order_date, count }) => {
      const d = String(order_date); if (!map[d]) map[d] = { date: d, settlements: 0, orders: 0 }; map[d].orders = count;
    });
    return Object.values(map).sort((a, b) => a.date > b.date ? 1 : -1);
  })();

  const ssRows = (status_settlement || []).map((row, i) => ({
    ...row, id: i,
    rate: row.order_count > 0 ? (row.settled_count / row.order_count) * 100 : 0,
    vs:   row.order_value > 0 ? ((row.settlement_amount / row.order_value) * 100).toFixed(1) : "—",
  }));

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <FilterBar mode={mode} setMode={setMode} selectedMonth={selectedMonth} setSelectedMonth={setSelectedMonth}
        months={months} customFrom={customFrom} setCustomFrom={setCustomFrom}
        customTo={customTo} setCustomTo={setCustomTo} onApply={range => setActiveRange(range)} />

      {loading && (
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", py: 10, gap: 2 }}>
          <CircularProgress color="primary" />
          <Typography color="text.secondary">Loading overview…</Typography>
        </Box>
      )}

      {!loading && profit && <>
        {/* Hero banner */}
        <Paper elevation={2} sx={{
          background: `linear-gradient(135deg, ${netProfit >= 0 ? "#ECFDF5" : "#FFF1F2"} 0%, #fff 70%)`,
          border: `1px solid ${netProfit >= 0 ? C.greenBorder : C.redBorder}`, borderRadius: 4,
          p: 3.5, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 3,
        }}>
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1, letterSpacing: "0.1em" }}>NET PROFIT — {filterLabel.toUpperCase()}</Typography>
            <Typography variant="h2" sx={{ fontFamily: "monospace", color: netProfit >= 0 ? C.green : C.red, lineHeight: 1, letterSpacing: "-0.03em" }}>{fmt(netProfit)}</Typography>
            <Box sx={{ display: "flex", gap: 1, mt: 1.5, flexWrap: "wrap" }}>
              <Chip label={netProfit >= 0 ? "Profitable" : "Loss"} color={netProfit >= 0 ? "success" : "error"} size="small" />
              <Chip label={`${profit.order_count} Settled Orders`} size="small" />
              <Chip label={`${profit.ads_campaigns} Ad Campaigns`} color="warning" size="small" />
            </Box>
          </Box>
          <Box sx={{ textAlign: "right" }}>
            <Typography variant="subtitle2" sx={{ mb: 0.75 }}>Gross Revenue</Typography>
            <Typography variant="h3" sx={{ fontFamily: "monospace", fontWeight: 800 }}>{fmt(profit.gross_revenue)}</Typography>
            <Typography variant="caption" sx={{ mt: 0.5, display: "block" }}>
              Settlement: <strong style={{ color: C.gray800 }}>{fmt(profit.net_settlement_revenue)}</strong>
            </Typography>
          </Box>
        </Paper>

        {/* KPI strip */}
        {dash && (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
            <KpiCard label="Settled Payments"      value={payment_stats.total.toLocaleString()}           accent={C.green}  icon="💰" sub="from payment data" />
            <KpiCard label="Orders Tracked"        value={order_stats.total.toLocaleString()}             accent={C.blue}   icon="📦" sub="in Orders CSV" />
            <KpiCard label="Match Rate"            value={`${matchRate}%`}                                accent={matchRate >= 80 ? C.green : C.amber} icon="🔗" sub={`${join_stats.matched_count} linked`} />
            <KpiCard label="Net Settlement"        value={fmt(netSettle)}                                 accent={netSettle >= 0 ? C.green : C.red} icon="💳" />
            <KpiCard label="Settlement Efficiency" value={`${settleEff}%`}                               accent={C.orange} icon="📈" sub="settlement ÷ sale" />
            <KpiCard label="Unmatched Payments"    value={join_stats.unmatched_count.toLocaleString()}    accent={C.amber}  icon="⚠️" sub="no order record" />
            <KpiCard label="Unsettled Orders"      value={(unsettled?.count ?? 0).toLocaleString()}       accent={C.red}    icon="🔴"
              sub={unsettled?.total_value ? `At-risk: ${fmt(unsettled.total_value)}` : "no payment record"}
              onClick={() => navigate("/orders?view=unsettled")} />
          </Box>
        )}

        {/* P&L summary grid */}
        <Card elevation={1}>
          <CardContent>
            <Typography variant="subtitle2" sx={{ mb: 2 }}>P&L Summary</Typography>
            <Grid container spacing={0} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, overflow: "hidden" }}>
              {[
                { title: "Revenue", rows: [
                  { label: "Gross Revenue",  val: profit.gross_revenue,          color: C.gray800 },
                  { label: "Net Settlement", val: profit.net_settlement_revenue, color: C.green },
                  { label: "Purchase Cost",  val: profit.total_purchase_cost,    color: C.amber },
                  { label: "Packaging",      val: profit.total_packaging_cost,   color: C.gray600 },
                  { label: "Net P&L",        val: netProfit, color: netProfit >= 0 ? C.green : C.red, bold: true },
                ]},
                { title: "Profit & Loss", rows: [
                  { label: "Delivered Profit", val: profit.total_profit,                 color: C.green },
                  { label: "Return Loss",       val: profit.total_loss,                  color: C.red },
                  { label: "Claims Received",   val: profit.total_claims,                color: C.blue },
                  { label: "Referral Income",   val: profit.total_referral_income,       color: C.green },
                  { label: "Comp / Recovery",   val: profit.total_compensation_recovery, color: C.amber },
                ]},
                { title: "Deductions", rows: [
                  { label: "Ads Cost",      val: profit.total_ads_cost,        color: C.red },
                  { label: "Shipping",       val: profit.total_shipping_cost,   color: C.amber },
                  { label: "Commission",     val: profit.total_commission_paid, color: C.orange },
                  { label: "TCS",            val: profit.total_tcs,             color: C.gray500 },
                  { label: "TDS",            val: profit.total_tds,             color: C.gray500 },
                  { label: "Affiliate Fee",  val: profit.total_affiliate_fee,   color: C.red },
                ]},
              ].map((col, ci) => (
                <Grid item xs={12} md={4} key={col.title} sx={{ p: 2, borderRight: ci < 2 ? "1px solid" : "none", borderColor: "divider" }}>
                  <Typography variant="subtitle2" sx={{ mb: 1.5, fontSize: 10, color: "text.secondary" }}>{col.title}</Typography>
                  {col.rows.map(r => <PLRow key={r.label} {...r} />)}
                </Grid>
              ))}
            </Grid>
          </CardContent>
        </Card>

        {/* Operations row */}
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
          {[
            { icon: "🛒", label: "Orders Settled",  value: profit.order_count.toLocaleString(),                       sub: `${profit.orders_with_price} with price`,   accent: C.blue },
            { icon: "⚠️", label: "Missing Price",   value: profit.orders_missing_price.toLocaleString(),              sub: "SKUs without pricing",                     accent: C.amber },
            { icon: "↩",  label: "Pure Returns",    value: profit.total_pure_returns.toLocaleString(),                sub: "return-only orders",                       accent: C.red },
            { icon: "✅", label: "Claimed Orders",  value: profit.total_claimed_orders.toLocaleString(),              sub: fmt(profit.total_claims),                   accent: C.blue },
            { icon: "📣", label: "Ad Campaigns",    value: profit.ads_campaigns.toLocaleString(),                     sub: `${profit.adjustment_count} adj. rows`,     accent: C.orange },
            { icon: "🔗", label: "Referral Count",  value: (profit.referral_count ?? 0).toLocaleString(),             sub: fmt(profit.total_referral_income),          accent: C.green },
          ].map(c => <KpiCard key={c.label} {...c} />)}
        </Box>

        {/* Status-Settlement crosswalk */}
        {ssRows.length > 0 && (
          <Card elevation={1}>
            <CardContent>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Order Status → Settlement Crosswalk</Typography>
              <Typography variant="caption" sx={{ display: "block", mb: 2 }}>Count and settlement amount per lifecycle status among settled orders.</Typography>
              <Box sx={{ overflowX: "auto" }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      {["Order Status", "Orders", "Settled", "Settlement Rate", "Net Settlement", "Order Value", "vs Value"].map(h => (
                        <TableCell key={h}>{h}</TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {ssRows.map(row => (
                      <TableRow key={row.status}>
                        <TableCell>
                          <Chip label={row.status} size="small" color={row.status === "DELIVERED" ? "success" : row.status === "RTO_COMPLETE" ? "error" : "default"} />
                        </TableCell>
                        <TableCell sx={{ fontFamily: "monospace", fontWeight: 600 }}>{row.order_count?.toLocaleString()}</TableCell>
                        <TableCell>
                          <Chip label={row.settled_count?.toLocaleString()} size="small" color={row.settled_count > 0 ? "success" : "default"} variant="outlined" />
                        </TableCell>
                        <TableCell sx={{ minWidth: 160 }}>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                            <LinearProgress variant="determinate" value={row.rate} sx={{ flex: 1, bgcolor: "grey.100", "& .MuiLinearProgress-bar": { bgcolor: STATUS_COLOR[row.status] || C.blue } }} />
                            <Typography variant="caption" sx={{ fontFamily: "monospace", fontWeight: 700, minWidth: 38 }}>{row.rate.toFixed(1)}%</Typography>
                          </Box>
                        </TableCell>
                        <TableCell sx={{ fontFamily: "monospace", fontWeight: 700, color: row.settlement_amount >= 0 ? C.green : C.red }}>{fmt(row.settlement_amount)}</TableCell>
                        <TableCell sx={{ fontFamily: "monospace", color: "text.secondary" }}>{fmt(row.order_value)}</TableCell>
                        <TableCell>
                          {row.vs !== "—" && <Typography variant="caption" sx={{ fontFamily: "monospace", color: Number(row.vs) > 0 ? C.green : C.red, fontWeight: 700 }}>{row.vs}%</Typography>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            </CardContent>
          </Card>
        )}

        {/* Charts row 1 */}
        {dash && order_stats?.by_status?.length > 0 && (
          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <Card elevation={1}>
                <CardContent>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>Orders by Lifecycle Status</Typography>
                  <BarChart dataset={order_stats.by_status}
                    xAxis={[{ scaleType: "band", dataKey: "reason_for_credit_entry",
                      colorMap: { type: "ordinal", values: Object.keys(STATUS_COLOR), colors: Object.values(STATUS_COLOR) } }]}
                    series={[{ dataKey: "count", label: "Orders" }]}
                    height={220} borderRadius={6} margin={{ left: 50, bottom: 30, right: 10, top: 10 }}
                    slotProps={{ legend: { hidden: true } }} />
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} md={6}>
              <Card elevation={1}>
                <CardContent>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>Payments by Settlement Status</Typography>
                  <BarChart dataset={payment_stats.by_status}
                    xAxis={[{ scaleType: "band", dataKey: "live_order_status" }]}
                    series={[{ dataKey: "count", label: "Payments", color: C.blue }]}
                    height={220} borderRadius={6} margin={{ left: 50, bottom: 30, right: 10, top: 10 }}
                    slotProps={{ legend: { hidden: true } }} />
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        )}

        {/* Charts row 2 */}
        {dash && (
          <Grid container spacing={2}>
            <Grid item xs={12} md={4}>
              <Card elevation={1} sx={{ height: "100%" }}>
                <CardContent>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>Payment–Order Match Rate</Typography>
                  {matchPieData.length > 0 && (
                    <PieChart series={[{ data: matchPieData, innerRadius: 50, outerRadius: 76, paddingAngle: 3 }]}
                      height={180} slotProps={{ legend: { direction: "row", position: { vertical: "bottom", horizontal: "middle" }, labelStyle: { fontSize: 11 } } }} />
                  )}
                  <Box sx={{ textAlign: "center", mt: 1 }}>
                    <Typography variant="h4" sx={{ fontFamily: "monospace", color: matchRate >= 80 ? C.green : C.amber, fontWeight: 800 }}>{matchRate}%</Typography>
                    <Typography variant="caption">settlements with Order record</Typography>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} md={8}>
              <Card elevation={1}>
                <CardContent>
                  <Typography variant="subtitle2" sx={{ mb: 2 }}>Payment Deductions Breakdown</Typography>
                  <Grid container spacing={1.5}>
                    {[
                      { label: "Total Sale Amount",      value: payment_stats.total_sale,       color: C.green },
                      { label: "Net Settlement",         value: payment_stats.total_settlement, color: netSettle >= 0 ? C.green : C.red },
                      { label: "Commission (incl. GST)", value: payment_stats.total_commission, color: C.orange },
                      { label: "TCS Deducted",           value: payment_stats.total_tcs,        color: C.gray500 },
                      { label: "TDS Deducted",           value: payment_stats.total_tds,        color: C.gray500 },
                    ].map(item => (
                      <Grid item xs={6} key={item.label}>
                        <Paper variant="outlined" sx={{ p: 1.5, bgcolor: "grey.50" }}>
                          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>{item.label}</Typography>
                          <Typography variant="h6" sx={{ fontFamily: "monospace", fontWeight: 700, color: item.color }}>{fmt(item.value)}</Typography>
                        </Paper>
                      </Grid>
                    ))}
                  </Grid>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        )}

        {/* Deduction split + timeline */}
        <Grid container spacing={2}>
          {pieData.length > 0 && (
            <Grid item xs={12} md={5}>
              <Card elevation={1}>
                <CardContent>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>Deduction Split</Typography>
                  <PieChart series={[{ data: pieData, innerRadius: 55, outerRadius: 82, paddingAngle: 2 }]}
                    height={240} slotProps={{ legend: { direction: "column", position: { vertical: "middle", horizontal: "right" }, labelStyle: { fontSize: 11 } } }} />
                </CardContent>
              </Card>
            </Grid>
          )}
          {timelineData.length > 0 && (
            <Grid item xs={12} md={7}>
              <Card elevation={1}>
                <CardContent>
                  <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Daily Settlement Activity</Typography>
                  <Typography variant="caption" sx={{ display: "block", mb: 1 }}>Settlements received per day vs order placement.</Typography>
                  <LineChart dataset={timelineData}
                    xAxis={[{ dataKey: "date", scaleType: "point", tickLabelStyle: { fontSize: 10 } }]}
                    series={[
                      { dataKey: "settlements", label: "Settlements",   color: C.green, showMark: false, area: true },
                      { dataKey: "orders",       label: "Orders Placed", color: C.blue,  showMark: false, area: true },
                    ]}
                    height={240} margin={{ left: 50, right: 10, top: 10, bottom: 32 }} />
                </CardContent>
              </Card>
            </Grid>
          )}
        </Grid>
      </>}

      {!loading && !profit && (
        <Alert severity="info" sx={{ borderRadius: 3 }}>No data for this period — try a different month or All Time.</Alert>
      )}
    </Box>
  );
}
