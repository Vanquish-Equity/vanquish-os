"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, domMax, LayoutGroup, LazyMotion, MotionConfig, useIsPresent, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import SelectMenu from "@/components/SelectMenu";

const spring = { type: "spring" as const, stiffness: 380, damping: 34, mass: .85 };
const shadow = "0 8px 30px rgb(15 23 42 / .12), 0 0 0 1px rgb(0 194 209 / .25)";

export default function VanquishAI() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const group = useId();
  const reduced = useReducedMotion();
  const close = () => setOpen(false);
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) setOpen(false);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [open]);

  return <LazyMotion features={domMax} strict>
    <MotionConfig reducedMotion="user">
      <LayoutGroup id={group}>
        <m.div data-ai-motion layoutRoot data-context-exclude className="vq-ai-root pointer-events-none fixed inset-x-3 bottom-5 z-[90] flex justify-center">
          <m.button data-ai-motion ref={trigger} layoutId={reduced ? undefined : "surface"} type="button"
            aria-expanded={open} aria-controls="vanquish-ai-panel" aria-label="Vanquish AI (offline)"
            title="Vanquish AI (offline)" tabIndex={open ? -1 : 0}
            onClick={() => setOpen(true)}
            transition={{ layout: spring }}
            whileHover={open || reduced ? undefined : { scale: 1.08 }}
            whileTap={reduced ? undefined : { scale: .94 }}
            style={{ borderRadius: 22, boxShadow: shadow, pointerEvents: open ? "none" : "auto" }}
            className="vq-ai-surface flex h-11 w-11 items-center justify-center bg-white text-[18px] text-cyan-700 focus-visible:outline-2 focus-visible:outline-cyan-400">
            <m.span data-ai-motion layoutId={reduced ? undefined : "spark"} aria-hidden="true" transition={{ layout: spring }} className="block">✦</m.span>
          </m.button>
          <AnimatePresence onExitComplete={() => trigger.current?.focus()}>
            {open && <AssistantPanel key="assistant" close={close} reduced={Boolean(reduced)} />}
          </AnimatePresence>
        </m.div>
      </LayoutGroup>
    </MotionConfig>
  </LazyMotion>;
}

function AssistantPanel({ close, reduced }: { close: () => void; reduced: boolean }) {
  const pathname = usePathname();
  const [mode, setMode] = useState("ask");
  const [moving, setMoving] = useState(true);
  const panel = useRef<HTMLElement>(null);
  const present = useIsPresent();
  const focus = () => panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
  useEffect(() => {
    if (!reduced) return;
    const frame = requestAnimationFrame(focus);
    return () => cancelAnimationFrame(frame);
  }, [reduced]);

  return <m.aside data-ai-motion ref={panel} layoutId={reduced ? undefined : "surface"}
    id="vanquish-ai-panel" role="dialog" aria-label="Vanquish AI" inert={!present}
    initial={reduced ? { opacity: 0 } : false} animate={{ opacity: 1 }} exit={{ opacity: reduced ? 0 : 1 }}
    transition={{ layout: spring, opacity: { duration: 0 } }}
    onLayoutAnimationStart={() => setMoving(true)}
    onLayoutAnimationComplete={() => { setMoving(false); if (present) focus(); }}
    style={{ borderRadius: 24, boxShadow: shadow, overflow: !present || (moving && !reduced) ? "hidden" : "visible" }}
    className="vq-ai-surface pointer-events-auto absolute bottom-0 w-full max-w-[400px] bg-white p-5">
    <m.div data-ai-motion layout="position" className="flex items-center justify-between">
      <h2 className="flex items-center gap-2 text-[17px] font-semibold text-ink">
        <m.span data-ai-motion layoutId={reduced ? undefined : "spark"} transition={{ layout: spring }} aria-hidden="true" className="block text-[18px] text-cyan-700">✦</m.span>
        <m.span data-ai-motion initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : present ? .16 : .08, delay: present && !reduced ? .16 : 0 }}>Vanquish AI</m.span>
      </h2>
      <m.button data-ai-motion type="button" aria-label="Close Vanquish AI" onClick={close}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : .12 }}
        className="rounded-full border border-neutral-200 px-3 py-1 text-[12px]">Close</m.button>
    </m.div>
    <m.div data-ai-motion layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0 : .16, delay: present && !reduced ? .2 : 0 }}>
      <p className="mt-2 text-[12px] text-neutral-500">The workspace assistant is ready for a future provider connection. AI is currently offline.</p>
      <label className="mt-4 block text-[12px] text-neutral-600">Mode<SelectMenu value={mode} onChange={setMode} options={[{value:"ask",label:"Ask the workspace"},{value:"summarize",label:"Summarize this record"},{value:"suggest",label:"Suggest changes"}]} /></label>
      <p className="mt-3 break-all text-[11px] text-neutral-400">Context: {pathname}</p>
      <textarea aria-label="Prompt" disabled placeholder="Available when AI is connected" className="mt-3 w-full resize-none rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-[13px]" />
      <button disabled className="mt-2 rounded-full bg-ink px-4 py-2 text-[12px] font-semibold text-white opacity-40">Send</button>
      <Link href="/review#suggested-changes" onClick={close} className="ml-3 text-[12px] font-semibold text-cyan-800">Suggest a change manually</Link>
    </m.div>
  </m.aside>;
}
