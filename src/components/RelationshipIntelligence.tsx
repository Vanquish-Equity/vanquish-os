"use client";
import { formatDay } from "@/lib/format-datetime";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import SelectMenu from "@/components/SelectMenu";
import Checkbox from "@/components/Checkbox";
import { loadRelationshipGraph } from "@/lib/relationships/intelligence-actions";
import {
  introductions,
  relationshipEvidence,
  relationshipScore,
  type RelationshipGraph,
} from "@/lib/relationships/intelligence";
import type { RelationshipOption } from "@/lib/relationships/intelligence-queries";
export default function RelationshipIntelligence({
  people,
  members,
  allowed,
  optionsPartial = false,
  unavailable = false,
}: {
  people: RelationshipOption[];
  members: RelationshipOption[];
  allowed: boolean;
  optionsPartial?: boolean;
  unavailable?: boolean;
}) {
  const id = useId(),
    generation = useRef(0);
  const [person, setPerson] = useState(people[0]?.id ?? ""),
    [member, setMember] = useState(members[0]?.id ?? "");
  const [graph, setGraph] = useState<RelationshipGraph | null>(null),
    [evidence, setEvidence] = useState(true);
  const [busy, startTransition] = useTransition();
  function clear() {
    generation.current++;
    setGraph(null);
  }
  useEffect(() => {
    // Authorization is revalidated on every request; discard displayed evidence on refocus.
    const reset = () => {
      generation.current++;
      setGraph(null);
    };
    window.addEventListener("focus", reset);
    return () => window.removeEventListener("focus", reset);
  }, []);
  const result = graph ? introductions(graph) : null;
  const strengths = (graph?.edges ?? [])
    .filter((e) => e.person === person)
    .sort(
      (a, b) =>
        (relationshipScore(b, graph!.asOf!) ?? -1) -
          (relationshipScore(a, graph!.asOf!) ?? -1) ||
        a.member.localeCompare(b.member),
    );
  return (
    <section
      aria-label="Relationship intelligence"
      className="vq-card-static min-w-0 rounded-[14px] bg-white p-4 sm:p-5 motion-reduce:[&_*]:animate-none motion-reduce:[&_*]:transition-none"
    >
      <h2 className="text-[15px] font-semibold text-ink">
        Relationship intelligence
      </h2>
      <p className="mt-2 text-[12px] text-neutral-500">
        Shows only that contact happened and when, never what was said, over the
        last 180 days. A shared contact suggests who to ask about an
        introduction; it is not a promise of one. Two-way contact is not
        measured yet.
      </p>
      {!allowed || unavailable ? (
        <p role="status" className="mt-4 text-sm">
          Not available. You need an active membership, relationship access and
          sharing turned on.
        </p>
      ) : (
        <>
          <div className="mt-4 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="min-w-0">
              <label htmlFor={id + "-person"} className="mb-1 block text-xs">
                Target person
              </label>
              <SelectMenu
                id={id + "-person"}
                value={person}
                options={people.map((p) => ({ value: p.id, label: p.name }))}
                rootClassName="min-w-0 w-full"
                buttonClassName="min-h-11"
                onChange={(v) => {
                  clear();
                  setPerson(v);
                }}
              />
            </div>
            <div className="min-w-0">
              <label htmlFor={id + "-member"} className="mb-1 block text-xs">
                Starting member (sharing enabled)
              </label>
              <SelectMenu
                id={id + "-member"}
                value={member}
                options={members.map((m) => ({ value: m.id, label: m.name }))}
                rootClassName="min-w-0 w-full"
                buttonClassName="min-h-11"
                onChange={(v) => {
                  clear();
                  setMember(v);
                }}
              />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <button
              disabled={busy || !person || !member}
              className="min-h-11 rounded-full bg-ink px-4 text-xs font-semibold text-white disabled:opacity-40"
              onClick={() => {
                clear();
                const request = generation.current;
                startTransition(async () => {
                  const data = await loadRelationshipGraph(person, member);
                  if (request === generation.current) setGraph(data);
                });
              }}
            >
              {busy
                ? "Checking shared activity…"
                : "Calculate relationships"}
            </button>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs">
              <Checkbox
                checked={evidence}
                onChange={(e) => setEvidence(e.target.checked)}
              />
              Show path evidence
            </label>
          </div>
          {!people.length || !members.length ? (
            <p role="status" className="mt-3 text-sm">
              Empty. No visible people or active sharing members available.
            </p>
          ) : null}
          {optionsPartial && (
            <p className="mt-3 text-xs">
              Showing up to 50 people and 500 members. Open a person&apos;s
              record to check that person directly.
            </p>
          )}
          {graph?.status === "unavailable" && (
            <p role="status" className="mt-4 text-sm">
              Not available right now. Access or sharing may have changed.
              Refresh the page and try again.
            </p>
          )}
          {graph && graph.status !== "unavailable" && (
            <div aria-live="polite" className="mt-4 space-y-4 text-[13px]">
              {result?.partial && (
                <p
                  role="status"
                  className="rounded-xl border border-amber-200 bg-amber-50 p-3"
                >
                  Partial result: the search stopped early because it reached a
                  time or size limit. Scores are minimums and some connections
                  may be missing.
                </p>
              )}
              <h3 className="font-semibold">
                Strength for the selected person, as of {formatDay(graph.asOf)}
              </h3>
              {strengths.map((e) => (
                <article
                  key={e.member}
                  className="rounded-xl border border-neutral-100 p-3"
                >
                  <p>
                    {e.memberName}:{" "}
                    <strong>{relationshipScore(e, graph.asOf!)}/100</strong> 
                    {result?.partial ? " (at least)" : ""}
                  </p>
                  <p className="mt-1 text-xs text-neutral-500">
                    {relationshipEvidence(e, graph.asOf!)}
                  </p>
                </article>
              ))}
              {!strengths.length && (
                <p>
                  No shared activity found in this period
                  {result?.partial ? " before the search stopped" : ""}. No
                  result does not mean a score of zero.
                </p>
              )}
              <h3 className="font-semibold">
                Introduction routes · at most 3 hops
              </h3>
              {result?.paths.map((p) => (
                <article
                  key={p.nodes.map((n) => n.id).join(":")}
                  className="rounded-xl border border-neutral-100 p-3"
                >
                  <ol className="list-inside list-decimal space-y-1 break-words">
                    {p.nodes.map((n) => (
                      <li key={n.id}>{n.name}</li>
                    ))}
                  </ol>
                  <p className="mt-2 text-xs">
                    {p.edges.length} hop{p.edges.length === 1 ? "" : "s"} ·
                    weakest edge {p.score}/100
                  </p>
                  {evidence && (
                    <ul className="mt-2 space-y-2 text-xs text-neutral-500">
                      {p.edges.map((e) => (
                        <li key={e.member + e.person}>
                          {e.memberName} with {e.personName}:{" "}
                          {relationshipEvidence(e, graph.asOf!)}
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              ))}
              {!result?.paths.length && (
                <p>
                  No connection found
                  {result?.partial
                    ? " before the search stopped"
                    : " in this window"}
                  . This does not establish that no relationship exists.
                </p>
              )}
              <p className="text-xs text-neutral-500">
                No subjects, titles, bodies, attendees or direction are used.
                Contact days count once across email and meetings. A meeting day
                does not prove mutual participation or reciprocity.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
