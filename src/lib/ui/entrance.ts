import type { CSSProperties } from "react";

// Shared rules for the entrance experience: the one-time welcome after a new
// sign-in, the collapsible sidebar and how the signed-in member is named.

// Set by /auth/callback after a successful sign-in and consumed (cleared) by
// the dashboard on its first page load, so the intro plays once per sign-in:
// not on navigation, reloads or returning to a tab.
export const WELCOME_COOKIE = "vq_welcome";
export const WELCOME_MAX_AGE_SECONDS = 120;

// The intro only plays when the first screen is one of these.
export const INTRO_PATHS = ["/home", "/overview"];

// "Replay intro" (user menu): replays on Home/Overview, or goes to Home and
// replays there. For reviewing the sequence without signing out.
export const INTRO_REPLAY_EVENT = "vq-intro-replay";
const REPLAY_KEY = "vq.replayIntro";

export function requestIntroReplay(pathname: string): "here" | "home" {
  if (INTRO_PATHS.includes(pathname)) {
    window.dispatchEvent(new Event(INTRO_REPLAY_EVENT));
    return "here";
  }
  try {
    window.sessionStorage.setItem(REPLAY_KEY, "1");
  } catch {
    // Without storage the replay simply does not carry over to Home.
  }
  return "home";
}

export function takeReplayRequest() {
  try {
    if (window.sessionStorage.getItem(REPLAY_KEY) !== "1") return false;
    window.sessionStorage.removeItem(REPLAY_KEY);
    return true;
  } catch {
    return false;
  }
}

// One preference for the entrance chime and the interface sounds.
export const SOUND_STORAGE_KEY = "vq.sounds";

// One sidebar preference per member on this browser. The name is derived
// from the email so the server can read it before rendering (no flicker)
// without putting the address itself in a cookie name.
export function sidebarCookieName(email: string) {
  let hash = 5381;
  for (const char of email.trim().toLowerCase()) {
    hash = ((hash << 5) + hash + char.charCodeAt(0)) >>> 0;
  }
  return `vq_sidebar_${hash.toString(36)}`;
}

export const SIDEBAR_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

// "marios@vanquishequity.com" -> "MARIOS"
export function accountLabel(email: string) {
  const local = email.split("@")[0]?.trim() ?? "";
  return (local || email).toUpperCase();
}

export function greetingFor(hour: number) {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 18) return "Good afternoon";
  return "Good evening";
}

// First name for the greeting. Only trusted profile names are used: the
// member's display_name (managed by Vanquish in Supabase) first, then the
// name from the sign-in provider. The email is never turned into a name.
// display_name is used as written ("Juan Pablo"); a provider full name
// ("Mario Salas Sandí") is reduced to its first word.
export function greetingName(displayName: string | null | undefined, providerName: string | null | undefined) {
  const display = displayName?.trim();
  if (display) return display.replace(/\s+/g, " ");
  return providerName?.trim().split(/\s+/)[0] ?? "";
}

// Props for a card that takes part in the intro: order and a small start
// offset (visual only — transforms, the layout never moves).
export function introCard(index: number): CSSProperties {
  const offsets: Array<[number, number]> = [
    [-26, 30],
    [24, 32],
    [0, 38],
    [-20, 28],
    [26, 24],
    [-12, 34],
  ];
  const [dx, dy] = offsets[index % offsets.length];
  return { "--vq-i": index, "--vq-dx": `${dx}px`, "--vq-dy": `${dy}px` } as CSSProperties;
}
