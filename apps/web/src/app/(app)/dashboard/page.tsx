"use client";

import Link from "next/link";
import type { Call, CallbackTask } from "@axo/shared";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Empty, ErrorNote, PageHeader, ScoreBadge, Stat } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { formatDateTime, formatDuration, humanize, maskPhone } from "@/lib/utils";

interface Overview {
  activeCalls: number;
  callsToday: number;
  newLeadsToday: number;
  hotLeads: number;
  testDrivesToday: number;
  serviceToday: number;
  pendingCallbacks: number;
  recentCalls: Omit<Call, "transcript">[];
  callbacks: CallbackTask[];
}

export default function DashboardPage() {
  const { data, error, reload } = useApi<Overview>("/api/overview", { refreshMs: 10000 });

  return (
    <div>
      <PageHeader title="Overview" description="Live activity across your showrooms" actions={<Link href="/console"><Button>Test call</Button></Link>} />
      <ErrorNote error={error} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
        <Stat label="Live calls" value={data?.activeCalls ?? "-"} />
        <Stat label="Calls today" value={data?.callsToday ?? "-"} />
        <Stat label="New leads" value={data?.newLeadsToday ?? "-"} />
        <Stat label="Hot leads" value={data?.hotLeads ?? "-"} />
        <Stat label="Test drives" value={data?.testDrivesToday ?? "-"} hint="today" />
        <Stat label="Service jobs" value={data?.serviceToday ?? "-"} hint="today" />
        <Stat label="Callbacks" value={data?.pendingCallbacks ?? "-"} hint="pending" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent calls</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {!data?.recentCalls.length && <Empty>No calls yet. Try the test console.</Empty>}
            {data?.recentCalls.map((c) => (
              <Link key={c.id} href={`/calls/${c.id}`} className="flex items-center justify-between gap-3 rounded-md border p-3 hover:bg-muted/50">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.extracted?.name ?? maskPhone(c.direction === "outbound" ? c.to : c.from)} · {humanize(c.outcome)}</p>
                  <p className="truncate text-xs text-muted-foreground">{c.summary ?? "In progress…"}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  <ScoreBadge score={c.leadScore} />
                  <span>{formatDuration(c.durationSec)}</span>
                  <span>{formatDateTime(c.startedAt)}</span>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Callbacks due</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {!data?.callbacks.length && <Empty>Nothing pending.</Empty>}
            {data?.callbacks.map((cb) => (
              <div key={cb.id} className="rounded-md border p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{cb.customerName ?? cb.phone}</span>
                  <Badge variant={cb.priority === "instant" ? "hot" : cb.priority === "high" ? "warm" : "secondary"}>{cb.priority}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{cb.reason}</p>
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Due {formatDateTime(cb.dueAt)} · {cb.department}</span>
                  <Button size="sm" variant="outline" onClick={() => void api(`/api/callbacks/${cb.id}`, { method: "PATCH", json: { status: "done" } }).then(reload)}>
                    Done
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
