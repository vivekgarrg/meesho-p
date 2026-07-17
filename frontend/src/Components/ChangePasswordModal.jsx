import React, { useState } from "react";
import { C, S, btn } from "../App";
import { useAuth } from "../contexts/AuthContext";

export default function ChangePasswordModal({ onClose }) {
  const { changePassword } = useAuth();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (newPassword.length < 4) {
      setError("New password must be at least 4 characters.");
      return;
    }
    if (newPassword !== confirm) {
      setError("New password and confirmation do not match.");
      return;
    }
    setSubmitting(true);
    try {
      await changePassword(oldPassword, newPassword);
      setSuccess(true);
    } catch (err) {
      setError(err.message || "Could not change password.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        style={{ ...S.card, width: 380, display: "flex", flexDirection: "column", gap: 14 }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontSize: 16, fontWeight: 800, color: C.gray800 }}>Change Password</h2>
          <button type="button" onClick={onClose} style={{ ...btn("ghost", "sm"), padding: "4px 10px" }}>✕</button>
        </div>

        {success ? (
          <>
            <div style={{ fontSize: 13, color: C.green, background: C.greenLight, border: `1px solid ${C.greenBorder}`, borderRadius: 8, padding: "10px 12px" }}>
              ✓ Password updated successfully.
            </div>
            <button type="button" onClick={onClose} style={btn("primary", "md")}>Done</button>
          </>
        ) : (
          <>
            <div>
              <label style={S.label}>Current password</label>
              <input style={S.inp} type="password" value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)} autoFocus required />
            </div>
            <div>
              <label style={S.label}>New password</label>
              <input style={S.inp} type="password" value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)} required />
            </div>
            <div>
              <label style={S.label}>Confirm new password</label>
              <input style={S.inp} type="password" value={confirm}
                onChange={(e) => setConfirm(e.target.value)} required />
            </div>

            {error && (
              <div style={{ fontSize: 12, color: C.red, background: C.redLight, border: `1px solid ${C.redBorder}`, borderRadius: 8, padding: "8px 12px" }}>
                {error}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" onClick={onClose} style={btn("ghost", "md")}>Cancel</button>
              <button type="submit" disabled={submitting} style={{ ...btn("primary", "md"), opacity: submitting ? 0.7 : 1 }}>
                {submitting ? "Saving…" : "Update password"}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
