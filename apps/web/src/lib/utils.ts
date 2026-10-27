import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
export const formatINR = (n: number | undefined) => (n === undefined ? "-" : inr.format(n));
export const formatINR2 = (n: number | undefined) => (n === undefined ? "-" : `₹${n.toFixed(2)}`);

export const lakh = (n: number) => `₹${(n / 100000).toFixed(2).replace(/\.?0+$/, "")} L`;

export function formatDateTime(iso?: string) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function formatDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Mask phone numbers in the UI for roles that don't need them in full. */
export const maskPhone = (p?: string) => (p && p.length > 4 ? `${"•".repeat(Math.max(0, p.length - 4))}${p.slice(-4)}` : (p ?? ""));

export const humanize = (s?: string) => (s ? s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "-");
