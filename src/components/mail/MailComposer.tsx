"use client";
import { startTransition, useEffect, useRef, useState } from "react";
import MailReviewHistory from "./MailReviewHistory";
import MailReviewPanel from "./MailReviewPanel";
import {
  mailCompletionState,
  mailCompletionAliases,
  startMailUpload,
  uploadMailChunk,
  removeMailUpload,
  reviewMailMutation,
  executeMailMutation,
  cancelMailReview,
} from "@/lib/google/mail-completion-actions";
import {
  MAIL_CHUNK_LIMIT,
  type ForwardSource,
  type MailReview,
  type MailCompletionOperation,
  type VerifiedAlias,
} from "@/lib/google/mail-completion-types";
import RichTextEditor from "@/components/RichTextEditor";
import SelectMenu from "@/components/SelectMenu";
import Checkbox from "@/components/Checkbox";
import RecipientInput from "./RecipientInput";
import useMovableDialog from "@/components/dialog/useMovableDialog";
import type { RecipientContact } from "@/lib/communications/contact-suggestions";
import {
  saveGmailDraft,
  sendGmailDraft,
  discardGmailDraft,
  mailboxProfile,
  mailSignature,
} from "@/lib/google/mail-actions";
import { validateCompose } from "@/lib/google/mail-validation";
import type { ComposeInput, MailAttachment } from "@/lib/google/mail-types";
import type { ContactGroup, LpContact } from "@/lib/communications/queries";

export type ComposeSeed = ComposeInput & {
  draftId?: string;
  draftMessageId?: string;
  attachments?: MailAttachment[];
  forwardSource?: ForwardSource;
};
const inputClass =
  "w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-[13px] outline-none focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100";
export default function MailComposer({
  seed,
  contacts,
  groups,
  knownRecipients = contacts,
  onClose,
  onSent,
}: {
  seed: ComposeSeed;
  contacts: LpContact[];
  groups: ContactGroup[];
  knownRecipients?: RecipientContact[];
  onClose: () => void;
  onSent: () => void;
}) {
  const [senderEmail, setSenderEmail] = useState("");
  const [completion, setCompletion] = useState(false);
  const [aliases, setAliases] = useState<VerifiedAlias[]>([]);
  const [alias, setAlias] = useState("");
  const [review, setReview] = useState<MailReview | null>(null);
  const [reviewForm, setReviewForm] = useState<FormData | null>(null);
  const uploadRef = useRef("");
  const forwardRef = useRef(seed.forwardSource);

  const dialog = useRef<HTMLDialogElement>(null);
  const [message, setMessage] = useState<ComposeInput>(seed);
  const [previousMessageId, setPreviousMessageId] = useState(
    seed.draftMessageId ?? "",
  );
  const [draftId, setDraftId] = useState(seed.draftId ?? "");
  const [dirty, setDirty] = useState(!seed.draftId);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [status, setStatus] = useState("");
  const [full, setFull] = useState(false);
  const movable = useMovableDialog(dialog, !full);
  const [picker, setPicker] = useState(false);
  const [groupId, setGroupId] = useState("all");
  const [field, setField] = useState("to");
  const [search, setSearch] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [retained, setRetained] = useState(seed.attachments ?? []);
  const [keepParts, setKeepParts] = useState(
    (seed.attachments ?? []).map((a) => a.partId),
  );
  const [chosen, setChosen] = useState<string[]>([]);
  const [confirmSend, setConfirmSend] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const reviewIdRef = useRef<string | null>(null);
  useEffect(() => {
    let alive = true;
    startTransition(async () => {
      const enabled = await mailCompletionState();
      if (!alive) return;
      setCompletion(enabled);
      if (enabled) {
        const result = await mailCompletionAliases();
        if (!alive) return;
        if (result.ok) {
          setAliases(result.data);
          setAlias(
            (
              result.data.find((a) => a.default) ||
              result.data.find((a) => a.primary) ||
              result.data[0]
            )?.email ?? "",
          );
        } else setStatus(result.message);
      }
    });
    return () => {
      alive = false;
      const id = reviewIdRef.current;
      if (id)
        startTransition(() => {
          void cancelMailReview(id);
        });
      const upload = uploadRef.current;
      if (upload)
        startTransition(() => {
          void removeMailUpload(upload);
        });
    };
  }, []);
  function clearReview() {
    const id = reviewIdRef.current;
    reviewIdRef.current = null;
    setReview(null);
    setReviewForm(null);
    if (id)
      startTransition(() => {
        void cancelMailReview(id);
      });
  }
  async function prepareEnhanced(operation: MailCompletionOperation) {
    if (busyRef.current || uncertain) return;
    busyRef.current = true;
    setBusy(true);
    setStatus("");
    clearReview();
    try {
      const form = new FormData();
      form.set("draftId", draftId);
      form.set("message", JSON.stringify(message));
      form.set("previousMessageId", previousMessageId);
      form.set("keepParts", JSON.stringify(keepParts));
      form.set("alias", alias);
      if (forwardRef.current && !draftId)
        form.set(
          "forwardSource",
          JSON.stringify({
            ...forwardRef.current,
            partIds: forwardRef.current.partIds.filter((id) =>
              keepParts.includes(id),
            ),
          }),
        );
      if (operation === "save" && files.length) {
        if (uploadRef.current) await removeMailUpload(uploadRef.current);
        const begun = await startMailUpload(
          files.map((f) => ({ name: f.name, type: f.type, size: f.size })),
        );
        if (!begun.ok) {
          setStatus(begun.message);
          return;
        }
        uploadRef.current = begun.data.id;
        for (let index = 0; index < files.length; index++)
          for (
            let offset = 0;
            offset < files[index].size;
            offset += MAIL_CHUNK_LIMIT
          ) {
            const bytes = new Uint8Array(
              await files[index]
                .slice(offset, offset + MAIL_CHUNK_LIMIT)
                .arrayBuffer(),
            );
            const chunk = await uploadMailChunk(
              begun.data.id,
              index,
              offset,
              bytes,
            );
            if (!chunk.ok) {
              setStatus(chunk.message);
              return;
            }
          }
        form.set("uploadId", begun.data.id);
      }
      const prepared = await reviewMailMutation(operation, form);
      if (!prepared.ok) {
        setStatus(prepared.message);
        return;
      }
      reviewIdRef.current = prepared.data.id;
      setReview(prepared.data);
      setReviewForm(form);
    } catch {
      setStatus("Review unavailable. No Google write was requested.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function confirmEnhanced() {
    if (!review || !reviewForm || busyRef.current || uncertain) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await executeMailMutation(
        review.id,
        review.operation,
        reviewForm,
        true,
      );
      if (!result.ok) {
        reviewIdRef.current = null;
        setStatus(result.message);
        if (result.code === "uncertain") setUncertain(true);
        setReview(null);
        return;
      }
      reviewIdRef.current = null;
      if (review.operation === "save") {
        setDraftId(result.data.id);
        setFiles([]);
        uploadRef.current = "";
        forwardRef.current = undefined;
        // Provider normalization must be reloaded before another edit/send; no automatic provider write.
        setStatus(
          "Saved in Gmail. Close and reopen this draft to review its current content before sending.",
        );
        setDirty(false);
        setUncertain(true);
      } else if (review.operation === "send") {
        setStatus(
          "Sent. Source draft retained in Gmail; do not send it again.",
        );
        setDirty(false);
        setUncertain(true);
      } else onClose();
      setReview(null);
    } catch {
      setUncertain(true);
      setStatus(
        "The write result is uncertain. Do not retry; review Gmail with the owner.",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function cancelEnhanced() {
    if (!review || busyRef.current) return;
    const result = await cancelMailReview(review.id);
    reviewIdRef.current = null;
    setReview(null);
    if (!result.ok) setStatus(result.message);
    else if (result.data === "uncertain") {
      setUncertain(true);
      setStatus(
        "Cancellation arrived after dispatch began. Outcome uncertain; do not retry.",
      );
    }
  }
  // New messages and replies start with the Gmail signature, like Gmail;
  // a reopened draft already contains whatever the member kept.
  const wantsSignature = !seed.draftId;
  const [initialHtml, setInitialHtml] = useState<string | null>(
    wantsSignature ? null : seed.html,
  );
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    let canceled = false;
    mailboxProfile().then((result) => {
      if (canceled) return;
      if (result.ok) setSenderEmail(result.data.email);
      else setStatus(result.message);
    });
    return () => {
      canceled = true;
    };
  }, []);
  useEffect(() => {
    if (!wantsSignature) return;
    let canceled = false;
    mailSignature()
      .then((result) => {
        if (canceled) return;
        const signature = result.ok ? result.data.html : "";
        const html = signature
          ? `<br><br>${signature}${seed.html ? `<br>${seed.html}` : ""}`
          : seed.html;
        setMessage((current) => ({ ...current, html }));
        setInitialHtml(html);
      })
      .catch(() => {
        if (!canceled) setInitialHtml(seed.html);
      });
    return () => {
      canceled = true;
    };
  }, [wantsSignature, seed.html]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  const eligible = contacts.filter(
    (c) =>
      c.email &&
      (groupId === "all" ||
        groups.find((g) => g.id === groupId)?.personIds.includes(c.personId)) &&
      `${c.name} ${c.email}`.toLowerCase().includes(search.toLowerCase()),
  );
  function change<K extends keyof ComposeInput>(
    key: K,
    value: ComposeInput[K],
  ) {
    clearReview();
    setMessage((m) => ({ ...m, [key]: value }));
    setDirty(true);
    setConfirmSend(false);
  }
  function close() {
    if (busyRef.current) return;
    if (
      dirty &&
      !window.confirm("Close without saving these changes to Gmail?")
    )
      return;
    onClose();
  }
  async function save(send: boolean) {
    if (completion) {
      await prepareEnhanced(send ? "send" : "save");
      return;
    }
    if (busyRef.current || uncertain || !senderEmail) return;
    try {
      validateCompose(message, send);
    } catch {
      setStatus(
        "Check the To, CC and BCC addresses. Add at least one recipient (maximum 200), using commas between addresses.",
      );
      return;
    }
    if (send && !confirmSend) {
      setConfirmSend(true);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setStatus("");
    try {
      let id = draftId;
      let savedRequiresReload = false;
      if (dirty || !id) {
        const form = new FormData();
        form.set("message", JSON.stringify(message));
        form.set("draftId", id);
        form.set("previousMessageId", previousMessageId);
        form.set("keepParts", JSON.stringify(keepParts));
        files.forEach((f) => form.append("attachments", f));
        const saved = await saveGmailDraft(form);
        if (!saved.ok) {
          setStatus(saved.message);
          return;
        }
        id = saved.data.id;
        savedRequiresReload = saved.data.requiresReload;
        setDraftId(id);
        setDirty(false);
        setFiles([]);
        setPreviousMessageId(saved.data.messageId);
        setRetained(saved.data.attachments);
        setKeepParts(saved.data.attachments.map((a) => a.partId));
      }
      if (savedRequiresReload) {
        setStatus(
          "Saved in Gmail. Close and reopen the draft to reload its attachments before editing or sending.",
        );
        setUncertain(true);
        return;
      }
      if (!send) {
        setStatus("Saved in your Gmail drafts.");
        return;
      }
      const sent = await sendGmailDraft(id);
      if (!sent.ok) {
        setStatus(`${sent.message} Check Sent and Gmail before sending again.`);
        setUncertain(true);
        return;
      }
      onSent();
    } catch {
      setStatus(
        "The operation was not confirmed. Check Gmail before retrying.",
      );
      if (send) setUncertain(true);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function discard() {
    if (completion) {
      if (draftId) await prepareEnhanced("discard");
      else close();
      return;
    }
    if (
      busyRef.current ||
      !window.confirm(
        "Discard this draft? This also removes the saved draft from Gmail.",
      )
    )
      return;
    busyRef.current = true;
    setBusy(true);
    try {
      if (draftId) {
        const result = await discardGmailDraft(draftId);
        if (!result.ok) {
          setStatus(result.message);
          return;
        }
      }
      onClose();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      className={`${full ? "h-[94vh] w-[96vw] max-w-none" : "w-[760px] max-w-[94vw]"} max-h-[94vh] rounded-2xl border border-neutral-200 bg-white p-0 text-ink shadow-2xl backdrop:bg-ink/35${completion ? " motion-reduce:[&_*]:transition-none motion-reduce:[&_*]:animate-none" : ""}`}
      aria-labelledby="mail-compose-title"
    >
      <div
        {...movable.handleProps}
        aria-label="Move composer"
        className={`flex items-center justify-between border-b border-neutral-100 px-5 py-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-300 ${full ? "" : "touch-none select-none cursor-grab active:cursor-grabbing"}`}
      >
        <h2 id="mail-compose-title" className="font-semibold">
          {seed.threadId ? "Reply" : "New message"}
        </h2>
        <div className="flex gap-3 text-[12px]">
          <button
            type="button"
            onClick={() => {
              movable.resetPosition();
              setFull((v) => !v);
            }}
          >
            {full ? "Restore" : "Full screen"}
          </button>
          <button type="button" onClick={close} aria-label="Close composer">
            ✕
          </button>
        </div>
      </div>
      <div className="space-y-3 overflow-y-auto p-5">
        <p className="rounded-xl bg-neutral-50 px-3 py-2 text-[12px] text-neutral-500">
          From:{" "}
          <span className="font-medium text-ink">
            {(completion ? alias : senderEmail) ||
              "Checking your Google connection…"}
          </span>
        </p>
        {completion && (
          <div className="space-y-2">
            <label htmlFor="mail-send-as" className="block text-xs">
              Verified Google send-as
            </label>
            <SelectMenu
              id="mail-send-as"
              buttonClassName="min-h-11"
              value={alias}
              options={aliases.map((a) => ({ value: a.email, label: a.email }))}
              disabled={busy || uncertain}
              onChange={(value) => {
                clearReview();
                setAlias(value);
                setDirty(true);
              }}
            />
            <p className="text-xs text-neutral-500">
              Each save, send or deletion needs its own review. Save and reopen
              a changed draft before sending.
            </p>
            <button
              type="button"
              disabled
              className="min-h-11 rounded-full border px-4 text-xs opacity-50"
            >
              Schedule send — unavailable
            </button>
            <p className="text-xs text-neutral-500">
              No dispatcher or message-body store is active. Push refresh is
              also off.
            </p>
            <MailReviewHistory />
          </div>
        )}
        {(["to", "cc", "bcc"] as const).map((key) => (
          <div key={key} className="flex items-center gap-3">
            <label
              htmlFor={`mail-${key}`}
              className="w-8 text-[12px] font-medium uppercase text-neutral-500"
            >
              {key}
            </label>
            <RecipientInput
              id={`mail-${key}`}
              value={message[key]}
              onChange={(value) => change(key, value)}
              contacts={knownRecipients}
              className={inputClass}
              placeholder={`${key.toUpperCase()} addresses`}
              disabled={busy || uncertain}
            />
          </div>
        ))}
        <button
          type="button"
          className="text-[12px] font-semibold text-cyan-800"
          onClick={() => setPicker((v) => !v)}
        >
          Add People or a group
        </button>
        {picker && (
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
            <div className="grid grid-cols-2 gap-2">
              <SelectMenu
                value={groupId}
                options={[
                  { value: "all", label: "All People" },
                  ...groups.map((g) => ({ value: g.id, label: g.name })),
                ]}
                onChange={(value) => {
                  setGroupId(value);
                  setChosen([]);
                }}
              />
              <SelectMenu
                value={field}
                options={[
                  { value: "to", label: "Add to To" },
                  { value: "cc", label: "Add to CC" },
                  { value: "bcc", label: "Add to BCC (private)" },
                ]}
                onChange={setField}
              />
            </div>
            <input
              aria-label="Search People"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={`${inputClass} my-2`}
              placeholder="Search People"
            />
            <label className="flex items-center gap-2 text-[12px]">
              <Checkbox
                checked={
                  eligible.length > 0 &&
                  eligible.every((c) => chosen.includes(c.personId))
                }
                onChange={(e) =>
                  setChosen(
                    e.target.checked ? eligible.map((c) => c.personId) : [],
                  )
                }
              />{" "}
              Select all shown ({eligible.length})
            </label>
            <div className="my-2 max-h-40 overflow-y-auto">
              {eligible.map((c) => (
                <label
                  key={c.personId}
                  className="flex items-center gap-2 py-1.5 text-[12px]"
                >
                  <Checkbox
                    checked={chosen.includes(c.personId)}
                    onChange={(e) =>
                      setChosen((v) =>
                        e.target.checked
                          ? [...v, c.personId]
                          : v.filter((id) => id !== c.personId),
                      )
                    }
                  />
                  <span>
                    {c.name} <span className="text-neutral-400">{c.email}</span>
                  </span>
                </label>
              ))}
            </div>
            <button
              type="button"
              disabled={busy || uncertain || !chosen.length}
              className="rounded-full bg-ink px-3 py-2 text-[12px] text-white disabled:opacity-40"
              onClick={() => {
                const key = field as "to" | "cc" | "bcc";
                const emails = eligible
                  .filter((c) => chosen.includes(c.personId))
                  .map((c) => c.email);
                change(
                  key,
                  [message[key], ...emails].filter(Boolean).join(", "),
                );
                setPicker(false);
                setChosen([]);
              }}
            >
              Add selected recipients
            </button>
          </div>
        )}
        <label
          className="block text-[12px] font-medium text-neutral-500"
          htmlFor="mail-subject"
        >
          Subject
        </label>
        <input
          id="mail-subject"
          className={inputClass}
          value={message.subject}
          onChange={(e) => change("subject", e.target.value)}
          disabled={busy || uncertain}
        />
        {initialHtml === null ? (
          <div className="min-h-[180px] rounded-xl border border-neutral-200 px-3 py-2 text-[13px] text-neutral-400">
            Loading your signature…
          </div>
        ) : (
          <RichTextEditor
            initialHtml={initialHtml}
            onChange={(html) => change("html", html)}
            disabled={busy || uncertain}
            placeholder="Write your message…"
          />
        )}
        <label className="inline-flex cursor-pointer rounded-full border border-neutral-200 px-3 py-2 text-[12px]">
          Attach files
          <input
            type="file"
            multiple
            className="sr-only"
            disabled={busy || uncertain}
            onChange={(e) => {
              const next = [...files, ...Array.from(e.target.files ?? [])];
              if (
                next.reduce((s, f) => s + f.size, 0) > 2 * 1024 * 1024 ||
                next.length > 10
              ) {
                setStatus("Attach up to 10 files, 2 MB combined.");
                return;
              }
              clearReview();
              setFiles(next);
              setDirty(true);
              e.target.value = "";
            }}
          />
        </label>
        <span className="ml-2 text-[11px] text-neutral-400">2 MB combined</span>
        <div className="flex flex-wrap gap-2">
          {retained
            .filter((a) => keepParts.includes(a.partId))
            .map((a) => (
              <button
                key={a.partId}
                disabled={busy || uncertain}
                type="button"
                className="rounded-lg border px-2 py-1 text-xs"
                onClick={() => {
                  clearReview();
                  setKeepParts((v) => v.filter((id) => id !== a.partId));
                  setDirty(true);
                }}
              >
                {a.name} ×
              </button>
            ))}
          {files.map((f, i) => (
            <button
              key={i}
              disabled={busy || uncertain}
              type="button"
              className="rounded-lg border px-2 py-1 text-xs"
              onClick={() => {
                clearReview();
                setFiles((v) => v.filter((_, j) => i !== j));
                setDirty(true);
              }}
            >
              {f.name} ×
            </button>
          ))}
        </div>
        {status && (
          <p
            role="status"
            className="rounded-xl bg-neutral-50 px-3 py-2 text-[12px] text-neutral-600"
          >
            {status}
          </p>
        )}
        {review && (
          <MailReviewPanel
            key={review.id}
            review={review}
            busy={busy}
            onConfirm={() =>
              startTransition(async () => {
                await confirmEnhanced();
              })
            }
            onCancel={() =>
              startTransition(async () => {
                await cancelEnhanced();
              })
            }
          />
        )}
        {!completion && confirmSend && !uncertain && (
          <p className="rounded-xl bg-cyan-50 px-3 py-2 text-[12px] text-cyan-900">
            Ready to send now from your connected Google account. Review To, CC,
            BCC and attachments, then confirm.
          </p>
        )}
      </div>
      <footer className="flex flex-wrap items-center gap-2 border-t border-neutral-100 px-5 py-4">
        <button
          type="button"
          disabled={
            busy ||
            uncertain ||
            !senderEmail ||
            (completion && (dirty || !draftId))
          }
          onClick={() =>
            startTransition(async () => {
              await save(true);
            })
          }
          className="rounded-full bg-ink px-5 py-2 text-[12px] font-semibold text-white disabled:opacity-40"
        >
          {busy
            ? "Working…"
            : completion
              ? "Review send"
              : confirmSend
                ? "Confirm send"
                : "Send"}
        </button>
        <button
          type="button"
          disabled={
            busy ||
            uncertain ||
            !senderEmail ||
            (completion && initialHtml === null)
          }
          onClick={() =>
            startTransition(async () => {
              await save(false);
            })
          }
          className="rounded-full border border-neutral-200 px-4 py-2 text-[12px]"
        >
          {completion ? "Review save to Gmail" : "Save to Gmail"}
        </button>
        <span className="flex-1 text-[11px] text-neutral-400">
          {dirty ? "Unsaved changes" : draftId ? "Saved in Gmail" : ""}
        </span>
        <button
          type="button"
          disabled={busy || uncertain}
          onClick={() =>
            startTransition(async () => {
              await discard();
            })
          }
          className="text-[12px] text-neutral-500"
        >
          Discard
        </button>
      </footer>
    </dialog>
  );
}
