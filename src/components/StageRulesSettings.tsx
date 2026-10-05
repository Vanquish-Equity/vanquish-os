"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import SelectMenu from "@/components/SelectMenu";
import { createStageRule, setStageRuleActive } from "@/lib/settings/stage-rule-actions";

type Stage = { id: string; name: string };
type Member = { email: string; name: string | null };
export type StageRule = {
  id: string;
  stage_id: string;
  title: string;
  due_in_days: number | null;
  assignee_email: string | null;
  is_active: boolean;
};

export default function StageRulesSettings({
  stages,
  members,
  rules,
}: {
  stages: Stage[];
  members: Member[];
  rules: StageRule[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [stageId, setStageId] = useState(stages[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [dueInDays, setDueInDays] = useState("");
  const [assignee, setAssignee] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const memberName = (email: string | null) =>
    email ? members.find((member) => member.email === email)?.name || email.split("@")[0] : null;

  function run(action: () => Promise<{ ok: boolean; message?: string }>, success: string, onSuccess?: () => void) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      setMessage(result.ok ? success : result.message ?? "Could not save the change.");
      if (result.ok) {
        onSuccess?.();
        router.refresh();
      }
    });
  }

  return (
    <section className="vq-card-static rounded-[14px] bg-white p-5 sm:p-6" aria-labelledby="settings-stage-rules">
      <h2 id="settings-stage-rules" className="text-[15px] font-semibold text-ink">Stage rules</h2>
      <p className="mt-1 text-[12px] text-neutral-500">
        When a Deal enters a Pipeline stage, create these tasks on it. A Deal that already has an open task from the
        same rule doesn&apos;t get a second one. Only Admins can change rules; they apply to everyone&apos;s stage moves.
      </p>

      <form
        className="mt-4 grid gap-2 sm:grid-cols-[minmax(150px,1fr)_minmax(200px,2fr)_110px_minmax(150px,1fr)_auto] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          run(
            () =>
              createStageRule({
                stageId,
                title,
                dueInDays: dueInDays.trim() === "" ? null : Number(dueInDays),
                assigneeEmail: assignee || null,
              }),
            "Rule saved.",
            () => {
              setTitle("");
              setDueInDays("");
            },
          );
        }}
      >
        <div className="text-[11px] font-semibold text-ink">
          When a Deal enters
          <SelectMenu
            value={stageId}
            options={stages.map((stage) => ({ value: stage.id, label: stage.name }))}
            onChange={setStageId}
            rootClassName="mt-1"
          />
        </div>
        <label className="text-[11px] font-semibold text-ink">
          Create task
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Send diligence request list"
            required
            maxLength={200}
            className="mt-1 block w-full rounded-lg border border-neutral-200 px-3 py-2 text-[12px] font-normal"
          />
        </label>
        <label className="text-[11px] font-semibold text-ink">
          Due in days
          <input
            value={dueInDays}
            onChange={(event) => setDueInDays(event.target.value)}
            inputMode="numeric"
            type="number"
            min={0}
            max={365}
            placeholder="No date"
            className="mt-1 block w-full rounded-lg border border-neutral-200 px-3 py-2 text-[12px] font-normal"
          />
        </label>
        <div className="text-[11px] font-semibold text-ink">
          Assign to
          <SelectMenu
            value={assignee}
            options={[
              { value: "", label: "Unassigned" },
              ...members.map((member) => ({ value: member.email, label: member.name || member.email })),
            ]}
            onChange={setAssignee}
            rootClassName="mt-1"
          />
        </div>
        <button
          type="submit"
          disabled={pending || !stageId}
          className="rounded-lg bg-ink px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-40"
        >
          Add rule
        </button>
      </form>

      {rules.length === 0 ? (
        <p className="mt-4 text-[11.5px] text-neutral-400">No stage rules yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-neutral-100 rounded-xl border border-neutral-100">
          {rules.map((rule) => (
            <li key={rule.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-[12px]">
              <span className="rounded-full bg-[#f0fafb] px-2 py-0.5 text-[10.5px] font-semibold text-cyan-800">
                {stages.find((stage) => stage.id === rule.stage_id)?.name ?? "Inactive stage"}
              </span>
              <span className={`min-w-0 flex-1 truncate font-semibold ${rule.is_active ? "text-ink" : "text-neutral-400 line-through"}`}>
                {rule.title}
              </span>
              <span className="text-[11px] text-neutral-500">
                {[
                  rule.due_in_days === null ? "No due date" : `Due in ${rule.due_in_days}d`,
                  memberName(rule.assignee_email) ?? "Unassigned",
                ].join(" · ")}
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => setStageRuleActive(rule.id, !rule.is_active), rule.is_active ? "Rule turned off." : "Rule turned on.")}
                className="rounded-lg border border-neutral-200 px-2.5 py-1 text-[11px] font-semibold text-ink hover:border-cyan-300 disabled:opacity-40"
              >
                {rule.is_active ? "Turn off" : "Turn on"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {message && <p role="status" className="mt-3 text-[11px] text-cyan-800">{message}</p>}
    </section>
  );
}
