import type { Metadata } from "next";
import { AuthProvider } from "@/lib/auth-context";
import "./globals.css";

export const metadata: Metadata = {
  title: "AXO Voice: AI receptionist for Indian businesses",
  description: "Answers your calls and WhatsApp in a natural Indian voice, in English, Hindi, Hinglish and Kannada. Books appointments and captures every lead.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
