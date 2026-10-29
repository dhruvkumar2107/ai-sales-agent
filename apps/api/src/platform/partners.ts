import { DEFAULT_PARTNERS } from "@axo/shared";
import { getStore } from "../db/store";

/** The platform's owners and how the monthly profit is split between them (shares add up to 100). */
export interface Partner {
  name: string;
  share: number;
}

const doc = () => getStore().collection<{ id: string; partners: Partner[] }>("platformConfig");

export async function getPartners(): Promise<Partner[]> {
  return (await doc().get("partners"))?.partners ?? DEFAULT_PARTNERS;
}

export async function savePartners(partners: Partner[]): Promise<string | null> {
  const clean = partners.map((p) => ({ name: String(p.name ?? "").trim(), share: Number(p.share) })).filter((p) => p.name);
  if (!clean.length) return "Add at least one partner";
  if (clean.some((p) => !Number.isFinite(p.share) || p.share < 0)) return "Shares must be positive numbers";
  if (Math.abs(clean.reduce((n, p) => n + p.share, 0) - 100) > 0.01) return "Shares must add up to 100%";
  await doc().set({ id: "partners", partners: clean });
  return null;
}

/** Each partner's part of a profit figure; a loss is shared the same way. */
export const splitProfit = (profit: number, partners: Partner[]) => partners.map((p) => ({ ...p, amount: Math.round((profit * p.share) / 100) }));
