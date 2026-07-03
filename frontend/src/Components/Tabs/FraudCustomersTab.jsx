import React, { useState, useEffect, useCallback } from "react";
import { API, C } from "../../App";
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, FormControl, InputAdornment, InputLabel,
  LinearProgress, MenuItem, Paper, Select, Table, TableBody, TableCell,
  TableHead, TableRow, TextField, ToggleButton, ToggleButtonGroup, Tooltip,
  Typography,
} from "@mui/material";
import BlockIcon from "@mui/icons-material/Block";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutlined";
import SearchIcon from "@mui/icons-material/Search";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";

// ── helpers ───────────────────────────────────────────────────────────────────
const STATUS_STYLE = {
  DELIVERED: { bg: "#D1FAE5", color: "#065F46", border: "#6EE7B7", label: "Delivered" },
  RETURN:    { bg: "#FEE2E2", color: "#991B1B", border: "#FCA5A5", label: "Return"    },
  RTO:       { bg: "#FEF3C7", color: "#92400E", border: "#FDE68A", label: "RTO"       },
  CANCELLED: { bg: "#F3F4F6", color: "#6B7280", border: "#D1D5DB", label: "Cancelled" },
  PENDING:   { bg: "#EFF6FF", color: "#1E40AF", border: "#BFDBFE", label: "Pending"   },
};

function StatusChip({ status, small }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.PENDING;
  return (
    <Chip label={s.label} size="small"
      sx={{ fontSize: small ? 10 : 11, fontWeight: 700, height: small ? 18 : 22,
            background: s.bg, color: s.color, border: `1px solid ${s.border}`,
            "& .MuiChip-label": { px: small ? "5px" : "8px" } }} />
  );
}

function ReturnMeter({ rate }) {
  const pct   = Math.round(rate * 100);
  const color = rate >= 0.5 ? "#DC2626" : rate >= 0.25 ? "#D97706" : "#16A34A";
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 120 }}>
      <Box sx={{ flex: 1, height: 6, borderRadius: 3, background: "#E5E7EB", overflow: "hidden" }}>
        <Box sx={{ width: `${pct}%`, height: "100%", borderRadius: 3, background: color, transition: "width 0.3s" }} />
      </Box>
      <Typography sx={{ fontFamily: "monospace", fontWeight: 700, fontSize: 12, color, minWidth: 34, textAlign: "right" }}>{pct}%</Typography>
    </Box>
  );
}

function RiskChip({ level }) {
  const MAP = {
    high:   { bg: "#FEE2E2", color: "#DC2626", border: "#FCA5A5", label: "High Risk"  },
    medium: { bg: "#FEF3C7", color: "#D97706", border: "#FDE68A", label: "Medium"     },
    low:    { bg: "#D1FAE5", color: "#059669", border: "#6EE7B7", label: "Low Risk"   },
  };
  const s = MAP[level] || MAP.low;
  return (
    <Chip label={s.label} size="small"
      sx={{ fontWeight: 700, fontSize: 11, background: s.bg, color: s.color, border: `1px solid ${s.border}`, "& .MuiChip-label": { px: "8px" } }} />
  );
}

// ── Block modal ───────────────────────────────────────────────────────────────
function BlockModal({ customer, onConfirm, onClose }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const handleConfirm = async () => { setSaving(true); await onConfirm(reason); setSaving(false); };

  if (!customer) return null;
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ background: "#FEF2F2", color: "#DC2626", fontWeight: 800, borderBottom: `1px solid #FCA5A5` }}>
        🚫 Block Customer
      </DialogTitle>
      <DialogContent sx={{ pt: "20px !important" }}>
        <Box sx={{ display: "flex", gap: "16px", mb: "16px", flexWrap: "wrap" }}>
          <Box>
            <Typography sx={{ fontWeight: 800, fontSize: 15, color: C.gray800 }}>{customer.customer_name}</Typography>
            <Typography sx={{ fontSize: 12, color: C.gray500 }}>
              {[customer.customer_address, customer.customer_city, customer.customer_state, customer.customer_pincode].filter(Boolean).join(", ")}
            </Typography>
          </Box>
          <Box sx={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <Chip label={`${customer.returned} Returns`} size="small"
              sx={{ background: "#FEE2E2", color: "#DC2626", border: "1px solid #FCA5A5", fontWeight: 700 }} />
            <Chip label={`${customer.total_orders} Total Orders`} size="small"
              sx={{ background: C.gray100, color: C.gray600, fontWeight: 600 }} />
            <Chip label={`${Math.round(customer.return_rate * 100)}% Return Rate`} size="small"
              sx={{ background: "#FEF3C7", color: "#D97706", border: "1px solid #FDE68A", fontWeight: 700 }} />
          </Box>
        </Box>

        <Alert severity="warning" sx={{ mb: "14px", fontSize: 12 }}>
          This customer will be flagged on every future label parse. Block is based on <strong>return behaviour</strong>, not RTO.
        </Alert>

        <TextField
          label="Reason for blocking (optional)"
          multiline rows={3} fullWidth size="small"
          value={reason} onChange={e => setReason(e.target.value)}
          placeholder={`e.g. ${customer.returned} returns out of ${customer.total_orders} orders — suspected serial returner`}
        />
      </DialogContent>
      <DialogActions sx={{ px: "24px", pb: "16px", gap: "8px" }}>
        <Button onClick={onClose} variant="outlined" color="inherit">Cancel</Button>
        <Button onClick={handleConfirm} disabled={saving} variant="contained" color="error" startIcon={<BlockIcon />}>
          {saving ? "Blocking…" : "Confirm Block"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Expanded customer detail ──────────────────────────────────────────────────
function CustomerDetail({ customer }) {
  return (
    <Box sx={{ p: "16px 24px", background: "#FFFBEB", borderTop: `2px solid #FDE68A` }}>
      <Box sx={{ display: "flex", gap: "24px", flexWrap: "wrap" }}>

        {/* Address */}
        <Box sx={{ minWidth: 200 }}>
          <Typography sx={{ fontSize: 10, fontWeight: 700, color: C.gray400, textTransform: "uppercase", letterSpacing: "0.08em", mb: "4px" }}>Address</Typography>
          <Typography sx={{ fontSize: 12, color: C.gray700 }}>{customer.customer_address || "—"}</Typography>
          <Typography sx={{ fontSize: 11, color: C.gray500 }}>{[customer.customer_city, customer.customer_state].filter(Boolean).join(", ")} {customer.customer_pincode}</Typography>
        </Box>

        {/* SKU Breakdown */}
        <Box sx={{ flex: 1, minWidth: 320 }}>
          <Typography sx={{ fontSize: 10, fontWeight: 700, color: C.gray400, textTransform: "uppercase", letterSpacing: "0.08em", mb: "8px" }}>
            SKU Breakdown ({customer.sku_breakdown?.length || 0} SKUs)
          </Typography>
          <Box sx={{ borderRadius: "8px", overflow: "hidden", border: `1px solid ${C.border}` }}>
            <Table size="small" sx={{ width: "100%", borderCollapse: "collapse" }}>
              <TableHead>
                <TableRow sx={{ background: C.gray50 }}>
                  {["SKU", "Qty", "Orders", "Delivered", "Returned", "RTO"].map(h => (
                    <TableCell key={h} sx={{ fontSize: 10, fontWeight: 700, color: C.gray500, textTransform: "uppercase", py: "6px", px: "10px", whiteSpace: "nowrap" }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {(customer.sku_breakdown || []).map(row => (
                  <TableRow key={row.sku} sx={{ background: C.white, "&:hover": { background: C.gray50 } }}>
                    <TableCell sx={{ py: "6px", px: "10px" }}>
                      <span style={{ fontFamily: "monospace", fontSize: 11, color: C.orange, fontWeight: 700, background: C.orangeLight, padding: "2px 6px", borderRadius: 4 }}>{row.sku || "—"}</span>
                    </TableCell>
                    <TableCell sx={{ py: "6px", px: "10px", fontFamily: "monospace", fontWeight: 700, fontSize: 13 }}>{row.qty}</TableCell>
                    <TableCell sx={{ py: "6px", px: "10px", fontFamily: "monospace", fontSize: 12 }}>{row.orders}</TableCell>
                    <TableCell sx={{ py: "6px", px: "10px" }}>
                      {row.delivered > 0 ? <Chip label={row.delivered} size="small" sx={{ background: "#D1FAE5", color: "#065F46", fontWeight: 700, height: 18, "& .MuiChip-label": { px: "6px", fontSize: 11 } }} /> : <span style={{ color: C.gray300 }}>—</span>}
                    </TableCell>
                    <TableCell sx={{ py: "6px", px: "10px" }}>
                      {row.returned > 0 ? <Chip label={row.returned} size="small" sx={{ background: "#FEE2E2", color: "#DC2626", fontWeight: 800, height: 18, "& .MuiChip-label": { px: "6px", fontSize: 11 } }} /> : <span style={{ color: C.gray300 }}>—</span>}
                    </TableCell>
                    <TableCell sx={{ py: "6px", px: "10px" }}>
                      {row.rto > 0 ? <Chip label={row.rto} size="small" sx={{ background: "#FEF3C7", color: "#92400E", fontWeight: 700, height: 18, "& .MuiChip-label": { px: "6px", fontSize: 11 } }} /> : <span style={{ color: C.gray300 }}>—</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </Box>

        {/* Order History */}
        <Box sx={{ flex: 1, minWidth: 340 }}>
          <Typography sx={{ fontSize: 10, fontWeight: 700, color: C.gray400, textTransform: "uppercase", letterSpacing: "0.08em", mb: "8px" }}>
            Order History ({customer.orders?.length || 0} orders)
          </Typography>
          <Box sx={{ maxHeight: 260, overflowY: "auto", borderRadius: "8px", border: `1px solid ${C.border}` }}>
            <Table size="small" sx={{ width: "100%", borderCollapse: "collapse" }}>
              <TableHead>
                <TableRow sx={{ background: C.gray50, position: "sticky", top: 0, zIndex: 1 }}>
                  {["Date", "Order ID", "SKU", "Qty", "Status"].map(h => (
                    <TableCell key={h} sx={{ fontSize: 10, fontWeight: 700, color: C.gray500, textTransform: "uppercase", py: "6px", px: "10px", whiteSpace: "nowrap" }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {(customer.orders || []).map((o, i) => (
                  <TableRow key={`${o.order_id}-${i}`} sx={{ background: o.status === "RETURN" ? "#FFF5F5" : C.white, "&:hover": { background: C.gray50 } }}>
                    <TableCell sx={{ py: "5px", px: "10px", fontFamily: "monospace", fontSize: 11, color: C.gray500, whiteSpace: "nowrap" }}>
                      {o.order_date ? o.order_date.slice(0, 10) : "—"}
                    </TableCell>
                    <TableCell sx={{ py: "5px", px: "10px" }}>
                      <Tooltip title={o.order_id} placement="top">
                        <span style={{ fontFamily: "monospace", fontSize: 10, color: C.gray400 }}>…{(o.order_id || "").slice(-10)}</span>
                      </Tooltip>
                    </TableCell>
                    <TableCell sx={{ py: "5px", px: "10px" }}>
                      <span style={{ fontFamily: "monospace", fontSize: 11, color: C.orange, fontWeight: 600 }}>{o.sku || "—"}</span>
                    </TableCell>
                    <TableCell sx={{ py: "5px", px: "10px", fontFamily: "monospace", fontSize: 12, textAlign: "center" }}>{o.qty}</TableCell>
                    <TableCell sx={{ py: "5px", px: "10px" }}>
                      <StatusChip status={o.status} small />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

// ── Customer row ──────────────────────────────────────────────────────────────
function CustomerRow({ customer, onBlock, expandedKey, setExpandedKey }) {
  const key      = `${customer.customer_name}|${customer.customer_pincode}`;
  const expanded = expandedKey === key;

  return (
    <>
      <TableRow
        sx={{
          background: customer.is_blocked ? "#FEF2F2"
            : customer.risk_level === "high" ? "#FFF5F5"
            : customer.risk_level === "medium" ? "#FFFBEB"
            : C.white,
          cursor: "pointer",
          "&:hover": { background: "#FFF7ED" },
          borderLeft: `4px solid ${customer.risk_level === "high" ? "#DC2626" : customer.risk_level === "medium" ? "#D97706" : "#E5E7EB"}`,
        }}
        onClick={() => setExpandedKey(expanded ? null : key)}
      >
        {/* Expand toggle */}
        <TableCell sx={{ py: "10px", px: "10px", width: 36 }}>
          {expanded ? <KeyboardArrowUpIcon sx={{ fontSize: 18, color: C.gray400 }} /> : <KeyboardArrowDownIcon sx={{ fontSize: 18, color: C.gray400 }} />}
        </TableCell>

        {/* Customer */}
        <TableCell sx={{ py: "10px", px: "12px", minWidth: 180 }}>
          <Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: "6px", mb: "2px" }}>
              <Typography sx={{ fontWeight: 800, fontSize: 13, color: C.gray800 }}>{customer.customer_name}</Typography>
              {customer.is_blocked && <Chip label="BLOCKED" size="small" sx={{ height: 16, fontSize: 9, fontWeight: 800, background: "#FEE2E2", color: "#DC2626", "& .MuiChip-label": { px: "5px" } }} />}
            </Box>
            <Typography sx={{ fontSize: 11, color: C.gray500 }}>{[customer.customer_city, customer.customer_state].filter(Boolean).join(", ")} {customer.customer_pincode}</Typography>
          </Box>
        </TableCell>

        {/* Order counts */}
        <TableCell sx={{ textAlign: "center", py: "10px", px: "12px" }}>
          <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 18, color: C.gray800 }}>{customer.total_orders}</span>
        </TableCell>
        <TableCell sx={{ textAlign: "center", py: "10px", px: "12px" }}>
          <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 15, color: "#16A34A" }}>{customer.delivered}</span>
        </TableCell>
        <TableCell sx={{ textAlign: "center", py: "10px", px: "12px" }}>
          {customer.returned > 0
            ? <Chip label={customer.returned} size="small" sx={{ fontFamily: "monospace", fontWeight: 800, fontSize: 14, background: "#FEE2E2", color: "#DC2626", border: "1px solid #FCA5A5", "& .MuiChip-label": { px: "10px" } }} />
            : <span style={{ color: C.gray300, fontSize: 14 }}>0</span>}
        </TableCell>
        <TableCell sx={{ textAlign: "center", py: "10px", px: "12px" }}>
          {customer.rto > 0
            ? <Chip label={customer.rto} size="small" sx={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13, background: "#FEF3C7", color: "#92400E", border: "1px solid #FDE68A", "& .MuiChip-label": { px: "8px" } }} />
            : <span style={{ color: C.gray300, fontSize: 13 }}>0</span>}
        </TableCell>

        {/* Return rate */}
        <TableCell sx={{ py: "10px", px: "12px", minWidth: 140 }}>
          <ReturnMeter rate={customer.return_rate} />
        </TableCell>

        {/* SKUs */}
        <TableCell sx={{ py: "10px", px: "12px", maxWidth: 200 }}>
          <Box sx={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
            {(customer.sku_breakdown || []).slice(0, 3).map(s => (
              <Chip key={s.sku} label={s.sku || "?"} size="small"
                sx={{ fontFamily: "monospace", fontSize: 10, background: C.orangeLight, color: C.orange, border: `1px solid ${C.orangeBorder}`, height: 18, "& .MuiChip-label": { px: "5px" } }} />
            ))}
            {(customer.sku_breakdown || []).length > 3 && (
              <Chip label={`+${customer.sku_breakdown.length - 3}`} size="small"
                sx={{ fontSize: 10, background: C.gray100, color: C.gray500, height: 18, "& .MuiChip-label": { px: "5px" } }} />
            )}
          </Box>
        </TableCell>

        {/* Risk */}
        <TableCell sx={{ py: "10px", px: "12px" }}>
          <RiskChip level={customer.risk_level} />
        </TableCell>

        {/* Last order */}
        <TableCell sx={{ py: "10px", px: "12px" }}>
          <Typography sx={{ fontSize: 11, color: C.gray500, fontFamily: "monospace" }}>
            {customer.last_order ? customer.last_order.slice(0, 10) : "—"}
          </Typography>
        </TableCell>

        {/* Block action */}
        <TableCell sx={{ py: "10px", px: "12px" }} onClick={e => e.stopPropagation()}>
          {customer.is_blocked
            ? <Chip label="Blocked" size="small" sx={{ background: "#FEE2E2", color: "#DC2626", fontWeight: 700, fontSize: 11 }} />
            : (
              <Button size="small" variant="contained" color="error" startIcon={<BlockIcon sx={{ fontSize: 13 }} />}
                onClick={() => onBlock(customer)}
                sx={{ fontSize: 11, px: "10px", py: "3px", textTransform: "none", fontWeight: 700 }}>
                Block
              </Button>
            )}
        </TableCell>
      </TableRow>

      {/* Expanded detail */}
      {expanded && (
        <TableRow>
          <TableCell colSpan={11} sx={{ p: 0, borderBottom: `2px solid #FDE68A` }}>
            <CustomerDetail customer={customer} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Tab
// ═══════════════════════════════════════════════════════════════════════════════
export function FraudCustomersTab() {
  const [suspects,    setSuspects]    = useState([]);
  const [blocked,     setBlocked]     = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [riskFilter,  setRiskFilter]  = useState("all");
  const [searchQ,     setSearchQ]     = useState("");
  const [minOrders,   setMinOrders]   = useState(2);
  const [blockTarget, setBlockTarget] = useState(null);
  const [activeView,  setActiveView]  = useState("suspects");
  const [expandedKey, setExpandedKey] = useState(null);

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
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer_name:    customer.customer_name,
        customer_pincode: customer.customer_pincode,
        customer_city:    customer.customer_city,
        customer_state:   customer.customer_state,
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

  const filtered = suspects.filter(s => {
    if (!searchQ) return true;
    const q = searchQ.toLowerCase();
    return (
      s.customer_name.toLowerCase().includes(q) ||
      s.customer_pincode.includes(q) ||
      (s.customer_city || "").toLowerCase().includes(q) ||
      (s.customer_address || "").toLowerCase().includes(q)
    );
  });

  const highCount   = suspects.filter(s => s.risk_level === "high").length;
  const medCount    = suspects.filter(s => s.risk_level === "medium").length;
  const returnCount = suspects.reduce((s, c) => s + c.returned, 0);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <BlockModal customer={blockTarget} onConfirm={reason => handleBlock(blockTarget, reason)} onClose={() => setBlockTarget(null)} />

      {/* Header */}
      <Box>
        <Typography sx={{ fontWeight: 800, fontSize: 20, color: C.gray800, mb: "4px" }}>🚨 Fraud / Return Customers</Typography>
        <Typography sx={{ fontSize: 13, color: C.gray400 }}>
          Customers grouped by same name + same address. Risk is based on <strong>RETURN rate</strong> (not RTO). Block a customer to get a warning on future label uploads.
        </Typography>
      </Box>

      {/* KPI strip */}
      <Box sx={{ display: "flex", gap: "14px", flexWrap: "wrap" }}>
        {[
          { label: "High Risk",      value: highCount,        color: "#DC2626", bg: "#FEE2E2" },
          { label: "Medium Risk",    value: medCount,         color: "#D97706", bg: "#FEF3C7" },
          { label: "Total Suspects", value: suspects.length,  color: C.blue,   bg: "#EFF6FF" },
          { label: "Total Returns",  value: returnCount,      color: "#DC2626", bg: "#FFF5F5" },
          { label: "Blocked",        value: blocked.length,   color: C.gray700, bg: C.gray100 },
        ].map(k => (
          <Paper key={k.label} elevation={0} sx={{ border: `1px solid ${k.bg}`, borderTop: `3px solid ${k.color}`, borderRadius: 2, p: "12px 18px", minWidth: 130, flex: "1 1 130px" }}>
            <Typography sx={{ fontSize: 10, fontWeight: 700, color: C.gray400, textTransform: "uppercase", letterSpacing: "0.07em", mb: "4px" }}>{k.label}</Typography>
            <Typography sx={{ fontSize: 24, fontWeight: 800, fontFamily: "monospace", color: k.color }}>{k.value}</Typography>
          </Paper>
        ))}
      </Box>

      {/* View toggle */}
      <ToggleButtonGroup value={activeView} exclusive onChange={(_, v) => v && setActiveView(v)} size="small">
        <ToggleButton value="suspects" sx={{ textTransform: "none", fontWeight: 600 }}>Suspect Analysis</ToggleButton>
        <ToggleButton value="blocked"  sx={{ textTransform: "none", fontWeight: 600 }}>Blocked ({blocked.length})</ToggleButton>
      </ToggleButtonGroup>

      {/* ── Suspects view ── */}
      {activeView === "suspects" && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: "14px" }}>

          {/* Filter bar */}
          <Paper variant="outlined" sx={{ p: "12px 18px", display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center", borderRadius: 2 }}>
            <TextField
              value={searchQ} onChange={e => setSearchQ(e.target.value)}
              placeholder="Search name, pincode, city, address…" size="small" sx={{ width: 260 }}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" sx={{ color: "text.disabled" }} /></InputAdornment> }}
            />
            <Box sx={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Typography sx={{ fontSize: 12, fontWeight: 700, color: C.gray500 }}>Risk:</Typography>
              {["all","high","medium","low"].map(r => (
                <Button key={r} size="small"
                  variant={riskFilter === r ? "contained" : "outlined"}
                  color={r === "high" ? "error" : r === "medium" ? "warning" : r === "low" ? "success" : "inherit"}
                  onClick={() => setRiskFilter(r)}
                  sx={{ textTransform: "capitalize", minWidth: 56, fontWeight: riskFilter === r ? 700 : 500 }}>
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                </Button>
              ))}
            </Box>
            <FormControl size="small" sx={{ minWidth: 110 }}>
              <InputLabel>Min orders</InputLabel>
              <Select value={minOrders} label="Min orders" onChange={e => setMinOrders(Number(e.target.value))}>
                {[1,2,3,5,10].map(n => <MenuItem key={n} value={n}>{n}</MenuItem>)}
              </Select>
            </FormControl>
            {loading && <CircularProgress size={18} sx={{ color: C.orange }} />}
          </Paper>

          {/* Risk legend */}
          <Paper variant="outlined" sx={{ p: "10px 16px", background: "#FFFBEB", borderColor: "#FDE68A", borderRadius: 2 }}>
            <Typography sx={{ fontSize: 10, fontWeight: 700, color: "#D97706", textTransform: "uppercase", letterSpacing: "0.07em", mb: "6px" }}>How risk is calculated (based on RETURN, not RTO)</Typography>
            <Box sx={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
              <Typography sx={{ fontSize: 12, color: C.gray600 }}><strong style={{ color: "#DC2626" }}>High Risk</strong> — Return rate ≥ 50% OR ≥ 3 returns</Typography>
              <Typography sx={{ fontSize: 12, color: C.gray600 }}><strong style={{ color: "#D97706" }}>Medium</strong> — Return rate ≥ 25% OR ≥ 2 returns</Typography>
              <Typography sx={{ fontSize: 12, color: C.gray600 }}><strong style={{ color: "#16A34A" }}>Low</strong> — below thresholds</Typography>
              <Typography sx={{ fontSize: 11, color: C.gray400 }}>Only customers with ≥ {minOrders} orders shown · Click row to expand full history</Typography>
            </Box>
          </Paper>

          {/* Table */}
          {!loading && filtered.length === 0 ? (
            <Paper elevation={0} sx={{ border: `1px solid ${C.border}`, borderRadius: 2, p: "40px 24px", textAlign: "center" }}>
              <Typography sx={{ color: C.gray400 }}>No customers found matching the current filters.</Typography>
            </Paper>
          ) : (
            <Paper elevation={0} sx={{ border: `1px solid ${C.border}`, borderRadius: 2, overflow: "hidden" }}>
              <Box sx={{ p: "12px 18px 8px", display: "flex", alignItems: "center", gap: "10px" }}>
                <Typography sx={{ fontWeight: 700, fontSize: 14, color: C.gray800 }}>Customer Risk Analysis</Typography>
                <Chip label={`${filtered.length} customers`} size="small" sx={{ fontWeight: 700 }} />
                <Typography sx={{ fontSize: 11, color: C.gray400, ml: "auto" }}>Click any row to see full order history &amp; SKU breakdown</Typography>
              </Box>
              <Box sx={{ overflowX: "auto" }}>
                <Table size="small" sx={{ width: "100%", borderCollapse: "collapse" }}>
                  <TableHead>
                    <TableRow>
                      {[
                        ["",         "center", 36 ],
                        ["Customer", "left",   200],
                        ["Orders",   "center", 70 ],
                        ["Delivered","center", 80 ],
                        ["Returned", "center", 80 ],
                        ["RTO",      "center", 65 ],
                        ["Return Rate","left", 150],
                        ["SKUs",     "left",   200],
                        ["Risk",     "center", 110],
                        ["Last Order","left",  100],
                        ["Action",   "center", 90 ],
                      ].map(([h, a, w]) => (
                        <TableCell key={h || "exp"} sx={{ textAlign: a, fontSize: 11, fontWeight: 700, color: C.gray500, textTransform: "uppercase", letterSpacing: "0.06em", background: C.gray50, borderBottom: `1px solid ${C.border}`, py: "9px", px: "12px", minWidth: w, whiteSpace: "nowrap" }}>
                          {h}
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filtered.map(customer => (
                      <CustomerRow
                        key={`${customer.customer_name}|${customer.customer_pincode}`}
                        customer={customer}
                        onBlock={setBlockTarget}
                        expandedKey={expandedKey}
                        setExpandedKey={setExpandedKey}
                      />
                    ))}
                  </TableBody>
                </Table>
              </Box>
            </Paper>
          )}
        </Box>
      )}

      {/* ── Blocked customers view ── */}
      {activeView === "blocked" && (
        <Paper elevation={0} sx={{ border: `1px solid ${C.border}`, borderRadius: 2, overflow: "hidden" }}>
          <Box sx={{ p: "12px 18px 8px", display: "flex", alignItems: "center", gap: "10px" }}>
            <Typography sx={{ fontWeight: 700, fontSize: 14, color: C.gray800 }}>Blocked Customers</Typography>
            <Chip label={blocked.length} size="small" sx={{ fontWeight: 700, background: "#FEE2E2", color: "#DC2626" }} />
          </Box>
          <Box sx={{ overflowX: "auto" }}>
            <Table size="small" sx={{ width: "100%", borderCollapse: "collapse" }}>
              <TableHead>
                <TableRow>
                  {[["Customer","left",180],["Address","left",200],["Pincode","left",90],["Reason","left",200],["Blocked On","left",110],["Action","center",100]].map(([h,a,w]) => (
                    <TableCell key={h} sx={{ textAlign: a, fontSize: 11, fontWeight: 700, color: C.gray500, textTransform: "uppercase", letterSpacing: "0.06em", background: C.gray50, borderBottom: `1px solid ${C.border}`, py: "9px", px: "14px", minWidth: w }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {blocked.map(bc => (
                  <TableRow key={bc.id} sx={{ background: C.white, "&:hover": { background: "#FFF5F5" } }}>
                    <TableCell sx={{ py: "10px", px: "14px" }}>
                      <Typography sx={{ fontWeight: 700, fontSize: 13, color: C.gray800 }}>{bc.customer_name}</Typography>
                      <Typography sx={{ fontSize: 11, color: C.gray500 }}>{[bc.customer_city, bc.customer_state].filter(Boolean).join(", ")}</Typography>
                    </TableCell>
                    <TableCell sx={{ py: "10px", px: "14px" }}>
                      <Typography sx={{ fontSize: 12, color: C.gray600 }}>{bc.customer_address || "—"}</Typography>
                    </TableCell>
                    <TableCell sx={{ py: "10px", px: "14px" }}>
                      <span style={{ fontFamily: "monospace", fontSize: 12, color: C.gray500 }}>{bc.customer_pincode}</span>
                    </TableCell>
                    <TableCell sx={{ py: "10px", px: "14px" }}>
                      <Typography sx={{ fontSize: 12, color: C.gray500, fontStyle: bc.reason ? "normal" : "italic" }}>
                        {bc.reason || "No reason given"}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ py: "10px", px: "14px" }}>
                      <Typography sx={{ fontSize: 11, fontFamily: "monospace", color: C.gray400 }}>
                        {new Date(bc.blocked_at).toLocaleDateString("en-IN")}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ py: "10px", px: "14px", textAlign: "center" }}>
                      <Button size="small" variant="outlined" color="success" startIcon={<CheckCircleOutlineIcon />}
                        onClick={() => handleUnblock(bc.id)} sx={{ fontSize: 11, px: "10px", py: "3px", textTransform: "none" }}>
                        Unblock
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {blocked.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} sx={{ textAlign: "center", py: "40px", color: C.gray400 }}>No blocked customers</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Box>
        </Paper>
      )}
    </Box>
  );
}
