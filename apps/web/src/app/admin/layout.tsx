"use client";

import { LayoutDashboard, Settings, Shield } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, ErrorNote, Input } from "@/components/ui";
import { adminSession, api, ApiError } from "@/lib/api";

/** Platform-owner area: checks admin access (signed-in admin email, or the admin key on hosted demos). */
export default function AdminLayout({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"checking" | "ok" | "locked">("checking");
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  const check = async () => {
    try {
      await api("/admin/me");
      setState("ok");
    } catch (e) {
      setState("locked");
      if (e instanceof ApiError && e.status !== 403) setError(e.message);
    }
  };

  useEffect(() => {
    // The admin panel always works across all dealerships, never "as" one.
    adminSession.setActAs("");
    void check();
  }, []);

  const unlock = async (e: React.FormEvent) => {
    e.preventDefault();
    adminSession.setKey(key.trim());
    setError(null);
    try {
      await api("/admin/me");
      setState("ok");
    } catch {
      adminSession.setKey("");
      setError("That admin key is not correct.");
    }
  };

  if (state === "checking") return <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">Loading…</div>;

  if (state === "locked")
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-4 w-4" /> Admin panel
            </CardTitle>
            <CardDescription>For the platform owner only. Enter your admin key, or sign in with an admin email.</CardDescription>
          </CardHeader>
          <CardContent>
            <ErrorNote error={error} />
            <form onSubmit={unlock} className="space-y-3">
              <Input type="password" placeholder="Admin key" value={key} onChange={(e) => setKey(e.target.value)} autoFocus />
              <Button className="w-full" disabled={!key.trim()}>
                Unlock
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b bg-card">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 md:px-8">
          <Link href="/admin" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">AX</div>
            <div>
              <p className="text-sm font-semibold leading-tight">AXO Platform Admin</p>
              <p className="text-xs text-muted-foreground">All businesses</p>
            </div>
          </Link>
          <div className="flex gap-2">
            <Link href="/admin/settings">
              <Button variant="ghost" size="sm">
                <Settings className="h-4 w-4" /> Settings
              </Button>
            </Link>
            <Button variant="ghost" size="sm" onClick={() => (window.location.href = "/dashboard")}>
              <LayoutDashboard className="h-4 w-4" /> My dashboard
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                adminSession.setKey("");
                window.location.reload();
              }}
            >
              Lock
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl p-4 md:p-8">{children}</main>
    </div>
  );
}
