"use client";

import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { LEAD_STAGES, type Branch, type Lead, type LeadStage, type Member } from "@axo/shared";
import { Badge, Button, Dialog, ErrorNote, Field, Input, PageHeader, ScoreBadge, Select, Textarea } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { cn, formatDateTime, humanize, lakh } from "@/lib/utils";

const STAGE_LABEL: Record<LeadStage, string> = { new: "New", contacted: "Contacted", test_drive_booked: "Test drive booked", negotiation: "Negotiation", won: "Won", lost: "Lost" };

export default function LeadsPage() {
  const [q, setQ] = useState("");
  const [score, setScore] = useState("");
  const [branchId, setBranchId] = useState("");
  const params = new URLSearchParams(Object.entries({ q, score, branchId }).filter(([, v]) => v)).toString();
  const { data: leads, setData, error, reload } = useApi<Lead[]>(`/api/leads${params ? `?${params}` : ""}`, { refreshMs: 15000 });
  const { data: team } = useApi<Member[]>("/api/team");
  const { data: branches } = useApi<Branch[]>("/api/branches");
  const [dragId, setDragId] = useState<string | null>(null);
  const [open, setOpen] = useState<Lead | null>(null);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const byStage = useMemo(() => Object.fromEntries(LEAD_STAGES.map((s) => [s, (leads ?? []).filter((l) => l.stage === s)])) as Record<LeadStage, Lead[]>, [leads]);
  const execName = (id?: string) => team?.find((m) => m.id === id)?.name ?? "Unassigned";

  const move = async (id: string, stage: LeadStage) => {
    setData((prev) => prev?.map((l) => (l.id === id ? { ...l, stage } : l)));
    try {
      await api(`/api/leads/${id}`, { method: "PATCH", json: { stage } });
    } catch (e) {
      setErr((e as Error).message);
      void reload();
    }
  };

  return (
    <div>
      <PageHeader
        title="Leads"
        description="Drag cards between stages. New leads are auto-assigned by branch and model."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Add lead
          </Button>
        }
      />
      <ErrorNote error={error ?? err} />
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="w-64 pl-8" placeholder="Search name, phone, model" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select className="w-36" value={score} onChange={(e) => setScore(e.target.value)}>
          <option value="">All scores</option>
          <option value="hot">Hot</option>
          <option value="warm">Warm</option>
          <option value="cold">Cold</option>
        </Select>
        <Select className="w-56" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
          <option value="">All branches</option>
          {branches?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-4">
        {LEAD_STAGES.map((stage) => (
          <div
            key={stage}
            className="flex w-72 shrink-0 flex-col rounded-lg bg-muted/60 p-2"
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragId) void move(dragId, stage);
              setDragId(null);
            }}
          >
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="text-sm font-medium">{STAGE_LABEL[stage]}</span>
              <Badge variant="secondary">{byStage[stage].length}</Badge>
            </div>
            <div className="flex min-h-24 flex-col gap-2">
              {byStage[stage].map((l) => (
                <button
                  key={l.id}
                  draggable
                  onDragStart={() => setDragId(l.id)}
                  onClick={() => setOpen(l)}
                  className={cn("rounded-md border bg-card p-3 text-left text-sm shadow-sm transition hover:shadow", dragId === l.id && "opacity-50")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{l.name ?? l.phone}</span>
                    <ScoreBadge score={l.score} />
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {l.interestedModel ?? "Model not captured"}
                    {l.budget ? ` · ${lakh(l.budget)}` : ""}
                  </p>
                  <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>{humanize(l.source)}</span>
                    <span>{execName(l.assignedTo)}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {open && <LeadDialog lead={open} team={team ?? []} onClose={() => setOpen(null)} onSaved={(l) => { setData((prev) => prev?.map((x) => (x.id === l.id ? l : x))); setOpen(l); }} />}
      {creating && <NewLeadDialog onClose={() => setCreating(false)} onCreated={() => { setCreating(false); void reload(); }} />}
    </div>
  );
}

function LeadDialog({ lead, team, onClose, onSaved }: { lead: Lead; team: Member[]; onClose: () => void; onSaved: (l: Lead) => void }) {
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const patch = async (body: Record<string, unknown>) => {
    try {
      onSaved(await api<Lead>(`/api/leads/${lead.id}`, { method: "PATCH", json: body }));
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const rows: [string, string | undefined][] = [
    ["Phone", lead.phone],
    ["Model", [lead.interestedModel, lead.variant].filter(Boolean).join(" ")],
    ["Budget", lead.budget ? lakh(lead.budget) : undefined],
    ["Fuel", lead.fuel],
    ["Timeline", humanize(lead.timeline)],
    ["Payment", humanize(lead.paymentMode)],
    ["Exchange", lead.hasExchange ? `${lead.exchangeVehicle?.make ?? ""} ${lead.exchangeVehicle?.model ?? ""} ${lead.exchangeVehicle?.year ?? ""} ${lead.exchangeVehicle?.kilometres ? `${lead.exchangeVehicle.kilometres} km` : ""}` : "No"],
    ["City", lead.city],
    ["Language", lead.language],
    ["Created", formatDateTime(lead.createdAt)],
  ];
  return (
    <Dialog open onClose={onClose} title={lead.name ?? lead.phone} wide>
      <ErrorNote error={err} />
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <dl className="grid grid-cols-3 gap-y-2 text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="col-span-2">{v || "-"}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Field label="Stage">
              <Select value={lead.stage} onChange={(e) => void patch({ stage: e.target.value })}>
                {LEAD_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {STAGE_LABEL[s]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Assigned to">
              <Select value={lead.assignedTo ?? ""} onChange={(e) => void patch({ assignedTo: e.target.value || undefined })}>
                <option value="">Unassigned</option>
                {team.filter((m) => m.role === "sales_executive" || m.role === "sales_manager").map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Score">
              <Select value={lead.score} onChange={(e) => void patch({ score: e.target.value })}>
                <option value="hot">Hot</option>
                <option value="warm">Warm</option>
                <option value="cold">Cold</option>
              </Select>
            </Field>
            {lead.stage === "won" && (
              <Field label="Revenue (₹)">
                <Input type="number" defaultValue={lead.revenue} onBlur={(e) => void patch({ revenue: Number(e.target.value) || undefined })} />
              </Field>
            )}
          </div>
          {lead.lastCallId && (
            <Link href={`/calls/${lead.lastCallId}`} className="mt-4 inline-block text-sm text-primary hover:underline">
              Open last call →
            </Link>
          )}
        </div>
        <div className="flex flex-col">
          <p className="mb-2 text-sm font-medium">Notes</p>
          <div className="flex-1 space-y-2 overflow-y-auto rounded-md border p-2 text-sm" style={{ maxHeight: 260 }}>
            {!lead.notesLog.length && <p className="text-muted-foreground">No notes yet.</p>}
            {lead.notesLog.map((n, i) => (
              <div key={i}>
                <p>{n.text}</p>
                <p className="text-xs text-muted-foreground">
                  {n.by} · {formatDateTime(n.at)}
                </p>
              </div>
            ))}
          </div>
          <Textarea className="mt-2" placeholder="Add a note…" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button className="mt-2 self-end" size="sm" disabled={!note.trim()} onClick={() => void patch({ note }).then(() => setNote(""))}>
            Add note
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function NewLeadDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [f, setF] = useState({ name: "", phone: "", interestedModel: "", source: "walk_in", notes: "" });
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api("/api/leads", { method: "POST", json: { ...f, note: f.notes || undefined } });
      onCreated();
    } catch (e2) {
      setErr((e2 as Error).message);
    }
  };
  return (
    <Dialog open onClose={onClose} title="Add lead">
      <form onSubmit={submit} className="space-y-3">
        <ErrorNote error={err} />
        <Field label="Name">
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Phone">
          <Input required value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="98450 12345" />
        </Field>
        <Field label="Interested model">
          <Input value={f.interestedModel} onChange={(e) => setF({ ...f, interestedModel: e.target.value })} />
        </Field>
        <Field label="Source">
          <Select value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>
            {["walk_in", "website", "facebook", "instagram", "referral", "other"].map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notes">
          <Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
        <Button className="w-full">Create lead</Button>
      </form>
    </Dialog>
  );
}
