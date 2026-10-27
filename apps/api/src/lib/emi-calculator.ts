export function calculateEMI(
  price: number,
  downPayment: number,
  tenureMonths: number,
  interestRate: number
): {emi: number, totalInterest: number, totalAmount: number};

export function calculateEMI(params: { price: number; downPayment: number; tenureMonths: number; interestRate: number }): {emi: number, totalInterest: number, totalAmount: number};

export function calculateEMI(
  arg1: number | { price: number; downPayment: number; tenureMonths: number; interestRate: number },
  downPayment?: number,
  tenureMonths?: number,
  interestRate?: number
): {emi: number, totalInterest: number, totalAmount: number} {
  const { price, downPayment: dp, tenureMonths: tm, interestRate: ir } = 
    typeof arg1 === "object" ? arg1 : { price: arg1, downPayment: downPayment!, tenureMonths: tenureMonths!, interestRate: interestRate! };

  const principal = price - dp;
  if (principal <= 0) return { emi: 0, totalInterest: 0, totalAmount: price };
  const monthlyRate = ir / 12 / 100;
  const n = tm;
  const emi = principal * (monthlyRate * Math.pow(1 + monthlyRate, n)) / (Math.pow(1 + monthlyRate, n) - 1);
  const totalAmount = emi * n;
  const totalInterest = totalAmount - principal;
  return { emi: Math.round(emi), totalInterest: Math.round(totalInterest), totalAmount: Math.round(totalAmount) };
}