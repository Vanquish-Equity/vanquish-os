"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import NavIcon from "@/components/NavIcon";
import { INTRO_PATHS, INTRO_REPLAY_EVENT, takeReplayRequest, WELCOME_COOKIE } from "@/lib/ui/entrance";
import {
  audioAllowedNow,
  playEntranceChime,
  setSoundPref,
  useSoundPref,
} from "@/lib/ui/sound";

// Runs while the HTML is parsed, before the first paint, so the page never
// shows its final state and then jumps into the intro. It consumes the
// one-time marker set by /auth/callback: reloads, navigations and returning
// to the tab find no marker and show the page directly.
export const entranceBootScript = (enabled: boolean) => `(function(){try{
var d=document,c=d.cookie;
if(!/(?:^|;\\s*)${WELCOME_COOKIE}=1(?:;|$)/.test(c))return;
d.cookie="${WELCOME_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax"+(location.protocol==="https:"?"; Secure":"");
if(!${JSON.stringify(enabled)})return;
var p=location.pathname.replace(/\\/$/,"");
if(${JSON.stringify(INTRO_PATHS)}.indexOf(p)<0)return;
d.documentElement.setAttribute("data-vq-intro","play");
}catch(e){}})();`;

// Two moments: the logo (~2.5 s), a short pause, then the cards (~2 s).
// Keep in sync with the timings in globals.css.
const FULL_MS = 5300;
const REDUCED_MS = 2300;

// Vanquish "V" mark as three strokes (traced from public/vanquish-mark.png).
const MARK_PATHS = [
  "M135 160 H300 L783 978 L716 1112 Q690 1150 655 1118 L112 214 Q95 170 135 160 Z",
  "M470 160 H625 L918 658 L852 796 Q822 836 790 800 L438 222 Q420 170 470 160 Z",
  "M812 160 H1128 L996 470 Q960 520 925 470 L775 218 Q760 170 812 160 Z",
];

function playing() {
  return typeof document !== "undefined" && document.documentElement.getAttribute("data-vq-intro") === "play";
}

export default function EntranceIntro() {
  const pathname = usePathname();
  const soundOn = useSoundPref();
  const [active, setActive] = useState(false);
  const startPath = useRef<string | null>(null);
  const played = useRef(false);
  const timer = useRef<number | null>(null);

  const end = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    document.documentElement.removeAttribute("data-vq-intro");
    setActive(false);
  }, []);

  // Starts (or restarts) the sequence on the current page.
  const begin = useCallback(() => {
    const root = document.documentElement;
    if (root.getAttribute("data-vq-intro") === "play") {
      // Restart CSS animations: remove, force a reflow, add again.
      root.removeAttribute("data-vq-intro");
      void root.offsetWidth;
    }
    root.setAttribute("data-vq-intro", "play");
    startPath.current = window.location.pathname;
    played.current = false;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(end, reduced ? REDUCED_MS : FULL_MS);
    setActive(true);
  }, [end]);

  const chime = useCallback(() => {
    if (played.current) return;
    played.current = true;
    void playEntranceChime();
  }, []);

  // Start: the boot script decided before hydration.
  useEffect(() => {
    if (!playing()) return;
    // Syncs with the attribute set outside React by the boot script.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    begin();
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [begin]);

  // "Replay intro" from the user menu (same page, or after going to Home).
  useEffect(() => {
    const onReplay = () => begin();
    window.addEventListener(INTRO_REPLAY_EVENT, onReplay);
    return () => window.removeEventListener(INTRO_REPLAY_EVENT, onReplay);
  }, [begin]);

  useEffect(() => {
    if (!INTRO_PATHS.includes(pathname) || !takeReplayRequest()) return;
    // Syncs with the replay request stored in sessionStorage.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    begin();
  }, [pathname, begin]);

  // Sound: only when enabled, and only if the browser allows it now or the
  // person interacts during the intro. Never blocks or throws.
  useEffect(() => {
    if (!active || !soundOn || played.current) return;
    if (audioAllowedNow()) {
      chime();
      return;
    }
    const onGesture = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-vq-intro-skip]")) return;
      chime();
    };
    window.addEventListener("pointerdown", onGesture, { once: true });
    window.addEventListener("keydown", onGesture, { once: true });
    return () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
  }, [active, soundOn, chime]);

  // Leaving the first screen ends the intro.
  useEffect(() => {
    if (active && startPath.current && pathname !== startPath.current) end();
  }, [active, pathname, end]);

  // Escape skips.
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") end();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, end]);

  function toggleSound() {
    const next = !soundOn;
    setSoundPref(next);
    // The click itself allows audio: play right away when turning it on.
    if (next) chime();
  }

  // Rendered on the server too (hidden by CSS unless the boot script set
  // data-vq-intro), so the overlay is there from the first paint.
  return (
    <div className="vq-intro-layer">
      <div className="vq-intro-backdrop">
        <div className="vq-intro-logo">
          <svg viewBox="90 140 1060 1030" className="vq-intro-mark" aria-hidden="true">
            {MARK_PATHS.map((d) => (
              <path key={d} d={d} pathLength={1} />
            ))}
          </svg>
          <span className="vq-intro-wordmark" aria-hidden="true">
            <span className="block font-[family-name:var(--font-display)] text-[22px] font-bold tracking-[0.18em] text-white">
              VANQUISH
            </span>
            <span className="mt-1 block text-[9px] tracking-[0.3em] text-neutral-500">OPERATING SYSTEM</span>
          </span>
        </div>
      </div>
      <div className="vq-intro-controls">
        <button
          type="button"
          onClick={toggleSound}
          data-sound="off"
          aria-pressed={soundOn}
          className="vq-intro-button"
        >
          <NavIcon name={soundOn ? "sound-on" : "sound-off"} className="h-4 w-4" />
          <span>{soundOn ? "Sound on" : "Sound off"}</span>
        </button>
        <button
          type="button"
          onClick={end}
          data-vq-intro-skip
          className="vq-intro-button"
        >
          Skip
        </button>
      </div>
      <span className="sr-only" role="status">
        {active ? "Welcome to Vanquish OS" : ""}
      </span>
    </div>
  );
}
