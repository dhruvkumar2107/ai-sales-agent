"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, ErrorNote, PageHeader, Stat, Table, Tabs, Td, Th, Tr } from "@/components/ui";
import { useApi } from "@/lib/api";
import { formatINR, formatINR2, humanize } from "@/lib/utils";

interface Analytics {
  totals: Record<string, number | null>;
  daily: { day: string; calls: number; leads: number; testDrives: number }[];
  outcomes: { name: string; value: number }[];
  languages: { name: string; value: number }[];
  sources: { name: string; value: number }[];
  executives: { id: string; name: string; leads: number; hot: number; contacted: number; testDrives: number; won: number; conversion: number; revenue: number }[];
}

type Range = "7" | "30" | "90";

// Single-series charts use one hue (the brand primary); axes and grid stay recessive.
const MARK = "hsl(var(--primary))";
const AXIS = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };

function ChartTooltip({ active, payload, label, unit }: { active?: boolean; payload?: { value: number }[]; label?: string; unit: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-card px-3 py-2 text-xs shadow-md">
      <p className="text-muted-foreground">{label}</p>
      <p className="font-medium tabular-nums text-foreground">
        {payload[0]!.value} {unit}
      </p>
    </div>
  );
}

function DailyBar({ data, dataKey, unit }: { data: Analytics["daily"]; dataKey: "calls" | "leads" | "testDrives"; unit: string }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }} barCategoryGap={2}>
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
        <XAxis dataKey="day" tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(d: string) => d.slice(5)} minTickGap={24} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip cursor={{ fill: "hsl(var(--muted))" }} content={<ChartTooltip unit={unit} />} />
        <Bar dataKey={dataKey} fill={MARK} radius={[4, 4, 0, 0]} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function Breakdown({ data, unit }: { data: { name: string; value: number }[]; unit: string }) {
  const rows = data.slice(0, 8).map((d) => ({ ...d, name: humanize(d.name) }));
  return (
    <ResponsiveContainer width="100%" height={Math.max(120, rows.length * 30)}>
      <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 24, bottom: 0, left: 8 }} barCategoryGap={4}>
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis type="category" dataKey="name" width={130} tick={AXIS} tickLine={false} axisLine={false} />
        <Tooltip cursor={{ fill: "hsl(var(--muted))" }} content={<ChartTooltip unit={unit} />} />
        <Bar dataKey="value" fill={MARK} radius={[0, 4, 4, 0]} maxBarSize={16} label={{ position: "right", fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function AnalyticsPage() {
  const [range, setRange] = useState<Range>("30");
  const from = new Date(Date.now() - Number(range) * 86400_000).toISOString();
  const { data, error } = useApi<Analytics>(`/api/analytics?from=${encodeURIComponent(from)}`);
  const t = data?.totals ?? {};
  const v = (k: string) => (t[k] ?? "-") as number | string;

  return (
    <div>
      <PageHeader title="Analytics" description="AI agent impact on enquiries, test drives, sales and service" actions={<Tabs value={range} onChange={setRange} items={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }]} />} />
      <ErrorNote error={error} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
        <Stat label="Enquiries handled" value={v("enquiriesHandled")} />
        <Stat label="Lead response" value={t.avgLeadResponseMin != null ? `${t.avgLeadResponseMin} min` : "-"} hint={`${v("leadsContactedWithin2Min")} within 2 min`} />
        <Stat label="Test drives booked" value={v("testDrivesBooked")} hint={`${v("testDrivesCompleted")} completed`} />
        <Stat label="Enquiry → test drive" value={`${v("enquiryToTestDrivePct")}%`} />
        <Stat label="Test drive → sale" value={`${v("testDriveToSalePct")}%`} />
        <Stat label="Missed calls recovered" value={v("missedCallsRecovered")} />
        <Stat label="Service bookings" value={v("serviceBookings")} />
        <Stat label="Revenue influenced" value={formatINR((t.revenueInfluenced as number) ?? 0)} />
        <Stat label="Hot leads" value={v("hotLeads")} hint={`${v("transfers")} live transfers`} />
        <Stat label="Cost per call" value={formatINR2((t.costPerCall as number) ?? 0)} hint={`${formatINR2((t.totalCost as number) ?? 0)} total`} />
        <Stat label="Avg first audio" value={t.avgFirstAudioMs ? `${t.avgFirstAudioMs} ms` : "-"} hint="target under 1200 ms" />
        <Stat label="Deals won" value={v("won")} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Calls per day</CardTitle>
          </CardHeader>
          <CardContent>{data && <DailyBar data={data.daily} dataKey="calls" unit="calls" />}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>New leads per day</CardTitle>
          </CardHeader>
          <CardContent>{data && <DailyBar data={data.daily} dataKey="leads" unit="leads" />}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Test drives booked per day</CardTitle>
          </CardHeader>
          <CardContent>{data && <DailyBar data={data.daily} dataKey="testDrives" unit="test drives" />}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Call outcomes</CardTitle>
          </CardHeader>
          <CardContent>{data && <Breakdown data={data.outcomes} unit="calls" />}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Lead sources</CardTitle>
          </CardHeader>
          <CardContent>{data && <Breakdown data={data.sources} unit="leads" />}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Conversation languages</CardTitle>
          </CardHeader>
          <CardContent>{data && <Breakdown data={data.languages} unit="calls" />}</CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Sales executive performance</CardTitle>
          <CardDescription>Leads created in this period, by assigned executive</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <thead>
              <tr className="border-b">
                <Th>Executive</Th>
                <Th className="text-right">Leads</Th>
                <Th className="text-right">Hot</Th>
                <Th className="text-right">Contacted</Th>
                <Th className="text-right">Test drives</Th>
                <Th className="text-right">Won</Th>
                <Th className="text-right">Conversion</Th>
                <Th className="text-right">Revenue</Th>
              </tr>
            </thead>
            <tbody>
              {data?.executives.map((e) => (
                <Tr key={e.id}>
                  <Td className="font-medium">{e.name}</Td>
                  <Td className="text-right tabular-nums">{e.leads}</Td>
                  <Td className="text-right tabular-nums">{e.hot}</Td>
                  <Td className="text-right tabular-nums">{e.contacted}</Td>
                  <Td className="text-right tabular-nums">{e.testDrives}</Td>
                  <Td className="text-right tabular-nums">{e.won}</Td>
                  <Td className="text-right tabular-nums">{e.conversion}%</Td>
                  <Td className="text-right tabular-nums">{formatINR(e.revenue)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
