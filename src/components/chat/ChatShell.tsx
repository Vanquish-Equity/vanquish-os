"use client";

import { usePathname } from "next/navigation";

// Two panes on wide screens (list + conversation). On phones one at a time:
// the list at /chat, the conversation (with a back link) at /chat/<id>.
export default function ChatShell({ list, children }: { list: React.ReactNode; children: React.ReactNode }) {
  const pathname = usePathname();
  const inConversation = pathname !== "/chat";
  return (
    <div className="flex h-full min-h-0">
      <aside
        aria-label="Conversations"
        className={`w-full flex-shrink-0 overflow-y-auto border-r border-neutral-100 bg-white md:block md:w-[320px] ${
          inConversation ? "hidden" : "block"
        }`}
      >
        {list}
      </aside>
      <section className={`min-w-0 flex-1 flex-col ${inConversation ? "flex" : "hidden md:flex"}`}>{children}</section>
    </div>
  );
}
