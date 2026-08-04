import React, { useEffect, useState, useCallback } from "react";
import { C, S, btn, CHART_COLORS, SectionHeader } from "../../App";
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
        <SectionHeader title="Profit calculation" />
        <label style={{
          display: "flex", alignItems: "flex-start", gap: 12, cursor: canEdit ? "pointer" : "default",
          padding: "12px 14px", borderRadius: 10,
          border: `1px solid ${profile?.deduct_transport_charges ? C.greenBorder : C.border}`,
          background: profile?.deduct_transport_charges ? C.greenLight : C.gray50,
          opacity: canEdit ? 1 : 0.75,
        }}>
          <input
            type="checkbox"
            disabled={!canEdit || profileSaving}
            checked={!!profile?.deduct_transport_charges}
            onChange={(e) => saveProfile({ deduct_transport_charges: e.target.checked })}
            style={{ width: 18, height: 18, marginTop: 2, cursor: canEdit ? "pointer" : "default", flexShrink: 0 }}
          />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.gray800 }}>
              Deduct transportation charges from profit
            </div>
            <div style={{ fontSize: 12, color: C.gray500, marginTop: 3 }}>
              When on, the daily transport charges recorded under Expenses are subtracted
              from this business's net profit for the selected period. Off by default, and
              set per business — the charges are always shown either way.
            </div>
          </div>
        </label>
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
