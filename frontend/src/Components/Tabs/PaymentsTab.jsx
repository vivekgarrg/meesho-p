import React, { useCallback, useEffect, useState } from "react";
import {
  Box,
  Card,
  CardContent,
  Chip,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { DataGrid } from "@mui/x-data-grid";

import { API, C, fmt, STATUS_COLORS } from "../../App";
import { DateRangePicker } from "../shared/DateRangePicker";
import { PAGE_SIZE } from "../../lib/helper";

const PAYMENT_STATUSES = ["DELIVERED", "RTO", "RETURN", "PENDING", "CANCELLED"];

// Map STATUS_COLORS hex values to MUI Chip color-like sx overrides
function StatusChip({ status }) {
  const s = (status || "").toUpperCase();
  const bg = STATUS_COLORS[s] || C.gray400;
  return (
    <Chip
      label={status || "—"}
      size="small"
      sx={{
        bgcolor: bg,
        color: "#fff",
        fontWeight: 700,
        fontSize: 11,
        height: 22,
        borderRadius: "11px",
      }}
    />
  );
}

const columns = [
  {
    field: "sub_order_no",
    headerName: "Sub Order No",
    width: 150,
    renderCell: ({ value }) => (
      <Typography
        variant="caption"
        sx={{ fontFamily: "monospace", color: C.gray400, fontSize: 11 }}
      >
        …{(value || "").slice(-12)}
      </Typography>
    ),
  },
  {
    field: "order_date",
    headerName: "Order Date",
    width: 110,
    valueFormatter: (value) => (value || "").slice(0, 10),
    cellClassName: "cell-date",
  },
  {
    field: "supplier_sku",
    headerName: "SKU",
    width: 130,
    renderCell: ({ value }) =>
      value ? (
        <Chip
          label={value}
          size="small"
          color="primary"
          sx={{ fontFamily: "monospace", fontWeight: 600, fontSize: 11, height: 22 }}
        />
      ) : (
        <Typography variant="caption" sx={{ color: C.gray300 }}>
          —
        </Typography>
      ),
  },
  {
    field: "product_name",
    headerName: "Product Name",
    flex: 1,
    minWidth: 160,
    renderCell: ({ value }) => (
      <Typography
        variant="body2"
        noWrap
        title={value || ""}
        sx={{ color: C.gray600, fontSize: 13 }}
      >
        {value || "—"}
      </Typography>
    ),
  },
  {
    field: "live_order_status",
    headerName: "Status",
    width: 120,
    renderCell: ({ value }) => <StatusChip status={value} />,
  },
  {
    field: "quantity",
    headerName: "Qty",
    width: 60,
    align: "center",
    headerAlign: "center",
    valueFormatter: (value) => value ?? 1,
  },
  {
    field: "total_sale_amount",
    headerName: "Sale Amount",
    width: 120,
    align: "right",
    headerAlign: "right",
    renderCell: ({ value }) => (
      <Typography variant="body2" sx={{ fontFamily: "monospace", fontSize: 13 }}>
        {fmt(value)}
      </Typography>
    ),
  },
  {
    field: "final_settlement_amount",
    headerName: "Settlement",
    width: 120,
    align: "right",
    headerAlign: "right",
    renderCell: ({ value }) => {
      const n = Number(value || 0);
      return (
        <Typography
          variant="body2"
          sx={{
            fontFamily: "monospace",
            fontWeight: 700,
            fontSize: 13,
            color: n < 0 ? C.red : C.green,
          }}
        >
          {fmt(n)}
        </Typography>
      );
    },
  },
  {
    field: "meesho_commission_incl_gst",
    headerName: "Commission",
    width: 120,
    align: "right",
    headerAlign: "right",
    renderCell: ({ value }) => (
      <Typography
        variant="body2"
        sx={{ fontFamily: "monospace", fontSize: 13, color: C.red }}
      >
        {fmt(value)}
      </Typography>
    ),
  },
  {
    field: "claims",
    headerName: "Claims",
    width: 100,
    align: "right",
    headerAlign: "right",
    renderCell: ({ value }) => {
      const n = Number(value || 0);
      return (
        <Typography
          variant="body2"
          sx={{
            fontFamily: "monospace",
            fontSize: 13,
            color: n > 0 ? C.amber : C.gray400,
          }}
        >
          {n > 0 ? fmt(n) : "—"}
        </Typography>
      );
    },
  },
  {
    field: "tcs",
    headerName: "TCS",
    width: 100,
    align: "right",
    headerAlign: "right",
    renderCell: ({ value }) => (
      <Typography
        variant="body2"
        sx={{ fontFamily: "monospace", fontSize: 13, color: C.gray500 }}
      >
        {fmt(value)}
      </Typography>
    ),
  },
  {
    field: "tds",
    headerName: "TDS",
    width: 100,
    align: "right",
    headerAlign: "right",
    renderCell: ({ value }) => (
      <Typography
        variant="body2"
        sx={{ fontFamily: "monospace", fontSize: 13, color: C.gray500 }}
      >
        {fmt(value)}
      </Typography>
    ),
  },
];

export function PaymentsTab() {
  const [data, setData] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [skuFilter, setSkuFilter] = useState("");
  const [dateRange, setDateRange] = useState({ from: "", to: "" });

  const load = useCallback(async () => {
    const params = new URLSearchParams({
      page,
      page_size: PAGE_SIZE,
      ...(statusFilter && { status: statusFilter }),
      ...(skuFilter && { sku: skuFilter }),
      ...(dateRange.from && { date_from: dateRange.from }),
      ...(dateRange.to && { date_to: dateRange.to }),
    });
    const r = await fetch(`${API}/orders/?${params}`);
    if (r.ok) {
      const d = await r.json();
      setData(d.results);
      setTotal(d.total);
    }
  }, [page, statusFilter, skuFilter, dateRange]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDateChange = (range) => {
    setDateRange(range);
    setPage(1);
  };

  const handlePaginationModelChange = (model) => {
    setPage(model.page + 1);
  };

  return (
    <Paper
      elevation={0}
      sx={{
        background: C.white,
        border: `1px solid ${C.border}`,
        borderRadius: 4,
        p: 3,
        boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.06)",
      }}
    >
      {/* Header */}
      <Stack
        direction="row"
        alignItems="center"
        spacing={1.5}
        sx={{ mb: 2 }}
      >
        <Typography variant="subtitle1" fontWeight={700} color={C.gray800}>
          Payments (Settled Orders)
        </Typography>
        <Chip
          label={total}
          size="small"
          sx={{
            bgcolor: C.gray100,
            color: C.gray500,
            fontWeight: 700,
            fontSize: 11,
            border: `1px solid ${C.gray200}`,
          }}
        />
      </Stack>

      {/* Filters */}
      <Card
        variant="outlined"
        sx={{
          mb: 2,
          background: C.gray50,
          borderColor: C.border,
          borderRadius: 2.5,
        }}
      >
        <CardContent sx={{ py: 1.5, px: 1.75, "&:last-child": { pb: 1.5 } }}>
          <Stack
            direction="row"
            flexWrap="wrap"
            alignItems="center"
            gap={1.25}
          >
            {/* Date range picker */}
            <DateRangePicker
              from={dateRange.from}
              to={dateRange.to}
              onChange={handleDateChange}
            />

            {/* Vertical divider */}
            <Box sx={{ width: 1, height: 28, bgcolor: C.gray200 }} />

            {/* SKU filter */}
            <TextField
              size="small"
              value={skuFilter}
              onChange={(e) => {
                setSkuFilter(e.target.value);
                setPage(1);
              }}
              placeholder="Filter by SKU…"
              sx={{
                width: 180,
                "& .MuiInputBase-input": { fontSize: 12 },
              }}
            />

            {/* Vertical divider */}
            <Box sx={{ width: 1, height: 28, bgcolor: C.gray200 }} />

            {/* Status toggle buttons */}
            <ToggleButtonGroup
              exclusive
              size="small"
              value={statusFilter}
              onChange={(_, val) => {
                if (val !== null) {
                  setStatusFilter(val);
                  setPage(1);
                }
              }}
              sx={{ flexWrap: "wrap", gap: 0.5 }}
            >
              {["", ...PAYMENT_STATUSES].map((s) => {
                const isSelected = statusFilter === s;
                const activeColor = STATUS_COLORS[s] || C.gray700;
                return (
                  <ToggleButton
                    key={s || "ALL"}
                    value={s}
                    sx={{
                      px: 1.5,
                      py: 0.5,
                      fontSize: 12,
                      fontWeight: isSelected ? 700 : 400,
                      borderRadius: "20px !important",
                      border: `1px solid ${isSelected ? activeColor : C.gray300} !important`,
                      color: isSelected ? "#fff" : C.gray600,
                      bgcolor: isSelected ? activeColor : C.white,
                      "&:hover": {
                        bgcolor: isSelected ? activeColor : C.gray100,
                        opacity: 0.92,
                      },
                      "&.Mui-selected": {
                        bgcolor: activeColor,
                        color: "#fff",
                        "&:hover": { bgcolor: activeColor, opacity: 0.9 },
                      },
                      transition: "all 0.15s",
                      lineHeight: 1.4,
                      minWidth: "unset",
                    }}
                  >
                    {s || "All"}
                  </ToggleButton>
                );
              })}
            </ToggleButtonGroup>
          </Stack>
        </CardContent>
      </Card>

      {/* Data Grid */}
      <Box sx={{ width: "100%" }}>
        <DataGrid
          rows={data}
          columns={columns}
          getRowId={(row) => row.sub_order_no}
          rowHeight={52}
          disableRowSelectionOnClick
          paginationMode="server"
          rowCount={total}
          paginationModel={{ page: page - 1, pageSize: PAGE_SIZE }}
          onPaginationModelChange={handlePaginationModelChange}
          pageSizeOptions={[PAGE_SIZE]}
          localeText={{
            noRowsLabel: "No payment records found",
          }}
          sx={{
            border: `1px solid ${C.border}`,
            borderRadius: 2,
            fontSize: 13,
            "& .MuiDataGrid-columnHeaders": {
              bgcolor: C.gray50,
              borderBottom: `1px solid ${C.border}`,
              "& .MuiDataGrid-columnHeaderTitle": {
                fontSize: 11,
                fontWeight: 700,
                color: C.gray500,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              },
            },
            "& .MuiDataGrid-row": {
              "&:hover": { bgcolor: "#F0F7FF" },
            },
            "& .MuiDataGrid-cell": {
              borderBottom: `1px solid ${C.gray100}`,
              color: C.gray700,
              display: "flex",
              alignItems: "center",
            },
            "& .MuiDataGrid-footerContainer": {
              borderTop: `1px solid ${C.gray100}`,
            },
          }}
        />
      </Box>
    </Paper>
  );
}
