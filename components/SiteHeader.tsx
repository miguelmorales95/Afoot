"use client";

import { useState } from "react";
import Link from "next/link";
import { useApp } from "./AppProvider";
import { suggestMailto } from "@/lib/site";

export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0a0a0f]/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="text-xl">📍</span>
          <span>
            Afoot<span className="text-fuchsia-400"> LA</span>
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
            + Add a venue
          </Link>
          <AuthButton />
        </nav>
      </div>
    </header>
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
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-fuchsia-600 text-xs">
            {user.name.charAt(0).toUpperCase()}
          </span>
          <span className="max-w-[90px] truncate">{user.name}</span>
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="absolute right-0 z-50 mt-2 w-44 overflow-hidden rounded-xl border border-white/10 bg-[#14141b] py-1 shadow-xl">
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
        className="rounded-full bg-fuchsia-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-fuchsia-500"
      >
        Sign in
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-56 rounded-xl border border-white/10 bg-[#14141b] p-2 shadow-xl">
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
