"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { demoGetProfile, demoSaveProfile } from "@/lib/socialDemo";

export default function ProfilePage() {
  const { ready, user, hasAuth, requireAuth } = useApp();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [sharePhone, setSharePhone] = useState(true);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");

  useEffect(() => {
    if (!user) return;
    (async () => {
      if (hasAuth && supabaseBrowser && !user.demo) {
        const { data } = await supabaseBrowser
          .from("profiles")
          .select("display_name, phone, share_phone")
          .eq("id", user.id)
          .maybeSingle();
        setName(data?.display_name ?? user.name);
        setPhone(data?.phone ?? "");
        setSharePhone(data?.share_phone ?? true);
      } else {
        const p = demoGetProfile();
        setName(p.display_name || user.name);
        setPhone(p.phone);
        setSharePhone(p.share_phone);
      }
    })();
  }, [user, hasAuth]);

  if (ready && !user) {
    return (
      <main className="mx-auto max-w-md px-4 py-20 text-center">
        <p className="text-white/60">Sign in to set up your profile.</p>
        <button
          onClick={requireAuth}
          className="mt-4 rounded-full bg-fuchsia-600 px-5 py-3 text-sm font-semibold hover:bg-fuchsia-500"
        >
          Sign in
        </button>
      </main>
    );
  }

  const save = async () => {
    if (!user) return;
    setStatus("saving");
    if (hasAuth && supabaseBrowser && !user.demo) {
      await supabaseBrowser
        .from("profiles")
        .upsert({ id: user.id, display_name: name, phone, share_phone: sharePhone });
    } else {
      demoSaveProfile({ display_name: name, phone, share_phone: sharePhone });
    }
    setStatus("saved");
    setTimeout(() => setStatus("idle"), 1500);
  };

  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <h1 className="text-2xl font-bold tracking-tight">Your profile</h1>
      <p className="mt-2 text-sm text-white/50">
        Your name is shown to other attendees. Your phone is private — it&apos;s only shared when you
        approve someone&apos;s contact request.
      </p>

      <div className="mt-8 space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-white/80">Display name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm outline-none focus:border-fuchsia-500/50"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-white/80">
            Phone <span className="text-white/30">(private)</span>
          </label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(323) 555-0100"
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm outline-none focus:border-fuchsia-500/50"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-white/70">
          <input type="checkbox" checked={sharePhone} onChange={(e) => setSharePhone(e.target.checked)} />
          Allow my phone to be shared when I approve a request
        </label>

        <button
          onClick={save}
          disabled={status === "saving"}
          className="w-full rounded-full bg-fuchsia-600 px-5 py-3 text-sm font-semibold hover:bg-fuchsia-500 disabled:opacity-50"
        >
          {status === "saving" ? "Saving…" : status === "saved" ? "Saved ✓" : "Save"}
        </button>
      </div>
    </main>
  );
}
