"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export default function SubmitPage() {
  const [kind, setKind] = useState<"event" | "venue">("event");
  // /submit?kind=venue opens the venue form (e.g. from a "suggest a venue" link).
  useEffect(() => { if (new URLSearchParams(window.location.search).get("kind") === "venue") setKind("venue"); }, []);
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [readable, setReadable] = useState(true);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setStatus("sending");
    const fd = new FormData(e.currentTarget);
    const body = { ...Object.fromEntries(fd.entries()), ...(kind === "event" && { kind: "event" }) };
    try {
      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong.");
      setReadable(data.readable !== false);
      setStatus("done");
    } catch (err) {
      setMessage((err as Error).message);
      setStatus("error");
    }
  };

  if (status === "done") {
    return (
      <main className="mx-auto max-w-lg px-4 py-20 text-center">
        <div className="text-4xl">🎉</div>
        <h1 className="mt-4 text-2xl font-bold">Thanks — got it!</h1>
        <p className="mt-2 text-white/60">
          {kind === "event"
            ? readable
              ? "We read the event from the link. Someone checks it, then it shows up on Afoot."
              : "We couldn't read that page by ourselves, so we'll use the details you typed. Someone checks it before it shows up."
            : "We'll review the venue and start pulling in its events. The more small spots people add, the better Afoot gets."}
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-full bg-fuchsia-600 px-5 py-3 text-sm font-semibold hover:bg-fuchsia-500"
        >
          Back to events
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg px-4 py-12">
      <div className="flex gap-2 rounded-full bg-white/5 p-1 text-sm" role="tablist">
        {(["event", "venue"] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)}
            className={`flex-1 rounded-full px-4 py-2 font-semibold ${kind === k ? "bg-fuchsia-600 text-white" : "text-white/60"}`}>
            {k === "event" ? "Add an event" : "Add a venue"}
          </button>
        ))}
      </div>

      {kind === "event" ? (
        <>
          <h1 className="mt-6 text-2xl font-bold tracking-tight">Add an event</h1>
          <p className="mt-2 text-sm text-white/60">
            Paste the link to an event: Facebook, Eventbrite, Ticketmaster, Meetup, or the venue&apos;s own page.
            We&apos;ll read what we can. Facebook often hides events from people who aren&apos;t signed in, so add
            the basics below in case.
          </p>
          <form onSubmit={onSubmit} className="mt-8 space-y-4">
            <Field label="Event link *" name="event_url" type="url" required placeholder="https://www.facebook.com/events/..." />
            <Field label="Event name" name="title" placeholder="Open mic night" />
            <Field label="Date and start time" name="starts" type="datetime-local" />
            <Field label="Place" name="place" placeholder="Venue or park name" />
            <Field label="Address" name="address" placeholder="123 Main St, Los Angeles" />
            <div>
              <label className="mb-1 block text-sm font-medium text-white/80">Anything we should know?</label>
              <textarea name="note" rows={2} placeholder="e.g. 'Free, all ages, happens every month.'"
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm outline-none placeholder:text-white/30 focus:border-fuchsia-500/50" />
            </div>
            <Field label="Your email (optional)" name="submitter_email" type="email" placeholder="So we can say thanks / follow up" />
            <input type="text" name="company" tabIndex={-1} autoComplete="off" className="absolute left-[-9999px]" aria-hidden="true" />
            {status === "error" && (
              <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">{message}</p>
            )}
            <button type="submit" disabled={status === "sending"}
              className="w-full rounded-full bg-fuchsia-600 px-5 py-3 text-sm font-semibold text-white hover:bg-fuchsia-500 disabled:opacity-50">
              {status === "sending" ? "Reading the link…" : "Submit event"}
            </button>
          </form>
        </>
      ) : (
      <>
      <h1 className="mt-6 text-2xl font-bold tracking-tight">Add a venue</h1>
      <p className="mt-2 text-sm text-white/60">
        Know a bar, brewery, cafe, or spot with karaoke, game nights, or local shows? Drop its
        site below. If it has a newsletter or events page, even better — that&apos;s where the good
        stuff hides.
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <Field label="Venue name" name="venue_name" placeholder="Smog City Brewing" />
        <Field
          label="Website *"
          name="website"
          type="url"
          required
          placeholder="https://..."
        />
        <Field
          label="Events / calendar page"
          name="events_url"
          type="url"
          placeholder="https://...  (optional, speeds us up)"
        />
        <Field label="Neighborhood or city" name="city" placeholder="Highland Park" />
        <div>
          <label className="mb-1 block text-sm font-medium text-white/80">
            Anything we should know?
          </label>
          <textarea
            name="note"
            rows={3}
            placeholder="e.g. 'Trivia every Tuesday, they post it in their IG stories and newsletter.'"
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm outline-none placeholder:text-white/30 focus:border-fuchsia-500/50"
          />
        </div>
        <Field
          label="Your email (optional)"
          name="submitter_email"
          type="email"
          placeholder="So we can say thanks / follow up"
        />

        {/* Honeypot: hidden from humans, catches bots. */}
        <input
          type="text"
          name="company"
          tabIndex={-1}
          autoComplete="off"
          className="absolute left-[-9999px]"
          aria-hidden="true"
        />

        {status === "error" && (
          <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {message}
          </p>
        )}

        <button
          type="submit"
          disabled={status === "sending"}
          className="w-full rounded-full bg-fuchsia-600 px-5 py-3 text-sm font-semibold text-white hover:bg-fuchsia-500 disabled:opacity-50"
        >
          {status === "sending" ? "Sending…" : "Submit venue"}
        </button>
      </form>
      </>
      )}
    </main>
  );
}

function Field({
  label,
  name,
  type = "text",
  required,
  placeholder,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-white/80">{label}</label>
      <input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm outline-none placeholder:text-white/30 focus:border-fuchsia-500/50"
      />
    </div>
  );
}
