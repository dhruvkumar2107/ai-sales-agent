"use client";

import { ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PLAN_IDS, PLANS, type Call, type Message, type OrgPlatform } from "@axo/shared";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Empty, ErrorNote, Field, Input, PageHeader, Select, Stat, Table, Td, Textarea, Th, Tr } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { formatDateTime, formatDuration, formatINR, formatINR2, humanize, maskPhone } from "@/lib/utils";
import { FEATURE_LABELS, openDealerDashboard, type DealerRow } from "../../shared";

interface Detail extends DealerRow {
  daily: { date: string; calls: number; messages: number }[];
  recentCalls: Omit<Call, "transcript" | "latency">[];
  recentMessages: Message[];
  team: { id: string; name: string; email: string; role: string; invited: boolean }[];
  agents: { id: string; name: string; kind: string; active: boolean; phoneNumbers: string[] }[];
  whatsappToken: string;
}

/** Business-initiated messages that need an approved Meta template outside the 24 h chat window. */
const WA_TEMPLATES = ["post_call_followup", "testdrive_confirmation", "testdrive_reminder", "service_confirmation", "model_details", "showroom_location", "callback_notice", "booking_update", "review_request"];

export default function DealerAdminPage({ params }: { params: { id: string } }) {
  const { data, error, reload } = useApi<Detail>(`/admin/orgs/${params.id}`, { refreshMs: 30000 });
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const patch = async (section: string, body: Record<string, unknown>) => {
    setSaving(section);
    setSaveError(null);
    try {
      await api(`/admin/orgs/${params.id}`, { method: "PATCH", json: body });
      await reload();
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(null);
    }
  };

  if (!data) return <ErrorNote error={error} />;
  const { org, usage, billing } = data;
  const suspended = org.status === "suspended";
  const maxDay = Math.max(1, ...data.daily.map((d) => d.calls + d.messages));

  return (
    <div>
      <Link href="/admin" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> All dealerships
      </Link>
      <PageHeader
        title={org.name}
        description={`${org.showroomName} · joined ${formatDateTime(org.createdAt)}`}
        actions={
          <>
            <Button variant="outline" onClick={() => openDealerDashboard(org.id)}>
              <ExternalLink className="h-4 w-4" /> Open their dashboard
            </Button>
            <Button variant={suspended ? "default" : "destructive"} disabled={saving === "status"} onClick={() => void patch("status", { status: suspended ? "active" : "suspended" })}>
              {suspended ? "Reactivate" : "Suspend"}
            </Button>
          </>
        }
      />
      <ErrorNote error={saveError ?? error} />
      {suspended && <ErrorNote error="Suspended: their dashboard is locked, the AI does not answer or place calls, and no WhatsApp messages are sent." />}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Calls" value={`${usage.calls}/${billing.includedCalls}`} hint={`${usage.inbound} in · ${usage.outbound} out · ${usage.web} test`} />
        <Stat label="Minutes" value={usage.minutes} />
        <Stat label="WhatsApp sent" value={usage.messages} hint={`${usage.whatsappChats} chats`} />
        <Stat label="Leads" value={usage.leads} hint={`${usage.hotLeads} hot`} />
        <Stat label="Bookings" value={usage.testDrives + usage.serviceBookings} hint={`${usage.testDrives} test drives · ${usage.serviceBookings} service`} />
        <Stat label="Bill" value={formatINR(billing.revenue)} hint={billing.overageCalls ? `${formatINR(billing.basePrice)} + ${billing.overageCalls} extra calls` : billing.planLabel} />
        <Stat label="Your cost" value={formatINR(usage.cost)} />
        <Stat label="Profit" value={formatINR(billing.profit)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Controls org={org} saving={saving === "controls"} onSave={(b) => void patch("controls", b)} />
        <WhatsappSetup platform={org.platform} token={data.whatsappToken} saving={saving === "whatsapp"} onSave={(b) => void patch("whatsapp", b)} />

        <Card>
          <CardHeader>
            <CardTitle>Activity this month</CardTitle>
            <CardDescription>Calls and WhatsApp messages per day</CardDescription>
          </CardHeader>
          <CardContent>
            {!data.daily.length ? (
              <Empty>No activity this month.</Empty>
            ) : (
              <div className="space-y-1.5">
                {data.daily.map((d) => (
                  <div key={d.date} className="flex items-center gap-2 text-xs">
                    <span className="w-14 shrink-0 text-muted-foreground">{d.date.slice(5)}</span>
                    <div className="flex h-3 flex-1 overflow-hidden rounded bg-muted">
                      <div className="bg-primary" style={{ width: `${(d.calls / maxDay) * 100}%` }} title={`${d.calls} calls`} />
                      <div className="bg-emerald-500" style={{ width: `${(d.messages / maxDay) * 100}%` }} title={`${d.messages} messages`} />
                    </div>
                    <span className="w-20 shrink-0 text-right tabular-nums">
                      {d.calls} · {d.messages}
                    </span>
                  </div>
                ))}
                <p className="pt-1 text-xs text-muted-foreground">
                  <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-primary" />
                  calls <span className="ml-3 mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-500" />
                  WhatsApp
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <ContactNotes platform={org.platform} saving={saving === "contact"} onSave={(b) => void patch("contact", b)} />

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent calls</CardTitle>
          </CardHeader>
          {!data.recentCalls.length ? (
            <CardContent>
              <Empty>No calls yet.</Empty>
            </CardContent>
          ) : (
            <Table>
              <thead>
                <Tr>
                  <Th>When</Th>
                  <Th>Direction</Th>
                  <Th>Customer</Th>
                  <Th>Outcome</Th>
                  <Th>Duration</Th>
                  <Th>Cost</Th>
                  <Th>Summary</Th>
                </Tr>
              </thead>
              <tbody>
                {data.recentCalls.map((c) => (
                  <Tr key={c.id}>
                    <Td className="whitespace-nowrap text-xs">{formatDateTime(c.startedAt)}</Td>
                    <Td className="text-xs">{humanize(c.direction)}</Td>
                    <Td className="text-xs">{c.extracted?.name || maskPhone(c.direction === "outbound" ? c.to : c.from)}</Td>
                    <Td>
                      <Badge variant="secondary">{humanize(c.outcome)}</Badge>
                    </Td>
                    <Td className="tabular-nums text-xs">{formatDuration(c.durationSec)}</Td>
                    <Td className="tabular-nums text-xs">{formatINR2(c.cost?.total)}</Td>
                    <Td className="max-w-sm truncate text-xs" title={c.summary}>
                      {c.summary}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent WhatsApp & SMS</CardTitle>
          </CardHeader>
          {!data.recentMessages.length ? (
            <CardContent>
              <Empty>No messages yet.</Empty>
            </CardContent>
          ) : (
            <Table>
              <thead>
                <Tr>
                  <Th>When</Th>
                  <Th>To / from</Th>
                  <Th>Type</Th>
                  <Th>Message</Th>
                  <Th>Status</Th>
                </Tr>
              </thead>
              <tbody>
                {data.recentMessages.map((m) => (
                  <Tr key={m.id}>
                    <Td className="whitespace-nowrap text-xs">{formatDateTime(m.createdAt)}</Td>
                    <Td className="whitespace-nowrap text-xs">
                      {m.direction === "in" ? "← " : "→ "}
                      {maskPhone(m.phone)}
                    </Td>
                    <Td className="whitespace-nowrap text-xs">{m.template ? humanize(m.template) : m.direction === "in" ? "Customer" : m.author === "staff" ? "Staff" : "AI reply"}</Td>
                    <Td className="max-w-md truncate text-xs" title={m.body}>
                      {m.body}
                    </Td>
                    <Td>
                      <Badge variant={m.status === "failed" ? "hot" : m.status === "blocked" ? "warm" : m.status === "sent" ? "success" : "secondary"} title={m.error}>
                        {m.status}
                      </Badge>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Team</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {!data.team.length && <p className="text-muted-foreground">No team members.</p>}
            {data.team.map((m) => (
              <div key={m.id} className="flex justify-between gap-2">
                <span>
                  {m.name} <span className="text-xs text-muted-foreground">{m.email}</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {humanize(m.role)}
                  {m.invited && " · invited"}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>AI agents</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {data.agents.map((a) => (
              <div key={a.id} className="flex justify-between gap-2">
                <span>
                  {a.name} <span className="text-xs text-muted-foreground">{humanize(a.kind)}</span>
                </span>
                <span className="text-xs text-muted-foreground">{a.phoneNumbers.join(", ") || "no number yet"}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 rounded-md border p-3">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-primary" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function Controls({ org, saving, onSave }: { org: DealerRow["org"]; saving: boolean; onSave: (b: Record<string, unknown>) => void }) {
  const [plan, setPlan] = useState(org.plan);
  const [features, setFeatures] = useState(org.platform.features);
  const [limits, setLimits] = useState(org.platform.limits);
  const [price, setPrice] = useState(org.platform.monthlyPrice);
  useEffect(() => {
    setPlan(org.plan);
    setFeatures(org.platform.features);
    setLimits(org.platform.limits);
    setPrice(org.platform.monthlyPrice);
  }, [org]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Plan & controls</CardTitle>
        <CardDescription>What this dealership can use. Changes apply immediately.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Plan">
            <Select value={plan} onChange={(e) => setPlan(e.target.value as typeof plan)}>
              {PLAN_IDS.map((p) => (
                <option key={p} value={p}>
                  {PLANS[p].label} · {formatINR(PLANS[p].price)} · {PLANS[p].calls} calls
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Custom monthly price (₹)" hint="0 = plan price">
            <Input type="number" min={0} value={price} onChange={(e) => setPrice(Number(e.target.value))} />
          </Field>
        </div>
        {(Object.keys(FEATURE_LABELS) as (keyof OrgPlatform["features"])[]).map((k) => (
          <Switch key={k} checked={features[k]} onChange={(v) => setFeatures({ ...features, [k]: v })} label={FEATURE_LABELS[k].label} hint={FEATURE_LABELS[k].hint} />
        ))}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Max outbound calls / month" hint="0 = no cap. Customers' incoming calls are always answered.">
            <Input type="number" min={0} value={limits.monthlyCalls} onChange={(e) => setLimits({ ...limits, monthlyCalls: Number(e.target.value) })} />
          </Field>
          <Field label="Max WhatsApp/SMS / month" hint="0 = no cap">
            <Input type="number" min={0} value={limits.monthlyMessages} onChange={(e) => setLimits({ ...limits, monthlyMessages: Number(e.target.value) })} />
          </Field>
        </div>
        <div className="flex justify-end">
          <Button disabled={saving} onClick={() => onSave({ plan, platform: { features, limits, monthlyPrice: price } })}>
            {saving ? "Saving…" : "Save controls"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function WhatsappSetup({ platform, token, saving, onSave }: { platform: OrgPlatform; token: string; saving: boolean; onSave: (b: Record<string, unknown>) => void }) {
  const [wa, setWa] = useState(platform.whatsapp);
  const [tok, setTok] = useState(token);
  useEffect(() => {
    setWa(platform.whatsapp);
    setTok(token);
  }, [platform, token]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>WhatsApp number</CardTitle>
        <CardDescription>Leave blank to use your platform WhatsApp number. Give a dealership its own number from Meta WhatsApp Business.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Display number">
            <Input value={wa.displayNumber} onChange={(e) => setWa({ ...wa, displayNumber: e.target.value })} placeholder="+91 98450 00000" />
          </Field>
          <Field label="Meta phone number ID">
            <Input value={wa.phoneNumberId} onChange={(e) => setWa({ ...wa, phoneNumberId: e.target.value })} placeholder="1234567890" />
          </Field>
        </div>
        <Field label="Meta access token" hint="Stored encrypted; only the last 4 characters are shown">
          <Input type="password" value={tok} onChange={(e) => setTok(e.target.value)} placeholder="EAAG…" />
        </Field>
        <details className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-medium">Approved message templates</summary>
          <p className="mt-2 text-xs text-muted-foreground">
            Meta only allows free-text messages within 24 hours of the customer&apos;s last message. For messages you start (after-call, confirmations, reminders), enter the name of the template Meta approved. Leave blank to send free text.
          </p>
          <div className="mt-3 grid gap-2">
            <Field label="Template language code">
              <Input value={wa.templateLanguage} onChange={(e) => setWa({ ...wa, templateLanguage: e.target.value })} placeholder="en" />
            </Field>
            {WA_TEMPLATES.map((t) => (
              <div key={t} className="flex items-center gap-2">
                <span className="w-44 shrink-0 text-xs">{humanize(t)}</span>
                <Input value={wa.templates[t] ?? ""} onChange={(e) => setWa({ ...wa, templates: { ...wa.templates, [t]: e.target.value } })} placeholder="approved template name" />
              </div>
            ))}
          </div>
        </details>
        <div className="flex justify-end">
          <Button disabled={saving} onClick={() => onSave({ platform: { whatsapp: { ...wa, templates: Object.fromEntries(Object.entries(wa.templates).filter(([, v]) => v)) } }, whatsappToken: tok })}>
            {saving ? "Saving…" : "Save WhatsApp"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ContactNotes({ platform, saving, onSave }: { platform: OrgPlatform; saving: boolean; onSave: (b: Record<string, unknown>) => void }) {
  const [contact, setContact] = useState(platform.contact);
  const [notes, setNotes] = useState(platform.notes);
  useEffect(() => {
    setContact(platform.contact);
    setNotes(platform.notes);
  }, [platform]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Contact & notes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Contact name">
            <Input value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} />
          </Field>
          <Field label="Phone">
            <Input value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} />
          </Field>
          <Field label="Email">
            <Input value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
          </Field>
        </div>
        <Field label="Private notes" hint="Only you see these">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Payment terms, renewal date, contacts…" />
        </Field>
        <div className="flex justify-end">
          <Button disabled={saving} onClick={() => onSave({ platform: { contact, notes } })}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
