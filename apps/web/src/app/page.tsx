import { CalendarCheck, Clock, Languages, MessageCircle, PhoneCall, ShieldCheck, Sparkles, Store } from "lucide-react";
import Link from "next/link";
import { BUSINESS_TYPES, OVERAGE_PER_MINUTE, PLANS } from "@axo/shared";
import { Button } from "@/components/ui";
import { formatINR } from "@/lib/utils";

/** Optional sales WhatsApp number (digits with country code) for the "Talk to us" buttons */
const SALES_WHATSAPP = (process.env.NEXT_PUBLIC_SALES_WHATSAPP ?? "").replace(/\D/g, "");
const talkHref = SALES_WHATSAPP ? `https://wa.me/${SALES_WHATSAPP}?text=${encodeURIComponent("Hi! I'd like a demo of the AI receptionist for my business.")}` : "#pricing";

const FEATURES = [
  { icon: PhoneCall, title: "Answers every call", text: "Picks up instantly, day or night, on your own business number. No missed customers, no hold music." },
  { icon: Languages, title: "Speaks like your staff", text: "Natural Indian voice in English, Hindi, Hinglish and Kannada. Switches language when the caller does." },
  { icon: CalendarCheck, title: "Books and captures leads", text: "Takes appointments, orders and enquiries, and sends you every lead with a hot / warm / cold score." },
  { icon: MessageCircle, title: "WhatsApp too", text: "Replies to WhatsApp messages and sends prices, location and confirmations after every call." },
  { icon: Clock, title: "Live in a day", text: "We set up the agent, your number and WhatsApp for you. You just tell us about your business." },
  { icon: ShieldCheck, title: "Only says what's true", text: "Quotes only the prices and policies you give it, and hands the call to your staff when it should." },
];

const STEPS = [
  { title: "Tell us about your business", text: "Services, prices, timings, FAQs. A price list or website is enough." },
  { title: "We set up your AI receptionist", text: "Your own calling number and WhatsApp, connected and tested by our team." },
  { title: "Customers call, it handles them", text: "You get bookings, leads and call summaries on your dashboard and WhatsApp." },
];

const PAID_PLANS = (["starter", "growth", "enterprise"] as const).map((id) => ({ id, ...PLANS[id] }));

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 md:px-8">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">AX</div>
            <span className="font-semibold">AXO Voice</span>
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2">
            <a href="#how" className="hidden px-3 text-sm text-muted-foreground hover:text-foreground sm:block">
              How it works
            </a>
            <a href="#pricing" className="hidden px-3 text-sm text-muted-foreground hover:text-foreground sm:block">
              Pricing
            </a>
            <Link href="/login">
              <Button variant="ghost" size="sm">
                Sign in
              </Button>
            </Link>
            <Link href="/admin">
              <Button variant="outline" size="sm">
                Admin
              </Button>
            </Link>
          </nav>
        </div>
      </header>

      <section className="border-b bg-gradient-to-b from-accent/60 to-background">
        <div className="mx-auto max-w-6xl px-4 py-16 md:px-8 md:py-24">
          <div className="max-w-3xl">
            <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary" /> AI receptionist made for Indian businesses
            </span>
            <h1 className="mt-5 text-4xl font-bold tracking-tight md:text-6xl">Never miss a customer call again.</h1>
            <p className="mt-5 text-lg text-muted-foreground md:text-xl">
              An AI assistant that answers your phone and WhatsApp in a natural Indian voice, in English, Hindi, Hinglish or Kannada. It answers questions, books appointments and sends you every lead.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href={talkHref} target={SALES_WHATSAPP ? "_blank" : undefined} rel="noreferrer">
                <Button size="lg">Get a free demo</Button>
              </a>
              <Link href="/login">
                <Button size="lg" variant="outline">
                  Sign in to your dashboard
                </Button>
              </Link>
            </div>
          </div>

          <div className="mt-12 max-w-xl rounded-xl border bg-card p-4 shadow-sm">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">A real call, 9:40 pm</p>
            <div className="space-y-2 text-sm">
              <p className="w-fit max-w-[85%] rounded-lg bg-muted px-3 py-2">Hello, kal subah cleaning ke liye appointment mil sakta hai?</p>
              <p className="ml-auto w-fit max-w-[85%] rounded-lg bg-primary px-3 py-2 text-primary-foreground">Ji bilkul! Kal subah 10 baje aur 11:30 free hai. Kaunsa time aapke liye theek rahega?</p>
              <p className="w-fit max-w-[85%] rounded-lg bg-muted px-3 py-2">10 baje. Naam Priya hai.</p>
              <p className="ml-auto w-fit max-w-[85%] rounded-lg bg-primary px-3 py-2 text-primary-foreground">Done, Priya ji. Kal 10 baje confirm hai. Location aur details WhatsApp par bhej rahi hoon.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 md:px-8">
        <h2 className="text-2xl font-bold md:text-3xl">Everything a good receptionist does</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-lg border bg-card p-5">
              <f.icon className="h-5 w-5 text-primary" />
              <h3 className="mt-3 font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y bg-muted/40">
        <div className="mx-auto max-w-6xl px-4 py-16 md:px-8">
          <h2 className="flex items-center gap-2 text-2xl font-bold md:text-3xl">
            <Store className="h-6 w-6 text-primary" /> Works for any business
          </h2>
          <div className="mt-6 flex flex-wrap gap-2">
            {BUSINESS_TYPES.filter((t) => t.id !== "other").map((t) => (
              <span key={t.id} className="rounded-full border bg-card px-3 py-1 text-sm">
                {t.label}
              </span>
            ))}
            <span className="rounded-full border bg-card px-3 py-1 text-sm">Car and bike showrooms</span>
          </div>
        </div>
      </section>

      <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 md:px-8">
        <h2 className="text-2xl font-bold md:text-3xl">How it works</h2>
        <ol className="mt-8 grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="rounded-lg border bg-card p-5">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{i + 1}</span>
              <h3 className="mt-3 font-semibold">{s.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="pricing" className="scroll-mt-20 border-t bg-muted/40">
        <div className="mx-auto max-w-6xl px-4 py-16 md:px-8">
          <h2 className="text-2xl font-bold md:text-3xl">Simple monthly plans</h2>
          <p className="mt-2 text-muted-foreground">Extra minutes {formatINR(OVERAGE_PER_MINUTE)} each. One-time setup includes your number, WhatsApp and a trained agent.</p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {PAID_PLANS.map((p) => (
              <div key={p.id} className={`rounded-lg border bg-card p-6 ${p.id === "growth" ? "border-primary shadow-md" : ""}`}>
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">{p.label}</h3>
                  {p.id === "growth" && <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">Popular</span>}
                </div>
                <p className="mt-3 text-3xl font-bold">
                  {formatINR(p.price)}
                  <span className="text-sm font-normal text-muted-foreground">/month</span>
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{p.pitch}</p>
                <ul className="mt-4 space-y-1 text-sm">
                  <li>{p.minutes} call minutes</li>
                  <li>{p.messages.toLocaleString("en-IN")} WhatsApp messages</li>
                  <li>Dashboard, leads and call recordings</li>
                </ul>
                <a href={talkHref} target={SALES_WHATSAPP ? "_blank" : undefined} rel="noreferrer" className="mt-5 block">
                  <Button className="w-full" variant={p.id === "growth" ? "default" : "outline"}>
                    Get started
                  </Button>
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-muted-foreground md:px-8">
          <span>© {new Date().getFullYear()} AXO Voice</span>
          <div className="flex gap-4">
            <Link href="/login" className="hover:text-foreground">
              Sign in
            </Link>
            <Link href="/admin" className="hover:text-foreground">
              Admin
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
