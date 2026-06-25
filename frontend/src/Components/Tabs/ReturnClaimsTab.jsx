import React, { useState, useEffect, useMemo } from "react";
import {
  Box, Button, Card, CardContent, Chip, Paper,
  TextField, Typography, InputAdornment,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import { API, C, fmt } from "../../App";
import { FilterBar, fmtMonth, monthToRange } from "../shared/FilterBar";

const PAGE_SIZE = 30;

const STATUS_FILTERS = [
  { id: "",       label: "All" },
  { id: "return", label: "Returns" },
  { id: "rto",    label: "RTO" },
  { id: "claim",  label: "Claims" },
];

const STATUS_COLOR = {
  RETURN:       { bg: "#FEE2E2", fg: "#991B1B" },
  RTO:          { bg: "#FEF3C7", fg: "#92400E" },
  RTO_COMPLETE: { bg: "#FEF3C7", fg: "#92400E" },
  DELIVERED:    { bg: "#D1FAE5", fg: "#065F46" },
  SHIPPED:      { bg: "#DBEAFE", fg: "#1E40AF" },
  CANCELLED:    { bg: "#F3F4F6", fg: "#6B7280" },
};

function StatusBadge({ status }) {
  const s = (status || "").toUpperCase();
  const { bg = "#F3F4F6", fg = "#6B7280" } = STATUS_COLOR[s] || {};
  return (
    <span style={{ background: bg, color: fg, fontWeight: 700, fontSize: 11, padding: "2px 8px", borderRadius: 10, whiteSpace: "nowrap" }}>
      {status || "—"}
    </span>
  );
}

// ── Sub-row (individual payment row) ─────────────────────────────────────────
function SubRow({ row, idx }) {
  const bg = idx % 2 === 0 ? "#FAFAF9" : "#F9FAFB";
  const settlement = Number(row.final_settlement_amount || 0);
  return (
    <tr style={{ background: bg, borderBottom: `1px solid ${C.gray100}` }}>
      <td style={{ width: 40 }} />
      <td style={{ padding: "8px 12px", fontSize: 11, color: C.gray400, whiteSpace: "nowrap" }}>
        {row.payment_date || (row.order_date || "").slice(0, 10)}
      </td>
      <td style={{ padding: "8px 12px" }}>
        <StatusBadge status={row.live_order_status || "ADJ"} />
      </td>
      <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: settlement < 0 ? C.red : settlement > 0 ? C.green : C.gray400 }}>
        {fmt(settlement)}
      </td>
      <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: "monospace", fontSize: 12, color: C.gray500 }}>
        {fmt(row.total_sale_amount)}
      </td>
      <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: "monospace", fontSize: 12, color: C.red }}>
        {fmt(row.meesho_commission_incl_gst)}
      </td>
      <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: "monospace", fontSize: 12, color: C.gray500 }}>
        {fmt(row.tcs)}
      </td>
      <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: "monospace", fontSize: 12, color: C.gray500 }}>
        {fmt(row.tds)}
      </td>
      <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: "monospace", fontSize: 12, color: C.amber }}>
        {Number(row.claims || 0) > 0 ? fmt(row.claims) : "—"}
      </td>
      <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: "monospace", fontSize: 12, color: C.gray400 }}>
        {fmt(row.shipping_charge_incl_gst)}
      </td>
      <td style={{ padding: "8px 12px", fontSize: 11, color: C.gray400, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        title={row.claims_reason || row.compensation_reason || ""}>
        {row.claims_reason || row.compensation_reason || "—"}
      </td>
    </tr>
  );
}

// ── Main summary row (collapsible) ────────────────────────────────────────────
function OrderRow({ item }) {
  const [expanded, setExpanded] = useState(false);
  const net = item.net_settlement;
  const hasClaim = item.total_claims > 0;

  return (
    <>
      <tr
        onClick={() => setExpanded((x) => !x)}
        style={{
          cursor: "pointer",
          background: expanded ? "#F0F7FF" : "#fff",
          borderBottom: expanded ? "none" : `1px solid ${C.gray100}`,
        }}
        onMouseEnter={(e) => { if (!expanded) e.currentTarget.style.background = "#F8FAFF"; }}
        onMouseLeave={(e) => { if (!expanded) e.currentTarget.style.background = "#fff"; }}
      >
        <td style={{ width: 40, textAlign: "center", color: C.gray400 }}>
          {expanded ? <KeyboardArrowDownIcon fontSize="small" /> : <KeyboardArrowRightIcon fontSize="small" />}
        </td>
        <td style={{ padding: "12px 12px", fontSize: 12, color: C.gray500, whiteSpace: "nowrap" }}>
          {item.order_date || "—"}
        </td>
        <td style={{ padding: "12px 8px" }}>
          <span style={{ fontFamily: "monospace", fontSize: 11, color: C.blue, fontWeight: 600, background: C.blueLight, padding: "2px 6px", borderRadius: 4 }}>
            {item.sub_order_no}
          </span>
        </td>
        <td style={{ padding: "12px 8px" }}>
          {item.sku ? (
            <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 600, background: C.orangeLight, color: C.orange, padding: "2px 6px", borderRadius: 4 }}>
              {item.sku}
            </span>
          ) : <span style={{ color: C.gray300 }}>—</span>}
        </td>
        <td style={{ padding: "12px 8px", fontSize: 12, color: C.gray600, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          title={item.product_name || ""}>
          {item.product_name || "—"}
        </td>
        <td style={{ padding: "12px 8px" }}>
          <StatusBadge status={item.latest_status} />
          {hasClaim && (
            <span style={{ marginLeft: 4, background: "#FEF3C7", color: "#92400E", fontWeight: 700, fontSize: 10, padding: "2px 6px", borderRadius: 10 }}>
              CLAIM
            </span>
          )}
        </td>
        <td style={{ padding: "12px 8px", textAlign: "center" }}>
          <span style={{ background: C.gray100, color: C.gray500, fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 10 }}>
            {item.payment_count} rows
          </span>
        </td>
        <td style={{ padding: "12px 12px", textAlign: "right", fontFamily: "monospace", fontWeight: 800, fontSize: 14, color: net < 0 ? C.red : net > 0 ? C.green : C.gray400 }}>
          {fmt(net)}
        </td>
        <td style={{ padding: "12px 12px", textAlign: "right", fontFamily: "monospace", fontSize: 13, color: hasClaim ? C.amber : C.gray300, fontWeight: hasClaim ? 700 : 400 }}>
          {hasClaim ? fmt(item.total_claims) : "—"}
        </td>
        <td style={{ padding: "12px 12px", textAlign: "right", fontFamily: "monospace", fontSize: 12, color: C.red }}>
          {fmt(item.total_commission)}
        </td>
      </tr>

      {/* Sub-rows */}
      {expanded && (
        <>
          <tr style={{ background: "#F0F7FF" }}>
            <td colSpan={10}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#E0EDFF", borderBottom: `1px solid ${C.border}` }}>
                    <th style={{ width: 40 }} />
                    {["Date", "Status", "Settlement", "Sale Amount", "Commission", "TCS", "TDS", "Claims", "Shipping", "Reason"].map((h) => (
                      <th key={h} style={{ padding: "6px 12px", textAlign: h === "Date" || h === "Status" || h === "Reason" ? "left" : "right", fontSize: 10, fontWeight: 700, color: C.gray500, textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(item.rows || []).map((row, i) => <SubRow key={i} row={row} idx={i} />)}
                </tbody>
              </table>
            </td>
          </tr>
          <tr style={{ background: "#E0EDFF", borderBottom: `2px solid ${C.border}` }}>
            <td colSpan={10} style={{ padding: "6px 16px" }}>
              <span style={{ fontSize: 11, color: C.blue, fontWeight: 600 }}>
                Net Settlement: {fmt(item.net_settlement)} &nbsp;|&nbsp;
                Claims: {fmt(item.total_claims)} &nbsp;|&nbsp;
                Commission: {fmt(item.total_commission)} &nbsp;|&nbsp;
                TCS: {fmt(item.total_tcs)} &nbsp;|&nbsp;
                TDS: {fmt(item.total_tds)}
              </span>
            </td>
          </tr>
        </>
      )}
    </>
  );
}

// ── Pagination ────────────────────────────────────────────────────────────────
function Pagination({ page, total, pageSize, onChange }) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;
  return (
    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pt: 1.5, mt: 1.5, borderTop: `1px solid ${C.gray100}` }}>
      <Typography variant="caption" sx={{ color: C.gray400 }}>
        {Math.min((page - 1) * pageSize + 1, total)}–{Math.min(page * pageSize, total)} of {total}
      </Typography>
      <Box sx={{ display: "flex", gap: 0.75 }}>
        <Button size="small" variant="outlined" disabled={page === 1} onClick={() => onChange(page - 1)}>← Prev</Button>
        <Typography variant="caption" sx={{ alignSelf: "center", color: C.gray500, px: 1 }}>
          {page} / {totalPages}
        </Typography>
        <Button size="small" variant="outlined" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>Next →</Button>
      </Box>
    </Box>
  );
}

// ── Main Tab ──────────────────────────────────────────────────────────────────
export function ReturnClaimsTab() {
  const [months,       setMonths]       = useState([]);
  const [mode,         setMode]         = useState("all");
  const [selMonth,     setSelMonth]     = useState("");
  const [custFrom,     setCustFrom]     = useState("");
  const [custTo,       setCustTo]       = useState("");
  const [activeRange,  setActiveRange]  = useState(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [search,       setSearch]       = useState("");
  const [page,         setPage]         = useState(1);
  const [data,         setData]         = useState(null);
  const [loading,      setLoading]      = useState(true);

  useEffect(() => {
    fetch(`${API}/profit/available-months/`)
      .then((r) => r.json())
      .then((ms) => {
        setMonths(ms);
        const target = ms[0] || null;
        if (target) { setMode("month"); setSelMonth(target); setActiveRange(monthToRange(target)); }
        else         setActiveRange({});
      })
      .catch(() => setActiveRange({}));
  }, []);

  useEffect(() => { setPage(1); }, [activeRange, search, statusFilter]);

  const queryKey = useMemo(
    () => activeRange === null ? null : JSON.stringify({ activeRange, page, search, statusFilter }),
    [activeRange, page, search, statusFilter],
  );

  useEffect(() => {
    if (queryKey === null) return;
    setLoading(true);
    const params = { ...activeRange, page, page_size: PAGE_SIZE };
    if (search)       params.search = search;
    if (statusFilter) params.status = statusFilter;
    fetch(`${API}/orders/return-claims/?${new URLSearchParams(params)}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [queryKey]);

  const filterLabel =
    mode === "month"  ? fmtMonth(selMonth) :
    mode === "custom" ? `${custFrom} → ${custTo}` : "All Time";

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
      {/* Header */}
      <Box>
        <Typography variant="h6" sx={{ fontWeight: 800, color: C.gray800, mb: 0.5 }}>
          Returns &amp; Claims
        </Typography>
        <Typography variant="body2" sx={{ color: C.gray400 }}>
          Full payment history for returned, RTO, and claimed orders. Click any row to expand.
        </Typography>
      </Box>

      {/* Shared filter bar */}
      <FilterBar
        months={months}
        mode={mode}           setMode={setMode}
        selectedMonth={selMonth}   setSelectedMonth={setSelMonth}
        customFrom={custFrom}      setCustomFrom={setCustFrom}
        customTo={custTo}          setCustomTo={setCustTo}
        onApply={(range) => setActiveRange(range)}
      />

      {/* Status filter + search */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
        {STATUS_FILTERS.map(({ id, label }) => (
          <Button
            key={id}
            size="small"
            variant={statusFilter === id ? "contained" : "outlined"}
            color={id === "return" ? "error" : id === "rto" ? "warning" : id === "claim" ? "success" : "primary"}
            onClick={() => setStatusFilter(id)}
            sx={{ textTransform: "none", fontWeight: statusFilter === id ? 700 : 400 }}
          >
            {label}
          </Button>
        ))}
        <Box sx={{ flexGrow: 1 }} />
        <TextField
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search order no, SKU, product…"
          size="small"
          sx={{ width: 280 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" sx={{ color: "text.disabled" }} />
              </InputAdornment>
            ),
          }}
        />
      </Box>

      {/* Summary mini-cards */}
      {data && !loading && (
        <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
          <Card variant="outlined" sx={{ flex: "1 1 180px", borderTop: `3px solid ${C.red}` }}>
            <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
              <Typography variant="caption" sx={{ fontWeight: 700, color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.07em", display: "block", mb: 0.5 }}>
                Total Orders
              </Typography>
              <Typography sx={{ fontSize: 32, fontWeight: 800, fontFamily: "monospace", color: C.red, lineHeight: 1 }}>
                {data.total.toLocaleString()}
              </Typography>
              <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>{filterLabel}</Typography>
            </CardContent>
          </Card>

          {data.total_net_settlement !== undefined && (
            <Card variant="outlined" sx={{ flex: "1 1 180px", borderTop: `3px solid ${C.green}` }}>
              <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                <Typography variant="caption" sx={{ fontWeight: 700, color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.07em", display: "block", mb: 0.5 }}>
                  Net Settlement
                </Typography>
                <Typography sx={{ fontSize: 28, fontWeight: 800, fontFamily: "monospace", color: Number(data.total_net_settlement) >= 0 ? C.green : C.red, lineHeight: 1 }}>
                  {fmt(data.total_net_settlement)}
                </Typography>
                <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>{filterLabel}</Typography>
              </CardContent>
            </Card>
          )}

          {data.total_claims !== undefined && (
            <Card variant="outlined" sx={{ flex: "1 1 180px", borderTop: `3px solid ${C.amber}` }}>
              <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                <Typography variant="caption" sx={{ fontWeight: 700, color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.07em", display: "block", mb: 0.5 }}>
                  Total Claims
                </Typography>
                <Typography sx={{ fontSize: 28, fontWeight: 800, fontFamily: "monospace", color: C.amber, lineHeight: 1 }}>
                  {fmt(data.total_claims)}
                </Typography>
                <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>{filterLabel}</Typography>
              </CardContent>
            </Card>
          )}
        </Box>
      )}

      {/* Expandable table */}
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
        <Box sx={{ p: "10px 20px 8px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 1.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, color: C.gray800 }}>
            Return &amp; Claim Orders — {filterLabel}
          </Typography>
          {data && (
            <Chip
              label={`${data.total.toLocaleString()} orders`}
              size="small"
              sx={{ fontWeight: 600, fontSize: 11, bgcolor: C.gray100, color: C.gray500 }}
            />
          )}
          <Typography variant="caption" sx={{ color: C.gray400, ml: "auto" }}>
            Click any row to expand payment details
          </Typography>
        </Box>

        {loading ? (
          <Box sx={{ p: 4, textAlign: "center" }}>
            <Typography sx={{ color: C.gray400 }}>Loading…</Typography>
          </Box>
        ) : !data?.results?.length ? (
          <Box sx={{ p: 4, textAlign: "center" }}>
            <Typography sx={{ color: C.gray400 }}>No return / claim orders for this period.</Typography>
          </Box>
        ) : (
          <Box sx={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: C.gray50, borderBottom: `1px solid ${C.border}` }}>
                  <th style={{ width: 40 }} />
                  {[
                    ["Date", "left"], ["Sub Order No", "left"], ["SKU", "left"],
                    ["Product", "left"], ["Status", "left"], ["Rows", "center"],
                    ["Net Settlement", "right"], ["Claims", "right"], ["Commission", "right"],
                  ].map(([h, align]) => (
                    <th key={h} style={{ padding: "10px 12px", textAlign: align, fontSize: 11, fontWeight: 700, color: C.gray500, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.results.map((item) => (
                  <OrderRow key={item.sub_order_no} item={item} />
                ))}
              </tbody>
            </table>
          </Box>
        )}

        <Box sx={{ px: 2, pb: 2 }}>
          <Pagination page={page} total={data?.total ?? 0} pageSize={PAGE_SIZE} onChange={setPage} />
        </Box>
      </Paper>
    </Box>
  );
}
