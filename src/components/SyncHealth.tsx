"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import RelativeTime from "@/components/RelativeTime";
import { formatElapsed } from "@/lib/dates";
import { retrySyncJob } from "@/lib/sync/actions";

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
    <h2 id="sync-health-title" className="text-[15px] font-semibold text-ink">System health</h2>
    <p className="mt-1 text-[12px] text-neutral-500">Your Google services only. Queued runs need the external worker; they do not prove it is active.</p>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      {health.map(row => <article key={`${row.service}:${row.source_id ?? ""}`} className="rounded-xl border border-neutral-200 p-3 text-[12px]">
        <h3 className="font-semibold capitalize text-ink">{row.service}{row.source_id ? " folder" : ""}</h3>
        <p className="mt-2 text-neutral-500">Last successful sync: {row.last_success_at ? <RelativeTime date={row.last_success_at} /> : "Not yet completed"}</p>
        <p className="mt-1 text-neutral-500">Cursor checkpoint age: {row.cursor_updated_at ? <time dateTime={row.cursor_updated_at} title={row.cursor_updated_at}>{formatElapsed(row.cursor_updated_at)}</time> : "No checkpoint yet"}</p>
        <p className="mt-1 text-neutral-500">{row.dead_jobs} dead runs · {row.active_jobs} active runs</p>
      </article>)}
    </div>
    <div className="mt-3 divide-y divide-neutral-100">
      {!jobs.length && <p className="py-3 text-[12px] text-neutral-400">No runs yet.</p>}
      {jobs.map(job => <div key={job.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-[12px]">
        <span className="font-semibold text-ink">{job.service} · {job.status}</span>
        <span className="min-w-0 text-neutral-500">{job.attempts} attempts{job.error_code ? ` · ${job.error_code}` : ""} · <RelativeTime date={job.completed_at ?? job.created_at} /></span>
        {["dead", "retry"].includes(job.status) && <button type="button" disabled={pending} aria-label={`Retry ${job.service} run`} className="rounded-full border border-neutral-200 px-3 py-1.5 font-semibold text-ink hover:border-cyan-400 disabled:opacity-40" onClick={() => start(async () => {
          const result = await retrySyncJob(job.id);
          setMessage(result.message);
          if (result.ok) router.refresh();
        })}>Retry read sync</button>}
      </div>)}
    </div>
    {message && <p role="status" className="mt-3 text-[12px] text-cyan-800">{message}</p>}
  </section>;
}
