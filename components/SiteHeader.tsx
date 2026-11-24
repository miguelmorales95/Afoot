"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useApp } from "./AppProvider";
import { suggestMailto } from "@/lib/site";

// Scrolled this far down, the header gets out of the way; it comes back only after a real scroll
// up (someone who wants it), or near the top. Events get the screen: success is people going out.
const HIDE_AFTER = 80, SHOW_AFTER_UP = 250;

/** Hides on scroll down, returns on a deliberate scroll up. Sets --header-offset for sticky bars. */
function useAutoHide() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let last = window.scrollY, up = 0, ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const y = window.scrollY, dy = y - last;
        last = y;
        if (y < HIDE_AFTER) { up = 0; setHidden(false); return; }
        if (dy > 0) { up = 0; setHidden(true); }
        else if (dy < 0 && (up -= dy) > SHOW_AFTER_UP) setHidden(false);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const h = ref.current?.offsetHeight;
    document.documentElement.style.setProperty("--header-offset", hidden ? "0px" : h ? `${h}px` : "3.5rem");
  }, [hidden]);
  return { hidden, ref };
}

export default function SiteHeader() {
  const { hidden, ref } = useAutoHide();
  return (
    <header
      ref={ref}
      className={`sticky top-0 z-30 border-b border-white/10 bg-[#2b2119]/90 backdrop-blur transition-transform duration-200 motion-reduce:transition-none ${hidden ? "-translate-y-full" : ""}`}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <StapleGun />
          <span className="sr-only">Light Pole</span>
          <span className="font-poster text-[26px] uppercase leading-none" aria-hidden>
            <span className="text-[#fff23a]">Light</span> <span className="text-[#ff5fae]">Pole</span>
          </span>
        </Link>
        <nav className="flex items-center gap-2 text-sm text-white/70">
          <a
            href={suggestMailto()}
            className="hidden rounded-full px-3 py-1.5 font-medium text-white/70 hover:text-white sm:inline"
          >
            Email us a spot
          </a>
          <Link
            href="/submit"
            className="hidden rounded-full bg-white/10 px-3 py-1.5 font-medium text-white hover:bg-white/20 sm:inline"
          >
            + Add an event
          </Link>
          <NewsletterButton />
          <AuthButton />
        </nav>
      </div>
    </header>
  );
}

/** Opens the weekly-email sheet on the home page (which holds the place and type filters). */
export const NEWSLETTER_EVENT = "lightpole:newsletter";
function NewsletterButton() {
  const path = usePathname();
  const router = useRouter();
  return (
    <button
      onClick={() => (path === "/" ? window.dispatchEvent(new Event(NEWSLETTER_EVENT)) : router.push("/?newsletter=1"))}
      aria-label="Get these events by email every week"
      title="Weekly email"
      className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-white"
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" aria-hidden>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m3.5 6.5 8.5 7 8.5-7" />
      </svg>
    </button>
  );
}

/** A silver staple gun, side view: plunger cap, front head, squeeze lever, slot in the base. */
function StapleGun() {
  return (
    <svg viewBox="0 0 50 46" className="h-8 w-auto shrink-0" aria-hidden>
      <defs>
        <linearGradient id="steel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f4f6f8" />
          <stop offset="0.55" stopColor="#c9ced4" />
          <stop offset="1" stopColor="#8e959c" />
        </linearGradient>
      </defs>
      <g stroke="#3a3f45" strokeWidth="1.6" strokeLinejoin="round">
        {/* squeeze lever */}
        <path d="M23 19.5 L44.6 4.4 Q48.4 2.6 47.6 6.6 Q45.4 13.6 39.4 18 Q34.4 21.6 30.6 25 Z" fill="#b9bfc6" />
        {/* plunger cap */}
        <rect x="7.4" y="7" width="2.8" height="7" fill="url(#steel)" />
        <rect x="12.6" y="7" width="2.8" height="7" fill="url(#steel)" />
        <rect x="5" y="4.6" width="13" height="3" rx="1.5" fill="url(#steel)" />
        {/* body and front head */}
        <path d="M4 14 H18.5 V16.4 Q25.6 16.6 29.4 21.8 L31.2 25.4 Q31.8 27 33.6 27 H42 Q47.2 27 47.2 32.4 V44.4 H4 Z" fill="url(#steel)" />
        <path d="M18.5 16.4 V31" fill="none" />
      </g>
      {/* pivot and the slot in the base */}
      <circle cx="21.6" cy="23.4" r="2.2" fill="#3a3f45" />
      <rect x="23" y="33.4" width="18.6" height="4.6" rx="2.3" fill="#3a3f45" />
    </svg>
  );
}

function AuthButton() {
  const { ready, user, hasAuth, signInWithGoogle, signInWithFacebook, signOutUser } = useApp();
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const tryProvider = async (go: () => Promise<string | null>) => {
    setProblem(null);
    setProblem(await go());
  };

  if (!ready) return <div className="h-8 w-20 animate-pulse rounded-full bg-white/5" />;

  if (user) {
    return (
      <div className="relative">
        {/* Just the initial: the full name doesn't need to sit on screen. */}
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label={`Account menu (${user.name})`}
          title={user.name}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#ff8fb1] text-sm font-semibold text-[#1a1a1a]">
            {user.name.charAt(0).toUpperCase()}
          </span>
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="absolute right-0 z-50 mt-2 w-44 overflow-hidden rounded-xl border border-white/10 bg-[#3a2d23] py-1 shadow-xl">
              <MenuLink href="/inbox" onClick={() => setOpen(false)}>📥 Inbox</MenuLink>
              <MenuLink href="/profile" onClick={() => setOpen(false)}>⚙️ Profile</MenuLink>
              <button
                onClick={() => {
                  setOpen(false);
                  signOutUser();
                }}
                className="block w-full px-4 py-2 text-left text-sm text-white/70 hover:bg-white/5"
              >
                Sign out
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => { setOpen((o) => !o); setProblem(null); }}
        className="rounded-full bg-[#ffe45c] px-4 py-1.5 text-sm font-semibold text-[#1a1a1a] hover:bg-[#fff08a]"
      >
        Sign in
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-56 rounded-xl border border-white/10 bg-[#3a2d23] p-2 shadow-xl">
            <button
              onClick={() => void tryProvider(signInWithGoogle)}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-white hover:bg-white/10"
            >
              <span>🟦</span> Continue with Google
            </button>
            <button
              onClick={() => void tryProvider(signInWithFacebook)}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-white hover:bg-white/10"
            >
              <span>🔵</span> Continue with Facebook
            </button>
            {problem && <p className="px-3 pt-2 text-xs font-medium text-[#ffbf73]" role="alert">{problem}</p>}
            {!hasAuth && (
              <p className="px-3 pt-2 text-[11px] text-white/40">
                Demo mode — this creates a local test account. Real sign-in activates once Supabase
                Auth is configured.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function MenuLink({ href, onClick, children }: { href: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Link href={href} onClick={onClick} className="block px-4 py-2 text-sm text-white/70 hover:bg-white/5">
      {children}
    </Link>
  );
}
