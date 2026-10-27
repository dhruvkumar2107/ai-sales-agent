"use client";

import { Check, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import type { AgentConfig, Branch, CatalogModel, Offer, OrgSettings, TestDriveVehicle } from "@axo/shared";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, ErrorNote, Field, Input, PageHeader, Select, Table, Td, Textarea, Th, Tr } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { cn, humanize, lakh } from "@/lib/utils";

const STEPS = ["Showroom", "Branches", "Catalog & offers", "Test drive vehicles", "Service, EMI & hours", "Agents & greeting"] as const;

export default function SetupPage() {
  const [step, setStep] = useState(0);
  return (
    <div>
      <PageHeader title="Setup wizard" description="Configure everything your AI agent knows. Changes apply to the next call." />
      <div className="mb-6 flex flex-wrap gap-2">
        {STEPS.map((s, i) => (
          <button key={s} onClick={() => setStep(i)} className={cn("flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm", i === step ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>
            <span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-xs", i === step ? "bg-primary-foreground text-primary" : "bg-muted")}>{i + 1}</span>
            {s}
          </button>
        ))}
      </div>
      {step === 0 && <ShowroomStep />}
      {step === 1 && <BranchesStep />}
      {step === 2 && <CatalogStep />}
      {step === 3 && <VehiclesStep />}
      {step === 4 && <ServiceStep />}
      {step === 5 && <AgentsStep />}
      <div className="mt-6 flex justify-between">
        <Button variant="outline" disabled={step === 0} onClick={() => setStep(step - 1)}>
          Back
        </Button>
        {step < STEPS.length - 1 ? <Button onClick={() => setStep(step + 1)}>Next</Button> : <a href="/console"><Button>Finish and test a call</Button></a>}
      </div>
    </div>
  );
}

function useSaver() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (fn: () => Promise<unknown>, okText = "Saved") => {
    try {
      await fn();
      setMsg({ ok: true, text: okText });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
    setTimeout(() => setMsg(null), 4000);
  };
  const note = msg ? <p className={cn("text-sm", msg.ok ? "text-emerald-600" : "text-destructive")}>{msg.text}</p> : null;
  return { run, note };
}

// ---------------------------------------------------------------- 1. Showroom

function ShowroomStep() {
  const { me, refresh } = useAuth();
  const [name, setName] = useState(me?.org?.name ?? "");
  const [showroom, setShowroom] = useState(me?.org?.showroomName ?? "");
  const [brands, setBrands] = useState(me?.org?.brands.join(", ") ?? "");
  const { run, note } = useSaver();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Showroom</CardTitle>
        <CardDescription>The agent introduces itself with the showroom name.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-3">
        <Field label="Dealership group">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Showroom name (spoken)">
          <Input value={showroom} onChange={(e) => setShowroom(e.target.value)} />
        </Field>
        <Field label="Brands" hint="Comma separated">
          <Input value={brands} onChange={(e) => setBrands(e.target.value)} placeholder="Hyundai, Honda" />
        </Field>
        <div className="flex items-center gap-3 md:col-span-3">
          <Button onClick={() => void run(async () => { await api("/api/org", { method: "PATCH", json: { name, showroomName: showroom, brands: brands.split(",").map((b) => b.trim()).filter(Boolean) } }); await refresh(); })}>Save</Button>
          {note}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- 2. Branches

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const emptyBranch = { name: "", address: "", city: "", mapLink: "", phone: "", open: "09:30", close: "19:30", days: [1, 2, 3, 4, 5, 6], sales: "", service: "", manager: "", insurance: "", testDriveSlotMinutes: 30, serviceSlotMinutes: 60, serviceBays: 4 };

function BranchesStep() {
  const { data, reload } = useApi<Branch[]>("/api/branches");
  const [f, setF] = useState(emptyBranch);
  const [editing, setEditing] = useState<string | null>(null);
  const { run, note } = useSaver();
  const edit = (b: Branch) => {
    setEditing(b.id);
    setF({ name: b.name, address: b.address, city: b.city, mapLink: b.mapLink, phone: b.phone, open: b.workingHours.open, close: b.workingHours.close, days: b.workingHours.days, ...b.transferNumbers, testDriveSlotMinutes: b.testDriveSlotMinutes, serviceSlotMinutes: b.serviceSlotMinutes, serviceBays: b.serviceBays });
  };
  const save = () =>
    run(async () => {
      const body = { name: f.name, address: f.address, city: f.city, mapLink: f.mapLink, phone: f.phone, workingHours: { days: f.days, open: f.open, close: f.close }, transferNumbers: { sales: f.sales, service: f.service, manager: f.manager, insurance: f.insurance }, testDriveSlotMinutes: Number(f.testDriveSlotMinutes), serviceSlotMinutes: Number(f.serviceSlotMinutes), serviceBays: Number(f.serviceBays) };
      await api(editing ? `/api/branches/${editing}` : "/api/branches", { method: editing ? "PATCH" : "POST", json: body });
      setF(emptyBranch);
      setEditing(null);
      await reload();
    });
  const s = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Branches</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {data?.map((b) => (
            <div key={b.id} className="flex items-start justify-between rounded-md border p-3 text-sm">
              <div>
                <p className="font-medium">{b.name}</p>
                <p className="text-xs text-muted-foreground">{b.address}</p>
                <p className="text-xs text-muted-foreground">
                  {b.workingHours.days.map((d) => DAY[d]).join(" ")} · {b.workingHours.open}–{b.workingHours.close} · sales transfer {b.transferNumbers.sales || "-"}
                </p>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => edit(b)}>
                  Edit
                </Button>
                <Button size="icon" variant="ghost" aria-label="Delete branch" onClick={() => void api(`/api/branches/${b.id}`, { method: "DELETE" }).then(reload)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{editing ? "Edit branch" : "Add branch"}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <Field label="Name" className="col-span-2">
            <Input value={f.name} onChange={s("name")} />
          </Field>
          <Field label="Address" className="col-span-2">
            <Input value={f.address} onChange={s("address")} />
          </Field>
          <Field label="City">
            <Input value={f.city} onChange={s("city")} />
          </Field>
          <Field label="Map link">
            <Input value={f.mapLink} onChange={s("mapLink")} />
          </Field>
          <Field label="Opens">
            <Input type="time" value={f.open} onChange={s("open")} />
          </Field>
          <Field label="Closes">
            <Input type="time" value={f.close} onChange={s("close")} />
          </Field>
          <div className="col-span-2 flex flex-wrap gap-1">
            {DAY.map((d, i) => (
              <button key={d} type="button" onClick={() => setF({ ...f, days: f.days.includes(i) ? f.days.filter((x) => x !== i) : [...f.days, i].sort() })} className={cn("rounded border px-2 py-1 text-xs", f.days.includes(i) ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground")}>
                {d}
              </button>
            ))}
          </div>
          <Field label="Sales transfer no.">
            <Input value={f.sales} onChange={s("sales")} placeholder="+91…" />
          </Field>
          <Field label="Service transfer no.">
            <Input value={f.service} onChange={s("service")} />
          </Field>
          <Field label="Manager no.">
            <Input value={f.manager} onChange={s("manager")} />
          </Field>
          <Field label="Insurance desk no.">
            <Input value={f.insurance} onChange={s("insurance")} />
          </Field>
          <Field label="Test drive slot (min)">
            <Input type="number" value={f.testDriveSlotMinutes} onChange={s("testDriveSlotMinutes")} />
          </Field>
          <Field label="Service slot (min) / bays">
            <div className="flex gap-2">
              <Input type="number" value={f.serviceSlotMinutes} onChange={s("serviceSlotMinutes")} />
              <Input type="number" value={f.serviceBays} onChange={s("serviceBays")} />
            </div>
          </Field>
          <div className="col-span-2 flex items-center gap-3">
            <Button disabled={!f.name} onClick={() => void save()}>
              {editing ? "Update" : "Add branch"}
            </Button>
            {editing && (
              <Button variant="ghost" onClick={() => { setEditing(null); setF(emptyBranch); }}>
                Cancel
              </Button>
            )}
            {note}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- 3. Catalog & offers

function CatalogStep() {
  const { data: catalog, reload } = useApi<CatalogModel[]>("/api/catalog");
  const { data: offers, reload: reloadOffers } = useApi<Offer[]>("/api/offers");
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<{ imported: number; variants: number; errors: { row: number; message: string }[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [offer, setOffer] = useState({ title: "", description: "", models: "", validTo: "" });
  const { run, note } = useSaver();

  const importCsv = async (text: string) => {
    setErr(null);
    try {
      setResult(await api("/api/catalog/import", { method: "POST", body: text, headers: { "content-type": "text/csv" } }));
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Import catalog CSV</CardTitle>
          <CardDescription>
            One row per variant. Columns: brand, model, type (bike/scooter/car), variant, fuel (petrol/diesel/cng/ev/hybrid), transmission, ex_showroom_price, on_road_min, on_road_max, colors, key_features, brochure_url, aliases, talking_points. Use | to separate multiple values.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ErrorNote error={err} />
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed p-6 text-sm text-muted-foreground hover:bg-muted/50">
            <Upload className="h-4 w-4" /> Choose a CSV file
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void file.text().then(importCsv); }} />
          </label>
          <Textarea rows={4} placeholder="…or paste CSV here" value={csv} onChange={(e) => setCsv(e.target.value)} className="font-mono text-xs" />
          <Button disabled={!csv.trim()} onClick={() => void importCsv(csv)}>
            Import pasted CSV
          </Button>
          {result && (
            <div className="rounded-md bg-muted p-3 text-sm">
              <p className="flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-600" /> Imported {result.imported} models ({result.variants} variants).
              </p>
              {result.errors.map((e) => (
                <p key={e.row} className="text-destructive">
                  Row {e.row}: {e.message}
                </p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Catalog ({catalog?.length ?? 0} models)</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <thead>
              <tr className="border-b">
                <Th>Model</Th>
                <Th>Type</Th>
                <Th>Variants</Th>
                <Th>Ex-showroom</Th>
                <Th>Colours</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {catalog?.map((m) => (
                <Tr key={m.id}>
                  <Td className="font-medium">
                    {m.brand} {m.model}
                  </Td>
                  <Td>{m.type}</Td>
                  <Td>{m.variants.length}</Td>
                  <Td className="whitespace-nowrap">
                    {lakh(Math.min(...m.variants.map((v) => v.exShowroomPrice)))} – {lakh(Math.max(...m.variants.map((v) => v.exShowroomPrice)))}
                  </Td>
                  <Td className="max-w-[200px] truncate text-xs text-muted-foreground">{m.colors.join(", ")}</Td>
                  <Td>
                    <Button size="icon" variant="ghost" aria-label="Delete model" onClick={() => void api(`/api/catalog/${m.id}`, { method: "DELETE" }).then(reload)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Offers</CardTitle>
          <CardDescription>The agent quotes only active offers, with their validity. It never promises discounts beyond these.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {offers?.map((o) => (
            <div key={o.id} className="flex items-center justify-between rounded-md border p-3 text-sm">
              <div>
                <p className="font-medium">{o.title}</p>
                <p className="text-xs text-muted-foreground">
                  {o.description} · {o.models.join(", ") || "All models"} · till {o.validTo}
                </p>
              </div>
              <Button size="icon" variant="ghost" aria-label="Delete offer" onClick={() => void api(`/api/offers/${o.id}`, { method: "DELETE" }).then(reloadOffers)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <div className="grid gap-3 md:grid-cols-4">
            <Input placeholder="Title" value={offer.title} onChange={(e) => setOffer({ ...offer, title: e.target.value })} />
            <Input placeholder="Description (spoken)" value={offer.description} onChange={(e) => setOffer({ ...offer, description: e.target.value })} />
            <Input placeholder="Models (comma separated, blank = all)" value={offer.models} onChange={(e) => setOffer({ ...offer, models: e.target.value })} />
            <Input type="date" value={offer.validTo} onChange={(e) => setOffer({ ...offer, validTo: e.target.value })} aria-label="Valid until" />
          </div>
          <div className="flex items-center gap-3">
            <Button
              disabled={!offer.title || !offer.validTo}
              onClick={() =>
                void run(async () => {
                  await api("/api/offers", { method: "POST", json: { ...offer, models: offer.models.split(",").map((m) => m.trim()).filter(Boolean), validFrom: new Date().toISOString().slice(0, 10), active: true } });
                  setOffer({ title: "", description: "", models: "", validTo: "" });
                  await reloadOffers();
                })
              }
            >
              Add offer
            </Button>
            {note}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- 4. Test drive vehicles

function VehiclesStep() {
  const { data, reload } = useApi<TestDriveVehicle[]>("/api/test-drive-vehicles");
  const { data: branches } = useApi<Branch[]>("/api/branches");
  const { data: catalog } = useApi<CatalogModel[]>("/api/catalog");
  const [f, setF] = useState({ model: "", branchId: "", registrationNo: "" });
  const { run, note } = useSaver();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Test drive vehicles</CardTitle>
        <CardDescription>Slots per model and branch equal the number of demo vehicles available.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <Select value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })}>
            <option value="">Model…</option>
            {catalog?.map((m) => (
              <option key={m.id} value={m.model}>
                {m.brand} {m.model}
              </option>
            ))}
          </Select>
          <Select value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>
            <option value="">Branch…</option>
            {branches?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
          <Input placeholder="Registration no." value={f.registrationNo} onChange={(e) => setF({ ...f, registrationNo: e.target.value.toUpperCase() })} />
          <Button disabled={!f.model || !f.branchId} onClick={() => void run(async () => { await api("/api/test-drive-vehicles", { method: "POST", json: { ...f, active: true } }); setF({ model: "", branchId: "", registrationNo: "" }); await reload(); })}>
            Add vehicle
          </Button>
        </div>
        {note}
        <Table>
          <thead>
            <tr className="border-b">
              <Th>Model</Th>
              <Th>Branch</Th>
              <Th>Registration</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {data?.map((v) => (
              <Tr key={v.id}>
                <Td className="font-medium">{v.model}</Td>
                <Td>{branches?.find((b) => b.id === v.branchId)?.name ?? v.branchId}</Td>
                <Td className="font-mono text-xs">{v.registrationNo}</Td>
                <Td>
                  <button onClick={() => void api(`/api/test-drive-vehicles/${v.id}`, { method: "PATCH", json: { active: !v.active } }).then(reload)}>
                    <Badge variant={v.active ? "success" : "secondary"}>{v.active ? "Active" : "Inactive"}</Badge>
                  </button>
                </Td>
                <Td>
                  <Button size="icon" variant="ghost" aria-label="Delete vehicle" onClick={() => void api(`/api/test-drive-vehicles/${v.id}`, { method: "DELETE" }).then(reload)}>
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

// ---------------------------------------------------------------- 5. Service, EMI & hours

function ServiceStep() {
  const { data, setData } = useApi<OrgSettings>("/api/settings");
  const { run, note } = useSaver();
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const save = () => run(() => api("/api/settings", { method: "PATCH", json: { emi: data.emi, callingHours: data.callingHours, serviceTypes: data.serviceTypes } }));
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Service types</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.serviceTypes.map((s, i) => (
            <div key={s.type} className="grid grid-cols-5 items-center gap-2">
              <span className="col-span-2 text-sm">{humanize(s.type)}</span>
              <Input className="col-span-2" value={s.label} onChange={(e) => setData({ ...data, serviceTypes: data.serviceTypes.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
              <Input type="number" value={s.durationMinutes} aria-label="Duration minutes" onChange={(e) => setData({ ...data, serviceTypes: data.serviceTypes.map((x, j) => (j === i ? { ...x, durationMinutes: Number(e.target.value) } : x)) })} />
            </div>
          ))}
          {!data.serviceTypes.length && (
            <Button
              variant="outline"
              onClick={() => setData({ ...data, serviceTypes: (["free_service", "paid_service", "repair", "accident", "warranty"] as const).map((t) => ({ type: t, label: humanize(t), durationMinutes: 60, description: "" })) })}
            >
              Add default service types
            </Button>
          )}
          <p className="text-xs text-muted-foreground">Duration in minutes. Slot length and bay count are set per branch.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>EMI defaults & calling hours</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-3">
          <Field label="Interest rate %">
            <Input type="number" step="0.1" value={data.emi.interestRate} onChange={(e) => setData({ ...data, emi: { ...data.emi, interestRate: Number(e.target.value) } })} />
          </Field>
          <Field label="Tenure (months)">
            <Input type="number" value={data.emi.tenureMonths} onChange={(e) => setData({ ...data, emi: { ...data.emi, tenureMonths: Number(e.target.value) } })} />
          </Field>
          <Field label="Down payment %">
            <Input type="number" value={data.emi.downPaymentPercent} onChange={(e) => setData({ ...data, emi: { ...data.emi, downPaymentPercent: Number(e.target.value) } })} />
          </Field>
          <Field label="Outbound calls from (IST)">
            <Input type="time" value={data.callingHours.start} onChange={(e) => setData({ ...data, callingHours: { ...data.callingHours, start: e.target.value } })} />
          </Field>
          <Field label="Until (IST)">
            <Input type="time" value={data.callingHours.end} onChange={(e) => setData({ ...data, callingHours: { ...data.callingHours, end: e.target.value } })} />
          </Field>
          <p className="col-span-3 text-xs text-muted-foreground">Showroom working hours are set per branch in step 2.</p>
        </CardContent>
      </Card>
      <div className="flex items-center gap-3">
        <Button onClick={() => void save()}>Save</Button>
        {note}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 6. Agents & greeting

function AgentsStep() {
  const { data: agents, reload } = useApi<AgentConfig[]>("/api/agents");
  const { data: templates } = useApi<AgentConfig[]>("/api/agent-templates");
  const [sel, setSel] = useState<AgentConfig | null>(null);
  const { run, note } = useSaver();
  const current = sel ?? agents?.[0] ?? null;

  const update = (patch: Partial<AgentConfig>) => current && setSel({ ...current, ...patch });
  const save = () => current && run(async () => { await api(`/api/agents/${current.id}`, { method: "PATCH", json: current }); await reload(); });

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle>Agents</CardTitle>
          <CardDescription>Each agent can own phone numbers for inbound routing.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {agents?.map((a) => (
            <button key={a.id} onClick={() => setSel(a)} className={cn("w-full rounded-md border p-3 text-left text-sm", current?.id === a.id && "border-primary bg-accent")}>
              <p className="font-medium">{a.name}</p>
              <p className="text-xs text-muted-foreground">
                {humanize(a.kind)} · {a.languages.join(", ")} · {a.phoneNumbers.join(", ") || "no number"}
              </p>
            </button>
          ))}
          <p className="pt-2 text-xs font-medium text-muted-foreground">Add from template</p>
          {templates?.filter((t) => !agents?.some((a) => a.id === t.id)).map((t) => (
            <Button key={t.id} variant="outline" size="sm" className="w-full justify-start" onClick={() => void api("/api/agents", { method: "POST", json: t }).then(reload)}>
              + {t.name} ({humanize(t.kind)})
            </Button>
          ))}
        </CardContent>
      </Card>
      {current && (
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{current.name}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <Field label="Agent name">
              <Input value={current.name} onChange={(e) => update({ name: e.target.value })} />
            </Field>
            <Field label="Default language">
              <Select value={current.defaultLanguage} onChange={(e) => update({ defaultLanguage: e.target.value as AgentConfig["defaultLanguage"] })}>
                {["en", "hi", "kn", "hinglish"].map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Languages" hint="Comma separated: en, hi, kn, hinglish">
              <Input value={current.languages.join(", ")} onChange={(e) => update({ languages: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) as AgentConfig["languages"] })} />
            </Field>
            <Field label="Phone numbers" hint="E.164, comma separated">
              <Input value={current.phoneNumbers.join(", ")} onChange={(e) => update({ phoneNumbers: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
            </Field>
            {current.languages.map((l) => (
              <div key={l} className="col-span-2 grid grid-cols-2 gap-3 rounded-md border p-3">
                <Field label={`Greeting (${l})`} hint="Use {showroom_name}">
                  <Textarea rows={2} value={current.greeting[l] ?? ""} onChange={(e) => update({ greeting: { ...current.greeting, [l]: e.target.value } })} />
                </Field>
                <Field label={`Recording disclosure (${l})`}>
                  <Textarea rows={2} value={current.recordingDisclosure[l] ?? ""} onChange={(e) => update({ recordingDisclosure: { ...current.recordingDisclosure, [l]: e.target.value } })} />
                </Field>
              </div>
            ))}
            <Field label="Dealership-specific instructions" className="col-span-2">
              <Textarea rows={6} value={current.extraInstructions} onChange={(e) => update({ extraInstructions: e.target.value })} />
            </Field>
            <div className="col-span-2 flex items-center gap-3">
              <Button onClick={() => void save()}>Save agent</Button>
              {note}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
