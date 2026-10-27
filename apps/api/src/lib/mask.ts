/**
 * PII masking for logs. Phone numbers keep the last 4 digits only.
 * Recognises Indian 10-digit mobiles with optional +91 / 0 prefix and generic E.164.
 */
const PHONE_RE = /(\+?\d[\d\s-]{8,14}\d)/g;

export function maskPhone(phone: string | undefined | null): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return phone;
  return `${phone.startsWith("+") ? "+" : ""}${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

export function maskText(text: string): string {
  return text.replace(PHONE_RE, (m) => {
    const digits = m.replace(/\D/g, "");
    return digits.length >= 10 ? maskPhone(m) : m;
  });
}

/** Normalise an Indian phone to E.164 (+91XXXXXXXXXX). Leaves other E.164 numbers intact. */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `+91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return `+${digits}`;
}
