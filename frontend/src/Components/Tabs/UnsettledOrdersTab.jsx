import React, { useState, useEffect, useMemo } from "react";
import { API, C, fmt } from "../../App";
import { PAGE_SIZE as pageSize } from "../../lib/helper";

import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  FormControl,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  TextField,
  Typography,
} from "@mui/material";
import { DataGrid } from "@mui/x-data-grid";
import SearchIcon from "@mui/icons-material/Search";
import CalendarTodayIcon from "@mui/icons-material/CalendarToday";

const PAGE_SIZE = pageSize;

function fmtMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-IN", { month: "long", year: "numeric" });
}

function monthToRange(ym) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { date_from: `${ym}-01`, date_to: `${ym}-${String(last).padStart(2, "0")}` };
}

const STATUS_CHIP_COLOR = {
  DELIVERED:    "success",
  RTO_COMPLETE: "error",
  CANCELLED:    "default",
};

// ── Filter bar ────────────────────────────────────────────────────────────────
function FilterBar({ mode, setMode, selectedMonth, setSelectedMonth, months,
                     customFrom, setCustomFrom, customTo, setCustomTo, onApply }) {
  return (
    <Paper
      variant="outlined"
      sx={{ p: "14px 20px", display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", borderRadius: 2 }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mr: 0.5 }}>
        <CalendarTodayIcon fontSize="small" sx={{ color: "text.secondary" }} />
        <Typography variant="caption" sx={{ fontWeight: 700, color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Filter
        </Typography>
      </Box>

      {/* All time */}
      <Button
        size="small"
        variant={mode === "all" ? "contained" : "outlined"}
        color="primary"
        onClick={() => { setMode("all"); onApply({}); }}
        sx={{ textTransform: "none", fontWeight: mode === "all" ? 700 : 500 }}
      >
        All Time
      </Button>

      {/* Month select */}
      <FormControl size="small" sx={{ minWidth: 180 }}>
        <InputLabel>Select month</InputLabel>
        <Select
          value={mode === "month" ? selectedMonth : ""}
          label="Select month"
          onChange={(e) => {
            const m = e.target.value;
            if (!m) return;
            setMode("month");
            setSelectedMonth(m);
            onApply(monthToRange(m));
          }}
          sx={{
            bgcolor: mode === "month" ? "#F5F3FF" : undefined,
            "& .MuiOutlinedInput-notchedOutline": {
              borderColor: mode === "month" ? C.orange : undefined,
            },
          }}
        >
          <MenuItem value=""><em>Select month…</em></MenuItem>
          {months.map((m) => (
            <MenuItem key={m} value={m}>{fmtMonth(m)}</MenuItem>
          ))}
        </Select>
      </FormControl>

      <Box sx={{ width: "1px", height: 32, bgcolor: "divider" }} />

      {/* Custom range */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Typography variant="caption" sx={{ fontWeight: 600, color: "text.secondary" }}>Custom:</Typography>
        <TextField
          type="date"
          size="small"
          value={customFrom}
          onChange={(e) => setCustomFrom(e.target.value)}
          sx={{ width: 150 }}
          InputLabelProps={{ shrink: true }}
        />
        <Typography variant="body2" sx={{ color: "text.disabled" }}>→</Typography>
        <TextField
          type="date"
          size="small"
          value={customTo}
          onChange={(e) => setCustomTo(e.target.value)}
          sx={{ width: 150 }}
          InputLabelProps={{ shrink: true }}
        />
        <Button
          size="small"
          variant={mode === "custom" ? "contained" : "outlined"}
          disabled={!customFrom || !customTo}
          onClick={() => {
            if (!customFrom || !customTo) return;
            setMode("custom");
            onApply({ date_from: customFrom, date_to: customTo });
          }}
          sx={{ textTransform: "none" }}
        >
          Apply
        </Button>
      </Box>
    </Paper>
  );
}

// ── Main Tab ─────────────────────────────────────────────────────────────────
export function UnsettledOrdersTab({ initialMonth }) {
  const [months,   setMonths]   = useState([]);
  const [mode,     setMode]     = useState("all");
  const [selMonth, setSelMonth] = useState("");
  const [custFrom, setCustFrom] = useState("");
  const [custTo,   setCustTo]   = useState("");

  const [activeRange, setActiveRange] = useState(null); // null = waiting
  const [page,    setPage]    = useState(0);            // DataGrid is 0-indexed
  const [search,  setSearch]  = useState("");
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);

  // Load available months; use initialMonth if provided
  useEffect(() => {
    fetch(`${API}/profit/available-months/`)
      .then((r) => r.json())
      .then((ms) => {
        setMonths(ms);
        const target = (initialMonth && ms.includes(initialMonth)) ? initialMonth : (ms[0] || null);
        if (target) {
          setMode("month");
          setSelMonth(target);
          setActiveRange(monthToRange(target));
        } else {
          setActiveRange({});
        }
      })
      .catch(() => setActiveRange({}));
  }, []); // eslint-disable-line

  // Reset to page 0 when filter or search changes
  useEffect(() => { setPage(0); }, [activeRange, search]);

  // Stable query key — prevents double fetch when page reset races activeRange change
  const queryKey = useMemo(
    () => activeRange === null ? null : JSON.stringify({ activeRange, page, search }),
    [activeRange, page, search]
  );

  useEffect(() => {
    if (queryKey === null) return;
    setLoading(true);
    const params = { ...activeRange, page: page + 1, page_size: PAGE_SIZE }; // API is 1-indexed
    if (search) params.search = search;
    fetch(`${API}/orders/unsettled/?${new URLSearchParams(params)}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [queryKey]);

  const filterLabel =
    mode === "month"  ? fmtMonth(selMonth) :
    mode === "custom" ? `${custFrom} → ${custTo}` :
    "All Time";

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

      {/* Filter bar */}
      <FilterBar
        mode={mode}       setMode={setMode}
        selectedMonth={selMonth} setSelectedMonth={setSelMonth}
        months={months}
        customFrom={custFrom} setCustomFrom={setCustFrom}
        customTo={custTo}   setCustomTo={setCustTo}
        onApply={(range) => setActiveRange(range)}
      />

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
