import Link from "next/link";

export type SectionLink = { href: string; label: string; current?: boolean };

// Visible entry points between sibling screens (for example LP follow-up,
// LP scouting and LP fundraising). Callers pass only the links the viewer is
// allowed to open: a link is never rendered for an area without permission.
export default function SectionLinks({ links, label }: { links: SectionLink[]; label: string }) {
  if (links.length < 2) return null;
  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-2">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          aria-current={link.current ? "page" : undefined}
          className={`inline-flex min-h-11 items-center rounded-full border px-4 py-2 text-[12px] font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 sm:min-h-0 ${
            link.current
              ? "border-ink bg-ink text-white"
              : "border-neutral-200 text-ink hover:border-cyan-400"
          }`}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
