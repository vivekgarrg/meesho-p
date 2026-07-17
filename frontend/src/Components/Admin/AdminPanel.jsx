import React, { useCallback, useEffect, useMemo, useState } from "react";
import { C, S, btn, SectionHeader, Tag } from "../../App";
import { useAuth } from "../../contexts/AuthContext";
import {
  listBusinesses, createBusiness, updateBusiness,
  listMembers, addMember, removeMember,
  listUsers, createUser, updateUser, deleteUser,
} from "../../lib/adminApi";

function Banner({ error, notice }) {
  if (!error && !notice) return null;
  const isErr = !!error;
  return (
    <div style={{
      fontSize: 13, marginBottom: 14, padding: "9px 13px", borderRadius: 8,
      color: isErr ? C.red : C.green,
      background: isErr ? C.redLight : C.greenLight,
      border: `1px solid ${isErr ? C.redBorder : C.greenBorder}`,
    }}>
      {error || notice}
    </div>
  );
}

// ── Businesses section ────────────────────────────────────────────────────
function BusinessesSection({ users, onChanged, notify }) {
  const [businesses, setBusinesses] = useState([]);
  const [newName, setNewName] = useState("");
  const [selected, setSelected] = useState(null);
  const [members, setMembers] = useState([]);
  const [addUserId, setAddUserId] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setBusinesses(await listBusinesses());
    } catch (e) {
      notify({ error: e.message });
    }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const loadMembers = useCallback(async (biz) => {
    setSelected(biz);
    setAddUserId("");
    try {
      setMembers(await listMembers(biz.id));
    } catch (e) {
      notify({ error: e.message });
    }
  }, [notify]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    try {
      await createBusiness(newName.trim());
      setNewName("");
      notify({ notice: "Business created." });
      await load();
      onChanged();
    } catch (e) { notify({ error: e.message }); }
    finally { setBusy(false); }
  };

  const handleRename = async (biz) => {
    const name = window.prompt("Rename business", biz.name);
    if (!name || name.trim() === biz.name) return;
    try {
      await updateBusiness(biz.id, { name: name.trim() });
      notify({ notice: "Business renamed." });
      await load();
      onChanged();
    } catch (e) { notify({ error: e.message }); }
  };

  const handleToggleActive = async (biz) => {
    try {
      await updateBusiness(biz.id, { is_active: !biz.is_active });
      notify({ notice: `Business ${biz.is_active ? "deactivated" : "activated"}.` });
      await load();
      onChanged();
    } catch (e) { notify({ error: e.message }); }
  };

  const handleAddMember = async () => {
    if (!addUserId) return;
    try {
      await addMember(selected.id, Number(addUserId));
      notify({ notice: "Member added." });
      await loadMembers(selected);
      onChanged();
    } catch (e) { notify({ error: e.message }); }
  };

  const handleRemoveMember = async (m) => {
    if (!window.confirm(`Remove ${m.user.username} from ${selected.name}?`)) return;
    try {
      await removeMember(selected.id, m.id);
      notify({ notice: "Member removed." });
      await loadMembers(selected);
      onChanged();
    } catch (e) { notify({ error: e.message }); }
  };

  const memberUserIds = new Set(members.map((m) => m.user.id));
  const assignable = users.filter((u) => !memberUserIds.has(u.id));

  return (
    <div style={{ display: "grid", gridTemplateColumns: selected ? "1fr 1fr" : "1fr", gap: 20 }}>
      <div style={S.card}>
        <SectionHeader title="Businesses" count={businesses.length} />
        <form onSubmit={handleCreate} style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <input style={{ ...S.inp, flex: 1 }} placeholder="New business name"
            value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button type="submit" disabled={busy} style={btn("primary", "md")}>+ Add</button>
        </form>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={S.th}>Name</th>
                <th style={S.th}>Status</th>
                <th style={{ ...S.th, textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {businesses.map((b) => (
                <tr key={b.id}
                  style={{ background: selected?.id === b.id ? C.orangeLight : C.white, cursor: "pointer" }}
                  onClick={() => loadMembers(b)}>
                  <td style={S.td}><strong>{b.name}</strong></td>
                  <td style={S.td}>
                    <Tag variant={b.is_active ? "green" : "gray"}>{b.is_active ? "Active" : "Inactive"}</Tag>
                  </td>
                  <td style={{ ...S.td, textAlign: "right", whiteSpace: "nowrap" }}>
                    <button onClick={(e) => { e.stopPropagation(); handleRename(b); }} style={{ ...btn("ghost", "sm"), marginRight: 6 }}>Rename</button>
                    <button onClick={(e) => { e.stopPropagation(); handleToggleActive(b); }} style={btn(b.is_active ? "danger" : "success", "sm")}>
                      {b.is_active ? "Deactivate" : "Activate"}
                    </button>
                  </td>
                </tr>
              ))}
              {businesses.length === 0 && (
                <tr><td colSpan={3} style={{ ...S.td, textAlign: "center", padding: 30, color: C.gray400 }}>No businesses yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div style={S.card}>
          <SectionHeader title={`Members · ${selected.name}`} count={members.length}
            actions={<button onClick={() => setSelected(null)} style={btn("ghost", "sm")}>Close</button>} />
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <select style={{ ...S.inp, flex: 1 }} value={addUserId} onChange={(e) => setAddUserId(e.target.value)}>
              <option value="">Select user to add…</option>
              {assignable.map((u) => (
                <option key={u.id} value={u.id}>{u.username} ({u.role === "super_admin" ? "admin" : "user"})</option>
              ))}
            </select>
            <button onClick={handleAddMember} disabled={!addUserId} style={btn("secondary", "md")}>Add member</button>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={S.th}>User</th>
                <th style={S.th}>Role</th>
                <th style={{ ...S.th, textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td style={S.td}>{m.user.username}</td>
                  <td style={S.td}><Tag variant={m.user.role === "super_admin" ? "orange" : "blue"}>{m.user.role}</Tag></td>
                  <td style={{ ...S.td, textAlign: "right" }}>
                    <button onClick={() => handleRemoveMember(m)} style={btn("danger", "sm")}>Remove</button>
                  </td>
                </tr>
              ))}
              {members.length === 0 && (
                <tr><td colSpan={3} style={{ ...S.td, textAlign: "center", padding: 20, color: C.gray400 }}>No members</td></tr>
              )}
            </tbody>
          </table>
          <p style={{ fontSize: 11, color: C.gray400, marginTop: 10 }}>
            Super admins can access every business regardless of membership.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Users section ─────────────────────────────────────────────────────────
function UsersSection({ businesses, onChanged, notify, currentUserId }) {
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ username: "", password: "", role: "business_user" });
  const [busy, setBusy] = useState(false);

  const bizName = useMemo(() => {
    const map = {};
    businesses.forEach((b) => { map[b.id] = b.name; });
    return map;
  }, [businesses]);

  const load = useCallback(async () => {
    try { setUsers(await listUsers()); }
    catch (e) { notify({ error: e.message }); }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.username.trim() || !form.password) return;
    setBusy(true);
    try {
      await createUser({ username: form.username.trim(), password: form.password, role: form.role });
      setForm({ username: "", password: "", role: "business_user" });
      notify({ notice: "User created." });
      await load();
      onChanged();
    } catch (e) { notify({ error: e.message }); }
    finally { setBusy(false); }
  };

  const handleResetPassword = async (u) => {
    const pw = window.prompt(`New password for ${u.username} (min 4 chars)`);
    if (!pw) return;
    try {
      await updateUser(u.id, { password: pw });
      notify({ notice: `Password reset for ${u.username}.` });
    } catch (e) { notify({ error: e.message }); }
  };

  const handleToggleRole = async (u) => {
    const newRole = u.role === "super_admin" ? "business_user" : "super_admin";
    if (!window.confirm(`Change ${u.username}'s role to ${newRole}?`)) return;
    try {
      await updateUser(u.id, { role: newRole });
      notify({ notice: "Role updated." });
      await load();
      onChanged();
    } catch (e) { notify({ error: e.message }); }
  };

  const handleDelete = async (u) => {
    if (!window.confirm(`Delete user ${u.username}? This cannot be undone.`)) return;
    try {
      await deleteUser(u.id);
      notify({ notice: "User deleted." });
      await load();
      onChanged();
    } catch (e) { notify({ error: e.message }); }
  };

  return (
    <div style={S.card}>
      <SectionHeader title="Users" count={users.length} />
      <form onSubmit={handleCreate} style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <input style={{ ...S.inp, flex: "1 1 160px" }} placeholder="Username"
          value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} />
        <input style={{ ...S.inp, flex: "1 1 160px" }} type="password" placeholder="Password"
          value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
        <select style={{ ...S.inp, flex: "0 0 160px" }} value={form.role}
          onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
          <option value="business_user">Business user</option>
          <option value="super_admin">Super admin</option>
        </select>
        <button type="submit" disabled={busy} style={btn("primary", "md")}>+ Create user</button>
      </form>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={S.th}>Username</th>
              <th style={S.th}>Role</th>
              <th style={S.th}>Businesses</th>
              <th style={{ ...S.th, textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td style={S.td}>
                  <strong>{u.username}</strong>
                  {u.id === currentUserId && <span style={{ marginLeft: 6, fontSize: 10, color: C.gray400 }}>(you)</span>}
                </td>
                <td style={S.td}><Tag variant={u.role === "super_admin" ? "orange" : "blue"}>{u.role}</Tag></td>
                <td style={S.td}>
                  {u.role === "super_admin"
                    ? <span style={{ fontSize: 12, color: C.gray400 }}>all</span>
                    : (u.business_ids || []).length
                      ? (u.business_ids || []).map((id) => <span key={id} style={{ marginRight: 4 }}><Tag variant="gray">{bizName[id] || `#${id}`}</Tag></span>)
                      : <span style={{ fontSize: 12, color: C.gray400 }}>—</span>}
                </td>
                <td style={{ ...S.td, textAlign: "right", whiteSpace: "nowrap" }}>
                  <button onClick={() => handleResetPassword(u)} style={{ ...btn("ghost", "sm"), marginRight: 6 }}>Reset PW</button>
                  <button onClick={() => handleToggleRole(u)} style={{ ...btn("ghost", "sm"), marginRight: 6 }}>
                    {u.role === "super_admin" ? "Make user" : "Make admin"}
                  </button>
                  <button onClick={() => handleDelete(u)} disabled={u.id === currentUserId}
                    style={{ ...btn("danger", "sm"), opacity: u.id === currentUserId ? 0.4 : 1 }}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Admin panel root ────────────────────────────────────────────────────────
export default function AdminPanel() {
  const { user, isSuperAdmin, refreshUser } = useAuth();
  const [tab, setTab] = useState("businesses");
  const [businesses, setBusinesses] = useState([]);
  const [users, setUsers] = useState([]);
  const [msg, setMsg] = useState({ error: "", notice: "" });

  const notify = useCallback((m) => {
    setMsg({ error: m.error || "", notice: m.notice || "" });
    if (m.notice) setTimeout(() => setMsg((cur) => (cur.notice === m.notice ? { error: "", notice: "" } : cur)), 3000);
  }, []);

  // Shared refresh: keep businesses+users lists (used for cross-references and
  // the switcher) and the auth user (switcher/permissions) in sync.
  const refreshShared = useCallback(async () => {
    try {
      const [bs, us] = await Promise.all([listBusinesses(), listUsers()]);
      setBusinesses(bs);
      setUsers(us);
    } catch {
      // section-level errors already surface via notify
    }
    refreshUser();
  }, [refreshUser]);

  useEffect(() => { refreshShared(); }, [refreshShared]);

  if (!isSuperAdmin) {
    return (
      <div style={{ ...S.card, maxWidth: 480 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: C.gray800, marginBottom: 8 }}>Admin Panel</h2>
        <p style={{ fontSize: 13, color: C.gray500 }}>You need super-admin access to view this page.</p>
      </div>
    );
  }

  const TabBtn = ({ id, label }) => (
    <button onClick={() => setTab(id)}
      style={{ ...btn(tab === id ? "primary" : "ghost", "md") }}>{label}</button>
  );

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: C.gray900 }}>Admin Panel</h1>
        <div style={{ display: "flex", gap: 8, marginLeft: 12 }}>
          <TabBtn id="businesses" label="Businesses & Members" />
          <TabBtn id="users" label="Users" />
        </div>
      </div>

      <Banner error={msg.error} notice={msg.notice} />

      {tab === "businesses" ? (
        <BusinessesSection users={users} onChanged={refreshShared} notify={notify} />
      ) : (
        <UsersSection businesses={businesses} onChanged={refreshShared} notify={notify} currentUserId={user?.id} />
      )}
    </div>
  );
}
