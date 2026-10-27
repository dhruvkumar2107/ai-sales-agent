"use client";

import Link from "next/link";
import { useState } from "react";
import { CALL_OUTCOMES, type Call } from "@axo/shared";
import { Badge, Card, Empty, ErrorNote, Input, PageHeader, ScoreBadge, Select, Table, Td, Th, Tr } from "@/components/ui";
import { useApi } from "@/lib/api";
import { formatDateTime, formatDuration, formatINR2, humanize, maskPhone } from "@/lib/utils";

type CallRow = Omit<Call, "transcript"> & { turns: number };

export default function CallsPage() {
  const [f, setF] = useState({ q: "", direction: "", outcome: "", leadScore: "", sentiment: "", from: "", to: "" });
  const params = new URLSearchParams(
    Object.entries({ ...f, from: f.from ? new Date(f.from).toISOString() : "", to: f.to ? new Date(`${f.to}T23:59:59`).toISOString() : "" }).filter(([, v]) => v),
  ).toString();
  const { data, error } = useApi<CallRow[]>(`/api/calls${params ? `?${params}` : ""}`, { refreshMs: 15000 });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <div>
      <PageHeader title="Call logs" description="Every call with transcript, summary, extracted fields, latency and cost" />
      <ErrorNote error={error} />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input className="w-56" placeholder="Search name, number, summary" value={f.q} onChange={set("q")} />
        <Select className="w-32" value={f.direction} onChange={set("direction")}>
          <option value="">Direction</option>
          <option value="inbound">Inbound</option>
          <option value="outbound">Outbound</option>
          <option value="web">Web</option>
        </Select>
        <Select className="w-44" value={f.outcome} onChange={set("outcome")}>
          <option value="">Any outcome</option>
          {CALL_OUTCOMES.map((o) => (
            <option key={o} value={o}>
              {humanize(o)}
            </option>
          ))}
        </Select>
        <Select className="w-28" value={f.leadScore} onChange={set("leadScore")}>
          <option value="">Score</option>
          <option value="hot">Hot</option>
          <option value="warm">Warm</option>
          <option value="cold">Cold</option>
        </Select>
        <Select className="w-32" value={f.sentiment} onChange={set("sentiment")}>
          <option value="">Sentiment</option>
          {["positive", "neutral", "negative", "angry"].map((s) => (
            <option key={s} value={s}>
              {humanize(s)}
            </option>
          ))}
        </Select>
        <Input type="date" className="w-40" value={f.from} onChange={set("from")} aria-label="From date" />
        <Input type="date" className="w-40" value={f.to} onChange={set("to")} aria-label="To date" />
      </div>
      <Card>
        {!data?.length ? (
          <div className="p-5">
            <Empty>No calls match these filters.</Empty>
          </div>
        ) : (
          <Table>
            <thead>
              <tr className="border-b">
                <Th>When</Th>
                <Th>Customer</Th>
                <Th>Direction</Th>
                <Th>Outcome</Th>
                <Th>Score</Th>
                <Th>Sentiment</Th>
                <Th>Lang</Th>
                <Th className="text-right">Duration</Th>
                <Th className="text-right">First audio</Th>
                <Th className="text-right">Cost</Th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <Tr key={c.id} className="cursor-pointer">
                  <Td className="whitespace-nowrap">
                    <Link href={`/calls/${c.id}`} className="hover:underline">
                      {formatDateTime(c.startedAt)}
                    </Link>
                  </Td>
                  <Td>
                    <Link href={`/calls/${c.id}`} className="block max-w-[220px]">
                      <span className="font-medium">{c.extracted?.name ?? maskPhone(c.direction === "outbound" ? c.to : c.from)}</span>
                      <span className="block truncate text-xs text-muted-foreground">{c.summary ?? (c.status === "in_progress" ? "Live now…" : "")}</span>
                    </Link>
                  </Td>
                  <Td>
                    <Badge variant="secondary">{c.direction}</Badge>
                  </Td>
                  <Td className="whitespace-nowrap">{humanize(c.outcome)}</Td>
                  <Td>
                    <ScoreBadge score={c.leadScore} />
                  </Td>
                  <Td>{humanize(c.sentiment)}</Td>
                  <Td className="uppercase">{c.language ?? "-"}</Td>
                  <Td className="text-right tabular-nums">{formatDuration(c.durationSec)}</Td>
                  <Td className={`text-right tabular-nums ${c.avgFirstAudioMs && c.avgFirstAudioMs > 1200 ? "text-destructive" : ""}`}>{c.avgFirstAudioMs ? `${c.avgFirstAudioMs} ms` : "-"}</Td>
                  <Td className="text-right tabular-nums">{formatINR2(c.cost?.total)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
