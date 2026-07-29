import React, { useCallback, useEffect, useMemo, useState } from "react";
import { C, S, btn, SectionHeader, Tag, NAV_GROUPS, ALWAYS_VISIBLE_PATHS } from "../../App";
import { useAuth } from "../../contexts/AuthContext";
import {
  listBusinesses, createBusiness, updateBusiness,
  listMembers, addMember, removeMember,
  listUsers, createUser, updateUser, deleteUser, updateUserBusinesses,
} from "../../lib/adminApi";

// Format an ISO timestamp as a readable local date/time (or a dash when absent).
function fmtDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// Small labelled read-only attribute tile used in the user detail panel.
function AttrTile({ label, children }) {
  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 12px" }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.gray400, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 13, color: C.gray800, fontWeight: 600 }}>{children}</div>
    </div>
  );
}

// ── Expanded per-user details + management panel ────────────────────────────
function UserDetailPanel({ user, businesses, onSaved, notify }) {
  const isAdmin = user.role === "super_admin";
  const [profile, setProfile] = useState({
    email: user.email || "", first_name: user.first_name || "", last_name: user.last_name || "",
  });
  const [bizSel, setBizSel] = useState(new Set(user.business_ids || []));
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingBiz, setSavingBiz] = useState(false);

  useEffect(() => {
    setProfile({ email: user.email || "", first_name: user.first_name || "", last_name: user.last_name || "" });
    setBizSel(new Set(user.business_ids || []));
  }, [user]);

  const toggleBiz = (id) => setBizSel((prev) => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  const profileDirty =
    profile.email !== (user.email || "") ||
    profile.first_name !== (user.first_name || "") ||
    profile.last_name !== (user.last_name || "");

  const bizDirty = (() => {
    const cur = new Set(user.business_ids || []);
    if (cur.size !== bizSel.size) return true;
    for (const id of bizSel) if (!cur.has(id)) return true;
    return false;
  })();

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      await updateUser(user.id, profile);
      notify({ notice: "Profile updated." });
      onSaved();
    } catch (e) { notify({ error: e.message }); }
    finally { setSavingProfile(false); }
  };

  const saveBiz = async () => {
    setSavingBiz(true);
    try {
      await updateUserBusinesses(user.id, [...bizSel]);
      notify({ notice: "Businesses updated." });
      onSaved();
    } catch (e) { notify({ error: e.message }); }
    finally { setSavingBiz(false); }
  };

  const fld = { ...S.inp, fontSize: 13 };

  return (
    <div style={{ background: C.gray50, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, margin: "4px 0 8px" }}>
      {/* Attribute tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 16 }}>
        <AttrTile label="User ID">#{user.id}</AttrTile>
        <AttrTile label="Role"><Tag variant={isAdmin ? "orange" : "blue"}>{user.role}</Tag></AttrTile>
        <AttrTile label="Status"><Tag variant={user.is_active !== false ? "green" : "red"}>{user.is_active !== false ? "Active" : "Suspended"}</Tag></AttrTile>
        <AttrTile label="Joined">{fmtDateTime(user.date_joined)}</AttrTile>
        <AttrTile label="Last sign-in">{user.last_login ? fmtDateTime(user.last_login) : "Never"}</AttrTile>
        <AttrTile label="Businesses">{isAdmin ? "All (admin)" : (user.business_ids || []).length}</AttrTile>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Editable profile */}
        <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: C.gray700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Profile</span>
            <button onClick={saveProfile} disabled={!profileDirty || savingProfile}
              style={{ ...btn("primary", "sm"), opacity: profileDirty ? 1 : 0.45 }}>
              {savingProfile ? "Saving…" : "Save profile"}
            </button>
          </div>
          <label style={{ ...S.label, fontSize: 10 }}>Email</label>
          <input style={{ ...fld, marginBottom: 8 }} type="email" placeholder="email@example.com"
            value={profile.email} onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))} />
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={{ ...S.label, fontSize: 10 }}>First name</label>
              <input style={fld} value={profile.first_name} onChange={(e) => setProfile((p) => ({ ...p, first_name: e.target.value }))} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ ...S.label, fontSize: 10 }}>Last name</label>
              <input style={fld} value={profile.last_name} onChange={(e) => setProfile((p) => ({ ...p, last_name: e.target.value }))} />
            </div>
          </div>
        </div>

        {/* Businesses management */}
        <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: C.gray700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Businesses {!isAdmin && bizSel.size > 0 && <span style={{ color: C.blue }}>· {bizSel.size}</span>}
            </span>
            {!isAdmin && (
              <button onClick={saveBiz} disabled={!bizDirty || savingBiz}
                style={{ ...btn("secondary", "sm"), opacity: bizDirty ? 1 : 0.45 }}>
                {savingBiz ? "Saving…" : "Save businesses"}
              </button>
            )}
          </div>
          {isAdmin ? (
            <p style={{ fontSize: 12, color: C.gray500 }}>Super admins can access <strong>every business</strong> — no assignment needed.</p>
          ) : businesses.length === 0 ? (
            <p style={{ fontSize: 12, color: C.gray400 }}>No businesses exist yet.</p>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, maxHeight: 150, overflowY: "auto" }}>
              {businesses.map((b) => {
                const on = bizSel.has(b.id);
                return (
                  <label key={b.id} style={{
                    display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer",
                    fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 16,
                    border: `1px solid ${on ? C.blue : C.gray200}`,
                    background: on ? C.blueLight : C.white, color: on ? C.blue : C.gray600,
                  }}>
                    <input type="checkbox" checked={on} onChange={() => toggleBiz(b.id)} />
                    {b.name}
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

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
  const [assignBiz, setAssignBiz] = useState(new Set()); // business ids to grant on create
  const [busy, setBusy] = useState(false);
  const [expandedId, setExpandedId] = useState(null); // user row expanded into detail panel

  const toggleAssignBiz = (id) => {
    setAssignBiz((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

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
      const payload = { username: form.username.trim(), password: form.password, role: form.role };
      // Business assignment only applies to business users (admins see all).
      if (form.role === "business_user" && assignBiz.size) {
        payload.business_ids = [...assignBiz];
      }
      await createUser(payload);
      setForm({ username: "", password: "", role: "business_user" });
      setAssignBiz(new Set());
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

  const handleToggleActive = async (u) => {
    const suspend = u.is_active !== false;
    const verb = suspend ? "Suspend" : "Reactivate";
    if (suspend && !window.confirm(
      `Suspend ${u.username}? They will be signed out immediately and cannot log in until reactivated.`
    )) return;
    try {
      await updateUser(u.id, { is_active: !suspend });
      notify({ notice: `${u.username} ${suspend ? "suspended" : "reactivated"}.` });
      await load();
      onChanged();
    } catch (e) { notify({ error: e.message }); }
  };

  return (
    <div style={S.card}>
      <SectionHeader title="Users" count={users.length} />
      <form onSubmit={handleCreate} style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
        </div>

        {/* Assign businesses at creation (business users only — admins see all). */}
        {form.role === "business_user" && (
          <div style={{ marginTop: 10, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px", background: C.gray50 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.gray600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
              Assign businesses to manage {assignBiz.size > 0 && <span style={{ color: C.blue }}>· {assignBiz.size} selected</span>}
            </div>
            {businesses.length === 0 ? (
              <span style={{ fontSize: 12, color: C.gray400 }}>No businesses yet — create one first, or assign later.</span>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {businesses.map((b) => {
                  const on = assignBiz.has(b.id);
                  return (
                    <label key={b.id} style={{
                      display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer",
                      fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 16,
                      border: `1px solid ${on ? C.blue : C.gray200}`,
                      background: on ? C.blueLight : C.white, color: on ? C.blue : C.gray600,
                    }}>
                      <input type="checkbox" checked={on} onChange={() => toggleAssignBiz(b.id)} />
                      {b.name}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </form>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={S.th}>Username</th>
              <th style={S.th}>Role</th>
              <th style={S.th}>Status</th>
              <th style={S.th}>Businesses</th>
              <th style={{ ...S.th, textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const active = u.is_active !== false;
              const isSelf = u.id === currentUserId;
              const expanded = expandedId === u.id;
              return (
              <React.Fragment key={u.id}>
              <tr style={{ opacity: active ? 1 : 0.6, background: expanded ? C.orangeLight : undefined }}>
                <td style={S.td}>
                  <button onClick={() => setExpandedId(expanded ? null : u.id)}
                    style={{ background: "none", border: "none", cursor: "pointer", color: C.gray400, fontSize: 11, marginRight: 6, padding: 0 }}
                    title={expanded ? "Collapse" : "Show details"}>{expanded ? "▼" : "▶"}</button>
                  <strong>{u.username}</strong>
                  {isSelf && <span style={{ marginLeft: 6, fontSize: 10, color: C.gray400 }}>(you)</span>}
                </td>
                <td style={S.td}><Tag variant={u.role === "super_admin" ? "orange" : "blue"}>{u.role}</Tag></td>
                <td style={S.td}><Tag variant={active ? "green" : "red"}>{active ? "Active" : "Suspended"}</Tag></td>
                <td style={S.td}>
                  {u.role === "super_admin"
                    ? <span style={{ fontSize: 12, color: C.gray400 }}>all</span>
                    : (u.business_ids || []).length
                      ? (u.business_ids || []).map((id) => <span key={id} style={{ marginRight: 4 }}><Tag variant="gray">{bizName[id] || `#${id}`}</Tag></span>)
                      : <span style={{ fontSize: 12, color: C.gray400 }}>—</span>}
                </td>
                <td style={{ ...S.td, textAlign: "right", whiteSpace: "nowrap" }}>
                  <button onClick={() => setExpandedId(expanded ? null : u.id)}
                    style={{ ...btn(expanded ? "secondary" : "ghost", "sm"), marginRight: 6 }}>
                    {expanded ? "Close" : "Manage"}
                  </button>
                  <button onClick={() => handleResetPassword(u)} style={{ ...btn("ghost", "sm"), marginRight: 6 }}>Reset PW</button>
                  <button onClick={() => handleToggleRole(u)} style={{ ...btn("ghost", "sm"), marginRight: 6 }}>
                    {u.role === "super_admin" ? "Make user" : "Make admin"}
                  </button>
                  <button onClick={() => handleToggleActive(u)} disabled={isSelf}
                    style={{ ...btn(active ? "ghost" : "success", "sm"), marginRight: 6, opacity: isSelf ? 0.4 : 1 }}
                    title={isSelf ? "You cannot suspend your own account" : undefined}>
                    {active ? "Suspend" : "Activate"}
                  </button>
                  <button onClick={() => handleDelete(u)} disabled={isSelf}
                    style={{ ...btn("danger", "sm"), opacity: isSelf ? 0.4 : 1 }}>Delete</button>
                </td>
              </tr>
              {expanded && (
                <tr>
                  <td colSpan={5} style={{ padding: "0 8px", background: C.white }}>
                    <UserDetailPanel user={u} businesses={businesses}
                      notify={notify}
                      onSaved={async () => { await load(); onChanged(); }} />
                  </td>
                </tr>
              )}
              </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Sidebar tab visibility section ──────────────────────────────────────────
function SidebarTabsSection({ notify }) {
  const { navVisibility, updateNavVisibility, refreshNavVisibility } = useAuth();

  // Flat list of every togglable nav item (skip the always-visible ones — they
  // render as locked rows and are always included in what we save).
  const allPaths = useMemo(
    () => NAV_GROUPS.flatMap((g) => g.items).map((i) => i.path),
    []
  );
  const lockedPaths = useMemo(
    () => allPaths.filter((p) => ALWAYS_VISIBLE_PATHS.includes(p)),
    [allPaths]
  );

  // Build the initial selection: when a config exists use it, otherwise start
  // with everything checked (that mirrors the "all tabs visible" default).
  const buildInitial = useCallback(() => {
    if (navVisibility?.configured) return new Set(navVisibility.visiblePaths || []);
    return new Set(allPaths);
  }, [navVisibility, allPaths]);

  const [selected, setSelected] = useState(buildInitial);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setSelected(buildInitial()); }, [buildInitial]);

  const isLocked = (path) => ALWAYS_VISIBLE_PATHS.includes(path);
  const isChecked = (path) => isLocked(path) || selected.has(path);

  const toggle = (path) => {
    if (isLocked(path)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(allPaths));
  const clearAll = () => setSelected(new Set(lockedPaths));

  const save = async () => {
    // Always persist the locked paths so admins keep access to this screen.
    const paths = [...new Set([...selected, ...lockedPaths])];
    setBusy(true);
    try {
      await updateNavVisibility(paths);
      notify({ notice: "Sidebar tabs updated — this applies to all users." });
    } catch (e) {
      notify({ error: e.message });
    } finally {
      setBusy(false);
    }
  };

  const resetToAll = async () => {
    if (!window.confirm("Show every tab to all users again?")) return;
    setBusy(true);
    try {
      await updateNavVisibility([]); // empty = not configured = show everything
      await refreshNavVisibility();
      notify({ notice: "Reset — all tabs are now visible to everyone." });
    } catch (e) {
      notify({ error: e.message });
    } finally {
      setBusy(false);
    }
  };

  const selectedCount = [...new Set([...selected, ...lockedPaths])].length;

  return (
    <div style={S.card}>
      <SectionHeader
        title="Sidebar Tabs"
        count={`${selectedCount}/${allPaths.length}`}
        actions={
          <>
            <button onClick={selectAll} style={{ ...btn("ghost", "sm"), marginRight: 6 }}>Select all</button>
            <button onClick={clearAll} style={{ ...btn("ghost", "sm"), marginRight: 6 }}>Clear</button>
            <button onClick={save} disabled={busy} style={btn("primary", "sm")}>{busy ? "Saving…" : "Save changes"}</button>
          </>
        }
      />
      <p style={{ fontSize: 12, color: C.gray500, marginBottom: 4 }}>
        Choose which tabs appear in the left sidebar. Your selection is applied to
        <strong> every user</strong> across the whole app.
      </p>
      <p style={{ fontSize: 12, color: C.gray400, marginBottom: 16 }}>
        {navVisibility?.configured
          ? "A custom set is active. "
          : "No custom set yet — all tabs are currently visible. "}
        <button onClick={resetToAll} disabled={busy}
          style={{ ...btn("ghost", "sm"), padding: "3px 10px" }}>Reset (show all)</button>
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 16 }}>
        {NAV_GROUPS.map((group) => (
          <div key={group.label} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: group.color, display: "inline-block" }} />
              <span style={{ fontSize: 11, fontWeight: 800, color: C.gray600, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                {group.label}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {group.items.map((item) => {
                const locked = isLocked(item.path);
                return (
                  <label key={item.path}
                    style={{
                      display: "flex", alignItems: "center", gap: 9,
                      fontSize: 13, color: locked ? C.gray400 : C.gray700,
                      cursor: locked ? "not-allowed" : "pointer",
                      padding: "4px 6px", borderRadius: 7,
                    }}
                    title={locked ? "Always visible to super-admins" : undefined}>
                    <input type="checkbox" checked={isChecked(item.path)} disabled={locked}
                      onChange={() => toggle(item.path)} />
                    <span style={{ fontSize: 14, width: 18, textAlign: "center" }}>{item.icon}</span>
                    <span style={{ flex: 1 }}>{item.label}</span>
                    {locked && <span style={{ fontSize: 10, color: C.gray400 }}>🔒</span>}
                  </label>
                );
              })}
            </div>
          </div>
        ))}
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
          <TabBtn id="sidebar" label="Sidebar Tabs" />
        </div>
      </div>

      <Banner error={msg.error} notice={msg.notice} />

      {tab === "businesses" && (
        <BusinessesSection users={users} onChanged={refreshShared} notify={notify} />
      )}
      {tab === "users" && (
        <UsersSection businesses={businesses} onChanged={refreshShared} notify={notify} currentUserId={user?.id} />
      )}
      {tab === "sidebar" && (
        <SidebarTabsSection notify={notify} />
      )}
    </div>
  );
}
