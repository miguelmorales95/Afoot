"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { supabaseBrowser, hasAuth } from "@/lib/supabaseBrowser";

export interface AppUser {
  id: string;
  name: string;
  avatar: string | null;
  demo: boolean;
}

interface AppCtx {
  ready: boolean;
  hasAuth: boolean;
  user: AppUser | null;
  goingSet: Set<string>;
  signInWithGoogle: () => void;
  signInWithFacebook: () => void;
  signOutUser: () => void;
  requireAuth: () => void; // sign in (real provider or demo)
  toggleGoing: (occurrenceId: string) => void;
}

const Ctx = createContext<AppCtx | null>(null);
export const useApp = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApp must be used within AppProvider");
  return c;
};

const DEMO_USER_KEY = "afoot_demo_user";
const GOING_KEY = "afoot_going";

function readGoingLocal(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(GOING_KEY) || "[]"));
  } catch {
    return new Set();
  }
}
function writeGoingLocal(set: Set<string>) {
  try {
    localStorage.setItem(GOING_KEY, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

export default function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AppUser | null>(null);
  const [goingSet, setGoingSet] = useState<Set<string>>(new Set());
  const userRef = useRef<AppUser | null>(null);
  userRef.current = user;

  // Load the user's RSVPs (real = Supabase, demo = localStorage).
  const loadGoing = useCallback(async (u: AppUser | null) => {
    if (!u) return setGoingSet(new Set());
    if (!u.demo && supabaseBrowser) {
      const { data } = await supabaseBrowser.from("rsvps").select("occurrence_id").eq("user_id", u.id);
      setGoingSet(new Set((data ?? []).map((r) => r.occurrence_id as string)));
    } else {
      setGoingSet(readGoingLocal());
    }
  }, []);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    (async () => {
      if (hasAuth && supabaseBrowser) {
        const { data } = await supabaseBrowser.auth.getSession();
        const sUser = data.session?.user ?? null;
        const mapped = sUser ? mapSupabaseUser(sUser) : null;
        setUser(mapped);
        await loadGoing(mapped);
        const { data: sub } = supabaseBrowser.auth.onAuthStateChange((_e, session) => {
          const mu = session?.user ? mapSupabaseUser(session.user) : null;
          setUser(mu);
          void loadGoing(mu);
        });
        unsub = () => sub.subscription.unsubscribe();
      } else {
        // demo mode: restore a simulated user if present
        let demoUser: AppUser | null = null;
        try {
          const raw = localStorage.getItem(DEMO_USER_KEY);
          if (raw) demoUser = JSON.parse(raw);
        } catch {
          /* ignore */
        }
        setUser(demoUser);
        await loadGoing(demoUser);
      }
      setReady(true);
    })();
    return () => unsub?.();
  }, [loadGoing]);

  const signInDemo = useCallback(() => {
    const demoUser: AppUser = { id: "demo-user", name: "You (demo)", avatar: null, demo: true };
    try {
      localStorage.setItem(DEMO_USER_KEY, JSON.stringify(demoUser));
    } catch {
      /* ignore */
    }
    setUser(demoUser);
    void loadGoing(demoUser);
  }, [loadGoing]);

  const oauth = useCallback((provider: "google" | "facebook") => {
    if (hasAuth && supabaseBrowser) {
      void supabaseBrowser.auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
    } else {
      signInDemo();
    }
  }, [signInDemo]);

  const signOutUser = useCallback(() => {
    if (hasAuth && supabaseBrowser && !userRef.current?.demo) {
      void supabaseBrowser.auth.signOut();
    }
    try {
      localStorage.removeItem(DEMO_USER_KEY);
    } catch {
      /* ignore */
    }
    setUser(null);
    setGoingSet(new Set());
  }, []);

  const requireAuth = useCallback(() => {
    if (userRef.current) return;
    if (hasAuth) oauth("google");
    else signInDemo();
  }, [oauth, signInDemo]);

  const toggleGoing = useCallback(
    (occurrenceId: string) => {
      const u = userRef.current;
      if (!u) return requireAuth();
      setGoingSet((prev) => {
        const next = new Set(prev);
        const going = !next.has(occurrenceId);
        if (going) next.add(occurrenceId);
        else next.delete(occurrenceId);

        if (!u.demo && supabaseBrowser) {
          if (going)
            void supabaseBrowser.from("rsvps").insert({ user_id: u.id, occurrence_id: occurrenceId });
          else
            void supabaseBrowser
              .from("rsvps")
              .delete()
              .eq("user_id", u.id)
              .eq("occurrence_id", occurrenceId);
        } else {
          writeGoingLocal(next);
        }
        return next;
      });
    },
    [requireAuth],
  );

  return (
    <Ctx.Provider
      value={{
        ready,
        hasAuth,
        user,
        goingSet,
        signInWithGoogle: () => oauth("google"),
        signInWithFacebook: () => oauth("facebook"),
        signOutUser,
        requireAuth,
        toggleGoing,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

function mapSupabaseUser(u: { id: string; user_metadata?: Record<string, unknown>; email?: string }): AppUser {
  const meta = u.user_metadata ?? {};
  const name =
    (meta.full_name as string) ||
    (meta.name as string) ||
    (u.email ? u.email.split("@")[0] : "You");
  return { id: u.id, name, avatar: (meta.avatar_url as string) || null, demo: false };
}
