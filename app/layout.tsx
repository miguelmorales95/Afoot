import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Analytics } from "@vercel/analytics/next";
import { suggestMailto } from "@/lib/site";
import AppProvider from "@/components/AppProvider";
import SiteHeader from "@/components/SiteHeader";
import "./globals.css";

export const metadata: Metadata = {
  title: "Light Pole — what's posted around LA",
  description:
    "Everything posted around LA, from big nights out to karaoke, game nights and open mics. Gathered from venue calendars and newsletters.",
  openGraph: {
    title: "Light Pole",
    description: "What's posted around LA: the big nights and the small stuff, all on one pole.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#2b2119",
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
        {/* Page-visit counts for sponsor reports: no cookies, nothing that follows a person
            across days. Turn on under the project's Analytics tab in Vercel. */}
        <Analytics />
        <footer className="mx-auto max-w-6xl px-4 py-10 text-sm text-white/40">
          <p>
            Light Pole is where LA posts what&apos;s happening: the big nights and the small stuff,
            gathered from venue calendars and newsletters. Know a spot we&apos;re missing?{" "}
            <Link href="/submit" className="text-[#ffe45c] hover:underline">
              Add it
            </Link>{" "}
            or{" "}
            <a href={suggestMailto()} className="text-[#ffe45c] hover:underline">
              email it to us
            </a>
            .
          </p>
          <p className="mt-3">
            <Link href="/privacy" className="hover:text-white/70 hover:underline">
              Privacy
            </Link>
            {" · "}No ad tracking, and we never sell your data.
          </p>
        </footer>
      </body>
    </html>
  );
}
