"use client";

import { Mic, MicOff, Phone, PhoneOff, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AgentConfig } from "@axo/shared";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, ErrorNote, Field, Input, PageHeader, ScoreBadge, Select, Tabs } from "@/components/ui";
import { api, getToken, useApi, wsUrl } from "@/lib/api";
import { cn, formatINR2, humanize } from "@/lib/utils";

interface Line {
  role: "agent" | "caller" | "system";
  text: string;
  interrupted?: boolean;
}

/** AudioWorklet: capture mic, downsample to 16 kHz, emit 20 ms Int16 frames. */
const WORKLET = `
class Capture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = []; this.ratio = sampleRate / 16000; this.pos = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.pos += 1;
      if (this.pos >= this.ratio) { this.pos -= this.ratio; this.buf.push(ch[i]); }
    }
    while (this.buf.length >= 320) {
      const frame = this.buf.splice(0, 320);
      const out = new Int16Array(320);
      for (let i = 0; i < 320; i++) { const s = Math.max(-1, Math.min(1, frame[i])); out[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
      this.port.postMessage(out.buffer, [out.buffer]);
    }
    return true;
  }
}
registerProcessor("capture", Capture);
`;

export default function ConsolePage() {
  const { data: agents } = useApi<AgentConfig[]>("/api/agents");
  const [agentId, setAgentId] = useState("");
  const [mode, setMode] = useState<"voice" | "text">("voice");
  const [lines, setLines] = useState<Line[]>([]);
  const [connected, setConnected] = useState(false);
  const [latencies, setLatencies] = useState<number[]>([]);
  const [summary, setSummary] = useState<{ outcome?: string; summary?: string; leadScore?: string; cost?: { total: number }; callId?: string } | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [dialStatus, setDialStatus] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const playheadRef = useRef(0);
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!agentId && agents?.length) setAgentId(agents[0]!.id);
  }, [agents, agentId]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines]);
  useEffect(() => () => stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const playPcm = (buf: ArrayBuffer) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const pcm = new Int16Array(buf);
    const audio = ctx.createBuffer(1, pcm.length, 16000);
    const ch = audio.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i]! / 0x8000;
    const src = ctx.createBufferSource();
    src.buffer = audio;
    src.connect(ctx.destination);
    const at = Math.max(ctx.currentTime + 0.02, playheadRef.current);
    src.start(at);
    playheadRef.current = at + audio.duration;
    sourcesRef.current.push(src);
    src.onended = () => (sourcesRef.current = sourcesRef.current.filter((s) => s !== src));
  };

  /** Barge-in: drop everything queued for playback. */
  const flushPlayback = () => {
    for (const s of sourcesRef.current) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    sourcesRef.current = [];
    playheadRef.current = 0;
  };

  const start = async () => {
    setError(null);
    setLines([]);
    setLatencies([]);
    setSummary(null);
    try {
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const token = await getToken();
      const ws = new WebSocket(wsUrl(`/ws/console?${new URLSearchParams({ token, agentId, mode })}`));
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onmessage = (ev) => {
        if (ev.data instanceof ArrayBuffer) return playPcm(ev.data);
        const msg = JSON.parse(ev.data as string);
        if (msg.type === "transcript" && (msg.role === "agent" || msg.role === "caller")) setLines((l) => [...l, { role: msg.role, text: msg.text, interrupted: msg.interrupted }]);
        if (msg.type === "clear" || msg.type === "barge_in") flushPlayback();
        if (msg.type === "latency") setLatencies((l) => [...l, msg.firstAudioMs]);
        if (msg.type === "transfer") setLines((l) => [...l, { role: "system", text: `Transfer requested to ${msg.number}. Browser calls can't be bridged, so a callback is scheduled.` }]);
        if (msg.type === "call_summary") setSummary(msg);
        if (msg.type === "ended") setLines((l) => [...l, { role: "system", text: "Call ended by agent." }]);
        if (msg.type === "error") setError(msg.message);
      };
      ws.onclose = () => {
        setConnected(false);
        stopMic();
      };
      ws.onopen = async () => {
        setConnected(true);
        if (mode === "voice") {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
          streamRef.current = stream;
          const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
          await ctx.audioWorklet.addModule(url);
          const node = new AudioWorkletNode(ctx, "capture");
          node.port.onmessage = (e) => ws.readyState === WebSocket.OPEN && ws.send(e.data as ArrayBuffer);
          ctx.createMediaStreamSource(stream).connect(node);
        }
      };
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const stopMic = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const stop = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ type: "hangup" }));
    stopMic();
    flushPlayback();
  };

  const sendText = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || wsRef.current?.readyState !== WebSocket.OPEN) return;
    flushPlayback();
    wsRef.current.send(JSON.stringify({ type: "text", text }));
    setText("");
  };

  const callMyPhone = async () => {
    setDialStatus("Dialling…");
    try {
      const res = await api<{ status: string; reason?: string; error?: string }>("/api/console/call", { method: "POST", json: { phone, agentId } });
      setDialStatus(res.status === "placed" ? "Ringing your phone. Answer to talk to the agent." : `Not placed: ${res.reason ?? res.error ?? res.status}`);
    } catch (e) {
      setDialStatus((e as Error).message);
    }
  };

  const avg = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null;

  return (
    <div>
      <PageHeader title="Test console" description="Talk to your agent in the browser, chat by text, or have it call your phone" />
      <ErrorNote error={error} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
            <div className="flex flex-wrap items-center gap-2">
              <Select className="w-56" value={agentId} onChange={(e) => setAgentId(e.target.value)} disabled={connected}>
                {agents?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {humanize(a.kind)} ({a.languages.join("/")})
                  </option>
                ))}
              </Select>
              <Tabs value={mode} onChange={(v) => !connected && setMode(v)} items={[{ value: "voice", label: "Voice" }, { value: "text", label: "Text" }]} />
            </div>
            {connected ? (
              <Button variant="destructive" onClick={stop}>
                <PhoneOff className="h-4 w-4" /> Hang up
              </Button>
            ) : (
              <Button onClick={() => void start()} disabled={!agentId}>
                {mode === "voice" ? <Mic className="h-4 w-4" /> : <Send className="h-4 w-4" />} Start test call
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <div ref={scrollRef} className="h-[420px] space-y-2 overflow-y-auto rounded-md border bg-muted/30 p-3">
              {!lines.length && (
                <p className="pt-24 text-center text-sm text-muted-foreground">
                  {mode === "voice" ? "Start the call and speak. You can interrupt the agent at any time." : "Start the call, then type as the customer would speak."}
                </p>
              )}
              {lines.map((l, i) =>
                l.role === "system" ? (
                  <p key={i} className="text-center text-xs text-muted-foreground">
                    {l.text}
                  </p>
                ) : (
                  <div key={i} className={cn("flex", l.role === "caller" ? "justify-end" : "justify-start")}>
                    <div className={cn("max-w-[80%] rounded-lg px-3 py-2 text-sm", l.role === "caller" ? "bg-primary text-primary-foreground" : "bg-card shadow-sm")}>
                      {l.text}
                      {l.interrupted && <span className="ml-1 text-xs opacity-60">(interrupted)</span>}
                    </div>
                  </div>
                ),
              )}
            </div>
            <form onSubmit={sendText} className="mt-3 flex gap-2">
              <Input placeholder={connected ? "Type a customer line (works in voice mode too)…" : "Start a call first"} value={text} onChange={(e) => setText(e.target.value)} disabled={!connected} />
              <Button disabled={!connected}>
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Live metrics</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                <Badge variant={connected ? "success" : "secondary"}>{connected ? (mode === "voice" ? "Listening" : "Connected") : "Idle"}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Avg first audio</span>
                <span className={cn("tabular-nums", avg && avg > 1200 && "text-destructive")}>{avg ? `${avg} ms` : "-"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Last turn</span>
                <span className="tabular-nums">{latencies.length ? `${latencies[latencies.length - 1]} ms` : "-"}</span>
              </div>
              {mode === "voice" && !connected && (
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <MicOff className="h-3 w-3" /> Microphone access is requested when the call starts.
                </p>
              )}
            </CardContent>
          </Card>
          {summary && (
            <Card>
              <CardHeader>
                <CardTitle>Call result</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>{summary.summary}</p>
                <div className="flex flex-wrap gap-2">
                  <Badge>{humanize(summary.outcome)}</Badge>
                  <ScoreBadge score={summary.leadScore} />
                  <Badge variant="secondary">{formatINR2(summary.cost?.total)}</Badge>
                </div>
                {summary.callId && (
                  <a href={`/calls/${summary.callId}`} className="text-primary hover:underline">
                    Open call log →
                  </a>
                )}
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Call my phone</CardTitle>
              <CardDescription>The agent calls you through your telephony provider.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Field label="Your mobile number">
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98450 12345" />
              </Field>
              <Button variant="outline" className="w-full" disabled={!phone} onClick={() => void callMyPhone()}>
                <Phone className="h-4 w-4" /> Call me
              </Button>
              {dialStatus && <p className="text-xs text-muted-foreground">{dialStatus}</p>}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
