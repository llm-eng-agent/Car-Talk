import { describe, expect, it } from "vitest";
import { type EvidencePackage, type RetrievedChunk } from "../retrieval/types";
import { buildContext } from "./context";
import { generateAnswer, type StructuredModel } from "./generate";
import { type GenerationOutput } from "./schema";

function chunk(vehicleId: string): RetrievedChunk {
  return {
    chunkId: `${vehicleId}::b0::c0`,
    documentId: vehicleId,
    vehicleId,
    score: 1,
    sectionHeading: "Range",
    contentType: "section",
    content: "טווח של 500 קמ",
    articleTitle: `${vehicleId} review`,
    sourceUrl: `https://www.auto.co.il/${vehicleId}`,
  };
}

const pkg: EvidencePackage = {
  route: "single",
  vehicles: [{ vehicleId: "mg_s6", chunks: [chunk("mg_s6")] }],
  aspects: ["efficiency_range"],
  sufficient: true,
};
const built = buildContext("מה הטווח של MG S6?", pkg); // yields citation C1
const params = { userMessage: "מה הטווח של MG S6?", allowedVehicleIds: ["mg_s6"] };

function validOutput(): GenerationOutput {
  return {
    status: "complete",
    mode: "single_vehicle",
    overview: { text: "טווח טוב", citation_ids: ["C1"] },
    aspect_assessments: [
      { aspect: "efficiency_range", assessment: "positive", winner_vehicle_id: null, explanation: "טווח 500 קמ", citation_ids: ["C1"] },
    ],
    constraint_assessments: [],
    missing_information: [],
    preference_updates: [],
    usage_pattern_updates: [],
    follow_up_question: null,
  };
}

function invalidOutput(): GenerationOutput {
  const out = validOutput();
  out.overview.citation_ids = ["C9"]; // citation not in context
  return out;
}

function queuedModel(responses: (GenerationOutput | Error)[]): { model: StructuredModel; calls: () => number } {
  let i = 0;
  let n = 0;
  const model: StructuredModel = async () => {
    n += 1;
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    if (r instanceof Error) throw r;
    return r;
  };
  return { model, calls: () => n };
}

describe("generateAnswer", () => {
  it("accepts a valid first response without retrying", async () => {
    const { model, calls } = queuedModel([validOutput()]);
    const result = await generateAnswer(built, params, model);
    expect(result).toEqual({ ok: true, output: validOutput() });
    expect(calls()).toBe(1);
  });

  it("retries once when the first response has an invalid citation, then succeeds", async () => {
    const { model, calls } = queuedModel([invalidOutput(), validOutput()]);
    const result = await generateAnswer(built, params, model);
    expect(result.ok).toBe(true);
    expect(calls()).toBe(2);
  });

  it("retries once on a thrown provider error, then succeeds", async () => {
    const { model, calls } = queuedModel([new Error("timeout"), validOutput()]);
    const result = await generateAnswer(built, params, model);
    expect(result.ok).toBe(true);
    expect(calls()).toBe(2);
  });

  it("returns a failure after two invalid responses (at most two calls)", async () => {
    const { model, calls } = queuedModel([invalidOutput(), invalidOutput()]);
    const result = await generateAnswer(built, params, model);
    expect(result.ok).toBe(false);
    expect(calls()).toBe(2);
  });
});
