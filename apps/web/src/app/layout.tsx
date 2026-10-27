import "./globals.css";
import { SessionsProvider } from "@/lib/auth";
import { Metadata } from "next";

export async function metadata(): Promise<Metadata> {
  return {
    title: "AXO Voice Auto - Dashboard",
    description: "AXO Voice Auto - Multilingual AI Voice Agent Platform for Showrooms",
  };
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SessionsProvider>
      <html lang="en">
        <body>{children}</body>
      </html>
    </SessionsProvider>
  );
}