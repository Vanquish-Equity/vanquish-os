"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import SelectMenu from "@/components/SelectMenu";

export default function VanquishAI() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState("ask");
  const panel = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const interrupted = useRef<{ bounds: DOMRect; radius: string; opacity: string } | null>(null);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useLayoutEffect(() => {
    if (!mounted || !panel.current || !trigger.current || !content.current) return;
    const shell = panel.current;
    const body = content.current;
    const origin = trigger.current.getBoundingClientRect();
    const destination = shell.getBoundingClientRect();
    const focusPanel = () => shell.querySelector<HTMLButtonElement>("button")?.focus();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      if (open) focusPanel();
      const frame = open ? null : requestAnimationFrame(() => setMounted(false));
      return () => { if (frame !== null) cancelAnimationFrame(frame); };
    }
    // Animate the shell's actual bounds: text never stretches with the surface.
    const circle = { left: `${origin.left}px`, top: `${origin.top}px`, width: `${origin.width}px`, height: `${origin.height}px`, borderRadius: "22px", boxShadow: "0 0 24px rgb(0 194 209 / .35)" };
    const rectangle = { left: `${destination.left}px`, top: `${destination.top}px`, width: `${destination.width}px`, height: `${destination.height}px`, borderRadius: "16px", boxShadow: getComputedStyle(shell).boxShadow };
    const previous = interrupted.current;
    interrupted.current = null;
    const start = previous ? {
      left: `${previous.bounds.left}px`, top: `${previous.bounds.top}px`,
      width: `${previous.bounds.width}px`, height: `${previous.bounds.height}px`,
      borderRadius: previous.radius, boxShadow: rectangle.boxShadow,
    } : open ? circle : rectangle;
    shell.style.overflow = "hidden";
    body.style.width = `${destination.width}px`;
    const morph = shell.animate([start, open ? rectangle : circle], {
      duration: open ? 420 : 340, easing: "cubic-bezier(.22, 1, .36, 1)",
    });
    const reveal = body.animate(open ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: previous?.opacity ?? "1" }, { opacity: 0 }], {
      duration: open ? 160 : 90, delay: open ? 260 : 0, fill: "both",
    });
    let active = true;
    const finish = () => morph.finish();
    window.addEventListener("resize", finish);
    void morph.finished.then(() => {
      if (!active) return;
      shell.style.overflow = "";
      body.style.width = "";
      if (open) { reveal.cancel(); focusPanel(); }
      else setMounted(false);
    }).catch(() => { /* Cleanup cancels interrupted animations. */ });
    return () => {
      active = false;
      window.removeEventListener("resize", finish);
      if (morph.playState === "running") interrupted.current = {
        bounds: shell.getBoundingClientRect(), radius: getComputedStyle(shell).borderRadius,
        opacity: getComputedStyle(body).opacity,
      };
      morph.cancel(); reveal.cancel();
      shell.style.overflow = "";
      body.style.width = "";
    };
  }, [open, mounted]);
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("keydown",key);
    return () => { document.removeEventListener("keydown",key); };
  }, [open]);
  return <div data-context-exclude>
    <button ref={trigger} type="button" tabIndex={mounted ? -1 : 0} aria-expanded={open} aria-controls="vanquish-ai-panel" aria-label="Vanquish AI (offline)" title="Vanquish AI (offline)" onClick={() => { if (open) close(); else { interrupted.current = null; setMounted(true); setOpen(true); } }} style={{ opacity: mounted ? 0 : 1, pointerEvents: mounted ? "none" : undefined }} className="fixed bottom-5 left-1/2 z-[70] flex h-11 w-11 -translate-x-1/2 items-center justify-center rounded-full border border-cyan-200 bg-white text-[18px] text-ink shadow-lg hover:border-cyan-400 focus-visible:outline-2 focus-visible:outline-cyan-400"><span aria-hidden="true">✦</span></button>
    {mounted && <aside ref={panel} id="vanquish-ai-panel" role="dialog" aria-label="Vanquish AI" inert={!open} className="vq-card-static fixed inset-x-3 bottom-20 z-[90] rounded-2xl bg-white sm:inset-x-auto sm:right-5 sm:w-[400px]">
      <div ref={content} className="p-5">
      <div className="flex items-center justify-between"><h2 className="text-[17px] font-semibold text-ink">Vanquish AI</h2><button type="button" aria-label="Close Vanquish AI" className="rounded-full border border-neutral-200 px-3 py-1 text-[12px]" onClick={close}>Close</button></div>
      <p className="mt-2 text-[12px] text-neutral-500">The workspace assistant is ready for a future provider connection. AI is currently offline.</p>
      <label className="mt-4 block text-[12px] text-neutral-600">Mode<SelectMenu value={mode} onChange={setMode} options={[{value:"ask",label:"Ask the workspace"},{value:"summarize",label:"Summarize this record"},{value:"suggest",label:"Suggest changes"}]} /></label>
      <p className="mt-3 break-all text-[11px] text-neutral-400">Context: {pathname}</p>
      <textarea aria-label="Prompt" disabled placeholder="Available when AI is connected" className="mt-3 w-full resize-none rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-[13px]" />
      <button disabled className="mt-2 rounded-full bg-ink px-4 py-2 text-[12px] font-semibold text-white opacity-40">Send</button>
      <Link href="/review#suggested-changes" onClick={close} className="ml-3 text-[12px] font-semibold text-cyan-800">Suggest a change manually</Link>
      </div>
    </aside>}
  </div>;
}
