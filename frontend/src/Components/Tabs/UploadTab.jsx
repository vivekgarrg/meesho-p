import React, { useState } from "react";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import Grid from "@mui/material/Grid";
import Table from "@mui/material/Table";
import TableHead from "@mui/material/TableHead";
import TableBody from "@mui/material/TableBody";
import TableRow from "@mui/material/TableRow";
import TableCell from "@mui/material/TableCell";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import { API, C } from "../../App";

function UploadSection({ title, subtitle, icon, accept, endpoint, isOrders }) {
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
      if (res.ok) setMsg({ type: "ok", data: isOrders ? d : d.results });
      else        setMsg({ type: "err", text: d.error || "Upload failed" });
    } catch {
      setMsg({ type: "err", text: "Network error — is Django running on port 8000?" });
    }
    setLoading(false);
  };

  return (
    <Box
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
      sx={{
        border: `2px dashed ${dragging ? C.orange : "#CBD5E1"}`,
        borderRadius: 3, p: "36px 24px", textAlign: "center",
        bgcolor: dragging ? C.orangeLight : "grey.50",
        transition: "all 0.2s", cursor: "pointer",
      }}
    >
      <Typography variant="h2" sx={{ fontSize: 44, mb: 1.5 }}>{icon}</Typography>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>{title}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>{subtitle}</Typography>

      <Button variant="contained" component="label" disabled={loading} size="large" disableElevation>
        {loading ? "Uploading…" : "Choose File"}
        <input type="file" accept={accept} hidden onChange={e => handleFile(e.target.files[0])} disabled={loading} />
      </Button>

      {msg?.type === "ok" && (
        <Alert severity="success" sx={{ mt: 2.5, textAlign: "left" }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Upload successful — data saved to DB</Typography>
          {Object.entries(msg.data).map(([k, v]) => (
            <Box key={k} sx={{ display: "flex", justifyContent: "space-between", py: 0.5, borderBottom: "1px solid rgba(0,0,0,0.08)", fontSize: 13 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{k}{isOrders ? `: ${v}` : ""}</Typography>
              {!isOrders && (
                <Typography variant="body2" sx={{ fontFamily: "monospace", color: "success.main" }}>
                  {Object.entries(v).map(([kk, vv]) => `${kk}: ${vv}`).join(", ")}
                </Typography>
              )}
            </Box>
          ))}
        </Alert>
      )}
      {msg?.type === "err" && (
        <Alert severity="error" sx={{ mt: 2 }}>{msg.text}</Alert>
      )}
    </Box>
  );
}

export function UploadTab() {
  const TABLE_ROWS = [
    ["Order Payments",        "order_payments",        "sub_order_no",          "Update existing rows (safe to re-upload)"],
    ["Ads Cost",              "ads_cost",              "id (auto-increment)",   "Always inserts new rows"],
    ["Referral Payments",     "referral_payments",     "reward_id",             "Update existing rows"],
    ["Compensation & Recovery","compensation_recovery","id (auto-increment)",  "Always inserts new rows"],
  ];

  return (
    <Box sx={{ maxWidth: 900, mx: "auto", display: "flex", flexDirection: "column", gap: 3.5 }}>

      <Box>
        <Typography variant="h5" sx={{ fontWeight: 800, mb: 0.5 }}>Upload Data</Typography>
        <Typography variant="body2" color="text.secondary">
          Upload Meesho payment Excel report and Orders CSV to update the database.
        </Typography>
      </Box>

      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Card elevation={1}>
            <CardContent>
              <Typography variant="subtitle2" sx={{ mb: 2 }}>Payment Report (Excel)</Typography>
              <UploadSection
                title="Drop Meesho Excel report here"
                subtitle="SP_ORDER_ADS_REFERRAL_PAYMENT_FILE_*.xlsx"
                icon="📊"
                accept=".xlsx,.xls"
                endpoint="/upload/"
                isOrders={false}
              />
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card elevation={1}>
            <CardContent>
              <Typography variant="subtitle2" sx={{ mb: 2 }}>Orders CSV</Typography>
              <UploadSection
                title="Drop Orders CSV here"
                subtitle="Orders*.csv"
                icon="📦"
                accept=".csv"
                endpoint="/upload-orders/"
                isOrders={true}
              />
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Card elevation={1}>
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 2 }}>Excel Sheet → MySQL Table Mapping</Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Excel Sheet</TableCell>
                <TableCell>MySQL Table</TableCell>
                <TableCell>Primary Key</TableCell>
                <TableCell>Behaviour on Re-upload</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {TABLE_ROWS.map(([sheet, table, pk, behaviour], i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Chip label={sheet} size="small"
                      sx={{ fontWeight: 600, bgcolor: C.orangeLight, color: C.orange, border: `1px solid ${C.orangeBorder}` }} />
                  </TableCell>
                  <TableCell sx={{ fontFamily: "monospace", fontSize: 12 }}>{table}</TableCell>
                  <TableCell sx={{ fontFamily: "monospace", fontSize: 12, color: "#2563EB" }}>{pk}</TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">{behaviour}</Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </Box>
  );
}
