"use client";

import { useState } from "react";

// "Share a source": an Instagram account, a newsletter, or a calendar page we should pull events
// from. Used on /submit (Source tab) and in the popup the feed's tear-off flyer opens.

export type SourceType = "instagram" | "newsletter" | "website";
export const SOURCE_TYPES: Record<SourceType, { label: string; ticket: string; field: string; placeholder: string }> = {
  instagram: { label: "📸 Instagram", ticket: "Instagram", field: "Instagram handle or link", placeholder: "@handle" },
  newsletter: { label: "📬 Newsletter", ticket: "Newsletter", field: "Signup page or website", placeholder: "https://..." },
  // Stored as "website" (older submissions use it); shown as a calendar, which is what we want.
  website: { label: "🗓️ Calendar", ticket: "Calendar", field: "Link to the calendar or events page", placeholder: "https://..." },
};

export default function SourceForm({ initialType = "newsletter", initialMine = false, onClose }: {
  initialType?: SourceType;
  initialMine?: boolean;
  /** In a popup: shows a Close button once sent. */
  onClose?: () => void;
}) {
  const [sourceType, setSourceType] = useState<SourceType>(initialType);
  const [mine, setMine] = useState(initialMine);
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  // "This is my account" only means something for an Instagram account.
  const curator = mine && sourceType === "instagram";

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setStatus("sending");
    const body = { ...Object.fromEntries(new FormData(e.currentTarget).entries()), kind: "source" };
    try {
      const res = await fetch("/api/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
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
      <div className="py-6 text-center">
        <div className="text-4xl">🎉</div>
        <h2 className="mt-3 text-2xl font-bold">Thanks, got it!</h2>
        <p className="mt-2 text-sm text-white/60">
          {curator ? "We'll take a look at your page and reach out about crediting your posts." : "We'll check it out and start pulling events from it if it's a fit."}
        </p>
        {onClose && (
          <button type="button" onClick={onClose} className="mt-5 rounded-full bg-[#f3ece2] px-5 py-2.5 text-sm font-bold text-black">Back to the pole</button>
        )}
      </div>
    );
  }

  return (
    <>
      <h2 className="text-2xl font-bold tracking-tight">{curator ? "Become a curator" : "Share a source"}</h2>
      <p className="mt-2 text-sm text-white/60">
        {mine
          ? "Post LA events on Instagram? Tell us your handle. We add the events you post, credited to you and linked back to your page."
          : "An Instagram account, a newsletter, or a calendar page that posts LA events we're missing. We'll check it out and start pulling events from it."}
      </p>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-white/80">What is it?</label>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(SOURCE_TYPES) as SourceType[]).map((t) => (
              <button key={t} type="button" onClick={() => setSourceType(t)} aria-pressed={sourceType === t}
                className={`rounded-full px-3 py-1.5 text-sm ${sourceType === t ? "bg-white text-black" : "bg-white/5 text-white/70 hover:bg-white/10"}`}>
                {SOURCE_TYPES[t].label}
              </button>
            ))}
          </div>
          <input type="hidden" name="source_type" value={sourceType} />
        </div>
        <Field key={sourceType} label={`${SOURCE_TYPES[sourceType].field} *`} name="source_url" required placeholder={SOURCE_TYPES[sourceType].placeholder} />
        <Field label="Name" name="source_name" placeholder="e.g. 'LA Taco newsletter' or 'Eastside DIY shows'" />
        {sourceType === "instagram" && (
          <label className="flex items-center gap-2 text-sm text-white/80">
            <input type="checkbox" name="mine" value="1" checked={mine} onChange={(e) => setMine(e.target.checked)} className="h-4 w-4 accent-fuchsia-600" />
            This is my account. I&apos;d like to be a Light Pole curator.
          </label>
        )}
        <div>
          <label className="mb-1 block text-sm font-medium text-white/80">Anything we should know?</label>
          <textarea name="note" rows={2} placeholder="e.g. 'Posts warehouse shows in the Eastside every week.'"
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm outline-none placeholder:text-white/30 focus:border-fuchsia-500/50" />
        </div>
        <Field label={curator ? "Your email *" : "Your email (optional)"} name="submitter_email" type="email" required={curator} placeholder="So we can say thanks / follow up" />
        <input type="text" name="company" tabIndex={-1} autoComplete="off" className="absolute left-[-9999px]" aria-hidden="true" />
        {status === "error" && <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">{message}</p>}
        <button type="submit" disabled={status === "sending"}
          className="w-full rounded-full bg-fuchsia-600 px-5 py-3 text-sm font-semibold text-white hover:bg-fuchsia-500 disabled:opacity-50">
          {status === "sending" ? "Sending…" : curator ? "Sign me up" : "Share it"}
        </button>
      </form>
    </>
  );
}

function Field({ label, name, type = "text", required, placeholder }: { label: string; name: string; type?: string; required?: boolean; placeholder?: string }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-white/80">{label}</label>
      <input type={type} name={name} required={required} placeholder={placeholder}
        className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm outline-none placeholder:text-white/30 focus:border-fuchsia-500/50" />
    </div>
  );
}
