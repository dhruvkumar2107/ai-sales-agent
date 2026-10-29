"use client";

import { ExternalLink, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PLAN_IDS, PLANS } from "@axo/shared";
import { Badge, Button, Card, Dialog, Empty, ErrorNote, Field, Input, PageHeader, Select, Stat, Table, Td, Th, Tr } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { formatDateTime, formatINR } from "@/lib/utils";
import { AddBusinessDialog } from "./business";
import { openDealerDashboard, type DealerRow } from "./shared";

interface Overview {
  month: string;
  totals: { dealers: number; active: number; calls: number; minutes: number; messages: number; whatsappChats: number; leads: number; testDrives: number; cost: number; revenue: number; monthlyRevenue: number; setupFees: number; setupFeesDue: number; profit: number };
  partners: { name: string; share: number; amount: number }[];
  dealers: DealerRow[];
}

export default function AdminOverviewPage() {
  const [month, setMonth] = useState("");
  const { data, error, reload } = useApi<Overview>(`/admin/overview${month ? `?month=${month}` : ""}`, { refreshMs: 30000 });
  const [creating, setCreating] = useState(false);
  const [addingBusiness, setAddingBusiness] = useState(false);
  const t = data?.totals;

  return (
    <div>
      <PageHeader
        title="Businesses"
        description="Every business you've sold to: usage, what they owe you, your cost and profit"
        actions={
          <>
            <Input type="month" className="w-40" value={month || data?.month || ""} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />
            <Button variant="outline" onClick={() => setCreating(true)}>
              Add vehicle showroom
            </Button>
            <Button onClick={() => setAddingBusiness(true)}>
              <Plus className="h-4 w-4" /> Add business
            </Button>
          </>
        }
      />
      <ErrorNote error={error} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Stat label="Businesses" value={t ? `${t.active}/${t.dealers}` : "-"} hint="active / total" />
        <Stat label="Calls" value={t?.calls ?? "-"} hint={t ? `${t.minutes} minutes` : undefined} />
        <Stat label="WhatsApp sent" value={t?.messages ?? "-"} hint={t ? `${t.whatsappChats} chats` : undefined} />
        <Stat label="Leads" value={t?.leads ?? "-"} hint={t ? `${t.testDrives} test drives` : undefined} />
        <Stat label="Revenue" value={formatINR(t?.revenue)} hint={t ? `${formatINR(t.monthlyRevenue)} plans + ${formatINR(t.setupFees)} setup` : undefined} />
        <Stat label="Your cost" value={formatINR(t?.cost)} hint="calls, messages, gateway" />
        <Stat label="Profit" value={formatINR(t?.profit)} hint={t?.setupFeesDue ? `${formatINR(t.setupFeesDue)} setup fees due` : undefined} />
      </div>
      {data?.partners && (
        <div className="mb-6 flex flex-wrap gap-3">
          {data.partners.map((p) => (
            <div key={p.name} className="rounded-lg border bg-card px-4 py-2.5">
              <span className="text-xs text-muted-foreground">
                {p.name} · {p.share}%
              </span>
              <div className={`text-lg font-semibold tabular-nums ${p.amount < 0 ? "text-red-600" : "text-emerald-600"}`}>{formatINR(p.amount)}</div>
            </div>
          ))}
          <Link href="/admin/settings" className="self-center text-xs text-muted-foreground hover:underline">
            Change partners
          </Link>
        </div>
      )}

      <Card>
        {!data?.dealers.length ? (
          <div className="p-5">
            <Empty>No businesses yet. Click "Add business" to onboard your first customer.</Empty>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <Tr>
                  <Th>Business</Th>
                  <Th>Plan</Th>
                  <Th>Minutes used</Th>
                  <Th>Calls</Th>
                  <Th>WhatsApp</Th>
                  <Th>Leads</Th>
                  <Th>Revenue</Th>
                  <Th>Cost</Th>
                  <Th>Profit</Th>
                  <Th>Last call</Th>
                  <Th />
                </Tr>
              </thead>
              <tbody>
                {data.dealers.map(({ org, usage, billing }) => {
                  const pct = billing.includedMinutes ? Math.min(100, Math.round((usage.minutes / billing.includedMinutes) * 100)) : 0;
                  return (
                    <Tr key={org.id}>
                      <Td>
                        <Link href={`/admin/dealers/${org.id}`} className="font-medium hover:underline">
                          {org.name}
                        </Link>
                        <div className="text-xs text-muted-foreground">{org.platform.contact.name || org.showroomName}</div>
                      </Td>
                      <Td>
                        <div className="flex flex-wrap gap-1">
                          <Badge variant="secondary">{billing.planLabel}</Badge>
                          {org.status === "suspended" && <Badge variant="hot">suspended</Badge>}
                          {!org.platform.features.whatsapp && <Badge variant="warm">WhatsApp off</Badge>}
                          {billing.setupFeeDue > 0 && <Badge variant="warm">setup due</Badge>}
                        </div>
                      </Td>
                      <Td className="min-w-[140px]">
                        <div className="text-sm tabular-nums">
                          {usage.minutes} / {billing.includedMinutes}
                          {billing.overageMinutes > 0 && <span className="text-amber-600"> (+{billing.overageMinutes})</span>}
                        </div>
                        <div className="mt-1 h-1.5 w-full rounded-full bg-muted">
                          <div className={`h-1.5 rounded-full ${pct >= 100 ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${pct}%` }} />
                        </div>
                      </Td>
                      <Td className="tabular-nums">{usage.calls}</Td>
                      <Td className="tabular-nums">
                        {usage.messages}
                        <span className="text-xs text-muted-foreground"> · {usage.whatsappChats} chats</span>
                      </Td>
                      <Td className="tabular-nums">
                        {usage.leads}
                        {usage.hotLeads > 0 && <span className="text-xs text-red-600"> · {usage.hotLeads} hot</span>}
                      </Td>
                      <Td className="tabular-nums">{formatINR(billing.revenue)}</Td>
                      <Td className="tabular-nums">{formatINR(billing.cost)}</Td>
                      <Td className={`tabular-nums font-medium ${billing.profit < 0 ? "text-red-600" : "text-emerald-600"}`}>{formatINR(billing.profit)}</Td>
                      <Td className="whitespace-nowrap text-xs">{formatDateTime(usage.lastCallAt)}</Td>
                      <Td>
                        <div className="flex gap-1">
                          <Link href={`/admin/dealers/${org.id}`}>
                            <Button variant="outline" size="sm">
                              Manage
                            </Button>
                          </Link>
                          <Button variant="ghost" size="sm" onClick={() => openDealerDashboard(org.id)} title="Open their dashboard">
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
      <CreateDealer open={creating} onClose={() => setCreating(false)} onCreated={() => void reload()} />
      <AddBusinessDialog open={addingBusiness} onClose={() => setAddingBusiness(false)} onCreated={() => void reload()} />
    </div>
  );
}

function CreateDealer({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [f, setF] = useState({ name: "", showroomName: "", plan: "starter", ownerName: "", ownerEmail: "", ownerPhone: "", agentTemplate: "agent-car-showroom" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/admin/orgs", { method: "POST", json: f });
      onCreated();
      onClose();
      setF({ ...f, name: "", showroomName: "", ownerName: "", ownerEmail: "", ownerPhone: "" });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Add vehicle showroom">
      <ErrorNote error={error} />
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Dealership name">
            <Input value={f.name} onChange={set("name")} placeholder="Sri Ganesh Honda" required />
          </Field>
          <Field label="Name the AI says on calls" hint="Defaults to the dealership name">
            <Input value={f.showroomName} onChange={set("showroomName")} placeholder="Ganesh Honda" />
          </Field>
          <Field label="Plan">
            <Select value={f.plan} onChange={set("plan")}>
              {PLAN_IDS.map((p) => (
                <option key={p} value={p}>
                  {PLANS[p].label} · {formatINR(PLANS[p].price)}/month · {PLANS[p].minutes} min
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Starting agent">
            <Select value={f.agentTemplate} onChange={set("agentTemplate")}>
              <option value="agent-car-showroom">Car showroom</option>
              <option value="agent-two-wheeler">Two-wheeler showroom</option>
              <option value="agent-service-center">Service center</option>
            </Select>
          </Field>
          <Field label="Owner name">
            <Input value={f.ownerName} onChange={set("ownerName")} />
          </Field>
          <Field label="Owner phone">
            <Input value={f.ownerPhone} onChange={set("ownerPhone")} placeholder="+91…" />
          </Field>
        </div>
        <Field label="Owner login email" hint="They sign in with this email and land in their own dashboard">
          <Input type="email" value={f.ownerEmail} onChange={set("ownerEmail")} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || !f.name.trim()}>Create dealership</Button>
        </div>
      </form>
    </Dialog>
  );
}
