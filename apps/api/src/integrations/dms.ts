import { repo } from "../db/repo";
import { decryptString, hmacSha256 } from "../lib/crypto";
import { logger } from "../lib/logger";

/**
 * Generic REST adapter for the dealer's DMS / CRM. Configure a base URL (and optional auth header) in Settings.
 *
 * Contract (all JSON):
 *   GET  {base}/job-cards?vehicle_no=KA01AB1234  -> { jobCardNo, vehicleNo, model, status, estimatedReadyAt, customerPhone }
 *   GET  {base}/bookings?phone=+9198...          -> [{ id, model, variant, status, deliveryDate, pendingDocuments, customerPhone }]
 *   POST {base}/events                           <- { type, orgId, payload }   (header X-AXO-Signature: hex HMAC-SHA256 of body)
 *
 * When no DMS is configured, lookups fall back to AXO's own records.
 */
async function dmsConfig(orgId: string) {
  const s = await repo(orgId).settings();
  if (!s.webhooks.dmsBaseUrl) return null;
  return { base: s.webhooks.dmsBaseUrl.replace(/\/$/, ""), auth: s.webhooks.dmsAuthHeader ? decryptString(s.webhooks.dmsAuthHeader) : "", secret: s.webhooks.leadIntakeSecret ? decryptString(s.webhooks.leadIntakeSecret) : "" };
}

async function dmsGet<T>(orgId: string, path: string): Promise<T | null> {
  const cfg = await dmsConfig(orgId);
  if (!cfg) return null;
  const res = await fetch(`${cfg.base}${path}`, { headers: cfg.auth ? { Authorization: cfg.auth } : {}, signal: AbortSignal.timeout(3000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`DMS ${path} ${res.status}`);
  return (await res.json()) as T;
}

export interface JobCard {
  jobCardNo?: string;
  vehicleNo: string;
  model?: string;
  status: string;
  estimatedReadyAt?: string;
  customerPhone?: string;
}

export async function lookupJobCard(orgId: string, vehicleNo: string): Promise<JobCard | null> {
  const fromDms = await dmsGet<JobCard>(orgId, `/job-cards?vehicle_no=${encodeURIComponent(vehicleNo)}`);
  if (fromDms) return fromDms;
  const bookings = await repo(orgId).serviceBookings.list({ where: { vehicleNo }, orderBy: "start", desc: true, limit: 1 });
  const b = bookings[0];
  return b ? { jobCardNo: b.jobCardNo, vehicleNo: b.vehicleNo, model: b.model, status: b.status, estimatedReadyAt: b.estimatedReadyAt, customerPhone: b.phone } : null;
}

export async function lookupVehicleBookings(orgId: string, phone: string) {
  const fromDms = await dmsGet<Record<string, unknown>[]>(orgId, `/bookings?phone=${encodeURIComponent(phone)}`);
  if (fromDms) return fromDms;
  return repo(orgId).vehicleBookings.list({ where: { phone } });
}

/** Push an event (lead created, test drive booked...) to the DMS. Fire-and-forget. */
export async function pushDmsEvent(orgId: string, type: string, payload: Record<string, unknown>) {
  const cfg = await dmsConfig(orgId);
  if (!cfg) return;
  const body = JSON.stringify({ type, orgId, payload, at: new Date().toISOString() });
  fetch(`${cfg.base}/events`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cfg.auth ? { Authorization: cfg.auth } : {}), ...(cfg.secret ? { "X-AXO-Signature": hmacSha256(cfg.secret, body) } : {}) },
    body,
    signal: AbortSignal.timeout(5000),
  }).catch((err) => logger.warn({ err: (err as Error).message, type }, "DMS event push failed"));
}
