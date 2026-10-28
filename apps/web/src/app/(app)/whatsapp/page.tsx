"use client";

import { Bot, Send, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Conversation, Message } from "@axo/shared";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Empty, ErrorNote, Input, PageHeader, Table, Tabs, Td, Th, Tr } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { cn, formatDateTime, humanize, maskPhone } from "@/lib/utils";

type ConvRow = Omit<Conversation, "history">;
interface Status {
  features: { whatsapp: boolean; postCallWhatsapp: boolean; whatsappBot: boolean };
  displayNumber: string;
  provider: string;
  live: boolean;
  limits: { monthlyMessages: number };
}

const STATUS_VARIANT: Record<Message["status"], "success" | "secondary" | "hot" | "warm"> = { sent: "success", logged: "secondary", received: "secondary", failed: "hot", blocked: "warm" };

export default function WhatsappPage() {
  const [tab, setTab] = useState<"chats" | "log">("chats");
  const { data: status } = useApi<Status>("/api/whatsapp/status");
  const off = status && !status.features.whatsapp;

  return (
    <div>
      <PageHeader title="WhatsApp" description="Chats answered by your AI agent, messages sent after calls, and every WhatsApp/SMS sent" actions={<Tabs value={tab} onChange={setTab} items={[{ value: "chats", label: "Chats" }, { value: "log", label: "Message log" }]} />} />
      {status && (
        <div className="mb-4 flex flex-wrap gap-2 text-xs">
          <Badge variant={status.features.whatsapp ? "success" : "hot"}>WhatsApp {status.features.whatsapp ? "on" : "off"}</Badge>
          <Badge variant={status.features.whatsappBot ? "success" : "secondary"}>AI replies {status.features.whatsappBot ? "on" : "off"}</Badge>
          <Badge variant={status.features.postCallWhatsapp ? "success" : "secondary"}>After-call message {status.features.postCallWhatsapp ? "on" : "off"}</Badge>
          <Badge variant="secondary">{status.live ? `Live via ${status.provider}${status.displayNumber ? ` · ${status.displayNumber}` : ""}` : "Demo mode: messages are logged, not delivered"}</Badge>
        </div>
      )}
      {off && <ErrorNote error="WhatsApp is turned off for your account. Contact your service provider to enable it." />}
      {tab === "chats" ? <Chats demo={!status?.live} /> : <MessageLog />}
    </div>
  );
}

function Chats({ demo }: { demo: boolean }) {
  const { data: convs, reload } = useApi<ConvRow[]>("/api/whatsapp/conversations", { refreshMs: 5000 });
  const [selected, setSelected] = useState<string | null>(null);
  const active = selected ?? convs?.[0]?.id ?? null;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Conversations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 p-2 pt-0">
            {!convs?.length && <p className="p-3 text-sm text-muted-foreground">No chats yet. Messages appear here after calls, or when customers message your WhatsApp number.</p>}
            {convs?.map((c) => (
              <button key={c.id} onClick={() => setSelected(c.id)} className={cn("w-full rounded-md px-3 py-2 text-left hover:bg-muted", active === c.id && "bg-accent")}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{c.customerName || maskPhone(c.phone)}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(c.lastMessageAt)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-muted-foreground">{c.lastPreview}</span>
                  {c.unread > 0 && <Badge>{c.unread}</Badge>}
                </div>
              </button>
            ))}
          </CardContent>
        </Card>
        {demo && <Simulator onSent={(id) => (setSelected(id), void reload())} />}
      </div>
      <div className="lg:col-span-2">{active ? <Thread id={active} onChange={() => void reload()} /> : <Empty>Select a conversation.</Empty>}</div>
    </div>
  );
}

function Thread({ id, onChange }: { id: string; onChange: () => void }) {
  const { data, error, reload } = useApi<{ conversation: ConvRow; messages: Message[] }>(`/api/whatsapp/conversations/${id}`, { refreshMs: 4000 });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [data?.messages.length]);

  const c = data?.conversation;
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api(`/api/whatsapp/conversations/${id}/reply`, { method: "POST", json: { text } });
      setText("");
      await reload();
      onChange();
    } finally {
      setBusy(false);
    }
  };
  const toggleBot = async () => {
    if (!c) return;
    await api(`/api/whatsapp/conversations/${id}`, { method: "PATCH", json: { botEnabled: !c.botEnabled } });
    await reload();
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle>{c?.customerName || c?.phone || "…"}</CardTitle>
          <CardDescription>{c?.phone}</CardDescription>
        </div>
        {c && (
          <Button variant={c.botEnabled ? "outline" : "default"} size="sm" onClick={() => void toggleBot()}>
            {c.botEnabled ? (
              <>
                <UserRound className="h-4 w-4" /> Take over chat
              </>
            ) : (
              <>
                <Bot className="h-4 w-4" /> Let AI reply again
              </>
            )}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <ErrorNote error={error} />
        {c?.callContext && <p className="mb-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{c.callContext}</p>}
        <div ref={scrollRef} className="h-[420px] space-y-2 overflow-y-auto rounded-md border bg-muted/30 p-3">
          {data?.messages.map((m) => (
            <div key={m.id} className={cn("flex", m.direction === "in" ? "justify-start" : "justify-end")}>
              <div className={cn("max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm", m.direction === "in" ? "bg-card shadow-sm" : "bg-emerald-600 text-white dark:bg-emerald-700")}>
                {m.body}
                <div className={cn("mt-1 text-[10px]", m.direction === "in" ? "text-muted-foreground" : "text-white/70")}>
                  {formatDateTime(m.createdAt)} · {m.direction === "in" ? "customer" : m.author === "ai" ? "AI" : m.author}
                  {m.status !== "sent" && m.status !== "received" && ` · ${m.status}`}
                </div>
              </div>
            </div>
          ))}
        </div>
        <form onSubmit={send} className="mt-3 flex gap-2">
          <Input placeholder={c?.botEnabled ? "Reply as staff (the AI also replies to new messages)…" : "Reply as staff…"} value={text} onChange={(e) => setText(e.target.value)} />
          <Button disabled={busy || !text.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

const SAMPLES = ["Hi", "What's the on-road price of the Creta?", "What would the EMI be for the Creta?", "Send me the showroom location", "I want a test drive of the Venue tomorrow", "STOP"];

/** Demo mode: type as a customer to see the AI reply, without a real WhatsApp number. */
function Simulator({ onSent }: { onSent: (conversationId: string) => void }) {
  const [phone, setPhone] = useState("+919845012345");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (line: string) => {
    if (!line.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ conversationId: string; skipped?: string }>("/api/whatsapp/simulate", { method: "POST", json: { phone, text: line, name: "Demo customer" } });
      if (res.skipped) setError(`AI did not reply: ${res.skipped}`);
      setText("");
      onSent(res.conversationId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Try it as a customer</CardTitle>
        <CardDescription>Demo mode: send a WhatsApp message as a customer and watch the AI answer.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <ErrorNote error={error} />
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Customer number" />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(text);
          }}
          className="flex gap-2"
        >
          <Input placeholder="Customer message…" value={text} onChange={(e) => setText(e.target.value)} />
          <Button disabled={busy || !text.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
        <div className="flex flex-wrap gap-1.5">
          {SAMPLES.map((s) => (
            <button key={s} type="button" disabled={busy} onClick={() => void send(s)} className="rounded-full border bg-card px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-50">
              {s}
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function MessageLog() {
  const { data, error } = useApi<Message[]>("/api/messages", { refreshMs: 10000 });
  return (
    <Card>
      <ErrorNote error={error} />
      {!data?.length ? (
        <div className="p-5">
          <Empty>No messages yet.</Empty>
        </div>
      ) : (
        <Table>
          <thead>
            <Tr>
              <Th>Time</Th>
              <Th>To / from</Th>
              <Th>Type</Th>
              <Th>Message</Th>
              <Th>Status</Th>
            </Tr>
          </thead>
          <tbody>
            {data.map((m) => (
              <Tr key={m.id}>
                <Td className="whitespace-nowrap text-xs">{formatDateTime(m.createdAt)}</Td>
                <Td className="whitespace-nowrap text-xs">
                  {m.direction === "in" ? "← " : "→ "}
                  {maskPhone(m.phone)}
                  {m.audience === "internal" && <span className="text-muted-foreground"> (staff)</span>}
                </Td>
                <Td className="whitespace-nowrap text-xs">
                  {m.channel === "sms" ? "SMS" : "WhatsApp"} · {m.template ? humanize(m.template) : m.author === "staff" ? "Staff reply" : m.direction === "in" ? "Customer" : "AI reply"}
                </Td>
                <Td className="max-w-md truncate text-xs" title={m.body}>
                  {m.body}
                </Td>
                <Td>
                  <Badge variant={STATUS_VARIANT[m.status]} title={m.error}>
                    {m.status}
                  </Badge>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
