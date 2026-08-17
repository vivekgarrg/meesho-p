import React, { useEffect, useState } from "react";
import { API, C } from "../../App";
import {
  Alert, Box, Button, Chip, MenuItem, Paper, Table, TableBody, TableCell,
  TableHead, TableRow, TextField, Typography, CircularProgress,
} from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";

/*
 * BREACHED ORDERS
 *
 * "Breached" = still Ready to Ship, more than the configured number of days
 * (see backend BREACH_DAYS) after order_date, with no resolution
 * (Delivered/RTO/Cancelled/etc.) yet. There's no real pickup-confirmation
 * event anywhere in this app's data, so this is deliberately an inference
 * off what Meesho's own Orders export already reports — see
 * backend/meesho_app/views.py's breached_orders_list docstring.
 *
 * The export button downloads a .xlsx in the exact shape of Meesho's own
 * "orders not picked up" bulk-action template (one "Sub Order Num" column),
 * so it can be uploaded straight back to Meesho with no editing.
 */

export function BreachedOrdersTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [courier, setCourier] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    const p = new URLSearchParams(courier ? { courier } : {});
    fetch(`${API}/orders/breached/?${p}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => setError("Could not reach the server — is the backend running?"))
      .finally(() => setLoading(false));
  };

  useEffect(load, [courier]); // eslint-disable-line

  const download = async () => {
    setDownloading(true); setError("");
    try {
      const p = new URLSearchParams(courier ? { courier } : {});
      const res = await fetch(`${API}/orders/breached/export/?${p}`);
      if (!res.ok) { setError("Could not generate that file."); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "My-orders-are-not-picked-up-yet.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("Network error while downloading.");
    } finally {
      setDownloading(false);
    }
  };

  const rows = data?.results || [];
  const couriers = Object.keys(data?.by_courier || {}).sort((a, b) => (data.by_courier[b] - data.by_courier[a]));

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: "9px" }}>
          <WarningAmberIcon sx={{ color: C.amber, fontSize: 21 }} />
          <Typography sx={{ fontSize: 19, fontWeight: 800, color: C.gray800 }}>Breached Orders</Typography>
        </Box>
        <Typography sx={{ fontSize: 12, color: C.gray400, mt: "3px" }}>
          Still "Ready to Ship" {data?.breach_days ?? 2}+ days after the order date — download the sheet and
          upload it straight to Meesho to raise a non-pickup escalation.
        </Typography>
      </Box>

      {error && <Alert severity="error" sx={{ borderRadius: "10px" }} onClose={() => setError("")}>{error}</Alert>}

      <Paper elevation={0} sx={{ border: `1px solid ${C.border}`, borderRadius: "12px", p: "16px 18px" }}>
        <Box sx={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
          <TextField select size="small" label="Courier" value={courier}
            onChange={(e) => setCourier(e.target.value)}
            sx={{ minWidth: 180, "& .MuiInputBase-input": { fontSize: 13 } }}>
            <MenuItem value="">All couriers ({rows.length || data?.total || 0})</MenuItem>
            {couriers.map((c) => (
              <MenuItem key={c} value={c}>{c} ({data.by_courier[c]})</MenuItem>
            ))}
          </TextField>
          <Button onClick={download} disabled={downloading || !rows.length}
            sx={{ textTransform: "none", fontWeight: 800, fontSize: 14, px: "22px", py: "9px",
                  color: "#fff", bgcolor: C.orange, borderRadius: "10px",
                  boxShadow: "0 3px 12px rgba(109,40,217,0.28)",
                  "&:hover": { bgcolor: C.orange, filter: "brightness(0.94)" },
                  "&.Mui-disabled": { bgcolor: C.gray300, color: "#fff" } }}>
            <DownloadIcon sx={{ fontSize: 18, mr: "6px" }} />
            {downloading ? "Preparing…" : `Download ${courier ? `${courier} ` : ""}sheet`}
          </Button>
          <Typography sx={{ fontSize: 11, color: C.gray400 }}>
            Matches Meesho's own "orders not picked up" template — one Sub Order Num column, ready to re-upload.
          </Typography>
        </Box>

        {!!couriers.length && (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: "6px", mt: "12px" }}>
            {couriers.map((c) => (
              <Chip key={c} label={`${c}: ${data.by_courier[c]}`} size="small"
                onClick={() => setCourier(c === courier ? "" : c)}
                sx={{
                  fontSize: 12, fontWeight: 600,
                  bgcolor: c === courier ? C.orange : C.gray100,
                  color: c === courier ? "#fff" : C.gray700,
                  cursor: "pointer",
                }} />
            ))}
          </Box>
        )}
      </Paper>

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", p: "40px" }}><CircularProgress sx={{ color: C.orange }} /></Box>
      ) : (
        <Paper elevation={0} sx={{ border: `1px solid ${C.border}`, borderRadius: "12px", overflow: "hidden" }}>
          <Box sx={{ p: "12px 16px", borderBottom: `1px solid ${C.gray100}`, fontWeight: 700, fontSize: 13, color: C.gray800 }}>
            Breached orders ({rows.length})
          </Box>
          <Box sx={{ overflowX: "auto", maxHeight: 480 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>Sub Order No</TableCell>
                  <TableCell>Order Date</TableCell>
                  <TableCell align="right">Days Breached</TableCell>
                  <TableCell>SKU</TableCell>
                  <TableCell>Product</TableCell>
                  <TableCell>Courier</TableCell>
                  <TableCell>State</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow><TableCell colSpan={7} align="center" sx={{ color: C.gray400, py: 4 }}>
                    Nothing breached right now.
                  </TableCell></TableRow>
                ) : rows.map((r) => (
                  <TableRow key={r.sub_order_no}>
                    <TableCell sx={{ fontFamily: "monospace" }}>{r.sub_order_no}</TableCell>
                    <TableCell>{r.order_date}</TableCell>
                    <TableCell align="right">
                      <Chip label={r.days_breached} size="small"
                        sx={{ fontSize: 11, fontWeight: 700, bgcolor: "#FEF2F2", color: C.red }} />
                    </TableCell>
                    <TableCell sx={{ fontFamily: "monospace" }}>{r.sku || "—"}</TableCell>
                    <TableCell sx={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.product_name || "—"}
                    </TableCell>
                    <TableCell>{r.courier_name || <span style={{ color: C.gray400 }}>Unknown</span>}</TableCell>
                    <TableCell>{r.customer_state || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </Paper>
      )}
    </Box>
  );
}
