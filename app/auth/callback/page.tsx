"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

export default function AuthCallback() {
  const router = useRouter();
  useEffect(() => {
    (async () => {
      if (supabaseBrowser) {
        try {
          await supabaseBrowser.auth.exchangeCodeForSession(window.location.href);
        } catch {
          /* ignore — fall through to home */
        }
      }
      router.replace("/");
    })();
  }, [router]);

  return (
    <main className="mx-auto max-w-sm px-4 py-24 text-center text-white/60">
      Signing you in…
    </main>
  );
}
