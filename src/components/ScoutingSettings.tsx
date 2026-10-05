"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import RelativeTime from "@/components/RelativeTime";
import SelectMenu from "@/components/SelectMenu";
import { scanMailboxNow, setContactMode, type ContactMode } from "@/lib/scouting/actions";

const MODES: { value: ContactMode; label: string }[] = [
  { value: "request", label: "Ask me first (contact requests)" },
  { value: "auto", label: "Add them to People automatically" },
  { value: "skip", label: "Don't add contacts" },
];

export default function ScoutingSettings({
  contactMode,
  lastScannedAt,
  googleConnected,
}: {
  contactMode: ContactMode;
  lastScannedAt: string | null;
  googleConnected: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function run(action: () => Promise<{ ok: boolean; message?: string }>) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      setMessage(result.message ?? (result.ok ? "Saved." : "Could not save the change."));
      router.refresh();
    });
  }

  return (
    <section className="vq-card-static rounded-[14px] bg-white p-5 sm:p-6" aria-labelledby="settings-scouting">
      <h2 id="settings-scouting" className="text-[15px] font-semibold text-ink">Email scouting</h2>
      <p className="mt-1 max-w-[720px] text-[12px] text-neutral-500">
        Looks through the last 30 days of your Gmail (newest 500 emails, outside Promotions, Social, Updates, Forums,
        Spam and Trash) for companies you write with that aren&apos;t in Companies yet, and lists them in{" "}
        <Link href="/review" className="font-semibold text-cyan-700 hover:underline">Review</Link>. Only you see your
        suggestions. Stored per suggestion: the domain, thread counts, dates and the contacts&apos; names and emails —
        never subjects or message content. Runs every few hours while you use Vanquish OS.
      </p>
      {!googleConnected ? (
        <p className="mt-3 text-[12px] text-neutral-500">Connect Google above to use this.</p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <div className="max-w-[360px] text-[11px] font-semibold text-ink">
            When I create a company from a suggestion, its contacts…
            <SelectMenu
              value={contactMode}
              options={MODES}
              disabled={pending}
              onChange={(value) => run(() => setContactMode(value as ContactMode))}
              rootClassName="mt-1"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={pending}
              onClick={() => run(scanMailboxNow)}
              className="rounded-lg border border-neutral-200 px-2.5 py-1.5 text-[11px] font-semibold text-ink hover:border-cyan-300 disabled:opacity-40"
            >
              {pending ? "Working…" : "Scan now"}
            </button>
            {lastScannedAt && (
              <span className="text-[11px] text-neutral-400">
                Last scanned <RelativeTime date={lastScannedAt} />
              </span>
            )}
          </div>
        </div>
      )}
      {message && <p role="status" className="mt-3 text-[11px] text-cyan-800">{message}</p>}
    </section>
  );
}
