import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import InputAdornment from "@mui/material/InputAdornment";
import LinearProgress from "@mui/material/LinearProgress";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import ClearIcon from "@mui/icons-material/Clear";
import SearchIcon from "@mui/icons-material/Search";

import { DataGrid } from "@mui/x-data-grid";
import { BarChart } from "@mui/x-charts/BarChart";

import { API, C, fmt } from "../../App";
import { UnsettledOrdersTab } from "./UnsettledOrdersTab";
import { PAGE_SIZE } from "../../lib/helper";
import { colors } from "@mui/material";
import SkuWiseChart from "../Charts/SkuWiseChart";

// ── Constants ─────────────────────────────────────────────────────────────────
const STATUS = {
  DELIVERED: { label: "Delivered", icon: "✅", color: "#059669", bg: "#ECFDF5", border: "#A7F3D0" },
  RTO_COMPLETE: { label: "RTO", icon: "🔄", color: "#E11D48", bg: "#FFF1F2", border: "#FECDD3" },
  CANCELLED: { label: "Cancelled", icon: "✕", color: "#94A3B8", bg: "#F8FAFC", border: "#E2E8F0" },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const pct = (n, t) => (t > 0 ? ((n / t) * 100).toFixed(1) : "0.0");
const card = { bgcolor: "#fff", border: "1px solid #E2E8F0", borderRadius: 3, boxShadow: "0 1px 4px rgba(0,0,0,0.05)" };

function fmtDate(v) {
  if (!v) return "—";
  const [y, m, d] = v.split("-");
  return `${d}/${m}/${y?.slice(2)}`;
}
function fmtMonthShort(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1)?.toLocaleString("en-IN", { month: "short", year: "2-digit" });
}
function monthToRange(ym) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { date_from: `${ym}-01`, date_to: `${ym}-${String(last).padStart(2, "0")}` };
}

// ── DataGrid columns ──────────────────────────────────────────────────────────
const COLUMNS = [
  {
    field: "sub_order_no", headerName: "Order No", width: 158,
    renderCell: ({ value }) => (
      <Box sx={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: C.blue, bgcolor: C.blueLight, px: 1, py: 0.3, borderRadius: 1, border: "1px solid #BFDBFE" }}>
        {value}
      </Box>
    ),
  },
  {
    field: "order_date", headerName: "Date", width: 90,
    renderCell: ({ value }) => (
      <Typography sx={{ fontSize: 12, color: C.gray500, fontFamily: "monospace" }}>{fmtDate(value)}</Typography>
    ),
  },
  {
    field: "reason_for_credit_entry", headerName: "Status", width: 128,
    renderCell: ({ value }) => {
      const s = STATUS[value] || {};
      return (
        <Chip label={`${s.icon || ""} ${s.label || value || "—"}`} size="small"
          sx={{ bgcolor: s.bg || C.gray100, color: s.color || C.gray600, fontWeight: 700, fontSize: 11, border: `1px solid ${s.border || C.gray200}` }} />
      );
    },
  },
  {
    field: "sku", headerName: "SKU", width: 145,
    renderCell: ({ value }) => value
      ? <Chip label={value} size="small" sx={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, bgcolor: C.orangeLight, color: C.orange, border: `1px solid ${C.orangeBorder}`, maxWidth: 135, "& .MuiChip-label": { overflow: "hidden", textOverflow: "ellipsis" } }} />
      : <Typography sx={{ color: C.gray300, fontSize: 12 }}>—</Typography>,
  },
  {
    field: "product_name", headerName: "Product", flex: 1, minWidth: 180,
    renderCell: ({ value }) => (
      <Tooltip title={value || ""} placement="top">
        <Typography sx={{ fontSize: 12, color: C.gray700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {value || "—"}
        </Typography>
      </Tooltip>
    ),
  },
  {
    field: "quantity", headerName: "Qty", width: 58, type: "number",
    renderCell: ({ value }) => (
      <Box sx={{ width: 26, height: 26, borderRadius: "50%", bgcolor: C.gray100, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "monospace", fontWeight: 800, fontSize: 12, color: C.gray700 }}>
        {value ?? 1}
      </Box>
    ),
  },
  {
    field: "size", headerName: "Size", width: 65,
    renderCell: ({ value }) => <Typography sx={{ fontSize: 12, color: C.gray500 }}>{value || "—"}</Typography>,
  },
  {
    field: "customer_state", headerName: "State", width: 115,
    renderCell: ({ value }) => <Typography sx={{ fontSize: 12, color: C.gray600 }}>{value || "—"}</Typography>,
  },
  {
    field: "supplier_listed_price", headerName: "MRP ₹", width: 90, type: "number",
    renderCell: ({ value }) => <Typography sx={{ fontFamily: "monospace", fontSize: 12, color: C.gray400 }}>{value != null ? fmt(value) : "—"}</Typography>,
  },
  {
    field: "supplier_discounted_price", headerName: "Sell ₹", width: 88, type: "number",
    renderCell: ({ value }) => <Typography sx={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13, color: C.gray800 }}>{value != null ? fmt(value) : "—"}</Typography>,
  },
];

// ── Main Tab ──────────────────────────────────────────────────────────────────
export function OrdersTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get("view") || "all";

  const setView = v => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (v === "all") { next.delete("view"); next.delete("month"); }
      else next.set("view", v);
      return next;
    }, { replace: true });
  };

  // ── State ────────────────────────────────────────────────────────────────────
  const [selMonth, setSelMonth] = useState(() => {
    const n = new Date();
    n.setMonth(n.getMonth() - 1);
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
  });
  const [statusFilter, setStatusFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [search, setSearch] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [analytics, setAnalytics] = useState(null);
  const [months, setMonths] = useState([]);
  const [listLoading, setListLoading] = useState(true);

  const dateRange = selMonth ? monthToRange(selMonth) : {};
  const resetPage = () => setPage(1);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => { setSearchQ(search); resetPage(); }, 380);
    return () => clearTimeout(t);
  }, [search]); // eslint-disable-line

  // ── Loaders ──────────────────────────────────────────────────────────────────
  const loadAnalytics = useCallback(async () => {
    const p = new URLSearchParams({
      ...(dateRange.date_from && { date_from: dateRange.date_from }),
      ...(dateRange.date_to && { date_to: dateRange.date_to }),
      ...(statusFilter && { status: statusFilter }),
    });
    const r = await fetch(`${API}/full-orders/analytics/?${p}`);
    if (!r.ok) return;
    const d = await r.json();
    setAnalytics(d);
    if (d.months?.length) setMonths([...d.months].sort((a, b) => b.localeCompare(a))); // descending
  }, [selMonth, statusFilter]); // eslint-disable-line

  const loadList = useCallback(async () => {
    setListLoading(true);
    const p = new URLSearchParams({
      page, page_size: PAGE_SIZE,
      ...(dateRange.date_from && { date_from: dateRange.date_from }),
      ...(dateRange.date_to && { date_to: dateRange.date_to }),
      ...(statusFilter && { status: statusFilter }),
      ...(stateFilter && { state: stateFilter }),
      ...(searchQ && { search: searchQ }),
    });
    const r = await fetch(`${API}/full-orders/?${p}`);
    if (r.ok) { const d = await r.json(); setRows(d.results); setTotal(d.total); }
    setListLoading(false);
  }, [page, selMonth, statusFilter, stateFilter, searchQ]); // eslint-disable-line

  useEffect(() => { if (view === "all") loadList(); }, [loadList, view]);
  useEffect(() => { if (view === "all") loadAnalytics(); }, [loadAnalytics, view]);

  // ── Derived ──────────────────────────────────────────────────────────────────
  const getCount = s => analytics?.by_status?.find(x => x.reason_for_credit_entry === s)?.count ?? 0;
  const totalOrders = analytics?.total ?? 0;
  const delCount = getCount("DELIVERED");
  const rtoCount = getCount("RTO_COMPLETE");
  const canCount = getCount("CANCELLED");
  const drNum = Number(pct(delCount, totalOrders));
  const drColor = drNum >= 70 ? C.green : drNum >= 45 ? C.amber : C.red;

  const topStates = analytics?.by_state?.slice(0, 6) || [];
  const topSkus = analytics?.by_sku?.slice(0, 10) || [];
  const dailyData = (analytics?.daily || []).map(d => ({ label: fmtDate(d.order_date), count: d.count }));
  const currMonth = (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`; })();
  const hasFilters = !!(statusFilter || stateFilter || searchQ || (selMonth && selMonth !== currMonth));

  const clearAll = () => {
    setStatusFilter(""); setStateFilter(""); setSearch(""); setSearchQ(""); setSelMonth(currMonth); resetPage();
  };

  // ── View toggle ──────────────────────────────────────────────────────────────
  const ViewToggle = (
    <ToggleButtonGroup value={view} exclusive onChange={(_, v) => v && setView(v)} size="small"
      sx={{ "& .MuiToggleButton-root": { textTransform: "none", fontWeight: 600, fontSize: 12, px: 2, borderRadius: "8px !important" } }}>
      <ToggleButton value="all">All Orders</ToggleButton>
      <ToggleButton value="unsettled" sx={{ color: view === "unsettled" ? "error.main" : undefined }}>
        ⚡ Unsettled
      </ToggleButton>
    </ToggleButtonGroup>
  );

  if (view === "unsettled") {
    return (
      <Stack spacing={2.5}>
        <Box display="flex" justifyContent="flex-end">{ViewToggle}</Box>
        <UnsettledOrdersTab initialMonth={searchParams.get("month")} />
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
        <Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.25 }}>
            <Typography sx={{ fontSize: 20, fontWeight: 900, color: C.gray900 }}>Orders</Typography>
            {totalOrders > 0 && (
              <Chip label={totalOrders?.toLocaleString("en-IN")} size="small"
                sx={{ bgcolor: C.gray100, color: C.gray500, fontWeight: 700, fontSize: 11, border: `1px solid ${C.gray200}` }} />
            )}
            {listLoading && <CircularProgress size={13} sx={{ color: C.orange }} />}
          </Box>
          <Typography sx={{ fontSize: 12, color: C.gray400 }}>
            {selMonth ? fmtMonthShort(selMonth) : "All time"} · order lifecycle
          </Typography>
        </Box>
        {ViewToggle}
      </Box>

      {/* ── Controls card ────────────────────────────────────────────────────── */}
      <Box sx={{ ...card, overflow: "hidden" }}>

        {/* Month row */}
        {months.length > 0 && (
          <Box sx={{ px: 2.5, pt: 1.75, pb: 1.5, borderBottom: `1px solid ${C.gray100}` }}>
            <Box sx={{
              display: "flex", alignItems: "center", gap: 0.75, overflowX: "auto",
              scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" },
            }}>
              <Typography sx={{ fontSize: 10, fontWeight: 800, color: C.gray300, letterSpacing: "0.08em", textTransform: "uppercase", flexShrink: 0, mr: 0.5 }}>
                MONTH
              </Typography>
              {[null, ...months].map(m => {
                const active = selMonth === m;
                return (
                  <Chip key={m ?? "__all__"} label={m === null ? "All" : fmtMonthShort(m)} size="small"
                    onClick={() => { setSelMonth(m); resetPage(); }}
                    sx={{
                      flexShrink: 0, height: 26, fontSize: 11,
                      fontWeight: active ? 800 : 500,
                      bgcolor: active ? C.orange : "transparent",
                      color: active ? "#fff" : C.gray500,
                      border: `1.5px solid ${active ? C.orange : C.gray200}`,
                      transition: "all 0.12s",
                      "&:hover": { borderColor: C.orange, color: active ? "#fff" : C.orange },
                    }}
                  />
                );
              })}
            </Box>
          </Box>
        )}

        {/* Filter row */}
        <Box sx={{ px: 2.5, py: 1.5, display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>

          {/* Search */}
          <TextField size="small" value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search order, product, SKU…"
            sx={{ width: 230 }}
            InputProps={{
              startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 15, color: C.gray400 }} /></InputAdornment>,
              endAdornment: search
                ? <InputAdornment position="end"><ClearIcon onClick={() => { setSearch(""); setSearchQ(""); resetPage(); }} sx={{ fontSize: 14, color: C.gray400, cursor: "pointer", "&:hover": { color: C.red } }} /></InputAdornment>
                : null,
              sx: { fontSize: 13 },
            }}
          />

          {/* Status chips */}
          <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
            {[
              { value: "", label: "All", color: C.gray700, bg: C.gray800 },
              { value: "DELIVERED", label: "✅ Delivered", color: C.green, bg: C.green },
              { value: "RTO_COMPLETE", label: "🔄 RTO", color: C.red, bg: C.red },
              { value: "CANCELLED", label: "✕ Cancelled", color: C.gray500, bg: C.gray600 },
            ].map(opt => {
              const active = statusFilter === opt.value;
              return (
                <Chip key={opt.value} label={opt.label} size="small"
                  onClick={() => { setStatusFilter(active ? "" : opt.value); resetPage(); }}
                  sx={{
                    height: 28, fontSize: 11, fontWeight: active ? 700 : 500, cursor: "pointer",
                    bgcolor: active ? opt.bg : "transparent",
                    color: active ? "#fff" : C.gray500,
                    border: `1.5px solid ${active ? opt.bg : C.gray200}`,
                    transition: "all 0.12s",
                    "&:hover": { borderColor: opt.color, color: active ? "#fff" : opt.color },
                  }}
                />
              );
            })}
          </Box>

          {/* State picker */}
          {topStates.length > 0 && (
            <Select size="small" value={stateFilter} displayEmpty
              onChange={e => { setStateFilter(e.target.value); resetPage(); }}
              sx={{ minWidth: 148, fontSize: 12, color: stateFilter ? C.gray800 : C.gray400 }}
              renderValue={v => v || "All States"}
            >
              <MenuItem value=""><em style={{ fontSize: 12 }}>All States</em></MenuItem>
              {topStates.map(s => (
                <MenuItem key={s.customer_state} value={s.customer_state}
                  sx={{ fontSize: 12, display: "flex", justifyContent: "space-between" }}>
                  {s.customer_state || "Unknown"}
                  <Typography component="span" sx={{ fontSize: 11, color: C.gray400, ml: 2 }}>{s.count}</Typography>
                </MenuItem>
              ))}
            </Select>
          )}

          {/* Clear all */}
          {hasFilters && (
            <Chip label="Clear" size="small" onDelete={clearAll} onClick={clearAll}
              sx={{ ml: "auto", bgcolor: "#FFF1F2", color: C.red, border: `1px solid #FECDD3`, fontWeight: 700, fontSize: 11 }} />
          )}
        </Box>
      </Box>

      {/* ── Metric band ──────────────────────────────────────────────────────── */}
      <Box sx={{ ...card, p: 0, display: "flex", overflow: "hidden" }}>
        {[
          { label: "Total", value: totalOrders, icon: "📦", color: C.blue, sub: selMonth ? fmtMonthShort(selMonth) : "all time", clickKey: null },
          { label: "Delivered", value: delCount, icon: "✅", color: C.green, sub: `${pct(delCount, totalOrders)}% of total`, clickKey: "DELIVERED" },
          { label: "RTO", value: rtoCount, icon: "🔄", color: C.red, sub: `${pct(rtoCount, totalOrders)}% RTO rate`, clickKey: "RTO_COMPLETE" },
          { label: "Cancelled", value: canCount, icon: "✕", color: C.gray500, sub: `${pct(canCount, totalOrders)}% cancelled`, clickKey: "CANCELLED" },
        ].map((m, i) => {
          const active = m.clickKey && statusFilter === m.clickKey;
          return (
            <Box key={m.label}
              onClick={() => m.clickKey && (setStatusFilter(active ? "" : m.clickKey), resetPage())}
              sx={{
                flex: 1, p: "18px 20px",
                borderRight: i < 3 ? `1px solid ${C.gray100}` : "none",
                cursor: m.clickKey ? "pointer" : "default",
                bgcolor: active ? m.color : "#fff",
                transition: "background 0.15s",
                "&:hover": m.clickKey ? { bgcolor: active ? m.color : `${m.color}0D` } : {},
              }}
            >
              <Typography sx={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: active ? "rgba(255,255,255,0.75)" : C.gray400, mb: 0.5 }}>
                {m.icon} {m.label}
              </Typography>
              <Typography sx={{ fontSize: 26, fontWeight: 900, fontFamily: "monospace", lineHeight: 1, color: active ? "#fff" : m.color }}>
                {typeof m.value === "number" ? m.value?.toLocaleString("en-IN") : m.value}
              </Typography>
              <Typography sx={{ fontSize: 11, color: active ? "rgba(255,255,255,0.65)" : C.gray400, mt: 0.5 }}>
                {m.sub}
              </Typography>
            </Box>
          );
        })}

        {/* Delivery rate — visual panel */}
        <Box sx={{ flex: 1, p: "18px 20px", borderLeft: `1px solid ${C.gray100}`, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", mb: 1 }}>
            <Typography sx={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.gray400 }}>
              📊 Delivery Rate
            </Typography>
            <Typography sx={{ fontSize: 22, fontWeight: 900, fontFamily: "monospace", color: drColor }}>
              {drNum}%
            </Typography>
          </Box>
          <LinearProgress variant="determinate" value={Math.min(drNum, 100)}
            sx={{ height: 8, borderRadius: 99, bgcolor: C.gray100, "& .MuiLinearProgress-bar": { bgcolor: drColor, borderRadius: 99 } }} />
          <Typography sx={{ fontSize: 11, color: C.gray400, mt: 0.75 }}>
            {drNum >= 70 ? "🟢 Healthy" : drNum >= 45 ? "🟡 Moderate" : "🔴 High RTO risk"}
          </Typography>
        </Box>
      </Box>

      {/* ── Analytics: daily chart full-width ───────────────────────────────── */}
      {analytics && dailyData.length > 0 && (
        <Box sx={{ ...card, p: 2.5 }}>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", mb: 0.5 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 700, color: C.gray800 }}>Daily Order Volume</Typography>
            <Typography sx={{ fontSize: 11, color: C.gray400 }}>{dailyData.length} active days · {selMonth ? fmtMonthShort(selMonth) : "all time"}</Typography>
          </Box>
          <BarChart
            dataset={dailyData}
            xAxis={[{
              scaleType: "band", dataKey: "label",
              tickLabelStyle: { fontSize: 9, fill: C.gray400 },
              tickInterval: (_, i) => i % Math.max(1, Math.floor(dailyData.length / 20)) === 0,
            }]}
            series={[{ dataKey: "count", label: "Orders", color: C.orange, valueFormatter: v => v?.toLocaleString("en-IN") }]}
            height={200} borderRadius={4}
            margin={{ left: 42, bottom: 34, right: 10, top: 8 }}
            slotProps={{ legend: { hidden: true } }}
          />
        </Box>
      )}

      {/* ── Analytics: states + SKU breakdown ───────────────────────────────── */}
      {analytics && (
        <Box sx={{ display: "flex", gap: 2, alignItems: "stretch" }}>

          {/* Top states */}
          {topStates.length > 0 && (
            <Box sx={{ ...card, flex: "1 1 0", p: 2 }}>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: C.gray800, mb: 1.5 }}>Top States</Typography>
              <Stack spacing={1}>
                {topStates.map(s => {
                  const p = Number(pct(s.count, totalOrders));
                  const active = stateFilter === s.customer_state;
                  return (
                    <Box key={s.customer_state}
                      onClick={() => { setStateFilter(active ? "" : s.customer_state); resetPage(); }}
                      sx={{ cursor: "pointer", px: 1, py: 0.75, borderRadius: 1.5, bgcolor: active ? `${C.orange}0D` : "transparent", "&:hover": { bgcolor: `${C.orange}08` }, transition: "background 0.1s" }}>
                      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                        <Typography sx={{ fontSize: 12, fontWeight: active ? 700 : 500, color: active ? C.orange : C.gray700 }}>
                          {s.customer_state || "Unknown"}
                        </Typography>
                        <Typography sx={{ fontSize: 11, fontFamily: "monospace", fontWeight: 700, color: C.gray500 }}>
                          {s.count?.toLocaleString()} · {p}%
                        </Typography>
                      </Box>
                      <LinearProgress variant="determinate" value={p}
                        sx={{ height: 4, borderRadius: 99, bgcolor: C.gray100, "& .MuiLinearProgress-bar": { bgcolor: active ? C.orange : "#CBD5E1", borderRadius: 99 } }} />
                    </Box>
                  );
                })}
              </Stack>
            </Box>
          )}

          {/* SKU-wise order breakdown */}
          {topSkus.length > 0 && (
            <Box sx={{ ...card, flex: "2 1 0", p: 2.5 }}>
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", mb: 0.5 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: C.gray800 }}>SKU-wise Orders</Typography>
                <Typography sx={{ fontSize: 11, color: C.gray400 }}>top {topSkus.length} SKUs</Typography>
              </Box>
              <SkuWiseChart topSkus={topSkus} />

            </Box>
          )}
        </Box>
      )}

      {/* ── DataGrid ─────────────────────────────────────────────────────────── */}
      <Box sx={{ ...card, overflow: "hidden" }}>
        <Box sx={{ px: 2.5, py: 1.5, borderBottom: `1px solid ${C.gray100}`, display: "flex", alignItems: "center", gap: 1.5 }}>
          <Typography sx={{ fontSize: 14, fontWeight: 700, color: C.gray800 }}>
            {hasFilters ? "Filtered Results" : "All Orders"}
          </Typography>
          <Chip label={total?.toLocaleString("en-IN")} size="small"
            sx={{ bgcolor: C.gray100, color: C.gray500, fontWeight: 700, fontSize: 11, border: `1px solid ${C.gray200}` }} />
          {hasFilters && (
            <Typography sx={{ fontSize: 11, color: C.amber, fontWeight: 600 }}>· filtered</Typography>
          )}
        </Box>

        <DataGrid
          rows={rows}
          columns={COLUMNS}
          getRowId={r => r.sub_order_no}
          rowCount={total}
          paginationMode="server"
          paginationModel={{ page: page - 1, pageSize: PAGE_SIZE }}
          onPaginationModelChange={({ page: p }) => setPage(p + 1)}
          pageSizeOptions={[PAGE_SIZE]}
          rowHeight={48}
          disableRowSelectionOnClick
          autoHeight
          loading={listLoading}
          getRowClassName={({ row }) => {
            if (row.reason_for_credit_entry === "DELIVERED") return "row-del";
            if (row.reason_for_credit_entry === "RTO_COMPLETE") return "row-rto";
            return "row-can";
          }}
          sx={{
            border: "none",
            "& .MuiDataGrid-columnHeaders": {
              bgcolor: C.gray50, borderBottom: `1px solid ${C.gray200}`,
              "& .MuiDataGrid-columnHeaderTitle": { fontSize: 11, fontWeight: 700, color: C.gray500, textTransform: "uppercase", letterSpacing: "0.05em" },
            },
            "& .MuiDataGrid-cell": { borderBottom: `1px solid ${C.gray100}`, alignItems: "center" },
            "& .MuiDataGrid-footerContainer": { borderTop: `1px solid ${C.gray100}` },
            "& .row-del": { borderLeft: `3px solid ${C.green}`, "&:hover": { bgcolor: "#F0FDF4 !important" } },
            "& .row-rto": { borderLeft: `3px solid ${C.red}`, "&:hover": { bgcolor: "#FFF1F2 !important" } },
            "& .row-can": { borderLeft: `3px solid ${C.gray200}`, "&:hover": { bgcolor: `${C.gray50} !important` } },
          }}
          localeText={{ noRowsLabel: "No orders — upload Orders CSV or change filters" }}
        />
      </Box>
    </Stack>
  );
}
