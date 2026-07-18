// Phase 5 DoD (spec lines 2900): vehicle resolution reaches 100% on the test set.
// We evaluate the deterministic resolver against the committed Hebrew golden set.
import { describe, expect, it } from "vitest";
import evalData from "../../../data/eval_queries.json";
import { resolveVehicles } from "./vehicleResolver";

interface ContextTurn {
  role: string;
  text: string;
}
interface EvalQuery {
  id: string;
  query_type: string;
  query: string;
  context?: ContextTurn[];
  expected_vehicle_ids: string[];
}

const queries = evalData as EvalQuery[];

// Retrieval text mirrors the Python runner: prepend prior user turns (follow-up context).
function retrievalText(q: EvalQuery): string {
  const prior = (q.context ?? []).filter((t) => t.role === "user").map((t) => t.text);
  return [...prior, q.query].join(" ");
}

// Queries whose vehicle is *named* in the query/context (single, comparison, follow-up, and
// the named unanswerables). Un-named recommendations and the out-of-corpus query name no
// vehicle — their expected_vehicle_ids are the answer, not a mention, so they must resolve to
// [] (they route to open discovery / abstention downstream).
function namesVehicle(q: EvalQuery): boolean {
  if (q.query_type === "recommendation") return false;
  if (q.query_type === "unanswerable") return q.expected_vehicle_ids.length > 0;
  return true;
}

describe("vehicle resolution on the golden set", () => {
  it("resolves 100% of named queries to exactly their expected vehicles", () => {
    const named = queries.filter(namesVehicle);
    expect(named.length).toBeGreaterThan(0);
    const failures = named
      .map((q) => ({ q, got: resolveVehicles(retrievalText(q)).sort() }))
      .filter(({ q, got }) => JSON.stringify(got) !== JSON.stringify([...q.expected_vehicle_ids].sort()));
    expect(failures.map((f) => ({ id: f.q.id, got: f.got, want: f.q.expected_vehicle_ids }))).toEqual([]);
  });

  it("resolves no explicit vehicle for un-named recommendations and out-of-corpus queries", () => {
    const unnamed = queries.filter((q) => !namesVehicle(q));
    for (const q of unnamed) {
      expect(resolveVehicles(q.query)).toEqual([]);
    }
  });
});
