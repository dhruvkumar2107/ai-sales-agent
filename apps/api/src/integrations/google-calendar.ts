import { createSign } from "node:crypto";
import { env } from "../config";
import { logger } from "../lib/logger";

let cached: { token: string; exp: number } | null = null;

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");

/** OAuth2 access token for a Google service account (JWT bearer grant), cached until expiry. */
async function accessToken(): Promise<string | null> {
  if (!env.GOOGLE_CALENDAR_SA_EMAIL || !env.GOOGLE_CALENDAR_SA_KEY) return null;
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: env.GOOGLE_CALENDAR_SA_EMAIL, scope: "https://www.googleapis.com/auth/calendar.events", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(env.GOOGLE_CALENDAR_SA_KEY.replace(/\\n/g, "\n")).toString("base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${signature}` }),
  });
  if (!res.ok) throw new Error(`Google token ${res.status}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: json.access_token, exp: Date.now() + json.expires_in * 1000 };
  return cached.token;
}

/** Create a calendar event for a booking. No-op (returns null) when Google Calendar isn't configured. */
export async function createCalendarEvent(calendarId: string, ev: { summary: string; description?: string; start: string; end: string; location?: string }): Promise<string | null> {
  if (!calendarId) return null;
  try {
    const token = await accessToken();
    if (!token) return null;
    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ summary: ev.summary, description: ev.description, location: ev.location, start: { dateTime: ev.start, timeZone: "Asia/Kolkata" }, end: { dateTime: ev.end, timeZone: "Asia/Kolkata" } }),
    });
    if (!res.ok) throw new Error(`Calendar insert ${res.status}`);
    return ((await res.json()) as { id: string }).id;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "google calendar event failed");
    return null;
  }
}
