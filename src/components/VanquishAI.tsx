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
  const shape = useRef<SVGPathElement>(null);
  const spark = useRef<SVGTextElement>(null);
  const surface = useRef<SVGSVGElement>(null);
  const headerSpark = useRef<HTMLSpanElement>(null);
  const progress = useRef(0);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useLayoutEffect(() => {
    if (!mounted || !panel.current || !trigger.current || !surface.current || !shape.current || !spark.current || !headerSpark.current) return;
    const shell = panel.current;
    const overlay = surface.current;
    const outline = shape.current;
    const icon = spark.current;
    const origin = trigger.current.getBoundingClientRect();
    const destination = shell.getBoundingClientRect();
    const starTarget = headerSpark.current.getBoundingClientRect();
    const ox = origin.left + origin.width / 2;
    const oy = origin.top + origin.height / 2;
    const dx = destination.left + destination.width / 2;
    const dy = destination.top + destination.height / 2;
    const frames = [
      { at: 0, x: ox, y: oy, w: 44, h: 44, r: 22, skew: 0 },
      { at: .18, x: ox, y: oy - 28, w: 56, h: 100, r: 28, skew: -12 },
      { at: .52, x: ox + (dx - ox) * .62, y: oy + (dy - oy) * .62, w: destination.width * .72, h: destination.height * .82, r: 90, skew: 24 },
      { at: .82, x: dx, y: dy - 4, w: destination.width * 1.025, h: destination.height * 1.025, r: 42, skew: -5 },
      { at: 1, x: dx, y: dy, w: destination.width, h: destination.height, r: 16, skew: 0 },
    ];
    const draw = (p: number) => {
      progress.current = p;
      const index = frames.findIndex((frame) => frame.at >= p);
      const end = frames[Math.max(1, index)];
      const start = frames[Math.max(0, index - 1)];
      const t = Math.max(0, Math.min(1, (p - start.at) / (end.at - start.at)));
      const eased = t * t * (3 - 2 * t);
      const mix = (a: number, b: number) => a + (b - a) * eased;
      const x = mix(start.x, end.x), y = mix(start.y, end.y);
      const w = mix(start.w, end.w), h = mix(start.h, end.h);
      const r = Math.min(mix(start.r, end.r), w / 2, h / 2);
      const skew = mix(start.skew, end.skew);
      outline.setAttribute("d", morphOutline(x, y, w, h, r, skew));
      // The same star stays inside the transforming surface in both directions.
      const travel = Math.max(0, (p - .52) / .48);
      const settle = travel * travel * (3 - 2 * travel);
      const sx = x + (starTarget.left + starTarget.width / 2 - dx) * settle;
      const sy = y + (starTarget.top + starTarget.height / 2 - dy) * settle;
      icon.setAttribute("x", String(sx)); icon.setAttribute("y", String(sy));
      icon.setAttribute("transform", `rotate(${180 * Math.sin(Math.PI * p)}, ${sx}, ${sy})`);
      const reveal = Math.max(0, (p - .82) / .18);
      shell.style.opacity = String(reveal);
      shell.inert = !open || p < .99;
      overlay.style.opacity = String(1 - Math.max(0, (p - .95) / .05));
    };
    let frame = 0;
    const startProgress = progress.current;
    const target = open ? 1 : 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = reduced ? 0 : (open ? 820 : 700) * Math.abs(target - startProgress);
    const started = performance.now();
    const finish = () => {
      draw(target);
      shell.inert = !open;
      if (open) {
        shell.style.opacity = "";
        overlay.style.display = "none";
        shell.querySelector<HTMLButtonElement>("button")?.focus();
      } else {
        // Keep the SVG star visible until React restores the trigger in the
        // same commit; never flash the full panel or an empty closing circle.
        shell.style.opacity = "0";
        setMounted(false);
      }
    };
    overlay.style.display = "";
    draw(startProgress);
    const tick = (now: number) => {
      const elapsed = duration === 0 ? 1 : Math.min(1, (now - started) / duration);
      draw(startProgress + (target - startProgress) * elapsed);
      if (elapsed < 1) frame = requestAnimationFrame(tick);
      else finish();
    };
    frame = requestAnimationFrame(tick);
    const resize = () => { cancelAnimationFrame(frame); finish(); };
    window.addEventListener("resize", resize);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("resize", resize); };
  }, [open, mounted]);
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("keydown",key);
    return () => { document.removeEventListener("keydown",key); };
  }, [open]);
  return <div data-context-exclude>
    <button ref={trigger} type="button" tabIndex={mounted ? -1 : 0} aria-expanded={open} aria-controls="vanquish-ai-panel" aria-label="Vanquish AI (offline)" title="Vanquish AI (offline)" onClick={() => { if (open) close(); else { progress.current = 0; setMounted(true); setOpen(true); } }} style={{ opacity: mounted ? 0 : 1, pointerEvents: mounted ? "none" : undefined }} className="fixed bottom-5 left-1/2 z-[70] flex h-11 w-11 -translate-x-1/2 items-center justify-center rounded-full border border-cyan-200 bg-white text-[18px] text-cyan-700 shadow-lg hover:border-cyan-400 focus-visible:outline-2 focus-visible:outline-cyan-400"><span aria-hidden="true">✦</span></button>
    {mounted && <svg ref={surface} aria-hidden="true" className="vq-ai-morph fixed inset-0 z-[91] h-full w-full pointer-events-none">
      <defs>
        <linearGradient id="vq-ai-morph-fill" x1="0" y1="0" x2="1" y2="1"><stop stopColor="white" /><stop offset="1" stopColor="#ecfeff" /></linearGradient>
        <linearGradient id="vq-ai-morph-edge" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#22d3ee" /><stop offset=".5" stopColor="#0891b2" /><stop offset="1" stopColor="#a5f3fc" /></linearGradient>
      </defs>
      <path ref={shape} fill="url(#vq-ai-morph-fill)" stroke="url(#vq-ai-morph-edge)" strokeWidth="2" style={{ filter: "drop-shadow(0 0 9px rgb(0 194 209 / .28)) drop-shadow(0 8px 16px rgb(0 0 0 / .12))" }} />
      <text ref={spark} textAnchor="middle" dominantBaseline="central" fontSize="18" fill="#0e7490">✦</text>
    </svg>}
    {mounted && <aside ref={panel} id="vanquish-ai-panel" role="dialog" aria-label="Vanquish AI" inert={!open} className="vq-card-static fixed inset-x-3 bottom-20 z-[90] rounded-2xl bg-white sm:inset-x-auto sm:right-5 sm:w-[400px]">
      <div className="p-5">
      <div className="flex items-center justify-between"><h2 className="flex items-center gap-2 text-[17px] font-semibold text-ink"><span ref={headerSpark} aria-hidden="true" className="text-[18px] text-cyan-700">✦</span>Vanquish AI</h2><button type="button" aria-label="Close Vanquish AI" className="rounded-full border border-neutral-200 px-3 py-1 text-[12px]" onClick={close}>Close</button></div>
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

// Eight cubic segments keep the outline continuous from a circle to a rounded
// rectangle. Opposite edge offsets create the stretched droplet in the middle.
function morphOutline(cx: number, cy: number, w: number, h: number, radius: number, skew: number) {
  const l = cx - w / 2, r = cx + w / 2, t = cy - h / 2, b = cy + h / 2;
  const k = radius * .55228475;
  const q = radius;
  return `M ${l + q + skew} ${t}
    C ${l + q + skew} ${t} ${r - q + skew} ${t} ${r - q + skew} ${t}
    C ${r - q + k + skew} ${t} ${r + skew} ${t + q - k} ${r + skew} ${t + q}
    C ${r + skew} ${t + q} ${r - skew} ${b - q} ${r - skew} ${b - q}
    C ${r - skew} ${b - q + k} ${r - q + k - skew} ${b} ${r - q - skew} ${b}
    C ${r - q - skew} ${b} ${l + q - skew} ${b} ${l + q - skew} ${b}
    C ${l + q - k - skew} ${b} ${l - skew} ${b - q + k} ${l - skew} ${b - q}
    C ${l - skew} ${b - q} ${l + skew} ${t + q} ${l + skew} ${t + q}
    C ${l + skew} ${t + q - k} ${l + q - k + skew} ${t} ${l + q + skew} ${t} Z`;
}
