import React, { useState, useEffect, useCallback } from "react";
import { API, C } from "../../App";

import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Paper,
} from "@mui/material";
import { DataGrid } from "@mui/x-data-grid";
import BlockIcon from "@mui/icons-material/Block";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutlined";
import SearchIcon from "@mui/icons-material/Search";
import InputAdornment from "@mui/material/InputAdornment";

// ── RateMeter using LinearProgress ───────────────────────────────────────────
function RateMeter({ rate }) {
  const pct = Math.round(rate * 100);
  const color = rate >= 0.75 ? "error" : rate >= 0.40 ? "warning" : "success";
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 110, width: "100%" }}>
      <Box sx={{ flex: 1 }}>
        <LinearProgress
          variant="determinate"
          value={pct}
          color={color}
          sx={{ height: 6, borderRadius: 4 }}
        />
      </Box>
      <Typography
        variant="caption"
        sx={{
          fontFamily: "monospace",
          fontWeight: 700,
          minWidth: 36,
          textAlign: "right",
          color: rate >= 0.75 ? "error.main" : rate >= 0.40 ? "warning.main" : "success.main",
        }}
      >
        {pct}%
      </Typography>
    </Box>
  );
}

// ── BlockModal using MUI Dialog ───────────────────────────────────────────────
function BlockModal({ customer, onConfirm, onClose }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const handleConfirm = async () => {
    setSaving(true);
    await onConfirm(reason);
    setSaving(false);
  };

  return (
    <Dialog open={!!customer} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ bgcolor: "error.light", color: "error.dark", fontWeight: 800 }}>
        Block Customer
      </DialogTitle>
      <DialogContent sx={{ pt: 2 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, color: "text.primary", mt: 1 }}>
          {customer?.customer_name}
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mb: 2 }}>
          {[customer?.customer_city, customer?.customer_state, customer?.customer_pincode]
            .filter(Boolean)
            .join(", ")}
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mb: 1 }}>
          This customer will be flagged every time their label is parsed.
        </Typography>
        <TextField
          label="Reason for blocking (optional)"
          multiline
          rows={3}
          fullWidth
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. High RTO rate, suspected fraud…"
          size="small"
          sx={{ mt: 1 }}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
        <Button onClick={onClose} variant="outlined" color="inherit">
          Cancel
        </Button>
        <Button
          onClick={handleConfirm}
          disabled={saving}
          variant="contained"
          color="error"
          startIcon={<BlockIcon />}
        >
          {saving ? "Blocking…" : "Confirm Block"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Main Tab ─────────────────────────────────────────────────────────────────
export function FraudCustomersTab() {
  const [suspects, setSuspects] = useState([]);
  const [blocked, setBlocked] = useState([]);
  const [loading, setLoading] = useState(false);
  const [riskFilter, setRiskFilter] = useState("all");
  const [searchQ, setSearchQ] = useState("");
  const [minOrders, setMinOrders] = useState(2);
  const [blockTarget, setBlockTarget] = useState(null);
  const [activeView, setActiveView] = useState("suspects");

  const loadSuspects = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ min_orders: minOrders, ...(riskFilter !== "all" && { risk: riskFilter }) });
    try {
      const r = await fetch(`${API}/fraud-customers/?${params}`);
      if (r.ok) setSuspects((await r.json()).results || []);
    } finally { setLoading(false); }
  }, [minOrders, riskFilter]);

  const loadBlocked = useCallback(async () => {
    const r = await fetch(`${API}/blocked-customers/`);
    if (r.ok) setBlocked((await r.json()).results || []);
  }, []);

  useEffect(() => { loadSuspects(); loadBlocked(); }, [loadSuspects, loadBlocked]);

  const handleBlock = async (customer, reason) => {
    await fetch(`${API}/blocked-customers/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer_name: customer.customer_name,
        customer_pincode: customer.customer_pincode,
        customer_city: customer.customer_city,
        customer_state: customer.customer_state,
        reason,
      }),
    });
    setBlockTarget(null);
    await Promise.all([loadSuspects(), loadBlocked()]);
  };

  const handleUnblock = async (id) => {
    if (!window.confirm("Unblock this customer?")) return;
    await fetch(`${API}/blocked-customers/${id}/`, { method: "DELETE" });
    await Promise.all([loadSuspects(), loadBlocked()]);
  };

  const filtered = suspects.filter((s) => {
    if (!searchQ) return true;
    const q = searchQ.toLowerCase();
    return (
      s.customer_name.toLowerCase().includes(q) ||
      s.customer_pincode.includes(q) ||
      s.customer_city?.toLowerCase().includes(q)
    );
  });

  const highCount = suspects.filter((s) => s.risk_level === "high").length;
  const medCount = suspects.filter((s) => s.risk_level === "medium").length;
  const blockedCount = blocked.length;

  // ── DataGrid columns — Suspects ──────────────────────────────────────────
  const suspectColumns = [
    {
      field: "customer_name",
      headerName: "Customer Name",
      flex: 1.4,
      minWidth: 160,
      renderCell: ({ row }) => (
        <Box sx={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 0.5, height: "100%" }}>
          <Typography variant="body2" sx={{ fontWeight: 700, color: C.gray800, lineHeight: 1.2 }}>
            {row.customer_name}
          </Typography>
          {row.is_blocked && (
            <Chip label="BLOCKED" color="error" size="small" sx={{ width: "fit-content", height: 18, fontSize: 10, fontWeight: 700 }} />
          )}
        </Box>
      ),
    },
    {
      field: "customer_city",
      headerName: "Location",
      flex: 1.2,
      minWidth: 140,
      renderCell: ({ row }) => (
        <Box sx={{ display: "flex", flexDirection: "column", justifyContent: "center", height: "100%" }}>
          <Typography variant="body2" sx={{ color: C.gray600, fontSize: 12 }}>{row.customer_city || "—"}</Typography>
          <Typography variant="caption" sx={{ color: C.gray400 }}>
            {row.customer_state} {row.customer_pincode}
          </Typography>
        </Box>
      ),
    },
    {
      field: "total_orders",
      headerName: "Orders",
      width: 80,
      type: "number",
      renderCell: ({ value }) => (
        <Typography sx={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13 }}>{value}</Typography>
      ),
    },
    {
      field: "delivered",
      headerName: "Delivered",
      width: 90,
      type: "number",
      renderCell: ({ value }) => (
        <Typography sx={{ fontFamily: "monospace", color: "success.main", fontSize: 13 }}>{value}</Typography>
      ),
    },
    {
      field: "rto",
      headerName: "RTO",
      width: 70,
      type: "number",
      renderCell: ({ value }) => (
        <Typography sx={{ fontFamily: "monospace", fontWeight: value > 0 ? 700 : 400, color: value > 0 ? "error.main" : C.gray300, fontSize: 13 }}>
          {value}
        </Typography>
      ),
    },
    {
      field: "rto_rate",
      headerName: "RTO Rate",
      flex: 1,
      minWidth: 130,
      renderCell: ({ value }) => <RateMeter rate={value} />,
    },
    {
      field: "claim_count",
      headerName: "Claims",
      width: 80,
      type: "number",
      renderCell: ({ value }) =>
        value > 0 ? (
          <Chip
            label={value}
            color="error"
            size="small"
            sx={{ fontFamily: "monospace", fontWeight: 700, height: 22 }}
          />
        ) : (
          <Typography sx={{ fontFamily: "monospace", color: C.gray300, fontSize: 13 }}>0</Typography>
        ),
    },
    {
      field: "risk_level",
      headerName: "Risk",
      width: 120,
      renderCell: ({ value }) => {
        const colorMap = { high: "error", medium: "warning", low: "success" };
        const labelMap = { high: "High Risk", medium: "Medium", low: "Low" };
        return (
          <Chip
            label={labelMap[value] || value}
            color={colorMap[value] || "default"}
            size="small"
            sx={{ fontWeight: 700 }}
          />
        );
      },
    },
    {
      field: "action",
      headerName: "Action",
      width: 110,
      sortable: false,
      renderCell: ({ row }) =>
        row.is_blocked ? (
          <Typography variant="caption" sx={{ color: C.gray400, fontStyle: "italic" }}>
            Blocked
          </Typography>
        ) : (
          <Button
            size="small"
            variant="contained"
            color="error"
            startIcon={<BlockIcon />}
            onClick={() => setBlockTarget(row)}
            sx={{ fontSize: 11, px: 1.5 }}
          >
            Block
          </Button>
        ),
    },
  ];

  // ── DataGrid columns — Blocked customers ────────────────────────────────
  const blockedColumns = [
    {
      field: "customer_name",
      headerName: "Customer",
      flex: 1.2,
      minWidth: 150,
      renderCell: ({ value }) => (
        <Typography variant="body2" sx={{ fontWeight: 700, color: C.gray800 }}>{value}</Typography>
      ),
    },
    {
      field: "customer_city",
      headerName: "Location",
      flex: 1,
      minWidth: 130,
      renderCell: ({ row }) => (
        <Typography variant="body2" sx={{ color: C.gray500, fontSize: 12 }}>
          {[row.customer_city, row.customer_state].filter(Boolean).join(", ") || "—"}
        </Typography>
      ),
    },
    {
      field: "customer_pincode",
      headerName: "Pincode",
      width: 100,
      renderCell: ({ value }) => (
        <Typography sx={{ fontFamily: "monospace", fontSize: 12 }}>{value}</Typography>
      ),
    },
    {
      field: "reason",
      headerName: "Reason",
      flex: 1.5,
      minWidth: 180,
      renderCell: ({ value }) =>
        value ? (
          <Typography variant="body2" sx={{ color: C.gray500, fontSize: 12 }}>{value}</Typography>
        ) : (
          <Typography variant="body2" sx={{ color: C.gray300, fontStyle: "italic", fontSize: 12 }}>No reason given</Typography>
        ),
    },
    {
      field: "blocked_at",
      headerName: "Blocked On",
      width: 120,
      renderCell: ({ value }) => (
        <Typography variant="body2" sx={{ color: C.gray500, fontSize: 12, whiteSpace: "nowrap" }}>
          {new Date(value).toLocaleDateString("en-IN")}
        </Typography>
      ),
    },
    {
      field: "id",
      headerName: "Action",
      width: 110,
      sortable: false,
      renderCell: ({ value }) => (
        <Button
          size="small"
          variant="outlined"
          color="success"
          startIcon={<CheckCircleOutlineIcon />}
          onClick={() => handleUnblock(value)}
          sx={{ fontSize: 11, px: 1.5 }}
        >
          Unblock
        </Button>
      ),
    },
  ];

  const kpiCards = [
    { label: "High Risk", value: highCount, color: "error.main", borderColor: "error.main" },
    { label: "Medium Risk", value: medCount, color: "warning.main", borderColor: "warning.main" },
    { label: "Total Suspects", value: suspects.length, color: "info.main", borderColor: "info.main" },
    { label: "Blocked", value: blockedCount, color: "text.primary", borderColor: "text.secondary" },
  ];

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>

      <BlockModal
        customer={blockTarget}
        onConfirm={(reason) => handleBlock(blockTarget, reason)}
        onClose={() => setBlockTarget(null)}
      />

      {/* Header */}
      <Box>
        <Typography variant="h6" sx={{ fontWeight: 800, color: C.gray800, mb: 0.5 }}>
          Fraud Customers
        </Typography>
        <Typography variant="body2" sx={{ color: C.gray400 }}>
          Customers with high RTO rates or claims. Block them to get a warning on future label uploads.
        </Typography>
      </Box>

      {/* KPI strip */}
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.75 }}>
        {kpiCards.map((k) => (
          <Card
            key={k.label}
            variant="outlined"
            sx={{ minWidth: 140, borderTop: `3px solid`, borderTopColor: k.borderColor, flex: "1 1 140px" }}
          >
            <CardContent sx={{ pb: "16px !important" }}>
              <Typography variant="caption" sx={{ fontWeight: 700, color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.07em", display: "block", mb: 1 }}>
                {k.label}
              </Typography>
              <Typography sx={{ fontSize: 22, fontWeight: 800, fontFamily: "monospace", color: k.color }}>
                {k.value}
              </Typography>
            </CardContent>
          </Card>
        ))}
      </Box>

      {/* View toggle */}
      <ToggleButtonGroup
        value={activeView}
        exclusive
        onChange={(_, v) => v && setActiveView(v)}
        size="small"
      >
        <ToggleButton value="suspects" sx={{ textTransform: "none", fontWeight: 600 }}>
          Suspect Analysis
        </ToggleButton>
        <ToggleButton value="blocked" sx={{ textTransform: "none", fontWeight: 600 }}>
          Blocked Customers ({blockedCount})
        </ToggleButton>
      </ToggleButtonGroup>

      {/* ── Suspects view ── */}
      {activeView === "suspects" && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.75 }}>

          {/* Filter bar */}
          <Paper variant="outlined" sx={{ p: "14px 20px", display: "flex", gap: 1.5, flexWrap: "wrap", alignItems: "center", borderRadius: 2 }}>
            <TextField
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="Search name, pincode, city…"
              size="small"
              sx={{ width: 240 }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" sx={{ color: "text.disabled" }} />
                  </InputAdornment>
                ),
              }}
            />

            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Typography variant="caption" sx={{ fontWeight: 700, color: "text.secondary" }}>Risk:</Typography>
              {["all", "high", "medium", "low"].map((r) => (
                <Button
                  key={r}
                  size="small"
                  variant={riskFilter === r ? "contained" : "outlined"}
                  color={r === "high" ? "error" : r === "medium" ? "warning" : r === "low" ? "success" : "inherit"}
                  onClick={() => setRiskFilter(r)}
                  sx={{ textTransform: "capitalize", minWidth: 56, fontWeight: riskFilter === r ? 700 : 500 }}
                >
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                </Button>
              ))}
            </Box>

            <FormControl size="small" sx={{ minWidth: 110 }}>
              <InputLabel>Min orders</InputLabel>
              <Select
                value={minOrders}
                label="Min orders"
                onChange={(e) => setMinOrders(Number(e.target.value))}
              >
                {[1, 2, 3, 5, 10].map((n) => (
                  <MenuItem key={n} value={n}>{n}</MenuItem>
                ))}
              </Select>
            </FormControl>

            {loading && (
              <Typography variant="caption" sx={{ color: "text.disabled" }}>Calculating…</Typography>
            )}
          </Paper>

          {/* Risk legend */}
          <Paper variant="outlined" sx={{ p: "12px 18px", bgcolor: "#FFFBEB", borderColor: "#FDE68A", borderRadius: 2 }}>
            <Typography variant="caption" sx={{ fontWeight: 700, color: "warning.main", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", mb: 1 }}>
              How risk is calculated
            </Typography>
            <Box sx={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                <strong style={{ color: C.red }}>High Risk</strong> — RTO rate ≥ 75% OR ≥ 3 claims
              </Typography>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                <strong style={{ color: C.amber }}>Medium Risk</strong> — RTO rate ≥ 40% OR ≥ 1 claim
              </Typography>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                <strong style={{ color: C.green }}>Low Risk</strong> — below thresholds
              </Typography>
              <Typography variant="caption" sx={{ color: "text.disabled" }}>
                Only customers with ≥ {minOrders} orders are shown
              </Typography>
            </Box>
          </Paper>

          {/* Suspects DataGrid */}
          <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
            <Box sx={{ p: "14px 20px 10px", display: "flex", alignItems: "center", gap: 1.5 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, color: C.gray800 }}>
                Customer Risk Analysis
              </Typography>
              <Chip label={filtered.length} size="small" sx={{ fontWeight: 700 }} />
            </Box>
            <DataGrid
              rows={filtered}
              columns={suspectColumns}
              getRowId={(row) => `${row.customer_name}-${row.customer_pincode}`}
              rowHeight={64}
              loading={loading}
              autoHeight
              disableRowSelectionOnClick
              pageSizeOptions={[25, 50, 100]}
              initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
              sx={{
                border: 0,
                borderTop: `1px solid ${C.border}`,
                "& .MuiDataGrid-columnHeaders": { bgcolor: C.gray50 },
                "& .MuiDataGrid-cell": { alignItems: "center" },
              }}
            />
          </Paper>
        </Box>
      )}

      {/* ── Blocked customers view ── */}
      {activeView === "blocked" && (
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
          <Box sx={{ p: "14px 20px 10px", display: "flex", alignItems: "center", gap: 1.5 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: C.gray800 }}>
              Blocked Customers
            </Typography>
            <Chip label={blocked.length} size="small" color="error" sx={{ fontWeight: 700 }} />
          </Box>

          {blocked.length === 0 ? (
            <Box sx={{ textAlign: "center", py: 7, color: "text.disabled" }}>
              <Typography variant="h4" sx={{ mb: 1 }}>✅</Typography>
              <Typography variant="body2">
                No blocked customers. Block a customer from the Suspect Analysis tab.
              </Typography>
            </Box>
          ) : (
            <DataGrid
              rows={blocked}
              columns={blockedColumns}
              getRowId={(row) => row.id}
              rowHeight={64}
              autoHeight
              disableRowSelectionOnClick
              pageSizeOptions={[25, 50, 100]}
              initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
              sx={{
                border: 0,
                borderTop: `1px solid ${C.border}`,
                "& .MuiDataGrid-columnHeaders": { bgcolor: C.gray50 },
                "& .MuiDataGrid-cell": { alignItems: "center" },
              }}
            />
          )}
        </Paper>
      )}

      {/* Info callout */}
      <Paper variant="outlined" sx={{ p: "14px 20px", bgcolor: C.gray50, borderRadius: 2 }}>
        <Typography variant="caption" sx={{ fontWeight: 700, color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", mb: 1 }}>
          How blocking works
        </Typography>
        <Box sx={{ display: "flex", gap: 3.5, flexWrap: "wrap" }}>
          {[
            { icon: "📋", text: "Customer identity = Name + Pincode (as printed on Meesho labels)" },
            { icon: "🏷", text: "When you upload a labels PDF, any blocked customer in that batch is flagged immediately" },
            { icon: "📦", text: "Label Orders table shows a red BLOCKED badge on their rows" },
            { icon: "✓", text: "Unblocking is reversible — the customer goes back to normal" },
          ].map((item) => (
            <Box key={item.text} sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
              <Typography sx={{ fontSize: 16 }}>{item.icon}</Typography>
              <Typography variant="body2" sx={{ color: "text.secondary" }}>{item.text}</Typography>
            </Box>
          ))}
        </Box>
      </Paper>
    </Box>
  );
}
