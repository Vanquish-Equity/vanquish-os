"use client";

import { useSyncExternalStore } from "react";
import { SOUND_STORAGE_KEY } from "@/lib/ui/entrance";

// Optional entrance sound. Off by default; the choice is remembered on this
// browser. The tone is synthesized with Web Audio (no audio files).
//
// Browsers only let audio start after the person has interacted with the
// page. After the Google sign-in redirect there usually has been no
// interaction yet, so the sound is only attempted when the page already has
// user activation, or on the person's next click/key press during the intro.
// Nothing here ever throws or delays the page.

const PREF_EVENT = "vq-entrance-sound";

// Keeps the choice for this page even when localStorage is unavailable.
let memoryPref: boolean | null = null;

function readPref(): boolean {
  try {
    return window.localStorage.getItem(SOUND_STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

export function setEntranceSoundPref(on: boolean) {
  memoryPref = on;
  try {
    window.localStorage.setItem(SOUND_STORAGE_KEY, on ? "on" : "off");
  } catch {
    // Storage blocked (private mode): the toggle still works for this page.
  }
  window.dispatchEvent(new CustomEvent(PREF_EVENT, { detail: on }));
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

function getSnapshot() {
  return memoryPref ?? readPref();
}

export function useEntranceSoundPref() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

// True when the browser will let audio start now.
export function audioAllowedNow() {
  if (typeof navigator === "undefined") return false;
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  return Boolean(activation?.hasBeenActive);
}

let context: AudioContext | null = null;

// A short, soft two-note chime (~0.9 s, moderate volume). Returns whether it
// started; failures are swallowed.
export async function playEntranceChime(): Promise<boolean> {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return false;
    context = context ?? new Ctx();
    if (context.state === "suspended") await context.resume();
    if (context.state !== "running") return false;

    const now = context.currentTime;
    const master = context.createGain();
    master.gain.value = 0.12;
    master.connect(context.destination);

    const notes: Array<[number, number]> = [
      [659.25, 0], // E5
      [987.77, 0.12], // B5
      [1318.51, 0.24], // E6, faint
    ];
    notes.forEach(([frequency, offset], index) => {
      const osc = context!.createOscillator();
      const gain = context!.createGain();
      osc.type = index === 2 ? "sine" : "triangle";
      osc.frequency.value = frequency;
      const start = now + offset;
      const peak = index === 2 ? 0.25 : 0.6;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.75);
      osc.connect(gain).connect(master);
      osc.start(start);
      osc.stop(start + 0.8);
    });
    return true;
  } catch {
    return false;
  }
}
