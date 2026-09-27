"use client";

import { useSyncExternalStore } from "react";
import { INTERFACE_SOUND_STORAGE_KEY, SOUND_STORAGE_KEY, SOUND_VOLUME_STORAGE_KEY, WELCOME_SOUND_STORAGE_KEY } from "@/lib/ui/entrance";

// Vanquish OS sounds: the entrance chime and small card-shuffle sounds for
// hover, click, opening and adding. One preference controls all of them; it
// is on by default and one click in the sidebar turns it off (remembered on
// this browser). Everything is synthesized with Web Audio (no audio files).
//
// Browsers only let audio start after the person has interacted with the
// page. After the Google sign-in redirect there usually has been no
// interaction yet, so nothing is attempted until there is (the entrance
// waits for the first click or key press). Nothing here throws or delays
// the page.

const PREF_EVENT = "vq-sounds";
const VOLUME_EVENT = "vq-volume";
const DETAIL_EVENT = "vq-sound-detail";

// Keeps the choice for this page even when localStorage is unavailable.
let memoryPref: boolean | null = null;
let memoryVolume: number | null = null;

function readVolume(): number {
  try {
    const stored = window.localStorage.getItem(SOUND_VOLUME_STORAGE_KEY);
    if (stored === null) return 70;
    const volume = Number(stored);
    return Number.isFinite(volume) ? Math.max(0, Math.min(100, volume)) : 70;
  } catch {
    return 70;
  }
}

export function soundVolume() {
  return memoryVolume ?? readVolume();
}

export function setSoundVolume(value: number) {
  const volume = Math.max(0, Math.min(100, Math.round(value)));
  memoryVolume = volume;
  try { window.localStorage.setItem(SOUND_VOLUME_STORAGE_KEY, String(volume)); } catch { /* No storage */ }
  if (master) master.gain.value = volume / 100;
  window.dispatchEvent(new Event(VOLUME_EVENT));
}

export function useSoundVolume() {
  return useSyncExternalStore((callback) => {
    const changed = () => callback();
    const stored = () => { memoryVolume = null; callback(); };
    window.addEventListener(VOLUME_EVENT, changed);
    window.addEventListener("storage", stored);
    return () => {
      window.removeEventListener(VOLUME_EVENT, changed);
      window.removeEventListener("storage", stored);
    };
  }, soundVolume, () => 70);
}

function readPref(): boolean {
  try {
    return window.localStorage.getItem(SOUND_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundPref(on: boolean) {
  memoryPref = on;
  try {
    window.localStorage.setItem(SOUND_STORAGE_KEY, on ? "on" : "off");
  } catch {
    // Storage blocked (private mode): the toggle still works for this page.
  }
  window.dispatchEvent(new CustomEvent(PREF_EVENT, { detail: on }));
}

export function soundsEnabled() {
  return memoryPref ?? readPref();
}

function subscribe(callback: () => void) {
  const onChange = () => callback();
  // Another tab changed it: read storage again.
  const onStorage = () => {
    memoryPref = null;
    callback();
  };
  window.addEventListener(PREF_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(PREF_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useSoundPref() {
  return useSyncExternalStore(subscribe, soundsEnabled, () => true);
}

function detailEnabled(key: string) {
  try { return window.localStorage.getItem(key) !== "off"; } catch { return true; }
}

function detailSubscribe(callback: () => void) {
  window.addEventListener(DETAIL_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(DETAIL_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

export function setWelcomeSound(on: boolean) {
  try { window.localStorage.setItem(WELCOME_SOUND_STORAGE_KEY, on ? "on" : "off"); } catch { /* Browser storage blocked */ }
  window.dispatchEvent(new Event(DETAIL_EVENT));
}
export function setInterfaceSound(on: boolean) {
  try { window.localStorage.setItem(INTERFACE_SOUND_STORAGE_KEY, on ? "on" : "off"); } catch { /* Browser storage blocked */ }
  window.dispatchEvent(new Event(DETAIL_EVENT));
}
export function useWelcomeSound() {
  return useSyncExternalStore(detailSubscribe, () => detailEnabled(WELCOME_SOUND_STORAGE_KEY), () => true);
}
export function useInterfaceSound() {
  return useSyncExternalStore(detailSubscribe, () => detailEnabled(INTERFACE_SOUND_STORAGE_KEY), () => true);
}

// True when the browser will let audio start now.
export function audioAllowedNow() {
  if (typeof navigator === "undefined") return false;
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  return Boolean(activation?.hasBeenActive);
}

let context: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;

// The shared context, running, or null when the browser does not allow it.
async function runningContext(): Promise<AudioContext | null> {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    if (!context) {
      context = new Ctx();
      master = context.createGain();
      master.gain.value = soundVolume() / 100;
      master.connect(context.destination);
    }
    if (context.state === "suspended") await context.resume();
    return context.state === "running" ? context : null;
  } catch {
    return null;
  }
}

// A short, soft rising chime (~1 s, moderate volume). Returns whether it
// started; failures are swallowed.
export async function playEntranceChime(): Promise<boolean> {
  if (!soundsEnabled() || !detailEnabled(WELCOME_SOUND_STORAGE_KEY)) return false;
  const ctx = await runningContext();
  if (!ctx || !master) return false;
  try {
    const now = ctx.currentTime;
    const bus = ctx.createGain();
    bus.gain.value = 0.22;
    bus.connect(master);
    const notes: Array<[number, number]> = [
      [659.25, 0], // E5
      [987.77, 0.16], // B5
      [1318.51, 0.32], // E6, faint
    ];
    notes.forEach(([frequency, offset], index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = index === 2 ? "sine" : "triangle";
      osc.frequency.value = frequency;
      const start = now + offset;
      const peak = index === 2 ? 0.25 : 0.6;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.0);
      osc.connect(gain).connect(bus);
      osc.start(start);
      osc.stop(start + 1.05);
    });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------
// Card-shuffle sounds. Each "flick" is a few milliseconds of band-passed
// noise with a fast attack and decay, like the edge of a card; a riffle is
// several flicks in quick succession, and "add" ends with a soft slap.
// ---------------------------------------------------------------------

export type UiSound = "hover" | "click" | "open" | "add";

function noiseBuffer(ctx: AudioContext) {
  if (noise) return noise;
  const length = Math.floor(ctx.sampleRate * 0.5);
  noise = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  return noise;
}

function flick(
  ctx: AudioContext,
  at: number,
  { gain, frequency, duration, q = 1.1 }: { gain: number; frequency: number; duration: number; q?: number }
) {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx);
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = frequency;
  band.Q.value = q;
  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(0.0001, at);
  envelope.gain.exponentialRampToValueAtTime(gain, at + 0.003);
  envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  source.connect(band).connect(envelope).connect(master!);
  source.start(at, Math.random() * 0.4, duration + 0.02);
}

const jitter = (value: number, spread: number) => value + (Math.random() * 2 - 1) * spread;

// Separate throttles: hovers never stack (fast mouse moves) and never
// swallow the click that usually follows them; clicks do not stack either
// (double clicks).
const lastPlayed = { hover: 0, press: 0 };

export async function playUiSound(kind: UiSound) {
  if (!soundsEnabled() || !detailEnabled(INTERFACE_SOUND_STORAGE_KEY) || !audioAllowedNow()) return;
  const nowMs = performance.now();
  const lane = kind === "hover" ? "hover" : "press";
  if (nowMs - lastPlayed[lane] < (lane === "hover" ? 90 : 40)) return;
  lastPlayed[lane] = nowMs;

  const ctx = await runningContext();
  if (!ctx || !master) return;
  try {
    const t = ctx.currentTime + 0.005;
    if (kind === "hover") {
      flick(ctx, t, { gain: 0.05, frequency: jitter(4200, 500), duration: 0.028 });
      return;
    }
    if (kind === "click") {
      flick(ctx, t, { gain: 0.16, frequency: jitter(3200, 300), duration: 0.03 });
      flick(ctx, t + 0.022, { gain: 0.1, frequency: jitter(2600, 300), duration: 0.035 });
      return;
    }
    // open / add: a short riffle of cards.
    const count = kind === "open" ? 6 : 5;
    let at = t;
    for (let i = 0; i < count; i += 1) {
      flick(ctx, at, {
        gain: 0.14 * (1 - i / (count + 2)),
        frequency: jitter(3400, 700),
        duration: jitter(0.026, 0.006),
      });
      at += jitter(0.019, 0.005);
    }
    if (kind === "add") {
      // Soft slap of the deck landing.
      flick(ctx, at + 0.01, { gain: 0.22, frequency: 700, duration: 0.07, q: 0.7 });
    }
  } catch {
    // Never let a sound break the page.
  }
}
