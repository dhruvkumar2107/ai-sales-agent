import type { Language } from "@axo/shared";

/**
 * Rewrites text so TTS engines pronounce Indian prices, EMIs, phone numbers, registration
 * numbers, dates and times naturally. The LLM is told to write spoken forms already;
 * this is a safety net for tool output that slips through verbatim.
 */

const DIGITS: Record<"en" | "hi" | "kn", string[]> = {
  en: ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"],
  hi: ["शून्य", "एक", "दो", "तीन", "चार", "पाँच", "छह", "सात", "आठ", "नौ"],
  kn: ["ಸೊನ್ನೆ", "ಒಂದು", "ಎರಡು", "ಮೂರು", "ನಾಲ್ಕು", "ಐದು", "ಆರು", "ಏಳು", "ಎಂಟು", "ಒಂಬತ್ತು"],
};

const UNITS: Record<Language, { crore: string; lakh: string; thousand: string; rupees: string }> = {
  en: { crore: "crore", lakh: "lakh", thousand: "thousand", rupees: "rupees" },
  hinglish: { crore: "crore", lakh: "lakh", thousand: "hazaar", rupees: "rupaye" },
  hi: { crore: "करोड़", lakh: "लाख", thousand: "हज़ार", rupees: "रुपये" },
  kn: { crore: "ಕೋಟಿ", lakh: "ಲಕ್ಷ", thousand: "ಸಾವಿರ", rupees: "ರೂಪಾಯಿ" },
};

const MONTHS: Record<"en" | "hi" | "kn", string[]> = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  hi: ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"],
  kn: ["ಜನವರಿ", "ಫೆಬ್ರವರಿ", "ಮಾರ್ಚ್", "ಏಪ್ರಿಲ್", "ಮೇ", "ಜೂನ್", "ಜುಲೈ", "ಆಗಸ್ಟ್", "ಸೆಪ್ಟೆಂಬರ್", "ಅಕ್ಟೋಬರ್", "ನವೆಂಬರ್", "ಡಿಸೆಂಬರ್"],
};

const digitSet = (lang: Language) => (lang === "hi" ? DIGITS.hi : lang === "kn" ? DIGITS.kn : DIGITS.en);
const monthSet = (lang: Language) => (lang === "hi" ? MONTHS.hi : lang === "kn" ? MONTHS.kn : MONTHS.en);

/** 1290000 -> "12 lakh 90 thousand rupees" (or Hindi/Kannada units). */
export function speakRupees(amount: number, lang: Language, withCurrency = true): string {
  const u = UNITS[lang];
  const n = Math.round(amount);
  const parts: string[] = [];
  const crore = Math.floor(n / 1_00_00_000);
  const lakh = Math.floor((n % 1_00_00_000) / 1_00_000);
  const thousand = Math.floor((n % 1_00_000) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(`${crore} ${u.crore}`);
  if (lakh) parts.push(`${lakh} ${u.lakh}`);
  if (thousand) parts.push(`${thousand} ${u.thousand}`);
  // Below one lakh keep hundreds (EMIs); above, rounding to the thousand reads naturally.
  if (rest && n < 1_00_000) parts.push(String(rest));
  if (!parts.length) parts.push("0");
  return withCurrency ? `${parts.join(" ")} ${u.rupees}` : parts.join(" ");
}

export function speakDigits(digits: string, lang: Language): string {
  const words = digitSet(lang);
  return digits
    .replace(/\D/g, "")
    .split("")
    .map((d) => words[Number(d)])
    .join(" ");
}

/** Indian mobile: speak as two groups of five digits. */
export function speakPhone(raw: string, lang: Language): string {
  const d = raw.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");
  if (d.length !== 10) return speakDigits(d, lang);
  return `${speakDigits(d.slice(0, 5), lang)}, ${speakDigits(d.slice(5), lang)}`;
}

/** KA01AB1234 -> "K A, zero one, A B, one two three four" */
export function speakRegistration(reg: string, lang: Language): string {
  const m = reg.toUpperCase().replace(/[\s-]/g, "").match(/^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/);
  if (!m) return reg;
  const [, state, district, series, num] = m;
  const letters = (s: string) => s.split("").join(" ");
  return [letters(state!), speakDigits(district!, lang), series ? letters(series) : "", speakDigits(num!, lang)].filter(Boolean).join(", ");
}

export function speakDate(iso: string, lang: Language): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const day = Number(m[3]);
  const month = monthSet(lang)[Number(m[2]) - 1];
  return lang === "kn" ? `${month} ${day}` : `${day} ${month}`;
}

export function speakTime(hhmm: string, lang: Language): string {
  const [hs, ms] = hhmm.split(":");
  const h = Number(hs);
  const m = Number(ms);
  const h12 = ((h + 11) % 12) + 1;
  const mm = m ? `:${String(m).padStart(2, "0")}` : "";
  if (lang === "hi") {
    const part = h < 12 ? "सुबह" : h < 16 ? "दोपहर" : h < 20 ? "शाम" : "रात";
    return `${part} ${h12}${mm} बजे`;
  }
  if (lang === "hinglish") {
    const part = h < 12 ? "subah" : h < 16 ? "dopahar" : h < 20 ? "shaam" : "raat";
    return `${part} ${h12}${mm} baje`;
  }
  if (lang === "kn") {
    const part = h < 12 ? "ಬೆಳಿಗ್ಗೆ" : h < 16 ? "ಮಧ್ಯಾಹ್ನ" : h < 20 ? "ಸಂಜೆ" : "ರಾತ್ರಿ";
    return `${part} ${h12}${mm}`;
  }
  return `${h12}${mm} ${h < 12 ? "AM" : "PM"}`;
}

const parseAmount = (s: string) => Number(s.replace(/,/g, ""));

export function formatForSpeech(text: string, lang: Language): string {
  let t = text;
  // Strip markdown / emoji that LLMs occasionally emit.
  t = t.replace(/[*_#`>|]/g, "").replace(/\p{Extended_Pictographic}/gu, "");
  // ISO date-times and dates
  t = t.replace(/\b(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g, (_, d, tm) => `${speakDate(d, lang)}, ${speakTime(tm, lang)}`);
  t = t.replace(/\b\d{4}-\d{2}-\d{2}\b/g, (d) => speakDate(d, lang));
  // 24h times like 14:30 (not part of a ratio already handled)
  t = t.replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b(?!\s?(AM|PM|am|pm))/g, (_, h, m) => speakTime(`${h}:${m}`, lang));
  // Rupee amounts: ₹12,90,000 / Rs. 1290000 / INR 24,350
  t = t.replace(/(?:₹|\bRs\.?|\bINR)\s?(\d[\d,]*(?:\.\d+)?)(?!\s?(?:lakh|lac|crore|लाख|करोड़))/gi, (_, n) => speakRupees(parseAmount(n), lang));
  // "12.9 lakh" -> "12 lakh 90 thousand"
  t = t.replace(/\b(\d+(?:\.\d+)?)\s?(lakh|lac|lakhs)\b/gi, (_, n) => speakRupees(Number(n) * 1_00_000, lang, false));
  t = t.replace(/(?:₹|\bRs\.?)\s?/gi, "");
  // Registration numbers
  t = t.replace(/\b[A-Z]{2}[\s-]?\d{1,2}[\s-]?[A-Z]{0,3}[\s-]?\d{1,4}\b/g, (r) => (/[A-Z]{2}[\s-]?\d/.test(r) && /\d{3,4}$/.test(r) ? speakRegistration(r, lang) : r));
  // Indian phone numbers
  t = t.replace(/(?:\+91[\s-]?|\b0)?\b[6-9]\d{4}[\s-]?\d{5}\b/g, (p) => speakPhone(p, lang));
  // Plain large numbers (>= 1 lakh) without currency, e.g. kilometres: 125000 -> "1 lakh 25 thousand"
  t = t.replace(/\b\d{1,3}(?:,\d{2,3})+\b|\b\d{6,9}\b/g, (n) => speakRupees(parseAmount(n), lang, false));
  return t.replace(/\s{2,}/g, " ").trim();
}
