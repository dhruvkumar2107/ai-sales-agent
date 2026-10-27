import { parse } from "csv-parse/sync";
import { catalogCsvRowSchema, type CatalogModel, type Variant } from "@axo/shared";

export interface CatalogImportResult {
  models: CatalogModel[];
  errors: { row: number; message: string }[];
}

const split = (v?: string) =>
  (v ?? "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

/**
 * Parse a catalog CSV. One row per variant; rows with the same brand+model are merged into one model.
 * Columns: brand, model, type, variant, fuel, transmission, ex_showroom_price, on_road_min, on_road_max,
 *          colors, key_features, brochure_url, aliases, talking_points   (multi-values separated by "|")
 */
export function parseCatalogCsv(orgId: string, csv: string): CatalogImportResult {
  const rows = parse(csv, { columns: (h: string[]) => h.map((c) => c.trim().toLowerCase()), skip_empty_lines: true, trim: true }) as Record<string, string>[];
  const byKey = new Map<string, CatalogModel>();
  const errors: CatalogImportResult["errors"] = [];

  rows.forEach((raw, i) => {
    const cleaned = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v === "" ? undefined : v]));
    if (cleaned.type) cleaned.type = cleaned.type.toLowerCase();
    if (cleaned.fuel) cleaned.fuel = cleaned.fuel.toLowerCase();
    if (cleaned.transmission) cleaned.transmission = cleaned.transmission.toLowerCase();
    const parsed = catalogCsvRowSchema.safeParse(cleaned);
    if (!parsed.success) {
      errors.push({ row: i + 2, message: parsed.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ") });
      return;
    }
    const r = parsed.data;
    const key = `${slug(r.brand)}-${slug(r.model)}`;
    const variant: Variant = {
      name: r.variant,
      fuel: r.fuel,
      transmission: r.transmission,
      exShowroomPrice: r.ex_showroom_price,
      onRoadMin: r.on_road_min,
      onRoadMax: r.on_road_max,
    };
    const existing = byKey.get(key);
    if (existing) {
      existing.variants.push(variant);
      for (const c of split(r.colors)) if (!existing.colors.includes(c)) existing.colors.push(c);
      for (const f of split(r.key_features)) if (!existing.keyFeatures.includes(f)) existing.keyFeatures.push(f);
      return;
    }
    byKey.set(key, {
      id: key,
      orgId,
      brand: r.brand,
      model: r.model,
      type: r.type,
      variants: [variant],
      colors: split(r.colors),
      keyFeatures: split(r.key_features),
      brochureUrl: r.brochure_url ?? "",
      aliases: split(r.aliases),
      talkingPoints: split(r.talking_points),
      active: true,
    });
  });

  return { models: [...byKey.values()], errors };
}
