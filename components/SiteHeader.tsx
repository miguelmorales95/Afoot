"use client";

import { useState } from "react";
import Link from "next/link";
import { useApp } from "./AppProvider";
import { suggestMailto } from "@/lib/site";

export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#2b2119]/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <StapleGun />
          <span className="sr-only">Light Pole</span>
          <span className="font-poster text-[26px] uppercase leading-none" aria-hidden>
            <span className="text-[#fff23a]">Ligh<PoleT /></span> <span className="text-[#ff5fae]">Pole</span>
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
          <AuthButton />
        </nav>
      </div>
    </header>
  );
}

/** Side view of a staple gun firing a staple: how flyers actually go up on a pole. */
function StapleGun() {
  return (
    <svg viewBox="0 0 44 33" className="h-7 w-auto shrink-0" aria-hidden>
      {/* grip lever, hinged at the front, rear end raised */}
      <path d="M7 8.6 L38.6 2.2 Q42.4 1.6 42.4 5.2 V7.4 Q42.4 10.2 39.6 10.7 L15 15.4 Q11 16 9.6 13.4 Z" fill="#ff5fae" />
      {/* front head and magazine */}
      <path d="M2.5 8.5 Q2.5 7 4 7 H13 Q14.5 7 14.5 8.5 V17 H40 Q42 17 42 19 V22.5 Q42 24.5 40 24.5 H2.5 Z" fill="#d9dde1" />
      <rect x="5" y="19" width="34" height="1.3" rx="0.6" fill="#fff" opacity="0.7" />
      <circle cx="10.5" cy="11" r="1.7" fill="#2b2119" />
      {/* nose and a staple on its way out */}
      <rect x="2.5" y="24.5" width="7" height="2" fill="#9aa1a8" />
      <path d="M3.6 30.2 V27.8 H8.4 V30.2" fill="none" stroke="#fff23a" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

/** The T of LIGHT drawn as an LA wooden power pole: crossarm with insulators, braces, transformer can. */
function PoleT() {
  return (
    <svg viewBox="0 0 22 34" fill="currentColor" className="ml-[0.02em] inline-block h-[0.86em] w-auto align-baseline">
      {/* insulators on the crossarm, and one on the pole top */}
      <rect x="1" y="1.4" width="2.2" height="4" rx="1.1" />
      <rect x="18.8" y="1.4" width="2.2" height="4" rx="1.1" />
      <rect x="9.9" y="0" width="2.2" height="5" rx="1.1" />
      {/* crossarm */}
      <rect x="0" y="4.8" width="22" height="5" rx="0.5" />
      {/* tapered pole */}
      <path d="M8.6 3 L13.4 3 L14.2 34 L7.8 34 Z" />
      {/* braces under the crossarm */}
      <path d="M3.6 9.4 L8.6 15.4" stroke="currentColor" strokeWidth="2.2" fill="none" />
      <path d="M18.4 9.4 L13.4 15.4" stroke="currentColor" strokeWidth="2.2" fill="none" />
      {/* transformer can */}
      <rect x="14.6" y="17" width="6" height="8.6" rx="2" />
      <rect x="13.4" y="18.6" width="1.8" height="1.6" />
    </svg>
  );
}

function AuthButton() {
  const { ready, user, hasAuth, signInWithGoogle, signInWithFacebook, signOutUser } = useApp();
  const [open, setOpen] = useState(false);

  if (!ready) return <div className="h-8 w-20 animate-pulse rounded-full bg-white/5" />;

  if (user) {
    return (
      <div className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 rounded-full bg-white/10 py-1 pl-1 pr-3 text-sm font-medium text-white hover:bg-white/20"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#ff8fb1] text-xs text-[#1a1a1a]">
            {user.name.charAt(0).toUpperCase()}
          </span>
          <span className="max-w-[90px] truncate">{user.name}</span>
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
        onClick={() => setOpen((o) => !o)}
        className="rounded-full bg-[#ffe45c] px-4 py-1.5 text-sm font-semibold text-[#1a1a1a] hover:bg-[#fff08a]"
      >
        Sign in
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-56 rounded-xl border border-white/10 bg-[#3a2d23] p-2 shadow-xl">
            <button
              onClick={() => {
                setOpen(false);
                signInWithGoogle();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-white hover:bg-white/10"
            >
              <span>🟦</span> Continue with Google
            </button>
            <button
              onClick={() => {
                setOpen(false);
                signInWithFacebook();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-white hover:bg-white/10"
            >
              <span>🔵</span> Continue with Facebook
            </button>
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
