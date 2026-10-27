"use client";

import { createUserWithEmailAndPassword, GoogleAuthProvider, signInWithEmailAndPassword, signInWithPopup } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, ErrorNote, Field, Input, Tabs } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { AUTH_MODE, firebaseAuth } from "@/lib/firebase";

export default function LoginPage() {
  const router = useRouter();
  const { me, refresh, loading } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [dealership, setDealership] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && me?.orgId) router.replace("/dashboard");
  }, [loading, me, router]);

  const finish = async () => {
    // Creates the dealership on first login, or joins via a pending invite.
    await api("/api/auth/bootstrap", { method: "POST", json: { dealershipName: dealership || undefined, showroomName: dealership || undefined } });
    await refresh();
    router.replace("/dashboard");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (AUTH_MODE === "dev") return void (await finish());
      const auth = firebaseAuth();
      if (mode === "signup") await createUserWithEmailAndPassword(auth, email, password);
      else await signInWithEmailAndPassword(auth, email, password);
      await finish();
    } catch (err) {
      setError((err as Error).message.replace("Firebase: ", ""));
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setError(null);
    try {
      await signInWithPopup(firebaseAuth(), new GoogleAuthProvider());
      await finish();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground">AX</div>
          <CardTitle className="text-xl">AXO Voice Auto</CardTitle>
          <CardDescription>AI sales and service desk for your showroom</CardDescription>
        </CardHeader>
        <CardContent>
          {AUTH_MODE === "dev" ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Development mode: you are signed in as the owner of the demo dealership.</p>
              <Button className="w-full" onClick={() => void finish()}>
                Open dashboard
              </Button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <Tabs value={mode} onChange={setMode} items={[{ value: "signin", label: "Sign in" }, { value: "signup", label: "Create account" }]} />
              <ErrorNote error={error} />
              <Field label="Email">
                <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              </Field>
              <Field label="Password">
                <Input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} />
              </Field>
              {mode === "signup" && (
                <Field label="Dealership name" hint="Skip if you were invited by your team">
                  <Input value={dealership} onChange={(e) => setDealership(e.target.value)} placeholder="e.g. Sai Hyundai" />
                </Field>
              )}
              <Button className="w-full" disabled={busy}>
                {mode === "signup" ? "Create account" : "Sign in"}
              </Button>
              <Button type="button" variant="outline" className="w-full" onClick={() => void google()}>
                Continue with Google
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
