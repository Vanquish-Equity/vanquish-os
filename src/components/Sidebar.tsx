"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const workspaceItems = [
  { href: "/pipeline", label: "Pipeline" },
  { href: "/companies", label: "Companies" },
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
      <div className="mb-6 flex items-center gap-2.5 px-2">
        <div className="flex h-8.5 w-8.5 flex-shrink-0 items-center justify-center rounded-[9px] bg-gradient-to-br from-cyan-400 to-[#093236] font-[family-name:var(--font-display)] text-[15px] font-semibold text-white">
          V
        </div>
        <div>
          <div className="font-[family-name:var(--font-display)] text-sm font-semibold leading-tight text-white">
            Vanquish
          </div>
          <div className="mt-0.5 text-[9px] tracking-[1.6px] text-neutral-500">
            OPERATING SYSTEM
          </div>
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
