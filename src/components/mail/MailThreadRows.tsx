"use client";
import Link from "next/link";
import Checkbox from "@/components/Checkbox";
import { button, dateLabel, sender } from "./mail-ui";
import type {
  MailFolder,
  MailOperation,
  MailPage,
} from "@/lib/google/mail-types";
type Props = {
  loading: boolean;
  error: string;
  page: MailPage | null;
  selected: string[];
  folder: MailFolder;
  mutating: boolean;
  setSelected: React.Dispatch<React.SetStateAction<string[]>>;
  openThread: (id: string) => void;
  operate: (operation: MailOperation, ids: string[]) => Promise<void>;
};
export default function MailThreadRows({
  loading,
  error,
  page,
  selected,
  folder,
  mutating,
  setSelected,
  openThread,
  operate,
}: Props) {
  return loading ? (
    <div role="status" className="space-y-3 p-5">
      <span className="sr-only">Loading Gmail…</span>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="h-10 animate-pulse rounded-lg bg-neutral-50" />
      ))}
    </div>
  ) : error ? (
    <div className="p-10 text-center">
      <p role="alert" className="mb-3 text-sm text-neutral-500">
        {error}
      </p>
      <Link href="/settings#settings-connections" className={button}>
        Review Google connection
      </Link>
    </div>
  ) : !page?.threads.length ? (
    <p className="py-24 text-center text-sm text-neutral-400">
      No conversations match this view.
    </p>
  ) : (
    <div>
      {page.threads.map((t) => (
        <div
          key={t.id}
          className={`flex items-center gap-3 border-b border-neutral-100 px-4 py-3 transition hover:bg-cyan-50/40 ${t.unread ? "bg-white" : "bg-neutral-50/60"}`}
        >
          <Checkbox
            aria-label={`Select ${t.subject}`}
            checked={selected.includes(t.id)}
            onChange={(e) =>
              setSelected((v) =>
                e.target.checked ? [...v, t.id] : v.filter((id) => id !== t.id),
              )
            }
          />
          <button
            type="button"
            className={`text-lg ${t.starred ? "text-amber-500" : "text-neutral-300"}`}
            aria-label={t.starred ? "Remove star" : "Star conversation"}
            disabled={mutating}
            onClick={() => void operate(t.starred ? "unstar" : "star", [t.id])}
          >
            {t.starred ? "★" : "☆"}
          </button>
          <button
            type="button"
            onClick={() => openThread(t.id)}
            className="flex min-w-0 flex-1 flex-col gap-1 text-left lg:flex-row lg:items-center lg:gap-4"
          >
            <span
              className={`w-full truncate text-[12px] lg:w-[150px] lg:shrink-0 ${t.unread ? "font-semibold text-ink" : "text-neutral-500"}`}
            >
              {sender(folder === "sent" ? t.to : t.from)}{" "}
              {t.count > 1 && (
                <span className="font-normal text-neutral-400">
                  ({t.count})
                </span>
              )}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12px]">
              <span
                className={
                  t.unread ? "font-semibold text-ink" : "text-neutral-600"
                }
              >
                {t.subject}
              </span>
              <span className="ml-2 text-neutral-400">— {t.snippet}</span>
            </span>
          </button>
          {t.hasAttachments && (
            <span aria-label="Has attachments" className="text-neutral-400">
              ⌁
            </span>
          )}
          <span
            className={`shrink-0 text-[11px] ${t.unread ? "font-semibold text-ink" : "text-neutral-400"}`}
          >
            {dateLabel(t.date)}
          </span>
        </div>
      ))}
    </div>
  );
}
