"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { changeAvatar, changeDisplayName } from "@/lib/settings/actions";
import { requestIntroReplay, SIDEBAR_COOKIE_MAX_AGE_SECONDS } from "@/lib/ui/entrance";
import { playUiSound, setSoundPref, setSoundVolume, useSoundPref, useSoundVolume } from "@/lib/ui/sound";

type Props = {
  email: string;
  displayName: string;
  avatarUrl: string | null;
  profileAvailable: boolean;
  introCookie: string;
  initialIntroEnabled: boolean;
};

const card = "vq-card-static rounded-[14px] bg-white p-5 sm:p-6";

function Toggle({ label, description, enabled, onChange }: {
  label: string; description: string; enabled: boolean; onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div>
        <div className="text-[13px] font-semibold text-ink">{label}</div>
        <p className="mt-0.5 text-[11.5px] text-neutral-500">{description}</p>
      </div>
      <button type="button" role="switch" aria-label={label} aria-checked={enabled} onClick={onChange}
        data-sound="off"
        className={`relative h-7 w-12 flex-shrink-0 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-500 ${enabled ? "bg-cyan-400" : "bg-neutral-200"}`}>
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${enabled ? "translate-x-6" : "translate-x-1"}`} />
      </button>
    </div>
  );
}

export default function SettingsPanel({ email, displayName, avatarUrl, profileAvailable, introCookie, initialIntroEnabled }: Props) {
  const router = useRouter();
  const [name, setName] = useState(displayName);
  const [photoUrl, setPhotoUrl] = useState(avatarUrl);
  const [introEnabled, setIntroEnabled] = useState(initialIntroEnabled);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const soundOn = useSoundPref();
  const volume = useSoundVolume();
  const label = name.trim() || email.split("@")[0];

  function saveName(event: React.FormEvent) {
    event.preventDefault();
    setNotice(null);
    startTransition(async () => {
      const result = await changeDisplayName(name);
      setNotice(result.ok ? "Name saved." : result.message);
      if (result.ok) router.refresh();
    });
  }

  function uploadPhoto(file: File | null) {
    setNotice(null);
    startTransition(async () => {
      const result = await changeAvatar(file);
      setNotice(result.ok ? (file ? "Photo saved." : "Photo removed.") : result.message);
      if (fileRef.current) fileRef.current.value = "";
      if (result.ok) {
        if (!file) setPhotoUrl(null);
        else setPhotoUrl(URL.createObjectURL(file));
        router.refresh();
      }
    });
  }

  function toggleIntro() {
    const next = !introEnabled;
    setIntroEnabled(next);
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${introCookie}=${next ? "1" : "0"}; Path=/; Max-Age=${SIDEBAR_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
  }

  function replayIntro() {
    if (requestIntroReplay(window.location.pathname) === "home") router.push("/home");
  }

  return (
    <>
      <section className={card} aria-labelledby="settings-profile">
        <h2 id="settings-profile" className="text-[15px] font-semibold text-ink">Profile</h2>
        <p className="mt-1 text-[12px] text-neutral-500">Your name appears in Home. Your sign-in email cannot be changed here.</p>
        {!profileAvailable && <p role="status" className="mt-3 rounded-lg bg-amber-50 p-3 text-[12px] text-amber-800">Profile editing will be available after migration 0022 is applied.</p>}
        <div className="mt-5 flex flex-wrap items-center gap-4">
          <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#182022] text-lg font-semibold text-white">
            {photoUrl ? <Image src={photoUrl} alt="Your profile photo" width={64} height={64} unoptimized className="h-16 w-16 object-cover" /> : label.charAt(0).toUpperCase()}
          </div>
          <div className="flex flex-wrap gap-2">
            <label className={`cursor-pointer rounded-lg border border-neutral-200 px-3 py-2 text-[12px] font-semibold text-ink hover:border-cyan-300 ${pending || !profileAvailable ? "pointer-events-none opacity-50" : ""}`}>
              Upload photo
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={pending || !profileAvailable}
                onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadPhoto(file); }} />
            </label>
            {photoUrl && <button type="button" disabled={pending || !profileAvailable} onClick={() => uploadPhoto(null)}
              className="rounded-lg border border-neutral-200 px-3 py-2 text-[12px] font-semibold text-neutral-600 hover:border-cyan-300 disabled:opacity-50">Remove photo</button>}
          </div>
          <p className="w-full text-[11px] text-neutral-500">PNG, JPEG or WebP, up to 2 MB.</p>
        </div>
        <form className="mt-4 flex max-w-xl flex-wrap items-end gap-2" onSubmit={saveName}>
          <label className="min-w-[220px] flex-1 text-[12px] font-semibold text-neutral-700">Display name
            <input type="text" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required disabled={pending || !profileAvailable}
              className="mt-1.5 block w-full rounded-lg border border-neutral-200 px-3 py-2.5 text-[13px] font-normal text-ink outline-none focus:border-cyan-400 disabled:bg-neutral-50" />
          </label>
          <button type="submit" disabled={pending || !profileAvailable || !name.trim()}
            className="rounded-lg bg-ink px-4 py-2.5 text-[12px] font-semibold text-white hover:bg-[#263033] disabled:opacity-50">Save name</button>
        </form>
        <p className="mt-3 text-[11.5px] text-neutral-500">Signed in as <span className="font-medium text-ink">{email}</span></p>
        {notice && <p role="status" className="mt-3 text-[12px] text-cyan-800">{notice}</p>}
      </section>

      <section className={card} aria-labelledby="settings-experience">
        <h2 id="settings-experience" className="text-[15px] font-semibold text-ink">Appearance & sound</h2>
        <p className="mt-1 text-[12px] text-neutral-500">These choices are saved in this browser.</p>
        <div className="mt-3 divide-y divide-neutral-100">
          <Toggle label="Welcome intro" description="Play the logo and card animation when you sign in." enabled={introEnabled} onChange={toggleIntro} />
          <Toggle label="Interface sounds" description="Play the welcome chime and small interaction sounds." enabled={soundOn}
            onChange={() => { setSoundPref(!soundOn); if (!soundOn) void playUiSound("open"); }} />
          <div className="py-4">
            <label htmlFor="settings-volume" className="text-[13px] font-semibold text-ink">Volume · {volume}%</label>
            <input id="settings-volume" type="range" min="0" max="100" step="1" value={volume} disabled={!soundOn}
              onChange={(event) => setSoundVolume(Number(event.target.value))}
              onPointerUp={() => { if (soundOn) void playUiSound("open"); }}
              className="mt-2 block w-full max-w-sm accent-cyan-500 disabled:opacity-40" />
          </div>
        </div>
        <button type="button" onClick={replayIntro} className="rounded-lg border border-neutral-200 px-3 py-2 text-[12px] font-semibold text-ink hover:border-cyan-300">Replay intro now</button>
      </section>

      <section className={card} aria-labelledby="settings-connections">
        <h2 id="settings-connections" className="text-[15px] font-semibold text-ink">Connected accounts</h2>
        <p className="mt-1 text-[12px] text-neutral-500">Signing in with Google does not give Vanquish OS access to your mailbox or calendar. Connections will request separate permission.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {[
            ["Gmail", "Email activity and sending from your Gmail account"],
            ["Outlook", "Email activity and sending from your Microsoft mailbox"],
            ["Google Calendar", "Meetings linked to companies and deals"],
            ["Microsoft Calendar", "Meetings from your Microsoft calendar"],
          ].map(([title, detail]) => (
            <div key={title} className="rounded-xl border border-neutral-200 bg-[#f8fafb] p-4">
              <div className="flex items-center justify-between gap-2"><h3 className="text-[13px] font-semibold text-ink">{title}</h3><span className="rounded-full bg-neutral-200 px-2 py-1 text-[10px] font-semibold text-neutral-600">Not available yet</span></div>
              <p className="mt-2 text-[11.5px] text-neutral-500">{detail}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-neutral-500">Connection buttons and sync status will appear here when each service is configured.</p>
      </section>
    </>
  );
}
