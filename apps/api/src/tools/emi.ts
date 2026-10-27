export interface EmiInput {
  price: number;
  downPayment: number;
  tenureMonths: number;
  /** Annual interest rate in percent, e.g. 9.5 */
  annualRate: number;
}

export interface EmiResult {
  loanAmount: number;
  emi: number;
  totalPayable: number;
  totalInterest: number;
}

/**
 * Reducing-balance EMI: E = P * r * (1 + r)^n / ((1 + r)^n - 1), with r the monthly rate.
 * Zero interest degrades to P / n. Amounts are rounded to whole rupees.
 */
export function calculateEmi({ price, downPayment, tenureMonths, annualRate }: EmiInput): EmiResult {
  if (price <= 0) throw new Error("price must be positive");
  if (tenureMonths <= 0) throw new Error("tenure must be positive");
  const loan = Math.max(0, price - Math.max(0, downPayment));
  if (loan === 0) return { loanAmount: 0, emi: 0, totalPayable: 0, totalInterest: 0 };
  const r = annualRate / 12 / 100;
  const emiExact = r === 0 ? loan / tenureMonths : (loan * r * Math.pow(1 + r, tenureMonths)) / (Math.pow(1 + r, tenureMonths) - 1);
  const emi = Math.round(emiExact);
  // What the customer actually pays: the rounded instalment, every month.
  const totalPayable = emi * tenureMonths;
  return { loanAmount: Math.round(loan), emi, totalPayable, totalInterest: totalPayable - Math.round(loan) };
}
