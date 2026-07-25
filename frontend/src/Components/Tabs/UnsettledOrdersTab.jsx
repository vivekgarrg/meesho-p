import React, { useState, useEffect, useMemo } from "react";
import { API, C, fmt } from "../../App";
import { PAGE_SIZE as pageSize } from "../../lib/helper";
import { useDateFilter } from "../../contexts/DateFilterContext";

import {
  Box,
  Card,
  CardContent,
  Chip,
  InputAdornment,
  Paper,
  TextField,
  Typography,
} from "@mui/material";
import { DataGrid } from "@mui/x-data-grid";
import SearchIcon from "@mui/icons-material/Search";

const PAGE_SIZE = pageSize;

const STATUS_CHIP_COLOR = {
  DELIVERED:    "success",
  RTO_COMPLETE: "error",
  CANCELLED:    "default",
};

// ── Main Tab ─────────────────────────────────────────────────────────────────
export function UnsettledOrdersTab() {
  const { range: activeRange, label: filterLabel } = useDateFilter();

  const [page,    setPage]    = useState(0);            // DataGrid is 0-indexed
  const [search,  setSearch]  = useState("");
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);

  // Reset to page 0 when filter or search changes
  useEffect(() => { setPage(0); }, [JSON.stringify(activeRange), search]);

  // Stable query key — prevents double fetch when page reset races activeRange change
  const queryKey = useMemo(
    () => JSON.stringify({ activeRange, page, search }),
    [activeRange, page, search]
  );

  useEffect(() => {
    setLoading(true);
    const params = { ...activeRange, page: page + 1, page_size: PAGE_SIZE }; // API is 1-indexed
    if (search) params.search = search;
    fetch(`${API}/orders/unsettled/?${new URLSearchParams(params)}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [queryKey]);

  // ── DataGrid columns ──────────────────────────────────────────────────────
  const columns = [
    {
      field: "_idx",
      headerName: "#",
      width: 60,
      sortable: false,
      renderCell: ({ api, row }) => {
        const idx = api.getRowIndexRelativeToVisibleRows(row.sub_order_no);
        return (
          <Typography variant="caption" sx={{ color: "text.disabled" }}>
            {page * PAGE_SIZE + (idx ?? 0) + 1}
          </Typography>
        );
      },
    },
    {
      field: "order_date",
      headerName: "Order Date",
      width: 110,
      renderCell: ({ value }) => (
        <Typography variant="body2" sx={{ color: C.gray600, fontSize: 12, whiteSpace: "nowrap" }}>{value}</Typography>
      ),
    },
    {
      field: "sub_order_no",
      headerName: "Sub Order No",
      width: 160,
      renderCell: ({ value }) => (
        <Typography sx={{ fontFamily: "monospace", fontSize: 11, color: C.blue, fontWeight: 600, bgcolor: C.blueLight, px: 0.75, py: 0.25, borderRadius: 1 }}>
          {value}
        </Typography>
      ),
    },
    {
      field: "sku",
      headerName: "SKU",
      width: 120,
      renderCell: ({ value }) => (
        <Chip
          label={value}
          size="small"
          sx={{ fontFamily: "monospace", fontSize: 11, fontWeight: 600, bgcolor: C.orangeLight, color: C.orange, border: `1px solid ${C.orangeBorder}` }}
        />
      ),
    },
    {
      field: "product_name",
      headerName: "Product Name",
      flex: 1,
      minWidth: 160,
      renderCell: ({ value }) => (
        <Typography variant="body2" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {value}
        </Typography>
      ),
    },
    {
      field: "size",
      headerName: "Size",
      width: 70,
      renderCell: ({ value }) => (
        <Typography variant="body2">{value || "—"}</Typography>
      ),
    },
    {
      field: "quantity",
      headerName: "Qty",
      width: 65,
      type: "number",
      renderCell: ({ value }) => (
        <Typography sx={{ fontFamily: "monospace", fontWeight: 600, fontSize: 13 }}>{value}</Typography>
      ),
    },
    {
      field: "supplier_discounted_price",
      headerName: "Order Value",
      width: 120,
      type: "number",
      renderCell: ({ value }) => (
        <Typography sx={{ fontFamily: "monospace", fontWeight: 600, color: "warning.main", fontSize: 13 }}>
          {fmt(value)}
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
          color={STATUS_CHIP_COLOR[value] || "default"}
          size="small"
          sx={{ fontWeight: 600, fontSize: 11 }}
        />
      ),
    },
    {
      field: "customer_state",
      headerName: "State",
      width: 110,
      renderCell: ({ value }) => (
        <Typography variant="body2" sx={{ color: C.gray500, fontSize: 12 }}>{value || "—"}</Typography>
      ),
    },
  ];

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>

      {/* Header */}
      <Box>
        <Typography variant="h6" sx={{ fontWeight: 800, color: C.gray800, mb: 0.5 }}>
          Unsettled Orders
        </Typography>
        <Typography variant="body2" sx={{ color: C.gray400 }}>
          Orders placed but not yet settled by Meesho — no payment record found.
        </Typography>
      </Box>

      {/* Hero summary cards */}
      {data && !loading && (
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
          <Card
            variant="outlined"
            sx={{
              background: "linear-gradient(135deg, #FEF2F2 0%, #FFFFFF 60%)",
              borderTop: "3px solid",
              borderTopColor: "error.main",
            }}
          >
            <CardContent>
              <Typography variant="caption" sx={{ fontWeight: 700, color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.08em", display: "block", mb: 1 }}>
                Unsettled Orders — {filterLabel.toUpperCase()}
              </Typography>
              <Typography sx={{ fontSize: 48, fontWeight: 800, fontFamily: "monospace", color: "error.main", lineHeight: 1 }}>
                {data.total.toLocaleString()}
              </Typography>
              <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.75 }}>
                orders with no payment record
              </Typography>
            </CardContent>
          </Card>

          <Card variant="outlined" sx={{ borderTop: "3px solid", borderTopColor: "warning.main" }}>
            <CardContent>
              <Typography variant="caption" sx={{ fontWeight: 700, color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.08em", display: "block", mb: 1 }}>
                At-Risk Order Value
              </Typography>
              <Typography sx={{ fontSize: 36, fontWeight: 800, fontFamily: "monospace", color: "warning.main", lineHeight: 1 }}>
                {fmt(data.total_value)}
              </Typography>
              <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.75 }}>
                total discounted value of unsettled orders
              </Typography>
            </CardContent>
          </Card>
        </Box>
      )}

      {/* DataGrid card */}
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
        <Box sx={{ p: "14px 20px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 1.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, color: C.gray800 }}>
            Unsettled Orders{data ? ` — ${data.total.toLocaleString()} total` : ""}
          </Typography>
          <TextField
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search order no, SKU, product…"
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

        <DataGrid
          rows={data?.results ?? []}
          columns={columns}
          getRowId={(row) => row.sub_order_no}
          rowHeight={52}
          loading={loading}
          autoHeight
          // Server-side pagination
          paginationMode="server"
          rowCount={data?.total ?? 0}
          paginationModel={{ page, pageSize: PAGE_SIZE }}
          onPaginationModelChange={(model) => setPage(model.page)}
          pageSizeOptions={[PAGE_SIZE]}
          disableRowSelectionOnClick
          sx={{
            border: 0,
            borderTop: `1px solid ${C.border}`,
            "& .MuiDataGrid-columnHeaders": { bgcolor: C.gray50 },
            "& .MuiDataGrid-cell": { alignItems: "center" },
            "& .MuiDataGrid-overlayWrapper": { minHeight: 120 },
          }}
          localeText={{
            noRowsLabel: search
              ? "No orders matching search"
              : "No unsettled orders for this period",
          }}
        />
      </Paper>
    </Box>
  );
}
