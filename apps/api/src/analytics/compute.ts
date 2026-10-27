import type { Call, Lead, Member, ServiceBooking, TestDrive } from "@axo/shared";
import { repo } from "../db/repo";

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const istDay = (iso: string) => new Date(new Date(iso).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);

export interface AnalyticsInput {
  calls: Call[];
  leads: Lead[];
  testDrives: TestDrive[];
  serviceBookings: ServiceBooking[];
  members: Member[];
  from: string;
  to: string;
}

/** Pure analytics over a date range (ISO bounds). Kept pure so it is easy to test and to reuse in exports. */
export function computeAnalytics(i: AnalyticsInput) {
  const inRange = (iso?: string) => Boolean(iso && iso >= i.from && iso <= i.to);
  const calls = i.calls.filter((c) => inRange(c.startedAt));
  const leads = i.leads.filter((l) => inRange(l.createdAt));
  const tds = i.testDrives.filter((t) => inRange(t.createdAt));
  const svc = i.serviceBookings.filter((s) => inRange(s.createdAt));

  const conversations = calls.filter((c) => c.transcript.some((t) => t.role === "caller"));
  const enquiries = conversations.filter((c) => c.direction !== "outbound");
  const webLeads = leads.filter((l) => ["facebook", "instagram", "website", "walk_in"].includes(l.source) && l.firstContactedAt);
  const responseMins = webLeads.map((l) => (new Date(l.firstContactedAt!).getTime() - new Date(l.createdAt).getTime()) / 60000);
  const leadIdsWithTd = new Set(i.testDrives.filter((t) => t.leadId).map((t) => t.leadId));
  const leadsWithTd = leads.filter((l) => leadIdsWithTd.has(l.id) || ["test_drive_booked", "negotiation", "won"].includes(l.stage));
  const won = leads.filter((l) => l.stage === "won");
  const wonAfterTd = won.filter((l) => leadIdsWithTd.has(l.id));
  const totalCost = calls.reduce((n, c) => n + (c.cost?.total ?? 0), 0);
  const aiTouched = (l: Lead) => Boolean(l.lastCallId);
  const revenueInfluenced = won.filter(aiTouched).reduce((n, l) => n + (l.revenue ?? 0), 0) + svc.reduce((n, s) => n + (s.revenue ?? 0), 0);
  const latencies = calls.filter((c) => c.avgFirstAudioMs).map((c) => c.avgFirstAudioMs!);

  // Daily series
  const days: string[] = [];
  for (let d = new Date(i.from); d <= new Date(i.to); d = new Date(d.getTime() + 86400_000)) days.push(istDay(d.toISOString()));
  const daily = [...new Set(days)].map((day) => ({
    day,
    calls: calls.filter((c) => istDay(c.startedAt) === day).length,
    leads: leads.filter((l) => istDay(l.createdAt) === day).length,
    testDrives: tds.filter((t) => istDay(t.createdAt) === day).length,
  }));

  const countBy = <T,>(xs: T[], key: (x: T) => string | undefined) => {
    const m = new Map<string, number>();
    for (const x of xs) {
      const k = key(x) ?? "unknown";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  };

  const executives = i.members
    .filter((m) => m.role === "sales_executive")
    .map((m) => {
      const mine = leads.filter((l) => l.assignedTo === m.id);
      const mineWon = mine.filter((l) => l.stage === "won");
      return {
        id: m.id,
        name: m.name,
        leads: mine.length,
        hot: mine.filter((l) => l.score === "hot").length,
        contacted: mine.filter((l) => l.stage !== "new").length,
        testDrives: mine.filter((l) => leadIdsWithTd.has(l.id)).length,
        won: mineWon.length,
        conversion: pct(mineWon.length, mine.length),
        revenue: mineWon.reduce((n, l) => n + (l.revenue ?? 0), 0),
      };
    })
    .sort((a, b) => b.won - a.won || b.leads - a.leads);

  return {
    range: { from: i.from, to: i.to },
    totals: {
      calls: calls.length,
      enquiriesHandled: enquiries.length,
      outboundConnected: conversations.filter((c) => c.direction === "outbound").length,
      leads: leads.length,
      hotLeads: leads.filter((l) => l.score === "hot").length,
      avgLeadResponseMin: responseMins.length ? round(responseMins.reduce((a, b) => a + b, 0) / responseMins.length, 1) : null,
      leadsContactedWithin2Min: responseMins.filter((m) => m <= 2).length,
      testDrivesBooked: tds.length,
      testDrivesCompleted: tds.filter((t) => t.status === "completed").length,
      enquiryToTestDrivePct: pct(leadsWithTd.length, leads.length),
      testDriveToSalePct: pct(wonAfterTd.length, leadsWithTd.length),
      won: won.length,
      missedCallsRecovered: calls.filter((c) => c.missedCallRecovered).length,
      serviceBookings: svc.length,
      revenueInfluenced,
      totalCost: round(totalCost),
      costPerCall: calls.length ? round(totalCost / calls.length) : 0,
      avgFirstAudioMs: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
      transfers: calls.filter((c) => c.outcome === "transferred").length,
    },
    daily,
    outcomes: countBy(calls, (c) => c.outcome),
    languages: countBy(conversations, (c) => c.language),
    sources: countBy(leads, (l) => l.source),
    executives,
  };
}

export async function analyticsFor(orgId: string, from: string, to: string) {
  const r = repo(orgId);
  const [calls, leads, testDrives, serviceBookings, members] = await Promise.all([r.calls.list(), r.leads.list(), r.testDrives.list(), r.serviceBookings.list(), r.members.list()]);
  return computeAnalytics({ calls, leads, testDrives, serviceBookings, members, from, to });
}
