"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  trashCompanyAction,
  updateCompanyFieldAction,
} from "@/lib/companies/actions";
import SelectMenu from "@/components/SelectMenu";

type Option = { id: string; name: string };

type Company = {
  id: string;
  name: string;
  website: string | null;
  description: string | null;
  industryId: string | null;
  industryName: string | null;
};

type SaveResult = Promise<string | null>;

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

function EditableText({
  label,
  value,
  displayValue,
  placeholder,
  multiline = false,
  onSave,
}: {
  label: string;
  value: string | null;
  displayValue: string;
  placeholder?: string;
  multiline?: boolean;
  onSave: (value: string | null) => SaveResult;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (pending) return;
    const normalized = draft.trim() || null;

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
          className="rounded-md text-left text-[13px] font-semibold text-ink outline-none transition hover:text-cyan-700 focus:ring-2 focus:ring-cyan-100"
        >
          {displayValue}
        </button>
      </FieldFrame>
    );
  }

  const Field = multiline ? "textarea" : "input";

  return (
    <FieldFrame label={label} error={error}>
      <div className="flex items-start gap-1.5">
        <Field
          autoFocus
          value={draft}
          placeholder={placeholder}
          rows={multiline ? 3 : undefined}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void save()}
          onKeyDown={(event) => {
            if (!multiline && event.key === "Enter") {
              event.preventDefault();
              void save();
            }
            if (event.key === "Escape") {
              setDraft(value ?? "");
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

function EditableIndustry({
  value,
  displayValue,
  options,
  onSave,
}: {
  value: string | null;
  displayValue: string;
  options: Option[];
  onSave: (value: string | null) => SaveResult;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveValue(nextValue: string) {
    if (pending) return;
    if (nextValue === (value ?? "")) {
      setEditing(false);
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
      <FieldFrame label="Industry" error={error}>
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
    <FieldFrame label="Industry" error={error}>
      <div className="flex items-center gap-1.5">
        <div className="min-w-0 flex-1">
          <SelectMenu
            value={draft}
            onChange={(nextValue) => {
              setDraft(nextValue);
              void saveValue(nextValue);
            }}
            options={options.map((o) => ({ value: o.id, label: o.name }))}
            placeholder="Choose industry"
            disabled={pending}
            autoFocus
            buttonClassName="px-2.5 py-1.5 font-semibold"
          />
        </div>
      </div>
    </FieldFrame>
  );
}

function ConfirmDeleteDialog({
  companyName,
  onCancel,
  onConfirm,
  pending,
}: {
  companyName: string;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 px-4">
      <div className="vq-card-static w-full max-w-sm rounded-[14px] bg-white p-5 shadow-xl">
        <h3 className="mb-1.5 text-[14.5px] font-semibold text-ink">
          Move to trash?
        </h3>
        <p className="mb-4 text-[12.5px] text-neutral-500">
          <strong className="text-ink">{companyName}</strong> and its deals
          will be hidden from Pipeline and Companies. You can restore it
          later from the trash.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-full border border-neutral-200 px-3.5 py-1.5 text-[12px] font-semibold text-neutral-600 transition hover:border-neutral-300 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="rounded-full bg-red-600 px-3.5 py-1.5 text-[12px] font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
          >
            {pending ? "Moving…" : "Move to trash"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CompanyOverviewCard({
  company,
  industries,
}: {
  company: Company;
  industries: Option[];
}) {
  const router = useRouter();
  const [overrides, setOverrides] = useState<Partial<Company>>({});
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const current = { ...company, ...overrides };

  async function saveField(
    field: "name" | "website" | "description" | "industry_id",
    value: string | null
  ) {
    const result = await updateCompanyFieldAction({
      companyId: current.id,
      field,
      value,
    });

    if (!result.ok) return result.message;

    setOverrides((prev) => {
      if (field === "name") return { ...prev, name: value ?? current.name };
      if (field === "website") return { ...prev, website: value };
      if (field === "description") return { ...prev, description: value };
      const industry = industries.find((i) => i.id === value);
      return {
        ...prev,
        industryId: value,
        industryName: industry?.name ?? null,
      };
    });
    router.refresh();
    return null;
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    const result = await trashCompanyAction({ companyId: current.id });
    setDeleting(false);

    if (!result.ok) {
      setDeleteError(result.message);
      return;
    }

    router.push("/companies");
    router.refresh();
  }

  return (
    <div className="vq-card-static rounded-[14px] bg-white p-5">
      <div className="mb-3.5 flex items-center justify-between">
        <h2 className="text-[14.5px] font-semibold text-ink">
          Company Overview
        </h2>
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          className="text-[11px] font-semibold text-neutral-400 transition hover:text-red-600"
        >
          Move to trash
        </button>
      </div>

      {deleteError && (
        <p className="mb-3 text-xs text-red-600">{deleteError}</p>
      )}

      <div className="grid grid-cols-2 gap-4">
        <EditableText
          label="Name"
          value={current.name}
          displayValue={current.name}
          onSave={(value) => saveField("name", value)}
        />
        <EditableIndustry
          value={current.industryId}
          displayValue={current.industryName ?? "—"}
          options={industries}
          onSave={(value) => saveField("industry_id", value)}
        />
        <EditableText
          label="Website"
          value={current.website}
          displayValue={current.website ?? "—"}
          placeholder="https://…"
          onSave={(value) => saveField("website", value)}
        />
        <div className="col-span-2">
          <EditableText
            label="Description"
            value={current.description}
            displayValue={current.description ?? "—"}
            placeholder="What this company does…"
            multiline
            onSave={(value) => saveField("description", value)}
          />
        </div>
      </div>

      {confirmingDelete && (
        <ConfirmDeleteDialog
          companyName={current.name}
          pending={deleting}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => void handleDelete()}
        />
      )}
    </div>
  );
}
