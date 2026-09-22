"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createDealAction, type CreateDealInput } from "@/lib/deals/actions";
import SelectMenu, { type SelectMenuOption } from "@/components/SelectMenu";

type Option = {
  id: string;
  name: string;
};

type FormErrors = Partial<Record<keyof CreateDealInput, string>>;

const NEW_CATEGORY_VALUE = "__new_category__";

const emptyForm: CreateDealInput = {
  companyName: "",
  industryId: "",
  newIndustryName: "",
  dealName: "",
  stageId: "",
  priorityId: "",
  owner: "",
  potentialInvestment: "",
};

function buildInitialForm(stages: Option[]): CreateDealInput {
  return {
    ...emptyForm,
    stageId: stages[0]?.id ?? "",
  };
}

function validateForm(values: CreateDealInput) {
  const errors: FormErrors = {};
  const creatingCategory = values.industryId === NEW_CATEGORY_VALUE;

  if (!values.companyName.trim()) errors.companyName = "Company name is required.";
  if (!values.industryId) errors.industryId = "Choose a category.";
  if (creatingCategory && !values.newIndustryName.trim()) {
    errors.newIndustryName = "New category name is required.";
  }
  if (!values.dealName.trim()) errors.dealName = "Deal name is required.";
  if (!values.stageId) errors.stageId = "Choose a stage.";
  if (!values.priorityId) errors.priorityId = "Choose a priority.";
  if (!values.owner.trim()) errors.owner = "Owner is required.";

  if (values.potentialInvestment.trim()) {
    const amount = Number(values.potentialInvestment);
    if (!Number.isFinite(amount) || amount < 0) {
      errors.potentialInvestment = "Enter a valid non-negative amount.";
    }
  }

  return errors;
}

function fieldId(name: keyof CreateDealInput) {
  return `new-deal-${name}`;
}

function toMenuOptions(options: Option[]): SelectMenuOption[] {
  return options.map((option) => ({
    value: option.id,
    label: option.name,
  }));
}

export default function NewDealModal({
  industries,
  stages,
  priorities,
}: {
  industries: Option[];
  stages: Option[];
  priorities: Option[];
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const firstInputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(() => buildInitialForm(stages));
  const [dealNameTouched, setDealNameTouched] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const categoryOptions = [
    ...toMenuOptions(industries),
    { value: NEW_CATEGORY_VALUE, label: "Create new category" },
  ];
  const stageOptions = toMenuOptions(stages);
  const priorityOptions = toMenuOptions(priorities);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => firstInputRef.current?.focus(), 0);

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  function resetForm() {
    setValues(buildInitialForm(stages));
    setDealNameTouched(false);
    setErrors({});
    setServerError(null);
  }

  function closeModal() {
    if (pending) return;
    setOpen(false);
    resetForm();
  }

  function updateValue(name: keyof CreateDealInput, value: string) {
    setValues((current) => {
      if (name === "companyName" && !dealNameTouched) {
        const companyName = value.trim();
        return {
          ...current,
          companyName: value,
          dealName: companyName ? `${companyName} — new deal` : "",
        };
      }

      if (name === "industryId" && value !== NEW_CATEGORY_VALUE) {
        return { ...current, industryId: value, newIndustryName: "" };
      }

      return { ...current, [name]: value };
    });

    setErrors((current) => ({ ...current, [name]: undefined }));
    setServerError(null);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeModal();
      return;
    }

    if (event.key !== "Tab" || !dialogRef.current) return;

    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );

    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors = validateForm(values);
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) return;

    setPending(true);
    setServerError(null);

    const result = await createDealAction(values);

    setPending(false);

    if (!result.ok) {
      setServerError(result.message);
      setErrors((current) => ({ ...current, ...result.fieldErrors }));
      return;
    }

    setOpen(false);
    resetForm();
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full bg-ink px-3.5 py-2 text-[12px] font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={stages.length === 0}
      >
        New Deal
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 px-4 py-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeModal();
          }}
          onKeyDown={handleKeyDown}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-deal-title"
            className="max-h-[92vh] w-full max-w-[540px] overflow-y-auto rounded-[14px] border border-neutral-100 bg-white p-5 shadow-xl"
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2
                  id="new-deal-title"
                  className="font-[family-name:var(--font-display)] text-[18px] font-semibold text-ink"
                >
                  New Deal
                </h2>
              </div>
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
                <label
                  htmlFor={fieldId("companyName")}
                  className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400"
                >
                  Company name
                </label>
                <input
                  ref={firstInputRef}
                  id={fieldId("companyName")}
                  value={values.companyName}
                  onChange={(event) => updateValue("companyName", event.target.value)}
                  className="w-full rounded-xl border border-neutral-100 bg-white px-3 py-2 text-[12.5px] text-ink outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
                />
                {errors.companyName && (
                  <p className="mt-1 text-xs text-red-600">{errors.companyName}</p>
                )}
              </div>

              <div>
                <label
                  htmlFor={fieldId("industryId")}
                  className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400"
                >
                  Category
                </label>
                <SelectMenu
                  id={fieldId("industryId")}
                  value={values.industryId}
                  onChange={(value) => updateValue("industryId", value)}
                  options={categoryOptions}
                  placeholder="Choose category"
                />
                {errors.industryId && (
                  <p className="mt-1 text-xs text-red-600">{errors.industryId}</p>
                )}
              </div>

              {values.industryId === NEW_CATEGORY_VALUE && (
                <div>
                  <label
                    htmlFor={fieldId("newIndustryName")}
                    className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400"
                  >
                    New category
                  </label>
                  <input
                    id={fieldId("newIndustryName")}
                    value={values.newIndustryName}
                    onChange={(event) =>
                      updateValue("newIndustryName", event.target.value)
                    }
                    className="w-full rounded-xl border border-neutral-100 bg-white px-3 py-2 text-[12.5px] text-ink outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
                  />
                  {errors.newIndustryName && (
                    <p className="mt-1 text-xs text-red-600">
                      {errors.newIndustryName}
                    </p>
                  )}
                </div>
              )}

              <div>
                <label
                  htmlFor={fieldId("dealName")}
                  className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400"
                >
                  Deal name
                </label>
                <input
                  id={fieldId("dealName")}
                  value={values.dealName}
                  onChange={(event) => {
                    setDealNameTouched(true);
                    updateValue("dealName", event.target.value);
                  }}
                  className="w-full rounded-xl border border-neutral-100 bg-white px-3 py-2 text-[12.5px] text-ink outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
                />
                {errors.dealName && (
                  <p className="mt-1 text-xs text-red-600">{errors.dealName}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor={fieldId("stageId")}
                    className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400"
                  >
                    Stage
                  </label>
                  <SelectMenu
                    id={fieldId("stageId")}
                    value={values.stageId}
                    onChange={(value) => updateValue("stageId", value)}
                    options={stageOptions}
                    placeholder="Choose stage"
                  />
                  {errors.stageId && (
                    <p className="mt-1 text-xs text-red-600">{errors.stageId}</p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor={fieldId("priorityId")}
                    className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400"
                  >
                    Priority
                  </label>
                  <SelectMenu
                    id={fieldId("priorityId")}
                    value={values.priorityId}
                    onChange={(value) => updateValue("priorityId", value)}
                    options={priorityOptions}
                    placeholder="Choose priority"
                  />
                  {errors.priorityId && (
                    <p className="mt-1 text-xs text-red-600">{errors.priorityId}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor={fieldId("owner")}
                    className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400"
                  >
                    Owner
                  </label>
                  <input
                    id={fieldId("owner")}
                    value={values.owner}
                    onChange={(event) => updateValue("owner", event.target.value)}
                    className="w-full rounded-xl border border-neutral-100 bg-white px-3 py-2 text-[12.5px] text-ink outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
                  />
                  {errors.owner && (
                    <p className="mt-1 text-xs text-red-600">{errors.owner}</p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor={fieldId("potentialInvestment")}
                    className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400"
                  >
                    Potential investment
                  </label>
                  <input
                    id={fieldId("potentialInvestment")}
                    type="number"
                    min="0"
                    step="1"
                    value={values.potentialInvestment}
                    onChange={(event) =>
                      updateValue("potentialInvestment", event.target.value)
                    }
                    className="w-full rounded-xl border border-neutral-100 bg-white px-3 py-2 text-[12.5px] text-ink outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
                  />
                  {errors.potentialInvestment && (
                    <p className="mt-1 text-xs text-red-600">
                      {errors.potentialInvestment}
                    </p>
                  )}
                </div>
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
                  {pending ? "Creating..." : "Create Deal"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
