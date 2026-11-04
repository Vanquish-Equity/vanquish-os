"use client";
import { mailOperationLabel, mailStateLabel } from "@/lib/google/mail-completion-labels";
import LocalTime from "@/components/LocalTime";
import { useState, startTransition } from "react";
import {
  listMailReviews,
  cancelMailReview,
} from "@/lib/google/mail-completion-actions";
import type { MailReviewRow } from "@/lib/google/mail-completion-types";
export default function MailReviewHistory() {
  const [rows, setRows] = useState<MailReviewRow[] | null>(null),
    [status, setStatus] = useState("");
  async function load() {
    const result = await listMailReviews();
    if (result.ok) setRows(result.data);
    else setStatus(result.message);
  }
  return (
    <details className="rounded-xl border border-neutral-200 p-3 text-xs">
      <summary className="vq-disclosure">
        My recent Gmail confirmations
      </summary>
      <button
        className="min-h-11 rounded-full border px-3"
        onClick={() =>
          startTransition(() => {
            void load();
          })
        }
      >
        Refresh the list
      </button>
      {status && <p role="status">{status}</p>}
      {rows?.map((r) => (
        <article key={r.id} className="mt-2 break-words border-t py-2">
          <p title={`Reference ${r.id}`}>
            {mailOperationLabel(r.operation)} · {mailStateLabel(r.state)} ·{" "}
            <LocalTime date={r.created_at} mode="stamp" />
          </p>
          {r.open_signal !== undefined && <p>{r.open_signal ? <>First image load signal: <LocalTime date={r.open_signal} mode="stamp" />. This does not confirm a read.</> : "No image load signal detected."}</p>}
          {r.state === "uncertain" && (
            <p>
              We could not tell whether this went through. Check Gmail before
              trying again.
            </p>
          )}
          {r.state === "pending" && (
            <button
              className="min-h-11 rounded-full border px-3"
              onClick={() =>
                startTransition(async () => {
                  const result = await cancelMailReview(r.id);
                  setStatus(
                    result.ok ? `Confirmation: ${mailStateLabel(String(result.data))}` : result.message,
                  );
                  await load();
                })
              }
            >
              Cancel this confirmation
            </button>
          )}
        </article>
      ))}
      {rows?.length === 0 && <p>Nothing to show yet.</p>}
    </details>
  );
}
