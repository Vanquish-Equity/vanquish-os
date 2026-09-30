"use client";
import MailBody from "./MailBody";
import { button, sender, empty } from "./mail-ui";
import { plainTextToHtml } from "@/lib/communications/rich-text";
import type { MailMessage, MailOperation } from "@/lib/google/mail-types";
import type { ComposeSeed } from "./MailComposer";
type Props = {
  threadId: string;
  messages: MailMessage[] | null;
  threadError: string;
  mutating: boolean;
  onBack: () => void;
  operate: (operation: MailOperation, ids: string[]) => Promise<void>;
  reply: (message: MailMessage, all?: boolean) => void;
  editDraft: (message: MailMessage) => Promise<void>;
  setComposer: (seed: ComposeSeed) => void;
};
export default function MailThreadReader({
  threadId,
  messages,
  threadError,
  mutating,
  onBack,
  operate,
  reply,
  editDraft,
  setComposer,
}: Props) {
  return (
    <div className="p-5">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => onBack()} className={button}>
          ← Back
        </button>
        {(["archive", "unread", "trash"] as const).map((op) => (
          <button
            type="button"
            key={op}
            disabled={mutating}
            onClick={() => void operate(op, [threadId])}
            className={button}
          >
            {op === "unread"
              ? "Mark unread"
              : op === "archive"
                ? "Archive"
                : "Move to trash"}
          </button>
        ))}
      </div>
      {threadError ? (
        <p role="alert" className="text-sm text-rose-700">
          {threadError}
        </p>
      ) : !messages ? (
        <p role="status" className="py-12 text-center text-sm text-neutral-400">
          Loading conversation…
        </p>
      ) : (
        <>
          <h2 className="mb-5 text-xl font-semibold text-ink">
            {messages[0]?.subject}
          </h2>
          {messages.map((m, i) => (
            <details
              key={m.id}
              open={i === messages.length - 1}
              className="mb-3 rounded-xl border border-neutral-200 p-4"
            >
              <summary className="cursor-pointer list-none">
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-50 text-[12px] font-semibold text-cyan-900">
                    {sender(m.from).charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-ink">
                      {m.from}
                    </p>
                    <p className="truncate text-[11px] text-neutral-400">
                      To: {m.to}
                    </p>
                  </div>
                  <span className="text-[11px] text-neutral-400">
                    {m.date ? new Date(m.date).toLocaleString() : ""}
                  </span>
                </div>
              </summary>
              <div className="mt-2 break-words text-[11px] text-neutral-500">
                {m.cc && <p>CC: {m.cc}</p>}
                {m.bcc && <p>BCC: {m.bcc}</p>}
              </div>
              <MailBody message={m} />
              <div className="mt-4 flex flex-wrap gap-2">
                {m.labels.includes("DRAFT") ? (
                  <button
                    type="button"
                    className={button}
                    onClick={() => void editDraft(m)}
                  >
                    Edit Gmail draft
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className={button}
                      onClick={() => reply(m)}
                    >
                      Reply
                    </button>
                    <button
                      type="button"
                      className={button}
                      onClick={() => reply(m, true)}
                    >
                      Reply all
                    </button>
                    <button
                      type="button"
                      className={button}
                      onClick={() =>
                        setComposer({
                          ...empty,
                          subject: `Fwd: ${m.subject}`,
                          html: `<p>Forwarded message from ${plainTextToHtml(m.from)}</p>${plainTextToHtml(m.text || "[Original HTML message — open the conversation to read it]")}`,
                        })
                      }
                    >
                      Forward
                    </button>
                  </>
                )}
              </div>
            </details>
          ))}
          <button
            type="button"
            disabled={mutating}
            onClick={() => void operate("read", [threadId])}
            className={button}
          >
            Mark conversation as read
          </button>
        </>
      )}
    </div>
  );
}
