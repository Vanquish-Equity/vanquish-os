"use client";
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
      <summary className="min-h-11 cursor-pointer py-3">
        My operation reviews (metadata only)
      </summary>
      <button
        className="min-h-11 rounded-full border px-3"
        onClick={() =>
          startTransition(() => {
            void load();
          })
        }
      >
        Refresh review history
      </button>
      {status && <p role="status">{status}</p>}
      {rows?.map((r) => (
        <article key={r.id} className="mt-2 break-words border-t py-2">
          <p>
            {r.operation} · {r.state} · {r.id}
          </p>
          {r.state === "uncertain" && (
            <p>
              Human review required. Never retry this operation automatically.
            </p>
          )}
          {r.state === "pending" && (
            <button
              className="min-h-11 rounded-full border px-3"
              onClick={() =>
                startTransition(async () => {
                  const result = await cancelMailReview(r.id);
                  setStatus(
                    result.ok ? `Review ${result.data}` : result.message,
                  );
                  await load();
                })
              }
            >
              Cancel pending review
            </button>
          )}
        </article>
      ))}
      {rows?.length === 0 && <p>No operation reviews.</p>}
    </details>
  );
}
