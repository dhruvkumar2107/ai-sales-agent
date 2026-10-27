"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import type { Branch, ServiceBooking, TestDrive } from "@axo/shared";
import { Badge, Button, Card, Dialog, ErrorNote, PageHeader, Select, Tabs } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { cn, humanize } from "@/lib/utils";

type Kind = "testdrive" | "service";
type Item = { id: string; start: string; end: string; title: string; sub: string; status: string; raw: TestDrive | ServiceBooking };

const HOURS = Array.from({ length: 13 }, (_, i) => 8 + i); // 08:00 - 20:00
const IST = "Asia/Kolkata";
const istDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: IST });
const istHourFloat = (iso: string) => {
  const [h, m] = new Date(iso).toLocaleTimeString("en-GB", { timeZone: IST, hour: "2-digit", minute: "2-digit" }).split(":").map(Number);
  return h! + m! / 60;
};

function weekStart(offset: number) {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7);
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function CalendarPage() {
  const [kind, setKind] = useState<Kind>("testdrive");
  const [week, setWeek] = useState(0);
  const [branchId, setBranchId] = useState("");
  const [open, setOpen] = useState<Item | null>(null);
  const start = weekStart(week);
  const end = new Date(start.getTime() + 7 * 86400_000);
  const days = Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * 86400_000));
  const range = `from=${start.toISOString()}&to=${end.toISOString()}${branchId ? `&branchId=${branchId}` : ""}`;
  const { data: branches } = useApi<Branch[]>("/api/branches");
  const td = useApi<TestDrive[]>(kind === "testdrive" ? `/api/test-drives?${range}` : null);
  const svc = useApi<ServiceBooking[]>(kind === "service" ? `/api/service-bookings?${range}` : null);

  const items: Item[] = useMemo(
    () =>
      kind === "testdrive"
        ? (td.data ?? []).map((t) => ({ id: t.id, start: t.start, end: t.end, title: t.model, sub: t.customerName, status: t.status, raw: t }))
        : (svc.data ?? []).map((s) => ({ id: s.id, start: s.start, end: s.end, title: s.vehicleNo, sub: `${humanize(s.serviceType)} · ${s.customerName}`, status: s.status, raw: s })),
    [kind, td.data, svc.data],
  );

  const setStatus = async (item: Item, status: string) => {
    const path = kind === "testdrive" ? `/api/test-drives-admin/${item.id}` : `/api/service-bookings-admin/${item.id}`;
    await api(path, { method: "PATCH", json: { status } });
    setOpen(null);
    void (kind === "testdrive" ? td.reload() : svc.reload());
  };

  return (
    <div>
      <PageHeader
        title="Calendar"
        description="Test drives and service appointments by branch (IST)"
        actions={
          <>
            <Tabs value={kind} onChange={setKind} items={[{ value: "testdrive", label: "Test drives" }, { value: "service", label: "Service" }]} />
            <Select className="w-56" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">All branches</option>
              {branches?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </>
        }
      />
      <ErrorNote error={td.error ?? svc.error} />
      <div className="mb-3 flex items-center gap-2">
        <Button variant="outline" size="icon" onClick={() => setWeek(week - 1)} aria-label="Previous week">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={() => setWeek(0)}>
          This week
        </Button>
        <Button variant="outline" size="icon" onClick={() => setWeek(week + 1)} aria-label="Next week">
          <ChevronRight className="h-4 w-4" />
        </Button>
        <span className="text-sm text-muted-foreground">
          {days[0]!.toLocaleDateString("en-IN", { day: "numeric", month: "short" })} – {days[6]!.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
        </span>
      </div>
      <Card className="overflow-x-auto">
        <div className="grid min-w-[900px]" style={{ gridTemplateColumns: "56px repeat(7, 1fr)" }}>
          <div />
          {days.map((d) => (
            <div key={d.toISOString()} className={cn("border-b border-l px-2 py-2 text-center text-xs font-medium", istDate(d) === istDate(new Date()) && "bg-accent text-accent-foreground")}>
              {d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric" })}
            </div>
          ))}
          <div className="relative">
            {HOURS.map((h) => (
              <div key={h} className="h-14 pr-2 text-right text-[11px] text-muted-foreground">
                {String(h).padStart(2, "0")}:00
              </div>
            ))}
          </div>
          {days.map((d) => {
            const dayItems = items.filter((i) => istDate(new Date(i.start)) === istDate(d));
            return (
              <div key={d.toISOString()} className="relative border-l">
                {HOURS.map((h) => (
                  <div key={h} className="h-14 border-b border-dashed" />
                ))}
                {dayItems.map((i) => {
                  const top = (istHourFloat(i.start) - HOURS[0]!) * 56;
                  const height = Math.max(22, (istHourFloat(i.end) - istHourFloat(i.start)) * 56 - 2);
                  return (
                    <button
                      key={i.id}
                      onClick={() => setOpen(i)}
                      className={cn("absolute left-1 right-1 overflow-hidden rounded border-l-4 px-1.5 py-0.5 text-left text-[11px] leading-tight", i.status === "cancelled" || i.status === "no_show" ? "border-muted-foreground bg-muted text-muted-foreground line-through" : kind === "testdrive" ? "border-primary bg-primary/10" : "border-emerald-500 bg-emerald-500/10")}
                      style={{ top, height }}
                    >
                      <span className="font-medium">{i.title}</span> · {i.sub}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </Card>

      {open && (
        <Dialog open onClose={() => setOpen(null)} title={`${open.title} · ${open.sub}`}>
          <div className="space-y-2 text-sm">
            <p>
              {new Date(open.start).toLocaleString("en-IN", { timeZone: IST, dateStyle: "medium", timeStyle: "short" })} · <Badge variant="secondary">{humanize(open.status)}</Badge>
            </p>
            <p className="text-muted-foreground">Phone: {open.raw.phone}</p>
            <div className="flex flex-wrap gap-2 pt-2">
              {(kind === "testdrive" ? ["completed", "no_show", "cancelled"] : ["in_progress", "ready", "delivered", "cancelled"]).map((s) => (
                <Button key={s} size="sm" variant="outline" onClick={() => void setStatus(open, s)}>
                  Mark {humanize(s).toLowerCase()}
                </Button>
              ))}
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
