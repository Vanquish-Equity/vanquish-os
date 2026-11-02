"use client";
import { fileSizeLabel, mailConfirmLabel } from "@/lib/google/mail-completion-labels";
import LocalTime from "@/components/LocalTime";
import Checkbox from "@/components/Checkbox";
import { useState } from "react";
import type { MailReview } from "@/lib/google/mail-completion-types";
export default function MailReviewPanel({
  review,
  busy,
  onConfirm,
  onCancel,
}: {
  review: MailReview;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [checked, setChecked] = useState(false);
  return (
    <section
      aria-label="Confirm Gmail change"
      className="vq-card-static min-w-0 space-y-3 rounded-xl border border-cyan-200 bg-cyan-50 p-4 text-[12px] motion-reduce:[&_*]:transition-none"
    >
      <h3 className="font-semibold">
        {review.operation === "save"
          ? "Check before saving the draft"
          : review.operation === "send"
            ? "Check before sending now"
            : "Check before deleting the draft"}
      </h3>
      <dl className="space-y-1 break-words">
        <div>
          <dt className="inline font-semibold">From: </dt>
          <dd className="inline">{review.sender || "Not set"}</dd>
        </div>
        {(["to", "cc", "bcc"] as const).map((key) => (
          <div key={key}>
            <dt className="inline font-semibold uppercase">{key}: </dt>
            <dd className="inline">{review[key].join(", ") || "None"}</dd>
          </div>
        ))}
        <div>
          <dt className="inline font-semibold">Subject: </dt>
          <dd className="inline">{review.subject || "No subject"}</dd>
        </div>
      </dl>
      <p>
        Attachments:{" "}
        {review.attachments.length
          ? review.attachments
              .map((f) => `${f.name} (${fileSizeLabel(f.size)})`)
              .join(", ")
          : "None"}
      </p>
      <details>
        <summary className="vq-disclosure">
          Preview the message exactly as it will be sent
        </summary>
        <iframe
          title="Reviewed message body"
          sandbox=""
          referrerPolicy="no-referrer"
          className="mt-2 h-40 w-full rounded-xl border border-neutral-200 bg-white"
          srcDoc={`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'none'; img-src 'none'; form-action 'none'"><body>${review.html}</body>`}
        />
      </details>
      <p>
        This happens right after you confirm; nothing is scheduled. Confirm
        before <LocalTime date={review.expiresAt} mode="stamp" />, or start
        again.
      </p>
      {review.draftRetained && (
        <p className="font-semibold">
          This exact copy will be sent. The original draft stays in your Gmail
          drafts: do not send it again. You can delete it separately.
        </p>
      )}
      <label className="flex min-h-11 cursor-pointer items-start gap-2 py-3">
        <Checkbox
          checked={checked}
          disabled={busy}
          onChange={(e) => setChecked(e.target.checked)}
        />
        <span>
          I have checked the recipients, sender, content and attachments
          {review.draftRetained
            ? ", and I understand the original draft stays in Gmail"
            : ""}
          .
        </span>
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          disabled={busy || !checked}
          onClick={onConfirm}
          className="min-h-11 rounded-full bg-ink px-4 text-white disabled:opacity-40"
        >
          {mailConfirmLabel(review.operation)}
        </button>
        <button
          disabled={busy}
          onClick={onCancel}
          className="min-h-11 rounded-full border px-4"
        >
          Cancel
        </button>
      </div>
    </section>
  );
}
