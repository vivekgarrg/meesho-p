import React, { useState, useEffect, useCallback } from "react";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";
import ButtonGroup from "@mui/material/ButtonGroup";
import Chip from "@mui/material/Chip";
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
  const netPL     = data.reduce((a, s) => a + s.net_profit, 0);
  const delPft    = data.reduce((a, s) => a + (s.delivered_profit || 0), 0);
  const retLoss   = data.reduce((a, s) => a + (s.return_loss      || 0), 0);
  const rtoLoss   = data.reduce((a, s) => a + (s.rto_loss         || 0), 0);
  const exchNet   = data.reduce((a, s) => a + (s.exchange_net     || 0), 0);
  const claimLoss = data.reduce((a, s) => a + (s.claim_loss       || 0), 0);
  const otherNet  = data.reduce((a, s) => a + (s.other_net        || 0), 0);
  const nDel      = data.reduce((a, s) => a + (s.delivered_count  || 0), 0);
  const nRet      = data.reduce((a, s) => a + (s.return_count     || 0), 0);
  const nRTO      = data.reduce((a, s) => a + (s.rto_count        || 0), 0);
  const nExchange = data.reduce((a, s) => a + (s.exchange_count   || 0), 0);
  const nClaim    = data.reduce((a, s) => a + (s.claim_count      || 0), 0);
  const nOther    = data.reduce((a, s) => a + (s.other_count      || 0), 0);
  const nTotal    = nDel + nRet + nRTO + nExchange + nClaim;
  const nProfit = data.filter(s => s.net_profit > 0).length;
  const nLoss = data.filter(s => s.net_profit < 0).length;
  const pos = netPL >= 0;

  return (
    <Card elevation={1} sx={{ overflow: "hidden" }}>
      <Box sx={{ height: 3, background: `linear-gradient(90deg, ${pos ? C.green : C.red}, ${C.orange})` }} />
      <CardContent>
        <Box sx={{ display: "flex", gap: 3, flexWrap: "wrap", alignItems: "flex-start" }}>

          {/* Net P&L hero */}
          <Box sx={{ pr: 3, borderRight: `1px solid #E2E8F0`, minWidth: 160 }}>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Net P&L · {filterLabel}</Typography>
            <Typography variant="h3" sx={{ fontFamily: "monospace", fontWeight: 900, color: pos ? C.green : C.red, lineHeight: 1.1 }}>
              {pos ? "+" : ""}{fmt(netPL)}
            </Typography>
            <Box sx={{ display: "flex", gap: 1, mt: 1, flexWrap: "wrap" }}>
              {nProfit > 0 && <Chip label={`${nProfit} profitable`} color="success" size="small" />}
              {nLoss > 0 && <Chip label={`${nLoss} in loss`} color="error" size="small" />}
            </Box>
          </Box>

          {/* Breakdown amounts */}
          <Box sx={{ display: "flex", gap: 2.5, flexWrap: "wrap", flex: 1 }}>
            {[
              { label: "Delivered",   value: fmt(delPft),    color: C.green,   sub: `${nDel} orders` },
              { label: "Return",      value: fmt(retLoss),   color: C.red,     sub: `${nRet} pure (−pkg)` },
              { label: "RTO",         value: fmt(rtoLoss),   color: C.amber,   sub: `${nRTO} pure (−pkg)` },
              ...(nExchange > 0 ? [{ label: "Exchange",  value: fmt(exchNet),   color: C.blue,    sub: `${nExchange} (−2×pkg)` }] : []),
              { label: "Claim",       value: fmt(claimLoss), color: "#7C3AED", sub: `${nClaim} (−item cost)` },
              ...(otherNet !== 0 ? [{ label: "Other ±",  value: fmt(otherNet), color: otherNet >= 0 ? C.gray600 : C.red, sub: `${nOther} cancelled/adj` }] : []),
            ].map(m => (
              <Box key={m.label} sx={{ minWidth: 110 }}>
                <Typography variant="subtitle2" sx={{ mb: 0.25, fontSize: 11 }}>{m.label}</Typography>
                <Typography variant="h6" sx={{ fontFamily: "monospace", fontWeight: 800, color: m.color }}>{m.value}</Typography>
                <Typography variant="caption">{m.sub}</Typography>
              </Box>
            ))}
          </Box>

          {/* Rate bars */}
          <Box sx={{ minWidth: 200 }}>
            <Typography variant="subtitle2" sx={{ mb: 1, fontSize: 11 }}>Order Rates ({nTotal} total)</Typography>
            {[
              { label: "Delivered", p: pct(nDel,      nTotal), color: C.green },
              { label: "Pure Returns", p: pct(nRet,   nTotal), color: C.red },
              { label: "Pure RTO",  p: pct(nRTO,      nTotal), color: C.amber },
              ...(nExchange > 0 ? [{ label: "Exchange", p: pct(nExchange, nTotal), color: C.blue }] : []),
              { label: "Claims",    p: pct(nClaim,    nTotal), color: "#7C3AED" },
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
          </Box>

        </Box>

        {/* ── P&L Reconciliation ─────────────────────────────────────────── */}
        {(() => {
          const computed = delPft + retLoss + rtoLoss + exchNet + claimLoss;
          const diff = Math.abs(netPL - computed);
          const match = diff < 0.01;
          return (
            <Box sx={{ mt: 2, pt: 1.5, borderTop: "1px dashed #E2E8F0", display: "flex", gap: 3, flexWrap: "wrap", alignItems: "center" }}>
              <Typography variant="caption" color="text.disabled" sx={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                SKU P&L Check
              </Typography>
              <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", flex: 1 }}>
                {[
                  { label: "Σ net_profit (backend)", value: netPL },
                  { label: "Delivered", value: delPft },
                  { label: "+ Return",  value: retLoss },
                  { label: "+ RTO",     value: rtoLoss },
                  ...(nExchange > 0 ? [{ label: "+ Exchange", value: exchNet }] : []),
                  { label: "+ Claim",   value: claimLoss },
                  { label: "= Computed", value: computed },
                ].map(({ label, value }) => (
                  <Box key={label}>
                    <Typography variant="caption" color="text.disabled" display="block">{label}</Typography>
                    <Typography variant="body2" sx={{ fontFamily: "monospace", fontWeight: 700, color: value >= 0 ? C.green : C.red }}>
                      {value >= 0 ? "+" : ""}{fmt(value)}
                    </Typography>
                  </Box>
                ))}
              </Box>
              <Chip
                label={match ? `✅ Match` : `⚠️ Off by ${fmt(diff)}`}
                size="small"
                color={match ? "success" : "warning"}
                sx={{ fontWeight: 700 }}
              />
            </Box>
          );
        })()}
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
        const del = s.delivered_count || 0, ret = s.return_count || 0, rto = s.rto_count || 0;
        const claim = s.claim_count || 0, can = s.cancelled_count || 0;
        const total = del + ret + rto + claim + can;
        const dr = pct(del, total);
        return (
          <Box sx={{ py: 0.5, width: "100%" }}>
            <Box sx={{ display: "flex", gap: 1, fontSize: 12, mb: 0.5, flexWrap: "wrap" }}>
              {del   > 0 && <span style={{ color: C.green,    fontWeight: 600 }}>✅ {del}</span>}
              {ret   > 0 && <span style={{ color: C.red,      fontWeight: 600 }}>↩ {ret}</span>}
              {rto   > 0 && <span style={{ color: C.amber,    fontWeight: 600 }}>🔄 {rto}</span>}
              {claim > 0 && <span style={{ color: "#7C3AED",  fontWeight: 700, background: "#F5F3FF", padding: "0 5px", borderRadius: 6 }}>⚠ {claim} claim</span>}
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
      valueFormatter: value => fmt(value),
      renderCell: p => <Typography variant="body2" sx={{ fontFamily: "monospace", color: "text.secondary" }}>{fmt(p.value)}</Typography>,
    },
    {
      field: "avg_profit_per_piece", headerName: "Avg Profit/pc", width: 130, type: "number",
      valueFormatter: value => value != null ? fmt(value) : "—",
      renderCell: p => {
        if (p.value == null) return <span style={{ color: "#CBD5E1" }}>—</span>;
        const pos = p.value >= 0;
        return (
          <Typography variant="body2" sx={{ fontFamily: "monospace", fontWeight: 700, color: pos ? C.green : C.red }}>
            {pos ? "+" : ""}{fmt(p.value)}
          </Typography>
        );
      },
    },
    {
      field: "delivered_profit", headerName: "Delivered +", width: 130, type: "number",
      valueFormatter: value => fmt(value),
      renderCell: p => p.value ? <Typography variant="body2" sx={{ fontFamily: "monospace", color: C.green, fontWeight: 600 }}>+{fmt(p.value)}</Typography> : <span style={{ color: "#CBD5E1" }}>—</span>,
    },
    {
      field: "claims_total", headerName: "Claims ₹", width: 110, type: "number",
      valueFormatter: value => fmt(value),
      renderCell: p => {
        const n = Number(p.value || 0);
        return n > 0
          ? <Typography variant="body2" sx={{ fontFamily: "monospace", color: C.blue, fontWeight: 600 }}>+{fmt(n)}</Typography>
          : <span style={{ color: "#CBD5E1" }}>—</span>;
      },
    },
    {
      field: "net_profit", headerName: "Net P&L", width: 150, type: "number",
      valueFormatter: value => fmt(value),
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
          other_net: Number(raw.other_net || 0),
          pkg_cost: Number(raw.total_packaging_cost || 0),
          tax_cost: Number(raw.total_tax_cost || 0),
          del: raw.delivered_count || 0,
          ret: raw.return_count || 0,
          rto: raw.rto_count || 0,
          other: raw.other_count || 0,
          ord: raw.order_count || 0,
        };
      }).catch(() => ({ month: m, net: 0, del_pft: 0, ret_loss: 0, rto_loss: 0, claims: 0, del: 0, ret: 0, rto: 0, ord: 0 }))
    )).then(res => { setMonthly(res.sort((a, b) => a.month.localeCompare(b.month))); setLoading(false); });
  }, []); // eslint-disable-line

  const tot = monthly.reduce((acc, m) => ({
    net: acc.net + m.net,
    del_pft: acc.del_pft + m.del_pft,
    ret_loss: acc.ret_loss + m.ret_loss,
    rto_loss: acc.rto_loss + m.rto_loss,
    other_net: acc.other_net + m.other_net,
    pkg_cost: acc.pkg_cost + m.pkg_cost,
    tax_cost: acc.tax_cost + m.tax_cost,
    del: acc.del + m.del, ret: acc.ret + m.ret,
    rto: acc.rto + m.rto, other: acc.other + m.other, ord: acc.ord + m.ord,
  }), { net: 0, del_pft: 0, ret_loss: 0, rto_loss: 0, other_net: 0, pkg_cost: 0, tax_cost: 0, del: 0, ret: 0, rto: 0, other: 0, ord: 0 });

  const totOrds = tot.del + tot.ret + tot.rto;
  const delRate = totOrds > 0 ? Math.round(tot.del / totOrds * 100) : 0;
  const retRate = totOrds > 0 ? Math.round(tot.ret / totOrds * 100) : 0;
  const rtoRate = totOrds > 0 ? Math.round(tot.rto / totOrds * 100) : 0;

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
            {/* Summary cards */}
            <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}>
              {[
                { label: "Net P&L", value: tot.net, color: tot.net >= 0 ? C.green : C.red, sub: `${tot.ord} orders` },
                { label: "Delivered Profit", value: tot.del_pft, color: C.green, sub: `${tot.del} delivered` },
                { label: "Return Loss", value: tot.ret_loss, color: C.red, sub: `${tot.ret} returns` },
                { label: "RTO Loss", value: tot.rto_loss, color: C.amber, sub: `${tot.rto} RTOs` },
                { label: "Other ±", value: tot.other_net, color: tot.other_net >= 0 ? C.gray600 : C.red, sub: `${tot.other} orders (cancelled/adj)` },
                { label: "Packaging Cost", value: -tot.pkg_cost, color: C.red, sub: "total packaging paid" },
                { label: "Tax (GST) Cost", value: -tot.tax_cost, color: C.amber, sub: "GST on item price" },
              ].map(({ label, value, color, sub }) => (
                <Paper key={label} variant="outlined" sx={{ p: 1.5, bgcolor: "grey.50", flex: "1 1 130px" }}>
                  <Typography variant="subtitle2" sx={{ mb: 0.25, fontSize: 10 }}>{label}</Typography>
                  <Typography variant="h6" sx={{ fontFamily: "monospace", fontWeight: 800, color }}>{fmt(value)}</Typography>
                  <Typography variant="caption">{sub}</Typography>
                </Paper>
              ))}
            </Box>

            {/* Outcome rates + return/rto loss detail */}
            <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}>
              <Paper variant="outlined" sx={{ p: 1.5, bgcolor: "grey.50", flex: "1 1 180px" }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                  Order Outcome Rates ({totOrds} orders)
                </Typography>
                {[
                  { label: "Delivery", p: delRate, color: C.green },
                  { label: "Return %", p: retRate, color: C.red },
                  { label: "RTO %", p: rtoRate, color: C.amber },
                ].map(r => (
                  <Box key={r.label} sx={{ mb: 0.75 }}>
                    <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.25 }}>
                      <Typography variant="caption">{r.label}</Typography>
                      <Typography variant="caption" sx={{ fontWeight: 800, color: r.color }}>{r.p}%</Typography>
                    </Box>
                    <LinearProgress variant="determinate" value={r.p}
                      sx={{ height: 6, borderRadius: 99, bgcolor: "grey.200", "& .MuiLinearProgress-bar": { bgcolor: r.color } }} />
                  </Box>
                ))}
              </Paper>
              <Paper variant="outlined" sx={{ p: 1.5, bgcolor: "grey.50", flex: "1 1 130px" }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>Return Loss</Typography>
                <Typography variant="h6" sx={{ fontFamily: "monospace", color: C.red, fontWeight: 800 }}>{fmt(tot.ret_loss)}</Typography>
                <Typography variant="caption">{tot.ret} returns · {retRate}% rate</Typography>
              </Paper>
              <Paper variant="outlined" sx={{ p: 1.5, bgcolor: "grey.50", flex: "1 1 130px" }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>RTO Loss</Typography>
                <Typography variant="h6" sx={{ fontFamily: "monospace", color: C.amber, fontWeight: 800 }}>{fmt(tot.rto_loss)}</Typography>
                <Typography variant="caption">{tot.rto} RTOs · {rtoRate}% rate</Typography>
              </Paper>
            </Box>

            {/* P&L bar chart */}
            <Paper variant="outlined" sx={{ p: 2, bgcolor: "grey.50" }}>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Monthly Financial Breakdown</Typography>
              <Typography variant="caption" sx={{ display: "block", mb: 1, color: "text.secondary" }}>
                Return rate: <strong style={{ color: C.red }}>{retRate}%</strong>
                &nbsp;·&nbsp; RTO rate: <strong style={{ color: C.amber }}>{rtoRate}%</strong>
                &nbsp;·&nbsp; Delivery rate: <strong style={{ color: C.green }}>{delRate}%</strong>
              </Typography>
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
                    {["Month", "✅ Del.", "↩ Ret.", "🔄 RTO", "Profit +", "Loss −", "Other ±", "Packaging", "Tax (GST)", "Net P&L"].map(h => (
                      <TableCell key={h} sx={{ fontWeight: 700, fontSize: 11 }}>{h}</TableCell>
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
                        <TableCell sx={{ color: m.other_net >= 0 ? C.gray600 : C.red, fontFamily: "monospace" }}>
                          {m.other_net !== 0 ? `${m.other_net >= 0 ? "+" : ""}${fmt(m.other_net)}` : "—"}
                        </TableCell>
                        <TableCell sx={{ color: C.red, fontFamily: "monospace" }}>
                          {m.pkg_cost > 0 ? `−${fmt(m.pkg_cost)}` : "—"}
                        </TableCell>
                        <TableCell sx={{ color: C.amber, fontFamily: "monospace" }}>
                          {m.tax_cost > 0 ? `−${fmt(m.tax_cost)}` : "—"}
                        </TableCell>
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

// ── Low Margin Analysis Panel ─────────────────────────────────────────────────
const THRESHOLDS = [20, 30, 40, 50, 100];

function LowMarginPanel({ rows, threshold, setThreshold, onRowClick }) {
  const totalProfit = rows.reduce((a, s) => a + (s.delivered_profit || 0), 0);
  const totalQty = rows.reduce((a, s) => a + (s.delivered_quantity || 0), 0);
  const totalNetPL = rows.reduce((a, s) => a + s.net_profit, 0);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {/* Threshold selector */}
      <Paper elevation={1} sx={{ p: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
          Show SKUs where avg profit per piece is less than:
        </Typography>
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center" }}>
          {THRESHOLDS.map(t => (
            <Button key={t} size="small"
              variant={threshold === t ? "contained" : "outlined"} disableElevation
              color="warning"
              onClick={() => setThreshold(t)}
              sx={{ borderRadius: 20, fontWeight: threshold === t ? 700 : 400, minWidth: 64, fontFamily: "monospace" }}>
              &lt; ₹{t}
            </Button>
          ))}
          <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
            Formula: delivered_profit ÷ units_delivered
          </Typography>
        </Box>
      </Paper>

      {/* Summary strip */}
      <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}>
        {[
          { label: `SKUs flagged (< ₹${threshold}/piece)`, value: rows.length, color: "#D97706" },
          { label: "Total units delivered", value: totalQty.toLocaleString("en-IN"), color: "#2563EB" },
          { label: "Combined delivered profit", value: fmt(totalProfit), color: totalProfit >= 0 ? "#059669" : "#E11D48" },
          { label: "Net P&L (incl. returns)", value: fmt(totalNetPL), color: totalNetPL >= 0 ? "#059669" : "#E11D48" },
        ].map(item => (
          <Paper key={item.label} variant="outlined" sx={{ p: 1.5, flex: "1 1 150px", bgcolor: "grey.50" }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>{item.label}</Typography>
            <Typography variant="h6" sx={{ fontFamily: "monospace", fontWeight: 800, color: item.color }}>{item.value}</Typography>
          </Paper>
        ))}
      </Box>

      {rows.length === 0 ? (
        <Paper elevation={1} sx={{ textAlign: "center", py: 6 }}>
          <Typography variant="h4" sx={{ mb: 1 }}>✅</Typography>
          <Typography variant="h6" fontWeight={700}>No SKUs below ₹{threshold}/piece</Typography>
          <Typography variant="body2" color="text.secondary">All SKUs with delivered orders are earning more than ₹{threshold} per piece.</Typography>
        </Paper>
      ) : (
        <Paper elevation={1} sx={{ overflow: "hidden" }}>
          {/* Table header */}
          <Box sx={{ display: "flex", bgcolor: "grey.100", borderBottom: "1px solid #E2E8F0", px: 2, py: 1, gap: 1 }}>
            {["SKU", "Unit Cost (₹)", "Avg Settle/Pc", "Avg Profit/Pc", "Units Sold", "Del. Profit", "Return Rate", "Net P&L"].map((h, i) => (
              <Typography key={h} variant="caption" sx={{
                fontWeight: 700, color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.05em",
                flex: i === 0 ? "1 1 140px" : i === 3 ? "0 0 130px" : "1 1 90px",
                textAlign: i >= 1 ? "right" : "left",
              }}>{h}</Typography>
            ))}
            <Box sx={{ width: 36 }} />
          </Box>

          {/* Rows */}
          {rows.map((s) => {
            const avg = s.avg_profit_per_piece;
            const avgs = s.avg_settlement_per_piece;
            const cost = Number(s.one_unit_price || 0);
            const qty = Number(s.delivered_quantity || 0);
            const dPft = Number(s.delivered_profit || 0);
            const nDel = Number(s.delivered_count || 0);
            const nRet = Number(s.return_count || 0);
            const nRTO = Number(s.rto_count || 0);
            const tot = nDel + nRet + nRTO;
            const retRt = tot > 0 ? Math.round((nRet + nRTO) / tot * 100) : 0;
            const netPL = s.net_profit;
            // Gap to ₹50 threshold (for visual)
            const gap = threshold - avg;
            // Color scale based on how far below threshold
            const pctOfThresh = avg / threshold;
            const rowColor = pctOfThresh < 0.4 ? "#FFF1F2" : pctOfThresh < 0.7 ? "#FFFBEB" : "#F0FDF4";

            return (
              <Box key={s.sku_id} onClick={() => onRowClick(s)}
                sx={{
                  display: "flex", alignItems: "center", px: 2, py: 1.25, gap: 1,
                  bgcolor: rowColor,
                  borderBottom: "1px solid #F1F5F9",
                  cursor: "pointer", "&:hover": { filter: "brightness(0.96)" },
                  transition: "filter 0.15s",
                }}>
                {/* SKU */}
                <Box sx={{ flex: "1 1 140px" }}>
                  <Chip label={s.sku_id} size="small"
                    sx={{ fontFamily: "monospace", fontWeight: 700, bgcolor: "#F5F3FF", color: "#6D28D9", border: "1px solid #C4B5FD", maxWidth: "100%" }} />
                  <Typography variant="caption" sx={{ display: "block", color: "text.disabled", mt: 0.25 }}>{nDel} del orders</Typography>
                </Box>

                {/* Unit cost */}
                <Typography variant="body2" sx={{ fontFamily: "monospace", flex: "1 1 90px", textAlign: "right", color: "#64748B" }}>
                  {fmt(cost)}
                </Typography>

                {/* Avg settlement / piece */}
                <Typography variant="body2" sx={{ fontFamily: "monospace", flex: "1 1 90px", textAlign: "right", color: "#2563EB" }}>
                  {avgs !== null ? fmt(avgs) : "—"}
                </Typography>

                {/* Avg profit / piece — KEY COLUMN */}
                <Box sx={{ flex: "0 0 130px", textAlign: "right" }}>
                  <Typography variant="body2" sx={{
                    fontFamily: "monospace", fontWeight: 800, fontSize: 14,
                    color: avg < 0 ? "#E11D48" : avg < threshold * 0.5 ? "#D97706" : "#059669",
                  }}>
                    {avg < 0 ? "" : "+"}{fmt(avg)}
                  </Typography>
                  <Typography variant="caption" sx={{ color: "#94A3B8" }}>
                    ₹{gap.toFixed(0)} below ₹{threshold}
                  </Typography>
                </Box>

                {/* Units sold */}
                <Typography variant="body2" sx={{ fontFamily: "monospace", flex: "1 1 90px", textAlign: "right" }}>
                  {qty}
                </Typography>

                {/* Delivered profit */}
                <Typography variant="body2" sx={{ fontFamily: "monospace", flex: "1 1 90px", textAlign: "right", color: dPft >= 0 ? "#059669" : "#E11D48" }}>
                  {fmt(dPft)}
                </Typography>

                {/* Return rate */}
                <Box sx={{ flex: "1 1 90px", textAlign: "right" }}>
                  <Typography variant="body2" sx={{ fontFamily: "monospace", color: retRt > 30 ? "#E11D48" : retRt > 15 ? "#D97706" : "#64748B" }}>
                    {retRt}%
                  </Typography>
                  <Typography variant="caption" color="text.disabled">{nRet + nRTO} back</Typography>
                </Box>

                {/* Net P&L */}
                <Chip label={`${netPL >= 0 ? "+" : ""}${fmt(netPL)}`} size="small"
                  sx={{
                    flex: "1 1 90px", fontFamily: "monospace", fontWeight: 700, fontSize: 12,
                    bgcolor: netPL >= 0 ? "#ECFDF5" : "#FFF1F2",
                    color: netPL >= 0 ? "#059669" : "#E11D48",
                    border: `1px solid ${netPL >= 0 ? "#A7F3D0" : "#FECDD3"}`,
                  }} />

                {/* Detail button */}
                <Tooltip title="Monthly breakdown">
                  <IconButton size="small" sx={{ color: "#2563EB", width: 36 }}>📊</IconButton>
                </Tooltip>
              </Box>
            );
          })}
        </Paper>
      )}
    </Box>
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
  const [marginThreshold, setMarginThreshold] = useState(50);

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
        const delPft = Number(r.delivered_profit || 0);
        const delQty = Number(r.delivered_quantity || 0);
        const delCost = Number(r.delivered_purchase_cost || 0);
        // avg profit per delivered unit: (settlement - purchase_cost) / qty
        const avg_profit_per_piece = delQty > 0 ? delPft / delQty : null;
        // avg settlement per unit (gross, before deducting item cost)
        const avg_settlement_per_piece = delQty > 0 ? (delPft + delCost) / delQty : null;
        return {
          sku_id: key, ...r,
          net_profit: Number(r.net_profit ?? (delPft + Number(r.return_loss || 0) + Number(r.rto_loss || 0) + Number(r.exchange_net || 0) + Number(r.claim_loss || 0))),
          avg_profit_per_piece,
          avg_settlement_per_piece,
        };
      }).sort((a, b) => b.net_profit - a.net_profit);
      setAllData(prepared); setLoading(false);
    }).catch(() => setLoading(false));
  }, [JSON.stringify(range)]); // eslint-disable-line

  const profitRows = allData.filter(s => s.net_profit > 0);
  const lossRows = allData.filter(s => s.net_profit < 0).reverse();
  const lowMarginRows = allData
    .filter(s => s.avg_profit_per_piece !== null && s.avg_profit_per_piece < marginThreshold && (s.delivered_quantity || 0) > 0)
    .sort((a, b) => a.avg_profit_per_piece - b.avg_profit_per_piece);

  const viewData = view === "profit" ? profitRows
    : view === "loss" ? lossRows
      : view === "low-margin" ? lowMarginRows
        : allData;

  const chartData = [...allData].sort((a, b) => Math.abs(b.net_profit) - Math.abs(a.net_profit)).slice(0, 12);

  const handleFilter = (month, r) => {
    setSelMonth(month); setRange(r);
    setLabel(month === null ? "All time" : month === "custom" ? `${r.date_from} → ${r.date_to}` : fmtMonth(month));
  };

  const VIEWS = [
    { id: "all", label: "All", count: allData.length, color: "primary" },
    { id: "profit", label: "Profitable", count: profitRows.length, color: "success" },
    { id: "loss", label: "Loss", count: lossRows.length, color: "error" },
    { id: "low-margin", label: "Low Margin", count: lowMarginRows.length, color: "warning" },
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
          {VIEWS.map(({ id, label: l, count, color }) => (
            <Button key={id} onClick={() => setView(id)}
              variant={view === id ? "contained" : "outlined"} disableElevation color={color}
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

        {/* Low Margin Panel */}
        {view === "low-margin" && (
          <LowMarginPanel
            rows={lowMarginRows}
            threshold={marginThreshold}
            setThreshold={setMarginThreshold}
            onRowClick={setSelSKU}
          />
        )}

        {/* SKU DataGrid (for all / profit / loss views) */}
        {view !== "low-margin" && (
          <Card elevation={1}>
            <CardContent sx={{ pb: 0 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {viewData.length} SKUs · click any row for monthly breakdown
              </Typography>
            </CardContent>
            <SKUDataTable data={viewData} onRowClick={setSelSKU} />
          </Card>
        )}
      </>}

      {selSKU && <SKUDetailModal sku={selSKU} months={months} onClose={() => setSelSKU(null)} />}
    </Box>
  );
}
