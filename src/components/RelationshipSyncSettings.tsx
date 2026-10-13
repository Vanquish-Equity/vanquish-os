"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import RelativeTime from "@/components/RelativeTime";
import { deleteMyRelationshipHistory, setRelationshipSync, syncRelationshipsNow } from "@/lib/relationships/actions";

export default function RelationshipSyncSettings({
  enabled,
  lastSyncedAt,
  googleConnected,
}: {
  enabled: boolean;
  lastSyncedAt: string | null;
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
    <section className="vq-card-static rounded-[14px] bg-white p-5 sm:p-6" aria-labelledby="settings-relationships">
      <h2 id="settings-relationships" className="text-[15px] font-semibold text-ink">Relationship history</h2>
      <p className="mt-1 max-w-[720px] text-[12px] text-neutral-500">
        Shares with the team <em>that</em> you emailed or met someone in People, and on which day — never the subject,
        content, meeting title or other participants. It reads your connected Gmail and primary Calendar (first sync: the
        last 90 days), only for addresses already in People, then incrementally by the external worker, even while your browser is closed. It
        powers the Last interaction column in People and &ldquo;who knows them&rdquo; on Company pages.
      </p>
      {!googleConnected ? (
        <p className="mt-3 text-[12px] text-neutral-500">Connect Google above to use this.</p>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            disabled={pending}
            onClick={() => run(() => setRelationshipSync(!enabled))}
            className="flex items-center gap-2 text-[12px] font-semibold text-ink disabled:opacity-40"
          >
            <span aria-hidden="true" className={`relative h-5 w-9 rounded-full transition-colors ${enabled ? "bg-cyan-400" : "bg-neutral-200"}`}>
              <span className={`absolute left-[3px] top-[3px] h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${enabled ? "translate-x-4" : "translate-x-0"}`} />
            </span>
            Share my relationship history
          </button>
          {enabled && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(syncRelationshipsNow)}
              className="rounded-lg border border-neutral-200 px-2.5 py-1.5 text-[11px] font-semibold text-ink hover:border-cyan-300 disabled:opacity-40"
            >
              {pending ? "Queuing…" : "Queue sync"}
            </button>
          )}
          {lastSyncedAt && (
            <span className="text-[11px] text-neutral-400">
              Last synced <RelativeTime date={lastSyncedAt} />
            </span>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (window.confirm("Delete everything your account added to the relationship history and turn sync off?")) {
                run(deleteMyRelationshipHistory);
              }
            }}
            className="ml-auto text-[11px] font-semibold text-neutral-500 hover:text-ink disabled:opacity-40"
          >
            Delete my history
          </button>
        </div>
      )}
      {message && <p role="status" className="mt-3 text-[11px] text-cyan-800">{message}</p>}
    </section>
  );
}
