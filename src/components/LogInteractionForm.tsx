"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { logInteractionAction } from "@/lib/interactions/actions";
import { FormSelectMenu } from "@/components/SelectMenu";

export type InteractionDealOption = {
  id: string;
  name: string;
};

export default function LogInteractionForm({
  companyId,
  deals,
  initialDealId = "",
  onSuccess,
  title = "Log Interaction",
}: {
  companyId: string;
  deals: InteractionDealOption[];
  initialDealId?: string;
  onSuccess?: () => void;
  title?: string | null;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set("companyId", companyId);

    startTransition(async () => {
      const result = await logInteractionAction(formData);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setError(null);
      formRef.current?.reset();
      onSuccess?.();
      router.refresh();
    });
  }

  const inputClass =
    "rounded-xl border border-neutral-200 bg-white px-2.5 py-2 text-[12px] font-medium text-ink outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100";

  return (
    <div className="vq-card-static rounded-[14px] bg-white p-5">
      {title && (
        <h2 className="mb-3 text-[14.5px] font-semibold text-ink">
          {title}
        </h2>
      )}
      <form ref={formRef} onSubmit={handleSubmit} className="grid gap-2">
        <div className="grid grid-cols-3 gap-2">
          <FormSelectMenu
            name="type"
            defaultValue="note"
            options={["note", "call", "meeting", "email", "other"].map((type) => ({
              label: type,
              value: type,
            }))}
            buttonClassName="text-[12px] font-medium"
          />
          <input
            name="occurredAt"
            type="datetime-local"
            className={inputClass}
          />
          <FormSelectMenu
            name="dealId"
            defaultValue={initialDealId}
            options={[
              { label: "Company-level", value: "" },
              ...deals.map((deal) => ({
                label: deal.name,
                value: deal.id,
              })),
            ]}
            buttonClassName="text-[12px] font-medium"
          />
        </div>
        <input
          name="subject"
          placeholder="Subject"
          className={inputClass}
        />
        <textarea
          name="summary"
          placeholder="Summary"
          rows={3}
          className={inputClass}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-red-600">{error}</span>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-lg bg-ink px-3.5 py-2 text-[11.5px] font-semibold text-white transition hover:bg-neutral-800 disabled:opacity-50"
          >
            {isPending ? "Saving..." : "Log"}
          </button>
        </div>
      </form>
    </div>
  );
}
