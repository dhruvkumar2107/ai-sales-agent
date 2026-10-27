"use client";

import { BarChart3, CalendarDays, Headphones, LayoutDashboard, LogOut, Megaphone, Moon, PhoneCall, Settings, Sun, Users, Wand2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";
import { cn, humanize } from "@/lib/utils";
import { Button } from "./ui";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/calls", label: "Call logs", icon: PhoneCall },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone, roles: ["owner", "sales_manager", "service_advisor"] },
  { href: "/analytics", label: "Analytics", icon: BarChart3, roles: ["owner", "sales_manager"] },
  { href: "/console", label: "Test console", icon: Headphones },
  { href: "/setup", label: "Setup wizard", icon: Wand2, roles: ["owner", "sales_manager"] },
  { href: "/settings", label: "Settings", icon: Settings, roles: ["owner", "sales_manager"] },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { me, loading, signOut } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [dark, setDark] = useState(false);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem("axo-theme");
    } catch {
      /* storage unavailable */
    }
    const isDark = stored ? stored === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    setDark(isDark);
    document.documentElement.classList.toggle("dark", isDark);
  }, []);

  useEffect(() => {
    if (!loading && !me?.orgId) router.replace("/login");
  }, [loading, me, router]);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("axo-theme", next ? "dark" : "light");
    } catch {
      /* ignore */
    }
  };

  if (loading || !me?.orgId) return <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r bg-card md:flex">
        <div className="px-5 py-5">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">AX</div>
            <div>
              <p className="text-sm font-semibold leading-tight">AXO Voice Auto</p>
              <p className="text-xs text-muted-foreground">{me.org?.showroomName}</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 px-3">
          {NAV.filter((n) => !n.roles || (me.role && n.roles.includes(me.role))).map((n) => (
            <Link key={n.href} href={n.href} className={cn("flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground", pathname.startsWith(n.href) && "bg-accent font-medium text-accent-foreground")}>
              <n.icon className="h-4 w-4" />
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="border-t p-3">
          <p className="truncate px-2 text-xs text-muted-foreground">{me.email}</p>
          <p className="px-2 text-xs text-muted-foreground">{humanize(me.role ?? "")}</p>
          <div className="mt-2 flex gap-1">
            <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Toggle theme">
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void signOut().then(() => router.replace("/login"))}>
              <LogOut className="h-4 w-4" /> Sign out
            </Button>
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 overflow-x-auto border-b px-4 py-2 md:hidden">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={cn("whitespace-nowrap rounded-md px-2 py-1 text-xs", pathname.startsWith(n.href) ? "bg-accent text-accent-foreground" : "text-muted-foreground")}>
              {n.label}
            </Link>
          ))}
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
