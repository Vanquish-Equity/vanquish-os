"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

function NavLink({
  activeHref,
  href,
  label,
  onNavigate,
}: {
  activeHref: string;
  href: string;
  label: string;
  onNavigate: (href: string) => void;
}) {
  const active = activeHref === href || activeHref.startsWith(href + "/");
  return (
    <Link
      href={href}
      onClick={() => onNavigate(href)}
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

export default function Sidebar({
  userEmail,
  navItems,
}: {
  userEmail: string;
  // Already filtered by the member's permissions on the server.
  navItems: { href: string; label: string }[];
}) {
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const activeHref = pendingHref || pathname;

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
        {navItems.map((item) => (
          <NavLink
            key={item.href}
            {...item}
            activeHref={activeHref}
            onNavigate={setPendingHref}
          />
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
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="mt-0.5 text-[10px] font-semibold text-neutral-500 transition hover:text-white"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
