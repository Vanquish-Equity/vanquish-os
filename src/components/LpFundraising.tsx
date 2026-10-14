"use client";
import Link from "next/link";
import { useId, useState, useTransition } from "react";
import SelectMenu from "./SelectMenu";
import Checkbox from "./Checkbox";
import { saveLpRecord } from "@/lib/lp-management/actions";
export type LpRow = Record<string, string | number | boolean | null>;
export type LpData = {
  funds: LpRow[];
  investors: LpRow[];
  people: LpRow[];
  companies: LpRow[];
  entities: LpRow[];
  entries: LpRow[];
  commitments: LpRow[];
  flows: LpRow[];
  preferences: LpRow[];
  tasks: LpRow[];
  cards: LpRow[];
  history: LpRow[];
};
const stages = [
  "prospect",
  "contacted",
  "meeting",
  "interest",
  "soft_circle",
  "committed",
  "closed",
  "lost",
];
type Field = {
  key: string;
  label: string;
  type?: "text" | "date" | "checkbox";
  options?: { value: string; label: string }[];
  optional?: boolean;
};
function RecordForm({
  kind,
  title,
  fields,
  initial = {},
}: {
  kind: string;
  title: string;
  fields: Field[];
  initial?: Record<string, string | boolean>;
}) {
  const formId = useId();
  const [values, setValues] = useState<Record<string, string | boolean>>(() =>
      kind === "flow" ? { ...initial, id: crypto.randomUUID() } : initial,
    ),
    [pending, start] = useTransition(),
    [message, setMessage] = useState("");
  return (
    <details className="vq-card-static p-4">
      <summary className="cursor-pointer font-semibold">{title}</summary>
      <form
        className="mt-4 grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            try {
              const payload = { ...values };
              if (kind === "flow") payload.id ??= crypto.randomUUID();
              const result = await saveLpRecord(kind, payload);
              setMessage(result.message);
              if (result.ok && kind === "flow")
                setValues((v) => ({ ...v, id: crypto.randomUUID() }));
            } catch {
              setMessage("Could not save. Refresh and try again.");
            }
          });
        }}
      >
        {fields.map((f) => (
          <div key={f.key} className="min-w-0">
            <label
              htmlFor={`${formId}-${f.key}`}
              className="mb-1 block text-sm"
            >
              {f.label}
            </label>
            {f.options ? (
              <SelectMenu
                id={`${formId}-${f.key}`}
                value={String(values[f.key] ?? "")}
                onChange={(v) => setValues({ ...values, [f.key]: v })}
                options={[
                  { value: "", label: f.optional ? "None" : "Choose…" },
                  ...f.options,
                ]}
              />
            ) : f.type === "checkbox" ? (
              <Checkbox
                id={`${formId}-${f.key}`}
                checked={Boolean(values[f.key])}
                onChange={(e) =>
                  setValues({ ...values, [f.key]: e.target.checked })
                }
              />
            ) : (
              <input
                id={`${formId}-${f.key}`}
                type={f.type ?? "text"}
                required={!f.optional}
                maxLength={f.key === "notes" ? 2000 : 500}
                value={String(values[f.key] ?? "")}
                onChange={(e) =>
                  setValues({ ...values, [f.key]: e.target.value })
                }
                className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm focus:outline-cyan-400"
              />
            )}
          </div>
        ))}
        <button
          disabled={pending}
          className="w-fit rounded-xl bg-ink px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save record"}
        </button>
        <p role="status" className="text-sm text-cyan-800">
          {message}
        </p>
      </form>
    </details>
  );
}
function Records({
  title,
  rows,
  labels,
}: {
  title: string;
  rows: LpRow[];
  labels: Record<string, string>;
}) {
  return (
    <section className="vq-card-static space-y-3 p-5">
      <h2 className="font-semibold">
        {title} · {rows.length} records
      </h2>
      {!rows.length && <p className="text-sm text-neutral-500">No records.</p>}
      {rows.map((r, i) => (
        <dl
          key={String(r.id ?? i)}
          className="grid gap-x-4 gap-y-1 border-t border-neutral-100 pt-3 text-sm sm:grid-cols-2"
        >
          {Object.entries(r)
            .filter(
              ([k, v]) =>
                v !== null &&
                ![
                  "id",
                  "investor_id",
                  "fund_id",
                  "entry_id",
                  "person_id",
                  "company_id",
                  "legal_entity_id",
                ].includes(k),
            )
            .map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="text-xs text-neutral-500">
                  {k.replaceAll("_", " ")}
                </dt>
                <dd className="break-words">{String(v)}</dd>
              </div>
            ))}
          {r.investor_id && (
            <div>
              <dt className="text-xs text-neutral-500">Investor</dt>
              <dd>
                <Link
                  className="text-cyan-800 underline"
                  href={`/portfolio/fundraising/${r.investor_id}`}
                >
                  {labels[String(r.investor_id)] ?? "Investor"}
                </Link>
              </dd>
            </div>
          )}
          {r.fund_id && (
            <div>
              <dt className="text-xs text-neutral-500">Fund</dt>
              <dd>{labels[String(r.fund_id)] ?? "Fund"}</dd>
            </div>
          )}
        </dl>
      ))}
    </section>
  );
}
export default function LpFundraising({
  data,
  investorId,
}: {
  data: LpData;
  investorId?: string;
}) {
  const options = (rows: LpRow[], field = "name") =>
    rows.map((r) => ({ value: String(r.id), label: String(r[field] ?? r.id) }));
  const investorOptions = options(data.investors, "display_name"),
    fundOptions = options(data.funds),
    labels = Object.fromEntries(
      [...data.investors, ...data.funds].map((r) => [
        String(r.id),
        String(r.display_name ?? r.name),
      ]),
    );
  const base: Field[] = [
      { key: "investorId", label: "Investor", options: investorOptions },
      { key: "fundId", label: "Fund", options: fundOptions },
    ],
    initial: Record<string, string | boolean> = investorId
      ? { investorId }
      : {};
  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-7">
      <header>
        <h1 className="text-2xl font-semibold">
          {investorId
            ? `${labels[investorId] ?? "Investor"} · LP 360`
            : "LP fundraising"}
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Portfolio access required. Financial records are entered explicitly;
          messages and personal board moves never create commitments or update
          fund stages.
        </p>
      </header>
      <nav className="flex flex-wrap gap-4 text-sm text-cyan-800">
        <Link href="/portfolio/fundraising">All LPs</Link>
        <Link href="/lp-board">My LPs</Link>
        <Link href="/lp-scouting">Private scouting</Link>
      </nav>
      {!investorId && (
        <>
          <RecordForm
            kind="fund"
            title="Create fund"
            fields={[
              { key: "name", label: "Fund name" },
              { key: "currency", label: "ISO currency (USD, CRC…)" },
              {
                key: "target",
                label: "Target amount (decimal)",
                optional: true,
              },
              {
                key: "legalEntityId",
                label: "Legal entity",
                options: options(data.entities),
                optional: true,
              },
            ]}
          />
          <RecordForm
            kind="investor"
            title="Create or link Investor"
            fields={[
              {
                key: "personId",
                label: "Existing Person",
                options: options(data.people, "name"),
              },
              { key: "name", label: "Investor display name" },
              {
                key: "companyId",
                label: "Existing company",
                options: options(data.companies),
                optional: true,
              },
            ]}
          />
        </>
      )}
      <RecordForm
        kind="pipeline"
        title="Add LP to a fund pipeline"
        initial={initial}
        fields={[
          ...base,
          {
            key: "stage",
            label: "Initial stage",
            options: stages.map((s) => ({
              value: s,
              label: s.replaceAll("_", " "),
            })),
          },
          {
            key: "lossReason",
            label: "Loss reason (required for lost)",
            optional: true,
          },
        ]}
      />
      <section className="space-y-2">
        <h2 className="font-semibold">Fund pipeline</h2>
        {!data.entries.length && (
          <p className="text-sm">No pipeline entries.</p>
        )}
        {data.entries.map((e) => (
          <RecordForm
            key={`${e.id}:${e.stage}`}
            kind="pipeline"
            title={`${labels[String(e.investor_id)] ?? "Investor"} · ${labels[String(e.fund_id)] ?? "Fund"} · ${e.stage} · since ${String(e.stage_entered_at ?? "unknown").slice(0, 10)}`}
            initial={{
              investorId: String(e.investor_id),
              fundId: String(e.fund_id),
              expectedStage: String(e.stage),
              stage: String(e.stage),
              lossReason: String(e.loss_reason ?? ""),
            }}
            fields={[
              {
                key: "stage",
                label: "Next stage",
                options: stages.map((s) => ({
                  value: s,
                  label: s.replaceAll("_", " "),
                })),
              },
              { key: "lossReason", label: "Loss reason", optional: true },
            ]}
          />
        ))}
      </section>
      <RecordForm
        kind="commitment"
        title="Record or update commitment"
        initial={initial}
        fields={[
          ...base,
          { key: "amount", label: "Amount (decimal; fund currency)" },
          { key: "date", label: "Commitment date", type: "date" },
          {
            key: "status",
            label: "Explicit status",
            options: ["soft_circle", "signed", "funded", "cancelled"].map(
              (s) => ({ value: s, label: s }),
            ),
          },
        ]}
      />
      <RecordForm
        kind="flow"
        title="Record cash flow"
        initial={initial}
        fields={[
          ...base,
          {
            key: "flowKind",
            label: "Flow kind",
            options: ["capital_call", "contribution", "distribution"].map(
              (s) => ({ value: s, label: s.replaceAll("_", " ") }),
            ),
          },
          { key: "amount", label: "Amount (decimal; fund currency)" },
          { key: "date", label: "Flow date", type: "date" },
        ]}
      />
      <RecordForm
        kind="preferences"
        title="Contact and report preferences"
        initial={{ ...initial, coInvestment: false }}
        fields={[
          base[0],
          {
            key: "reportFrequency",
            label: "Report frequency",
            options: ["none", "weekly", "monthly", "quarterly"].map((s) => ({
              value: s,
              label: s,
            })),
          },
          {
            key: "contactPreference",
            label: "Contact preference",
            options: ["ask", "email", "phone", "no_contact"].map((s) => ({
              value: s,
              label: s,
            })),
          },
          {
            key: "coInvestment",
            label: "Co-investment interest",
            type: "checkbox",
          },
          { key: "notes", label: "Internal preference notes", optional: true },
        ]}
      />
      <RecordForm
        kind="task"
        title="Create LP task"
        initial={initial}
        fields={[
          base[0],
          { key: "title", label: "Task title" },
          { key: "date", label: "Due date", type: "date", optional: true },
        ]}
      />
      <RecordForm
        kind="board_link"
        title="Link own board card to Investor"
        initial={initial}
        fields={[
          base[0],
          {
            key: "cardId",
            label: "Your own card",
            options: options(data.cards),
          },
        ]}
      />
      <section className="vq-card-static p-5">
        <h2 className="font-semibold">Investors</h2>
        <div className="mt-3 flex flex-wrap gap-3">
          {data.investors.map((i) => (
            <Link
              key={String(i.id)}
              className="rounded-xl border px-3 py-2 text-sm text-cyan-800"
              href={`/portfolio/fundraising/${i.id}`}
            >
              {String(i.display_name)}
            </Link>
          ))}
        </div>
      </section>
      <Records title="Funds" rows={data.funds} labels={labels} />
      <Records title="Commitments" rows={data.commitments} labels={labels} />
      <Records
        title="Normalized cash flows (historical wires excluded)"
        rows={data.flows}
        labels={labels}
      />
      <Records title="Preferences" rows={data.preferences} labels={labels} />
      <Records title="Tasks" rows={data.tasks} labels={labels} />
      <Records title="Stage history" rows={data.history} labels={labels} />
      {data.tasks.map((t) => (
        <RecordForm
          key={`${t.id}:${t.done}`}
          kind="task"
          title={`Update task: ${t.title}`}
          initial={{
            id: String(t.id),
            investorId: String(t.investor_id),
            title: String(t.title),
            date: String(t.due_date ?? ""),
            assignee: String(t.assignee_email ?? ""),
            done: Boolean(t.done),
          }}
          fields={[
            { key: "title", label: "Title" },
            { key: "date", label: "Due date", type: "date", optional: true },
            { key: "done", label: "Completed", type: "checkbox" },
          ]}
        />
      ))}
      <p className="text-xs text-neutral-500">
        Each section is bounded to 100 records (identity selectors: 500). This
        view is not an accounting snapshot and does not aggregate currencies.
        Report preferences do not schedule delivery.
      </p>
    </div>
  );
}
