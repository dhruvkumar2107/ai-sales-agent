"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Call } from "@axo/shared";
import { Badge, Card, CardContent, CardHeader, CardTitle, ErrorNote, ScoreBadge, Stat, Table, Td, Th, Tr } from "@/components/ui";
import { API_URL, getToken, useApi } from "@/lib/api";
import { cn, formatDateTime, formatDuration, formatINR2, humanize, lakh } from "@/lib/utils";

export default function CallDetailPage({ params }: { params: { id: string } }) {
  const { data: call, error } = useApi<Call>(`/api/calls/${params.id}`, { refreshMs: 0 });
  const [audioSrc, setAudioSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!call?.recordingPath) return;
    // The recording endpoint decrypts on the fly; pass the token as a query param for the <audio> element.
    void getToken().then((t) => setAudioSrc(`${API_URL}/api/calls/${call.id}/recording?token=${encodeURIComponent(t)}`));
  }, [call?.id, call?.recordingPath]);

  if (error) return <ErrorNote error={error} />;
  if (!call) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const ex = call.extracted ?? {};
  const fields: [string, string | undefined][] = [
    ["Name", ex.name],
    ["Model", [ex.interestedModel, ex.variant].filter(Boolean).join(" ")],
    ["Vehicle type", ex.vehicleType],
    ["Fuel", ex.fuel],
    ["Budget", ex.budget ? lakh(ex.budget) : undefined],
    ["Timeline", ex.timeline ? humanize(ex.timeline) : undefined],
    ["Payment", ex.paymentMode ? humanize(ex.paymentMode) : undefined],
    ["Exchange", ex.hasExchange === undefined ? undefined : ex.hasExchange ? "Yes" : "No"],
    ["City", ex.city],
    ["Intent", ex.buyingIntent ? humanize(ex.buyingIntent) : undefined],
    ["Notes", ex.notes],
  ];

  return (
    <div className="space-y-6">
      <Link href="/calls" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Call logs
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{ex.name ?? (call.direction === "outbound" ? call.to : call.from)}</h1>
        <Badge variant="secondary">{call.direction}</Badge>
        <Badge>{humanize(call.outcome)}</Badge>
        <ScoreBadge score={call.leadScore} />
        {call.sentiment && <Badge variant={call.sentiment === "angry" || call.sentiment === "negative" ? "hot" : "secondary"}>{call.sentiment}</Badge>}
        <span className="text-sm text-muted-foreground">{formatDateTime(call.startedAt)}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Duration" value={formatDuration(call.durationSec)} />
        <Stat label="Avg first audio" value={call.avgFirstAudioMs ? `${call.avgFirstAudioMs} ms` : "-"} hint="target < 1200 ms" />
        <Stat label="Language" value={(call.language ?? "-").toUpperCase()} />
        <Stat label="Total cost" value={formatINR2(call.cost.total)} />
        <Stat label="Recording" value={call.recordingConsent ? "Consented" : "Off"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm">{call.summary ?? "Not available yet."}</p>
              {audioSrc ? <audio controls src={audioSrc} className="w-full" /> : <p className="text-xs text-muted-foreground">No recording stored for this call.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Transcript</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {call.transcript.map((t, i) =>
                t.role === "tool" ? (
                  <details key={i} className="rounded-md bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
                    <summary className="cursor-pointer">Tool: {t.tool}</summary>
                    <pre className="mt-1 whitespace-pre-wrap break-all">{t.text}</pre>
                  </details>
                ) : (
                  <div key={i} className={cn("flex", t.role === "caller" ? "justify-end" : "justify-start")}>
                    <div className={cn("max-w-[80%] rounded-lg px-3 py-2 text-sm", t.role === "caller" ? "bg-primary text-primary-foreground" : "bg-muted")}>
                      <p>{t.text}</p>
                      <p className={cn("mt-0.5 text-[10px]", t.role === "caller" ? "text-primary-foreground/70" : "text-muted-foreground")}>
                        {t.role} · {new Date(t.at).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })}
                        {t.interrupted ? " · interrupted" : ""}
                      </p>
                    </div>
                  </div>
                ),
              )}
            </CardContent>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Extracted fields</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-5 gap-y-2 text-sm">
                {fields.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="col-span-2 text-muted-foreground">{k}</dt>
                    <dd className="col-span-3">{v || "-"}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Latency per turn</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <thead>
                  <tr className="border-b">
                    <Th>Turn</Th>
                    <Th className="text-right">STT</Th>
                    <Th className="text-right">LLM</Th>
                    <Th className="text-right">TTS</Th>
                    <Th className="text-right">First audio</Th>
                  </tr>
                </thead>
                <tbody>
                  {call.latency.map((l) => (
                    <Tr key={l.turn}>
                      <Td>{l.turn}</Td>
                      <Td className="text-right tabular-nums">{l.sttMs ?? "-"}</Td>
                      <Td className="text-right tabular-nums">{l.llmFirstTokenMs ?? "-"}</Td>
                      <Td className="text-right tabular-nums">{l.ttsFirstByteMs ?? "-"}</Td>
                      <Td className={cn("text-right font-medium tabular-nums", l.firstAudioMs > 1200 && "text-destructive")}>{l.firstAudioMs}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
              <p className="mt-2 text-xs text-muted-foreground">Milliseconds from end of caller speech.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Cost breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
                {(["telephony", "stt", "tts", "llm", "messaging"] as const).map((k) => (
                  <div key={k} className="contents">
                    <dt className="uppercase text-muted-foreground">{k}</dt>
                    <dd className="text-right tabular-nums">{formatINR2(call.cost[k])}</dd>
                  </div>
                ))}
                <dt className="font-medium">Total</dt>
                <dd className="text-right font-medium tabular-nums">{formatINR2(call.cost.total)}</dd>
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">
                {call.usage.llmInputTokens.toLocaleString()} in / {call.usage.llmOutputTokens.toLocaleString()} out tokens · {call.usage.ttsChars} TTS chars · {Math.round(call.usage.sttSeconds)}s STT
              </p>
            </CardContent>
          </Card>
          {call.toolCalls.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Tool calls</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                {call.toolCalls.map((t, i) => (
                  <div key={i} className="flex justify-between">
                    <span className={t.ok ? "" : "text-destructive"}>{t.name}</span>
                    <span className="tabular-nums text-muted-foreground">{t.ms} ms</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
