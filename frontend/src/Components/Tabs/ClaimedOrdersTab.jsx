import React, { useState, useEffect, useCallback } from "react";
import {
  Box, Chip, CircularProgress, Collapse, Paper, Table, TableBody,
  TableCell, TableHead, TableRow, Typography, Button,
} from "@mui/material";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import { API, C, fmt } from "../../App";
import { FilterBar, fmtMonth, monthToRange } from "../shared/FilterBar";

// ── Status badge ──────────────────────────────────────────────────────────────
const STATUS_COLORS = {
  RETURN:       { bg: "#FEE2E2", fg: "#991B1B" },
  RTO:          { bg: "#FEF3C7", fg: "#92400E" },
  RTO_COMPLETE: { bg: "#FEF3C7", fg: "#92400E" },
  DELIVERED:    { bg: "#D1FAE5", fg: "#065F46" },
  EXCHANGE:     { bg: "#DBEAFE", fg: "#1E40AF" },
  CLAIM:        { bg: "#EDE9FE", fg: "#5B21B6" },
  CANCELLED:    { bg: "#F3F4F6", fg: "#6B7280" },
};

function StatusBadge({ status }) {
  const key = (status || "").toUpperCase();
  const { bg = "#F3F4F6", fg = "#6B7280" } = STATUS_COLORS[key] || {};
  return (
    <span style={{ background: bg, color: fg, fontWeight: 700, fontSize: 11, padding: "2px 8px", borderRadius: 10, whiteSpace: "nowrap" }}>
      {status || "ADJ"}
    </span>
  );
}

// ── Summary card ──────────────────────────────────────────────────────────────
function SummaryCard({ label, value, sub, accent }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, flex: "1 1 150px", borderRadius: 3, borderColor: accent + "44" }}>
      <Typography variant="caption" color="text.secondary" display="block">{label}</Typography>
      <Typography variant="h6" sx={{ fontFamily: "monospace", fontWeight: 800, color: accent, mt: 0.25 }}>{value}</Typography>
      {sub && <Typography variant="caption" color="text.disabled">{sub}</Typography>}
    </Paper>
  );
}

// ── Sub payment row (expanded) ─────────────────────────────────────────────────
function SubRow({ row, idx }) {
  const bg = idx % 2 === 0 ? "#FAFAF9" : "#F9FAFB";
  const settlement = Number(row.final_settlement_amount || 0);
  return (
    <TableRow sx={{ background: bg }}>
      <TableCell sx={{ width: 40 }} />
      <TableCell sx={{ fontSize: 11, color: C.gray400, whiteSpace: "nowrap" }}>
        {row.payment_date || (row.order_date || "").slice(0, 10)}
      </TableCell>
      <TableCell><StatusBadge status={row.live_order_status || "ADJ"} /></TableCell>
      <TableCell align="right" sx={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13, color: settlement < 0 ? C.red : settlement > 0 ? C.green : C.gray400 }}>
        {fmt(settlement)}
      </TableCell>
      <TableCell align="right" sx={{ fontFamily: "monospace", fontSize: 12, color: Number(row.claims || 0) > 0 ? C.amber : C.gray300, fontWeight: Number(row.claims || 0) > 0 ? 700 : 400 }}>
        {Number(row.claims || 0) > 0 ? fmt(row.claims) : "—"}
      </TableCell>
      <TableCell
        sx={{ fontSize: 11, color: C.gray400, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        title={row.claims_reason || row.compensation_reason || ""}
      >
        {row.claims_reason || row.compensation_reason || "—"}
      </TableCell>
    </TableRow>
  );
}

// ── Collapsible order row ─────────────────────────────────────────────────────
function OrderRow({ item }) {
  const [open, setOpen] = useState(false);
  const net = item.net_settlement;

  return (
    <>
      <TableRow
        onClick={() => setOpen((x) => !x)}
        sx={{
          cursor: "pointer",
          background: open ? "#FFFBEB" : "#fff",
          "&:hover": { background: open ? "#FFFBEB" : "#FAFAF5" },
          borderBottom: open ? "none" : undefined,
        }}
      >
        <TableCell sx={{ width: 40, textAlign: "center", color: C.gray400 }}>
          {open ? <KeyboardArrowDownIcon fontSize="small" /> : <KeyboardArrowRightIcon fontSize="small" />}
        </TableCell>
        <TableCell sx={{ fontSize: 12, color: C.gray500, whiteSpace: "nowrap" }}>{item.order_date || "—"}</TableCell>
        <TableCell>
          <span style={{ fontFamily: "monospace", fontSize: 11, color: C.blue, fontWeight: 600, background: C.blueLight, padding: "2px 6px", borderRadius: 4 }}>
            {item.sub_order_no}
          </span>
        </TableCell>
        <TableCell>
          {item.sku
            ? <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 600, background: C.orangeLight, color: C.orange, padding: "2px 6px", borderRadius: 4 }}>{item.sku}</span>
            : <span style={{ color: C.gray300 }}>—</span>}
        </TableCell>
        <TableCell
          sx={{ fontSize: 12, color: C.gray600, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          title={item.product_name || ""}
        >
          {item.product_name || "—"}
        </TableCell>
        <TableCell><StatusBadge status={item.primary_status} /></TableCell>
        <TableCell align="right" sx={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13, color: C.amber }}>
          +{fmt(item.total_claims)}
        </TableCell>
        <TableCell align="right" sx={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13, color: net >= 0 ? C.green : C.red }}>
          {fmt(net)}
        </TableCell>
      </TableRow>

      <TableRow>
        <TableCell colSpan={8} sx={{ p: 0, border: 0 }}>
          <Collapse in={open} unmountOnExit>
            <Box sx={{ background: "#FFFBEB", px: 2, py: 1.5, borderBottom: `1px solid ${C.border}` }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ background: "#FEF3C7" }}>
                    <TableCell sx={{ width: 40 }} />
                    {["Date", "Status", "Settlement", "Claim ₹", "Reason"].map((h) => (
                      <TableCell key={h} sx={{ fontSize: 10, fontWeight: 700, color: C.gray500, textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(item.rows || []).map((r, i) => <SubRow key={i} row={r} idx={i} />)}
                </TableBody>
              </Table>
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
}

// ── SKU-wise table ─────────────────────────────────────────────────────────────
function SKUTable({ rows }) {
  if (!rows.length) return <Typography color="text.secondary" sx={{ p: 3, textAlign: "center" }}>No data</Typography>;
  return (
    <Table size="small">
      <TableHead>
        <TableRow sx={{ background: "#F8FAFC" }}>
          {["SKU", "Product", "Orders", "Return Claims", "RTO Claims", "Other", "Total Claim ₹"].map((h) => (
            <TableCell key={h} sx={{ fontWeight: 700, fontSize: 11 }}>{h}</TableCell>
          ))}
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.sku} sx={{ "&:hover": { background: "#FFF7ED" } }}>
            <TableCell>
              <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, background: C.orangeLight, color: C.orange, padding: "2px 8px", borderRadius: 4 }}>
                {r.sku || "—"}
              </span>
            </TableCell>
            <TableCell sx={{ fontSize: 12, color: C.gray600, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              title={r.product_name || ""}>{r.product_name || "—"}</TableCell>
            <TableCell sx={{ fontFamily: "monospace", fontWeight: 700 }}>{r.order_count}</TableCell>
            <TableCell sx={{ fontFamily: "monospace", color: C.red }}>{r.return_count || "—"}</TableCell>
            <TableCell sx={{ fontFamily: "monospace", color: C.amber }}>{r.rto_count || "—"}</TableCell>
            <TableCell sx={{ fontFamily: "monospace", color: C.gray500 }}>{r.other_count || "—"}</TableCell>
            <TableCell align="right" sx={{ fontFamily: "monospace", fontWeight: 800, color: C.amber, fontSize: 14 }}>
              +{fmt(r.total_claims)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ── Main tab ──────────────────────────────────────────────────────────────────
export function ClaimedOrdersTab() {
  const [months,      setMonths]     = useState([]);
  const [mode,        setMode]       = useState("all");
  const [selMonth,    setSelMonth]   = useState(null);
  const [custFrom,    setCustFrom]   = useState("");
  const [custTo,      setCustTo]     = useState("");
  const [range,       setRange]      = useState(null);
  const [statusFilter, setStatus]    = useState("");   // "" / "return" / "rto"
  const [viewMode,    setViewMode]   = useState("orders"); // "orders" / "sku"
  const [data,        setData]       = useState(null);
  const [loading,     setLoading]    = useState(false);
  const [page,        setPage]       = useState(1);

  // Load available months
  useEffect(() => {
    fetch(`${API}/profit/available-months/`).then((r) => r.json()).then((ms) => {
      setMonths(ms);
      if (ms.length) {
        setMode("month");
        setSelMonth(ms[0]);
        setRange(monthToRange(ms[0]));
      } else {
        setRange({});
      }
    }).catch(() => setRange({}));
  }, []);

  const fetchData = useCallback(() => {
    if (range === null) return;
    setLoading(true);
    const params = new URLSearchParams({ page, page_size: 30, status: statusFilter, view: viewMode });
    if (range.date_from) params.set("date_from", range.date_from);
    if (range.date_to)   params.set("date_to",   range.date_to);
    fetch(`${API}/orders/claimed/?${params}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [range, page, statusFilter, viewMode]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleApply = (r) => { setRange(r); setPage(1); };
  const handleStatus = (s) => { setStatus(s); setPage(1); };
  const handleView   = (v) => { setViewMode(v); setPage(1); };

  const STATUS_TABS = [
    { id: "",       label: "All Claims" },
    { id: "return", label: "↩ Return Claims" },
    { id: "rto",    label: "🔄 RTO Claims" },
  ];
  const VIEW_TABS = [
    { id: "orders", label: "Orders" },
    { id: "sku",    label: "SKU-wise" },
  ];

  const totalOrders = data?.total ?? 0;
  const claimAmt    = data?.total_claim_amount ?? 0;
  const retCnt      = data?.return_count ?? 0;
  const rtoCnt      = data?.rto_count ?? 0;
  const otherCnt    = totalOrders - retCnt - rtoCnt;
  const totalPages  = Math.ceil(totalOrders / 30);

  const filterLabel =
    mode === "month"  ? fmtMonth(selMonth || "") :
    mode === "custom" ? `${custFrom} → ${custTo}` : "All Time";

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>Claimed Orders</Typography>
          <Typography variant="body2" color="text.secondary">Orders where Meesho paid a claim to you</Typography>
        </Box>
        {data && (
          <Chip
            label={`+${fmt(claimAmt)} total claimed`}
            color="warning"
            sx={{ fontFamily: "monospace", fontWeight: 800, fontSize: 14 }}
          />
        )}
      </Box>

      {/* Shared filter bar */}
      <FilterBar
        months={months}
        mode={mode}           setMode={setMode}
        selectedMonth={selMonth || ""}  setSelectedMonth={setSelMonth}
        customFrom={custFrom}  setCustomFrom={setCustFrom}
        customTo={custTo}      setCustomTo={setCustTo}
        onApply={handleApply}
      />

      {/* Summary cards */}
      <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}>
        <SummaryCard label="Total Claimed Orders"  value={totalOrders.toLocaleString()} sub="with claim payment"    accent={C.amber} />
        <SummaryCard label="Total Claim Amount"    value={`+${fmt(claimAmt)}`}          sub="Meesho credit to you"  accent={C.green} />
        <SummaryCard label="Return Claims"         value={retCnt.toLocaleString()}       sub="return + claim"        accent={C.red} />
        <SummaryCard label="RTO Claims"            value={rtoCnt.toLocaleString()}       sub="RTO + claim"           accent={C.amber} />
        <SummaryCard label="Other Claims"          value={otherCnt > 0 ? otherCnt.toLocaleString() : "—"} sub="delivered / pure claim" accent={C.blue} />
      </Box>

      {/* Filter bar */}
      <Box sx={{ display: "flex", gap: 2, alignItems: "center", flexWrap: "wrap" }}>
        {/* Status filter */}
        <Box sx={{ display: "flex", gap: 1 }}>
          {STATUS_TABS.map((t) => (
            <Chip key={t.id} label={t.label} size="small"
              color={statusFilter === t.id ? "warning" : "default"}
              variant={statusFilter === t.id ? "filled" : "outlined"}
              onClick={() => handleStatus(t.id)} />
          ))}
        </Box>
        <Box sx={{ flexGrow: 1 }} />
        {/* View toggle */}
        <Box sx={{ display: "flex", gap: 1 }}>
          {VIEW_TABS.map((t) => (
            <Chip key={t.id} label={t.label} size="small"
              color={viewMode === t.id ? "primary" : "default"}
              variant={viewMode === t.id ? "filled" : "outlined"}
              onClick={() => handleView(t.id)} />
          ))}
        </Box>
      </Box>

      {/* Table */}
      <Paper variant="outlined" sx={{ borderRadius: 3, overflow: "hidden" }}>
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}><CircularProgress /></Box>
        ) : !data || !data.results?.length ? (
          <Box sx={{ py: 8, textAlign: "center" }}>
            <Typography color="text.secondary">No claimed orders found for this period</Typography>
          </Box>
        ) : viewMode === "sku" ? (
          <SKUTable rows={data.results} />
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow sx={{ background: "#FFFBEB" }}>
                <TableCell sx={{ width: 40 }} />
                {["Date", "Sub-Order", "SKU", "Product", "Status", "Claim ₹", "Net Settlement"].map((h) => (
                  <TableCell key={h} sx={{ fontWeight: 700, fontSize: 11 }}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {data.results.map((item) => <OrderRow key={item.sub_order_no} item={item} />)}
            </TableBody>
          </Table>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 1.5, p: 2, borderTop: `1px solid ${C.border}` }}>
            <Button size="small" variant="outlined" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Prev</Button>
            <Typography variant="body2" color="text.secondary">Page {page} / {totalPages}</Typography>
            <Button size="small" variant="outlined" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next →</Button>
          </Box>
        )}
      </Paper>
    </Box>
  );
}
