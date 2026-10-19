import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { suggestMailto } from "@/lib/site";
import AppProvider from "@/components/AppProvider";
import SiteHeader from "@/components/SiteHeader";
import "./globals.css";

export const metadata: Metadata = {
  title: "WhatsUp LA — small events near you",
  description:
    "Karaoke, game nights, live music and the small local events that never make it onto Eventbrite. Sourced from LA venue calendars and newsletters.",
  openGraph: {
    title: "WhatsUp LA",
    description: "The small local events near you that are hard to find anywhere else.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0f",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <AppProvider>
          <SiteHeader />
          {children}
        </AppProvider>
        <footer className="mx-auto max-w-6xl px-4 py-10 text-sm text-white/40">
          <p>
            WhatsUp LA surfaces the small stuff — karaoke, game nights, local shows — from venue
            calendars and newsletters. Know a spot we&apos;re missing?{" "}
            <Link href="/submit" className="text-fuchsia-400 hover:underline">
              Add it
            </Link>{" "}
            or{" "}
            <a href={suggestMailto()} className="text-fuchsia-400 hover:underline">
              email it to us
            </a>
            .
          </p>
        </footer>
      </body>
    </html>
  );
}
