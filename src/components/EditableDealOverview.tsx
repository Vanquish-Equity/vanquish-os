"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateDealFieldAction } from "@/lib/deals/actions";
import SelectMenu from "@/components/SelectMenu";

type Option = {
  id: string;
  name: string;
};

type EditableDeal = {
  id: string;
  companyId: string;
  stageId: string;
  stageName: string | null;
  outcomeId: string | null;
  outcomeName: string | null;
  relationshipStateId: string | null;
  relationshipStateName: string | null;
  priorityId: string | null;
  priorityName: string | null;
  owner: string | null;
  potentialInvestment: number | null;
  name?: string;
  round?: string | null;
  raiseAmount?: number | null;
  source?: string | null;
  notes?: string | null;
};

type DealField =
  | "stage_id"
  | "priority_id"
  | "owner"
  | "potential_investment"
  | "outcome_id"
  | "relationship_state_id"
  | "name"
  | "round"
  | "raise_amount"
  | "source"
  | "notes";

type SaveResult = Promise<string | null>;

const EMPTY_VALUE = "__empty__";

function formatMoney(n: number | null) {
  if (!n) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

function FieldFrame({
  label,
  error,
  children,
}: {
  label: string;
  error: string | null;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 text-[10.5px] uppercase tracking-wide text-neutral-400">
        {label}
      </div>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function SaveButton({
  pending,
  onSave,
}: {
  pending: boolean;
  onSave: () => void;
}) {
  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSave}
      className="rounded-full bg-ink px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
      disabled={pending}
    >
      Save
    </button>
  );
}

function EditableSelectField({
  label,
  value,
  displayValue,
  options,
  allowEmpty = false,
  onSave,
}: {
  label: string;
  value: string | null;
  displayValue: string;
  options: Option[];
  allowEmpty?: boolean;
  onSave: (value: string | null) => SaveResult;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    await saveValue(draft);
  }

  async function saveValue(nextValue: string) {
    if (pending) return;

    if (!allowEmpty && !nextValue) {
      setError(`${label} is required.`);
      return;
    }

    if (nextValue === (value ?? "")) {
      setEditing(false);
      setError(null);
      return;
    }

    setPending(true);
    const nextError = await onSave(nextValue || null);
    setPending(false);

    if (nextError) {
      setError(nextError);
      return;
    }

    setError(null);
    setEditing(false);
  }

  if (!editing) {
    return (
      <FieldFrame label={label} error={error}>
        <button
          type="button"
          onClick={() => {
            setDraft(value ?? "");
            setError(null);
            setEditing(true);
          }}
          className="rounded-md text-left text-[13px] font-semibold text-ink outline-none transition hover:text-cyan-700 focus:ring-2 focus:ring-cyan-100"
        >
          {displayValue}
        </button>
      </FieldFrame>
    );
  }

  return (
    <FieldFrame label={label} error={error}>
      <div className="flex items-center gap-1.5">
        <div className="min-w-0 flex-1">
          <SelectMenu
            value={draft || (allowEmpty ? EMPTY_VALUE : "")}
            onChange={(nextValue) => {
              const normalizedValue = nextValue === EMPTY_VALUE ? "" : nextValue;
              setDraft(normalizedValue);
              void saveValue(normalizedValue);
            }}
            options={[
              ...(allowEmpty
                ? [{ value: EMPTY_VALUE, label: "None" }]
                : []),
              ...options.map((option) => ({
                value: option.id,
                label: option.name,
              })),
            ]}
            placeholder={`Choose ${label.toLocaleLowerCase()}`}
            disabled={pending}
            autoFocus
            buttonClassName="px-2.5 py-1.5 font-semibold"
          />
        </div>
        <SaveButton pending={pending} onSave={() => void save()} />
      </div>
    </FieldFrame>
  );
}

function EditableTextField({
  label,
  value,
  displayValue,
  multiline = false,
  required = false,
  onSave,
}: {
  label: string;
  value: string | null;
  displayValue: string;
  multiline?: boolean;
  required?: boolean;
  onSave: (value: string | null) => SaveResult;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (pending) return;

    const normalized = draft.trim() || null;

    if (required && !normalized) {
      setError(`${label} is required.`);
      return;
    }

    if (normalized === (value?.trim() || null)) {
      setEditing(false);
      setError(null);
      return;
    }

    setPending(true);
    const nextError = await onSave(normalized);
    setPending(false);

    if (nextError) {
      setError(nextError);
      return;
    }

    setError(null);
    setEditing(false);
  }

  if (!editing) {
    return (
      <FieldFrame label={label} error={error}>
        <button
          type="button"
          onClick={() => {
            setDraft(value ?? "");
            setError(null);
            setEditing(true);
          }}
          className={`rounded-md text-left text-[13px] font-semibold text-ink outline-none transition hover:text-cyan-700 focus:ring-2 focus:ring-cyan-100 ${
            multiline ? "whitespace-pre-wrap font-medium" : ""
          }`}
        >
          {displayValue}
        </button>
      </FieldFrame>
    );
  }

  const inputClass =
    "min-w-0 flex-1 rounded-xl border border-neutral-200 bg-white px-2.5 py-1.5 text-[12.5px] font-semibold text-ink outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100";

  function handleKeyDown(
    event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>
  ) {
    if (event.key === "Enter" && (!multiline || event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void save();
    }
    if (event.key === "Escape") {
      setDraft(value ?? "");
      setEditing(false);
      setError(null);
    }
  }

  return (
    <FieldFrame label={label} error={error}>
      <div className={`flex gap-1.5 ${multiline ? "items-start" : "items-center"}`}>
        {multiline ? (
          <textarea
            autoFocus
            rows={4}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => void save()}
            onKeyDown={handleKeyDown}
            className={inputClass}
            disabled={pending}
          />
        ) : (
          <input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => void save()}
            onKeyDown={handleKeyDown}
            className={inputClass}
            disabled={pending}
          />
        )}
        <SaveButton pending={pending} onSave={() => void save()} />
      </div>
    </FieldFrame>
  );
}

function EditableNumberField({
  label,
  value,
  displayValue,
  onSave,
}: {
  label: string;
  value: number | null;
  displayValue: string;
  onSave: (value: string | null) => SaveResult;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (pending) return;

    const trimmed = draft.trim();

    if (trimmed) {
      const amount = Number(trimmed);
      if (!Number.isFinite(amount) || amount < 0) {
        setError("Enter a valid non-negative amount.");
        return;
      }
    }

    if ((trimmed || null) === (value === null ? null : String(value))) {
      setEditing(false);
      setError(null);
      return;
    }

    setPending(true);
    const nextError = await onSave(trimmed || null);
    setPending(false);

    if (nextError) {
      setError(nextError);
      return;
    }

    setError(null);
    setEditing(false);
  }

  if (!editing) {
    return (
      <FieldFrame label={label} error={error}>
        <button
          type="button"
          onClick={() => {
            setDraft(value === null ? "" : String(value));
            setError(null);
            setEditing(true);
          }}
          className="rounded-md text-left text-[13px] font-semibold text-ink outline-none transition hover:text-cyan-700 focus:ring-2 focus:ring-cyan-100"
        >
          {displayValue}
        </button>
      </FieldFrame>
    );
  }

  return (
    <FieldFrame label={label} error={error}>
      <div className="flex items-center gap-1.5">
        <input
          autoFocus
          type="number"
          min="0"
          step="1"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void save()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void save();
            }
            if (event.key === "Escape") {
              setDraft(value === null ? "" : String(value));
              setEditing(false);
              setError(null);
            }
          }}
          className="min-w-0 flex-1 rounded-xl border border-neutral-200 bg-white px-2.5 py-1.5 text-[12.5px] font-semibold text-ink outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
          disabled={pending}
        />
        <SaveButton pending={pending} onSave={() => void save()} />
      </div>
    </FieldFrame>
  );
}

export default function EditableDealOverview({
  deal,
  stages,
  outcomes,
  relationshipStates,
  priorities,
  showDetails = false,
  title = "Deal Overview",
}: {
  deal: EditableDeal;
  stages: Option[];
  outcomes: Option[];
  relationshipStates: Option[];
  priorities: Option[];
  showDetails?: boolean;
  title?: string;
}) {
  const router = useRouter();
  const [overrides, setOverrides] = useState<Partial<EditableDeal>>({});
  const currentDeal = { ...deal, ...overrides };

  async function saveField(field: DealField, value: string | null) {
    const result = await updateDealFieldAction({
      dealId: currentDeal.id,
      companyId: currentDeal.companyId,
      field,
      value,
    });

    if (!result.ok) return result.message;

    setOverrides((current) => {
      if (field === "stage_id") {
        const stage = stages.find((option) => option.id === value);
        return {
          ...current,
          stageId: value ?? currentDeal.stageId,
          stageName: stage?.name ?? currentDeal.stageName,
        };
      }

      if (field === "priority_id") {
        const priority = priorities.find((option) => option.id === value);
        return {
          ...current,
          priorityId: value,
          priorityName: priority?.name ?? null,
        };
      }

      if (field === "outcome_id") {
        const outcome = outcomes.find((option) => option.id === value);
        return {
          ...current,
          outcomeId: value,
          outcomeName: outcome?.name ?? null,
        };
      }

      if (field === "relationship_state_id") {
        const state = relationshipStates.find((option) => option.id === value);
        return {
          ...current,
          relationshipStateId: value,
          relationshipStateName: state?.name ?? null,
        };
      }

      if (field === "owner") {
        return { ...current, owner: value };
      }

      if (field === "name") return { ...current, name: value ?? currentDeal.name };
      if (field === "round") return { ...current, round: value };
      if (field === "source") return { ...current, source: value };
      if (field === "notes") return { ...current, notes: value };
      if (field === "raise_amount") {
        return { ...current, raiseAmount: value === null ? null : Number(value) };
      }

      return {
        ...current,
        potentialInvestment: value === null ? null : Number(value),
      };
    });
    router.refresh();

    return null;
  }

  return (
    <div className="vq-card-static rounded-[14px] bg-white p-5">
      <h2 className="mb-3.5 text-[14.5px] font-semibold text-ink">
        {title}
      </h2>
      <div className="grid grid-cols-2 gap-4">
        {showDetails && (
          <>
            <EditableTextField
              label="Deal Name"
              value={currentDeal.name ?? null}
              displayValue={currentDeal.name || "—"}
              required
              onSave={(value) => saveField("name", value)}
            />
            <EditableTextField
              label="Round"
              value={currentDeal.round ?? null}
              displayValue={currentDeal.round ?? "—"}
              onSave={(value) => saveField("round", value)}
            />
          </>
        )}
        <EditableSelectField
          label="Stage"
          value={currentDeal.stageId}
          displayValue={currentDeal.stageName ?? "—"}
          options={stages}
          onSave={(value) => saveField("stage_id", value)}
        />
        <EditableSelectField
          label="Outcome"
          value={currentDeal.outcomeId}
          displayValue={currentDeal.outcomeName ?? "None"}
          options={outcomes}
          allowEmpty
          onSave={(value) => saveField("outcome_id", value)}
        />
        <EditableSelectField
          label="Relationship State"
          value={currentDeal.relationshipStateId}
          displayValue={currentDeal.relationshipStateName ?? "None"}
          options={relationshipStates}
          allowEmpty
          onSave={(value) => saveField("relationship_state_id", value)}
        />
        <EditableSelectField
          label="Priority"
          value={currentDeal.priorityId}
          displayValue={currentDeal.priorityName ?? "—"}
          options={priorities}
          allowEmpty
          onSave={(value) => saveField("priority_id", value)}
        />
        <EditableTextField
          label="Owner"
          value={currentDeal.owner}
          displayValue={currentDeal.owner ?? "—"}
          onSave={(value) => saveField("owner", value)}
        />
        <EditableNumberField
          label="Potential Investment"
          value={currentDeal.potentialInvestment}
          displayValue={formatMoney(currentDeal.potentialInvestment)}
          onSave={(value) => saveField("potential_investment", value)}
        />
        {showDetails && (
          <>
            <EditableNumberField
              label="Raise Amount"
              value={currentDeal.raiseAmount ?? null}
              displayValue={formatMoney(currentDeal.raiseAmount ?? null)}
              onSave={(value) => saveField("raise_amount", value)}
            />
            <EditableTextField
              label="Source"
              value={currentDeal.source ?? null}
              displayValue={currentDeal.source ?? "—"}
              onSave={(value) => saveField("source", value)}
            />
            <div className="col-span-2">
              <EditableTextField
                label="Notes"
                value={currentDeal.notes ?? null}
                displayValue={currentDeal.notes ?? "—"}
                multiline
                onSave={(value) => saveField("notes", value)}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
