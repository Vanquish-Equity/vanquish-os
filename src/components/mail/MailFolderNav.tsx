"use client";
import Link from "next/link";
import { MAIL_FOLDERS, type MailFolder } from "@/lib/google/mail-types";
type Props = {
  folder: MailFolder;
  labelId: string;
  labels: { id: string; name: string }[];
  newLabel: string;
  mutating: boolean;
  setNewLabel: (name: string) => void;
  onCreateLabel: () => void;
  onFolder: (folder: MailFolder, labelId?: string) => void;
};
export default function MailFolderNav({
  folder,
  labelId,
  labels,
  newLabel,
  mutating,
  setNewLabel,
  onCreateLabel,
  onFolder,
}: Props) {
  return (
    <nav
      aria-label="Mailbox folders"
      className="flex shrink-0 gap-1 overflow-x-auto border-b border-neutral-100 p-3 md:w-[170px] md:flex-col md:border-b-0 md:border-r"
    >
      {MAIL_FOLDERS.map((f) => (
        <button
          key={f.key}
          type="button"
          aria-current={folder === f.key && !labelId ? "page" : undefined}
          className={`whitespace-nowrap rounded-xl px-3 py-2.5 text-left text-[12px] font-medium ${folder === f.key && !labelId ? "bg-cyan-50 text-cyan-900" : "text-neutral-500 hover:bg-neutral-50"}`}
          onClick={() => onFolder(f.key)}
        >
          {f.label}
        </button>
      ))}
      <div className="hidden border-t border-neutral-100 pt-3 md:block">
        <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
          Labels
        </p>
        {labels.map((label) => (
          <button
            key={label.id}
            type="button"
            onClick={() => onFolder("all", label.id)}
            className={`block w-full truncate rounded-xl px-3 py-2 text-left text-[12px] ${labelId === label.id ? "bg-cyan-50 text-cyan-900" : "text-neutral-500 hover:bg-neutral-50"}`}
          >
            {label.name}
          </button>
        ))}
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          aria-label="New label name"
          placeholder="New label…"
          className="mt-2 w-full rounded-xl border border-neutral-200 px-2 py-1.5 text-[11px]"
        />
        <button
          type="button"
          disabled={!newLabel.trim() || mutating}
          className="mt-1 px-2 text-[11px] text-cyan-800 disabled:opacity-40"
          onClick={() => void onCreateLabel()}
        >
          Create label
        </button>
      </div>
      <Link
        href="/communications?folder=drafts"
        className="whitespace-nowrap rounded-xl px-3 py-2.5 text-[12px] font-medium text-neutral-500 hover:bg-neutral-50"
      >
        CRM drafts
      </Link>
      <Link
        href="/calendar"
        className="rounded-xl px-3 py-2.5 text-[12px] font-medium text-cyan-800"
      >
        Calendar ↗
      </Link>
    </nav>
  );
}
