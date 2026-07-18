import { describe, expect, it } from "vitest";
import { type EvidencePackage, type RetrievedChunk } from "../retrieval/types";
import { buildCitations } from "./citations";
import { type GenerationOutput } from "./schema";
import { validateGenerationOutput, type ValidationContext } from "./validate";

function chunk(vehicleId: string, i: number): RetrievedChunk {
  return {
    chunkId: `${vehicleId}::b0::c${i}`,
    documentId: vehicleId,
    vehicleId,
    score: 1,
    sectionHeading: `Section ${i}`,
    contentType: "section",
    content: `content-${vehicleId}-${i}`,
    articleTitle: `${vehicleId} review`,
    sourceUrl: `https://www.auto.co.il/${vehicleId}`,
  };
}

const evidence: EvidencePackage = {
  route: "comparison",
  vehicles: [
    { vehicleId: "mg_s6", chunks: [chunk("mg_s6", 0)] },
    { vehicleId: "kia_ev9", chunks: [chunk("kia_ev9", 0)] },
  ],
  aspects: [],
  sufficient: true,
};

const ctx: ValidationContext = {
  citationMap: buildCitations(evidence).map, // C1 → mg_s6, C2 → kia_ev9
  userMessage: "מה הטווח של MG S6?",
  allowedVehicleIds: ["mg_s6", "kia_ev9"],
};

function base(): GenerationOutput {
  return {
    status: "complete",
    mode: "comparison",
    overview: { text: "השוואת טווח", citation_ids: ["C1", "C2"] },
    aspect_assessments: [
      {
        aspect: "efficiency_range",
        assessment: "vehicle_advantage",
        winner_vehicle_id: "mg_s6",
        explanation: "ל-MG טווח ארוך יותר",
        citation_ids: ["C1"],
      },
    ],
    constraint_assessments: [],
    missing_information: [],
    preference_updates: [
      { aspect: "efficiency_range", priority: 1, source: "explicit", evidence_text: "טווח" },
    ],
    usage_pattern_updates: [],
    follow_up_question: null,
  };
}

describe("validateGenerationOutput", () => {
  it("accepts a well-formed, fully-cited output", () => {
    expect(validateGenerationOutput(base(), ctx)).toEqual({ ok: true, errors: [] });
  });

  it("rejects an unknown citation id", () => {
    const out = base();
    out.overview.citation_ids = ["C9"];
    const result = validateGenerationOutput(out, ctx);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("Unknown citation 'C9'"))).toBe(true);
  });

  it("rejects a material aspect assessment with no citation", () => {
    const out = base();
    out.aspect_assessments[0].citation_ids = [];
    expect(validateGenerationOutput(out, ctx).ok).toBe(false);
  });

  it("rejects an out-of-enum aspect", () => {
    const out = base();
    out.aspect_assessments[0].aspect = "speed";
    expect(validateGenerationOutput(out, ctx).ok).toBe(false);
  });

  it("rejects a winner outside the evidence vehicles", () => {
    const out = base();
    out.aspect_assessments[0].winner_vehicle_id = "toyota_corolla";
    expect(validateGenerationOutput(out, ctx).ok).toBe(false);
  });

  it("rejects evidence_text that is not a substring of the user message", () => {
    const out = base();
    out.preference_updates[0].evidence_text = "מחיר";
    const result = validateGenerationOutput(out, ctx);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("evidence_text"))).toBe(true);
  });

  it("rejects a declared winner under insufficient_evidence", () => {
    const out = base();
    out.status = "insufficient_evidence";
    const result = validateGenerationOutput(out, ctx);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("winner is declared"))).toBe(true);
  });
});
