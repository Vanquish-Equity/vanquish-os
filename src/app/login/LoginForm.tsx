"use client";

import Image from "next/image";
import { useState } from "react";
import { callbackUrl, SIGN_IN_PROVIDERS, type SignInProvider } from "@/lib/auth/providers";
import { createClient } from "@/lib/supabase/client";

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export default function LoginForm({
  next,
  initialError,
  signedOut,
}: {
  next: string;
  initialError: string | null;
  signedOut: boolean;
}) {
  const [email, setEmail] = useState("");
  const [emailStatus, setEmailStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [pendingProvider, setPendingProvider] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const providers = SIGN_IN_PROVIDERS.filter((provider) => provider.enabled);

  async function signInWith(provider: SignInProvider) {
    setError(null);
    setPendingProvider(provider.id);
    const supabase = createClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: provider.id,
      options: {
        redirectTo: callbackUrl(window.location.origin, next),
        scopes: provider.scopes,
        queryParams: provider.queryParams,
      },
    });
    if (oauthError) {
      setPendingProvider(null);
      setError("Could not start sign-in. Try again.");
    }
  }

  async function sendEmailLink(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setEmailStatus("sending");
    const supabase = createClient();
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: callbackUrl(window.location.origin, next) },
    });
    if (otpError) {
      setEmailStatus("idle");
      setError("Could not send the sign-in link. Try again in a moment.");
      return;
    }
    setEmailStatus("sent");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-4">
      <div className="vq-card-static w-full max-w-sm rounded-[14px] bg-white p-7">
        <div className="mb-7 rounded-[10px] bg-ink px-4 py-3">
          <div className="h-[30px] w-[120px]">
            <Image
              src="/vanquish-logotype.png"
              alt="Vanquish"
              width={2172}
              height={724}
              priority
              className="h-full w-full object-contain object-left"
            />
          </div>
          <div className="mt-1 text-[9px] tracking-[1.6px] text-neutral-500">
            OPERATING SYSTEM
          </div>
        </div>

        <h1 className="mb-1 font-[family-name:var(--font-display)] text-xl font-semibold text-ink">
          Sign in
        </h1>
        <p className="mb-5 text-[13px] text-neutral-500">
          Access is limited to authorized Vanquish members.
        </p>

        {signedOut && !error && (
          <p className="mb-4 rounded-xl bg-[#f7f9fa] px-3 py-2 text-[12px] text-neutral-600">
            You have been signed out.
          </p>
        )}

        <div className="flex flex-col gap-2.5">
          {providers.map((provider) => (
            <button
              key={provider.id}
              type="button"
              onClick={() => void signInWith(provider)}
              disabled={pendingProvider !== null}
              className="flex items-center justify-center gap-2.5 rounded-full bg-ink px-4 py-2.5 text-[13px] font-semibold text-white transition hover:bg-neutral-800 disabled:opacity-50"
            >
              {provider.id === "google" && (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white">
                  <GoogleMark />
                </span>
              )}
              {pendingProvider === provider.id ? "Redirecting…" : provider.label}
            </button>
          ))}
        </div>

        <div className="my-5 flex items-center gap-3 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
          <span className="h-px flex-1 bg-neutral-100" />
          or use an email link
          <span className="h-px flex-1 bg-neutral-100" />
        </div>

        {emailStatus === "sent" ? (
          <div className="rounded-xl border border-cyan-200 bg-cyan-50 px-3.5 py-3 text-[12.5px] text-cyan-900">
            If <strong>{email.trim()}</strong> can receive a sign-in link, it is on its way.
          </div>
        ) : (
          <form onSubmit={sendEmailLink} className="flex flex-col gap-2.5">
            <input
              type="email"
              required
              autoComplete="email"
              placeholder="you@vanquishequity.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-[13px] text-ink outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
            />
            <button
              type="submit"
              disabled={emailStatus === "sending"}
              className="rounded-full border border-neutral-200 px-4 py-2.5 text-[12.5px] font-semibold text-neutral-600 transition hover:border-cyan-300 hover:text-cyan-800 disabled:opacity-50"
            >
              {emailStatus === "sending" ? "Sending…" : "Email me a sign-in link"}
            </button>
          </form>
        )}

        {error && (
          <p role="alert" className="mt-4 text-[12px] text-red-600">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
