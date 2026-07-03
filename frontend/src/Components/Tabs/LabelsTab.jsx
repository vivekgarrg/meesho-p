import React, { useCallback, useEffect, useRef, useState } from "react";
import { BarChart } from "@mui/x-charts/BarChart";
import {
  Alert,
  Box,
  Button,
  ButtonGroup,
  Card,
  CardContent,
  Chip,
  Collapse,
  IconButton,
  LinearProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon   from "@mui/icons-material/KeyboardArrowUp";
import BlockIcon              from "@mui/icons-material/Block";
import { C, API, fmt } from "../../App";
import { PAGE_SIZE } from "../../lib/helper";

// ── localStorage helpers — persist parsed label results by date ───────────────
const _LS_PREFIX = "labels_parse_";
function saveParseResult(date, fileName, result) {
  try {
    // Exclude cropped_pdf_b64 — it can be several MBs and would fill the quota
    const { cropped_pdf_b64, ...rest } = result; // eslint-disable-line no-unused-vars
    localStorage.setItem(_LS_PREFIX + date, JSON.stringify({ fileName, result: rest }));
  } catch { /* quota exceeded — silently skip */ }
}
function loadParseResult(date) {
  try {
    const raw = localStorage.getItem(_LS_PREFIX + date);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

const COURIER_COLORS = {
  Valmo:          { bg: "#EFF6FF", fg: "#2563EB", border: "#BFDBFE" },
  Shadowfax:      { bg: "#F0FDF4", fg: "#16A34A", border: "#BBF7D0" },
  Delhivery:      { bg: "#FFF7ED", fg: "#EA580C", border: "#FED7AA" },
  "Xpress Bees":  { bg: "#FAF5FF", fg: "#9333EA", border: "#E9D5FF" },
  BlueDart:       { bg: "#FFF0EA", fg: "#E8510A", border: "#F5C4AD" },
  Ekart:          { bg: "#FFFBEB", fg: "#D97706", border: "#FDE68A" },
};

const DELIVERY_STATUS_STYLE = {
  DELIVERED:    { bg: "#F0FDF4", fg: "#16A34A", border: "#BBF7D0" },
  RTO_COMPLETE: { bg: "#FEF2F2", fg: "#DC2626", border: "#FECACA" },
  CANCELLED:    { bg: "#F9FAFB", fg: "#6B7280", border: "#E5E7EB" },
};

function cs(name) {
  return COURIER_COLORS[name] || { bg: C.gray100, fg: C.gray600, border: C.gray200 };
}
function todayISO() { return new Date().toISOString().slice(0, 10); }
function offsetDate(days) {
  const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10);
}
function daysDiff(iso) {
  return Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
}
function downloadCroppedPDF(b64, fileName) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const blob  = new Blob([bytes], { type: "application/pdf" });
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement("a");
  a.href = url; a.download = `labels_only_${fileName.replace(/\.pdf$/i, "")}.pdf`;
  a.click(); URL.revokeObjectURL(url);
}

// ── Shared tag ───────────────────────────────────────────────────────────────
function CTag({ children, bg, fg, border, fontSize = 11 }) {
  return (
    <Chip
      label={children}
      size="small"
      sx={{
        height: "auto",
        px: 0.5,
        py: "2px",
        fontSize,
        fontWeight: 600,
        background: bg,
        color: fg,
        border: `1px solid ${border}`,
        borderRadius: "20px",
        "& .MuiChip-label": { px: "6px", py: 0, lineHeight: 1.4, whiteSpace: "nowrap" },
      }}
    />
  );
}

// ── KPI card ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, accent, icon, highlight }) {
  return (
    <Paper
      elevation={1}
      sx={{
        borderTop: `3px solid ${accent}`,
        p: 2,
        borderRadius: 2,
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        background: highlight ? `${accent}0D` : C.white,
      }}
    >
      <Typography variant="subtitle2" sx={{ fontSize: 11, fontWeight: 700, color: C.gray400, letterSpacing: "0.07em", textTransform: "uppercase" }}>
        {icon} {label}
      </Typography>
      <Typography sx={{ fontSize: 26, fontWeight: 800, color: accent, fontFamily: "'DM Mono', monospace", lineHeight: 1.1 }}>
        {value}
      </Typography>
      {sub && <Typography sx={{ fontSize: 11, color: C.gray400 }}>{sub}</Typography>}
    </Paper>
  );
}

// ── Drop zone ────────────────────────────────────────────────────────────────
function DropZone({ onFile, disabled }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const handle = (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) { alert("Please upload a PDF file."); return; }
    onFile(file);
  };
  return (
    <div
      onClick={() => !disabled && inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); if (!disabled) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); if (!disabled) handle(e.dataTransfer.files[0]); }}
      style={{
        border: `2px dashed ${dragging ? C.orange : C.gray300}`,
        borderRadius: 14,
        padding: "40px 32px",
        textAlign: "center",
        cursor: disabled ? "not-allowed" : "pointer",
        background: dragging ? C.orangeLight : C.gray50,
        transition: "all 0.2s",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <div style={{ fontSize: 40, marginBottom: 10 }}>📄</div>
      <Typography sx={{ fontSize: 14, fontWeight: 700, color: C.gray700, mb: "5px" }}>
        Drop Meesho Labels PDF here
      </Typography>
      <Typography sx={{ fontSize: 12, color: C.gray400, mb: 2 }}>
        One label per page — extracts SKU + Qty from Product Details table
      </Typography>
      <Button
        variant="contained"
        disableElevation
        sx={{
          background: C.orange,
          color: C.white,
          fontWeight: 600,
          fontSize: 13,
          borderRadius: 2,
          textTransform: "none",
          "&:hover": { background: C.orange, opacity: 0.9 },
        }}
      >
        Choose PDF file
      </Button>
      <input ref={inputRef} type="file" accept=".pdf" style={{ display: "none" }} onChange={e => handle(e.target.files[0])} />
    </div>
  );
}

// ── Batch date picker ────────────────────────────────────────────────────────
function BatchDatePicker({ value, onChange }) {
  const today = todayISO();
  const diff  = daysDiff(value);
  const presets = [
    { label: "Today", date: today }, { label: "Yesterday", date: offsetDate(-1) },
    { label: "2 days ago", date: offsetDate(-2) }, { label: "3 days ago", date: offsetDate(-3) },
    { label: "1 week ago", date: offsetDate(-7) },
  ];
  return (
    <Paper
      elevation={1}
      sx={{
        p: "14px 20px",
        borderRadius: 2,
        borderLeft: `4px solid ${diff > 0 ? C.amber : C.green}`,
        background: diff > 0 ? "#FFFDF5" : C.greenLight,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: "7px", minWidth: 130 }}>
          <span style={{ fontSize: 16 }}>📅</span>
          <Box>
            <Typography sx={{ fontSize: 12, fontWeight: 700, color: C.gray700 }}>Batch Date</Typography>
            <Typography sx={{ fontSize: 11, color: C.gray400 }}>Record labels under this date</Typography>
          </Box>
        </Box>
        <Box sx={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {presets.map(p => {
            const active = value === p.date;
            return (
              <Chip
                key={p.date}
                label={p.label}
                size="small"
                onClick={() => onChange(p.date)}
                color={active ? "primary" : "default"}
                variant={active ? "filled" : "outlined"}
                sx={{
                  fontSize: 12,
                  fontWeight: active ? 700 : 500,
                  borderColor: active ? C.orange : C.gray300,
                  background: active ? C.orangeLight : C.white,
                  color: active ? C.orange : C.gray600,
                  cursor: "pointer",
                  "& .MuiChip-label": { px: "10px" },
                }}
              />
            );
          })}
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Typography sx={{ fontSize: 11, color: C.gray400 }}>custom:</Typography>
          <TextField
            type="date"
            size="small"
            value={value}
            inputProps={{ max: today }}
            onChange={e => e.target.value && onChange(e.target.value)}
            sx={{ width: 145, "& input": { fontSize: 12, py: "7px" } }}
          />
        </Box>
        <Chip
          label={diff === 0 ? "✓ Today" : `↩ Back-dated ${diff}d`}
          size="small"
          sx={{
            ml: "auto",
            fontSize: 12,
            fontWeight: 700,
            background: diff === 0 ? C.greenLight : C.amberLight,
            color: diff === 0 ? C.green : C.amber,
            border: `1px solid ${diff === 0 ? C.greenBorder : "#FDE68A"}`,
            "& .MuiChip-label": { px: "10px" },
          }}
        />
      </Box>
    </Paper>
  );
}

// ── Customer history drawer ───────────────────────────────────────────────────
function SummaryKpi({ label, value, sub, accent, icon }) {
  return (
    <Paper
      elevation={1}
      sx={{
        borderTop: `3px solid ${accent}`,
        p: 2,
        borderRadius: 2,
        display: "flex",
        flexDirection: "column",
        gap: "5px",
      }}
    >
      <Typography sx={{ fontSize: 10, fontWeight: 700, color: C.gray400, textTransform: "uppercase", letterSpacing: "0.07em" }}>
        {icon} {label}
      </Typography>
      <Typography sx={{ fontSize: 22, fontWeight: 800, color: accent, fontFamily: "'DM Mono', monospace", lineHeight: 1 }}>
        {value}
      </Typography>
      {sub && <Typography sx={{ fontSize: 11, color: C.gray400 }}>{sub}</Typography>}
    </Paper>
  );
}

function CustomerHistoryDrawer({ query, onClose }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  useEffect(() => {
    setLoading(true); setData(null); setError("");
    const params = new URLSearchParams();
    if (query.name)    params.set("name", query.name);
    if (query.pincode) params.set("pincode", query.pincode);
    fetch(`${API}/labels/customer-history/?${params}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => { setError("Failed to load history"); setLoading(false); });
  }, [query.name, query.pincode]);

  const s = data?.summary || {};

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", zIndex: 9000, display: "flex", justifyContent: "flex-end" }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ width: "min(820px, 96vw)", height: "100vh", background: C.white, overflowY: "auto", boxShadow: "-12px 0 48px rgba(0,0,0,0.18)", display: "flex", flexDirection: "column" }}
      >
        <div
          style={{ padding: "18px 24px 16px", borderBottom: `1px solid ${C.border}`, background: C.gray50, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, position: "sticky", top: 0, zIndex: 10 }}
        >
          <div>
            <Typography sx={{ fontSize: 17, fontWeight: 800, color: C.gray800, mb: "4px" }}>👤 {query.name || `Pincode ${query.pincode}`}</Typography>
            {data && <Typography sx={{ fontSize: 12, color: C.gray400 }}>{[data.customer_city, data.customer_state, data.customer_pincode].filter(Boolean).join(", ")}</Typography>}
          </div>
          <Button
            variant="outlined"
            size="small"
            onClick={onClose}
            sx={{ flexShrink: 0, color: C.gray600, borderColor: C.gray300, textTransform: "none", fontWeight: 500 }}
          >
            ✕ Close
          </Button>
        </div>
        <div style={{ padding: "20px 24px", flex: 1 }}>
          {loading && <Typography sx={{ textAlign: "center", p: "60px", color: C.gray400 }}>Loading history…</Typography>}
          {error && (
            <Alert severity="error" sx={{ borderRadius: 2 }}>{error}</Alert>
          )}
          {data && !loading && (
            <>
              {data.customer_address && (
                <Paper elevation={0} sx={{ p: "12px 16px", mb: "18px", background: C.blueLight, border: `1px solid #BFDBFE`, borderRadius: 2 }}>
                  <Typography sx={{ fontSize: 11, fontWeight: 700, color: C.blue, textTransform: "uppercase", letterSpacing: "0.07em", mb: "6px" }}>📍 Customer Address</Typography>
                  <Typography sx={{ fontSize: 13, color: C.gray700, lineHeight: 1.6, whiteSpace: "pre-line" }}>{data.customer_address}</Typography>
                </Paper>
              )}
              <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "12px", mb: "20px" }}>
                <SummaryKpi label="Total Orders"   value={s.total_orders}  accent={C.blue}   icon="📦" />
                <SummaryKpi label="Total Items"    value={s.total_items}   accent={C.orange} icon="🏷" />
                <SummaryKpi label="Delivered"      value={s.delivered}     accent={C.green}  icon="✅" sub={s.total_orders > 0 ? `${((s.delivered / s.total_orders) * 100).toFixed(0)}% rate` : ""} />
                <SummaryKpi label="RTO"            value={s.rto}           accent={C.red}    icon="↩" />
                <SummaryKpi label="Pending"        value={s.pending}       accent={s.pending > 0 ? C.amber : C.green} icon="⏳" />
                <SummaryKpi label="Net Settlement" value={fmt(s.total_settlement)} accent={s.total_settlement > 0 ? C.green : C.gray400} icon="💰" sub={`${s.settled_count} of ${s.total_orders} settled`} />
              </Box>
              <Typography variant="subtitle2" sx={{ fontSize: 11, fontWeight: 700, color: C.gray400, textTransform: "uppercase", letterSpacing: "0.08em", mb: "12px" }}>
                Order History — {s.total_orders} orders
              </Typography>
              <Box sx={{ overflowX: "auto", border: `1px solid ${C.border}`, borderRadius: "10px", overflow: "hidden" }}>
                <Table size="small" sx={{ width: "100%", borderCollapse: "collapse" }}>
                  <TableHead>
                    <TableRow>
                      {["Upload Date", "Order ID", "SKU", "Qty", "Courier", "Payment", "Delivery Status", "Settlement", "Settled Date"].map(h => (
                        <TableCell key={h} sx={{ fontSize: 10, fontWeight: 700, color: C.gray500, letterSpacing: "0.06em", textTransform: "uppercase", background: C.gray50, whiteSpace: "nowrap", borderBottom: `1px solid ${C.border}` }}>{h}</TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(data.orders || []).map((r, i) => {
                      const dlStyle = DELIVERY_STATUS_STYLE[r.delivery_status] || { bg: C.gray100, fg: C.gray500, border: C.gray200 };
                      const rowBg   = i % 2 === 0 ? C.white : C.gray50;
                      return (
                        <TableRow
                          key={r.order_id}
                          sx={{ background: rowBg, "&:hover": { background: "#F0F7FF" } }}
                        >
                          <TableCell sx={{ fontSize: 12, color: C.gray500, whiteSpace: "nowrap", py: "8px", px: "16px" }}>{r.uploaded_date || "—"}</TableCell>
                          <TableCell sx={{ fontFamily: "monospace", fontSize: 10, color: C.gray400, py: "8px", px: "16px" }}>…{String(r.order_id || "").slice(-12)}</TableCell>
                          <TableCell sx={{ py: "8px", px: "16px" }}>
                            {r.sku
                              ? <span style={{ fontFamily: "monospace", fontSize: 11, color: C.orange, fontWeight: 600, background: C.orangeLight, padding: "2px 6px", borderRadius: 4 }}>{r.sku}</span>
                              : <span style={{ color: C.gray300 }}>—</span>}
                          </TableCell>
                          <TableCell sx={{ textAlign: "center", py: "8px", px: "16px" }}>
                            {r.qty > 1
                              ? <CTag bg={C.amberLight} fg={C.amber} border="#FDE68A">×{r.qty}</CTag>
                              : <span style={{ color: C.gray400, fontSize: 12 }}>1</span>}
                          </TableCell>
                          <TableCell sx={{ py: "8px", px: "16px" }}>
                            {r.courier_name
                              ? <CTag bg={cs(r.courier_name).bg} fg={cs(r.courier_name).fg} border={cs(r.courier_name).border}>{r.courier_name}</CTag>
                              : <span style={{ color: C.gray300 }}>—</span>}
                          </TableCell>
                          <TableCell sx={{ py: "8px", px: "16px" }}>
                            {r.payment_type === "Prepaid"
                              ? <CTag bg="#F0FDF4" fg="#16A34A" border="#BBF7D0">Prepaid</CTag>
                              : r.payment_type === "COD"
                              ? <CTag bg="#FFFBEB" fg="#D97706" border="#FDE68A">COD</CTag>
                              : <span style={{ color: C.gray300 }}>—</span>}
                          </TableCell>
                          <TableCell sx={{ py: "8px", px: "16px" }}>
                            {r.delivery_status
                              ? <CTag bg={dlStyle.bg} fg={dlStyle.fg} border={dlStyle.border}>{r.delivery_status}</CTag>
                              : r.live_order_status
                              ? <CTag bg={C.blueLight} fg={C.blue} border="#BFDBFE">{r.live_order_status}</CTag>
                              : <CTag bg={C.gray100} fg={C.gray500} border={C.gray200}>Pending</CTag>}
                          </TableCell>
                          <TableCell sx={{ fontFamily: "monospace", fontWeight: r.is_settled ? 700 : 400, color: r.is_settled ? (r.settlement_amount >= 0 ? C.green : C.red) : C.gray300, py: "8px", px: "16px" }}>
                            {r.is_settled ? fmt(r.settlement_amount) : "—"}
                          </TableCell>
                          <TableCell sx={{ fontSize: 11, color: C.gray400, whiteSpace: "nowrap", py: "8px", px: "16px" }}>{r.payment_date || "—"}</TableCell>
                        </TableRow>
                      );
                    })}
                    {(!data.orders || data.orders.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={9} sx={{ textAlign: "center", py: "32px", color: C.gray400 }}>No orders found</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </Box>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Duplicate address drawer ──────────────────────────────────────────────────
function DuplicateAddressDrawer({ entry, onClose }) {
  const { address_key, customer_city, customer_state, customer_pincode, orders = [] } = entry;
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)", zIndex: 9100, display: "flex", justifyContent: "flex-end" }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ width: "min(860px, 97vw)", height: "100vh", background: C.white, overflowY: "auto", boxShadow: "-12px 0 48px rgba(0,0,0,0.2)", display: "flex", flexDirection: "column" }}
      >
        {/* Header */}
        <div style={{ padding: "18px 24px 14px", borderBottom: `1px solid ${C.border}`, background: "#FFFBEB", position: "sticky", top: 0, zIndex: 10 }}>
          <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
            <div>
              <Box sx={{ display: "flex", alignItems: "center", gap: "8px", mb: "4px" }}>
                <span style={{ fontSize: 20 }}>🔁</span>
                <Typography sx={{ fontSize: 16, fontWeight: 800, color: C.gray800 }}>Repeated Address</Typography>
                <Chip
                  label={`${orders.length} orders`}
                  size="small"
                  sx={{ background: C.amberLight, color: C.amber, border: "1px solid #FDE68A", fontWeight: 700, fontSize: 12, "& .MuiChip-label": { px: "8px" } }}
                />
              </Box>
              <Typography sx={{ fontSize: 13, color: C.gray600, fontFamily: "monospace" }}>
                📍 {customer_city}{customer_state ? `, ${customer_state}` : ""} — Pincode: <strong>{customer_pincode}</strong>
              </Typography>
              <Typography sx={{ fontSize: 11, color: C.gray400, mt: "2px" }}>
                Same delivery address found in {orders.length} different orders
              </Typography>
            </div>
            <Button
              variant="outlined"
              size="small"
              onClick={onClose}
              sx={{ flexShrink: 0, color: C.gray600, borderColor: C.gray300, textTransform: "none", fontWeight: 500 }}
            >
              ✕ Close
            </Button>
          </Box>
        </div>

        {/* Orders detail table */}
        <div style={{ padding: "20px 24px", flex: 1 }}>
          <Box sx={{ overflowX: "auto", border: `1px solid ${C.border}`, borderRadius: "10px", overflow: "hidden" }}>
            <Table size="small" sx={{ width: "100%", borderCollapse: "collapse" }}>
              <TableHead>
                <TableRow>
                  {["#", "Upload Date", "Order ID", "Customer Name", "City", "State", "Pincode", "Courier", "AWB", "Payment", "SKU", "Qty", "Packed"].map(h => (
                    <TableCell key={h} sx={{ fontSize: 11, fontWeight: 700, color: C.gray500, textTransform: "uppercase", letterSpacing: "0.06em", background: C.gray50, whiteSpace: "nowrap", borderBottom: `1px solid ${C.border}` }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {orders.map((o, i) => {
                  const rowBg = i % 2 === 0 ? C.white : "#FFFBEB";
                  return (
                    <TableRow
                      key={o.order_id}
                      sx={{ background: rowBg, "&:hover": { background: "#FEF9C3" } }}
                    >
                      <TableCell sx={{ color: C.gray400, fontSize: 11, py: "8px", px: "12px" }}>{i + 1}</TableCell>
                      <TableCell sx={{ whiteSpace: "nowrap", color: C.gray500, fontSize: 12, py: "8px", px: "12px" }}>{o.uploaded_date || "—"}</TableCell>
                      <TableCell sx={{ fontFamily: "monospace", fontSize: 10, color: C.gray400, whiteSpace: "nowrap", py: "8px", px: "12px" }}>…{String(o.order_id || "").slice(-14)}</TableCell>
                      <TableCell sx={{ fontWeight: 700, color: C.gray800, whiteSpace: "nowrap", py: "8px", px: "12px" }}>{o.customer_name || "—"}</TableCell>
                      <TableCell sx={{ color: C.gray600, whiteSpace: "nowrap", py: "8px", px: "12px" }}>{o.customer_city || "—"}</TableCell>
                      <TableCell sx={{ color: C.gray600, py: "8px", px: "12px" }}>{o.customer_state || "—"}</TableCell>
                      <TableCell sx={{ fontFamily: "monospace", fontWeight: 700, color: C.blue, py: "8px", px: "12px" }}>{o.customer_pincode || "—"}</TableCell>
                      <TableCell sx={{ py: "8px", px: "12px" }}>
                        {o.courier_name
                          ? <CTag bg={cs(o.courier_name).bg} fg={cs(o.courier_name).fg} border={cs(o.courier_name).border}>{o.courier_name}</CTag>
                          : <span style={{ color: C.gray300 }}>—</span>}
                      </TableCell>
                      <TableCell sx={{ fontFamily: "monospace", fontSize: 10, color: C.gray500, py: "8px", px: "12px" }}>{o.awb_number || "—"}</TableCell>
                      <TableCell sx={{ py: "8px", px: "12px" }}>
                        {o.payment_type === "Prepaid"
                          ? <CTag bg="#F0FDF4" fg="#16A34A" border="#BBF7D0">Prepaid</CTag>
                          : o.payment_type === "COD"
                          ? <CTag bg="#FFFBEB" fg="#D97706" border="#FDE68A">COD</CTag>
                          : <span style={{ color: C.gray300 }}>—</span>}
                      </TableCell>
                      <TableCell sx={{ py: "8px", px: "12px" }}>
                        {o.sku
                          ? <span style={{ fontFamily: "monospace", fontSize: 10, color: C.orange, fontWeight: 700, background: C.orangeLight, padding: "2px 6px", borderRadius: 4 }}>{o.sku}</span>
                          : <span style={{ color: C.gray300 }}>—</span>}
                      </TableCell>
                      <TableCell sx={{ textAlign: "center", fontFamily: "monospace", py: "8px", px: "12px" }}>{o.qty || 1}</TableCell>
                      <TableCell sx={{ textAlign: "center", py: "8px", px: "12px" }}>
                        {o.is_packed
                          ? <Chip label="✓ Packed" size="small" sx={{ fontSize: 11, background: C.greenLight, color: C.green, border: `1px solid ${C.greenBorder}`, fontWeight: 700, "& .MuiChip-label": { px: "6px" } }} />
                          : <Chip label="—" size="small" sx={{ fontSize: 11, background: C.gray100, color: C.gray400, border: `1px solid ${C.gray200}`, "& .MuiChip-label": { px: "6px" } }} />}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Box>
        </div>
      </div>
    </div>
  );
}

// ── Duplicate address banner ──────────────────────────────────────────────────
function DuplicateBanner({ repData, repLoading }) {
  const [open, setOpen]           = useState(null); // entry to show in drawer
  const [expanded, setExpanded]   = useState(false);

  if (repLoading) return null;
  if (!repData || repData.total === 0) return null;

  const results = repData.results || [];
  const shown   = expanded ? results : results.slice(0, 3);

  return (
    <>
      {open && <DuplicateAddressDrawer entry={open} onClose={() => setOpen(null)} />}

      <Box sx={{ background: "#FFFBEB", border: `2px solid #FDE68A`, borderRadius: "10px", p: "12px 16px" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: "8px", mb: "10px" }}>
          <span style={{ fontSize: 16 }}>🔁</span>
          <Typography sx={{ fontSize: 13, fontWeight: 800, color: C.amber }}>
            {repData.total} Repeated Address{repData.total !== 1 ? "es" : ""} Found
          </Typography>
          <Typography sx={{ fontSize: 11, color: C.gray500 }}>— same delivery address ordered multiple times</Typography>
        </Box>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
          {shown.map((entry) => (
            <Chip
              key={entry.address_key}
              label={
                <Box sx={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span>📍 {entry.address_key}</span>
                  <Box component="span" sx={{ background: "#FDE68A", color: "#78350F", borderRadius: "20px", px: "7px", py: "1px", fontSize: 10 }}>{entry.order_count}×</Box>
                </Box>
              }
              onClick={() => setOpen(entry)}
              size="small"
              sx={{
                background: C.amberLight,
                color: "#92400E",
                border: "1px solid #FDE68A",
                fontWeight: 600,
                fontSize: 12,
                cursor: "pointer",
                height: "auto",
                py: "3px",
                "& .MuiChip-label": { px: "10px" },
              }}
            />
          ))}
          {results.length > 3 && (
            <Chip
              label={expanded ? "Show less ▲" : `+${results.length - 3} more ▼`}
              onClick={() => setExpanded(e => !e)}
              size="small"
              sx={{
                background: C.white,
                color: C.amber,
                border: "1px solid #FDE68A",
                fontWeight: 600,
                fontSize: 12,
                cursor: "pointer",
                "& .MuiChip-label": { px: "10px" },
              }}
            />
          )}
        </Box>
      </Box>
    </>
  );
}

// ── Orders by partner tab ─────────────────────────────────────────────────────
function OrdersByPartnerTab({ availDates, activeRange, onRangeChange, onViewHistory }) {
  const [orders,      setOrders]      = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [filter,      setFilter]      = useState("all");   // "all" | "packed" | "unpacked"
  const [search,      setSearch]      = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [dateMode,    setDateMode]    = useState("all");
  const [selDate,     setSelDate]     = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page_size: 1000 });
    if (activeRange?.date_from) params.set("date_from", activeRange.date_from);
    if (activeRange?.date_to)   params.set("date_to",   activeRange.date_to);
    try {
      const r = await fetch(`${API}/labels/orders/?${params}`);
      if (r.ok) setOrders((await r.json()).results || []);
    } finally { setLoading(false); }
  }, [JSON.stringify(activeRange)]); // eslint-disable-line

  useEffect(() => { if (activeRange !== null) load(); }, [load, activeRange]);

  const togglePacked = async (order_id, current) => {
    const res = await fetch(`${API}/labels/orders/${encodeURIComponent(order_id)}/pack/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packed: !current }),
    });
    if (res.ok) {
      const upd = (list) => list.map(o => o.order_id === order_id ? { ...o, is_packed: !current } : o);
      setOrders(upd); setSuggestions(upd);
    }
  };

  const markAllPacked = async () => {
    const targets = displayed.filter(o => !o.is_packed);
    if (targets.length === 0) return;
    if (!window.confirm(`Mark all ${targets.length} displayed orders as packed?`)) return;
    const res = await fetch(`${API}/labels/bulk-pack/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_ids: targets.map(o => o.order_id), packed: true }),
    });
    if (res.ok) setOrders(prev => prev.map(o => targets.find(t => t.order_id === o.order_id) ? { ...o, is_packed: true } : o));
  };

  const handleSearch = (val) => {
    setSearch(val);
    const v = val.trim();
    if (v.length >= 2) {
      setSuggestions(
        orders.filter(o => {
          const id = String(o.order_id);
          return id.slice(-4).includes(v) || id.endsWith(v);
        }).slice(0, 8)
      );
    } else { setSuggestions([]); }
  };

  const applyDate = (mode, dateStr, range) => {
    setDateMode(mode);
    if (dateStr) setSelDate(dateStr);
    onRangeChange(range);
  };

  const packedCount   = orders.filter(o => o.is_packed).length;
  const unpackedCount = orders.length - packedCount;
  const allPacked     = orders.length > 0 && unpackedCount === 0;

  const displayed = orders.filter(o => {
    if (filter === "packed")   return o.is_packed;
    if (filter === "unpacked") return !o.is_packed;
    return true;
  });

  const byCourier = displayed.reduce((acc, o) => {
    const c = o.courier_name || "Unknown";
    if (!acc[c]) acc[c] = [];
    acc[c].push(o);
    return acc;
  }, {});

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: "16px" }}>

      {/* Date filter */}
      <Paper elevation={1} sx={{ p: "12px 16px", borderRadius: 2, display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <Typography sx={{ fontSize: 12, fontWeight: 700, color: C.gray500, textTransform: "uppercase", letterSpacing: "0.06em" }}>📅 Date</Typography>
        <Chip
          label="All Time"
          size="small"
          onClick={() => applyDate("all", "", {})}
          color={dateMode === "all" ? "primary" : "default"}
          variant={dateMode === "all" ? "filled" : "outlined"}
          sx={{
            fontSize: 12,
            fontWeight: dateMode === "all" ? 700 : 500,
            background: dateMode === "all" ? C.orangeLight : C.white,
            color: dateMode === "all" ? C.orange : C.gray600,
            borderColor: dateMode === "all" ? C.orange : C.gray300,
            cursor: "pointer",
          }}
        />
        {availDates.slice(0, 7).map(d => (
          <Chip
            key={d}
            label={d}
            size="small"
            onClick={() => applyDate("single", d, { date_from: d, date_to: d })}
            color={dateMode === "single" && selDate === d ? "primary" : "default"}
            variant={dateMode === "single" && selDate === d ? "filled" : "outlined"}
            sx={{
              fontSize: 11,
              fontWeight: dateMode === "single" && selDate === d ? 700 : 500,
              background: dateMode === "single" && selDate === d ? C.orangeLight : C.white,
              color: dateMode === "single" && selDate === d ? C.orange : C.gray600,
              borderColor: dateMode === "single" && selDate === d ? C.orange : C.gray300,
              cursor: "pointer",
            }}
          />
        ))}
        <Button
          size="small"
          variant="outlined"
          onClick={load}
          sx={{ minWidth: 0, px: "10px", py: "4px", color: C.gray500, borderColor: C.gray300, fontSize: 12, textTransform: "none" }}
        >
          ⟳
        </Button>
      </Paper>

      {loading ? (
        <Typography sx={{ textAlign: "center", p: "48px", color: C.gray400 }}>Loading orders…</Typography>
      ) : orders.length === 0 ? (
        <Typography sx={{ textAlign: "center", p: "48px", color: C.gray400 }}>No orders found for this period.</Typography>
      ) : (
        <>
          {/* Stats + search row */}
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "flex-start" }}>
            {/* KPIs */}
            <Box sx={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              {[
                { label: "Total",      value: orders.length,  color: C.blue   },
                { label: "Packed",     value: packedCount,    color: C.green  },
                { label: "Not Packed", value: unpackedCount,  color: unpackedCount > 0 ? C.red : C.gray300 },
              ].map(k => (
                <Paper key={k.label} elevation={0} sx={{ background: C.gray50, border: `1px solid ${C.border}`, borderRadius: "10px", p: "8px 16px", textAlign: "center" }}>
                  <Typography sx={{ fontSize: 10, fontWeight: 700, color: C.gray400, textTransform: "uppercase" }}>{k.label}</Typography>
                  <Typography sx={{ fontSize: 18, fontWeight: 800, color: k.color, fontFamily: "monospace" }}>{k.value}</Typography>
                </Paper>
              ))}
              {!allPacked && (
                <Button
                  color="success"
                  variant="outlined"
                  size="small"
                  onClick={markAllPacked}
                  sx={{ alignSelf: "center", fontSize: 12, fontWeight: 700, textTransform: "none", borderColor: C.green, color: C.green, background: C.greenLight, "&:hover": { background: C.greenLight, borderColor: C.green } }}
                >
                  ✓ Mark All Packed
                </Button>
              )}
              {allPacked && (
                <Paper elevation={0} sx={{ alignSelf: "center", p: "8px 14px", borderRadius: 2, background: C.greenLight, color: C.green, fontSize: 12, fontWeight: 700, border: `1px solid ${C.greenBorder}` }}>
                  🎉 All Packed!
                </Paper>
              )}
            </Box>

            {/* Autocomplete search */}
            <Box sx={{ position: "relative", minWidth: 260 }}>
              <Typography variant="subtitle2" sx={{ fontSize: 11, fontWeight: 600, color: C.gray600, mb: "3px" }}>
                Find by last 4 digits of suborder #
              </Typography>
              <TextField
                size="small"
                value={search}
                onChange={e => handleSearch(e.target.value)}
                placeholder="e.g. 0480"
                sx={{ width: "100%", "& input": { fontSize: 13 } }}
              />
              {suggestions.length > 0 && (
                <Box sx={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50, background: C.white, border: `1px solid ${C.border}`, borderRadius: "8px", boxShadow: "0 8px 24px rgba(0,0,0,0.12)", mt: "2px", overflow: "hidden" }}>
                  {suggestions.map(o => (
                    <Box key={o.order_id} sx={{ p: "8px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${C.gray100}`, background: o.is_packed ? "#F0FDF4" : C.white }}>
                      <div>
                        <span style={{ fontFamily: "monospace", fontSize: 11, color: C.gray500 }}>…{o.order_id.slice(-14)}</span>
                        <span style={{ marginLeft: 8, fontSize: 12, color: C.gray600 }}>{o.customer_name}</span>
                      </div>
                      <Button
                        size="small"
                        onClick={() => { togglePacked(o.order_id, o.is_packed); setSearch(""); setSuggestions([]); }}
                        sx={{
                          fontSize: 11,
                          fontWeight: 600,
                          textTransform: "none",
                          borderRadius: "20px",
                          px: "10px",
                          py: "2px",
                          minWidth: 0,
                          background: o.is_packed ? C.greenLight : "#FEE2E2",
                          color: o.is_packed ? C.green : C.red,
                          "&:hover": { background: o.is_packed ? C.greenLight : "#FEE2E2", opacity: 0.85 },
                        }}
                      >
                        {o.is_packed ? "✓ Packed" : "Not Packed"}
                      </Button>
                    </Box>
                  ))}
                </Box>
              )}
            </Box>

            {/* Filter tabs */}
            <Box sx={{ display: "flex", gap: "4px", background: C.gray100, borderRadius: "8px", p: "3px", alignSelf: "flex-end" }}>
              {[["all", "All"], ["packed", "✓ Packed"], ["unpacked", "Not Packed"]].map(([id, label]) => (
                <Button
                  key={id}
                  size="small"
                  onClick={() => setFilter(id)}
                  sx={{
                    px: "14px",
                    py: "5px",
                    borderRadius: "6px",
                    border: "none",
                    fontSize: 12,
                    fontWeight: filter === id ? 700 : 500,
                    background: filter === id ? C.white : "transparent",
                    color: filter === id ? C.orange : C.gray500,
                    boxShadow: filter === id ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
                    textTransform: "none",
                    "&:hover": { background: filter === id ? C.white : "transparent" },
                    minWidth: 0,
                  }}
                >
                  {label} ({id === "all" ? orders.length : id === "packed" ? packedCount : unpackedCount})
                </Button>
              ))}
            </Box>
          </Box>

          {/* Orders grouped by courier */}
          {displayed.length === 0 ? (
            <Typography sx={{ textAlign: "center", p: "32px", color: C.gray400 }}>
              {filter === "packed" ? "No packed orders." : filter === "unpacked" ? "🎉 All orders packed!" : "No orders."}
            </Typography>
          ) : (
            <Box sx={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {Object.entries(byCourier).sort().map(([courier, rows]) => {
                const cst = cs(courier);
                const cp  = rows.filter(o => o.is_packed).length;
                return (
                  <Box key={courier} sx={{ border: `1px solid ${cst.border}`, borderRadius: "10px", overflow: "hidden" }}>
                    {/* Courier header */}
                    <Box sx={{ background: cst.bg, p: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
                      <Typography sx={{ fontWeight: 800, fontSize: 14, color: cst.fg }}>{courier}</Typography>
                      <Box sx={{ display: "flex", gap: "8px", alignItems: "center" }}>
                        <Typography sx={{ fontSize: 12, color: cst.fg, fontWeight: 600 }}>{rows.length} orders</Typography>
                        <Chip label={`${cp} packed`} size="small" sx={{ fontSize: 11, background: C.greenLight, color: C.green, border: `1px solid ${C.greenBorder}`, fontWeight: 700, "& .MuiChip-label": { px: "6px" } }} />
                        {cp < rows.length && <Chip label={`${rows.length - cp} left`} size="small" sx={{ fontSize: 11, background: C.redLight, color: C.red, border: `1px solid ${C.redBorder}`, fontWeight: 700, "& .MuiChip-label": { px: "6px" } }} />}
                      </Box>
                    </Box>

                    {/* Orders table */}
                    <Box sx={{ overflowX: "auto" }}>
                      <Table size="small" sx={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                        <TableHead>
                          <TableRow sx={{ background: C.gray50 }}>
                            {["Order ID", "Customer", "City / State", "AWB", "Payment", "SKU", "Qty", "Date", "Packed"].map(h => (
                              <TableCell key={h} sx={{ fontSize: 10, fontWeight: 700, color: C.gray500, textTransform: "uppercase", letterSpacing: "0.06em", background: C.gray50, whiteSpace: "nowrap", borderBottom: `1px solid ${C.border}` }}>{h}</TableCell>
                            ))}
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {rows.map((o, i) => (
                            <TableRow
                              key={o.order_id}
                              sx={{
                                background: o.is_packed ? "#F0FDF4" : i % 2 === 0 ? C.white : C.gray50,
                                borderTop: `1px solid ${C.gray100}`,
                                cursor: "pointer",
                                "&:hover": { background: o.is_packed ? "#D1FAE5" : "#F0F7FF" },
                              }}
                              onClick={() => onViewHistory({ name: o.customer_name, pincode: o.customer_pincode })}
                            >
                              <TableCell sx={{ fontFamily: "monospace", fontSize: 10, color: C.gray400, whiteSpace: "nowrap", py: "8px", px: "12px" }}>…{o.order_id.slice(-14)}</TableCell>
                              <TableCell sx={{ fontWeight: 600, color: C.gray700, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", py: "8px", px: "12px" }}>{o.customer_name || "—"}</TableCell>
                              <TableCell sx={{ color: C.gray500, whiteSpace: "nowrap", fontSize: 11, py: "8px", px: "12px" }}>{[o.customer_city, o.customer_state].filter(Boolean).join(", ") || "—"}</TableCell>
                              <TableCell sx={{ fontFamily: "monospace", fontSize: 10, color: C.gray500, py: "8px", px: "12px" }}>{o.awb_number || "—"}</TableCell>
                              <TableCell sx={{ textAlign: "center", py: "8px", px: "12px" }}>
                                {o.payment_type === "COD"
                                  ? <CTag bg="#FFFBEB" fg="#D97706" border="#FDE68A">COD</CTag>
                                  : o.payment_type === "Prepaid"
                                  ? <CTag bg="#F0FDF4" fg="#16A34A" border="#BBF7D0">PP</CTag>
                                  : <span style={{ color: C.gray300 }}>—</span>}
                              </TableCell>
                              <TableCell sx={{ fontFamily: "monospace", fontSize: 10, color: C.orange, fontWeight: 700, py: "8px", px: "12px" }}>{o.sku || "—"}</TableCell>
                              <TableCell sx={{ textAlign: "center", fontFamily: "monospace", py: "8px", px: "12px" }}>{o.qty || 1}</TableCell>
                              <TableCell sx={{ color: C.gray400, fontSize: 11, whiteSpace: "nowrap", py: "8px", px: "12px" }}>{o.uploaded_date || "—"}</TableCell>
                              <TableCell
                                sx={{ textAlign: "center", py: "8px", px: "12px" }}
                                onClick={e => { e.stopPropagation(); togglePacked(o.order_id, o.is_packed); }}
                              >
                                <Button
                                  size="small"
                                  sx={{
                                    px: "10px",
                                    py: "2px",
                                    borderRadius: "20px",
                                    fontSize: 11,
                                    fontWeight: 600,
                                    whiteSpace: "nowrap",
                                    textTransform: "none",
                                    minWidth: 0,
                                    background: o.is_packed ? C.greenLight : C.white,
                                    color: o.is_packed ? C.green : C.gray400,
                                    border: `1px solid ${o.is_packed ? C.greenBorder : C.gray300}`,
                                    "&:hover": { background: o.is_packed ? C.greenLight : C.white, opacity: 0.85 },
                                  }}
                                >
                                  {o.is_packed ? "✓ Packed" : "Not Packed"}
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Box>
                  </Box>
                );
              })}
            </Box>
          )}
        </>
      )}
    </Box>
  );
}

// ── Repeated-customer helpers ─────────────────────────────────────────────────
const STATUS_STYLE_R = {
  DELIVERED: { bg: "#D1FAE5", color: "#065F46", border: "#6EE7B7", label: "Delivered" },
  RETURN:    { bg: "#FEE2E2", color: "#991B1B", border: "#FCA5A5", label: "Return"    },
  RTO:       { bg: "#FEF3C7", color: "#92400E", border: "#FDE68A", label: "RTO"       },
  CANCELLED: { bg: "#F3F4F6", color: "#6B7280", border: "#D1D5DB", label: "Cancelled" },
  PENDING:   { bg: "#EFF6FF", color: "#1E40AF", border: "#BFDBFE", label: "Pending"   },
};
function RStatusChip({ status }) {
  const s = STATUS_STYLE_R[status] || STATUS_STYLE_R.PENDING;
  return (
    <span style={{ display: "inline-block", background: s.bg, color: s.color,
      border: `1px solid ${s.border}`, borderRadius: 4, fontSize: 10, fontWeight: 700,
      padding: "1px 6px", lineHeight: "18px" }}>{s.label}</span>
  );
}
function ReturnBar({ rate }) {
  const pct   = Math.round(rate * 100);
  const color = rate >= 0.5 ? "#DC2626" : rate >= 0.25 ? "#D97706" : "#16A34A";
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 100 }}>
      <Box sx={{ flex: 1, height: 5, borderRadius: 3, background: "#E5E7EB", overflow: "hidden" }}>
        <Box sx={{ width: `${pct}%`, height: "100%", borderRadius: 3, background: color }} />
      </Box>
      <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 11, color, minWidth: 30 }}>{pct}%</span>
    </Box>
  );
}
const RISK_COLORS = {
  high:   { bg: "#FEE2E2", color: "#DC2626", border: "#FCA5A5" },
  medium: { bg: "#FEF3C7", color: "#D97706", border: "#FDE68A" },
  low:    { bg: "#D1FAE5", color: "#059669", border: "#6EE7B7" },
};

function RepeatCustomerRow({ c, onBlock }) {
  const [open, setOpen] = useState(false);
  const rk = RISK_COLORS[c.risk_level] || RISK_COLORS.low;
  return (
    <>
      <TableRow
        sx={{ cursor: "pointer", background: c.is_blocked ? "#FFF0F0" : c.risk_level === "high" ? "#FFF5F5" : "#FFFBEB",
          borderLeft: `4px solid ${rk.color}`, "&:hover": { background: "#FFF7ED" } }}
        onClick={() => setOpen(o => !o)}
      >
        <TableCell sx={{ py: "8px", px: "10px", width: 32 }}>
          {open ? <KeyboardArrowUpIcon sx={{ fontSize: 17, color: C.gray400 }} /> : <KeyboardArrowDownIcon sx={{ fontSize: 17, color: C.gray400 }} />}
        </TableCell>
        <TableCell sx={{ py: "8px", px: "12px" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
            <Typography sx={{ fontWeight: 800, fontSize: 13, color: C.gray800 }}>{c.customer_name}</Typography>
            {c.is_blocked && <span style={{ fontSize: 9, fontWeight: 800, background: "#FEE2E2", color: "#DC2626", border: "1px solid #FCA5A5", borderRadius: 3, padding: "1px 5px" }}>BLOCKED</span>}
            <span style={{ fontSize: 11, color: C.gray400 }}>{[c.customer_city, c.customer_state].filter(Boolean).join(", ")} · {c.customer_pincode}</span>
          </Box>
          <Typography sx={{ fontSize: 11, color: C.gray400, mt: "2px" }}>{c.customer_address || ""}</Typography>
        </TableCell>
        {/* batch orders */}
        <TableCell sx={{ py: "8px", px: "12px" }}>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
            {c.batch_orders?.map((bo, i) => (
              <Tooltip key={i} title={bo.order_id} placement="top">
                <span style={{ fontFamily: "monospace", fontSize: 10, background: C.orangeLight, color: C.orange,
                  border: `1px solid ${C.orangeBorder}`, borderRadius: 4, padding: "1px 6px" }}>{bo.sku || "?"} ×{bo.qty}</span>
              </Tooltip>
            ))}
          </Box>
        </TableCell>
        {/* prior orders */}
        <TableCell sx={{ py: "8px", px: "12px", textAlign: "center", fontFamily: "monospace", fontWeight: 800, fontSize: 16, color: C.gray700 }}>
          {c.prior_order_count}
        </TableCell>
        <TableCell sx={{ py: "8px", px: "12px", textAlign: "center", fontFamily: "monospace", fontSize: 14, color: "#16A34A", fontWeight: 700 }}>
          {c.delivered}
        </TableCell>
        <TableCell sx={{ py: "8px", px: "12px", textAlign: "center" }}>
          {c.returned > 0
            ? <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 14, background: "#FEE2E2", color: "#DC2626", border: "1px solid #FCA5A5", borderRadius: 4, padding: "1px 10px" }}>{c.returned}</span>
            : <span style={{ color: C.gray300 }}>0</span>}
        </TableCell>
        <TableCell sx={{ py: "8px", px: "12px", textAlign: "center" }}>
          {c.rto > 0
            ? <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13, background: "#FEF3C7", color: "#92400E", border: "1px solid #FDE68A", borderRadius: 4, padding: "1px 8px" }}>{c.rto}</span>
            : <span style={{ color: C.gray300 }}>0</span>}
        </TableCell>
        <TableCell sx={{ py: "8px", px: "12px", minWidth: 120 }}>
          <ReturnBar rate={c.return_rate} />
        </TableCell>
        <TableCell sx={{ py: "8px", px: "12px" }}>
          <span style={{ fontSize: 11, fontWeight: 700, background: rk.bg, color: rk.color, border: `1px solid ${rk.border}`, borderRadius: 4, padding: "2px 8px" }}>
            {c.risk_level === "high" ? "High Risk" : c.risk_level === "medium" ? "Medium" : "Low Risk"}
          </span>
        </TableCell>
        <TableCell sx={{ py: "8px", px: "12px" }} onClick={e => e.stopPropagation()}>
          {c.is_blocked
            ? <span style={{ fontSize: 11, color: "#DC2626", fontWeight: 700 }}>Blocked</span>
            : (
              <Button size="small" variant="outlined" color="error" startIcon={<BlockIcon sx={{ fontSize: 12 }} />}
                onClick={() => onBlock(c)}
                sx={{ fontSize: 11, py: "2px", px: "8px", textTransform: "none", fontWeight: 700 }}>
                Block
              </Button>
            )}
        </TableCell>
      </TableRow>

      {/* Expanded detail */}
      <TableRow>
        <TableCell colSpan={10} sx={{ p: 0, border: 0 }}>
          <Collapse in={open} unmountOnExit>
            <Box sx={{ p: "14px 20px", background: "#FFFBEB", borderTop: "1px dashed #FDE68A", display: "flex", gap: "20px", flexWrap: "wrap" }}>

              {/* SKU breakdown */}
              <Box sx={{ flex: 1, minWidth: 280 }}>
                <Typography sx={{ fontSize: 10, fontWeight: 700, color: C.gray400, textTransform: "uppercase", letterSpacing: "0.08em", mb: "8px" }}>
                  Prior SKU Breakdown
                </Typography>
                <Table size="small" sx={{ borderCollapse: "collapse", border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" }}>
                  <TableHead>
                    <TableRow sx={{ background: C.gray50 }}>
                      {["SKU","Qty","Orders","Delivered","Returned","RTO"].map(h => (
                        <TableCell key={h} sx={{ py: "5px", px: "8px", fontSize: 10, fontWeight: 700, color: C.gray500, textTransform: "uppercase" }}>{h}</TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(c.sku_breakdown || []).map(row => (
                      <TableRow key={row.sku}>
                        <TableCell sx={{ py: "5px", px: "8px" }}>
                          <span style={{ fontFamily: "monospace", fontSize: 11, color: C.orange, fontWeight: 700, background: C.orangeLight, padding: "1px 5px", borderRadius: 3 }}>{row.sku}</span>
                        </TableCell>
                        <TableCell sx={{ py: "5px", px: "8px", fontFamily: "monospace", fontWeight: 700, fontSize: 13 }}>{row.qty}</TableCell>
                        <TableCell sx={{ py: "5px", px: "8px", fontFamily: "monospace", fontSize: 12 }}>{row.orders}</TableCell>
                        <TableCell sx={{ py: "5px", px: "8px" }}>
                          {row.delivered > 0 ? <span style={{ fontSize: 11, color: "#065F46", fontWeight: 700 }}>{row.delivered}</span> : <span style={{ color: C.gray300 }}>—</span>}
                        </TableCell>
                        <TableCell sx={{ py: "5px", px: "8px" }}>
                          {row.returned > 0 ? <span style={{ fontSize: 11, color: "#DC2626", fontWeight: 800 }}>{row.returned}</span> : <span style={{ color: C.gray300 }}>—</span>}
                        </TableCell>
                        <TableCell sx={{ py: "5px", px: "8px" }}>
                          {row.rto > 0 ? <span style={{ fontSize: 11, color: "#92400E", fontWeight: 700 }}>{row.rto}</span> : <span style={{ color: C.gray300 }}>—</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>

              {/* Order history */}
              <Box sx={{ flex: 1, minWidth: 320 }}>
                <Typography sx={{ fontSize: 10, fontWeight: 700, color: C.gray400, textTransform: "uppercase", letterSpacing: "0.08em", mb: "8px" }}>
                  Prior Order History ({c.orders?.length})
                </Typography>
                <Box sx={{ maxHeight: 220, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 1 }}>
                  <Table size="small" sx={{ borderCollapse: "collapse" }}>
                    <TableHead>
                      <TableRow sx={{ background: C.gray50, position: "sticky", top: 0, zIndex: 1 }}>
                        {["Date","SKU","Qty","Status"].map(h => (
                          <TableCell key={h} sx={{ py: "5px", px: "8px", fontSize: 10, fontWeight: 700, color: C.gray500, textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(c.orders || []).map((o, i) => (
                        <TableRow key={`${o.order_id}-${i}`} sx={{ background: o.status === "RETURN" ? "#FFF5F5" : "white" }}>
                          <TableCell sx={{ py: "4px", px: "8px", fontFamily: "monospace", fontSize: 11, color: C.gray500, whiteSpace: "nowrap" }}>
                            {(o.order_date || "").slice(0, 10)}
                          </TableCell>
                          <TableCell sx={{ py: "4px", px: "8px" }}>
                            <span style={{ fontFamily: "monospace", fontSize: 11, color: C.orange, fontWeight: 600 }}>{o.sku || "—"}</span>
                          </TableCell>
                          <TableCell sx={{ py: "4px", px: "8px", fontFamily: "monospace", fontSize: 12, textAlign: "center" }}>{o.qty}</TableCell>
                          <TableCell sx={{ py: "4px", px: "8px" }}><RStatusChip status={o.status} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              </Box>
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
}

function RepeatedCustomersSection({ customers, onBlock }) {
  const [collapsed, setCollapsed] = useState(false);
  if (!customers?.length) return null;
  const highCount = customers.filter(c => c.risk_level === "high").length;
  const medCount  = customers.filter(c => c.risk_level === "medium").length;
  const blockedCount = customers.filter(c => c.is_blocked).length;

  return (
    <Box sx={{ mb: "16px" }}>
      {/* Header bar */}
      <Box
        onClick={() => setCollapsed(c => !c)}
        sx={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer",
          background: highCount > 0 ? "#FFF5F5" : "#FFFBEB",
          border: `1px solid ${highCount > 0 ? "#FCA5A5" : "#FDE68A"}`,
          borderRadius: collapsed ? 2 : "8px 8px 0 0",
          px: "16px", py: "10px", userSelect: "none" }}
      >
        <Typography sx={{ fontWeight: 800, fontSize: 14, color: highCount > 0 ? "#DC2626" : "#D97706" }}>
          👤 {customers.length} Repeat Customer{customers.length > 1 ? "s" : ""} in This Batch
        </Typography>
        <Box sx={{ display: "flex", gap: "6px", flexWrap: "wrap", flex: 1 }}>
          {highCount > 0   && <span style={{ fontSize: 11, fontWeight: 700, background: "#FEE2E2", color: "#DC2626", border: "1px solid #FCA5A5", borderRadius: 4, padding: "1px 7px" }}>{highCount} High Risk</span>}
          {medCount > 0    && <span style={{ fontSize: 11, fontWeight: 700, background: "#FEF3C7", color: "#D97706", border: "1px solid #FDE68A", borderRadius: 4, padding: "1px 7px" }}>{medCount} Medium</span>}
          {blockedCount > 0 && <span style={{ fontSize: 11, fontWeight: 700, background: "#FEE2E2", color: "#DC2626", borderRadius: 4, padding: "1px 7px" }}>{blockedCount} Blocked</span>}
        </Box>
        <Typography sx={{ fontSize: 11, color: C.gray400 }}>Based on RETURN rate · {collapsed ? "Show ▼" : "Hide ▲"}</Typography>
      </Box>

      {/* Table */}
      {!collapsed && (
        <Paper elevation={0} sx={{ border: `1px solid ${highCount > 0 ? "#FCA5A5" : "#FDE68A"}`, borderTop: 0, borderRadius: "0 0 8px 8px", overflow: "hidden" }}>
          <Box sx={{ overflowX: "auto" }}>
            <Table size="small" sx={{ borderCollapse: "collapse", width: "100%" }}>
              <TableHead>
                <TableRow sx={{ background: C.gray50 }}>
                  {[
                    ["",            "center", 32 ],
                    ["Customer",    "left",   200],
                    ["In This Batch","left",  180],
                    ["Prior Orders","center", 80 ],
                    ["Delivered",   "center", 80 ],
                    ["Returned",    "center", 80 ],
                    ["RTO",         "center", 60 ],
                    ["Return Rate", "left",   130],
                    ["Risk",        "center", 100],
                    ["Action",      "center", 90 ],
                  ].map(([h, a, w]) => (
                    <TableCell key={h || "exp"}
                      sx={{ textAlign: a, fontSize: 10, fontWeight: 700, color: C.gray500,
                        textTransform: "uppercase", letterSpacing: "0.06em",
                        py: "8px", px: "12px", minWidth: w, whiteSpace: "nowrap",
                        borderBottom: `1px solid ${C.border}` }}>
                      {h}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {customers.map(c => (
                  <RepeatCustomerRow
                    key={`${c.customer_name}|${c.customer_pincode}`}
                    c={c}
                    onBlock={onBlock}
                  />
                ))}
              </TableBody>
            </Table>
          </Box>
        </Paper>
      )}
    </Box>
  );
}

// ── Main LabelsTab ────────────────────────────────────────────────────────────
export function LabelsTab() {
  const today = todayISO();

  // Sub-tab
  const [subTab, setSubTab] = useState("upload"); // "upload" | "orders"

  // Upload state
  const [batchDate,     setBatchDate]     = useState(today);
  const [uploadResult,  setUploadResult]  = useState(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadError,   setUploadError]   = useState("");
  const [fileName,      setFileName]      = useState("");
  const [showPages,     setShowPages]     = useState(false);
  const [skuSearch,     setSkuSearch]     = useState("");

  // Date filter (shared between tabs)
  const [availDates,  setAvailDates]  = useState([]);
  const [dateMode,    setDateMode]    = useState("all");
  const [selDate,     setSelDate]     = useState("");
  const [customFrom,  setCustomFrom]  = useState("");
  const [customTo,    setCustomTo]    = useState("");
  const [activeRange, setActiveRange] = useState(null);

  // Repeat customers
  const [repData,    setRepData]    = useState(null);
  const [repLoading, setRepLoading] = useState(false);

  // History drawer
  const [historyQuery, setHistoryQuery] = useState(null);

  // Packing tracker (for current upload)
  const [packedTarget,  setPackedTarget]  = useState("");
  const [packingOrders, setPackingOrders] = useState([]);
  const [packingShow,   setPackingShow]   = useState(false);

  // ── Restore from localStorage when batchDate changes ─────────────────────
  useEffect(() => {
    const saved = loadParseResult(batchDate);
    if (saved) {
      setUploadResult(saved.result);
      setFileName(saved.fileName);
      setPackingOrders([]);
      setPackingShow(false);
    } else {
      setUploadResult(null);
      setFileName("");
    }
  }, [batchDate]); // eslint-disable-line

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API}/labels/summary/`)
      .then(r => r.json())
      .then(d => {
        const dates = d.available_dates || [];
        setAvailDates(dates);
        if (dates.length > 0) {
          setSelDate(dates[0]); setDateMode("single");
          setActiveRange({ date_from: dates[0], date_to: dates[0] });
        } else {
          setActiveRange({});
        }
      })
      .catch(() => setActiveRange({}));
  }, []);

  // ── Fetch repeat customers (address-based) ────────────────────────────────
  useEffect(() => {
    if (activeRange === null) return;
    setRepLoading(true); setRepData(null);
    const params = new URLSearchParams();
    if (activeRange.date_from) params.set("date_from", activeRange.date_from);
    if (activeRange.date_to)   params.set("date_to",   activeRange.date_to);
    fetch(`${API}/labels/duplicates/?${params}`)
      .then(r => r.json())
      .then(d => { setRepData(d); setRepLoading(false); })
      .catch(() => setRepLoading(false));
  }, [JSON.stringify(activeRange)]); // eslint-disable-line

  const applyRange = (range) => { setActiveRange(range); };

  // ── Upload handlers ───────────────────────────────────────────────────────
  const handleFile = async (file) => {
    setUploadLoading(true); setUploadError(""); setUploadResult(null);
    setPackingOrders([]); setPackingShow(false);
    setFileName(file.name);
    const form = new FormData();
    form.append("file", file);
    form.append("upload_date", batchDate);
    try {
      const res  = await fetch(`${API}/labels/parse/`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok || data.error) {
        setUploadError(data.error || "Upload failed.");
      } else {
        setUploadResult(data);
        saveParseResult(batchDate, file.name, data);
        setAvailDates(prev => prev.includes(batchDate) ? prev : [batchDate, ...prev].sort().reverse());
        setActiveRange(ar => ar ? { ...ar } : {});
        const ords = (data.page_details || []).filter(pd => pd.order_id)
          .map(pd => ({ order_id: pd.order_id, sku: pd.sku, qty: pd.qty || 1, is_packed: false }));
        setPackingOrders(ords);
        if (ords.length > 0) setPackingShow(true);
      }
    } catch {
      setUploadError("Could not reach the server — is the backend running?");
    }
    setUploadLoading(false);
  };

  const resetUpload = () => {
    setUploadResult(null); setUploadError(""); setFileName("");
    setShowPages(false); setSkuSearch(""); setBatchDate(todayISO());
    setPackedTarget(""); setPackingOrders([]); setPackingShow(false);
  };

  const handleBlockFromLabel = async (customer) => {
    await fetch(`${API}/blocked-customers/`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer_name:    customer.customer_name,
        customer_pincode: customer.customer_pincode,
        customer_city:    customer.customer_city,
        customer_state:   customer.customer_state,
        reason:           `Blocked from label parse — ${customer.returned} returns out of ${customer.prior_order_count} prior orders (${Math.round(customer.return_rate * 100)}% return rate)`,
      }),
    });
    // Mark the customer as blocked in-place so UI reflects immediately
    setUploadResult(prev => ({
      ...prev,
      repeated_customers: (prev.repeated_customers || []).map(c =>
        c.customer_name === customer.customer_name && c.customer_pincode === customer.customer_pincode
          ? { ...c, is_blocked: true }
          : c
      ),
    }));
  };

  const togglePacked = async (order_id) => {
    const current = packingOrders.find(o => o.order_id === order_id)?.is_packed ?? false;
    const res = await fetch(`${API}/labels/orders/${encodeURIComponent(order_id)}/pack/`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packed: !current }),
    });
    if (res.ok) setPackingOrders(prev => prev.map(o => o.order_id === order_id ? { ...o, is_packed: !current } : o));
  };

  const markAllPacked = async () => {
    const ids = packingOrders.map(o => o.order_id);
    const res = await fetch(`${API}/labels/bulk-pack/`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_ids: ids, packed: true }),
    });
    if (res.ok) setPackingOrders(prev => prev.map(o => ({ ...o, is_packed: true })));
  };

  const applyPackedTarget = async () => {
    const n = parseInt(packedTarget, 10);
    if (isNaN(n) || n < 0 || packingOrders.length === 0) return;
    const toPackIds   = packingOrders.slice(0, n).map(o => o.order_id);
    const toUnpackIds = packingOrders.slice(n).map(o => o.order_id);
    await Promise.all([
      toPackIds.length   && fetch(`${API}/labels/bulk-pack/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order_ids: toPackIds,   packed: true  }) }),
      toUnpackIds.length && fetch(`${API}/labels/bulk-pack/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order_ids: toUnpackIds, packed: false }) }),
    ].filter(Boolean));
    setPackingOrders(prev => prev.map((o, i) => ({ ...o, is_packed: i < n })));
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const filteredSku  = (uploadResult?.sku_table || []).filter(r => !skuSearch || r.sku.toLowerCase().includes(skuSearch.toLowerCase()) || (r.parent_sku || "").toLowerCase().includes(skuSearch.toLowerCase()));
  const skuGroups = (() => {
    const map = {};
    filteredSku.forEach(row => {
      const hasParent = row.parent_sku && row.parent_sku !== row.sku;
      const key = hasParent ? row.parent_sku : `__${row.sku}`;
      if (!map[key]) map[key] = { parentSku: hasParent ? row.parent_sku : null, children: [] };
      map[key].children.push(row);
    });
    return Object.values(map).sort((a, b) =>
      b.children.reduce((s, r) => s + r.count, 0) - a.children.reduce((s, r) => s + r.count, 0)
    );
  })();
  const chartData    = (uploadResult?.sku_table || []).slice(0, 15).map(r => ({ sku: r.sku.length > 20 ? r.sku.slice(0, 18) + "…" : r.sku, fullSku: r.sku, count: r.count, totalQty: r.total_qty }));
  const highQtyCount = (uploadResult?.sku_table || []).reduce((s, r) => s + r.high_qty_orders, 0);
  const totalLabels  = uploadResult?.total_labels ?? 0;
  const totalPages   = uploadResult?.total_pages  ?? 0;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {historyQuery && <CustomerHistoryDrawer query={historyQuery} onClose={() => setHistoryQuery(null)} />}

      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <Typography sx={{ fontSize: 18, fontWeight: 800, color: C.gray800, mb: "3px" }}>🏷 Labels</Typography>
          <Typography sx={{ fontSize: 13, color: C.gray400 }}>Upload Meesho label PDFs, track packing, and monitor delivery partners.</Typography>
        </div>
        {/* Sub-tab navigation */}
        <Box sx={{ display: "flex", gap: 0, background: C.gray100, borderRadius: "10px", p: "4px" }}>
          {[["upload", "📤 Upload & Pack"], ["orders", "🚚 Orders by Partner"]].map(([id, label]) => (
            <Button
              key={id}
              onClick={() => setSubTab(id)}
              sx={{
                px: "20px",
                py: "8px",
                borderRadius: "8px",
                border: "none",
                fontSize: 13,
                fontWeight: subTab === id ? 700 : 500,
                background: subTab === id ? C.white : "transparent",
                color: subTab === id ? C.orange : C.gray500,
                boxShadow: subTab === id ? "0 2px 8px rgba(0,0,0,0.1)" : "none",
                transition: "all 0.15s",
                textTransform: "none",
                "&:hover": { background: subTab === id ? C.white : "transparent" },
              }}
            >
              {label}
            </Button>
          ))}
        </Box>
      </Box>

      {/* Duplicate address banner — shown on both tabs */}
      <DuplicateBanner repData={repData} repLoading={repLoading} />

      {/* ════════════════ TAB 1: UPLOAD & PACK ══════════════════════════════ */}
      {subTab === "upload" && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: "16px" }}>

          {/* Upload card */}
          <Paper elevation={1} sx={{ p: 3, borderRadius: 2 }}>
            <Typography variant="subtitle2" sx={{ fontSize: 11, fontWeight: 700, color: C.gray400, letterSpacing: "0.08em", textTransform: "uppercase", mb: "16px" }}>
              📤 Upload New Labels PDF
              {uploadResult && <span style={{ marginLeft: 10, fontWeight: 400, color: C.green, textTransform: "none", letterSpacing: 0 }}>✓ {fileName}</span>}
            </Typography>

            {!uploadResult && !uploadLoading && (
              <>
                <BatchDatePicker value={batchDate} onChange={setBatchDate} />
                <Box sx={{ mt: "14px", p: "12px 16px", background: C.gray50, borderRadius: "10px", border: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
                  <Typography sx={{ fontSize: 13, color: C.gray600, fontWeight: 600 }}>📦 How many did you pack today?</Typography>
                  <TextField
                    type="number"
                    size="small"
                    inputProps={{ min: 0 }}
                    value={packedTarget}
                    onChange={e => setPackedTarget(e.target.value)}
                    placeholder="e.g. 45"
                    sx={{ width: 90, "& input": { fontSize: 13, py: "7px" } }}
                  />
                  <Typography sx={{ fontSize: 12, color: C.gray400 }}>Leave blank if you packed everything</Typography>
                </Box>
                <Box sx={{ mt: "16px" }}><DropZone onFile={handleFile} /></Box>
              </>
            )}

            {uploadLoading && (
              <Box sx={{ textAlign: "center", p: "48px 32px" }}>
                <div style={{ fontSize: 32, marginBottom: 10 }}>⚙️</div>
                <Typography sx={{ fontSize: 14, fontWeight: 700, color: C.gray700 }}>Parsing labels…</Typography>
                <Typography sx={{ fontSize: 12, color: C.gray400, mt: "4px" }}>Extracting from <strong>{fileName}</strong></Typography>
              </Box>
            )}

            {uploadError && (
              <Alert severity="error" sx={{ mt: "12px", borderRadius: 2 }} icon={<span>⚠️</span>}>
                {uploadError}
              </Alert>
            )}

            {uploadResult && (
              <>
                {/* Badges + actions */}
                <Box sx={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", mb: "16px" }}>
                  <Chip
                    label={`✓ ${fileName}`}
                    size="small"
                    sx={{ background: C.greenLight, border: `1px solid ${C.greenBorder}`, color: C.green, fontWeight: 600, fontSize: 12, "& .MuiChip-label": { px: "10px" } }}
                  />
                  {(() => {
                    const diff = daysDiff(uploadResult.upload_date || batchDate);
                    return (
                      <Chip
                        label={`📅 Saved as ${uploadResult.upload_date || batchDate}${diff > 0 ? ` (${diff}d ago)` : " (today)"}`}
                        size="small"
                        sx={{ background: diff === 0 ? C.greenLight : C.amberLight, border: `1px solid ${diff === 0 ? C.greenBorder : "#FDE68A"}`, color: diff === 0 ? C.green : C.amber, fontWeight: 600, fontSize: 12, "& .MuiChip-label": { px: "10px" } }}
                      />
                    );
                  })()}
                  {!uploadResult.cropped_pdf_b64 && (
                    <Chip
                      label="💾 Restored from saved data"
                      size="small"
                      sx={{ background: "#EFF6FF", border: "1px solid #BFDBFE", color: "#2563EB", fontWeight: 600, fontSize: 12, "& .MuiChip-label": { px: "10px" } }}
                    />
                  )}
                  {highQtyCount > 0 && (
                    <Chip
                      label={`⚠ ${highQtyCount} label${highQtyCount > 1 ? "s" : ""} with Qty > 1`}
                      size="small"
                      sx={{ background: C.amberLight, border: "1px solid #FDE68A", color: C.amber, fontWeight: 600, fontSize: 12, "& .MuiChip-label": { px: "10px" } }}
                    />
                  )}
                  <Box sx={{ ml: "auto", display: "flex", gap: "8px" }}>
                    {uploadResult.cropped_pdf_b64 && (
                      <Button
                        variant="outlined"
                        size="small"
                        onClick={() => downloadCroppedPDF(uploadResult.cropped_pdf_b64, fileName)}
                        sx={{ fontSize: 13, borderColor: C.green, color: C.green, background: C.greenLight, fontWeight: 600, textTransform: "none", "&:hover": { background: C.greenLight, borderColor: C.green } }}
                      >
                        ⬇ Download Cropped Labels
                      </Button>
                    )}
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={resetUpload}
                      sx={{ fontSize: 13, borderColor: C.gray300, color: C.gray600, fontWeight: 500, textTransform: "none" }}
                    >
                      ↩ New Upload
                    </Button>
                  </Box>
                </Box>

                {/* Blocked customers warning */}
                {(uploadResult.blocked_customers_found?.length > 0) && (
                  <Alert severity="error" sx={{ mb: "16px", borderRadius: 2 }}>
                    <Typography sx={{ fontSize: 13, fontWeight: 800, color: C.red, mb: "8px" }}>
                      🚨 {uploadResult.blocked_customers_found.length} Blocked Customer{uploadResult.blocked_customers_found.length > 1 ? "s" : ""} Found!
                    </Typography>
                    <Box sx={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                      {uploadResult.blocked_customers_found.map((bc, i) => (
                        <Box key={i} sx={{ fontSize: 12, color: "#B91C1C", display: "flex", gap: "12px", flexWrap: "wrap" }}>
                          <strong>{bc.customer_name}</strong>
                          <span style={{ color: C.gray500 }}>Pincode: {bc.customer_pincode}</span>
                          {bc.sku && <span style={{ fontFamily: "monospace", background: C.redLight, padding: "0 6px", borderRadius: 4 }}>{bc.sku}</span>}
                          <span style={{ color: C.gray400, fontFamily: "monospace", fontSize: 11 }}>{bc.order_id}</span>
                        </Box>
                      ))}
                    </Box>
                  </Alert>
                )}

                {/* Repeated customers */}
                <RepeatedCustomersSection
                  customers={uploadResult.repeated_customers}
                  onBlock={handleBlockFromLabel}
                />

                {/* KPI cards */}
                <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "12px", mb: "16px" }}>
                  <KpiCard label="Total Pages"  value={uploadResult.total_pages}      sub="one label per page"   accent={C.blue}   icon="📄" />
                  <KpiCard label="Unique SKUs"  value={uploadResult.total_unique_skus} sub="distinct products"     accent={C.orange} icon="🏷" />
                  <KpiCard label="Labels Found" value={totalLabels}                    sub={`${((totalLabels / Math.max(totalPages, 1)) * 100).toFixed(0)}% coverage`} accent={totalLabels === totalPages ? C.green : C.amber} icon="✅" />
                  <KpiCard label="Multi-Qty"    value={highQtyCount}                   sub="qty > 1 orders"        accent={highQtyCount > 0 ? C.amber : C.green} icon={highQtyCount > 0 ? "⚠️" : "✓"} highlight={highQtyCount > 0} />
                </Box>

                {/* Packing tracker */}
                {packingShow && packingOrders.length > 0 && (() => {
                  const packedCount   = packingOrders.filter(o => o.is_packed).length;
                  const unpackedCount = packingOrders.length - packedCount;
                  const pct           = Math.round((packedCount / packingOrders.length) * 100);
                  const allDone       = packedCount === packingOrders.length;
                  return (
                    <Box sx={{ background: allDone ? C.greenLight : C.amberLight, border: `2px solid ${allDone ? C.greenBorder : "#FDE68A"}`, borderRadius: "12px", p: "14px 18px", mb: "16px" }}>
                      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px", mb: "12px" }}>
                        <div>
                          <Typography sx={{ fontSize: 14, fontWeight: 800, color: allDone ? C.green : C.amber }}>
                            📦 Packing Tracker — {packedCount} / {packingOrders.length} packed
                          </Typography>
                          {!allDone && <Typography sx={{ fontSize: 12, color: C.gray500, mt: "2px" }}>{unpackedCount} order{unpackedCount !== 1 ? "s" : ""} not yet packed</Typography>}
                        </div>
                        <Box sx={{ display: "flex", gap: "8px", alignItems: "center" }}>
                          <TextField
                            type="number"
                            size="small"
                            inputProps={{ min: 0, max: packingOrders.length }}
                            value={packedTarget}
                            onChange={e => setPackedTarget(e.target.value)}
                            placeholder={`0–${packingOrders.length}`}
                            sx={{ width: 80, "& input": { fontSize: 12, py: "5px" } }}
                          />
                          <Button
                            size="small"
                            onClick={applyPackedTarget}
                            sx={{ fontSize: 12, fontWeight: 600, textTransform: "none", borderColor: C.amber, color: C.amber, background: C.amberLight, border: `1px solid ${C.amber}`, "&:hover": { background: C.amberLight } }}
                          >
                            Apply
                          </Button>
                          {!allDone && (
                            <Button
                              color="success"
                              size="small"
                              onClick={markAllPacked}
                              sx={{ fontSize: 12, fontWeight: 600, textTransform: "none", borderColor: C.green, color: C.green, background: C.greenLight, border: `1px solid ${C.green}`, "&:hover": { background: C.greenLight } }}
                            >
                              ✓ Mark All Packed
                            </Button>
                          )}
                        </Box>
                      </Box>
                      <LinearProgress
                        variant="determinate"
                        value={pct}
                        sx={{
                          height: 8,
                          borderRadius: 4,
                          mb: "14px",
                          background: "#E5E7EB",
                          "& .MuiLinearProgress-bar": { background: allDone ? C.green : C.amber, borderRadius: 4 },
                        }}
                      />
                      {!allDone && (
                        <Box sx={{ maxHeight: 260, overflowY: "auto" }}>
                          <Table size="small" sx={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                            <TableHead>
                              <TableRow sx={{ background: "rgba(0,0,0,0.04)" }}>
                                {["Order ID", "SKU", "Qty", "Packed?"].map(h => (
                                  <TableCell key={h} sx={{ fontSize: 10, fontWeight: 700, color: C.gray500, textTransform: "uppercase", letterSpacing: "0.06em", background: "rgba(0,0,0,0.04)", py: "6px", px: "10px", borderBottom: `1px solid ${C.border}` }}>{h}</TableCell>
                                ))}
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {packingOrders.map((o, i) => (
                                <TableRow
                                  key={o.order_id}
                                  sx={{ background: o.is_packed ? "#F0FDF4" : i % 2 === 0 ? C.white : C.gray50, opacity: o.is_packed ? 0.55 : 1 }}
                                >
                                  <TableCell sx={{ fontFamily: "monospace", fontSize: 10, color: C.gray400, py: "7px", px: "10px" }}>…{o.order_id.slice(-14)}</TableCell>
                                  <TableCell sx={{ fontFamily: "monospace", fontSize: 11, color: C.orange, fontWeight: 600, py: "7px", px: "10px" }}>{o.sku || "—"}</TableCell>
                                  <TableCell sx={{ textAlign: "center", py: "7px", px: "10px" }}>{o.qty}</TableCell>
                                  <TableCell sx={{ py: "7px", px: "10px" }}>
                                    <Button
                                      size="small"
                                      onClick={() => togglePacked(o.order_id)}
                                      sx={{
                                        px: "12px",
                                        py: "2px",
                                        borderRadius: "20px",
                                        fontSize: 11,
                                        fontWeight: 600,
                                        textTransform: "none",
                                        minWidth: 0,
                                        background: o.is_packed ? C.greenLight : C.white,
                                        color: o.is_packed ? C.green : C.gray500,
                                        border: `1px solid ${o.is_packed ? C.greenBorder : C.gray300}`,
                                        "&:hover": { background: o.is_packed ? C.greenLight : C.white, opacity: 0.85 },
                                      }}
                                    >
                                      {o.is_packed ? "✓ Packed" : "Mark Packed"}
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </Box>
                      )}
                      {allDone && (
                        <Typography sx={{ fontSize: 14, fontWeight: 700, color: C.green, textAlign: "center" }}>🎉 All orders packed!</Typography>
                      )}
                    </Box>
                  );
                })()}

                {/* SKU distribution chart */}
                {chartData.length > 0 && (
                  <Box sx={{ background: C.gray50, borderRadius: "10px", p: "16px 16px 0", mb: "16px" }}>
                    <Typography variant="subtitle2" sx={{ fontSize: 11, fontWeight: 700, color: C.gray400, textTransform: "uppercase", letterSpacing: "0.08em", mb: "8px" }}>
                      SKU Distribution — Top {chartData.length}
                    </Typography>
                    <BarChart
                      dataset={chartData}
                      xAxis={[{ scaleType: "band", dataKey: "sku", tickLabelStyle: { fontSize: 9 }, tickLabelPlacement: "tick" }]}
                      series={[{ dataKey: "count", label: "Labels", valueFormatter: v => `${v} labels` }]}
                      height={200}
                      borderRadius={4}
                      margin={{ left: 40, bottom: 70, right: 10, top: 10 }}
                      slotProps={{ legend: { hidden: true } }}
                    />
                  </Box>
                )}

                {/* SKU table */}
                <Box sx={{ overflowX: "auto" }}>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: "10px" }}>
                    <Typography variant="subtitle2" sx={{ fontSize: 11, fontWeight: 700, color: C.gray400, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                      SKU Dispatch — {skuGroups.length} group{skuGroups.length !== 1 ? "s" : ""}, {filteredSku.length} SKU{filteredSku.length !== 1 ? "s" : ""}
                    </Typography>
                    <TextField
                      size="small"
                      value={skuSearch}
                      onChange={e => setSkuSearch(e.target.value)}
                      placeholder="🔍 Search SKU / parent…"
                      sx={{ width: 200, "& input": { fontSize: 12 } }}
                    />
                  </Box>
                  <Table size="small" sx={{ width: "100%", borderCollapse: "collapse" }}>
                    <TableHead>
                      <TableRow>
                        {[["#","left"],["SKU","left"],["Orders","right"],["Units","right"],["Max Qty","center"],["Multi-Qty","center"],["% Share","right"],["Bar","left"]].map(([h, a]) => (
                          <TableCell key={h} sx={{ textAlign: a, fontSize: 11, fontWeight: 700, color: C.gray500, textTransform: "uppercase", letterSpacing: "0.06em", background: C.gray50, whiteSpace: "nowrap", borderBottom: `1px solid ${C.border}`, py: "10px", px: "14px" }}>{h}</TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {skuGroups.map((group, groupIdx) => {
                        const totalCount = group.children.reduce((s, r) => s + r.count, 0);
                        const totalQty   = group.children.reduce((s, r) => s + r.total_qty, 0);
                        const totalPct   = totalLabels > 0 ? (totalCount / totalLabels) * 100 : 0;
                        const totalHQ    = group.children.reduce((s, r) => s + r.high_qty_orders, 0);
                        const maxMaxQty  = Math.max(...group.children.map(r => r.max_qty));

                        if (!group.parentSku) {
                          const row = group.children[0];
                          const pct = totalPct;
                          const isHQ = row.max_qty > 1;
                          return (
                            <TableRow key={row.sku} sx={{ background: isHQ ? "#FFFBEB" : groupIdx % 2 === 0 ? C.white : C.gray50, "&:hover": { background: isHQ ? "#FDE68A55" : "#F0F7FF" } }}>
                              <TableCell sx={{ color: C.gray400, fontSize: 11, width: 36, py: "10px", px: "14px" }}>{groupIdx + 1}</TableCell>
                              <TableCell sx={{ py: "10px", px: "14px" }}>
                                <Box sx={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                  {isHQ && <span title="Multi-qty orders">⚠️</span>}
                                  <span style={{ fontFamily: "monospace", fontSize: 12, color: C.orange, fontWeight: 700, background: C.orangeLight, padding: "3px 9px", borderRadius: 6 }}>{row.sku}</span>
                                </Box>
                              </TableCell>
                              <TableCell sx={{ textAlign: "right", py: "10px", px: "14px" }}>
                                <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 20, color: C.gray800 }}>{row.count}</span>
                              </TableCell>
                              <TableCell sx={{ textAlign: "right", fontFamily: "monospace", fontWeight: 600, color: C.blue, py: "10px", px: "14px" }}>{row.total_qty}</TableCell>
                              <TableCell sx={{ textAlign: "center", py: "10px", px: "14px" }}>
                                <Chip label={`× ${row.max_qty}`} size="small" sx={{ fontSize: 12, fontWeight: 700, background: row.max_qty > 1 ? C.amberLight : C.gray100, color: row.max_qty > 1 ? C.amber : C.gray500, border: `1px solid ${row.max_qty > 1 ? "#FDE68A" : C.gray200}`, "& .MuiChip-label": { px: "8px" } }} />
                              </TableCell>
                              <TableCell sx={{ textAlign: "center", py: "10px", px: "14px" }}>
                                {row.high_qty_orders > 0 ? <Chip label={row.high_qty_orders} size="small" sx={{ background: C.amberLight, color: C.amber, border: "1px solid #FDE68A", fontWeight: 700, fontSize: 12, "& .MuiChip-label": { px: "8px" } }} /> : <span style={{ color: C.gray300 }}>—</span>}
                              </TableCell>
                              <TableCell sx={{ textAlign: "right", fontFamily: "monospace", color: C.gray500, fontSize: 12, py: "10px", px: "14px" }}>{pct.toFixed(1)}%</TableCell>
                              <TableCell sx={{ minWidth: 80, py: "10px", px: "14px" }}>
                                <div style={{ height: 8, background: C.gray100, borderRadius: 4, overflow: "hidden" }}>
                                  <div style={{ width: `${pct}%`, height: "100%", borderRadius: 4, background: isHQ ? "linear-gradient(90deg,#D97706,#F59E0B)" : "linear-gradient(90deg,#E8510A,#F59E0B)" }} />
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        }

                        return (
                          <React.Fragment key={group.parentSku}>
                            <TableRow sx={{ background: "#F5F3FF", borderTop: "2px solid #DDD6FE", "&:hover": { background: "#EDE9FE" } }}>
                              <TableCell sx={{ color: C.gray400, fontSize: 11, width: 36, py: "10px", px: "14px" }}>{groupIdx + 1}</TableCell>
                              <TableCell sx={{ py: "10px", px: "14px" }}>
                                <Box sx={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                  <span style={{ fontFamily: "monospace", fontSize: 12, color: "#7C3AED", fontWeight: 800, background: "#EDE9FE", padding: "3px 9px", borderRadius: 6, border: "1px solid #DDD6FE" }}>{group.parentSku}</span>
                                  <Typography sx={{ fontSize: 10, color: "#A78BFA", fontWeight: 600 }}>{group.children.length} variant{group.children.length !== 1 ? "s" : ""}</Typography>
                                </Box>
                              </TableCell>
                              <TableCell sx={{ textAlign: "right", py: "10px", px: "14px" }}>
                                <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 20, color: "#7C3AED" }}>{totalCount}</span>
                              </TableCell>
                              <TableCell sx={{ textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: "#7C3AED", py: "10px", px: "14px" }}>{totalQty}</TableCell>
                              <TableCell sx={{ textAlign: "center", py: "10px", px: "14px" }}>
                                <Chip label={`× ${maxMaxQty}`} size="small" sx={{ fontSize: 12, fontWeight: 700, background: maxMaxQty > 1 ? C.amberLight : C.gray100, color: maxMaxQty > 1 ? C.amber : C.gray500, border: `1px solid ${maxMaxQty > 1 ? "#FDE68A" : C.gray200}`, "& .MuiChip-label": { px: "8px" } }} />
                              </TableCell>
                              <TableCell sx={{ textAlign: "center", py: "10px", px: "14px" }}>
                                {totalHQ > 0 ? <Chip label={totalHQ} size="small" sx={{ background: C.amberLight, color: C.amber, border: "1px solid #FDE68A", fontWeight: 700, fontSize: 12, "& .MuiChip-label": { px: "8px" } }} /> : <span style={{ color: C.gray300 }}>—</span>}
                              </TableCell>
                              <TableCell sx={{ textAlign: "right", fontFamily: "monospace", color: "#7C3AED", fontWeight: 700, fontSize: 12, py: "10px", px: "14px" }}>{totalPct.toFixed(1)}%</TableCell>
                              <TableCell sx={{ minWidth: 80, py: "10px", px: "14px" }}>
                                <div style={{ height: 8, background: C.gray100, borderRadius: 4, overflow: "hidden" }}>
                                  <div style={{ width: `${totalPct}%`, height: "100%", borderRadius: 4, background: "linear-gradient(90deg,#7C3AED,#A855F7)" }} />
                                </div>
                              </TableCell>
                            </TableRow>
                            {group.children.map((row, ci) => {
                              const pct  = totalLabels > 0 ? (row.count / totalLabels) * 100 : 0;
                              const isHQ = row.max_qty > 1;
                              return (
                                <TableRow key={row.sku} sx={{ background: ci % 2 === 0 ? "#FAFAFF" : C.white, "&:hover": { background: "#EFECFF" } }}>
                                  <TableCell sx={{ py: "7px", px: "14px" }} />
                                  <TableCell sx={{ py: "7px", px: "14px" }}>
                                    <Box sx={{ display: "flex", alignItems: "center", gap: "6px", pl: "16px" }}>
                                      <span style={{ color: "#C4B5FD", fontSize: 14 }}>↳</span>
                                      {isHQ && <span title="Multi-qty orders" style={{ fontSize: 12 }}>⚠️</span>}
                                      <span style={{ fontFamily: "monospace", fontSize: 11, color: C.orange, fontWeight: 700, background: C.orangeLight, padding: "2px 7px", borderRadius: 5 }}>{row.sku}</span>
                                    </Box>
                                  </TableCell>
                                  <TableCell sx={{ textAlign: "right", py: "7px", px: "14px" }}>
                                    <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 16, color: C.gray700 }}>{row.count}</span>
                                  </TableCell>
                                  <TableCell sx={{ textAlign: "right", fontFamily: "monospace", fontWeight: 600, color: C.blue, py: "7px", px: "14px" }}>{row.total_qty}</TableCell>
                                  <TableCell sx={{ textAlign: "center", py: "7px", px: "14px" }}>
                                    <Chip label={`× ${row.max_qty}`} size="small" sx={{ fontSize: 11, fontWeight: 700, background: row.max_qty > 1 ? C.amberLight : C.gray100, color: row.max_qty > 1 ? C.amber : C.gray500, border: `1px solid ${row.max_qty > 1 ? "#FDE68A" : C.gray200}`, "& .MuiChip-label": { px: "6px" } }} />
                                  </TableCell>
                                  <TableCell sx={{ textAlign: "center", py: "7px", px: "14px" }}>
                                    {row.high_qty_orders > 0 ? <Chip label={row.high_qty_orders} size="small" sx={{ background: C.amberLight, color: C.amber, border: "1px solid #FDE68A", fontWeight: 700, fontSize: 11, "& .MuiChip-label": { px: "6px" } }} /> : <span style={{ color: C.gray300 }}>—</span>}
                                  </TableCell>
                                  <TableCell sx={{ textAlign: "right", fontFamily: "monospace", color: C.gray400, fontSize: 11, py: "7px", px: "14px" }}>{pct.toFixed(1)}%</TableCell>
                                  <TableCell sx={{ minWidth: 80, py: "7px", px: "14px" }}>
                                    <div style={{ height: 6, background: C.gray100, borderRadius: 4, overflow: "hidden" }}>
                                      <div style={{ width: `${pct}%`, height: "100%", borderRadius: 4, background: isHQ ? "linear-gradient(90deg,#D97706,#F59E0B)" : "linear-gradient(90deg,#E8510A,#F59E0B)" }} />
                                    </div>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </React.Fragment>
                        );
                      })}
                      {filteredSku.length > 0 && (
                        <TableRow sx={{ background: C.gray50, borderTop: `2px solid ${C.border}` }}>
                          <TableCell colSpan={2} sx={{ fontWeight: 700, color: C.gray700, py: "10px", px: "14px" }}>Total</TableCell>
                          <TableCell sx={{ textAlign: "right", fontFamily: "monospace", fontWeight: 800, fontSize: 18, color: C.orange, py: "10px", px: "14px" }}>{filteredSku.reduce((s, r) => s + r.count, 0)}</TableCell>
                          <TableCell sx={{ textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: C.blue, py: "10px", px: "14px" }}>{filteredSku.reduce((s, r) => s + r.total_qty, 0)}</TableCell>
                          <TableCell colSpan={4} sx={{ py: "10px", px: "14px" }} />
                        </TableRow>
                      )}
                      {filteredSku.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={8} sx={{ textAlign: "center", py: "40px", color: C.gray400 }}>
                            {skuSearch ? `No SKU matching "${skuSearch}"` : "No SKUs extracted"}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </Box>

                {/* Per-page detail */}
                <Box sx={{ mt: "14px", borderTop: `1px solid ${C.border}`, pt: "14px" }}>
                  <Box sx={{ display: "flex", justifyContent: "space-between", cursor: "pointer" }} onClick={() => setShowPages(o => !o)}>
                    <Typography sx={{ fontSize: 12, fontWeight: 700, color: C.gray500 }}>Per-page detail — {uploadResult.page_details.length} pages</Typography>
                    <Typography sx={{ fontSize: 12, color: C.gray400 }}>{showPages ? "▲ Hide" : "▼ Show"}</Typography>
                  </Box>
                  {showPages && (
                    <Box sx={{ border: `1px solid ${C.border}`, borderRadius: "8px", overflow: "hidden", mt: "10px" }}>
                      {uploadResult.page_details.map(d => (
                        <Box key={d.page} sx={{ display: "flex", alignItems: "center", gap: "12px", p: "8px 14px", borderBottom: `1px solid ${C.gray100}` }}>
                          <Typography sx={{ fontSize: 11, color: C.gray400, fontFamily: "monospace", minWidth: 48 }}>pg {d.page}</Typography>
                          {d.sku
                            ? <Chip label={d.sku} size="small" sx={{ background: C.orangeLight, color: C.orange, border: `1px solid ${C.orangeBorder}`, fontWeight: 600, fontSize: 11, fontFamily: "monospace", "& .MuiChip-label": { px: "8px" } }} />
                            : <Typography sx={{ fontSize: 12, color: C.gray400 }}>No SKU</Typography>}
                          {d.parent_sku && d.parent_sku !== d.sku && (
                            <Chip label={`↳ ${d.parent_sku}`} size="small" sx={{ background: "#F5F3FF", color: "#7C3AED", border: "1px solid #DDD6FE", fontWeight: 600, fontSize: 11, fontFamily: "monospace", "& .MuiChip-label": { px: "8px" } }} />
                          )}
                          {d.qty > 1 && (
                            <Chip label={`Qty: ${d.qty}`} size="small" sx={{ background: C.amberLight, color: C.amber, border: "1px solid #FDE68A", fontWeight: 700, fontSize: 11, "& .MuiChip-label": { px: "8px" } }} />
                          )}
                        </Box>
                      ))}
                    </Box>
                  )}
                </Box>
              </>
            )}
          </Paper>

          {/* Date filter (for banner context) */}
          <Paper elevation={1} sx={{ p: "12px 16px", borderRadius: 2, display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <Typography sx={{ fontSize: 12, fontWeight: 700, color: C.gray500, textTransform: "uppercase", letterSpacing: "0.06em" }}>📅 Date Filter</Typography>
            <Chip
              label="All Time"
              size="small"
              onClick={() => { setDateMode("all"); applyRange({}); }}
              color={dateMode === "all" ? "primary" : "default"}
              variant={dateMode === "all" ? "filled" : "outlined"}
              sx={{
                fontSize: 12,
                fontWeight: dateMode === "all" ? 700 : 500,
                background: dateMode === "all" ? C.orangeLight : C.white,
                color: dateMode === "all" ? C.orange : C.gray600,
                borderColor: dateMode === "all" ? C.orange : C.gray300,
                cursor: "pointer",
              }}
            />
            {availDates.slice(0, 7).map(d => (
              <Chip
                key={d}
                label={d}
                size="small"
                onClick={() => { setSelDate(d); setDateMode("single"); applyRange({ date_from: d, date_to: d }); }}
                color={dateMode === "single" && selDate === d ? "primary" : "default"}
                variant={dateMode === "single" && selDate === d ? "filled" : "outlined"}
                sx={{
                  fontSize: 11,
                  fontWeight: dateMode === "single" && selDate === d ? 700 : 500,
                  background: dateMode === "single" && selDate === d ? C.orangeLight : C.white,
                  color: dateMode === "single" && selDate === d ? C.orange : C.gray600,
                  borderColor: dateMode === "single" && selDate === d ? C.orange : C.gray300,
                  cursor: "pointer",
                }}
              />
            ))}
            <Box component="span" sx={{ color: C.gray300, fontSize: 18 }}>|</Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <TextField
                type="date"
                size="small"
                value={customFrom}
                onChange={e => setCustomFrom(e.target.value)}
                sx={{ width: 140, "& input": { fontSize: 12, py: "7px" } }}
              />
              <Typography sx={{ color: C.gray400, fontSize: 13 }}>→</Typography>
              <TextField
                type="date"
                size="small"
                value={customTo}
                onChange={e => setCustomTo(e.target.value)}
                sx={{ width: 140, "& input": { fontSize: 12, py: "7px" } }}
              />
              <Button
                size="small"
                disabled={!customFrom || !customTo}
                onClick={() => { if (!customFrom || !customTo) return; setDateMode("custom"); applyRange({ date_from: customFrom, date_to: customTo }); }}
                sx={{
                  px: "14px",
                  py: "6px",
                  fontSize: 12,
                  fontWeight: 600,
                  textTransform: "none",
                  background: dateMode === "custom" ? C.orange : C.gray100,
                  color: dateMode === "custom" ? C.white : C.gray600,
                  border: "none",
                  "&:hover": { background: dateMode === "custom" ? C.orange : C.gray100 },
                  "&.Mui-disabled": { opacity: 0.5 },
                }}
              >
                Apply
              </Button>
            </Box>
          </Paper>
        </Box>
      )}

      {/* ════════════════ TAB 2: ORDERS BY PARTNER ══════════════════════════ */}
      {subTab === "orders" && (
        <OrdersByPartnerTab
          availDates={availDates}
          activeRange={activeRange}
          onRangeChange={applyRange}
          onViewHistory={setHistoryQuery}
        />
      )}
    </Box>
  );
}
