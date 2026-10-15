import { describe, expect, it } from "vitest";
import {
  introductions,
  parseRelationshipGraph,
  relationshipEvidence,
  relationshipScore,
  utcDay,
  type RelationshipEdge,
  type RelationshipGraph,
} from "./intelligence";
const p = "f4000000-0000-0000-0000-000000000001",
  bridge = "f4000000-0000-0000-0000-000000000002";
const a = "a".repeat(32),
  b = "b".repeat(32),
  c = "c".repeat(32);
const edge = (
  person = p,
  member = a,
  days = 1,
  meetings = 0,
  lastOn = "2026-10-14",
): RelationshipEdge => ({
  person,
  member,
  days,
  meetings,
  lastOn,
  personName: "Synthetic person",
  memberName: "Synthetic member",
});
const graph = (edges: RelationshipEdge[]): RelationshipGraph => ({
  status: "ready",
  asOf: "2026-10-15",
  windowDays: 180,
  version: "v1",
  root: a,
  target: p,
  nodesVisited: 5,
  edges,
});
describe("relationship intelligence v1", () => {
  it("has known recency/frequency/meeting weights and saturated upper bound", () => {
    expect(relationshipScore(edge(), "2026-10-15")).toBe(53);
    // Same aggregate as SQL fixture: two distinct dates, one meeting date.
    expect(relationshipScore(edge(p, a, 2, 1), "2026-10-15")).toBe(61);
    expect(
      relationshipScore(edge(p, a, 4, 1, "2026-09-30"), "2026-10-15"),
    ).toBe(57);
    expect(relationshipScore(edge(p, a, 180, 180), "2026-10-15")).toBe(100);
    expect(
      relationshipScore(edge(p, a, 1, 0, "2026-07-01"), "2026-10-15"),
    ).toBe(13);
  });
  it("rejects future, impossible and non-date values and empty windows instead of inventing zero", () => {
    for (const date of [
      "2026-10-16",
      "2026-02-30",
      "not-a-date",
      "2026-04-18",
      "2026-10-15T00:00:00Z",
    ])
      expect(
        relationshipScore(edge(p, a, 1, 0, date), "2026-10-15"),
      ).toBeNull();
    expect(relationshipScore(edge(p, a, 0), "2026-10-15")).toBeNull();
    expect(relationshipScore(edge(p, a, 1, 2), "2026-10-15")).toBeNull();
    expect(utcDay("2026-10-15")).toBe(Date.UTC(2026, 9, 15) / 86400000);
    expect(
      relationshipScore(edge(p, a, 1, 0, "2026-04-19"), "2026-10-15"),
    ).toBe(13);
  });
  it("explains evidence, UTC window, version-independent unavailability of reciprocity", () => {
    expect(
      relationshipEvidence(edge(p, a, 4, 1, "2026-09-30"), "2026-10-15"),
    ).toContain(
      "4 contact days in the 180 days ending 2026-10-15 (UTC); last contact 2026-09-30; 1 meeting day. Reciprocity: unavailable.",
    );
  });
  it("uses distinct-member evidence and only direct or three-edge bipartite paths", () => {
    const edges = [
      edge(bridge, a),
      edge(bridge, b, 4),
      edge(p, b, 2, 1),
      edge(p, c, 180, 4),
    ];
    const { paths } = introductions(graph(edges));
    expect(paths).toHaveLength(1);
    expect(paths[0].nodes.map((n) => n.id)).toEqual([a, bridge, b, p]);
    expect(paths[0].score).toBe(53);
    expect(paths[0].edges).toHaveLength(3);
    expect(introductions(graph([edge(p, b)])).paths).toHaveLength(0);
  });
  it("orders direct paths first and ties deterministically on visible IDs", () => {
    const edges = [
      edge(bridge, a),
      edge(bridge, c),
      edge(p, c),
      edge(bridge, b),
      edge(p, b),
      edge(p, a),
    ];
    expect(
      introductions(graph(edges)).paths.map((p) => p.nodes.map((n) => n.id)),
    ).toEqual([
      [a, p],
      [a, bridge, b, p],
      [a, bridge, c, p],
    ]);
    expect(introductions(graph([...edges].reverse()))).toEqual(
      introductions(graph(edges)),
    );
  });
  it("distinguishes empty, unavailable, and partial, rejecting malformed/unbounded data", () => {
    expect(introductions({ ...graph([]), status: "empty" })).toEqual({
      paths: [],
      partial: false,
    });
    expect(introductions({ ...graph([]), status: "partial" })).toEqual({
      paths: [],
      partial: true,
    });
    expect(
      parseRelationshipGraph({ ...graph([]), nodesVisited: 501 }).status,
    ).toBe("unavailable");
    expect(
      parseRelationshipGraph({ ...graph([]), edges: Array(2001).fill(edge()) })
        .status,
    ).toBe("unavailable");
    expect(
      parseRelationshipGraph(graph([edge(p, a, 1, 0, "invalid")])).status,
    ).toBe("unavailable");
  });
  it("marks a capped list partial and never returns more than 20 routes", () => {
    const edges = [edge(bridge, a)];
    for (let i = 1; i <= 25; i++) {
      const member = i.toString(16).padStart(32, "0");
      edges.push(edge(bridge, member), edge(p, member));
    }
    const result = introductions(graph(edges));
    expect(result.paths).toHaveLength(20);
    expect(result.partial).toBe(true);
  });
});
