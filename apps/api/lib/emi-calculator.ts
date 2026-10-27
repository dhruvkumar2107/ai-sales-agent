export function calculateEMI({ price, downPayment, tenureMonths, interestRate }: { price: number; downPayment: number; tenureMonths: number; interestRate: number }) {
  const principal = price - downPayment;
  if (principal <= 0) return { emi: 0, totalInterest: 0, totalAmount: price };
  const monthlyRate = interestRate / 12 / 100;
  const n = tenureMonths;
  const emi = principal * (monthlyRate * Math.pow(1 + monthlyRate, n)) / (Math.pow(1 + monthlyRate, n) - 1);
  const totalAmount = emi * n;
  const totalInterest = totalAmount - principal;
  return { emi: Math.round(emi), totalInterest: Math.round(totalInterest), totalAmount: Math.round(totalAmount) };
}