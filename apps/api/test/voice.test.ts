import { describe, expect, it } from "vitest";
import { SentenceChunker } from "../src/voice/chunker";
import { detectLanguage } from "../src/voice/language";
import { checkPrices, collectNumbers, extractAmounts } from "../src/voice/price-guard";
import { formatForSpeech, speakPhone, speakRegistration, speakRupees, speakTime } from "../src/voice/speech-format";

const feed = (chunker: SentenceChunker, text: string, step = 3) => {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += step) out.push(...chunker.push(text.slice(i, i + step)));
  const rest = chunker.flush();
  if (rest) out.push(rest);
  return out;
};

describe("sentence chunker", () => {
  it("splits streamed text into sentences", () => {
    expect(feed(new SentenceChunker({ firstChunkCommaMin: 999 }), "The Creta starts at 11 lakh. Would you like a test drive? Great!")).toEqual(["The Creta starts at 11 lakh.", "Would you like a test drive?", "Great!"]);
  });

  it("never splits decimals or abbreviations", () => {
    expect(feed(new SentenceChunker({ firstChunkCommaMin: 999 }), "It costs Rs. 12.9 lakh on-road. Dr. Rao drove it.")).toEqual(["It costs Rs. 12.9 lakh on-road.", "Dr. Rao drove it."]);
  });

  it("splits on the Devanagari danda", () => {
    expect(feed(new SentenceChunker({ firstChunkCommaMin: 999 }), "क्रेटा 11 लाख से शुरू होती है। टेस्ट ड्राइव बुक करें?")).toEqual(["क्रेटा 11 लाख से शुरू होती है।", "टेस्ट ड्राइव बुक करें?"]);
  });

  it("emits an early first chunk at a comma for lower latency", () => {
    const out = feed(new SentenceChunker({ firstChunkCommaMin: 20 }), "Sure, the Venue is a compact SUV, and it starts at 8.5 lakh. Want details?");
    expect(out[0]).toBe("Sure, the Venue is a compact SUV,");
    expect(out[1]).toBe("and it starts at 8.5 lakh.");
  });

  it("force-splits run-on text", () => {
    const out = feed(new SentenceChunker({ maxChunk: 40 }), "word ".repeat(30));
    expect(out.length).toBeGreaterThan(2);
    expect(out.every((s) => s.length <= 40)).toBe(true);
  });
});

describe("speech formatting", () => {
  it("speaks rupees in lakhs and thousands", () => {
    expect(speakRupees(1290000, "en")).toBe("12 lakh 90 thousand rupees");
    expect(speakRupees(24350, "en")).toBe("24 thousand 350 rupees");
    expect(speakRupees(15000000, "en")).toBe("1 crore 50 lakh rupees");
    expect(speakRupees(1290000, "hi")).toBe("12 लाख 90 हज़ार रुपये");
  });

  it("formats currency, phone numbers, registrations, dates and times in text", () => {
    expect(formatForSpeech("On-road is ₹12,90,000.", "en")).toBe("On-road is 12 lakh 90 thousand rupees.");
    expect(formatForSpeech("About 12.9 lakh", "en")).toBe("About 12 lakh 90 thousand");
    expect(speakPhone("+919845012345", "en")).toBe("nine eight four five zero, one two three four five");
    expect(speakRegistration("KA01AB1234", "en")).toBe("K A, zero one, A B, one two three four");
    expect(formatForSpeech("Booked for 2026-10-28 at 14:30", "en")).toBe("Booked for 28 October at 2:30 PM");
    expect(speakTime("11:00", "hi")).toBe("सुबह 11 बजे");
  });

  it("strips markdown and emoji", () => {
    expect(formatForSpeech("**Great** choice 🚗", "en")).toBe("Great choice");
  });
});

describe("language detection", () => {
  it("detects scripts and Hinglish", () => {
    expect(detectLanguage("मुझे क्रेटा चाहिए").language).toBe("hi");
    expect(detectLanguage("ನನಗೆ ಕಾರು ಬೇಕು").language).toBe("kn");
    expect(detectLanguage("Mujhe Creta ki test drive chahiye").language).toBe("hinglish");
    expect(detectLanguage("I want to book a test drive").language).toBe("en");
    expect(detectLanguage("nanage swalpa details beku").language).toBe("kn");
  });
});

describe("price guard", () => {
  const allowed = collectNumbers({ exShowroomPrice: 1100000, onRoadMin: 1290000, onRoadMax: 1330000, emi: 21674 });

  it("extracts compound amounts", () => {
    expect(extractAmounts("It is 12 lakh 90 thousand rupees on-road")).toEqual([1290000]);
    expect(extractAmounts("EMI of 21,674 rupees")).toEqual([21674]);
    expect(extractAmounts("I drive 40 km a day")).toEqual([]);
    expect(extractAmounts("A 2019 model at 5 lakh")).toEqual([500000]);
  });

  it("allows grounded figures, including natural rounding", () => {
    expect(checkPrices("The Creta starts at 11 lakh rupees ex-showroom.", allowed).ok).toBe(true);
    expect(checkPrices("On-road around 12.9 to 13.3 lakh.", allowed).ok).toBe(true);
    expect(checkPrices("Your EMI is about 21,700 rupees.", allowed).ok).toBe(true);
  });

  it("blocks invented prices", () => {
    const r = checkPrices("I can give it to you for 9 lakh rupees.", allowed);
    expect(r.ok).toBe(false);
    expect(r.ungrounded).toEqual([900000]);
  });
});
