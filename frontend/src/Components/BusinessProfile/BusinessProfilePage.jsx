import React, { useEffect, useState, useCallback } from "react";
import { API, C, S, btn, CHART_COLORS, SectionHeader } from "../../App";
import { useAuth } from "../../contexts/AuthContext";
import { useBusiness } from "../../contexts/BusinessContext";

function hashColor(name) {
  let hash = 0;
  const str = String(name || "");
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return CHART_COLORS[hash % CHART_COLORS.length];
}

// Which profile fields the form exposes, in the order they're shown.
const PROFILE_FIELDS = [
  { key: "legal_name",     label: "Registered / legal name" },
  { key: "gstin",          label: "GSTIN" },
  { key: "pan",            label: "PAN" },
  { key: "supplier_id",    label: "Meesho supplier ID" },
  { key: "contact_person", label: "Contact person" },
  { key: "phone",          label: "Phone" },
  { key: "email",          label: "Email" },
  { key: "address_line1",  label: "Address line 1" },
  { key: "address_line2",  label: "Address line 2" },
  { key: "city",           label: "City" },
  { key: "state",          label: "State" },
  { key: "pincode",        label: "Pincode" },
  { key: "notes",          label: "Notes", type: "textarea" },
];

// Every on/off switch that changes how this business's profit is calculated —
// the one place to find them. Profile flags save with the business; the cost
// flags below save through /cost-settings/.
const PROFIT_FLAGS = [
  {
    key: "deduct_transport_charges",
    title: "Deduct transportation charges from profit",
    help: "When on, the daily transport charges recorded under Expenses are subtracted from this business's net profit for the selected period. Off by default — the charges are always shown either way.",
  },
  {
    key: "deduct_employee_salaries",
    title: "Deduct employee salaries from profit",
    help: "When on, this business's salary cost for the selected period — earned salary from the Payroll Run, plus extra pay (Sunday / weekly-off working, overtime) and bonuses — is subtracted from net profit. A month counts in proportion to how much of it falls in the period. Off by default.",
  },
  {
    key: "deduct_owner_spent",
    title: "Deduct owner spent from profit",
    help: "When on, the money the owner took out of the business — recorded as \"Spent (owner draw)\" payments in the Employees tab — is subtracted from net profit for the selected period. It is never counted as salary. Off by default.",
  },
];

const COST_FLAGS = [
  {
    key: "exchange_uses_two_packets",
    title: "Exchange uses two packets",
    help: "An exchange ships twice, so it consumes two boxes. Turn off if you reuse the customer's original packaging.",
  },
  {
    key: "sale_price_includes_gst",
    title: "Sale price includes GST",
    help: "Meesho's sale figures are GST-inclusive, so the tax is the slice already inside the price. Turn off only if your sale amounts are pre-tax.",
  },
];

/**
 * The ₹ set aside on every order that sells, so the losses that keep turning
 * up are already paid for out of profit. Saved when the box loses focus.
 */
function BufferSetting({ value, canEdit, saving, onSave }) {
  const [draft, setDraft] = useState(value ?? 6);
  useEffect(() => { setDraft(value ?? 6); }, [value]);
  const commit = () => {
    const n = Number(draft);
    if (Number.isFinite(n) && n >= 0 && n !== Number(value)) onSave(n);
    else setDraft(value ?? 6);
  };
  return (
    <div style={{ padding: "12px 14px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.gray50,
      marginTop: 10, opacity: canEdit ? 1 : 0.75, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 260px", minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.gray800 }}>Loss buffer per order</div>
        <div style={{ fontSize: 12, color: C.gray500, marginTop: 3 }}>
          Set aside on every delivered, exchanged or claimed order so losses (damages, rejected claims, odd deductions)
          are covered. Not charged on returns or RTO. A SKU with its own buffer in SKU Pricing uses that instead.
          Set 0 to turn it off.
        </div>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 15, fontWeight: 800, color: C.gray800 }}>
        ₹
        <input type="number" min="0" step="0.5" value={draft} disabled={!canEdit || saving}
          onChange={(e) => setDraft(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          style={{ ...S.inp, width: 90, fontWeight: 800, fontSize: 15 }} />
        <span style={{ fontSize: 12, color: C.gray500, fontWeight: 600 }}>/ order</span>
      </label>
    </div>
  );
}

function initialsOf(name) {
  return (name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

export default function BusinessProfilePage() {
  const { user } = useAuth();
  const { activeBusiness, activeBusinessId } = useBusiness();
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [userId, setUserId] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState("");

  // Business profile — details plus the calculation switches.
  const [profile, setProfile] = useState(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState(null);

  // Cost settings — packaging outcomes and GST/exchange switches (per business).
  const [cost, setCost] = useState(null);
  const loadCost = useCallback(async () => {
    if (!activeBusinessId) return;
    try {
      const res = await fetch(`${API}/cost-settings/`);
      if (res.ok) setCost(await res.json());
    } catch { /* section just stays hidden */ }
  }, [activeBusinessId]);
  useEffect(() => { loadCost(); }, [loadCost]);

  const saveCost = async (patch) => {
    setProfileSaving(true);
    setProfileMsg(null);
    setCost((c) => ({ ...(c || {}), ...patch }));
    try {
      const res = await fetch(`${API}/cost-settings/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setProfileMsg({ type: "error", text: data?.error || "Could not save." });
        loadCost();
        return;
      }
      setCost(data);
      setProfileMsg({ type: "success", text: "Saved." });
    } catch {
      setProfileMsg({ type: "error", text: "Network error while saving." });
      loadCost();
    } finally {
      setProfileSaving(false);
    }
  };

  // Data cache — answers are kept until something is uploaded or edited; this
  // lets the owner force a fresh recompute.
  const [cacheInfo, setCacheInfo] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [cacheMsg, setCacheMsg] = useState(null);
  const loadCacheInfo = useCallback(async () => {
    if (!activeBusinessId) return;
    try {
      const res = await fetch(`${API}/cache/status/`);
      if (res.ok) setCacheInfo(await res.json());
    } catch { /* card just shows no timestamp */ }
  }, [activeBusinessId]);
  useEffect(() => { loadCacheInfo(); }, [loadCacheInfo]);

  const refreshData = async (scope) => {
    setRefreshing(true);
    setCacheMsg(null);
    try {
      const res = await fetch(`${API}/cache/refresh/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setCacheMsg({ type: "error", text: data?.error || "Could not refresh." });
        return;
      }
      setCacheMsg({ type: "success", text: "Refreshed — reloading with fresh data…" });
      // Every screen fetched its numbers earlier; a reload makes all of them
      // ask again rather than leaving stale figures on the open page.
      setTimeout(() => window.location.reload(), 700);
    } catch {
      setCacheMsg({ type: "error", text: "Network error while refreshing." });
    } finally {
      setRefreshing(false);
    }
  };

  const loadProfile = useCallback(async () => {
    if (!activeBusinessId) return;
    try {
      const res = await fetch(`/api/businesses/${activeBusinessId}/`);
      if (!res.ok) return;
      const data = await res.json();
      setProfile(data?.profile ?? {});
    } catch { /* leave the form empty; saving will still work */ }
  }, [activeBusinessId]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  const saveProfile = async (patch) => {
    setProfileSaving(true);
    setProfileMsg(null);
    const next = { ...(profile || {}), ...patch };
    setProfile(next);                       // optimistic, so a toggle feels instant
    try {
      const res = await fetch(`/api/businesses/${activeBusinessId}/`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: next }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setProfileMsg({ type: "error", text: data?.error || "Could not save. Only a super admin can edit a business." });
        loadProfile();                      // roll back to what the server has
        return;
      }
      setProfile(data?.profile ?? next);
      setProfileMsg({ type: "success", text: "Saved." });
    } catch {
      setProfileMsg({ type: "error", text: "Network error while saving." });
      loadProfile();
    } finally {
      setProfileSaving(false);
    }
  };

  const loadMembers = useCallback(async () => {
    if (!activeBusinessId) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/businesses/${activeBusinessId}/memberships/`);
      if (!res.ok) throw new Error("Failed to load members");
      const data = await res.json();
      setMembers(data);
    } catch (err) {
      setError(err.message || "Failed to load members");
    } finally {
      setLoading(false);
    }
  }, [activeBusinessId]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  const handleAssign = async (e) => {
    e.preventDefault();
    if (!userId) return;
    setAssigning(true);
    setAssignError("");
    try {
      const res = await fetch(`/api/businesses/${activeBusinessId}/memberships/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: Number(userId) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || body.error || "Failed to assign user");
      }
      setUserId("");
      await loadMembers();
    } catch (err) {
      setAssignError(err.message || "Failed to assign user");
    } finally {
      setAssigning(false);
    }
  };

  if (!activeBusiness) {
    return <div style={S.card}>No active business selected.</div>;
  }

  const canEdit = user?.role === "super_admin";
  const color = hashColor(activeBusiness.name);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ ...S.card, display: "flex", alignItems: "center", gap: 16 }}>
        <div
          style={{
            width: 56, height: 56, borderRadius: "50%", background: color,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20, fontWeight: 800, color: "#fff", flexShrink: 0,
          }}
        >
          {initialsOf(activeBusiness.name)}
        </div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.gray800 }}>{activeBusiness.name}</div>
          <div style={{ fontSize: 12, color: C.gray400 }}>
            {activeBusiness.is_active ? "Active" : "Inactive"} · Business #{activeBusiness.id}
          </div>
        </div>
      </div>

      {/* ── Calculation settings ───────────────────────────────────────── */}
      <div style={S.card}>
        <SectionHeader title="Profit calculation — all switches" />
        {(() => {
          const FlagRow = ({ checked, onChange, title, help, first }) => (
            <label style={{
              display: "flex", alignItems: "flex-start", gap: 12, cursor: canEdit ? "pointer" : "default",
              padding: "12px 14px", borderRadius: 10, marginTop: first ? 0 : 10,
              border: `1px solid ${checked ? C.greenBorder : C.border}`,
              background: checked ? C.greenLight : C.gray50,
              opacity: canEdit ? 1 : 0.75,
            }}>
              <input
                type="checkbox"
                disabled={!canEdit || profileSaving}
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                style={{ width: 18, height: 18, marginTop: 2, cursor: canEdit ? "pointer" : "default", flexShrink: 0 }}
              />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.gray800 }}>{title}</div>
                <div style={{ fontSize: 12, color: C.gray500, marginTop: 3 }}>{help}</div>
              </div>
            </label>
          );
          return (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.gray400, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 8 }}>
                Deductions from net profit
              </div>
              {PROFIT_FLAGS.map((f, i) => (
                <FlagRow key={f.key} first={i === 0} title={f.title} help={f.help}
                         checked={!!profile?.[f.key]} onChange={(v) => saveProfile({ [f.key]: v })} />
              ))}
              {cost && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.gray400, letterSpacing: "0.07em", textTransform: "uppercase", margin: "18px 0 8px" }}>
                    Packaging & tax
                  </div>
                  <div style={{
                    padding: "12px 14px", borderRadius: 10, border: `1px solid ${C.border}`,
                    background: C.gray50, opacity: canEdit ? 1 : 0.75,
                  }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.gray800 }}>Charge packaging on these order outcomes</div>
                    <div style={{ fontSize: 12, color: C.gray500, margin: "3px 0 10px" }}>
                      A box is used the moment an order is packed. Tick the outcomes whose packaging cost counts against profit.
                    </div>
                    <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                      {(cost.available_statuses || []).map(({ value, label }) => {
                        const on = (cost.packaging_statuses || []).includes(value);
                        return (
                          <label key={value} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: C.gray800, cursor: canEdit ? "pointer" : "default" }}>
                            <input
                              type="checkbox" checked={on} disabled={!canEdit || profileSaving}
                              onChange={(e) => saveCost({
                                packaging_statuses: e.target.checked
                                  ? [...(cost.packaging_statuses || []), value]
                                  : (cost.packaging_statuses || []).filter((x) => x !== value),
                              })}
                            />
                            {label}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                  {COST_FLAGS.map((f) => (
                    <FlagRow key={f.key} title={f.title} help={f.help}
                             checked={!!cost[f.key]} onChange={(v) => saveCost({ [f.key]: v })} />
                  ))}
                  <BufferSetting value={cost.default_buffer_per_order} canEdit={canEdit} saving={profileSaving}
                    onSave={(v) => saveCost({ default_buffer_per_order: v })} />
                </>
              )}
            </>
          );
        })()}
        {!canEdit && (
          <div style={{ fontSize: 12, color: C.gray400, marginTop: 8 }}>
            Only a super admin can change these settings.
          </div>
        )}
        {profileMsg && (
          <div style={{
            marginTop: 10, fontSize: 12, fontWeight: 600,
            color: profileMsg.type === "success" ? C.green : C.red,
          }}>
            {profileMsg.text}
          </div>
        )}
      </div>

      {/* ── Data & cache ───────────────────────────────────────────────── */}
      <div style={S.card}>
        <SectionHeader
          title="Data & speed"
          actions={(
            <button
              onClick={() => refreshData("business")}
              disabled={refreshing}
              style={{ ...btn("primary", "md"), opacity: refreshing ? 0.7 : 1 }}
            >
              {refreshing ? "Refreshing…" : "🔄 Refresh data"}
            </button>
          )}
        />
        <div style={{ fontSize: 13, color: C.gray600, lineHeight: 1.7 }}>
          To keep screens fast, answers are remembered until your data changes. They refresh
          <b> automatically </b>after every upload, order update or edit, and expire on their own
          after {cacheInfo ? Math.round(cacheInfo.ttl_seconds / 60) : 15} minutes. If a number ever looks out of date, press
          <b> Refresh data </b>to recompute everything for this business now.
        </div>
        <div style={{ fontSize: 12, color: C.gray400, marginTop: 8 }}>
          {cacheInfo?.enabled === false
            ? "Caching is switched off on this server."
            : cacheInfo?.last_change
              ? `Data last changed: ${new Date(cacheInfo.last_change * 1000).toLocaleString("en-IN")}`
              : ""}
        </div>
        {user?.role === "super_admin" && (
          <button
            onClick={() => { if (window.confirm("Refresh data for every business?")) refreshData("all"); }}
            disabled={refreshing}
            style={{ ...btn("secondary", "sm"), marginTop: 10, opacity: refreshing ? 0.7 : 1 }}
          >
            Refresh all businesses
          </button>
        )}
        {cacheMsg && (
          <div style={{
            marginTop: 10, fontSize: 12, fontWeight: 600,
            color: cacheMsg.type === "success" ? C.green : C.red,
          }}>
            {cacheMsg.text}
          </div>
        )}
      </div>

      {/* ── Business details ───────────────────────────────────────────── */}
      <div style={S.card}>
        <SectionHeader
          title="Business details"
          actions={canEdit ? (
            <button
              onClick={() => saveProfile({})}
              disabled={profileSaving}
              style={{ ...btn("primary", "md"), opacity: profileSaving ? 0.7 : 1 }}
            >
              {profileSaving ? "Saving…" : "Save details"}
            </button>
          ) : undefined}
        />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 14 }}>
          {PROFILE_FIELDS.map(({ key, label, type }) => (
            <div key={key} style={type === "textarea" ? { gridColumn: "1 / -1" } : undefined}>
              <label style={S.label}>{label}</label>
              {type === "textarea" ? (
                <textarea
                  style={{ ...S.inp, minHeight: 70, resize: "vertical" }}
                  disabled={!canEdit}
                  value={profile?.[key] ?? ""}
                  onChange={(e) => setProfile((prev) => ({ ...(prev || {}), [key]: e.target.value }))}
                />
              ) : (
                <input
                  style={S.inp}
                  disabled={!canEdit}
                  value={profile?.[key] ?? ""}
                  onChange={(e) => setProfile((prev) => ({ ...(prev || {}), [key]: e.target.value }))}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      <div style={S.card}>
        <SectionHeader title="Members" count={members.length} />
        {loading ? (
          <div style={{ color: C.gray400, fontSize: 13 }}>Loading…</div>
        ) : error ? (
          <div style={{ color: C.red, fontSize: 13 }}>{error}</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={S.th}>Username</th>
                  <th style={S.th}>Email</th>
                  <th style={S.th}>Role</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td style={S.td}>{m.user.username}</td>
                    <td style={S.td}>{m.user.email || "—"}</td>
                    <td style={S.td}>{m.user.role}</td>
                  </tr>
                ))}
                {members.length === 0 && (
                  <tr>
                    <td style={S.td} colSpan={3}>No members yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {user?.role === "super_admin" && (
        <div style={S.card}>
          <p style={S.cardTitle}>Assign user to this business</p>
          <form onSubmit={handleAssign} style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
            <div style={{ maxWidth: 200 }}>
              <label style={S.label}>User ID</label>
              <input
                style={S.inp}
                type="number"
                min="1"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                required
              />
            </div>
            <button type="submit" disabled={assigning} style={{ ...btn("primary", "md"), opacity: assigning ? 0.7 : 1 }}>
              {assigning ? "Assigning…" : "Assign"}
            </button>
          </form>
          {assignError && (
            <div style={{ marginTop: 10, fontSize: 12, color: C.red }}>{assignError}</div>
          )}
        </div>
      )}
    </div>
  );
}
