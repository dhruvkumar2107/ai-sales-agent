import { describe, expect, it } from "vitest";
import { availableSlots, normalizeDate, normalizeTime } from "../src/bookings/slots";
import { decideRetry } from "../src/campaigns/retry";
import { isWithinCallingHours, nextCallingTime } from "../src/compliance/calling-hours";
import { parseCatalogCsv } from "../src/integrations/csv-import";
import { scoreLead } from "../src/leads/scoring";
import { maskPhone, maskText, normalizePhone } from "../src/lib/mask";
import { findModel } from "../src/tools/catalog";
import { calculateEmi } from "../src/tools/emi";

describe("EMI calculator", () => {
  it("matches the standard reducing-balance formula", () => {
    // 10 lakh at 9.5% for 60 months -> 21,002 (bank calculators agree)
    const r = calculateEmi({ price: 1250000, downPayment: 250000, tenureMonths: 60, annualRate: 9.5 });
    expect(r.loanAmount).toBe(1000000);
    expect(r.emi).toBe(21002);
    expect(r.totalPayable).toBe(1260120);
    expect(r.totalInterest).toBe(260120);
  });

  it("handles zero interest and full down payment", () => {
    expect(calculateEmi({ price: 120000, downPayment: 0, tenureMonths: 12, annualRate: 0 }).emi).toBe(10000);
    expect(calculateEmi({ price: 100000, downPayment: 150000, tenureMonths: 12, annualRate: 10 }).emi).toBe(0);
  });

  it("rejects invalid input", () => {
    expect(() => calculateEmi({ price: 0, downPayment: 0, tenureMonths: 12, annualRate: 9 })).toThrow();
    expect(() => calculateEmi({ price: 100000, downPayment: 0, tenureMonths: 0, annualRate: 9 })).toThrow();
  });
});

describe("lead scoring", () => {
  it("scores buy-now intent as hot regardless of other fields", () => {
    expect(scoreLead({ utterances: ["I want to buy the Creta today"] }).score).toBe("hot");
    expect(scoreLead({ utterances: ["main aaj showroom aa raha hoon"] }).score).toBe("hot");
    expect(scoreLead({ buyingIntent: "visiting_today" }).score).toBe("hot");
  });

  it("combines timeline, test drive and qualification", () => {
    expect(scoreLead({ timeline: "this_week", interestedModel: "Creta", budget: 1200000, paymentMode: "loan" }).score).toBe("hot");
    expect(scoreLead({ timeline: "this_month", interestedModel: "Venue" }).score).toBe("warm");
    expect(scoreLead({ timeline: "three_months_plus" }).score).toBe("cold");
    expect(scoreLead({ interestedModel: "Venue", testDriveBooked: true }).score).toBe("warm");
  });
});

describe("slot logic", () => {
  const hours = { days: [0, 1, 2, 3, 4, 5, 6], open: "10:00", close: "12:00" };
  const now = new Date("2026-10-27T00:00:00+05:30");

  it("generates slots within working hours", () => {
    expect(availableSlots({ date: "2026-10-28", workingHours: hours, slotMinutes: 30, capacity: 1, booked: [], now })).toEqual(["10:00", "10:30", "11:00", "11:30"]);
  });

  it("respects capacity with overlapping bookings", () => {
    const booked = [{ start: "2026-10-28T10:00:00+05:30", end: "2026-10-28T10:30:00+05:30" }];
    expect(availableSlots({ date: "2026-10-28", workingHours: hours, slotMinutes: 30, capacity: 1, booked, now })).toEqual(["10:30", "11:00", "11:30"]);
    expect(availableSlots({ date: "2026-10-28", workingHours: hours, slotMinutes: 30, capacity: 2, booked, now })).toContain("10:00");
  });

  it("excludes past slots, the notice period, closed days and holidays", () => {
    const midMorning = new Date("2026-10-28T10:10:00+05:30");
    expect(availableSlots({ date: "2026-10-28", workingHours: hours, slotMinutes: 30, capacity: 1, booked: [], now: midMorning, leadMinutes: 30 })).toEqual(["11:00", "11:30"]);
    expect(availableSlots({ date: "2026-10-28", workingHours: { ...hours, days: [1] }, slotMinutes: 30, capacity: 1, booked: [], now })).toEqual([]); // Wednesday closed
    expect(availableSlots({ date: "2026-10-28", workingHours: hours, slotMinutes: 30, capacity: 1, booked: [], now, holidays: ["2026-10-28"] })).toEqual([]);
  });

  it("multi-slot service jobs need capacity across their whole duration", () => {
    const booked = [{ start: "2026-10-28T11:00:00+05:30", end: "2026-10-28T12:00:00+05:30" }];
    expect(availableSlots({ date: "2026-10-28", workingHours: hours, slotMinutes: 30, durationMinutes: 60, capacity: 1, booked, now })).toEqual(["10:00"]);
  });

  it("normalises loose times and dates", () => {
    expect(normalizeTime("11 am")).toBe("11:00");
    expect(normalizeTime("4:30pm")).toBe("16:30");
    expect(normalizeTime("12 am")).toBe("00:00");
    expect(normalizeTime("banana")).toBeNull();
    expect(normalizeDate("tomorrow", now)).toBe("2026-10-28");
    expect(normalizeDate("2026-11-02")).toBe("2026-11-02");
  });
});

describe("retry logic and calling hours", () => {
  const window = { start: "09:00", end: "20:00" };
  const at = (s: string) => new Date(`${s}+05:30`);

  it("retries unanswered calls with configured delays", () => {
    const d = decideRetry({ outcome: "no_answer", attempts: 1, maxAttempts: 3, retryMinutes: [30, 120], window, now: at("2026-10-27T11:00:00") });
    expect(d.status).toBe("pending");
    expect(d.nextAttemptAt).toBe(at("2026-10-27T11:30:00").toISOString());
    const d2 = decideRetry({ outcome: "busy", attempts: 2, maxAttempts: 3, retryMinutes: [30, 120], window, now: at("2026-10-27T11:00:00") });
    expect(d2.nextAttemptAt).toBe(at("2026-10-27T13:00:00").toISOString());
  });

  it("pushes retries that land after hours to the next morning", () => {
    const d = decideRetry({ outcome: "no_answer", attempts: 1, maxAttempts: 3, retryMinutes: [120], window, now: at("2026-10-27T19:00:00") });
    expect(d.nextAttemptAt).toBe(at("2026-10-28T09:00:00").toISOString());
  });

  it("stops after max attempts, on answer, and on opt-out", () => {
    expect(decideRetry({ outcome: "no_answer", attempts: 3, maxAttempts: 3, retryMinutes: [30], window }).status).toBe("failed");
    expect(decideRetry({ outcome: "test_drive_booked", attempts: 1, maxAttempts: 3, retryMinutes: [30], window }).status).toBe("completed");
    expect(decideRetry({ outcome: "opted_out", attempts: 1, maxAttempts: 3, retryMinutes: [30], window }).status).toBe("opted_out");
  });

  it("knows the IST calling window", () => {
    expect(isWithinCallingHours(at("2026-10-27T08:59:00"), window)).toBe(false);
    expect(isWithinCallingHours(at("2026-10-27T09:00:00"), window)).toBe(true);
    expect(isWithinCallingHours(at("2026-10-27T20:00:00"), window)).toBe(false);
    expect(nextCallingTime(at("2026-10-27T06:00:00"), window).toISOString()).toBe(at("2026-10-27T09:00:00").toISOString());
  });
});

describe("catalog import and matching", () => {
  const csv = `brand,model,type,variant,fuel,transmission,ex_showroom_price,on_road_min,on_road_max,colors,aliases
Hyundai,Creta,car,E,petrol,manual,1100000,1290000,1330000,White|Black,kreta|क्रेटा
Hyundai,Creta,car,SX Diesel AT,diesel,automatic,1850000,,,Grey,
Honda,Activa,scooter,STD,Petrol,CVT,78000,92000,95000,,
Bad,Row,truck,X,petrol,manual,abc,,,,`;

  it("groups variants by model and reports bad rows", () => {
    const { models, errors } = parseCatalogCsv("org", csv);
    expect(models).toHaveLength(2);
    const creta = models.find((m) => m.model === "Creta")!;
    expect(creta.variants).toHaveLength(2);
    expect(creta.colors).toEqual(["White", "Black", "Grey"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.row).toBe(5);
  });

  it("finds models by alias, transliteration and misspelling", () => {
    const { models } = parseCatalogCsv("org", csv);
    expect(findModel(models, "kreta")?.model).toBe("Creta");
    expect(findModel(models, "क्रेटा")?.model).toBe("Creta");
    expect(findModel(models, "Hyundai Creta SX")?.model).toBe("Creta");
    expect(findModel(models, "Activaa")?.model).toBe("Activa");
    expect(findModel(models, "Fortuner")).toBeNull();
  });
});

describe("PII masking", () => {
  it("masks phone numbers in logs", () => {
    expect(maskPhone("+919845012345")).toBe("+********2345");
    expect(maskText("Call 9845012345 now")).toBe("Call ******2345 now");
    expect(normalizePhone("098450 12345")).toBe("+919845012345");
    expect(normalizePhone("9845012345")).toBe("+919845012345");
  });
});
