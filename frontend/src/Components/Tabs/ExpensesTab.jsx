import React, { useState, useEffect, useCallback, useRef } from "react";
import { API, C, S, btn } from "../../App";
import { useDateFilter } from "../../contexts/DateFilterContext";
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  IconButton, MenuItem, Table, TableHead, TableBody, TableRow, TableCell,
  CircularProgress, Tooltip,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import DownloadIcon from "@mui/icons-material/Download";
import UploadFileIcon from "@mui/icons-material/UploadFile";

const todayStr = () => new Date().toISOString().slice(0, 10);

const fmt2 = (n) =>
  n === null || n === undefined || n === ""
    ? "₹0.00"
    : `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const CATEGORIES = [
  { value: "packaging", label: "Packaging Material" },
  { value: "other", label: "Other Expense" },
];

const emptyItem = () => ({ description: "", category: "packaging", quantity: "1", unit_rate: "" });
const emptyInvoice = () => ({ invoice_no: "", vendor: "", title: "", date: todayStr(), notes: "", items: [emptyItem()] });

function lineAmount(it) {
  return (Number(it.quantity) || 0) * (Number(it.unit_rate) || 0);
}
function invoiceTotal(items) {
  return items.reduce((s, it) => s + lineAmount(it), 0);
}

function KpiCard({ label, value, color, bg, sub }) {
  return (
    <div style={{
      flex: "1 1 160px", padding: "14px 18px", borderRadius: 14,
      background: bg || C.white, border: `1.5px solid ${C.gray200}`, borderTop: `3px solid ${color || C.orange}`,
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.gray400, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "monospace", color: color || C.gray800, lineHeight: 1.1 }}>{fmt2(value)}</div>
      {sub && <div style={{ fontSize: 11, color: C.gray400, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

// ── Invoice create/edit dialog ──
function InvoiceDialog({ open, initial, onClose, onSaved }) {
  const [form, setForm] = useState(emptyInvoice());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (open) { setForm(initial || emptyInvoice()); setErr(""); }
  }, [open, initial]);

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setItem = (i, k, v) => setForm((f) => ({ ...f, items: f.items.map((it, j) => (j === i ? { ...it, [k]: v } : it)) }));
  const addItem = () => setForm((f) => ({ ...f, items: [...f.items, emptyItem()] }));
  const removeItem = (i) => setForm((f) => ({ ...f, items: f.items.filter((_, j) => j !== i) }));

  const total = invoiceTotal(form.items);

  const save = async () => {
    if (!form.date) return setErr("Date is required.");
    const items = form.items.filter((it) => (it.description || "").trim());
    if (items.length === 0) return setErr("Add at least one line item with a description.");
    setSaving(true); setErr("");
    try {
      const isEdit = !!(initial && initial.id);
      const url = isEdit ? `${API}/expenses/invoices/${initial.id}/` : `${API}/expenses/invoices/`;
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, items }),
      });
      if (!res.ok) throw new Error("save failed");
      onSaved();
      onClose();
    } catch {
      setErr("Could not save the invoice.");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>{initial && initial.id ? "Edit Invoice" : "New Expense Invoice"}</DialogTitle>
      <DialogContent dividers>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          <TextField label="Date" type="date" size="small" value={form.date} onChange={(e) => setField("date", e.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField label="Vendor" size="small" value={form.vendor} onChange={(e) => setField("vendor", e.target.value)} sx={{ flex: 1, minWidth: 160 }} />
          <TextField label="Invoice No (optional)" size="small" value={form.invoice_no} onChange={(e) => setField("invoice_no", e.target.value)} />
          <TextField label="Title (optional)" size="small" value={form.title} onChange={(e) => setField("title", e.target.value)} sx={{ flex: 1, minWidth: 160 }} />
        </div>

        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700 }}>Description</TableCell>
              <TableCell sx={{ fontWeight: 700, width: 160 }}>Category</TableCell>
              <TableCell sx={{ fontWeight: 700, width: 90 }} align="right">Qty</TableCell>
              <TableCell sx={{ fontWeight: 700, width: 110 }} align="right">Rate</TableCell>
              <TableCell sx={{ fontWeight: 700, width: 120 }} align="right">Amount</TableCell>
              <TableCell sx={{ width: 44 }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {form.items.map((it, i) => (
              <TableRow key={i}>
                <TableCell><TextField fullWidth size="small" placeholder="e.g. Bubble wrap" value={it.description} onChange={(e) => setItem(i, "description", e.target.value)} /></TableCell>
                <TableCell>
                  <TextField select fullWidth size="small" value={it.category} onChange={(e) => setItem(i, "category", e.target.value)}>
                    {CATEGORIES.map((c) => <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>)}
                  </TextField>
                </TableCell>
                <TableCell align="right"><TextField size="small" type="number" value={it.quantity} onChange={(e) => setItem(i, "quantity", e.target.value)} inputProps={{ style: { textAlign: "right" } }} /></TableCell>
                <TableCell align="right"><TextField size="small" type="number" value={it.unit_rate} onChange={(e) => setItem(i, "unit_rate", e.target.value)} inputProps={{ style: { textAlign: "right" } }} /></TableCell>
                <TableCell align="right" sx={{ fontFamily: "monospace", fontWeight: 700 }}>{fmt2(lineAmount(it))}</TableCell>
                <TableCell><IconButton size="small" onClick={() => removeItem(i)} disabled={form.items.length === 1}><DeleteIcon fontSize="small" /></IconButton></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
          <Button startIcon={<AddIcon />} onClick={addItem} size="small">Add line</Button>
          <div style={{ fontSize: 15, fontWeight: 800 }}>Total: <span style={{ fontFamily: "monospace", color: C.green }}>{fmt2(total)}</span></div>
        </div>

        <TextField label="Notes" fullWidth multiline minRows={2} size="small" value={form.notes} onChange={(e) => setField("notes", e.target.value)} sx={{ mt: 2 }} />
        {err && <div style={{ color: C.red, fontSize: 13, marginTop: 10, fontWeight: 600 }}>{err}</div>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Invoice"}</Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Main ──
export function ExpensesTab() {
  const { range, label: periodLabel } = useDateFilter();
  const [invoices, setInvoices] = useState([]);
  const [invMeta, setInvMeta] = useState({ grand_total: "0", by_category: {} });
  const [transport, setTransport] = useState([]);
  const [transportTotal, setTransportTotal] = useState("0");
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const [tForm, setTForm] = useState({ date: todayStr(), amount: "", note: "" });
  const [tSaving, setTSaving] = useState(false);

  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [sheetMsg, setSheetMsg] = useState(null);
  const fileRef = useRef(null);

  const dateParam = (() => {
    const p = new URLSearchParams();
    if (range.date_from) p.set("date_from", range.date_from);
    if (range.date_to) p.set("date_to", range.date_to);
    const s = p.toString();
    return s ? `?${s}` : "";
  })();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [invR, trR, smR] = await Promise.all([
        fetch(`${API}/expenses/invoices/${dateParam}`).then((r) => r.json()),
        fetch(`${API}/expenses/transport/${dateParam}`).then((r) => r.json()),
        fetch(`${API}/expenses/summary/${dateParam}`).then((r) => r.json()),
      ]);
      setInvoices(invR.results || []);
      setInvMeta({ grand_total: invR.grand_total || "0", by_category: invR.by_category || {} });
      setTransport(trR.results || []);
      setTransportTotal(trR.total_amount || "0");
      setSummary(smR);
    } finally { setLoading(false); }
  }, [dateParam]);

  useEffect(() => { load(); }, [load]);

  // Fetched as a blob rather than navigating to the URL: auth is a JWT held in
  // JS, and a plain link navigation wouldn't carry the Authorization header.
  const handleExport = async () => {
    setExporting(true);
    setSheetMsg(null);
    try {
      const res = await fetch(`${API}/expenses/export/${dateParam}`);
      if (!res.ok) {
        setSheetMsg({ type: "error", text: "Could not export the expense sheet." });
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") || "";
      const named = /filename="?([^"]+)"?/.exec(cd);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = named ? named[1] : "expenses.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      const n = res.headers.get("X-Expense-Rows");
      const t = res.headers.get("X-Transport-Rows");
      setSheetMsg({
        type: "success",
        text: `Exported ${n ?? "?"} expense line(s) and ${t ?? "?"} transport charge(s) for ${periodLabel}.`,
      });
    } catch {
      setSheetMsg({ type: "error", text: "Could not export the expense sheet." });
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async (file) => {
    if (!file) return;
    setImporting(true);
    setSheetMsg(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API}/expenses/import/`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setSheetMsg({ type: "error", text: data.error || "Import failed." });
        return;
      }
      const bits = [
        `${data.invoices_created} invoice(s) added`,
        `${data.invoices_updated} updated`,
        `${data.items_written} line item(s) written`,
        `${data.transport_created} transport charge(s) added`,
        `${data.transport_updated} updated`,
      ];
      if (data.skipped_rows) bits.push(`${data.skipped_rows} row(s) skipped`);
      setSheetMsg({ type: "success", text: `Imported — ${bits.join(", ")}.`, warnings: data.warnings });
      load();
    } catch {
      setSheetMsg({ type: "error", text: "Network error during import." });
    } finally {
      setImporting(false);
    }
  };

  const deleteInvoice = async (id) => {
    if (!window.confirm("Delete this invoice?")) return;
    await fetch(`${API}/expenses/invoices/${id}/`, { method: "DELETE" });
    load();
  };

  const addTransport = async () => {
    if (!tForm.date || !tForm.amount) return;
    setTSaving(true);
    try {
      await fetch(`${API}/expenses/transport/`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: tForm.date, amount: tForm.amount, note: tForm.note }),
      });
      setTForm({ date: tForm.date, amount: "", note: "" });
      load();
    } finally { setTSaving(false); }
  };

  const deleteTransport = async (id) => {
    await fetch(`${API}/expenses/transport/${id}/`, { method: "DELETE" });
    load();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: C.gray800, margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
            <ReceiptLongIcon style={{ color: C.orange }} /> Expenses
          </h1>
          <p style={{ color: C.gray400, fontSize: 13, margin: "4px 0 0" }}>
            Packaging material, other business costs and daily transportation — track actual cost with totals.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: C.gray400 }}>{periodLabel}</span>
          <Tooltip title="Download the current period as an Excel sheet you can edit and re-import">
            <span>
              <button onClick={handleExport} disabled={exporting} style={{ ...btn("ghostOrange", "md"), opacity: exporting ? 0.6 : 1 }}>
                {exporting
                  ? <CircularProgress size={13} style={{ color: C.orange }} />
                  : <DownloadIcon style={{ fontSize: 16, verticalAlign: "-3px" }} />}
                &nbsp;Export sheet
              </button>
            </span>
          </Tooltip>
          <Tooltip title="Upload an edited export — rows keep their IDs, so they update instead of duplicating">
            <span>
              <button onClick={() => fileRef.current?.click()} disabled={importing} style={{ ...btn("ghost", "md"), opacity: importing ? 0.6 : 1 }}>
                {importing
                  ? <CircularProgress size={13} style={{ color: C.gray600 }} />
                  : <UploadFileIcon style={{ fontSize: 16, verticalAlign: "-3px" }} />}
                &nbsp;Import sheet
              </button>
            </span>
          </Tooltip>
          <input
            ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; handleImport(f); }}
          />
          <button onClick={() => { setEditing(null); setDialogOpen(true); }} style={btn("primary", "md")}>+ New Invoice</button>
        </div>
      </div>

      {/* Export / import result */}
      {sheetMsg && (
        <div style={{
          padding: "12px 18px", borderRadius: 10, fontSize: 13, fontWeight: 500,
          background: sheetMsg.type === "success" ? "#ECFDF5" : "#FFF1F2",
          color:      sheetMsg.type === "success" ? C.green : C.red,
          border: `1px solid ${sheetMsg.type === "success" ? "#A7F3D0" : "#FECDD3"}`,
          display: "flex", alignItems: "flex-start", gap: 8,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {sheetMsg.text}
            {!!sheetMsg.warnings?.length && (
              <ul style={{ margin: "6px 0 0 18px", fontWeight: 400 }}>
                {sheetMsg.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            )}
          </div>
          <button onClick={() => setSheetMsg(null)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", fontSize: 16, lineHeight: 1 }}>×</button>
        </div>
      )}

      {/* Summary cards */}
      {summary && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <KpiCard label="Packaging Material" value={summary.packaging} color={C.blue} bg="#EFF6FF" />
          <KpiCard label="Other Expenses" value={summary.other} color="#D97706" bg="#FFFBEB" />
          <KpiCard label="Transportation" value={summary.transport} color="#7C3AED" bg="#F5F3FF" sub={`${transport.length} day(s)`} />
          <KpiCard label="Grand Total" value={summary.grand_total} color={C.green} bg="#ECFDF5" sub={periodLabel} />
        </div>
      )}

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 40 }}><CircularProgress style={{ color: C.orange }} /></div>
      ) : (
        <>
          {/* Invoices */}
          <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "12px 20px", borderBottom: `1px solid ${C.gray100}`, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontWeight: 700, fontSize: 13, color: C.gray800 }}>Expense Invoices</span>
              <span style={{ fontSize: 12, color: C.gray400, background: C.gray100, borderRadius: 10, padding: "2px 8px", fontWeight: 600 }}>{invoices.length}</span>
              <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 800, color: C.gray700 }}>Total: <span style={{ fontFamily: "monospace" }}>{fmt2(invMeta.grand_total)}</span></span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr>{["Date", "Vendor / Title", "Invoice No", "Lines", "Categories", "Amount", ""].map((h) => (
                    <th key={h} style={{ ...S.th, fontSize: 10, whiteSpace: "nowrap" }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {invoices.length === 0 ? (
                    <tr><td colSpan={7} style={{ ...S.td, textAlign: "center", padding: 40, color: C.gray400 }}>No invoices for this period. Click “+ New Invoice” to add one.</td></tr>
                  ) : invoices.map((inv, idx) => (
                    <tr key={inv.id} style={{ background: idx % 2 === 0 ? C.white : C.gray50, borderBottom: `1px solid ${C.gray100}` }}>
                      <td style={{ ...S.td, whiteSpace: "nowrap", color: C.gray500 }}>{inv.date}</td>
                      <td style={{ ...S.td }}>
                        <div style={{ fontWeight: 600, color: C.gray700 }}>{inv.vendor || "—"}</div>
                        {inv.title && <div style={{ fontSize: 11, color: C.gray400 }}>{inv.title}</div>}
                      </td>
                      <td style={{ ...S.td, fontFamily: "monospace", color: C.gray500 }}>{inv.invoice_no || "—"}</td>
                      <td style={{ ...S.td, textAlign: "center" }}>{inv.items.length}</td>
                      <td style={{ ...S.td }}>
                        {Object.entries(inv.by_category).map(([k, v]) => (
                          <span key={k} style={{ display: "inline-block", fontSize: 10, marginRight: 6, padding: "1px 6px", borderRadius: 4, background: k === "packaging" ? "#EFF6FF" : "#FFFBEB", color: k === "packaging" ? C.blue : "#D97706", fontWeight: 600 }}>
                            {k}: {fmt2(v)}
                          </span>
                        ))}
                      </td>
                      <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: C.gray800 }}>{fmt2(inv.total_amount)}</td>
                      <td style={{ ...S.td, whiteSpace: "nowrap" }}>
                        <Tooltip title="Edit"><IconButton size="small" onClick={() => { setEditing({ ...inv, items: inv.items.map((it) => ({ description: it.description, category: it.category, quantity: it.quantity, unit_rate: it.unit_rate })) }); setDialogOpen(true); }}><EditIcon fontSize="small" /></IconButton></Tooltip>
                        <Tooltip title="Delete"><IconButton size="small" onClick={() => deleteInvoice(inv.id)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Transport daily log */}
          <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "12px 20px", borderBottom: `1px solid ${C.gray100}`, display: "flex", alignItems: "center", gap: 10 }}>
              <LocalShippingIcon style={{ color: "#7C3AED", fontSize: 20 }} />
              <span style={{ fontWeight: 700, fontSize: 13, color: C.gray800 }}>Daily Transportation Charges</span>
              <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 800, color: C.gray700 }}>Total: <span style={{ fontFamily: "monospace", color: "#7C3AED" }}>{fmt2(transportTotal)}</span></span>
            </div>
            {/* Add row */}
            <div style={{ display: "flex", gap: 10, padding: "12px 20px", borderBottom: `1px solid ${C.gray100}`, flexWrap: "wrap", alignItems: "center" }}>
              <input type="date" value={tForm.date} onChange={(e) => setTForm((f) => ({ ...f, date: e.target.value }))} style={{ ...S.inp, width: 150 }} />
              <input type="number" placeholder="Amount ₹" value={tForm.amount} onChange={(e) => setTForm((f) => ({ ...f, amount: e.target.value }))} style={{ ...S.inp, width: 130 }} />
              <input placeholder="Note (e.g. Tempo to hub)" value={tForm.note} onChange={(e) => setTForm((f) => ({ ...f, note: e.target.value }))} style={{ ...S.inp, flex: 1, minWidth: 180 }} />
              <button onClick={addTransport} disabled={tSaving || !tForm.amount} style={{ ...btn("primary", "sm"), opacity: tSaving || !tForm.amount ? 0.5 : 1 }}>+ Add charge</button>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead><tr>{["Date", "Amount", "Note", ""].map((h) => <th key={h} style={{ ...S.th, fontSize: 10 }}>{h}</th>)}</tr></thead>
                <tbody>
                  {transport.length === 0 ? (
                    <tr><td colSpan={4} style={{ ...S.td, textAlign: "center", padding: 30, color: C.gray400 }}>No transport charges logged for this period.</td></tr>
                  ) : transport.map((t, idx) => (
                    <tr key={t.id} style={{ background: idx % 2 === 0 ? C.white : C.gray50, borderBottom: `1px solid ${C.gray100}` }}>
                      <td style={{ ...S.td, whiteSpace: "nowrap", color: C.gray500 }}>{t.date}</td>
                      <td style={{ ...S.td, fontFamily: "monospace", fontWeight: 700, color: C.gray800 }}>{fmt2(t.amount)}</td>
                      <td style={{ ...S.td, color: C.gray600 }}>{t.note || "—"}</td>
                      <td style={{ ...S.td }}><IconButton size="small" onClick={() => deleteTransport(t.id)}><DeleteIcon fontSize="small" /></IconButton></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <InvoiceDialog open={dialogOpen} initial={editing} onClose={() => setDialogOpen(false)} onSaved={load} />
    </div>
  );
}
