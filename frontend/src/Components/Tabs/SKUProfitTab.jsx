import React, { useState, useEffect, useCallback, useRef } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import CircularProgress from "@mui/material/CircularProgress";
import TextField from "@mui/material/TextField";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import Tooltip from "@mui/material/Tooltip";
import Table from "@mui/material/Table";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableCell from "@mui/material/TableCell";
import TableBody from "@mui/material/TableBody";
import Alert from "@mui/material/Alert";
import Collapse from "@mui/material/Collapse";
import { DataGrid } from "@mui/x-data-grid";
import { AppBarChart } from "../Charts/AppBarChart";
import { AppPieChart } from "../Charts/AppPieChart";
import { API, fmt } from "../../App";
import { useDateFilter } from "../../contexts/DateFilterContext";

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

// ── Design tokens ─────────────────────────────────────────────────────────────
const DS = {
  card: {
    background: "#fff",
    border: "1px solid #E8EDF3",
    borderRadius: "14px",
    boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
  },
  label: {
    fontSize: 10, fontWeight: 700,
    textTransform: "uppercase", letterSpacing: "0.08em", color: "#94A3B8",
  },
};

const STATUS = {
  delivered: { icon: "✅", color: "#059669", bg: "#ECFDF5", border: "#A7F3D0", label: "Delivered" },
  return: { icon: "↩", color: "#DC2626", bg: "#FFF1F2", border: "#FECDD3", label: "Return" },
  rto: { icon: "🔄", color: "#D97706", bg: "#FFFBEB", border: "#FDE68A", label: "RTO" },
  exchange: { icon: "🔁", color: "#2563EB", bg: "#EFF6FF", border: "#BFDBFE", label: "Exchange" },
  claim: { icon: "⚠", color: "#7C3AED", bg: "#F5F3FF", border: "#DDD6FE", label: "Claim" },
  other: { icon: "⊘", color: "#64748B", bg: "#F8FAFC", border: "#E2E8F0", label: "Other" },
};

// ── Reusable atoms ─────────────────────────────────────────────────────────────
function SectionLabel({ children, sx }) {
  return <Typography sx={{ ...DS.label, mb: 1.5, ...sx }}>{children}</Typography>;
}

function PLChip({ value, large }) {
  const pos = value >= 0;
  return (
    <Chip
      label={`${pos ? "+" : ""}${fmt(value)}`}
      size="small"
      sx={{
        fontFamily: "monospace", fontWeight: 800, fontSize: large ? 14 : 12,
        bgcolor: pos ? "#ECFDF5" : "#FFF1F2",
        color: pos ? "#059669" : "#E11D48",
        border: `1px solid ${pos ? "#A7F3D0" : "#FECDD3"}`,
      }}
    />
  );
}

// ── Month filter ──────────────────────────────────────────────────────────────
function MonthFilter({ months, selMonth, onSelect }) {
  const [showCustom, setShowCustom] = useState(false);
  const [cf, setCf] = useState("");
  const [ct, setCt] = useState("");

  return (
    <Box sx={{ ...DS.card, p: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
        <Typography sx={{ ...DS.label, mr: 0.5 }}>Period</Typography>

        {/* All time */}
        <Chip label="All time" size="small" onClick={() => onSelect(null, {})}
          sx={{
            borderRadius: "8px", fontWeight: selMonth === null ? 700 : 500, fontSize: 12,
            bgcolor: selMonth === null ? "#1E3A5F" : "transparent",
            color: selMonth === null ? "#fff" : "#64748B",
            border: selMonth === null ? "1.5px solid #1E3A5F" : "1px solid #E2E8F0",
          }} />

        <Box sx={{ width: 1, height: 18, bgcolor: "#E2E8F0", mx: 0.5 }} />

        {/* Month chips */}
        {months.slice(0, 12).map(m => {
          const active = selMonth === m;
          return (
            <Chip key={m} label={fmtShort(m)} size="small" onClick={() => onSelect(m, toRange(m))}
              sx={{
                borderRadius: "8px", fontWeight: active ? 700 : 400, fontSize: 12,
                bgcolor: active ? "#2563EB" : "transparent",
                color: active ? "#fff" : "#475569",
                border: active ? "1.5px solid #2563EB" : "1px solid #E2E8F0",
              }} />
          );
        })}

        <Chip label={`Custom${showCustom ? " ▲" : " ▼"}`} size="small"
          onClick={() => setShowCustom(s => !s)}
          sx={{
            borderRadius: "8px", fontSize: 12,
            bgcolor: showCustom ? "#EFF6FF" : "transparent",
            color: showCustom ? "#2563EB" : "#64748B",
            border: `1px solid ${showCustom ? "#2563EB" : "#E2E8F0"}`,
          }} />
      </Box>

      {showCustom && (
        <Box sx={{ display: "flex", gap: 1.5, alignItems: "center", mt: 1.5, flexWrap: "wrap" }}>
          <Typography variant="caption" color="text.secondary">From</Typography>
          <TextField size="small" type="date" value={cf} onChange={e => setCf(e.target.value)}
            sx={{ width: 150, "& .MuiOutlinedInput-root": { borderRadius: "8px", fontSize: 13 } }} />
          <Typography variant="caption" color="text.secondary">→</Typography>
          <TextField size="small" type="date" value={ct} onChange={e => setCt(e.target.value)}
            sx={{ width: 150, "& .MuiOutlinedInput-root": { borderRadius: "8px", fontSize: 13 } }} />
          <Button size="small" variant="contained" disableElevation
            disabled={!cf || !ct}
            onClick={() => { if (cf && ct) { onSelect("custom", { date_from: cf, date_to: ct }); setShowCustom(false); } }}
            sx={{ borderRadius: "8px", textTransform: "none", fontWeight: 600 }}>
            Apply
          </Button>
        </Box>
      )}
    </Box>
  );
}

// ── Metrics Panel ─────────────────────────────────────────────────────────────
function MetricsPanel({ data, filterLabel, profitSummary }) {
  const ps = profitSummary || {};
  const delSum = ps?.order_summary?.delivered_summary || {};
  const retSum = ps?.order_summary?.return_summary || {};
  const rtoSum = ps?.order_summary?.rto_summary || {};
  const exchSum = ps?.order_summary?.exchanged_summary || {};
  const claimSum = ps?.order_summary?.claim_summary || {};
  const otherSum = ps?.order_summary?.unknown_summary || {};

  const nDel = delSum.order_count ?? 0;
  const nRet = retSum.order_count ?? 0;
  const nRTO = rtoSum.order_count ?? 0;
  const nExchange = exchSum.order_count ?? 0;
  const nClaim = claimSum.order_count ?? 0;
  const nOther = otherSum.order_count ?? 0;
  const nTotal = ps.order_count ?? (nDel + nRet + nRTO + nExchange + nClaim + nOther);

  const delPft = Number(delSum.net_profit_loss ?? 0);
  const retLoss = Number(retSum.net_profit_loss ?? 0);
  const rtoLoss = Number(rtoSum.net_profit_loss ?? 0);
  const exchNet = Number(exchSum.net_profit_loss ?? 0);
  const claimLoss = Number(claimSum.net_profit_loss ?? 0);
  const otherNet = Number(otherSum.net_profit_loss ?? 0);
  const netPL = Number(ps.net_revenue ?? 0);
  const orderNetPL = Number(ps.net_profit_loss ?? 0);

  const nProfit = data.filter(s => s.net_profit > 0).length;
  const nLoss = data.filter(s => s.net_profit < 0).length;
  const pos = netPL >= 0;

  const statusCards = [
    { ...STATUS.delivered, count: nDel, rate: pct(nDel, nTotal), value: delPft },
    { ...STATUS.return, count: nRet, rate: pct(nRet, nTotal), value: retLoss, color: retLoss >= 0 ? "#64748B" : "#DC2626" },
    { ...STATUS.rto, count: nRTO, rate: pct(nRTO, nTotal), value: rtoLoss, color: rtoLoss >= 0 ? "#64748B" : "#D97706" },
    ...(nExchange > 0 ? [{ ...STATUS.exchange, count: nExchange, rate: pct(nExchange, nTotal), value: exchNet, color: exchNet >= 0 ? "#64748B" : "#2563EB" }] : []),
    { ...STATUS.claim, count: nClaim, rate: pct(nClaim, nTotal), value: claimLoss, color: claimLoss >= 0 ? "#059669" : "#7C3AED" },
    ...(nOther > 0 ? [{ ...STATUS.other, count: nOther, rate: pct(nOther, nTotal), value: otherNet }] : []),
  ];

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>

      {/* ── Hero banner ─────────────────────────────────────────────────── */}
      <Box sx={{
        ...DS.card,
        background: pos
          ? "linear-gradient(135deg,#ECFDF5 0%,#F0FDF4 60%,#fff 100%)"
          : "linear-gradient(135deg,#FFF1F2 0%,#FFF5F5 60%,#fff 100%)",
        border: `1.5px solid ${pos ? "#A7F3D0" : "#FECDD3"}`,
        p: 3, display: "flex", flexWrap: "wrap", gap: 3, alignItems: "center",
      }}>
        <Box sx={{ minWidth: 200 }}>
          <Typography sx={{ ...DS.label, color: pos ? "#059669" : "#DC2626", mb: 1 }}>
            Net P&L · {filterLabel}
          </Typography>
          <Typography sx={{ fontFamily: "monospace", fontWeight: 900, fontSize: 44, lineHeight: 1, color: pos ? "#059669" : "#E11D48" }}>
            {pos ? "+" : ""}{fmt(netPL)}
          </Typography>
          <Box sx={{ display: "flex", gap: 1, mt: 1.5, flexWrap: "wrap" }}>
            <Chip size="small"
              label={pos ? "✅ Profitable period" : "❌ Loss period"}
              sx={{ bgcolor: pos ? "#D1FAE5" : "#FEE2E2", color: pos ? "#065F46" : "#991B1B", fontWeight: 700, border: "none" }} />
            {nProfit > 0 && <Chip size="small" label={`${nProfit} profitable SKUs`} color="success" variant="outlined" />}
            {nLoss > 0 && <Chip size="small" label={`${nLoss} in loss`} color="error" variant="outlined" />}
          </Box>
        </Box>

        <Box sx={{ width: 1, bgcolor: pos ? "#A7F3D0" : "#FECDD3", alignSelf: "stretch", display: { xs: "none", sm: "block" } }} />

        <Box sx={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
          {[
            { label: "Settled Orders", value: nTotal.toLocaleString(), color: "#1E3A5F" },
            { label: "Gross Revenue", value: fmt(ps.gross_revenue ?? 0), color: "#334155" },
            { label: "Order Net P&L", value: fmt(orderNetPL), color: orderNetPL >= 0 ? "#059669" : "#DC2626" },
          ].map(({ label, value, color }) => (
            <Box key={label}>
              <Typography sx={DS.label}>{label}</Typography>
              <Typography sx={{ fontFamily: "monospace", fontWeight: 800, fontSize: 20, color, mt: 0.5 }}>{value}</Typography>
            </Box>
          ))}
        </Box>
      </Box>

      {/* ── Status breakdown cards ───────────────────────────────────────── */}
      <Box>
        <SectionLabel>Breakdown by Order Status</SectionLabel>
        <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}>
          {statusCards.map(({ icon, label, count, rate, value, color, bg, border }) => (
            <Box key={label} sx={{
              flex: "1 1 120px", bgcolor: bg,
              border: `1px solid ${border}`, borderRadius: "12px", p: 1.75,
              transition: "box-shadow 0.15s",
              "&:hover": { boxShadow: "0 4px 12px rgba(0,0,0,0.08)" },
            }}>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
                <Typography sx={{ fontSize: 18 }}>{icon}</Typography>
                <Chip label={`${rate}%`} size="small"
                  sx={{ fontSize: 10, fontWeight: 700, height: 18, bgcolor: "rgba(255,255,255,0.7)", color: "#475569" }} />
              </Box>
              <Typography sx={{ ...DS.label, color: "#64748B", mb: 0.5 }}>{label}</Typography>
              <Typography sx={{ fontFamily: "monospace", fontWeight: 800, fontSize: 18, color, lineHeight: 1.1 }}>
                {value >= 0 ? "+" : ""}{fmt(value)}
              </Typography>
              <Typography sx={{ fontSize: 11, color: "#94A3B8", mt: 0.5 }}>{count.toLocaleString()} orders</Typography>
            </Box>
          ))}
        </Box>
      </Box>

      {/* ── Order outcome rates ──────────────────────────────────────────── */}
      <Box sx={{ ...DS.card, p: 2.5 }}>
        <SectionLabel>Order Outcome Rates · {nTotal.toLocaleString()} total settled</SectionLabel>
        <Box sx={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
          {[
            { label: "✅ Delivered", p: pct(nDel, nTotal), count: nDel, color: "#059669" },
            { label: "↩ Return", p: pct(nRet, nTotal), count: nRet, color: "#DC2626" },
            { label: "🔄 Pure RTO", p: pct(nRTO, nTotal), count: nRTO, color: "#D97706" },
            ...(nExchange > 0 ? [{ label: "🔁 Exchange", p: pct(nExchange, nTotal), count: nExchange, color: "#2563EB" }] : []),
            { label: "⚠ Claims", p: pct(nClaim, nTotal), count: nClaim, color: "#7C3AED" },
          ].map(r => (
            <Box key={r.label} sx={{ flex: "1 1 160px" }}>
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", mb: 0.75 }}>
                <Typography sx={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>{r.label}</Typography>
                <Box>
                  <Typography component="span" sx={{ fontFamily: "monospace", fontWeight: 800, fontSize: 14, color: r.color }}>{r.p}%</Typography>
                  <Typography component="span" sx={{ fontSize: 11, color: "#94A3B8", ml: 0.5 }}>({r.count})</Typography>
                </Box>
              </Box>
              <LinearProgress variant="determinate" value={r.p}
                sx={{ height: 8, borderRadius: 99, bgcolor: "#F1F5F9", "& .MuiLinearProgress-bar": { bgcolor: r.color, borderRadius: 99 } }} />
            </Box>
          ))}
        </Box>
      </Box>

    </Box>
  );
}

// ── SKU DataGrid ──────────────────────────────────────────────────────────────
function SKUDataTable({ data, onRowClick }) {
  const columns = [
    {
      field: "sku_id", headerName: "SKU", minWidth: 190, flex: 1.2,
      renderCell: p => (
        <Box sx={{ py: 0.5 }}>
          <Chip label={p.value} size="small" sx={{
            fontFamily: "monospace", fontWeight: 700, fontSize: 12,
            bgcolor: "#FFF7ED", color: "#C2410C", border: "1px solid #FED7AA",
            maxWidth: 170, "& .MuiChip-label": { overflow: "hidden", textOverflow: "ellipsis" },
          }} />
          {p.row.parent && (
            <Typography sx={{ fontSize: 11, color: "#94A3B8", mt: 0.3, pl: 0.5 }}>↳ {p.row.parent}</Typography>
          )}
        </Box>
      ),
    },
    {
      field: "health", headerName: "Orders & Health", width: 210, sortable: false,
      renderCell: p => {
        const s = p.row;
        const del = s.delivered_count || 0, ret = s.return_count || 0;
        const rto = s.rto_count || 0, claim = s.claim_count || 0;
        const total = del + ret + rto + (s.cancelled_count || 0) + claim;
        const dr = pct(del, total);
        const drColor = dr >= 70 ? "#059669" : dr >= 45 ? "#D97706" : "#DC2626";
        return (
          <Box sx={{ py: 0.75, width: "100%" }}>
            <Box sx={{ display: "flex", gap: 0.5, mb: 0.75, flexWrap: "wrap" }}>
              {del > 0 && <span style={{ fontSize: 11, fontWeight: 600, color: "#059669", background: "#ECFDF5", padding: "1px 6px", borderRadius: 20, border: "1px solid #A7F3D0" }}>✅ {del}</span>}
              {ret > 0 && <span style={{ fontSize: 11, fontWeight: 600, color: "#DC2626", background: "#FFF1F2", padding: "1px 6px", borderRadius: 20, border: "1px solid #FECDD3" }}>↩ {ret}</span>}
              {rto > 0 && <span style={{ fontSize: 11, fontWeight: 600, color: "#D97706", background: "#FFFBEB", padding: "1px 6px", borderRadius: 20, border: "1px solid #FDE68A" }}>🔄 {rto}</span>}
              {claim > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: "#7C3AED", background: "#F5F3FF", padding: "1px 6px", borderRadius: 20, border: "1px solid #DDD6FE" }}>⚠ {claim}</span>}
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <LinearProgress variant="determinate" value={dr} sx={{
                flex: 1, height: 5, borderRadius: 99, bgcolor: "#F1F5F9",
                "& .MuiLinearProgress-bar": { bgcolor: drColor, borderRadius: 99 },
              }} />
              <Typography sx={{ fontSize: 11, fontWeight: 700, color: drColor, minWidth: 28 }}>{dr}%</Typography>
            </Box>
          </Box>
        );
      },
    },
    {
      field: "one_unit_price", headerName: "Unit Cost", width: 100, type: "number",
      valueFormatter: value => fmt(value),
      renderCell: p => <Typography sx={{ fontFamily: "monospace", fontSize: 13, color: "#475569" }}>{fmt(p.value)}</Typography>,
    },
    {
      field: "avg_profit_per_piece", headerName: "Avg Profit / pc", width: 140, type: "number",
      valueFormatter: value => value != null ? fmt(value) : "—",
      renderCell: p => {
        if (p.value == null) return <Typography sx={{ color: "#CBD5E1", fontFamily: "monospace" }}>—</Typography>;
        const pos = p.value >= 0;
        return (
          <Box sx={{ textAlign: "right" }}>
            <Typography sx={{ fontFamily: "monospace", fontWeight: 800, fontSize: 14, color: pos ? "#059669" : "#E11D48" }}>
              {pos ? "+" : ""}{fmt(p.value)}
            </Typography>
            <Typography sx={{ fontSize: 10, color: "#94A3B8" }}>per unit delivered</Typography>
          </Box>
        );
      },
    },
    {
      field: "delivered_profit", headerName: "Delivered P&L", width: 130, type: "number",
      valueFormatter: value => fmt(value),
      renderCell: p => p.value
        ? <Typography sx={{ fontFamily: "monospace", fontSize: 13, fontWeight: 600, color: "#059669" }}>+{fmt(p.value)}</Typography>
        : <Typography sx={{ color: "#CBD5E1", fontFamily: "monospace" }}>—</Typography>,
    },
    {
      field: "net_profit", headerName: "Net P&L", width: 150, type: "number",
      valueFormatter: value => fmt(value),
      renderCell: p => <PLChip value={p.value} large />,
    },
    {
      field: "actions", headerName: "", width: 52, sortable: false,
      renderCell: p => (
        <Tooltip title="View full analysis" placement="left">
          <IconButton size="small"
            onClick={e => { e.stopPropagation(); onRowClick(p.row); }}
            sx={{ color: "#CBD5E1", fontSize: 18, "&:hover": { color: "#2563EB", bgcolor: "#EFF6FF" } }}>
            ▸
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
      rowHeight={68}
      disableRowSelectionOnClick
      sx={{
        border: "none",
        "& .MuiDataGrid-columnHeaders": { bgcolor: "#F8FAFC", borderBottom: "2px solid #E8EDF3" },
        "& .MuiDataGrid-columnHeaderTitle": { fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "#64748B" },
        "& .MuiDataGrid-row": { borderBottom: "1px solid #F1F5F9", cursor: "pointer" },
        "& .MuiDataGrid-row:hover": { bgcolor: "#FAFBFF" },
        "& .MuiDataGrid-cell": { borderBottom: "none" },
        "& .MuiDataGrid-footerContainer": { borderTop: "1px solid #E8EDF3" },
      }}
    />
  );
}

// ── SKU Detail Modal ──────────────────────────────────────────────────────────
function SKUDetailModal({ sku, months, initialRange, initialMonth, onClose }) {
  const [selMonth, setSelMonth] = useState(initialMonth);
  const [range, setRange] = useState(initialRange || {});
  const [label, setLabel] = useState(
    initialMonth == null ? "All time"
      : initialMonth === "custom" ? `${initialRange?.date_from} → ${initialRange?.date_to}`
        : fmtMonth(initialMonth)
  );
  const [activeTab, setActiveTab] = useState("overview");
  const [periodData, setPeriodData] = useState(null);
  const [periodLoading, setPeriodLoading] = useState(true);
  const [monthly, setMonthly] = useState([]);
  const [monthlyLoading, setMonthlyLoading] = useState(months.length > 0);

  useEffect(() => {
    const h = e => e.key === "Escape" && onClose();
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  useEffect(() => {
    setPeriodLoading(true); setPeriodData(null);
    const params = new URLSearchParams();
    if (range.date_from) params.set("date_from", range.date_from);
    if (range.date_to) params.set("date_to", range.date_to);
    fetch(`${API}/profit/?${params}`).then(r => r.json()).then(d => {
      setPeriodData((d.sku_wise_profit || {})[sku.sku_id] || {});
      setPeriodLoading(false);
    }).catch(() => { setPeriodData({}); setPeriodLoading(false); });
  }, [JSON.stringify(range)]); // eslint-disable-line

  useEffect(() => {
    if (months.length === 0) { setMonthlyLoading(false); return; }
    Promise.all(months.map(m =>
      fetch(`${API}/profit/?${new URLSearchParams(toRange(m))}`).then(r => r.json()).then(d => ({
        month: m, raw: (d.sku_wise_profit || {})[sku.sku_id] || {},
      })).catch(() => ({ month: m, raw: {} }))
    )).then(res => { setMonthly(res.sort((a, b) => a.month.localeCompare(b.month))); setMonthlyLoading(false); });
  }, []); // eslint-disable-line

  // ── Derived ───────────────────────────────────────────────────────────────
  const d = periodData || {};
  const nDel = Number(d.delivered_count || 0);
  const nRet = Number(d.return_count || 0);
  const nRTO = Number(d.rto_count || 0);
  const nExchange = Number(d.exchange_count || 0);
  const nClaim = Number(d.claim_count || 0);
  const nOther = Number(d.other_count || 0);
  const nTotal = Number(d.order_count || 0) || (nDel + nRet + nRTO + nExchange + nClaim + nOther);
  const delQty = Number(d.delivered_quantity || 0);
  // Cost shown must be the ALL-IN cost the backend actually deducted
  // (item + packaging + GST). Using the raw item cost understated both this
  // column and the gross by exactly the packaging + GST.
  const delItemCost = Number(d.delivered_purchase_cost || 0);              // item × qty, ex-tax, ex-packaging
  const delCost = Number(d.delivered_final_purchase_cost ?? delItemCost);  // item + packaging + GST
  const delNet = Number(d.delivered_profit || 0);
  // Prefer the settlement the backend summed; fall back to profit + cost.
  const delGross = Number(d.delivered_total_settlement ?? (delNet + delCost));
  const retNet = Number(d.return_loss || 0);
  const rtoNet = Number(d.rto_loss || 0);
  const exchNet = Number(d.exchange_loss || 0); // fix: was exchange_net (always 0)
  const claimNet = Number(d.claim_loss || 0);
  const claimsRcv = Number(d.claims_total || 0);
  const otherNet = Number(d.other_net || 0);
  const pkgCost = Number(d.total_packaging_cost || 0);
  const taxCost = Number(d.total_tax_cost || 0);
  const totalNet = Number(d.net_profit || 0) || (delNet + retNet + rtoNet + exchNet + claimNet + otherNet);
  const unitCost = Number(sku.one_unit_price || 0);
  const avgProfit = delQty > 0 ? delNet / delQty : null;

  const pos = totalNet >= 0;
  const drPct = pct(nDel, nTotal);
  const retPct = pct(nRet, nTotal);
  const rtoPct = pct(nRTO, nTotal);
  const excPct = pct(nExchange, nTotal);
  const clmPct = pct(nClaim, nTotal);

  const statusPieData = [
    { id: 0, value: nDel, label: "Delivered", color: "#059669" },
    { id: 1, value: nRet, label: "Return", color: "#DC2626" },
    { id: 2, value: nRTO, label: "RTO", color: "#D97706" },
    { id: 3, value: nExchange, label: "Exchange", color: "#2563EB" },
    { id: 4, value: nClaim, label: "Claim", color: "#7C3AED" },
    { id: 5, value: nOther, label: "Other", color: "#94A3B8" },
  ].filter(x => x.value > 0);

  const plBarData = [
    { s: "Delivered", v: delNet },
    { s: "Return", v: retNet },
    { s: "RTO", v: rtoNet },
    ...(nExchange > 0 ? [{ s: "Exchange", v: exchNet }] : []),
    ...(nClaim > 0 ? [{ s: "Claim", v: claimNet }] : []),
    ...(nOther > 0 ? [{ s: "Other", v: otherNet }] : []),
  ];

  const monthlyChartData = monthly.map(({ month, raw }) => ({
    month: fmtShort(month),
    Delivered: Number(raw.delivered_profit || 0),
    Return: Math.abs(Number(raw.return_loss || 0)),
    RTO: Math.abs(Number(raw.rto_loss || 0)),
  }));

  const settlementRows = [
    { ...STATUS.delivered, count: nDel, qty: delQty, gross: delGross, cost: delCost > 0 ? -delCost : null, net: delNet, note: `${delQty} units · cost incl. pkg + GST`, show: nDel > 0, netColor: "#059669" },
    { ...STATUS.return, count: nRet, qty: null, gross: null, cost: null, net: retNet, note: "pkg already deducted", show: nRet > 0, netColor: retNet >= 0 ? "#64748B" : "#DC2626" },
    { ...STATUS.rto, count: nRTO, qty: null, gross: null, cost: null, net: rtoNet, note: "pkg already deducted", show: nRTO > 0, netColor: rtoNet >= 0 ? "#64748B" : "#D97706" },
    { ...STATUS.exchange, count: nExchange, qty: null, gross: null, cost: null, net: exchNet, note: "2×pkg deducted", show: nExchange > 0, netColor: exchNet >= 0 ? "#64748B" : "#2563EB" },
    { ...STATUS.claim, count: nClaim, qty: null, gross: claimsRcv || null, cost: claimsRcv ? -(claimsRcv - claimNet) : null, net: claimNet, note: claimsRcv > 0 ? `${fmt(claimsRcv)} received` : "item cost deducted", show: nClaim > 0, netColor: claimNet >= 0 ? "#059669" : "#7C3AED" },
    { ...STATUS.other, count: nOther, qty: null, gross: null, cost: null, net: otherNet, note: "cancelled / adj", show: nOther > 0, netColor: "#64748B" },
  ].filter(r => r.show);

  const handleMonthSelect = (m, r) => {
    setSelMonth(m); setRange(r || {});
    setLabel(m == null ? "All time" : m === "custom" ? `${r.date_from} → ${r.date_to}` : fmtMonth(m));
  };

  const TABS = [
    { id: "overview", label: "Overview" },
    { id: "settlement", label: "Settlement" },
    { id: "charts", label: "Charts" },
    { id: "history", label: "Monthly History" },
  ];

  const accentColor = pos ? "#059669" : "#E11D48";

  return (
    <Dialog open maxWidth="lg" fullWidth onClose={onClose}
      PaperProps={{ sx: { borderRadius: "20px", maxHeight: "94vh", overflow: "hidden", display: "flex", flexDirection: "column" } }}>

      {/* ── Gradient header ────────────────────────────────────────────────── */}
      <Box sx={{
        background: pos
          ? "linear-gradient(135deg,#ECFDF5 0%,#D1FAE5 100%)"
          : "linear-gradient(135deg,#FFF1F2 0%,#FFE4E6 100%)",
        px: 3, pt: 2.5, pb: 0,
        borderBottom: `2px solid ${pos ? "#A7F3D0" : "#FECDD3"}`,
        flexShrink: 0,
      }}>
        <Box sx={{ display: "flex", alignItems: "flex-start", gap: 2, mb: 1.5, flexWrap: "wrap" }}>
          <Box sx={{ flex: 1 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", mb: 1 }}>
              <Chip label={sku.sku_id} sx={{
                fontFamily: "monospace", fontWeight: 800, fontSize: 15,
                bgcolor: "#FFF7ED", color: "#C2410C", border: "1px solid #FED7AA",
                height: 32,
              }} />
              <Typography sx={{ fontSize: 12, color: "#64748B" }}>
                Unit cost: <strong style={{ fontFamily: "monospace", color: "#334155" }}>{fmt(unitCost)}</strong>
              </Typography>
              {sku.parent && <Typography sx={{ fontSize: 12, color: "#94A3B8" }}>Parent: {sku.parent}</Typography>}
            </Box>
            {!periodLoading && (
              <Box sx={{ display: "flex", alignItems: "baseline", gap: 1.5, flexWrap: "wrap" }}>
                <Typography sx={{ fontFamily: "monospace", fontWeight: 900, fontSize: 38, color: accentColor, lineHeight: 1 }}>
                  {pos ? "+" : ""}{fmt(totalNet)}
                </Typography>
                <Typography sx={{ fontSize: 13, color: "#94A3B8" }}>net P&L · {label}</Typography>
              </Box>
            )}
          </Box>
          <IconButton onClick={onClose} sx={{ color: "#64748B", "&:hover": { bgcolor: "rgba(0,0,0,0.06)" } }}>✕</IconButton>
        </Box>

        {/* Tab navigation */}
        <Box sx={{ display: "flex" }}>
          {TABS.map(t => (
            <Box key={t.id} onClick={() => setActiveTab(t.id)} sx={{
              px: 2.5, py: 1.25, cursor: "pointer",
              borderBottom: activeTab === t.id ? `3px solid ${accentColor}` : "3px solid transparent",
            }}>
              <Typography sx={{
                fontSize: 13, fontWeight: activeTab === t.id ? 700 : 500,
                color: activeTab === t.id ? accentColor : "#64748B",
              }}>{t.label}</Typography>
            </Box>
          ))}
        </Box>
      </Box>

      {/* ── Period filter ──────────────────────────────────────────────────── */}
      <Box sx={{ px: 3, py: 1.5, bgcolor: "#F8FAFC", borderBottom: "1px solid #E2E8F0", flexShrink: 0 }}>
        <MonthFilter months={months} selMonth={selMonth} onSelect={handleMonthSelect} />
      </Box>

      <DialogContent sx={{ p: 0, overflowY: "auto", flex: 1 }}>
        {periodLoading ? (
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", py: 10, gap: 2 }}>
            <CircularProgress sx={{ color: accentColor }} />
            <Typography sx={{ color: "#94A3B8", fontSize: 14 }}>Loading data for {label}…</Typography>
          </Box>
        ) : nTotal === 0 ? (
          <Box sx={{ textAlign: "center", py: 10 }}>
            <Typography sx={{ fontSize: 44, mb: 1.5 }}>📭</Typography>
            <Typography sx={{ fontWeight: 700, fontSize: 18, mb: 0.5 }}>No orders for {label}</Typography>
            <Typography sx={{ color: "#94A3B8" }}>Select a different period above.</Typography>
          </Box>
        ) : (
          <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 3 }}>

            {/* ── OVERVIEW ───────────────────────────────────────────────── */}
            {activeTab === "overview" && (
              <>
                {/* KPI strip */}
                <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}>
                  {[
                    { label: "Net P&L", value: fmt(totalNet), color: accentColor, accent: accentColor, big: true },
                    { label: "Total Orders", value: nTotal.toLocaleString(), color: "#1E3A5F", accent: "#3B82F6" },
                    { label: "Delivery Rate", value: `${drPct}%`, color: drPct >= 70 ? "#059669" : drPct >= 45 ? "#D97706" : "#DC2626", accent: drPct >= 70 ? "#059669" : drPct >= 45 ? "#D97706" : "#DC2626" },
                    { label: "Units Delivered", value: delQty.toLocaleString(), color: "#059669", accent: "#059669" },
                    ...(avgProfit != null ? [{ label: "Avg Profit / pc", value: fmt(avgProfit), color: avgProfit >= 0 ? "#059669" : "#E11D48", accent: avgProfit >= 0 ? "#059669" : "#E11D48" }] : []),
                    { label: "Packaging Cost", value: fmt(pkgCost), color: "#D97706", accent: "#D97706" },
                    { label: "GST on Items", value: fmt(taxCost), color: "#D97706", accent: "#D97706" },
                  ].map(({ label: lbl, value, color, accent, big }) => (
                    <Box key={lbl} sx={{
                      flex: big ? "1 1 160px" : "1 1 100px",
                      bgcolor: "#fff", border: "1px solid #E8EDF3",
                      borderTop: `3px solid ${accent}`, borderRadius: "12px",
                      p: 1.75, boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
                    }}>
                      <Typography sx={DS.label}>{lbl}</Typography>
                      <Typography sx={{ fontFamily: "monospace", fontWeight: 800, fontSize: big ? 24 : 18, color, mt: 0.75, lineHeight: 1 }}>
                        {value}
                      </Typography>
                    </Box>
                  ))}
                </Box>

                {/* Rate bars */}
                <Box sx={{ ...DS.card, p: 2.5 }}>
                  <SectionLabel>Order Outcome Rates · {nTotal} settled</SectionLabel>
                  <Box sx={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                    {[
                      { label: "✅ Delivered", p: drPct, count: nDel, color: "#059669" },
                      { label: "↩ Return", p: retPct, count: nRet, color: "#DC2626" },
                      { label: "🔄 RTO", p: rtoPct, count: nRTO, color: "#D97706" },
                      ...(nExchange > 0 ? [{ label: "🔁 Exchange", p: excPct, count: nExchange, color: "#2563EB" }] : []),
                      ...(nClaim > 0 ? [{ label: "⚠ Claim", p: clmPct, count: nClaim, color: "#7C3AED" }] : []),
                    ].map(r => (
                      <Box key={r.label} sx={{ flex: "1 1 160px" }}>
                        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", mb: 0.5 }}>
                          <Typography sx={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>{r.label}</Typography>
                          <Typography sx={{ fontFamily: "monospace", fontWeight: 800, fontSize: 14, color: r.color }}>
                            {r.p}% <span style={{ fontSize: 11, fontWeight: 400, color: "#94A3B8" }}>({r.count})</span>
                          </Typography>
                        </Box>
                        <LinearProgress variant="determinate" value={r.p}
                          sx={{ height: 8, borderRadius: 99, bgcolor: "#F1F5F9", "& .MuiLinearProgress-bar": { bgcolor: r.color, borderRadius: 99 } }} />
                      </Box>
                    ))}
                  </Box>
                </Box>
              </>
            )}

            {/* ── SETTLEMENT ─────────────────────────────────────────────── */}
            {activeTab === "settlement" && (
              <Box sx={{ ...DS.card, overflow: "hidden" }}>
                <Box sx={{ px: 2.5, py: 1.75, borderBottom: "1px solid #E8EDF3" }}>
                  <Typography sx={{ fontWeight: 700, fontSize: 15 }}>Settlement Breakdown</Typography>
                  <Typography sx={{ fontSize: 12, color: "#94A3B8", mt: 0.25 }}>Period: {label}</Typography>
                </Box>
                <Box sx={{ overflowX: "auto" }}>
                  <Table>
                    <TableHead>
                      <TableRow sx={{ bgcolor: "#F8FAFC" }}>
                        {["Status", "Orders", "Qty", "Gross Settlement", "Purchase Cost", "Net P&L"].map((h, i) => (
                          <TableCell key={h} sx={{
                            fontWeight: 700, fontSize: 10, textTransform: "uppercase",
                            letterSpacing: "0.07em", color: "#94A3B8",
                            borderBottom: "2px solid #E8EDF3",
                            textAlign: i >= 3 ? "right" : "left", py: 1.5,
                          }}>{h}</TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {settlementRows.map(row => (
                        <TableRow key={row.label}
                          sx={{ borderLeft: `3px solid ${row.color}`, "&:hover": { bgcolor: "#F8FAFC" } }}>
                          <TableCell sx={{ py: 1.5, pl: 2 }}>
                            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                              <Box sx={{
                                width: 32, height: 32, borderRadius: "8px",
                                bgcolor: row.bg, border: `1px solid ${row.border}`,
                                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15,
                              }}>{row.icon}</Box>
                              <Box>
                                <Typography sx={{ fontWeight: 700, fontSize: 13 }}>{row.label}</Typography>
                                {row.note && <Typography sx={{ fontSize: 11, color: "#94A3B8" }}>{row.note}</Typography>}
                              </Box>
                            </Box>
                          </TableCell>
                          <TableCell sx={{ fontFamily: "monospace", color: "#475569" }}>{row.count.toLocaleString()}</TableCell>
                          <TableCell sx={{ fontFamily: "monospace", color: "#94A3B8" }}>{row.qty != null ? row.qty : "—"}</TableCell>
                          <TableCell sx={{ textAlign: "right", fontFamily: "monospace", color: "#334155" }}>
                            {row.gross != null && row.gross !== 0 ? fmt(row.gross) : "—"}
                          </TableCell>
                          <TableCell sx={{ textAlign: "right", fontFamily: "monospace", color: "#DC2626" }}>
                            {row.cost != null && row.cost !== 0 ? fmt(row.cost) : "—"}
                          </TableCell>
                          <TableCell sx={{ textAlign: "right", pr: 2 }}>
                            <PLChip value={row.net} />
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow sx={{ bgcolor: "#F8FAFC" }}>
                        <TableCell sx={{ fontWeight: 800, fontSize: 14, pl: 2, py: 1.75 }}>Total</TableCell>
                        <TableCell sx={{ fontFamily: "monospace", fontWeight: 700 }}>{nTotal.toLocaleString()}</TableCell>
                        <TableCell sx={{ fontFamily: "monospace", fontWeight: 700 }}>{delQty > 0 ? delQty : "—"}</TableCell>
                        <TableCell sx={{ textAlign: "right", fontFamily: "monospace", fontWeight: 700 }}>{delGross > 0 ? fmt(delGross) : "—"}</TableCell>
                        <TableCell sx={{ textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: "#DC2626" }}>{delCost > 0 ? fmt(-delCost) : "—"}</TableCell>
                        <TableCell sx={{ textAlign: "right", pr: 2 }}><PLChip value={totalNet} large /></TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </Box>
              </Box>
            )}

            {/* ── CHARTS ─────────────────────────────────────────────────── */}
            {activeTab === "charts" && (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
                  <Box sx={{ ...DS.card, p: 2.5, flex: "0 0 300px" }}>
                    <Typography sx={{ fontWeight: 700, fontSize: 14, mb: 0.5 }}>Order Distribution</Typography>
                    <Typography sx={{ fontSize: 12, color: "#94A3B8", mb: 1 }}>{nTotal} total orders</Typography>
                    <AppPieChart data={statusPieData} height={200} valueFormatter={(v) => v} />
                    <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap", mt: 1 }}>
                      {statusPieData.map(s => (
                        <Chip key={s.label} label={`${s.label} ${pct(s.value, nTotal)}%`} size="small"
                          sx={{ bgcolor: "transparent", border: `1px solid ${s.color}`, color: s.color, fontWeight: 600, fontSize: 10 }} />
                      ))}
                    </Box>
                  </Box>
                  <Box sx={{ ...DS.card, p: 2.5, flex: "1 1 300px" }}>
                    <Typography sx={{ fontWeight: 700, fontSize: 14, mb: 0.5 }}>Net P&L by Status</Typography>
                    <Typography sx={{ fontSize: 12, color: "#94A3B8", mb: 1 }}>Green = profit · Red = loss</Typography>
                    <AppBarChart
                      dataset={plBarData}
                      indexKey="s"
                      series={[{ dataKey: "v", label: "Net P&L" }]}
                      diverging
                      valueFormatter={fmt}
                      height={230}
                    />
                  </Box>
                </Box>
              </Box>
            )}

            {/* ── HISTORY ────────────────────────────────────────────────── */}
            {activeTab === "history" && (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
                {monthlyLoading ? (
                  <Box sx={{ textAlign: "center", py: 6 }}><CircularProgress size={28} /></Box>
                ) : (
                  <>
                    <Box sx={{ ...DS.card, p: 2.5 }}>
                      <Typography sx={{ fontWeight: 700, fontSize: 14, mb: 0.5 }}>Monthly Trend — All Time</Typography>
                      <Typography sx={{ fontSize: 12, color: "#94A3B8", mb: 1.5 }}>Delivered profit vs return & RTO losses</Typography>
                      <AppBarChart
                        dataset={monthlyChartData}
                        indexKey="month"
                        series={[
                          { dataKey: "Delivered", label: "Delivered +", color: "#059669" },
                          { dataKey: "Return", label: "Return −", color: "#DC2626" },
                          { dataKey: "RTO", label: "RTO −", color: "#D97706" },
                        ]}
                        valueFormatter={fmt}
                        height={240}
                      />
                    </Box>
                    <Box sx={{ ...DS.card, overflow: "hidden" }}>
                      <Box sx={{ px: 2.5, py: 1.5, borderBottom: "1px solid #E8EDF3" }}>
                        <Typography sx={{ fontWeight: 700, fontSize: 14 }}>Month-by-Month Detail</Typography>
                      </Box>
                      <Box sx={{ overflowX: "auto" }}>
                        <Table size="small">
                          <TableHead>
                            <TableRow sx={{ bgcolor: "#F8FAFC" }}>
                              {["Month", "✅ Del", "↩ Ret", "🔄 RTO", "⚠ Claims", "Del. Profit", "Ret. Loss", "RTO Loss", "Exchange", "Claim Net", "Pkg Cost", "Net P&L"].map(h => (
                                <TableCell key={h} sx={{ fontWeight: 700, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", color: "#94A3B8", whiteSpace: "nowrap", py: 1.25 }}>{h}</TableCell>
                              ))}
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {monthly.map(({ month, raw }) => {
                              const mNet = Number(raw.net_profit || 0);
                              const mDel = Number(raw.delivered_profit || 0);
                              const mRet = Number(raw.return_loss || 0);
                              const mRTO = Number(raw.rto_loss || 0);
                              const mExch = Number(raw.exchange_loss || 0); // fix: was exchange_net (always 0)
                              const mClm = Number(raw.claim_loss || 0);
                              const mPkg = Number(raw.total_packaging_cost || 0);
                              // Verify: mDel + mRet + mRTO + mExch + mClm === mNet (pkg already inside mDel)
                              const computedNet = mDel + mRet + mRTO + mExch + mClm;
                              return (
                                <TableRow key={month} sx={{ "&:hover": { bgcolor: "#F8FAFC" } }}>
                                  <TableCell sx={{ fontWeight: 700, whiteSpace: "nowrap", fontSize: 13 }}>{fmtShort(month)}</TableCell>
                                  <TableCell sx={{ color: "#059669", fontFamily: "monospace", fontSize: 12 }}>{raw.delivered_count || "—"}</TableCell>
                                  <TableCell sx={{ color: "#DC2626", fontFamily: "monospace", fontSize: 12 }}>{raw.return_count || "—"}</TableCell>
                                  <TableCell sx={{ color: "#D97706", fontFamily: "monospace", fontSize: 12 }}>{raw.rto_count || "—"}</TableCell>
                                  <TableCell sx={{ color: "#7C3AED", fontFamily: "monospace", fontSize: 12 }}>{raw.claim_count || "—"}</TableCell>
                                  <TableCell sx={{ color: "#059669", fontFamily: "monospace", fontSize: 12 }}>{mDel !== 0 ? `+${fmt(mDel)}` : "—"}</TableCell>
                                  <TableCell sx={{ color: "#DC2626", fontFamily: "monospace", fontSize: 12 }}>{mRet !== 0 ? fmt(mRet) : "—"}</TableCell>
                                  <TableCell sx={{ color: "#D97706", fontFamily: "monospace", fontSize: 12 }}>{mRTO !== 0 ? fmt(mRTO) : "—"}</TableCell>
                                  <TableCell sx={{ color: "#2563EB", fontFamily: "monospace", fontSize: 12 }}>{mExch !== 0 ? `${mExch >= 0 ? "+" : ""}${fmt(mExch)}` : "—"}</TableCell>
                                  <TableCell sx={{ color: "#7C3AED", fontFamily: "monospace", fontSize: 12 }}>{mClm !== 0 ? `${mClm >= 0 ? "+" : ""}${fmt(mClm)}` : "—"}</TableCell>
                                  <TableCell sx={{ color: "#D97706", fontFamily: "monospace", fontSize: 12 }}>{mPkg > 0 ? `−${fmt(mPkg)}` : "—"}</TableCell>
                                  <TableCell>
                                    <PLChip value={mNet} />
                                    {Math.abs(computedNet - mNet) > 0.5 && (
                                      <Tooltip title={`Computed: ${fmt(computedNet)} vs Backend: ${fmt(mNet)}`}>
                                        <Typography sx={{ fontSize: 9, color: "#E11D48", mt: 0.3 }}>⚠ mismatch</Typography>
                                      </Tooltip>
                                    )}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </Box>
                    </Box>
                  </>
                )}
              </Box>
            )}
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Low Margin Panel ──────────────────────────────────────────────────────────
const THRESHOLDS = [20, 30, 40, 50, 100];

function LowMarginPanel({ rows, threshold, setThreshold, onRowClick }) {
  const totalProfit = rows.reduce((a, s) => a + (s.delivered_profit || 0), 0);
  const totalQty = rows.reduce((a, s) => a + (s.delivered_quantity || 0), 0);
  const totalNetPL = rows.reduce((a, s) => a + s.net_profit, 0);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {/* Threshold selector */}
      <Box sx={{ ...DS.card, p: 2.5 }}>
        <Typography sx={{ fontWeight: 700, fontSize: 15, mb: 0.5 }}>Low Margin SKU Detector</Typography>
        <Typography sx={{ fontSize: 12, color: "#94A3B8", mb: 1.5 }}>
          Flag SKUs where avg profit per delivered unit is below the threshold.
        </Typography>
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center" }}>
          <Typography sx={DS.label}>Threshold:</Typography>
          {THRESHOLDS.map(t => (
            <Button key={t} size="small" disableElevation
              variant={threshold === t ? "contained" : "outlined"} color="warning"
              onClick={() => setThreshold(t)}
              sx={{ borderRadius: "8px", fontFamily: "monospace", fontWeight: 700, minWidth: 60, textTransform: "none" }}>
              &lt;₹{t}
            </Button>
          ))}
        </Box>
      </Box>

      {/* Summary strip */}
      <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}>
        {[
          { label: `SKUs below ₹${threshold}/pc`, value: rows.length, color: "#D97706", accent: "#D97706" },
          { label: "Units delivered", value: totalQty.toLocaleString(), color: "#1E3A5F", accent: "#3B82F6" },
          { label: "Delivered profit", value: fmt(totalProfit), color: totalProfit >= 0 ? "#059669" : "#E11D48", accent: totalProfit >= 0 ? "#059669" : "#E11D48" },
          { label: "Net P&L incl. returns", value: fmt(totalNetPL), color: totalNetPL >= 0 ? "#059669" : "#E11D48", accent: totalNetPL >= 0 ? "#059669" : "#E11D48" },
        ].map(item => (
          <Box key={item.label} sx={{ ...DS.card, p: 2, flex: "1 1 150px", borderTop: `3px solid ${item.accent}` }}>
            <Typography sx={DS.label}>{item.label}</Typography>
            <Typography sx={{ fontFamily: "monospace", fontWeight: 800, fontSize: 22, color: item.color, mt: 0.75 }}>{item.value}</Typography>
          </Box>
        ))}
      </Box>

      {rows.length === 0 ? (
        <Box sx={{ ...DS.card, textAlign: "center", py: 8 }}>
          <Typography sx={{ fontSize: 36, mb: 1 }}>✅</Typography>
          <Typography sx={{ fontWeight: 700, fontSize: 18, mb: 0.5 }}>All Clear!</Typography>
          <Typography sx={{ color: "#94A3B8" }}>No SKUs earning below ₹{threshold}/piece.</Typography>
        </Box>
      ) : (
        <Box sx={{ ...DS.card, overflow: "hidden" }}>
          {/* Header row */}
          <Box sx={{ display: "flex", bgcolor: "#F8FAFC", borderBottom: "2px solid #E8EDF3", px: 2.5, py: 1.25, gap: 1 }}>
            {["SKU", "Unit Cost", "Avg Settle/pc", "Avg Profit/pc", "Units", "Del. Profit", "Return Rate", "Net P&L"].map((h, i) => (
              <Typography key={h} sx={{
                ...DS.label,
                flex: i === 0 ? "1 1 150px" : i === 3 ? "0 0 130px" : "1 1 90px",
                textAlign: i >= 1 ? "right" : "left",
              }}>{h}</Typography>
            ))}
            <Box sx={{ width: 44 }} />
          </Box>

          {rows.map(s => {
            const avg = s.avg_profit_per_piece;
            const avgSettle = s.avg_settlement_per_piece;
            const cost = Number(s.one_unit_price || 0);
            const qty = Number(s.delivered_quantity || 0);
            const dPft = Number(s.delivered_profit || 0);
            const nDel = Number(s.delivered_count || 0);
            const nRet = Number(s.return_count || 0);
            const nRTO = Number(s.rto_count || 0);
            const tot = nDel + nRet + nRTO;
            const retRt = tot > 0 ? Math.round((nRet + nRTO) / tot * 100) : 0;
            const pctT = avg / threshold;
            const sev = pctT < 0.4 ? "crit" : pctT < 0.7 ? "warn" : "ok";
            const rowBg = { crit: "#FFF1F2", warn: "#FFFBEB", ok: "#F0FDF4" }[sev];
            const leftBorder = { crit: "#E11D48", warn: "#D97706", ok: "#059669" }[sev];

            return (
              <Box key={s.sku_id} onClick={() => onRowClick(s)} sx={{
                display: "flex", alignItems: "center", px: 2.5, py: 1.5, gap: 1,
                bgcolor: rowBg, borderBottom: "1px solid #E8EDF3",
                borderLeft: `3px solid ${leftBorder}`,
                cursor: "pointer", transition: "filter 0.12s",
                "&:hover": { filter: "brightness(0.97)" },
              }}>
                <Box sx={{ flex: "1 1 150px" }}>
                  <Chip label={s.sku_id} size="small" sx={{
                    fontFamily: "monospace", fontWeight: 700, fontSize: 11,
                    bgcolor: "#F5F3FF", color: "#6D28D9", border: "1px solid #C4B5FD", maxWidth: "100%",
                  }} />
                  <Typography sx={{ fontSize: 11, color: "#94A3B8", mt: 0.3 }}>{nDel} delivered</Typography>
                </Box>
                <Typography sx={{ fontFamily: "monospace", flex: "1 1 90px", textAlign: "right", color: "#475569", fontSize: 13 }}>{fmt(cost)}</Typography>
                <Typography sx={{ fontFamily: "monospace", flex: "1 1 90px", textAlign: "right", color: "#2563EB", fontSize: 13 }}>{avgSettle != null ? fmt(avgSettle) : "—"}</Typography>
                <Box sx={{ flex: "0 0 130px", textAlign: "right" }}>
                  <Typography sx={{ fontFamily: "monospace", fontWeight: 800, fontSize: 15, color: leftBorder }}>
                    {avg < 0 ? "" : "+"}{fmt(avg)}
                  </Typography>
                  <Typography sx={{ fontSize: 10, color: "#94A3B8" }}>₹{(threshold - avg).toFixed(0)} below limit</Typography>
                </Box>
                <Typography sx={{ fontFamily: "monospace", flex: "1 1 90px", textAlign: "right", fontSize: 13 }}>{qty}</Typography>
                <Typography sx={{ fontFamily: "monospace", flex: "1 1 90px", textAlign: "right", fontSize: 13, color: dPft >= 0 ? "#059669" : "#E11D48" }}>{fmt(dPft)}</Typography>
                <Box sx={{ flex: "1 1 90px", textAlign: "right" }}>
                  <Typography sx={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13, color: retRt > 30 ? "#E11D48" : retRt > 15 ? "#D97706" : "#64748B" }}>{retRt}%</Typography>
                  <Typography sx={{ fontSize: 10, color: "#94A3B8" }}>{nRet + nRTO} back</Typography>
                </Box>
                <PLChip value={s.net_profit} />
                <Tooltip title="View full analysis">
                  <IconButton size="small" sx={{ color: "#CBD5E1", width: 44, "&:hover": { color: "#2563EB", bgcolor: "#EFF6FF" } }}>▸</IconButton>
                </Tooltip>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}

// ── Missing SKUs panel ───────────────────────────────────────────────────────
function AddPriceDialog({ skuId, onClose, onSaved }) {
  const [form, setForm] = useState({ item_price: "", packaging_cost: "", tax_percent: "", final_price: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const computedFinal = (() => {
    const ip = parseFloat(form.item_price) || 0;
    const pc = parseFloat(form.packaging_cost) || 0;
    const tax = parseFloat(form.tax_percent) || 0;
    if (!ip) return "";
    return (ip * (1 + tax / 100) + pc).toFixed(2);
  })();

  const field = (k, label, required, type = "number", adornment = "₹") => (
    <TextField
      key={k} label={label} size="small" type={type} fullWidth required={required}
      value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}
      InputProps={adornment ? { startAdornment: <InputAdornment position="start">{adornment}</InputAdornment> } : undefined}
      sx={{ "& .MuiOutlinedInput-root": { borderRadius: "8px" } }}
    />
  );

  const handleSave = async () => {
    if (!form.item_price) { setErr("Item price is required."); return; }
    setSaving(true); setErr("");
    const payload = {
      sku_id: skuId,
      item_price: form.item_price || null,
      packaging_cost: form.packaging_cost || null,
      tax_percent: form.tax_percent || null,
      final_price: form.final_price || computedFinal || null,
    };
    const r = await fetch(`${API}/final-prices/`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (r.ok) { onSaved(skuId); }
    else { const d = await r.json(); setErr(d.detail || d.sku_id?.[0] || "Save failed"); }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 800, fontSize: 16, pb: 1 }}>
        Add Pricing — <span style={{ fontFamily: "monospace", color: "#D97706" }}>{skuId}</span>
      </DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: "14px", pt: "12px !important" }}>
        {err && <Alert severity="error" sx={{ fontSize: 12 }}>{err}</Alert>}
        {field("item_price", "Item / Purchase Price", true)}
        {field("packaging_cost", "Packaging Cost", false)}
        {field("tax_percent", "Tax %", false, "number", "%")}
        <Box sx={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {field("final_price", "Final / Listed Price (MSP)", false)}
          {computedFinal && (
            <Tooltip title="Auto-calculated from item price + tax + packaging">
              <Button size="small" variant="outlined" sx={{ whiteSpace: "nowrap", fontSize: 11, textTransform: "none", borderRadius: "8px" }}
                onClick={() => setForm(f => ({ ...f, final_price: computedFinal }))}>
                Use {computedFinal}
              </Button>
            </Tooltip>
          )}
        </Box>
        <Typography sx={{ fontSize: 11, color: "#94A3B8" }}>
          Final price = item × (1 + tax%) + packaging · Can be overridden manually
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: "24px", pb: "16px", gap: "8px" }}>
        <Button onClick={onClose} variant="outlined" color="inherit">Cancel</Button>
        <Button onClick={handleSave} disabled={saving} variant="contained"
          sx={{ textTransform: "none", fontWeight: 700, borderRadius: "8px" }}>
          {saving ? "Saving…" : "Save Price"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function LinkToParentDialog({ skuId, onClose, onSaved }) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const timerRef = useRef(null);

  const doSearch = useCallback(async (q) => {
    if (!q || q.length < 1) { setResults([]); return; }
    setSearching(true);
    const r = await fetch(`${API}/parent-prices/?search=${encodeURIComponent(q)}`);
    if (r.ok) {
      const d = await r.json();
      setResults(d.results || []);
    }
    setSearching(false);
  }, []);

  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(search), 300);
    return () => clearTimeout(timerRef.current);
  }, [search, doSearch]);

  const handleSave = async () => {
    if (!selected) { setErr("Please select a parent."); return; }
    setSaving(true); setErr("");
    const payload = {
      sku_id: skuId,
      parent: selected.item_id,
      item_price: selected.item_price,
      packaging_cost: selected.packaging_cost,
      tax_percent: selected.tax_percent,
      final_price: selected.final_price,
    };
    const r = await fetch(`${API}/final-prices/`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (r.ok) { onSaved(skuId); }
    else { const d = await r.json(); setErr(d.detail || d.sku_id?.[0] || "Link failed"); }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800, fontSize: 16, pb: 1 }}>
        Link to Parent — <span style={{ fontFamily: "monospace", color: "#D97706" }}>{skuId}</span>
      </DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: "14px", pt: "12px !important" }}>
        {err && <Alert severity="error" sx={{ fontSize: 12 }}>{err}</Alert>}
        <Typography sx={{ fontSize: 12, color: "#64748B" }}>
          The SKU will inherit all pricing from the selected parent (item price, tax, packaging, final price). Future parent price changes will update this SKU automatically.
        </Typography>
        <TextField
          label="Search parent ID" size="small" fullWidth
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="e.g. PARENT-123"
          InputProps={{ startAdornment: <InputAdornment position="start">🔍</InputAdornment> }}
          sx={{ "& .MuiOutlinedInput-root": { borderRadius: "8px" } }}
        />
        {searching && <LinearProgress sx={{ borderRadius: 2 }} />}

        {/* Results list */}
        {results.length > 0 && (
          <Box sx={{ border: "1px solid #E2E8F0", borderRadius: "8px", overflow: "hidden" }}>
            {results.map(p => (
              <Box key={p.item_id}
                onClick={() => setSelected(p)}
                sx={{
                  px: "14px", py: "10px", cursor: "pointer",
                  background: selected?.item_id === p.item_id ? "#EFF6FF" : "#fff",
                  borderLeft: `3px solid ${selected?.item_id === p.item_id ? "#2563EB" : "transparent"}`,
                  borderBottom: "1px solid #F1F5F9",
                  "&:hover": { background: "#F8FAFC" },
                  "&:last-child": { borderBottom: 0 },
                }}
              >
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
                  <Typography sx={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13, color: "#0F172A" }}>
                    {p.item_id}
                  </Typography>
                  <Box sx={{ display: "flex", gap: "10px", fontSize: 12, color: "#64748B" }}>
                    {p.item_price != null && <span>Cost: <strong>₹{p.item_price}</strong></span>}
                    {p.final_price != null && <span>MSP: <strong>₹{p.final_price}</strong></span>}
                    {p.tax_percent != null && <span>Tax: <strong>{p.tax_percent}%</strong></span>}
                    {p.packaging_cost != null && <span>Pkg: <strong>₹{p.packaging_cost}</strong></span>}
                  </Box>
                </Box>
                {p.sku_ids?.length > 0 && (
                  <Typography sx={{ fontSize: 10, color: "#94A3B8", mt: "3px" }}>
                    {p.sku_ids.length} SKU{p.sku_ids.length > 1 ? "s" : ""} linked: {p.sku_ids.slice(0, 3).join(", ")}{p.sku_ids.length > 3 ? ` +${p.sku_ids.length - 3} more` : ""}
                  </Typography>
                )}
              </Box>
            ))}
          </Box>
        )}
        {search.length > 0 && !searching && results.length === 0 && (
          <Typography sx={{ fontSize: 12, color: "#94A3B8", textAlign: "center", py: "10px" }}>No parents found for "{search}"</Typography>
        )}

        {selected && (
          <Alert severity="success" sx={{ fontSize: 12 }}>
            Selected: <strong>{selected.item_id}</strong> — pricing will be copied automatically
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ px: "24px", pb: "16px", gap: "8px" }}>
        <Button onClick={onClose} variant="outlined" color="inherit">Cancel</Button>
        <Button onClick={handleSave} disabled={saving || !selected} variant="contained" color="primary"
          sx={{ textTransform: "none", fontWeight: 700, borderRadius: "8px" }}>
          {saving ? "Linking…" : "Link to Parent"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function MissingSkuPanel({ missingSkus, ordersCount, onResolved }) {
  const [open, setOpen] = useState(true);
  const [resolved, setResolved] = useState(new Set());
  const [addDialog, setAddDialog] = useState(null); // skuId
  const [linkDialog, setLinkDialog] = useState(null); // skuId

  if (!missingSkus?.length) return null;
  const pending = missingSkus.filter(s => !resolved.has(s));
  if (pending.length === 0) return null;

  const handleSaved = (skuId) => {
    setResolved(prev => new Set([...prev, skuId]));
    setAddDialog(null);
    setLinkDialog(null);
    onResolved?.();
  };

  return (
    <>
      {addDialog && <AddPriceDialog skuId={addDialog} onClose={() => setAddDialog(null)} onSaved={handleSaved} />}
      {linkDialog && <LinkToParentDialog skuId={linkDialog} onClose={() => setLinkDialog(null)} onSaved={handleSaved} />}

      <Box sx={{ border: "1.5px solid #FDE68A", borderRadius: "12px", overflow: "hidden", mb: 0 }}>
        {/* Header */}
        <Box
          onClick={() => setOpen(o => !o)}
          sx={{
            display: "flex", alignItems: "center", gap: "10px", cursor: "pointer",
            background: "#FFFBEB", px: "16px", py: "12px", userSelect: "none"
          }}
        >
          <Typography sx={{ fontSize: 16, lineHeight: 1 }}>⚠️</Typography>
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ fontWeight: 800, fontSize: 14, color: "#92400E" }}>
              {pending.length} SKU{pending.length > 1 ? "s" : ""} missing pricing
            </Typography>
            <Typography sx={{ fontSize: 12, color: "#B45309" }}>
              {ordersCount} order{ordersCount !== 1 ? "s" : ""} excluded from profit calculations · Add a price or link to a parent SKU to fix
            </Typography>
          </Box>
          <Typography sx={{ fontSize: 12, color: "#92400E", fontWeight: 600 }}>{open ? "Hide ▲" : "Show ▼"}</Typography>
        </Box>

        {/* Table */}
        <Collapse in={open}>
          <Box sx={{ background: "#fff", borderTop: "1px solid #FDE68A", overflowX: "auto" }}>
            <Table size="small" sx={{ borderCollapse: "collapse" }}>
              <TableHead>
                <TableRow sx={{ background: "#FFF7ED" }}>
                  <TableCell sx={{ py: "8px", px: "16px", fontSize: 10, fontWeight: 700, color: "#B45309", textTransform: "uppercase", letterSpacing: "0.07em", width: "50%" }}>
                    SKU ID
                  </TableCell>
                  <TableCell sx={{ py: "8px", px: "16px", fontSize: 10, fontWeight: 700, color: "#B45309", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                    Actions
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pending.map(sku => (
                  <TableRow key={sku} sx={{ borderTop: "1px solid #FEF3C7", "&:hover": { background: "#FFFBEB" } }}>
                    <TableCell sx={{ py: "10px", px: "16px" }}>
                      <span style={{
                        fontFamily: "monospace", fontWeight: 700, fontSize: 13, color: "#D97706",
                        background: "#FEF3C7", border: "1px solid #FDE68A", borderRadius: "5px", padding: "3px 10px"
                      }}>
                        {sku}
                      </span>
                    </TableCell>
                    <TableCell sx={{ py: "8px", px: "16px" }}>
                      <Box sx={{ display: "flex", gap: "8px" }}>
                        <Button size="small" variant="contained" disableElevation
                          onClick={() => setAddDialog(sku)}
                          sx={{
                            textTransform: "none", fontWeight: 700, fontSize: 12, borderRadius: "7px",
                            background: "#059669", "&:hover": { background: "#047857" }
                          }}>
                          + Add Price
                        </Button>
                        <Button size="small" variant="outlined"
                          onClick={() => setLinkDialog(sku)}
                          sx={{
                            textTransform: "none", fontWeight: 700, fontSize: 12, borderRadius: "7px",
                            borderColor: "#2563EB", color: "#2563EB", "&:hover": { background: "#EFF6FF" }
                          }}>
                          🔗 Link to Parent
                        </Button>
                      </Box>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </Collapse>
      </Box>
    </>
  );
}

// ── Main tab ──────────────────────────────────────────────────────────────────
export function SKUAnalysisTab() {
  const { range, label, months, mode: globalMode, selectedMonth: globalMonth } = useDateFilter();
  const [allData, setAllData] = useState([]);
  const [profitSummary, setProfitSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("all");
  const [selSKU, setSelSKU] = useState(null);
  const [marginThreshold, setMarginThreshold] = useState(50);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true); setProfitSummary(null); setAllData([]);
    const params = new URLSearchParams();
    if (range.date_from) params.set("date_from", range.date_from);
    if (range.date_to) params.set("date_to", range.date_to);
    fetch(`${API}/profit/?${params}`, { signal: ctrl.signal })
      .then(r => r.json())
      .then(d => {
        setProfitSummary(d);
        const raw = d.sku_wise_profit || {};
        const prepared = Object.keys(raw)
          .filter(key => key !== "__unattributed__")
          .map(key => {
            const skuRaw = raw[key];
            const delPft = Number(skuRaw.delivered_profit || 0);
            const delQty = Number(skuRaw.delivered_quantity || 0);
            // Same reasoning as the detail view: settlement = profit + the
            // all-in cost that was deducted, not just the raw item cost.
            const delCost = Number(skuRaw.delivered_final_purchase_cost ?? skuRaw.delivered_purchase_cost ?? 0);
            const avg_profit_per_piece = delQty > 0 ? delPft / delQty : null;
            const avg_settlement_per_piece = delQty > 0 ? (delPft + delCost) / delQty : null;
            return {
              sku_id: key, ...skuRaw,
              net_profit: Number(skuRaw.net_profit ?? (delPft + Number(skuRaw.return_loss || 0) + Number(skuRaw.rto_loss || 0) + Number(skuRaw.exchange_loss || 0) + Number(skuRaw.claim_loss || 0))),
              avg_profit_per_piece,
              avg_settlement_per_piece,
            };
          }).sort((a, b) => b.net_profit - a.net_profit);
        setAllData(prepared); setLoading(false);
      })
      .catch(e => { if (e.name !== "AbortError") setLoading(false); });
    return () => ctrl.abort();
  }, [JSON.stringify(range), reloadTick]); // eslint-disable-line

  const profitRows = allData.filter(s => s.net_profit > 0);
  const lossRows = allData.filter(s => s.net_profit < 0).reverse();
  const lowMarginRows = allData
    .filter(s => s.avg_profit_per_piece !== null && s.avg_profit_per_piece < marginThreshold && (s.delivered_quantity || 0) > 0)
    .sort((a, b) => a.avg_profit_per_piece - b.avg_profit_per_piece);

  const viewData = view === "profit" ? profitRows : view === "loss" ? lossRows : view === "low-margin" ? lowMarginRows : allData;
  const chartData = [...allData].sort((a, b) => Math.abs(b.net_profit) - Math.abs(a.net_profit)).slice(0, 12);

  const VIEWS = [
    { id: "all", label: "All SKUs", count: allData.length, activeBg: "#1E3A5F", activeText: "#fff", idleBg: "#EFF6FF", idleText: "#1E3A5F", idleBorder: "#BFDBFE" },
    { id: "profit", label: "Profitable", count: profitRows.length, activeBg: "#059669", activeText: "#fff", idleBg: "#ECFDF5", idleText: "#059669", idleBorder: "#A7F3D0" },
    { id: "loss", label: "In Loss", count: lossRows.length, activeBg: "#DC2626", activeText: "#fff", idleBg: "#FFF1F2", idleText: "#DC2626", idleBorder: "#FECDD3" },
    { id: "low-margin", label: "Low Margin", count: lowMarginRows.length, activeBg: "#D97706", activeText: "#fff", idleBg: "#FFFBEB", idleText: "#D97706", idleBorder: "#FDE68A" },
  ];

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 2 }}>
        <Box>
          <Typography sx={{ fontWeight: 900, fontSize: 26, color: "#0F172A", lineHeight: 1.1 }}>SKU P&L Analysis</Typography>
          <Typography sx={{ fontSize: 13, color: "#94A3B8", mt: 0.5 }}>
            Settled orders · <strong style={{ color: "#475569" }}>{label}</strong>
          </Typography>
        </Box>

        {/* View switcher */}
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          {VIEWS.map(v => {
            const active = view === v.id;
            return (
              <Box key={v.id} onClick={() => setView(v.id)} sx={{
                display: "flex", alignItems: "center", gap: 0.75,
                px: 1.75, py: 0.875,
                bgcolor: active ? v.activeBg : v.idleBg,
                border: `1.5px solid ${active ? v.activeBg : v.idleBorder}`,
                borderRadius: "10px", cursor: "pointer",
                transition: "all 0.15s",
                "&:hover": { boxShadow: "0 2px 8px rgba(0,0,0,0.1)" },
              }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: active ? v.activeText : v.idleText }}>
                  {v.label}
                </Typography>
                <Box sx={{
                  minWidth: 22, height: 22, borderRadius: "6px",
                  bgcolor: active ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.06)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Typography sx={{ fontSize: 11, fontWeight: 800, color: active ? v.activeText : v.idleText }}>{v.count}</Typography>
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>

      {/* ── Missing SKUs panel ───────────────────────────────────────────── */}
      {!loading && (
        <MissingSkuPanel
          missingSkus={profitSummary?.missing_sku}
          ordersCount={profitSummary?.orders_missing_sku ?? 0}
          onResolved={() => setReloadTick(t => t + 1)}
        />
      )}

      {/* ── Unattributed orders panel ─────────────────────────────────────── */}
      {!loading && (profitSummary?.orders_missing_price ?? 0) > 0 && (() => {
        const uAmt = Number(profitSummary?.sku_wise_profit?.["__unattributed__"]?.net_profit ?? 0);
        const uCount = profitSummary.orders_missing_price;
        const orderNetPL = Number(profitSummary?.net_profit_loss ?? 0);
        return (
          <Box sx={{
            ...DS.card, p: 2, display: "flex", gap: 2, alignItems: "flex-start",
            border: "1px solid #FDE68A", bgcolor: "#FFFBEB",
          }}>
            <Typography sx={{ fontSize: 22, lineHeight: 1, mt: 0.25 }}>📦</Typography>
            <Box sx={{ flex: 1 }}>
              <Typography sx={{ fontSize: 14, fontWeight: 700, color: "#92400E", mb: 0.5 }}>
                Unattributed Orders — {uCount} orders with no pricing
              </Typography>
              <Typography sx={{ fontSize: 12, color: "#78350F", mb: 1.5 }}>
                These orders have settled amounts but no purchase price on record, so they can't be split into per-SKU profit.
                Their net settlement is already included in <b>Order Net P&L</b> ({fmt(orderNetPL)}) but won't appear in any SKU row.
              </Typography>
              <Box sx={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                <Box>
                  <Typography sx={{ fontSize: 11, color: "#92400E", fontWeight: 700, letterSpacing: 0.5 }}>ORDERS</Typography>
                  <Typography sx={{ fontFamily: "monospace", fontWeight: 800, fontSize: 22, color: "#92400E", lineHeight: 1.2 }}>
                    {uCount}
                  </Typography>
                </Box>
                <Box>
                  <Typography sx={{ fontSize: 11, color: "#92400E", fontWeight: 700, letterSpacing: 0.5 }}>NET SETTLEMENT</Typography>
                  <Typography sx={{ fontFamily: "monospace", fontWeight: 800, fontSize: 22, lineHeight: 1.2, color: uAmt >= 0 ? "#059669" : "#DC2626" }}>
                    {uAmt >= 0 ? "+" : ""}{fmt(uAmt)}
                  </Typography>
                </Box>
                <Box sx={{ alignSelf: "center" }}>
                  <Chip
                    label="Add pricing → Pricing tab"
                    size="small"
                    sx={{ bgcolor: "#FEF3C7", color: "#92400E", fontWeight: 700, border: "1px solid #FCD34D", cursor: "pointer" }}
                  />
                </Box>
              </Box>
            </Box>
          </Box>
        );
      })()}

      {/* ── Loading ──────────────────────────────────────────────────────── */}
      {loading && (
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", py: 10, gap: 2 }}>
          <CircularProgress sx={{ color: "#3B82F6" }} />
          <Typography sx={{ color: "#94A3B8", fontSize: 14 }}>Crunching numbers for {label}…</Typography>
        </Box>
      )}

      {!loading && allData.length === 0 && (
        <Box sx={{ ...DS.card, textAlign: "center", py: 10 }}>
          <Typography sx={{ fontSize: 44, mb: 1.5 }}>📭</Typography>
          <Typography sx={{ fontWeight: 800, fontSize: 20, mb: 0.5, color: "#0F172A" }}>No data for {label}</Typography>
          <Typography sx={{ color: "#94A3B8" }}>No settled orders with pricing found. Try All time or another month.</Typography>
        </Box>
      )}

      {!loading && allData.length > 0 && (
        <>
          <MetricsPanel data={allData} filterLabel={label} profitSummary={profitSummary} />

          {/* ── Top SKUs chart ─────────────────────────────────────────── */}
          {chartData.length > 0 && (
            <Box sx={{ ...DS.card, p: 2.5 }}>
              <Typography sx={{ fontWeight: 700, fontSize: 15, mb: 0.25 }}>
                Top {chartData.length} SKUs by Absolute Impact
              </Typography>
              <Typography sx={{ fontSize: 12, color: "#94A3B8", mb: 1.5 }}>
                Click a bar to open that SKU's full analysis · Green = profit, Red = loss
              </Typography>
              <AppBarChart
                dataset={chartData}
                indexKey="sku_id"
                series={[{ dataKey: "net_profit", label: "Net P&L" }]}
                diverging
                valueFormatter={fmt}
                height={230}
                onBarClick={(skuId) => { const sku = allData.find(s => s.sku_id === skuId); if (sku) setSelSKU(sku); }}
              />
            </Box>
          )}

          {/* ── Low Margin Panel ──────────────────────────────────────── */}
          {view === "low-margin" && (
            <LowMarginPanel rows={lowMarginRows} threshold={marginThreshold} setThreshold={setMarginThreshold} onRowClick={setSelSKU} />
          )}

          {/* ── SKU DataGrid ──────────────────────────────────────────── */}
          {view !== "low-margin" && (
            <Box sx={{ ...DS.card, overflow: "hidden" }}>
              <Box sx={{ px: 2.5, py: 1.75, borderBottom: "1px solid #E8EDF3" }}>
                <Typography sx={{ fontWeight: 700, fontSize: 15 }}>
                  {viewData.length} SKUs
                  <Typography component="span" sx={{ fontSize: 13, fontWeight: 400, color: "#94A3B8", ml: 1 }}>
                    {view === "profit" ? "— profitable" : view === "loss" ? "— in loss" : "— all"}
                  </Typography>
                </Typography>
                <Typography sx={{ fontSize: 12, color: "#94A3B8", mt: 0.25 }}>Click any row to open full P&L analysis</Typography>
              </Box>
              <SKUDataTable data={viewData} onRowClick={setSelSKU} />
            </Box>
          )}
        </>
      )}

      {selSKU && (
        <SKUDetailModal
          sku={selSKU}
          months={months}
          initialRange={range}
          initialMonth={globalMode === "month" ? globalMonth : null}
          onClose={() => setSelSKU(null)}
        />
      )}
    </Box>
  );
}
