"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { createDealAction, type CreateDealInput } from "@/lib/deals/actions";
import { dealHref } from "@/lib/deals/scope";
import { findCompanyMatches } from "@/lib/companies/matching";
import SelectMenu, { type SelectMenuOption } from "@/components/SelectMenu";

type Option = {
  id: string;
  name: string;
};

export type NewDealCompanyOption = {
  id: string;
  name: string;
  aliases?: string[];
};

type FormErrors = Partial<Record<keyof CreateDealInput, string>>;

const NEW_CATEGORY_VALUE = "__new_category__";

const emptyForm: CreateDealInput = {
  companyMode: "existing",
  companyId: "",
  companyName: "",
  industryId: "",
  newIndustryName: "",
  dealName: "",
  round: "",
  stageId: "",
  priorityId: "",
  owner: "",
  potentialInvestment: "",
};

const inputClass =
  "w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-[12.5px] text-ink outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100";
const labelClass =
  "mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400";

function buildInitialForm(stages: Option[], fixedCompany?: Option): CreateDealInput {
  return {
    ...emptyForm,
    companyId: fixedCompany?.id ?? "",
    stageId: stages[0]?.id ?? "",
  };
}

function validateForm(values: CreateDealInput) {
  const errors: FormErrors = {};

  if (values.companyMode === "new") {
    if (!values.companyName.trim()) errors.companyName = "Company name is required.";
    if (!values.industryId) errors.industryId = "Choose a category.";
    if (values.industryId === NEW_CATEGORY_VALUE && !values.newIndustryName.trim()) {
      errors.newIndustryName = "New category name is required.";
    }
  } else if (!values.companyId) {
    errors.companyId = "Choose a company or create a new one.";
  }
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

function fieldId(name: keyof CreateDealInput | "companySearch") {
  return `new-deal-${name}`;
}

function toMenuOptions(options: Option[]): SelectMenuOption[] {
  return options.map((option) => ({
    value: option.id,
    label: option.name,
  }));
}

function FieldError({ message }: { message?: string }) {
  return message ? <p className="mt-1 text-xs text-red-600">{message}</p> : null;
}

export default function NewDealModal({
  industries,
  stages,
  priorities,
  companies = [],
  fixedCompany,
}: {
  industries: Option[];
  stages: Option[];
  priorities: Option[];
  // Existing companies to search when no company is fixed.
  companies?: NewDealCompanyOption[];
  // Creates the deal for this company without asking for it again.
  fixedCompany?: Option;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const firstInputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(() => buildInitialForm(stages, fixedCompany));
  const [query, setQuery] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const categoryOptions = [
    ...toMenuOptions(industries),
    { value: NEW_CATEGORY_VALUE, label: "Create new category" },
  ];
  const stageOptions = toMenuOptions(stages);
  const priorityOptions = toMenuOptions(priorities);
  const creatingCompany = !fixedCompany && values.companyMode === "new";
  const selectedCompany = fixedCompany
    ? fixedCompany
    : companies.find((company) => company.id === values.companyId) ?? null;
  const searchMatches = useMemo(
    () => findCompanyMatches(companies, query),
    [companies, query]
  );
  const newNameMatches = useMemo(
    () => (creatingCompany ? findCompanyMatches(companies, values.companyName, 4) : []),
    [companies, creatingCompany, values.companyName]
  );
  const exactNewNameMatch = newNameMatches.find((match) => match.exact);
  const exactSearchMatch = searchMatches.find((match) => match.exact);
  const companyNameForDeal = creatingCompany
    ? values.companyName.trim()
    : selectedCompany?.name ?? "";

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
    setValues(buildInitialForm(stages, fixedCompany));
    setQuery("");
    setErrors({});
    setServerError(null);
  }

  function closeModal() {
    if (pending) return;
    setOpen(false);
    resetForm();
  }

  function updateValue<K extends keyof CreateDealInput>(name: K, value: CreateDealInput[K]) {
    setValues((current) => {
      if (name === "industryId" && value !== NEW_CATEGORY_VALUE) {
        return { ...current, industryId: value as string, newIndustryName: "" };
      }
      return { ...current, [name]: value };
    });

    setErrors((current) => ({ ...current, [name]: undefined }));
    setServerError(null);
  }

  function selectCompany(companyId: string) {
    setValues((current) => ({
      ...current,
      companyMode: "existing",
      companyId,
      companyName: "",
      industryId: "",
      newIndustryName: "",
    }));
    setErrors((current) => ({ ...current, companyId: undefined, companyName: undefined }));
    setServerError(null);
  }

  function startNewCompany() {
    setValues((current) => ({
      ...current,
      companyMode: "new",
      companyId: "",
      companyName: query.trim(),
    }));
    setErrors((current) => ({ ...current, companyId: undefined }));
    setServerError(null);
  }

  function backToSearch() {
    setQuery(values.companyName || query);
    setValues((current) => ({
      ...current,
      companyMode: "existing",
      companyId: "",
      companyName: "",
      industryId: "",
      newIndustryName: "",
    }));
    setErrors({});
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
    if (creatingCompany && exactNewNameMatch) {
      nextErrors.companyName = `${exactNewNameMatch.company.name} already exists. Select it instead.`;
    }
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
    if (fixedCompany && result.companyId && result.dealId) {
      router.push(dealHref(result.companyId, result.dealId));
    }
    router.refresh();
  }

  function renderCompanyStep() {
    if (fixedCompany) {
      return (
        <div className="rounded-xl bg-[#f7f9fa] px-3 py-2 text-[12px] text-neutral-600">
          <div className="text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
            Company
          </div>
          <div className="mt-0.5 font-semibold text-ink">{fixedCompany.name}</div>
        </div>
      );
    }

    if (selectedCompany && !creatingCompany) {
      return (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-[#f7f9fa] px-3 py-2 text-[12px] text-neutral-600">
          <div className="min-w-0">
            <div className="text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
              Existing company
            </div>
            <div className="mt-0.5 truncate font-semibold text-ink">{selectedCompany.name}</div>
          </div>
          <button
            type="button"
            onClick={() => {
              setQuery(selectedCompany.name);
              updateValue("companyId", "");
            }}
            className="flex-shrink-0 text-[11.5px] font-semibold text-cyan-700 hover:text-cyan-800"
          >
            Change
          </button>
        </div>
      );
    }

    if (creatingCompany) {
      return (
        <div className="flex flex-col gap-3 rounded-xl border border-neutral-100 p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
              New company and its first deal
            </span>
            <button
              type="button"
              onClick={backToSearch}
              className="text-[11.5px] font-semibold text-cyan-700 hover:text-cyan-800"
            >
              Back to search
            </button>
          </div>
          <div>
            <label htmlFor={fieldId("companyName")} className={labelClass}>
              Company name
            </label>
            <input
              ref={firstInputRef}
              autoFocus
              id={fieldId("companyName")}
              value={values.companyName}
              onChange={(event) => updateValue("companyName", event.target.value)}
              className={inputClass}
            />
            <FieldError message={errors.companyName} />
          </div>
          {newNameMatches.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12px]">
              <p className="font-medium text-amber-900">
                {exactNewNameMatch
                  ? "This company already exists. Select it instead of creating a duplicate."
                  : "Similar companies already exist. Select one if this deal belongs to it."}
              </p>
              <div className="mt-2 flex flex-col gap-1.5">
                {newNameMatches.map((match) => (
                  <button
                    key={match.company.id}
                    type="button"
                    onClick={() => selectCompany(match.company.id)}
                    className="flex items-center justify-between gap-2 rounded-lg bg-white px-2.5 py-1.5 text-left font-semibold text-ink transition hover:text-cyan-800"
                  >
                    <span className="truncate">{match.company.name}</span>
                    <span className="flex-shrink-0 text-[11px] text-cyan-700">Use this company</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <label htmlFor={fieldId("industryId")} className={labelClass}>
              Category
            </label>
            <SelectMenu
              id={fieldId("industryId")}
              value={values.industryId}
              onChange={(value) => updateValue("industryId", value)}
              options={categoryOptions}
              placeholder="Choose category"
            />
            <FieldError message={errors.industryId} />
          </div>
          {values.industryId === NEW_CATEGORY_VALUE && (
            <div>
              <label htmlFor={fieldId("newIndustryName")} className={labelClass}>
                New category
              </label>
              <input
                id={fieldId("newIndustryName")}
                value={values.newIndustryName}
                onChange={(event) => updateValue("newIndustryName", event.target.value)}
                className={inputClass}
              />
              <FieldError message={errors.newIndustryName} />
            </div>
          )}
        </div>
      );
    }

    return (
      <div>
        <label htmlFor={fieldId("companySearch")} className={labelClass}>
          Company
        </label>
        <input
          ref={firstInputRef}
          id={fieldId("companySearch")}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setErrors((current) => ({ ...current, companyId: undefined }));
          }}
          placeholder="Search existing companies"
          autoComplete="off"
          className={inputClass}
        />
        <FieldError message={errors.companyId} />
        {!query.trim() && (
          <p className="mt-1.5 px-1 text-[11.5px] text-neutral-400">
            Type the company name to search existing companies or create a new one.
          </p>
        )}
        {query.trim() && (
          <div className="mt-2 flex flex-col gap-1.5" role="listbox" aria-label="Matching companies">
            {searchMatches.length === 0 && (
              <p className="px-1 text-[12px] text-neutral-400">No existing company matches.</p>
            )}
            {searchMatches.map((match) => (
              <button
                key={match.company.id}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => selectCompany(match.company.id)}
                className="flex items-center justify-between gap-2 rounded-xl border border-neutral-100 px-3 py-2 text-left text-[12.5px] font-semibold text-ink transition hover:border-cyan-300 hover:text-cyan-800"
              >
                <span className="truncate">{match.company.name}</span>
                <span className="flex-shrink-0 text-[11px] font-semibold text-cyan-700">
                  {match.exact ? "Same name · Select" : "Select"}
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="mt-3 border-t border-neutral-100 pt-3">
          <button
            type="button"
            onClick={startNewCompany}
            disabled={Boolean(exactSearchMatch)}
            className="text-[12px] font-semibold text-neutral-600 transition hover:text-cyan-800 disabled:cursor-not-allowed disabled:text-neutral-300"
          >
            + Create new company{query.trim() ? ` “${query.trim()}”` : ""} and its first deal
          </button>
          {exactSearchMatch && (
            <p className="mt-1 text-[11px] text-neutral-400">
              {exactSearchMatch.company.name} already exists. Select it above.
            </p>
          )}
        </div>
      </div>
    );
  }

  const companyReady = Boolean(fixedCompany || creatingCompany || selectedCompany);

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

      {open &&
        createPortal(
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
              className="vq-card-static max-h-[92vh] w-full max-w-[540px] overflow-y-auto rounded-[14px] bg-white p-5 shadow-xl"
            >
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h2
                    id="new-deal-title"
                    className="font-[family-name:var(--font-display)] text-[18px] font-semibold text-ink"
                  >
                    New Deal
                  </h2>
                  <p className="mt-0.5 text-[12px] text-neutral-500">
                    A deal is one opportunity or evaluation for a company.
                  </p>
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
                {renderCompanyStep()}

                {companyReady && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label htmlFor={fieldId("dealName")} className={labelClass}>
                          Deal name
                        </label>
                        <input
                          ref={fixedCompany || selectedCompany ? firstInputRef : undefined}
                          id={fieldId("dealName")}
                          value={values.dealName}
                          onChange={(event) => updateValue("dealName", event.target.value)}
                          placeholder={companyNameForDeal || "Deal name"}
                          className={inputClass}
                        />
                        <FieldError message={errors.dealName} />
                      </div>
                      <div>
                        <label htmlFor={fieldId("round")} className={labelClass}>
                          Round (optional)
                        </label>
                        <input
                          id={fieldId("round")}
                          value={values.round}
                          onChange={(event) => updateValue("round", event.target.value)}
                          placeholder="Only if known, e.g. Seed"
                          className={inputClass}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label htmlFor={fieldId("stageId")} className={labelClass}>
                          Stage
                        </label>
                        <SelectMenu
                          id={fieldId("stageId")}
                          value={values.stageId}
                          onChange={(value) => updateValue("stageId", value)}
                          options={stageOptions}
                          placeholder="Choose stage"
                        />
                        <FieldError message={errors.stageId} />
                      </div>

                      <div>
                        <label htmlFor={fieldId("priorityId")} className={labelClass}>
                          Priority
                        </label>
                        <SelectMenu
                          id={fieldId("priorityId")}
                          value={values.priorityId}
                          onChange={(value) => updateValue("priorityId", value)}
                          options={priorityOptions}
                          placeholder="Choose priority"
                        />
                        <FieldError message={errors.priorityId} />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label htmlFor={fieldId("owner")} className={labelClass}>
                          Owner
                        </label>
                        <input
                          id={fieldId("owner")}
                          value={values.owner}
                          onChange={(event) => updateValue("owner", event.target.value)}
                          className={inputClass}
                        />
                        <FieldError message={errors.owner} />
                      </div>

                      <div>
                        <label htmlFor={fieldId("potentialInvestment")} className={labelClass}>
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
                          className={inputClass}
                        />
                        <FieldError message={errors.potentialInvestment} />
                      </div>
                    </div>
                  </>
                )}

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
                    disabled={pending || !companyReady}
                  >
                    {pending
                      ? "Creating..."
                      : creatingCompany
                        ? "Create company and deal"
                        : "Create Deal"}
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
