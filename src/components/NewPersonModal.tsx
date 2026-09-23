"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPersonAction } from "@/lib/people/actions";
import SelectMenu, { type SelectMenuOption } from "@/components/SelectMenu";

type Option = { id: string; name: string };

type FormValues = {
  name: string;
  title: string;
  companyId: string;
  linkedinUrl: string;
  email: string;
};

const emptyForm: FormValues = {
  name: "",
  title: "",
  companyId: "",
  linkedinUrl: "",
  email: "",
};

function toMenuOptions(options: Option[]): SelectMenuOption[] {
  return options.map((option) => ({ value: option.id, label: option.name }));
}

export default function NewPersonModal({ companies }: { companies: Option[] }) {
  const router = useRouter();
  const firstInputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<FormValues>(emptyForm);
  const [nameError, setNameError] = useState<string | null>(null);
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
    setValues(emptyForm);
    setNameError(null);
    setServerError(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!values.name.trim()) {
      setNameError("Name is required.");
      return;
    }

    setPending(true);
    setServerError(null);

    const result = await createPersonAction({
      name: values.name,
      title: values.title,
      companyId: values.companyId || null,
      linkedinUrl: values.linkedinUrl,
      email: values.email,
    });

    setPending(false);

    if (!result.ok) {
      setServerError(result.message);
      return;
    }

    setOpen(false);
    setValues(emptyForm);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full bg-ink px-3.5 py-2 text-[12px] font-semibold text-white transition hover:bg-neutral-800"
      >
        New Person
      </button>

      {open && (
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
            aria-labelledby="new-person-title"
            className="vq-card-static max-h-[92vh] w-full max-w-[460px] overflow-y-auto rounded-[14px] bg-white p-5 shadow-xl"
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <h2
                id="new-person-title"
                className="font-[family-name:var(--font-display)] text-[18px] font-semibold text-ink"
              >
                New Person
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
                  Name
                </label>
                <input
                  ref={firstInputRef}
                  value={values.name}
                  onChange={(e) => {
                    setValues((v) => ({ ...v, name: e.target.value }));
                    setNameError(null);
                  }}
                  className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-[12.5px] text-ink outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
                />
                {nameError && <p className="mt-1 text-xs text-red-600">{nameError}</p>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
                    Title
                  </label>
                  <input
                    value={values.title}
                    onChange={(e) => setValues((v) => ({ ...v, title: e.target.value }))}
                    className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-[12.5px] text-ink outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
                    Company
                  </label>
                  <SelectMenu
                    value={values.companyId}
                    onChange={(value) => setValues((v) => ({ ...v, companyId: value }))}
                    options={toMenuOptions(companies)}
                    placeholder="None"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
                  Email
                </label>
                <input
                  type="email"
                  value={values.email}
                  onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))}
                  className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-[12.5px] text-ink outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
                />
              </div>

              <div>
                <label className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
                  LinkedIn URL
                </label>
                <input
                  value={values.linkedinUrl}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, linkedinUrl: e.target.value }))
                  }
                  className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-[12.5px] text-ink outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
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
                  {pending ? "Creating..." : "Create Person"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
