import type { LeadFields, LeadScore } from "@axo/shared";

export interface ScoreInput extends LeadFields {
  testDriveBooked?: boolean;
  /** Raw utterances; buying-intent phrases force "hot" */
  utterances?: string[];
}

// Hindi/Hinglish allow a couple of words between "aaj" and the verb ("aaj showroom aa raha hoon").
const BUY_NOW = /(want|going|ready) to buy|buy (it )?today|book(ing)? (it )?today|visiting (the showroom )?today|coming (to the showroom )?today|aaj( \S+){0,2} (khareed|lena|book|aa raha|aa rahi|aaunga|aaungi|aa jaunga)|आज( \S+){0,2} (खरीद|आ रहा|आ रही|आऊंगा|आऊँगा)|ಇಂದು( \S+){0,2} (ಖರೀದಿ|ಬರುತ್ತೇನೆ)/i;

/**
 * Transparent points-based lead score (0-100):
 *   timeline: this week 35, this month 20, 3+ months 5
 *   test drive booked 20, model chosen 10 (+5 variant), budget known 10,
 *   payment mode cash/loan 10, exchange 5, name+phone 5
 * Explicit buy-now / visiting-today intent is always hot.
 * hot >= 60, warm >= 30, else cold.
 */
export function scoreLead(i: ScoreInput): { score: LeadScore; value: number; reasons: string[] } {
  const reasons: string[] = [];
  let v = 0;
  const add = (pts: number, why: string) => {
    v += pts;
    reasons.push(`${why} (+${pts})`);
  };

  if (i.timeline === "this_week") add(35, "buying this week");
  else if (i.timeline === "this_month") add(20, "buying this month");
  else if (i.timeline === "three_months_plus") add(5, "buying in 3+ months");
  if (i.testDriveBooked) add(20, "test drive booked");
  if (i.interestedModel) add(10, "model chosen");
  if (i.variant) add(5, "variant chosen");
  if (i.budget) add(10, "budget shared");
  if (i.paymentMode === "cash" || i.paymentMode === "loan") add(10, `payment by ${i.paymentMode}`);
  if (i.hasExchange || i.paymentMode === "exchange") add(5, "has exchange vehicle");
  if (i.name && i.phone) add(5, "contact details");

  const intent = i.buyingIntent === "buy_today" || i.buyingIntent === "visiting_today" || (i.utterances ?? []).some((u) => BUY_NOW.test(u));
  if (intent) {
    reasons.push("explicit buy-now / visiting-today intent");
    return { score: "hot", value: Math.max(v, 90), reasons };
  }
  const value = Math.min(100, v);
  return { score: value >= 60 ? "hot" : value >= 30 ? "warm" : "cold", value, reasons };
}

export const hasBuyNowIntent = (text: string) => BUY_NOW.test(text);
