import Image from "next/image";
import type { DealMember } from "@/lib/deals/assignee-types";

export default function DealAssigneeAvatars({ members }: { members: DealMember[] }) {
  if (!members.length) return null;
  return <div className="flex -space-x-1.5" aria-label={`Assigned: ${members.map((member) => member.name).join(", ")}`}>
    {members.slice(0, 4).map((member) => <span key={member.email} title={member.name} className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-cyan-700 text-[9px] font-semibold text-white">
      {member.avatarUrl ? <Image src={member.avatarUrl} alt={member.name} width={28} height={28} unoptimized className="h-full w-full object-cover" /> : member.name.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}
    </span>)}
    {members.length > 4 && <span title={members.slice(4).map((member) => member.name).join(", ")} className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-neutral-600 text-[9px] font-semibold text-white">+{members.length - 4}</span>}
  </div>;
}
