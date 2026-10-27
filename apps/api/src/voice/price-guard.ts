/**
 * Guardrail that stops the agent from speaking a rupee figure that is not grounded in configured
 * data, tool results, or something the caller said. Runs on every sentence before TTS.
 */

const UNIT: Record<string, number> = {
  crore: 1_00_00_000,
  करोड़: 1_00_00_000,
  ಕೋಟಿ: 1_00_00_000,
  lakh: 1_00_000,
  lakhs: 1_00_000,
  lac: 1_00_000,
  लाख: 1_00_000,
  ಲಕ್ಷ: 1_00_000,
  thousand: 1000,
  hazaar: 1000,
  hazar: 1000,
  हज़ार: 1000,
  हजार: 1000,
  ಸಾವಿರ: 1000,
  k: 1000,
};

const MONEY_HINT = /₹|\brs\.?|\binr\b|rupee|rupaye|रुपये|ರೂಪಾಯಿ|lakh|lac|crore|लाख|करोड़|ಲಕ್ಷ|ಕೋಟಿ|emi|ईएमआई|price|कीमत|ಬೆಲೆ|on-road|ex-showroom|down ?payment/i;

/** Extract rupee amounts mentioned in a sentence. Compound forms ("12 lakh 90 thousand") are summed. */
export function extractAmounts(sentence: string): number[] {
  if (!MONEY_HINT.test(sentence)) return [];
  const amounts: number[] = [];
  const re = /(\d[\d,]*(?:\.\d+)?)\s*(crore|करोड़|ಕೋಟಿ|lakhs?|lac|लाख|ಲಕ್ಷ|thousand|hazaa?r|हज़ार|हजार|ಸಾವಿರ|k\b)?/gi;
  let current: number | null = null;
  let lastUnit = Infinity;
  let lastEnd = -1;
  for (const m of sentence.matchAll(re)) {
    const value = Number(m[1]!.replace(/,/g, ""));
    const unitWord = m[2]?.toLowerCase();
    const unit = unitWord ? (UNIT[unitWord] ?? UNIT[m[2]!] ?? 1) : 1;
    const gap = sentence.slice(lastEnd, m.index).trim();
    const continues = current !== null && unit < lastUnit && /^(and|aur|और|ಮತ್ತು)?$/i.test(gap);
    if (continues) {
      current! += value * unit;
    } else {
      if (current !== null) amounts.push(current);
      current = value * unit;
    }
    lastUnit = unit;
    lastEnd = m.index! + m[0].length;
  }
  if (current !== null) amounts.push(current);
  // Ignore small numbers: years, tenure months, percentages, kilometres are not rupee claims.
  return amounts.filter((a) => a >= 1000 && !(a >= 1990 && a <= 2100 && Number.isInteger(a)));
}

/** Collect every numeric value from arbitrary JSON (tool results, catalog). */
export function collectNumbers(value: unknown, into: Set<number> = new Set()): Set<number> {
  if (typeof value === "number" && Number.isFinite(value)) into.add(value);
  else if (typeof value === "string") for (const a of extractAmounts(value)) into.add(a);
  else if (Array.isArray(value)) value.forEach((v) => collectNumbers(v, into));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => collectNumbers(v, into));
  return into;
}

export interface GuardResult {
  ok: boolean;
  ungrounded: number[];
}

/**
 * An amount is grounded if it is within `tolerance` (default 2%) of a known number, which allows
 * natural rounding ("about 13 lakh" for 12.9 lakh) but blocks invented figures.
 */
export function checkPrices(sentence: string, allowed: Set<number>, tolerance = 0.02): GuardResult {
  const ungrounded = extractAmounts(sentence).filter((a) => {
    for (const k of allowed) if (k > 0 && Math.abs(a - k) / k <= tolerance) return false;
    return true;
  });
  return { ok: ungrounded.length === 0, ungrounded };
}
