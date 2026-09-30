"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import SelectMenu from "@/components/SelectMenu";
import Checkbox from "@/components/Checkbox";
import MailThreadReader from "./MailThreadReader";
import MailFolderNav from "./MailFolderNav";
import MailThreadRows from "./MailThreadRows";
import { button, empty } from "./mail-ui";
import MailComposer, { type ComposeSeed } from "./MailComposer";
import {
  listMail,
  readThread,
  changeMail,
  findGmailDraft,
  mailboxProfile,
  listMailLabels,
  manageMailLabel,
  labelConversations,
} from "@/lib/google/mail-actions";
import {
  MAIL_FOLDERS,
  type MailFolder,
  type MailPage,
  type MailMessage,
  type MailOperation,
} from "@/lib/google/mail-types";
import { parseAddresses } from "@/lib/google/mail-validation";
import { plainTextToHtml } from "@/lib/communications/rich-text";
import type { ContactGroup, LpContact } from "@/lib/communications/queries";

export default function MailWorkspace({
  connected,
  contacts,
  groups,
  initialFolder = "inbox",
  me,
}: {
  connected: boolean;
  contacts: LpContact[];
  groups: ContactGroup[];
  initialFolder?: MailFolder;
  me: string;
}) {
  const [mailboxEmail, setMailboxEmail] = useState(me);
  useEffect(() => {
    let canceled = false;
    if (connected)
      mailboxProfile().then((result) => {
        if (!canceled && result.ok) setMailboxEmail(result.data.email);
      });
    return () => {
      canceled = true;
    };
  }, [connected]);
  const [labels, setLabels] = useState<{ id: string; name: string }[]>([]);
  const [labelId, setLabelId] = useState("");
  const [targetLabel, setTargetLabel] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [labelRevision, setLabelRevision] = useState(0);
  useEffect(() => {
    let canceled = false;
    if (connected)
      listMailLabels().then((result) => {
        if (!canceled && result.ok) setLabels(result.data);
      });
    return () => {
      canceled = true;
    };
  }, [connected, labelRevision]);
  const [folder, setFolder] = useState<MailFolder>(initialFolder);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [attachmentOnly, setAttachmentOnly] = useState(false);
  const [filters, setFilters] = useState(false);
  const [tokens, setTokens] = useState<string[]>([""]);
  const token = tokens.at(-1) ?? "";
  const [page, setPage] = useState<MailPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MailMessage[] | null>(null);
  const [threadError, setThreadError] = useState("");
  const [composer, setComposer] = useState<ComposeSeed | null>(null);
  const [mutating, setMutating] = useState(false);
  const mutatingRef = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!connected) return;
    let canceled = false;
    queueMicrotask(() => {
      if (!canceled) {
        setLoading(true);
        setError("");
        setSelected([]);
      }
    });
    listMail(
      folder,
      `${query} ${unreadOnly ? "is:unread" : ""} ${attachmentOnly ? "has:attachment" : ""}`,
      token,
      labelId,
    )
      .then((result) => {
        if (canceled) return;
        if (result.ok) setPage(result.data);
        else {
          setPage(null);
          setError(result.message);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!canceled) {
          setError("Could not load mail. Try refreshing.");
          setLoading(false);
        }
      });
    return () => {
      canceled = true;
    };
  }, [
    connected,
    folder,
    query,
    token,
    unreadOnly,
    attachmentOnly,
    revision,
    labelId,
  ]);
  useEffect(() => {
    if (!threadId) return;
    let canceled = false;
    readThread(threadId)
      .then((result) => {
        if (canceled) return;
        if (result.ok) {
          setMessages(result.data.messages);
          if (result.data.messages.some((m) => m.labels.includes("UNREAD"))) {
            void changeMail([threadId], "read").then((updated) => {
              if (!canceled && updated.ok && !updated.data.failed.length)
                setPage((page) =>
                  page
                    ? {
                        ...page,
                        threads: page.threads.map((t) =>
                          t.id === threadId ? { ...t, unread: false } : t,
                        ),
                      }
                    : page,
                );
            });
          }
        } else setThreadError(result.message);
      })
      .catch(() => {
        if (!canceled) setThreadError("Could not open this conversation.");
      });
    return () => {
      canceled = true;
    };
  }, [threadId, revision]);
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (
        composer ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        (event.target as HTMLElement).closest(
          "input,textarea,[contenteditable=true]",
        )
      )
        return;
      if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "c") setComposer({ ...empty });
      if (event.key === "Escape") setThreadId(null);
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [composer]);
  async function operate(operation: MailOperation, ids = selected) {
    if (mutatingRef.current || !ids.length) return;
    mutatingRef.current = true;
    setMutating(true);
    setNotice("");
    try {
      const result = await changeMail(ids, operation);
      if (!result.ok) setNotice(result.message);
      else {
        setNotice(
          result.data.failed.length
            ? `${result.data.completed.length} updated; ${result.data.failed.length} could not be confirmed. Refresh before retrying.`
            : `${result.data.completed.length} conversation${result.data.completed.length === 1 ? "" : "s"} updated in Gmail.`,
        );
        setSelected(result.data.failed);
        setRevision((v) => v + 1);
      }
    } catch {
      setNotice(
        "The operation was not confirmed. Refresh Gmail before retrying.",
      );
    } finally {
      mutatingRef.current = false;
      setMutating(false);
    }
  }
  async function manageLabel(operation: "create" | "rename" | "delete") {
    if (mutatingRef.current) return;
    let name = newLabel;
    if (operation === "rename") {
      const answer = window.prompt(
        "Label name",
        labels.find((l) => l.id === labelId)?.name,
      );
      if (!answer) return;
      name = answer;
    }
    if (
      operation === "delete" &&
      !window.confirm("Delete this Gmail label? Messages are kept.")
    )
      return;
    mutatingRef.current = true;
    setMutating(true);
    try {
      const result = await manageMailLabel(operation, name, labelId);
      if (!result.ok) setNotice(result.message);
      else {
        setLabelRevision((v) => v + 1);
        setNewLabel("");
        if (operation === "delete") setLabelId("");
      }
    } finally {
      mutatingRef.current = false;
      setMutating(false);
    }
  }
  async function applyLabel(remove = false) {
    if (mutatingRef.current || !targetLabel || !selected.length) return;
    mutatingRef.current = true;
    setMutating(true);
    try {
      const result = await labelConversations(selected, targetLabel, remove);
      setNotice(
        result.ok
          ? result.data.failed.length
            ? "Some labels could not be updated. Refresh before retrying."
            : "Labels updated in Gmail."
          : result.message,
      );
      setRevision((v) => v + 1);
    } finally {
      mutatingRef.current = false;
      setMutating(false);
    }
  }
  function openThread(id: string) {
    setThreadId(id);
    setMessages(null);
    setThreadError("");
  }
  function reply(message: MailMessage, all = false) {
    const from = message.replyTo || message.from;
    const isMine = message.from
      .toLowerCase()
      .includes(mailboxEmail.toLowerCase());
    let replyCc = "";
    if (all) {
      try {
        const replyTo = parseAddresses(isMine ? message.to : from);
        replyCc = parseAddresses(
          [message.to, message.cc].filter(Boolean).join(", "),
        )
          .filter(
            (address) =>
              address.toLowerCase() !== mailboxEmail.toLowerCase() &&
              !replyTo.some((to) => to.toLowerCase() === address.toLowerCase()),
          )
          .join(", ");
      } catch {
        setNotice("Review the recipient addresses before replying to all.");
      }
    }
    setComposer({
      to: isMine ? message.to : from,
      cc: replyCc,
      bcc: "",
      subject: /^re:/i.test(message.subject)
        ? message.subject
        : `Re: ${message.subject}`,
      html: `<br><br><p>On ${message.date}, ${plainTextToHtml(message.from)} wrote:</p><div>${plainTextToHtml(message.text || "[Original HTML message — see conversation above]")}</div>`,
      threadId: message.threadId,
      replyMessageId: message.messageId,
      references: [message.references, message.messageId]
        .filter(Boolean)
        .join(" "),
    });
  }
  async function editDraft(message: MailMessage) {
    const result = await findGmailDraft(message.id);
    if (!result.ok) {
      setNotice(result.message);
      return;
    }
    const m = result.data.message;
    setComposer({
      to: m.to,
      cc: m.cc,
      bcc: m.bcc,
      subject: m.subject === "(No subject)" ? "" : m.subject,
      html: m.html ? m.html : plainTextToHtml(m.text),
      draftId: result.data.id,
      draftMessageId: m.id,
      attachments: m.attachments,
      ...(m.messageId && m.references
        ? { threadId: m.threadId, references: m.references }
        : {}),
    });
  }
  if (!connected)
    return (
      <div className="vq-card-static rounded-2xl bg-white p-10 text-center">
        <h2 className="font-semibold text-ink">Connect your Google mailbox</h2>
        <p className="my-2 text-[13px] text-neutral-500">
          Your own Gmail messages and calendar appear here after connecting.
        </p>
        <Link href="/settings#settings-connections" className={button}>
          Connect Google in Settings
        </Link>
      </div>
    );
  return (
    <div className="vq-card-static min-h-[640px] overflow-hidden rounded-2xl bg-white">
      <p className="border-b border-neutral-100 px-5 py-2 text-[11px] text-neutral-400">
        Google mailbox · {mailboxEmail}
      </p>
      <div className="flex flex-wrap items-center gap-3 border-b border-neutral-100 p-4">
        <button
          type="button"
          onClick={() => setComposer({ ...empty })}
          className="rounded-full bg-ink px-5 py-2.5 text-[12px] font-semibold text-white"
        >
          Compose
        </button>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setQuery(search);
            setTokens([""]);
            setThreadId(null);
          }}
          className="flex min-w-[180px] flex-1 items-center gap-2 rounded-xl bg-neutral-50 px-3"
        >
          <span aria-hidden className="text-neutral-400">
            ⌕
          </span>
          <input
            ref={searchRef}
            aria-label="Search Gmail"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search mail · from: subject: after: has:attachment"
            className="min-w-0 flex-1 bg-transparent py-2.5 text-[12px] outline-none"
          />
          <button type="submit" className="text-[11px] text-cyan-800">
            Search
          </button>
        </form>
        <button
          type="button"
          onClick={() => setFilters((v) => !v)}
          className={button}
          aria-expanded={filters}
        >
          Filters
        </button>
        <button
          type="button"
          onClick={() => setRevision((v) => v + 1)}
          disabled={loading}
          className={button}
        >
          Refresh
        </button>
      </div>
      {filters && (
        <div className="flex flex-wrap gap-5 border-b border-neutral-100 px-5 py-3 text-[12px]">
          <label className="flex items-center gap-2">
            <Checkbox
              checked={unreadOnly}
              onChange={(e) => {
                setUnreadOnly(e.target.checked);
                setTokens([""]);
              }}
            />{" "}
            Unread only
          </label>
          <label className="flex items-center gap-2">
            <Checkbox
              checked={attachmentOnly}
              onChange={(e) => {
                setAttachmentOnly(e.target.checked);
                setTokens([""]);
              }}
            />{" "}
            Has attachments
          </label>
          <button
            type="button"
            className="text-cyan-800"
            onClick={() => {
              setUnreadOnly(false);
              setAttachmentOnly(false);
              setQuery("");
              setSearch("");
              setTokens([""]);
            }}
          >
            Clear filters
          </button>
        </div>
      )}
      <div className="flex flex-col md:flex-row">
        <MailFolderNav
          folder={folder}
          labelId={labelId}
          labels={labels}
          newLabel={newLabel}
          mutating={mutating}
          setNewLabel={setNewLabel}
          onCreateLabel={() => void manageLabel("create")}
          onFolder={(folder, label = "") => {
            setFolder(folder);
            setLabelId(label);
            setTokens([""]);
            setThreadId(null);
            setPage(null);
            setSelected([]);
          }}
        />
        <main className="min-w-0 flex-1">
          {notice && (
            <p
              role="status"
              className="border-b border-neutral-100 bg-neutral-50 px-5 py-3 text-[12px] text-neutral-600"
            >
              {notice}
            </p>
          )}
          {threadId ? (
            <MailThreadReader
              threadId={threadId}
              messages={messages}
              threadError={threadError}
              mutating={mutating}
              onBack={() => setThreadId(null)}
              operate={operate}
              reply={reply}
              editDraft={editDraft}
              setComposer={setComposer}
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-neutral-100 px-4 py-3">
                <Checkbox
                  aria-label="Select all conversations on this page"
                  checked={
                    !!page?.threads.length &&
                    page.threads.every((t) => selected.includes(t.id))
                  }
                  disabled={loading}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? (page?.threads ?? []).map((t) => t.id)
                        : [],
                    )
                  }
                />
                {selected.length ? (
                  <>
                    <span className="text-[11px] text-neutral-500">
                      {selected.length} selected
                    </span>
                    {(
                      [
                        "archive",
                        "read",
                        "unread",
                        "trash",
                        ...(folder === "trash" ? ["restore"] : []),
                        ...(folder === "spam" ? ["not-spam"] : []),
                      ] as MailOperation[]
                    ).map((op) => (
                      <button
                        type="button"
                        key={op}
                        disabled={mutating || loading}
                        onClick={() => void operate(op)}
                        className={button}
                      >
                        {
                          (
                            {
                              archive: "Archive",
                              read: "Read",
                              unread: "Unread",
                              trash: "Trash",
                              restore: "Restore",
                              "not-spam": "Not spam",
                            } as Record<string, string>
                          )[op]
                        }
                      </button>
                    ))}
                  </>
                ) : (
                  <span className="text-[12px] font-medium text-neutral-500">
                    {MAIL_FOLDERS.find((f) => f.key === folder)?.label}{" "}
                    {query && "· Search results"}
                  </span>
                )}
                {selected.length > 0 && labels.length > 0 && (
                  <>
                    <SelectMenu
                      value={targetLabel}
                      options={labels.map((l) => ({
                        value: l.id,
                        label: l.name,
                      }))}
                      placeholder="Choose label"
                      rootClassName="w-32"
                      onChange={setTargetLabel}
                    />
                    <button
                      type="button"
                      disabled={!targetLabel || mutating}
                      onClick={() => void applyLabel()}
                      className={button}
                    >
                      Apply label
                    </button>
                    <button
                      type="button"
                      disabled={!targetLabel || mutating}
                      onClick={() => void applyLabel(true)}
                      className={button}
                    >
                      Remove label
                    </button>
                  </>
                )}
                {labelId && (
                  <>
                    <span className="text-[12px] text-cyan-800">
                      {labels.find((l) => l.id === labelId)?.name}
                    </span>
                    <button
                      type="button"
                      disabled={mutating}
                      className={button}
                      onClick={() => void manageLabel("rename")}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      disabled={mutating}
                      className={button}
                      onClick={() => void manageLabel("delete")}
                    >
                      Delete label
                    </button>
                  </>
                )}
                <span className="flex-1" />
                <span className="text-[11px] text-neutral-400">
                  Page {tokens.length}
                </span>
                <button
                  type="button"
                  className={button}
                  disabled={loading || tokens.length <= 1}
                  onClick={() => setTokens((v) => v.slice(0, -1))}
                >
                  ‹ Previous
                </button>
                <button
                  type="button"
                  className={button}
                  disabled={loading || !page?.nextPageToken}
                  onClick={() => {
                    if (page?.nextPageToken)
                      setTokens((v) => [...v, page.nextPageToken!]);
                  }}
                >
                  Next ›
                </button>
              </div>
              <MailThreadRows
                loading={loading}
                error={error}
                page={page}
                selected={selected}
                folder={folder}
                mutating={mutating}
                setSelected={setSelected}
                openThread={openThread}
                operate={operate}
              />
            </>
          )}
        </main>
      </div>
      {composer && (
        <MailComposer
          seed={composer}
          contacts={contacts}
          groups={groups}
          onClose={() => {
            setComposer(null);
            setRevision((v) => v + 1);
          }}
          onSent={() => {
            setComposer(null);
            setFolder("sent");
            setThreadId(null);
            setTokens([""]);
            setRevision((v) => v + 1);
            setNotice("Message sent through Gmail.");
          }}
        />
      )}
    </div>
  );
}
