import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Grid from "@mui/material/Grid";
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
import { DataGrid } from "@mui/x-data-grid";
import { BarChart } from "@mui/x-charts/BarChart";

import { API, C, fmt, StatCard } from "../../App";
import { DateRangePicker } from "../shared/DateRangePicker";
import { UnsettledOrdersTab } from "./UnsettledOrdersTab";
import { PAGE_SIZE } from "../../lib/helper";

const ORDER_STATUSES = ["DELIVERED", "RTO_COMPLETE", "CANCELLED"];

const STATUS_COLORS = {
  DELIVERED: "#059669",
  RTO_COMPLETE: "#E11D48",
  CANCELLED: "#94A3B8",
};

export function OrdersTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get("view") || "all";

  const setView = (v) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (v === "all") {
          next.delete("view");
          next.delete("month");
        } else {
          next.set("view", v);
        }
        return next;
      },
      { replace: true }
    );
  };

  const [data, setData] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [skuFilter, setSkuFilter] = useState("");
  const [dateRange, setDateRange] = useState({ from: "", to: "" });
  const [analytics, setAnalytics] = useState(null);

  const load = useCallback(async () => {
    if (view !== "all") return;
    const params = new URLSearchParams({
      page,
      page_size: PAGE_SIZE,
      ...(statusFilter && { status: statusFilter }),
      ...(skuFilter && { sku: skuFilter }),
      ...(dateRange.from && { date_from: dateRange.from }),
      ...(dateRange.to && { date_to: dateRange.to }),
    });
    const r = await fetch(`${API}/full-orders/?${params}`);
    if (r.ok) {
      const d = await r.json();
      setData(d.results);
      setTotal(d.total);
    }
  }, [view, page, statusFilter, skuFilter, dateRange]);

  const loadAnalytics = useCallback(async () => {
    if (view !== "all") return;
    const params = new URLSearchParams({
      ...(dateRange.from && { date_from: dateRange.from }),
      ...(dateRange.to && { date_to: dateRange.to }),
    });
    const r = await fetch(`${API}/full-orders/analytics/?${params}`);
    if (r.ok) setAnalytics(await r.json());
  }, [view, dateRange]);

  useEffect(() => {
    load();
    loadAnalytics();
  }, [load, loadAnalytics]);

  const handleDateChange = (range) => {
    setDateRange(range);
    setPage(1);
  };

  const deliveredCount =
    analytics?.by_status?.find(
      (s) => s.reason_for_credit_entry === "DELIVERED"
    )?.count ?? 0;
  const rtoCount =
    analytics?.by_status?.find(
      (s) => s.reason_for_credit_entry === "RTO_COMPLETE"
    )?.count ?? 0;
  const cancelledCount =
    analytics?.by_status?.find(
      (s) => s.reason_for_credit_entry === "CANCELLED"
    )?.count ?? 0;
  const totalOrders = analytics?.total ?? 0;
  const deliveredPct =
    totalOrders > 0
      ? ((deliveredCount / totalOrders) * 100).toFixed(1)
      : "0.0";

  // DataGrid columns
  const columns = [
    {
      field: "sub_order_no",
      headerName: "Sub Order No",
      width: 150,
      renderCell: ({ value }) => (
        <Typography
          variant="body2"
          sx={{ fontFamily: "monospace", fontSize: 11, color: "text.secondary" }}
        >
          …{value?.slice(-12)}
        </Typography>
      ),
    },
    {
      field: "order_date",
      headerName: "Order Date",
      width: 120,
      renderCell: ({ value }) => (
        <Typography variant="body2" color="text.secondary" noWrap>
          {value || "—"}
        </Typography>
      ),
    },
    {
      field: "reason_for_credit_entry",
      headerName: "Status",
      width: 140,
      renderCell: ({ value }) => (
        <Chip
          label={value || "—"}
          size="small"
          sx={{
            bgcolor: STATUS_COLORS[value] ? `${STATUS_COLORS[value]}20` : "grey.100",
            color: STATUS_COLORS[value] || "text.secondary",
            fontWeight: 600,
            fontSize: 11,
            border: `1px solid ${STATUS_COLORS[value] || "#ccc"}`,
          }}
        />
      ),
    },
    {
      field: "sku",
      headerName: "SKU",
      width: 140,
      renderCell: ({ value }) =>
        value ? (
          <Chip
            label={value}
            size="small"
            sx={{
              fontFamily: "monospace",
              fontSize: 11,
              fontWeight: 600,
              bgcolor: "#FFF7ED",
              color: "#C2410C",
              border: "1px solid #FED7AA",
            }}
          />
        ) : (
          <Typography variant="body2" color="text.disabled">
            —
          </Typography>
        ),
    },
    {
      field: "size",
      headerName: "Size",
      width: 80,
      renderCell: ({ value }) => (
        <Typography variant="body2" color="text.secondary">
          {value || "—"}
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
          color="text.secondary"
          noWrap
          title={value}
        >
          {value || "—"}
        </Typography>
      ),
    },
    {
      field: "quantity",
      headerName: "Qty",
      type: "number",
      width: 70,
      valueFormatter: (value) => value ?? 1,
    },
    {
      field: "customer_state",
      headerName: "State",
      width: 120,
      renderCell: ({ value }) => (
        <Typography variant="body2" color="text.secondary" noWrap>
          {value || "—"}
        </Typography>
      ),
    },
    {
      field: "supplier_listed_price",
      headerName: "Listed Price",
      type: "number",
      width: 120,
      valueFormatter: (value) => fmt(value),
    },
    {
      field: "supplier_discounted_price",
      headerName: "Discounted Price",
      type: "number",
      width: 140,
      valueFormatter: (value) => fmt(value),
    },
  ];

  const ViewToggle = (
    <ToggleButtonGroup
      value={view}
      exclusive
      onChange={(_, v) => v && setView(v)}
      size="small"
    >
      <ToggleButton value="all">All Orders</ToggleButton>
      <ToggleButton
        value="unsettled"
        sx={{ color: view === "unsettled" ? "error.main" : undefined }}
      >
        Unsettled
      </ToggleButton>
    </ToggleButtonGroup>
  );

  if (view === "unsettled") {
    return (
      <Stack spacing={2.5}>
        <Box display="flex" justifyContent="flex-end">
          {ViewToggle}
        </Box>
        <UnsettledOrdersTab initialMonth={searchParams.get("month")} />
      </Stack>
    );
  }

  return (
    <Stack spacing={2.5}>
      {/* View toggle */}
      <Box display="flex" justifyContent="flex-end">
        {ViewToggle}
      </Box>

      {/* Summary KPI cards */}
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.75 }}>
        <StatCard
          label="Total Orders"
          value={null}
          sub={`${totalOrders.toLocaleString()} orders`}
          accent={C.blue}
          icon="📦"
        />
        <StatCard
          label="Delivered"
          value={null}
          sub={`${deliveredCount.toLocaleString()} (${deliveredPct}%)`}
          accent={C.green}
          icon="✅"
        />
        <StatCard
          label="RTO Complete"
          value={null}
          sub={`${rtoCount.toLocaleString()} orders`}
          accent={C.red}
          icon="↩"
        />
        <StatCard
          label="Cancelled"
          value={null}
          sub={`${cancelledCount.toLocaleString()} orders`}
          accent={C.gray400}
          icon="✕"
        />
      </Box>

      {/* Charts row */}
      {analytics && (
        <Grid container spacing={2.25}>
          {/* Status distribution bar chart */}
          <Grid item xs={12} md={6}>
            <Card variant="outlined">
              <CardContent>
                <Typography
                  variant="subtitle2"
                  fontWeight={700}
                  gutterBottom
                  color="text.secondary"
                >
                  Order Status Distribution
                </Typography>
                <BarChart
                  dataset={analytics.by_status}
                  xAxis={[
                    {
                      scaleType: "band",
                      dataKey: "reason_for_credit_entry",
                      colorMap: {
                        type: "ordinal",
                        values: ["DELIVERED", "RTO_COMPLETE", "CANCELLED"],
                        colors: ["#059669", "#E11D48", "#94A3B8"],
                      },
                    },
                  ]}
                  series={[{ dataKey: "count", label: "Orders" }]}
                  height={220}
                  borderRadius={6}
                  margin={{ left: 50, bottom: 30, right: 10, top: 10 }}
                  slotProps={{ legend: { hidden: true } }}
                />
              </CardContent>
            </Card>
          </Grid>

          {/* Top customer states table */}
          <Grid item xs={12} md={6}>
            <Card variant="outlined" sx={{ height: "100%" }}>
              <CardContent>
                <Typography
                  variant="subtitle2"
                  fontWeight={700}
                  gutterBottom
                  color="text.secondary"
                >
                  Top Customer States
                </Typography>
                <Box sx={{ overflowY: "auto", maxHeight: 200 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>
                          State
                        </TableCell>
                        <TableCell
                          align="right"
                          sx={{ fontWeight: 700, fontSize: 12 }}
                        >
                          Orders
                        </TableCell>
                        <TableCell
                          align="right"
                          sx={{ fontWeight: 700, fontSize: 12 }}
                        >
                          Share
                        </TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(analytics.by_state || []).map((s) => (
                        <TableRow key={s.customer_state} hover>
                          <TableCell sx={{ fontSize: 12 }}>
                            {s.customer_state || "—"}
                          </TableCell>
                          <TableCell
                            align="right"
                            sx={{
                              fontFamily: "monospace",
                              fontWeight: 600,
                              fontSize: 12,
                            }}
                          >
                            {s.count}
                          </TableCell>
                          <TableCell
                            align="right"
                            sx={{ color: "text.secondary", fontSize: 12 }}
                          >
                            {totalOrders > 0
                              ? `${((s.count / totalOrders) * 100).toFixed(1)}%`
                              : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* Orders table with filters */}
      <Card variant="outlined">
        <CardContent>
          {/* Header */}
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            mb={2}
            flexWrap="wrap"
            gap={1}
          >
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="subtitle1" fontWeight={700}>
                All Orders
              </Typography>
              <Chip
                label={total}
                size="small"
                variant="outlined"
                sx={{ fontSize: 11, height: 22 }}
              />
            </Stack>
          </Stack>

          {/* Filter bar */}
          <Paper
            variant="outlined"
            sx={{
              display: "flex",
              flexWrap: "wrap",
              gap: 1.25,
              alignItems: "center",
              p: 1.5,
              mb: 2,
              bgcolor: "grey.50",
              borderRadius: 2,
            }}
          >
            <DateRangePicker
              from={dateRange.from}
              to={dateRange.to}
              onChange={handleDateChange}
            />

            <Box sx={{ width: 1, height: 28, bgcolor: "grey.200" }} />

            <TextField
              size="small"
              value={skuFilter}
              onChange={(e) => {
                setSkuFilter(e.target.value);
                setPage(1);
              }}
              placeholder="Filter by SKU…"
              sx={{ width: 180 }}
              inputProps={{ style: { fontSize: 12 } }}
            />

            <Box sx={{ width: 1, height: 28, bgcolor: "grey.200" }} />

            {/* Status filter pills */}
            <ToggleButtonGroup
              value={statusFilter}
              exclusive
              onChange={(_, v) => {
                setStatusFilter(v === null ? "" : v);
                setPage(1);
              }}
              size="small"
            >
              <ToggleButton value="" sx={{ fontSize: 11, px: 1.5, py: 0.5 }}>
                All
              </ToggleButton>
              {ORDER_STATUSES.map((s) => (
                <ToggleButton
                  key={s}
                  value={s}
                  sx={{
                    fontSize: 11,
                    px: 1.5,
                    py: 0.5,
                    "&.Mui-selected": {
                      bgcolor: STATUS_COLORS[s],
                      color: "#fff",
                      "&:hover": { bgcolor: STATUS_COLORS[s] },
                    },
                  }}
                >
                  {s}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Paper>

          {/* DataGrid */}
          <DataGrid
            rows={data}
            columns={columns}
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
              border: "none",
              "& .MuiDataGrid-columnHeaders": {
                bgcolor: "grey.50",
                fontSize: 12,
                fontWeight: 700,
              },
              "& .MuiDataGrid-cell": { fontSize: 12 },
              "& .MuiDataGrid-row:hover": { bgcolor: "#F0F7FF" },
            }}
            localeText={{
              noRowsLabel: "No orders found — upload Orders CSV first",
            }}
          />
        </CardContent>
      </Card>
    </Stack>
  );
}
