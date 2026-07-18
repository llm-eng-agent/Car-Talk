import { describe, expect, it } from "vitest";
import { type Aspect } from "../retrieval/types";
import { type ParsedConstraints } from "./constraints";
import { recommend } from "./recommend";
import {
  type AspectAssessment,
  type AspectAssessmentValue,
  type ConstraintAssessment,
  type ConstraintAssessmentValue,
  type GenerationOutput,
} from "./schema";

function aspect(a: Aspect, assessment: AspectAssessmentValue, winner: string | null): AspectAssessment {
  return { aspect: a, assessment, winner_vehicle_id: winner, explanation: "", citation_ids: winner ? ["C1"] : [] };
}

function constraint(vehicleId: string, name: string, status: ConstraintAssessmentValue): ConstraintAssessment {
  return { constraint: name, vehicle_id: vehicleId, status, explanation: "", citation_ids: ["C1"] };
}

function out(over: Partial<GenerationOutput>): GenerationOutput {
  return {
    status: "complete",
    mode: "recommendation",
    overview: { text: "", citation_ids: [] },
    aspect_assessments: [],
    constraint_assessments: [],
    missing_information: [],
    preference_updates: [],
    usage_pattern_updates: [],
    follow_up_question: null,
    ...over,
  };
}

const noConstraints: ParsedConstraints = {};

describe("recommend", () => {
  it("eliminates a vehicle that violates a hard constraint", () => {
    const rec = recommend(
      out({ constraint_assessments: [constraint("kia_ev9", "minimum_seats", "satisfied"), constraint("mg_s6", "minimum_seats", "not_satisfied")] }),
      { candidateVehicleIds: ["kia_ev9", "mg_s6"], priorityAspects: [], constraints: { minimumSeats: 7 } },
    );
    expect(rec.eliminated).toEqual([{ vehicleId: "mg_s6", constraint: "minimum_seats" }]);
    expect(rec.decision).toBe("kia_ev9");
    expect(rec.decisionRule).toBe("constraint");
  });

  it("does NOT eliminate a vehicle with missing constraint evidence", () => {
    const rec = recommend(
      out({
        constraint_assessments: [constraint("kia_ev9", "minimum_seats", "insufficient_evidence")],
        aspect_assessments: [aspect("space_practicality", "vehicle_advantage", "kia_ev9")],
      }),
      { candidateVehicleIds: ["kia_ev9", "mg_s6"], priorityAspects: [], constraints: { minimumSeats: 7 } },
    );
    expect(rec.eliminated).toEqual([]);
    // kia is "blocked" (unverified stated constraint) so it cannot be the confident pick.
    expect(rec.decision).not.toBe("kia_ev9");
  });

  it("ignores a not_satisfied constraint the user never requested", () => {
    const rec = recommend(
      out({
        // The model volunteered a constraint the user did not ask for.
        constraint_assessments: [constraint("mg_s6", "minimum_seats", "not_satisfied")],
        aspect_assessments: [aspect("performance", "vehicle_advantage", "mg_s6")],
      }),
      { candidateVehicleIds: ["mg_s6", "kia_ev9"], priorityAspects: [], constraints: noConstraints },
    );
    expect(rec.eliminated).toEqual([]); // no constraint was requested
    expect(rec.decision).toBe("mg_s6"); // falls through to aspect evidence
  });

  it("uses the highest-priority aspect (lexicographic) to decide", () => {
    const rec = recommend(
      out({
        aspect_assessments: [
          aspect("performance", "vehicle_advantage", "mg_s6"),
          aspect("efficiency_range", "vehicle_advantage", "kia_ev9"),
        ],
      }),
      { candidateVehicleIds: ["mg_s6", "kia_ev9"], priorityAspects: ["performance", "efficiency_range"], constraints: noConstraints },
    );
    expect(rec.decision).toBe("mg_s6");
    expect(rec.decisionRule).toBe("lexicographic");
  });

  it("skips a tied top priority and decides on the next one", () => {
    const rec = recommend(
      out({
        aspect_assessments: [
          aspect("performance", "tie", null),
          aspect("efficiency_range", "vehicle_advantage", "kia_ev9"),
        ],
      }),
      { candidateVehicleIds: ["mg_s6", "kia_ev9"], priorityAspects: ["performance", "efficiency_range"], constraints: noConstraints },
    );
    expect(rec.decision).toBe("kia_ev9");
    expect(rec.decisionRule).toBe("lexicographic");
  });

  it("recommends the sole Pareto winner when priorities are unranked", () => {
    const rec = recommend(
      out({ aspect_assessments: [aspect("space_practicality", "vehicle_advantage", "kia_ev9"), aspect("refinement", "tie", null)] }),
      { candidateVehicleIds: ["kia_ev9", "genesis_gv80"], priorityAspects: [], constraints: noConstraints },
    );
    expect(rec.decision).toBe("kia_ev9");
    expect(rec.decisionRule).toBe("pareto");
    expect(rec.tradeOff).toBe(false);
  });

  it("reports a trade-off (no winner) when each vehicle wins a different aspect", () => {
    const rec = recommend(
      out({
        follow_up_question: "מה חשוב לך יותר?",
        aspect_assessments: [aspect("performance", "vehicle_advantage", "mg_s6"), aspect("space_practicality", "vehicle_advantage", "kia_ev9")],
      }),
      { candidateVehicleIds: ["mg_s6", "kia_ev9"], priorityAspects: [], constraints: noConstraints },
    );
    expect(rec.decision).toBeNull();
    expect(rec.tradeOff).toBe(true);
    expect(rec.followUpQuestion).toBe("מה חשוב לך יותר?");
  });

  it("returns no decision (no numeric score field) when evidence does not differentiate", () => {
    const rec = recommend(
      out({ aspect_assessments: [aspect("performance", "tie", null)] }),
      { candidateVehicleIds: ["mg_s6", "kia_ev9"], priorityAspects: [], constraints: noConstraints },
    );
    expect(rec.decision).toBeNull();
    expect(rec.decisionRule).toBe("none");
    expect(Object.keys(rec)).not.toContain("score");
  });
});
