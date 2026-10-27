import type { CatalogModel } from "@axo/shared";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9ऀ-ॿಀ-೿]/g, "");

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length]![b.length]!;
}

/**
 * Find a model by name, brand+name, alias or transliteration, tolerating STT misspellings
 * ("kreta" -> Creta). Exact matches beat longer partial matches beat fuzzy matches.
 */
export function findModel(catalog: CatalogModel[], query: string): CatalogModel | null {
  const q = norm(query);
  if (!q) return null;
  let best: { m: CatalogModel; score: number } | null = null;
  for (const m of catalog.filter((x) => x.active)) {
    const names = [m.model, `${m.brand}${m.model}`, ...m.aliases].map(norm);
    for (const n of names) {
      let score = -1;
      if (n === q) score = 100;
      else if (q.includes(n) && n.length >= 3) score = 60 + n.length;
      else if (n.includes(q) && q.length >= 3) score = 40 + q.length;
      else {
        const d = levenshtein(n, q);
        if (d <= Math.max(1, Math.floor(n.length / 4))) score = 30 - d;
      }
      if (score > (best?.score ?? -1)) best = { m, score };
    }
  }
  return best?.m ?? null;
}

export interface CatalogFilters {
  type?: "bike" | "scooter" | "car";
  fuel?: "petrol" | "diesel" | "cng" | "ev" | "hybrid";
  minPrice?: number;
  maxPrice?: number;
  transmission?: string;
}

export function searchCatalog(catalog: CatalogModel[], query: string, f: CatalogFilters = {}) {
  const q = query.toLowerCase();
  const words = q.split(/\s+/).filter((w) => w.length > 2);
  return catalog
    .filter((m) => m.active)
    .filter((m) => !f.type || m.type === f.type)
    .map((m) => {
      const variants = m.variants.filter(
        (v) => (!f.fuel || v.fuel === f.fuel) && (!f.maxPrice || v.exShowroomPrice <= f.maxPrice) && (!f.minPrice || v.exShowroomPrice >= f.minPrice) && (!f.transmission || v.transmission === f.transmission),
      );
      const hay = `${m.brand} ${m.model} ${m.type} ${m.keyFeatures.join(" ")} ${m.aliases.join(" ")} ${m.variants.map((v) => `${v.fuel} ${v.transmission}`).join(" ")}`.toLowerCase();
      const relevance = !words.length ? 1 : words.filter((w) => hay.includes(w)).length;
      return { m, variants, relevance };
    })
    .filter((x) => x.variants.length && (x.relevance > 0 || !words.length || Object.keys(f).length > 0))
    .sort((a, b) => b.relevance - a.relevance || a.variants[0]!.exShowroomPrice - b.variants[0]!.exShowroomPrice)
    .slice(0, 5)
    .map(({ m, variants }) => ({
      brand: m.brand,
      model: m.model,
      type: m.type,
      fuels: [...new Set(variants.map((v) => v.fuel))],
      exShowroomFrom: Math.min(...variants.map((v) => v.exShowroomPrice)),
      exShowroomTo: Math.max(...variants.map((v) => v.exShowroomPrice)),
      keyFeatures: m.keyFeatures.slice(0, 3),
    }));
}
