import React, { useState, useEffect, useMemo } from "react";
import {
  Box, Card, CardContent, Chip, Paper,
  TextField, Typography, InputAdornment, ToggleButton, ToggleButtonGroup,
} from "@mui/material";
import { DataGrid } from "@mui/x-data-grid";
import SearchIcon from "@mui/icons-material/Search";
import { API, C, fmt } from "../../App";
import { PAGE_SIZE as pageSize } from "../../lib/helper";
import { useDateFilter } from "../../contexts/DateFilterContext";

const PAGE_SIZE = pageSize;

// ── Summary card ──────────────────────────────────────────────────────────────
function SummaryCard({ title, count, value, valueLabel, color }) {
  return (
    <Card variant="outlined" sx={{ flex: "1 1 240px", borderTop: `3px solid ${color}` }}>
      <CardContent>
        <Typography variant="caption" sx={{ fontWeight: 700, color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.07em", display: "block", mb: 1 }}>
          {title}
        </Typography>
        <Typography sx={{ fontSize: 40, fontWeight: 800, fontFamily: "monospace", color, lineHeight: 1 }}>
          {(count ?? 0).toLocaleString()}
        </Typography>
        <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.75 }}>
          {valueLabel}: {fmt(value ?? 0)}
        </Typography>
      </CardContent>
    </Card>
  );
}

// ── Orders-without-payment columns ────────────────────────────────────────────
const ORDER_COLS = [
  {
    field: "order_date", headerName: "Date", width: 110,
    renderCell: ({ value }) => <Typography sx={{ fontSize: 12, color: C.gray500 }}>{value}</Typography>,
  },
  {
    field: "sub_order_no", headerName: "Sub Order No", width: 160,
    renderCell: ({ value }) => (
      <Typography sx={{ fontFamily: "monospace", fontSize: 11, color: C.blue, fontWeight: 600, bgcolor: C.blueLight, px: 0.75, py: 0.25, borderRadius: 1 }}>
        {value}
      </Typography>
    ),
  },
  {
    field: "sku", headerName: "SKU", width: 120,
    renderCell: ({ value }) => value ? (
      <Chip label={value} size="small" sx={{ fontFamily: "monospace", fontSize: 11, fontWeight: 600, bgcolor: C.orangeLight, color: C.orange }} />
    ) : <Typography sx={{ color: C.gray300 }}>—</Typography>,
  },
  {
    field: "product_name", headerName: "Product", flex: 1, minWidth: 160,
    renderCell: ({ value }) => <Typography variant="body2" noWrap sx={{ color: C.gray600, fontSize: 12 }}>{value || "—"}</Typography>,
  },
  {
    field: "reason_for_credit_entry", headerName: "Status", width: 130,
    renderCell: ({ value }) => (
      <Chip label={value || "—"} size="small"
        sx={{
          fontWeight: 600, fontSize: 11,
          bgcolor: value === "DELIVERED" ? "#D1FAE5" : value === "SHIPPED" ? "#DBEAFE" : "#FEE2E2",
          color:   value === "DELIVERED" ? "#065F46" : value === "SHIPPED" ? "#1E40AF" : "#991B1B",
        }} />
    ),
  },
  {
    field: "supplier_discounted_price", headerName: "Order Value", width: 120, type: "number",
    renderCell: ({ value }) => (
      <Typography sx={{ fontFamily: "monospace", fontWeight: 600, color: "warning.main", fontSize: 13 }}>{fmt(value)}</Typography>
    ),
  },
  {
    field: "customer_state", headerName: "State", width: 110,
    renderCell: ({ value }) => <Typography sx={{ fontSize: 12, color: C.gray500 }}>{value || "—"}</Typography>,
  },
];

// ── Payments-without-order columns ────────────────────────────────────────────
const PAYMENT_COLS = [
  {
    field: "order_date", headerName: "Date", width: 110,
    valueFormatter: (v) => (v || "").slice(0, 10),
  },
  {
    field: "sub_order_no", headerName: "Sub Order No", width: 160,
    renderCell: ({ value }) => (
      <Typography sx={{ fontFamily: "monospace", fontSize: 11, color: C.blue, fontWeight: 600, bgcolor: C.blueLight, px: 0.75, py: 0.25, borderRadius: 1 }}>
        {value}
      </Typography>
    ),
  },
  {
    field: "supplier_sku", headerName: "SKU", width: 120,
    renderCell: ({ value }) => value ? (
      <Chip label={value} size="small" sx={{ fontFamily: "monospace", fontSize: 11, fontWeight: 600, bgcolor: C.orangeLight, color: C.orange }} />
    ) : <Typography sx={{ color: C.gray300 }}>—</Typography>,
  },
  {
    field: "product_name", headerName: "Product", flex: 1, minWidth: 160,
    renderCell: ({ value }) => <Typography variant="body2" noWrap sx={{ color: C.gray600, fontSize: 12 }}>{value || "—"}</Typography>,
  },
  {
    field: "live_order_status", headerName: "Status", width: 130,
    renderCell: ({ value }) => <Chip label={value || "—"} size="small" sx={{ fontWeight: 600, fontSize: 11 }} />,
  },
  {
    field: "final_settlement_amount", headerName: "Settlement", width: 120, type: "number",
    renderCell: ({ value }) => {
      const n = Number(value || 0);
      return <Typography sx={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13, color: n < 0 ? C.red : C.green }}>{fmt(n)}</Typography>;
    },
  },
  {
    field: "total_sale_amount", headerName: "Sale Amount", width: 120, type: "number",
    renderCell: ({ value }) => <Typography sx={{ fontFamily: "monospace", fontSize: 13 }}>{fmt(value)}</Typography>,
  },
];

// ── Main component ────────────────────────────────────────────────────────────
export function MismatchTab() {
  const { range: activeRange, label: filterLabel } = useDateFilter();
  const [view,        setView]        = useState("orders");  // "orders" | "payments"
  const [page,        setPage]        = useState(0);
  const [search,      setSearch]      = useState("");
  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(true);

  useEffect(() => { setPage(0); }, [JSON.stringify(activeRange), search, view]);

  const queryKey = useMemo(
    () => JSON.stringify({ activeRange, page, search, view }),
    [activeRange, page, search, view],
  );

  useEffect(() => {
    setLoading(true);
    const params = { ...activeRange, page: page + 1, page_size: PAGE_SIZE, view };
    if (search) params.search = search;
    fetch(`${API}/orders/payment-mismatch/?${new URLSearchParams(params)}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [queryKey]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
      {/* Header */}
      <Box>
        <Typography variant="h6" sx={{ fontWeight: 800, color: C.gray800, mb: 0.5 }}>
          Payment ↔ Order Mismatch
        </Typography>
        <Typography variant="body2" sx={{ color: C.gray400 }}>
          Identify gaps: orders with no payment record, and payments with no matching order.
        </Typography>
      </Box>

      {/* Summary cards */}
      {data && (
        <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
          <SummaryCard
            title="Orders Without Payment" color={C.red}
            count={data.orders_no_payment?.count}
            value={data.orders_no_payment?.total_value}
            valueLabel="At-risk value"
          />
          <SummaryCard
            title="Payments Without Order" color={C.amber}
            count={data.payments_no_order?.count}
            value={data.payments_no_order?.total_settlement}
            valueLabel="Settlement amount"
          />
        </Box>
      )}

      {/* View toggle + search */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
        <ToggleButtonGroup exclusive size="small" value={view} onChange={(_, v) => v && setView(v)}>
          <ToggleButton value="orders">
            Orders without Payment ({data?.orders_no_payment?.count ?? "…"})
          </ToggleButton>
          <ToggleButton value="payments">
            Payments without Order ({data?.payments_no_order?.count ?? "…"})
          </ToggleButton>
        </ToggleButtonGroup>
        <TextField
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search order no, SKU…"
          size="small"
          sx={{ width: 260 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" sx={{ color: "text.disabled" }} />
              </InputAdornment>
            ),
          }}
        />
      </Box>

      {/* DataGrid */}
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
        <Box sx={{ p: "10px 20px 8px", borderBottom: `1px solid ${C.border}` }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, color: C.gray800 }}>
            {view === "orders" ? "Orders without Payment" : "Payments without Order"}
            {" — "}{filterLabel}
            {data ? ` — ${data.total.toLocaleString()} total` : ""}
          </Typography>
        </Box>
        <DataGrid
          rows={data?.results ?? []}
          columns={view === "orders" ? ORDER_COLS : PAYMENT_COLS}
          getRowId={(row) => row.sub_order_no + (row.payment_date || "") + (row.live_order_status || "")}
          rowHeight={52}
          loading={loading}
          autoHeight
          paginationMode="server"
          rowCount={data?.total ?? 0}
          paginationModel={{ page, pageSize: PAGE_SIZE }}
          onPaginationModelChange={(m) => setPage(m.page)}
          pageSizeOptions={[PAGE_SIZE]}
          disableRowSelectionOnClick
          sx={{
            border: 0,
            borderTop: `1px solid ${C.border}`,
            "& .MuiDataGrid-columnHeaders": { bgcolor: C.gray50 },
            "& .MuiDataGrid-cell": { alignItems: "center" },
            "& .MuiDataGrid-overlayWrapper": { minHeight: 120 },
          }}
          localeText={{ noRowsLabel: "No mismatches found for this period" }}
        />
      </Paper>
    </Box>
  );
}
