"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle"
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setErrorMessage(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setErrorMessage(error.message);
      setStatus("error");
    } else {
      setStatus("sent");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-white">
      <div className="w-full max-w-sm px-6">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-gradient-to-br from-cyan-400 to-[#093236] font-[family-name:var(--font-display)] text-[15px] font-semibold text-white">
            V
          </div>
          <div>
            <div className="font-[family-name:var(--font-display)] text-sm font-semibold text-ink">
              Vanquish
            </div>
            <div className="text-[9px] tracking-[1.6px] text-neutral-400">
              OPERATING SYSTEM
            </div>
          </div>
        </div>

        <h1 className="mb-1 font-[family-name:var(--font-display)] text-xl font-semibold text-ink">
          Sign in
        </h1>
        <p className="mb-6 text-sm text-neutral-500">
          Enter your Vanquish email and we&apos;ll send a sign-in link.
        </p>

        {status === "sent" ? (
          <div className="rounded-[10px] border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-900">
            Check <strong>{email}</strong> for a sign-in link.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <input
              type="email"
              required
              placeholder="you@vanquish.vc"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-[10px] border border-neutral-200 bg-neutral-50 px-3.5 py-2.5 text-sm outline-none focus:border-cyan-400"
            />
            <button
              type="submit"
              disabled={status === "sending"}
              className="rounded-[10px] bg-ink px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {status === "sending" ? "Sending…" : "Send sign-in link"}
            </button>
            {status === "error" && (
              <p className="text-xs text-red-600">
                {errorMessage ?? "Something went wrong. Try again."}
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
