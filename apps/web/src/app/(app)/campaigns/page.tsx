"use client";

import { Pause, Play, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { CAMPAIGN_TYPES, type AgentConfig, type Campaign, type CampaignContact } from "@axo/shared";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, Empty, ErrorNote, Field, Input, PageHeader, Select, Table, Td, Textarea, Th, Tr } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { formatDateTime, humanize } from "@/lib/utils";

const STATUS_VARIANT: Record<string, "success" | "secondary" | "warm" | "default"> = { running: "success", paused: "warm", completed: "secondary", draft: "default" };

export default function CampaignsPage() {
  const { data, error, reload } = useApi<Campaign[]>("/api/campaigns", { refreshMs: 5000 });
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div>
      <PageHeader
        title="Campaigns"
        description="Outbound calling between your calling hours (IST) with retries, DND and opt-out checks"
        actions={
          <>
            <Button variant="outline" onClick={() => void act(() => api("/api/campaigns/run-reminders", { method: "POST" }))}>
              <RefreshCw className="h-4 w-4" /> Run reminder scan
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> New campaign
            </Button>
          </>
        }
      />
      <ErrorNote error={error ?? err} />
      {!data?.length && <Empty>No campaigns yet. Create one, or wait for automatic follow-ups and reminders.</Empty>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data?.map((c) => {
          const done = c.stats.completed + c.stats.failed + c.stats.optedOut + c.stats.skippedDnd;
          const progress = c.stats.total ? Math.round((done / c.stats.total) * 100) : 0;
          return (
            <Card key={c.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <button className="text-left" onClick={() => setOpenId(c.id)}>
                    <CardTitle className="hover:underline">{c.name}</CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">{humanize(c.type)}</p>
                  </button>
                  <Badge variant={STATUS_VARIANT[c.status]}>{c.status}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                    <span>
                      {done} / {c.stats.total} done
                    </span>
                    <span>{progress}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2 text-center text-xs">
                  {[
                    ["Queued", c.stats.queued],
                    ["Connected", c.stats.connected],
                    ["Failed", c.stats.failed],
                    ["DND/opt-out", c.stats.skippedDnd + c.stats.optedOut],
                  ].map(([k, v]) => (
                    <div key={k as string} className="rounded-md bg-muted/60 py-1.5">
                      <p className="text-base font-semibold tabular-nums">{v}</p>
                      <p className="text-muted-foreground">{k}</p>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  {c.status === "running" ? (
                    <Button size="sm" variant="outline" onClick={() => void act(() => api(`/api/campaigns/${c.id}/pause`, { method: "POST" }))}>
                      <Pause className="h-3.5 w-3.5" /> Pause
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => void act(() => api(`/api/campaigns/${c.id}/start`, { method: "POST" }))} disabled={!c.stats.total}>
                      <Play className="h-3.5 w-3.5" /> {c.status === "draft" ? "Start" : "Resume"}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setOpenId(c.id)}>
                    Contacts
                  </Button>
                  <Button size="icon" variant="ghost" className="ml-auto" aria-label="Delete campaign" onClick={() => confirm(`Delete "${c.name}"?`) && void act(() => api(`/api/campaigns/${c.id}`, { method: "DELETE" }))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      {creating && <NewCampaign onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setOpenId(id); void reload(); }} />}
      {openId && <CampaignDetail id={openId} onClose={() => setOpenId(null)} onChanged={() => void reload()} />}
    </div>
  );
}

function NewCampaign({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { data: agents } = useApi<AgentConfig[]>("/api/agents");
  const [f, setF] = useState({ name: "", type: "festive_offer", agentId: "", script: "", maxAttempts: 3, concurrency: 3, retry: "30, 120, 1440" });
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const c = await api<Campaign>("/api/campaigns", {
        method: "POST",
        json: { name: f.name, type: f.type, agentId: f.agentId || undefined, script: f.script, maxAttempts: Number(f.maxAttempts), concurrency: Number(f.concurrency), retryMinutes: f.retry.split(",").map((x) => Number(x.trim())).filter(Boolean) },
      });
      onCreated(c.id);
    } catch (e2) {
      setErr((e2 as Error).message);
    }
  };
  return (
    <Dialog open onClose={onClose} title="New campaign">
      <form onSubmit={submit} className="space-y-3">
        <ErrorNote error={err} />
        <Field label="Name">
          <Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Diwali offers - Creta owners" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              {CAMPAIGN_TYPES.map((t) => (
                <option key={t} value={t}>
                  {humanize(t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Agent">
            <Select value={f.agentId} onChange={(e) => setF({ ...f, agentId: e.target.value })}>
              <option value="">Default agent</option>
              {agents?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Brief for the agent" hint="Facts only: offer details, dates, what to ask. The agent won't invent anything beyond this.">
          <Textarea value={f.script} onChange={(e) => setF({ ...f, script: e.target.value })} />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Max attempts">
            <Input type="number" min={1} max={6} value={f.maxAttempts} onChange={(e) => setF({ ...f, maxAttempts: Number(e.target.value) })} />
          </Field>
          <Field label="Concurrent calls">
            <Input type="number" min={1} max={50} value={f.concurrency} onChange={(e) => setF({ ...f, concurrency: Number(e.target.value) })} />
          </Field>
          <Field label="Retry after (min)">
            <Input value={f.retry} onChange={(e) => setF({ ...f, retry: e.target.value })} />
          </Field>
        </div>
        <Button className="w-full">Create</Button>
      </form>
    </Dialog>
  );
}

function CampaignDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { data, reload } = useApi<{ campaign: Campaign; contacts: CampaignContact[] }>(`/api/campaigns/${id}`, { refreshMs: 5000 });
  const [csv, setCsv] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const upload = async (text: string) => {
    try {
      const r = await api<{ parsed: number; added: number }>(`/api/campaigns/${id}/contacts`, { method: "POST", body: text, headers: { "content-type": "text/csv" } });
      setMsg(`Added ${r.added} of ${r.parsed} contacts`);
      setCsv("");
      await reload();
      onChanged();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  if (!data) return null;
  return (
    <Dialog open onClose={onClose} title={data.campaign.name} wide>
      <div className="space-y-4">
        {data.campaign.script && <p className="rounded-md bg-muted p-3 text-sm">{data.campaign.script}</p>}
        <div className="space-y-2">
          <p className="text-sm font-medium">Upload contacts (CSV)</p>
          <p className="text-xs text-muted-foreground">Columns: phone (required), name, plus any extra columns (vehicle, model, expiry…) which the agent receives as context.</p>
          <div className="flex gap-2">
            <label className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted">
              <Upload className="h-4 w-4" /> Choose file
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void file.text().then(upload); }} />
            </label>
            <Textarea rows={2} className="font-mono text-xs" placeholder={"phone,name,model\n9845012345,Rahul,Creta"} value={csv} onChange={(e) => setCsv(e.target.value)} />
            <Button variant="outline" disabled={!csv.trim()} onClick={() => void upload(csv)}>
              Add
            </Button>
          </div>
          {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
        </div>
        <div className="max-h-[380px] overflow-y-auto">
          <Table>
            <thead>
              <tr className="border-b">
                <Th>Contact</Th>
                <Th>Status</Th>
                <Th>Attempts</Th>
                <Th>Last outcome</Th>
                <Th>Next attempt</Th>
              </tr>
            </thead>
            <tbody>
              {data.contacts.map((c) => (
                <Tr key={c.id}>
                  <Td>
                    <p className="font-medium">{c.name ?? "-"}</p>
                    <p className="text-xs text-muted-foreground">{c.phone}</p>
                  </Td>
                  <Td>
                    <Badge variant={c.status === "completed" ? "success" : c.status === "failed" ? "hot" : "secondary"}>{humanize(c.status)}</Badge>
                  </Td>
                  <Td className="tabular-nums">{c.attempts}</Td>
                  <Td>{humanize(c.lastOutcome)}</Td>
                  <Td className="text-xs">{c.nextAttemptAt ? formatDateTime(c.nextAttemptAt) : "-"}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          {!data.contacts.length && <Empty>No contacts yet.</Empty>}
        </div>
      </div>
    </Dialog>
  );
}
