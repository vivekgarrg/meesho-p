import React, { useState, useEffect, useCallback } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Alert from "@mui/material/Alert";
import Table from "@mui/material/Table";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableCell from "@mui/material/TableCell";
import TableBody from "@mui/material/TableBody";
import Tooltip from "@mui/material/Tooltip";
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";
import BlockIcon from "@mui/icons-material/Block";
import { AppBarChart } from "../Charts/AppBarChart";
import { AppLineChart } from "../Charts/AppLineChart";
import { AppPieChart } from "../Charts/AppPieChart";
import { API, C, fmt } from "../../App";
import { useDateFilter } from "../../contexts/DateFilterContext";

// ─────────────────────────────────────────────────────────────────────────────
// Design tokens — mirrors OverviewTab.jsx so this reads as the same app.
// ─────────────────────────────────────────────────────────────────────────────
const T = {
  card: { background: "#fff", border: "1px solid #E2E8F0", borderRadius: 16, padding: "20px 22px", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" },
  label: { fontSize: 11, fontWeight: 700, color: "#94A3B8", letterSpacing: "0.07em", textTransform: "uppercase" },
};

function fmtShort(ym) {
  if (!ym) return "";
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-IN", { month: "short", year: "2-digit" });
}

const SEGMENT_STYLE = {
  VIP:                 { bg: "#ECFDF5", color: "#059669", border: "#A7F3D0" },
  "At Risk":           { bg: "#FEF2F2", color: "#DC2626", border: "#FECACA" },
  "Frequent Returner":  { bg: "#FFF7ED", color: "#C2410C", border: "#FED7AA" },
  Growing:             { bg: "#EFF6FF", color: "#2563EB", border: "#BFDBFE" },
  Steady:              { bg: "#F8FAFC", color: "#64748B", border: "#E2E8F0" },
};
const SEGMENT_ORDER = ["VIP", "At Risk", "Frequent Returner", "Growing", "Steady"];

function SegmentChip({ segment, size }) {
  const s = SEGMENT_STYLE[segment] || SEGMENT_STYLE.Steady;
  return (
    <Chip label={segment} size="small" sx={{
      fontWeight: 700, fontSize: size === "sm" ? 10 : 11, height: size === "sm" ? 18 : 22,
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
      "& .MuiChip-label": { px: size === "sm" ? "6px" : "8px" },
    }} />
  );
}

function KPICard({ label, value, sub, color, accent }) {
  return (
    <Box sx={{ ...T.card, borderTop: `3px solid ${accent || color || C.blue}`, flex: "1 1 200px", minWidth: 0 }}>
      <Typography sx={T.label}>{label}</Typography>
      <Typography sx={{ fontSize: 24, fontWeight: 800, fontFamily: "monospace", color: color || C.gray800, mt: "6px", lineHeight: 1.1 }}>{value}</Typography>
      {sub && <Typography sx={{ fontSize: 11, color: C.gray400, mt: "5px" }}>{sub}</Typography>}
    </Box>
  );
}

const INSIGHT_STYLE = {
  danger:  { bg: "#FEF2F2", border: "#FECACA", color: "#B91C1C", icon: "⚠️" },
  warning: { bg: "#FFFBEB", border: "#FDE68A", color: "#92400E", icon: "⏱️" },
  success: { bg: "#ECFDF5", border: "#A7F3D0", color: "#065F46", icon: "✅" },
};

function InsightRow({ insight }) {
  const s = INSIGHT_STYLE[insight.type] || INSIGHT_STYLE.warning;
  return (
    <Box sx={{ display: "flex", gap: "10px", alignItems: "flex-start", p: "12px 16px", borderRadius: "10px", background: s.bg, border: `1px solid ${s.border}` }}>
      <Typography sx={{ fontSize: 16, lineHeight: 1.2 }}>{s.icon}</Typography>
      <Typography sx={{ fontSize: 13, color: s.color, fontWeight: 600, lineHeight: 1.5 }}>{insight.text}</Typography>
    </Box>
  );
}

const STATUS_STYLE = {
  DELIVERED: { bg: "#D1FAE5", color: "#065F46", label: "Delivered" },
  RETURN:    { bg: "#FEE2E2", color: "#991B1B", label: "Return" },
  RTO:       { bg: "#FEF3C7", color: "#92400E", label: "RTO" },
  CANCELLED: { bg: "#F3F4F6", color: "#6B7280", label: "Cancelled" },
  PENDING:   { bg: "#EFF6FF", color: "#1E40AF", label: "Pending" },
};

function StatusChip({ status }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.PENDING;
  return <Chip label={s.label} size="small" sx={{ fontSize: 10, fontWeight: 700, height: 18, background: s.bg, color: s.color, "& .MuiChip-label": { px: "6px" } }} />;
}

// ── Detail modal — fetches this one customer's full lifetime history via the
// same endpoint (customer_name + customer_pincode params), independent of
// whatever date range the dashboard list is currently windowed to. ──────────
function CustomerDetailModal({ customer, onClose, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [blocking, setBlocking] = useState(false);

  useEffect(() => {
    setDetail(null);
    const p = new URLSearchParams({ customer_name: customer.customer_name, customer_pincode: customer.customer_pincode });
    fetch(`${API}/customer-insights/?${p}`).then(r => r.json()).then(d => setDetail(d.customer));
  }, [customer.customer_name, customer.customer_pincode]);

  const block = async () => {
    setBlocking(true);
    try {
      const res = await fetch(`${API}/blocked-customers/`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: customer.customer_name, customer_pincode: customer.customer_pincode,
          customer_city: customer.customer_city, customer_state: customer.customer_state,
          reason: `${customer.segment_label} · ${Math.round(customer.return_rate * 100)}% return rate — flagged from Customer Insights`,
        }),
      });
      if (res.ok) {
        setDetail(d => d ? { ...d, is_blocked: true } : d);
        onChanged();
      }
    } finally { setBlocking(false); }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: "12px", borderBottom: `1px solid ${C.border}` }}>
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontWeight: 800, fontSize: 16, color: C.gray800 }}>{customer.customer_name}</Typography>
          <Typography sx={{ fontSize: 12, color: C.gray500 }}>
            {[customer.customer_city, customer.customer_state, customer.customer_pincode].filter(Boolean).join(", ")}
          </Typography>
        </Box>
        <SegmentChip segment={customer.segment_label} />
        <IconButton onClick={onClose} size="small"><CloseIcon fontSize="small" /></IconButton>
      </DialogTitle>
      <DialogContent sx={{ pt: "20px !important" }}>
        {!detail ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}><CircularProgress size={24} sx={{ color: C.orange }} /></Box>
        ) : (
          <>
            <Box sx={{ display: "flex", gap: "12px", flexWrap: "wrap", mb: "16px" }}>
              {[
                { label: "Lifetime orders", value: detail.total_orders },
                { label: "Lifetime value", value: fmt(detail.total_order_value) },
                { label: "Return rate", value: `${Math.round(detail.return_rate * 100)}%` },
                { label: "Avg order value", value: fmt(detail.avg_order_value) },
                { label: "First order", value: detail.first_order_date?.slice(0, 10) || "—" },
                { label: "Last order", value: detail.last_order?.slice(0, 10) || "—" },
              ].map(k => (
                <Box key={k.label} sx={{ background: C.gray50, border: `1px solid ${C.border}`, borderRadius: "10px", px: "14px", py: "8px", minWidth: 110 }}>
                  <Typography sx={{ fontSize: 10, fontWeight: 700, color: C.gray400, textTransform: "uppercase" }}>{k.label}</Typography>
                  <Typography sx={{ fontSize: 15, fontWeight: 800, fontFamily: "monospace", color: C.gray800 }}>{k.value}</Typography>
                </Box>
              ))}
            </Box>

            {detail.is_blocked ? (
              <Alert severity="error" sx={{ mb: "16px", fontSize: 12 }}>Already blocked in Fraud Watch.</Alert>
            ) : (
              <Button size="small" variant="contained" color="error" startIcon={<BlockIcon sx={{ fontSize: 14 }} />}
                disabled={blocking} onClick={block}
                sx={{ mb: "16px", textTransform: "none", fontWeight: 700 }}>
                {blocking ? "Blocking…" : "Block this customer"}
              </Button>
            )}

            <Typography sx={{ ...T.label, mb: "8px" }}>Full order history ({detail.orders.length})</Typography>
            <Box sx={{ maxHeight: 320, overflowY: "auto", borderRadius: "8px", border: `1px solid ${C.border}` }}>
              <Table size="small" sx={{ width: "100%", borderCollapse: "collapse" }}>
                <TableHead>
                  <TableRow sx={{ background: C.gray50, position: "sticky", top: 0 }}>
                    {["Date", "SKU", "Qty", "Value", "Status", "Return reason"].map(h => (
                      <TableCell key={h} sx={{ fontSize: 10, fontWeight: 700, color: C.gray500, textTransform: "uppercase", py: "6px", px: "10px" }}>{h}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {detail.orders.map((o, i) => (
                    <TableRow key={`${o.order_id}-${i}`} sx={{ background: o.status === "RETURN" ? "#FFF5F5" : C.white }}>
                      <TableCell sx={{ py: "5px", px: "10px", fontFamily: "monospace", fontSize: 11, color: C.gray500, whiteSpace: "nowrap" }}>{o.order_date?.slice(0, 10) || "—"}</TableCell>
                      <TableCell sx={{ py: "5px", px: "10px", fontFamily: "monospace", fontSize: 11, color: C.orange, fontWeight: 600 }}>{o.sku || "—"}</TableCell>
                      <TableCell sx={{ py: "5px", px: "10px", fontFamily: "monospace", fontSize: 12, textAlign: "center" }}>{o.qty}</TableCell>
                      <TableCell sx={{ py: "5px", px: "10px", fontFamily: "monospace", fontSize: 12 }}>{fmt(o.value)}</TableCell>
                      <TableCell sx={{ py: "5px", px: "10px" }}><StatusChip status={o.status} /></TableCell>
                      <TableCell sx={{ py: "5px", px: "10px", fontSize: 11, color: C.gray500 }}>{o.return_reason || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export function CustomerInsightsTab() {
  const { range, label } = useDateFilter();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [segmentFilter, setSegmentFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [reloadTick, setReloadTick] = useState(0);

  const fetchData = useCallback(() => {
    const ctrl = new AbortController();
    setLoading(true);
    const params = new URLSearchParams();
    if (range.date_from) params.set("date_from", range.date_from);
    if (range.date_to) params.set("date_to", range.date_to);
    fetch(`${API}/customer-insights/?${params}`, { signal: ctrl.signal })
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { if (e.name !== "AbortError") setLoading(false); });
    return () => ctrl.abort();
  }, [JSON.stringify(range), reloadTick]); // eslint-disable-line

  useEffect(() => fetchData(), [fetchData]);

  const results = data?.results || [];
  const filtered = results.filter(r => {
    if (segmentFilter !== "all" && r.segment_label !== segmentFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return r.customer_name.toLowerCase().includes(q) || r.customer_pincode.includes(q) || (r.customer_city || "").toLowerCase().includes(q);
  });

  const summary = data?.summary || {};
  const segmentCounts = data?.segment_counts || {};
  const monthlyTrend = data?.monthly_trend || [];
  const topReturnSkus = data?.top_return_skus || [];
  const insights = data?.insights || [];
  const topByValue = results.slice(0, 10);

  const segmentPieData = SEGMENT_ORDER
    .filter(seg => segmentCounts[seg] > 0)
    .map(seg => ({ id: seg, label: seg, value: segmentCounts[seg], color: SEGMENT_STYLE[seg].color }));

  const returnRateColor = summary.repeat_return_rate <= summary.overall_return_rate ? C.green : C.red;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {selected && (
        <CustomerDetailModal customer={selected} onClose={() => setSelected(null)} onChanged={() => setReloadTick(t => t + 1)} />
      )}

      {/* Header */}
      <Box>
        <Typography sx={{ fontWeight: 900, fontSize: 26, color: "#0F172A", lineHeight: 1.1 }}>Customer Insights</Typography>
        <Typography sx={{ fontSize: 13, color: "#94A3B8", mt: "4px" }}>
          Repeat customers, grouped by name + pincode · <strong style={{ color: "#475569" }}>{label}</strong> · at least 2 orders
        </Typography>
      </Box>

      {loading && !data ? (
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", py: 10, gap: 2 }}>
          <CircularProgress sx={{ color: "#3B82F6" }} />
          <Typography sx={{ color: "#94A3B8", fontSize: 14 }}>Crunching customer history for {label}…</Typography>
        </Box>
      ) : results.length === 0 ? (
        <Box sx={{ ...T.card, textAlign: "center", py: 10 }}>
          <Typography sx={{ fontSize: 44, mb: "12px" }}>👥</Typography>
          <Typography sx={{ fontWeight: 800, fontSize: 20, mb: "4px", color: "#0F172A" }}>No repeat customers in {label}</Typography>
          <Typography sx={{ color: "#94A3B8" }}>Try All time, or a wider date range — this needs at least 2 orders from the same customer.</Typography>
        </Box>
      ) : (
        <>
          {/* KPI row */}
          <Box sx={{ display: "flex", gap: "14px", flexWrap: "wrap" }}>
            <KPICard label="Repeat customers" value={summary.repeat_customer_count} color={C.blue} />
            <KPICard label="Repeat revenue" value={fmt(summary.total_repeat_revenue)} color={C.green} />
            <KPICard label="Avg orders / customer" value={summary.avg_orders_per_customer} color={C.gray800} accent="#8B5CF6" />
            <KPICard label="Return rate: repeat vs overall" color={returnRateColor} accent={returnRateColor}
              value={`${Math.round((summary.repeat_return_rate || 0) * 100)}% / ${Math.round((summary.overall_return_rate || 0) * 100)}%`}
              sub={summary.repeat_return_rate <= summary.overall_return_rate ? "Repeat customers are more reliable" : "Repeat customers return more than average"} />
          </Box>

          {/* Insights — the "what should be done" section, front and center */}
          {insights.length > 0 && (
            <Box sx={{ ...T.card }}>
              <Typography sx={{ ...T.label, mb: "12px" }}>What the data is saying</Typography>
              <Box sx={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {insights.map((ins, i) => <InsightRow key={i} insight={ins} />)}
              </Box>
            </Box>
          )}

          {/* Charts */}
          <Box sx={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
            <Box sx={{ ...T.card, flex: "1 1 380px" }}>
              <Typography sx={{ fontWeight: 700, fontSize: 15, mb: "4px" }}>Repeat Customers Over Time</Typography>
              <Typography sx={{ fontSize: 12, color: "#94A3B8", mb: "14px" }}>How many distinct repeat customers ordered each month</Typography>
              <AppLineChart dataset={monthlyTrend} indexKey="month"
                series={[{ dataKey: "repeat_customers", label: "Repeat customers", color: C.blue }]}
                indexFormatter={fmtShort} maxTicks={12} height={220} />
            </Box>
            <Box sx={{ ...T.card, flex: "1 1 380px" }}>
              <Typography sx={{ fontWeight: 700, fontSize: 15, mb: "4px" }}>Repeat Revenue Over Time</Typography>
              <Typography sx={{ fontSize: 12, color: "#94A3B8", mb: "14px" }}>Order value from repeat customers, by month</Typography>
              <AppLineChart dataset={monthlyTrend} indexKey="month"
                series={[{ dataKey: "revenue", label: "Revenue", color: C.green }]}
                indexFormatter={fmtShort} valueFormatter={fmt} maxTicks={12} height={220} />
            </Box>
          </Box>

          <Box sx={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
            <Box sx={{ ...T.card, flex: "1 1 280px" }}>
              <Typography sx={{ fontWeight: 700, fontSize: 15, mb: "4px" }}>Segment Mix</Typography>
              <Typography sx={{ fontSize: 12, color: "#94A3B8", mb: "10px" }}>Value × reliability, this period</Typography>
              <AppPieChart data={segmentPieData} height={200} showLegend valueFormatter={(v) => `${v} customers`} />
            </Box>
            <Box sx={{ ...T.card, flex: "2 1 420px" }}>
              <Typography sx={{ fontWeight: 700, fontSize: 15, mb: "4px" }}>Top 10 Repeat Customers by Value</Typography>
              <Typography sx={{ fontSize: 12, color: "#94A3B8", mb: "14px" }}>Click a bar to open that customer's full history</Typography>
              <AppBarChart dataset={topByValue} indexKey="customer_name"
                series={[{ dataKey: "total_order_value", label: "Order value" }]}
                colorful valueFormatter={fmt} height={230}
                onBarClick={(name) => { const c = results.find(r => r.customer_name === name); if (c) setSelected(c); }} />
            </Box>
            <Box sx={{ ...T.card, flex: "1 1 320px" }}>
              <Typography sx={{ fontWeight: 700, fontSize: 15, mb: "4px" }}>Most-Returned SKUs</Typography>
              <Typography sx={{ fontSize: 12, color: "#94A3B8", mb: "14px" }}>What repeat customers send back most</Typography>
              {topReturnSkus.length === 0 ? (
                <Typography sx={{ fontSize: 12.5, color: C.gray400, textAlign: "center", py: 4 }}>No returns from repeat customers in this period.</Typography>
              ) : (
                <AppBarChart dataset={topReturnSkus} indexKey="sku"
                  series={[{ dataKey: "returned", label: "Times returned" }]}
                  colorful height={230} />
              )}
            </Box>
          </Box>

          {/* Filter bar */}
          <Box sx={{ ...T.card, display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center", py: "14px" }}>
            <TextField value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search name, pincode, city…" size="small" sx={{ width: 240 }}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" sx={{ color: "text.disabled" }} /></InputAdornment> }} />
            <Box sx={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              <Chip label={`All (${results.length})`} size="small" onClick={() => setSegmentFilter("all")}
                sx={{ fontWeight: 700, cursor: "pointer", background: segmentFilter === "all" ? C.gray800 : C.gray100, color: segmentFilter === "all" ? "#fff" : C.gray600 }} />
              {SEGMENT_ORDER.filter(seg => segmentCounts[seg] > 0).map(seg => {
                const s = SEGMENT_STYLE[seg];
                const active = segmentFilter === seg;
                return (
                  <Chip key={seg} label={`${seg} (${segmentCounts[seg]})`} size="small" onClick={() => setSegmentFilter(seg)}
                    sx={{ fontWeight: 700, cursor: "pointer", background: active ? s.color : s.bg, color: active ? "#fff" : s.color, border: `1px solid ${s.border}` }} />
                );
              })}
            </Box>
            {loading && <CircularProgress size={16} sx={{ color: C.orange }} />}
          </Box>

          {/* Table */}
          <Box sx={{ ...T.card, p: 0, overflow: "hidden" }}>
            <Box sx={{ px: "20px", py: "14px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: "10px" }}>
              <Typography sx={{ fontWeight: 700, fontSize: 14, color: C.gray800 }}>{filtered.length} customer{filtered.length === 1 ? "" : "s"}</Typography>
              <Typography sx={{ fontSize: 11, color: C.gray400, ml: "auto" }}>Click any row to open full history</Typography>
            </Box>
            <Box sx={{ overflowX: "auto" }}>
              <Table size="small" sx={{ width: "100%", borderCollapse: "collapse" }}>
                <TableHead>
                  <TableRow>
                    {[["Customer", "left", 190], ["Segment", "left", 150], ["Orders", "center", 70],
                      ["Total value", "right", 110], ["Return rate", "left", 130], ["Last order", "left", 100], ["", "center", 70]].map(([h, a, w]) => (
                      <TableCell key={h} sx={{ textAlign: a, fontSize: 11, fontWeight: 700, color: C.gray500, textTransform: "uppercase", letterSpacing: "0.06em", background: C.gray50, borderBottom: `1px solid ${C.border}`, py: "9px", px: "14px", minWidth: w }}>{h}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filtered.map(c => (
                    <TableRow key={`${c.customer_name}|${c.customer_pincode}`} onClick={() => setSelected(c)}
                      sx={{ cursor: "pointer", "&:hover": { background: "#FAFBFF" } }}>
                      <TableCell sx={{ py: "10px", px: "14px" }}>
                        <Box sx={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <Typography sx={{ fontWeight: 700, fontSize: 13, color: C.gray800 }}>{c.customer_name}</Typography>
                          {c.is_blocked && <Chip label="BLOCKED" size="small" sx={{ height: 16, fontSize: 9, fontWeight: 800, background: "#FEE2E2", color: "#DC2626", "& .MuiChip-label": { px: "5px" } }} />}
                        </Box>
                        <Typography sx={{ fontSize: 11, color: C.gray500 }}>{[c.customer_city, c.customer_pincode].filter(Boolean).join(" · ")}</Typography>
                      </TableCell>
                      <TableCell sx={{ py: "10px", px: "14px" }}><SegmentChip segment={c.segment_label} /></TableCell>
                      <TableCell sx={{ py: "10px", px: "14px", textAlign: "center", fontFamily: "monospace", fontWeight: 700 }}>{c.total_orders}</TableCell>
                      <TableCell sx={{ py: "10px", px: "14px", textAlign: "right", fontFamily: "monospace", fontWeight: 800, color: C.gray800 }}>{fmt(c.total_order_value)}</TableCell>
                      <TableCell sx={{ py: "10px", px: "14px" }}>
                        <Typography sx={{ fontFamily: "monospace", fontWeight: 700, fontSize: 12, color: c.return_rate >= 0.3 ? C.red : c.return_rate >= 0.15 ? "#D97706" : C.green }}>
                          {Math.round(c.return_rate * 100)}% <span style={{ color: C.gray400, fontWeight: 400 }}>({c.returned})</span>
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ py: "10px", px: "14px", fontFamily: "monospace", fontSize: 11, color: C.gray500 }}>{c.last_order?.slice(0, 10) || "—"}</TableCell>
                      <TableCell sx={{ py: "10px", px: "14px", textAlign: "center" }}>
                        <Tooltip title="View full history"><span style={{ color: C.gray300 }}>▸</span></Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </Box>
        </>
      )}
    </Box>
  );
}
