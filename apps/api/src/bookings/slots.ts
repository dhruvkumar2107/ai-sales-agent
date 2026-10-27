import type { WorkingHours } from "@axo/shared";
import { istParts, istToDate } from "../compliance/calling-hours";

export interface SlotQuery {
  /** IST date YYYY-MM-DD */
  date: string;
  workingHours: WorkingHours;
  slotMinutes: number;
  /** Bookings allowed per slot (test drive vehicles for the model, or service bays) */
  capacity: number;
  /** Existing bookings that overlap the day */
  booked: { start: string; end: string }[];
  holidays?: string[];
  /** Minimum notice before a slot can be booked */
  leadMinutes?: number;
  /** Duration of the new booking (service jobs may span several slots); defaults to slotMinutes */
  durationMinutes?: number;
  now?: Date;
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
};
const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/**
 * Available start times (IST "HH:MM") for a day. A slot is free when the number of existing bookings
 * overlapping [start, start + duration) is below capacity. Past slots and slots inside the notice
 * period are excluded, as are closed days and holidays.
 */
export function availableSlots(q: SlotQuery): string[] {
  if (q.capacity <= 0) return [];
  if (q.holidays?.includes(q.date)) return [];
  const weekday = new Date(`${q.date}T12:00:00+05:30`).getUTCDay();
  if (!q.workingHours.days.includes(weekday)) return [];

  const now = q.now ?? new Date();
  const earliest = now.getTime() + (q.leadMinutes ?? 60) * 60_000;
  const duration = q.durationMinutes ?? q.slotMinutes;
  const open = toMin(q.workingHours.open);
  const close = toMin(q.workingHours.close);
  const intervals = q.booked.map((b) => [new Date(b.start).getTime(), new Date(b.end).getTime()] as const);

  const out: string[] = [];
  for (let m = open; m + duration <= close; m += q.slotMinutes) {
    const start = istToDate(q.date, toHHMM(m)).getTime();
    if (start < earliest) continue;
    const end = start + duration * 60_000;
    const overlapping = intervals.filter(([s, e]) => s < end && e > start).length;
    if (overlapping < q.capacity) out.push(toHHMM(m));
  }
  return out;
}

export function isSlotAvailable(q: SlotQuery, time: string): boolean {
  return availableSlots(q).includes(time);
}

/** Normalise loose times from the model ("11", "11:00", "11 am", "4:30pm") to HH:MM. */
export function normalizeTime(raw: string): string | null {
  const m = raw.trim().toLowerCase().match(/^(\d{1,2})(?::|\.)?(\d{2})?\s*(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (m[3] === "pm" && h < 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return toHHMM(h * 60 + min);
}

/** Resolve "today" / "tomorrow" / ISO dates to IST YYYY-MM-DD. */
export function normalizeDate(raw: string, now = new Date()): string | null {
  const s = raw.trim().toLowerCase();
  const today = istParts(now).date;
  const add = (n: number) => istParts(new Date(now.getTime() + n * 86400_000)).date;
  if (["today", "aaj", "आज", "ಇಂದು"].includes(s)) return today;
  if (["tomorrow", "kal", "कल", "ನಾಳೆ"].includes(s)) return add(1);
  if (["day after tomorrow", "parso", "परसों"].includes(s)) return add(2);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}
