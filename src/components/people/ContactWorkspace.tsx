"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  completeContactReminder, createContactReminder, downloadContactFile,
  removeContactFile, removeContactNote, saveContactNote, uploadContactFile,
} from "@/lib/people/contact-workspace-actions";

type Note = { id: string; body: string; author: string; day: string; mine: boolean };
type Reminder = { id: string; title: string; due_at: string | null; status: string };
type ContactFile = { name: string };
type Result = Awaited<ReturnType<typeof saveContactNote>>;
const input = "w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm";
const button = "min-h-9 rounded-full border border-neutral-200 bg-white px-3 text-xs font-semibold text-cyan-900 hover:border-cyan-400 disabled:opacity-50";

export default function ContactWorkspace({ personId, notes, reminders, files }: {
  personId: string; notes: Note[] | null; reminders: Reminder[] | null; files?: ContactFile[] | null;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<"Notes" | "Reminders" | "Files">("Notes");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [message, setMessage] = useState<{ text: string; error: boolean }>();
  const tabs = files === undefined ? ["Notes", "Reminders"] as const : ["Notes", "Reminders", "Files"] as const;

  async function run(action: () => Promise<Result>, success: string, form?: HTMLFormElement) {
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

  function submit(event: FormEvent<HTMLFormElement>, action: (data: FormData) => Promise<Result>, success: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void run(() => action(data), success, form);
  }

  return <section aria-label="Contact workspace" className="vq-card-static space-y-3 rounded-[14px] bg-white p-4">
    <div className="flex flex-wrap gap-2" aria-label="Contact workspace sections">
      {tabs.map((tab) => <button key={tab} type="button" aria-pressed={panel === tab} disabled={busy}
        className={`${button} aria-pressed:border-cyan-200 aria-pressed:bg-cyan-50`}
        onClick={() => { setPanel(tab); setMessage(undefined); }}>{tab}</button>)}
    </div>
    {message && <p role={message.error ? "alert" : "status"} className={`text-sm ${message.error ? "text-red-700" : "text-neutral-700"}`}>{message.text}</p>}
    {panel === "Notes" && (notes === null ? <p className="text-sm text-neutral-600">Notes are unavailable right now.</p> : <>
      <p className="text-xs text-neutral-600">Notes are shared with active workspace members.</p>
      <form className="space-y-2" onSubmit={(event) => submit(event, (data) => saveContactNote(personId, String(data.get("note") ?? "")), "Note saved.")}>
        <textarea className={input} rows={3} name="note" aria-label="Contact note" placeholder="What should the team know?" maxLength={2000} required />
        <button className={button} disabled={busy}>Add note</button>
      </form>
      {notes.length === 0 ? <p className="text-sm text-neutral-500">No notes yet.</p> : <ul className="divide-y divide-neutral-100">{notes.map((note) => <li key={note.id} className="space-y-1 py-2.5 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-600">
          <span>{note.author} · {note.day}</span>
          {note.mine && <button type="button" className="min-h-8 text-red-700 underline" disabled={busy}
            onClick={() => { if (window.confirm("Remove this note?")) void run(() => removeContactNote(personId, note.id), "Note removed."); }}>Remove</button>}
        </div>
        <p className="whitespace-pre-wrap break-words">{note.body}</p>
      </li>)}</ul>}
    </>)}
    {panel === "Reminders" && (reminders === null ? <p className="text-sm text-neutral-600">Reminders are unavailable right now.</p> : <>
      <p className="text-xs text-neutral-600">Reminders are assigned to you and also appear in Tasks.</p>
      <form className="space-y-2" onSubmit={(event) => submit(event,
        (data) => createContactReminder(personId, String(data.get("title") ?? ""), String(data.get("due") ?? "")), "Reminder added to Tasks.")}>
        <input className={input} name="title" aria-label="Reminder title" placeholder="Follow up about…" maxLength={160} required />
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs text-neutral-600">Due date<input className={input} type="date" name="due" required /></label>
          <button className={button} disabled={busy}>Add reminder</button>
        </div>
      </form>
      {reminders.length === 0 ? <p className="text-sm text-neutral-500">No reminders yet.</p> : <ul className="divide-y divide-neutral-100">{reminders.map((reminder) => <li key={reminder.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
        <div><p className="break-words font-medium">{reminder.title}</p><p className="text-xs text-neutral-600">{reminder.due_at}</p></div>
        {reminder.status === "done" ? <span className="text-xs text-neutral-500">Completed</span>
          : <button type="button" className={button} disabled={busy} onClick={() => void run(() => completeContactReminder(personId, reminder.id), "Reminder completed.")}>Mark done</button>}
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
