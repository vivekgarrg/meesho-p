import React, { useState, useEffect, useCallback, useMemo } from "react";
import { API, C, S, btn } from "../../App";
import { useAuth } from "../../contexts/AuthContext";
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  IconButton, MenuItem, Table, TableHead, TableBody, TableRow, TableCell,
  CircularProgress, Tooltip, Chip, Tabs, Tab,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import PaymentsIcon from "@mui/icons-material/Payments";
import PersonIcon from "@mui/icons-material/Person";
import EventBusyIcon from "@mui/icons-material/EventBusy";

const todayStr = () => new Date().toISOString().slice(0, 10);

const fmt2 = (n) =>
  n === null || n === undefined || n === ""
    ? "₹0.00"
    : `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Salary figures read better without paise — the rupee is the unit people
// actually think in when they say "he's on thirty thousand".
const fmt0 = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

/** 'YYYY-MM' for the month n months before the current one. */
function shiftMonth(ym, n) {
  const [y, m] = ym.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}
const thisMonth = () => new Date().toISOString().slice(0, 7);
/** Salary runs in arrears, so the month you land on is the one just finished. */
const lastMonth = () => shiftMonth(thisMonth(), -1);

function monthLabel(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-IN", { month: "long", year: "numeric" });
}
/** The last N months, newest first, as 'YYYY-MM'. */
function recentMonths(n) {
  const cur = thisMonth();
  return Array.from({ length: n }, (_, i) => shiftMonth(cur, -i));
}

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
// Values match Python's date.weekday(), which is what the server compares against.
const WEEKDAY_OPTIONS = [
  { value: 0, label: "Monday" }, { value: 1, label: "Tuesday" }, { value: 2, label: "Wednesday" },
  { value: 3, label: "Thursday" }, { value: 4, label: "Friday" }, { value: 5, label: "Saturday" },
  { value: 6, label: "Sunday" },
];
const weekdayLabel = (v) =>
  v === null || v === undefined || v === "" ? "—" : (WEEKDAY_OPTIONS.find((w) => w.value === Number(v))?.label ?? "—");

// Attendance statuses. `short` is what fits in a calendar cell.
const ATTENDANCE_STATUSES = [
  { value: "present",      label: "Present",      short: "P",  color: C.green,  bg: "#ECFDF5" },
  { value: "half_day",     label: "Half Day",     short: "½",  color: "#B45309", bg: "#FEF3C7" },
  { value: "paid_leave",   label: "Paid Leave",   short: "PL", color: C.blue,   bg: "#EFF6FF" },
  { value: "unpaid_leave", label: "Unpaid Leave", short: "UL", color: C.red,    bg: "#FFF1F2" },
  { value: "absent",       label: "Absent",       short: "A",  color: C.red,    bg: "#FEE2E2" },
];
const statusMeta = (v) => ATTENDANCE_STATUSES.find((s) => s.value === v);

// Mirrors EmployeeAttendance.EXTRA_PAY_REASON_CHOICES on the server.
const EXTRA_PAY_REASONS = [
  { value: "sunday",   label: "Sunday / weekly-off working" },
  { value: "holiday",  label: "Holiday working" },
  { value: "overtime", label: "Overtime" },
  { value: "other",    label: "Other" },
];

/** "2 Sundays · 1 overtime" — the short form of a payslip's extra_pay_breakdown. */
function extraPaySummary(breakdown) {
  if (!breakdown?.length) return "";
  const short = { sunday: "Sunday", holiday: "holiday", overtime: "overtime", other: "other", "": "unspecified" };
  return breakdown.map((b) => {
    const word = short[b.reason] ?? b.reason;
    return `${b.days} ${word}${b.reason === "sunday" && b.days !== 1 ? "s" : ""}`;
  }).join(" · ");
}

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
  monthly_salary: "", weekly_off_day: "", paid_leave_per_month: "0",
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
const emptyPayment = () => ({
  amount: "", paid_on: todayStr(), payment_type: "salary",
  salary_month: lastMonth(), method: "cash", reference: "", note: "",
});

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

function FormSection({ title, children, hint }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.gray400, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: hint ? 3 : 8 }}>{title}</div>
      {hint && <div style={{ fontSize: 11.5, color: C.gray400, marginBottom: 9 }}>{hint}</div>}
      {children}
    </div>
  );
}

function SectionShell({ title, count, actions, children }) {
  return (
    <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "12px 20px", borderBottom: `1px solid ${C.gray100}`, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: C.gray800 }}>{title}</span>
        {count !== undefined && (
          <span style={{ fontSize: 12, color: C.gray400, background: C.gray100, borderRadius: 10, padding: "2px 8px", fontWeight: 600 }}>{count}</span>
        )}
        {actions && <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>{actions}</div>}
      </div>
      {children}
    </div>
  );
}

function MonthPicker({ value, onChange, months = 12 }) {
  return (
    <TextField select size="small" style={{ minWidth: 170 }} value={value} onChange={(e) => onChange(e.target.value)}>
      {recentMonths(months).map((m) => <MenuItem key={m} value={m}>{monthLabel(m)}</MenuItem>)}
    </TextField>
  );
}

// ── Employee add/edit dialog ──
function EmployeeFormDialog({ open, initial, onClose, onSaved }) {
  const [form, setForm] = useState(emptyEmployee());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (open) {
      const base = initial ? { ...emptyEmployee(), ...initial } : emptyEmployee();
      // The server sends null for "no weekly off"; a select needs "".
      setForm({ ...base, weekly_off_day: base.weekly_off_day ?? "" });
      setErr("");
    }
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

        <FormSection
          title="Payroll terms"
          hint="The day rate is the monthly salary divided by the days in that month, so a clean month always pays exactly the figure below. Weekly offs and holidays are paid days."
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            <div>
              <label style={S.label}>Monthly salary (₹)</label>
              <input style={S.inp} type="number" min="0" value={form.monthly_salary ?? ""}
                     onChange={(e) => setField("monthly_salary", e.target.value)} placeholder="0" />
            </div>
            <div>
              <label style={S.label}>Weekly off (holiday)</label>
              <TextField select fullWidth size="small" value={form.weekly_off_day ?? ""}
                         onChange={(e) => setField("weekly_off_day", e.target.value)}>
                <MenuItem value="">No fixed weekly off</MenuItem>
                {WEEKDAY_OPTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
              </TextField>
            </div>
            <div>
              <label style={S.label}>Paid leave per month (days)</label>
              <input style={S.inp} type="number" min="0" step="0.5" value={form.paid_leave_per_month ?? "0"}
                     onChange={(e) => setField("paid_leave_per_month", e.target.value)} />
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

// ── Holiday dialog: business-wide by default, or scoped to one person ──
function HolidayFormDialog({ open, employees, onClose, onSaved }) {
  const [form, setForm] = useState({ date: todayStr(), name: "", employee_id: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => { if (open) { setForm({ date: todayStr(), name: "", employee_id: "" }); setErr(""); } }, [open]);

  const save = async () => {
    if (!form.name.trim()) return setErr("Give the holiday a name.");
    setSaving(true); setErr("");
    try {
      const res = await fetch(`${API}/employees/holidays/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, employee_id: form.employee_id || null }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Could not save the holiday.");
      onSaved(); onClose();
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>Add Holiday</DialogTitle>
      <DialogContent dividers>
        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <label style={S.label}>Date</label>
            <input style={S.inp} type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
          </div>
          <div>
            <label style={S.label}>Name</label>
            <input style={S.inp} value={form.name} placeholder="Diwali, shop closed…"
                   onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <label style={S.label}>Applies to</label>
            <TextField select fullWidth size="small" value={form.employee_id}
                       onChange={(e) => setForm((f) => ({ ...f, employee_id: e.target.value }))}>
              <MenuItem value="">Everyone</MenuItem>
              {employees.map((e) => <MenuItem key={e.id} value={e.id}>{e.full_name}</MenuItem>)}
            </TextField>
            <div style={{ fontSize: 11.5, color: C.gray400, marginTop: 5 }}>
              Pick one person to give them a holiday the rest of the team doesn't get.
            </div>
          </div>
        </div>
        {err && <div style={{ color: C.red, fontSize: 13, fontWeight: 600, marginTop: 10 }}>{err}</div>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Day editor: the one place attendance and extra pay get typed in ──
function DayEditorDialog({ open, employee, date, existing, onClose, onSaved }) {
  const [form, setForm] = useState({ status: "present", overtime_hours: "", extra_pay: "", extra_pay_reason: "", note: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  // Monday = 0, matching weekly_off_day. Extra pay on a Sunday or on this
  // person's own weekly off is almost always "worked their day off".
  const weekday = date ? (new Date(`${date}T00:00:00`).getDay() + 6) % 7 : null;
  const isSunday = weekday === 6;
  const isOwnWeekOff = employee?.weekly_off_day !== null && employee?.weekly_off_day !== undefined
    && weekday === Number(employee.weekly_off_day);
  const suggestedReason = isSunday || isOwnWeekOff ? "sunday" : "overtime";

  useEffect(() => {
    if (!open) return;
    setForm({
      status: existing?.status || "present",
      overtime_hours: existing?.overtime_hours ?? "",
      extra_pay: existing?.extra_pay ?? "",
      extra_pay_reason: existing?.extra_pay_reason || suggestedReason,
      note: existing?.note || "",
    });
    setErr("");
  }, [open, existing]); // eslint-disable-line

  const hasExtraPay = Number(form.extra_pay) > 0;

  const save = async () => {
    if (Number(form.extra_pay) < 0) { setErr("Extra pay can't be negative."); return; }
    if (hasExtraPay && !form.extra_pay_reason) { setErr("Pick what the extra pay is for."); return; }
    setSaving(true); setErr("");
    try {
      const res = await fetch(`${API}/employees/attendance/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: employee.id, date,
          status: form.status,
          overtime_hours: form.overtime_hours || 0,
          extra_pay: form.extra_pay || 0,
          extra_pay_reason: hasExtraPay ? form.extra_pay_reason : "",
          note: form.note,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Could not save.");
      onSaved(); onClose();
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  };

  const clear = async () => {
    if (!existing) return onClose();
    setSaving(true);
    try {
      await fetch(`${API}/employees/attendance/${existing.id}/`, { method: "DELETE" });
      onSaved(); onClose();
    } finally { setSaving(false); }
  };

  if (!open) return null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 800, fontSize: 16 }}>
        {date}
        <span style={{ fontSize: 12, fontWeight: 500, color: C.gray400, marginLeft: 8 }}>{employee?.full_name}</span>
      </DialogTitle>
      <DialogContent dividers>
        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <label style={S.label}>Attendance</label>
            <TextField select fullWidth size="small" value={form.status}
                       onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
              {ATTENDANCE_STATUSES.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
            </TextField>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={S.label}>Extra hours worked</label>
              <input style={S.inp} type="number" min="0" step="0.5" value={form.overtime_hours}
                     onChange={(e) => setForm((f) => ({ ...f, overtime_hours: e.target.value }))} placeholder="0" />
            </div>
            <div style={{ flex: 1 }}>
              <label style={S.label}>Extra pay (₹)</label>
              <input style={S.inp} type="number" min="0" value={form.extra_pay}
                     onChange={(e) => setForm((f) => ({ ...f, extra_pay: e.target.value }))} placeholder="0" />
            </div>
          </div>
          {(isSunday || isOwnWeekOff) && (
            <div style={{ fontSize: 11.5, color: "#92400E", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, padding: "7px 10px", marginTop: -4 }}>
              {isOwnWeekOff ? `This is ${employee?.full_name}'s weekly off` : "This is a Sunday"} — if they came in,
              enter the agreed Sunday-working amount as extra pay.
            </div>
          )}
          <div>
            <label style={S.label}>Extra pay is for {hasExtraPay && <span style={{ color: C.red }}>*</span>}</label>
            <TextField select fullWidth size="small" value={form.extra_pay_reason} disabled={!hasExtraPay}
                       onChange={(e) => setForm((f) => ({ ...f, extra_pay_reason: e.target.value }))}>
              {EXTRA_PAY_REASONS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
            </TextField>
          </div>
          <div style={{ fontSize: 11.5, color: C.gray400, marginTop: -4 }}>
            Extra pay is mainly for working on a Sunday (or the person's weekly off). It's paid on top
            of the month's salary, shows on the payslip by reason, and counts in salary cost when
            salaries are deducted from profit.
          </div>
          <div>
            <label style={S.label}>Note</label>
            <input style={S.inp} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
          </div>
        </div>
        {err && <div style={{ color: C.red, fontSize: 13, fontWeight: 600, marginTop: 10 }}>{err}</div>}
      </DialogContent>
      <DialogActions>
        {existing && <Button color="inherit" onClick={clear} disabled={saving}>Clear day</Button>}
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
      </DialogActions>
    </Dialog>
  );
}

/** A month grid. Weekly offs and holidays render as non-working; the rest
 *  default to worked, matching how the server reads an empty register. */
function AttendanceCalendar({ month, employee, attendance, holidays, canEdit, onPickDay }) {
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const attByDate = useMemo(() => Object.fromEntries(attendance.map((a) => [a.date, a])), [attendance]);
  const holByDate = useMemo(() => Object.fromEntries(holidays.map((h) => [h.date, h])), [holidays]);

  // Monday-first, matching the weekly-off values.
  const firstCol = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  const cells = [...Array(firstCol).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 4 }}>
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} style={{ fontSize: 10, fontWeight: 700, color: C.gray400, textAlign: "center", textTransform: "uppercase" }}>{d}</div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {cells.map((day, i) => {
          if (day === null) return <div key={`pad-${i}`} />;
          const iso = `${month}-${String(day).padStart(2, "0")}`;
          const holiday = holByDate[iso];
          const isWeekOff = employee?.weekly_off_day !== null && employee?.weekly_off_day !== undefined
            && ((new Date(y, m - 1, day).getDay() + 6) % 7) === Number(employee.weekly_off_day);
          const att = attByDate[iso];

          let bg = C.white, color = C.gray700, mark = "", border = C.gray200;
          if (holiday) {
            bg = "#F5F3FF"; color = "#6D28D9"; mark = "H"; border = "#DDD6FE";
          } else if (isWeekOff) {
            bg = C.gray100; color = C.gray400; mark = "off";
          } else if (att) {
            const meta = statusMeta(att.status);
            if (meta && att.status !== "present") { bg = meta.bg; color = meta.color; mark = meta.short; border = meta.bg; }
          }
          const hasExtra = att && Number(att.extra_pay) > 0;

          return (
            <div
              key={iso}
              onClick={canEdit ? () => onPickDay(iso, att) : undefined}
              title={[
                holiday ? holiday.name : (isWeekOff ? "Weekly off" : ""),
                hasExtra ? `+${fmt0(att.extra_pay)} ${EXTRA_PAY_REASONS.find((r) => r.value === att.extra_pay_reason)?.label || "extra pay"}` : "",
                att?.note || "",
              ].filter(Boolean).join(" · ")}
              style={{
                position: "relative", minHeight: 46, borderRadius: 8, background: bg,
                border: `1px solid ${border}`, padding: "4px 5px", cursor: canEdit ? "pointer" : "default",
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color }}>{day}</div>
              {mark && <div style={{ fontSize: 10, fontWeight: 800, color, marginTop: 1 }}>{mark}</div>}
              {hasExtra && (
                <div style={{ position: "absolute", right: 3, bottom: 2, fontSize: 9, fontWeight: 800, color: C.green }}>
                  +{fmt0(att.extra_pay)}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
        {[{ short: "H", label: "Holiday", color: "#6D28D9" }, { short: "off", label: "Weekly off", color: C.gray400 },
          ...ATTENDANCE_STATUSES.filter((s) => s.value !== "present")].map((s) => (
          <span key={s.label} style={{ fontSize: 10.5, color: C.gray500 }}>
            <b style={{ color: s.color }}>{s.short}</b> {s.label}
          </span>
        ))}
        <span style={{ fontSize: 10.5, color: C.gray400 }}>Unmarked days count as worked.</span>
      </div>
    </div>
  );
}

/** The payslip breakdown — how the month's number was arrived at. */
function PayslipBreakdown({ slip }) {
  if (!slip) return null;
  if (!slip.employed) {
    return <div style={{ color: C.gray400, fontSize: 13, padding: "16px 0" }}>Not employed during {monthLabel(slip.month)}.</div>;
  }
  const Row = ({ label, value, color, bold, note, divider }) => (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "7px 0",
      borderTop: divider ? `1.5px solid ${C.gray200}` : undefined,
    }}>
      <span style={{ fontSize: 12.5, color: bold ? C.gray800 : C.gray500, fontWeight: bold ? 700 : 500 }}>
        {label}
        {note && <span style={{ fontSize: 11, color: C.gray400, marginLeft: 6 }}>{note}</span>}
      </span>
      <span style={{ fontFamily: "monospace", fontWeight: bold ? 800 : 700, fontSize: bold ? 14 : 12.5, color: color || C.gray800 }}>
        {value}
      </span>
    </div>
  );

  return (
    <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 280px" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.gray400, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Days</div>
        <Row label="Days in month" value={slip.days_in_month} />
        <Row label="Days employed" value={slip.eligible_days} note={slip.eligible_days !== slip.days_in_month ? "part month" : ""} />
        <Row label="Worked" value={slip.present_days} color={C.green} />
        <Row label="Weekly offs" value={slip.week_off_days} color={C.gray500} note="paid" />
        <Row label="Holidays" value={slip.holiday_days} color="#6D28D9" note="paid" />
        <Row label="Paid leave" value={`${slip.paid_leave_days}${Number(slip.paid_leave_honoured) < Number(slip.paid_leave_days) ? ` (${slip.paid_leave_honoured} within quota)` : ""}`} color={C.blue} />
        <Row label="Half days" value={slip.half_days} color="#B45309" />
        <Row label="Unpaid leave" value={slip.unpaid_leave_days} color={C.red} />
        <Row label="Absent" value={slip.absent_days} color={C.red} />
        <Row label="Loss of pay" value={`${slip.lop_days} days`} color={C.red} bold divider />
        <Row label="Payable days" value={slip.payable_days} color={C.green} bold />
      </div>

      <div style={{ flex: "1 1 280px" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.gray400, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Money</div>
        <Row label="Monthly salary" value={fmt2(slip.monthly_salary)} />
        <Row label="Day rate" value={fmt2(slip.day_rate)} note={`÷ ${slip.days_in_month} days`} />
        <Row label="Earned salary" value={fmt2(slip.earned_salary)} note={`${slip.payable_days} × day rate`} bold divider />
        <Row label="Extra pay" value={`+ ${fmt2(slip.extra_pay)}`} color={C.green}
             note={[extraPaySummary(slip.extra_pay_breakdown),
                    Number(slip.overtime_hours) > 0 ? `${slip.overtime_hours} extra hrs` : ""].filter(Boolean).join(" · ")
                   || "Sunday / weekly-off working, overtime"} />
        {(slip.extra_pay_breakdown || []).map((b) => (
          <Row key={b.reason || "unspecified"} label={`   ↳ ${b.label}`} value={`+ ${fmt2(b.amount)}`} color={C.green}
               note={`${b.days} day${b.days === 1 ? "" : "s"}`} />
        ))}
        <Row label="Net payable" value={fmt2(slip.net_payable)} color={C.gray800} bold divider />
        <Row label="Already settled" value={`− ${fmt2(slip.settled)}`} color={C.gray500}
             note={Number(slip.advances) > 0 ? `incl. ${fmt2(slip.advances)} advance` : ""} />
        <Row label="Still due" value={fmt2(slip.due)} color={Number(slip.due) > 0 ? C.red : C.green} bold divider />
        {Number(slip.bonus) > 0 && (
          <Row label="Bonus paid separately" value={fmt2(slip.bonus)} color={C.gray400} note="not part of salary" />
        )}
      </div>
    </div>
  );
}

// ── Employee detail: payslip + attendance + payment ledger ──
function EmployeeDetailDialog({ open, employee, canEdit, onClose, onChanged }) {
  const [tab, setTab] = useState(0);
  const [month, setMonth] = useState(lastMonth());
  const [slip, setSlip] = useState(null);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(emptyPayment());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [dayEdit, setDayEdit] = useState(null);

  const load = useCallback(async () => {
    if (!employee) return;
    setLoading(true);
    try {
      const [slipR, payR] = await Promise.all([
        fetch(`${API}/employees/${employee.id}/payroll/?month=${month}`).then((r) => (r.ok ? r.json() : null)),
        fetch(`${API}/employees/${employee.id}/payments/`).then((r) => r.json()),
      ]);
      setSlip(slipR);
      setPayments(payR.results || []);
    } finally { setLoading(false); }
  }, [employee, month]);

  useEffect(() => { if (open) { load(); setErr(""); } }, [open, load]);
  useEffect(() => { if (open) { setTab(0); setMonth(lastMonth()); setForm(emptyPayment()); } }, [open, employee]);

  const recordPayment = async (override) => {
    const body = { ...form, ...(override || {}) };
    const amount = Number(body.amount);
    if (!amount || amount <= 0) return setErr("Enter a valid amount.");
    if (!body.paid_on) return setErr("Date is required.");
    setSaving(true); setErr("");
    try {
      const res = await fetch(`${API}/employees/${employee.id}/payments/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
  const due = Number(slip?.due || 0);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 800, pb: 0 }}>
        {employee.full_name}
        <span style={{ fontSize: 12, fontWeight: 500, color: C.gray400, marginLeft: 10 }}>
          {employee.designation || "—"}{employee.department ? ` · ${employee.department}` : ""}
          {" · "}{fmt0(employee.monthly_salary)}/mo
          {employee.weekly_off_day !== null && employee.weekly_off_day !== undefined
            ? ` · off ${weekdayLabel(employee.weekly_off_day)}` : ""}
        </span>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mt: 1, minHeight: 36 }}>
          <Tab label="Payslip" sx={{ minHeight: 36, fontWeight: 700, fontSize: 12.5 }} />
          <Tab label="Attendance" sx={{ minHeight: 36, fontWeight: 700, fontSize: 12.5 }} />
          <Tab label="Payments" sx={{ minHeight: 36, fontWeight: 700, fontSize: 12.5 }} />
        </Tabs>
      </DialogTitle>
      <DialogContent dividers>
        {tab !== 2 && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
            <MonthPicker value={month} onChange={setMonth} />
            {slip?.employed && (
              <>
                <KpiCard label="Net Payable" value={fmt2(slip.net_payable)} color={C.gray800} />
                <KpiCard label="Still Due" value={fmt2(slip.due)} color={due > 0 ? C.red : C.green}
                         bg={due > 0 ? "#FFF1F2" : "#ECFDF5"} />
              </>
            )}
            {canEdit && due > 0 && (
              <button
                style={{ ...btn("primary", "md"), opacity: saving ? 0.6 : 1, marginLeft: "auto" }}
                disabled={saving}
                onClick={() => recordPayment({ amount: slip.due, salary_month: month, payment_type: "salary", paid_on: todayStr() })}
              >
                {saving ? "Paying…" : `Pay ${fmt2(slip.due)} for ${monthLabel(month)}`}
              </button>
            )}
          </div>
        )}

        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 30 }}><CircularProgress size={26} /></div>
        ) : (
          <>
            {tab === 0 && <PayslipBreakdown slip={slip} />}

            {tab === 1 && (
              <AttendanceCalendar
                month={month}
                employee={employee}
                attendance={slip?.attendance || []}
                holidays={slip?.holidays || []}
                canEdit={canEdit}
                onPickDay={(iso, att) => setDayEdit({ date: iso, existing: att })}
              />
            )}

            {tab === 2 && (
              <>
                {canEdit && (
                  <div style={{ ...S.card, background: C.gray50, marginBottom: 18 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.gray700, marginBottom: 10 }}>Record a payment</div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                      <div>
                        <label style={S.label}>Amount</label>
                        <input style={{ ...S.inp, width: 120 }} type="number" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
                      </div>
                      <div>
                        <label style={S.label}>Paid on</label>
                        <input style={{ ...S.inp, width: 150 }} type="date" value={form.paid_on} onChange={(e) => setForm((f) => ({ ...f, paid_on: e.target.value }))} />
                      </div>
                      <div>
                        <label style={S.label}>Type</label>
                        <TextField select size="small" style={{ width: 150 }} value={form.payment_type} onChange={(e) => setForm((f) => ({ ...f, payment_type: e.target.value }))}>
                          {PAYMENT_TYPE_OPTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
                        </TextField>
                      </div>
                      {/* Only salary and advance settle a month; the rest are money on top. */}
                      {(form.payment_type === "salary" || form.payment_type === "advance") && (
                        <div>
                          <label style={S.label}>For month</label>
                          <TextField select size="small" style={{ width: 170 }} value={form.salary_month}
                                     onChange={(e) => setForm((f) => ({ ...f, salary_month: e.target.value }))}>
                            {recentMonths(12).map((m) => <MenuItem key={m} value={m}>{monthLabel(m)}</MenuItem>)}
                          </TextField>
                        </div>
                      )}
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
                      <button onClick={() => recordPayment()} disabled={saving} style={{ ...btn("primary", "md"), opacity: saving ? 0.6 : 1 }}>
                        {saving ? "Saving…" : "+ Add payment"}
                      </button>
                    </div>
                    <div style={{ fontSize: 11.5, color: C.gray400, marginTop: 8 }}>
                      Salary is paid in arrears — a payment made on the 1st settles the previous month, which is what "For month" defaults to.
                    </div>
                    {err && <div style={{ color: C.red, fontSize: 12, marginTop: 8, fontWeight: 600 }}>{err}</div>}
                  </div>
                )}

                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: C.gray700 }}>Payment history</span>
                  <span style={{ fontSize: 12, color: C.gray400 }}>total {fmt2(totalPaid)}</span>
                </div>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700 }}>Paid on</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>For month</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Type</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Method</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Reference</TableCell>
                      <TableCell sx={{ fontWeight: 700 }} align="right">Amount</TableCell>
                      {canEdit && <TableCell sx={{ width: 44 }} />}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {payments.length === 0 ? (
                      <TableRow><TableCell colSpan={7} align="center" sx={{ color: C.gray400, padding: 3 }}>No payments recorded yet.</TableCell></TableRow>
                    ) : payments.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>{p.paid_on}</TableCell>
                        <TableCell style={{ color: p.salary_month ? C.gray800 : C.gray400 }}>
                          {p.salary_month ? monthLabel(p.salary_month) : "—"}
                        </TableCell>
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
              </>
            )}
          </>
        )}
        {tab !== 2 && err && <div style={{ color: C.red, fontSize: 12, marginTop: 10, fontWeight: 600 }}>{err}</div>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>

      <DayEditorDialog
        open={!!dayEdit}
        employee={employee}
        date={dayEdit?.date}
        existing={dayEdit?.existing}
        onClose={() => setDayEdit(null)}
        onSaved={() => { load(); onChanged(); }}
      />
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
  const [register, setRegister] = useState(null);
  const [holidays, setHolidays] = useState([]);
  const [salaryDue, setSalaryDue] = useState(null);
  const [payrollMonth, setPayrollMonth] = useState(lastMonth());
  const [loading, setLoading] = useState(true);
  const [payingId, setPayingId] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [empDialogOpen, setEmpDialogOpen] = useState(false);
  const [editingEmp, setEditingEmp] = useState(null);
  const [detailEmp, setDetailEmp] = useState(null);
  const [holidayDialogOpen, setHolidayDialogOpen] = useState(false);

  const [ownerDialogOpen, setOwnerDialogOpen] = useState(false);
  const [editingOwner, setEditingOwner] = useState(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (search) qs.set("search", search);
      if (statusFilter) qs.set("status", statusFilter);
      const [empR, ownerR, sumR, dueR] = await Promise.all([
        fetch(`${API}/employees/?${qs}`).then((r) => r.json()),
        fetch(`${API}/owners/`).then((r) => r.json()),
        fetch(`${API}/employees/summary/`).then((r) => r.json()),
        fetch(`${API}/employees/salary-due/`).then((r) => (r.ok ? r.json() : null)),
      ]);
      setEmployees(empR.results || []);
      setOwners(ownerR.results || []);
      setSummary(sumR);
      setSalaryDue(dueR);
    } finally { setLoading(false); }
  }, [search, statusFilter]);

  // The payroll run and holiday list follow the month picker, not the search
  // box, so they reload on their own rather than with the directory.
  const loadPayroll = useCallback(async () => {
    const [regR, holR] = await Promise.all([
      fetch(`${API}/employees/payroll/?month=${payrollMonth}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`${API}/employees/holidays/?month=${payrollMonth}`).then((r) => (r.ok ? r.json() : null)),
    ]);
    setRegister(regR);
    setHolidays(holR?.results || []);
  }, [payrollMonth]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { loadPayroll(); }, [loadPayroll]);

  const refreshEverything = useCallback(() => { loadAll(); loadPayroll(); }, [loadAll, loadPayroll]);

  const payRow = async (row) => {
    setPayingId(row.employee_id);
    try {
      const res = await fetch(`${API}/employees/${row.employee_id}/payments/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: row.due, paid_on: todayStr(), payment_type: "salary",
          salary_month: payrollMonth, method: "cash",
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        alert(d?.error || "Could not record the payment.");
        return;
      }
      refreshEverything();
    } finally { setPayingId(null); }
  };

  const deleteEmployee = async (emp) => {
    if (!window.confirm(`Delete ${emp.full_name}?`)) return;
    const res = await fetch(`${API}/employees/${emp.id}/`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      alert(data?.error || "Could not delete employee.");
      return;
    }
    refreshEverything();
  };

  const deleteOwner = async (owner) => {
    if (!window.confirm(`Delete ${owner.name}?`)) return;
    await fetch(`${API}/owners/${owner.id}/`, { method: "DELETE" });
    loadAll();
  };

  const deleteHoliday = async (h) => {
    if (!window.confirm(`Remove "${h.name}" on ${h.date}?`)) return;
    await fetch(`${API}/employees/holidays/${h.id}/`, { method: "DELETE" });
    refreshEverything();
  };

  const monthlyWageBill = employees
    .filter((e) => e.status === "active")
    .reduce((s, e) => s + Number(e.monthly_salary || 0), 0);
  const totalDue = Number(salaryDue?.total_due || 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {summary && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <KpiCard label="Active Employees" value={summary.active_employees} color={C.blue} />
          <KpiCard label="Monthly Wage Bill" value={fmt0(monthlyWageBill)} color={C.gray800}
                   sub="active employees, at full month" />
          <KpiCard label="Salary Due" value={fmt2(totalDue)} color={totalDue > 0 ? C.red : C.green}
                   bg={totalDue > 0 ? "#FFF1F2" : "#ECFDF5"}
                   sub={totalDue > 0
                     ? `${salaryDue.employee_count} ${salaryDue.employee_count === 1 ? "person" : "people"}, from ${monthLabel(salaryDue.oldest_month)}`
                     : "all closed months settled"} />
          <KpiCard label="Paid This Month" value={fmt2(summary.total_paid_this_month)} color={C.orange} bg="#FFFBEB" />
          <KpiCard label="Paid All Time" value={fmt2(summary.total_paid_all_time)} color={C.green} bg="#ECFDF5" />
        </div>
      )}

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 40 }}><CircularProgress style={{ color: C.orange }} /></div>
      ) : (
        <>
          {/* Payroll run for one month */}
          <SectionShell
            title="Payroll Run"
            actions={<MonthPicker value={payrollMonth} onChange={setPayrollMonth} />}
          >
            <div style={{ padding: "10px 20px", borderBottom: `1px solid ${C.gray100}`, fontSize: 11.5, color: C.gray500, display: "flex", flexDirection: "column", gap: 4 }}>
              <div>
                {register?.is_closed
                  ? `${monthLabel(payrollMonth)} has ended — this is what's owed for it.`
                  : `${monthLabel(payrollMonth)} is still running. These figures are provisional and become payable on the 1st.`}
              </div>
              <div>
                <b style={{ color: C.gray700 }}>Extra Pay</b> is the extra paid for working on a Sunday (or the
                person's weekly off), plus any holiday working or overtime — entered per day from the
                employee's attendance calendar and added on top of the earned salary.
              </div>
              {register && (
                <div style={{
                  alignSelf: "flex-start", marginTop: 2, padding: "4px 10px", borderRadius: 999, fontWeight: 600,
                  background: register.deducted_from_profit ? "#ECFDF5" : C.gray50,
                  border: `1px solid ${register.deducted_from_profit ? "#A7F3D0" : C.gray200}`,
                  color: register.deducted_from_profit ? C.green : C.gray500,
                }}>
                  {register.deducted_from_profit
                    ? "✓ Salaries (incl. extra pay) are deducted from this business's profit"
                    : "Salaries are not deducted from profit — turn it on in Business Profile → Profit calculation"}
                </div>
              )}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr>{["Name", "Salary", "Payable Days", "LOP", "Earned", "Extra Pay", "Net Payable", "Settled", "Due", ""].map((h, i) => (
                    <th key={h || i} style={{ ...S.th, fontSize: 10, whiteSpace: "nowrap", textAlign: i === 0 ? "left" : "right" }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {!register || register.results.length === 0 ? (
                    <tr><td colSpan={10} style={{ ...S.td, textAlign: "center", padding: 30, color: C.gray400 }}>
                      Nobody was on the payroll in {monthLabel(payrollMonth)}.
                    </td></tr>
                  ) : register.results.map((r, idx) => {
                    const rDue = Number(r.due);
                    const emp = employees.find((e) => e.id === r.employee_id);
                    return (
                      <tr key={r.employee_id}
                          style={{ background: idx % 2 === 0 ? C.white : C.gray50, borderBottom: `1px solid ${C.gray100}`, cursor: emp ? "pointer" : "default" }}
                          onClick={() => emp && setDetailEmp(emp)}>
                        <td style={{ ...S.td, fontWeight: 600, color: C.gray800, whiteSpace: "nowrap" }}>
                          {r.employee_name}
                          {r.designation && <span style={{ color: C.gray400, fontWeight: 500 }}> · {r.designation}</span>}
                        </td>
                        <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace" }}>{fmt0(r.monthly_salary)}</td>
                        <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace" }}>
                          {r.payable_days}<span style={{ color: C.gray400 }}>/{r.eligible_days}</span>
                        </td>
                        <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", color: Number(r.lop_days) > 0 ? C.red : C.gray400 }}>
                          {r.lop_days}
                        </td>
                        <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace" }}>{fmt0(r.earned_salary)}</td>
                        <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", color: Number(r.extra_pay) > 0 ? C.green : C.gray400 }}>
                          {Number(r.extra_pay) > 0 ? `+${fmt0(r.extra_pay)}` : "—"}
                          {Number(r.extra_pay) > 0 && r.extra_pay_breakdown?.length > 0 && (
                            <div style={{ fontFamily: "inherit", fontSize: 10, color: C.gray400, whiteSpace: "nowrap" }}>
                              {extraPaySummary(r.extra_pay_breakdown)}
                            </div>
                          )}
                        </td>
                        <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: C.gray800 }}>{fmt0(r.net_payable)}</td>
                        <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", color: C.gray500 }}>{fmt0(r.settled)}</td>
                        <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 800, color: rDue > 0 ? C.red : C.green }}>
                          {fmt0(r.due)}
                        </td>
                        <td style={{ ...S.td, textAlign: "right", whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                          {canEdit && rDue > 0 && (
                            <button style={{ ...btn("primary", "sm"), opacity: payingId === r.employee_id ? 0.6 : 1 }}
                                    disabled={payingId === r.employee_id}
                                    onClick={() => payRow(r)}>
                              {payingId === r.employee_id ? "…" : "Pay"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {register && register.results.length > 0 && (
                  <tfoot>
                    <tr style={{ borderTop: `2px solid ${C.gray200}`, background: C.gray50 }}>
                      <td style={{ ...S.td, fontWeight: 800, color: C.gray800 }}>Total</td>
                      <td colSpan={3} />
                      <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 700 }}>{fmt0(register.totals.earned_salary)}</td>
                      <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: C.green }}>
                        {Number(register.totals.extra_pay) > 0 ? `+${fmt0(register.totals.extra_pay)}` : "—"}
                      </td>
                      <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 800 }}>{fmt0(register.totals.net_payable)}</td>
                      <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: C.gray500 }}>{fmt0(register.totals.settled)}</td>
                      <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 800, color: Number(register.totals.due) > 0 ? C.red : C.green }}>
                        {fmt0(register.totals.due)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </SectionShell>

          {/* Employees */}
          <SectionShell
            title="Employees"
            count={employees.length}
            actions={
              <>
                <input
                  style={{ ...S.inp, width: 200 }}
                  placeholder="Search name, phone, role…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {/* displayEmpty belongs to the inner Select; on TextField it leaks
                    to the DOM and React warns about an unknown attribute. */}
                <TextField select size="small" style={{ width: 130 }} value={statusFilter}
                           onChange={(e) => setStatusFilter(e.target.value)} SelectProps={{ displayEmpty: true }}>
                  <MenuItem value="">All statuses</MenuItem>
                  {STATUS_OPTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
                </TextField>
                {canEdit && (
                  <button onClick={() => { setEditingEmp(null); setEmpDialogOpen(true); }} style={btn("primary", "sm")}>
                    <AddIcon fontSize="small" style={{ verticalAlign: "middle" }} /> Add employee
                  </button>
                )}
              </>
            }
          >
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr>{["Name", "Designation", "Salary", "Weekly Off", "Paid Leave", "Status", "Total Paid", "Last Payment", ""].map((h, i) => (
                    <th key={h || i} style={{ ...S.th, fontSize: 10, whiteSpace: "nowrap" }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {employees.length === 0 ? (
                    <tr><td colSpan={9} style={{ ...S.td, textAlign: "center", padding: 40, color: C.gray400 }}>No employees yet. Click "+ Add employee" to add one.</td></tr>
                  ) : employees.map((emp, idx) => (
                    <tr key={emp.id} style={{ background: idx % 2 === 0 ? C.white : C.gray50, borderBottom: `1px solid ${C.gray100}`, cursor: "pointer" }} onClick={() => setDetailEmp(emp)}>
                      <td style={{ ...S.td, fontWeight: 600, color: C.gray800 }}>
                        <PersonIcon fontSize="inherit" style={{ marginRight: 6, verticalAlign: "middle", color: C.gray400 }} />
                        {emp.full_name}
                      </td>
                      <td style={{ ...S.td, color: C.gray500 }}>{emp.designation || "—"}</td>
                      <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: Number(emp.monthly_salary) > 0 ? C.gray800 : C.gray400 }}>
                        {Number(emp.monthly_salary) > 0 ? `${fmt0(emp.monthly_salary)}/mo` : "not set"}
                      </td>
                      <td style={{ ...S.td, color: C.gray500 }}>{weekdayLabel(emp.weekly_off_day)}</td>
                      <td style={{ ...S.td, textAlign: "right", color: C.gray500 }}>
                        {Number(emp.paid_leave_per_month) > 0 ? `${Number(emp.paid_leave_per_month)} d/mo` : "—"}
                      </td>
                      <td style={S.td}>
                        <Chip size="small" label={emp.status === "active" ? "Active" : "Inactive"}
                          sx={{ background: emp.status === "active" ? "#ECFDF5" : C.gray100, color: emp.status === "active" ? C.green : C.gray500, fontWeight: 700, fontSize: 10 }} />
                      </td>
                      <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: C.gray800 }}>{fmt2(emp.total_paid)}</td>
                      <td style={{ ...S.td, color: C.gray500 }}>{emp.last_payment_date || "—"}</td>
                      <td style={{ ...S.td, whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                        <Tooltip title="Payslip, attendance & payments"><IconButton size="small" onClick={() => setDetailEmp(emp)}><PaymentsIcon fontSize="small" /></IconButton></Tooltip>
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
          </SectionShell>

          {/* Holidays for the payroll month */}
          <SectionShell
            title={`Holidays · ${monthLabel(payrollMonth)}`}
            count={holidays.length}
            actions={canEdit && (
              <button onClick={() => setHolidayDialogOpen(true)} style={btn("secondary", "sm")}>
                <AddIcon fontSize="small" style={{ verticalAlign: "middle" }} /> Add holiday
              </button>
            )}
          >
            <div style={{ padding: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
              {holidays.length === 0 ? (
                <div style={{ color: C.gray400, fontSize: 13 }}>
                  No holidays in {monthLabel(payrollMonth)}. Weekly offs are set per employee and don't need listing here.
                </div>
              ) : holidays.map((h) => (
                <div key={h.id} style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderRadius: 20,
                  background: h.scope === "business" ? "#F5F3FF" : "#FFF7ED",
                  border: `1px solid ${h.scope === "business" ? "#DDD6FE" : "#FED7AA"}`,
                }}>
                  <EventBusyIcon fontSize="small" style={{ color: h.scope === "business" ? "#6D28D9" : "#C2410C" }} />
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.gray800 }}>{h.name}</div>
                    <div style={{ fontSize: 11, color: C.gray500 }}>
                      {h.date} · {h.scope === "business" ? "everyone" : h.employee_name}
                    </div>
                  </div>
                  {canEdit && (
                    <IconButton size="small" onClick={() => deleteHoliday(h)}><DeleteIcon fontSize="small" /></IconButton>
                  )}
                </div>
              ))}
            </div>
          </SectionShell>

          {/* Owners */}
          <SectionShell
            title="Owner Details"
            count={owners.length}
            actions={canEdit && (
              <button onClick={() => { setEditingOwner(null); setOwnerDialogOpen(true); }} style={btn("secondary", "sm")}>
                <AddIcon fontSize="small" style={{ verticalAlign: "middle" }} /> Add owner
              </button>
            )}
          >
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
          </SectionShell>
        </>
      )}

      <EmployeeFormDialog open={empDialogOpen} initial={editingEmp} onClose={() => setEmpDialogOpen(false)} onSaved={refreshEverything} />
      <OwnerFormDialog open={ownerDialogOpen} initial={editingOwner} onClose={() => setOwnerDialogOpen(false)} onSaved={loadAll} />
      <HolidayFormDialog open={holidayDialogOpen} employees={employees} onClose={() => setHolidayDialogOpen(false)} onSaved={refreshEverything} />
      <EmployeeDetailDialog open={!!detailEmp} employee={detailEmp} canEdit={canEdit} onClose={() => setDetailEmp(null)} onChanged={refreshEverything} />
    </div>
  );
}
