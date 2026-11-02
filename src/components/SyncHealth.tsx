"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import RelativeTime from "@/components/RelativeTime";
import { retrySyncJob } from "@/lib/sync/actions";
import { attemptsLabel, syncErrorLabel, syncServiceLabel, syncStatusLabel } from "@/lib/sync/labels";

// User-facing text, grouped so it can be translated later.
const TEXT = {
  title: "Google sync status",
  intro: "Your Google services only. A run that is waiting has not necessarily started; if it stays waiting, ask an admin to check the background sync.",
  lastSuccess: "Last successful sync",
  neverSynced: "Not yet completed",
  lastCheck: "Last update from Google",
  noCheck: "Nothing received yet",
  noRuns: "No sync runs yet.",
  retry: "Try again",
  folder: " folder",
};

export type SyncHealthRow = {
  service: string;
  source_id: string | null;
  last_success_at: string | null;
  cursor_updated_at: string | null;
  dead_jobs: number;
  active_jobs: number;
};
export type SyncJob = {
  id: string; service: string; status: string; attempts: number;
  error_code: string | null; created_at: string; completed_at: string | null;
};

export default function SyncHealth({ health, jobs }: { health: SyncHealthRow[]; jobs: SyncJob[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState("");
  return <section className="vq-card-static rounded-[14px] bg-white p-5" aria-labelledby="sync-health-title">
    <h2 id="sync-health-title" className="text-[15px] font-semibold text-ink">{TEXT.title}</h2>
    <p className="mt-1 text-[12px] text-neutral-500">{TEXT.intro}</p>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      {health.map(row => <article key={`${row.service}:${row.source_id ?? ""}`} className="rounded-xl border border-neutral-200 p-3 text-[12px]">
        <h3 className="font-semibold text-ink">{syncServiceLabel(row.service)}{row.source_id ? TEXT.folder : ""}</h3>
        <p className="mt-2 text-neutral-500">{TEXT.lastSuccess}: {row.last_success_at ? <RelativeTime date={row.last_success_at} /> : TEXT.neverSynced}</p>
        <p className="mt-1 text-neutral-500">{TEXT.lastCheck}: {row.cursor_updated_at ? <RelativeTime date={row.cursor_updated_at} /> : TEXT.noCheck}</p>
        <p className="mt-1 text-neutral-500">{row.dead_jobs} {row.dead_jobs === 1 ? "run" : "runs"} stopped after errors · {row.active_jobs} in progress</p>
      </article>)}
    </div>
    <div className="mt-3 divide-y divide-neutral-100">
      {!jobs.length && <p className="py-3 text-[12px] text-neutral-400">{TEXT.noRuns}</p>}
      {jobs.map(job => <div key={job.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-[12px]">
        <span className="font-semibold text-ink">{syncServiceLabel(job.service)} · {syncStatusLabel(job.status)}</span>
        <span className="min-w-0 text-neutral-500">{attemptsLabel(job.attempts)}{job.error_code ? <span title={`Code: ${job.error_code}`}> · {syncErrorLabel(job.error_code)}</span> : null} · <RelativeTime date={job.completed_at ?? job.created_at} /></span>
        {["dead", "retry"].includes(job.status) && <button type="button" disabled={pending} aria-label={`Try the ${syncServiceLabel(job.service)} sync again`} className="rounded-full border border-neutral-200 px-3 py-1.5 font-semibold text-ink hover:border-cyan-400 disabled:opacity-40" onClick={() => start(async () => {
          const result = await retrySyncJob(job.id);
          setMessage(result.message);
          if (result.ok) router.refresh();
        })}>{TEXT.retry}</button>}
      </div>)}
    </div>
    {message && <p role="status" className="mt-3 text-[12px] text-cyan-800">{message}</p>}
  </section>;
}
