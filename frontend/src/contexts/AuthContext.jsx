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

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
