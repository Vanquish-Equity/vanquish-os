"use client";
import { startTransition, useState, useSyncExternalStore } from "react";
import SelectMenu from "./SelectMenu";
import Checkbox from "./Checkbox";
import {
  loadFundMetrics,
  requestWeekly,
  setWeeklySubscription,
} from "@/lib/reporting/actions";
import type { Metrics } from "@/lib/reporting/metrics";
import { browserZone, formatDay, todayKey } from "@/lib/format-datetime";
import { metricsReasonLabel } from "@/lib/reporting/labels";

// User-facing text, grouped so it can be translated later.
const TEXT = {
  csvTitle: "Export to CSV",
  csvIntro:
    "Download up to 5,000 rows at a time. You only get what you are allowed to see, and there is an hourly limit on rows; if you reach it, try again later.",
  csvNote:
    "Dates and currencies are labeled in the file. Private boards, mailbox and LP scouting data, positions and private files are never included. If the download does not start, CSV export may not be turned on yet: ask an admin.",
  csvButton: "Download CSV",
  weeklyTitle: "Weekly report",
  weeklyOptIn: "Send me the weekly report",
  weeklyIntro:
    "A summary of how many deals are in each stage, based on what you can see. Only you can download it. It is not emailed, and there is no PDF yet.",
  optedIn: "You are signed up. Prepare and download the report here; it is not emailed yet.",
  optedOut: "You are signed out of the weekly report.",
  saveFailed: "Could not save your choice. Try again.",
  weekLabel: "Week starting (pick a Monday)",
  prepare: "Prepare weekly report",
  reportReady: "Your report is ready. Use the download link.",
  reportFailed: "Could not prepare the report. Pick a recent Monday, or ask an admin to turn weekly reports on.",
  reportError: "Could not prepare the report. Try again.",
  weeklyDownload: "Download weekly CSV",
  fundTitle: "Fund metrics",
  fundIntro:
    "Fund performance (DPI, TVPI, XIRR) appears once an admin has approved the accounting basis and checked the fund's value and cash movements against the records. Commitments and capital calls are not money already paid in. Older wire records are left out.",
  asOf: "As of date",
  calculate: "Show fund metrics",
  metricsError: "Could not load the metrics. Try again.",
  noCurrency: "Currency not set",
  warning:
    "This view is not an audited financial statement. Check the accounting basis and cutoff date before relying on it.",
};
const noop = () => () => {};
export default function CrmReporting({
  portfolio,
  documents,
  subscribed,
  funds,
  today: serverToday,
}: {
  portfolio: boolean;
  documents: boolean;
  subscribed: boolean;
  funds: { id: string; name: string }[];
  today: string;
}) {
  // "Today" is the member's own day: the server can only offer its UTC day, so
  // after hydration the browser's calendar day replaces it.
  const today = useSyncExternalStore(
    noop,
    () => todayKey(browserZone()),
    () => serverToday,
  );
  const [resource, setResource] = useState("deals"),
    [enabled, setEnabled] = useState(subscribed);
  const [weekPick, setWeekPick] = useState<string | null>(null),
    [report, setReport] = useState<string>();
  const [fund, setFund] = useState(""),
    [asOfPick, setAsOfPick] = useState<string | null>(null),
    [basis, setBasis] = useState("");
  const [metrics, setMetrics] = useState<Metrics>(),
    [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const week = weekPick ?? today,
    asOf = asOfPick ?? today;
  async function subscribe(value: boolean) {
    setBusy(true);
    setReport(undefined);
    try {
      const result = await setWeeklySubscription(value);
      if (result.ok) {
        setEnabled(value);
        setMessage(
          value
            ? TEXT.optedIn
            : TEXT.optedOut,
        );
      } else setMessage(TEXT.saveFailed);
    } catch {
      setMessage(TEXT.saveFailed);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-2">
      <section className="vq-card-static min-w-0 rounded-xl bg-white p-5">
        <h2 className="text-lg font-semibold">{TEXT.csvTitle}</h2>
        <p className="my-3 text-sm text-neutral-600">
          {TEXT.csvIntro}
        </p>
        <label htmlFor="report-resource">Shared resource</label>
        <SelectMenu
          id="report-resource"
          value={resource}
          onChange={setResource}
          options={[
            { value: "deals", label: "Deals" },
            ...(portfolio
              ? [{ value: "funds", label: "Fund catalog (Portfolio)" }]
              : []),
            ...(documents
              ? [{ value: "documents", label: "Shared document metadata" }]
              : []),
          ]}
        />
        <a
          className="mt-4 inline-flex min-h-11 items-center rounded-full border border-neutral-200 px-4 py-2 text-[12px] font-semibold text-ink transition hover:border-cyan-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400"
          href={`/api/reporting/export?resource=${resource}`}
        >
          {TEXT.csvButton}
        </a>
        <p className="mt-3 text-xs text-neutral-500">
          {TEXT.csvNote}
        </p>
      </section>
      <section className="vq-card-static min-w-0 rounded-xl bg-white p-5">
        <h2 className="text-lg font-semibold">{TEXT.weeklyTitle}</h2>
        <label className="my-3 flex min-h-11 items-center gap-3">
          <Checkbox
            checked={enabled}
            disabled={busy}
            onChange={(e) => {
              const checked = e.target.checked;
              startTransition(() => subscribe(checked));
            }}
          />
          {TEXT.weeklyOptIn}
        </label>
        <p className="mb-3 text-sm text-neutral-600">
          {TEXT.weeklyIntro}
        </p>
        <label className="block">
          {TEXT.weekLabel}
          <input
            className="my-2 block min-h-11 max-w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm focus:outline-cyan-400"
            type="date"
            value={week}
            max={today}
            onChange={(e) => {
              setWeekPick(e.target.value);
              setReport(undefined);
            }}
          />
        </label>
        <button
          className="min-h-11 rounded-full border border-neutral-200 px-4 py-2 text-[12px] font-semibold text-ink transition hover:border-cyan-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 disabled:opacity-40"
          disabled={busy || !enabled}
          onClick={() =>
            startTransition(async () => {
              setBusy(true);
              setReport(undefined);
              try {
                const r = await requestWeekly(week);
                setReport(r.id);
                setMessage(
                  r.ok
                    ? TEXT.reportReady
                    : TEXT.reportFailed,
                );
              } catch {
                setMessage(TEXT.reportError);
              } finally {
                setBusy(false);
              }
            })
          }
        >
          {TEXT.prepare}
        </button>
        {report && (
          <a
            className="ml-3 inline-flex min-h-11 items-center underline"
            href={`/api/reporting/weekly?id=${report}`}
          >
            {TEXT.weeklyDownload}
          </a>
        )}
      </section>
      {portfolio && (
        <section className="vq-card-static min-w-0 rounded-xl bg-white p-5 lg:col-span-2">
          <h2 className="text-lg font-semibold">{TEXT.fundTitle}</h2>
          <p className="my-3 text-sm text-neutral-600">
            {TEXT.fundIntro}
          </p>
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="min-w-0">
              <label htmlFor="report-fund">Fund</label>
              <SelectMenu
                rootClassName="min-w-0 w-full"
                id="report-fund"
                value={fund}
                onChange={setFund}
                options={funds.map((f) => ({ value: f.id, label: f.name }))}
              />
            </div>
            <div className="min-w-0">
              <label htmlFor="report-basis">Accounting basis</label>
              <SelectMenu
                rootClassName="min-w-0 w-full"
                id="report-basis"
                value={basis}
                onChange={setBasis}
                options={[
                  {
                    value: "gross",
                    label: "Gross (not available yet)",
                    disabled: true,
                  },
                  { value: "net", label: "Net (needs admin approval)" },
                ]}
              />
            </div>
            <label>
              {TEXT.asOf}
              <input
                className="block min-h-11 w-full min-w-0 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm focus:outline-cyan-400"
                type="date"
                value={asOf}
                max={today}
                onChange={(e) => setAsOfPick(e.target.value)}
              />
            </label>
          </div>
          <button
            className="mt-4 min-h-11 rounded-full border border-neutral-200 px-4 py-2 text-[12px] font-semibold text-ink transition hover:border-cyan-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 disabled:opacity-40"
            disabled={busy || !fund || !basis}
            onClick={() =>
              startTransition(async () => {
                setBusy(true);
                try {
                  setMetrics(await loadFundMetrics(fund, asOf, basis));
                } catch {
                  setMessage(TEXT.metricsError);
                } finally {
                  setBusy(false);
                }
              })
            }
          >
            {TEXT.calculate}
          </button>
          {metrics && (
            <div className="mt-4 break-words" role="status">
              <p>
                As of {formatDay(metrics.asOf)} ·{" "}
                {metrics.basis === "net" ? "Net" : metrics.basis === "gross" ? "Gross" : metrics.basis} ·{" "}
                {metrics.currency ?? TEXT.noCurrency}
              </p>
              {metrics.status === "available" ? (
                <p>
                  DPI {metrics.dpi?.toFixed(3)} · TVPI{" "}
                  {metrics.tvpi?.toFixed(3)} · XIRR{" "}
                  {metrics.xirr === undefined
                    ? "Not available"
                    : (metrics.xirr * 100).toFixed(2) + "%"}{" "}
                  · Called {metrics.called} · Paid {metrics.paid} · Distributed{" "}
                  {metrics.distributions}
                </p>
              ) : (
                <p>
                  {metrics.status === "ambiguous"
                    ? "Cannot be determined"
                    : "Not available"}
                  : {metricsReasonLabel(metrics.reason)}
                </p>
              )}
              <p className="text-sm text-neutral-600">
                {TEXT.warning}
              </p>
            </div>
          )}
        </section>
      )}
      <p className="text-sm lg:col-span-2" role="status">
        {message}
      </p>
    </div>
  );
}
