"use client";

import { useEffect, useState } from "react";
import { filterLine } from "@/lib/weeklyEmail";

/**
 * "Your week on the pole": sign up for one email a week built from the filters on screen right
 * now (place + event types). Small spots and curator picks go first, plus a short note from the
 * person who runs Light Pole. Double opt-in: a confirmation email comes first.
 */
export default function WeeklyEmailSheet({
  loc, placeName, types, onClose, onChangeFilters,
}: {
  loc: { lat: number; lng: number; label: string; all?: boolean };
  placeName: string;
  types: string[];
  onClose: () => void;
  onChangeFilters: () => void;
}) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "updated" | "error">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const place = loc.all ? "All of LA" : placeName === "you" ? "your location" : placeName;
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setStatus("sending");
    const company = new FormData(e.currentTarget).get("company");
    try {
      const res = await fetch("/api/newsletter/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, place, lat: loc.lat, lng: loc.lng, all: !!loc.all, types, company }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong.");
      setStatus(data.updated ? "updated" : "sent");
    } catch (err) {
      setMessage((err as Error).message);
      setStatus("error");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Weekly email"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-t-3xl border border-white/10 bg-[#2b2119] p-5 pb-8 sm:rounded-3xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-poster text-[28px] uppercase leading-none text-[#fff23a]">Your week on the pole</h2>
          <button onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-full text-white/60 hover:bg-white/10 hover:text-white">
            ✕
          </button>
        </div>

        {status === "sent" || status === "updated" ? (
          <p className="mt-4 text-white/80">
            {status === "sent"
              ? "Check your inbox and tap the link to confirm. Then it's one email every Thursday morning."
              : "Updated. Your weekly email now follows these filters."}
          </p>
        ) : (
          <form onSubmit={submit} className="mt-3 space-y-4">
            <p className="text-sm text-white/70">
              One email every Thursday morning: <b className="text-white">{filterLine(place, types)}</b> for the
              week ahead, small spots first, plus a quick note from me (the one dude running this).{" "}
              <button type="button" onClick={onChangeFilters} className="text-[#ffe45c] underline-offset-2 hover:underline">
                Change filters
              </button>
            </p>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              aria-label="Your email"
              autoComplete="email"
              className="w-full rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm outline-none placeholder:text-white/30 focus:border-[#ffe45c]/60"
            />
            <input type="text" name="company" tabIndex={-1} autoComplete="off" className="absolute left-[-9999px]" aria-hidden="true" />
            {status === "error" && <p className="text-sm text-red-300">{message}</p>}
            <button
              type="submit"
              disabled={status === "sending"}
              className="w-full rounded-full bg-[#fff23a] px-5 py-3 text-sm font-extrabold text-[#111] hover:bg-[#fff58a] disabled:opacity-50"
            >
              {status === "sending" ? "Sending…" : "Send me the week"}
            </button>
            <p className="text-center text-[11px] text-white/40">One email a week. Unsubscribe in one tap. We never share your address.</p>
          </form>
        )}
      </div>
    </div>
  );
}
