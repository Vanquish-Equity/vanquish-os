"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { discardDraftAction, saveDraftAction } from "@/lib/communications/actions";
import SelectMenu from "@/components/SelectMenu";
import { isActiveMember, memberLabel, type Member } from "@/lib/communications/drafts";
import type { ContactGroup, DraftDetail, DraftRecipient, LpContact } from "@/lib/communications/queries";
import { RECIPIENT_ISSUE_LABELS } from "@/lib/communications/recipients";
import { formatExactDate } from "@/lib/dates";

// One selected recipient. Saved recipients keep their recipientId; they are
// re-selected with the contact's current email only when acceptCurrent is
// set (new selections always use the current email).
type Selection = {
  key: string;
  personId: string | null;
  recipientId: string | null;
  acceptCurrent: boolean;
  field: "to" | "cc" | "bcc";
};

type Filter = "all" | "selected" | "not_selected";

const inputClass =
  "w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-[13px] text-ink outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100 disabled:bg-neutral-50";
const labelClass = "mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400";

function recipientKey(recipient: DraftRecipient) {
  return recipient.personId ?? `saved:${recipient.recipientId}`;
}

function initialSelection(draft: DraftDetail | null) {
  const map = new Map<string, Selection>();
  for (const recipient of draft?.recipients ?? []) {
    map.set(recipientKey(recipient), {
      key: recipientKey(recipient),
      personId: recipient.personId,
      recipientId: recipient.recipientId,
      acceptCurrent: false,
      field: recipient.field,
    });
  }
  return map;
}

function matches(contact: LpContact, query: string) {
  if (!query) return true;
  const haystack = [contact.name, contact.email, contact.organization, contact.title]
    .filter(Boolean)
    .join(" ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  return query
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/\s+/)
    .every((term) => haystack.includes(term));
}

export default function DraftComposer({
  draft,
  contacts,
  groups,
  members,
  canEdit,
  currentUserEmail,
  justSaved = false,
}: {
  draft: DraftDetail | null;
  contacts: LpContact[];
  groups: ContactGroup[];
  // Active members, the only valid responsibles.
  members: Member[];
  canEdit: boolean;
  currentUserEmail: string;
  justSaved?: boolean;
}) {
  const router = useRouter();
  const createdBy = draft?.createdBy ?? currentUserEmail;
  const [assignedTo, setAssignedTo] = useState(draft?.assignedTo ?? currentUserEmail);
  const assigneeActive = isActiveMember(members, assignedTo);
  // Handing the draft to someone else removes your edit rights unless you
  // created it.
  const handingOff = assignedTo !== (draft?.assignedTo ?? currentUserEmail) && assignedTo !== currentUserEmail && createdBy !== currentUserEmail;
  const [subject, setSubject] = useState(draft?.subject ?? "");
  const [body, setBody] = useState(draft?.body ?? "");
  const [selection, setSelection] = useState(() => initialSelection(draft));
  const [query, setQuery] = useState("");
  const [groupId, setGroupId] = useState(groups.find((g) => g.kind === "potential_lp")?.id ?? "all");
  const [addField, setAddField] = useState<"to" | "cc" | "bcc">("bcc");
  const [filter, setFilter] = useState<Filter>("all");
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(
    justSaved ? { tone: "ok", text: "Draft saved. Nothing was sent." } : null
  );
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [isPending, startTransition] = useTransition();

  const savedByKey = useMemo(() => {
    const map = new Map<string, DraftRecipient>();
    for (const recipient of draft?.recipients ?? []) map.set(recipientKey(recipient), recipient);
    return map;
  }, [draft]);
  const contactById = useMemo(() => new Map(contacts.map((c) => [c.personId, c])), [contacts]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // Final list, in the order shown to the user.
  const finalList = useMemo(() => {
    return [...selection.values()]
      .map((item) => {
        const saved = savedByKey.get(item.key) ?? null;
        const contact = item.personId ? contactById.get(item.personId) ?? null : null;
        const unresolved = Boolean(saved?.issue) && !item.acceptCurrent;
        // Saved and not re-selected: exactly the stored email. New or
        // accepted: the contact's current email, as the database will pick.
        const email =
          saved && !item.acceptCurrent
            ? saved.emailAtSelection
            : contact?.email ?? saved?.currentEmail ?? saved?.emailAtSelection ?? "";
        return {
          item,
          saved,
          name: contact?.name ?? saved?.name ?? "Unknown contact",
          email,
          unresolved,
        };
      })
      .sort((a, b) => Number(b.unresolved) - Number(a.unresolved) || a.name.localeCompare(b.name));
  }, [selection, savedByKey, contactById]);

  const reviewCount = finalList.filter((entry) => entry.unresolved).length;
  const selectedCount = selection.size;
  const selectableContacts = contacts.filter((contact) => contact.email);

  const inGroup = groupId === "all" ? contacts : contacts.filter((contact) => groups.find((g) => g.id === groupId)?.personIds.includes(contact.personId));
  const visibleContacts = inGroup.filter((contact) => {
    if (!matches(contact, query.trim())) return false;
    const isSelected = selection.has(contact.personId);
    if (filter === "selected") return isSelected;
    if (filter === "not_selected") return !isSelected;
    return true;
  });

  function markDirty() {
    setDirty(true);
    setMessage(null);
  }

  function toggle(contact: LpContact) {
    if (!canEdit || !contact.email) return;
    setSelection((current) => {
      const next = new Map(current);
      if (next.has(contact.personId)) next.delete(contact.personId);
      else {
        const saved = savedByKey.get(contact.personId);
        next.set(contact.personId, {
          key: contact.personId,
          personId: contact.personId,
          recipientId: saved?.recipientId ?? null,
          // Re-adding a flagged recipient means choosing the current email.
          acceptCurrent: Boolean(saved?.issue),
          field: addField,
        });
      }
      return next;
    });
    markDirty();
  }

  function setMany(list: LpContact[], selected: boolean) {
    setSelection((current) => {
      const next = new Map(current);
      for (const contact of list) {
        if (!contact.email) continue;
        if (selected && !next.has(contact.personId)) {
          const saved = savedByKey.get(contact.personId);
          next.set(contact.personId, {
            key: contact.personId,
            personId: contact.personId,
            recipientId: saved?.recipientId ?? null,
            acceptCurrent: Boolean(saved?.issue),
            field: addField,
          });
        }
        if (!selected) next.delete(contact.personId);
      }
      return next;
    });
    markDirty();
  }

  function removeKey(key: string) {
    setSelection((current) => {
      const next = new Map(current);
      next.delete(key);
      return next;
    });
    markDirty();
  }

  function changeField(key: string, field: "to" | "cc" | "bcc") {
    setSelection((current) => {
      const next = new Map(current);
      const item = next.get(key);
      if (item) next.set(key, { ...item, field });
      return next;
    });
    markDirty();
  }

  function acceptCurrent(key: string) {
    setSelection((current) => {
      const next = new Map(current);
      const item = next.get(key);
      if (item) next.set(key, { ...item, acceptCurrent: true });
      return next;
    });
    markDirty();
  }

  function save() {
    setMessage(null);
    startTransition(async () => {
      const result = await saveDraftAction({
        draftId: draft?.id ?? null,
        subject,
        body,
        assignedTo: draft && assignedTo === draft.assignedTo ? null : assignedTo,
        recipients: [...selection.values()].map((item) => ({
          recipientId: item.recipientId,
          personId: item.personId,
          acceptCurrent: item.acceptCurrent || !item.recipientId,
          field: item.field,
        })),
      });
      if (!result.ok) {
        setMessage({ tone: "error", text: result.message });
        return;
      }
      setDirty(false);
      if (handingOff) {
        router.push("/communications");
        router.refresh();
        return;
      }
      // The page reloads the draft from the database, so what is shown after
      // saving is exactly what was stored.
      router.replace(`/communications/${result.draftId}?saved=1`);
      router.refresh();
    });
  }

  function discard() {
    if (!draft) return;
    startTransition(async () => {
      const result = await discardDraftAction(draft.id);
      if (!result.ok) {
        setMessage({ tone: "error", text: result.message });
        return;
      }
      setDirty(false);
      router.push("/communications");
    });
  }

  const readiness = [
    { label: "Subject", ok: subject.trim().length > 0 },
    { label: "Message", ok: body.trim().length > 0 },
    { label: "At least one recipient", ok: selectedCount > 0 },
    { label: "No recipients to review", ok: reviewCount === 0 },
    { label: "Responsible is an active member", ok: assigneeActive },
  ];

  const memberOptions = [
    ...members.map((member) => ({
      value: member.email,
      label: member.email === currentUserEmail ? `${member.name} (you)` : `${member.name} · ${member.email}`,
    })),
    ...(assigneeActive ? [] : [{ value: assignedTo, label: `${assignedTo} (no longer active)`, disabled: true }]),
  ];

  return (
    <div className="flex flex-col gap-4">
      {!canEdit && draft && (
        <div className="rounded-[14px] border border-neutral-200 bg-[#f7f9fa] px-4 py-3 text-[12.5px] text-neutral-600">
          {draft.archivedAt
            ? "This draft was discarded. It is read-only."
            : `Read-only: only ${memberLabel(members, draft.createdBy)} (created it) and ${memberLabel(
                members,
                draft.assignedTo
              )} (responsible) can edit this draft.`}
        </div>
      )}

      <section className="vq-card-static grid grid-cols-1 gap-4 rounded-[14px] bg-white p-5 sm:grid-cols-2">
        <div>
          <div className={labelClass}>Created by</div>
          <p className="py-2 text-[13px] text-ink">
            {memberLabel(members, createdBy)}
            {createdBy === currentUserEmail ? " (you)" : ""}
            <span className="block text-[11.5px] text-neutral-500">Prepared the draft. Can keep editing it.</span>
          </p>
        </div>
        <div>
          <label htmlFor="draft-assignee" className={labelClass}>
            Responsible / planned sender
          </label>
          {canEdit ? (
            <SelectMenu
              id="draft-assignee"
              value={assignedTo}
              options={memberOptions}
              onChange={(value) => {
                setAssignedTo(value);
                markDirty();
              }}
            />
          ) : (
            <p id="draft-assignee" className="py-2 text-[13px] text-ink">
              {memberLabel(members, assignedTo)}
            </p>
          )}
          <p className="mt-1 text-[11.5px] text-neutral-500">
            Reviews the draft and, once Outlook is connected, sends it from their own mailbox.
          </p>
          {!assigneeActive && (
            <p role="alert" className="mt-1 text-[11.5px] text-amber-800">
              This responsible is no longer an active member. Choose another one.
            </p>
          )}
          {handingOff && (
            <p className="mt-1 text-[11.5px] text-amber-800">
              After saving, {memberLabel(members, assignedTo)} and {memberLabel(members, createdBy)} can edit it; you
              will only be able to view it.
            </p>
          )}
        </div>
      </section>

      {reviewCount > 0 && (
        <div role="status" className="rounded-[14px] border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-900">
          <span className="font-semibold">
            {reviewCount} recipient{reviewCount === 1 ? "" : "s"} need{reviewCount === 1 ? "s" : ""} review.
          </span>{" "}
          Their contact changed in People after they were selected. Use the current email or remove them in the recipient
          list before this draft is sent.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Message */}
        <section className="vq-card-static flex flex-col gap-3.5 rounded-[14px] bg-white p-5">
          <h2 className="text-[13px] font-semibold text-ink">Message</h2>
          <div>
            <label htmlFor="draft-subject" className={labelClass}>
              Subject
            </label>
            <input
              id="draft-subject"
              value={subject}
              maxLength={500}
              disabled={!canEdit}
              onChange={(event) => {
                setSubject(event.target.value);
                markDirty();
              }}
              placeholder="e.g. Investment announcement, quarterly update, event invitation"
              className={inputClass}
            />
          </div>
          <div className="flex flex-1 flex-col">
            <label htmlFor="draft-body" className={labelClass}>
              Body
            </label>
            <textarea
              id="draft-body"
              value={body}
              disabled={!canEdit}
              onChange={(event) => {
                setBody(event.target.value);
                markDirty();
              }}
              rows={16}
              placeholder="Write the email. Plain text; line breaks are kept."
              className={`${inputClass} min-h-[280px] flex-1 resize-y leading-relaxed`}
            />
          </div>

          <div className="rounded-xl border border-neutral-100 bg-[#f7f9fa] p-3.5 text-[12px] text-neutral-600">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
                Delivery · planned
              </span>
              <span className="rounded-full bg-white px-2 py-0.5 text-[10.5px] font-semibold text-neutral-500 ring-1 ring-neutral-200">
                Outlook not connected
              </span>
            </div>
            <dl className="mt-2 grid grid-cols-[72px_1fr] gap-y-1">
              <dt className="text-neutral-400">From</dt>
              <dd className="text-ink">
                {memberLabel(members, assignedTo)} · {assignedTo} (their Outlook mailbox)
              </dd>
              <dt className="text-neutral-400">Recipients</dt>
              <dd className="text-ink">
                {selectedCount} person{selectedCount === 1 ? "" : "s"} · To, CC and BCC
              </dd>
            </dl>
            <p className="mt-2 text-neutral-500">
              Sending is not available yet. Saving only stores this draft in Vanquish OS; no email is sent.
            </p>
            <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {readiness.map((item) => (
                <li key={item.label} className={item.ok ? "text-emerald-700" : "text-neutral-400"}>
                  {item.ok ? "✓" : "○"} {item.label}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Recipients picker */}
        <section className="vq-card-static flex min-h-0 flex-col rounded-[14px] bg-white">
          <div className="border-b border-neutral-100 p-5 pb-3.5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[13px] font-semibold text-ink">People</h2>
              <span className="rounded-full bg-ink px-2.5 py-1 text-[11.5px] font-semibold text-white" aria-live="polite">
                {selectedCount} selected
              </span>
            </div>
            {contacts.length > 0 && (
              <>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div><label className={labelClass} htmlFor="draft-group">Choose a group</label>
                    <SelectMenu id="draft-group" value={groupId} onChange={setGroupId}
                      options={[{ value: "all", label: "All People" }, ...groups.map((g) => ({ value: g.id, label: g.name }))]} />
                  </div>
                  <div><label className={labelClass} htmlFor="draft-add-field">Add selected contacts to</label>
                    <SelectMenu id="draft-add-field" value={addField} onChange={(v) => setAddField(v as "to" | "cc" | "bcc")}
                      options={[{ value: "to", label: "To" }, { value: "cc", label: "CC" }, { value: "bcc", label: "BCC" }]} />
                  </div>
                </div>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search name, email, company or title"
                  aria-label="Search People"
                  className={`${inputClass} mt-3`}
                />
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex gap-1.5" role="group" aria-label="Filter People">
                    {(
                      [
                        ["all", `All (${inGroup.length})`],
                        ["selected", `Selected (${[...selection.keys()].filter((k) => contactById.has(k)).length})`],
                        ["not_selected", "Not selected"],
                      ] as [Filter, string][]
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setFilter(key)}
                        aria-pressed={filter === key}
                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                          filter === key
                            ? "bg-ink text-white"
                            : "border border-neutral-200 text-neutral-600 hover:border-cyan-300 hover:text-cyan-800"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {canEdit && (
                    <div className="flex gap-2 text-[11px] font-semibold">
                      <button
                        type="button"
                        onClick={() => setMany(visibleContacts, true)}
                        className="text-cyan-700 hover:underline"
                      >
                        Select shown
                      </button>
                      <button
                        type="button"
                        onClick={() => setMany(visibleContacts, false)}
                        className="text-neutral-500 hover:underline"
                      >
                        Clear shown
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="max-h-[440px] min-h-[160px] flex-1 overflow-auto p-2">
            {contacts.length === 0 ? (
              <div className="px-4 py-8 text-center text-[12.5px] text-neutral-500">
                <p className="font-semibold text-ink">No People yet.</p>
                <p className="mt-1">
                  Add one in{" "}
                  <Link href="/people" className="font-semibold text-cyan-700 hover:underline">
                    People
                  </Link>
                  . You can still write and save the message now.
                </p>
              </div>
            ) : visibleContacts.length === 0 ? (
              <p className="px-4 py-8 text-center text-[12.5px] text-neutral-400">No People match.</p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {visibleContacts.map((contact) => {
                  const isSelected = selection.has(contact.personId);
                  const saved = savedByKey.get(contact.personId);
                  const flagged = isSelected && saved?.issue && !selection.get(contact.personId)?.acceptCurrent;
                  return (
                    <li key={contact.personId}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={isSelected}
                        disabled={!canEdit || !contact.email}
                        onClick={() => toggle(contact)}
                        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition ${
                          isSelected ? "bg-[#f0fafb] ring-1 ring-cyan-200" : "hover:bg-neutral-50"
                        } disabled:cursor-not-allowed disabled:opacity-60`}
                      >
                        <span
                          aria-hidden
                          className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border text-[10px] font-bold ${
                            isSelected ? "border-cyan-700 bg-cyan-700 text-white" : "border-neutral-300 bg-white"
                          }`}
                        >
                          {isSelected ? "✓" : ""}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] font-semibold text-ink">{contact.name}</span>
                          <span className="block truncate text-[11.5px] text-neutral-500">
                            {contact.email ?? "No email — add one in People"}
                            {contact.organization ? ` · ${contact.organization}` : ""}
                          </span>
                        </span>
                        {flagged && (
                          <span className="flex-shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10.5px] font-semibold text-amber-800 ring-1 ring-amber-200">
                            Review
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {contacts.length > 0 && selectableContacts.length < contacts.length && (
            <p className="border-t border-neutral-100 px-5 py-2 text-[11px] text-neutral-500">
              {contacts.length - selectableContacts.length} person
              {contacts.length - selectableContacts.length === 1 ? " has" : "s have"} no email and cannot be selected.
            </p>
          )}
        </section>
      </div>

      {/* Final recipient list */}
      <section className="vq-card-static rounded-[14px] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 px-5 py-3.5">
          <div>
            <h2 className="text-[13px] font-semibold text-ink">
              Recipients · {selectedCount} person{selectedCount === 1 ? "" : "s"}
            </h2>
            <p className="mt-0.5 text-[11.5px] text-neutral-500">
              Exactly who this draft will be addressed to once sending is connected.
            </p>
          </div>
        </div>
        {finalList.length === 0 ? (
          <p className="px-5 py-6 text-[12.5px] text-neutral-400">
            No recipients selected. Choose People above to add them.
          </p>
        ) : (
          <ul className="max-h-[360px] divide-y divide-neutral-50 overflow-auto">
            {finalList.map(({ item, saved, name, email, unresolved }) => (
              <li key={item.key} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-[12.5px]">
                <div className="min-w-0 flex-1">
                  <span className="font-semibold text-ink">{name}</span>{" "}
                  <span className="text-neutral-500">&lt;{email}&gt;</span>
                  {unresolved && saved?.issue && (
                    <p className="mt-0.5 text-[11.5px] text-amber-800">
                      {RECIPIENT_ISSUE_LABELS[saved.issue]}
                      {saved.canAcceptCurrent && saved.currentEmail && saved.currentEmail !== saved.emailAtSelection
                        ? ` · current email: ${saved.currentEmail}`
                        : ""}
                    </p>
                  )}
                  {!unresolved && saved?.issue && item.acceptCurrent && (
                    <p className="mt-0.5 text-[11.5px] text-emerald-700">Will use the current email when saved.</p>
                  )}
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1.5">
                    <div className="w-24"><label htmlFor={`recipient-field-${item.key}`} className="sr-only">Address field for {name}</label><SelectMenu id={`recipient-field-${item.key}`} value={item.field}
                      onChange={(v) => changeField(item.key, v as "to" | "cc" | "bcc")}
                      options={[{ value: "to", label: "To" }, { value: "cc", label: "CC" }, { value: "bcc", label: "BCC" }]} /></div>
                    {unresolved && saved?.canAcceptCurrent && (
                      <button
                        type="button"
                        onClick={() => acceptCurrent(item.key)}
                        className="rounded-full border border-cyan-300 px-2.5 py-1 text-[11px] font-semibold text-cyan-800 transition hover:bg-cyan-50"
                      >
                        Use current email
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => removeKey(item.key)}
                      aria-label={`Remove ${name}`}
                      className="rounded-full border border-neutral-200 px-2.5 py-1 text-[11px] font-semibold text-neutral-600 transition hover:border-red-200 hover:text-red-700"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canEdit && (
        <div className="sticky bottom-0 z-10 -mx-7 flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 bg-white/95 px-7 py-3 backdrop-blur">
          <div className="text-[12px] text-neutral-500">
            {message ? (
              <span role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? "text-red-600" : "text-emerald-700"}>
                {message.text}
              </span>
            ) : dirty ? (
              "Unsaved changes"
            ) : draft ? (
              `Saved · last change ${formatExactDate(draft.updatedAt)}`
            ) : (
              "Not saved yet"
            )}
          </div>
          <div className="flex items-center gap-2">
            {draft &&
              (confirmDiscard ? (
                <span role="alertdialog" aria-label="Discard draft" className="flex items-center gap-2 text-[12px] text-neutral-600">
                  Discard this draft?
                  <button
                    type="button"
                    onClick={discard}
                    disabled={isPending}
                    className="rounded-full bg-red-600 px-3 py-1.5 text-[11.5px] font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
                  >
                    Discard draft
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDiscard(false)}
                    className="rounded-full border border-neutral-200 px-3 py-1.5 text-[11.5px] font-semibold text-neutral-600"
                  >
                    Keep
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDiscard(true)}
                  className="rounded-full border border-neutral-200 px-3.5 py-2 text-[12px] font-semibold text-neutral-600 transition hover:border-red-200 hover:text-red-700"
                >
                  Discard
                </button>
              ))}
            <button
              type="button"
              onClick={save}
              disabled={isPending || (!dirty && Boolean(draft))}
              className="rounded-full bg-ink px-4 py-2 text-[12px] font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? "Saving..." : "Save draft"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
