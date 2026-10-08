"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

type Phase = "idle" | "running" | "done";

// A thin bar under the top edge that starts when an internal link is clicked
// and completes when the new route has rendered. It waits a moment before
// showing, so instant navigations never flash it.
function Bar() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [phase, setPhase] = useState<Phase>("idle");
  const timers = useRef<number[]>([]);
  const here = `${pathname}?${search}`;
  const hereRef = useRef(here);

  function clear() {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
  }

  useEffect(() => {
    hereRef.current = here;
    clear();
    // Route committed: finish the bar, then reset it once it has faded.
    setPhase((current) => {
      if (current === "idle") return current;
      timers.current.push(window.setTimeout(() => setPhase("idle"), 320));
      return "done";
    });
  }, [here]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || (anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (`${url.pathname}?${url.searchParams.toString()}` === hereRef.current) return;
      if (url.pathname === window.location.pathname && url.hash) return;
      clear();
      // Show only if the route takes longer than a blink, and never hang.
      timers.current.push(window.setTimeout(() => setPhase("running"), 120));
      timers.current.push(window.setTimeout(() => setPhase("idle"), 12000));
    }
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      clear();
    };
  }, []);

  const width = phase === "idle" ? "0%" : phase === "running" ? "86%" : "100%";
  const transition =
    phase === "running"
      ? "width 7s cubic-bezier(0.1, 0.7, 0.2, 1), opacity 120ms ease-out"
      : phase === "done"
        ? "width 180ms ease-out, opacity 220ms ease-out 140ms"
        : "none";
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed left-0 top-0 z-[2000] h-[2px] bg-cyan shadow-[0_0_8px_rgb(0_194_209/0.6)]"
      style={{ width, opacity: phase === "running" ? 1 : 0, transition }}
    />
  );
}

export default function NavigationProgress() {
  return (
    <Suspense fallback={null}>
      <Bar />
    </Suspense>
  );
}
