"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { disconnectGoogleMailbox } from "@/lib/connections/actions";
import type { MailboxConnection } from "@/lib/connections/queries";
import { changeAvatar, changeDisplayName } from "@/lib/settings/actions";
import { formatExactDateTime } from "@/lib/dates";
import { requestIntroReplay, SIDEBAR_COOKIE_MAX_AGE_SECONDS } from "@/lib/ui/entrance";
import { playUiSound, setInterfaceSound, setSoundPref, setSoundVolume, setWelcomeSound, useInterfaceSound, useSoundPref, useSoundVolume, useWelcomeSound } from "@/lib/ui/sound";
import { landingCookieName, NOTICE_FLAGS, notificationCookieName, pipelineCookieName, type LandingPage, type NoticeCategory, type PipelineDefault } from "@/lib/settings/preferences";
import { setTimePreference, useTimePreferences, type DateStyle, type TimeZoneChoice } from "@/lib/settings/time";

type Props = {
  email: string;
  displayName: string;
  avatarUrl: string | null;
  profileAvailable: boolean;
  introCookie: string;
  initialIntroEnabled: boolean;
  initialNoticeMask: number;
  initialLanding: LandingPage;
  initialPipeline: PipelineDefault;
  mailbox: MailboxConnection;
  connectStatus: string | null;
};

const CONNECT_STATUS_MESSAGES: Record<string, { tone: "ok" | "error"; text: string }> = {
  ok: { tone: "ok", text: "Google connected." },
  declined: { tone: "error", text: "Connection cancelled — nothing was connected." },
  error: { tone: "error", text: "Something went wrong connecting Google. Try again." },
  no_refresh_token: {
    tone: "error",
    text: "Google didn't return a refresh token. Remove Vanquish OS from your Google Account's connected apps and try connecting again.",
  },
  not_configured: { tone: "error", text: "Google connection isn't configured yet." },
};

const GRANTED_SCOPE_LABELS: Record<string, string> = {
  "https://www.googleapis.com/auth/gmail.send": "Send email",
  "https://www.googleapis.com/auth/gmail.readonly": "Read your mailbox",
  "https://www.googleapis.com/auth/gmail.modify": "Organize your mailbox (archive, labels)",
  "https://www.googleapis.com/auth/calendar.readonly": "Read your calendar",
};

// Google always includes these alongside whatever scopes were actually
// requested (identifying who signed the consent, not a mailbox
// capability) — not worth showing next to the ones that matter.
const HIDDEN_SCOPES = new Set([
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
]);

const card = "vq-card-static rounded-[14px] bg-white p-5 sm:p-6";

function Toggle({ label, description, enabled, onChange, disabled = false }: {
  label: string; description: string; enabled: boolean; onChange: () => void; disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div>
        <div className="text-[13px] font-semibold text-ink">{label}</div>
        <p className="mt-0.5 text-[11.5px] text-neutral-500">{description}</p>
      </div>
      <button type="button" role="switch" aria-label={label} aria-checked={enabled} onClick={onChange} disabled={disabled}
        data-sound="off"
        className={`relative h-7 w-12 flex-shrink-0 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-500 disabled:opacity-40 ${enabled ? "bg-cyan-400" : "bg-neutral-200"}`}>
        <span className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${enabled ? "translate-x-5" : "translate-x-0"}`} />
      </button>
    </div>
  );
}

export default function SettingsPanel({ email, displayName, avatarUrl, profileAvailable, introCookie, initialIntroEnabled, initialNoticeMask, initialLanding, initialPipeline, mailbox, connectStatus }: Props) {
  const router = useRouter();
  const [name, setName] = useState(displayName);
  const [photoUrl, setPhotoUrl] = useState(avatarUrl);
  const [introEnabled, setIntroEnabled] = useState(initialIntroEnabled);
  const [noticeMask, setNoticeMask] = useState(initialNoticeMask);
  const [landing, setLanding] = useState(initialLanding);
  const [pipeline, setPipeline] = useState(initialPipeline);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [connectPending, startConnectTransition] = useTransition();
  const [connectMessage, setConnectMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const soundOn = useSoundPref();
  const welcomeSound = useWelcomeSound();
  const interfaceSound = useInterfaceSound();
  const { zone, style } = useTimePreferences();
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
    saveCookie(introCookie, next ? "1" : "0");
  }

  function saveCookie(key: string, value: string) {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${key}=${encodeURIComponent(value)}; Path=/; Max-Age=${SIDEBAR_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
  }

  function toggleNotice(category: NoticeCategory) {
    const next = noticeMask ^ NOTICE_FLAGS[category];
    setNoticeMask(next);
    saveCookie(notificationCookieName(email), String(next));
    router.refresh();
  }

  function replayIntro() {
    if (requestIntroReplay(window.location.pathname) === "home") router.push("/home");
  }

  function disconnectGoogle() {
    setConnectMessage(null);
    startConnectTransition(async () => {
      const result = await disconnectGoogleMailbox();
      setConnectMessage(result.ok ? "Google disconnected." : result.message);
      if (result.ok) router.refresh();
    });
  }

  const statusFromRedirect = connectStatus ? CONNECT_STATUS_MESSAGES[connectStatus] ?? null : null;

  return (
    <>
      <section className={card} aria-labelledby="settings-profile">
        <h2 id="settings-profile" className="text-[15px] font-semibold text-ink">Profile</h2>
        <p className="mt-1 text-[12px] text-neutral-500">Your name appears in Home and the account menu. Your sign-in email cannot be changed here.</p>
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
          <Toggle label="All sounds" description="Master sound switch for this browser." enabled={soundOn}
            onChange={() => { setSoundPref(!soundOn); if (!soundOn) void playUiSound("open"); }} />
          <Toggle label="Welcome chime" description="Sound during the logo intro." enabled={welcomeSound} disabled={!soundOn}
            onChange={() => setWelcomeSound(!welcomeSound)} />
          <Toggle label="Interface sounds" description="Clicks, cards and other small interactions." enabled={interfaceSound} disabled={!soundOn}
            onChange={() => { setInterfaceSound(!interfaceSound); if (!interfaceSound) void playUiSound("open"); }} />
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

      <section className={card} aria-labelledby="settings-notices">
        <h2 id="settings-notices" className="text-[15px] font-semibold text-ink">Notifications</h2>
        <p className="mt-1 text-[12px] text-neutral-500">Choose what appears in your inbox, Home and unread counter. Hidden notices are kept and return if you enable their category again. Saved in this browser.</p>
        <div className="mt-3 divide-y divide-neutral-100">
          <Toggle label="Assigned tasks" description="Tasks assigned to you." enabled={Boolean(noticeMask & NOTICE_FLAGS.tasks)} onChange={() => toggleNotice("tasks")} />
          <Toggle label="Mentions and replies" description="@mentions in chat or comments, and replies to your comments." enabled={Boolean(noticeMask & NOTICE_FLAGS.mentions)} onChange={() => toggleNotice("mentions")} />
          <Toggle label="Chat messages" description="Direct and group messages. Chat @mentions follow the Mentions choice." enabled={Boolean(noticeMask & NOTICE_FLAGS.chat)} onChange={() => toggleNotice("chat")} />
          <Toggle label="Assigned email drafts" description="Historical only — drafts no longer have a responsible to assign." enabled={Boolean(noticeMask & NOTICE_FLAGS.drafts)} onChange={() => toggleNotice("drafts")} />
        </div>
        <p className="mt-2 text-[11px] text-neutral-500">Activity alerts can be added when that event type exists.</p>
      </section>

      <section className={card} aria-labelledby="settings-workspace">
        <h2 id="settings-workspace" className="text-[15px] font-semibold text-ink">Workspace preferences</h2>
        <p className="mt-1 text-[12px] text-neutral-500">These choices are saved in this browser for your account.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-[12px] font-semibold text-ink">Page after sign-in
            <select value={landing} onChange={(event) => { const value = event.target.value as LandingPage; setLanding(value); saveCookie(landingCookieName(email), value); }} className="mt-1.5 block w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[12px] font-normal focus:border-cyan-400">
              <option value="/home">Home</option><option value="/overview">Overview</option><option value="/pipeline">Pipeline</option>
            </select>
          </label>
          <label className="text-[12px] font-semibold text-ink">Default Pipeline filter
            <select value={pipeline} onChange={(event) => { const value = event.target.value as PipelineDefault; setPipeline(value); saveCookie(pipelineCookieName(email), value); router.refresh(); }} className="mt-1.5 block w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[12px] font-normal focus:border-cyan-400">
              <option value="all">Show terminal outcomes</option><option value="active">Hide terminal outcomes</option>
            </select>
          </label>
          <label className="text-[12px] font-semibold text-ink">Time zone
            <select value={zone} onChange={(event) => setTimePreference("zone", event.target.value as TimeZoneChoice)} className="mt-1.5 block w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[12px] font-normal focus:border-cyan-400">
              <option value="browser">Use browser time zone</option><option value="America/Costa_Rica">Costa Rica</option><option value="America/Los_Angeles">Los Angeles</option><option value="UTC">UTC</option>
            </select>
          </label>
          <label className="text-[12px] font-semibold text-ink">Date format
            <select value={style} onChange={(event) => setTimePreference("style", event.target.value as DateStyle)} className="mt-1.5 block w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[12px] font-normal focus:border-cyan-400">
              <option value="month-first">Month / day / year</option><option value="day-first">Day / month / year</option><option value="iso">Year / month / day</option>
            </select>
          </label>
        </div>
        <p className="mt-3 text-[11px] text-neutral-500">Time zone and date format currently apply to chat and notification timestamps. Date-only CRM fields continue to use their original calendar dates.</p>
      </section>

      <section className={card} aria-labelledby="settings-connections">
        <h2 id="settings-connections" className="text-[15px] font-semibold text-ink">Connected accounts</h2>
        <p className="mt-1 text-[12px] text-neutral-500">Signing in with Google does not give Vanquish OS access to your mailbox or calendar. Connecting asks for that separately.</p>
        {statusFromRedirect && (
          <p role="status" className={`mt-3 rounded-lg p-3 text-[12px] ${statusFromRedirect.tone === "ok" ? "bg-cyan-50 text-cyan-800" : "bg-amber-50 text-amber-800"}`}>
            {statusFromRedirect.text}
          </p>
        )}
        <div className="mt-4 rounded-xl border border-neutral-200 bg-[#f8fafb] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[13px] font-semibold text-ink">Google (Gmail + Calendar)</h3>
            <span
              className={`rounded-full px-2 py-1 text-[10px] font-semibold ${
                mailbox.connected ? "bg-emerald-100 text-emerald-800" : "bg-neutral-200 text-neutral-600"
              }`}
            >
              {mailbox.connected ? "Connected" : "Not connected"}
            </span>
          </div>
          <p className="mt-2 text-[11.5px] text-neutral-500">
            Sending drafts, reading Inbox/Sent, and meetings linked to companies and deals, from your own Gmail and Google
            Calendar. One connection covers both.
          </p>
          {mailbox.connected ? (
            <>
              {mailbox.connectedAt && (
                <p className="mt-2 text-[11.5px] text-neutral-500">
                  Connected {formatExactDateTime(mailbox.connectedAt)}
                </p>
              )}
              {mailbox.grantedScopes.filter((scope) => !HIDDEN_SCOPES.has(scope)).length > 0 && (
                <ul className="mt-2 space-y-0.5 text-[11.5px] text-neutral-600">
                  {mailbox.grantedScopes
                    .filter((scope) => !HIDDEN_SCOPES.has(scope))
                    .map((scope) => (
                      <li key={scope} className="flex items-center gap-1.5">
                        <span aria-hidden className="text-emerald-600">✓</span>
                        {GRANTED_SCOPE_LABELS[scope] ?? scope}
                      </li>
                    ))}
                </ul>
              )}
              <button
                type="button"
                disabled={connectPending}
                onClick={disconnectGoogle}
                className="mt-3 rounded-lg border border-neutral-200 px-3 py-2 text-[12px] font-semibold text-neutral-700 hover:border-red-200 hover:text-red-700 disabled:opacity-50"
              >
                {connectPending ? "Disconnecting..." : "Disconnect"}
              </button>
            </>
          ) : (
            <a
              href="/api/connections/google/start"
              className="mt-3 inline-block rounded-lg bg-ink px-3 py-2 text-[12px] font-semibold text-white hover:bg-[#263033]"
            >
              Connect Google
            </a>
          )}
          {connectMessage && <p role="status" className="mt-2 text-[11.5px] text-cyan-800">{connectMessage}</p>}
        </div>
        <p className="mt-3 text-[11px] text-neutral-500">
          Sending, mailbox sync and calendar sync are separate follow-up work — connecting only stores the grant for now.
        </p>
      </section>
    </>
  );
}
