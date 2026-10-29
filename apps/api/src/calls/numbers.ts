import { global, repo } from "../db/repo";
import { normalizePhone } from "../lib/mask";

/** Numbers in `wanted` that are already routed to a different dealership, with that dealership's name. */
export async function numberConflicts(orgId: string, wanted: string[]): Promise<{ number: string; orgName: string }[]> {
  const out: { number: string; orgName: string }[] = [];
  for (const n of wanted) {
    const route = await global.phoneRoutes().get(normalizePhone(n));
    if (route && route.orgId !== orgId) out.push({ number: n, orgName: (await global.orgs().get(route.orgId))?.name ?? route.orgId });
  }
  return out;
}

/** Rebuild the inbound routing table for one dealership from its agents' phone numbers. */
export async function syncPhoneRoutes(orgId: string): Promise<void> {
  const agents = await repo(orgId).agents.list();
  const wanted = new Map<string, string>();
  for (const a of agents) for (const n of a.phoneNumbers) wanted.set(normalizePhone(n), a.id);
  for (const route of await global.phoneRoutes().list({ where: { orgId } })) if (!wanted.has(route.id)) await global.phoneRoutes().delete(route.id);
  for (const [id, agentId] of wanted) {
    const existing = await global.phoneRoutes().get(id);
    if (existing && existing.orgId !== orgId) continue; // never take over another dealership's number
    await global.phoneRoutes().set({ id, orgId, agentId });
  }
}
