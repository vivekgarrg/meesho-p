import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { getAccessToken, setTokens, clearTokens } from "../lib/authFetch";

const AuthContext = createContext(null);

async function fetchMe() {
  const res = await fetch("/api/auth/me/");
  if (!res.ok) throw new Error("Failed to fetch current user");
  return res.json();
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      if (getAccessToken()) {
        try {
          const me = await fetchMe();
          setUser(me);
        } catch {
          clearTokens();
          setUser(null);
        }
      }
      setLoading(false);
    })();
  }, []);

  const login = useCallback(async (username, password) => {
    const res = await fetch("/api/auth/login/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      let message = "Login failed";
      try {
        const body = await res.json();
        message = body.detail || body.error || message;
      } catch {
        // ignore body parse errors
      }
      throw new Error(message);
    }
    const { access, refresh } = await res.json();
    setTokens({ access, refresh });
    const me = await fetchMe();
    setUser(me);
    return me;
  }, []);

  const logout = useCallback(() => {
    clearTokens();
    setUser(null);
  }, []);

  // Re-fetch the current user (e.g. after an admin creates/edits businesses so
  // the business switcher and permissions reflect the latest state).
  const refreshUser = useCallback(async () => {
    if (!getAccessToken()) return null;
    const me = await fetchMe();
    setUser(me);
    return me;
  }, []);

  const changePassword = useCallback(async (oldPassword, newPassword) => {
    const res = await fetch("/api/auth/change-password/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
    });
    if (!res.ok) {
      let message = "Could not change password";
      try {
        const body = await res.json();
        message = body.old_password || body.new_password || body.detail || message;
      } catch {
        // ignore body parse errors
      }
      throw new Error(message);
    }
    return true;
  }, []);

  const isSuperAdmin = user?.role === "super_admin";

  return (
    <AuthContext.Provider
      value={{
        user, loading, login, logout, refreshUser, changePassword, isSuperAdmin,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
