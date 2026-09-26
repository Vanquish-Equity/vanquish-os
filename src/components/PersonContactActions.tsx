"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { setPotentialLpAction, updateContactAction } from "@/lib/people/actions";

const inputClass =
  "w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-[12.5px] text-ink outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100";
const labelClass = "mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400";

// Potential LP toggle and "Edit" (name + primary email) for one row of People.
export default function PersonContactActions({
  personId,
  name,
  email,
  isPotentialLp,
}: {
  personId: string;
  name: string;
  email: string | null;
  isPotentialLp: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  function toggleLp() {
    setError(null);
    startTransition(async () => {
      const result = await setPotentialLpAction({ personId, value: !isPotentialLp });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={toggleLp}
          disabled={isPending}
          aria-pressed={isPotentialLp}
          title={isPotentialLp ? "Unmark as potential LP" : "Mark as potential LP"}
          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition disabled:opacity-50 ${
            isPotentialLp
              ? "bg-cyan-50 text-cyan-800 ring-1 ring-cyan-200 hover:bg-cyan-100"
              : "border border-neutral-200 text-neutral-500 hover:border-cyan-300 hover:text-cyan-800"
          }`}
        >
          {isPotentialLp ? "Potential LP ✓" : "Mark potential LP"}
        </button>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setEditing(true);
          }}
          className="rounded-full border border-neutral-200 px-2.5 py-1 text-[11px] font-semibold text-neutral-600 transition hover:border-cyan-300 hover:text-cyan-800"
        >
          Edit
        </button>
      </div>
      {error && (
        <p role="alert" className="max-w-[260px] text-right text-[11px] text-red-600">
          {error}
        </p>
      )}
      {editing && (
        <EditContactDialog
          personId={personId}
          name={name}
          email={email}
          isPotentialLp={isPotentialLp}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}

function EditContactDialog({
  personId,
  name,
  email,
  isPotentialLp,
  onClose,
}: {
  personId: string;
  name: string;
  email: string | null;
  isPotentialLp: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const firstInputRef = useRef<HTMLInputElement | null>(null);
  const [values, setValues] = useState({ name, email: email ?? "" });
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => firstInputRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const emailChanged = (email ?? "").toLowerCase() !== values.email.trim().toLowerCase();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await updateContactAction({ personId, name: values.name, email: values.email });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onClose();
      router.refresh();
    });
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 px-4 py-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isPending) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !isPending) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`edit-contact-${personId}`}
        className="vq-card-static w-full max-w-[420px] rounded-[14px] bg-white p-5 text-left shadow-xl"
      >
        <h2
          id={`edit-contact-${personId}`}
          className="mb-4 font-[family-name:var(--font-display)] text-[18px] font-semibold text-ink"
        >
          Edit contact
        </h2>
        <form onSubmit={submit} className="flex flex-col gap-3.5">
          <div>
            <label htmlFor={`contact-name-${personId}`} className={labelClass}>
              Name
            </label>
            <input
              id={`contact-name-${personId}`}
              ref={firstInputRef}
              value={values.name}
              onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor={`contact-email-${personId}`} className={labelClass}>
              Email
            </label>
            <input
              id={`contact-email-${personId}`}
              type="email"
              value={values.email}
              onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))}
              className={inputClass}
            />
            {emailChanged && email && (
              <p className="mt-1 text-[11px] text-amber-700">
                Email drafts that already include this contact will ask for a review of the new address.
              </p>
            )}
            {isPotentialLp && !values.email.trim() && (
              <p className="mt-1 text-[11px] text-neutral-500">A potential LP needs an email.</p>
            )}
          </div>
          {error && (
            <p role="alert" className="text-xs text-red-600">
              {error}
            </p>
          )}
          <div className="mt-1 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="rounded-full border border-neutral-100 px-3.5 py-2 text-[12px] font-semibold text-neutral-600 transition hover:border-neutral-200 hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending || !values.name.trim()}
              className="rounded-full bg-ink px-3.5 py-2 text-[12px] font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? "Saving..." : "Save contact"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
