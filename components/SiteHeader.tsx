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
          <AuthButton />
        </nav>
      </div>
    </header>
  );
}

/** A D-handle staple gun pressed flat against a pole, a staple going in at the nose. */
function StapleGun() {
  return (
    <svg viewBox="0 0 34 36" className="h-8 w-auto shrink-0" aria-hidden>
      {/* the pole */}
      <rect x="0" y="0" width="5" height="36" rx="1" fill="#7a5636" />
      {/* body: flat side against the pole, nose at the bottom */}
      <rect x="5.5" y="2" width="9" height="32" rx="2" fill="#d9dde1" />
      <rect x="7.4" y="5" width="1.3" height="20" rx="0.6" fill="#fff" opacity="0.75" />
      <rect x="5.5" y="27" width="9" height="7" rx="1.5" fill="#9aa1a8" />
      {/* D-handle: an angled squeeze grip looping back to the body, with the hand hole */}
      <path
        fillRule="evenodd"
        fill="#ff5fae"
        d="M14 2.5 L24 3 Q33.5 4 32.4 13 L30.6 23.5 Q29.8 28.4 25 27.2 L14 23.5 Z M15.6 8 L23.2 8.5 Q27.6 9.4 26.9 13.6 L25.6 20.2 Q25 22.8 22.6 22 L15.6 19 Z"
      />
      {/* finger ridges on the grip */}
      <path d="M31.2 11 H33 M30.8 14.5 H32.6 M30.2 18 H32 M29.6 21.5 H31.4" stroke="#2b2119" strokeWidth="1" strokeLinecap="round" />
      {/* a staple going into the pole */}
      <path d="M6.2 29.2 H2.6 V33.6 H6.2" fill="none" stroke="#fff23a" strokeWidth="1.4" strokeLinejoin="round" />
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
