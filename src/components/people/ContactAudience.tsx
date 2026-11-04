"use client";

import { useId } from "react";
import Checkbox from "@/components/Checkbox";
import { MAX_RECIPIENTS, PRIVACY_COPY, VISIBILITIES, type Visibility } from "@/lib/people/contact-privacy";

export type Audience = { visibility: Visibility; recipients: string[] };
export type MemberOption = { email: string; name: string };

// "Who can see this": Team / Private / Specific people. Team may also include
// members (they are notified); Specific people needs at least one.
export default function ContactAudience({ members, value, onChange, disabled }: {
  members: MemberOption[]; value: Audience; onChange: (next: Audience) => void; disabled?: boolean;
}) {
  const name = useId();
  const picker = value.visibility !== "private";
  const toggle = (email: string, on: boolean) => {
    const next = on ? [...value.recipients, email] : value.recipients.filter((item) => item !== email);
    if (next.length <= MAX_RECIPIENTS) onChange({ ...value, recipients: next });
  };
  return <fieldset className="space-y-2" disabled={disabled}>
    <legend className="text-xs font-semibold text-neutral-700">{PRIVACY_COPY.legend}</legend>
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {VISIBILITIES.map((option) => <label key={option} className="inline-flex min-h-8 items-center gap-1.5 text-sm">
        <input type="radio" name={name} value={option} checked={value.visibility === option}
          onChange={() => onChange({ visibility: option, recipients: option === "private" ? [] : value.recipients })} />
        {PRIVACY_COPY.options[option]}
      </label>)}
    </div>
    <p className="text-xs text-neutral-600">{PRIVACY_COPY.hints[value.visibility]}</p>
    {picker && <div className="space-y-1">
      <p className="text-xs text-neutral-600">{value.visibility === "shared" ? PRIVACY_COPY.pickShared : PRIVACY_COPY.pickTeam}</p>
      {members.length === 0 ? <p className="text-xs text-neutral-500">{PRIVACY_COPY.noMembers}</p>
        : <ul className="grid max-h-36 gap-x-4 overflow-y-auto sm:grid-cols-2" aria-label="Members to include">
          {members.map((member) => <li key={member.email}>
            <label className="flex min-h-9 items-center gap-2 text-sm">
              <Checkbox checked={value.recipients.includes(member.email)} onChange={(event) => toggle(member.email, event.target.checked)} />
              <span className="min-w-0 break-words">{member.name}</span>
            </label>
          </li>)}
        </ul>}
    </div>}
  </fieldset>;
}
