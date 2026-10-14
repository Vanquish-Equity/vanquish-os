"use client";
import { startTransition, useState } from "react";
import SelectMenu from "./SelectMenu";
import Checkbox from "./Checkbox";
import {
  loadFundMetrics,
  requestWeekly,
  setWeeklySubscription,
} from "@/lib/reporting/actions";
import type { Metrics } from "@/lib/reporting/metrics";
export default function CrmReporting({
  portfolio,
  documents,
  subscribed,
  funds,
  today,
}: {
  portfolio: boolean;
  documents: boolean;
  subscribed: boolean;
  funds: { id: string; name: string }[];
  today: string;
}) {
  const [resource, setResource] = useState("deals"),
    [enabled, setEnabled] = useState(subscribed);
  const [week, setWeek] = useState(today),
    [report, setReport] = useState<string>();
  const [fund, setFund] = useState(""),
    [asOf, setAsOf] = useState(today),
    [basis, setBasis] = useState("");
  const [metrics, setMetrics] = useState<Metrics>(),
    [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function subscribe(value: boolean) {
    setBusy(true);
    setReport(undefined);
    try {
      const result = await setWeeklySubscription(value);
      if (result.ok) {
        setEnabled(value);
        setMessage(
          value
            ? "Opted in. Generate/download only; delivery is disabled."
            : "Subscription revoked. Downloads recheck consent.",
        );
      } else setMessage("Could not save subscription.");
    } catch {
      setMessage("Subscription unavailable.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-2">
      <section className="vq-card-static min-w-0 rounded-xl bg-white p-5">
        <h2 className="text-lg font-semibold">Authorized CSV</h2>
        <p className="my-3 text-sm text-neutral-600">
          Up to 5,000 rows; 10,000 reserved rows per UTC hour. Current
          permissions apply to each batch. Concurrent exports are not accounting
          snapshots.
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
          className="mt-4 inline-flex min-h-11 items-center rounded border px-4 focus-visible:outline-2"
          href={`/api/reporting/export?resource=${resource}`}
        >
          Download CSV
        </a>
        <p className="mt-3 text-xs text-neutral-500">
          UTC and currency are labeled. Private boards, mailbox/LP evidence,
          positions and private files are excluded. Owner activation of CSV is
          required.
        </p>
      </section>
      <section className="vq-card-static min-w-0 rounded-xl bg-white p-5">
        <h2 className="text-lg font-semibold">Weekly report</h2>
        <label className="my-3 flex min-h-11 items-center gap-3">
          <Checkbox
            checked={enabled}
            disabled={busy}
            onChange={(e) => {
              const checked = e.target.checked;
              startTransition(() => subscribe(checked));
            }}
          />
          Opt in to my weekly report
        </label>
        <p className="mb-3 text-sm text-neutral-600">
          Only you can generate/download current authorized stage counts. No
          email is sent. PDF and scheduled dispatch are deferred.
        </p>
        <label className="block">
          Week starting Monday (UTC)
          <input
            className="my-2 block min-h-11 max-w-full rounded border p-2"
            type="date"
            value={week}
            max={today}
            onChange={(e) => {
              setWeek(e.target.value);
              setReport(undefined);
            }}
          />
        </label>
        <button
          className="min-h-11 rounded border px-4 disabled:opacity-50"
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
                    ? "Report reference ready. Access is checked again at download."
                    : "Choose a recent Monday; weekly generation requires owner activation.",
                );
              } catch {
                setMessage("Report unavailable.");
              } finally {
                setBusy(false);
              }
            })
          }
        >
          Generate reference
        </button>
        {report && (
          <a
            className="ml-3 inline-flex min-h-11 items-center underline"
            href={`/api/reporting/weekly?id=${report}`}
          >
            Download weekly CSV
          </a>
        )}
      </section>
      {portfolio && (
        <section className="vq-card-static min-w-0 rounded-xl bg-white p-5 lg:col-span-2">
          <h2 className="text-lg font-semibold">Fund metrics</h2>
          <p className="my-3 text-sm text-neutral-600">
            Unavailable until owner activation, accounting-basis approval and a
            dated NAV/flow reconciliation. Commitments and calls are not paid-in
            capital. Legacy wires are excluded.
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
                    label: "Gross (contract deferred)",
                    disabled: true,
                  },
                  { value: "net", label: "Net (requires approval)" },
                ]}
              />
            </div>
            <label>
              As of (UTC)
              <input
                className="block min-h-11 w-full min-w-0 rounded border p-2"
                type="date"
                value={asOf}
                max={today}
                onChange={(e) => setAsOf(e.target.value)}
              />
            </label>
          </div>
          <button
            className="mt-4 min-h-11 rounded border px-4 disabled:opacity-50"
            disabled={busy || !fund || !basis}
            onClick={() =>
              startTransition(async () => {
                setBusy(true);
                try {
                  setMetrics(await loadFundMetrics(fund, asOf, basis));
                } catch {
                  setMessage("Metrics unavailable.");
                } finally {
                  setBusy(false);
                }
              })
            }
          >
            Calculate metrics
          </button>
          {metrics && (
            <div className="mt-4 break-words" role="status">
              <p>
                As of {metrics.asOf} · {metrics.basis} ·{" "}
                {metrics.currency ?? "Currency unavailable"}
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
                    ? "Ambiguous"
                    : "Not available"}
                  : {metrics.reason}
                </p>
              )}
              <p className="text-sm text-neutral-600">
                Reconciliation warning: this view is not an audited financial
                statement. Verify the reviewed basis and cutoff.
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
