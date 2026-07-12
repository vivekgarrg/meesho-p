import React, { useEffect, useState, useCallback } from "react";
import { C, S, btn, CHART_COLORS, SectionHeader } from "../../App";
import { useAuth } from "../../contexts/AuthContext";
import { useBusiness } from "../../contexts/BusinessContext";

function hashColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return CHART_COLORS[hash % CHART_COLORS.length];
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
