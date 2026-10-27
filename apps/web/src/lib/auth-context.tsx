"use client";

import { onAuthStateChanged, signOut as fbSignOut, type User } from "firebase/auth";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import { AUTH_MODE, firebaseAuth } from "./firebase";

export interface Me {
  uid: string;
  email: string;
  orgId: string | null;
  role: "owner" | "sales_manager" | "sales_executive" | "service_advisor" | null;
  org: { id: string; name: string; showroomName: string; brands: string[] } | null;
}

interface AuthState {
  user: User | null;
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState>({ user: null, me: null, loading: true, refresh: async () => {}, signOut: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      setMe(await api<Me>("/api/me"));
    } catch {
      setMe(null);
    }
  };

  useEffect(() => {
    if (AUTH_MODE === "dev") {
      void refresh().finally(() => setLoading(false));
      return;
    }
    return onAuthStateChanged(firebaseAuth(), async (u) => {
      setUser(u);
      if (u) await refresh();
      else setMe(null);
      setLoading(false);
    });
  }, []);

  const signOut = async () => {
    if (AUTH_MODE !== "dev") await fbSignOut(firebaseAuth());
    setMe(null);
  };

  return <Ctx.Provider value={{ user, me, loading, refresh, signOut }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
