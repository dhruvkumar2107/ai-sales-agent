"use client";

import { ArrowLeft, CheckCircle2, CircleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PLAN_IDS, PLANS } from "@axo/shared";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, ErrorNote, Field, Input, PageHeader, Select, Table, Td, Th, Tr } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { formatINR } from "@/lib/utils";

interface KeyField {
  key: string;
  group: string;
  label: string;
  hint?: string;
  secret?: boolean;
  options?: string[];
  value: string;
  source: "panel" | "env file" | "not set";
}
interface Partner {
  name: string;
  share: number;
}
interface AdminMe {
  pricing: { overagePerMinute: number; setupFee: number; paymentFeePercent: number };
  setup: { whatsappWebhookUrl: string; whatsappVerifyToken: string; twilioVoiceUrl: string };
}

/** Assumed cost of one call minute (phone + AI + voice) at the default cost rates; for the margin column. */
const COST_PER_MIN = 8;

export default function AdminSettingsPage() {
  const { data, error, reload } = useApi<{ fields: KeyField[]; partners: Partner[] }>("/admin/keys");
  const { data: me } = useApi<AdminMe>("/admin/me");
  return (
    <div>
      <Link href="/admin" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> All businesses
      </Link>
      <PageHeader title="Settings" description="Your provider keys, the partner split and the price list. Every business uses these keys." />
      <ErrorNote error={error} />
      <div className="grid gap-6 lg:grid-cols-2">
        {data && <SetupChecklist fields={data.fields} />}
        {data && <KeysCard fields={data.fields} onSaved={() => void reload()} />}
        <div className="space-y-6">
          {data && <PartnersCard partners={data.partners} />}
          <PricingCard pricing={me?.pricing} />
          {me && (
            <Card>
              <CardHeader>
                <CardTitle>Paste once in Twilio and Meta</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-xs">
                <p>
                  Twilio voice webhook: <code className="select-all">{me.setup.twilioVoiceUrl}</code> (set automatically when you connect a number)
                </p>
                <p>
                  Meta webhook URL: <code className="select-all">{me.setup.whatsappWebhookUrl}</code>
                </p>
                <p>
                  Meta verify token: <code className="select-all">{me.setup.whatsappVerifyToken}</code> · subscribe to &quot;messages&quot;
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

/** The one-time account setup, in order, with where to click and what to paste; ticks itself off as keys are saved. */
const STEPS: { title: string; keys: string[]; optional?: boolean; links: { label: string; url: string }[]; how: string }[] = [
  { title: "Public server URL", keys: ["PUBLIC_BASE_URL"], links: [{ label: "Render dashboard", url: "https://dashboard.render.com" }], how: "Copy your API service's https address (e.g. https://axo-api.onrender.com) into Public server URL." },
  { title: "Gemini AI key", keys: ["GEMINI_API_KEY"], links: [{ label: "Get API key", url: "https://aistudio.google.com/app/apikey" }], how: "Sign in with Google, Create API key, copy it into Gemini API key, and set AI model provider to gemini." },
  { title: "Twilio account", keys: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"], links: [{ label: "Sign up", url: "https://www.twilio.com/try-twilio" }, { label: "Console", url: "https://console.twilio.com" }], how: "Sign up, verify your email and phone, upgrade with a card, then copy Account SID and Auth Token from the Console home page." },
  { title: "Twilio India documents", keys: ["TWILIO_BUNDLE_SID"], links: [{ label: "Regulatory Compliance", url: "https://console.twilio.com/us1/develop/phone-numbers/regulatory-compliance/bundles" }], how: "Create a Bundle for India (business address + GST or company documents). Once approved (1-3 days), paste the BU… id and the AD… address id." },
  { title: "Meta business and WhatsApp account", keys: ["META_WA_TOKEN", "META_WABA_ID"], links: [{ label: "Business settings", url: "https://business.facebook.com/settings" }, { label: "WhatsApp Manager", url: "https://business.facebook.com/wa/manage/home/" }], how: "In Business settings > Users > System users, add an admin system user, assign your app and WhatsApp account, Generate token with whatsapp_business_messaging and whatsapp_business_management, and paste it. Copy the WhatsApp Business Account ID from WhatsApp Manager." },
  { title: "Meta app and webhook", keys: ["META_APP_ID", "META_APP_SECRET"], links: [{ label: "Meta for Developers", url: "https://developers.facebook.com/apps" }], how: "Create a Business app with the WhatsApp product; copy App ID and App secret from Settings > Basic. Under WhatsApp > Configuration, paste the webhook URL and verify token shown on this page and subscribe to messages." },
  { title: "WhatsApp self-connect for businesses", keys: ["META_ES_CONFIG_ID"], optional: true, links: [{ label: "Business verification", url: "https://business.facebook.com/settings/security" }, { label: "Embedded Signup docs", url: "https://developers.facebook.com/docs/whatsapp/embedded-signup" }], how: "Verify your business, apply as a Tech Provider, then in your app > Facebook Login for Business > Configurations create a WhatsApp Embedded Signup configuration and paste its ID." },
];

function SetupChecklist({ fields }: { fields: KeyField[] }) {
  const isSet = (k: string) => {
    const f = fields.find((x) => x.key === k);
    return Boolean(f && f.source !== "not set" && !(k === "PUBLIC_BASE_URL" && /localhost/.test(f.value)));
  };
  const done = STEPS.filter((s) => s.keys.every(isSet)).length;
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          One-time setup <Badge variant={done === STEPS.length ? "success" : "secondary"}>{done}/{STEPS.length} done</Badge>
        </CardTitle>
        <CardDescription>Do these once for the whole platform. After that, every new business is set up from the admin panel: buy its number in one click and send it the WhatsApp link.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2">
        {STEPS.map((s, i) => {
          const ok = s.keys.every(isSet);
          return (
            <div key={s.title} className={`rounded-md border p-3 text-sm ${ok ? "border-emerald-500/40 bg-emerald-500/5" : ""}`}>
              <div className="mb-1 flex items-center gap-2 font-medium">
                {ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <span className="flex h-4 w-4 items-center justify-center rounded-full border text-[10px]">{i + 1}</span>}
                {s.title}
                {s.optional && <Badge variant="secondary">later</Badge>}
              </div>
              <p className="text-xs text-muted-foreground">{s.how}</p>
              <div className="mt-2 flex flex-wrap gap-3 text-xs">
                {s.links.map((l) => (
                  <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                    {l.label} ↗
                  </a>
                ))}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function KeysCard({ fields, onSaved }: { fields: KeyField[]; onSaved: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [checks, setChecks] = useState<{ name: string; ok: boolean; detail: string }[] | null>(null);
  useEffect(() => setValues(Object.fromEntries(fields.map((f) => [f.key, f.value]))), [fields]);
  const groups = [...new Set(fields.map((f) => f.group))];

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      // Only send what changed, so values from the env file are not copied into the panel.
      const changed = Object.fromEntries(fields.filter((f) => (values[f.key] ?? "") !== f.value).map((f) => [f.key, values[f.key] ?? ""]));
      await api("/admin/keys", { method: "PUT", json: { values: changed } });
      setSaved(true);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const check = async () => {
    setBusy(true);
    try {
      setChecks((await api<{ checks: { name: string; ok: boolean; detail: string }[] }>("/admin/keys/check", { method: "POST" })).checks);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Provider keys</CardTitle>
        <CardDescription>Paste your accounts&apos; keys here; they apply immediately, no restart. Secrets are stored encrypted and only their last 4 characters are shown. Clear a field to go back to the server&apos;s env file value.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <ErrorNote error={error} />
        {groups.map((g) => (
          <section key={g} className="space-y-3">
            <h3 className="text-sm font-semibold">{g}</h3>
            {fields
              .filter((f) => f.group === g)
              .map((f) => (
                <Field key={f.key} label={f.label} hint={[f.hint, f.source === "env file" ? "Currently from the env file" : ""].filter(Boolean).join(" · ") || undefined}>
                  {f.options ? (
                    <Select value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}>
                      {f.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input type={f.secret ? "password" : "text"} autoComplete="off" value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
                  )}
                </Field>
              ))}
          </section>
        ))}
        {checks && (
          <div className="space-y-1.5">
            {checks.map((c) => (
              <div key={c.name} className="flex gap-2 text-sm">
                {c.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />}
                <span>
                  <span className="font-medium">{c.name}:</span> {c.detail}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-end gap-2">
          {saved && <span className="text-sm text-emerald-600">Saved</span>}
          <Button variant="outline" disabled={busy} onClick={() => void check()}>
            Check keys
          </Button>
          <Button disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save keys"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PartnersCard({ partners }: { partners: Partner[] }) {
  const [list, setList] = useState(partners);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => setList(partners), [partners]);
  const total = list.reduce((n, p) => n + (Number(p.share) || 0), 0);

  const save = async () => {
    setError(null);
    setSaved(false);
    try {
      await api("/admin/partners", { method: "PUT", json: { partners: list } });
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Partners</CardTitle>
        <CardDescription>Each month&apos;s profit (all fees received minus phone, AI, WhatsApp and payment gateway costs) is split by these shares on the Businesses page.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ErrorNote error={error} />
        {list.map((p, i) => (
          <div key={i} className="flex gap-2">
            <Input value={p.name} onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Partner name" />
            <div className="flex w-32 shrink-0 items-center gap-1">
              <Input type="number" min={0} max={100} value={p.share} onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, share: Number(e.target.value) } : x)))} />
              <span className="text-sm">%</span>
            </div>
          </div>
        ))}
        <div className="flex items-center justify-between gap-2">
          <span className={`text-sm ${total === 100 ? "text-muted-foreground" : "text-amber-600"}`}>Total {total}%</span>
          <div className="flex items-center gap-2">
            {saved && <span className="text-sm text-emerald-600">Saved</span>}
            <Button disabled={total !== 100} onClick={() => void save()}>
              Save partners
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PricingCard({ pricing }: { pricing?: AdminMe["pricing"] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Price list</CardTitle>
        <CardDescription>
          One-time setup {formatINR(pricing?.setupFee)} per business, then a monthly plan. Extra minutes {formatINR(pricing?.overagePerMinute)}/min. Prices exclude 18% GST. Margin assumes about {formatINR(COST_PER_MIN)} cost per call minute, fully used.
        </CardDescription>
      </CardHeader>
      <Table>
        <thead>
          <Tr>
            <Th>Plan</Th>
            <Th>Price / month</Th>
            <Th>Minutes</Th>
            <Th>WhatsApp</Th>
            <Th>Margin</Th>
          </Tr>
        </thead>
        <tbody>
          {PLAN_IDS.filter((id) => id !== "trial").map((id) => {
            const p = PLANS[id];
            const margin = Math.round((1 - (p.minutes * COST_PER_MIN + p.messages * 0.35 + p.price * ((pricing?.paymentFeePercent ?? 2) / 100)) / p.price) * 100);
            return (
              <Tr key={id}>
                <Td>
                  <div className="font-medium">{p.label}</div>
                  <div className="text-xs text-muted-foreground">{p.pitch}</div>
                </Td>
                <Td className="tabular-nums">{formatINR(p.price)}</Td>
                <Td className="tabular-nums">{p.minutes}</Td>
                <Td className="tabular-nums">{p.messages}</Td>
                <Td>
                  <Badge variant="success">{margin}%</Badge>
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
    </Card>
  );
}
