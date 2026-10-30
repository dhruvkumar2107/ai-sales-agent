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

/** The WhatsApp connect link with copy and one-tap send to the owner's own WhatsApp. */
function WhatsappLinkBox({ link, ownerPhone }: { link: { url: string; ready: boolean }; ownerPhone?: string }) {
  const [copied, setCopied] = useState(false);
  const text = `Hi! Please open this link to connect your WhatsApp number to your AI assistant (takes 2 minutes): ${link.url}`;
  const digits = (ownerPhone ?? "").replace(/\D/g, "");
  const to = digits.length === 10 ? `91${digits}` : digits;
  return (
    <div className="mt-3 space-y-2 rounded-md border p-3 text-sm">
      <div className="font-medium">WhatsApp: send this link to the owner</div>
      {!link.ready && <ErrorNote error="Add your Meta app ID, app secret and Embedded Signup configuration ID in Settings first; until then the link page asks the business to wait." />}
      <Input readOnly value={link.url} onFocus={(e) => e.target.select()} />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void navigator.clipboard.writeText(link.url);
            setCopied(true);
          }}
        >
          {copied ? "Copied" : "Copy link"}
        </Button>
        <a href={`https://wa.me/${to}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">
          <Button size="sm">{to ? "Send to owner on WhatsApp" : "Send on WhatsApp"}</Button>
        </a>
      </div>
      <p className="text-xs text-muted-foreground">Valid for 14 days. When they finish, the number is linked automatically. It must not be in use on the normal WhatsApp app.</p>
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
  /** buy = a new Indian number from our Twilio account; existing = one already on our account; later = no number yet */
  callMode: "buy" as "buy" | "existing" | "later",
  numberType: "local",
  callNumber: "",
  /** link = the owner connects their own WhatsApp from a link; same / existing = a number in our Meta account */
  waMode: "link" as "link" | "same" | "existing" | "later",
  whatsappNumber: "",
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
  const [done, setDone] = useState<{ id: string; setup: ConnectResult; whatsappLink?: { url: string; ready: boolean } } | null>(null);
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
      if (f.callMode === "buy" && !window.confirm(`A new Indian ${f.numberType === "tollfree" ? "toll-free" : f.numberType === "mobile" ? "mobile" : "landline"} number will be bought on your Twilio account for ${f.name}. Twilio charges its monthly number fee. Continue?`)) return;
      const callNumber = f.callMode === "existing" ? f.callNumber : "";
      const res = await api<{ id: string; setup: ConnectResult; whatsappLink?: { url: string; ready: boolean } }>("/admin/orgs", {
        method: "POST",
        json: {
          name: f.name,
          plan: f.plan,
          ownerName: f.ownerName,
          ownerPhone: f.ownerPhone,
          ownerEmail: f.ownerEmail,
          business: { type: f.type, typeLabel: f.type === "other" ? f.typeLabel : "", description: f.description, knowledge: f.knowledge, actions: f.actions, address: f.address, mapLink: f.mapLink, timings: f.timings, staffPhone: f.ownerPhone },
          agent: { name: f.agentName, voice: f.voice, languages: f.languages, defaultLanguage: f.defaultLanguage },
          callNumber,
          whatsappNumber: f.waMode === "same" ? callNumber : f.waMode === "existing" ? f.whatsappNumber : "",
          buyNumber: f.callMode === "buy" ? { type: f.numberType } : undefined,
          whatsappSelfConnect: f.waMode === "link",
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
        {done.whatsappLink && <WhatsappLinkBox link={done.whatsappLink} ownerPhone={f.ownerPhone} />}
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
            <Field label="Calling number" hint={f.callMode === "buy" ? "Bought from your Twilio account and connected to the AI automatically" : f.callMode === "existing" ? "A number already on your Twilio/Exotel account" : "Add one later from the business page"}>
              <Select value={f.callMode} onChange={(e) => setF((cur) => ({ ...cur, callMode: e.target.value as "buy" | "existing" | "later", waMode: cur.waMode === "same" && e.target.value !== "existing" ? "link" : cur.waMode }))}>
                <option value="buy">Buy a new number automatically</option>
                <option value="existing">I already have a number</option>
                <option value="later">Later</option>
              </Select>
              {f.callMode === "buy" && (
                <Select value={f.numberType} onChange={(e) => set("numberType", e.target.value)} aria-label="Number type">
                  <option value="local">Landline (local)</option>
                  <option value="mobile">Mobile</option>
                  <option value="tollfree">Toll-free</option>
                </Select>
              )}
              {f.callMode === "existing" && <Input value={f.callNumber} onChange={(e) => set("callNumber", e.target.value)} placeholder="+91 80 4123 4567" />}
            </Field>
            <Field label="WhatsApp" hint={f.waMode === "link" ? "You get a link to send the owner; they connect their own number in 2 minutes" : f.waMode === "later" ? "Add it later from the business page" : "Must already be added to your WhatsApp Business account in Meta"}>
              <Select value={f.waMode} onChange={(e) => set("waMode", e.target.value as "link" | "same" | "existing" | "later")}>
                <option value="link">Owner connects their WhatsApp (link)</option>
                {f.callMode === "existing" && <option value="same">Same as calling number</option>}
                <option value="existing">A number in my Meta account</option>
                <option value="later">Later</option>
              </Select>
              {f.waMode === "existing" && <Input value={f.whatsappNumber} onChange={(e) => set("whatsappNumber", e.target.value)} placeholder="+91 98450 00000" />}
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
          <Button disabled={busy || !f.name.trim() || !f.actions.length}>{busy ? (f.callMode === "buy" ? "Setting up and buying the number…" : "Setting up…") : "Create and go live"}</Button>
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

interface AvailableNumber {
  phoneNumber: string;
  friendlyName: string;
  locality: string;
  region: string;
}

/** Buy a Twilio number for this business (linked and configured on purchase) and send the WhatsApp self-connect link. */
export function ProvisionCard({ orgId, businessName, ownerPhone, onDone }: { orgId: string; businessName: string; ownerPhone?: string; onDone: () => void }) {
  const [type, setType] = useState("local");
  const [contains, setContains] = useState("");
  const [numbers, setNumbers] = useState<AvailableNumber[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConnectResult | null>(null);
  const [link, setLink] = useState<{ url: string; ready: boolean } | null>(null);

  const run = async (what: string, f: () => Promise<void>) => {
    setBusy(what);
    setError(null);
    try {
      await f();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const search = () => run("search", async () => setNumbers((await api<{ numbers: AvailableNumber[] }>(`/admin/twilio/available?country=IN&type=${type}&contains=${encodeURIComponent(contains)}`)).numbers));
  const buy = (n: string) =>
    run(n, async () => {
      if (!window.confirm(`Buy ${n} on your Twilio account for ${businessName}? Twilio charges its monthly number fee.`)) return;
      setResult(await api<ConnectResult>(`/admin/orgs/${orgId}/buy-number`, { method: "POST", json: { phoneNumber: n } }));
      setNumbers(null);
      onDone();
    });
  const getLink = () => run("link", async () => setLink(await api<{ url: string; ready: boolean }>(`/admin/orgs/${orgId}/whatsapp-link`)));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Get numbers automatically</CardTitle>
        <CardDescription>Buy a calling number from your Twilio account in one click, and send the business a link to connect its own WhatsApp.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ErrorNote error={error} />
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Calling number</h3>
          <div className="flex flex-wrap gap-2">
            <Select className="w-32" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="local">Landline</option>
              <option value="mobile">Mobile</option>
              <option value="tollfree">Toll-free</option>
            </Select>
            <Input className="w-40" value={contains} onChange={(e) => setContains(e.target.value)} placeholder="Digits, e.g. 80" />
            <Button variant="outline" disabled={busy !== null} onClick={() => void search()}>
              {busy === "search" ? "Searching…" : "Find numbers"}
            </Button>
          </div>
          {numbers && !numbers.length && <p className="text-sm text-muted-foreground">No numbers available with these filters. Try another type or fewer digits.</p>}
          {numbers?.map((n) => (
            <div key={n.phoneNumber} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
              <span>
                <span className="font-medium tabular-nums">{n.friendlyName}</span>
                <span className="text-xs text-muted-foreground"> {[n.locality, n.region].filter(Boolean).join(", ")}</span>
              </span>
              <Button size="sm" disabled={busy !== null} onClick={() => void buy(n.phoneNumber)}>
                {busy === n.phoneNumber ? "Buying…" : "Buy"}
              </Button>
            </div>
          ))}
          {result && <SetupReport result={result} />}
        </section>
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">WhatsApp</h3>
          {!link ? (
            <Button variant="outline" disabled={busy !== null} onClick={() => void getLink()}>
              Create "Connect WhatsApp" link
            </Button>
          ) : (
            <WhatsappLinkBox link={link} ownerPhone={ownerPhone} />
          )}
        </section>
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
