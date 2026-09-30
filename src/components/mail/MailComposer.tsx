"use client";
import { useEffect, useRef, useState } from "react";
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
} from "@/lib/google/mail-actions";
import { validateCompose } from "@/lib/google/mail-validation";
import type { ComposeInput, MailAttachment } from "@/lib/google/mail-types";
import type { ContactGroup, LpContact } from "@/lib/communications/queries";

export type ComposeSeed = ComposeInput & {
  draftId?: string;
  draftMessageId?: string;
  attachments?: MailAttachment[];
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
      className={`${full ? "h-[94vh] w-[96vw] max-w-none" : "w-[760px] max-w-[94vw]"} max-h-[94vh] rounded-2xl border border-neutral-200 bg-white p-0 text-ink shadow-2xl backdrop:bg-ink/35`}
      aria-labelledby="mail-compose-title"
    >
      <div {...movable.handleProps} aria-label="Move composer" className={`flex items-center justify-between border-b border-neutral-100 px-5 py-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-300 ${full ? "" : "touch-none select-none cursor-grab active:cursor-grabbing"}`}>
        <h2 id="mail-compose-title" className="font-semibold">
          {seed.threadId ? "Reply" : "New message"}
        </h2>
        <div className="flex gap-3 text-[12px]">
          <button type="button" onClick={() => { movable.resetPosition(); setFull((v) => !v); }}>
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
            {senderEmail || "Checking your Google connection…"}
          </span>
        </p>
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
        <RichTextEditor
          initialHtml={seed.html}
          onChange={(html) => change("html", html)}
          disabled={busy || uncertain}
          placeholder="Write your message…"
        />
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
        {confirmSend && !uncertain && (
          <p className="rounded-xl bg-cyan-50 px-3 py-2 text-[12px] text-cyan-900">
            Ready to send now from your connected Google account. Review To, CC,
            BCC and attachments, then confirm.
          </p>
        )}
      </div>
      <footer className="flex flex-wrap items-center gap-2 border-t border-neutral-100 px-5 py-4">
        <button
          type="button"
          disabled={busy || uncertain || !senderEmail}
          onClick={() => void save(true)}
          className="rounded-full bg-ink px-5 py-2 text-[12px] font-semibold text-white disabled:opacity-40"
        >
          {busy ? "Working…" : confirmSend ? "Confirm send" : "Send"}
        </button>
        <button
          type="button"
          disabled={busy || uncertain || !senderEmail}
          onClick={() => void save(false)}
          className="rounded-full border border-neutral-200 px-4 py-2 text-[12px]"
        >
          Save to Gmail
        </button>
        <span className="flex-1 text-[11px] text-neutral-400">
          {dirty ? "Unsaved changes" : draftId ? "Saved in Gmail" : ""}
        </span>
        <button
          type="button"
          disabled={busy || uncertain}
          onClick={() => void discard()}
          className="text-[12px] text-neutral-500"
        >
          Discard
        </button>
      </footer>
    </dialog>
  );
}
