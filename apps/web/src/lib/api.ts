"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AUTH_MODE, firebaseAuth } from "./firebase";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

export async function getToken(): Promise<string> {
  if (AUTH_MODE === "dev") return "dev";
  const user = firebaseAuth().currentUser;
  if (!user) throw new Error("Not signed in");
  return user.getIdToken();
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, ...((init.headers as Record<string, string>) ?? {}) };
  let body = init.body;
  if (init.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`${API_URL}${path}`, { ...init, headers, body });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, err.error ?? res.statusText);
  }
  return (await res.json()) as T;
}

/** Minimal data hook: fetch on mount / when the path changes, with optional polling. */
export function useApi<T>(path: string | null, opts: { refreshMs?: number } = {}) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const pathRef = useRef(path);
  pathRef.current = path;

  const reload = useCallback(async () => {
    if (!pathRef.current) return;
    try {
      const d = await api<T>(pathRef.current);
      setData(d);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(Boolean(path));
    void reload();
    if (!opts.refreshMs) return;
    const t = setInterval(() => void reload(), opts.refreshMs);
    return () => clearInterval(t);
  }, [path, opts.refreshMs, reload]);

  return { data, error, loading, reload, setData };
}

export const wsUrl = (path: string) => API_URL.replace(/^http/, "ws") + path;
