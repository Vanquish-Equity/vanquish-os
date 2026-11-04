"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTaskAction } from "@/lib/tasks/actions";
import Checkbox from "@/components/Checkbox";
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
  lockDeal = false,
  onSuccess,
  title = "Log Interaction",
  variant = "card",
  followUpMembers,
}: {
  companyId: string;
  deals: InteractionDealOption[];
  initialDealId?: string;
  // Keeps the interaction on initialDealId instead of offering a deal picker.
  lockDeal?: boolean;
  onSuccess?: () => void;
  title?: string | null;
  variant?: "card" | "plain";
  followUpMembers?: { email: string; name: string }[];
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const [isPending, startTransition] = useTransition();
  const [addTask, setAddTask] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [logged, setLogged] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (uncertain || isPending) return;
    const formData = new FormData(event.currentTarget);
    formData.set("companyId", companyId);

    startTransition(async () => {
      setError(null);
      setNotice("");
      try {
        if (!logged) {
          const result = await logInteractionAction(formData);
          if (!result.ok) { setError(result.message); return; }
        }
        if (addTask && lockDeal && followUpMembers?.length) {
          setLogged(true);
          const task = await createTaskAction({
            title: String(formData.get("taskTitle") ?? ""), assigneeEmail: String(formData.get("taskAssignee") ?? ""),
            dueAt: String(formData.get("taskDue") ?? ""), owner: "", priorityId: null, companyId, dealId: initialDealId,
          });
          if (!task.ok) {
            setError("Update saved. The task was not created. Check the task details and retry only the task.");
            router.refresh();
            return;
          }
          setNotice("Update and next action saved.");
        } else {
          setNotice("Update saved.");
        }
        setLogged(false);
        setAddTask(false);
        formRef.current?.reset();
        onSuccess?.();
        router.refresh();
      } catch {
        setUncertain(true);
        setError("Save could not be confirmed. Reload this deal and check its activity and tasks before trying again.");
      }
    });
  }

  const inputClass =
    "rounded-xl border border-neutral-200 bg-white px-2.5 py-2 text-[12px] font-medium text-ink outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100";
  const containerClass =
    variant === "card" ? "vq-card-static rounded-[14px] bg-white p-5" : "";

  return (
    <div className={containerClass}>
      {title && (
        <h2 className="mb-3 text-[14.5px] font-semibold text-ink">
          {title}
        </h2>
      )}
      <form ref={formRef} onSubmit={handleSubmit} className="grid gap-2">
        <fieldset disabled={logged || isPending || uncertain} className="grid gap-2">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
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
          {lockDeal ? (
            <>
              <input type="hidden" name="dealId" value={initialDealId} />
              <div className="truncate rounded-xl bg-[#f7f9fa] px-2.5 py-2 text-[12px] font-medium text-neutral-600">
                {deals.find((deal) => deal.id === initialDealId)?.name ?? "This deal"}
              </div>
            </>
          ) : (
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
          )}
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
        </fieldset>
        {followUpMembers?.length ? <div className="grid gap-2">
          {!logged && <label className="flex items-center gap-2 text-xs"><Checkbox checked={addTask} onChange={(e) => setAddTask(e.target.checked)} /> Add next action</label>}
          {addTask && <fieldset disabled={isPending || uncertain} className="grid gap-2 sm:grid-cols-3">
            <label className="grid gap-1 text-xs">Next action<input required name="taskTitle" maxLength={160} className={inputClass} /></label>
            <label className="grid gap-1 text-xs">Responsible member<select required name="taskAssignee" className={inputClass}>
              <option value="">Choose a member</option>
              {followUpMembers.map(({ email, name }) => <option key={email} value={email}>{name}</option>)}
            </select></label>
            <label className="grid gap-1 text-xs">Due date<input required name="taskDue" type="date" className={inputClass} /></label>
          </fieldset>}
        </div> : null}
        <div className="flex items-center justify-between gap-2">
          <span role="status" className={error ? "text-xs text-red-600" : "text-xs text-neutral-600"}>{error ?? notice}</span>
          {logged && !uncertain && <button type="button" className="text-xs underline" disabled={isPending}
            onClick={() => { setLogged(false); setAddTask(false); setError(null); setNotice("Update saved without a next action."); formRef.current?.reset(); }}>Skip task</button>}
          <button
            type="submit"
            disabled={isPending || uncertain}
            className="rounded-lg bg-ink px-3.5 py-2 text-[11.5px] font-semibold text-white transition hover:bg-neutral-800 disabled:opacity-50"
          >
            {isPending ? "Saving..." : logged ? "Retry task" : addTask ? "Save update and task" : "Log"}
          </button>
        </div>
      </form>
    </div>
  );
}
