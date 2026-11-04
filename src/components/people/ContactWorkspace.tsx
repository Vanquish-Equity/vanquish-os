"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import ContactAudience, { type Audience, type MemberOption } from "@/components/people/ContactAudience";
import {
  completeContactReminder, createContactReminder, downloadContactFile, removeContactFile, removeContactNote,
  removeContactReminder, saveContactNote, updateContactReminder, uploadContactFile,
} from "@/lib/people/contact-workspace-actions";
import type { Visibility } from "@/lib/people/contact-privacy";

type Note = { id: string; body: string; author: string; day: string; mine: boolean; label: string; tagged: string | null };
type Reminder = {
  id: string; title: string; dueOn: string; visibility: Visibility; mine: boolean; included: string[]; label: string;
  forLabel: string; done: boolean; overdue: boolean; canComplete: boolean; doneBy: string | null;
};
const TEAM_DEFAULT: Audience = { visibility: "team", recipients: [] };
const COPY = {
  notesHint: "Notes follow Who can see this. Team notes are shared with active workspace members.",
  remindersHint: "One shared reminder: anyone included can mark it done for everyone.",
  overdue: "Overdue",
};
type ContactFile = { name: string };
type Result = Awaited<ReturnType<typeof saveContactNote>>;
const input = "w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm";
const button = "min-h-9 rounded-full border border-neutral-200 bg-white px-3 text-xs font-semibold text-cyan-900 hover:border-cyan-400 disabled:opacity-50";

export default function ContactWorkspace({ personId, notes, reminders, files, members = [] }: {
  personId: string; notes: Note[] | null; reminders: Reminder[] | null; files?: ContactFile[] | null; members?: MemberOption[];
}) {
  const [noteAudience, setNoteAudience] = useState<Audience>(TEAM_DEFAULT);
  const [reminderAudience, setReminderAudience] = useState<Audience>(TEAM_DEFAULT);
  const [editing, setEditing] = useState<string | null>(null);
  const [editAudience, setEditAudience] = useState<Audience>(TEAM_DEFAULT);
  const router = useRouter();
  const [panel, setPanel] = useState<"Notes" | "Reminders" | "Files">("Notes");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [message, setMessage] = useState<{ text: string; error: boolean }>();
  const tabs = files === undefined ? ["Notes", "Reminders"] as const : ["Notes", "Reminders", "Files"] as const;

  async function run(action: () => Promise<Result>, success: string, form?: HTMLFormElement, after?: () => void) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await action();
      if (!result.ok) setMessage({ text: result.message, error: true });
      else if (result.url) window.location.assign(result.url);
      else {
        form?.reset();
        after?.();
        setMessage({ text: success, error: false });
        router.refresh();
      }
    } catch {
      setMessage({ text: "Couldn't complete this action. Refresh to check the result.", error: true });
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>, action: (data: FormData) => Promise<Result>, success: string, after?: () => void) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void run(() => action(data), success, form, after);
  }

  return <section aria-label="Contact workspace" className="vq-card-static space-y-3 rounded-[14px] bg-white p-4">
    <div className="flex flex-wrap gap-2" aria-label="Contact workspace sections">
      {tabs.map((tab) => <button key={tab} type="button" aria-pressed={panel === tab} disabled={busy}
        className={`${button} aria-pressed:border-cyan-200 aria-pressed:bg-cyan-50`}
        onClick={() => { setPanel(tab); setMessage(undefined); }}>{tab}</button>)}
    </div>
    {message && <p role={message.error ? "alert" : "status"} className={`text-sm ${message.error ? "text-red-700" : "text-neutral-700"}`}>{message.text}</p>}
    {panel === "Notes" && (notes === null ? <p className="text-sm text-neutral-600">Notes are unavailable right now.</p> : <>
      <p className="text-xs text-neutral-600">{COPY.notesHint}</p>
      <form className="space-y-2" onSubmit={(event) => submit(event, (data) => saveContactNote(personId, String(data.get("note") ?? ""), noteAudience.visibility, noteAudience.recipients),
        "Note saved.", () => setNoteAudience(TEAM_DEFAULT))}>
        <textarea className={input} rows={3} name="note" aria-label="Contact note" placeholder="What should the team know?" maxLength={2000} required />
        <ContactAudience members={members} value={noteAudience} onChange={setNoteAudience} disabled={busy} />
        <button className={button} disabled={busy}>Add note</button>
      </form>
      {notes.length === 0 ? <p className="text-sm text-neutral-500">No notes yet.</p> : <ul className="divide-y divide-neutral-100">{notes.map((note) => <li key={note.id} className="space-y-1 py-2.5 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-600">
          <span>{note.author} · {note.day} · <span className="rounded-full bg-neutral-100 px-2 py-0.5">{note.label}</span></span>
          {note.mine && <button type="button" className="min-h-8 text-red-700 underline" disabled={busy}
            onClick={() => { if (window.confirm("Remove this note?")) void run(() => removeContactNote(personId, note.id), "Note removed."); }}>Remove</button>}
        </div>
        <p className="whitespace-pre-wrap break-words">{note.body}</p>
        {note.tagged && <p className="text-xs text-neutral-600">{note.tagged}</p>}
      </li>)}</ul>}
    </>)}
    {panel === "Reminders" && (reminders === null ? <p className="text-sm text-neutral-600">Reminders are unavailable right now.</p> : <>
      <p className="text-xs text-neutral-600">{COPY.remindersHint}</p>
      <form className="space-y-2" onSubmit={(event) => submit(event,
        (data) => createContactReminder(personId, String(data.get("title") ?? ""), String(data.get("due") ?? ""), reminderAudience.visibility, reminderAudience.recipients),
        "Reminder added.", () => setReminderAudience(TEAM_DEFAULT))}>
        <input className={input} name="title" aria-label="Reminder title" placeholder="Follow up about…" maxLength={160} required />
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs text-neutral-600">Due date<input className={input} type="date" name="due" required /></label>
        </div>
        <ContactAudience members={members} value={reminderAudience} onChange={setReminderAudience} disabled={busy} />
        <button className={button} disabled={busy}>Add reminder</button>
      </form>
      {reminders.length === 0 ? <p className="text-sm text-neutral-500">No reminders yet.</p> : <ul className="divide-y divide-neutral-100">{reminders.map((reminder) => <li key={reminder.id} className="space-y-1.5 py-2.5 text-sm">
        {editing === reminder.id ? <form className="space-y-2" onSubmit={(event) => submit(event,
          (data) => updateContactReminder(personId, reminder.id, String(data.get("title") ?? ""), String(data.get("due") ?? ""), editAudience.visibility, editAudience.recipients),
          "Reminder updated.", () => setEditing(null))}>
          <input className={input} name="title" aria-label="Reminder title" defaultValue={reminder.title} maxLength={160} required />
          <label className="grid gap-1 text-xs text-neutral-600">Due date<input className={input} type="date" name="due" defaultValue={reminder.dueOn} required /></label>
          <ContactAudience members={members} value={editAudience} onChange={setEditAudience} disabled={busy} />
          <div className="flex gap-2"><button className={button} disabled={busy}>Save</button>
            <button type="button" className={button} disabled={busy} onClick={() => setEditing(null)}>Cancel</button></div>
        </form> : <>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className={`break-words font-medium ${reminder.done ? "text-neutral-500 line-through" : ""}`}>{reminder.title}</p>
              <p className="text-xs text-neutral-600">{reminder.forLabel}</p>
              <p className={`text-xs ${reminder.overdue ? "font-semibold text-red-700" : "text-neutral-600"}`}>
                Due {reminder.dueOn}{reminder.overdue ? ` · ${COPY.overdue}` : ""}
              </p>
              <p className="text-xs text-neutral-500">{reminder.label}</p>
              {reminder.doneBy && <p className="text-xs text-neutral-600">{reminder.doneBy}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              {reminder.canComplete && <button type="button" className={button} disabled={busy}
                onClick={() => void run(() => completeContactReminder(personId, reminder.id), "Reminder completed.")}>Mark done</button>}
              {reminder.mine && <button type="button" className={button} disabled={busy}
                onClick={() => { setEditAudience({ visibility: reminder.visibility, recipients: reminder.included.filter((email) => members.some((member) => member.email === email)) }); setEditing(reminder.id); }}>Edit</button>}
              {reminder.mine && <button type="button" className={button} disabled={busy}
                onClick={() => { if (window.confirm("Remove this reminder?")) void run(() => removeContactReminder(personId, reminder.id), "Reminder removed."); }}>Remove</button>}
            </div>
          </div>
        </>}
      </li>)}</ul>}
    </>)}
    {panel === "Files" && (files == null ? <p className="text-sm text-neutral-600">Files are unavailable right now.</p> : <>
      <p className="text-xs text-neutral-600">Available to workspace members with Documents access. Up to 3 MB per file.</p>
      <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => submit(event, (data) => uploadContactFile(personId, data), "File uploaded.")}>
        <input type="file" name="file" aria-label="Contact file" className="min-w-0 max-w-full text-sm" required />
        <button className={button} disabled={busy}>Upload file</button>
      </form>
      {files.length === 0 ? <p className="text-sm text-neutral-500">No files attached.</p> : <ul className="divide-y divide-neutral-100">{files.map((file) => <li key={file.name} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
        <span className="min-w-0 break-all">{file.name.slice(37)}</span>
        <div className="flex gap-2">
          <button type="button" className={button} disabled={busy} onClick={() => void run(() => downloadContactFile(personId, file.name), "")}>Download</button>
          <button type="button" className={button} disabled={busy}
            onClick={() => { if (window.confirm("Permanently remove this file?")) void run(() => removeContactFile(personId, file.name), "File removed."); }}>Remove</button>
        </div>
      </li>)}</ul>}
    </>)}
  </section>;
}
