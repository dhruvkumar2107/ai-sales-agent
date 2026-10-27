import type { Language } from "@axo/shared";

/** Fixed lines spoken without a round-trip to the LLM (lower latency, guaranteed wording). */
export const PHRASES = {
  reprompt: {
    en: ["Are you still there?", "Sorry, I can't hear you. Could you please repeat that?"],
    hi: ["क्या आप लाइन पर हैं?", "माफ़ कीजिए, आवाज़ नहीं आ रही। क्या आप दोबारा बोल सकते हैं?"],
    hinglish: ["Hello, kya aap line par hain?", "Sorry, aawaz nahi aa rahi. Kya aap dobara bol sakte hain?"],
    kn: ["ನೀವು ಲೈನ್‌ನಲ್ಲಿ ಇದ್ದೀರಾ?", "ಕ್ಷಮಿಸಿ, ಧ್ವನಿ ಕೇಳುತ್ತಿಲ್ಲ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಹೇಳುತ್ತೀರಾ?"],
  },
  silenceGoodbye: {
    en: "I'm not able to hear you, so I'll end the call now. Our team will call you back. Thank you!",
    hi: "आपकी आवाज़ नहीं आ रही, इसलिए मैं कॉल समाप्त कर रही हूँ। हमारी टीम आपको वापस कॉल करेगी। धन्यवाद!",
    hinglish: "Aapki aawaz nahi aa rahi, isliye main call end kar rahi hoon. Hamari team aapko call back karegi. Thank you!",
    kn: "ನಿಮ್ಮ ಧ್ವನಿ ಕೇಳುತ್ತಿಲ್ಲ, ಆದ್ದರಿಂದ ಕರೆ ಮುಗಿಸುತ್ತಿದ್ದೇನೆ. ನಮ್ಮ ತಂಡ ನಿಮಗೆ ಮರಳಿ ಕರೆ ಮಾಡುತ್ತದೆ. ಧನ್ಯವಾದಗಳು!",
  },
  priceFallback: {
    en: "Let me have our sales team confirm the exact figure for you.",
    hi: "सही कीमत के लिए हमारी सेल्स टीम आपसे कन्फ़र्म करेगी।",
    hinglish: "Exact figure ke liye hamari sales team aapko confirm karegi.",
    kn: "ನಿಖರವಾದ ಮೊತ್ತವನ್ನು ನಮ್ಮ ಸೇಲ್ಸ್ ತಂಡ ನಿಮಗೆ ಖಚಿತಪಡಿಸುತ್ತದೆ.",
  },
  toolFailure: {
    en: "Sorry, I'm having trouble checking that right now. I'll have our team call you back with the details.",
    hi: "माफ़ कीजिए, अभी यह जानकारी नहीं मिल पा रही। हमारी टीम आपको वापस कॉल करके बताएगी।",
    hinglish: "Sorry, abhi yeh check nahi ho pa raha. Hamari team aapko call back karke batayegi.",
    kn: "ಕ್ಷಮಿಸಿ, ಈಗ ಅದನ್ನು ಪರಿಶೀಲಿಸಲು ಆಗುತ್ತಿಲ್ಲ. ನಮ್ಮ ತಂಡ ನಿಮಗೆ ಮರಳಿ ಕರೆ ಮಾಡುತ್ತದೆ.",
  },
  holdOn: {
    en: "One moment please.",
    hi: "एक पल रुकिए।",
    hinglish: "Ek second please.",
    kn: "ಒಂದು ಕ್ಷಣ ದಯವಿಟ್ಟು.",
  },
  llmError: {
    en: "Sorry, could you say that again?",
    hi: "माफ़ कीजिए, क्या आप फिर से बोल सकते हैं?",
    hinglish: "Sorry, kya aap phir se bol sakte hain?",
    kn: "ಕ್ಷಮಿಸಿ, ಮತ್ತೊಮ್ಮೆ ಹೇಳುತ್ತೀರಾ?",
  },
} satisfies Record<string, Record<Language, string | string[]>>;

export function phrase(key: keyof typeof PHRASES, lang: Language, index = 0): string {
  const v = PHRASES[key][lang] ?? PHRASES[key].en;
  return Array.isArray(v) ? v[Math.min(index, v.length - 1)]! : v;
}
