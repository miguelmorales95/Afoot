import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { suggestMailto } from "@/lib/site";
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
        <header className="sticky top-0 z-20 border-b border-white/10 bg-[#0a0a0f]/80 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span className="text-xl">📍</span>
              <span>
                WhatsUp<span className="text-fuchsia-400"> LA</span>
              </span>
            </Link>
            <nav className="flex items-center gap-2 text-sm text-white/70">
              <a
                href={suggestMailto()}
                className="hidden rounded-full px-3 py-1.5 font-medium text-white/70 hover:text-white sm:inline"
              >
                Email us a spot
              </a>
              <Link href="/submit" className="rounded-full bg-white/10 px-3 py-1.5 font-medium text-white hover:bg-white/20">
                + Add a venue
              </Link>
            </nav>
          </div>
        </header>
        {children}
        <footer className="mx-auto max-w-5xl px-4 py-10 text-sm text-white/40">
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
