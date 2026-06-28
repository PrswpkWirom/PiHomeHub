import { createContext, useContext, useEffect, useState } from "react";

import { api } from "../api/client";
import type { AuthUser } from "../types/api";

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const nextUser = await api.get<AuthUser>("/api/auth/me");
      setUser(nextUser);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const login = async (username: string, password: string) => {
    const nextUser = await api.post<AuthUser>("/api/auth/login", { username, password });
    setUser(nextUser);
  };

  const logout = async () => {
    await api.post("/api/auth/logout");
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}
