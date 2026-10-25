import React, { useState } from "react";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import Table from "@mui/material/Table";
import TableHead from "@mui/material/TableHead";
import TableBody from "@mui/material/TableBody";
import TableRow from "@mui/material/TableRow";
import TableCell from "@mui/material/TableCell";
import Chip from "@mui/material/Chip";
import { API, C } from "../../App";

/**
 * One drop zone. The card owns the outer spacing; this component only fills the
 * space it is given, so both cards line up whatever their content does.
 */
function UploadSection({ title, subtitle, icon, accept, endpoint, isOrders, summarize }) {
  const [dragging, setDragging] = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [msg,      setMsg]      = useState(null);

  const handleFile = async (file) => {
    if (!file) return;
    setLoading(true); setMsg(null);
    const fd = new FormData(); fd.append("file", file);
    try {
      const res = await fetch(`${API}${endpoint}`, { method: "POST", body: fd });
      const d   = await res.json();
      if (res.ok) setMsg({ type: "ok", data: summarize ? summarize(d) : isOrders ? d : d.results, scan: d.scan_check });
      else        setMsg({ type: "err", text: d.error || "Upload failed" });
    } catch {
      setMsg({ type: "err", text: "Network error — is Django running on port 8000?" });
    }
    setLoading(false);
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <Box
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
        sx={{
          border: `2px dashed ${dragging ? C.orange : "#CBD5E1"}`,
          borderRadius: 2.5,
          // Tighter on phones, where the old 36px block pushed the button below
          // the fold; responsive values keep the zone tappable without dead space.
          px: { xs: 2, sm: 3 },
          py: { xs: 3, sm: 4 },
          textAlign: "center",
          bgcolor: dragging ? C.orangeLight : "grey.50",
          transition: "border-color 0.2s, background-color 0.2s",
          cursor: "pointer",
          minWidth: 0,
        }}
      >
        <Box sx={{ fontSize: { xs: 32, sm: 38 }, lineHeight: 1, mb: 1.5 }} aria-hidden>
          {icon}
        </Box>

        <Typography
          sx={{
            fontWeight: 700, mb: 0.75, lineHeight: 1.3,
            fontSize: { xs: 15, sm: 16 },
          }}
        >
          {title}
        </Typography>

        {/* Filenames are long and unbreakable — let them wrap rather than
            stretch the card wider than its column. */}
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{
            mb: 2.5, fontFamily: "monospace", fontSize: { xs: 11, sm: 12 },
            overflowWrap: "anywhere",
          }}
        >
          {subtitle}
        </Typography>

        <Button
          variant="contained" component="label" disabled={loading} disableElevation
          sx={{ textTransform: "none", fontWeight: 600, px: 3, width: { xs: "100%", sm: "auto" } }}
        >
          {loading ? "Uploading…" : "Choose File"}
          <input type="file" accept={accept} hidden onChange={e => handleFile(e.target.files[0])} disabled={loading} />
        </Button>
      </Box>

      {msg?.type === "ok" && (
        <Alert severity="success" sx={{ textAlign: "left", "& .MuiAlert-message": { minWidth: 0, width: "100%" } }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Upload successful — data saved to DB</Typography>
          {Object.entries(msg.data).map(([k, v]) => (
            <Box
              key={k}
              sx={{
                display: "flex", flexWrap: "wrap", gap: 0.5,
                justifyContent: "space-between", alignItems: "baseline",
                py: 0.5, borderBottom: "1px solid rgba(0,0,0,0.08)", minWidth: 0,
              }}
            >
              <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>
                {k}{isOrders ? `: ${v}` : ""}
              </Typography>
              {!isOrders && (
                <Typography
                  variant="body2"
                  sx={{ fontFamily: "monospace", color: "success.main", fontSize: 12, overflowWrap: "anywhere" }}
                >
                  {Object.entries(v).map(([kk, vv]) => `${kk}: ${vv}`).join(", ")}
                </Typography>
              )}
            </Box>
          ))}
        </Alert>
      )}
      {msg?.type === "ok" && msg.scan && <ScanCheck s={msg.scan} />}
      {msg?.type === "err" && <Alert severity="error">{msg.text}</Alert>}
    </Box>
  );
}

/**
 * What an orders sheet says about the parcels we scanned: of the ones marked
 * dispatched at the packing desk, how many the marketplace now shows shipped,
 * and which are still waiting.
 */
function ScanCheck({ s }) {
  const [open, setOpen] = useState(false);
  if (!s.scanned_in_file) {
    return <Alert severity="info">None of the orders in this file were scanned at the Order Scan desk.</Alert>;
  }
  const waiting = s.dispatched_not_shipped + s.dispatched_no_status;
  const pct = s.dispatched ? Math.round((s.dispatched_shipped / s.dispatched) * 100) : 0;
  const rows = [
    ["Dispatched at the desk", s.dispatched],
    ["Shipped per this sheet", `${s.dispatched_shipped}${s.dispatched ? ` (${pct}%)` : ""}`],
    ["Still not shipped", s.dispatched_not_shipped],
    ["No status in the sheet", s.dispatched_no_status],
    ["Cancelled", s.dispatched_cancelled],
    ["Packed, not dispatched yet", s.packed_not_dispatched],
    ["Newly marked shipped by this upload", s.newly_shipped],
  ];
  return (
    <Alert severity={waiting || s.dispatched_cancelled ? "warning" : "success"} sx={{ textAlign: "left", "& .MuiAlert-message": { minWidth: 0, width: "100%" } }}>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Order Scan check — {s.dispatched_shipped} of {s.dispatched} dispatched parcels shipped
      </Typography>
      {rows.map(([k, v]) => (
        <Box key={k} sx={{ display: "flex", justifyContent: "space-between", gap: 1, py: 0.4, borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
          <Typography variant="body2">{k}</Typography>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>{v}</Typography>
        </Box>
      ))}
      {s.waiting?.length > 0 && (
        <Box sx={{ mt: 1 }}>
          <Button size="small" onClick={() => setOpen((v) => !v)} sx={{ textTransform: "none", px: 0 }}>
            {open ? "Hide" : "Show"} dispatched but not shipped{waiting > s.waiting.length ? ` (first ${s.waiting.length})` : ""}
          </Button>
          {open && s.waiting.map((w) => (
            <Typography key={w.order} variant="body2" sx={{ fontFamily: "monospace", fontSize: 12, overflowWrap: "anywhere" }}>
              {w.order}{w.awb ? ` · ${w.awb}` : ""}{w.courier ? ` · ${w.courier}` : ""} · {w.status}
            </Typography>
          ))}
        </Box>
      )}
    </Alert>
  );
}

function UploadCard({ eyebrow, children }) {
  return (
    // height 100% + stretch alignment from the grid keeps both cards the same
    // height even when one shows an upload result and the other doesn't.
    <Card elevation={0} sx={{ height: "100%", border: `1px solid ${C.border}`, borderRadius: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 2.5 }, "&:last-child": { pb: { xs: 2, sm: 2.5 } } }}>
        <Typography
          sx={{
            fontSize: 11, fontWeight: 700, letterSpacing: "0.08em",
            textTransform: "uppercase", color: C.gray400, mb: 1.75,
          }}
        >
          {eyebrow}
        </Typography>
        {children}
      </CardContent>
    </Card>
  );
}

// What the Flipkart upload endpoints send back is a full profit summary (the
// payments one) — show just the counts that say what the file did.
const flipkartPaymentsSummary = (d) => ({
  "Order items in file": d.total_rows,
  "New": d.created,
  "Updated": d.updated,
  "Skipped (no SKU)": d.invalid_rows,
  "Ads / fines / other lines saved": (d.other_charges_created || 0) + (d.other_charges_updated || 0),
  "SKUs with no price set": (d.missing_price_skus || []).length,
});
const meeshoOrdersSummary = (d) => ({
  "Rows in file": d.total_rows,
  "New": d.created,
  "Updated": d.updated,
});
const flipkartOrdersSummary = (d) => ({
  "Order items in file": d.total_rows,
  "New": d.created,
  "Updated": d.updated,
  "Skipped": d.invalid_rows,
});

export function UploadTab() {
  const TABLE_ROWS = [
    ["Order Payments",         "order_payments",        "sub_order_no",        "Update existing rows (safe to re-upload)"],
    ["Ads Cost",               "ads_cost",              "id (auto-increment)", "Always inserts new rows"],
    ["Referral Payments",      "referral_payments",     "reward_id",           "Update existing rows"],
    ["Compensation & Recovery", "compensation_recovery", "id (auto-increment)", "Always inserts new rows"],
    ["Flipkart Settlement — Orders", "flipkart_order_payments", "order_item_id + neft_id", "Update existing rows (safe to re-upload)"],
    ["Flipkart Settlement — Ads, Fines, SPF…", "flipkart_other_charges", "sheet + neft_id + reference", "Update existing rows"],
    ["Flipkart Orders report", "flipkart_orders", "order_item_id", "Update existing rows (status refreshes)"],
  ];

  return (
    <Box sx={{ maxWidth: 1040, mx: "auto", display: "flex", flexDirection: "column", gap: { xs: 2.5, sm: 3 }, minWidth: 0 }}>

      <Box>
        <Typography sx={{ fontWeight: 800, fontSize: { xs: 20, sm: 24 }, mb: 0.5, lineHeight: 1.25 }}>
          Upload Data
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Upload the Meesho payment report — the .xlsx, or the .zip straight from the panel — and the Orders CSV.
        </Typography>
      </Box>

      {/* CSS grid rather than MUI <Grid item xs>: that API was removed in MUI v6,
          so the old markup gave the two cards no width at all and they sized to
          their content instead of splitting the row evenly. */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" },
          alignItems: "stretch",
          gap: { xs: 2, sm: 2.5 },
        }}
      >
        <UploadCard eyebrow="Payment Report (Excel or ZIP)">
          <UploadSection
            title="Drop the Meesho payment file here"
            subtitle="SP_ORDER_ADS_REFERRAL_PAYMENT_FILE_*.xlsx — or the .zip Meesho gives you, unopened"
            icon="📊"
            accept=".xlsx,.xls,.zip"
            endpoint="/upload/"
            isOrders={false}
          />
        </UploadCard>

        <UploadCard eyebrow="Orders CSV">
          <UploadSection
            title="Drop Orders CSV here"
            subtitle="Orders*.csv"
            icon="📦"
            accept=".csv"
            endpoint="/upload-orders/"
            isOrders={true}
            summarize={meeshoOrdersSummary}
          />
        </UploadCard>
      </Box>

      <Box>
        <Typography sx={{ fontWeight: 800, fontSize: { xs: 17, sm: 19 }, mb: 0.5, lineHeight: 1.25 }}>
          Flipkart
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Two files, both .xlsx from the Flipkart seller hub: the Settlement Report (what was paid — order items plus ads,
          fines and other charges) and the Orders report (every order and its status). Profit uses the same SKU pricing as Meesho.
        </Typography>
      </Box>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" },
          alignItems: "stretch",
          gap: { xs: 2, sm: 2.5 },
        }}
      >
        <UploadCard eyebrow="Flipkart Payments (Settlement Report)">
          <UploadSection
            title="Drop the Flipkart Settlement Report here"
            subtitle="<uuid>_<timestamp>.xlsx — with the Orders, Ads, Fines… sheets"
            icon="💸"
            accept=".xlsx,.xls"
            endpoint="/flipkart-profit/upload/"
            isOrders={true}
            summarize={flipkartPaymentsSummary}
          />
        </UploadCard>

        <UploadCard eyebrow="Flipkart Orders (Orders report)">
          <UploadSection
            title="Drop the Flipkart Orders report here"
            subtitle="<uuid>_<timestamp>.xlsx — order_item_id, order_item_status, sku…"
            icon="🛍️"
            accept=".xlsx,.xls"
            endpoint="/flipkart-orders/upload/"
            isOrders={true}
            summarize={flipkartOrdersSummary}
          />
        </UploadCard>
      </Box>

      <Card elevation={0} sx={{ border: `1px solid ${C.border}`, borderRadius: 3 }}>
        <CardContent sx={{ p: { xs: 2, sm: 2.5 }, "&:last-child": { pb: { xs: 2, sm: 2.5 } } }}>
          <Typography
            sx={{
              fontSize: 11, fontWeight: 700, letterSpacing: "0.08em",
              textTransform: "uppercase", color: C.gray400, mb: 1.75,
            }}
          >
            Excel Sheet → MySQL Table Mapping
          </Typography>
          {/* Four columns can't fit a phone; scroll the table instead of
              letting it squeeze the cells into unreadable slivers. */}
          <Box sx={{ overflowX: "auto", mx: { xs: -2, sm: 0 }, px: { xs: 2, sm: 0 } }}>
            <Table size="small" sx={{ minWidth: 560 }}>
              <TableHead>
                <TableRow>
                  {["Excel Sheet", "MySQL Table", "Primary Key", "Behaviour on Re-upload"].map(h => (
                    <TableCell key={h} sx={{ fontWeight: 700, fontSize: 12, whiteSpace: "nowrap", color: C.gray600 }}>
                      {h}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {TABLE_ROWS.map(([sheet, table, pk, behaviour]) => (
                  <TableRow key={table}>
                    <TableCell>
                      <Chip label={sheet} size="small"
                        sx={{ fontWeight: 600, bgcolor: C.orangeLight, color: C.orange, border: `1px solid ${C.orangeBorder}` }} />
                    </TableCell>
                    <TableCell sx={{ fontFamily: "monospace", fontSize: 12, whiteSpace: "nowrap" }}>{table}</TableCell>
                    <TableCell sx={{ fontFamily: "monospace", fontSize: 12, color: "#2563EB", whiteSpace: "nowrap" }}>{pk}</TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">{behaviour}</Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
