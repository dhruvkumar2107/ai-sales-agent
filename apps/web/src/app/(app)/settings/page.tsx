"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import { ROLES, type Member, type OrgSettings } from "@axo/shared";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, ErrorNote, Field, Input, PageHeader, Select, Table, Tabs, Td, Th, Tr } from "@/components/ui";
import { API_URL, api, useApi } from "@/lib/api";
import { cn, formatINR, humanize } from "@/lib/utils";

type Tab = "keys" | "webhooks" | "team" | "compliance" | "billing";

const SECRET_KEYS = [
  ["anthropic", "Anthropic API key"],
  ["deepgram", "Deepgram API key"],
  ["sarvam", "Sarvam API key"],
  ["elevenlabs", "ElevenLabs API key"],
  ["twilio_auth_token", "Twilio auth token"],
  ["exotel_api_token", "Exotel API token"],
] as const;

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("keys");
  return (
    <div>
      <PageHeader title="Settings" description="Provider keys, numbers, webhooks, team and compliance" />
      <div className="mb-6">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: "keys", label: "API keys" },
            { value: "webhooks", label: "Webhooks" },
            { value: "team", label: "Team" },
            { value: "compliance", label: "Compliance" },
            { value: "billing", label: "Billing" },
          ]}
        />
      </div>
      {tab === "keys" && <KeysTab />}
      {tab === "webhooks" && <WebhooksTab />}
      {tab === "team" && <TeamTab />}
      {tab === "compliance" && <ComplianceTab />}
      {tab === "billing" && <BillingTab />}
    </div>
  );
}

function useSettings() {
  const s = useApi<OrgSettings>("/api/settings");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const save = async (patch: Partial<OrgSettings> | Record<string, unknown>) => {
    setErr(null);
    try {
      await api("/api/settings", { method: "PATCH", json: patch });
      setMsg("Saved");
      setTimeout(() => setMsg(null), 3000);
      await s.reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return { ...s, save, msg, err };
}

function KeysTab() {
  const { data, save, msg, err } = useSettings();
  const [vals, setVals] = useState<Record<string, string>>({});
  return (
    <Card>
      <CardHeader>
        <CardTitle>Provider API keys</CardTitle>
        <CardDescription>
          Keys are encrypted with AES-256-GCM before storage and never shown again, only the last four characters. Server-wide keys in the API's .env are used when a dealership key is not set. Providers are selected with TELEPHONY_PROVIDER, STT_PROVIDER, TTS_PROVIDER and LLM_PROVIDER.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ErrorNote error={err} />
        {SECRET_KEYS.map(([k, label]) => (
          <div key={k} className="grid items-center gap-3 md:grid-cols-3">
            <span className="text-sm">{label}</span>
            <Input type="password" placeholder={data?.secrets[k] || "Not set"} value={vals[k] ?? ""} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} autoComplete="off" />
            <span className="text-xs text-muted-foreground">{data?.secrets[k] ? `Stored (${data.secrets[k]})` : "Using server default"}</span>
          </div>
        ))}
        <div className="flex items-center gap-3">
          <Button onClick={() => void save({ secrets: Object.fromEntries(Object.entries(vals).filter(([, v]) => v)) }).then(() => setVals({}))}>Save keys</Button>
          {msg && <span className="text-sm text-emerald-600">{msg}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function WebhooksTab() {
  const { data, save, msg, err } = useSettings();
  const [f, setF] = useState<Record<string, string>>({});
  if (!data) return null;
  const v = (k: keyof OrgSettings["webhooks"]) => f[k] ?? data.webhooks[k];
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Dealer DMS / CRM adapter</CardTitle>
          <CardDescription>Generic REST: GET /job-cards?vehicle_no=, GET /bookings?phone=, POST /events (signed with X-AXO-Signature).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ErrorNote error={err} />
          <Field label="Base URL">
            <Input value={v("dmsBaseUrl")} onChange={(e) => setF({ ...f, dmsBaseUrl: e.target.value })} placeholder="https://dms.example.com/api" />
          </Field>
          <Field label="Authorization header" hint="e.g. Bearer abc123 (stored encrypted)">
            <Input type="password" value={v("dmsAuthHeader")} onChange={(e) => setF({ ...f, dmsAuthHeader: e.target.value })} />
          </Field>
          <Field label="Google Calendar ID" hint="Share the calendar with the service account in GOOGLE_CALENDAR_SA_EMAIL">
            <Input value={data.googleCalendarId} onChange={(e) => void save({ googleCalendarId: e.target.value })} />
          </Field>
          <div className="flex items-center gap-3">
            <Button onClick={() => void save({ webhooks: { ...data.webhooks, ...f } })}>Save</Button>
            {msg && <span className="text-sm text-emerald-600">{msg}</span>}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>New-lead webhook</CardTitle>
          <CardDescription>Point Facebook/Instagram lead ads (via Zapier/Make), your website form or walk-in app here. The agent calls the lead within 2 minutes.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Field label="Endpoint">
            <Input readOnly value={`${API_URL}/webhooks/leads/${data.orgId}`} />
          </Field>
          <Field label="Signing secret" hint="Send header X-AXO-Signature: hex HMAC-SHA256(secret, raw body)">
            <Input type="password" value={v("leadIntakeSecret")} onChange={(e) => setF({ ...f, leadIntakeSecret: e.target.value })} placeholder="Set a long random secret" />
          </Field>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{`POST /webhooks/leads/${data.orgId}
{ "name": "Rahul", "phone": "9845012345",
  "source": "facebook", "interestedModel": "Creta",
  "city": "Bengaluru" }`}</pre>
          <Button onClick={() => void save({ webhooks: { ...data.webhooks, ...f } })}>Save secret</Button>
        </CardContent>
      </Card>
    </div>
  );
}

function TeamTab() {
  const { data, reload } = useApi<Member[]>("/api/team");
  const [f, setF] = useState({ name: "", email: "", role: "sales_executive", phone: "" });
  const [err, setErr] = useState<string | null>(null);
  const invite = async () => {
    setErr(null);
    try {
      await api("/api/team", { method: "POST", json: { ...f, departments: f.role === "service_advisor" ? ["service"] : ["sales"] } });
      setF({ name: "", email: "", role: "sales_executive", phone: "" });
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Team</CardTitle>
        <CardDescription>Invited members join this dealership when they first sign in with that email. Phone numbers are used for live transfers.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ErrorNote error={err} />
        <div className="grid gap-2 md:grid-cols-5">
          <Input placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Input placeholder="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <Input placeholder="Mobile (+91…)" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {humanize(r)}
              </option>
            ))}
          </Select>
          <Button disabled={!f.email || !f.name} onClick={() => void invite()}>
            Invite
          </Button>
        </div>
        <Table>
          <thead>
            <tr className="border-b">
              <Th>Name</Th>
              <Th>Role</Th>
              <Th>Phone</Th>
              <Th>Departments</Th>
              <Th>Available</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {data?.map((m) => (
              <Tr key={m.id}>
                <Td>
                  <p className="font-medium">{m.name}</p>
                  <p className="text-xs text-muted-foreground">{m.email}</p>
                </Td>
                <Td>
                  {humanize(m.role)} {m.id.startsWith("invite:") && <Badge variant="secondary">invited</Badge>}
                </Td>
                <Td className="text-xs">{m.phone ?? "-"}</Td>
                <Td className="text-xs">{m.departments.join(", ")}</Td>
                <Td>
                  <button onClick={() => void api(`/api/team/${encodeURIComponent(m.id)}`, { method: "PATCH", json: { available: !m.available } }).then(reload)}>
                    <Badge variant={m.available ? "success" : "secondary"}>{m.available ? "Available" : "Away"}</Badge>
                  </button>
                </Td>
                <Td>
                  <Button size="icon" variant="ghost" aria-label="Remove member" onClick={() => void api(`/api/team/${encodeURIComponent(m.id)}`, { method: "DELETE" }).then(reload)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </CardContent>
    </Card>
  );
}

function ComplianceTab() {
  const { data, save, msg, err } = useSettings();
  const [dnd, setDnd] = useState("");
  const [dndMsg, setDndMsg] = useState<string | null>(null);
  if (!data) return null;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Recording & retention (DPDP Act)</CardTitle>
          <CardDescription>Every call opens with the recording disclosure. Recordings are encrypted at rest and deleted after the retention period.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ErrorNote error={err} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={data.recordCalls} onChange={(e) => void save({ recordCalls: e.target.checked })} /> Record calls (consent flag stored per call)
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Keep recordings (days)" hint="0 = don't store">
              <Input type="number" defaultValue={data.retentionDays.recordings} onBlur={(e) => void save({ retentionDays: { ...data.retentionDays, recordings: Number(e.target.value) } })} />
            </Field>
            <Field label="Keep transcripts (days)">
              <Input type="number" defaultValue={data.retentionDays.transcripts} onBlur={(e) => void save({ retentionDays: { ...data.retentionDays, transcripts: Number(e.target.value) } })} />
            </Field>
          </div>
          {msg && <span className="text-sm text-emerald-600">{msg}</span>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>DND / NDNC</CardTitle>
          <CardDescription>
            Outbound calls run only between {data.callingHours.start} and {data.callingHours.end} IST. Opt-outs requested on a call apply instantly. Paste numbers from your operator's DND scrub to block promotional calls.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <textarea className={cn("min-h-[120px] w-full rounded-md border bg-background p-2 font-mono text-xs")} placeholder="One number per line" value={dnd} onChange={(e) => setDnd(e.target.value)} />
          <Button
            variant="outline"
            disabled={!dnd.trim()}
            onClick={() =>
              void api<{ imported: number }>("/api/compliance/dnd", { method: "POST", json: { numbers: dnd.split(/\s+/).filter(Boolean) } }).then((r) => {
                setDndMsg(`Imported ${r.imported} numbers`);
                setDnd("");
              })
            }
          >
            Import DND list
          </Button>
          {dndMsg && <p className="text-sm text-emerald-600">{dndMsg}</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function BillingTab() {
  const { data } = useApi<{ month: string; calls: number; minutes: number; usageCostInr: number; plan: string }>("/api/billing");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Billing</CardTitle>
        <CardDescription>Placeholder: plan management and invoices will appear here.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-4">
        <div>
          <p className="text-xs text-muted-foreground">Plan</p>
          <p className="text-lg font-semibold capitalize">{data?.plan ?? "-"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Calls ({data?.month})</p>
          <p className="text-lg font-semibold">{data?.calls ?? "-"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Minutes</p>
          <p className="text-lg font-semibold">{data?.minutes ?? "-"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Provider usage cost</p>
          <p className="text-lg font-semibold">{formatINR(data?.usageCostInr)}</p>
        </div>
      </CardContent>
    </Card>
  );
}
