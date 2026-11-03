"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";

export default function ContactDrawer({ children, closeHref }: { children: ReactNode; closeHref: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    if (!element) return;
    element.showModal();
    return () => {
      element.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return <dialog ref={dialog} aria-label="Contact profile" onCancel={(event) => {
    event.preventDefault();
    router.replace(closeHref, { scroll: false });
  }} className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-dvh w-full max-w-[38rem] overflow-y-auto bg-white text-ink shadow-xl backdrop:bg-black/25">
    <div className="sticky top-0 z-10 flex items-center justify-between border-b border-neutral-100 bg-white px-5 py-2">
      <span className="text-xs font-semibold text-neutral-500">Contact profile</span>
      <button type="button" className="min-h-11 rounded-full px-3 text-sm hover:bg-neutral-100" onClick={() => router.replace(closeHref, { scroll: false })}>Close</button>
    </div>
    {children}
  </dialog>;
}
