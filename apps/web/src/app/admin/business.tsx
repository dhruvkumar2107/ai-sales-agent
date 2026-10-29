"use client";

import { CheckCircle2, CircleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { BUSINESS_ACTION_INFO, BUSINESS_ACTIONS, BUSINESS_TYPES, PLAN_IDS, PLANS, type BusinessAction, type BusinessProfile } from "@axo/shared";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Dialog, ErrorNote, Field, Input, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { formatINR } from "@/lib/utils";

interface ChannelStatus {
  status: "ready" | "action_needed";
  number: string;
  detail: string;
}
export interface ConnectResult {
  calls?: ChannelStatus;
  whatsapp?: ChannelStatus;
}

const LANGUAGE_OPTIONS = [
  { id: "en", label: "English" },
  { id: "hi", label: "Hindi" },
  { id: "hinglish", label: "Hinglish" },
  { id: "kn", label: "Kannada" },
];

const typeOf = (id: string) => BUSINESS_TYPES.find((t) => t.id === id) ?? BUSINESS_TYPES[BUSINESS_TYPES.length - 1]!;

/** Tick what the agent may do for this business. */
function ActionPicker({ value, onChange }: { value: BusinessAction[]; onChange: (v: BusinessAction[]) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {BUSINESS_ACTIONS.map((a) => (
        <label key={a} className="flex cursor-pointer items-start gap-2 rounded-md border p-2.5">
          <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-primary" checked={value.includes(a)} onChange={(e) => onChange(e.target.checked ? [...value, a] : value.filter((x) => x !== a))} />
          <span>
            <span className="block text-sm font-medium">{BUSINESS_ACTION_INFO[a].label}</span>
            <span className="block text-xs text-muted-foreground">{BUSINESS_ACTION_INFO[a].hint}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

/** What is live now and what still needs a step outside the app, per channel. */
export function SetupReport({ result }: { result: ConnectResult }) {
  const rows = [
    ["Calls", result.calls],
    ["WhatsApp", result.whatsapp],
  ] as const;
  return (
    <div className="space-y-2">
      {rows.map(([label, s]) =>
        s ? (
          <div key={label} className={`flex gap-2 rounded-md border p-3 text-sm ${s.status === "ready" ? "border-emerald-500/40 bg-emerald-500/5" : "border-amber-500/40 bg-amber-500/5"}`}>
            {s.status === "ready" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />}
            <div>
              <div className="font-medium">
                {label} · {s.number}
              </div>
              <div className="text-muted-foreground">{s.detail}</div>
            </div>
          </div>
        ) : null,
      )}
    </div>
  );
}

const emptyForm = () => ({
  name: "",
  type: "clinic",
  typeLabel: "",
  description: "",
  knowledge: "",
  actions: typeOf("clinic").actions,
  address: "",
  mapLink: "",
  timings: "",
  agentName: "Asha",
  voice: "female" as "female" | "male",
  languages: ["en", "hi"],
  defaultLanguage: "en",
  callNumber: "",
  whatsappNumber: "",
  sameNumber: true,
  ownerName: "",
  ownerPhone: "",
  ownerEmail: "",
  plan: "starter",
});

/** One form: what the business is, what the agent should do, and its numbers. Saving makes the agent live. */
export function AddBusinessDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [f, setF] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ id: string; setup: ConnectResult } | null>(null);
  const set = <K extends keyof ReturnType<typeof emptyForm>>(k: K, v: ReturnType<typeof emptyForm>[K]) => setF((cur) => ({ ...cur, [k]: v }));
  const type = typeOf(f.type);

  const close = () => {
    setDone(null);
    setError(null);
    setF(emptyForm());
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ id: string; setup: ConnectResult }>("/admin/orgs", {
        method: "POST",
        json: {
          name: f.name,
          plan: f.plan,
          ownerName: f.ownerName,
          ownerPhone: f.ownerPhone,
          ownerEmail: f.ownerEmail,
          business: { type: f.type, typeLabel: f.type === "other" ? f.typeLabel : "", description: f.description, knowledge: f.knowledge, actions: f.actions, address: f.address, mapLink: f.mapLink, timings: f.timings, staffPhone: f.ownerPhone },
          agent: { name: f.agentName, voice: f.voice, languages: f.languages, defaultLanguage: f.defaultLanguage },
          callNumber: f.callNumber,
          whatsappNumber: f.sameNumber ? f.callNumber : f.whatsappNumber,
        },
      });
      setDone(res);
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    const nothing = !done.setup.calls && !done.setup.whatsapp;
    return (
      <Dialog open={open} onClose={close} title={`${f.name} is set up`}>
        <p className="mb-3 text-sm text-muted-foreground">
          {f.agentName} now knows the business and does what you ticked. {nothing ? "Add a calling or WhatsApp number from the business page to go live." : ""}
        </p>
        <SetupReport result={done.setup} />
        <div className="flex justify-end gap-2 pt-4">
          <Button variant="ghost" onClick={close}>
            Close
          </Button>
          <Link href={`/admin/dealers/${done.id}`}>
            <Button>Open business</Button>
          </Link>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onClose={close} title="Add business" wide>
      <ErrorNote error={error} />
      <form onSubmit={submit} className="space-y-5">
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">1. The business</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Business name" hint="The AI says this name on calls">
              <Input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Smile Dental Care" required />
            </Field>
            <Field label="Type of business">
              <Select
                value={f.type}
                onChange={(e) => {
                  const t = typeOf(e.target.value);
                  setF((cur) => ({ ...cur, type: t.id, actions: t.actions }));
                }}
              >
                {BUSINESS_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>
            {f.type === "other" && (
              <Field label="What kind of business?" className="sm:col-span-2">
                <Input value={f.typeLabel} onChange={(e) => set("typeLabel", e.target.value)} placeholder="Pet grooming studio" />
              </Field>
            )}
          </div>
          <Field label="What do they do?" hint="A few sentences, as you'd explain it to a new receptionist">
            <Textarea value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="A family dental clinic in Jayanagar with two dentists. Most patients come for check-ups, cleaning and root canals." />
          </Field>
          <Field label="Business knowledge" hint="Services, prices, offers, FAQs and rules. The AI only quotes what is written here; anything else gets a callback.">
            <Textarea className="min-h-[140px] font-mono text-xs" value={f.knowledge} onChange={(e) => set("knowledge", e.target.value)} placeholder={type.example || "Services and prices, one per line\nFAQs and policies"} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Address">
              <Input value={f.address} onChange={(e) => set("address", e.target.value)} placeholder="12, 9th Main, Jayanagar" />
            </Field>
            <Field label="Google Maps link">
              <Input value={f.mapLink} onChange={(e) => set("mapLink", e.target.value)} placeholder="https://maps.app.goo.gl/…" />
            </Field>
            <Field label="Timings">
              <Input value={f.timings} onChange={(e) => set("timings", e.target.value)} placeholder="Mon-Sat 10am-8pm" />
            </Field>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">2. What should the agent do?</h3>
          <ActionPicker value={f.actions} onChange={(v) => set("actions", v)} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Agent name">
              <Input value={f.agentName} onChange={(e) => set("agentName", e.target.value)} />
            </Field>
            <Field label="Voice">
              <Select value={f.voice} onChange={(e) => set("voice", e.target.value as "female" | "male")}>
                <option value="female">Female</option>
                <option value="male">Male</option>
              </Select>
            </Field>
            <Field label="Starts in">
              <Select value={f.defaultLanguage} onChange={(e) => set("defaultLanguage", e.target.value)}>
                {LANGUAGE_OPTIONS.filter((l) => f.languages.includes(l.id)).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            <span className="text-muted-foreground">Languages:</span>
            {LANGUAGE_OPTIONS.map((l) => (
              <label key={l.id} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={f.languages.includes(l.id)}
                  onChange={(e) => {
                    const languages = e.target.checked ? [...f.languages, l.id] : f.languages.filter((x) => x !== l.id);
                    if (!languages.length) return;
                    setF((cur) => ({ ...cur, languages, defaultLanguage: languages.includes(cur.defaultLanguage) ? cur.defaultLanguage : languages[0]! }));
                  }}
                />
                {l.label}
              </label>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">3. Numbers</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Calling number" hint="A number on your Twilio/Exotel account. Customers who call it reach the AI.">
              <Input value={f.callNumber} onChange={(e) => set("callNumber", e.target.value)} placeholder="+91 80 4123 4567" />
            </Field>
            <Field label="WhatsApp number" hint="Must be added to your WhatsApp Business account in Meta.">
              <Input value={f.sameNumber ? f.callNumber : f.whatsappNumber} disabled={f.sameNumber} onChange={(e) => set("whatsappNumber", e.target.value)} placeholder="+91 98450 00000" />
              <label className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" className="h-3.5 w-3.5 accent-primary" checked={f.sameNumber} onChange={(e) => set("sameNumber", e.target.checked)} />
                Same as calling number
              </label>
            </Field>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">4. Owner and plan</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Owner name">
              <Input value={f.ownerName} onChange={(e) => set("ownerName", e.target.value)} />
            </Field>
            <Field label="Owner / staff phone" hint="Live transfers and new-booking alerts go here">
              <Input value={f.ownerPhone} onChange={(e) => set("ownerPhone", e.target.value)} placeholder="+91…" />
            </Field>
            <Field label="Owner login email" hint="Optional: lets them sign in to their own dashboard">
              <Input type="email" value={f.ownerEmail} onChange={(e) => set("ownerEmail", e.target.value)} />
            </Field>
            <Field label="Plan">
              <Select value={f.plan} onChange={(e) => set("plan", e.target.value)}>
                {PLAN_IDS.map((p) => (
                  <option key={p} value={p}>
                    {PLANS[p].label} · {formatINR(PLANS[p].price)}/month · {PLANS[p].minutes} min
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </section>

        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button disabled={busy || !f.name.trim() || !f.actions.length}>{busy ? "Setting up…" : "Create and go live"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Edit what the agent knows and does; it applies from the next call or message. */
export function BusinessProfileCard({ business, saving, onSave }: { business: BusinessProfile; saving: boolean; onSave: (b: Partial<BusinessProfile>) => void }) {
  const [b, setB] = useState(business);
  useEffect(() => setB(business), [business]);
  const set = <K extends keyof BusinessProfile>(k: K, v: BusinessProfile[K]) => setB((cur) => ({ ...cur, [k]: v }));
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Business profile <Badge variant="secondary">{b.typeLabel || typeOf(b.type).label}</Badge>
        </CardTitle>
        <CardDescription>What the AI knows and does on calls and WhatsApp. Changes apply from the next call or message.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Field label="What they do">
          <Textarea value={b.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
        <Field label="Business knowledge" hint="The AI only quotes what is written here">
          <Textarea className="min-h-[160px] font-mono text-xs" value={b.knowledge} onChange={(e) => set("knowledge", e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Address">
            <Input value={b.address} onChange={(e) => set("address", e.target.value)} />
          </Field>
          <Field label="Google Maps link">
            <Input value={b.mapLink} onChange={(e) => set("mapLink", e.target.value)} />
          </Field>
          <Field label="Timings">
            <Input value={b.timings} onChange={(e) => set("timings", e.target.value)} />
          </Field>
          <Field label="Staff phone" hint="Transfers and alerts">
            <Input value={b.staffPhone} onChange={(e) => set("staffPhone", e.target.value)} />
          </Field>
        </div>
        <ActionPicker value={b.actions} onChange={(v) => set("actions", v)} />
        <div className="flex justify-end">
          <Button disabled={saving || !b.actions.length} onClick={() => onSave(b)}>
            {saving ? "Saving…" : "Save profile"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Type the number, press Connect: links it to the agent and configures Twilio / Meta where the server can. */
export function QuickConnectCard({ orgId, callNumber, whatsappNumber, onConnected }: { orgId: string; callNumber: string; whatsappNumber: string; onConnected: () => void }) {
  const [call, setCall] = useState(callNumber);
  const [wa, setWa] = useState(whatsappNumber);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConnectResult | null>(null);
  useEffect(() => {
    setCall(callNumber);
    setWa(whatsappNumber);
  }, [callNumber, whatsappNumber]);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await api<ConnectResult>(`/admin/orgs/${orgId}/connect`, { method: "POST", json: { callNumber: call, whatsappNumber: wa } }));
      onConnected();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect numbers</CardTitle>
        <CardDescription>Enter the numbers and press Connect. The AI is linked to them and the providers are set up where your server settings allow it.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ErrorNote error={error} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Calling number">
            <Input value={call} onChange={(e) => setCall(e.target.value)} placeholder="+91 80 4123 4567" />
          </Field>
          <Field label="WhatsApp number">
            <Input value={wa} onChange={(e) => setWa(e.target.value)} placeholder="+91 98450 00000" />
          </Field>
        </div>
        {result && <SetupReport result={result} />}
        <div className="flex justify-end">
          <Button disabled={busy || (!call.trim() && !wa.trim())} onClick={() => void connect()}>
            {busy ? "Connecting…" : "Connect"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
