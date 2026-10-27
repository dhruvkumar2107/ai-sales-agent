import type { Language } from "@axo/shared";

const HINDI_ROMAN = new Set(
  "hai hain kya mujhe chahiye chahte kitna kitne kitni nahi nahin haan han ji bhai gaadi gadi kab aap aapka mera meri naam karna karni hoga hogi kaise kaisa kal aaj abhi wala wali lena leni dena batao bataiye bolo theek thik accha acha matlab paisa paise lakh kharidna khareedna dekhna chalega milega sakte sakta sakti baje bas dhanyavaad shukriya subah shaam raat dopahar gaadi naya nayi purana purani hum main ka ki ke ko se mein par bhi".split(" "),
);
const KANNADA_ROMAN = new Set("beku illa howdu houdu yenu enu nanage nange swalpa gottilla banni madi maadi hegide yaavaga elli bekagide sari ide".split(" "));
// Words that are Hinglish-ambiguous in English sentences; don't count them alone.
const AMBIGUOUS = new Set(["main", "par", "hum", "ka", "ke", "ki", "ko", "se", "bhi", "lakh", "ji"]);

export interface LanguageGuess {
  language: Language;
  confidence: number;
}

/**
 * Detect the caller's language from a transcript, optionally using the STT engine's language hint.
 * Script wins first (Kannada / Devanagari), then romanised Hindi or Kannada vocabulary (Hinglish), else English.
 */
export function detectLanguage(text: string, sttHint?: string): LanguageGuess {
  const kannada = (text.match(/[ಀ-೿]/g) ?? []).length;
  const devanagari = (text.match(/[ऀ-ॿ]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  const total = kannada + devanagari + latin || 1;

  if (kannada / total > 0.3) return { language: "kn", confidence: 0.95 };
  if (devanagari / total > 0.3) {
    // Devanagari with plenty of English words is still Hindi for TTS purposes.
    return { language: "hi", confidence: 0.95 };
  }

  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  const hindiHits = words.filter((w) => HINDI_ROMAN.has(w));
  const strongHindi = hindiHits.filter((w) => !AMBIGUOUS.has(w)).length;
  const kannadaHits = words.filter((w) => KANNADA_ROMAN.has(w)).length;

  if (kannadaHits >= 1 && kannadaHits >= strongHindi) return { language: "kn", confidence: 0.6 };
  if (strongHindi >= 2 || (strongHindi >= 1 && words.length <= 4) || (words.length > 0 && hindiHits.length / words.length > 0.3 && strongHindi >= 1)) {
    return { language: "hinglish", confidence: Math.min(0.9, 0.5 + strongHindi * 0.1) };
  }

  const hint = sttHint?.toLowerCase() ?? "";
  if (hint.startsWith("kn")) return { language: "kn", confidence: 0.7 };
  if (hint.startsWith("hi")) return { language: words.length ? "hinglish" : "hi", confidence: 0.6 };
  return { language: "en", confidence: words.length >= 2 ? 0.8 : 0.5 };
}

export const LANGUAGE_NAMES: Record<Language, string> = {
  en: "English",
  hi: "Hindi",
  kn: "Kannada",
  hinglish: "Hinglish (conversational Hindi-English mix written in Roman script)",
};

/** BCP-47 locale for STT/TTS providers. Hinglish is synthesised with a Hindi voice. */
export const LOCALE: Record<Language, string> = { en: "en-IN", hi: "hi-IN", kn: "kn-IN", hinglish: "hi-IN" };
