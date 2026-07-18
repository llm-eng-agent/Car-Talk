import { describe, expect, it } from "vitest";
import {
  ASPECT_ASSESSMENT_VALUES,
  CONSTRAINT_ASSESSMENT_VALUES,
  GENERATION_JSON_SCHEMA,
  GENERATION_MODES,
  GENERATION_STATUSES,
} from "./schema";

describe("generation schema", () => {
  it("exposes the spec's status and mode vocabularies", () => {
    expect([...GENERATION_STATUSES]).toEqual(["complete", "partial", "insufficient_evidence", "out_of_scope"]);
    expect([...GENERATION_MODES]).toEqual(["single_vehicle", "comparison", "recommendation"]);
  });

  it("exposes the spec's assessment enums", () => {
    expect([...ASPECT_ASSESSMENT_VALUES]).toEqual([
      "positive",
      "negative",
      "mixed",
      "vehicle_advantage",
      "tie",
      "trade_off",
      "insufficient_evidence",
    ]);
    expect([...CONSTRAINT_ASSESSMENT_VALUES]).toEqual([
      "satisfied",
      "not_satisfied",
      "partially_satisfied",
      "insufficient_evidence",
    ]);
  });

  it("is a closed, fully-required JSON Schema object with no recommended_vehicle_id", () => {
    expect(GENERATION_JSON_SCHEMA.additionalProperties).toBe(false);
    expect(GENERATION_JSON_SCHEMA.required).toEqual(Object.keys(GENERATION_JSON_SCHEMA.properties));
    expect(JSON.stringify(GENERATION_JSON_SCHEMA)).not.toContain("recommended_vehicle_id");
  });
});
