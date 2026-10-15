// The only score implementation. SQL returns authorized daily aggregates, never a score.
export const RELATIONSHIP_VERSION = "v1";
export const WINDOW_DAYS = 180;
export type RelationshipEdge = {
  person: string;
  personName: string;
  member: string;
  memberName: string;
  days: number;
  meetings: number;
  lastOn: string;
};
export type RelationshipGraph = {
  status: "ready" | "empty" | "partial" | "unavailable";
  asOf?: string;
  windowDays?: number;
  version?: string;
  root?: string;
  target?: string;
  nodesVisited?: number;
  edges: RelationshipEdge[];
  reasons?: string[];
};
export type Introduction = {
  nodes: { id: string; name: string }[];
  edges: RelationshipEdge[];
  score: number;
};
export function utcDay(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const n = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === value
    ? n / 86400000
    : null;
}
export function relationshipScore(
  edge: Pick<RelationshipEdge, "days" | "meetings" | "lastOn">,
  asOf: string,
): number | null {
  const end = utcDay(asOf),
    last = utcDay(edge.lastOn);
  if (
    end === null ||
    last === null ||
    !Number.isInteger(edge.days) ||
    !Number.isInteger(edge.meetings) ||
    edge.days < 1 ||
    edge.days > WINDOW_DAYS ||
    edge.meetings < 0 ||
    edge.meetings > edge.days
  )
    return null;
  const age = end - last;
  if (age < 0 || age >= WINDOW_DAYS) return null;
  const recency = age <= 7 ? 50 : age <= 30 ? 40 : age <= 90 ? 25 : 10;
  return recency + 3 * Math.min(edge.days, 10) + 5 * Math.min(edge.meetings, 4);
}
export function relationshipEvidence(edge: RelationshipEdge, asOf: string) {
  return `${edge.days} contact day${edge.days === 1 ? "" : "s"} in the 180 days ending ${asOf} (UTC); last contact ${edge.lastOn}; ${edge.meetings} meeting day${edge.meetings === 1 ? "" : "s"}. Reciprocity: unavailable.`;
}
// Strict response bounds: a malformed/oversized response cannot become an unbounded UI walk.
export function parseRelationshipGraph(value: unknown): RelationshipGraph {
  const denied: RelationshipGraph = { status: "unavailable", edges: [] };
  if (!value || typeof value !== "object") return denied;
  const g = value as RelationshipGraph;
  if (g.status === "unavailable") return denied;
  if (
    !["ready", "empty", "partial"].includes(g.status) ||
    g.version !== "v1" ||
    g.windowDays !== 180 ||
    !g.asOf ||
    utcDay(g.asOf) === null ||
    !g.root ||
    !g.target ||
    !Array.isArray(g.edges) ||
    g.edges.length > 2000 ||
    !Number.isInteger(g.nodesVisited) ||
    g.nodesVisited! > 500 ||
    g.nodesVisited! < 0
  )
    return denied;
  const nodes = new Set<string>();
  for (const e of g.edges) {
    if (
      !e ||
      !/^[0-9a-f-]{36}$/i.test(e.person) ||
      !/^[0-9a-f]{32}$/i.test(e.member) ||
      typeof e.personName !== "string" ||
      e.personName.length > 160 ||
      typeof e.memberName !== "string" ||
      e.memberName.length > 160 ||
      relationshipScore(e, g.asOf) === null
    )
      return denied;
    nodes.add("p:" + e.person);
    nodes.add("m:" + e.member);
  }
  return nodes.size <= 500 ? g : denied;
}
export function introductions(graph: RelationshipGraph): {
  paths: Introduction[];
  partial: boolean;
} {
  const g = parseRelationshipGraph(graph);
  if (g.status === "unavailable") return { paths: [], partial: false };
  const roots = g.edges.filter((e) => e.member === g.root);
  const targets = g.edges.filter((e) => e.person === g.target);
  const byPair = new Map(g.edges.map((e) => [e.member + ":" + e.person, e]));
  const paths: Introduction[] = [];
  function add(edges: RelationshipEdge[], nodes: Introduction["nodes"]) {
    paths.push({
      edges,
      nodes,
      score: Math.min(...edges.map((e) => relationshipScore(e, g.asOf!)!)),
    });
  }
  for (const r of roots) {
    if (r.person === g.target) {
      add(
        [r],
        [
          { id: r.member, name: r.memberName },
          { id: r.person, name: r.personName },
        ],
      );
      continue;
    }
    for (const t of targets) {
      if (t.member === g.root) continue;
      const bridge = byPair.get(t.member + ":" + r.person);
      if (bridge)
        add(
          [r, bridge, t],
          [
            { id: r.member, name: r.memberName },
            { id: r.person, name: r.personName },
            { id: t.member, name: t.memberName },
            { id: t.person, name: t.personName },
          ],
        );
    }
  }
  // At most 2,000 edges / 500 nodes; result ordering uses only visible evidence and IDs.
  paths.sort(
    (a, b) =>
      a.edges.length - b.edges.length ||
      b.score - a.score ||
      a.nodes
        .map((n) => n.id)
        .join(":")
        .localeCompare(b.nodes.map((n) => n.id).join(":")),
  );
  return {
    paths: paths.slice(0, 20),
    partial: g.status === "partial" || paths.length > 20,
  };
}
