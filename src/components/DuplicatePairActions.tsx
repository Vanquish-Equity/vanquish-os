"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { dismissDuplicateAction, mergePeopleAction } from "@/lib/people/duplicate-actions";

export default function DuplicatePairActions({
  a,
  b,
}: {
  a: { id: string; name: string };
  b: { id: string; name: string };
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(work: () => Promise<{ ok: boolean; message?: string }>) {
    setPending(true);
    setError(null);
    const result = await work();
    setPending(false);
    if (!result.ok) {
      setError(result.message ?? "Something went wrong.");
      return;
    }
    router.refresh();
  }

  function merge(keep: { id: string; name: string }, drop: { id: string; name: string }) {
    if (
      !window.confirm(
        `Keep "${keep.name}" and merge the other record into it? Its emails, groups, deals, drafts and board links move over, and it is archived.`,
      )
    )
      return;
    void run(() => mergePeopleAction(keep.id, drop.id));
  }

  const button =
    "rounded-full border border-neutral-200 px-3 py-1.5 text-[11.5px] font-semibold text-neutral-600 transition hover:border-cyan-300 hover:text-cyan-800 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={pending} onClick={() => merge(a, b)} className={button}>
        Keep left
      </button>
      <button type="button" disabled={pending} onClick={() => merge(b, a)} className={button}>
        Keep right
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => void run(() => dismissDuplicateAction(a.id, b.id))}
        className="text-[11.5px] font-semibold text-neutral-500 hover:text-ink disabled:opacity-50"
      >
        Not duplicates
      </button>
      {error && <p className="w-full text-[11px] text-red-600" role="alert">{error}</p>}
    </div>
  );
}
