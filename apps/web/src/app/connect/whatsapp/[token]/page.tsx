"use client";

import { CheckCircle2, MessageCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, ErrorNote } from "@/components/ui";
import { API_URL } from "@/lib/api";

interface LinkInfo {
  businessName: string;
  connected: boolean;
  displayNumber: string;
  ready: boolean;
  appId: string;
  configId: string;
  graphVersion: string;
}

interface FacebookSdk {
  init(o: Record<string, unknown>): void;
  login(cb: (r: { authResponse?: { code?: string } }) => void, o: Record<string, unknown>): void;
}
declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

/**
 * Opened by the business from the link the platform owner sends. Runs Meta's Embedded Signup: the business logs
 * in to Facebook, picks or adds its WhatsApp number and verifies it; we receive a one-time code plus the number
 * and account ids, and the server links everything. No login to our app is needed; the link itself is signed.
 */
export default function ConnectWhatsappPage({ params }: { params: { token: string } }) {
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const session = useRef<{ code?: string; phoneNumberId?: string; wabaId?: string }>({});
  const url = `${API_URL}/public/whatsapp-connect/${params.token}`;

  useEffect(() => {
    fetch(url)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "This link is not valid.");
        setInfo(j);
      })
      .catch((e: Error) => setError(e.message));
  }, [url]);

  // Load the Facebook SDK once we know the app id.
  useEffect(() => {
    if (!info?.ready || window.FB) return;
    window.fbAsyncInit = () => window.FB!.init({ appId: info.appId, autoLogAppEvents: true, xfbml: false, version: info.graphVersion });
    const s = document.createElement("script");
    s.src = "https://connect.facebook.net/en_US/sdk.js";
    s.async = true;
    s.crossOrigin = "anonymous";
    document.body.appendChild(s);
  }, [info]);

  // Embedded Signup reports the chosen number and account through a window message.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      try {
        if (!/(^|\.)facebook\.com$/.test(new URL(e.origin).hostname)) return;
        const data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
        if (data?.type !== "WA_EMBEDDED_SIGNUP") return;
        if (data.event === "FINISH" || data.event === "FINISH_ONLY_WABA") {
          session.current.phoneNumberId = data.data?.phone_number_id;
          session.current.wabaId = data.data?.waba_id;
          void finish();
        } else if (data.event === "CANCEL") {
          setBusy(false);
          setError(`Setup stopped${data.data?.current_step ? ` at "${data.data.current_step}"` : ""}. You can start again.`);
        }
      } catch {
        /* not ours */
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = async () => {
    const s = session.current;
    if (!s.code || !s.phoneNumberId || !s.wabaId) return; // wait for both the code and the message
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(s) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Could not connect");
      setDone(j.displayNumber || "your number");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const start = () => {
    if (!window.FB || !info) return setError("Facebook is still loading. Try again in a few seconds.");
    setError(null);
    setBusy(true);
    session.current = {};
    window.FB.login(
      (r) => {
        if (!r.authResponse?.code) {
          setBusy(false);
          return;
        }
        session.current.code = r.authResponse.code;
        void finish();
      },
      { config_id: info.configId, response_type: "code", override_default_response_type: true, extras: { setup: {}, featureType: "", sessionInfoVersion: "3" } },
    );
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-emerald-600" /> Connect WhatsApp
          </CardTitle>
          <CardDescription>{info ? `For ${info.businessName}. Your AI assistant will reply to customers on this WhatsApp number.` : "Loading…"}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <ErrorNote error={error} />
          {done ? (
            <div className="flex gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>Done. {done} is connected and the AI assistant is now answering WhatsApp messages. You can close this page.</span>
            </div>
          ) : info && !info.ready ? (
            <p className="text-muted-foreground">WhatsApp self-connect is not switched on yet. Please contact the person who sent you this link.</p>
          ) : (
            info && (
              <>
                {info.connected && <p className="rounded-md bg-muted p-3">{info.displayNumber || "A number"} is already connected. Continue only to switch to a different number.</p>}
                <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
                  <li>Log in with the Facebook account that manages your business.</li>
                  <li>Choose or create your business, then add your WhatsApp number.</li>
                  <li>Enter the code WhatsApp sends to that number.</li>
                </ol>
                <p className="text-xs text-muted-foreground">The number must not be in use on the normal WhatsApp or WhatsApp Business app; delete that account from the phone first, or use a new number.</p>
                <Button className="w-full" disabled={busy} onClick={start}>
                  {busy ? "Finishing in the Facebook window…" : "Connect with Facebook"}
                </Button>
              </>
            )
          )}
        </CardContent>
      </Card>
    </div>
  );
}
