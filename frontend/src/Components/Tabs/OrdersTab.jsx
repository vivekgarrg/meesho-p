import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import InputAdornment from "@mui/material/InputAdornment";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import SearchIcon from "@mui/icons-material/Search";
import { DataGrid } from "@mui/x-data-grid";
import { BarChart } from "@mui/x-charts/BarChart";

import { API, C, fmt } from "../../App";
import { DateRangePicker } from "../shared/DateRangePicker";
import { UnsettledOrdersTab } from "./UnsettledOrdersTab";
import { PAGE_SIZE } from "../../lib/helper";

const ORDER_STATUSES = ["DELIVERED", "RTO_COMPLETE", "CANCELLED"];

const STATUS_META = {
  DELIVERED:    { color: "#059669", bg: "#ECFDF5", label: "Delivered", icon: "✅" },
  RTO_COMPLETE: { color: "#E11D48", bg: "#FFF1F2", label: "RTO",       icon: "🔄" },
  CANCELLED:    { color: "#94A3B8", bg: "#F1F5F9", label: "Cancelled", icon: "✕" },
};

// ── KPI card ──────────────────────────────────────────────────────────────────
function KPICard({ icon, label, count, sub, color, bg }) {
  return (
    <Paper variant="outlined" sx={{
      flex: "1 1 160px",
      p: "16px 20px",
      borderRadius: 3,
      borderTop: `3px solid ${color}`,
      background: bg || "#fff",
      position: "relative",
      overflow: "hidden",
    }}>
      <Box sx={{ position: "absolute", right: -8, top: -8, width: 52, height: 52, borderRadius: "50%", bgcolor: color, opacity: 0.08 }} />
      <Typography sx={{ fontSize: 11, fontWeight: 700, color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.75, display: "flex", alignItems: "center", gap: 0.5 }}>
        {icon && <span>{icon}</span>}{label}
      </Typography>
      <Typography sx={{ fontSize: 28, fontWeight: 800, fontFamily: "monospace", color, lineHeight: 1.1 }}>
        {count.toLocaleString("en-IN")}
      </Typography>
      {sub && (
        <Typography variant="caption" sx={{ color: "text.disabled", mt: 0.5, display: "block" }}>
          {sub}
        </Typography>
      )}
    </Paper>
  );
}

// ── DataGrid columns ──────────────────────────────────────────────────────────
const COLUMNS = [
  {
    field: "sub_order_no", headerName: "Sub Order No", width: 158,
    renderCell: ({ value }) => (
      <Typography sx={{ fontFamily: "monospace", fontSize: 11, color: C.blue, fontWeight: 600, bgcolor: C.blueLight, px: 0.75, py: 0.25, borderRadius: 1 }}>
        {value}
      </Typography>
    ),
  },
  {
    field: "order_date", headerName: "Order Date", width: 110,
    renderCell: ({ value }) => (
      <Typography variant="body2" sx={{ color: C.gray500, fontSize: 12 }}>{value || "—"}</Typography>
    ),
  },
  {
    field: "reason_for_credit_entry", headerName: "Status", width: 140,
    renderCell: ({ value }) => {
      const m = STATUS_META[value] || {};
      return (
        <Chip label={value || "—"} size="small" sx={{
          bgcolor: m.bg || C.gray100, color: m.color || C.gray600,
          fontWeight: 700, fontSize: 11, border: `1px solid ${m.color || C.gray300}22`,
        }} />
      );
    },
  },
  {
    field: "sku", headerName: "SKU", width: 140,
    renderCell: ({ value }) => value ? (
      <Chip label={value} size="small" sx={{ fontFamily: "monospace", fontSize: 11, fontWeight: 600, bgcolor: C.orangeLight, color: C.orange, border: `1px solid ${C.orangeBorder}` }} />
    ) : <Typography variant="body2" sx={{ color: C.gray300 }}>—</Typography>,
  },
  {
    field: "size", headerName: "Size", width: 70,
    renderCell: ({ value }) => <Typography variant="body2" sx={{ color: C.gray500 }}>{value || "—"}</Typography>,
  },
  {
    field: "product_name", headerName: "Product Name", flex: 1, minWidth: 160,
    renderCell: ({ value }) => (
      <Typography variant="body2" noWrap title={value || ""} sx={{ color: C.gray700, fontSize: 12 }}>{value || "—"}</Typography>
    ),
  },
  {
    field: "quantity", headerName: "Qty", type: "number", width: 65,
    renderCell: ({ value }) => <Typography sx={{ fontFamily: "monospace", fontWeight: 600, fontSize: 13 }}>{value ?? 1}</Typography>,
  },
  {
    field: "customer_state", headerName: "State", width: 120,
    renderCell: ({ value }) => <Typography variant="body2" sx={{ color: C.gray500, fontSize: 12 }}>{value || "—"}</Typography>,
  },
  {
    field: "supplier_listed_price", headerName: "Listed ₹", type: "number", width: 110,
    renderCell: ({ value }) => <Typography sx={{ fontFamily: "monospace", fontSize: 12, color: C.gray600 }}>{fmt(value)}</Typography>,
  },
  {
    field: "supplier_discounted_price", headerName: "Discounted ₹", type: "number", width: 120,
    renderCell: ({ value }) => <Typography sx={{ fontFamily: "monospace", fontWeight: 600, fontSize: 13 }}>{fmt(value)}</Typography>,
  },
];

// ── Main tab ──────────────────────────────────────────────────────────────────
export function OrdersTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get("view") || "all";

  const setView = (v) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (v === "all") { next.delete("view"); next.delete("month"); }
      else next.set("view", v);
      return next;
    }, { replace: true });
  };

  const [data,         setData]         = useState([]);
  const [total,        setTotal]        = useState(0);
  const [page,         setPage]         = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [skuFilter,    setSkuFilter]    = useState("");
  const [dateRange,    setDateRange]    = useState({ from: "", to: "" });
  const [analytics,    setAnalytics]    = useState(null);

  const load = useCallback(async () => {
    if (view !== "all") return;
    const params = new URLSearchParams({
      page, page_size: PAGE_SIZE,
      ...(statusFilter && { status: statusFilter }),
      ...(skuFilter    && { sku: skuFilter }),
      ...(dateRange.from && { date_from: dateRange.from }),
      ...(dateRange.to   && { date_to: dateRange.to }),
    });
    const r = await fetch(`${API}/full-orders/?${params}`);
    if (r.ok) { const d = await r.json(); setData(d.results); setTotal(d.total); }
  }, [view, page, statusFilter, skuFilter, dateRange]);

  const loadAnalytics = useCallback(async () => {
    if (view !== "all") return;
    const params = new URLSearchParams({
      ...(dateRange.from && { date_from: dateRange.from }),
      ...(dateRange.to   && { date_to: dateRange.to }),
    });
    const r = await fetch(`${API}/full-orders/analytics/?${params}`);
    if (r.ok) setAnalytics(await r.json());
  }, [view, dateRange]);

  useEffect(() => { load(); loadAnalytics(); }, [load, loadAnalytics]);

  const handleDateChange = (range) => { setDateRange(range); setPage(1); };

  // ── Derived counts ────────────────────────────────────────────────────────
  const getCount = (status) =>
    analytics?.by_status?.find((s) => s.reason_for_credit_entry === status)?.count ?? 0;
  const totalOrders    = analytics?.total ?? 0;
  const deliveredCount = getCount("DELIVERED");
  const rtoCount       = getCount("RTO_COMPLETE");
  const cancelledCount = getCount("CANCELLED");
  const pct = (n) => totalOrders > 0 ? `${((n / totalOrders) * 100).toFixed(1)}%` : "—";

  // ── View toggle ───────────────────────────────────────────────────────────
  const ViewToggle = (
    <ToggleButtonGroup value={view} exclusive onChange={(_, v) => v && setView(v)} size="small">
      <ToggleButton value="all" sx={{ textTransform: "none", fontWeight: 600, fontSize: 12 }}>All Orders</ToggleButton>
      <ToggleButton value="unsettled" sx={{ textTransform: "none", fontWeight: 600, fontSize: 12, color: view === "unsettled" ? "error.main" : undefined }}>
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
    <Stack spacing={2.5}>
      {/* ── Header row ───────────────────────────────────────────────────── */}
      <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 1.5 }}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 800, color: C.gray800, mb: 0.25 }}>Orders</Typography>
          <Typography variant="body2" sx={{ color: C.gray400 }}>
            Full order lifecycle — placed, delivered, returned, cancelled.
          </Typography>
        </Box>
        {ViewToggle}
      </Box>

      {/* ── KPI cards ─────────────────────────────────────────────────────── */}
      <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
        <KPICard icon="📦" label="Total Orders" count={totalOrders}    color={C.blue}    sub="all statuses" />
        <KPICard icon="✅" label="Delivered"    count={deliveredCount} color={C.green}   bg="#ECFDF5" sub={`${pct(deliveredCount)} delivery rate`} />
        <KPICard icon="🔄" label="RTO"          count={rtoCount}       color={C.red}     bg="#FFF1F2" sub={`${pct(rtoCount)} RTO rate`} />
        <KPICard icon="✕"  label="Cancelled"    count={cancelledCount} color={C.gray400} sub={pct(cancelledCount)} />
      </Box>

      {/* ── Charts row ────────────────────────────────────────────────────── */}
      {analytics && (
        <Box sx={{ display: "flex", gap: 2.25, flexWrap: "wrap" }}>
          {/* Status bar chart */}
          <Card variant="outlined" sx={{ flex: "1 1 300px", borderRadius: 3 }}>
            <CardContent>
              <Typography variant="subtitle2" fontWeight={700} color="text.secondary" gutterBottom>
                Order Status Distribution
              </Typography>
              <BarChart
                dataset={analytics.by_status}
                xAxis={[{
                  scaleType: "band", dataKey: "reason_for_credit_entry",
                  tickLabelStyle: { fontSize: 11 },
                  colorMap: {
                    type: "ordinal",
                    values: ["DELIVERED", "RTO_COMPLETE", "CANCELLED"],
                    colors: [C.green, C.red, C.gray400],
                  },
                }]}
                series={[{ dataKey: "count", label: "Orders", valueFormatter: (v) => v?.toLocaleString("en-IN") }]}
                height={220} borderRadius={6}
                margin={{ left: 52, bottom: 32, right: 10, top: 10 }}
                slotProps={{ legend: { hidden: true } }}
              />
            </CardContent>
          </Card>

          {/* Top customer states */}
          <Card variant="outlined" sx={{ flex: "1 1 280px", borderRadius: 3 }}>
            <CardContent>
              <Typography variant="subtitle2" fontWeight={700} color="text.secondary" gutterBottom>
                Top Customer States
              </Typography>
              <Box sx={{ overflowY: "auto", maxHeight: 200 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700, fontSize: 11, bgcolor: C.gray50 }}>State</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700, fontSize: 11, bgcolor: C.gray50 }}>Orders</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700, fontSize: 11, bgcolor: C.gray50 }}>Share</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(analytics.by_state || []).map((s) => (
                      <TableRow key={s.customer_state} hover>
                        <TableCell sx={{ fontSize: 12 }}>{s.customer_state || "—"}</TableCell>
                        <TableCell align="right" sx={{ fontFamily: "monospace", fontWeight: 600, fontSize: 12 }}>
                          {s.count.toLocaleString("en-IN")}
                        </TableCell>
                        <TableCell align="right" sx={{ color: "text.secondary", fontSize: 12 }}>
                          {totalOrders > 0 ? `${((s.count / totalOrders) * 100).toFixed(1)}%` : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            </CardContent>
          </Card>
        </Box>
      )}

      {/* ── Orders table + filters ────────────────────────────────────────── */}
      <Card variant="outlined" sx={{ borderRadius: 3 }}>
        <CardContent>
          <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2} flexWrap="wrap" gap={1}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="subtitle1" fontWeight={700} color={C.gray800}>All Orders</Typography>
              <Chip label={total.toLocaleString("en-IN")} size="small" sx={{ bgcolor: C.gray100, color: C.gray500, fontWeight: 700, fontSize: 11, border: `1px solid ${C.gray200}` }} />
            </Stack>
          </Stack>

          {/* Filter bar */}
          <Paper variant="outlined" sx={{ display: "flex", flexWrap: "wrap", gap: 1.25, alignItems: "center", p: 1.5, mb: 2, bgcolor: C.gray50, borderRadius: 2 }}>
            <DateRangePicker from={dateRange.from} to={dateRange.to} onChange={handleDateChange} />

            <Box sx={{ width: 1, height: 28, bgcolor: C.gray200 }} />

            <TextField
              size="small"
              value={skuFilter}
              onChange={(e) => { setSkuFilter(e.target.value); setPage(1); }}
              placeholder="Filter by SKU…"
              sx={{ width: 180 }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" sx={{ color: "text.disabled", fontSize: 16 }} />
                  </InputAdornment>
                ),
                style: { fontSize: 12 },
              }}
            />

            <Box sx={{ width: 1, height: 28, bgcolor: C.gray200 }} />

            <ToggleButtonGroup
              value={statusFilter} exclusive size="small"
              onChange={(_, v) => { setStatusFilter(v === null ? "" : v); setPage(1); }}
            >
              <ToggleButton value="" sx={{ fontSize: 11, px: 1.5, py: 0.5, textTransform: "none" }}>All</ToggleButton>
              {ORDER_STATUSES.map((s) => {
                const m = STATUS_META[s] || {};
                return (
                  <ToggleButton key={s} value={s} sx={{
                    fontSize: 11, px: 1.5, py: 0.5, textTransform: "none",
                    "&.Mui-selected": { bgcolor: m.color, color: "#fff", "&:hover": { bgcolor: m.color, opacity: 0.9 } },
                  }}>
                    {m.label || s}
                  </ToggleButton>
                );
              })}
            </ToggleButtonGroup>
          </Paper>

          {/* DataGrid */}
          <DataGrid
            rows={data}
            columns={COLUMNS}
            getRowId={(row) => row.sub_order_no}
            rowCount={total}
            paginationMode="server"
            paginationModel={{ page: page - 1, pageSize: PAGE_SIZE }}
            onPaginationModelChange={({ page: p }) => setPage(p + 1)}
            pageSizeOptions={[PAGE_SIZE]}
            rowHeight={52}
            disableRowSelectionOnClick
            autoHeight
            sx={{
              border: `1px solid ${C.border}`,
              borderRadius: 2,
              "& .MuiDataGrid-columnHeaders": {
                bgcolor: C.gray50,
                "& .MuiDataGrid-columnHeaderTitle": { fontSize: 11, fontWeight: 700, color: C.gray500, textTransform: "uppercase", letterSpacing: "0.06em" },
              },
              "& .MuiDataGrid-row:hover": { bgcolor: "#F0F7FF" },
              "& .MuiDataGrid-cell": { borderBottom: `1px solid ${C.gray100}`, alignItems: "center" },
              "& .MuiDataGrid-footerContainer": { borderTop: `1px solid ${C.gray100}` },
            }}
            localeText={{ noRowsLabel: "No orders found — upload Orders CSV first" }}
          />
        </CardContent>
      </Card>
    </Stack>
  );
}
