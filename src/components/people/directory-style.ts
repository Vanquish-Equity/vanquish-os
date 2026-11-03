export const peopleTableClass = "w-full text-[12.5px] [&_td]:border-r [&_td]:border-neutral-100 [&_th]:border-r [&_th]:border-neutral-200";
export const peopleAvatarClass = "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#f0fafb] text-[10.5px] font-semibold text-cyan-800";

export function peopleInitials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase();
}
