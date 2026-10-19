"use client";

import { useState } from "react";
import Link from "next/link";

export default function SubmitPage() {
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setStatus("sending");
    const fd = new FormData(e.currentTarget);
    const body = Object.fromEntries(fd.entries());
    try {
      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong.");
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
          We&apos;ll review the venue and start pulling in its events. The more small spots people
          add, the better WhatsUp gets.
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
      <h1 className="text-2xl font-bold tracking-tight">Add a venue</h1>
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
