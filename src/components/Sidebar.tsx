"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

const workspaceItems = [
  { href: "/overview", label: "Overview" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/companies", label: "Companies" },
  { href: "/people", label: "People" },
  { href: "/tasks", label: "Tasks" },
  { href: "/review", label: "Review" },
  { href: "/portfolio", label: "Portfolio" },
];

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(href + "/");
  return (
    <Link
      href={href}
      className={`flex items-center gap-2.5 rounded-[9px] px-3 py-2.5 text-[13px] font-medium transition-colors ${
        active
          ? "bg-[#12191c] text-white"
          : "text-neutral-400 hover:bg-[#12191c] hover:text-white"
      }`}
    >
      {label}
    </Link>
  );
}

export default function Sidebar({ userEmail }: { userEmail: string }) {
  return (
    <aside className="flex h-screen w-[248px] flex-shrink-0 flex-col bg-ink px-3.5 py-5">
      <div className="mb-6 px-2">
        <div className="h-[42px] w-[166px]">
          <Image
            src="/vanquish-logotype.png"
            alt="Vanquish"
            width={2172}
            height={724}
            priority
            className="h-full w-full object-contain object-left"
          />
        </div>
        <div className="mt-1 text-[9px] tracking-[1.6px] text-neutral-500">
          OPERATING SYSTEM
        </div>
      </div>

      <div className="mb-1.5 mt-2 px-3 text-[10px] tracking-[1.4px] text-neutral-600 uppercase">
        Workspace
      </div>
      <nav className="flex flex-col gap-0.5">
        {workspaceItems.map((item) => (
          <NavLink key={item.href} {...item} />
        ))}
      </nav>

      <div className="flex-1" />

      <div className="flex items-center gap-2.5 border-t border-[#14191b] px-3 pt-3">
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[#182022] text-[11px] font-semibold text-white">
          {userEmail.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="truncate text-xs font-medium leading-tight text-neutral-200">
            {userEmail}
          </div>
          <div className="mt-0.5 text-[10px] text-neutral-500">
            Vanquish Equity
          </div>
        </div>
      </div>
    </aside>
  );
}
