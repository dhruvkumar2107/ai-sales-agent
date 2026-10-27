/**
 * Outbound calling window in IST (default 09:00-20:00, configurable per org). India has no DST,
 * so IST is a fixed UTC+05:30 offset.
 */
const IST_OFFSET_MS = 5.5 * 3600_000;

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
};

export function istMinutesOfDay(at: Date): number {
  const ist = new Date(at.getTime() + IST_OFFSET_MS);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

export function isWithinCallingHours(at: Date, window: { start: string; end: string }): boolean {
  const m = istMinutesOfDay(at);
  return m >= toMinutes(window.start) && m < toMinutes(window.end);
}

/** Earliest instant >= `at` inside the window. */
export function nextCallingTime(at: Date, window: { start: string; end: string }): Date {
  if (isWithinCallingHours(at, window)) return at;
  const m = istMinutesOfDay(at);
  const start = toMinutes(window.start);
  const ist = new Date(at.getTime() + IST_OFFSET_MS);
  const midnightIstUtc = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_OFFSET_MS;
  const dayOffset = m < start ? 0 : 1;
  return new Date(midnightIstUtc + dayOffset * 86400_000 + start * 60_000);
}

/** IST "YYYY-MM-DD" and "HH:MM" for a Date. */
export function istParts(at: Date): { date: string; time: string; weekday: number } {
  const ist = new Date(at.getTime() + IST_OFFSET_MS);
  return { date: ist.toISOString().slice(0, 10), time: ist.toISOString().slice(11, 16), weekday: ist.getUTCDay() };
}

/** Build a UTC Date from an IST date and time. */
export function istToDate(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+05:30`);
}
