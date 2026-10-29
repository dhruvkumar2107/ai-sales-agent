"use client";

import { ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PLAN_IDS, PLANS, type Call, type Message, type OrgPlatform } from "@axo/shared";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Empty, ErrorNote, Field, Input, PageHeader, Select, Stat, Table, Td, Textarea, Th, Tr } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { formatDateTime, formatDuration, formatINR, formatINR2, humanize, maskPhone } from "@/lib/utils";
import { BusinessProfileCard, ProvisionCard, QuickConnectCard } from "../../business";
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
interface AdminMe {
  messagingProvider: string;
  telephonyProvider: string;
  setup: { whatsappWebhookUrl: string; whatsappVerifyToken: string; twilioVoiceUrl: string };
}

const WA_TEMPLATES = ["post_call_followup", "business_followup", "appointment_request", "order_received", "business_details", "business_location", "testdrive_confirmation", "testdrive_reminder", "service_confirmation", "model_details", "showroom_location", "callback_notice", "booking_update", "review_request"];

export default function DealerAdminPage({ params }: { params: { id: string } }) {
  const { data, error, reload } = useApi<Detail>(`/admin/orgs/${params.id}`, { refreshMs: 30000 });
  const { data: adminMe } = useApi<AdminMe>("/admin/me");
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const patch = async (section: string, body: Record<string, unknown>, path = "", method = "PATCH") => {
    setSaving(section);
    setSaveError(null);
    try {
      await api(`/admin/orgs/${params.id}${path}`, { method, json: body });
      await reload();
      return true;
    } catch (e) {
      setSaveError((e as Error).message);
      return false;
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
        <ArrowLeft className="h-4 w-4" /> All businesses
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
        <Stat label="Minutes" value={`${usage.minutes}/${billing.includedMinutes}`} hint={billing.overageMinutes ? `${billing.overageMinutes} extra minutes` : "used / included"} />
        <Stat label="Calls" value={usage.calls} hint={`${usage.inbound} in · ${usage.outbound} out · ${usage.web} test`} />
        <Stat label="WhatsApp sent" value={usage.messages} hint={`${usage.whatsappChats} chats`} />
        <Stat label="Leads" value={usage.leads} hint={`${usage.hotLeads} hot`} />
        <Stat label="Bookings" value={usage.testDrives + usage.serviceBookings} hint={`${usage.testDrives} test drives · ${usage.serviceBookings} service`} />
        <Stat label="Bill" value={formatINR(billing.revenue)} hint={[`${formatINR(billing.basePrice)} plan`, billing.overage && `${formatINR(billing.overage)} extra`, billing.setupFee && `${formatINR(billing.setupFee)} setup`].filter(Boolean).join(" + ")} />
        <Stat label="Your cost" value={formatINR(billing.cost)} hint={`incl. ${formatINR(billing.paymentFees)} gateway`} />
        <Stat label="Profit" value={formatINR(billing.profit)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {org.business && <BusinessProfileCard business={org.business} saving={saving === "business"} onSave={(b) => void patch("business", { business: b })} />}
        <QuickConnectCard orgId={org.id} callNumber={data.agents.find((a) => a.phoneNumbers.length)?.phoneNumbers[0] ?? ""} whatsappNumber={org.platform.whatsapp.displayNumber} onConnected={() => void reload()} />
        <ProvisionCard orgId={org.id} businessName={org.name} onDone={() => void reload()} />
        <Controls org={org} saving={saving === "controls"} onSave={(b) => void patch("controls", b)} />
        <WhatsappSetup platform={org.platform} token={data.whatsappToken} adminMe={adminMe} saving={saving === "whatsapp"} onSave={(b) => void patch("whatsapp", b)} />
        <CallingSetup
          agents={data.agents}
          platform={org.platform}
          adminMe={adminMe}
          saving={saving === "calling"}
          onSave={async (numbers, callerId) => {
            if (await patch("calling", { agents: numbers }, "/numbers", "PUT")) await patch("calling", { platform: { calling: { callerId } } });
          }}
        />

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
  const [setupFee, setSetupFee] = useState(org.platform.setupFee);
  useEffect(() => {
    setSetupFee(org.platform.setupFee);
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
                  {PLANS[p].label} · {formatINR(PLANS[p].price)} · {PLANS[p].minutes} min
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Custom monthly price (₹)" hint="0 = plan price">
            <Input type="number" min={0} value={price} onChange={(e) => setPrice(Number(e.target.value))} />
          </Field>
        </div>
        <div className="flex items-end gap-3 rounded-md border p-3">
          <Field label="One-time setup fee (₹)" hint={org.platform.setupFeePaidAt ? `Received ${formatDateTime(org.platform.setupFeePaidAt)}` : "0 = waived"} className="flex-1">
            <Input type="number" min={0} value={setupFee} onChange={(e) => setSetupFee(Number(e.target.value))} />
          </Field>
          {org.platform.setupFeePaidAt ? (
            <Button variant="ghost" size="sm" disabled={saving} onClick={() => onSave({ platform: { setupFeePaidAt: "" } })}>
              Mark unpaid
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled={saving || !setupFee} onClick={() => onSave({ platform: { setupFee, setupFeePaidAt: new Date().toISOString() } })}>
              Mark received
            </Button>
          )}
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
          <Button disabled={saving} onClick={() => onSave({ plan, platform: { features, limits, monthlyPrice: price, setupFee } })}>
            {saving ? "Saving…" : "Save controls"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function WhatsappSetup({ platform, token, adminMe, saving, onSave }: { platform: OrgPlatform; token: string; adminMe?: AdminMe; saving: boolean; onSave: (b: Record<string, unknown>) => void }) {
  const [wa, setWa] = useState(platform.whatsapp);
  const [tok, setTok] = useState(token);
  useEffect(() => {
    setWa(platform.whatsapp);
    setTok(token);
  }, [platform, token]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          WhatsApp number
          {!platform.features.whatsapp ? <Badge variant="warm">Turned off</Badge> : platform.whatsapp.phoneNumberId && token ? <Badge variant="success">Live: own number</Badge> : adminMe?.messagingProvider === "meta" ? <Badge variant="success">Live: platform number</Badge> : <Badge variant="secondary">Demo (not sent)</Badge>}
        </CardTitle>
        <CardDescription>Link this dealership&apos;s own WhatsApp Business number. Once the phone number ID and token are saved, their messages go out for real from that number.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {adminMe && (
          <div className="rounded-md bg-muted p-3 text-xs">
            <p className="mb-1 font-medium">In the Meta app: WhatsApp &gt; Configuration &gt; Webhook</p>
            <p>
              Callback URL: <code className="select-all">{adminMe.setup.whatsappWebhookUrl}</code>
            </p>
            <p>
              Verify token: <code className="select-all">{adminMe.setup.whatsappVerifyToken}</code>
            </p>
            <p className="mt-1 text-muted-foreground">Subscribe to the &quot;messages&quot; field. One webhook serves every dealership; replies are matched by phone number ID.</p>
          </div>
        )}
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

function CallingSetup({
  agents,
  platform,
  adminMe,
  saving,
  onSave,
}: {
  agents: Detail["agents"];
  platform: OrgPlatform;
  adminMe?: AdminMe;
  saving: boolean;
  onSave: (numbers: Record<string, string[]>, callerId: string) => Promise<void>;
}) {
  const toText = () => Object.fromEntries(agents.map((a) => [a.id, a.phoneNumbers.join(", ")]));
  const [numbers, setNumbers] = useState<Record<string, string>>(toText);
  const [callerId, setCallerId] = useState(platform.calling.callerId);
  useEffect(() => {
    setNumbers(toText());
    setCallerId(platform.calling.callerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents, platform]);
  const linked = agents.some((a) => a.phoneNumbers.length);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Calling numbers
          {!platform.features.voiceCalls ? <Badge variant="warm">Turned off</Badge> : linked ? <Badge variant="success">Linked</Badge> : <Badge variant="secondary">No number yet</Badge>}
        </CardTitle>
        <CardDescription>Customers who call these numbers reach the AI agent. Buy the number on your {adminMe ? humanize(adminMe.telephonyProvider) : "telephony"} account, then link it here.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!agents.length && <p className="text-sm text-muted-foreground">This dealership has no AI agent yet.</p>}
        {agents.map((a) => (
          <Field key={a.id} label={`${a.name} · ${humanize(a.kind)}${a.active ? "" : " (inactive)"}`} hint="Incoming numbers, comma separated, e.g. +918041234567">
            <Input value={numbers[a.id] ?? ""} onChange={(e) => setNumbers({ ...numbers, [a.id]: e.target.value })} placeholder="+91 80 4123 4567" />
          </Field>
        ))}
        <Field label="Outbound caller number" hint="Shown to customers when the AI calls them. Leave blank for your platform default.">
          <Input value={callerId} onChange={(e) => setCallerId(e.target.value)} placeholder="+91 80 4123 4567" />
        </Field>
        {adminMe?.telephonyProvider === "twilio" && (
          <p className="rounded-md bg-muted p-3 text-xs">
            In Twilio, set each number&apos;s &quot;A call comes in&quot; webhook to <code className="select-all">{adminMe.setup.twilioVoiceUrl}</code> (HTTP POST).
          </p>
        )}
        {adminMe?.telephonyProvider === "exotel" && <p className="rounded-md bg-muted p-3 text-xs">In Exotel, attach these numbers to your AXO call flow (the Voicebot applet).</p>}
        <div className="flex justify-end">
          <Button
            disabled={saving}
            onClick={() =>
              void onSave(
                Object.fromEntries(agents.map((a) => [a.id, (numbers[a.id] ?? "").split(",").map((n) => n.trim()).filter(Boolean)])),
                callerId.trim(),
              )
            }
          >
            {saving ? "Saving…" : "Save numbers"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
