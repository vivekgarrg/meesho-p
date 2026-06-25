import React, { useCallback, useEffect, useState } from "react";
import {
  Box, Card, CardContent, Chip, Paper, Stack,
  TextField, ToggleButton, ToggleButtonGroup, Typography,
} from "@mui/material";
import InputAdornment from "@mui/material/InputAdornment";
import SearchIcon from "@mui/icons-material/Search";
import { DataGrid } from "@mui/x-data-grid";

import { API, C, fmt, STATUS_COLORS } from "../../App";
import { DateRangePicker } from "../shared/DateRangePicker";
import { PAGE_SIZE } from "../../lib/helper";

const PAYMENT_STATUSES = ["DELIVERED", "RTO", "RETURN", "PENDING", "CANCELLED"];

// ── Status chip ───────────────────────────────────────────────────────────────
function StatusChip({ status }) {
  const s = (status || "").toUpperCase();
  const color = STATUS_COLORS[s] || C.gray400;
  return (
    <Chip
      label={status || "—"}
      size="small"
      sx={{ bgcolor: color, color: "#fff", fontWeight: 700, fontSize: 11, height: 22, borderRadius: "11px" }}
    />
  );
}

// ── KPI card ──────────────────────────────────────────────────────────────────
function KPICard({ label, value, isAmount, color, bg, sub }) {
  const displayValue = isAmount ? fmt(value) : (value ?? 0).toLocaleString("en-IN");
  const numVal = Number(value ?? 0);
  const resolvedColor = color ?? (numVal < 0 ? C.red : numVal > 0 ? C.green : C.gray800);
  return (
    <Paper variant="outlined" sx={{
      flex: "1 1 170px", p: "16px 20px", borderRadius: 3,
      borderTop: `3px solid ${resolvedColor}`,
      background: bg || "#fff",
      position: "relative", overflow: "hidden",
    }}>
      <Box sx={{ position: "absolute", right: -8, top: -8, width: 52, height: 52, borderRadius: "50%", bgcolor: resolvedColor, opacity: 0.07 }} />
      <Typography sx={{ fontSize: 11, fontWeight: 700, color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.75 }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: isAmount ? 22 : 28, fontWeight: 800, fontFamily: "monospace", color: resolvedColor, lineHeight: 1.1 }}>
        {displayValue}
      </Typography>
      {sub && (
        <Typography variant="caption" sx={{ color: "text.disabled", mt: 0.5, display: "block" }}>{sub}</Typography>
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
    valueFormatter: (value) => (value || "").slice(0, 10),
    renderCell: ({ value }) => (
      <Typography variant="body2" sx={{ color: C.gray500, fontSize: 12 }}>{(value || "").slice(0, 10) || "—"}</Typography>
    ),
  },
  {
    field: "supplier_sku", headerName: "SKU", width: 130,
    renderCell: ({ value }) => value ? (
      <Chip label={value} size="small" sx={{ fontFamily: "monospace", fontWeight: 600, fontSize: 11, bgcolor: C.orangeLight, color: C.orange, border: `1px solid ${C.orangeBorder}` }} />
    ) : (
      <Typography variant="caption" sx={{ color: C.gray300 }}>—</Typography>
    ),
  },
  {
    field: "product_name", headerName: "Product Name", flex: 1, minWidth: 160,
    renderCell: ({ value }) => (
      <Typography variant="body2" noWrap title={value || ""} sx={{ color: C.gray600, fontSize: 12 }}>{value || "—"}</Typography>
    ),
  },
  {
    field: "live_order_status", headerName: "Status", width: 120,
    renderCell: ({ value }) => <StatusChip status={value} />,
  },
  {
    field: "quantity", headerName: "Qty", width: 60, align: "center", headerAlign: "center",
    renderCell: ({ value }) => (
      <Typography sx={{ fontFamily: "monospace", fontWeight: 600, fontSize: 13 }}>{value ?? 1}</Typography>
    ),
  },
  {
    field: "total_sale_amount", headerName: "Sale ₹", width: 120, align: "right", headerAlign: "right",
    renderCell: ({ value }) => (
      <Typography sx={{ fontFamily: "monospace", fontSize: 13, color: C.gray700 }}>{fmt(value)}</Typography>
    ),
  },
  {
    field: "final_settlement_amount", headerName: "Settlement ₹", width: 130, align: "right", headerAlign: "right",
    renderCell: ({ value }) => {
      const n = Number(value || 0);
      return (
        <Typography sx={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13, color: n < 0 ? C.red : C.green }}>
          {fmt(n)}
        </Typography>
      );
    },
  },
  {
    field: "meesho_commission_incl_gst", headerName: "Commission", width: 120, align: "right", headerAlign: "right",
    renderCell: ({ value }) => (
      <Typography sx={{ fontFamily: "monospace", fontSize: 13, color: C.orange }}>{fmt(value)}</Typography>
    ),
  },
  {
    field: "claims", headerName: "Claims ₹", width: 100, align: "right", headerAlign: "right",
    renderCell: ({ value }) => {
      const n = Number(value || 0);
      return (
        <Typography sx={{ fontFamily: "monospace", fontSize: 13, color: n > 0 ? C.amber : C.gray300, fontWeight: n > 0 ? 700 : 400 }}>
          {n > 0 ? fmt(n) : "—"}
        </Typography>
      );
    },
  },
  {
    field: "tcs", headerName: "TCS", width: 90, align: "right", headerAlign: "right",
    renderCell: ({ value }) => (
      <Typography sx={{ fontFamily: "monospace", fontSize: 12, color: C.gray400 }}>{fmt(value)}</Typography>
    ),
  },
  {
    field: "tds", headerName: "TDS", width: 90, align: "right", headerAlign: "right",
    renderCell: ({ value }) => (
      <Typography sx={{ fontFamily: "monospace", fontSize: 12, color: C.gray400 }}>{fmt(value)}</Typography>
    ),
  },
];

// ── Main tab ──────────────────────────────────────────────────────────────────
export function PaymentsTab() {
  const [data,         setData]         = useState([]);
  const [total,        setTotal]        = useState(0);
  const [page,         setPage]         = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [skuFilter,    setSkuFilter]    = useState("");
  const [dateRange,    setDateRange]    = useState({ from: "", to: "" });
  const [stats,        setStats]        = useState(null); // payment_stats from dashboard

  // Paginated rows
  const load = useCallback(async () => {
    const params = new URLSearchParams({
      page, page_size: PAGE_SIZE,
      ...(statusFilter && { status: statusFilter }),
      ...(skuFilter    && { sku: skuFilter }),
      ...(dateRange.from && { date_from: dateRange.from }),
      ...(dateRange.to   && { date_to: dateRange.to }),
    });
    const r = await fetch(`${API}/orders/?${params}`);
    if (r.ok) { const d = await r.json(); setData(d.results); setTotal(d.total); }
  }, [page, statusFilter, skuFilter, dateRange]);

  // Aggregate stats (always matches the date range, ignores pagination)
  const loadStats = useCallback(async () => {
    const params = new URLSearchParams({
      ...(dateRange.from && { date_from: dateRange.from }),
      ...(dateRange.to   && { date_to: dateRange.to }),
    });
    const r = await fetch(`${API}/dashboard/?${params}`);
    if (r.ok) { const d = await r.json(); setStats(d.payment_stats); }
  }, [dateRange]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadStats(); }, [loadStats]);

  const handleDateChange = (range) => { setDateRange(range); setPage(1); };
  const handlePaginationModelChange = (model) => setPage(model.page + 1);

  const netSettle  = Number(stats?.total_settlement ?? 0);
  const commission = Math.abs(Number(stats?.total_commission ?? 0));

  return (
    <Stack spacing={2.5}>
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <Box>
        <Typography variant="h6" sx={{ fontWeight: 800, color: C.gray800, mb: 0.25 }}>Payments</Typography>
        <Typography variant="body2" sx={{ color: C.gray400 }}>
          Settled orders with Meesho payment data — commission, TCS/TDS, claims and net settlement.
        </Typography>
      </Box>

      {/* ── KPI cards ─────────────────────────────────────────────────────── */}
      <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
        <KPICard label="Total Payments" value={stats?.total ?? total} color={C.blue}  sub="payment records" />
        <KPICard label="Total Sale ₹"    value={stats?.total_sale}    isAmount color={C.gray800} sub="gross sale amount" />
        <KPICard
          label="Net Settlement ₹"  value={stats?.total_settlement} isAmount
          color={netSettle >= 0 ? C.green : C.red}
          bg={netSettle >= 0 ? "#ECFDF5" : "#FFF1F2"}
          sub="after all deductions"
        />
        <KPICard label="Commission ₹" value={stats?.total_commission} isAmount color={C.orange} sub="incl. GST" />
      </Box>

      {/* ── Filters ───────────────────────────────────────────────────────── */}
      <Card variant="outlined" sx={{ borderRadius: 3 }}>
        <CardContent sx={{ py: 1.5, px: 1.75, "&:last-child": { pb: 1.5 } }}>
          <Stack direction="row" flexWrap="wrap" alignItems="center" gap={1.25}>
            <DateRangePicker from={dateRange.from} to={dateRange.to} onChange={handleDateChange} />

            <Box sx={{ width: 1, height: 28, bgcolor: C.gray200 }} />

            <TextField
              size="small"
              value={skuFilter}
              onChange={(e) => { setSkuFilter(e.target.value); setPage(1); }}
              placeholder="Filter by SKU…"
              sx={{ width: 180, "& .MuiInputBase-input": { fontSize: 12 } }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" sx={{ color: "text.disabled", fontSize: 16 }} />
                  </InputAdornment>
                ),
              }}
            />

            <Box sx={{ width: 1, height: 28, bgcolor: C.gray200 }} />

            <ToggleButtonGroup
              exclusive size="small" value={statusFilter} sx={{ flexWrap: "wrap", gap: 0.5 }}
              onChange={(_, val) => { if (val !== null) { setStatusFilter(val); setPage(1); } }}
            >
              {["", ...PAYMENT_STATUSES].map((s) => {
                const isActive  = statusFilter === s;
                const baseColor = STATUS_COLORS[s] || C.gray700;
                return (
                  <ToggleButton key={s || "ALL"} value={s} sx={{
                    px: 1.5, py: 0.5, fontSize: 12, fontWeight: isActive ? 700 : 400,
                    borderRadius: "20px !important",
                    border: `1px solid ${isActive ? baseColor : C.gray300} !important`,
                    color: isActive ? "#fff" : C.gray600,
                    bgcolor: isActive ? baseColor : C.white,
                    textTransform: "none", lineHeight: 1.4, minWidth: "unset",
                    "&.Mui-selected": { bgcolor: baseColor, color: "#fff", "&:hover": { bgcolor: baseColor, opacity: 0.9 } },
                    "&:hover": { bgcolor: isActive ? baseColor : C.gray100, opacity: 0.92 },
                    transition: "all 0.15s",
                  }}>
                    {s || "All"}
                  </ToggleButton>
                );
              })}
            </ToggleButtonGroup>
          </Stack>
        </CardContent>
      </Card>

      {/* ── Data Grid ─────────────────────────────────────────────────────── */}
      <Paper elevation={0} sx={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 3, overflow: "hidden" }}>
        <Box sx={{ px: 2.5, py: 1.5, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 1.5 }}>
          <Typography variant="subtitle2" fontWeight={700} color={C.gray800}>
            Payment Records
          </Typography>
          <Chip
            label={total.toLocaleString("en-IN")}
            size="small"
            sx={{ bgcolor: C.gray100, color: C.gray500, fontWeight: 700, fontSize: 11, border: `1px solid ${C.gray200}` }}
          />
          <Typography variant="caption" sx={{ color: C.gray400, ml: "auto" }}>
            Showing page {page} · {PAGE_SIZE} per page
          </Typography>
        </Box>

        <DataGrid
          rows={data}
          columns={COLUMNS}
          getRowId={(row) => row.sub_order_no}
          rowHeight={52}
          disableRowSelectionOnClick
          paginationMode="server"
          rowCount={total}
          paginationModel={{ page: page - 1, pageSize: PAGE_SIZE }}
          onPaginationModelChange={handlePaginationModelChange}
          pageSizeOptions={[PAGE_SIZE]}
          localeText={{ noRowsLabel: "No payment records found" }}
          sx={{
            border: 0,
            fontSize: 13,
            "& .MuiDataGrid-columnHeaders": {
              bgcolor: C.gray50,
              borderBottom: `1px solid ${C.border}`,
              "& .MuiDataGrid-columnHeaderTitle": { fontSize: 11, fontWeight: 700, color: C.gray500, textTransform: "uppercase", letterSpacing: "0.06em" },
            },
            "& .MuiDataGrid-row:hover": { bgcolor: "#F0F7FF" },
            "& .MuiDataGrid-cell": { borderBottom: `1px solid ${C.gray100}`, color: C.gray700, display: "flex", alignItems: "center" },
            "& .MuiDataGrid-footerContainer": { borderTop: `1px solid ${C.gray100}` },
          }}
        />
      </Paper>
    </Stack>
  );
}
