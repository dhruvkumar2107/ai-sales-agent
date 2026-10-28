import type { Branch, CatalogModel } from "@axo/shared";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const lakh = (n: number) => `₹${(n / 1_00_000).toFixed(2).replace(/\.?0+$/, "")} lakh`;

/** Variables for the `model_details` message, straight from the catalog (never invented). */
export function modelDetailsVars(m: CatalogModel, showroom: string): Record<string, string> {
  const variants = m.variants.slice(0, 6).map((v) => `${v.name} (${lakh(v.exShowroomPrice)} ex-showroom)`);
  const lows = m.variants.map((v) => v.onRoadMin ?? v.exShowroomPrice);
  const highs = m.variants.map((v) => v.onRoadMax ?? v.exShowroomPrice);
  const range = lows.length ? `${lakh(Math.min(...lows))} - ${lakh(Math.max(...highs))}` : "on request";
  return {
    model: `${m.brand} ${m.model}`,
    showroom,
    variants: variants.join(", ") || "-",
    price_range: range,
    features: m.keyFeatures.slice(0, 4).join(", ") || "-",
    brochure: m.brochureUrl ? `Brochure: ${m.brochureUrl}\n` : "",
    link: m.brochureUrl ?? "",
  };
}

/** Variables for the `showroom_location` message. */
export function locationVars(b: Branch, showroom: string): Record<string, string> {
  const days = b.workingHours.days.length === 7 ? "All days" : b.workingHours.days.map((d) => DAY_NAMES[d]).join(", ");
  return {
    showroom,
    branch: b.name,
    address: b.address,
    map: b.mapLink ?? "",
    timings: `${days}, ${b.workingHours.open} - ${b.workingHours.close}`,
    phone: b.phone ?? "",
  };
}
