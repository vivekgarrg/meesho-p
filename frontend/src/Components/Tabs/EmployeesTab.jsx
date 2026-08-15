import React, { useState, useEffect, useCallback } from "react";
import { API, C, S, btn, SectionHeader } from "../../App";
import { useAuth } from "../../contexts/AuthContext";
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  IconButton, MenuItem, Table, TableHead, TableBody, TableRow, TableCell,
  CircularProgress, Tooltip, Chip,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import PaymentsIcon from "@mui/icons-material/Payments";
import PersonIcon from "@mui/icons-material/Person";

const todayStr = () => new Date().toISOString().slice(0, 10);

const fmt2 = (n) =>
  n === null || n === undefined || n === ""
    ? "₹0.00"
    : `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];
const SALARY_TYPE_OPTIONS = [
  { value: "fixed_monthly", label: "Fixed Monthly" },
  { value: "piecework", label: "Piecework" },
  { value: "daily_wage", label: "Daily Wage" },
  { value: "other", label: "Other" },
];
const PAYMENT_TYPE_OPTIONS = [
  { value: "salary", label: "Salary" },
  { value: "advance", label: "Advance" },
  { value: "bonus", label: "Bonus" },
  { value: "reimbursement", label: "Reimbursement" },
  { value: "other", label: "Other" },
];
const METHOD_OPTIONS = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "cheque", label: "Cheque" },
  { value: "other", label: "Other" },
];

// ── Shared field schemas (declarative, same shape used across BusinessProfile) ──
const ADDRESS_FIELDS = [
  { key: "address_line1", label: "Address line 1" },
  { key: "address_line2", label: "Address line 2" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "pincode", label: "Pincode" },
];
const BANK_FIELDS = [
  { key: "account_holder_name", label: "Account holder name" },
  { key: "bank_name", label: "Bank name" },
  { key: "account_number", label: "Account number" },
  { key: "ifsc_code", label: "IFSC code" },
  { key: "upi_id", label: "UPI ID" },
];

const emptyEmployee = () => ({
  full_name: "", phone: "", email: "", designation: "", department: "",
  date_of_joining: "", date_of_leaving: "", status: "active", salary_type: "fixed_monthly",
  address_line1: "", address_line2: "", city: "", state: "", pincode: "",
  account_holder_name: "", bank_name: "", account_number: "", ifsc_code: "", upi_id: "",
  emergency_contact_name: "", emergency_contact_phone: "", notes: "",
});
const emptyOwner = () => ({
  name: "", phone: "", email: "", pan: "",
  address_line1: "", address_line2: "", city: "", state: "", pincode: "",
  account_holder_name: "", bank_name: "", account_number: "", ifsc_code: "", upi_id: "",
  ownership_percent: "", notes: "",
});
const emptyPayment = () => ({ amount: "", paid_on: todayStr(), payment_type: "salary", method: "cash", reference: "", note: "" });

function KpiCard({ label, value, color, bg, sub }) {
  return (
    <div style={{
      flex: "1 1 160px", padding: "14px 18px", borderRadius: 14,
      background: bg || C.white, border: `1.5px solid ${C.gray200}`, borderTop: `3px solid ${color || C.orange}`,
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.gray400, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "monospace", color: color || C.gray800, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.gray400, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function FieldGrid({ fields, values, onChange, disabled }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
      {fields.map(({ key, label, type }) => (
        <div key={key} style={type === "textarea" ? { gridColumn: "1 / -1" } : undefined}>
          <label style={S.label}>{label}</label>
          {type === "textarea" ? (
            <textarea
              style={{ ...S.inp, minHeight: 60, resize: "vertical" }}
              disabled={disabled}
              value={values[key] ?? ""}
              onChange={(e) => onChange(key, e.target.value)}
            />
          ) : (
            <input
              style={S.inp}
              type={type || "text"}
              disabled={disabled}
              value={values[key] ?? ""}
              onChange={(e) => onChange(key, e.target.value)}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function FormSection({ title, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.gray400, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

// ── Employee add/edit dialog ──
function EmployeeFormDialog({ open, initial, onClose, onSaved }) {
  const [form, setForm] = useState(emptyEmployee());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (open) { setForm(initial ? { ...emptyEmployee(), ...initial } : emptyEmployee()); setErr(""); }
  }, [open, initial]);

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!(form.full_name || "").trim()) return setErr("Name is required.");
    setSaving(true); setErr("");
    try {
      const isEdit = !!(initial && initial.id);
      const url = isEdit ? `${API}/employees/${initial.id}/` : `${API}/employees/`;
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Save failed");
      onSaved();
      onClose();
    } catch (e) {
      setErr(e.message || "Could not save the employee.");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>{initial && initial.id ? "Edit Employee" : "Add Employee"}</DialogTitle>
      <DialogContent dividers>
        <FormSection title="Identity">
          <FieldGrid
            fields={[
              { key: "full_name", label: "Full name" },
              { key: "phone", label: "Phone" },
              { key: "email", label: "Email" },
            ]}
            values={form} onChange={setField}
          />
        </FormSection>

        <FormSection title="Employment">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={S.label}>Designation</label>
              <input style={S.inp} value={form.designation} onChange={(e) => setField("designation", e.target.value)} />
            </div>
            <div>
              <label style={S.label}>Department</label>
              <input style={S.inp} value={form.department} onChange={(e) => setField("department", e.target.value)} />
            </div>
            <div>
              <label style={S.label}>Status</label>
              <TextField select fullWidth size="small" value={form.status} onChange={(e) => setField("status", e.target.value)}>
                {STATUS_OPTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
              </TextField>
            </div>
            <div>
              <label style={S.label}>Salary type</label>
              <TextField select fullWidth size="small" value={form.salary_type} onChange={(e) => setField("salary_type", e.target.value)}>
                {SALARY_TYPE_OPTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
              </TextField>
            </div>
            <div>
              <label style={S.label}>Date of joining</label>
              <input style={S.inp} type="date" value={form.date_of_joining || ""} onChange={(e) => setField("date_of_joining", e.target.value)} />
            </div>
            <div>
              <label style={S.label}>Date of leaving</label>
              <input style={S.inp} type="date" value={form.date_of_leaving || ""} onChange={(e) => setField("date_of_leaving", e.target.value)} />
            </div>
          </div>
        </FormSection>

        <FormSection title="Address">
          <FieldGrid fields={ADDRESS_FIELDS} values={form} onChange={setField} />
        </FormSection>

        <FormSection title="Bank details">
          <FieldGrid fields={BANK_FIELDS} values={form} onChange={setField} />
        </FormSection>

        <FormSection title="Emergency contact">
          <FieldGrid
            fields={[
              { key: "emergency_contact_name", label: "Name" },
              { key: "emergency_contact_phone", label: "Phone" },
            ]}
            values={form} onChange={setField}
          />
        </FormSection>

        <FormSection title="Notes">
          <FieldGrid fields={[{ key: "notes", label: "Notes", type: "textarea" }]} values={form} onChange={setField} />
        </FormSection>

        {err && <div style={{ color: C.red, fontSize: 13, fontWeight: 600 }}>{err}</div>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Owner add/edit dialog ──
function OwnerFormDialog({ open, initial, onClose, onSaved }) {
  const [form, setForm] = useState(emptyOwner());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (open) { setForm(initial ? { ...emptyOwner(), ...initial } : emptyOwner()); setErr(""); }
  }, [open, initial]);

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!(form.name || "").trim()) return setErr("Name is required.");
    setSaving(true); setErr("");
    try {
      const isEdit = !!(initial && initial.id);
      const url = isEdit ? `${API}/owners/${initial.id}/` : `${API}/owners/`;
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Save failed");
      onSaved();
      onClose();
    } catch (e) {
      setErr(e.message || "Could not save the owner.");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>{initial && initial.id ? "Edit Owner" : "Add Owner"}</DialogTitle>
      <DialogContent dividers>
        <FormSection title="Identity">
          <FieldGrid
            fields={[
              { key: "name", label: "Name" },
              { key: "phone", label: "Phone" },
              { key: "email", label: "Email" },
              { key: "pan", label: "PAN" },
              { key: "ownership_percent", label: "Ownership %", type: "number" },
            ]}
            values={form} onChange={setField}
          />
        </FormSection>
        <FormSection title="Address">
          <FieldGrid fields={ADDRESS_FIELDS} values={form} onChange={setField} />
        </FormSection>
        <FormSection title="Bank details">
          <FieldGrid fields={BANK_FIELDS} values={form} onChange={setField} />
        </FormSection>
        <FormSection title="Notes">
          <FieldGrid fields={[{ key: "notes", label: "Notes", type: "textarea" }]} values={form} onChange={setField} />
        </FormSection>
        {err && <div style={{ color: C.red, fontSize: 13, fontWeight: 600 }}>{err}</div>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Employee detail: profile summary + payment timeline ──
function EmployeeDetailDialog({ open, employee, canEdit, onClose, onChanged }) {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(emptyPayment());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    if (!employee) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/employees/${employee.id}/payments/`);
      const data = await res.json();
      setPayments(data.results || []);
    } finally { setLoading(false); }
  }, [employee]);

  useEffect(() => { if (open) { load(); setForm(emptyPayment()); setErr(""); } }, [open, load]);

  const recordPayment = async () => {
    const amount = Number(form.amount);
    if (!amount || amount <= 0) return setErr("Enter a valid amount.");
    if (!form.paid_on) return setErr("Date is required.");
    setSaving(true); setErr("");
    try {
      const res = await fetch(`${API}/employees/${employee.id}/payments/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Could not record payment.");
      setForm(emptyPayment());
      await load();
      onChanged();
    } catch (e) {
      setErr(e.message);
    } finally { setSaving(false); }
  };

  const deletePayment = async (id) => {
    if (!window.confirm("Delete this payment record?")) return;
    await fetch(`${API}/employees/payments/${id}/`, { method: "DELETE" });
    load();
    onChanged();
  };

  if (!employee) return null;
  const totalPaid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>
        {employee.full_name}
        <span style={{ fontSize: 12, fontWeight: 500, color: C.gray400, marginLeft: 10 }}>
          {employee.designation || "—"}{employee.department ? ` · ${employee.department}` : ""}
        </span>
      </DialogTitle>
      <DialogContent dividers>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
          <KpiCard label="Total Paid" value={fmt2(totalPaid)} color={C.green} />
          <KpiCard label="Phone" value={employee.phone || "—"} />
          <KpiCard label="Status" value={employee.status === "active" ? "Active" : "Inactive"} color={employee.status === "active" ? C.green : C.gray400} />
        </div>

        {canEdit && (
          <div style={{ ...S.card, background: C.gray50, marginBottom: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.gray700, marginBottom: 10 }}>Record a payment</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div>
                <label style={S.label}>Amount</label>
                <input style={{ ...S.inp, width: 120 }} type="number" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
              </div>
              <div>
                <label style={S.label}>Date</label>
                <input style={{ ...S.inp, width: 150 }} type="date" value={form.paid_on} onChange={(e) => setForm((f) => ({ ...f, paid_on: e.target.value }))} />
              </div>
              <div>
                <label style={S.label}>Type</label>
                <TextField select size="small" style={{ width: 150 }} value={form.payment_type} onChange={(e) => setForm((f) => ({ ...f, payment_type: e.target.value }))}>
                  {PAYMENT_TYPE_OPTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
                </TextField>
              </div>
              <div>
                <label style={S.label}>Method</label>
                <TextField select size="small" style={{ width: 150 }} value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}>
                  {METHOD_OPTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
                </TextField>
              </div>
              <div style={{ flex: "1 1 160px" }}>
                <label style={S.label}>Reference</label>
                <input style={S.inp} value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} placeholder="UTR / cheque no." />
              </div>
              <button onClick={recordPayment} disabled={saving} style={{ ...btn("primary", "md"), opacity: saving ? 0.6 : 1 }}>
                {saving ? "Saving…" : "+ Add payment"}
              </button>
            </div>
            {err && <div style={{ color: C.red, fontSize: 12, marginTop: 8, fontWeight: 600 }}>{err}</div>}
          </div>
        )}

        <div style={{ fontSize: 12, fontWeight: 700, color: C.gray700, marginBottom: 8 }}>Payment history</div>
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 20 }}><CircularProgress size={24} /></div>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Date</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Type</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Method</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Reference</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="right">Amount</TableCell>
                {canEdit && <TableCell sx={{ width: 44 }} />}
              </TableRow>
            </TableHead>
            <TableBody>
              {payments.length === 0 ? (
                <TableRow><TableCell colSpan={6} align="center" sx={{ color: C.gray400, padding: 3 }}>No payments recorded yet.</TableCell></TableRow>
              ) : payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{p.paid_on}</TableCell>
                  <TableCell style={{ textTransform: "capitalize" }}>{p.payment_type}</TableCell>
                  <TableCell style={{ textTransform: "capitalize" }}>{p.method.replace("_", " ")}</TableCell>
                  <TableCell>{p.reference || "—"}</TableCell>
                  <TableCell align="right" sx={{ fontFamily: "monospace", fontWeight: 700 }}>{fmt2(p.amount)}</TableCell>
                  {canEdit && (
                    <TableCell>
                      <IconButton size="small" onClick={() => deletePayment(p.id)}><DeleteIcon fontSize="small" /></IconButton>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Main tab ──
export function EmployeesTab() {
  const { user } = useAuth();
  const canEdit = user?.role === "super_admin";

  const [employees, setEmployees] = useState([]);
  const [owners, setOwners] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [empDialogOpen, setEmpDialogOpen] = useState(false);
  const [editingEmp, setEditingEmp] = useState(null);
  const [detailEmp, setDetailEmp] = useState(null);

  const [ownerDialogOpen, setOwnerDialogOpen] = useState(false);
  const [editingOwner, setEditingOwner] = useState(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (search) qs.set("search", search);
      if (statusFilter) qs.set("status", statusFilter);
      const [empR, ownerR, sumR] = await Promise.all([
        fetch(`${API}/employees/?${qs}`).then((r) => r.json()),
        fetch(`${API}/owners/`).then((r) => r.json()),
        fetch(`${API}/employees/summary/`).then((r) => r.json()),
      ]);
      setEmployees(empR.results || []);
      setOwners(ownerR.results || []);
      setSummary(sumR);
    } finally { setLoading(false); }
  }, [search, statusFilter]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const deleteEmployee = async (emp) => {
    if (!window.confirm(`Delete ${emp.full_name}?`)) return;
    const res = await fetch(`${API}/employees/${emp.id}/`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      alert(data?.error || "Could not delete employee.");
      return;
    }
    loadAll();
  };

  const deleteOwner = async (owner) => {
    if (!window.confirm(`Delete ${owner.name}?`)) return;
    await fetch(`${API}/owners/${owner.id}/`, { method: "DELETE" });
    loadAll();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {summary && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <KpiCard label="Active Employees" value={summary.active_employees} color={C.blue} />
          <KpiCard label="Paid This Month" value={fmt2(summary.total_paid_this_month)} color={C.orange} bg="#FFFBEB" />
          <KpiCard label="Paid All Time" value={fmt2(summary.total_paid_all_time)} color={C.green} bg="#ECFDF5" />
        </div>
      )}

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 40 }}><CircularProgress style={{ color: C.orange }} /></div>
      ) : (
        <>
          {/* Employees */}
          <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "12px 20px", borderBottom: `1px solid ${C.gray100}`, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 700, fontSize: 13, color: C.gray800 }}>Employees</span>
              <span style={{ fontSize: 12, color: C.gray400, background: C.gray100, borderRadius: 10, padding: "2px 8px", fontWeight: 600 }}>{employees.length}</span>
              <input
                style={{ ...S.inp, width: 200, marginLeft: "auto" }}
                placeholder="Search name, phone, role…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <TextField select size="small" style={{ width: 130 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} displayEmpty>
                <MenuItem value="">All statuses</MenuItem>
                {STATUS_OPTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
              </TextField>
              {canEdit && (
                <button onClick={() => { setEditingEmp(null); setEmpDialogOpen(true); }} style={btn("primary", "sm")}>
                  <AddIcon fontSize="small" style={{ verticalAlign: "middle" }} /> Add employee
                </button>
              )}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr>{["Name", "Designation", "Status", "Total Paid", "Last Payment", ""].map((h) => (
                    <th key={h} style={{ ...S.th, fontSize: 10, whiteSpace: "nowrap" }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {employees.length === 0 ? (
                    <tr><td colSpan={6} style={{ ...S.td, textAlign: "center", padding: 40, color: C.gray400 }}>No employees yet. Click "+ Add employee" to add one.</td></tr>
                  ) : employees.map((emp, idx) => (
                    <tr key={emp.id} style={{ background: idx % 2 === 0 ? C.white : C.gray50, borderBottom: `1px solid ${C.gray100}`, cursor: "pointer" }} onClick={() => setDetailEmp(emp)}>
                      <td style={{ ...S.td, fontWeight: 600, color: C.gray800 }}>
                        <PersonIcon fontSize="inherit" style={{ marginRight: 6, verticalAlign: "middle", color: C.gray400 }} />
                        {emp.full_name}
                      </td>
                      <td style={{ ...S.td, color: C.gray500 }}>{emp.designation || "—"}</td>
                      <td style={S.td}>
                        <Chip size="small" label={emp.status === "active" ? "Active" : "Inactive"}
                          sx={{ background: emp.status === "active" ? "#ECFDF5" : C.gray100, color: emp.status === "active" ? C.green : C.gray500, fontWeight: 700, fontSize: 10 }} />
                      </td>
                      <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: C.gray800 }}>{fmt2(emp.total_paid)}</td>
                      <td style={{ ...S.td, color: C.gray500 }}>{emp.last_payment_date || "—"}</td>
                      <td style={{ ...S.td, whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                        <Tooltip title="Payment history"><IconButton size="small" onClick={() => setDetailEmp(emp)}><PaymentsIcon fontSize="small" /></IconButton></Tooltip>
                        {canEdit && (
                          <>
                            <Tooltip title="Edit"><IconButton size="small" onClick={() => { setEditingEmp(emp); setEmpDialogOpen(true); }}><EditIcon fontSize="small" /></IconButton></Tooltip>
                            <Tooltip title="Delete"><IconButton size="small" onClick={() => deleteEmployee(emp)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Owners */}
          <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "12px 20px", borderBottom: `1px solid ${C.gray100}`, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontWeight: 700, fontSize: 13, color: C.gray800 }}>Owner Details</span>
              <span style={{ fontSize: 12, color: C.gray400, background: C.gray100, borderRadius: 10, padding: "2px 8px", fontWeight: 600 }}>{owners.length}</span>
              {canEdit && (
                <button onClick={() => { setEditingOwner(null); setOwnerDialogOpen(true); }} style={{ ...btn("secondary", "sm"), marginLeft: "auto" }}>
                  <AddIcon fontSize="small" style={{ verticalAlign: "middle" }} /> Add owner
                </button>
              )}
            </div>
            <div style={{ padding: 16, display: "flex", gap: 14, flexWrap: "wrap" }}>
              {owners.length === 0 ? (
                <div style={{ color: C.gray400, fontSize: 13, padding: "10px 4px" }}>No owner details on file yet.</div>
              ) : owners.map((o) => (
                <div key={o.id} style={{ ...S.card, flex: "1 1 260px", minWidth: 240 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: C.gray800 }}>{o.name}</div>
                      {o.ownership_percent && <div style={{ fontSize: 11, color: C.gray400 }}>{o.ownership_percent}% ownership</div>}
                    </div>
                    {canEdit && (
                      <div>
                        <IconButton size="small" onClick={() => { setEditingOwner(o); setOwnerDialogOpen(true); }}><EditIcon fontSize="small" /></IconButton>
                        <IconButton size="small" onClick={() => deleteOwner(o)}><DeleteIcon fontSize="small" /></IconButton>
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: C.gray500, marginTop: 8, lineHeight: 1.6 }}>
                    {o.phone && <div>📞 {o.phone}</div>}
                    {o.email && <div>✉ {o.email}</div>}
                    {o.pan && <div>PAN: {o.pan}</div>}
                    {(o.city || o.state) && <div>{[o.city, o.state].filter(Boolean).join(", ")}</div>}
                    {o.bank_name && <div>{o.bank_name} {o.account_number ? `··· ${String(o.account_number).slice(-4)}` : ""}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <EmployeeFormDialog open={empDialogOpen} initial={editingEmp} onClose={() => setEmpDialogOpen(false)} onSaved={loadAll} />
      <OwnerFormDialog open={ownerDialogOpen} initial={editingOwner} onClose={() => setOwnerDialogOpen(false)} onSaved={loadAll} />
      <EmployeeDetailDialog open={!!detailEmp} employee={detailEmp} canEdit={canEdit} onClose={() => setDetailEmp(null)} onChanged={loadAll} />
    </div>
  );
}
