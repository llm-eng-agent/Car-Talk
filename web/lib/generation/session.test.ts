import { describe, expect, it } from "vitest";
import { type GenerationOutput } from "./schema";
import { emptySession, sanitizeSession, updateSession, type SessionTurn } from "./session";

function out(over: Partial<GenerationOutput>): GenerationOutput {
  return {
    status: "complete",
    mode: "single_vehicle",
    overview: { text: "תקציר", citation_ids: [] },
    aspect_assessments: [],
    constraint_assessments: [],
    missing_information: [],
    preference_updates: [],
    usage_pattern_updates: [],
    follow_up_question: null,
    ...over,
  };
}

function turn(over: Partial<SessionTurn>): SessionTurn {
  return { userQuery: "q", resolvedVehicleIds: [], route: "single", output: out({}), constraints: {}, ...over };
}

describe("emptySession", () => {
  it("starts empty (new session — spec §16.2)", () => {
    expect(emptySession()).toEqual({
      activeVehicleIds: [],
      comparisonVehicleIds: [],
      preferences: { priorities: [], constraints: {}, usagePatterns: [] },
      recentTurns: [],
      inferredCounts: {},
    });
  });
});

describe("sanitizeSession", () => {
  it("drops non-approved vehicles and out-of-enum aspects/usage", () => {
    const s = sanitizeSession({
      activeVehicleIds: ["mg_s6", "toyota_corolla"],
      preferences: { priorities: ["performance", "nonsense"], usagePatterns: ["city_driving", "flying"], constraints: {} },
      recentTurns: [{ user: "a", assistant: "b" }, { user: "c", assistant: "d" }, { user: "e", assistant: "f" }],
    });
    expect(s.activeVehicleIds).toEqual(["mg_s6"]);
    expect(s.preferences.priorities).toEqual(["performance"]);
    expect(s.preferences.usagePatterns).toEqual(["city_driving"]);
    expect(s.recentTurns).toHaveLength(2); // capped
  });

  it("returns an empty session for garbage input", () => {
    expect(sanitizeSession(null)).toEqual(emptySession());
    expect(sanitizeSession("nope")).toEqual(emptySession());
  });
});

describe("updateSession", () => {
  it("stores an explicit preference immediately", () => {
    const s = updateSession(emptySession(), turn({
      output: out({ preference_updates: [{ aspect: "ride_comfort", priority: 1, source: "explicit", evidence_text: "נוחות" }] }),
    }));
    expect(s.preferences.priorities).toEqual(["ride_comfort"]);
  });

  it("stores an inferred preference only after two turns (two-turn rule §249)", () => {
    const infer = turn({
      output: out({ preference_updates: [{ aspect: "performance", priority: 1, source: "inferred", evidence_text: "ביצועים" }] }),
    });
    const after1 = updateSession(emptySession(), infer);
    expect(after1.preferences.priorities).toEqual([]); // not yet
    expect(after1.inferredCounts.performance).toBe(1);

    const after2 = updateSession(after1, infer);
    expect(after2.preferences.priorities).toEqual(["performance"]); // now it sticks
  });

  it("lets a later explicit correction reorder priorities (override stale order)", () => {
    const prev = { ...emptySession(), preferences: { priorities: ["performance" as const], constraints: {}, usagePatterns: [] } };
    const s = updateSession(prev, turn({
      output: out({ preference_updates: [{ aspect: "ride_comfort", priority: 1, source: "explicit", evidence_text: "נוחות" }] }),
    }));
    expect(s.preferences.priorities).toEqual(["ride_comfort", "performance"]);
  });

  it("orders multiple explicit priorities by their stated rank", () => {
    const s = updateSession(emptySession(), turn({
      output: out({ preference_updates: [
        { aspect: "performance", priority: 2, source: "explicit", evidence_text: "ביצועים" },
        { aspect: "ride_comfort", priority: 1, source: "explicit", evidence_text: "נוחות" },
      ] }),
    }));
    expect(s.preferences.priorities).toEqual(["ride_comfort", "performance"]);
  });

  it("does not turn a one-time question into a preference", () => {
    const s = updateSession(emptySession(), turn({ output: out({ preference_updates: [] }) }));
    expect(s.preferences.priorities).toEqual([]);
  });

  it("lets a new explicit constraint override a conflicting prior one", () => {
    const prev = { ...emptySession(), preferences: { priorities: [], constraints: { allowedPowertrains: ["diesel" as const] }, usagePatterns: [] } };
    const s = updateSession(prev, turn({ constraints: { allowedPowertrains: ["electric"] } }));
    expect(s.preferences.constraints.allowedPowertrains).toEqual(["electric"]);
  });

  it("keeps active vehicles on a follow-up that names none, and sets comparison vehicles", () => {
    const withActive = updateSession(emptySession(), turn({ resolvedVehicleIds: ["mg_s6", "kia_ev9"], route: "comparison" }));
    expect(withActive.activeVehicleIds).toEqual(["mg_s6", "kia_ev9"]);
    expect(withActive.comparisonVehicleIds).toEqual(["mg_s6", "kia_ev9"]);

    const followUp = updateSession(withActive, turn({ resolvedVehicleIds: [] }));
    expect(followUp.activeVehicleIds).toEqual(["mg_s6", "kia_ev9"]); // carried over
  });

  it("unions valid usage patterns and ignores unknown ones", () => {
    const s = updateSession(emptySession(), turn({
      output: out({ usage_pattern_updates: [
        { usage_pattern: "long_trips", source: "explicit", evidence_text: "טיולים" },
        { usage_pattern: "space_travel", source: "explicit", evidence_text: "x" },
      ] }),
    }));
    expect(s.preferences.usagePatterns).toEqual(["long_trips"]);
  });

  it("keeps only the two most recent turns", () => {
    let s = emptySession();
    for (const q of ["a", "b", "c"]) s = updateSession(s, turn({ userQuery: q, output: out({ overview: { text: `ans-${q}`, citation_ids: [] } }) }));
    expect(s.recentTurns.map((t) => t.user)).toEqual(["b", "c"]);
  });
});
