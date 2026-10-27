import { randomUUID } from "node:crypto";
import { detectLanguage } from "../../voice/language";
import type { LlmContentBlock, LlmMessage, LlmProvider, LlmStreamOptions, LlmToolUse, LlmTurnResult } from "./types";

/**
 * Deterministic, offline stand-in for Claude. It understands the scripted simulator scenarios well enough
 * to exercise every tool, so the full pipeline (tools, guards, latency logging, post-call analysis) runs
 * in CI without API keys. It is NOT a conversational model; use LLM_PROVIDER=anthropic for real calls.
 */

type Lang = "en" | "hi";
type Flow = "testdrive" | "service" | "status" | "emi" | "price" | "exchange" | "compare" | "complaint" | "feedback" | null;

const RX = {
  optout: /(don'?t|do not|stop) call|unsubscribe|remove my number|call mat|phone mat|मत करो|कॉल मत/i,
  wrong: /wrong number|galat number|गलत नंबर|not interested in any/i,
  hot: /(want|going|ready) to buy|buy (it )?today|visiting today|coming today|book (it|the car|the bike) now|aaj (hi )?(khareed|le|aa)|आज (ही )?(खरीद|आ)/i,
  angry: /complain|worst|terrible|pathetic|angry|frustrated|not happy|bakwas|bekaar|bekar|ghatiya|third time|cheated|unacceptable|शिकायत|बेकार/i,
  safety: /brake|fire|smoke|accident|steering|airbag|fuel leak|ब्रेक|आग/i,
  emi: /\bemi\b|installment|instalment|kist|किस्त|monthly/i,
  price: /price|cost|kitne ka|kitna|on.?road|ex.?showroom|kimat|कीमत|दाम|rate/i,
  compare: /compare|better than|\bvs\b|versus|nexon|seltos|brezza|city|ola|ather|tvs|bajaj|competitor/i,
  exchange: /exchange|old (car|bike|scooter|vehicle)|purani|पुरानी/i,
  testdrive: /test ?drive|test ?ride|टेस्ट ड्राइव|drive karna|chala ke dekh/i,
  status: /\bready\b|status|kab milegi|kab tak|job card|तैयार/i,
  service: /servic|सर्विस|repair|oil change|book.*slot/i,
  feedback: /\b([1-5])\b.*(star|out of)|rating|rate it|^\s*[1-5]\s*$/i,
  yes: /(yes|yeah|sure|ok|okay|haan|han|ha|ji|theek|chalega|sari|houdu)|हाँ|हां|ठीक|ಹೌದು/i,
  done: /that'?s all|nothing else|no thanks|bye|thank you|thanks|bas itna|dhanyavaad|शुक्रिया|धन्यवाद|ಧನ್ಯವಾದ/i,
  greetingOnly: /^(hi|hello|hey|namaste|namaskar|हेलो|नमस्ते)[\s.!]*$/i,
};

const t = (lang: Lang, en: string, hi: string) => (lang === "hi" ? hi : en);
const lakh = (n: number) => `${(n / 1_00_000).toFixed(1).replace(/\.0$/, "")} lakh`;

interface ToolResultInfo {
  name: string;
  input: Record<string, unknown>;
  result: Record<string, unknown>;
}

function textOf(m: LlmMessage): string {
  if (typeof m.content === "string") return m.content;
  return (m.content ?? [])
    .map((b) => (b.type === "text" ? b.text : ""))
    .join(" ")
    .replace(/\(Detected caller language[^)]*\)\s*/g, "")
    .replace(/^\[[^\]]*\]\s*/, "");
}

function lastToolResults(messages: LlmMessage[]): ToolResultInfo[] {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user" || typeof last.content === "string") return [];
  const results = last.content.filter((b) => b.type === "tool_result");
  if (!results.length) return [];
  const prev = messages[messages.length - 2];
  const uses = prev && typeof prev.content !== "string" ? (prev.content ?? []).filter((b) => b.type === "tool_use") : [];
  return results.map((r) => {
    const use = uses.find((u) => u.type === "tool_use" && u.id === (r as { tool_use_id: string }).tool_use_id) as { name: string; input: Record<string, unknown> } | undefined;
    const raw = (r as { content?: unknown }).content;
    const str = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.map((x: { text?: string }) => x.text ?? "").join("") : "{}";
    let result: Record<string, unknown> = {};
    try {
      result = JSON.parse(str);
    } catch {
      result = { error: str };
    }
    return { name: use?.name ?? "unknown", input: use?.input ?? {}, result };
  });
}

function callerTexts(messages: LlmMessage[]): string[] {
  return messages.filter((m) => m.role === "user" && (typeof m.content === "string" || m.content.some((b) => b.type === "text"))).map(textOf).filter((s) => s && !s.startsWith("[Call connected"));
}

function toolsCalled(messages: LlmMessage[]): Set<string> {
  const names = new Set<string>();
  for (const m of messages) if (m.role === "assistant" && typeof m.content !== "string") for (const b of m.content) if (b.type === "tool_use") names.add(b.name);
  return names;
}

function extract(all: string, models: string[]) {
  const name =
    all.match(/(?:my name is|this is|i am|i'm|mera naam|naam)\s+([A-Z][a-z]+|[a-z]{3,})/i)?.[1] ??
    all.match(/(?:मेरा नाम|नाम)\s+([ऀ-ॿ]+)/)?.[1] ??
    all.match(/(?:ನನ್ನ ಹೆಸರು)\s+([ಀ-೿]+)/)?.[1];
  const phone = all.match(/(?:\+91[\s-]?)?\b([6-9]\d{4}[\s-]?\d{5})\b/)?.[1]?.replace(/\D/g, "");
  const vehicleNo = all.match(/\b([A-Z]{2}[\s-]?\d{1,2}[\s-]?[A-Z]{1,3}[\s-]?\d{3,4})\b/i)?.[1]?.toUpperCase().replace(/[\s-]/g, "");
  const lower = all.toLowerCase();
  const model = models.filter((m) => lower.includes(m.toLowerCase())).sort((a, b) => b.length - a.length)[0];
  const timeM = all.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|baje|बजे)\b/i);
  let time: string | undefined;
  if (timeM) {
    let h = Number(timeM[1]);
    const ampm = timeM[3]!.toLowerCase();
    if (ampm === "pm" && h < 12) h += 12;
    if ((ampm === "baje" || ampm === "बजे") && h < 8) h += 12;
    time = `${String(h).padStart(2, "0")}:${timeM[2] ?? "00"}`;
  }
  const day = /day after tomorrow|parso|परसों/i.test(all) ? 2 : /tomorrow|kal|कल/i.test(all) ? 1 : /today|aaj|आज/i.test(all) ? 0 : undefined;
  const year = all.match(/\b(20[0-2]\d|19[89]\d)\b/)?.[1];
  const km = all.match(/(\d[\d,]*)\s*(?:k\b|km|kms|kilomet)/i)?.[1];
  const kmVal = km ? Number(km.replace(/,/g, "")) * (/\d\s*k\b/i.test(all) && Number(km) < 1000 ? 1000 : 1) : undefined;
  return { name, phone, vehicleNo, model, time, day, year: year ? Number(year) : undefined, km: kmVal };
}

function flowOf(text: string): Flow {
  if (RX.angry.test(text)) return "complaint";
  if (RX.emi.test(text)) return "emi";
  if (RX.exchange.test(text)) return "exchange";
  if (RX.compare.test(text)) return "compare";
  if (RX.testdrive.test(text)) return "testdrive";
  if (RX.status.test(text)) return "status";
  if (RX.service.test(text)) return "service";
  if (RX.price.test(text)) return "price";
  if (RX.feedback.test(text)) return "feedback";
  return null;
}

function dateFromOffset(offset: number): string {
  const d = new Date(Date.now() + 5.5 * 3600_000 + offset * 86400_000);
  return d.toISOString().slice(0, 10);
}

export class MockLlm implements LlmProvider {
  readonly name = "mock";

  async streamTurn(o: LlmStreamOptions): Promise<LlmTurnResult> {
    this.setFlowFromMessages(o.messages);
    const { text, tools } = this.decide(o);
    // Simulate token streaming so chunker / latency paths are exercised.
    for (const piece of text.match(/\S+\s*/g) ?? []) {
      if (o.signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
      o.onText(piece);
      await new Promise((r) => setTimeout(r, 2));
    }
    const content: LlmContentBlock[] = [];
    if (text) content.push({ type: "text", text });
    const toolUses: LlmToolUse[] = tools.map((tu) => ({ id: `toolu_${randomUUID().slice(0, 12)}`, ...tu }));
    for (const tu of toolUses) content.push({ type: "tool_use", id: tu.id, name: tu.name, input: tu.input as Record<string, unknown> });
    const inputTokens = Math.round(JSON.stringify(o.messages).length / 4 + o.system.length / 4);
    return { content, text, toolUses, stopReason: toolUses.length ? "tool_use" : "end_turn", usage: { inputTokens, outputTokens: Math.round(text.length / 4) + toolUses.length * 30 } };
  }

  async completeJson<T>(o: { prompt: string }): Promise<{ data: T; usage: LlmTurnResult["usage"] }> {
    const p = o.prompt;
    const angry = RX.angry.test(p);
    const data = {
      summary: p.split("\n").filter((l) => l.startsWith("caller:")).slice(0, 3).map((l) => l.slice(7).trim()).join(" / ").slice(0, 280) || "Short call.",
      sentiment: angry ? "angry" : /thank|great|perfect|dhanyavaad/i.test(p) ? "positive" : "neutral",
      extracted: {},
    };
    return { data: data as T, usage: { inputTokens: Math.round(p.length / 4), outputTokens: 80 } };
  }

  private decide(o: LlmStreamOptions): { text: string; tools: { name: string; input: unknown }[] } {
    const models = (o.hints?.models as string[] | undefined) ?? [];
    const agentKind = (o.hints?.agentKind as string | undefined) ?? "combined";
    const callerPhone = (o.hints?.callerPhone as string | undefined) ?? "";
    const results = lastToolResults(o.messages);
    const texts = callerTexts(o.messages);
    const last = texts[texts.length - 1] ?? "";
    const all = texts.join(" \n ");
    const lang: Lang = ["hi", "hinglish"].includes(detectLanguage(texts.join(" ")).language) ? "hi" : "en";
    const ent = extract(all, models);
    const called = toolsCalled(o.messages);

    // ---------- respond to tool results ----------
    if (results.length) return this.afterTools(results, lang, ent, called);

    // ---------- respond to caller utterance ----------
    if (RX.optout.test(last)) return { text: "", tools: [{ name: "record_opt_out", input: { reason: "caller_request" } }] };
    if (RX.wrong.test(last)) return { text: t(lang, "Sorry for the trouble. Have a great day!", "Maaf kijiye, aapka din shubh ho!"), tools: [{ name: "end_call", input: { outcome: "wrong_number" } }] };
    if (RX.hot.test(last)) {
      return {
        text: "",
        tools: [{ name: "save_lead", input: { fields: { name: ent.name, interestedModel: ent.model, timeline: "this_week", buyingIntent: /visit|coming|aa/i.test(last) ? "visiting_today" : "buy_today" }, score: "hot" } }],
      };
    }

    if (RX.done.test(last) && texts.length > 1) {
      const outcome = called.has("book_testdrive") ? "test_drive_booked" : called.has("book_service") ? "service_booked" : called.has("save_lead") ? "lead_captured" : called.has("create_ticket") ? "complaint_logged" : "info_provided";
      return { text: t(lang, "Thank you for calling. Have a wonderful day!", "Call karne ke liye dhanyavaad. Aapka din shubh ho!"), tools: [{ name: "end_call", input: { outcome } }] };
    }

    let flow: Flow = null;
    for (let i = texts.length - 1; i >= 0 && !flow; i--) flow = flowOf(texts[i]!);
    if (agentKind === "service" && flow === "testdrive") flow = "service";

    switch (flow) {
      case "complaint": {
        if (called.has("create_ticket")) return { text: t(lang, "I've noted that. Is there anything else?", "Maine note kar liya hai. Aur kuch?"), tools: [] };
        const safety = RX.safety.test(all);
        return {
          text: "",
          tools: [{ name: "create_ticket", input: { category: safety ? "safety" : "service_quality", description: last.slice(0, 300), severity: safety ? "critical" : "high", vehicle_no: ent.vehicleNo } }],
        };
      }
      case "emi":
        if (!ent.model) return { text: t(lang, "Sure, which model would you like the EMI for?", "Zaroor, kis model ke liye EMI jaanna chahenge?"), tools: [] };
        return { text: "", tools: [{ name: "get_model_details", input: { model: ent.model } }] };
      case "price":
        if (!ent.model) return { text: t(lang, "Which model are you interested in?", "Aap kaunsa model dekh rahe hain?"), tools: [] };
        return { text: "", tools: [{ name: "get_model_details", input: { model: ent.model } }] };
      case "compare":
        if (!ent.model) return { text: t(lang, "Happy to help. Which of our models are you considering?", "Zaroor. Aap hamare kaunse model ko dekh rahe hain?"), tools: [] };
        return { text: "", tools: [{ name: "get_model_details", input: { model: ent.model } }] };
      case "exchange":
        if (!ent.year || !ent.km)
          return { text: t(lang, "Sure. Which make, model and year is your old vehicle, and how many kilometres has it run?", "Zaroor. Purani gaadi ka make, model, saal aur kitne kilometre chali hai?"), tools: [] };
        return {
          text: "",
          tools: [{ name: "save_lead", input: { fields: { name: ent.name, interestedModel: ent.model, paymentMode: "exchange", hasExchange: true, exchangeVehicle: { year: ent.year, kilometres: ent.km, condition: /good|accha|achha/i.test(all) ? "good" : "average", model: all.match(/(?:old|purani)\s+(\w+\s?\w*)/i)?.[1] } }, score: "warm" } }],
        };
      case "testdrive": {
        if (!ent.model) return { text: t(lang, "Lovely! Which model would you like to test drive?", "Badhiya! Kaunsi gaadi ki test drive leni hai?"), tools: [] };
        if (!ent.name) return { text: t(lang, "May I have your name please?", "Aapka naam jaan sakti hoon?"), tools: [] };
        if (ent.day === undefined && !ent.time) return { text: t(lang, "Which day works for you, today or tomorrow?", "Aapke liye kaunsa din theek rahega, aaj ya kal?"), tools: [] };
        const date = dateFromOffset(ent.day ?? 1);
        if (!ent.time) return { text: "", tools: [{ name: "check_testdrive_slots", input: { model: ent.model, date } }] };
        if (called.has("book_testdrive")) return { text: t(lang, "You're all set. Anything else I can help with?", "Sab set hai. Aur kuch madad chahiye?"), tools: [] };
        const confirmedBefore = o.messages.some((m) => m.role === "assistant" && /confirm|pakka/i.test(textOf(m)));
        if (!confirmedBefore)
          return { text: t(lang, `Just to confirm, ${ent.name}, a ${ent.model} test drive on ${date} at ${ent.time}. Shall I book it?`, `Confirm kar doon, ${ent.name} ji, ${ent.model} ki test drive ${date} ko ${ent.time} baje. Pakka karoon?`), tools: [] };
        if (!RX.yes.test(last)) return { text: t(lang, "No problem, what time would you prefer?", "Koi baat nahi, kaunsa time theek rahega?"), tools: [] };
        return { text: "", tools: [{ name: "book_testdrive", input: { model: ent.model, date, time: ent.time, customer_name: ent.name, phone: ent.phone ?? callerPhone } }] };
      }
      case "status":
        if (!ent.vehicleNo) return { text: t(lang, "Sure, may I have your vehicle registration number?", "Zaroor, apni gaadi ka number batayenge?"), tools: [] };
        return { text: "", tools: [{ name: "lookup_job_card", input: { vehicle_no: ent.vehicleNo } }] };
      case "service": {
        if (!ent.vehicleNo) return { text: t(lang, "Happy to book your service. What is your vehicle number?", "Service book kar deti hoon. Gaadi ka number kya hai?"), tools: [] };
        if (!ent.name) return { text: t(lang, "And your name please?", "Aur aapka naam?"), tools: [] };
        const date = dateFromOffset(ent.day ?? 1);
        if (!ent.time) return { text: "", tools: [{ name: "check_service_slots", input: { date } }] };
        if (called.has("book_service")) return { text: t(lang, "Your service is booked. Anything else?", "Aapki service book ho gayi hai. Aur kuch?"), tools: [] };
        return {
          text: "",
          tools: [{ name: "book_service", input: { vehicle_no: ent.vehicleNo, model: ent.model ?? "Unknown", date, time: ent.time, service_type: /free/i.test(all) ? "free_service" : /repair|problem|noise/i.test(all) ? "repair" : "paid_service", customer_name: ent.name, pickup_drop: /pick ?up|pickup/i.test(all), kilometres: ent.km } }],
        };
      }
      case "feedback": {
        const rating = Number(last.match(/\b([1-5])\b/)?.[1] ?? 0);
        if (rating) return { text: "", tools: [{ name: "record_feedback", input: { rating, comment: last } }] };
        return { text: t(lang, "On a scale of 1 to 5, how would you rate your service experience?", "1 se 5 mein aap service ko kitne number denge?"), tools: [] };
      }
    }

    if (ent.model && !called.has("get_model_details")) return { text: "", tools: [{ name: "get_model_details", input: { model: ent.model } }] };
    if (RX.greetingOnly.test(last) || !last)
      return { text: t(lang, "Hello! Are you looking for a bike or a car today?", "Namaste! Aap bike dekh rahe hain ya car?"), tools: [] };
    return { text: t(lang, "Sure. Which model or budget do you have in mind?", "Zaroor. Aapke mann mein kaunsa model ya budget hai?"), tools: [] };
  }

  private afterTools(results: ToolResultInfo[], lang: Lang, ent: ReturnType<typeof extract>, called: Set<string>) {
    const r = results[0]!;
    const res = r.result;
    if (res.error) return { text: String(res.spoken ?? t(lang, "Sorry, I couldn't check that. Our team will call you back.", "Maaf kijiye, abhi check nahi ho paya. Team aapko call karegi.")), tools: [] };
    switch (r.name) {
      case "record_opt_out":
        return { text: t(lang, "Done, you won't receive any more calls from us. Sorry for the disturbance.", "Theek hai, ab aapko hamari taraf se call nahi aayega. Takleef ke liye maafi."), tools: [{ name: "end_call", input: { outcome: "opted_out" } }] };
      case "save_lead":
        if (res.score === "hot" && !called.has("transfer_to_human"))
          return { text: t(lang, "Wonderful! Let me connect you to our sales executive right away.", "Bahut badhiya! Main aapko abhi hamare sales executive se jod rahi hoon."), tools: [{ name: "transfer_to_human", input: { reason: "Hot lead ready to buy", department: "sales", priority: "instant" } }] };
        return { text: t(lang, "Thank you, I've noted the details. Our team will call you back with an evaluation. Would you like to book a test drive meanwhile?", "Dhanyavaad, details note kar li hain. Team evaluation ke saath call karegi. Tab tak test drive book karein?"), tools: [] };
      case "transfer_to_human":
        if (res.transferred) return { text: "", tools: [] };
        return { text: t(lang, "Our executives are busy right now, so I've scheduled a callback within a few minutes.", "Abhi sab executives busy hain, maine kuch hi minute mein callback schedule kar diya hai."), tools: [{ name: "end_call", input: { outcome: "callback_scheduled" } }] };
      case "create_ticket":
        if (res.escalate && !called.has("transfer_to_human"))
          return { text: t(lang, "I'm sorry about this. I've raised a ticket and I'm connecting you to our service manager now.", "Iske liye maafi chahti hoon. Maine ticket bana diya hai aur aapko service manager se jod rahi hoon."), tools: [{ name: "transfer_to_human", input: { reason: "Escalated complaint", department: "manager", priority: "instant" } }] };
        return { text: t(lang, `I'm sorry about this. Your ticket number is ${res.ticketId}, and our service manager will call you today.`, `Iske liye maafi. Aapka ticket number ${res.ticketId} hai, service manager aaj aapko call karenge.`), tools: [] };
      case "get_model_details": {
        if (!res.found) return { text: t(lang, "I don't have details on that model right now. Shall I have our sales team call you?", "Is model ki jaankari abhi mere paas nahi hai. Sales team se call karwa doon?"), tools: [] };
        const variants = res.variants as { exShowroomPrice: number; onRoadMin?: number; onRoadMax?: number }[];
        const v = variants[0]!;
        if (this.lastFlow === "emi" && !called.has("calculate_emi")) {
          return { text: "", tools: [{ name: "calculate_emi", input: { price: v.onRoadMin ?? v.exShowroomPrice } }] };
        }
        const talking = (res.talkingPoints as string[] | undefined)?.[0];
        if (talking && this.lastFlow === "compare") return { text: t(lang, `I can't speak for other brands, but the ${res.model} offers ${talking.toLowerCase()}. Would you like to experience it on a test drive?`, `Doosre brands ke baare mein nahi keh sakti, lekin ${res.model} mein ${talking} milta hai. Test drive karke dekhenge?`), tools: [] };
        const onRoad = v.onRoadMin && v.onRoadMax ? t(lang, `, around ${lakh(v.onRoadMin)} to ${lakh(v.onRoadMax)} on-road`, `, on-road lagbhag ${lakh(v.onRoadMin)} se ${lakh(v.onRoadMax)}`) : "";
        return { text: t(lang, `The ${res.model} starts at ${lakh(v.exShowroomPrice)} rupees ex-showroom${onRoad}. Final price depends on showroom confirmation. Would you like to book a test drive?`, `${res.model} ${lakh(v.exShowroomPrice)} rupaye ex-showroom se shuru hoti hai${onRoad}. Final price showroom confirm karega. Test drive book karein?`), tools: [] };
      }
      case "calculate_emi":
        return { text: t(lang, `With ${Number(res.downPayment).toLocaleString("en-IN")} rupees down and ${res.tenureMonths} months at ${res.interestRate} percent, the EMI comes to about ${Number(res.emi).toLocaleString("en-IN")} rupees. This is an estimate, final terms depend on the bank. Shall I book a test drive?`, `${Number(res.downPayment).toLocaleString("en-IN")} rupaye down payment aur ${res.tenureMonths} mahine ${res.interestRate} percent par EMI lagbhag ${Number(res.emi).toLocaleString("en-IN")} rupaye banegi. Yeh estimate hai, final bank tay karega. Test drive book karein?`), tools: [] };
      case "check_testdrive_slots":
      case "check_service_slots": {
        const slots = (res.slots as string[] | undefined) ?? [];
        if (!slots.length) return { text: t(lang, "That day is fully booked. Would another day work?", "Us din sab slots bhare hain. Koi aur din chalega?"), tools: [] };
        return { text: t(lang, `I have ${slots[0]} or ${slots[1] ?? slots[0]} available. Which time suits you?`, `${slots[0]} ya ${slots[1] ?? slots[0]} ka slot khali hai. Kaunsa time theek rahega?`), tools: [] };
      }
      case "book_testdrive":
      case "book_service":
        if (!res.booked) return { text: t(lang, "That slot just got taken. Could you pick another time?", "Woh slot abhi bhar gaya. Koi aur time batayenge?"), tools: [] };
        return { text: t(lang, `Done! You're booked for ${res.date} at ${res.time} at our ${res.branchName} branch. I've sent the details on WhatsApp.`, `Ho gaya! ${res.date} ko ${res.time} baje ${res.branchName} branch mein booking pakki hai. Details WhatsApp par bhej di hain.`), tools: [] };
      case "lookup_job_card":
        if (!res.verified) return { text: t(lang, "For security, could you confirm the registered mobile number on the vehicle?", "Security ke liye, gaadi par registered mobile number confirm karenge?"), tools: [] };
        return { text: t(lang, `Your vehicle status is ${String(res.status).replace(/_/g, " ")}. ${res.estimatedReadyAt ? `It should be ready by ${res.estimatedReadyAt}.` : ""}`, `Aapki gaadi ka status ${String(res.status).replace(/_/g, " ")} hai. ${res.estimatedReadyAt ? `${res.estimatedReadyAt} tak ready ho jayegi.` : ""}`), tools: [] };
      case "record_feedback":
        return { text: t(lang, "Thank you for your feedback! Have a great day.", "Aapke feedback ke liye dhanyavaad! Aapka din shubh ho."), tools: [{ name: "end_call", input: { outcome: "feedback_recorded" } }] };
      case "end_call":
        return { text: "", tools: [] };
      default:
        return { text: t(lang, "Done. Anything else I can help you with?", "Ho gaya. Aur kuch madad chahiye?"), tools: [] };
    }
  }

  private lastFlow: Flow = null;

  /** Track the active flow so get_model_details results route to EMI / comparison replies. */
  private setFlowFromMessages(messages: LlmMessage[]) {
    const texts = callerTexts(messages);
    let flow: Flow = null;
    for (let i = texts.length - 1; i >= 0 && !flow; i--) flow = flowOf(texts[i]!);
    this.lastFlow = flow;
  }
}
