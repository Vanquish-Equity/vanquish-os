"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { createTaskAction } from "@/lib/tasks/actions";
import SelectMenu, { type SelectMenuOption } from "@/components/SelectMenu";

type Option = { id: string; name: string };

type FormValues = {
  title: string;
  companyId: string;
  dealId: string;
  owner: string;
  dueAt: string;
  priorityId: string;
};

const emptyForm: FormValues = {
  title: "",
  companyId: "",
  dealId: "",
  owner: "",
  dueAt: "",
  priorityId: "",
};

function toMenuOptions(options: Option[]): SelectMenuOption[] {
  return options.map((option) => ({ value: option.id, label: option.name }));
}

export type TaskLinkContext = {
  companyId: string;
  companyName: string;
  dealId: string;
  dealName: string;
};

export default function NewTaskModal({
  companies,
  deals,
  priorities,
  link,
  buttonLabel = "New Task",
}: {
  companies: Option[];
  deals: { id: string; name: string; company_id: string }[];
  priorities: Option[];
  // When set, the task is always created for this company and deal.
  link?: TaskLinkContext;
  buttonLabel?: string;
}) {
  const router = useRouter();
  const firstInputRef = useRef<HTMLInputElement | null>(null);
  const initialForm: FormValues = link
    ? { ...emptyForm, companyId: link.companyId, dealId: link.dealId }
    : emptyForm;
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<FormValues>(initialForm);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => firstInputRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  function closeModal() {
    if (pending) return;
    setOpen(false);
    setValues(initialForm);
    setTitleError(null);
    setServerError(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!values.title.trim()) {
      setTitleError("Title is required.");
      return;
    }

    setPending(true);
    setServerError(null);

    const result = await createTaskAction({
      title: values.title,
      companyId: values.companyId || null,
      dealId: values.dealId || null,
      owner: values.owner,
      dueAt: values.dueAt || null,
      priorityId: values.priorityId || null,
    });

    setPending(false);

    if (!result.ok) {
      setServerError(result.message);
      return;
    }

    setOpen(false);
    setValues(initialForm);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full bg-ink px-3.5 py-2 text-[12px] font-semibold text-white transition hover:bg-neutral-800"
      >
        {buttonLabel}
      </button>

      {open && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 px-4 py-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeModal();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              closeModal();
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-task-title"
            className="vq-card-static max-h-[92vh] w-full max-w-[460px] overflow-y-auto rounded-[14px] bg-white p-5 shadow-xl"
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <h2
                id="new-task-title"
                className="font-[family-name:var(--font-display)] text-[18px] font-semibold text-ink"
              >
                New Task
              </h2>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-full border border-neutral-100 px-2.5 py-1 text-[12px] font-semibold text-neutral-500 transition hover:border-neutral-200 hover:text-ink"
                disabled={pending}
              >
                Close
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
              <div>
                <label className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
                  Title
                </label>
                <input
                  ref={firstInputRef}
                  value={values.title}
                  onChange={(e) => {
                    setValues((v) => ({ ...v, title: e.target.value }));
                    setTitleError(null);
                  }}
                  className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-[12.5px] text-ink outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
                />
                {titleError && <p className="mt-1 text-xs text-red-600">{titleError}</p>}
              </div>

              {link ? (
                <div className="rounded-xl bg-[#f7f9fa] px-3 py-2 text-[12px] text-neutral-600">
                  <div className="text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
                    Linked to
                  </div>
                  <div className="mt-0.5 font-semibold text-ink">
                    {link.companyName} / {link.dealName}
                  </div>
                </div>
              ) : (
              <>
              <div>
                <label className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
                  Company (optional)
                </label>
                <SelectMenu
                  value={values.companyId}
                  onChange={(value) => setValues((v) => ({ ...v, companyId: value, dealId: "" }))}
                  options={toMenuOptions(companies)}
                  placeholder="No company"
                />
              </div>

              {values.companyId && (
                <div>
                  <label className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
                    Deal (optional)
                  </label>
                  <SelectMenu value={values.dealId}
                    onChange={(value) => setValues((v) => ({ ...v, dealId: value }))}
                    options={toMenuOptions(deals.filter((deal) => deal.company_id === values.companyId))}
                    placeholder="No deal" />
                </div>
              )}
              </>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
                    Owner
                  </label>
                  <input
                    value={values.owner}
                    onChange={(e) => setValues((v) => ({ ...v, owner: e.target.value }))}
                    className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-[12.5px] text-ink outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
                    Due date
                  </label>
                  <input
                    type="date"
                    value={values.dueAt}
                    onChange={(e) => setValues((v) => ({ ...v, dueAt: e.target.value }))}
                    className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-[12.5px] text-ink outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
                  Priority
                </label>
                <SelectMenu
                  value={values.priorityId}
                  onChange={(value) => setValues((v) => ({ ...v, priorityId: value }))}
                  options={toMenuOptions(priorities)}
                  placeholder="No priority"
                />
              </div>

              {serverError && (
                <p className="text-xs text-red-600" role="alert">
                  {serverError}
                </p>
              )}

              <div className="mt-1 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-full border border-neutral-100 px-3.5 py-2 text-[12px] font-semibold text-neutral-600 transition hover:border-neutral-200 hover:text-ink"
                  disabled={pending}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-full bg-ink px-3.5 py-2 text-[12px] font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={pending}
                >
                  {pending ? "Creating..." : "Create Task"}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
