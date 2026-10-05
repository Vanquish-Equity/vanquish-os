"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Checkbox from "@/components/Checkbox";
import { STAGE_REQUIREMENTS } from "@/lib/settings/stage-requirements";
import { setStageRequirement } from "@/lib/settings/stage-rule-actions";

type Stage = { id: string; name: string };

export default function StageRequirementsSettings({
  stages,
  active,
}: {
  stages: Stage[];
  // "stageId:requirement" for every requirement currently switched on.
  active: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const on = new Set(active);

  function toggle(stageId: string, requirement: string, enabled: boolean) {
    setMessage(null);
    startTransition(async () => {
      const result = await setStageRequirement(stageId, requirement, enabled);
      setMessage(result.ok ? "Requirement saved." : result.message);
      if (result.ok) router.refresh();
    });
  }

  return (
    <section className="vq-card-static rounded-[14px] bg-white p-5 sm:p-6" aria-labelledby="settings-stage-requirements">
      <h2 id="settings-stage-requirements" className="text-[15px] font-semibold text-ink">Stage requirements</h2>
      <p className="mt-1 text-[12px] text-neutral-500">
        What a Deal must have before it can enter a stage. A move that misses one is refused with the list of what to add,
        from the Pipeline board, the Deal page or anywhere else. Only Admins can change these.
      </p>
      <div className="mt-4 overflow-x-auto rounded-xl border border-neutral-100">
        <table className="w-full min-w-[720px] text-left text-[12px]">
          <thead>
            <tr className="text-[10.5px] uppercase tracking-wide text-neutral-400">
              <th className="px-3 py-2 font-semibold">To enter</th>
              {STAGE_REQUIREMENTS.map((item) => (
                <th key={item.key} className="px-2 py-2 text-center font-semibold">{item.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stages.map((stage) => (
              <tr key={stage.id} className="border-t border-neutral-50">
                <td className="px-3 py-2 font-semibold text-ink">{stage.name}</td>
                {STAGE_REQUIREMENTS.map((item) => {
                  const checked = on.has(`${stage.id}:${item.key}`);
                  return (
                    <td key={item.key} className="px-2 py-2 text-center">
                      <Checkbox
                        checked={checked}
                        disabled={pending}
                        aria-label={`${stage.name}: require ${item.label}`}
                        onChange={() => toggle(stage.id, item.key, !checked)}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-neutral-500">
        <span className="font-semibold text-ink">DD checklist complete</span>: no required critical or important due
        diligence item is still open (found, not applicable and waived all count as done).
      </p>
      {message && <p role="status" className="mt-3 text-[11px] text-cyan-800">{message}</p>}
    </section>
  );
}
