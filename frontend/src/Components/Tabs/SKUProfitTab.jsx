import React, { useState, useEffect, useCallback } from "react";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";
import ButtonGroup from "@mui/material/ButtonGroup";
import Chip from "@mui/material/Chip";
import Grid from "@mui/material/Grid";
import LinearProgress from "@mui/material/LinearProgress";
import CircularProgress from "@mui/material/CircularProgress";
import TextField from "@mui/material/TextField";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Table from "@mui/material/Table";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableCell from "@mui/material/TableCell";
import TableBody from "@mui/material/TableBody";
import TableSortLabel from "@mui/material/TableSortLabel";
import { DataGrid } from "@mui/x-data-grid";
import { BarChart } from "@mui/x-charts/BarChart";
import { API, C, fmt } from "../../App";

// ── utils ─────────────────────────────────────────────────────────────────────
const fmtMonth = ym => new Date(...ym.split("-").map((v, i) => i === 1 ? v - 1 : +v), 1)
  .toLocaleString("en-IN", { month: "long", year: "numeric" });
const fmtShort = ym => new Date(...ym.split("-").map((v, i) => i === 1 ? v - 1 : +v), 1)
  .toLocaleString("en-IN", { month: "short", year: "2-digit" });
const toRange = ym => {
  const [y, m] = ym.split("-").map(Number);
  return { date_from: `${ym}-01`, date_to: `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}` };
};
const pct = (n, d) => d > 0 ? Math.round(n / d * 100) : 0;

// ── Month filter (pill row) ───────────────────────────────────────────────────
function MonthFilter({ months, selMonth, onSelect }) {
  const [showCustom, setShowCustom] = useState(false);
  const [cf, setCf] = useState(""); const [ct, setCt] = useState("");

  return (
    <Paper elevation={1} sx={{ p: 1.5 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <Typography variant="subtitle2" sx={{ mr: 0.5 }}>Period</Typography>
        <Chip label="All time" size="small" onClick={() => onSelect(null, {})}
          color={selMonth === null ? "primary" : "default"}
          variant={selMonth === null ? "filled" : "outlined"} />
        {months.slice(0, 12).map(m => (
          <Chip key={m} label={fmtShort(m)} size="small" onClick={() => onSelect(m, toRange(m))}
            color={selMonth === m ? "primary" : "default"}
            variant={selMonth === m ? "filled" : "outlined"} />
        ))}
        <Chip label={`Custom ${showCustom ? "▲" : "▼"}`} size="small"
          onClick={() => setShowCustom(s => !s)}
          color={showCustom ? "secondary" : "default"}
          variant={showCustom ? "filled" : "outlined"} />
      </Box>
      {showCustom && (
        <Box sx={{ display: "flex", gap: 1.5, alignItems: "center", mt: 1.5, flexWrap: "wrap" }}>
          <Typography variant="body2" color="text.secondary">From</Typography>
          <TextField size="small" type="date" value={cf} onChange={e => setCf(e.target.value)} sx={{ width: 155 }} InputLabelProps={{ shrink: true }} label="From" />
          <Typography variant="body2" color="text.secondary">to</Typography>
          <TextField size="small" type="date" value={ct} onChange={e => setCt(e.target.value)} sx={{ width: 155 }} InputLabelProps={{ shrink: true }} label="To" />
          <Button size="small" variant="contained" disableElevation disabled={!cf || !ct}
            onClick={() => { if (cf && ct) { onSelect("custom", { date_from: cf, date_to: ct }); setShowCustom(false); } }}>
            Apply
          </Button>
        </Box>
      )}
    </Paper>
  );
}

// ── Unified metrics panel ─────────────────────────────────────────────────────
function MetricsPanel({ data, filterLabel }) {
  const netPL = data.reduce((a, s) => a + s.net_profit, 0);
  const delPft = data.reduce((a, s) => a + (s.delivered_profit || 0), 0);
  const retLoss = data.reduce((a, s) => a + (s.return_loss || 0), 0);
  const rtoLoss = data.reduce((a, s) => a + (s.rto_loss || 0), 0);
  const claims = data.reduce((a, s) => a + (s.claims_total || 0), 0);
  const nDel = data.reduce((a, s) => a + (s.delivered_count || 0), 0);
  const nRet = data.reduce((a, s) => a + (s.return_count || 0), 0);
  const nRTO = data.reduce((a, s) => a + (s.rto_count || 0), 0);
  const nTotal = nDel + nRet + nRTO;
  const nProfit = data.filter(s => s.net_profit > 0).length;
  const nLoss = data.filter(s => s.net_profit < 0).length;
  const pos = netPL >= 0;

  return (
    <Card elevation={1} sx={{ overflow: "hidden" }}>
      <Box sx={{ height: 3, background: `linear-gradient(90deg, ${pos ? C.green : C.red}, ${C.orange})` }} />
      <CardContent>
        <Grid container spacing={2} alignItems="flex-start">
          {/* Net P&L hero */}
          <Grid item xs={12} md="auto">
            <Box sx={{ pr: { md: 3 }, borderRight: { md: "1px solid" }, borderColor: "divider", mr: { md: 2 } }}>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Net P&L · {filterLabel}</Typography>
              <Typography variant="h3" sx={{ fontFamily: "monospace", fontWeight: 900, color: pos ? C.green : C.red, lineHeight: 1.1 }}>
                {pos ? "+" : ""}{fmt(netPL)}
              </Typography>
              <Box sx={{ display: "flex", gap: 1, mt: 1, flexWrap: "wrap" }}>
                {nProfit > 0 && <Chip label={`${nProfit} profitable`} color="success" size="small" />}
                {nLoss > 0 && <Chip label={`${nLoss} in loss`} color="error" size="small" />}
              </Box>
            </Box>
          </Grid>

          {/* Breakdown */}
          <Grid item xs={12} md>
            <Grid container spacing={2}>
              {[
                { label: "Delivered Profit", value: fmt(delPft), color: C.green, sub: `${nDel} orders` },
                { label: "Return Loss", value: fmt(retLoss), color: C.red, sub: `${nRet} returns` },
                { label: "RTO Loss", value: fmt(rtoLoss), color: C.amber, sub: `${nRTO} RTOs` },
                ...(claims !== 0 ? [{ label: "Claims", value: fmt(claims), color: C.blue, sub: `${data.reduce((a, s) => a + (s.claims_count || 0), 0)} claims` }] : []),
              ].map(m => (
                <Grid item key={m.label}>
                  <Typography variant="subtitle2" sx={{ mb: 0.25 }}>{m.label}</Typography>
                  <Typography variant="h6" sx={{ fontFamily: "monospace", fontWeight: 800, color: m.color }}>{m.value}</Typography>
                  <Typography variant="caption">{m.sub}</Typography>
                </Grid>
              ))}

              {/* Rate bars */}
              <Grid item xs={12} md="auto" sx={{ minWidth: 200 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>Order Rates ({nTotal} total)</Typography>
                {[
                  { label: "Delivered", p: pct(nDel, nTotal), color: C.green },
                  { label: "Returns", p: pct(nRet, nTotal), color: C.red },
                  { label: "RTO", p: pct(nRTO, nTotal), color: C.amber },
                ].map(r => (
                  <Box key={r.label} sx={{ mb: 0.75 }}>
                    <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.25 }}>
                      <Typography variant="caption">{r.label}</Typography>
                      <Typography variant="caption" sx={{ fontWeight: 700, color: r.color }}>{r.p}%</Typography>
                    </Box>
                    <LinearProgress variant="determinate" value={r.p}
                      sx={{ height: 5, borderRadius: 99, bgcolor: "grey.100", "& .MuiLinearProgress-bar": { bgcolor: r.color } }} />
                  </Box>
                ))}
              </Grid>
            </Grid>
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );
}

// ── SKU DataGrid ──────────────────────────────────────────────────────────────
function SKUDataTable({ data, onRowClick }) {
  const columns = [
    {
      field: "sku_id", headerName: "SKU", minWidth: 180, flex: 1,
      renderCell: p => (
        <Box>
          <Chip label={p.value} size="small" sx={{ fontFamily: "monospace", fontWeight: 700, bgcolor: C.orangeLight, color: C.orange, border: `1px solid ${C.orangeBorder}` }} />
          {p.row.parent && <Typography variant="caption" sx={{ display: "block", color: "text.disabled", mt: 0.25 }}>↳ {p.row.parent}</Typography>}
        </Box>
      ),
    },
    {
      field: "health", headerName: "Volume & Health", width: 200, sortable: false,
      renderCell: p => {
        const s = p.row;
        const del = s.delivered_count || 0, ret = s.return_count || 0, rto = s.rto_count || 0, can = s.cancelled_count || 0;
        const total = del + ret + rto + can;
        const dr = pct(del, total);
        return (
          <Box sx={{ py: 0.5, width: "100%" }}>
            <Box sx={{ display: "flex", gap: 1, fontSize: 12, mb: 0.5, flexWrap: "wrap" }}>
              {del > 0 && <span style={{ color: C.green, fontWeight: 600 }}>✅ {del}</span>}
              {ret > 0 && <span style={{ color: C.red, fontWeight: 600 }}>↩ {ret}</span>}
              {rto > 0 && <span style={{ color: C.amber, fontWeight: 600 }}>🔄 {rto}</span>}
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <LinearProgress variant="determinate" value={dr} sx={{
                flex: 1, height: 4, borderRadius: 99, bgcolor: "grey.100",
                "& .MuiLinearProgress-bar": { bgcolor: dr >= 70 ? C.green : dr >= 45 ? C.amber : C.red }
              }} />
              <Typography variant="caption" sx={{ fontWeight: 700, minWidth: 32 }}>{dr}%</Typography>
            </Box>
          </Box>
        );
      },
    },
    {
      field: "one_unit_price", headerName: "Cost", width: 120, type: "number",
      valueFormatter: ({ value }) => fmt(value),
      renderCell: p => <Typography variant="body2" sx={{ fontFamily: "monospace", color: "text.secondary" }}>{fmt(p.value)}</Typography>,
    },
    {
      field: "delivered_profit", headerName: "Delivered +", width: 130, type: "number",
      valueFormatter: ({ value }) => fmt(value),
      renderCell: p => p.value ? <Typography variant="body2" sx={{ fontFamily: "monospace", color: C.green, fontWeight: 600 }}>+{fmt(p.value)}</Typography> : <span style={{ color: "#CBD5E1" }}>—</span>,
    },
    {
      field: "total_loss", headerName: "Loss −", width: 120, type: "number",
      valueGetter: p => (p?.row?.return_loss || 0) + (p?.row?.rto_loss || 0),
      valueFormatter: ({ value }) => fmt(value),
      renderCell: p => p.value ? <Typography variant="body2" sx={{ fontFamily: "monospace", color: C.red, fontWeight: 600 }}>{fmt(p.value)}</Typography> : <span style={{ color: "#CBD5E1" }}>—</span>,
    },
    {
      field: "net_profit", headerName: "Net P&L", width: 150, type: "number",
      valueFormatter: ({ value }) => fmt(value),
      renderCell: p => {
        const pos = p.value >= 0;
        return (
          <Chip label={`${pos ? "+" : ""}${fmt(p.value)}`} size="small"
            sx={{
              fontFamily: "monospace", fontWeight: 800, fontSize: 13,
              bgcolor: pos ? C.greenLight : "#FFF1F2", color: pos ? C.green : C.red,
              border: `1px solid ${pos ? C.greenBorder : "#FECDD3"}`
            }} />
        );
      },
    },
    {
      field: "actions", headerName: "", width: 60, sortable: false,
      renderCell: p => (
        <Tooltip title="Monthly breakdown">
          <IconButton size="small" onClick={e => { e.stopPropagation(); onRowClick(p.row); }} sx={{ color: C.blue }}>
            📊
          </IconButton>
        </Tooltip>
      ),
    },
  ];

  return (
    <DataGrid
      rows={data}
      columns={columns}
      getRowId={r => r.sku_id}
      initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
      pageSizeOptions={[25, 50, 100]}
      onRowClick={p => onRowClick(p.row)}
      rowHeight={64}
      disableRowSelectionOnClick
      sx={{ border: "none", "& .MuiDataGrid-row:hover": { bgcolor: "#F5F3FF", cursor: "pointer" } }}
    />
  );
}

// ── Monthly drill-down modal ──────────────────────────────────────────────────
function SKUDetailModal({ sku, months, onClose }) {
  const [monthly, setMonthly] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const h = e => e.key === "Escape" && onClose();
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  useEffect(() => {
    setLoading(true);
    Promise.all(months.map(m =>
      fetch(`${API}/profit/?${new URLSearchParams(toRange(m))}`).then(r => r.json()).then(d => {
        const raw = (d.sku_wise_profit || {})[sku.sku_id] || {};
        return {
          month: m,
          net: Number(raw.net_profit ?? (Number(raw.delivered_profit || 0) + Number(raw.return_loss || 0))),
          del_pft: Number(raw.delivered_profit || 0),
          ret_loss: Number(raw.return_loss || 0),
          rto_loss: Number(raw.rto_loss || 0),
          claims: Number(raw.claims_total || 0),
          del: raw.delivered_count || 0, ret: raw.return_count || 0,
          rto: raw.rto_count || 0, ord: raw.order_count || 0,
        };
      }).catch(() => ({ month: m, net: 0, del_pft: 0, ret_loss: 0, rto_loss: 0, claims: 0, del: 0, ret: 0, rto: 0, ord: 0 }))
    )).then(res => { setMonthly(res.sort((a, b) => a.month.localeCompare(b.month))); setLoading(false); });
  }, []); // eslint-disable-line

  const tot = monthly.reduce((acc, m) => ({
    net: acc.net + m.net, del_pft: acc.del_pft + m.del_pft,
    ret_loss: acc.ret_loss + m.ret_loss, rto_loss: acc.rto_loss + m.rto_loss,
    claims: acc.claims + m.claims, del: acc.del + m.del,
    ret: acc.ret + m.ret, rto: acc.rto + m.rto, ord: acc.ord + m.ord,
  }), { net: 0, del_pft: 0, ret_loss: 0, rto_loss: 0, claims: 0, del: 0, ret: 0, rto: 0, ord: 0 });

  const chartData = monthly.map(m => ({
    month: fmtShort(m.month),
    "Delivered": m.del_pft,
    "Return": Math.abs(m.ret_loss),
    "RTO": Math.abs(m.rto_loss),
  }));

  return (
    <Dialog open maxWidth="md" fullWidth onClose={onClose}
      PaperProps={{ sx: { borderRadius: 4, maxHeight: "90vh" } }}>
      <DialogTitle sx={{ bgcolor: "grey.50", display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap", pb: 1.5 }}>
        <Chip label={sku.sku_id} sx={{ fontFamily: "monospace", fontWeight: 700, bgcolor: C.orangeLight, color: C.orange, border: `1px solid ${C.orangeBorder}` }} />
        <Box sx={{ display: "flex", gap: 1.5 }}>
          <Typography variant="body2" color="text.secondary">Cost <strong style={{ color: C.gray800, fontFamily: "monospace" }}>{fmt(sku.one_unit_price)}</strong></Typography>
          <Typography variant="body2" color="text.disabled">·</Typography>
          <Typography variant="body2" color="text.secondary">{months.length} months</Typography>
        </Box>
        <Box sx={{ flex: 1 }} />
        {!loading && (
          <Chip label={`${tot.net >= 0 ? "+" : ""}${fmt(tot.net)} total`}
            color={tot.net >= 0 ? "success" : "error"} sx={{ fontFamily: "monospace", fontWeight: 800, fontSize: 14 }} />
        )}
        <IconButton size="small" onClick={onClose}>✕</IconButton>
      </DialogTitle>

      <DialogContent sx={{ p: 3 }}>
        {loading ? (
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", py: 8, gap: 2 }}>
            <CircularProgress color="primary" />
            <Typography color="text.secondary">Loading {months.length} months…</Typography>
          </Box>
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {/* Summary grid */}
            <Grid container spacing={1.5}>
              {[
                { label: "Net P&L", value: tot.net, color: tot.net >= 0 ? C.green : C.red, sub: `${tot.ord} orders` },
                { label: "Delivered Profit", value: tot.del_pft, color: C.green, sub: `${tot.del} delivered` },
                { label: "Return Loss", value: tot.ret_loss, color: C.red, sub: `${tot.ret} returns` },
                { label: "RTO Loss", value: tot.rto_loss, color: C.amber, sub: `${tot.rto} RTOs` },
                { label: "Claims", value: tot.claims, color: C.blue, sub: "net received" },
              ].map(({ label, value, color, sub }) => (
                <Grid item xs={6} md="auto" key={label} sx={{ minWidth: 140 }}>
                  <Paper variant="outlined" sx={{ p: 1.5, bgcolor: "grey.50" }}>
                    <Typography variant="subtitle2" sx={{ mb: 0.25, fontSize: 10 }}>{label}</Typography>
                    <Typography variant="h6" sx={{ fontFamily: "monospace", fontWeight: 800, color }}>{fmt(value)}</Typography>
                    <Typography variant="caption">{sub}</Typography>
                  </Paper>
                </Grid>
              ))}
            </Grid>

            {/* P&L bar chart */}
            <Paper variant="outlined" sx={{ p: 2, bgcolor: "grey.50" }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Monthly Financial Breakdown</Typography>
              <BarChart
                dataset={chartData}
                xAxis={[{ scaleType: "band", dataKey: "month" }]}
                series={[
                  { dataKey: "Delivered", label: "Delivered +", color: C.green, stack: "a" },
                  { dataKey: "Return", label: "Return −", color: C.red, stack: "b" },
                  { dataKey: "RTO", label: "RTO −", color: C.amber, stack: "b" },
                ]}
                height={220} borderRadius={4}
                margin={{ left: 60, bottom: 30, right: 10, top: 10 }}
              />
            </Paper>

            {/* Monthly detail table */}
            <Box sx={{ overflowX: "auto" }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    {["Month", "✅ Del.", "↩ Ret.", "🔄 RTO", "Profit +", "Loss −", "Net P&L"].map(h => (
                      <TableCell key={h}>{h}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {monthly.map(m => {
                    const loss = m.ret_loss + m.rto_loss;
                    return (
                      <TableRow key={m.month}>
                        <TableCell sx={{ fontWeight: 600 }}>{fmtShort(m.month)}</TableCell>
                        <TableCell sx={{ color: C.green, fontFamily: "monospace" }}>{m.del || "—"}</TableCell>
                        <TableCell sx={{ color: C.red, fontFamily: "monospace" }}>{m.ret || "—"}</TableCell>
                        <TableCell sx={{ color: C.amber, fontFamily: "monospace" }}>{m.rto || "—"}</TableCell>
                        <TableCell sx={{ color: C.green, fontFamily: "monospace" }}>{m.del_pft !== 0 ? `+${fmt(m.del_pft)}` : "—"}</TableCell>
                        <TableCell sx={{ color: C.red, fontFamily: "monospace" }}>{loss !== 0 ? fmt(loss) : "—"}</TableCell>
                        <TableCell>
                          <Chip label={`${m.net >= 0 ? "+" : ""}${fmt(m.net)}`} size="small"
                            sx={{
                              fontFamily: "monospace", fontWeight: 700, fontSize: 12,
                              bgcolor: m.net >= 0 ? C.greenLight : "#FFF1F2",
                              color: m.net >= 0 ? C.green : C.red,
                              border: `1px solid ${m.net >= 0 ? C.greenBorder : "#FECDD3"}`
                            }} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Box>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Main tab ──────────────────────────────────────────────────────────────────
export function SKUAnalysisTab() {
  const [allData, setAllData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("all");
  const [selSKU, setSelSKU] = useState(null);
  const [months, setMonths] = useState([]);
  const [selMonth, setSelMonth] = useState(null);
  const [range, setRange] = useState(null);
  const [label, setLabel] = useState("All time");

  useEffect(() => {
    fetch(`${API}/profit/available-months/`).then(r => r.json()).then(ms => {
      setMonths(ms);
      if (ms.length > 0) { setSelMonth(ms[0]); setRange(toRange(ms[0])); setLabel(fmtMonth(ms[0])); }
      else { setRange({}); setLabel("All time"); }
    }).catch(() => { setRange({}); setLabel("All time"); });
  }, []);

  useEffect(() => {
    if (range === null) return;
    setLoading(true);
    const params = new URLSearchParams();
    if (range.date_from) params.set("date_from", range.date_from);
    if (range.date_to) params.set("date_to", range.date_to);
    fetch(`${API}/profit/?${params}`).then(r => r.json()).then(d => {
      const raw = d.sku_wise_profit || {};
      const prepared = Object.keys(raw).map(key => {
        const r = raw[key];
        return {
          sku_id: key, ...r,
          net_profit: Number(r.net_profit ?? (Number(r.delivered_profit || 0) + Number(r.return_loss || 0) + Number(r.rto_loss || 0))),
        };
      }).sort((a, b) => b.net_profit - a.net_profit);
      setAllData(prepared); setLoading(false);
    }).catch(() => setLoading(false));
  }, [JSON.stringify(range)]); // eslint-disable-line

  const profitRows = allData.filter(s => s.net_profit > 0);
  const lossRows = allData.filter(s => s.net_profit < 0).reverse();
  const viewData = view === "profit" ? profitRows : view === "loss" ? lossRows : allData;

  const chartData = [...allData].sort((a, b) => Math.abs(b.net_profit) - Math.abs(a.net_profit)).slice(0, 12);

  const handleFilter = (month, r) => {
    setSelMonth(month); setRange(r);
    setLabel(month === null ? "All time" : month === "custom" ? `${r.date_from} → ${r.date_to}` : fmtMonth(month));
  };

  const VIEWS = [
    { id: "all", label: "All", count: allData.length },
    { id: "profit", label: "Profitable", count: profitRows.length },
    { id: "loss", label: "Loss", count: lossRows.length },
  ];

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1.5 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800, mb: 0.25 }}>SKU P&L Analysis</Typography>
          <Typography variant="body2" color="text.secondary">Settled orders · {label}</Typography>
        </Box>
        <ButtonGroup size="small" variant="outlined">
          {VIEWS.map(({ id, label: l, count }) => (
            <Button key={id} onClick={() => setView(id)}
              variant={view === id ? "contained" : "outlined"} disableElevation
              color={id === "loss" ? "error" : id === "profit" ? "success" : "primary"}
              sx={{ fontWeight: view === id ? 700 : 500 }}>
              {l} <Chip label={count} size="small" sx={{ ml: 0.75, height: 18, fontSize: 10, bgcolor: "rgba(255,255,255,0.3)", color: "inherit" }} />
            </Button>
          ))}
        </ButtonGroup>
      </Box>

      {/* Month filter */}
      <MonthFilter months={months} selMonth={selMonth} onSelect={handleFilter} />

      {/* Loading */}
      {loading && (
        <Card elevation={1} sx={{ textAlign: "center", py: 8 }}>
          <CircularProgress color="primary" sx={{ mb: 2 }} />
          <Typography color="text.secondary">Loading SKU analysis… {label}</Typography>
        </Card>
      )}

      {!loading && allData.length === 0 && (
        <Card elevation={1} sx={{ textAlign: "center", py: 8 }}>
          <Typography variant="h3" sx={{ mb: 1 }}>📭</Typography>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>No data for {label}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>No settled orders with pricing found.</Typography>
        </Card>
      )}

      {!loading && allData.length > 0 && <>
        <MetricsPanel data={allData} filterLabel={label} />

        {/* Top SKUs chart */}
        {chartData.length > 0 && (
          <Card elevation={1}>
            <CardContent>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Top {chartData.length} SKUs by Absolute Impact</Typography>
              <BarChart
                dataset={chartData}
                xAxis={[{
                  scaleType: "band", dataKey: "sku_id",
                  tickLabelStyle: { fontSize: 10 }, tickLabelPlacement: "tick",
                  colorMap: {
                    type: "ordinal",
                    values: chartData.map(d => d.sku_id),
                    colors: chartData.map(d => d.net_profit >= 0 ? C.green : C.red),
                  },
                }]}
                series={[{ dataKey: "net_profit", label: "Net P&L", valueFormatter: v => fmt(v) }]}
                height={220} borderRadius={6}
                margin={{ left: 70, bottom: 60, right: 10, top: 10 }}
                slotProps={{ legend: { hidden: true } }}
                onAxisClick={(_, d) => { const sku = allData.find(s => s.sku_id === d?.axisValue); if (sku) setSelSKU(sku); }}
              />
            </CardContent>
          </Card>
        )}

        {/* SKU DataGrid */}
        <Card elevation={1}>
          <CardContent sx={{ pb: 0 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {viewData.length} SKUs · click any row for monthly breakdown
            </Typography>
          </CardContent>
          <SKUDataTable data={viewData} onRowClick={setSelSKU} />
        </Card>
      </>}

      {selSKU && <SKUDetailModal sku={selSKU} months={months} onClose={() => setSelSKU(null)} />}
    </Box>
  );
}
