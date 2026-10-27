/**
 * Splits a stream of LLM text deltas into speakable chunks for TTS.
 *
 * - Splits on sentence enders (. ! ? and the Devanagari danda ।) once followed by whitespace,
 *   so decimals like "8.5 lakh" never split.
 * - Ignores common abbreviations ("Rs.", "Dr.", "No.", "approx.").
 * - The first chunk of a reply may also split on a comma once it is long enough: the caller hears
 *   audio sooner, which matters more than prosody for the opening words.
 * - Very long run-on text is force-split at the last space.
 */
const ABBREVIATIONS = new Set(["rs", "mr", "mrs", "ms", "dr", "no", "st", "approx", "vs", "etc", "sr", "jr", "km", "kms", "ltd", "pvt", "e.g", "i.e"]);

const ENDERS = new Set([".", "!", "?", "।", "॥"]);

export interface ChunkerOptions {
  firstChunkCommaMin?: number;
  maxChunk?: number;
}

export class SentenceChunker {
  private buf = "";
  private emittedAny = false;
  private readonly commaMin: number;
  private readonly maxChunk: number;

  constructor(o: ChunkerOptions = {}) {
    this.commaMin = o.firstChunkCommaMin ?? 30;
    this.maxChunk = o.maxChunk ?? 220;
  }

  push(delta: string): string[] {
    this.buf += delta;
    const out: string[] = [];
    for (;;) {
      const cut = this.findCut();
      if (cut < 0) break;
      const chunk = this.buf.slice(0, cut).trim();
      this.buf = this.buf.slice(cut).replace(/^\s+/, "");
      if (chunk) {
        out.push(chunk);
        this.emittedAny = true;
      }
    }
    return out;
  }

  /** Return whatever is left (end of the LLM stream). */
  flush(): string | null {
    const rest = this.buf.trim();
    this.buf = "";
    this.emittedAny = false;
    return rest || null;
  }

  reset() {
    this.buf = "";
    this.emittedAny = false;
  }

  private findCut(): number {
    const b = this.buf;
    for (let i = 0; i < b.length - 1; i++) {
      const ch = b[i]!;
      const next = b[i + 1]!;
      if (ENDERS.has(ch) && /\s/.test(next)) {
        if (ch === "." && this.isAbbreviation(i)) continue;
        return i + 1;
      }
      if (!this.emittedAny && (ch === "," || ch === ";" || ch === "—") && /\s/.test(next) && i + 1 >= this.commaMin) {
        return i + 1;
      }
    }
    if (b.length > this.maxChunk) {
      const sp = b.lastIndexOf(" ", this.maxChunk);
      return sp > 0 ? sp : this.maxChunk;
    }
    return -1;
  }

  private isAbbreviation(dotIndex: number): boolean {
    const before = this.buf.slice(0, dotIndex);
    const word = before.split(/\s+/).pop()?.toLowerCase().replace(/[^a-z.]/g, "") ?? "";
    if (ABBREVIATIONS.has(word)) return true;
    // Single capital letter initials, e.g. "K. A." in names
    return /(^|\s)[A-Z]$/.test(before);
  }
}
